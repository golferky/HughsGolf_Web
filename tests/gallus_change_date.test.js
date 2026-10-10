// Gallus Queue: change the date of a queued round that was imported under the wrong date.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name, pre = '') {
  const i = src.indexOf(pre + 'function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const plain = x => JSON.parse(JSON.stringify(x));
const calls = [], alerts = []; let rows, other = '2026-10-06', modalRemoved = 0, loaded = 0;
const ctx = vm.createContext({ String, parseInt, Date, db: {}, currentUser: { name: 'Tester' }, escapeHtml: x => String(x),
  query: () => rows, alert: t => alerts.push(t), serverRun: async (sql, p) => { calls.push({ sql, p }); }, saveDBToServer: async () => { calls.push('saved'); }, loadGallusQueue: () => { loaded++; },
  document: { getElementById: id => id === 'gallusDateOther' ? { value: other } : id === 'gallusDateModal' ? { remove() { modalRemoved++; } } : null } });
vm.runInContext(extract('gallusDateFromInput'), ctx); vm.runInContext(extract('_saveGallusDate', 'async '), ctx);
assert.strictEqual(ctx.gallusDateFromInput('2026-10-06'), '20261006'); assert.strictEqual(ctx.gallusDateFromInput('20260929'), '20260929'); assert.strictEqual(ctx.gallusDateFromInput(''), ''); assert.strictEqual(ctx.gallusDateFromInput('10/06/2026'), '');
(async () => {
  rows = [{ ID: 5, Date: '20260929', ResolvedName: 'A', ImportedToScores: 0, Reconciled: 0 }, { ID: 6, Date: '20260929', ResolvedName: 'B', ImportedToScores: null, Reconciled: null }];
  await ctx._saveGallusDate('5,6');
  const upd = calls.find(c => c.sql && /^UPDATE GallusImport SET Date=\?/.test(c.sql));
  assert(upd && /WHERE ID IN/.test(upd.sql), 'rows updated by ID');
  assert.deepStrictEqual(plain(upd.p), ['20261006', '5', '6']);
  assert(calls.some(c => c.sql && /INSERT INTO LogTable/.test(c.sql) && /20260929 -> 20261006/.test(c.p[5])), 'logged');
  assert(calls.includes('saved') && loaded === 1 && modalRemoved === 1, 'saved, modal closed, queue redrawn');
  // a reconciled/posted round can be re-dated too (only the queue label moves; Scores are never touched)
  calls.length = 0; rows = [{ ID: 5, Date: '20260922', ResolvedName: 'A', ImportedToScores: 1, Reconciled: 1 }];
  await ctx._saveGallusDate('5');
  const upd2 = calls.find(c => c.sql && /^UPDATE GallusImport SET Date=\?/.test(c.sql));
  assert(upd2 && !/Reconciled/.test(upd2.sql) && !calls.some(c => c.sql && /Scores|Handicaps/.test(c.sql.replace('GallusImport', ''))), 'posted round re-dated, no score writes');
  // same date / bad date: nothing written
  calls.length = 0; rows = [{ ID: 5, Date: '20261006', ResolvedName: 'A', ImportedToScores: 0, Reconciled: 0 }];
  await ctx._saveGallusDate('5'); assert.strictEqual(calls.length, 0, 'unchanged date writes nothing');
  other = ''; await ctx._saveGallusDate('5'); assert.strictEqual(calls.length, 0); assert(/valid date/.test(alerts[alerts.length - 1]));
  // wiring: the pencil sits by the date, only on rounds not yet posted; the editor refuses posted rounds too
  assert(/<span onclick="editGallusDate\('\$\{_safeAllIds\}'\)"[^`]*Change the round date/.test(src), 'pencil next to the date');
  assert(/scores already recorded are not moved or deleted/.test(extract('editGallusDate')));
  assert(/not the date you entered[\s\S]*✏️/.test(src), 'duplicate prompt names the queued date and the pencil');
  assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
