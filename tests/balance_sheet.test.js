// Balance Sheet (Admin): League Dues in/out, EOY Skins and post-season CTP pools, regular-season kitties, and the completeness table.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const J = x => JSON.parse(JSON.stringify(x));
const c = vm.createContext({ Math, parseFloat, String, Object, Array, JSON, Number });
vm.runInContext("const bsR2 = x => Math.round((parseFloat(x) || 0) * 100) / 100; const bsSum = (a, f) => bsR2((a || []).reduce((t, r) => t + (parseFloat(f ? f(r) : r.amount) || 0), 0));", c);
['bsMoney', 'bsDuesSheet', 'bsPoolSheet', 'bsKittySheet', 'bsClassifyPayment', 'bsCompleteness', 'bsRenderRows', 'bsDateText', 'bsRenderLedger'].forEach(n => vm.runInContext(extract(n), c));
assert.strictEqual(c.bsMoney(1234.5), '$1,234.50'); assert.strictEqual(c.bsMoney(-20), '($20.00)'); assert.strictEqual(c.bsMoney(0.005 + 0.1), '$0.11'); assert.strictEqual(c.bsMoney(null), '$0.00');

// ── (1) League Dues ──
const dues = Array.from({ length: 24 }, (_, i) => ({ player: 'P' + i, amount: 45 }));              // $1,080 in
const d = {
  dues, expenses: [{ category: 'Food', amount: 300 }, { category: 'Food', amount: 100 }, { category: 'Prizes', amount: 150 }, { category: 'Other', amount: 55.5 }],
  awards: [
    { key: 'half1', label: '1st half winners', rows: [{ player: 'Ann', place: '1st', amount: 60, paid: true }, { player: 'Bob', place: '1st', amount: 60, paid: true }, { player: 'Cy', place: '2nd', amount: 50, paid: false }] },
    { key: 'half2', label: '2nd half winners', rows: [] }, { key: 'champ', label: 'League Championship winners', rows: [{ player: 'Di', place: '1st', amount: 100, paid: false }, { player: 'Ed', place: '2nd', amount: 50, paid: false }] }],
  estimates: [{ key: 'half2', label: '2nd half winners', total: 310 }, { key: 'x', label: 'zero estimate', total: 0 }], rosterUnpaid: ['Zed Late'] };
