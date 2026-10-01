const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const ctx = {}; vm.createContext(ctx); vm.runInContext(extract('psLeaderboardRanks'), ctx);
const P = (name, net, f = true, b = true) => ({ name, runNet: net, frontComplete: f, backComplete: b });
const ranks = (lb, ok = () => true) => Array.from(ctx.psLeaderboardRanks(lb, ok));

// 1, T2, T2, T2, 5 (competition ranking), then T5 group
assert.deepStrictEqual(ranks([P('Brad', 34), P('Robby', 35), P('Howard', 35), P('TJ', 35), P('TG', 36), P('Greg', 36), P('Don', 36), P('Jake', 37)]), [1, 2, 2, 2, 5, 5, 5, 8]);
// no ties
assert.deepStrictEqual(ranks([P('A', 30), P('B', 31), P('C', 32)]), [1, 2, 3]);
// tie for 1st
assert.deepStrictEqual(ranks([P('A', 30), P('B', 30), P('C', 32)]), [1, 1, 3]);
// subs get no place and don't break or join a tie
assert.deepStrictEqual(ranks([P('A', 30), P('Sub', 30), P('B', 30), P('C', 31)], p => p.name !== 'Sub'), [1, null, 1, 3]);
// players with no score never tie each other
assert.deepStrictEqual(ranks([P('A', 30), P('X', '', false, false), P('Y', '', false, false)]), [1, 2, 3]);
// different completed nines are not tied even with equal net
assert.deepStrictEqual(ranks([P('A', 35, true, true), P('B', 35, true, false)]), [1, 2]);
assert(/psLeaderboardRanks\(leaderboard/.test(src), 'renderer uses helper');
console.log('ok');
