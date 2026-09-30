// Regression test: a fresh page load must never run financial actions or pop alerts.
//
// Bug: reloading the sandbox showed "No eligible EOY Skins payers found for 2026" on the login screen.
// Trace: page load -> tryAutoLoad() -> onDbLoaded() -> initEntry() (runs BEFORE login) -> buildEntryGrid()
// -> calcEoySkins(season, true) (post-season default date) [and saveSkinWinnersForDate() when a date had scores
// but no winners]. calcEoySkins also alerted even when called "silent".
//
// This test runs the page's real inline script in a vm with a stubbed DOM and a fake SQLite database, performs
// a page load (DOMContentLoaded included), and asserts that nothing financial ran and nothing alerted:
//   A. no database loaded (DB fetch fails)      -> login/no-DB screen
//   B. database loaded, nobody logged in, post-season configured with legacy untagged EOY payments (the bug)
// Run: node tests/startup_no_financial_actions.test.js      (HG_HTML=/path/to/HughsGolf.html to test another copy)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const htmlPath = process.env.HG_HTML || path.join(__dirname, '..', 'HughsGolf.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const main = html.match(/<script>([\s\S]*?)<\/script>/);
assert(main, 'main inline script not found');
const script = main[1];

// ---- Universal fake DOM element: any property/method exists and does nothing harmful.
function makeEl() {
  const store = {};
  return new Proxy(function () {}, {
    get(t, k) {
      if (k in store) return store[k];
      if (k === 'then') return undefined;
      if (k === Symbol.iterator) return () => [][Symbol.iterator]();
      if (typeof k === 'symbol') return k === Symbol.toPrimitive ? () => '' : undefined;
      switch (k) {
        case 'value': case 'innerHTML': case 'textContent': case 'innerText': case 'id': case 'className':
        case 'href': case 'src': case 'type': case 'name': case 'placeholder': return '';
        case 'checked': case 'disabled': case 'hidden': case 'readOnly': return false;
        case 'options': case 'children': case 'childNodes': case 'selectedOptions': case 'files': return [];
        case 'length': return 0;
        case 'style': case 'dataset': return (store[k] = {});
        case 'classList': return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
        case 'parentNode': case 'parentElement': case 'firstChild': case 'lastChild': case 'nextSibling': case 'previousSibling':
        case 'previousElementSibling': case 'nextElementSibling': case 'firstElementChild': case 'lastElementChild': case 'offsetParent': return null;
        case 'offsetWidth': case 'offsetHeight': case 'scrollTop': case 'scrollHeight': case 'clientWidth': case 'clientHeight': return 0;
        default: return () => makeEl();
      }
    },
    set(t, k, v) { store[k] = v; return true; },
    apply() { return makeEl(); },
  });
}

// ---- Scripted fake SQLite: enough rows for a post-season season with LEGACY untagged EOY payments
//      (which PR #2's stricter "assigned week" rule counts as unassigned -> zero eligible payers).
const par = { Name: 'Boone Links' };
for (let i = 1; i <= 18; i++) par['Hole' + i] = [4, 4, 3, 4, 5, 4, 3, 4, 5][(i - 1) % 9];
for (let i = 1; i <= 18; i++) par['HCP' + i] = i;
const seasonRow = { League: "Hugh's", Season: 2026, PostSeasonDt: '9/22/2026', SkinsPS: 7, ClosestPS: 3, EOYSkins: 20,
                    PSWeek1Nine: 'Front', PSWeek2Dt: null, Course: 'Boone Links', Start9: 'F', Cost: 45, Skins: 2, Closest: 1 };
function answer(sql) {
  if (/PRAGMA table_info/.test(sql)) return [];
  if (/sqlite_master/.test(sql)) return [{ name: 'x' }];
  if (/MAX\(Season\)/.test(sql)) return [{ s: 2026 }];
  if (/FROM Courses/.test(sql)) return [par];
  if (/FROM SeasonSettings/.test(sql)) return [seasonRow];
  if (/'EOY Skins'/.test(sql) && /Detail='Payment'/.test(sql)) return [{ ID: 1, Player: 'Ann', Earned: 20, Comment: '', DatePaid: '9/1/2026' }];
  return [];
}
class FakeDatabase {
  prepare(sql) {
    const rows = answer(sql); let i = 0, cur = null;
    return { bind() {}, step() { if (i < rows.length) { cur = rows[i++]; return true; } return false; }, getAsObject() { return cur; }, free() {} };
  }
  run() {} exec() { return []; } export() { return new Uint8Array(8); } getRowsModified() { return 0; } close() {}
}

