// Schedule Builder SIDE row: follow the league rule (start Front in April, swap every month) instead of showing "Front" for blanks.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
function world({ start9 = 'F', startDate = '4/7/2026', stored = {}, scores = {}, psW1 = 'Back', ps = { '20260929': 1, '20261006': 2 } } = {}) {
  const c = vm.createContext({
    getSeasonSettings: () => ({ Start9: start9, StartDate: startDate, PSWeek1Nine: psW1 }),
    getPostSeasonContextForDate: d => ps[String(d)] ? { week: ps[String(d)] } : null,
    query: (sql, args) => {
      const m = sql.match(/Date='?(\d+)/) || sql.match(/Date=(\d+)/);
      const d = m && m[1];
      if (/FROM Scores/.test(sql)) return scores[d] ? [{ FrontBack: scores[d] }] : [];
      if (/FROM Schedule/.test(sql)) return d in stored ? [{ FrontBack: stored[d] }] : [];
      return [];
    } });
  ['getPostSeasonWeek1Nine', 'getScheduledFrontBack', 'scheduleSideFor'].forEach(n => vm.runInContext(extract(n), c));
  return c.scheduleSideFor;
}
// the rule from League Settings: April Front, May Back, June Front, July Back, August Front, September Back
let side = world();
[['20260407', 'Front'], ['20260428', 'Front'], ['20260505', 'Back'], ['20260602', 'Front'], ['20260630', 'Front'], ['20260707', 'Back'], ['20260728', 'Back'],
 ['20260804', 'Front'], ['20260825', 'Front'], ['20260901', 'Back'], ['20260922', 'Back']].forEach(([d, e]) => assert.strictEqual(side(d), e, d));
// Start 9 = Back flips the whole pattern
side = world({ start9: 'B' });
assert.strictEqual(side('20260407'), 'Back'); assert.strictEqual(side('20260505'), 'Front');
// post-season: Week 1 follows PSWeek1Nine (Back here), Week 2 is the other nine
side = world();
assert.strictEqual(side('20260929'), 'Back'); assert.strictEqual(side('20261006'), 'Front');
assert.strictEqual(world({ psW1: 'Front' })('20260929'), 'Front'); assert.strictEqual(world({ psW1: 'Front' })('20261006'), 'Back');
// a nine saved on the Schedule row (clicking the Side cell) wins; a blank/NULL one follows the rule
side = world({ stored: { '20260707': 'Front', '20260804': 'Back', '20260602': null, '20260505': '' } });
assert.strictEqual(side('20260707'), 'Front'); assert.strictEqual(side('20260804'), 'Back');
assert.strictEqual(side('20260602'), 'Front', 'NULL follows the rule'); assert.strictEqual(side('20260505'), 'Back', 'blank follows the rule');
assert.strictEqual(world({ stored: { '20260707': 'B' } })('20260707'), 'Back', "'B' accepted");
// nine already scored for the night is honoured when nothing is saved on the Schedule row
assert.strictEqual(world({ scores: { '20260707': 'Front' } })('20260707'), 'Front');
// wiring: side row (regular + post-season) and both toggles use the helper; no more blank-means-Front
assert(!/FrontBack \|\| 'Front'/.test(src.slice(src.indexOf('function loadScheduleBuilder'), src.indexOf('function loadScheduleBuilder') + 9000)), 'builder no longer defaults blanks to Front');
assert((src.match(/scheduleSideFor\(/g) || []).length >= 5, 'used by both side rows and both toggles');
console.log('ok');
