// Admin > Logging > Usage: a security-level filter (Developers / Admins / Players) next to the Player filter.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name, asyncFn) {
  const i = src.indexOf((asyncFn ? 'async ' : '') + 'function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const players = [{ Player: 'Dev One', Officer: 'Developer' }, { Player: 'Admin One', Officer: 'President' }, { Player: 'Admin Two', Officer: 'Secretary' },
  { Player: 'Player One', Officer: '' }, { Player: "Player O'Neil", Officer: null }, { Player: 'Player Two', Officer: 'Treasurer' }];
const c = vm.createContext({});
vm.runInContext(extract('roleFromOfficerValue') + extract('pvPlayersAtLevel') + extract('pvLevelClause'), c);
const at = l => Array.from(c.pvPlayersAtLevel(l, players));
assert.strictEqual(c.pvPlayersAtLevel('', players), null, 'no level = no filter');
assert.deepStrictEqual(at('developer'), ['Dev One']);
assert.deepStrictEqual(at('admin'), ['Admin One', 'Admin Two'], 'president / secretary are admins, as at login');
assert.deepStrictEqual(at('player'), ['Player One', "Player O'Neil", 'Player Two'], 'everyone else is a player');
assert.strictEqual(c.pvLevelClause(null), '');
assert.strictEqual(c.pvLevelClause([]), 'AND 0', 'empty level matches nothing');
assert.strictEqual(c.pvLevelClause(["Player O'Neil", 'Player One']), "AND Player IN ('Player O''Neil','Player One')", 'names are SQL-escaped');

// loadPageViews applies the level to every query, to the Player dropdown, and drops a stale player selection
const pv = [['Dev One', 'admin'], ['Dev One', 'home'], ['Admin One', 'scorecard'], ['Player One', 'home'], [null, 'home']];
function run(level, player) {
  const seen = [], els = { pvDaysFilter: { value: '30' }, pvLevelFilter: { value: level }, pvPlayerFilter: { value: player, innerHTML: '' } };
  const ctx = vm.createContext({ db: {}, window: { _pageViewBuffer: [] }, parseInt, Date, document: { getElementById: id => els[id] || { innerHTML: '', style: {} }, querySelectorAll: () => [] },
    pvSyncToggleBtn() {}, ADMIN_SECTIONS: [], PV_STATS_VIEWS: [], pvFlush: async () => {}, SERVER_RUN_QUEUE: Promise.resolve(), refreshLiveDbSnapshotForReadOnlyView: async () => {},
    query: sql => { seen.push(sql); if (/FROM Players/.test(sql)) return players; return []; }, console });
  vm.runInContext(extract('roleFromOfficerValue') + extract('pvPlayersAtLevel') + extract('pvLevelClause') + extract('pvTabKey') + extract('pvKnownTabKeys') + extract('pvUnusedKeys') + 'async ' + extract('loadPageViews', true).replace(/^async /, ''), ctx);
  return ctx.loadPageViews().then(() => ({ seen, els }));
}
(async () => {
  let r = await run('admin', '');
  const pvQueries = r.seen.filter(q => /FROM PageViews/.test(q));
  assert(pvQueries.length >= 5, 'summary, by tab, by player, recent and the dropdown all query page views');
  pvQueries.forEach(q => assert(/AND Player IN \('Admin One','Admin Two'\)/.test(q), 'every usage query is limited to admins: ' + q.slice(0, 60)));
  r = await run('', '');
  r.seen.filter(q => /FROM PageViews/.test(q)).forEach(q => assert(!/Player IN \(/.test(q), 'no level = unchanged queries'));
  r = await run('player', 'Dev One');                                   // Gary is a developer, not a player: stale selection is dropped
  assert(!r.seen.some(q => /Player = 'Dev One'/.test(q)), 'a player outside the chosen level is no longer filtered on');
  r = await run('developer', '');
  r.seen.filter(q => /FROM PageViews/.test(q)).forEach(q => assert(/AND Player IN \('Dev One'\)/.test(q)));
  // markup: the Level filter sits between Last and Player with the three levels
  assert(/<select id="pvLevelFilter" onchange="loadPageViews\(\)"/.test(src) && /<option value="developer">Developers<\/option>\s*<option value="admin">Admins<\/option>\s*<option value="player">Players<\/option>/.test(src));
  assert(src.indexOf('id="pvLevelFilter"') < src.indexOf('id="pvPlayerFilter"') && src.indexOf('id="pvDaysFilter"') < src.indexOf('id="pvLevelFilter"'), 'order: Last, Level, Player');
  assert(!/guest/i.test(src.slice(src.indexOf('id="pvLevelFilter"'), src.indexOf('id="pvLevelFilter"') + 500)), 'no guest level (skipped for now)');
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