// ---- Load the page in a vm and record everything financial / user-facing.
async function loadPage({ dbAvailable }) {
  const rec = { alerts: [], confirms: [], prompts: [], serverRun: [], calls: [], errors: [] };
  const els = {};
  const listeners = { DOMContentLoaded: [], load: [] };
  const timers = [];
  const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; };
  const location = { href: 'https://hughsgolf-sandbox.duckdns.org:8446/', hostname: 'hughsgolf-sandbox.duckdns.org', host: 'hughsgolf-sandbox.duckdns.org:8446',
                     protocol: 'https:', port: '8446', search: '', hash: '', pathname: '/', origin: 'https://hughsgolf-sandbox.duckdns.org:8446' };
  const doc = {
    getElementById: id => els[id] || (els[id] = makeEl()),
    querySelector: () => makeEl(), querySelectorAll: () => [], createElement: () => makeEl(), createTextNode: () => makeEl(),
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); }, removeEventListener() {},
    body: makeEl(), head: makeEl(), documentElement: makeEl(), cookie: '', readyState: 'complete', title: '', hidden: false,
    getElementsByClassName: () => [], getElementsByTagName: () => [],
  };
  const jsonResp = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o), arrayBuffer: async () => new ArrayBuffer(8), headers: { get: () => null } });
  const fetchStub = async (url) => {
    const u = String(url);
    if (/HughsGolf(-test[^.]*)?\.db/.test(u)) {
      if (!dbAvailable) return { ok: false, status: 404, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } };
      return jsonResp({});
    }
    if (/save-token/.test(u)) return jsonResp({ ok: true, token: 't' });
    return jsonResp({ ok: true });
  };
  const sandbox = {
    document: doc, location, localStorage: store(), sessionStorage: store(), fetch: fetchStub,
    navigator: { userAgent: 'node-test', platform: 'test', clipboard: {}, maxTouchPoints: 0, onLine: true },
    history: { replaceState() {}, pushState() {} },
    console: { log() {}, info() {}, debug() {}, warn() {}, error: (...a) => rec.errors.push(a.map(String).join(' ')) },
    alert: m => rec.alerts.push(String(m)), confirm: m => { rec.confirms.push(String(m)); return false; }, prompt: m => { rec.prompts.push(String(m)); return null; },
    initSqlJs: async () => ({ Database: FakeDatabase }),
    setTimeout: (fn, ms) => { timers.push({ fn, ms: ms || 0 }); return timers.length; }, clearTimeout() {},
    setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0,
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); }, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    innerWidth: 1200, innerHeight: 800, screen: { width: 1200, height: 800 },
    URLSearchParams, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Promise, Set, Map, JSON, Math, Date, Object, Array, String, Number, parseInt, parseFloat, isNaN,
    Blob: function () {}, FormData: function () {}, Notification: undefined, indexedDB: undefined, atob: s => s, btoa: s => s, crypto: { getRandomValues: a => a, subtle: {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }), open() {}, print() {}, scrollTo() {}, focus() {},
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(script, ctx, { filename: 'HughsGolf.html' });

  // Spy on every financial entry point (function declarations are writable globals).
  const financial = ['calcEoySkins', 'saveSkinWinnersForDate', 'calcSkinWinnersForDate', 'recalcPostSeasonEoyRefunds',
    'issuePostSeasonRefunds', 'refundEoyPayment', 'assignEoyPaymentWeeks', 'quickPayEoySkins', 'showEoyPaymentPrompt',
    'editEoyPayment', 'deleteEoyPayment', 'confirmPayment', 'confirmPaymentForPlayer', 'toggleEntryPaid', 'buildEntryGrid', 'initEntry', 'onDbLoaded'];
  financial.forEach(n => vm.runInContext(`if (typeof ${n} === 'function') { const __o = ${n}; ${n} = function () { __rec(${JSON.stringify(n)}); return __o.apply(this, arguments); }; }`, Object.assign(ctx, { __rec: n => rec.calls.push(n) })));
  vm.runInContext(`{ const __s = serverRun; serverRun = function (sql, p) { __sr(String(sql)); return __s.apply(this, arguments); }; }`, Object.assign(ctx, { __sr: sql => rec.serverRun.push(sql) }));

  // Let the startup promise chain finish, fire DOMContentLoaded/load like a browser, then flush short timers.
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
  await settle();
  for (const fn of [...listeners.DOMContentLoaded, ...listeners.load]) { try { await fn({}); } catch (e) { rec.errors.push('listener: ' + e.message); } }
  await settle();
  for (let round = 0; round < 5 && timers.length; round++) {
    const batch = timers.splice(0).filter(t => t.ms <= 500);
    for (const t of batch) { try { await t.fn(); } catch (e) { rec.errors.push('timer: ' + e.message); } }
    await settle();
  }
  return { rec, ctx, els };
}

