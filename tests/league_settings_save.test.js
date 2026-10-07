// League Settings save: a settings column the database does not have must not make the whole season update fail.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const LS_FIELDS = { money: [['Cost', 'Weekly Cost'], ['Carryover', 'Carryover'], ['ChampPlaces', 'CC # Places'], ['EOY Skins', 'EOY Skins $']], general: [['Format', 'Format'], ['Name', 'League Name']] };
const MID = new Set(['ChampPlaces', 'EOY Skins']);
function run({ seasonEnded = true, columns }) {
  const calls = [], alerts = [];
  const inputs = { Cost: '45', Carryover: '', ChampPlaces: '2', 'EOY Skins': '20', Format: '2 Man', Name: "Hugh's" };
  const c = vm.createContext({ calls, alerts, LS_FIELDS, LS_MID_SEASON_OK: MID, console,
    document: { getElementById: () => ({ value: '2026' }), querySelector: sel => { const m = sel.match(/data-lscol="([^"]+)"/); return m && m[1] in inputs ? { value: inputs[m[1]] } : null; } },
    window: { _lsOriginal: { PostSeasonDt: seasonEnded ? '9/29/2026' : '12/31/2099' } }, Date, isNaN, Set, Object,
    confirmChanges: () => true, query: sql => /PRAGMA table_info\(SeasonSettings\)/.test(sql) ? columns.map(name => ({ name })) : [],
    serverRun: (sql, args) => { calls.push({ sql, args }); }, saveDBToServer() {}, loadLeagueSettings() {}, alert: m => alerts.push(m) });
  vm.runInContext(extract('saveLeagueSettings'), c); c.saveLeagueSettings();
  return { calls, alerts };
}
const season = r => r.calls.find(x => /UPDATE SeasonSettings/.test(x.sql));
// the reported case: the season has ended (every field unlocks) and the database has no Carryover column
let r = run({ columns: ['League', 'Season', 'Cost', 'ChampPlaces', 'EOYSkins'] });
assert(season(r), 'the season update is still sent'); assert(!/Carryover/.test(season(r).sql), 'without the missing column');
assert(/ChampPlaces=\?/.test(season(r).sql) && /Cost=\?/.test(season(r).sql) && /EOYSkins=\?/.test(season(r).sql), 'the rest of the settings are saved, including CC # Places');
assert.deepStrictEqual(JSON.parse(JSON.stringify(season(r).args)), ['45', '2', '20', '2026']);
assert.strictEqual(r.alerts.length, 1); assert(/Carryover/.test(r.alerts[0]) && /no place to store/.test(r.alerts[0]), 'the skipped setting is reported, not hidden');
assert(r.calls.some(x => /UPDATE LeagueSettings/.test(x.sql)), 'league-wide settings are saved as before');
// a database that has the column saves it, and says nothing
r = run({ columns: ['League', 'Season', 'Cost', 'Carryover', 'ChampPlaces', 'EOYSkins'] });
assert(/Carryover=\?/.test(season(r).sql)); assert.strictEqual(r.alerts.length, 0);
// during the season only the mid-season fields are saved (unchanged behaviour)
r = run({ seasonEnded: false, columns: ['League', 'Season', 'Cost', 'ChampPlaces', 'EOYSkins'] });
assert(!/Cost=|Carryover/.test(season(r).sql) && /ChampPlaces=\?/.test(season(r).sql));
// wiring
assert(/keepExisting\(seasonCols, 'SeasonSettings'\)/.test(src) && /PRAGMA table_info\(\$\{table\}\)/.test(src));
assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]) && ((v) => v[0] > '20261007' || (v[0] === '20261007' && +v[1] >= 3))(src.match(/const APP_VERSION = '([^']+)';/)[1].split('.')));
console.log('ok');
