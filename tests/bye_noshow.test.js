// Playing a bye team: both show = all 3 points; one no-show = 1 point (the player who showed), the team point goes to the bye team;
// both no-show = 0. A sub who plays counts as showing. (A bye team never has scores, so nothing it "plays" ever counts.)
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf(') {', i) + 2; for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
const c = vm.createContext({}); vm.runInContext(extract('calcMatchPoints'), c);
const real = { A: 'Ann', B: 'Bob' }, ghost = { A: 'Bye A', B: 'Bye B' };
const play = (scores, opp = ghost, subs = {}) => { const r = c.calcMatchPoints(real, opp, Object.fromEntries(Object.entries(scores).map(([p, n]) => [p, { net: n }])), 1, 2, subs); return { total: r.A.pts1 + r.B.pts1 + r.t1tpts, team: r.t1tpts, byeTeam: r.A.pts2 + r.B.pts2 + r.t2tpts }; };
for (const opp of [ghost, {}]) {                      // a bye team with made-up players, or with no players at all
  assert.deepStrictEqual(play({ Ann: 38, Bob: 44 }, opp), { total: 3, team: 1, byeTeam: 0 }, 'both show: all 3 points');
  assert.deepStrictEqual(play({ Ann: 38 }, opp), { total: 1, team: 0, byeTeam: 2 }, 'Bob no-shows: 1 point; the bye team gets his match and the team point');
  assert.deepStrictEqual(play({ Bob: 44 }, opp), { total: 1, team: 0, byeTeam: 2 }, 'Ann no-shows: 1 point; the bye team gets her match and the team point');
  assert.deepStrictEqual(play({}, opp), { total: 0, team: 0, byeTeam: 3 }, 'both no-show: the bye team takes all 3');
}
assert.deepStrictEqual(play({ Ann: 38, Sam: 50 }, ghost, { '1-B': 'Sam' }), { total: 3, team: 1, byeTeam: 0 }, 'a sub who plays counts as showing');
// the bye team can be either side of the match, and two real teams are scored exactly as before
const r2 = c.calcMatchPoints(ghost, real, { Ann: { net: 38 } }, 2, 1, {}); assert.deepStrictEqual([r2.A.pts2 + r2.B.pts2 + r2.t2tpts, r2.A.pts1 + r2.B.pts1 + r2.t1tpts], [1, 2], 'bye on the first side');
const vs = (s) => c.calcMatchPoints(real, { A: 'Cy', B: 'Di' }, Object.fromEntries(Object.entries(s).map(([p, n]) => [p, { net: n }])), 1, 2, {});
const n1 = vs({ Ann: 38, Cy: 40 }); assert.deepStrictEqual([n1.A.pts1, n1.A.pts2, n1.B.pts1, n1.B.pts2], [1, 0, 0, 0], 'two real teams: a no-show is still just a forfeited match');
assert(/Playing a bye/.test(src), 'the rules say how a bye works');
console.log('ok');
