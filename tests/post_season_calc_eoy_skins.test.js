// Regression test: calcEoySkins (the AUTOMATIC / silent path that runs after scores are saved) is READ-ONLY.
// It may only compute a preview and mark a week "Needs Calculate" / "Restate Needed"; it never creates, deletes or
// updates a Payments row and never saves the database. Only an officer's confirmed psSkinCommit writes winner rows
// and the remainder. The whole-dollar helper (psWeekSkinPayout) is covered here too.
// Week 1 = 9/29/2026 (Back 9), week 2 = 10/6/2026 (Front 9).
// Run: node tests/post_season_calc_eoy_skins.test.js
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

//  Ann: both weeks. Ben: week 1 only. Cy, Dee: week 2 only. Eve scores in week 1 but never paid. Fay paid week 1, no score.
const eoyRows = [
  { Player: 'Ann', Earned: 20, Comment: '(Both Weeks)' },
  { Player: 'Ben', Earned: 10, Comment: '(1st Week)' },
  { Player: 'Cy', Earned: 10, Comment: '(2nd Week)' },
  { Player: 'Dee', Earned: 10, Comment: '(2nd Week)' },
  { Player: 'Fay', Earned: 10, Comment: '(1st Week)' },
];
const nines = (v) => { const r = {}; v.forEach((g, i) => { r[String(i + 1)] = g; }); return r; };
const par4 = Array(9).fill(4);
const scoresByDate = {
  // Week 1 BACK 9 (scores saved as 1-9 of that nine): Ann wins the first two holes (3s); Ben wins the third (4 vs 5).
  20260929: [
    { Player: 'Ann', ...nines([3, 3, 5, 4, 4, 4, 4, 4, 4]) },
    { Player: 'Ben', ...nines([4, 4, 4, 4, 4, 4, 4, 4, 4]) },
    { Player: 'Eve', ...nines([2, 2, 2, 2, 2, 2, 2, 2, 2]) },     // unpaid -> ignored
  ],
  // Week 2 FRONT 9: Dee wins the first hole only.
  20261006: [
    { Player: 'Ann', ...nines(par4) },
    { Player: 'Cy', ...nines(par4) },
    { Player: 'Dee', ...nines([3, 4, 4, 4, 4, 4, 4, 4, 4]) },
  ],
};

let existingWinners = [];
let legacyDates = new Set();         // dates whose stored payouts still have cents
const runs = [];
const alerts = [], confirms = [];
function query(sql, params = []) {
  if (/Detail='Refund'/.test(sql)) return [];
  if (/SELECT Player, Detail FROM Payments WHERE Date IN/.test(sql)) return existingWinners.map(r => ({ Player: r.Player, Detail: r.Detail }));
  if (/rowid AS ID/.test(sql)) return existingWinners.filter(r => String(r.Date) === String(params[0])).map(r => ({ ID: r.RowID, Player: r.Player, Detail: r.Detail, Earned: r.Earned ?? 4, DatePaid: r.DatePaid || '' }));
  if (/FROM Payments/.test(sql) && /'EOY Skins'/.test(sql)) return eoyRows;
  if (/SELECT PSWeek2Dt/.test(sql)) return [];
  if (/SELECT rowid as RowID/.test(sql)) return existingWinners;
  if (/FROM Scores WHERE Date=(\d+) AND League/.test(sql)) return scoresByDate[sql.match(/Date=(\d+)/)[1]] || [];
  if (/FROM Handicaps/.test(sql)) return [{ Hdcp: 0 }];
  return [];
}
const seq = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ctx = vm.createContext({
  window: {}, document: { getElementById: () => ({ value: 'Front' }) },
  query, parseInt, parseFloat, String, Set, Number, Math, Object, Array,
  PS_SKIN_REM_DETAIL: 'PS Skin Remainder', PS_EOY_REM_DETAIL: 'Skins Kitty Remainder',
  serverRun: (sql, params) => runs.push({ sql, params }),
  saveDBToServer: async () => { runs.push({ sql: 'SAVE' }); }, alert: m => alerts.push(m), confirm: () => { confirms.push(1); return true; }, applyCellClasses() {}, isPostSeasonEntryMode: () => true,
  ccRosterEligible: () => true, recalcPostSeasonEoyRefunds: () => ({ noShows: [] }),
  getSeasonSettings: () => ({ PostSeasonDt: '9/29/2026', PSWeek1Nine: 'Back', SkinsPS: 7, ClosestPS: 3, EOYSkins: 20 }),
  courseData: { front: { hcps: seq, pars: par4 }, back: { hcps: seq, pars: par4 }, all18: {} },
});
['psMdyToInt', 'psAddDaysMdy', 'parsePostSeasonDates', 'getPostSeasonWeekForDate', 'getPostSeasonWeek1Nine',
 'getPostSeasonWeekEntry', 'eoyWeeksFromComment', 'computeEoyGrossByWeek', 'getEoyRefundsByPlayer', 'getEoySkinPlayersForWeek',
 'psWeekSkinPayout', 'psWeekScorerRows', 'getPostSeasonWeekPotPlayers', 'psSkinFingerprint', 'psWeekSkinState', 'psNetHoles', 'psFindWinners', 'psComputeWeekWinners', 'calcEoySkins']
  .forEach(n => vm.runInContext(extract(n), ctx));

