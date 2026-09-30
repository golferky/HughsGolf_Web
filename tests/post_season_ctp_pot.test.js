// Regression test: on a post-season date the CTPs tab uses ONLY that week's EOY Skins payers,
// a pot of $3 x that week's players (split across that week's CTP holes), plus normal per-hole
// carryover, and honors PSWeek1Nine for Front/Back. Week 1 and week 2 must never mix.
// Run: node tests/post_season_ctp_pot.test.js
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

// Week 1 = 9/22/2026, week 2 = 9/29/2026. Par 3s: front 3 & 7, back 12 & 16.
let week1Nine = 'Front';
const eoyRows = [
  { Player: 'Ann', Earned: 20, Comment: '(Both Weeks)' }, // both weeks
  { Player: 'Ben', Earned: 10, Comment: '(1st Week)' },   // week 1 only
  { Player: 'Cy', Earned: 10, Comment: '(2nd Week)' },    // week 2 only
  { Player: 'Dee', Earned: 10, Comment: '(2nd Week)' },   // week 2 only
];
const course = { Hole1: 4, Hole2: 4, Hole3: 3, Hole4: 4, Hole5: 5, Hole6: 4, Hole7: 3, Hole8: 4, Hole9: 5,
                 Hole10: 4, Hole11: 4, Hole12: 3, Hole13: 4, Hole14: 5, Hole15: 4, Hole16: 3, Hole17: 4, Hole18: 5 };
function query(sql) {
  if (/Detail='Refund'/.test(sql)) return [];
  if (/SELECT \* FROM SeasonSettings/.test(sql)) return [{ PostSeasonDt: '9/22/2026', PSWeek1Nine: week1Nine, EOYSkins: 20, ClosestPS: 3 }];
  if (/SELECT PostSeasonDt, EOYSkins as EoySkins FROM SeasonSettings/.test(sql)) return [{ PostSeasonDt: '9/22/2026', EoySkins: 20 }];
  if (/SELECT PSWeek2Dt/.test(sql)) return [];
  if (/FROM Courses/.test(sql)) return [course];
  if (/FROM Payments/.test(sql) && /'EOY Skins'/.test(sql)) return eoyRows;
  if (/Player='Kitty' AND Date </.test(sql)) return [{ Detail: 'Carryover12-Back', Earned: 4, cDate: 20260915 }];
  return [];
}

const els = { ctpsDate: { value: '' }, ctpsSeason: { value: '2026' }, ctpsContent: { innerHTML: '' } };
const ctx = vm.createContext({
  document: { getElementById: id => els[id] }, db: true, currentUser: { role: 'admin' },
  query, parseInt, parseFloat, String, Set, Number, Math, toDateKey: v => String(v),
  reconcilePreviousCtpCarryovers: () => 0, saveDBToServer() {}, fmtDate: d => d,
  getScheduledFrontBack: () => 'Front',   // regular-season logic; must NOT be used for post season
});
['psMdyToInt', 'psAddDaysMdy', 'getSeasonSettings', 'getPostSeasonWeek1Nine', 'getPostSeasonWeekForDate',
 'parsePostSeasonDates', 'getPostSeasonWeekEntry', 'eoyWeeksFromComment', 'computeEoyGrossByWeek', 'getEoyRefundsByPlayer', 'getEoySkinPlayersForWeek', 'getPostSeasonContextForDate', 'getPostSeasonCtpInfo', 'loadCtps']
  .forEach(n => vm.runInContext(extract(n), ctx));

function load(date) {
  els.ctpsDate.value = date;
  vm.runInContext('loadCtps()', ctx);
  return els.ctpsContent.innerHTML;
}
const options = out => (out.match(/<option value="([^"]+)">/g) || []).map(o => o.replace(/<option value="|">/g, '')).filter(Boolean);

// ---- Week 1, Front: Ann + Ben -> $6 pot over holes 3 & 7 = $3.00 each, no carryover
let out = load('20260922');
assert(/2 players × \$3 = <strong>\$6<\/strong>/.test(out), 'week 1 pot should be 2 x $3 = $6');
assert(/Front 9 · 2 CTP holes/.test(out));
assert.deepStrictEqual(Array.from(new Set(options(out))).sort(), ['Ann', 'Ben']);
assert(!out.includes('Cy') && !out.includes('Dee'));
assert.strictEqual((out.match(/\$3\.00/g) || []).length, 4, 'each hole: pot $3.00 and total $3.00');

// ---- Week 2, Back: Ann + Cy + Dee -> $9 pot over holes 12 & 16 = $4/hole ($1 remainder), hole 12 carries $4
out = load('20260929');
assert(/3 players × \$3 = <strong>\$9<\/strong>/.test(out), 'week 2 pot should be 3 x $3 = $9');
assert(/Back 9 · 2 CTP holes/.test(out));
assert.deepStrictEqual(Array.from(new Set(options(out))).sort(), ['Ann', 'Cy', 'Dee']);
assert(!out.includes('Ben'), 'Ben (week 1 only) must not appear in week 2');
assert(/\$8\.00/.test(out), 'hole 12 total = $4 pot + $4 carryover');
assert(/remainder/.test(out));

// ---- PSWeek1Nine = Back swaps the sides, players stay with their own week
week1Nine = 'Back';
out = load('20260922');
assert(/Back 9 · 2 CTP holes/.test(out), 'week 1 is the Back 9 when PSWeek1Nine=Back');
assert.deepStrictEqual(Array.from(new Set(options(out))).sort(), ['Ann', 'Ben']);
out = load('20260929');
assert(/Front 9 · 2 CTP holes/.test(out), 'week 2 is the Front 9 when PSWeek1Nine=Back');
assert.deepStrictEqual(Array.from(new Set(options(out))).sort(), ['Ann', 'Cy', 'Dee']);

console.log('ok');
