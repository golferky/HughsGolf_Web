// Regression test: psSkinCommit is the ONLY writer of post-season Skin winner payouts and PS Skin Remainder rows.
//
// Starting from a Payments ledger that holds PAID and UNPAID post-season winner rows (and, in a second run, already
// recorded remainder rows), every automatic / silent calculation path is called and the ledger must come out
// byte-for-byte identical, with no remainder row created and no Payments mutation issued:
//   calcEoySkins (silent and not), saveSkinWinnersForDate (what every score save, Gallus import, paid toggle, sub removal
//   and saveEntryToDB / savePlayerScoreNow call for a post-season date), _runScoreRecalc, manualRecalcSkins.
// A refund may write only its own Refund row. A source scan then proves no other function can create, update or delete
// post-season winner / remainder rows, and that the only callers of the two calculators are the known score paths.
// Week 1 = 9/29/2026 (Back 9), Week 2 = 10/6/2026 (Front 9).
// Run: node tests/post_season_skins_no_auto_writes.test.js
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

// ---------------------------------------------------------------- fake database
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
const wk1Holes = p => p === 'Play01' ? [3, 3, 4, 4, 4, 4, 4, 4, 4] : p === 'Play02' ? [4, 4, 3, 4, 4, 4, 4, 4, 4] : fours;
const scoresByDate = {
  20260929: scored1.map(p => hole(p, wk1Holes(p))),
  20261006: ['Play01', ...week2Only].map(p => hole(p, p === 'Quinn A' ? [3, 4, 4, 4, 4, 4, 4, 4, 4] : fours)),
};
const grossScored = { '20260929|Back': scoresByDate[20260929].map(r => r.Player), '20261006|Front': scoresByDate[20261006].map(r => r.Player) };

