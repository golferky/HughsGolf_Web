// My Profile: officers get a "Text me when someone logs in" box (on for the developer unless they turned it off; an admin only once they turn it on).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
const c = vm.createContext({ String }); ['isOfficerLoginTexts', 'loginTextsOn'].forEach(f => vm.runInContext(extract(f), c));
assert.strictEqual(c.isOfficerLoginTexts({ Officer: 'Developer' }) && c.isOfficerLoginTexts({ Officer: 'admin' }) && c.isOfficerLoginTexts({ Officer: 'Secretary' }), true);
assert.strictEqual(c.isOfficerLoginTexts({ Officer: '' }) || c.isOfficerLoginTexts({ Officer: 'Player' }) || c.isOfficerLoginTexts(null), false, 'players do not see the box');
assert.strictEqual(c.loginTextsOn({ Officer: 'Developer', LoginTexts: null }), true, 'developer: on by default');
assert.strictEqual(c.loginTextsOn({ Officer: 'Developer', LoginTexts: 'N' }), false, 'developer: can turn it off');
assert.strictEqual(c.loginTextsOn({ Officer: 'Admin', LoginTexts: null }), false, 'admin: off until turned on');
assert.strictEqual(c.loginTextsOn({ Officer: 'Admin', LoginTexts: 'Y' }), true);
assert(/id="selfLoginTexts"/.test(src) && /\.\.\.\(v\('selfLoginTexts'\) \? \{ loginTexts: v\('selfLoginTexts'\)\.checked \? 'Y' : 'N' \} : \{\}\)/.test(src), 'the box is saved with the profile (only when shown)');
assert(/ensureCol\('Players', 'LoginTexts', 'TEXT'\)/.test(src));
console.log('ok');
