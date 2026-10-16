// Admin > New Season: build the weekly schedule (dates, matchups, Front/Back) without SQL.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
const FUNCS = ['psMdyToInt', 'psAddDaysMdy', 'scheduleSkipDates', 'scheduleWeekDates', 'scheduleRoundRobin', 'scheduleFrontBackFor', 'scheduleSourceWeeks', 'scheduleBuildPlan', 'scheduleBuildFormHtml', 'scheduleInsertRows', 'mdyOf', 'buildNewSeasonSchedule', 'newSeasonIsAdmin', 'seasonRemovable'];
function world({ ss = { Season: 2027, Teams: 12, StartDate: '4/6/2027', EndDate: '6/15/2027', Start9: 'F' }, sourceRows = [], scheduleCount = 0, scoresIn = false, confirmOk = true, role = 'admin' } = {}) {
  const calls = [], alerts = [], audits = [], els = { schedSeason: { value: '2027' }, schedFrom: { value: '2026' }, schedSkip: { value: '' } };
  const c = vm.createContext({ calls, alerts, audits, parseInt, String, isNaN, Date, Object, Set, Math, Array, JSON, RegExp, currentUser: { name: 'Pat', role },
    document: { getElementById: id => els[id] || null }, alert: m => alerts.push(m), confirm: m => { c.lastConfirm = m; return confirmOk; }, fmtDate: d => d,
    getSeasonSettings: y => (y === ss.Season ? ss : {}),
    query: (sql, args) => {
      if (/FROM Schedule WHERE League="Hugh's" AND Date >= '2026/.test(sql)) return sourceRows;
      if (/SELECT Season FROM SeasonSettings/.test(sql)) return [{ Season: 2027 }, { Season: 2026 }];
      if (/DISTINCT substr/.test(sql)) return [{ y: '2026' }];
      if (/COUNT\(\*\) AS n FROM Schedule/.test(sql)) return [{ n: scheduleCount }];
      const m = sql.match(/FROM (Scores|Matches|Payments)/); if (m) return [{ n: scoresIn && m[1] === 'Scores' ? 2 : 0 }];
      return [];
    },
    serverRun: (sql, args) => calls.push({ sql, args }), auditDbChange: (...a) => audits.push(a), saveDBToServer() {}, newSeasonRefresh() {} });
  FUNCS.forEach(f => vm.runInContext(extract(f), c));
  return { c, calls, alerts, audits, els };
}
const J = x => JSON.parse(JSON.stringify(x));
const w0 = world();
// round robin: every pair meets exactly once per round, every team plays every week
[4, 6, 12].forEach(n => {
  const rr = J(w0.c.scheduleRoundRobin(n)), seen = new Set();
  assert.strictEqual(rr.length, n - 1);
  rr.forEach(week => { const teams = week.flatMap(m => m.split('v').map(Number)); assert.strictEqual(new Set(teams).size, n, 'each team once a week'); week.forEach(m => { assert(!seen.has(m), 'no repeat ' + m); seen.add(m); }); });
  assert.strictEqual(seen.size, n * (n - 1) / 2);
});
// dates
const sk = J(w0.c.scheduleSkipDates('5/25/2027, 7/6/2027 abc'));
assert.deepStrictEqual(sk.bad, ['abc']);
const wd = J(w0.c.scheduleWeekDates('4/6/2027', '6/15/2027', new Set(['20270511'])));
assert.strictEqual(wd.dates.length, 10); assert.strictEqual(wd.dates[0], '20270406'); assert.strictEqual(wd.dates[wd.dates.length - 1], '20270615');
assert.deepStrictEqual(wd.skipped, ['20270511']); assert(!wd.dates.includes('20270511'));
assert.strictEqual(w0.c.scheduleFrontBackFor('20270406', '4/6/2027', 'F'), 'Front'); assert.strictEqual(w0.c.scheduleFrontBackFor('20270505', '4/6/2027', 'F'), 'Back');
assert.strictEqual(w0.c.scheduleFrontBackFor('20270406', '4/6/2027', 'B'), 'Back'); assert.strictEqual(w0.c.scheduleFrontBackFor('20270606', '4/6/2027', 'F'), 'Front');
// plan: fresh round robin when there is no source
let plan = J(w0.c.scheduleBuildPlan(2027, null, ''));
assert.strictEqual(plan.rows.length, 11); assert.strictEqual(plan.usedSource, false); assert.strictEqual(plan.rows[0].matchups.length, 6); assert.strictEqual(plan.rows[0].fb, 'Front');
// plan: copies an earlier season's pairings (cycling), when they fit
const rr12 = J(w0.c.scheduleRoundRobin(12)), cols = m => Object.fromEntries(m.map((x, i) => [String(i + 1), x]));
const srcRows = rr12.map((m, i) => ({ sDate: '2026040' + i, ...cols(m), Status: null }));
srcRows.push({ sDate: '20260901', ...cols(['1v2']), Status: 'Rainout' });                  // a rained-out week is not a pattern week
const w1 = world({ sourceRows: srcRows }); plan = J(w1.c.scheduleBuildPlan(2027, 2026, ''));
assert.strictEqual(plan.usedSource, true); assert.strictEqual(plan.fromSeason, 2026); assert.deepStrictEqual(plan.rows[0].matchups, rr12[0]); assert.deepStrictEqual(plan.rows[10].matchups, rr12[10]);
// with a source the number of weeks is that season's played weeks, whatever the End Date says (rainouts are not repeated)
const longer = J(world({ sourceRows: srcRows, ss: { Season: 2027, Teams: 12, StartDate: '4/6/2027', EndDate: '12/14/2027', Start9: 'F' } }).c.scheduleBuildPlan(2027, 2026, ''));
assert.strictEqual(longer.rows.length, 11, 'weeks come from the source, not the End Date'); assert.strictEqual(longer.endMdy, '6/15/2027');
const skipped = J(w1.c.scheduleBuildPlan(2027, 2026, '4/13/2027'));
assert.strictEqual(skipped.rows.length, 11); assert.strictEqual(skipped.rows[1].date, '20270420'); assert.strictEqual(skipped.rows[10].date, '20270622', 'a skipped week lengthens the season, it does not shorten it');
assert.deepStrictEqual(skipped.skipped, ['20270413']);
// a source without an End Date is fine; a fresh round robin needs one
assert.strictEqual(J(world({ sourceRows: srcRows, ss: { Season: 2027, Teams: 12, StartDate: '4/6/2027', Start9: 'F' } }).c.scheduleBuildPlan(2027, 2026, '')).rows.length, 11);
assert(/End Date/.test(world({ ss: { Season: 2027, Teams: 12, StartDate: '4/6/2027' } }).c.scheduleBuildPlan(2027, null, '').error));
// a source that does not fit the team count falls back to a round robin
plan = J(world({ sourceRows: srcRows, ss: { Season: 2027, Teams: 10, StartDate: '4/6/2027', EndDate: '6/15/2027', Start9: 'F' } }).c.scheduleBuildPlan(2027, 2026, ''));
assert.strictEqual(plan.usedSource, false); assert.strictEqual(plan.rows[0].matchups.length, 5);
// errors
assert(/does not exist/.test(world().c.scheduleBuildPlan(2030, null, '').error));
assert(/even number/.test(world({ ss: { Season: 2027, Teams: 11, StartDate: '4/6/2027', EndDate: '6/15/2027' } }).c.scheduleBuildPlan(2027, null, '').error));
assert(/Start Date/.test(world({ ss: { Season: 2027, Teams: 12, StartDate: '', EndDate: '' } }).c.scheduleBuildPlan(2027, null, '').error));
assert(/not month\/day\/year/.test(world().c.scheduleBuildPlan(2027, null, 'tomorrow').error));
// action: writes one row per week, updates the End Date, logs
let w = world(); w.c.buildNewSeasonSchedule();
const ins = w.calls.filter(x => /INSERT INTO Schedule/.test(x.sql)), upd = w.calls.find(x => /UPDATE SeasonSettings SET EndDate/.test(x.sql));
assert.strictEqual(ins.length, 11); assert.strictEqual(ins[0].args.length, 1 + 24 + 1, 'date, 24 matchup slots, FrontBack'); assert.strictEqual(ins[0].args[0], '20270406');
assert.strictEqual(ins[0].args[7], null, 'unused slots are NULL'); assert.strictEqual(ins[0].args[25], 'Front'); assert(/\?,\?/.test(ins[0].sql) && (ins[0].sql.match(/\?/g) || []).length === 26);
assert.strictEqual(upd.args[0], '6/15/2027'); assert.strictEqual(w.audits[0][0], 'schedule_built'); assert(!w.calls.some(x => /DELETE FROM Schedule/.test(x.sql)));
assert(/backup/.test(w.c.lastConfirm));
// rebuild rules
w = world({ scheduleCount: 11 }); w.c.buildNewSeasonSchedule(); assert(w.calls.some(x => /DELETE FROM Schedule/.test(x.sql)) && w.calls.filter(x => /INSERT INTO Schedule/.test(x.sql)).length === 11, 'an empty season can be rebuilt');
w = world({ scheduleCount: 11, scoresIn: true }); w.c.buildNewSeasonSchedule(); assert(!w.calls.length && /cannot be rebuilt/.test(w.alerts[0]), 'never replaces a played season');
w = world({ confirmOk: false }); w.c.buildNewSeasonSchedule(); assert(!w.calls.length);
w = world({ role: 'player' }); w.c.buildNewSeasonSchedule(); assert(!w.calls.length && /Only admins/.test(w.alerts[0]));
// form
const html = world().c.scheduleBuildFormHtml(); assert(/id="schedSeason"/.test(html) && /id="schedFrom"/.test(html) && /id="schedSkip"/.test(html) && /<option value="2026">2026/.test(html) && /Fresh round robin/.test(html));
// wiring
assert(/newSeasonFormHtml\(\) \+ scheduleBuildFormHtml\(\) \+ newSeasonSetupHtml\(\)/.test(src));
console.log('ok');
