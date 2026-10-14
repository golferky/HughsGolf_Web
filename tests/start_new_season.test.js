// Admin > New Season: start a season without SQL, and a new season stays editable until its start date.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }

// ── lock rule ──
const lc = vm.createContext({ parseInt, String, isNaN, Date });
['psMdyToInt', 'lsSeasonLocked'].forEach(f => vm.runInContext(extract(f), lc));
const locked = (ss, t) => lc.lsSeasonLocked(ss, t);
const S = { StartDate: '3/1/2027', PostSeasonDt: '9/28/2027' };
assert.strictEqual(locked(S, 20270101), false, 'before the start date everything is editable');
assert.strictEqual(locked(S, 20270301), true, 'locked from the start date');
assert.strictEqual(locked(S, 20270928), true, 'and through post-season week 1');
assert.strictEqual(locked(S, 20270929), false, 'unlocked after the post-season date');
assert.strictEqual(locked({ PostSeasonDt: '9/28/2027' }, 20270601), false, 'no start date yet: still being set up');
assert.strictEqual(locked({ StartDate: '3/1/2027' }, 20270601), true, 'started with no post-season date: stays locked');
assert.strictEqual(locked(null, 20270601), false);

// ── create / remove ──
function world({ seasons = [2026], scoresIn = [], exists = false, confirmOk = true } = {}) {
  const calls = [], alerts = [], audits = [], els = { newSeasonYear: { value: '2027' }, newSeasonFrom: { value: '2026' }, newSeasonCopyTeams: { checked: true }, lsSeason: { innerHTML: 'x' }, teamsSeason: { innerHTML: 'x' } };
  const src2026 = { League: "Hugh's", Season: 2026, Cost: 45, Course: 'Club', Start9: 'F', StartDate: '4/7/2026', EndDate: '9/22/2026', PostSeasonDt: '9/29/2026', PSWeek2Dt: '10/13/2026', Rainouts: 2, Byes: 1, Teams: 12, Extra: 'not a column' };
  const c = vm.createContext({ calls, alerts, audits, parseInt, String, isNaN, Date, Object, Set, JSON, Math, currentUser: { name: 'Pat', role: 'admin' },
    document: { getElementById: id => els[id] || null }, alert: m => alerts.push(m), confirm: m => { c.lastConfirm = m; return confirmOk; },
    query: (sql, args) => {
      if (/PRAGMA table_info\(SeasonSettings\)/.test(sql)) return Object.keys(src2026).filter(k => k !== 'Extra').map(name => ({ name }));
      if (/SELECT 1 FROM SeasonSettings/.test(sql)) return exists ? [{ 1: 1 }] : [];
      if (/SELECT \* FROM SeasonSettings/.test(sql)) return args[0] === 2026 ? [src2026] : [];
      if (/SELECT Season FROM SeasonSettings/.test(sql)) return seasons.map(Season => ({ Season }));
      if (/COUNT\(\*\) AS n FROM SeasonSettings/.test(sql)) return [{ n: seasons.length }];
      const m = sql.match(/FROM (Scores|Matches|Payments)/); if (m) return [{ n: m[1] === 'Scores' && scoresIn.includes(args[0] / 10000 | 0) ? 3 : 0 }];
      return [];
    },
    serverRun: (sql, args) => calls.push({ sql, args }), auditDbChange: (...a) => audits.push(a), saveDBToServer() {}, loadNewSeasonSetup() {} });
  ['psMdyToInt', 'psAddDaysMdy', 'newSeasonIsAdmin', 'seasonRemovable', 'newSeasonRefresh', 'createNewSeason', 'removeNewSeason', 'newSeasonFormHtml'].forEach(f => vm.runInContext(extract(f), c));
  return { c, calls, alerts, audits, els };
}
let w = world(); w.c.createNewSeason();
const ins = w.calls.find(x => /INSERT INTO SeasonSettings/.test(x.sql)), teams = w.calls.find(x => /INSERT INTO Teams/.test(x.sql));
assert(ins && teams, 'season row and teams copied');
const row = {}; ins.sql.match(/\(([^)]*)\) VALUES/)[1].split(',').forEach((c, i) => row[c.replace(/"/g, '')] = ins.args[i]);
assert.strictEqual(row.Season, 2027); assert.strictEqual(row.Cost, 45); assert.strictEqual(row.Teams, 12); assert(!('Extra' in row), 'only real columns');
assert.strictEqual(row.StartDate, '4/6/2027', 'dates move forward 52 weeks (same weekday)'); assert.strictEqual(row.EndDate, '9/21/2027'); assert.strictEqual(row.PostSeasonDt, '9/28/2027');
assert.strictEqual(row.PSWeek2Dt, null); assert.strictEqual(row.Rainouts, 0); assert.strictEqual(row.Byes, 0);
assert.strictEqual(JSON.stringify(teams.args), '[2027,2026]');
assert(w.audits.length === 1 && w.audits[0][0] === 'season_created');
assert(/3.*refresh|Refresh/i.test(w.alerts.join(' ')) || /refresh the page/.test(w.alerts.join(' ')), 'tells the admin what to do next');
assert(/current season right away/.test(w.c.lastConfirm) && /backup/.test(w.c.lastConfirm), 'warns about the switch and the backup');
assert.strictEqual(w.els.lsSeason.innerHTML, '', 'season dropdowns are rebuilt');
w = world(); w.els.newSeasonCopyTeams.checked = false; w.c.createNewSeason(); assert(!w.calls.some(x => /INSERT INTO Teams/.test(x.sql)), 'teams only when asked');
w = world({ exists: true }); w.c.createNewSeason(); assert(!w.calls.length && /already exists/.test(w.alerts[0]), 'no duplicate season');
w = world({ confirmOk: false }); w.c.createNewSeason(); assert(!w.calls.length, 'cancel does nothing');
w = world(); w.els.newSeasonYear.value = 'abc'; w.c.createNewSeason(); assert(!w.calls.length);
w = world(); w.c.currentUser.role = 'player'; w.c.createNewSeason(); assert(!w.calls.length && /Only admins/.test(w.alerts[0]));

// remove: only an empty season, never the only one
w = world({ seasons: [2027, 2026], scoresIn: [2026] }); w.c.removeNewSeason(2027);
assert(w.calls.length === 2 && /DELETE FROM Teams/.test(w.calls[0].sql) && /DELETE FROM SeasonSettings/.test(w.calls[1].sql) && w.audits[0][0] === 'season_removed');
w = world({ seasons: [2027, 2026], scoresIn: [2026] }); w.c.removeNewSeason(2026); assert(!w.calls.length && /cannot be removed/.test(w.alerts[0]), 'a season with scores is kept');
w = world({ seasons: [2026] }); w.c.removeNewSeason(2026); assert(!w.calls.length && /only season/.test(w.alerts[0]));
// the form offers Remove only for empty seasons, and defaults to the next year
w = world({ seasons: [2027, 2026], scoresIn: [2026] }); const html = w.c.newSeasonFormHtml();
assert(/value="2028"/.test(html) && /Remove 2027/.test(html) && !/Remove 2026/.test(html));
assert(!/Remove/.test(world({ seasons: [2026] }).c.newSeasonFormHtml()), 'one season: nothing to remove');
console.log('ok');
