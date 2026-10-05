// Usage > By Tab also lists tabs / sub-screens with zero views.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const tabs = ['home', 'board', 'admin', 'stats', 'payments'];
const c = vm.createContext({ ADMIN_SECTIONS: ['players', 'sql'], PV_STATS_VIEWS: ['individual', 'h2h'],
  document: { querySelectorAll: () => tabs.map(t => ({ getAttribute: () => t })) } });
['pvTabKey', 'pvKnownTabKeys', 'pvUnusedKeys'].forEach(n => vm.runInContext(extract(n), c));
const J = x => JSON.parse(JSON.stringify(x));
assert.strictEqual(c.pvTabKey('admin', 'players'), 'admin › players');
assert.strictEqual(c.pvTabKey('home', null), 'home');
const known = J(c.pvKnownTabKeys());
assert.deepStrictEqual(known, ['home', 'board', 'admin', 'admin › players', 'admin › sql', 'stats', 'stats › individual', 'stats › h2h', 'payments']);
assert.deepStrictEqual(J(c.pvUnusedKeys(known, ['home', 'admin › players', 'stats › h2h'])), ['board', 'admin', 'admin › sql', 'stats', 'stats › individual', 'payments']);
assert.deepStrictEqual(J(c.pvUnusedKeys(known, known)), [], 'everything used: nothing listed');
assert.deepStrictEqual(J(c.pvUnusedKeys(['a', 'a', 'b'], [])), ['a', 'b'], 'no duplicates');
assert(/Not used \(\$\{unused\.length\}\)/.test(src) && /pvUnusedKeys\(pvKnownTabKeys\(\), usedKeys\)/.test(src), 'wired into loadPageViews');
assert(/const PV_STATS_VIEWS = \['individual', 'rankings', 'leaders', 'h2h'\]/.test(src), 'matches the stats views pvTrack records');
console.log('ok');
