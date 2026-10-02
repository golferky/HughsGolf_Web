// SF Standings grid: sortable columns, "*" on weeks a sub played, click a "*" to see the sub hole by hole.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const plain = x => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------- sorting
const sctx = vm.createContext({ parseInt, String, Math, window: { _sfSort: { key: 'total', dir: 'desc' } } });
vm.runInContext(extract('sfSortRows'), sctx);
const rows = [
  { team: '10', aPlayer: 'Brad', bPlayer: 'Tom', aPts: 370, bPts: 365, total: 457, rank: 3, weeks: { 20260407: 20, 20260414: 23 } },
  { team: '3', aPlayer: 'Geoff', bPlayer: 'Ben', aPts: 368, bPts: 366, total: 473, rank: 1, weeks: { 20260407: 21, 20260414: 20 } },
  { team: '11', aPlayer: 'Jon', bPlayer: 'Jake', aPts: 323, bPts: 301, total: 411, rank: 5, weeks: { 20260407: 12 } },                  // no 04/14 score
  { team: '9', aPlayer: 'Gary', bPlayer: 'Greg', aPts: 372, bPts: 350, total: 464, rank: 2, weeks: { 20260407: 22, 20260414: 26 } },
  { team: '1', aPlayer: '', bPlayer: 'Dan', aPts: 256, bPts: 257, total: 350, rank: 6, weeks: {} },                                      // blank name, no scores
];
const order = (key, dir) => sctx.sfSortRows(rows, key, dir).map(r => r.team);
assert.deepStrictEqual(order('total', 'desc'), ['3', '9', '10', '11', '1']);
assert.deepStrictEqual(order('total', 'asc'), ['1', '11', '10', '9', '3']);
assert.deepStrictEqual(order('team', 'asc'), ['1', '3', '9', '10', '11'], 'team sorts numerically (9 before 10)');
assert.deepStrictEqual(order('team', 'desc'), ['11', '10', '9', '3', '1']);
assert.deepStrictEqual(order('aPlayer', 'asc'), ['10', '9', '3', '11', '1'], 'text sort (Brad, Gary, Geoff, Jon); blank names last');
assert.deepStrictEqual(order('aPlayer', 'desc'), ['11', '3', '9', '10', '1'], 'blank names stay last when descending');
assert.deepStrictEqual(order('bPts', 'desc'), ['3', '10', '9', '11', '1']);
assert.deepStrictEqual(order('aPts', 'desc'), ['9', '10', '3', '11', '1']);
assert.deepStrictEqual(order('rank', 'asc'), ['3', '9', '10', '11', '1'], 'rank column = standings place');
// a week column: blanks (no score that week) always last, in both directions
assert.deepStrictEqual(order('d:20260414', 'desc'), ['9', '10', '3', '11', '1']);
assert.deepStrictEqual(order('d:20260414', 'asc'), ['3', '10', '9', '11', '1']);
assert.deepStrictEqual(order('d:20260407', 'desc'), ['9', '3', '10', '11', '1']);
// sorting never mutates the input and ties keep their order
assert.deepStrictEqual(rows.map(r => r.team), ['10', '3', '11', '9', '1']);
const tie = [{ team: '2', total: 5, weeks: {} }, { team: '1', total: 5, weeks: {} }, { team: '3', total: 5, weeks: {} }];
assert.deepStrictEqual(sctx.sfSortRows(tie, 'total', 'desc').map(r => r.team), ['2', '1', '3']);

// click handling: first click picks a sensible direction, second click flips it
const c = vm.createContext({ window: { _sfSort: { key: 'total', dir: 'desc' }, _sfRowsCtx: null }, console });
vm.runInContext(extract('sfSetSort'), c);
c.sfSetSort('aPlayer'); assert.deepStrictEqual(plain(c.window._sfSort), { key: 'aPlayer', dir: 'asc' }, 'names start A-Z');
c.sfSetSort('aPlayer'); assert.deepStrictEqual(plain(c.window._sfSort), { key: 'aPlayer', dir: 'desc' });
c.sfSetSort('total'); assert.deepStrictEqual(plain(c.window._sfSort), { key: 'total', dir: 'desc' }, 'points start high-to-low');
c.sfSetSort('d:20260407'); assert.deepStrictEqual(plain(c.window._sfSort), { key: 'd:20260407', dir: 'desc' });
c.sfSetSort('team'); assert.strictEqual(c.window._sfSort.dir, 'asc');

