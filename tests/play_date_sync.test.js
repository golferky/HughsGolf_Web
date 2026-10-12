// One date for every Play tab: remembered from any date picker, applied to the other Play tabs when they open.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
const mk = (vals, value) => ({ options: vals.map(v => ({ value: v })), value: value ?? vals[0] });
const els = { matchesDate: mk(['20261013', '20261006', '20260929']), skinsDate: mk(['20261006', '20260929']), ctpsDate: mk(['20260922']), stablefordDate: mk(['20261006']),
  hdcpAsOfDate: mk(['', '20261006'], ''), entryDate: mk(['20261013', '20261006'], '20261013') };
const win = {};
const ctx = vm.createContext({ String, Array, window: win, document: { getElementById: id => els[id] || null } });
vm.runInContext("const PLAY_DATE_FOLLOWERS = ['matchesDate', 'skinsDate', 'ctpsDate', 'stablefordDate', 'hdcpAsOfDate']; const PLAY_DATE_SOURCES = [...PLAY_DATE_FOLLOWERS, 'entryDate'];", ctx);
['playDateRemember', 'playDateApply'].forEach(f => vm.runInContext(extract(f), ctx));
// nothing remembered yet: tabs keep their own defaults
assert.strictEqual(ctx.playDateApply('matchesDate'), false); assert.strictEqual(els.matchesDate.value, '20261013');
// a date picked on one tab is applied to the others when it is one of their dates
ctx.playDateRemember('skinsDate', '20261006');
assert.strictEqual(win._playDate, '20261006');
assert.strictEqual(ctx.playDateApply('matchesDate'), true); assert.strictEqual(els.matchesDate.value, '20261006');
assert.strictEqual(ctx.playDateApply('stablefordDate'), true); assert.strictEqual(els.hdcpAsOfDate.value, '');
assert.strictEqual(ctx.playDateApply('hdcpAsOfDate'), true); assert.strictEqual(els.hdcpAsOfDate.value, '20261006');
// a tab that does not have that date keeps its own
assert.strictEqual(ctx.playDateApply('ctpsDate'), false); assert.strictEqual(els.ctpsDate.value, '20260922');
// Score Entry supplies the date but never follows it
ctx.playDateRemember('entryDate', '20261013'); assert.strictEqual(win._playDate, '20261013');
els.entryDate.value = '20261013'; assert.strictEqual(ctx.playDateApply('entryDate'), false); assert.strictEqual(els.entryDate.value, '20261013');
// other controls and bad values are ignored
ctx.playDateRemember('someOtherSelect', '20250101'); assert.strictEqual(win._playDate, '20261013');
ctx.playDateRemember('matchesDate', ''); assert.strictEqual(win._playDate, '20261013');
// Most Recent on Handicaps clears it
ctx.playDateRemember('hdcpAsOfDate', ''); assert.strictEqual(win._playDate, null);
// wiring: every follower's loader applies it before loading; the change listener records it
['matchesDate', 'stablefordDate', 'skinsDate', 'ctpsDate', 'hdcpAsOfDate'].forEach(id => assert(src.includes(`playDateApply('${id}')`), id));
assert(/document\.addEventListener\('change', e => playDateRemember\(e\.target && e\.target\.id, e\.target && e\.target\.value\), true\)/.test(src));
console.log('ok');
