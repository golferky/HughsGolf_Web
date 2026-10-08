// Officers can put a paid winner back to unpaid (Award Prizes and the Prize Money tab).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name, pre = '') {
  const i = src.indexOf(pre + 'function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const calls = [], alerts = [], confirms = [];
let row = { DatePaid: '10/8/2026, 5:11:51 AM' }, role = 'admin', answer = true, cbRan = 0;
const ctx = vm.createContext({
  window: { _afterMarkPaidCallback: null }, document: { getElementById: () => null }, Date, parseFloat, String,
  currentUser: { role: 'admin', name: 'Tester' }, isOfficerRole: () => role === 'admin',
  requireOfficer() { if (role === 'admin') return true; alerts.push('Only an admin can change this.'); return false; },
  query: () => (row ? [row] : []), serverRun: async (sql, p) => { calls.push({ sql, p }); }, SERVER_RUN_QUEUE: Promise.resolve(), saveDBToServer: async () => { calls.push({ saved: 1 }); },
  loadPrizeMoney() {}, alert: t => alerts.push(t), confirm: t => { confirms.push(t); return answer; }, renderAwardPrizes() {},
  escapeHtml: x => String(x), awardIsPaid: r => !!String(r.DatePaid || '').trim(),
});
vm.runInContext(extract('undoMarkPaid', 'async '), ctx); vm.runInContext(extract('awardPayButton'), ctx);
(async () => {
  // confirmed undo clears only the paid date and logs it
  ctx.window._afterMarkPaidCallback = () => cbRan++;
  await ctx.undoMarkPaid('Steve Bailey', '20261231', 'League Championship', 'Earned-3rd', 45);
  const upd = calls.find(c => /^UPDATE Payments SET DatePaid=''/.test(c.sql || ''));
  assert(upd && !/Earned|Player=\?,/.test(upd.sql.split('WHERE')[0]), 'only DatePaid is cleared');
  assert.deepStrictEqual(Array.from(upd.p), ['Steve Bailey', '20261231', 'League Championship', 'Earned-3rd']);
  assert(calls.some(c => /INSERT INTO LogTable/.test(c.sql || '') && /Undid paid/.test(c.p[4])), 'logged');
  assert(calls.some(c => c.saved) && cbRan === 1, 'saved and refreshed');
  // cancel does nothing
  calls.length = 0; answer = false;
  await ctx.undoMarkPaid('Steve Bailey', '20261231', 'League Championship', 'Earned-3rd', 45);
  assert.strictEqual(calls.length, 0, 'cancelled: nothing written');
  // not paid -> message, nothing written
  answer = true; row = { DatePaid: '' };
  await ctx.undoMarkPaid('X', '20261231', 'D', 'T', 1);
  assert.strictEqual(calls.length, 0); assert(/not marked paid/.test(alerts[alerts.length - 1]));
  // non-officer is refused
  row = { DatePaid: 'x' }; role = 'player';
  await ctx.undoMarkPaid('X', '20261231', 'D', 'T', 1);
  assert.strictEqual(calls.length, 0); assert(/Only an admin/.test(alerts[alerts.length - 1]));
  // buttons: officers see Undo on paid rows; players do not
  role = 'admin';
  assert(/Undo paid/.test(ctx.awardPayButton({ Player: 'A', Detail: 'Earned-1st', Earned: 60, DatePaid: 'x' }, 'League Championship', 2026)));
  assert(!/Undo paid/.test(ctx.awardPayButton({ Player: 'A', Detail: 'Earned-1st', Earned: 60, DatePaid: '' }, 'League Championship', 2026)), 'no Undo on unpaid rows');
  role = 'player';
  assert(!/Undo paid/.test(ctx.awardPayButton({ Player: 'A', Detail: 'Earned-1st', Earned: 60, DatePaid: 'x' }, 'League Championship', 2026)), 'players never see Undo');
  assert(/undoMarkPaid\('\$\{safePlayer\}'/.test(src), 'Prize Money tab has Undo paid too');
  assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