const inserts = () => runs.filter(r => /^INSERT INTO Payments/.test(r.sql)).map(r => r.params);
const plain = o => JSON.parse(JSON.stringify(o));

// ---- whole-dollar helper: floor(pot / skins); remainder = pot - paid; zero winners = the whole pot is the remainder
assert.deepStrictEqual(plain(ctx.psWeekSkinPayout(2, 3, 7)), { pot: 14, each: 4, paid: 12, remainder: 2 });
assert.deepStrictEqual(plain(ctx.psWeekSkinPayout(19, 3, 7)), { pot: 133, each: 44, paid: 132, remainder: 1 });   // the real Week 1: $133 / 3
assert.deepStrictEqual(plain(ctx.psWeekSkinPayout(3, 1, 7)), { pot: 21, each: 21, paid: 21, remainder: 0 });
assert.deepStrictEqual(plain(ctx.psWeekSkinPayout(19, 0, 7)), { pot: 133, each: 0, paid: 0, remainder: 133 });
for (let players = 0; players <= 40; players++) for (let skins = 0; skins <= 18; skins++) {
  const p = ctx.psWeekSkinPayout(players, skins, 7);
  assert(p.paid <= p.pot, `payout exceeds pot: ${players} players / ${skins} skins`);
  assert(p.remainder >= 0 && Math.abs(p.paid + p.remainder - p.pot) < 1e-9, `pot not conserved: ${players}/${skins}`);
  assert(Number.isInteger(p.each), 'each payout must be whole dollars');
}

// ---- calcEoySkins is READ-ONLY, silent or not: no INSERT / UPDATE / DELETE, no save, no confirm dialog
const assertNoWrites = label => { assert.deepStrictEqual(runs, [], `${label}: calcEoySkins must not write or save anything, got ${JSON.stringify(runs)}`); assert.strictEqual(confirms.length, 0, `${label}: no confirm dialog`); };
vm.runInContext(`calcEoySkins(2026, true)`, ctx);
assertNoWrites('silent, nothing stored');
const needs = () => JSON.parse(JSON.stringify(ctx.window.psSkinNeeds));
assert.deepStrictEqual(needs(), { 1: 'Needs Calculate', 2: 'Needs Calculate' }, 'scored weeks with no stored result are marked Needs Calculate');

// stored winners that are not whole dollars -> Restate Needed, still no writes (incl. the old "existing results" branch)
existingWinners = [
  { RowID: 1, Date: 20260929, Player: 'Ann', Detail: '#10', Earned: 4.67 },
  { RowID: 2, Date: 20260929, Player: 'Ann', Detail: '#11', Earned: 4.67 },
  { RowID: 3, Date: 20260929, Player: 'Ben', Detail: '#12', Earned: 4.67 },
  { RowID: 4, Date: 20261006, Player: 'Dee', Detail: '#1', Earned: 21 },
  { RowID: 5, Date: 20261006, Player: 'Ben', Detail: '#3', Earned: 21 },          // Ben did not enter week 2: still NOT deleted automatically
];
vm.runInContext(`calcEoySkins(2026, true)`, ctx);
assertNoWrites('silent, stored cents + ineligible row');
assert.strictEqual(needs()[1], 'Restate Needed', 'cents ($4.67) -> Restate Needed');
assert.deepStrictEqual(Object.keys(ctx.window.skinWinnerCells).sort(), ['Ann-10', 'Ann-11', 'Ben-12', 'Ben-3', 'Dee-1'], 'grid shading comes from the stored rows');

// paid winner rows are never touched either
existingWinners[0].DatePaid = '9/30/2026';
vm.runInContext(`calcEoySkins(2026, true)`, ctx);
assertNoWrites('silent, a paid row exists');

// non-silent (manual) call is also only a preview: no confirm, no writes, tells the officer where to act
alerts.length = 0;
vm.runInContext(`calcEoySkins(2026, false)`, ctx);
assertNoWrites('non-silent');
assert(alerts.length === 1 && /preview only, nothing was written/.test(alerts[0]) && /Calculate \/ Restate/.test(alerts[0]), alerts.join('|'));

// the source has no write statements left inside calcEoySkins
const src = extract('calcEoySkins');
assert(!/serverRun\(|saveDBToServer\(|INSERT|DELETE|UPDATE/.test(src.replace(/\/\/.*$/gm, '')), 'calcEoySkins contains no write or save call');

console.log('ok');