// The Payments ledger (winner rows + remainder rows). Every mutating statement is recorded AND applied, so any write is
// visible both in `mutations` and as a changed ledger.
let stored, rem, nextId;
const mutations = [], saves = [], alerts = [], confirms = [];
const row = (Player, Detail, Earned, DatePaid = '') => ({ ID: nextId++, Player, Detail, Earned, DatePaid });
function isPaymentsMutation(sql) { return /^\s*(INSERT INTO|DELETE FROM|UPDATE)\s+Payments/i.test(sql); }
function serverRun(sql, params = []) {
  if (!isPaymentsMutation(sql)) return;
  mutations.push({ sql, params });
  const dates = (sql.match(/Date IN \(([\d,]+)\)/) || [])[1];
  if (/^UPDATE Payments SET Earned=\? WHERE rowid=\?/.test(sql)) {
    for (const d of Object.keys(stored)) stored[d].forEach(r => { if (r.ID === params[1]) r.Earned = params[0]; });
  } else if (/^UPDATE Payments SET Earned=\? WHERE Date=(\d+)/.test(sql)) {
    const d = sql.match(/Date=(\d+)/)[1]; (stored[d] || []).forEach(r => { r.Earned = params[0]; });
  } else if (/^DELETE FROM Payments WHERE rowid=\?/.test(sql)) {
    for (const d of Object.keys(stored)) stored[d] = stored[d].filter(r => r.ID !== params[0]);
  } else if (/^DELETE FROM Payments/.test(sql) && /Player='Kitty'/.test(sql) && /Remainder|PS_SKIN|\?/.test(sql)) {
    for (const k of Object.keys(rem)) if (k.endsWith('|' + params[0])) delete rem[k];
  } else if (/^DELETE FROM Payments/.test(sql) && /'Skin'/.test(sql)) {
    (dates ? dates.split(',') : [String(params[0])]).forEach(d => { stored[d] = []; });
  } else if (/^INSERT INTO Payments/.test(sql) && /'Kitty'/.test(sql)) {
    const desc = /,'EOY Skins',/.test(sql) ? 'EOY Skins' : 'Skin';
    rem[`${desc}|${params[1]}|${params[0]}`] = { Earned: params[2], Comment: params[4] };
  } else if (/^INSERT INTO Payments/.test(sql) && /'Skin'/.test(sql)) {
    (stored[params[1]] = stored[params[1]] || []).push(row(params[0], params[2], params[3]));
  }
}
function query(sql, params = []) {
  if (/Detail='Refund'/.test(sql)) return refundRows.map(r => ({ ...r }));
  if (/SELECT \* FROM SeasonSettings/.test(sql)) return [{ PostSeasonDt: '9/29/2026', PSWeek1Nine: 'Back', SkinsPS: 7, ClosestPS: 3, EOYSkins: 20, Course: 'X' }];
  if (/SELECT PostSeasonDt, EOYSkins as EoySkins/.test(sql)) return [{ PostSeasonDt: '9/29/2026', EoySkins: 20 }];
  if (/SELECT PSWeek2Dt/.test(sql)) return [];
  if (/SELECT DISTINCT Player FROM Scores/.test(sql)) return (grossScored[`${params[0]}|${params[1]}`] || []).map(Player => ({ Player }));
  let m;
  if ((m = sql.match(/FROM Scores WHERE Date=(\d+) AND League/))) return scoresByDate[m[1]] || [];
  if (/FROM Handicaps/.test(sql)) return [{ Hdcp: 0 }];
  if (/SELECT Player, Detail FROM Payments WHERE Date IN/.test(sql)) return Object.values(stored).flat().map(r => ({ Player: r.Player, Detail: r.Detail }));
  if (/SELECT Player, Detail FROM Payments WHERE Date=/.test(sql)) return (stored[sql.match(/Date=(\d+)/)[1]] || []).map(r => ({ Player: r.Player, Detail: r.Detail }));
  if (/rowid AS ID/.test(sql)) return (stored[params[0]] || []).map(r => ({ ...r }));
  if (/SELECT CAST\(Earned AS REAL\) AS Earned, COALESCE\(Comment/.test(sql)) { const k = `${params[0]}|${params[1]}|${params[2]}`; return rem[k] ? [{ ...rem[k] }] : []; }
  if (/'CTP'/.test(sql) && /LIMIT 1/.test(sql)) return [];
  if (/FROM Payments/.test(sql) && /'EOY Skins'/.test(sql)) return eoyRows;
  return [];
}
let refundRows = [];
const els = {};
const el = id => els[id] || (els[id] = { innerHTML: '', value: '', style: {}, textContent: '', appendChild(c) { this.innerHTML += c.innerHTML; } });
const seq = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ctx = vm.createContext({
  window: {}, document: { getElementById: el, querySelector: () => null }, db: true, currentUser: { role: 'admin' },
  query, parseInt, parseFloat, String, Set, Map, Number, Math, Object, Array, JSON,
  PS_SKIN_REM_DETAIL: 'PS Skin Remainder', PS_EOY_REM_DETAIL: 'Skins Kitty Remainder',
  serverRun, SERVER_RUN_QUEUE: Promise.resolve(), saveDBToServer: async () => { saves.push(1); },
  confirm: t => { confirms.push(t); return true; }, alert: t => alerts.push(t), fmtDate: d => d,
  loadSkins() {}, loadPrizeMoney() {}, loadCourse() {}, renderPostSeasonBreakdown() {}, reRenderEntry() {}, applyCellClasses() {},
  isPostSeasonEntryMode: () => true, ccRosterEligible: () => true, calcMatchesForDate: async () => {}, warnIfUnpaidScorers: () => true,
  calcSkinWinnersForDate: () => { throw new Error('the regular-season calculator must never run for a post-season date'); },
  entryState: {}, _lastFocusedSlotKey: null, entryInitialized: true,
  courseData: { front: { hcps: seq, pars: fours }, back: { hcps: seq, pars: fours }, all18: {} },
});
['psMdyToInt', 'psAddDaysMdy', 'getSeasonSettings', 'getPostSeasonWeek1Nine', 'parsePostSeasonDates', 'getPostSeasonWeekForDate', 'getPostSeasonWeekEntry',
 'eoyWeeksFromComment', 'eoyCommentForWeeks', 'computeEoyGrossByWeek', 'getEoySkinGrossPlayersForWeek', 'getEoyRefundsByPlayer', 'getEoySkinPlayersForWeek',
 'getEoyRefundedWeeks', 'getPostSeasonWeekNoShows', 'recalcPostSeasonEoyRefunds', 'psWeekHasCtpResults', 'planPostSeasonRefunds',
 'psWeekSkinPayout', 'psWeekScorerRows', 'getPostSeasonWeekPotPlayers', 'psSkinFingerprint', 'psWeekSkinState', 'psSkinRemainderCredit',
 'psNetHoles', 'psFindWinners', 'psComputeWeekWinners', 'psSkinCommitPlan', 'getPostSeasonContextForDate', 'calcEoySkins', 'saveSkinWinnersForDate']
  .concat(html.includes('function psWeekIsLegacyLocked(') ? ['psWeekIsLegacyLocked'] : [])   // present only in the pre-fix code
  .forEach(n => vm.runInContext(extract(n), ctx));
['psSkinCommit', 'issuePostSeasonRefunds', '_runScoreRecalc', 'manualRecalcSkins'].forEach(n => vm.runInContext('async ' + extract(n), ctx));
const run = code => vm.runInContext(code, ctx);

// ---------------------------------------------------------------- initial ledgers
function reset(withRemainder) {
  nextId = 1; mutations.length = 0; saves.length = 0; alerts.length = 0; confirms.length = 0; refundRows = []; rem = {};
  stored = {
    20260929: [row('Play01', '#10', 44, '9/30/2026 8:00 AM'),          // PAID
               row('Play01', '#11', 44.33),                              // unpaid, cents (Restate needed)
               row('Play02', '#12', 44.33)],                             // unpaid, cents
    20261006: [row('Quinn A', '#1', 21)],                                // week 2, unpaid, whole dollars
  };
  if (withRemainder) {
    const fp = 'recorded-earlier';
    rem['Skin|PS Skin Remainder|20260929'] = { Earned: 1, Comment: fp };
    rem['EOY Skins|Skins Kitty Remainder|20260929'] = { Earned: 1, Comment: fp };
  }
}
const ledger = () => JSON.stringify({ stored, rem });
const assertUntouched = (label, before) => {
  assert.deepStrictEqual(mutations, [], `${label}: issued Payments writes ${JSON.stringify(mutations)}`);
  assert.strictEqual(ledger(), before, `${label}: the Payments ledger changed`);
  assert(!Object.keys(rem).some(k => /Remainder/.test(k)) || withRemainderNow, `${label}: a remainder row appeared`);
};
let withRemainderNow = false;

(async () => {
  for (const withRemainder of [false, true]) {
    withRemainderNow = withRemainder;
    const tag = withRemainder ? ' (remainder already recorded)' : '';
    reset(withRemainder);
    const before = ledger();
    const remKeysBefore = Object.keys(rem).sort().join();

    // ---- calcEoySkins, silent and manual
    run('calcEoySkins(2026, true)');           assertUntouched('calcEoySkins silent' + tag, before);
    run('calcEoySkins(2026, false)');          assertUntouched('calcEoySkins manual' + tag, before);
    assert.strictEqual(confirms.length, 0, 'no confirm dialog from calcEoySkins');
    assert.strictEqual(saves.length, 0, 'calcEoySkins never saves the database');

    // ---- saveSkinWinnersForDate: what every score-save / import / paid-toggle / sub-removal path calls
    for (const d of [20260929, 20261006]) {
      const r = run(`saveSkinWinnersForDate(${d})`);
      assert.strictEqual(r.ok, false, 'post-season save reports nothing was recorded');
      assertUntouched(`saveSkinWinnersForDate(${d})` + tag, before);
    }

    // ---- the score-save recalculation and the manual "recalc skins" button
    await run('_runScoreRecalc(20260929)');    assertUntouched('_runScoreRecalc wk1' + tag, before);
    await run('_runScoreRecalc(20261006)');    assertUntouched('_runScoreRecalc wk2' + tag, before);
    els.entryDate = { value: '20260929' };
    await run('manualRecalcSkins()');          assertUntouched('manualRecalcSkins' + tag, before);
    assert(/officer Calculate \/ Restate/.test(alerts[alerts.length - 1] || ''), 'the button explains where to record payouts');

    // ---- a refund changes the pot, but writes ONLY its own Refund row: winner rows stay (paid and unpaid), no remainder
    const storedBefore = JSON.stringify(stored), remBefore = JSON.stringify(rem);
    mutations.length = 0;
    await run(`issuePostSeasonRefunds(2026, [1], ['Dan Bowen'])`);
    assert(mutations.length >= 1 && mutations.every(m => /^INSERT INTO Payments/.test(m.sql) && /'EOY Skins','Refund'/.test(m.sql)),
      'a refund may only insert its Refund row, got ' + JSON.stringify(mutations));
    assert.strictEqual(JSON.stringify(stored), storedBefore, 'a refund must not change any Skin winner row');
    assert.strictEqual(JSON.stringify(rem), remBefore, 'a refund must not create or change a remainder row');

    // ---- and the officer action is still the one that does write (so the guard above is not vacuous)
    reset(withRemainder);
    mutations.length = 0;
    await run(`psSkinCommit(2026, 1, 'restate')`);
    assert(alerts.some(a => /already paid/.test(a)), 'a paid row blocks the officer action');
    assert.strictEqual(mutations.length, 0, 'blocked: nothing written');
  }

  // officer Calculate/Restate on an unpaid-only week DOES write (proves the ledger/fake really records writes)
  reset(false);
  stored[20260929] = [row('Play01', '#10', 44.33), row('Play01', '#11', 44.33), row('Play02', '#12', 44.33)];
  const before = ledger();
  await run(`psSkinCommit(2026, 1, 'restate')`);
  assert(mutations.length > 0 && ledger() !== before, 'psSkinCommit writes (restate $44.33 -> $44, remainder recorded)');
  assert.deepStrictEqual(stored[20260929].map(r => r.Earned), [44, 44, 44]);
  assert.strictEqual(rem['Skin|PS Skin Remainder|20260929'].Earned, 1);

  // ---------------------------------------------------------------- source scan: who can write winner / remainder rows?
  const lines = html.split('\n');
  const enclosing = idx => {
    const upTo = html.slice(0, idx); let m, last = null; const re = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
    while ((m = re.exec(upTo))) last = { name: m[1], at: m.index };
    return last;
  };
  const sqlStrings = [...html.matchAll(/`[^`]*?(?:INSERT INTO Payments|DELETE FROM Payments|UPDATE Payments)[^`]*?`/g)];
  const writers = {};
  for (const m of sqlStrings) {
    const context = m[0] + html.slice(m.index + m[0].length, m.index + m[0].length + 220);
    const touchesRemainder = /PS_SKIN_REM_DETAIL|PS_EOY_REM_DETAIL|PS Skin Remainder|Skins Kitty Remainder/.test(context);
    const touchesSkinWinners = /'Skin'/.test(context) && /#%|`#\$\{|'#'/.test(context) && !/'Skin','CTP'/.test(m[0]) || /"Desc" IN \('Skin','CTP'\)[^`]*#%/.test(m[0]);
    if (!touchesRemainder && !touchesSkinWinners) continue;
    const fn = enclosing(m.index).name;
    (writers[fn] = writers[fn] || []).push(m.index);
  }
  // Post-season winner / remainder rows: psSkinCommit only. saveSkinWinnersForDate's statements are the REGULAR-season
  // branch (after the post-season early return).
  // releaseFutureScores is the one documented exception (see the end of this test): test-mode back-out of FUTURE-dated data.
  assert.deepStrictEqual(Object.keys(writers).sort(), ['psSkinCommit', 'releaseFutureScores', 'saveSkinWinnersForDate'], 'unexpected writer(s) of Skin winner / remainder rows: ' + Object.keys(writers).join(', '));
  writers.releaseFutureScores.forEach(at => assert(/CAST\(Date AS INTEGER\) > \$\{t\}/.test(html.slice(at, at + 200)), 'releaseFutureScores may only touch dates after today'));
  const sswStart = html.indexOf('function saveSkinWinnersForDate(');
  const regularBranchAt = html.indexOf('const result = calcSkinWinnersForDate(date);', sswStart);
  const psReturnAt = html.indexOf('return { ok: false, count: 0, total: 0, message:', sswStart);
  assert(psReturnAt > 0 && psReturnAt < regularBranchAt, 'the post-season branch returns before the regular-season calculator');
  writers.saveSkinWinnersForDate.forEach(at => assert(at > regularBranchAt, 'saveSkinWinnersForDate may write only AFTER the post-season early return'));

  // The two calculators contain no write or save at all for post-season dates
  const calcSrc = extract('calcEoySkins').replace(/\/\/.*$/gm, '');
  assert(!/serverRun\(|saveDBToServer\(|\bINSERT\b|\bDELETE\b|\bUPDATE\b/.test(calcSrc), 'calcEoySkins contains no write or save call');
  const sswPs = extract('saveSkinWinnersForDate'); const psPart = sswPs.slice(0, sswPs.indexOf('calcSkinWinnersForDate')).replace(/\/\/.*$/gm, '');
  assert(!/serverRun\(|saveDBToServer\(|\bINSERT\b|\bDELETE\b|\bUPDATE\b/.test(psPart), 'the post-season branch of saveSkinWinnersForDate contains no write');

  // Every caller of the two calculators is a known score / refund / import path (all proven read-only above)
  const callers = new Set();
  for (const fnName of ['calcEoySkins', 'saveSkinWinnersForDate']) {
    const re = new RegExp(`(?<!function )\\b${fnName}\\(`, 'g'); let m;
    while ((m = re.exec(html))) { const e = enclosing(m.index); if (e && e.name !== fnName) callers.add(`${e.name} -> ${fnName}`); }
  }
  assert.deepStrictEqual([...callers].sort(), [
    'doGallusConfirm -> calcEoySkins' /* post-season Gallus import: read-only marker refresh, same as savePlayerScoreNow */, 'doGallusConfirm -> saveSkinWinnersForDate', 'issuePostSeasonRefunds -> calcEoySkins', 'manualRecalcSkins -> saveSkinWinnersForDate',
    'removeSub -> saveSkinWinnersForDate', 'saveEntryToDB -> saveSkinWinnersForDate', 'savePlayerScoreNow -> calcEoySkins',
    'saveSkinWinnersForDate -> calcEoySkins', 'toggleEntryPaid -> saveSkinWinnersForDate', 'undoGallusImport -> saveSkinWinnersForDate',
    '_runScoreRecalc -> saveSkinWinnersForDate'].sort(), 'a new caller of the calculators appeared: review it');

  // DOCUMENTED EXCEPTION: the test-mode "release future scores" back-out (unchecking "Allow future scores", logout or a
  // 20-minute timeout) deletes FUTURE-dated test scores plus any winners made from them, mirroring a server-side sweep
  // (app.py). It only ever touches dates after today, so real played post-season weeks are never affected.
  assert(/Mirror the server back-out in this browser's copy/.test(html));

  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
