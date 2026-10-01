// A single player's Front or Back 9 scores can be cleared in post-season entry; everything derived from them refreshes.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const calls = [], runs = [];
let confirmAnswer = true, alerts = [], paidRows = [];
const mkInp = hi => ({ dataset: { hi: String(hi), slotkey: 'k1' }, value: '4' });
let inputs = Array.from({ length: 18 }, (_, hi) => mkInp(hi));
const cells = {};
const cell = (id, text = '') => cells[id] = cells[id] || { textContent: text, className: '', querySelector: () => null };
const ctx = vm.createContext({
  window: {}, currentUser: { role: 'admin' }, CSS: { escape: x => x }, parseInt, String, console,
  entryState: { _psWeek1Fb: 'Back', _psDate1: 20260929, _psDate2: 20261006, _psFrontDate: 20261006, _psBackDate: 20260929,
    k1: { active: 'Gary Scudder', holes: Array(18).fill('4'), _lastSavedFrontSig: 'f', _lastSavedBackSig: 'b' } },
  document: { getElementById: id => cell(id), querySelectorAll: () => inputs },
  query: (sql, params) => { calls.push(['query', sql, params]); return paidRows; },
  serverRun: (sql, params) => { runs.push([sql, params]); },
  confirm: () => confirmAnswer, alert: m => alerts.push(m),
  SERVER_RUN_QUEUE: Promise.resolve(), courseData: { all18: 'ALL18' },
  getPostSeasonEntryTotals: st => ({ frontGross: st.holes.slice(0, 9).every(v => v === '') ? '' : 36, backGross: st.holes.slice(9).every(v => v === '') ? '' : 36, runGross: 36, runNet: 30, runPar: 36 }),
  loadScores: () => calls.push(['loadScores']), renderPostSeasonBreakdown: n => calls.push(['breakdown', n]), applyCellClasses: n => calls.push(['classes', n]),
});
['psNineTotalCell', 'psSetNineTotal', 'psRefreshAfterClear'].forEach(n => vm.runInContext(extract(n), ctx));
vm.runInContext('async ' + extract('clearPlayerNine'), ctx);
const st = () => ctx.entryState.k1;
const writes = () => runs.map(r => r[0].split(' ').slice(0, 3).join(' '));

