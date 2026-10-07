// Post-season Skins auto-calculation gating (see psSkinAutoEligible).
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
var TODAY = 20261007;
var TODAY = 20261007;
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
  entryState: {}, _lastFocusedSlotKey: null, entryInitialized: true, psTodayInt: () => TODAY, logIt() {},
  courseData: { front: { hcps: seq, pars: fours }, back: { hcps: seq, pars: fours }, all18: {} },
});
['psMdyToInt', 'psAddDaysMdy', 'getSeasonSettings', 'getPostSeasonWeek1Nine', 'parsePostSeasonDates', 'getPostSeasonWeekForDate', 'getPostSeasonWeekEntry',
 'eoyWeeksFromComment', 'eoyCommentForWeeks', 'computeEoyGrossByWeek', 'getEoySkinGrossPlayersForWeek', 'getEoyRefundsByPlayer', 'getEoySkinPlayersForWeek',
 'getEoyRefundedWeeks', 'getPostSeasonWeekNoShows', 'recalcPostSeasonEoyRefunds', 'psWeekHasCtpResults', 'planPostSeasonRefunds',
 'psWeekSkinPayout', 'psWeekScorerRows', 'getPostSeasonWeekPotPlayers', 'psSkinFingerprint', 'psWeekSkinState', 'psSkinRemainderCredit',
 'psNetHoles', 'psFindWinners', 'psComputeWeekWinners', 'psSkinCommitPlan', 'getPostSeasonContextForDate', 'calcEoySkins', 'psSkinAutoEligible']
  .concat(html.includes('function psWeekIsLegacyLocked(') ? ['psWeekIsLegacyLocked'] : [])   // present only in the pre-fix code
  .forEach(n => vm.runInContext(extract(n), ctx));
['psSkinCommit', 'psSkinAutoCommit'].forEach(n => vm.runInContext('async ' + extract(n), ctx));
vm.runInContext('const _psAutoBusy = {};', ctx);
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


// Post-season Skins calculate themselves, but only when it is safe. Week 1 = 9/29/2026 (Back 9), Week 2 = 10/6/2026 (Front 9).
// Run: node tests/post_season_skins_auto.test.js
const quiet = label => { assert.strictEqual(confirms.length, 0, label + ': no confirm dialog'); assert.strictEqual(alerts.length, 0, label + ': no alert'); };
(async () => {
  // A) fully scored, nothing paid, date has arrived -> calculated with no prompts
  reset(false); stored[20260929] = []; TODAY = 20261007;
  assert.strictEqual(await run('psSkinAutoCommit(2026, 1)'), true, 'week 1 calculates itself');
  quiet('A');
  assert(mutations.length > 0 && stored[20260929].length > 0, 'winner rows written');
  assert(rem['Skin|PS Skin Remainder|20260929'] && rem['EOY Skins|Skins Kitty Remainder|20260929'], 'remainder recorded in both places');
  assert(saves.length > 0, 'saved to the server');
  // B) calculated already -> nothing more happens (idempotent)
  mutations.length = 0;
  assert.strictEqual(await run('psSkinAutoCommit(2026, 1)'), false, 'second run is a no-op');
  assert.deepStrictEqual(mutations, [], 'B: no writes');
  // C) a winner row is already paid -> never touched
  reset(false); const paidBefore = ledger();
  assert.strictEqual(await run('psSkinAutoCommit(2026, 1)'), false);
  assert.deepStrictEqual(mutations, [], 'C: paid rows block'); assert.strictEqual(ledger(), paidBefore);
  // D) future week -> nothing
  reset(false); stored[20261006] = []; TODAY = 20261005;
  assert.strictEqual(await run('psSkinAutoCommit(2026, 2)'), false); assert.deepStrictEqual(mutations, [], 'D: future week is left alone');
  // E) a half-entered night -> stays a preview
  TODAY = 20261007; reset(false); stored[20261006] = [];
  const quinn = scoresByDate[20261006].find(r => r.Player === 'Quinn B'); const keep = quinn['9']; quinn['9'] = null;
  assert.strictEqual(await run('psSkinAutoCommit(2026, 2)'), false); assert.deepStrictEqual(mutations, [], 'E: incomplete scores');
  quinn['9'] = keep;
  assert.strictEqual(await run('psSkinAutoCommit(2026, 2)'), true, 'E: calculates once the last hole is in');
  quiet('E');
  // F) a late score correction changes the winners -> the unpaid week re-calculates itself
  mutations.length = 0;
  const before = JSON.stringify(stored[20261006]);
  scoresByDate[20261006].find(r => r.Player === 'Quinn B')['1'] = 2;       // Quinn B now takes hole 1 outright
  assert.strictEqual(await run('psSkinAutoCommit(2026, 2)'), true, 'F: re-calculates');
  assert.notStrictEqual(JSON.stringify(stored[20261006]), before, 'F: winners changed');
  assert(stored[20261006].some(r => r.Player === 'Quinn B'), 'F: the new winner is stored');
  // G) a non-officer never writes
  reset(false); stored[20260929] = []; run("currentUser = { role: 'player' }"); mutations.length = 0;
  await run('psSkinAutoCommit(2026, 1)'); assert.deepStrictEqual(mutations, [], 'G: players never write'); run("currentUser = { role: 'admin' }");
  // wiring
  const h = require('fs').readFileSync(require('path').join(__dirname, '..', 'HughsGolf.html'), 'utf8');
  assert(/psSkinAutoAll\(psContext\.season\)/.test(h) && (h.match(/psSkinAutoAll\(/g) || []).length >= 5, 'every score / import / refund path asks for the automatic check');
  assert(/psSkinCommit\(season, week, 'calculate', \{ auto: true \}\)/.test(h), 'auto goes through the one writer');
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