const s1 = J(c.bsDuesSheet(d));
assert.strictEqual(s1.moneyIn, 1080); assert.strictEqual(s1.expenseTotal, 605.5); assert.deepStrictEqual(s1.byCat, { Food: 400, Prizes: 150, Other: 55.5 });
assert.strictEqual(s1.awardedTotal, 320); assert.strictEqual(s1.paidOut, 120); assert.strictEqual(s1.owed, 200, 'awarded but not marked paid');
assert.strictEqual(s1.afterExpenses, 474.5);                      // 1080 - 605.5
assert.strictEqual(s1.cashOnHand, 354.5);                         // minus prizes already paid
assert.strictEqual(s1.afterAwards, 154.5);                        // minus everything awarded
assert.strictEqual(s1.estimateTotal, 310); assert.strictEqual(s1.projected, -155.5, 'a shortfall shows as negative, not hidden');
const lines = s1.rows.map(r => r.label).join('\n');
assert(/League dues collected \(24 payments\)/.test(lines) && /Expenses \(4 items/.test(lines) && /1st half winners \(awarded\)/.test(lines) && /League Championship winners \(awarded\)/.test(lines));
assert(/2nd half winners \(not awarded yet, estimate\)/.test(lines) && !/zero estimate/.test(lines), 'only real estimates, only for awards not yet made');
assert(!/2nd half winners \(awarded\)/.test(lines), 'an empty award is not listed as awarded');
assert(/Roster players with no dues payment recorded: Zed Late/.test(lines));
assert(s1.rows.find(r => /1st half winners \(awarded\)/.test(r.label)).note === 'paid $120.00, owed $50.00');
const html = c.bsRenderRows(s1.rows);
assert(/\(\$605\.50\)/.test(html) && /\$1,080\.00/.test(html), 'money out shows in parentheses');
assert(!/<script/.test(c.bsRenderRows([{ kind: 'in', label: '<script>x</script>', amount: 1 }])), 'labels are escaped');
// nothing at all: all zeros, no crash
const empty = J(c.bsDuesSheet({})); assert.strictEqual(empty.moneyIn, 0); assert.strictEqual(empty.afterAwards, 0);

// ── the pool as a running ledger: dues in, expenses out, awards move from the pool to a person ──
const lp = J(c.bsDuesSheet({
  dues: [{ player: 'A', amount: 45, date: 20260407 }, { player: 'B', amount: 45, date: 20260407 }, { player: 'C', amount: 45, date: 20260414 }],
  expenses: [{ date: 20260501, category: 'Food', description: 'Pizza', amount: 60 }],
  awards: [{ key: 'champ', label: 'League Championship winners', date: '20261231', rows: [{ player: 'Brad Pierce', place: '1st', amount: 100, paid: false, date: '20261231' }, { player: 'Tom Jennings', place: '2nd', amount: 50, paid: true, date: '20261231' }] }],
  estimates: [{ key: 'half1', label: '1st half winners', total: 310 }] }));
assert.deepStrictEqual(lp.ledger.map(r => [r.date, r.kind, r.amount, r.balance]), [['20260407', 'in', 90, 90], ['20260414', 'in', 45, 135], ['20260501', 'expense', -60, 75], ['20261231', 'award', -100, -25], ['20261231', 'award', -50, -75]],
  'dues grouped by day; each movement shows the pool balance after it');
assert.strictEqual(lp.ledger[0].label, 'Dues collected (2 payments)'); assert.strictEqual(lp.ledger[2].label, 'Expense: Food - Pizza');
assert.strictEqual(lp.ledger[3].label, 'Pool \u2192 Brad Pierce'); assert.strictEqual(lp.ledger[3].detail, 'League Championship winners, 1st');
assert.strictEqual(lp.ledger[3].paid, false); assert.strictEqual(lp.ledger[4].paid, true);
assert.strictEqual(lp.poolBalance, -75, 'pool = dues - expenses - everything awarded'); assert.strictEqual(lp.poolBalance, lp.afterAwards);
assert.strictEqual(lp.cashOnHand, 75 - 50, 'paying a winner is separate from awarding: cash only drops by what was handed over');
assert(!lp.ledger.some(r => /half/.test(r.label)), 'estimates are not taken from the pool until the award is made');
const lh = c.bsRenderLedger(lp.ledger, lp.estimates);
assert(/Pool \u2192 Brad Pierce/.test(lh) && /owed/.test(lh) && /\u2713 paid/.test(lh) && /\(\$100\.00\)/.test(lh) && /04\/07\/2026/.test(lh), 'awards read "Pool -> person" with paid / owed');
assert(/1st half winners \(not awarded yet, not taken from the pool\)/.test(lh) && /\(\$310\.00\)/.test(lh), 'estimates are shown below the ledger, clearly not yet taken');
assert(/Nothing recorded yet/.test(c.bsRenderLedger([], [])));
assert.strictEqual(J(c.bsDuesSheet({})).poolBalance, 0);
assert.strictEqual(c.bsDateText('20261231'), '12/31/2026');

// ── (2) EOY Skins and post-season CTP ──
const week = (n, over) => Object.assign({ week: n, date: n === 1 ? '09/29/2026' : '10/06/2026', nine: n === 1 ? 'Back' : 'Front', potPlayers: 19, fieldPlayers: 20, weekEntry: 10, skinAmt: 7, ctpAmt: 3,
  skinWinners: [{ player: 'A', amount: 44, paid: true }, { player: 'B', amount: 44, paid: false }], ctpWinners: [{ player: 'C', amount: 28, paid: true }, { player: 'D', amount: 28, paid: true }], skinRemainderRecorded: 0 }, over || {});
// 20 entries x 2 weeks x $10 = $400 paid in, nobody refunded
const p = J(c.bsPoolSheet({ entries: { paymentsIn: 400, paymentCount: 20 }, refunds: { issued: 0, paid: 0 }, weeks: [week(1), week(2, { potPlayers: 20, fieldPlayers: 20 })] }));
const w1 = p.weeks[0];
assert.strictEqual(w1.skinPot, 133); assert.strictEqual(w1.ctpPot, 57); assert.strictEqual(w1.skinWon, 88); assert.strictEqual(w1.skinLeft, 45);
assert.strictEqual(w1.ctpWon, 56); assert.strictEqual(w1.ctpLeft, 1, 'the $1 CTP remainder from the screenshot');
assert.strictEqual(w1.held, 10, 'a player paid in but with no score is held, not lost');
assert.strictEqual(w1.total, 200); assert.strictEqual(p.weeks[1].total, 200);
assert.strictEqual(p.netIn, 400); assert.strictEqual(p.accounted, 400); assert.strictEqual(p.difference, 0);
assert(p.rows.some(r => r.kind === 'check-ok' && /accounted for/.test(r.label)));
assert.strictEqual(w1.toRecord, 45, 'skins leftover not yet recorded as a remainder');
// recorded remainder reduces what is left to record
assert.strictEqual(J(c.bsPoolSheet({ entries: { paymentsIn: 400 }, weeks: [week(1, { skinRemainderRecorded: 45 })] })).weeks[0].toRecord, 0);
// refunds and transfers: refunded money leaves the pool; an unexplained difference is flagged
const p2 = J(c.bsPoolSheet({ entries: { paymentsIn: 400, paymentCount: 20, transfersIn: 25 }, refunds: { issued: 20, paid: 10 }, weeks: [week(1, { fieldPlayers: 19 }), week(2, { potPlayers: 19, fieldPlayers: 19 })] }));
assert.strictEqual(p2.refundsOwed, 10); assert.strictEqual(p2.netIn, 405);          // 400 + 25 - 20
assert.strictEqual(p2.accounted, 380); assert.strictEqual(p2.difference, 25, 'the transfer is not explained by the weeks');
assert(p2.rows.some(r => r.kind === 'check-bad'));
const none = J(c.bsPoolSheet({})); assert.strictEqual(none.netIn, 0); assert.strictEqual(none.difference, 0);
assert(J(c.bsPoolSheet({ unassignedPayments: 2 })).rows.some(r => /2 EOY payment\(s\) are not assigned/.test(r.label)));

// ── (3) Skins and CTP kitties ──
const k = J(c.bsKittySheet({ skin: { in: 800, winners: 600, winnersPaid: 550, transfersOut: 20, kittyPayouts: 30, remainderCredit: 5 }, ctp: { in: 400, winners: 330, winnersPaid: 300, transfersOut: 0, kittyPayouts: 10, carryoverHeld: 22 } }));
assert.strictEqual(k.skinBalance, 155);                         // 800 - 600 - 20 - 30 + 5
assert.strictEqual(k.skinPmShows, 185);                         // the Prize Money formula leaves the 30 of payouts in
assert(k.rows.some(r => r.kind === 'check-bad' && /does not subtract Pay-from-Kitty/.test(r.label)), 'the difference is flagged, not hidden');
assert.strictEqual(k.ctpLeft, 60);
const k2 = J(c.bsKittySheet({ skin: { in: 100, winners: 60, winnersPaid: 60, transfersOut: 0, kittyPayouts: 0, remainderCredit: 0 }, ctp: { in: 50, winners: 40, winnersPaid: 40, transfersOut: 0, kittyPayouts: 0, carryoverHeld: 10 } }));
assert(k2.rows.some(r => r.kind === 'check-ok' && /Matches the Skins kitty/.test(r.label)));

// ── completeness: every payment row by type; unknown types flagged ──
const rows = [['League Dues', 'Payment', 'A', 45], ['League Dues', 'Payment', 'B', 45], ['Reg Season Champ-1st half', 'Earned-1st', 'A', 60], ['League Championship', 'Earned-1st', 'A', 100],
  ['EOY Skins', 'Payment', 'A', 20], ['EOY Skins', 'Refund', 'B', -10], ['EOY Skins', 'Skins Kitty Remainder', 'Kitty', 2], ['EOY Skins', 'Pool Transfer', 'Kitty', 5],
  ['Skin', 'Payment', 'A', 2], ['Skin', '#4', 'A', 6], ['CTP', '#12', 'A', 4], ['CTP', 'Carryover3-Front', 'Kitty', 3], ['CTP', 'Kitty Payout', 'A', 3], ['Skin', 'Pool Transfer', 'Kitty', 1],
  ['Skin', 'PS Skin Remainder', 'Kitty', 1], ['Mystery', 'Thing', 'A', 9]].map(([d_, t, p_, e]) => ({ d: d_, t, p: p_, e }));
const comp = J(c.bsCompleteness(rows));
const byType = Object.fromEntries(comp.map(x => [x.type, x]));
assert.strictEqual(byType['League dues paid in'].count, 2); assert.strictEqual(byType['League dues paid in'].total, 90);
assert.strictEqual(byType['Prize awarded from dues'].count, 2); assert.strictEqual(byType['Prize awarded from dues'].total, 160);
assert.strictEqual(byType['EOY refund'].total, -10); assert.strictEqual(byType['CTP carryover record'].on, 'Skins & CTP kitties');
assert.strictEqual(byType['Mystery / Thing'].on, '', 'an unknown type has no sheet'); assert.strictEqual(comp[comp.length - 1].type, 'Mystery / Thing', 'unknown types are listed last');
assert(comp.filter(x => x.on === '').length === 1, 'every known type is on a sheet');
assert.strictEqual(comp.reduce((t, x) => t + x.count, 0), rows.length, 'every row is counted exactly once');

// ── wiring ──
assert(/id="adminBtnBalance"[^>]*>📒 Balance Sheet</.test(src) && /id="adminBalance"/.test(src) && /id="balanceBody"/.test(src) && /id="balanceSeason"/.test(src));
assert(/ADMIN_SECTIONS = \[[^\]]*'balance'/.test(src) && /if \(section==='balance'\)\s+loadBalanceSheet\(\);/.test(src));
assert(/bsDuesSheet\(bsGatherDues\(season\)\)/.test(src) && /Marking a winner paid does not move the pool again/.test(src) && /bsRenderLedger\(dues\.ledger, dues\.estimates\)/.test(src) && /bsPoolSheet\(bsGatherPool\(season\)\)/.test(src) && /bsKittySheet\(bsGatherKitty\(season\)\)/.test(src) && /bsCompleteness\(all\)/.test(src));
const loader = extract('loadBalanceSheet') + extract('bsGatherDues') + extract('bsGatherPool') + extract('bsGatherKitty');
assert(!/serverRun|INSERT|UPDATE |DELETE/.test(loader.replace(/UPDATE/g, '')), 'the Balance Sheet only reads');
assert(/LeagueExpenses/.test(extract('bsGatherDues')), 'expenses come from the Expenses screen table');
assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]) && src.match(/const APP_VERSION = '([^']+)';/)[1] >= '20261007.5');
console.log('ok');
