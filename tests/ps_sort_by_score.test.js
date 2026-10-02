// "Sort by Score" on the post-season grid must order players by score even when only one nine has been played (Week 1).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const ctx = vm.createContext({ parseInt, isNaN });
['getPostSeasonEntryTotals', 'psCompareByScore'].forEach(n => vm.runInContext(extract(n), ctx));
const back = (...g) => [...Array(9).fill(''), ...g.map(String), ...Array(9 - g.length).fill('')];       // Week 1 only (back 9)
const front = g => [...g.map(String), ...Array(9 - g.length).fill(''), ...Array(9).fill('')];
const both = (b, f) => [...f, ...b].map(String);
const slot = (name, holes, phdcp = 0) => ({ name, st: { holes, phdcp } });
const sorted = list => list.slice().sort((x, y) => ctx.psCompareByScore(ctx.getPostSeasonEntryTotals(x.st), ctx.getPostSeasonEntryTotals(y.st))).map(x => x.name);
const nine = (n, extra = 0) => Array(9).fill(Math.floor(n / 9)).map((v, i) => v + (i < n % 9 ? 1 : 0));

// Week 1 only: nobody has a total (totalNet is '' for everyone) yet the grid must still sort by running net
const list = [slot('High', back(...nine(46)), 9), slot('NoScore', Array(18).fill('')), slot('Low', back(...nine(39)), 4), slot('Mid', back(...nine(44)), 8)];
assert(list.every(l => ctx.getPostSeasonEntryTotals(l.st).totalNet === ''), 'precondition: no 18-hole totals during Week 1');
assert.deepStrictEqual(sorted(list), ['Low', 'Mid', 'High', 'NoScore'], 'by net (gross - handicap), no score last: 35 < 36 < 37');
// handicap matters: higher gross can have the lower net
assert.deepStrictEqual(sorted([slot('A', back(...nine(40)), 0), slot('B', back(...nine(44)), 9)]), ['B', 'A']);
// two nines beat one nine (like the leaderboard), then lower net wins among equals
assert.deepStrictEqual(sorted([slot('OneNine', back(...nine(30))), slot('TwoNines', both(nine(40), nine(40)))]), ['TwoNines', 'OneNine']);
assert.deepStrictEqual(sorted([slot('X', both(nine(40), nine(42))), slot('Y', both(nine(38), nine(40)))]), ['Y', 'X']);
// ties keep their existing (group) order; blanks keep theirs
assert.deepStrictEqual(sorted([slot('T1', back(...nine(40))), slot('T2', back(...nine(40))), slot('B1', Array(18).fill('')), slot('B2', Array(18).fill(''))]), ['T1', 'T2', 'B1', 'B2']);
// the grid uses it (and no longer sorts on totalNet alone)
const grid = src.slice(src.indexOf('// Post season: optionally sort by net score ascending'), src.indexOf('slots.forEach(slot => {\n    const key = `${slot.team}-${slot.grade}`;\n    const st  = entryState[key];'));
assert(/psCompareByScore\(/.test(grid) && !/\.totalNet/.test(grid), 'grid sort uses psCompareByScore');
console.log('ok');
