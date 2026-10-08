// Stats > Individual: the Season dropdown lists only seasons where the selected player has scores.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
let lastSql = '', lastArgs = [], rows = [];
const ctx = vm.createContext({ String, query: (sql, a) => { lastSql = sql; lastArgs = a; return rows; } });
vm.runInContext(extract('statsSeasonsWithScores'), ctx);
rows = [{ y: '2026' }, { y: '2025' }, { y: '2019' }, { y: 'null' }, { y: '' }];
assert.deepStrictEqual(Array.from(ctx.statsSeasonsWithScores('Gary Scudder')), ['2026', '2025', '2019'], 'only 4-digit years, newest first as returned');
assert(/FROM Scores WHERE Player=\?/.test(lastSql) && /Gross > 0/.test(lastSql) && lastArgs[0] === 'Gary Scudder', 'per player, scored rounds only');
assert.deepStrictEqual(Array.from(ctx.statsSeasonsWithScores('')), [], 'no player, no seasons');
const h = extract('loadPlayerStats');
assert(/statsSeasonsWithScores\(player\)/.test(h) && !/FROM Teams WHERE League="Hugh's" ORDER BY Year DESC/.test(h), 'dropdown built from scores, not from Teams years');
assert(/seasonSel\.value = years\.includes\(keep\) \? keep : ''/.test(h), 'selection kept only when still valid');
assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
console.log('ok');
