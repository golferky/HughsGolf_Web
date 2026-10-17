// My Profile (client): the form's values go to /update-my-profile with the player's session; this browser's copy follows the server's answer.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name, asyn) { const i = src.indexOf((asyn ? 'async function ' : 'function ') + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
function world({ resp = { ok: true, player: { Email: 'new@example.com', Phone: '859-555-0123', CellCarrier: 'Verizon', EmailStats: 'Y', TextStats: 'N', ContactOK: 'Y', ContactMethod: 'email', BlockSubs: 'N' }, modifiedMs: 5000 }, columns = ['Email', 'Phone', 'CellCarrier', 'EmailStats', 'TextStats', 'ContactOK', 'ContactMethod', 'BlockSubs'] } = {}) {
  const els = { selfEmail: { value: ' new@example.com ' }, selfPhone: { value: '(859) 555-0123' }, selfCarrier: { value: 'Verizon' }, selfEmailStats: { checked: true }, selfTextStats: { checked: false }, selfSaveBtn: { disabled: false } };
  const sent = [], runs = [], alerts = [], toasts = []; let removed = 0;
  const c = vm.createContext({ els, sent, runs, alerts, toasts, Object, JSON, String, Promise, Date,
    document: { getElementById: id => els[id], querySelector: sel => /selfContact/.test(sel) ? { value: 'email' } : null },
    localStorage: { getItem: k => (k === 'hg_session_Pat Example' ? 'sess-pat' : null) }, window: {},
    fetch: async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body), headers: opts.headers }); return { json: async () => resp }; },
    hasDbColumn: (t, col) => t === 'Players' && columns.includes(col), db: { run: (sql, args) => runs.push({ sql, args }) },
    alert: m => alerts.push(m), showToast: (...a) => toasts.push(a), SERVER_DB_MODIFIED_MS: 0, SERVER_DB_MODIFIED: 0 });
  vm.runInContext('const PROFILE_CARRIERS = [];', c);
  vm.runInContext(extract('profileContactChoice') + '\n' + extract('selfProfilePayload') + '\n' + extract('doSelfProfileSave', true), c);
  return { c, els, sent, runs, alerts, toasts, overlay: { remove: () => removed++ }, removed: () => removed };
}
// which sub-contact option is preselected
const w0 = world(); const choice = p => w0.c.profileContactChoice(p);
assert.strictEqual(choice(null), ''); assert.strictEqual(choice({}), ''); assert.strictEqual(choice({ BlockSubs: 'Y', ContactOK: 'Y', ContactMethod: 'email' }), 'none', "don't ask wins");
assert.strictEqual(choice({ ContactOK: 'Y', ContactMethod: 'both' }), 'both'); assert.strictEqual(choice({ ContactOK: 'N', ContactMethod: 'email' }), ''); assert.strictEqual(choice({ ContactOK: 'Y', ContactMethod: 'carrier pigeon' }), '');
(async () => {
  let w = world(); await w.c.doSelfProfileSave(w.overlay, 'Pat Example');
  assert.strictEqual(w.sent.length, 1); assert.strictEqual(w.sent[0].url, '/update-my-profile');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(w.sent[0].body)), { player: 'Pat Example', sessionToken: 'sess-pat', email: 'new@example.com', phone: '(859) 555-0123', carrier: 'Verizon', emailStats: 'Y', textStats: 'N', contact: 'email' });
  assert.strictEqual(w.runs.length, 1); assert(/^UPDATE Players SET Email=\?, Phone=\?, CellCarrier=\?, EmailStats=\?, TextStats=\?, ContactOK=\?, ContactMethod=\?, BlockSubs=\? WHERE Player=\?$/.test(w.runs[0].sql), w.runs[0].sql);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(w.runs[0].args)), ['new@example.com', '859-555-0123', 'Verizon', 'Y', 'N', 'Y', 'email', 'N', 'Pat Example'], "the server's tidied values are what this browser keeps");
  assert.strictEqual(w.removed(), 1, 'the form closes'); assert.strictEqual(w.toasts.length, 1); assert.deepStrictEqual(w.alerts, []);
  // a database copy without the newer columns only gets the ones it has
  w = world({ columns: ['Email', 'Phone', 'CellCarrier'] }); await w.c.doSelfProfileSave(w.overlay, 'Pat Example');
  assert(/SET Email=\?, Phone=\?, CellCarrier=\? WHERE/.test(w.runs[0].sql));
  // the server says no: the message is shown, nothing changes locally, the form stays open and can be tried again
  w = world({ resp: { ok: false, error: 'Please sign in again, then try once more.' } }); await w.c.doSelfProfileSave(w.overlay, 'Pat Example');
  assert.deepStrictEqual(w.alerts, ['Please sign in again, then try once more.']); assert.strictEqual(w.runs.length, 0); assert.strictEqual(w.removed(), 0); assert.strictEqual(w.els.selfSaveBtn.disabled, false);
  // wiring: the modal asks for the stats and sub-request choices, and the old direct database write is gone
  const modal = extract('showPlayerSelfEditModal');
  ['selfEmail', 'selfPhone', 'selfCarrier', 'selfEmailStats', 'selfTextStats', 'selfContact'].forEach(id => assert(modal.includes(id), id));
  assert(!/UPDATE Players SET Email=\?, Phone=\?, CellCarrier=\? WHERE Player=\?', *\n? *\[email/.test(src), 'no client-side direct write');
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
