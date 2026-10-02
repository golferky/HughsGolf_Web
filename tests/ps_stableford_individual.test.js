// Post-season Stableford is an individual award (no teams / best ball); the team standings never include post-season nights.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const course = { Hole1: 4, Hole2: 5, Hole3: 3, Hole4: 4, Hole5: 4, Hole6: 4, Hole7: 5, Hole8: 4, Hole9: 4, Hole10: 3, Hole11: 5, Hole12: 3, Hole13: 4, Hole14: 4, Hole15: 4, Hole16: 5, Hole17: 4, Hole18: 4 };
[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18].forEach(h => { course['H' + h] = h; });          // stroke index
const backPars = [3, 5, 3, 4, 4, 4, 5, 4, 4];
const scores = {   // date -> rows (Back 9 on 9/29 = Week 1, Front 9 on 10/6 = Week 2)
  20260929: [['Ann', backPars], ['Ben', backPars.map(p => p + 1)], ['Cy', backPars.map(p => p + 2)]],
  20261006: [['Ann', [4, 5, 3, 4, 4, 4, 5, 4, 4].map(p => p + 1)], ['Cy', [4, 5, 3, 4, 4, 4, 5, 4, 4]]],
};
const hdcp = { Ann: 0, Ben: 9, Cy: 0 };
const queries = [];
function row(player, g) { const r = { Player: player }; g.forEach((v, i) => r[String(i + 1)] = v); return r; }
const ctx = vm.createContext({
  console, parseInt, Number, String, Set, Array, Object, Math, isFinite, Number,
  query: (sql, p) => {
    queries.push(sql);
    let m;
    if (/FROM Teams|FROM Subs/.test(sql)) throw new Error('team query in an individual view: ' + sql.slice(0, 40));
    if ((m = sql.match(/SELECT DISTINCT FrontBack FROM Scores WHERE Date=(\d+)/))) return scores[m[1]] ? [{ FrontBack: m[1] === '20260929' ? 'Back' : 'Front' }] : [];
    if (/FROM Courses/.test(sql)) return [course];
    if ((m = sql.match(/FROM Scores WHERE Date=(\d+) AND FrontBack/))) return (scores[m[1]] || []).map(([n, g]) => row(n, g));
    if (/SELECT PHdcp, Hdcp FROM Handicaps/.test(sql)) return [{ PHdcp: hdcp[p[0]], Hdcp: hdcp[p[0]] }];
    return [];
  },
  getSeasonSettings: () => ({ Course: 'X', PostSeasonDt: '9/29/2026' }),
  parsePostSeasonDates: () => ({ week1: 20260929, week2: 20261006 }),
});
['sbfPts', 'sbfColor', 'sbfActualHole', 'sbfStablefordStrokesForHole', 'sbfNetPerHole', 'sbfGetPlayerPhdcp', 'sbfScoreIndividual', 'sbfRankIndividuals', 'sbfExcludePostSeasonDates',
 'sbfPostSeasonDay', 'sbfPostSeasonStandings'].forEach(n => vm.runInContext(extract(n), ctx));
const plain = x => JSON.parse(JSON.stringify(x));

// scoring (same scale as the league Stableford): par = 2, bogey = 1, double bogey+ = 0; net uses the stableford strokes
const day1 = ctx.sbfPostSeasonDay(20260929);
const byName = Object.fromEntries(day1.rows.map(r => [r.player, r]));
assert.strictEqual(day1.fb, 'Back'); assert.deepStrictEqual(Array.from(day1.holeNums), [10, 11, 12, 13, 14, 15, 16, 17, 18]);
assert.strictEqual(byName.Ann.total, 18, 'scratch, par every hole = 9 x 2');
assert.strictEqual(byName.Ben.total, 18, '9 handicap gets a stroke on every hole: gross par+1 = net par');
assert.strictEqual(byName.Cy.total, 0, 'scratch, par+2 every hole = double bogey = 0');
// ranking: highest first, ties share a place
assert.deepStrictEqual(plain(day1.rows.map(r => [r.player, r.rank])), [['Ann', 1], ['Ben', 1], ['Cy', 3]], 'Ann and Ben tie for 1st on Week 1');
assert(!('team' in day1.rows[0]) && !('bbNet' in day1.rows[0]), 'individual rows: no team / best-ball fields');

