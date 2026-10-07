// Post season: when tonight's nine is complete for a player, the cursor jumps to the next player's first hole of tonight's nine.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const ctx = vm.createContext({ parseInt });
vm.runInContext(extract('psNineRestartPos'), ctx);
const f = ctx.psNineRestartPos;
// 2026: Week 1 = 9/29 (Back first, so cells 0-8 are holes 10-18), Week 2 = 10/6
assert.strictEqual(f(8, '20260929', 20260929, 20261006), 0, 'Week 1: after the 9th cell (hole 18) go to the next player\'s hole 10');
assert.strictEqual(f(3, '20260929', 20260929, 20261006), -1, 'mid-nine keeps the normal advance');
assert.strictEqual(f(17, '20260929', 20260929, 20261006), -1, 'Week 1 never restarts at the right-hand nine');
assert.strictEqual(f(17, '20261006', 20260929, 20261006), 9, 'Week 2: after the last cell go to the next player\'s first cell of the Week 2 nine');
assert.strictEqual(f(8, '20261006', 20260929, 20261006), -1, 'Week 2 does not restart at the left-hand nine');
assert.strictEqual(f(8, '20260915', 20260929, 20261006), -1, 'regular-season dates are untouched');
const h = extract('onScoreKeydown');
assert(/psNineRestartPos\(cells\.indexOf\(inp\)/.test(h) && /isPostSeasonEntryMode\(\)/.test(h), 'wired into the digit handler, post season only');
assert(/if \(rowInputs\[rowIdx \+ 1\]\) \{\s*focusScoreInput\(rowInputs\[rowIdx \+ 1\]\);/.test(h), 'normal advance is still there');
assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
console.log('ok');