// ---------------------------------------------------------------- week cells: * for sub weeks
const w = vm.createContext({ String });
vm.runInContext(extract('sfWeekCellHtml'), w);
const r0 = { team: '3', weeks: { 20260407: 21, 20260414: 20, 20260421: null }, subWeeks: { 20260414: { a: false, b: true } } };
const plainCell = w.sfWeekCellHtml(2026, r0, 20260407);
assert(/>21<\/td>/.test(plainCell) && !/\*/.test(plainCell) && /jumpToStableford\(2026,20260407\)/.test(plainCell), 'no sub: no star, click opens the week as before');
const subCell = w.sfWeekCellHtml(2026, r0, 20260414);
assert(/>20\*<\/td>/.test(subCell), 'a sub week shows the points with a *');
assert(/showSfSubDetail\(2026,20260414,'3'\)/.test(subCell) && !/jumpToStableford/.test(subCell), 'clicking the * opens the sub hole-by-hole');
assert(/A sub played for B/.test(subCell), 'tooltip says which slot');
assert(/A & B/.test(w.sfWeekCellHtml(2026, { team: '1', weeks: { 1: 5 }, subWeeks: { 1: { a: true, b: true } } }, 1)));
assert.strictEqual(w.sfWeekCellHtml(2026, r0, 20260421), '<td style="padding:6px 8px;text-align:center;font-size:12px"></td>', 'no score that week: empty cell');

// ---------------------------------------------------------------- data: sub flags + hole-by-hole detail
const course = { Hole10: 3, Hole11: 5, Hole12: 3, Hole13: 4, Hole14: 4, Hole15: 4, Hole16: 5, Hole17: 4, Hole18: 4 };
for (let h = 1; h <= 18; h++) course['H' + h] = h;
const pars = [3, 5, 3, 4, 4, 4, 5, 4, 4];
const gridRow = (name, g) => { const r = { Player: name }; g.forEach((v, i) => r[String(i + 1)] = v); return r; };
const DATE = 20260414;
const scoreRows = { Geoff: pars, Sam: pars.map(p => p + 1), Ben: pars, Gary: pars, Greg: pars };       // Sam subs for Ben (team 3, grade B)
const fake = vm.createContext({
  console, parseInt, Number, String, Object, Array, Math,
  db: {}, getSeasonSettings: () => ({ Course: 'X' }), fmtDate: String,
  query: (sql, p) => {
    if (/SELECT DISTINCT FrontBack FROM Scores/.test(sql)) return [{ FrontBack: 'Back' }];
    if (/FROM Courses/.test(sql)) return [course];
    if (/FROM Subs WHERE Date=\d+ AND League="Hugh's" AND Team=\?/.test(sql)) return p[0] === '3' ? [{ Player: 'Sam', Grade: 'B' }] : [];
    if (/SELECT Player, Team, Grade FROM Subs/.test(sql)) return [{ Player: 'Sam', Team: '3', Grade: 'B' }];
    if (/SELECT Player, Grade FROM Teams WHERE Year=\d+ AND Team=\?/.test(sql)) return p[0] === '3' ? [{ Player: 'Geoff', Grade: 'A' }, { Player: 'Ben', Grade: 'B' }] : [];
    if (/SELECT Player, Team, Grade FROM Teams/.test(sql)) return [{ Player: 'Geoff', Team: '3', Grade: 'A' }, { Player: 'Ben', Team: '3', Grade: 'B' }, { Player: 'Gary', Team: '9', Grade: 'A' }, { Player: 'Greg', Team: '9', Grade: 'B' }];
    if (/FROM Scores WHERE Date=\d+ AND FrontBack='Back' AND League="Hugh's" AND Player=\?/.test(sql)) return scoreRows[p[0]] ? [gridRow(p[0], scoreRows[p[0]])] : [];
    if (/"1","2","3","4","5","6","7","8","9" FROM Scores WHERE Date=/.test(sql)) return Object.entries(scoreRows).map(([n, g]) => gridRow(n, g));
    if (/FROM Handicaps WHERE Player=\? AND League="Hugh's" AND Date=/.test(sql)) return [{ PHdcp: 0, Hdcp: 0 }];
    return [];
  },
});
['sbfPts', 'sbfColor', 'sbfActualHole', 'sbfStablefordStrokesForHole', 'sbfNetPerHole', 'sbfGetPlayerPhdcp', 'sbfScoreIndividual', 'calcStablefordTeamTotals', 'sbfTeamWeekDetail', 'sfSubDetailHtml']
  .forEach(n => vm.runInContext(extract(n), fake));
