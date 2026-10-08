// "Mark paid" / "Undo" buttons on the Balance Sheet ledgers and the Award CTP Winners screen.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name, pre = '') {
  const i = src.indexOf(pre + 'function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const calls = []; let officer = true, refreshed = [];
const c = vm.createContext({ Math, parseFloat, parseInt, String, Object, Array, JSON, Number, RegExp, window: {}, isOfficerRole: () => officer,
  doMarkPaid: (...a) => calls.push(['doMarkPaid', ...a]), undoMarkPaid: async (...a) => calls.push(['undoMarkPaid', ...a]),
  markEoyRefundPaid: async (...a) => calls.push(['markEoyRefundPaid', ...a]),
  loadBalanceSheet: () => refreshed.push('balance'), loadCtps: () => refreshed.push('ctp'), renderAwardPrizes: () => refreshed.push('award') });
vm.runInContext("const bsR2 = x => Math.round((parseFloat(x) || 0) * 100) / 100; const bsSum = (a, f) => bsR2((a || []).reduce((t, r) => t + (parseFloat(f ? f(r) : r.amount) || 0), 0));", c);
['bsByDate', 'bsPayersByName', 'bsHoleText'].forEach(n => { const m = src.match(new RegExp('const ' + n + ' = [\\s\\S]*?;\\n')); vm.runInContext(m[0], c); });
['bsMoney', 'bsRunningLedger', 'bsDuesSheet', 'bsEoyLedger', 'bsKittyLedgers', 'bsDateText', 'bsRenderLedger', 'prizeRefresh'].forEach(n => vm.runInContext(extract(n), c));
['prizePay', 'prizeUnpay'].forEach(n => vm.runInContext(extract(n, 'async '), c));
const plain = x => JSON.parse(JSON.stringify(x));
const btn = (html, label) => [...html.matchAll(new RegExp(`<button data-pay="([^"]*)" data-after="(\\w+)"[^>]*>${label}</button>`, 'g'))].map(m => ({ pay: JSON.parse(m[1].replace(/&quot;/g, '"')), after: m[2] }));

// every pool's person rows carry what is needed to pay them
const dues = c.bsDuesSheet({ dues: [], expenses: [], estimates: [], awards: [{ key: 'half1', label: '1st half winners', desc: 'Reg Season Champ-1st half', date: '20261231', rows: [{ player: 'Ann', detail: 'Earned-1st', place: '1st', amount: 60, paid: false, date: '20261231' }] }] });
assert.deepStrictEqual(plain(dues.ledger[0].pay), { player: 'Ann', date: '20261231', desc: 'Reg Season Champ-1st half', detail: 'Earned-1st', amount: 60 });
const eoy = c.bsEoyLedger({ season: 2026, entries: [], transfersIn: [], refunds: [{ id: 7, date: 20260929, player: 'Dan', amount: -10, paid: false }],
  skinWinners: [{ date: 20260929, week: 1, player: 'Tom', hole: '#15', amount: 44, paid: true }], ctpWinners: [{ date: 20261006, week: 2, player: 'Greg', hole: '#8', amount: 25, paid: false }], remainders: [] });
const by = n => eoy.ledger.find(e => e.label.includes(n));
assert.deepStrictEqual(plain(by('Dan').pay), { refundId: 7, season: 2026, player: 'Dan', date: '20260929', desc: 'EOY Skins', detail: 'Refund', amount: 10 });
assert.deepStrictEqual(plain(by('Tom').pay), { player: 'Tom', date: '20260929', desc: 'Skin', detail: '#15', amount: 44 });
assert.deepStrictEqual(plain(by('Greg').pay), { player: 'Greg', date: '20261006', desc: 'CTP', detail: '#8', amount: 25 });
const kit = c.bsKittyLedgers({ skin: { winners: [{ date: 20260414, player: 'Bo', hole: '#3', amount: 8, paid: false }] }, ctp: {} });
assert.deepStrictEqual(plain(kit.skin.ledger[0].pay), { player: 'Bo', date: '20260414', desc: 'Skin', detail: '#3', amount: 8 });

// buttons: Mark paid on owed rows, Undo on paid rows, none for non-officers or rows without a payer
let html = c.bsRenderLedger(eoy.ledger, []);
assert.strictEqual(btn(html, 'Mark paid').length, 2, 'Dan and Greg are owed'); assert.strictEqual(btn(html, 'Undo').length, 1, 'Tom is paid');
assert(btn(html, 'Mark paid').every(b => b.after === 'balance'));
officer = false; html = c.bsRenderLedger(eoy.ledger, []);
assert(!/prizePay|prizeUnpay/.test(html), 'players see no buttons');
officer = true;

(async () => {
  const el = (pay, after) => ({ getAttribute: k => k === 'data-pay' ? JSON.stringify(pay) : after });
  await c.prizePay(el({ player: 'Greg', date: '20261006', desc: 'CTP', detail: '#8', amount: 25 }, 'balance'));
  assert.deepStrictEqual(plain(calls.pop()), ['doMarkPaid', 'Greg', 20261006, 'CTP', '#8', 25], 'Skin/CTP dates stay numeric like the Prize Money tab');
  c.window._afterMarkPaidCallback(); assert.deepStrictEqual(refreshed.pop(), 'balance', 'redraws the screen it was clicked on');
  await c.prizePay(el({ player: 'Ann', date: '20261231', desc: 'League Championship', detail: 'Earned-1st', amount: 60 }, 'award'));
  assert.deepStrictEqual(plain(calls.pop()), ['doMarkPaid', 'Ann', '20261231', 'League Championship', 'Earned-1st', 60], 'season awards keep their text date');
  assert(c.window._emailToastShownDates.has('20261231'), 'no "email results" prompt for a season award');
  await c.prizePay(el({ refundId: 7, season: 2026, player: 'Dan', date: '20260929', desc: 'EOY Skins', detail: 'Refund', amount: 10 }, 'balance'));
  assert.deepStrictEqual(plain(calls.pop()), ['markEoyRefundPaid', 7, 2026]); assert.strictEqual(refreshed.pop(), 'balance');
  await c.prizeUnpay(el({ player: 'Tom', date: '20260929', desc: 'Skin', detail: '#15', amount: 44 }, 'ctp'));
  assert.deepStrictEqual(plain(calls.pop()), ['undoMarkPaid', 'Tom', '20260929', 'Skin', '#15', 44]);
  // CTP screen wiring
  const l = extract('loadCtps');
  assert(/data-after="ctp" onclick="prizePay\(this\)"/.test(l) && /data-after="ctp" onclick="prizeUnpay\(this\)"/.test(l), 'CTP screen has Mark paid / Undo');
  assert(/winner\.datePaid \? ''/.test(l), 'a paid CTP winner cannot be Reset');
  assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
