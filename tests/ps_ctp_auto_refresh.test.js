// Post-season CTP amounts follow the week's pot: unpaid rows are brought to floor(players x $3 / par-3 holes) + carryover.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name, pre = '') {
  const i = src.indexOf(pre + 'function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
let rows, writes, players = 17, carry = {}, role = 'admin';
const ctx = vm.createContext({
  parseInt, parseFloat, String, Math, Object, console,
  db: true, currentUser: { role: 'admin', name: 'T' }, isOfficerRole: () => role === 'admin',
  getSeasonSettings: () => ({ PostSeasonDt: '9/29/2026' }),
  parsePostSeasonDates: () => ({ week1: 20260929, week2: 20261006 }),
  getPostSeasonCtpInfo: d => ({ week: d == 20260929 ? 1 : 2, fb: d == 20260929 ? 'Back' : 'Front', payers: Array(players).fill('p'), ctpAmt: 3 }),
  ctpHolesFor: (d, fb) => fb === 'Front' ? [4, 8] : [10, 12],
  ctpCarryoverByHole: () => carry,
  query: (sql, p) => rows.filter(r => r.Date === p[0]),
  serverRun: (sql, p) => { writes.push({ sql, p }); }, SERVER_RUN_QUEUE: Promise.resolve(), saveDBToServer: async () => { writes.push('saved'); },
  logIt() {}, loadCtps() {}, loadPrizeMoney() {}, psTodayInt: () => 20261008,
});
['psCtpExpectedAmounts', 'psCtpAutoRefresh'].forEach(n => vm.runInContext(extract(n), ctx));
vm.runInContext(extract('psCtpAutoAll', 'async '), ctx);
const reset = () => { writes = []; carry = {}; players = 17; role = 'admin';
  rows = [
    { Date: 20261006, ID: 1, Player: 'Howard Gorman', Detail: '#4', Earned: 21, DatePaid: '' },
    { Date: 20261006, ID: 2, Player: 'Greg Lemker', Detail: '#8', Earned: 25, DatePaid: '' },
    { Date: 20260929, ID: 3, Player: 'Brad Pierce', Detail: '#12', Earned: 28, DatePaid: '10/8/2026' },
  ]; };
(async () => {
  reset();
  assert.strictEqual(ctx.psCtpExpectedAmounts(2026, 2).expected[4], 25, '17 x $3 = $51, two holes -> $25');
  assert.strictEqual(ctx.psCtpAutoRefresh(2026, 2, 20261008), 1, 'only Howard changes');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(writes)), [{ sql: 'UPDATE Payments SET Earned=? WHERE rowid=?', p: [25, 1] }]);
  // paid rows are never touched, even when the pot says otherwise
  reset(); players = 19; rows[2].Earned = 20;
  assert.strictEqual(ctx.psCtpAutoRefresh(2026, 1, 20261008), 0); assert.deepStrictEqual(writes, [], 'paid winner untouched');
  // an unpaid winner of week 1 does update
  reset(); players = 19; rows[2].DatePaid = ''; rows[2].Earned = 20;
  assert.strictEqual(ctx.psCtpAutoRefresh(2026, 1, 20261008), 1); assert.deepStrictEqual(JSON.parse(JSON.stringify(writes[0].p)), [28, 3]);
  // future week is left alone
  reset(); assert.strictEqual(ctx.psCtpAutoRefresh(2026, 2, 20261005), 0); assert.deepStrictEqual(writes, []);
  // carryover is added on top
  reset(); carry = { 4: 6 }; rows[0].Earned = 25;
  assert.strictEqual(ctx.psCtpAutoRefresh(2026, 2, 20261008), 1); assert.deepStrictEqual(JSON.parse(JSON.stringify(writes[0].p)), [31, 1], 'hole 4: 25 + 6 carry');
  // a no-winner carryover row follows the pot too
  reset(); rows = [{ Date: 20261006, ID: 9, Player: 'Kitty', Detail: 'Carryover4-Front', Earned: 21, DatePaid: '10/6/2026' }];
  assert.strictEqual(ctx.psCtpAutoRefresh(2026, 2, 20261008), 1); assert.deepStrictEqual(JSON.parse(JSON.stringify(writes[0].p)), [25, 9]);
  // nothing scored -> nothing
  reset(); players = 0; assert.strictEqual(ctx.psCtpAutoRefresh(2026, 2, 20261008), 0);
  // officer-only wrapper saves once, players do nothing
  reset(); await ctx.psCtpAutoAll(2026); assert(writes.includes('saved'), 'saved after changes');
  reset(); role = 'player'; await ctx.psCtpAutoAll(2026); assert.deepStrictEqual(writes, [], 'players never write');
  reset(); rows[0].Earned = 25; await ctx.psCtpAutoAll(2026); assert.deepStrictEqual(writes, [], 'nothing to change: no save');
  assert(/psCtpAutoAll\(season\)\.catch/.test(extract('psSkinAutoAll')), 'runs from the same score / import / refund hook as the Skins');
  assert(/const holes = ctpHolesFor\(date, fb, season\);/.test(extract('loadCtps')) && /ctpCarryoverByHole\(date, season\)/.test(extract('loadCtps')), 'CTP panel uses the shared helpers');
  assert(/psCtpAutoAll\(parseInt\(season\)\)/.test(extract('loadCtps')) && /if \(psInfo\)/.test(extract('loadCtps')), 'opening the CTP screen for a post-season week also refreshes stale amounts');
  assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
