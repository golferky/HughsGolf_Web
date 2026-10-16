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

// ── 2nd Tuesday of April ──
const sta = vm.createContext({ Date, String, Math }); vm.runInContext(extract('leagueSeasonStart', 'leagueStartWeekLabel', 'leagueDayLabel'), sta);
assert.strictEqual(sta.leagueSeasonStart(2027), '4/13/2027', 'Tuesday and the 2nd when the settings are empty'); assert.strictEqual(sta.leagueSeasonStart(2027, 'Thursday', '2nd'), '4/8/2027'); assert.strictEqual(sta.leagueSeasonStart(2027, 'nonsense', 'nonsense'), '4/13/2027');
// Start Week: 1st / 2nd / 3rd / 4th / Last (Tuesdays in April 2027: 6, 13, 20, 27; 2026: 7, 14, 21, 28; 2029: 3, 10, 17, 24)
[['1st', '4/6/2027'], ['2nd', '4/13/2027'], ['3rd', '4/20/2027'], ['4th', '4/27/2027'], ['Last', '4/27/2027'], ['last', '4/27/2027']].forEach(([w, d]) => assert.strictEqual(sta.leagueSeasonStart(2027, 'Tuesday', w), d, w));
assert.strictEqual(sta.leagueSeasonStart(2026, 'Tuesday', 'Last'), '4/28/2026'); assert.strictEqual(sta.leagueSeasonStart(2029, 'Tuesday', 'Last'), '4/24/2029'); assert.strictEqual(sta.leagueSeasonStart(2029, 'Tuesday', '1st'), '4/3/2029');
assert.strictEqual(sta.leagueSeasonStart(2027, 'Thursday', 'Last'), '4/29/2027');
[[2026, '4/14/2026'], [2027, '4/13/2027'], [2028, '4/11/2028'], [2029, '4/10/2029'], [2030, '4/9/2030'], [2031, '4/8/2031'], [2032, '4/13/2032']].forEach(([y, d]) => assert.strictEqual(sta.leagueSeasonStart(y, 'Tuesday', '2nd'), d, String(y)));
[2026, 2027, 2028, 2035].forEach(y => { const [m, d] = sta.leagueSeasonStart(y, 'Tuesday', '2nd').split('/').map(Number); assert.strictEqual(new Date(Date.UTC(y, m - 1, d)).getUTCDay(), 2); assert(d >= 8 && d <= 14); });

