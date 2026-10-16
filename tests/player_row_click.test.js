// Admin > Players: the whole row opens the editor; Edit / Delete are the first column.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
function run(target, selection = '') {
  const edited = [], c = vm.createContext({ editPlayer: n => edited.push(n), window: { getSelection: () => selection }, String });
  vm.runInContext(extract('playerRowClick'), c);
  c.playerRowClick({ target: { closest: sel => (target ? target : null) && (sel.split(',').map(x => x.trim()).includes(target) ? {} : null) } }, 'Pat Example');
  return edited;
}
assert.deepStrictEqual(run('td'), ['Pat Example'], 'a click on a cell edits');
['button', 'a', 'input', 'select', 'textarea', 'label'].forEach(t => assert.deepStrictEqual(run(t), [], t + ' keeps its own job'));
assert.deepStrictEqual(run('td', 'some selected text'), [], 'selecting text does not open the editor');
// wiring: row handler, name still shows scores without opening the editor, buttons are the first column
assert(/tr\.onclick = ev => playerRowClick\(ev, r\.Player\)/.test(src));
assert(/title="Show this player's scores" onclick="event\.stopPropagation\(\);showPlayerScores\(/.test(src));
const head = src.slice(src.indexOf('<table id="playersTable"'), src.indexOf('<tbody id="playersBody">'));
assert(/<thead><tr>\s*<th[^>]*>Actions<\/th>\s*<th[^>]*>Player<\/th>/.test(head), 'Actions is the first header');
const n = src.indexOf('function loadAdminPlayers'), row = src.slice(src.indexOf('tr.innerHTML = `', n), src.indexOf('</td>`;', n));
assert(/^tr\.innerHTML = `\s*<td[^>]*>\s*<button onclick="editPlayer\(/.test(row), 'the Edit / Delete cell comes first in each row');
console.log('ok');