// post-season standings: Week 1 + Week 2 per player
const st = ctx.sbfPostSeasonStandings(2026);
assert.deepStrictEqual(plain(st.map(r => [r.player, r.w1, r.w2, r.total, r.rank])),
  [['Ann', 18, 9, 27, 1], ['Ben', 18, null, 18, 2], ['Cy', 0, 18, 18, 2]], 'Ann 18+9; Ben only Week 1; Cy 0+18; Ben/Cy tie 2nd');
// the input rows are not mutated by ranking
const rows = [{ player: 'B', total: 5 }, { player: 'A', total: 9 }];
ctx.sbfRankIndividuals(rows); assert.strictEqual(rows[0].player, 'B'); assert(!('rank' in rows[0]));

// team standings never include the post-season nights
assert.deepStrictEqual(plain(ctx.sbfExcludePostSeasonDates([20260915, 20260922, 20260929, 20261006], 2026)), [20260915, 20260922]);
assert(/allPlayedDates = sbfExcludePostSeasonDates\(allPlayedDates, season\)/.test(src), 'loadSfStandings uses it');

// loadStableford: a post-season date goes to the individual view and never queries teams / subs; a regular date still does
const ids = {}; const el = id => ids[id] || (ids[id] = { innerHTML: '', value: '' });
let routed = null;
const lctx = vm.createContext({ db: {}, document: { getElementById: id => id === 'stablefordDate' ? { value: lctx.__date } : el(id) }, getPostSeasonContextForDate: d => d === '20260929' ? { week: 1 } : null,
  renderPostSeasonStableford: (d, w) => { routed = [d, w]; }, query: sql => { if (/FROM Teams|FROM Subs/.test(sql)) lctx.__teamQuery = true; return []; }, getSeasonSettings: () => ({}), sbfGetPlayerPhdcp: () => 0, Object, Number, String, parseInt, Math });
vm.runInContext(extract('loadStableford'), lctx);
lctx.__date = '20260929'; lctx.loadStableford();
assert.deepStrictEqual(routed, ['20260929', 1]); assert(!lctx.__teamQuery, 'no team queries for a post-season date');
routed = null; lctx.__date = '20260915'; try { lctx.loadStableford(); } catch (e) { /* the stubbed regular path may run out of data */ }
assert.strictEqual(routed, null, 'regular dates keep the team best-ball view'); assert(lctx.__teamQuery, 'regular date still builds teams');
assert.strictEqual(ids.stablefordPsBanner.innerHTML, '', 'banner cleared on regular dates');

// rendered HTML: individual table, no team / best-ball wording, standings block present
const rctx = vm.createContext(Object.assign({}, ctx));
const outs = {}; rctx.document = { getElementById: id => outs[id] || (outs[id] = { innerHTML: '' }) };
['sbfPostSeasonDay', 'sbfPostSeasonStandings', 'renderPostSeasonStableford'].forEach(n => vm.runInContext(extract(n), rctx));
rctx.renderPostSeasonStableford('20260929', 1);
const head = outs.stablefordHead.innerHTML, body = outs.stablefordBody.innerHTML, stand = outs.stablefordPsStandings.innerHTML, banner = outs.stablefordPsBanner.innerHTML;
assert(/Pos/.test(head) && /Player/.test(head) && !/Team|BB/.test(head), 'header has Pos/Player, no Team / BB Pts');
assert(!/Best Ball/.test(body) && /Stableford pts/.test(body) && /Ann/.test(body), 'rows are players');
assert(/individual/i.test(banner) && /Week 1/.test(banner));
assert(/Individual Standings 2026/.test(stand) && /Week 1/.test(stand) && /Week 2/.test(stand) && /27/.test(stand));
console.log('ok');
