// Round date list grouped by season: grouping and which season starts open.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
const c = vm.createContext({ String, Array });
['playDateGroupBySeason', 'playDateDefaultSeason'].forEach(f => vm.runInContext(extract(f), c));
const J = x => JSON.parse(JSON.stringify(x));
const opts = ['20271005', '20270928', '20270413', '20261006', '20260922', '20260407', '20250401'].map(date => ({ date, ps: 0 }));
assert.deepStrictEqual(J(c.playDateGroupBySeason(opts)).map(g => [g.year, g.items.length]), [['2027', 3], ['2026', 3], ['2025', 1]], 'one group per season, newest first, order kept');
assert.deepStrictEqual(J(c.playDateGroupBySeason([])), []);
assert.strictEqual(c.playDateDefaultSeason(opts, '20260922', '20261016'), '2026', 'the picked date\'s season');
assert.strictEqual(c.playDateDefaultSeason(opts, '', '20261016'), '2026', 'no pick: the latest date up to today (2027 is still in the future)');
assert.strictEqual(c.playDateDefaultSeason(opts, '', '20270601'), '2027');
assert.strictEqual(c.playDateDefaultSeason(opts, '', '20200101'), '2027', 'nothing before today: the newest season');
assert.strictEqual(c.playDateDefaultSeason([], '', '20261016'), '');
// wiring
assert(/id="playDateBtn"/.test(src) && /id="playDatePanel"/.test(src) && /<select id="playDateSel"[^>]*display:none/.test(src), 'a button and panel in front of the hidden select');
assert(/window\._pdOpts = opts; window\._pdWant = want;/.test(src), 'sync feeds the panel');
console.log('ok');
