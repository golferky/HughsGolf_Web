// Regression test: whole-dollar post-season Skins payouts and the Skins-kitty remainder.
//  * Restate / Calculate are the ONLY writers of the remainder; both need the officer's confirmation
//  * the remainder is written once per week (overwritten, never added), and a stale record counts as $0
//  * payouts never exceed the week's pot; the remainder = pot - paid (zero winners -> the whole pot)
//  * existing unpaid $44.33 rows restate to $44 with the $1 difference going to the Skins kitty; paid rows block it
//  * EOY Collected stays gross; the regular Skins-kitty math is untouched when nothing is recorded
// Week 1 = 9/29/2026 (Back 9): 19 paid-and-scored + 4 confirmed no-shows. Week 2 = 10/6/2026 (Front 9).
// Run: node tests/post_season_skins_remainder.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'HughsGolf.html'), 'utf8');
function extract(name) {
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, `function ${name} not found`);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start, i + 1);
}

const scored1 = Array.from({ length: 19 }, (_, i) => 'Play' + String(i + 1).padStart(2, '0'));
const noShows = ['Dan Bowen', 'Jason Noble', 'Steve Bailey', 'Tim Franxman'];
const week2Only = ['Quinn A', 'Quinn B'];
const eoyRows = [
  ...scored1.map(p => ({ Player: p, Earned: p === 'Play01' ? 20 : 10, Comment: p === 'Play01' ? '(Both Weeks)' : '(1st Week)' })),
  ...noShows.map(p => ({ Player: p, Earned: 10, Comment: '(1st Week)' })),
  ...week2Only.map(p => ({ Player: p, Earned: 10, Comment: '(2nd Week)' })),
];
const hole = (p, h) => ({ Player: p, ...Object.fromEntries(h.map((g, i) => [String(i + 1), g])) });
const fours = Array(9).fill(4);
// Week 1 back nine: Play01 wins holes 1 and 2 (3s), Play02 wins hole 3 (4 vs 5 for Play03)... -> 3 outright skins
const wk1Holes = p => p === 'Play01' ? [3, 3, 4, 4, 4, 4, 4, 4, 4] : p === 'Play02' ? [4, 4, 3, 4, 4, 4, 4, 4, 4] : fours;
let scoresByDate;
function resetScores() {
  scoresByDate = {
    20260929: scored1.map(p => hole(p, wk1Holes(p))),
    20261006: ['Play01', ...week2Only].map(p => hole(p, p === 'Quinn A' ? [3, 4, 4, 4, 4, 4, 4, 4, 4] : fours)),
  };
}
const grossScored = () => ({ '20260929|Back': scoresByDate[20260929].map(r => r.Player), '20261006|Front': scoresByDate[20261006].map(r => r.Player) });

