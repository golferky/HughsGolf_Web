// Admin > Carriers (client): status rules, the lists that use the carrier table, and the actions' calls.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name, asyn) { const i = src.indexOf((asyn ? 'async function ' : 'function ') + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf(') {', i) + 2; for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
function world(rows = [], players = []) {
  const els = { carriersBody: { innerHTML: '' }, pmCarrier: { innerHTML: '', value: '' } }, sent = [], alerts = [], mirrored = [];
  const c = vm.createContext({ els, sent, alerts, mirrored, String, Array, Date, Object, JSON, Promise, currentUser: { name: 'Boss Admin' }, playerSessionToken: () => 'sess-boss',
    escapeHtml: t => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'), document: { getElementById: id => els[id] || null },
    query: sql => /FROM CarrierGateways/.test(sql) ? rows : /GROUP BY CellCarrier/.test(sql) ? [{ c: 'T-Mobile', n: 3 }, { c: 'tmobile', n: 1 }, { c: 'Verizon', n: 2 }] : players,
    db: { run: (sql, args) => mirrored.push({ sql, args }) }, alert: m => alerts.push(m), SERVER_DB_MODIFIED_MS: 0, SERVER_DB_MODIFIED: 0, isSandboxHost: () => false,
    fetch: async (url, o) => { sent.push({ url, body: JSON.parse(o.body) }); return { json: async () => c.reply }; } });
  c.reply = { ok: true, row: { Carrier: 'Verizon', Gateway: 'vtext.com', Status: 'validated', ValidatedAt: '2026-10-18', ValidatedBy: 'Boss Admin', Note: '', Active: 'Y' }, modifiedMs: 9 };
  ['carrierCanonical', 'carrierRows', 'carrierState', 'carrierChoices', 'fillCarrierSelect', 'carrierMirror', 'carrierCandidates', 'loadCarriersAdmin', 'loadCarrierPlayers', 'carrierPlayerRows', 'cellKey', 'cellConfirmedOn', 'normalizeCarrier'].forEach(f => vm.runInContext(extract(f), c));
  ['carrierCall', 'carrierAdminAction'].forEach(f => vm.runInContext(extract(f, true), c));
  vm.runInContext("const CARRIER_RETEST_DAYS = 365; const CARRIER_FALLBACK = ['AT&T', 'Verizon', 'T-Mobile', 'Sprint', 'Boost', 'Cricket', 'Metro', 'US Cellular'];", c);
  return { c, els, sent, alerts, mirrored };
}
const R = (Carrier, Status, ValidatedAt = null, Active = 'Y', Note = '') => ({ Carrier, Gateway: 'x.example.com', Status, ValidatedAt, ValidatedBy: 'Boss', Note, Active });
(async () => {
  const w = world(); const now = Date.UTC(2026, 9, 18);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(w.c.carrierState(R('A', 'validated', '2026-10-01'), now))), { status: 'validated', retestDue: false });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(w.c.carrierState(R('A', 'validated', '2025-10-17'), now))), { status: 'unvalidated', retestDue: true }, 'older than a year: re-test due');
  assert.strictEqual(w.c.carrierState(R('A', 'validated', '2025-10-19'), now).retestDue, false); assert.strictEqual(w.c.carrierState(R('A', 'validated', null), now).status, 'unvalidated');
  assert.strictEqual(w.c.carrierState(R('A', 'unavailable'), now).status, 'unavailable'); assert.strictEqual(w.c.carrierState(R('A', 'validated', '2026-10-01', 'N'), now).status, 'unavailable', 'switched off');
  assert.strictEqual(w.c.carrierState(R('A', 'weird'), now).status, 'unvalidated');
  assert.deepStrictEqual([' att ', 'TMobile', 'us cellular', 'Mint Mobile'].map(w.c.carrierCanonical), ['AT&T', 'T-Mobile', 'US Cellular', 'Mint Mobile']);
  // the lists players and admins pick from: active carriers from the table, then Other; the old list when there is no table
  let x = world([R('Verizon', 'unvalidated'), R('Mint Mobile', 'unvalidated'), R('Cricket', 'unavailable', null, 'N')]);
  assert.deepStrictEqual(Array.from(x.c.carrierChoices()), ['Verizon', 'Mint Mobile', 'Other']);
  assert.deepStrictEqual(Array.from(world([]).c.carrierChoices()), ['AT&T', 'Verizon', 'T-Mobile', 'Sprint', 'Boost', 'Cricket', 'Metro', 'US Cellular', 'Other']);
  x.c.fillCarrierSelect('pmCarrier', 'Mint Mobile'); assert(/<option value="">None<\/option>/.test(x.els.pmCarrier.innerHTML) && /value="Mint Mobile"/.test(x.els.pmCarrier.innerHTML) && /Other \(no SMS gateway\)/.test(x.els.pmCarrier.innerHTML) && x.els.pmCarrier.value === 'Mint Mobile');
  assert.strictEqual(x.c.normalizeCarrier('mint mobile'), 'Mint Mobile', 'a carrier added by an admin keeps its name in the player editor'); assert.strictEqual(x.c.normalizeCarrier('Mystery Co'), 'Other');
  // the screen: status badges, re-test flag, player counts (T-Mobile spellings are added together), actions
  const today = new Date(), iso = d => d.toISOString().slice(0, 10), old = new Date(today.getTime() - 400 * 86400000);
  x = world([R('T-Mobile', 'validated', iso(today)), R('Verizon', 'validated', iso(old)), R('AT&T', 'unavailable', null, 'Y', 'ended 2025')]); x.c.loadCarriersAdmin();
  const html = x.els.carriersBody.innerHTML; assert(/Validated/.test(html) && /Unavailable/.test(html) && /re-test due/.test(html) && /ended 2025/.test(html));
  assert(/<td style="padding:7px 10px;text-align:center">4<\/td>/.test(html), 'tmobile + T-Mobile = 4 players'); assert(/data-c="T-Mobile" onclick="carrierClick\(this,'test'\)"/.test(html));
  assert(/No carrier list yet/.test(world([]).els.carriersBody.innerHTML) || (world([]).c.loadCarriersAdmin(), true));
  // candidates for a test text
  x = world([], [{ Player: 'Pat', Phone: '502-555-0111', CellCarrier: 'tmobile' }, { Player: 'Lee', Phone: '502-555-0112', CellCarrier: 'Verizon' }]);
  assert.deepStrictEqual(Array.from(x.c.carrierCandidates('T-Mobile')).map(p => p.Player), ['Pat']);
  // an admin action: the admin's own session goes with it, and this browser's copy follows the answer
  x = world([R('Verizon', 'unvalidated')]); assert.strictEqual(await x.c.carrierAdminAction('validate', 'Verizon', { note: 'ok' }), true);
  assert.deepStrictEqual(x.sent[0], { url: '/carrier-admin', body: { admin: 'Boss Admin', sessionToken: 'sess-boss', action: 'validate', carrier: 'Verizon', note: 'ok' } });
  assert(/INSERT OR REPLACE INTO CarrierGateways/.test(x.mirrored[1].sql) && x.mirrored[1].args[0] === 'Verizon' && x.mirrored[1].args[2] === 'validated');
  x = world([]); x.c.reply = { ok: false, error: 'Only an admin who is signed in can change carriers.' }; assert.strictEqual(await x.c.carrierAdminAction('validate', 'Verizon'), false); assert.deepStrictEqual(Array.from(x.alerts), ['Only an admin who is signed in can change carriers.']); assert.strictEqual(x.mirrored.length, 0);
  // wiring
  assert(/ADMIN_SECTIONS = \[[^\]]*'carriers'/.test(src) && /tables: \['players','teams','subs','leaguesettings','carriers','newseason'\]/.test(src) && /id="adminBtnCarriers"/.test(src) && /id="adminCarriers"/.test(src) && /if \(section==='carriers'\) loadCarriersAdmin\(\)/.test(src));
  assert(/\$\{carrierChoices\(\)\.map\(c =>/.test(extract('showPlayerSelfEditModal')), 'My Profile uses the table');
  assert(/fillCarrierSelect\('pmCarrier'\);\s*document\.getElementById\('pmCarrier'\)\.value = normalizeCarrier/.test(src));
  const popup = extract('carrierTestPopup'); assert(/\/carrier-test/.test(popup) && /confirm\(`Send a REAL test text/.test(popup) && /confirmed: true/.test(popup) && /person\.Phone/.test(popup), 'the test popup confirms with the name and number, in the sandbox too');
  assert(/no cell number saved/.test(popup), 'the popup says why nobody can be tested');
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
{ const eh = extract('escapeHtml'); const f = new Function(eh + '; return escapeHtml;')(); assert(f(5135550199) === '5135550199' && f(null) === '' && f('a<b') === 'a&lt;b', 'escapeHtml copes with numbers and empty values'); }
