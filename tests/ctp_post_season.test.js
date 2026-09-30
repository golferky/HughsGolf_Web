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

// Fake DB: season 2025, post season starts 9/17/2025 (week 2 = 9/24/2025)
let week1Nine = 'Front';
const eoyRows = [
  { Player: 'Alice', Earned: 20, Comment: '' },
  { Player: 'Bob', Earned: 10, Comment: '(1st Week)' },
  { Player: 'Cara', Earned: 10, Comment: '(2nd Week)' },
];
function query(sql) {
  if (/FROM SeasonSettings WHERE League="Hugh's" AND Season=\d+ AND PostSeasonDt IS NOT NULL/.test(sql)) return [{ PostSeasonDt: '9/17/2025' }];
  if (/SELECT PostSeasonDt, EOYSkins as EoySkins FROM SeasonSettings/.test(sql)) return [{ PostSeasonDt: '9/17/2025', EoySkins: 20 }];
  if (/SELECT \* FROM SeasonSettings/.test(sql)) return [{ EOYSkins: 20, PSWeek1Nine: week1Nine }];
  if (/FROM Payments/.test(sql) && /EOY Skins/.test(sql)) return eoyRows;
  return [];
}

const ctx = vm.createContext({ query, parseInt, parseFloat, Set, Date, String, Number });
['psMdyToInt', 'psAddDaysMdy', 'getSeasonSettings', 'getPostSeasonWeek1Nine', 'parsePostSeasonDates', 'getPostSeasonWeekForDate', 'getEoySkinPlayersForWeek',
 'getPostSeasonContextForDate', 'getCtpDateKeys', 'getPostSeasonCtpInfo']
  .forEach(n => vm.runInContext(extract(n), ctx));

// 1. Post-season nights appear in the CTP date list even with no CTP 'Payment' rows
const keys = vm.runInContext(`getCtpDateKeys(['20250910'], 2025)`, ctx);
assert.deepStrictEqual(Array.from(keys), ['20250924', '20250917', '20250910']);

// 2. Week 1 = Front, eligible = full-payers + week-1 payers
const w1 = vm.runInContext(`getPostSeasonCtpInfo('20250917')`, ctx);
assert.strictEqual(w1.fb, 'Front');
assert.deepStrictEqual(Array.from(w1.payers), ['Alice', 'Bob']);

// 3. Week 2 = Back
const w2 = vm.runInContext(`getPostSeasonCtpInfo('20250924')`, ctx);
assert.strictEqual(w2.fb, 'Back');
assert.deepStrictEqual(Array.from(w2.payers), ['Alice', 'Cara']);

// 4. Regular-season date is not post season
assert.strictEqual(vm.runInContext(`getPostSeasonCtpInfo('20250910')`, ctx), null);

// 5. Sandbox: when Week 1 is the Back 9, CTP sides swap
week1Nine = 'Back';
assert.strictEqual(vm.runInContext(`getPostSeasonCtpInfo('20250917')`, ctx).fb, 'Back');
assert.strictEqual(vm.runInContext(`getPostSeasonCtpInfo('20250924')`, ctx).fb, 'Front');

console.log('ok');
