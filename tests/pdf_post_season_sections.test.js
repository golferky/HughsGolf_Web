// The combined PDF drops Matches and Standings on post-season nights and is unchanged otherwise.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
function run(date, ps) {
  const c = vm.createContext({ document: { getElementById: id => id === 'pdfCombinedDate' ? { value: date } : null },
    getPostSeasonContextForDate: d => { if (ps.includes(d)) return { week: 1 }; if (d === 'boom') throw new Error('x'); return null; },
    prepareScoresPdfSection: () => 'scores', prepareStandingsPdfSection: () => 'standings', prepareMatchesPdfSection: () => 'matches', preparePrizeMoneyPdfSection: () => 'prize' });
  ['combinedPdfIsPostSeason', 'combinedPdfReports'].forEach(n => vm.runInContext(extract(n), c));
  return JSON.parse(JSON.stringify(c.combinedPdfReports()));
}
assert.deepStrictEqual(run('20260929', ['20260929', '20261006']), ['scores', 'prize'], 'Week 1');
assert.deepStrictEqual(run('20261006', ['20260929', '20261006']), ['scores', 'prize'], 'Week 2');
assert.deepStrictEqual(run('20260922', ['20260929', '20261006']), ['scores', 'standings', 'matches', 'prize'], 'regular season unchanged');
assert.deepStrictEqual(run('boom', []), ['scores', 'standings', 'matches', 'prize'], 'lookup failure falls back to the full report');
assert.strictEqual((src.match(/combinedPdfReports\(\)/g) || []).length, 3, 'print and email both use it (plus the definition)');
assert(!/const reports = \[prepareScoresPdfSection\(\), prepareStandingsPdfSection/.test(src.replace(/function combinedPdfReports[\s\S]*?\n}\n/, '')), 'no path builds the full list directly');
console.log('ok');