(async () => {
  // cancel: nothing happens
  confirmAnswer = false;
  await ctx.clearPlayerNine('k1', 'Front');
  assert.strictEqual(runs.length, 0, 'cancel writes nothing'); assert.strictEqual(st().holes[0], '4');
  confirmAnswer = true;

  // Front 9 = Week 2 (Back is Week 1) -> Week 2 date, FrontBack 'Front', holes 0-8 only
  await ctx.clearPlayerNine('k1', 'Front');
  assert.deepStrictEqual(Array.from(st().holes), [...Array(9).fill(''), ...Array(9).fill('4')], 'only the Front 9 holes are cleared');
  const del = runs.find(r => /^DELETE FROM Scores/.test(r[0]));
  assert.deepStrictEqual(Array.from(del[1]), ["Hugh's", 'Gary Scudder', 20261006, 'Front'], 'this player, Week 2 date, Front only');
  assert(/FrontBack=\?/.test(del[0]) && /Player=\?/.test(del[0]) && /Date AS INTEGER/.test(del[0]));
  const ctp = runs.find(r => /^DELETE FROM Payments/.test(r[0]));
  assert(/"Desc"='CTP'/.test(ctp[0]) && /COALESCE\(DatePaid,''\)=''/.test(ctp[0]) && Array.from(ctp[1]).join() === "Hugh's,Gary Scudder,20261006", 'only this player\'s UNPAID CTP wins that week');
  assert(!runs.some(r => /Skin'|EOY Skins|League Dues/.test(r[0]) && /DELETE|UPDATE Payments/.test(r[0])), 'skins / buy-ins untouched');
  assert.strictEqual(st()._lastSavedFrontSig, null, 'front re-saves when re-entered'); assert.strictEqual(st()._lastSavedBackSig, 'b');
  assert(inputs.slice(0, 9).every(i => i.value === '') && inputs.slice(9).every(i => i.value === '4'), 'cells emptied in place');
  assert.strictEqual(cells['out-k1'].textContent, '', 'OUT total blank'); assert.strictEqual(cells['in-k1'].textContent, 36, 'IN total kept');
  // everything below refreshes
  const names = calls.map(c => c[0]);
  assert(names.includes('loadScores') && names.includes('breakdown') && names.includes('classes'), 'tables, leaderboard/pots/skins and highlights refresh: ' + names);

  // the panels refresh immediately (before the server queue settles), and again after it
  {
    let release; const events = [];
    ctx.SERVER_RUN_QUEUE = new Promise(r => { release = r; });          // a slow / stuck server write
    ctx.renderPostSeasonBreakdown = n => events.push('breakdown');
    ctx.loadScores = () => events.push('loadScores');
    ctx.applyCellClasses = () => events.push('classes');
    st().holes = Array(18).fill('4'); paidRows = []; runs.length = 0;
    const p = ctx.clearPlayerNine('k1', 'Front');
    await new Promise(r => setImmediate(r));
    assert.deepStrictEqual(events, ['breakdown', 'loadScores', 'classes'], 'refreshed while the server write is still pending');
    assert.strictEqual(cells['out-k1'].textContent, '');
    release(); await p;
    assert.strictEqual(events.length, 6, 'and refreshed again once the queue settles');
    // a failing step (or a rejected queue) never blocks the others
    events.length = 0; ctx.loadScores = () => { throw new Error('boom'); }; ctx.SERVER_RUN_QUEUE = Promise.reject(new Error('queue down'));
    st().holes = Array(18).fill('4');
    await ctx.clearPlayerNine('k1', 'Back');
    assert.deepStrictEqual(events, ['breakdown', 'classes', 'breakdown', 'classes'], 'breakdown + highlights still refresh when loadScores throws / queue rejects');
    ctx.SERVER_RUN_QUEUE = Promise.resolve(); ctx.loadScores = () => calls.push(['loadScores']);
    st().holes = [...Array(9).fill(''), ...Array(9).fill('4')];   // restore: Front cleared, Back still scored
  }
  // Back 9 = Week 1 date
  runs.length = 0;
  await ctx.clearPlayerNine('k1', 'Back');
  assert.deepStrictEqual(Array.from(runs.find(r => /^DELETE FROM Scores/.test(r[0]))[1]), ["Hugh's", 'Gary Scudder', 20260929, 'Back']);
  assert(st().holes.every(v => v === ''));

  // paid winnings that week: refused, nothing written
  runs.length = 0; st().holes = Array(18).fill('4'); paidRows = [{ Desc: 'Skin', Detail: '#2' }];
  await ctx.clearPlayerNine('k1', 'Front');
  assert.strictEqual(runs.length, 0); assert(/already has paid winnings/.test(alerts[0])); assert.strictEqual(st().holes[0], '4');
  // helpers: total cell / button visibility
  const td = { textContent: '', _s: { textContent: '' }, _b: { style: {} }, querySelector(sel) { return sel === '.psv' ? this._s : this._b; } };
  ctx.psSetNineTotal(td, 40); assert.strictEqual(td._s.textContent, 40); assert.strictEqual(td._b.style.visibility, 'visible');
  ctx.psSetNineTotal(td, ''); assert.strictEqual(td._b.style.visibility, 'hidden');
  // wiring
  assert(/psNineTotalCell\(`out-\$\{key\}`, key, 'Front'/.test(src) && /psNineTotalCell\(`in-\$\{key\}`, key, 'Back'/.test(src), 'OUT = Front, IN = Back');
  assert.strictEqual([...src.matchAll(/psSetNineTotal\(outEl,/g)].length, 2, 'typing and paste both update via the helper');
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
