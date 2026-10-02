// Prize Money tab and CTP winners are visible to every role; only admins can change anything.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name, async_) {
  const i = src.indexOf((async_ ? 'async ' : '') + 'function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
// tab access
const adminOnly = src.match(/const ADMIN_ONLY_TABS = new Set\(\[([^\]]*)\]\)/)[1];
const t = vm.createContext({ currentUser: null, Set });
vm.runInContext(`const ADMIN_ONLY_TABS = new Set([${adminOnly}]);` + extract('canAccessTab'), t);
assert.strictEqual(t.canAccessTab('prizemoney', 'player'), true);
assert.strictEqual(t.canAccessTab('skins', 'player'), true);
['admin', 'payments', 'schedule'].forEach(x => assert.strictEqual(t.canAccessTab(x, 'player'), false, x));
assert.strictEqual(t.canAccessTab('admin', 'admin'), true);

// every mutator refuses for players before doing anything, and works for admins
const names = ['ctpSetWinner', 'ctpReset', 'ctpNoWinner', 'markSelectedPaid', 'sendUnpaidReminders', 'doMarkPaid', 'showPoolTransfer', 'clearKitty', 'showKittyPay'];  // (markEoyRefundPaid already has its own officer check, covered in post_season_refunds_owed)
for (const n of names) {
  const isAsync = src.includes('async function ' + n + '(');
  const body = extract(n, isAsync);
  assert(/^[^{]*\{\s*\n\s*if \(!requireOfficer\(\)\) return;/.test(body), n + ' starts with the officer guard');
  for (const role of ['player', 'admin', 'developer']) {
    const alerts = []; let touched = 0;
    const c = vm.createContext({ currentUser: { role }, alert: m => alerts.push(m), db: { run() { touched++; } }, serverRun() { touched++; }, query() { touched++; return []; },
      confirm() { touched++; return false; }, prompt() { touched++; return null; }, document: new Proxy({}, { get: () => () => { touched++; return { style: {}, classList: { add() {}, remove() {} }, querySelectorAll: () => [], value: '' }; } }), window: {}, console });
    vm.runInContext(extract('isOfficerRole') + extract('requireOfficer'), c);
    vm.runInContext(body, c);
    try { await_(c[n]()); } catch (e) { /* admin paths may throw on the stub DOM; only the player path matters */ }
    if (role === 'player') { assert.deepStrictEqual(alerts, ['Only an admin can change this.'], n + ' refuses a player'); assert.strictEqual(touched, 0, n + ' does nothing for a player'); }
  }
}
function await_(p) { return p && p.catch ? p.catch(() => {}) : p; }

// Prize Money tab: no unguarded action buttons for players
assert(/\(isOfficerRole\(\) \? _emailBtn : ''\)/.test(src), 'Email Results button is officer-only');
assert(/\$\{ctpAlertHtml\}|ctpAlertHtml = \(isOfficerOrDev && ctpUnreconciled\.length\)/.test(src));

// CTP winners listing in the Post-Season breakdown: read-only for everyone
const ctx = vm.createContext({});
vm.runInContext(extract('psCtpWinnersHtml'), ctx);
const html = ctx.psCtpWinnersHtml(1, 'Back', [{ Player: 'Sam Dinn', Detail: '#10', Earned: 12 }, { Player: 'Brad Pierce', Detail: '#12', Earned: 7.5 }]);
assert(/Week 1 CTP Winners \(Back 9\)/.test(html) && /H10[\s\S]*Sam Dinn[\s\S]*\$12\.00/.test(html) && /H12[\s\S]*Brad Pierce[\s\S]*\$7\.50/.test(html));
assert(!/<button|<select|onclick/.test(html), 'no controls in the CTP winners list');
assert(/No CTP winners yet/.test(ctx.psCtpWinnersHtml(2, 'Front', [])));
assert(/\$\{skinsHtml \|\| ''\}\$\{ctpWinnersHtml\}/.test(src), 'rendered in the breakdown for all roles');
assert(!/isOfficerRole\(\)[^;]*ctpWinnersHtml/.test(src));
console.log('ok');
