// Award Prizes tab: CTP block moved for admins, half-season and League Championship awards (ties split, no tie-break), pay + reset rules.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name, isAsync) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return (isAsync ? 'async ' : '') + src.slice(i, k + 1); }
}
const J = x => JSON.parse(JSON.stringify(x));
function world(over) {
  const calls = [], alerts = [], confirms = [];
  const c = vm.createContext(Object.assign({ calls, alerts, confirms, console, Math, parseInt, parseFloat, String, Object, Array, JSON, Set,
    escapeHtml: x => String(x), requireOfficer: () => true, confirm: m => { confirms.push(m); return c.__confirmAnswer !== false; }, alert: m => alerts.push(m),
    serverRun: (sql, args) => { calls.push({ sql, args }); }, SERVER_RUN_QUEUE: Promise.resolve(), saveDBToServer: async () => { calls.push({ sql: 'SAVEDB' }); },
    logIt() {}, renderAwardPrizes() {}, currentUser: { name: 'Admin' }, query: () => [] }, over));
  ['awardPlaceLabel', 'awardPlacesWithTies', 'awardDetailFor', 'awardCommentFor', 'awardRecordedRows', 'awardIsPaid', 'halfSeasonAwardPlan', 'champAwardPlan', 'awardReset']
    .forEach(n => vm.runInContext(extract(n), c));
  vm.runInContext(extract('awardWrite', true) + '\n' + extract('halfSeasonAwardReadiness') + '\n' + extract('awardHalfSeasonWinners', true) + '\n' + extract('awardChampionshipWinners', true), c);
  return c;
}
// ── places with ties: tied entries share the combined prizes of the places they cover; no tie-break ──
const E = (id, score, n = 2) => ({ id, score, players: Array.from({ length: n }, (_, i) => id + i) });
let c = world();
let r = J(c.awardPlacesWithTies([E('A', 50), E('B', 40), E('C', 30)], [120, 100, 90]));
assert.deepStrictEqual(r.map(x => [x.id, x.place, x.tied, x.prize, x.perPlayer]), [['A', 1, false, 120, 60], ['B', 2, false, 100, 50], ['C', 3, false, 90, 45]]);
r = J(c.awardPlacesWithTies([E('A', 50), E('B', 40), E('C', 40), E('D', 10)], [120, 100, 90]));   // B and C tie for 2nd: (100 + 90) / 2 each
assert.deepStrictEqual(r.map(x => [x.id, x.place, x.tied, x.prize]), [['A', 1, false, 120], ['B', 2, true, 95], ['C', 2, true, 95], ['D', 4, false, 0]]);
r = J(c.awardPlacesWithTies([E('A', 50), E('B', 40), E('C', 30), E('D', 30)], [120, 100, 90]));   // tie straddling the last paid place: 90 / 2
assert.deepStrictEqual(r.map(x => x.prize), [120, 100, 45, 45]);
r = J(c.awardPlacesWithTies([E('A', 5), E('B', 5), E('C', 5)], [100, 50, 25]));                    // three-way tie for 1st: 175 / 3
assert.deepStrictEqual(r.map(x => [x.place, x.prize]), [[1, 58.33], [1, 58.33], [1, 58.33]]);
assert.strictEqual(r[0].perPlayer, 29.17, 'cents per player on a team');
r = J(c.awardPlacesWithTies([E('A', 5, 1)], [100, 50])); assert.deepStrictEqual([r[0].prize, r[0].perPlayer], [100, 100], 'one player gets the whole prize');
assert.strictEqual(c.awardDetailFor({ place: 2 }), 'Earned-2nd'); assert.strictEqual(c.awardCommentFor({ place: 2, tied: true }, '1st half'), 'T2nd-1st half');

// ── half season ──
c = world({ calcHalfSeasonWinners: () => ({ ok: true, amounts: [120, 100, 90], midDate: 20260630, allRanked: [
  { team: 3, aPlayer: 'Ann', bPlayer: 'Bob', total: 61 }, { team: 7, aPlayer: 'Cy', bPlayer: 'Di', total: 55 }, { team: 9, aPlayer: 'Ed', bPlayer: 'Flo', total: 55 }, { team: 1, aPlayer: 'Gus', bPlayer: 'Hal', total: 20 }] }) });
