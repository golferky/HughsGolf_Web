// Regression test: calcEoySkins (the AUTOMATIC path: runs when scores are saved) calculates and stores post-season Skins
// payouts PER WEEK in WHOLE DOLLARS from that week's paid-and-scored players. It never writes the Skins-kitty remainder
// and never touches a week whose stored payouts still have cents (e.g. $44.33) - only an officer's Restate/Calculate does.
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
function query(sql, params = []) {
  if (/Detail='Refund'/.test(sql)) return [];
  if (/ABS\(CAST\(Earned/.test(sql)) return legacyDates.has(String(params[0])) ? [{ 1: 1 }] : [];
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
  serverRun: (sql, params) => runs.push({ sql, params }),
  saveDBToServer() {}, alert() {}, confirm: () => true, applyCellClasses() {}, isPostSeasonEntryMode: () => true,
  ccRosterEligible: () => true, recalcPostSeasonEoyRefunds: () => ({ noShows: [] }),
  getSeasonSettings: () => ({ PostSeasonDt: '9/29/2026', PSWeek1Nine: 'Back', SkinsPS: 7, ClosestPS: 3, EOYSkins: 20 }),
  courseData: { front: { hcps: seq, pars: par4 }, back: { hcps: seq, pars: par4 }, all18: {} },
});
['psMdyToInt', 'psAddDaysMdy', 'parsePostSeasonDates', 'getPostSeasonWeekForDate', 'getPostSeasonWeek1Nine',
 'getPostSeasonWeekEntry', 'eoyWeeksFromComment', 'computeEoyGrossByWeek', 'getEoyRefundsByPlayer', 'getEoySkinPlayersForWeek',
 'psWeekSkinPayout', 'psWeekScorerRows', 'psWeekIsLegacyLocked', 'psNetHoles', 'psFindWinners', 'psComputeWeekWinners', 'calcEoySkins']
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

// ---- Fresh automatic calculation: per-week whole-dollar payouts, Eve (unpaid) and Fay (no score) out of the pot
vm.runInContext(`calcEoySkins(2026, true)`, ctx);
const ins = inserts();
const w1 = ins.filter(p => p[1] === 20260929), w2 = ins.filter(p => p[1] === 20261006);
// Week 1 (Back 9): Ann + Ben scored = $14 over 3 skins = $4 each (whole dollars; $2 is the remainder, NOT written here)
assert.deepStrictEqual(w1.map(p => [p[0], p[2], p[3]]), [['Ann', '#10', 4], ['Ann', '#11', 4], ['Ben', '#12', 4]]);
// Week 2 (Front 9): Ann + Cy + Dee = $21 over 1 skin = $21 (a combined pot would be $35 / 4 skins)
assert.deepStrictEqual(w2.map(p => [p[0], p[2], p[3]]), [['Dee', '#1', 21]]);
assert.strictEqual(ins.length, 4);
assert(!w1.some(p => ['Cy', 'Dee'].includes(p[0])), 'week 2 players never win week 1 skins');
assert(!w2.some(p => ['Ann', 'Ben'].includes(p[0])), 'week 1 winners never appear in week 2');
assert(!ins.some(p => !Number.isInteger(p[3])), 'no cents payouts');
const writesRemainder = () => runs.some(r => /Remainder/.test(r.sql) || (r.params || []).some(v => /Remainder|^Kitty$/.test(String(v))));
assert(!writesRemainder(), 'the automatic path must never write a Skins-kitty remainder');

// ---- Existing whole-dollar results: restated per week; a stale row from the wrong week is removed
runs.length = 0;
existingWinners = [
  { RowID: 1, Date: 20260929, Player: 'Ann', Detail: '#10' },
  { RowID: 2, Date: 20260929, Player: 'Ann', Detail: '#11' },
  { RowID: 3, Date: 20260929, Player: 'Ben', Detail: '#12' },
  { RowID: 4, Date: 20261006, Player: 'Dee', Detail: '#1' },
  { RowID: 5, Date: 20261006, Player: 'Ben', Detail: '#3' },   // Ben did not enter week 2
];
vm.runInContext(`calcEoySkins(2026, true)`, ctx);
const deletes = runs.filter(r => /^DELETE/.test(r.sql)).map(r => r.params[0]);
assert.deepStrictEqual(deletes, [5], 'only the ineligible week-2 row is removed');
const updates = runs.filter(r => /^UPDATE Payments SET Earned/.test(r.sql));
const upd = d => updates.find(u => u.sql.includes(`Date=${d}`)).params[0];
assert.strictEqual(upd(20260929), 4, 'week 1 restated from the week 1 pot, whole dollars');
assert.strictEqual(upd(20261006), 21, 'week 2 restated from the week 2 pot (1 skin left)');
assert.strictEqual(inserts().length, 0);
assert(!writesRemainder(), 'no remainder written');

// ---- A week still stored with cents ($44.33) is LEFT ALONE by the automatic path; the other week still calculates
runs.length = 0;
existingWinners = [];
legacyDates = new Set(['20260929']);
vm.runInContext(`calcEoySkins(2026, true)`, ctx);
assert(!runs.some(r => (r.params || []).includes(20260929) || /20260929/.test(r.sql)), 'legacy week 1 (cents) must not be deleted, updated or rewritten automatically');
assert.deepStrictEqual(inserts().map(p => [p[0], p[1], p[2], p[3]]), [['Dee', 20261006, '#1', 21]], 'week 2 still calculates');

// ---- Both weeks legacy: nothing at all is written
runs.length = 0;
legacyDates = new Set(['20260929', '20261006']);
vm.runInContext(`calcEoySkins(2026, true)`, ctx);
assert.strictEqual(runs.length, 0, 'nothing written when every week is still in cents');

console.log('ok');