const financialCalls = ['calcEoySkins', 'saveSkinWinnersForDate', 'calcSkinWinnersForDate', 'recalcPostSeasonEoyRefunds', 'issuePostSeasonRefunds',
  'refundEoyPayment', 'assignEoyPaymentWeeks', 'quickPayEoySkins', 'showEoyPaymentPrompt', 'editEoyPayment', 'deleteEoyPayment',
  'confirmPayment', 'confirmPaymentForPlayer', 'toggleEntryPaid'];
const paymentWrites = rec => rec.serverRun.filter(sql => /Payments/i.test(sql));
function assertQuiet(name, { rec }) {
  assert.deepStrictEqual(rec.alerts, [], `${name}: no alerts on page load, got: ${rec.alerts.join(' | ')}`);
  assert.deepStrictEqual(rec.confirms, [], `${name}: no confirm dialogs on page load`);
  assert.deepStrictEqual(rec.prompts, [], `${name}: no prompts on page load`);
  assert.deepStrictEqual(rec.calls.filter(c => financialCalls.includes(c)), [], `${name}: no financial function may run on page load`);
  assert.deepStrictEqual(paymentWrites(rec), [], `${name}: no Payments writes on page load`);
}

(async () => {
  // ================= A. No database loaded: login / no-DB screen
  const a = await loadPage({ dbAvailable: false });
  assert.strictEqual(vm.runInContext('typeof db === "undefined" || !db', a.ctx), true, 'A: no database is loaded');
  assertQuiet('A (no DB)', a);

  // ================= B. Database loaded, nobody logged in, post-season + legacy untagged EOY payments (the reported bug)
  const b = await loadPage({ dbAvailable: true });
  assert.strictEqual(vm.runInContext('!!db', b.ctx), true, 'B: the database is loaded');
  assert.strictEqual(vm.runInContext('!currentUser', b.ctx), true, 'B: nobody is logged in (login screen)');
  assert(b.rec.calls.includes('onDbLoaded') && b.rec.calls.includes('initEntry') && b.rec.calls.includes('buildEntryGrid'),
    'B: the startup path (onDbLoaded -> initEntry -> buildEntryGrid) actually ran, so this test exercises the bug');
  assert.strictEqual(vm.runInContext(`document.getElementById('entryDate').value`, b.ctx), '20260922', 'B: default entry date is the post-season date');
  assertQuiet('B (DB loaded, not logged in)', b);

  // ================= C. calcEoySkins itself: silent mode never alerts; explicit (non-silent) use still tells the officer
  vm.runInContext('calcEoySkins(2026, true)', b.ctx);
  assert.deepStrictEqual(b.rec.alerts, [], 'silent calcEoySkins must not alert');
  vm.runInContext('calcEoySkins(2026, false)', b.ctx);
  assert(/No eligible EOY Skins payers found for 2026/.test(b.rec.alerts.join('|')), 'an explicit run still explains why nothing was calculated');

  // ================= D. buildEntryGrid is a pure render: rebuilding it later never calculates payouts either
  b.rec.alerts.length = 0; b.rec.calls.length = 0; b.rec.serverRun.length = 0;
  vm.runInContext('buildEntryGrid()', b.ctx);
  assert.deepStrictEqual(b.rec.calls.filter(c => financialCalls.includes(c)), [], 'D: rebuilding the grid runs no financial function');
  assert.deepStrictEqual(paymentWrites(b.rec), []);
  assert.deepStrictEqual(b.rec.alerts, []);

  // Static guard: the grid builder body has no calls to payout/refund/payment functions at all
  const start = html.indexOf('function buildEntryGrid()');
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  const body = html.slice(start, i + 1).replace(/\/\/.*$/gm, '');
  financialCalls.concat(['calcMatchesForDate']).forEach(n => assert(!new RegExp(`\\b${n}\\(`).test(body), `buildEntryGrid must not call ${n}()`));

  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