let plan = c.halfSeasonAwardPlan(2026, 1);
assert.deepStrictEqual(J(plan.rows.map(x => [x.team, x.place, x.tied, x.prize, x.perPlayer])), [[3, 1, false, 120, 60], [7, 2, true, 95, 47.5], [9, 2, true, 95, 47.5]], 'only paid places; the tie splits 2nd+3rd');
c = world({ calcHalfSeasonWinners: () => ({ ok: false, message: 'No schedule found for this season.' }) });
assert.strictEqual(c.halfSeasonAwardPlan(2026, 1).ok, false);
// readiness: every scheduled date of the half must have scores
const sched = ['20260407', '20260414', '20260421', '20260428', '20260505', '20260512'];   // middle = 20260428 -> half 1 = first three dates
c = world({ query: sql => /FROM Schedule/.test(sql) ? sched.map(d => ({ sDate: d })) : /FROM Scores/.test(sql) ? ['20260407', '20260414', '20260421', '20260428'].map(d => ({ sDate: d })) : [] });
assert.deepStrictEqual(J(c.halfSeasonAwardReadiness(2026, 1)), { ready: true, missing: [] });
let rd = J(c.halfSeasonAwardReadiness(2026, 2)); assert.strictEqual(rd.ready, false); assert.deepStrictEqual(rd.missing, ['20260505', '20260512']);

