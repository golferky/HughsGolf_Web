// Gallus Queue: check a round against the scorecard BEFORE importing it.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name, pre = '') {
  const i = src.indexOf(pre + 'function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const plain = x => JSON.parse(JSON.stringify(x));
const calls = []; let sheet = {}, shown = null;
const ctx = vm.createContext({ String, parseInt, Array, JSON, window: {}, escapeHtml: x => String(x), fmtDate: d => d,
  db: { run: (sql, p) => calls.push(['run', p]) }, saveDBToServer: async () => calls.push(['saved']), loadGallusQueue: () => calls.push(['reload']), _hideGallusToast() {}, _processNextImportAllGroup: () => calls.push(['next']),
  isDatePostSeason: d => d === '20261006', query: (sql, p) => { calls.push(['q', sql, p]); const r = sheet[p[0]]; return r ? [r] : []; },
  _doVerifyImport: async players => calls.push(['import', players.map(x => x.resolvedName)]),
  document: { getElementById: id => id === 'gallusPreCheckModal' ? { remove() { calls.push(['modalRemoved']); } } : null, body: { insertAdjacentHTML: (w, h) => { shown = h; } } } });
ctx._gallusVerifyPlayers = [];
['gallusCompareScores', 'gallusPreCheckHtml', 'gallusExistingNine', 'gallusPreCheckCancel'].forEach(n => vm.runInContext(extract(n), ctx));
['_gallusMarkGroupReconciled', 'gallusPreCheckGo', 'gallusPreImportCheck'].forEach(n => vm.runInContext(extract(n, 'async '), ctx));
const P = (name, scores, id = 1) => ({ id, resolvedName: name, gallusName: name, scores, frontBack: 'Front', date: '20260929' });
const four = [4, 4, 5, 3, 4, 4, 4, 3, 5];

// compare: new / same / different (with the holes)
const ex = { Ann: ['4', '4', '5', '3', '4', '4', '4', '3', '5'], Bo: ['4', '5', '5', '3', '4', '4', '4', '3', ''], Cy: null };
const res = ctx.gallusCompareScores([P('Ann', four), P('Bo', four), P('Cy', four)], n => ex[n]);
assert.deepStrictEqual(plain(res.map(r => r.status)), ['same', 'different', 'new']);
assert.deepStrictEqual(plain(res[1].diffs), [{ hole: 2, sheet: 5, gallus: 4 }, { hole: 9, sheet: '—', gallus: 5 }], 'a missing sheet hole counts as a difference');
assert.strictEqual(ctx.gallusCompareScores([P('Dee', four)], () => ['', '', '', '', '', '', '', '', ''])[0].status, 'new', 'an empty row is new');
const html = ctx.gallusPreCheckHtml(res);
assert(/1 new · 1 same · 1 different/.test(html) && /H2: sheet 5 → Gallus 4/.test(html) && /H9: sheet — → Gallus 5/.test(html) && /Same as the sheet/.test(html) && /New — nothing on the sheet/.test(html));
// existing scores come from the database: this player + date (+ the nine in post season)
sheet = { Ann: { 1: 4, 2: 4, 3: 5, 4: 3, 5: 4, 6: 4, 7: 4, 8: 3, 9: 5 } };
assert.deepStrictEqual(plain(ctx.gallusExistingNine('Ann', '20260915', 'Front', false)), [4, 4, 5, 3, 4, 4, 4, 3, 5]); assert.strictEqual(ctx.gallusExistingNine('Zed', '20260915', 'Front', false), null);
assert(/AND FrontBack=\?/.test(calls.find(c => c[0] === 'q')[1]) === false, 'regular night: by date only');
calls.length = 0; ctx.gallusExistingNine('Ann', '20261006', 'Front', true); assert(/AND FrontBack=\?/.test(calls[0][1]) && calls[0][2][2] === 'Front', 'post season: the card\'s nine');

(async () => {
  // all new inside Import All: no pause; a single import always shows the check
  sheet = {}; calls.length = 0; shown = null; ctx.window._importAllBatch = [1];
  await ctx.gallusPreImportCheck([P('Cy', four)]); assert.strictEqual(shown, null); assert(calls.some(c => c[0] === 'import'), 'all new in a batch goes straight through');
  ctx.window._importAllBatch = null; calls.length = 0;
  await ctx.gallusPreImportCheck([P('Cy', four)]); assert(/Check before importing/.test(shown) && /Import the new scores/.test(shown) && !/Overwrite/.test(shown) && !calls.some(c => c[0] === 'import'), 'single import shows the check and writes nothing yet');
  // differences offer keep vs overwrite
  sheet = { Bo: { 1: 4, 2: 5, 3: 5, 4: 3, 5: 4, 6: 4, 7: 4, 8: 3, 9: 5 } };
  await ctx.gallusPreImportCheck([P('Bo', four, 1), P('Cy', four, 2)]);
  assert(/Overwrite with Gallus/.test(shown) && /Keep sheet scores \(import only the new\)/.test(shown) && /Cancel/.test(shown));
  // keep: only the new player is written; overwrite: everyone
  ctx._gallusVerifyPlayers = [P('Bo', four, 1), P('Cy', four, 2)];
  calls.length = 0; await ctx.gallusPreCheckGo('keep'); assert.deepStrictEqual(plain(calls.find(c => c[0] === 'import')[1]), ['Cy']);
  calls.length = 0; await ctx.gallusPreCheckGo('overwrite'); assert.deepStrictEqual(plain(calls.find(c => c[0] === 'import')[1]), ['Bo', 'Cy'], 'overwrite imports both'); assert.strictEqual(ctx.window._gallusSkipOverwriteCheck, false);
  // nothing new: just mark reconciled, no import
  ctx.window._gallusPreCheckResults = ctx.gallusCompareScores([P('Ann', four, 3)], () => ['4', '4', '5', '3', '4', '4', '4', '3', '5']); ctx._gallusVerifyPlayers = [P('Ann', four, 3)];
  calls.length = 0; await ctx.gallusPreCheckGo('keep'); assert(!calls.some(c => c[0] === 'import') && calls.some(c => c[0] === 'run') && calls.some(c => c[0] === 'saved'), 'all same: reconcile only');
  // cancel stops a batch
  ctx.window._importAllBatch = [1, 2]; ctx.gallusPreCheckCancel(); assert.strictEqual(ctx.window._importAllBatch, null);
  // wiring: the queue's Import Round goes through the check
  const imp = extract('importGallusEntry', 'async '); assert(/await gallusPreImportCheck\(_gallusVerifyPlayers\)/.test(imp) && !/await _doVerifyImport\(_gallusVerifyPlayers\)/.test(imp));
  assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