const tot = plain(fake.calcStablefordTeamTotals(DATE));
assert.strictEqual(tot['3'].aSub, false); assert.strictEqual(tot['3'].bSub, true, 'team 3: a sub played the B slot');
assert.strictEqual(tot['9'].aSub, false); assert.strictEqual(tot['9'].bSub, false, 'team 9: no subs');
assert.strictEqual(tot['3'].bPlayer, 'Sam', 'existing fields unchanged');

const det = fake.sbfTeamWeekDetail(DATE, '3');
assert.deepStrictEqual(plain(det.players.map(p => [p.slot, p.player, p.forPlayer])), [['B', 'Sam', 'Ben']], 'only the sub is shown, with who he played for');
assert.deepStrictEqual(Array.from(det.holeNums), [10, 11, 12, 13, 14, 15, 16, 17, 18]);
const sam = det.players[0];
assert.deepStrictEqual(Array.from(sam.gross), pars.map(p => p + 1), 'hole-by-hole gross');
assert.strictEqual(sam.total, 9, 'bogey every hole = 9 x 1 pt (scratch)');
assert(sam.pts.every(x => x === 1) && sam.net.every((n, i) => n === pars[i] + 1));
assert.strictEqual(fake.sbfTeamWeekDetail(DATE, '9').players.length, 0, 'a team with no sub has nothing to show');
const html = fake.sfSubDetailHtml(det);
assert(/Sam/.test(html) && /SUB/.test(html) && /for Ben \(B\)/.test(html) && />Gross</.test(html) && />Net</.test(html) && />Pts</.test(html) && /<b>9 pts<\/b>/.test(html), 'sub name, who for, gross/net/pts rows, total');
assert((html.match(/<th[ >]/g) || []).length === 11, 'Hole + 9 holes + Tot');
assert(/No sub detail/.test(fake.sfSubDetailHtml(fake.sbfTeamWeekDetail(DATE, '9'))));

// ---------------------------------------------------------------- rendered grid: sortable headers, fixed rank, stars
const outs = {};
const rctx = vm.createContext({ window: { _sfSort: { key: 'total', dir: 'desc' } }, document: { getElementById: id => outs[id] || (outs[id] = { innerHTML: '' }) }, String, Math, parseInt, fmtDate: d => `${String(d).slice(4, 6)}/${String(d).slice(6, 8)}/${String(d).slice(0, 4)}` });
['sfSortRows', 'sfWeekCellHtml', 'sfRenderStandingsTable'].forEach(n => vm.runInContext(extract(n), rctx));
const g = rows.map(r => ({ ...r, subWeeks: r.team === '3' ? { 20260414: { a: true, b: false } } : {} }));
rctx.sfRenderStandingsTable(2026, [20260407, 20260414], g, 473);
const head = outs.sfStandingsHead.innerHTML, body = outs.sfStandingsBody.innerHTML;
['rank', 'team', 'aPlayer', 'bPlayer', 'aPts', 'bPts', 'total', 'd:20260407', 'd:20260414'].forEach(k => assert(head.includes(`onclick="sfSetSort('${k}')"`), 'sortable header: ' + k));
assert(/Total ▼/.test(head), 'active sort shows an arrow');
assert((body.match(/\d+\*<\/td>/g) || []).length === 1, 'exactly one starred cell');
rctx.window._sfSort = { key: 'team', dir: 'asc' }; rctx.sfRenderStandingsTable(2026, [20260407, 20260414], g, 473);
const teamOrder = [...outs.sfStandingsBody.innerHTML.matchAll(/font-weight:600">(\d+)<\/td>\s*<td style="padding:6px 10px">/g)].map(m => m[1]);
assert.deepStrictEqual(teamOrder, ['1', '3', '9', '10', '11'], 'rows re-ordered by team');
const ranks = [...outs.sfStandingsBody.innerHTML.matchAll(/color:#888;font-size:12px">(\d+)<\/td>/g)].map(m => m[1]);
assert.deepStrictEqual(ranks, ['6', '1', '2', '3', '5'], 'the # column stays the standings place while sorted by team');

// wiring
assert(/id="sfSubDetailModal"/.test(src) && /onclick="closeSfSubDetail\(\)"/.test(src), 'sub detail modal');
assert(/if \(d\.aSub \|\| d\.bSub\) teamTotals\[team\]\.subWeeks\[date\]/.test(src), 'loadSfStandings records sub weeks');
assert(/sfRenderStandingsTable\(season, playedDates, rows, leaderTotal\)/.test(src));
console.log('ok');
