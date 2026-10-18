// Admin > New Season: the setup checklist moved out of Help into its own admin section.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
assert(!/help_newseason/.test(src), 'no longer a Help accordion item');
assert(/ADMIN_SECTIONS = \[[^\]]*'newseason'/.test(src), 'section registered');
assert(/id="adminBtnNewseason"/.test(src) && /id="adminNewseason"/.test(src) && /id="newSeasonBody"/.test(src));
assert(/if \(section==='newseason'\)\s+loadNewSeasonSetup\(\)/.test(src));
assert(/tables: \['players','teams','subs','carriers','newseason'\]/.test(src), 'it is a pill in the Table Maintenance group');
const el = { innerHTML: '' };
const ctx = vm.createContext({ newSeasonFormHtml: () => '<form>', scheduleBuildFormHtml: () => '', document: { getElementById: id => id === 'newSeasonBody' ? el : null } });
['newSeasonSetupHtml', 'loadNewSeasonSetup'].forEach(f => vm.runInContext(extract(f), ctx));
ctx.loadNewSeasonSetup();
assert(el.innerHTML.startsWith('<form>'), 'the start-a-season box comes first');
['Backup the database', 'Set up the new season', 'Review League Settings', 'Check the season schedule', 'Update the player roster', 'Set handicap seeds', 'Check the season schedule', 'Collect dues', 'Verify app access', 'Test score entry', 'Odd number of teams'].forEach(t => assert(el.innerHTML.includes(t), t));
assert((el.innerHTML.match(/<li>/g) || []).length === 9, 'nine steps');
console.log('ok');
