const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const ctx = {}; vm.createContext(ctx); vm.runInContext(['psLeaderboardRanks', 'psLeaderboardShotsBack', 'psCcPrizeSchedule', 'psLeaderboardCcPotential', 'psCcMissedWeek'].map(extract).join('\n'), ctx);
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
// ---- shots back (strokes behind the leader)
const back = (lb, ok = () => true) => Array.from(ctx.psLeaderboardShotsBack(lb, ctx.psLeaderboardRanks(lb, ok)));
assert.deepStrictEqual(back([P('Brad', 34), P('Robby', 35), P('Howard', 35), P('Greg', 36), P('Jake', 38)]), [0, 1, 1, 2, 4]);
// tied leaders are both 0
assert.deepStrictEqual(back([P('A', 30), P('B', 30), P('C', 32)]), [0, 0, 2]);
// subs and unscored players get no value; a sub with the best score is not the leader
assert.deepStrictEqual(back([P('Sub', 29), P('A', 30), P('B', 33), P('X', '', false, false)], p => p.name !== 'Sub'), [null, 0, 3, null]);
// fewer completed nines is not comparable
assert.deepStrictEqual(back([P('A', 35, true, true), P('B', 20, true, false)]), [0, null]);
assert(/psLeaderboardShotsBack\(leaderboard/.test(src), 'renderer uses shots-back helper');
// ---- potential CC winnings
const sched = ss => Array.from(ctx.psCcPrizeSchedule(ss, 1000));
assert.deepStrictEqual(sched({}), [100, 50, 25], 'defaults');
assert.deepStrictEqual(sched({ ChampMode: 'Flat', ChampPlaces: 2, ChampPlace1: 120, ChampPlace2: 60, ChampPlace3: 30 }), [120, 60], 'ChampPlaces limits paid places');
assert.deepStrictEqual(sched({ ChampMode: 'Percent', ChampPlace1: 50, ChampPlace2: 30, ChampPlace3: 20 }), [500, 300, 200], 'Percent of dues');
assert.deepStrictEqual(sched({ ChampPlaces: 1 }), [100]);
const cc = (lb, sch = [100, 50, 25], ok = () => true) => Array.from(ctx.psLeaderboardCcPotential(lb, ctx.psLeaderboardRanks(lb, ok), sch));
assert.deepStrictEqual(cc([P('A', 30), P('B', 31), P('C', 32), P('D', 33)]), [100, 50, 25, null], 'straight places; 4th unpaid');
assert.deepStrictEqual(cc([P('A', 30), P('B', 31), P('C', 31), P('D', 33)]), [100, 37.5, 37.5, null], 'T2 splits 2nd+3rd');
assert.deepStrictEqual(cc([P('A', 30), P('B', 30), P('C', 32)]), [75, 75, 25], 'tie for 1st splits 1st+2nd');
assert.deepStrictEqual(cc([P('A', 30), P('B', 31), P('C', 31), P('D', 31)]), [100, 25, 25, 25], 'T2 of 3 splits 2nd+3rd+nothing');
assert.deepStrictEqual(cc([P('Sub', 29), P('A', 30), P('B', 31)], [100, 50, 25], p => p.name !== 'Sub'), [null, 100, 50], 'subs get nothing and take no place');
assert.deepStrictEqual(cc([P('A', 30), P('X', '', false, false)]), [100, null], 'unscored get nothing');
assert.deepStrictEqual(cc([P('A', 30), P('B', 31)], [100]), [100, null], 'only paid places');
assert(/psLeaderboardCcPotential\(leaderboard/.test(src) && />CC \$</.test(src), 'renderer uses CC helper and has the CC $ header');
// ---- League Championship needs BOTH weeks
const miss = (scored, closed) => ctx.psCcMissedWeek(scored, closed);
assert.strictEqual(miss({ 1: true, 2: true }, { 1: true, 2: true }), 0, 'played both');
assert.strictEqual(miss({ 1: false, 2: true }, { 1: true, 2: false }), 1, 'no Week 1 once Week 1 is over (Gary)');
assert.strictEqual(miss({ 1: true, 2: false }, { 1: true, 2: false }), 0, 'Week 2 not over yet: still in the running');
assert.strictEqual(miss({ 1: true, 2: false }, { 1: true, 2: true }), 2, 'no Week 2 once Week 2 is over');
assert.strictEqual(miss({ 1: false, 2: false }, { 1: false, 2: false }), 0, 'nothing is over yet: live Week 1 players are not excluded');
assert.strictEqual(miss({ 1: false, 2: false }, { 1: true, 2: true }), 1, 'reports the first missed week');
assert.strictEqual(miss(undefined, { 1: false, 2: false }), 0);
// column header and negative display
assert(/>Back</.test(src) && /-\${lbBack\[i\]}/.test(src), 'Back header and negative shots back');
assert(/psLeaderboardRanks\(leaderboard/.test(src), 'renderer uses helper');
console.log('ok');
