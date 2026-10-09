// Gallus import: no "Confirm Player Names" screen when every name already matches a league player, and no "Collect Payments"
// pop-up when every imported player was already on the scorecard (auto-reconciled).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name, pre = '') {
  const i = src.indexOf(pre + 'function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const league = new Set(['robby lykes', 'steve klute', 'don sullivan']); const calls = [];
const btn = { textContent: '', style: {} };
const ctx = vm.createContext({ String, window: { _pendingGallusImport: {} }, participantSql: () => '1=1', query: (sql, p) => league.has(String(p[0]).toLowerCase()) ? [{}] : [],
  _doGallusImportCommit: async pi => calls.push(['commit', pi.nameOverrides]), showGallusNameRemapModal: () => calls.push(['modal']), document: { querySelector: () => btn } });
vm.runInContext(extract('gallusNameIsConfident'), ctx); vm.runInContext(extract('gallusConfirmNames', 'async '), ctx);
const T = (...n) => ({ players: n.map(name => ({ name })) });
(async () => {
  assert.ok(ctx.gallusNameIsConfident('Robby Lykes') && ctx.gallusNameIsConfident('robby lykes'), 'exact, any case');
  assert.ok(ctx.gallusNameIsConfident('Lykes, Robby') && ctx.gallusNameIsConfident('Lykes Robby'), 'first/last swapped');
  assert.ok(!ctx.gallusNameIsConfident('Lykes') && !ctx.gallusNameIsConfident('Bobby Likes') && !ctx.gallusNameIsConfident(''), 'a last-name guess or no match is not confident');
  await ctx.gallusConfirmNames(T('Robby Lykes', 'Klute, Steve', 'Don Sullivan'));
  assert.deepStrictEqual(calls.map(c => c[0]), ['commit'], 'all names match: import without the confirm screen'); assert.strictEqual(ctx.window._pendingGallusImport, null); assert.strictEqual(btn.style.background, '#6a1b9a');
  calls.length = 0; await ctx.gallusConfirmNames(T('Robby Lykes', 'Steve Klutz'));
  assert.deepStrictEqual(calls.map(c => c[0]), ['modal'], 'one unsure name: the confirm screen still appears');
  // wiring
  assert(/await gallusConfirmNames\(window\._pendingGallusImport\)/.test(src) && !/\n\s*showGallusNameRemapModal\(window\._pendingGallusImport\);\s*\n\s*return;/.test(src), 'the confirm click goes through the check');
  assert(/importedNames\.length > 0 && autoReconciled\.length < importedNames\.length\) \{\s*showGallusPaymentModal/.test(src), 'payment pop-up only when something was not already on the scorecard');
  assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
