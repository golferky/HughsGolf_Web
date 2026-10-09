// Import Round from Gallus: after the fetch, the round is compared with the scorecard (before it is added to the queue),
// and the import uses the date showing when you confirm.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const els = { gallusFetchCheck: { innerHTML: '' }, gallusSubmitDate: { value: '2026-10-06' }, gallusFrontBackOverride: { value: 'Front' } };
const asked = [];
const ctx = vm.createContext({ String, parseInt, Array, JSON, window: { _pendingGallusImport: { today: '20260929', frontBack: 'Front', players: [{ name: 'Lykes, Robby', scores: [4, 4, 5, 3, 4, 4, 4, 3, 5] }, { name: 'Klute, Steve', scores: [4, 4, 5, 3, 4, 4, 4, 3, 5] }] } },
  document: { getElementById: id => els[id] || null }, escapeHtml: x => String(x), fmtDate: d => d, isDatePostSeason: d => d === '20261006',
  resolveGallusPlayerName: n => ({ 'Lykes, Robby': 'Robby Lykes' }[n] || ''), gallusExistingNine: (name, date, fb, isPS) => { asked.push([name, date, fb, isPS]); return name === 'Robby Lykes' ? ['4', '4', '5', '3', '4', '4', '4', '3', '5'] : null; } });
['gallusDateFromInput', 'gallusCompareScores', 'gallusPreCheckHtml', 'renderGallusFetchCheck'].forEach(n => vm.runInContext(extract(n), ctx));
ctx.renderGallusFetchCheck();
assert.deepStrictEqual(JSON.parse(JSON.stringify(asked[0])), ['Robby Lykes', '20261006', 'Front', true], 'uses the date and nine showing now, resolves the Gallus name, and knows 10/6 is post season');
assert.strictEqual(asked[1][0], 'Klute, Steve', 'an unmatched name falls back to the Gallus name');
const h = els.gallusFetchCheck.innerHTML;
assert(/Compared with the scorecard \(Front 9, 20261006\)/.test(h) && /Same as the sheet/.test(h) && /New — nothing on the sheet/.test(h) && /Nothing conflicts|already on the scorecard|differ/.test(h));
els.gallusSubmitDate.value = '2026-09-29'; ctx.renderGallusFetchCheck(); assert.strictEqual(asked[asked.length - 1][1], '20260929', 'changing the date re-runs the check');
// wiring
assert(/id="gallusSubmitDate" onchange="renderGallusFetchCheck\(\)"/.test(src) && /id="gallusFrontBackOverride" onchange="renderGallusFetchCheck\(\)"/.test(src), 'date and nine changes refresh the check');
assert(/renderGallusFetchCheck\(\);\s*return;/.test(src) && /id="gallusFetchCheck"/.test(src), 'shown right after the fetch');
assert(/window\._pendingGallusImport\.today = _dateNow/.test(src), 'import uses the date showing at confirm time');
assert(/Fetch a round and add it to the Gallus Queue\. Nothing is posted to the scorecard/.test(src), 'modal text says it only queues');
assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
console.log('ok');
