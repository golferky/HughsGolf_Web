// Versions are compared number by number, so 20261018.10 is newer than 20261018.9 (plain text order says the opposite).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf(') {', i) + 2; for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
const c = vm.createContext({}); vm.runInContext(extract('versionCmp'), c);
assert.strictEqual(c.versionCmp('20261018.10', '20261018.9'), 1);
assert.strictEqual(c.versionCmp('20261018.9', '20261018.10'), -1);
assert.strictEqual(c.versionCmp('20261018.2', '20261018.2'), 0);
assert.strictEqual(c.versionCmp('20261019.1', '20261018.12'), 1);
assert.strictEqual(c.versionCmp('0', '20261018.1'), -1);
assert(!/e\.version > lastSeen|lastSeen >= latestVersion|localeCompare\(a\.version\)/.test(src), 'the What\'s New and changelog code use versionCmp');
console.log('ok');
