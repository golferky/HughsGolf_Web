// Schedule tab: post-season Week 1 / Week 2 are listed (newest first, with their nine), and the regular rows are unchanged.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
function run({ postSeasonDt = '9/29/2026', w1 = 'Back', played = [], extraRows = [] } = {}) {
  const out = [];
  const tbodyEl = { appendChild: tr => out.push(tr) };
  const mkEl = () => ({ style: {}, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, remove() {} });
  const regular = [{ sDate: '20260922', Status: null, '1': '1v2' }, { sDate: '20260915', Status: null, '1': '1v3' }, ...extraRows];
  const c = vm.createContext({
    db: {}, console, parseInt, String, Set, Object,
    document: { getElementById: id => id === 'schedSeason' ? { value: '2026' } : id === 'tab-schedule' ? { insertBefore() {}, querySelector: () => ({}) } : mkEl(), querySelector: () => mkEl(), createElement: () => mkEl() },
    currentUser: null, tbody: () => tbodyEl, fmtDate: d => String(d),
    getSeasonSettings: () => ({ PostSeasonDt: postSeasonDt }),
    parsePostSeasonDates: dt => dt ? { week1: 20260929, week2: 20261006 } : null,
    getPostSeasonFrontBackMap: () => ({ week1Fb: w1, week2Fb: w1 === 'Back' ? 'Front' : 'Back' }),
    query: sql => /FROM Schedule/.test(sql) ? regular : /FROM Teams/.test(sql) ? [] : /FROM Scores/.test(sql) ? played.map(d => ({ Date: d })) : [] });
  vm.runInContext(extract('loadSchedule'), c); c.loadSchedule();
  return out.map(tr => tr.innerHTML.replace(/\s+/g, ' '));
}
let rows = run();
assert.strictEqual(rows.length, 4, '2 post-season + 2 regular');
assert(/20261006/.test(rows[0]) && /Post-season Wk 2/.test(rows[0]) && /All players · Front 9/.test(rows[0]), 'Week 2 first (newest), the other nine');
assert(/20260929/.test(rows[1]) && /Post-season Wk 1/.test(rows[1]) && /All players · Back 9/.test(rows[1]), 'Week 1 follows the Week 1 nine setting');
assert(/20260922/.test(rows[2]) && /1v2/.test(rows[2]) && !/Post-season/.test(rows[2]), 'regular rows follow, unchanged');
assert(/—/.test(rows[0]) && /—/.test(rows[1]), 'unplayed weeks show a dash');
rows = run({ played: ['20260929'], w1: 'Front' });
assert(/✓ Played/.test(rows[1]) && /Front 9/.test(rows[1]) && !/Played/.test(rows[0]), 'played week marked; Front setting flips the nines');
assert(/Back 9/.test(rows[0]));
assert.strictEqual(run({ postSeasonDt: null }).length, 2, 'no post-season date: nothing added');
assert.strictEqual(run({ extraRows: [{ sDate: '20260929', Status: null, '1': '' }] }).filter(h => /Post-season Wk 1/.test(h)).length, 0, 'a post-season date already in the Schedule table is not listed twice');
console.log('ok');