(async () => {
  // award the half: writes unpaid payout rows (one per player) dated 12/31 with the place, only after a confirm
  c = world({ calcHalfSeasonWinners: () => ({ ok: true, amounts: [120, 100, 90], midDate: 1, allRanked: [{ team: 3, aPlayer: 'Ann', bPlayer: 'Bob', total: 61 }, { team: 7, aPlayer: 'Cy', bPlayer: 'Di', total: 55 }] }),
    query: sql => /FROM Schedule/.test(sql) ? ['20260407', '20260414'].map(d => ({ sDate: d })) : /FROM Scores/.test(sql) ? [{ sDate: '20260407' }] : /FROM Payments/.test(sql) ? [] : [] });
  // not finished (20260414 has no scores) -> nothing is written
  await c.awardHalfSeasonWinners(2026, 2);
  assert(c.alerts.some(a => /not finished/.test(a)) || c.calls.length === 0);
  c = world({ calcHalfSeasonWinners: () => ({ ok: true, amounts: [120, 100, 90], midDate: 1, allRanked: [{ team: 3, aPlayer: 'Ann', bPlayer: 'Bob', total: 61 }, { team: 7, aPlayer: 'Cy', bPlayer: 'Di', total: 55 }] }),
    query: sql => /FROM Schedule/.test(sql) ? ['20260407', '20260414'].map(d => ({ sDate: d })) : /FROM Scores/.test(sql) ? ['20260407', '20260414'].map(d => ({ sDate: d })) : [] });
  await c.awardHalfSeasonWinners(2026, 1);
  const ins = c.calls.filter(x => /INSERT INTO Payments/.test(x.sql));
  assert.strictEqual(ins.length, 4, 'two teams x two players');
  assert.deepStrictEqual(J(ins[0].args), ["Hugh's", 'Ann', '20261231', 'Reg Season Champ-1st half', 'Earned-1st', 60, '', '1st-1st half', '']);
  assert.deepStrictEqual(J(ins[2].args).slice(1, 8), ['Cy', '20261231', 'Reg Season Champ-1st half', 'Earned-2nd', 50, '', '2nd-1st half']);
  assert(c.calls.some(x => x.sql === 'SAVEDB') && /Award 1st half winners \(2026\)/.test(c.confirms[0]) && /Team 3 \(Ann \/ Bob\)/.test(c.confirms[0]), 'confirmed with a preview, then saved');
  // declining the confirm writes nothing
  c = world({ calcHalfSeasonWinners: () => ({ ok: true, amounts: [120], midDate: 1, allRanked: [{ team: 3, aPlayer: 'Ann', bPlayer: 'Bob', total: 61 }] }),
    query: sql => /FROM Schedule/.test(sql) ? [{ sDate: '20260407' }] : /FROM Scores/.test(sql) ? [{ sDate: '20260407' }] : [] });
  c.__confirmAnswer = false; await c.awardHalfSeasonWinners(2026, 1); assert.strictEqual(c.calls.filter(x => /INSERT/.test(x.sql)).length, 0, 'declined');
  // an award that already exists is not made twice
  c = world({ calcHalfSeasonWinners: () => ({ ok: true, amounts: [120], midDate: 1, allRanked: [{ team: 3, aPlayer: 'Ann', bPlayer: 'Bob', total: 61 }] }),
    query: sql => /FROM Schedule/.test(sql) ? [{ sDate: '20260407' }] : /FROM Scores/.test(sql) ? [{ sDate: '20260407' }] : /FROM Payments/.test(sql) ? [{ Player: 'Ann', Detail: 'Earned-1st', Earned: 60, DatePaid: '' }] : [] });
  await c.awardHalfSeasonWinners(2026, 1); assert.strictEqual(c.calls.filter(x => /INSERT/.test(x.sql)).length, 0); assert(c.alerts.some(a => /already been made/.test(a)));

  // ── League Championship ──
  const scores = [ // Player, D, Net, Gross: week1 = 20260929, week2 = 20261006
    ['Ann', 20260929, 36, 41], ['Ann', 20261006, 35, 40], ['Bob', 20260929, 34, 40], ['Bob', 20261006, 37, 42], ['Cy', 20260929, 33, 39], ['Cy', 20261006, 38, 43],
    ['Di', 20260929, 30, 36], ['Sub Sam', 20260929, 20, 30], ['Sub Sam', 20261006, 20, 30], ['Eve', 20260929, 10, 20]];                                 // Di and Eve played one week; Sam is a sub
  const mk = (over2) => world(Object.assign({
    getSeasonSettings: () => ({ PostSeasonDt: '9/29/2026' }), parsePostSeasonDates: () => ({ week1: 20260929, week2: 20261006 }),
    ccRosterEligible: p => p !== 'Sub Sam', psCcPrizeSchedule: () => [100, 50, 25],
    query: sql => /FROM Scores/.test(sql) ? scores.map(([Player, D, Net, Gross]) => ({ Player, D, Net, Gross })) : /League Dues/.test(sql) ? [{ t: 0 }] : [] }, over2));
  c = mk();
  plan = c.champAwardPlan(2026);
  // three players are level on 71: they share places 1-3 (100+50+25)/3 each, no tie-break; subs and one-week players are not ranked
  assert.deepStrictEqual(J(plan.placed.map(x => [x.id, x.score, x.place, x.tied])), [['Ann', 71, 1, true], ['Bob', 71, 1, true], ['Cy', 71, 1, true]]);
  assert.deepStrictEqual(J(plan.paid.map(x => x.perPlayer)), [58.33, 58.33, 58.33]);
  assert(!plan.placed.some(x => x.id === 'Sub Sam'), 'a sub cannot compete'); assert.deepStrictEqual(J(plan.missingWeek), [{ player: 'Di', week: 2 }, { player: 'Eve', week: 2 }]);
  assert(plan.week1Scored && plan.week2Scored);
  // award: unpaid rows dated 12/31, T1st comments, only after confirm
  await c.awardChampionshipWinners(2026);
  const ci = c.calls.filter(x => /INSERT INTO Payments/.test(x.sql)); assert.strictEqual(ci.length, 3);
  assert.deepStrictEqual(J(ci[0].args), ["Hugh's", 'Ann', '20261231', 'League Championship', 'Earned-1st', 58.33, '', 'T1st-League Championship', '']);
  assert(/Award League Championship winners \(2026\)/.test(c.confirms[0]) && /tied: the combined prizes are split/.test(c.confirms[0]));
  // both weeks required before it can be awarded; no prize money set -> refuses
  c = mk({ query: sql => /FROM Scores/.test(sql) ? scores.filter(s => s[1] === 20260929).map(([Player, D, Net, Gross]) => ({ Player, D, Net, Gross })) : [{ t: 0 }] });
  await c.awardChampionshipWinners(2026); assert(c.alerts.some(a => /Both post-season weeks need scores/.test(a))); assert.strictEqual(c.calls.length, 0);
  c = mk({ psCcPrizeSchedule: () => [0, 0, 0] }); await c.awardChampionshipWinners(2026); assert(c.alerts.some(a => /No prize money is set/.test(a))); assert.strictEqual(c.calls.filter(x => /INSERT/.test(x.sql)).length, 0);
  c = world({ getSeasonSettings: () => ({}), parsePostSeasonDates: () => null }); assert.strictEqual(c.champAwardPlan(2026).ok, false);
  // distinct nets: strict order, ties only where nets match, Percent dues pass through the schedule helper
  c = mk({ query: sql => /FROM Scores/.test(sql) ? [['Ann', 20260929, 30], ['Ann', 20261006, 30], ['Bob', 20260929, 31], ['Bob', 20261006, 30], ['Cy', 20260929, 40], ['Cy', 20261006, 40]].map(([Player, D, Net]) => ({ Player, D, Net, Gross: 40 })) : [{ t: 0 }] });
  assert.deepStrictEqual(J(c.champAwardPlan(2026).placed.map(x => [x.id, x.place, x.prize])), [['Ann', 1, 100], ['Bob', 2, 50], ['Cy', 3, 25]]);

  // ── reset: only while nothing has been paid ──
  c = world({ query: sql => /FROM Payments/.test(sql) ? [{ Player: 'Ann', Detail: 'Earned-1st', Earned: 60, DatePaid: '4/1/2026' }, { Player: 'Bob', Detail: 'Earned-1st', Earned: 60, DatePaid: '' }] : [] });
  c.awardReset(2026, 'League Championship'); assert(c.alerts.some(a => /already been marked paid/.test(a))); assert.strictEqual(c.calls.length, 0);
  c = world({ query: sql => /FROM Payments/.test(sql) ? [{ Player: 'Ann', Detail: 'Earned-1st', Earned: 60, DatePaid: '' }] : [] });
  c.awardReset(2026, 'League Championship'); assert(c.calls.some(x => /DELETE FROM Payments .*DatePaid IS NULL OR DatePaid=''/.test(x.sql)), 'removes only unpaid rows'); 

  // ── wiring ──
  const skins = src.slice(src.indexOf('id="tab-skins"'), src.indexOf('id="tab-noshows"'));
  const awards = src.slice(src.indexOf('id="adminAwards"'), src.indexOf('<!-- BALANCE SHEET (Admin section)'));
  assert(/id="ctpsContent"/.test(awards) && /id="ctpsSeason"/.test(awards) && /id="ctpsDate"/.test(awards), 'CTP assignment moved to Award Prizes');
  assert(!/id="ctpsContent"|id="ctpsSeason"|id="ctpsDate"/.test(skins), 'and is gone from Skins/CTPs');
  assert(/id="skinWinners"/.test(skins) && /id="ctpWinners"/.test(skins) && /id="skinsParticipantsWrap"/.test(skins), 'everyone still sees skin winners, CTP winners and participants on Skins/CTPs');
  assert(!/data-tab="awards"/.test(src) && !/ADMIN_ONLY_TABS = new Set\(\[[^\]]*'awards'/.test(src), 'no longer a top-level tab');
  assert(/id="adminBtnAwards"[^>]*>🏆 Award Prizes</.test(src) && /ADMIN_SECTIONS = \[[^\]]*'awards'/.test(src), 'an Admin section instead');
  assert(/if \(section==='awards'\)\s+loadAwardPrizesTab\(\);/.test(src));
  assert(/function openAwardPrizes\(\) \{ switchTab\('admin'\); showAdminSection\('awards'\); \}/.test(src));
  assert(/Award Half-Season Winners/.test(awards) && /Award League Championship Winners/.test(awards) && /Award CTP Winners/.test(awards));
  assert(!/function previewHalfSeasonWinners|function saveHalfSeasonWinners|previewHalfSeasonWinners\(/.test(src), 'the preview-only buttons are replaced by the Award Prizes tab');
  assert(/openAwardPrizes\(\)/.test(src.slice(src.indexOf('HALF-SEASON STANDINGS PAYOUTS'), src.indexOf('HALF-SEASON STANDINGS PAYOUTS') + 2500)), 'Prize Money links to the Award Prizes section');
  assert(/_emailToastShownDates\.add\(date\)/.test(extract('awardMarkPaid')) && /_afterMarkPaidCallback = \(\) => renderAwardPrizes\(\)/.test(extract('awardMarkPaid')), 'paying a season award does not offer a league-night email');
  assert(/allRanked: ranked/.test(src));
  assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]) && src.match(/const APP_VERSION = '([^']+)';/)[1] >= '20261007.2');
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
