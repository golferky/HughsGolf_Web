// Regression test: on a post-season date the CTPs tab uses ONLY that week's PAID-AND-SCORED players as the pot basis
// ($3 each) and as the winner list, honors PSWeek1Nine for Front/Back, and leaves the existing per-hole rounding,
// remainder message and carryover behavior exactly as they were. Week 1 and week 2 must never mix.
// Week 1 = 9/29/2026 (Back 9), week 2 = 10/6/2026 (Front 9).
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

// Par 3s: front 3 & 7, back 12 & 16.
let week1Nine = 'Back';
const course = { Hole1: 4, Hole2: 4, Hole3: 3, Hole4: 4, Hole5: 5, Hole6: 4, Hole7: 3, Hole8: 4, Hole9: 5,
                 Hole10: 4, Hole11: 4, Hole12: 3, Hole13: 4, Hole14: 5, Hole15: 4, Hole16: 3, Hole17: 4, Hole18: 5 };

// Week 1 (9/29): 19 paid-and-scored + 4 confirmed no-shows (paid week 1, no score).
const week1Scored = Array.from({ length: 19 }, (_, i) => 'Play' + String(i + 1).padStart(2, '0'));
const noShows = ['Dan Bowen', 'Jason Noble', 'Steve Bailey', 'Tim Franxman'];
// Week 2 (10/6): Play01 (paid both weeks) + 3 week-2-only players; one week-2-only no-show.
const week2Only = ['Quinn A', 'Quinn B', 'Quinn C'];
const eoyRows = [
  ...week1Scored.map(p => ({ Player: p, Earned: p === 'Play01' ? 20 : 10, Comment: p === 'Play01' ? '(Both Weeks)' : '(1st Week)' })),
  ...noShows.map(p => ({ Player: p, Earned: 10, Comment: '(1st Week)' })),
  ...week2Only.map(p => ({ Player: p, Earned: 10, Comment: '(2nd Week)' })),
  { Player: 'Quinn NoShow', Earned: 10, Comment: '(2nd Week)' },
];
const scoreRow = p => ({ Player: p, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4, 9: 4 });
const scoresByDate = {
  20260929: week1Scored.map(scoreRow),
  20261006: ['Play01', ...week2Only].map(scoreRow),
};
function query(sql) {
  if (/Detail='Refund'/.test(sql)) return [];
  let m;
  if ((m = sql.match(/FROM Scores WHERE Date=(\d+)/))) return scoresByDate[m[1]] || [];
  if (/SELECT \* FROM SeasonSettings/.test(sql)) return [{ PostSeasonDt: '9/29/2026', PSWeek1Nine: week1Nine, EOYSkins: 20, ClosestPS: 3 }];
  if (/SELECT PostSeasonDt, EOYSkins as EoySkins FROM SeasonSettings/.test(sql)) return [{ PostSeasonDt: '9/29/2026', EoySkins: 20 }];
  if (/SELECT PSWeek2Dt/.test(sql)) return [];
  if (/FROM Courses/.test(sql)) return [course];
  if (/FROM Payments/.test(sql) && /'EOY Skins'/.test(sql)) return eoyRows;
  if (/Player='Kitty' AND Date </.test(sql)) return [{ Detail: 'Carryover12-Back', Earned: 4, cDate: 20260922 }];   // pre-existing CTP carryover
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
 'parsePostSeasonDates', 'getPostSeasonWeekEntry', 'eoyWeeksFromComment', 'computeEoyGrossByWeek', 'getEoyRefundsByPlayer', 'getEoySkinPlayersForWeek',
 'psWeekScorerRows', 'getPostSeasonWeekPotPlayers', 'getPostSeasonContextForDate', 'getPostSeasonCtpInfo', 'loadCtps']
  .forEach(n => vm.runInContext(extract(n), ctx));

function load(date) {
  els.ctpsDate.value = date;
  vm.runInContext('loadCtps()', ctx);
  return els.ctpsContent.innerHTML;
}
const options = out => Array.from(new Set((out.match(/<option value="([^"]+)">/g) || []).map(o => o.replace(/<option value="|">/g, '')).filter(Boolean))).sort();

// ---- Week 1, 9/29, Back 9: 19 paid-and-scored -> CTP pot 19 x $3 = $57; the 4 no-shows are in no pot and cannot win
let out = load('20260929');
assert(/19 players × \$3 = <strong>\$57<\/strong>/.test(out), 'week 1 CTP pot should be 19 x $3 = $57');
assert(/Back 9 · 2 CTP holes/.test(out), 'week 1 (9/29) is the Back 9');
assert.deepStrictEqual(options(out), week1Scored.slice().sort());
noShows.forEach(n => assert(!out.includes(n), n + ' (no-show) must not be a CTP winner option'));
week2Only.forEach(n => assert(!out.includes(n), n + ' (week 2 only) must not appear in week 1'));
// EXISTING rounding / remainder / carryover rules are unchanged: $57 / 2 holes = $28.50 -> $28 per hole, $1.00 remainder;
// hole 12 also carries its existing $4 carryover (total $32); hole 16 has none (total $28)
assert(/\$1\.00 remainder → kitty/.test(out), 'existing CTP remainder message is unchanged');
assert(/\$32\.00/.test(out), 'hole 12 total = $28 pot + $4 carryover');
assert.strictEqual((out.match(/\$28\.00/g) || []).length, 3, 'pot $28.00 on both holes + hole 16 total');

// ---- Week 2, 10/6, Front 9: Play01 + 3 week-2-only = 4 paid-and-scored -> 4 x $3 = $12 over holes 3 & 7 = $6 each
out = load('20261006');
assert(/4 players × \$3 = <strong>\$12<\/strong>/.test(out), 'week 2 CTP pot should be 4 x $3 = $12');
assert(/Front 9 · 2 CTP holes/.test(out), 'week 2 (10/6) is the Front 9');
assert.deepStrictEqual(options(out), ['Play01', ...week2Only].sort());
assert(!out.includes('Quinn NoShow'), 'a paid week-2 no-show is not in the pool or the dropdown');
assert(!out.includes('Play02') && !out.includes('Dan Bowen'), 'week 1 players who did not pay for week 2 never appear');
assert(!/remainder/.test(out), '$12 over 2 holes divides evenly: no remainder message');

// ---- PSWeek1Nine = Front swaps the sides, pools stay with their own week
week1Nine = 'Front';
out = load('20260929');
assert(/Front 9 · 2 CTP holes/.test(out) && /19 players × \$3/.test(out));
out = load('20261006');
assert(/Back 9 · 2 CTP holes/.test(out) && /4 players × \$3/.test(out));

console.log('ok');
