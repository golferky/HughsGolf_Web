// The "send week results" checks must work on post-season nights (no Matches rows): expected players = that week's post-season field.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
function counts(date, { ps, field = [], scored = [], matchesPlayed = 0 }) {
  const c = vm.createContext({
    getPostSeasonContextForDate: d => { if (d === 'boom') throw new Error('x'); return ps ? { season: 2026, week: 1 } : null; },
    getEoySkinPlayersForWeek: () => new Set(field),
    query: sql => /FROM Matches/.test(sql) ? [{ c: matchesPlayed }] : scored.map(Player => ({ Player })) });
  vm.runInContext(extract('weekScoreCounts'), c);
  return JSON.parse(JSON.stringify(c.weekScoreCounts(date)));
}
const names = n => Array.from({ length: n }, (_, i) => 'P' + i);
// the reported case: post-season night, 19 scored, no Matches rows -> was "19 of 0", now complete
let r = counts('20260929', { ps: true, field: names(19), scored: names(19), matchesPlayed: 0 });
assert.deepStrictEqual(r, { playedCount: 19, scoredCount: 19, postSeason: true, missing: [] });
assert(r.playedCount > 0 && r.scoredCount >= r.playedCount, 'scores OK');
// a paid-in player with no score yet is still flagged
r = counts('20260929', { ps: true, field: names(21), scored: names(19) });
assert.deepStrictEqual([r.scoredCount, r.playedCount], [19, 21]);
assert.deepStrictEqual(r.missing, ['P19', 'P20'], 'names the paid-in players with no score');
// someone scoring who is not in the field does not hide a missing field player
r = counts('20260929', { ps: true, field: names(20), scored: [...names(19), 'Visitor'] });
assert.deepStrictEqual([r.scoredCount, r.playedCount], [19, 20]);
// nobody in the field: nothing expected, so the check cannot pass
r = counts('20260929', { ps: true, field: [], scored: names(5) });
assert.deepStrictEqual([r.scoredCount, r.playedCount], [0, 0]);
// regular league night: unchanged (match points vs saved scores, no-shows excluded)
r = counts('20260922', { ps: false, matchesPlayed: 18, scored: names(18) });
assert.deepStrictEqual(r, { playedCount: 18, scoredCount: 18, postSeason: false });
r = counts('20260922', { ps: false, matchesPlayed: 18, scored: names(17) });
assert.deepStrictEqual([r.scoredCount, r.playedCount], [17, 18]);
// post-season lookup failure falls back to the league-night rule
r = counts('boom', { ps: false, matchesPlayed: 3, scored: names(3) });
assert.strictEqual(r.postSeason, false);
// wiring: both the send-now check and the ready prompt use it; neither counts Matches directly any more
const body = n => src.slice(src.indexOf('function ' + n + '('), src.indexOf('function ' + n + '(') + 2600);
['checkReadyToSendPdf', 'sendWeekResults'].forEach(n => {
  const b = body(n).split('function ' + n + '(')[1];
  assert(/weekScoreCounts\(date\)/.test(b), n + ' uses the helper');
  assert(!/FROM Matches WHERE CAST\(Date AS INTEGER\)=\$\{date\}[^`]*Points > 0/.test(b.slice(0, 900)), n + ' no longer counts Matches directly');
});
assert(/post-season field/.test(src), 'dialog says "post-season field"');
assert(/no score yet: \$\{\(wk\.missing \|\| \[\]\)\.join\(', '\)\}/.test(src), 'dialog lists who is missing');
console.log('ok');
