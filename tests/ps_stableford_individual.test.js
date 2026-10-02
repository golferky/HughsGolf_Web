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
  20260929: [['Ann', backPars], ['Ben', backPars.map(p => p + 1)], ['Cy', backPars.map(p => p + 2)], ['Sam', backPars], ['Eve', backPars], ['Howard Gorman', backPars]],
  20261006: [['Ann', [4, 5, 3, 4, 4, 4, 5, 4, 4].map(p => p + 1)], ['Cy', [4, 5, 3, 4, 4, 4, 5, 4, 4]], ['Sam', [4, 5, 3, 4, 4, 4, 5, 4, 4]], ['Howard Gorman', [4, 5, 3, 4, 4, 4, 5, 4, 4]]],
};
const hdcp = { Ann: 0, Ben: 9, Cy: 0, Sam: 0, Eve: 0, 'Howard Gorman': 0 };
const roster = new Set(['Ann', 'Ben', 'Cy', 'Eve']);          // Sam and Howard Gorman are subs (not on the season roster); Howard is the league-approved CC sub exception
const queries = [];
function row(player, g) { const r = { Player: player }; g.forEach((v, i) => r[String(i + 1)] = v); return r; }
const constLine = name => { const m = src.match(new RegExp(`const ${name} = [^;]*;`)); assert(m, name); return m[0]; };
const ctx = vm.createContext({
  console, parseInt, Number, String, Set, Array, Object, Math, isFinite, Number,
  query: (sql, p) => {
    queries.push(sql);
    let m;
    if (/SELECT 1 FROM Teams WHERE League=\? AND Year=\? AND Player=\?/.test(sql)) return roster.has(p[2]) ? [{ 1: 1 }] : [];     // roster check only
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
vm.runInContext(constLine('SUBS_CC_ELIGIBLE') + constLine('CC_SUB_EXCEPTIONS'), ctx);
['sbfPts', 'sbfColor', 'sbfActualHole', 'sbfStablefordStrokesForHole', 'sbfNetPerHole', 'sbfGetPlayerPhdcp', 'sbfScoreIndividual', 'sbfRankIndividuals', 'sbfExcludePostSeasonDates',
 'isSeasonRosterPlayer', 'isCcSubException', 'ccRosterEligible', 'sbfPostSeasonDay', 'sbfPostSeasonStandings'].forEach(n => vm.runInContext(extract(n), ctx));
const plain = x => JSON.parse(JSON.stringify(x));

// scoring (same scale as the league Stableford): par = 2, bogey = 1, double bogey+ = 0; net uses the stableford strokes
const day1 = ctx.sbfPostSeasonDay(20260929);
const byName = Object.fromEntries(day1.rows.map(r => [r.player, r]));
assert.strictEqual(day1.fb, 'Back'); assert.deepStrictEqual(Array.from(day1.holeNums), [10, 11, 12, 13, 14, 15, 16, 17, 18]);
assert.strictEqual(byName.Ann.total, 18, 'scratch, par every hole = 9 x 2');
assert.strictEqual(byName.Ben.total, 18, '9 handicap gets a stroke on every hole: gross par+1 = net par');
assert.strictEqual(byName.Cy.total, 0, 'scratch, par+2 every hole = double bogey = 0');
// nightly table: ALL players are shown, including the sub, ranked by that night's points (ties share a place)
assert.deepStrictEqual(plain(day1.rows.map(r => [r.player, r.rank, r.isSub])), [['Ann', 1, false], ['Ben', 1, false], ['Eve', 1, false], ['Howard Gorman', 1, true], ['Sam', 1, true], ['Cy', 6, false]],
  'Week 1 shows both subs (tagged), five players tie on 18, Cy 6th');
const day2 = ctx.sbfPostSeasonDay(20261006);
assert.deepStrictEqual(plain(day2.rows.map(r => [r.player, r.total, r.isSub])).sort(), [['Ann', 9, false], ['Cy', 18, false], ['Howard Gorman', 18, true], ['Sam', 18, true]].sort(), 'Week 2 shows the subs too');
assert(!('team' in day1.rows[0]) && !('bbNet' in day1.rows[0]), 'individual rows: no team / best-ball fields');

// AWARD standings: combined Week 1 + Week 2, a score in BOTH weeks needed for a place, subs excluded
const st = ctx.sbfPostSeasonStandings(2026);
assert.deepStrictEqual(plain(st.map(r => [r.player, r.w1, r.w2, r.total, r.rank])),
  [['Howard Gorman', 18, 18, 36, 1], ['Ann', 18, 9, 27, 2], ['Cy', 0, 18, 18, 3], ['Ben', 18, null, 18, null], ['Eve', 18, null, 18, null]],
  'placed: Howard Gorman 18+18=36 (CC sub exception: eligible), Ann 27, Cy 18 (both weeks). Ben and Eve played one week: listed, no place. Sam (ordinary sub) is not in the award');
assert(!st.some(r => r.player === 'Sam'), 'ordinary subs are excluded from the final award standings');
assert(st.find(r => r.player === 'Howard Gorman').rank === 1, 'Howard Gorman, the league-approved sub exception, is eligible and placed');
assert(st.filter(r => r.rank !== null).every(r => r.w1 !== null && r.w2 !== null), 'every placed player has a score in both weeks');
assert(st.filter(r => r.rank === null).every(r => r.w1 === null || r.w2 === null), 'unplaced players are missing a week');
// the ranked players come first, then the unplaced
assert.deepStrictEqual(plain(st.map(r => r.rank === null)), [false, false, false, true, true]);
// a player who scored 0 points in a week still HAS a score for that week (Cy Week 1: all double bogeys)
assert.strictEqual(st.find(r => r.player === 'Cy').w1, 0);
// the combined total is Week 1 + Week 2 (not either week alone); ties among placed players share a place
scores[20261006].push(['Ben', [4, 5, 3, 4, 4, 4, 5, 4, 4].map(p => p + 1)]);      // Ben now has Week 2 = 9 (his handicap 9: bogey = net par = 18)
const st2 = ctx.sbfPostSeasonStandings(2026);
assert.deepStrictEqual(plain(st2.filter(r => r.rank !== null).map(r => [r.player, r.total, r.rank])), [['Ben', 36, 1], ['Howard Gorman', 36, 1], ['Ann', 27, 3], ['Cy', 18, 4]], 'once Ben has both weeks he is placed: 18 + 18, tied with Howard for 1st');
// an ordinary sub who plays both weeks (Sam) still never appears
assert(!st2.some(r => r.player === 'Sam'));
scores[20261006].pop();

// the exception is for 2026 only: in another season Howard Gorman is an ordinary sub and is excluded
{ const c2 = vm.createContext({ ...ctx }); vm.runInContext(constLine('SUBS_CC_ELIGIBLE') + constLine('CC_SUB_EXCEPTIONS') + extract('isSeasonRosterPlayer') + extract('isCcSubException') + extract('ccRosterEligible'), c2);
  assert.strictEqual(c2.ccRosterEligible('Howard Gorman', 2026), true); assert.strictEqual(c2.ccRosterEligible('Howard Gorman', 2027), false); assert.strictEqual(c2.ccRosterEligible('Sam', 2026), false); }
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
assert(/Stableford Award — Individual Standings 2026/.test(stand) && /Week 1/.test(stand) && /Week 2/.test(stand) && /27/.test(stand));
assert(/both<\/b> weeks; subs are not part of the award/.test(stand), 'rules stated');
assert(/No final place yet/.test(stand) && /Ben/.test(stand) && /Eve/.test(stand) && !/Sam/.test(stand), 'one-week players listed unplaced; ordinary sub absent from the award');
assert(/Sam[\s\S]*SUB/.test(body) && /Howard Gorman[\s\S]*SUB/.test(body), 'nightly table still shows the subs, tagged SUB');
assert(/Howard Gorman/.test(stand), 'Howard Gorman is in the award standings');
console.log('ok');
