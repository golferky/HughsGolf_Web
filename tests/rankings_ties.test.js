// League Rankings: players with the same combined average share a rank (shown T6) instead of getting consecutive ranks.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const c = vm.createContext({ Math });
vm.runInContext(extract('rankWithTies'), c);
const plain = x => JSON.parse(JSON.stringify(x));
const rank = vals => plain(c.rankWithTies(vals.map((v, i) => ({ name: 'P' + i, overallAvg: v })), 'overallAvg', 'overallRank', 'overallTied').map(r => [r.overallRank, r.overallTied]));

// the screenshot: 40.0 x3 (ranks 6,7,8 before), then 40.1; 41.0 x2; 41.3 x3
assert.deepStrictEqual(rank([39.6, 40, 40, 40, 40.1]), [[1, false], [2, true], [2, true], [2, true], [5, false]], 'three 40.0 players share a rank; the next is 5th');
assert.deepStrictEqual(rank([36, 37.5, 41, 41, 41.3, 41.3, 41.3, 42]), [[1, false], [2, false], [3, true], [3, true], [5, true], [5, true], [5, true], [8, false]]);
assert.deepStrictEqual(rank([30, 31, 32]), [[1, false], [2, false], [3, false]], 'no ties: unchanged');
// averages of whole scores that are really equal (floating point) tie; different ones do not
assert.deepStrictEqual(rank([(39 + 40 + 41) / 3, 40, 40.0000000001, 40.001]).map(r => r[0]), [1, 1, 1, 4]);
assert.deepStrictEqual(rank([40.04, 40.05]).map(r => r[0]), [1, 2], 'only exactly equal averages tie (display rounding does not create ties)');
// no data ties only with no data
assert.deepStrictEqual(rank([40, null, null]), [[1, false], [2, true], [2, true]]);
assert.deepStrictEqual(rank([]), []);
// the table prints T for ties and still uses the helper for the default sort
assert(/rankWithTies\(overallRanked, 'overallAvg', 'overallRank', 'overallTied'\)/.test(src));
assert(/\$\{r\.overallTied \? 'T' : ''\}\$\{r\.overallRank\}/.test(src), 'Rank column shows T for ties');
console.log('ok');
