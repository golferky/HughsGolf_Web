// Usage > By Tab: friendly tab names, and a "Not used (0)" list limited to screens that group could actually open.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const labels = { home: 'Home', admin: '⚙ Admin', scorecard: '📝 Scores', noshows: 'Attendance', whatsnew: '📋 Changelog', payments: 'Payments', stats: '📊 Stats' };
const tabs = Object.keys(labels);
const c = vm.createContext({ ADMIN_SECTIONS: ['players', 'sql', 'leaguesettings', 'backups', 'sync', 'pdfs'], PV_STATS_VIEWS: ['individual', 'h2h'],
  PV_DEV_ONLY_SECTIONS: ['leaguesettings', 'backups', 'sql', 'sync'], ADMIN_ONLY_TABS: new Set(['admin', 'payments', 'schedule']),
  document: {
    querySelectorAll: () => tabs.map(t => ({ getAttribute: () => t })),
    querySelector: sel => { const m = sel.match(/data-tab="([^"]+)"/); return m && labels[m[1]] ? { textContent: labels[m[1]] } : null; } } });
['pvTabKey', 'pvTabLabel', 'pvDisplayKey', 'pvKnownTabKeys', 'pvUnusedKeys'].forEach(n => vm.runInContext(extract(n), c));
const J = x => JSON.parse(JSON.stringify(x));
const keys = lvl => J(c.pvKnownTabKeys(lvl)).map(k => c.pvTabKey(k.tab, k.sub));
// friendly names: the header text without its icon; unknown tabs keep their stored name
assert.strictEqual(c.pvTabLabel('scorecard'), 'Scores', "'scorecard' is the Scores tab");
assert.strictEqual(c.pvTabLabel('noshows'), 'Attendance');
assert.strictEqual(c.pvTabLabel('whatsnew'), 'Changelog');
assert.strictEqual(c.pvTabLabel('admin'), 'Admin');
assert.strictEqual(c.pvTabLabel('mystery'), 'mystery');
assert.strictEqual(c.pvDisplayKey('scorecard', null), 'Scores');
assert.strictEqual(c.pvDisplayKey('admin', 'players'), 'Admin › players');
assert.strictEqual(c.pvTabKey('scorecard', null), 'scorecard', 'stored/counted key is unchanged');
// who could open what
const everyone = keys('');
assert(everyone.includes('admin › sql') && everyone.includes('payments') && everyone.includes('stats › h2h'), 'no level: everything');
assert.deepStrictEqual(keys('developer'), everyone, 'developers see everything');
const adm = keys('admin');
assert(adm.includes('admin › players') && adm.includes('admin › pdfs') && adm.includes('payments'), 'admins: admin screens');
['admin › sql', 'admin › leaguesettings', 'admin › backups', 'admin › sync'].forEach(k => assert(!adm.includes(k), 'admins never see developer-only ' + k));
const pl = keys('player');
assert.deepStrictEqual(pl, ['home', 'scorecard', 'noshows', 'whatsnew', 'stats', 'stats › individual', 'stats › h2h'], 'players: no Admin, Payments or Schedule screens at all');
// unused = reachable minus used; no duplicates
assert.deepStrictEqual(J(c.pvUnusedKeys(c.pvKnownTabKeys('player'), ['home', 'stats › h2h'])).map(k => c.pvTabKey(k.tab, k.sub)), ['scorecard', 'noshows', 'whatsnew', 'stats', 'stats › individual']);
assert.deepStrictEqual(J(c.pvUnusedKeys([{ tab: 'a', sub: null }, { tab: 'a', sub: null }], [])).length, 1, 'no duplicates');
assert.deepStrictEqual(J(c.pvUnusedKeys(c.pvKnownTabKeys('player'), pl)), [], 'everything used: nothing listed');
// wiring: used rows and unused rows both use the friendly name; the level comes from the chosen player first, then the Level filter
assert(/barRow\(pvDisplayKey\(r\.Tab, r\.SubNav\), r\.n, tabMax\)/.test(src), 'used rows use the friendly name');
assert(/pvDisplayKey\(k\.tab, k\.sub\)/.test(src) && /pvUnusedKeys\(pvKnownTabKeys\(accessLevel\), usedKeys\)/.test(src));
assert(/selectedPlayer\s*\?\s*roleFromOfficerValue\(query\(`SELECT Officer FROM Players WHERE Player=\?`/.test(src), "a chosen player's own level wins");
assert(/const PV_STATS_VIEWS = \['individual', 'rankings', 'leaders', 'h2h'\]/.test(src), 'matches the stats views pvTrack records');
assert(/PV_DEV_ONLY_SECTIONS = \['leaguesettings', 'backups', 'sql', 'sync'\]/.test(src));
console.log('ok');