let stored, rem, nextId;
const writes = [];
const row = (Player, Detail, Earned, DatePaid = '') => ({ ID: nextId++, Player, Detail, Earned, DatePaid });
function query(sql, params = []) {
  if (/Detail='Refund'/.test(sql)) return [];
  if (/SELECT \* FROM SeasonSettings/.test(sql)) return [{ PostSeasonDt: '9/29/2026', PSWeek1Nine: 'Back', SkinsPS: 7, ClosestPS: 3, EOYSkins: 20, Course: 'X' }];
  if (/SELECT PSWeek2Dt/.test(sql)) return [];
  if (/SELECT DISTINCT Player FROM Scores/.test(sql)) return (grossScored()[`${params[0]}|${params[1]}`] || []).map(Player => ({ Player }));
  let m;
  if ((m = sql.match(/FROM Scores WHERE Date=(\d+) AND League/))) return scoresByDate[m[1]] || [];
  if (/FROM Handicaps/.test(sql)) return [{ Hdcp: 0 }];
  if (/rowid AS ID/.test(sql)) return (stored[params[0]] || []).map(r => ({ ...r }));
  if (/SELECT CAST\(Earned AS REAL\) AS Earned, COALESCE\(Comment/.test(sql)) { const k = `${params[0]}|${params[1]}|${params[2]}`; return rem[k] ? [{ ...rem[k] }] : []; }
  if (/FROM Payments/.test(sql) && /'EOY Skins'/.test(sql)) return eoyRows;
  return [];
}
// A tiny ledger: apply exactly the statements psSkinCommit issues, so reruns prove the "exactly once" behavior.
function serverRun(sql, params = []) {
  writes.push({ sql, params });
  if (/^UPDATE Payments SET Earned=\? WHERE rowid=\?/.test(sql)) {
    for (const d of Object.keys(stored)) stored[d].forEach(r => { if (r.ID === params[1]) r.Earned = params[0]; });
  } else if (/^DELETE FROM Payments WHERE League="Hugh's" AND "Desc"='Skin' AND Detail LIKE '#%'/.test(sql)) {
    stored[params[0]] = [];
  } else if (/^DELETE FROM Payments WHERE League="Hugh's" AND Player='Kitty'/.test(sql)) {
    [['Skin', params[1]], ['EOY Skins', params[2]]].forEach(([desc, detail]) => delete rem[`${desc}|${detail}|${params[0]}`]);
  } else if (/^INSERT INTO Payments/.test(sql) && /'Kitty'/.test(sql)) {
    const desc = /,'EOY Skins',/.test(sql) ? 'EOY Skins' : 'Skin';
    rem[`${desc}|${params[1]}|${params[0]}`] = { Earned: params[2], Comment: params[4] };
  } else if (/^INSERT INTO Payments/.test(sql)) {
    (stored[params[1]] = stored[params[1]] || []).push(row(params[0], params[2], params[3]));
  }
}
let confirmText = null, confirmAnswer = true;
const alerts = [];
const els = {};
const el = id => els[id] || (els[id] = { innerHTML: '', value: '', style: {}, textContent: '', appendChild(c) { this.innerHTML += c.innerHTML; } });
const seq = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ctx = vm.createContext({
  document: { getElementById: el }, db: true, currentUser: { role: 'admin' }, query, parseInt, parseFloat, String, Set, Number, Math, Object, Array, JSON,
  PS_SKIN_REM_DETAIL: 'PS Skin Remainder', PS_EOY_REM_DETAIL: 'Skins Kitty Remainder',
  serverRun, SERVER_RUN_QUEUE: Promise.resolve(), saveDBToServer: async () => { writes.push({ sql: 'SAVE' }); },
  confirm: t => { confirmText = t; return confirmAnswer; }, alert: t => alerts.push(t), fmtDate: d => d, loadSkins() {}, loadPrizeMoney() {}, loadCourse() {},
  courseData: { front: { hcps: seq, pars: fours }, back: { hcps: seq, pars: fours }, all18: {} },
});
['psMdyToInt', 'psAddDaysMdy', 'getSeasonSettings', 'getPostSeasonWeek1Nine', 'parsePostSeasonDates', 'getPostSeasonWeekForDate', 'getPostSeasonWeekEntry',
 'eoyWeeksFromComment', 'computeEoyGrossByWeek', 'getEoyRefundsByPlayer', 'getEoySkinPlayersForWeek', 'psWeekSkinPayout', 'psWeekScorerRows',
 'getPostSeasonWeekPotPlayers', 'psSkinFingerprint', 'psWeekSkinState', 'psSkinRemainderCredit', 'psNetHoles', 'psFindWinners', 'psComputeWeekWinners',
 'psSkinCommitPlan']
  .forEach(n => vm.runInContext(extract(n), ctx));
vm.runInContext('async ' + extract('psSkinCommit'), ctx);
const commit = (week, mode) => vm.runInContext(`psSkinCommit(2026, ${week}, '${mode}')`, ctx);
const credit = asOf => vm.runInContext(`psSkinRemainderCredit(2026${asOf ? ', ' + asOf : ''})`, ctx);
const state = week => JSON.parse(JSON.stringify(vm.runInContext(`psWeekSkinState(2026, ${week})`, ctx)));
function reset() {
  resetScores(); nextId = 1; writes.length = 0; alerts.length = 0; confirmText = null; confirmAnswer = true; rem = {};
  stored = { 20260929: [row('Play01', '#10', 44.33), row('Play01', '#11', 44.33), row('Play02', '#12', 44.33)] };   // the real unpaid $44.33 rows
}
const remRows = () => Object.keys(rem).sort();

(async () => {
  // ================= nothing happens until an officer acts: viewing state / credit never writes, and credit is $0 when nothing is recorded
  reset();
  assert.strictEqual(state(1).status, 'restate');
  assert.strictEqual(credit(), 0);
  assert(Object.is(credit(), 0), 'exactly +0 so the regular Skins-kitty math (-$11 today) is not disturbed');
  assert.strictEqual(writes.length, 0, 'state / credit are read-only');
  assert.strictEqual(state(1).potPlayers.length, 19);

  // ================= cancelling the confirmation writes nothing
  confirmAnswer = false;
  await commit(1, 'restate');
  assert.strictEqual(writes.length, 0, 'declined confirm = no writes');
  assert.deepStrictEqual(stored[20260929].map(r => r.Earned), [44.33, 44.33, 44.33]);
  confirmAnswer = true;

  // ================= Restate the real Week 1: $44.33 x 3 -> $44 x 3, $1 to the Skins kitty
  await commit(1, 'restate');
  assert(/Pot: 19 paid-and-scored players x \$7 = \$133\.00/.test(confirmText), confirmText);
  assert(/3 outright skins x \$44 \(whole dollars\) = \$132\.00 paid/.test(confirmText));
  assert(/Remainder to the Skins kitty: \$1\.00/.test(confirmText));
  assert(/\$44\.33 -> \$44\.00/.test(confirmText));
  assert.deepStrictEqual(stored[20260929].map(r => r.Earned), [44, 44, 44]);
  assert.deepStrictEqual(remRows(), ['EOY Skins|Skins Kitty Remainder|20260929', 'Skin|PS Skin Remainder|20260929']);
  assert.strictEqual(rem['Skin|PS Skin Remainder|20260929'].Earned, 1);
  assert.strictEqual(rem['EOY Skins|Skins Kitty Remainder|20260929'].Earned, 1);
  assert.strictEqual(writes.filter(w => w.sql === 'SAVE').length, 1, 'one save for the whole action');
  assert.strictEqual(state(1).status, 'calculated');
  assert.strictEqual(credit(), 1, 'the $1 is credited once');
  assert(state(1).payout.paid <= state(1).payout.pot, 'payout never exceeds the pot');
  assert.strictEqual(state(2).status, 'preview', 'week 2 untouched');
  assert.strictEqual(writes.filter(w => /Date=|20261006/.test(w.sql) || (w.params || []).includes(20261006)).length, 0, 'nothing written for week 2');

  // ================= Running it again (or Calculate over it) never adds a second remainder
  await commit(1, 'restate');
  await commit(1, 'calculate');
  await commit(1, 'calculate');
  assert.deepStrictEqual(remRows(), ['EOY Skins|Skins Kitty Remainder|20260929', 'Skin|PS Skin Remainder|20260929'], 'still exactly one row per ledger');
  assert.strictEqual(credit(), 1, 'recalculating replaces the remainder; it is not added');
  assert.strictEqual(state(1).status, 'calculated');
  assert.deepStrictEqual(stored[20260929].map(r => r.Earned), [44, 44, 44]);

  // ================= as-of dates: a view dated before the week does not see the credit
  assert.strictEqual(credit(20260928), 0);
  assert.strictEqual(credit(20260929), 1);
  assert.strictEqual(credit(20261231), 1);

  // ================= A later score change makes the record stale: counted as $0 until an officer recalculates (never double counted)
  scoresByDate[20260929] = scoresByDate[20260929].filter(r => r.Player !== 'Play19');       // pot is now 18 x $7 = $126
  assert.strictEqual(state(1).status, 'stale');
  assert.strictEqual(credit(), 0, 'stale remainder counts as $0');
  await commit(1, 'calculate');                                                              // officer recalculates: $126 / 3 = $42, rem 0
  assert.deepStrictEqual(stored[20260929].map(r => r.Earned), [42, 42, 42]);
  assert.strictEqual(rem['Skin|PS Skin Remainder|20260929'].Earned, 0);
  assert.strictEqual(credit(), 0);
  assert.strictEqual(remRows().length, 2);

  // ================= Paid rows block both Restate and Calculate; nothing is written
  reset();
  stored[20260929][0].DatePaid = '9/30/2026';
  writes.length = 0;
  await commit(1, 'restate'); await commit(1, 'calculate');
  assert.strictEqual(writes.length, 0, 'paid rows are never changed');
  assert(alerts.length === 2 && /already paid/.test(alerts[0]));
  assert.deepStrictEqual(stored[20260929].map(r => r.Earned), [44.33, 44.33, 44.33]);

  // ================= Zero outright winners: the WHOLE $133 goes to the Skins kitty (Calculate only)
  reset();
  scoresByDate[20260929] = scored1.map(p => hole(p, fours));                                 // everybody ties every hole
  stored[20260929] = [];
  await commit(1, 'restate');
  assert(/no stored skin winners/.test(alerts.pop()) && writes.length === 0, 'Restate needs stored winners');
  await commit(1, 'calculate');
  assert(/nobody wins a skin outright/.test(confirmText) && /Remainder to the Skins kitty: \$133\.00/.test(confirmText));
  assert.deepStrictEqual(stored[20260929], []);
  assert.strictEqual(rem['Skin|PS Skin Remainder|20260929'].Earned, 133);
  assert.strictEqual(rem['EOY Skins|Skins Kitty Remainder|20260929'].Earned, 133);
  assert.strictEqual(state(1).status, 'calculated');
  assert.strictEqual(credit(), 133);

  // ================= Week 2 is independent: its own 3 players -> $21 pot, one skin = $21, remainder 0; week 1 record untouched
  await commit(2, 'calculate');
  assert(/Pot: 3 paid-and-scored players x \$7 = \$21\.00/.test(confirmText) && /1 outright skin x \$21/.test(confirmText));
  assert.deepStrictEqual(stored[20261006].map(r => [r.Player, r.Earned]), [['Quinn A', 21]]);
  assert.strictEqual(rem['Skin|PS Skin Remainder|20261006'].Earned, 0);
  assert.strictEqual(rem['Skin|PS Skin Remainder|20260929'].Earned, 133, 'week 1 record is not touched by week 2');
  assert.strictEqual(credit(), 133);

  // ================= Only players who are not officers: nothing happens
  reset();
  ctx.currentUser = { role: 'player' };
  await commit(1, 'restate');
  assert.strictEqual(writes.length, 0);
  ctx.currentUser = { role: 'admin' };

  // ================= Source-level guarantees
  // 1. The remainder rows are written ONLY inside psSkinCommit
  const commitBody = extract('psSkinCommit');
  html.split('\n').forEach((line, i) => {
    if (/INSERT INTO Payments/.test(line) && /PS_SKIN_REM_DETAIL|PS_EOY_REM_DETAIL/.test(line))
      assert(commitBody.includes(line.trim()), `remainder INSERT outside psSkinCommit at line ${i + 1}`);
  });
  // 2. View / calculation helpers never write
  ['loadSkins', 'psWeekSkinState', 'psWeekPanelHtml', 'psSkinRemainderCredit', 'getPostSeasonWeekPotPlayers', 'psWeekScorerRows', 'psSkinCommitPlan', 'psComputeWeekWinners'].forEach(n =>
    assert(!/serverRun\(|saveDBToServer\(|INSERT INTO|UPDATE Payments|DELETE FROM/.test(extract(n)), n + ' must be read-only'));
  // 3. The automatic path (calcEoySkins / saveSkinWinnersForDate) never writes the remainder
  ['calcEoySkins', 'saveSkinWinnersForDate'].forEach(n => assert(!/REM_DETAIL|Remainder'/.test(extract(n).replace(/\(recorded only by an officer's Calculate\/Restate\)/g, '')), n + ' must not write the remainder'));
  // 4. Kitty math: the regular terms are unchanged and only the validated credit is added; EOY Collected stays gross
  assert(html.includes("const skinKitty        = Math.round((skinCollected - skinPaidOut - skinTransferOut + psRemainderCredit) * 100) / 100;"));
  assert(html.includes("const eoyCollected     = Math.round((eoyFromPayments + eoyFromTransfers) * 100) / 100;"), 'EOY Collected is still the gross payments + transfers');
  assert(html.includes("const eoyBalance       = Math.round((eoyCollected - eoyPaidOut - psRemainderCredit) * 100) / 100;"));
  assert(/Detail NOT IN \('Payment','Refund','Pool Transfer','Skins Kitty Remainder'\)/.test(html), 'the EOY remainder row is not counted twice as "paid out"');
  assert(html.includes("Math.round((collected - paidOut - transferred + psSkinRemainderCredit(s)) * 100) / 100"), 'Pool Transfer balance');
  assert(html.includes("Math.round((collected - paidOut - moved + psSkinRemainderCredit(s)) * 100) / 100"), 'Clear Kitty');
  assert(html.includes("Math.round((skinCollected - skinPaidOut + psSkinRemainderCredit(season)) * 100) / 100"), 'Admin kitty card');
  assert.strictEqual((html.match(/psSkinRemainderCredit\(/g) || []).length, 5, '4 kitty call sites + the definition');
  // the kitty and the EOY balance move by the same dollars in opposite directions
  const base = { skinKitty: -11, eoyCollected: 240, eoyPaidOut: 0 };                        // -$11: the regular-season kitty as it is today
  const after = c => ({ skinKitty: base.skinKitty + c, eoyBalance: base.eoyCollected - base.eoyPaidOut - c, eoyCollected: base.eoyCollected });
  assert.strictEqual(after(0).skinKitty, -11, 'the pre-existing -$11 regular-season discrepancy is not touched');
  assert.strictEqual(after(1).skinKitty - after(0).skinKitty, 1);
  assert.strictEqual(after(1).eoyBalance - after(0).eoyBalance, -1);
  assert.strictEqual(after(1).eoyCollected, after(0).eoyCollected, 'EOY Collected is unchanged');

  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