// ── create / remove ──
function world({ seasons = [2026], scoresIn = [], exists = false, confirmOk = true, lastOld, ps } = {}) {
  const opts = { lastOld };
  const calls = [], alerts = [], audits = [], els = { newSeasonSkip: { value: '' }, newSeasonYear: { value: '2027' }, newSeasonFrom: { value: '2026' }, newSeasonCopyTeams: { checked: true }, lsSeason: { innerHTML: 'x' }, teamsSeason: { innerHTML: 'x' } };
  const rr = (n) => { const t = Array.from({ length: n }, (_, i) => i + 1), w = []; for (let k = 0; k < n - 1; k++) { w.push(Array.from({ length: n / 2 }, (_, i) => `${Math.min(t[i], t[n - 1 - i])}v${Math.max(t[i], t[n - 1 - i])}`)); t.splice(1, 0, t.pop()); } return w; };
  const dstr = i => { const d = new Date(Date.UTC(2026, 3, 7 + i * 7)); return String(d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()); };
  const schedRows = rr(12).concat(rr(12)).map((m, i) => ({ sDate: dstr(i), ...Object.fromEntries(m.map((v, j) => [String(j + 1), v])), Status: null }));
  const src2026 = { League: "Hugh's", Season: 2026, Cost: 45, Course: 'Club', Start9: 'F', StartDate: '4/7/2026', EndDate: '9/15/2026', PostSeasonDt: ps || '9/8/2026', PSWeek2Dt: '10/13/2026', Rainouts: 2, Byes: 1, Teams: 12, Extra: 'not a column' };
  const c = vm.createContext({ calls, alerts, audits, parseInt, String, isNaN, Date, Object, Set, JSON, Math, Array, RegExp, fmtDate: d => d, currentUser: { name: 'Pat', role: 'admin' },
    getLeagueSetting: (k, d) => k === 'DayOfWeek' ? 'Tuesday' : k === 'StartWeek' ? (global.__startWeek || d) : d,
    document: { getElementById: id => els[id] || null }, alert: m => alerts.push(m), confirm: m => { c.lastConfirm = m; return confirmOk; },
    query: (sql, args) => {
      if (/FROM Schedule WHERE League="Hugh's" AND \(Status IS NULL/.test(sql)) return [{ d: opts.lastOld || '20260901' }];
      if (/FROM Schedule WHERE League="Hugh's" AND Date >= '2026/.test(sql)) return schedRows;
      if (/PRAGMA table_info\(SeasonSettings\)/.test(sql)) return Object.keys(src2026).filter(k => k !== 'Extra').map(name => ({ name }));
      if (/SELECT 1 FROM SeasonSettings/.test(sql)) return exists ? [{ 1: 1 }] : [];
      if (/SELECT \* FROM SeasonSettings/.test(sql)) return args[0] === 2026 ? [src2026] : [];
      if (/SELECT Season FROM SeasonSettings/.test(sql)) return seasons.map(Season => ({ Season }));
      if (/COUNT\(\*\) AS n FROM SeasonSettings/.test(sql)) return [{ n: seasons.length }];
      const m = sql.match(/FROM (Scores|Matches|Payments)/); if (m) return [{ n: m[1] === 'Scores' && scoresIn.includes(args[0] / 10000 | 0) ? 3 : 0 }];
      return [];
    },
    serverRun: (sql, args) => calls.push({ sql, args }), auditDbChange: (...a) => audits.push(a), saveDBToServer() {}, loadNewSeasonSetup() {} });
  ['psMdyToInt', 'psAddDaysMdy', 'newSeasonIsAdmin', 'seasonRemovable', 'newSeasonRefresh', 'createNewSeason', 'leagueSeasonStart', 'leagueStartWeekLabel', 'leagueDayLabel', 'removeNewSeason', 'newSeasonFormHtml', 'scheduleSkipDates', 'scheduleWeekDates', 'scheduleRoundRobin', 'mdyOf', 'scheduleFrontBackFor', 'scheduleSourceWeeks', 'scheduleBuildPlan', 'scheduleInsertRows'].forEach(f => vm.runInContext(extract(f), c));
  return { c, calls, alerts, audits, els };
}
let w = world(); w.c.createNewSeason();
const ins = w.calls.find(x => /INSERT INTO SeasonSettings/.test(x.sql)), teams = w.calls.find(x => /INSERT INTO Teams/.test(x.sql));
assert(ins && teams, 'season row and teams copied');
const row = {}; ins.sql.match(/\(([^)]*)\) VALUES/)[1].split(',').forEach((c, i) => row[c.replace(/"/g, '')] = ins.args[i]);
assert.strictEqual(row.Season, 2027); assert.strictEqual(row.Cost, 45); assert.strictEqual(row.Teams, 12); assert(!('Extra' in row), 'only real columns');
assert.strictEqual(row.StartDate, '4/13/2027', 'always the 2nd Tuesday of April');
assert.strictEqual(row.EndDate, '9/7/2027', 'the season ends on its last scheduled week (22 weeks from 4/13), not on last year\'s end date'); assert.strictEqual(row.PostSeasonDt, '9/14/2027', 'post-season the week after the last regular week, as in 2026');
const sched = w.calls.filter(x => /INSERT INTO Schedule/.test(x.sql)); assert.strictEqual(sched.length, 22, 'the whole schedule is built in the same step'); assert.strictEqual(sched[0].args[0], '20270413'); assert.strictEqual(sched[21].args[0], '20270907'); assert.strictEqual(sched[0].args[1], '1v12', 'pairings copied from 2026'); assert.strictEqual(sched[0].args[25], 'Front');
assert.strictEqual(row.PSWeek2Dt, null); assert.strictEqual(row.Rainouts, 0); assert.strictEqual(row.Byes, 0);
assert.strictEqual(JSON.stringify(teams.args), '[2027,2026]');
assert(w.audits.length === 1 && w.audits[0][0] === 'season_created');
assert(/22 weeks/.test(w.c.lastConfirm) && /pairings copied from 2026/.test(w.c.lastConfirm), 'the confirmation says what will be built');
assert(/3.*refresh|Refresh/i.test(w.alerts.join(' ')) || /refresh the page/.test(w.alerts.join(' ')), 'tells the admin what to do next');
assert(/current season right away/.test(w.c.lastConfirm) && /backup/.test(w.c.lastConfirm), 'warns about the switch and the backup');
assert.strictEqual(w.els.lsSeason.innerHTML, '', 'season dropdowns are rebuilt');
w = world(); w.els.newSeasonCopyTeams.checked = false; w.c.createNewSeason(); assert(!w.calls.some(x => /INSERT INTO Teams/.test(x.sql)), 'teams only when asked');
w = world({ exists: true }); w.c.createNewSeason(); assert(!w.calls.length && /already exists/.test(w.alerts[0]), 'no duplicate season');
w = world({ confirmOk: false }); w.c.createNewSeason(); assert(!w.calls.length, 'cancel does nothing');
w = world(); w.els.newSeasonYear.value = 'abc'; w.c.createNewSeason(); assert(!w.calls.length);
w = world(); w.c.currentUser.role = 'player'; w.c.createNewSeason(); assert(!w.calls.length && /Only admins/.test(w.alerts[0]));

global.__startWeek = '1st'; w = world(); w.c.createNewSeason(); { const i = w.calls.find(x => /INSERT INTO SeasonSettings/.test(x.sql)); const cols = i.sql.match(/\(([^)]*)\) VALUES/)[1].split(',').map(c => c.replace(/"/g, '')); assert.strictEqual(i.args[cols.indexOf('StartDate')], '4/6/2027', 'the Start Week setting decides'); assert(/1st Tuesday of April/.test(w.c.lastConfirm)); } delete global.__startWeek;
w = world({ ps: '9/15/2026' }); w.c.createNewSeason();   // 2026's post-season was two weeks after the last played week: dates simply move 52 weeks
const ins2 = w.calls.find(x => /INSERT INTO SeasonSettings/.test(x.sql)), row2 = {}; ins2.sql.match(/\(([^)]*)\) VALUES/)[1].split(',').forEach((c, i) => row2[c.replace(/"/g, '')] = ins2.args[i]);
assert.strictEqual(row2.PostSeasonDt, '9/21/2027', 'moved by how far the start moved (4/7/2026 to 4/13/2027)'); assert.strictEqual(row2.EndDate, '9/7/2027');
// remove: only an empty season, never the only one
w = world({ seasons: [2027, 2026], scoresIn: [2026] }); w.c.removeNewSeason(2027);
assert(w.calls.length === 3 && /DELETE FROM Teams/.test(w.calls[0].sql) && /DELETE FROM Schedule/.test(w.calls[1].sql) && /DELETE FROM SeasonSettings/.test(w.calls[2].sql) && w.audits[0][0] === 'season_removed');
w = world({ seasons: [2027, 2026], scoresIn: [2026] }); w.c.removeNewSeason(2026); assert(!w.calls.length && /cannot be removed/.test(w.alerts[0]), 'a season with scores is kept');
w = world({ seasons: [2026] }); w.c.removeNewSeason(2026); assert(!w.calls.length && /only season/.test(w.alerts[0]));
// the form offers Remove only for empty seasons, and defaults to the next year
w = world({ seasons: [2027, 2026], scoresIn: [2026] }); const html = w.c.newSeasonFormHtml();
assert(/value="2028"/.test(html) && /Remove 2027/.test(html) && !/Remove 2026/.test(html));
assert(!/Remove/.test(world({ seasons: [2026] }).c.newSeasonFormHtml()), 'one season: nothing to remove');
console.log('ok');
