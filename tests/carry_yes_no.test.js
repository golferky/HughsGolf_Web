// League Settings: "Carry Last Yrs" is a Yes/No choice (no limit on how far back), and older numeric values read correctly.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const ctx = vm.createContext({ String });
vm.runInContext(extract('lsCarryYesNo'), ctx);
const f = ctx.lsCarryYesNo;
['Y', 'y', 'Yes', '1', '2', '3', 1, 3].forEach(v => assert.strictEqual(f(v), 'Y', 'yes for ' + v));
['N', 'n', 'No', '0', 0, '', null, undefined].forEach(v => assert.strictEqual(f(v), 'N', 'no for ' + v));
assert(/\['CarryLastYears','Carry Last Yrs', \[\['Y','Yes'\],\['N','No'\]\]\]/.test(src), 'dropdown is Yes/No');
assert(!/\['CarryLastYears'[^\]]*\['0','1','2','3'\]/.test(src), 'no more 0-3 choices');
assert(/lp\.CarryLastYears = lsCarryYesNo\(lp\.CarryLastYears\)/.test(src), 'loaded value is normalised before the form and the change check');
console.log('ok');
