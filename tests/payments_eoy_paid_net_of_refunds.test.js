// Payments tab: the EOY Paid column is net of refunds, and shows the refund so it is visible that one was recorded.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
// rows: [player, Detail, Earned, DatePaid]
const db = [['Ann', 'Payment', 20, '10/1/2026'], ['Ann', 'Refund', -10, ''],                // refund recorded, still owed back
            ['Ben', 'Payment', 20, '10/1/2026'], ['Ben', 'Refund', -10, '10/2/2026'],      // refund already paid back
            ['Cy', 'Payment', 20, '10/1/2026'],                                            // no refund
            ['Dee', 'Payment', 10, '10/1/2026'], ['Dee', 'Refund', -10, '']];              // fully refunded
const c = vm.createContext({ parseFloat, Math, Math,
  query: (sql, p) => {
    const detail = sql.match(/Detail='(\w+)'/)[1]; const unpaidOnly = /COALESCE\(DatePaid,''\)=''/.test(sql);
    assert(/"Desc"='EOY Skins'/.test(sql) && /Date >= \? AND Date < \?/.test(sql), 'scoped to EOY Skins and the season');
    const s = db.filter(r => r[0] === p[0] && r[1] === detail && (!unpaidOnly || r[3] === '')).reduce((a, r) => a + r[2], 0);
    return [{ s }];
  } });
vm.runInContext(extract('eoyPaidSummary') + extract('eoyPaidCellHtml'), c);
const fmtM = v => v === null ? '—' : '$' + parseFloat(v || 0).toFixed(2);
const sum = n => JSON.parse(JSON.stringify(c.eoyPaidSummary(n, "Hugh's", '20260101', '20270101')));

assert.deepStrictEqual(sum('Ann'), { gross: 20, refunded: 10, owed: 10, net: 10 }, 'paid $20, $10 refund recorded and still owed: net $10');
assert.deepStrictEqual(sum('Ben'), { gross: 20, refunded: 10, owed: 0, net: 10 }, 'refund already paid back: net $10, nothing owed');
assert.deepStrictEqual(sum('Cy'), { gross: 20, refunded: 0, owed: 0, net: 20 }, 'no refund: unchanged');
assert.deepStrictEqual(sum('Dee'), { gross: 10, refunded: 10, owed: 10, net: 0 }, 'fully refunded: net $0');

// the cell: net amount, plus the refund breakdown when there is one
assert.strictEqual(c.eoyPaidCellHtml(c.eoyPaidSummary('Cy', "Hugh's", 'a', 'b'), fmtM), '$20.00', 'no refund: plain amount, same as before');
const ann = c.eoyPaidCellHtml(c.eoyPaidSummary('Ann', "Hugh's", 'a', 'b'), fmtM);
assert(/^\$10\.00<div/.test(ann) && /paid \$20\.00 − refund \$10\.00 \(owed\)/.test(ann) && /still owed back/.test(ann), ann);
const ben = c.eoyPaidCellHtml(c.eoyPaidSummary('Ben', "Hugh's", 'a', 'b'), fmtM);
assert(/^\$10\.00<div/.test(ben) && /paid \$20\.00 − refund \$10\.00</.test(ben) && !/owed/.test(ben), 'paid-back refund shows no "owed"');
assert(/^\$0\.00<div/.test(c.eoyPaidCellHtml(c.eoyPaidSummary('Dee', "Hugh's", 'a', 'b'), fmtM)));
assert.strictEqual(c.eoyPaidCellHtml(null, fmtM), '—', 'non-roster players still show a dash');

// wiring: the column, its totals and the recap card all use the net
assert(/const eoy = isRoster \? eoyPaidSummary\(player, league, dFrom, dTo\) : null;/.test(src) && /const eoyPaid = eoy \? eoy\.net : null;/.test(src), 'row EOY Paid = net');
assert(/\$\{eoyPaidCellHtml\(r\.eoy, fmtM\)\}/.test(src), 'cell shows the refund detail');
assert(/a\.eoyPaid \+= \(r\.eoyPaid\|\|0\);/.test(src), 'totals sum the net');
assert(!/Desc='EOY Skins' AND Detail='Payment' AND Date >= \? AND Date < \?`,\[player,league,dFrom,dTo\]\)\[0\]\?\.s\|\|0\) : null;/.test(src), 'old gross-only query is gone from loadPayments');
console.log('ok');
