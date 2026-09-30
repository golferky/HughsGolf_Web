// Regression test: CTPs must be assignable on post-season nights.
// Run: node tests/ctp_post_season.test.js
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

// Fake DB: season 2026, post season week 1 = 9/29/2026 (Back 9), week 2 = 10/6/2026 (Front 9)
let week1Nine = 'Back';
const eoyRows = [
  { Player: 'Alice', Earned: 20, Comment: '(Both Weeks)' },
  { Player: 'Bob', Earned: 10, Comment: '(1st Week)' },
  { Player: 'Cara', Earned: 10, Comment: '(2nd Week)' },
  { Player: 'Dan', Earned: 10, Comment: '(1st Week)' },        // paid week 1 but never scored: a no-show
];
const row = p => ({ Player: p, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4, 9: 4 });
const scoresByDate = { 20260929: [row('Alice'), row('Bob')], 20261006: [row('Alice'), row('Cara')] };
function query(sql) {
  if (/Detail='Refund'/.test(sql)) return [];
  let m;
  if ((m = sql.match(/FROM Scores WHERE Date=(\d+)/))) return scoresByDate[m[1]] || [];
  if (/FROM SeasonSettings WHERE League="Hugh's" AND Season=\d+ AND PostSeasonDt IS NOT NULL/.test(sql)) return [{ PostSeasonDt: '9/29/2026' }];
  if (/SELECT PostSeasonDt, EOYSkins as EoySkins FROM SeasonSettings/.test(sql)) return [{ PostSeasonDt: '9/29/2026', EoySkins: 20 }];
  if (/SELECT \* FROM SeasonSettings/.test(sql)) return [{ PostSeasonDt: '9/29/2026', EOYSkins: 20, ClosestPS: 3, PSWeek1Nine: week1Nine }];
  if (/FROM Payments/.test(sql) && /EOY Skins/.test(sql)) return eoyRows;
  return [];
}

const ctx = vm.createContext({ query, parseInt, parseFloat, Set, Date, String, Number });
['psMdyToInt', 'psAddDaysMdy', 'getSeasonSettings', 'getPostSeasonWeek1Nine', 'parsePostSeasonDates', 'getPostSeasonWeekForDate', 'getPostSeasonWeekEntry', 'eoyWeeksFromComment', 'computeEoyGrossByWeek', 'getEoyRefundsByPlayer', 'getEoySkinPlayersForWeek',
 'psWeekScorerRows', 'getPostSeasonWeekPotPlayers', 'getPostSeasonContextForDate', 'getCtpDateKeys', 'getPostSeasonCtpInfo']
  .forEach(n => vm.runInContext(extract(n), ctx));

// 1. Post-season nights appear in the CTP date list even with no CTP 'Payment' rows
const keys = vm.runInContext(`getCtpDateKeys(['20260922'], 2026)`, ctx);
assert.deepStrictEqual(Array.from(keys), ['20261006', '20260929', '20260922']);

// 2. Week 1 (9/29) = Back 9; the pot/winner list is paid-AND-SCORED only: Dan paid week 1 but never scored -> excluded
const w1 = vm.runInContext(`getPostSeasonCtpInfo('20260929')`, ctx);
assert.strictEqual(w1.fb, 'Back');
assert.deepStrictEqual(Array.from(w1.payers), ['Alice', 'Bob']);

// 3. Week 2 (10/6) = Front 9, its own players only
const w2 = vm.runInContext(`getPostSeasonCtpInfo('20261006')`, ctx);
assert.strictEqual(w2.fb, 'Front');
assert.deepStrictEqual(Array.from(w2.payers), ['Alice', 'Cara']);

// 4. Regular-season date is not post season
assert.strictEqual(vm.runInContext(`getPostSeasonCtpInfo('20260922')`, ctx), null);

// 5. When Week 1 is the Front 9 (PSWeek1Nine), the sides swap
week1Nine = 'Front';
assert.strictEqual(vm.runInContext(`getPostSeasonCtpInfo('20260929')`, ctx).fb, 'Front');
assert.strictEqual(vm.runInContext(`getPostSeasonCtpInfo('20261006')`, ctx).fb, 'Back');

console.log('ok');
