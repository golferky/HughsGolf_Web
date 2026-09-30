// Regression test: calcEoySkins calculates and stores post-season Skins payouts PER WEEK.
// Each week is independent ($10 per week entered = $7 Skins + $3 CTP): week N's pot pays only week N's
// winners; there is no combined two-week pot.
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

// Season 2026: week 1 = 9/22 (Front), week 2 = 9/29 (Back).
//  Ann: both weeks. Ben: week 1 only. Cy, Dee: week 2 only. Eve scores in week 1 but never paid.
const eoyRows = [
  { Player: 'Ann', Earned: 20, Comment: '' },
  { Player: 'Ben', Earned: 10, Comment: '(1st Week)' },
  { Player: 'Cy', Earned: 10, Comment: '(2nd Week)' },
  { Player: 'Dee', Earned: 10, Comment: '(2nd Week)' },
];
const nines = (v) => { const r = {}; v.forEach((g, i) => { r[String(i + 1)] = g; }); return r; };
const par4 = Array(9).fill(4);
const scoresByDate = {
  // Week 1 front: Ann wins holes 1,2 (3s); Ben wins hole 3 (4 vs 5); all else ties. Eve is unpaid -> ignored.
  20260922: [
    { Player: 'Ann', ...nines([3, 3, 5, 4, 4, 4, 4, 4, 4]) },
    { Player: 'Ben', ...nines([4, 4, 4, 4, 4, 4, 4, 4, 4]) },
    { Player: 'Eve', ...nines([2, 2, 2, 2, 2, 2, 2, 2, 2]) },
  ],
  // Week 2 back (scores saved as 1-9 of that nine): Dee wins hole 10 only.
  20260929: [
    { Player: 'Ann', ...nines(par4) },
    { Player: 'Cy', ...nines(par4) },
    { Player: 'Dee', ...nines([3, 4, 4, 4, 4, 4, 4, 4, 4]) },
  ],
};

let existingWinners = [];
const runs = [];
function query(sql, params = []) {
  if (/Detail='Refund'/.test(sql)) return [];
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
  getSeasonSettings: () => ({ PostSeasonDt: '9/22/2026', PSWeek1Nine: 'Front', SkinsPS: 7, ClosestPS: 3, EOYSkins: 20 }),
  courseData: { front: { hcps: seq, pars: par4 }, back: { hcps: seq, pars: par4 }, all18: {} },
});
['psMdyToInt', 'psAddDaysMdy', 'parsePostSeasonDates', 'getPostSeasonWeekForDate', 'getPostSeasonWeek1Nine',
 'getPostSeasonWeekEntry', 'computeEoyGrossByWeek', 'getEoyRefundsByPlayer', 'getEoySkinPlayersForWeek', 'psWeekSkinValue', 'calcEoySkins']
  .forEach(n => vm.runInContext(extract(n), ctx));

const inserts = () => runs.filter(r => /^INSERT INTO Payments/.test(r.sql)).map(r => r.params);

// ---- helper: per-week value never uses a combined pot
assert.strictEqual(ctx.psWeekSkinValue(2, 3, 7), 4.67);
assert.strictEqual(ctx.psWeekSkinValue(3, 1, 7), 21);
assert.strictEqual(ctx.psWeekSkinValue(3, 0, 7), 0);

// ---- Fresh calculation
vm.runInContext(`calcEoySkins(2026, true)`, ctx);
const ins = inserts();
const w1 = ins.filter(p => p[1] === 20260922), w2 = ins.filter(p => p[1] === 20260929);
// Week 1: 2 paid scorers (Ann, Ben; Eve excluded) x $7 = $14 over 3 skins = $4.67 each
assert.deepStrictEqual(w1.map(p => [p[0], p[2], p[3]]), [['Ann', '#1', 4.67], ['Ann', '#2', 4.67], ['Ben', '#3', 4.67]]);
// Week 2: 3 players x $7 = $21 over 1 skin = $21.00 (a combined pot would be $35 / 4 = $8.75)
assert.deepStrictEqual(w2.map(p => [p[0], p[2], p[3]]), [['Dee', '#10', 21]]);
assert.strictEqual(ins.length, 4);
assert(!w1.some(p => ['Cy', 'Dee'].includes(p[0])), 'week 2 players never win week 1 skins');
assert(!w2.some(p => ['Ann', 'Ben'].includes(p[0])), 'week 1 winners never appear in week 2');
assert(!ins.some(p => p[3] === 8.75), 'no combined two-week payout');

// ---- Existing results: stored payouts are restated per week; a stale row from the wrong week is removed
runs.length = 0;
existingWinners = [
  { RowID: 1, Date: 20260922, Player: 'Ann', Detail: '#1' },
  { RowID: 2, Date: 20260922, Player: 'Ann', Detail: '#2' },
  { RowID: 3, Date: 20260922, Player: 'Ben', Detail: '#3' },
  { RowID: 4, Date: 20260929, Player: 'Dee', Detail: '#10' },
  { RowID: 5, Date: 20260929, Player: 'Ben', Detail: '#12' },   // Ben did not enter week 2
];
vm.runInContext(`calcEoySkins(2026, true)`, ctx);
const deletes = runs.filter(r => /^DELETE/.test(r.sql)).map(r => r.params[0]);
assert.deepStrictEqual(deletes, [5], 'only the ineligible week-2 row is removed');
const updates = runs.filter(r => /^UPDATE Payments SET Earned/.test(r.sql));
const upd = d => updates.find(u => u.sql.includes(`Date=${d}`)).params[0];
assert.strictEqual(upd(20260922), 4.67, 'week 1 restated from the week 1 pot');
assert.strictEqual(upd(20260929), 21, 'week 2 restated from the week 2 pot (1 skin left)');
assert.strictEqual(inserts().length, 0);

console.log('ok');
