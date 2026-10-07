// Gallus import on a post-season night: the card goes into the nine that night plays, is saved per nine, and never lands in the wrong holes.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name, isAsync) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return (isAsync ? 'async ' : '') + src.slice(i, k + 1); }
}
const J = x => JSON.parse(JSON.stringify(x));
const par = [4, 4, 3, 5, 4, 4, 3, 5, 4], hc = [1, 2, 3, 4, 5, 6, 7, 8, 9];
function run({ ps = true, week = 1, week1Nine = 'Back', card = 'Back', scores = [5, 4, 3, 6, 5, 4, 3, 5, 4], preFront = null, partial = false, batch = false } = {}) {
  const calls = [], alerts = [];
  const holes = Array(18).fill(''); if (preFront) preFront.forEach((v, i) => { holes[i] = String(v); });
  const entryState = { A1: { active: 'Alice Player', regular: 'Alice Player', sub: null, team: 1, grade: 'A', holes, phdcp: 6 } };
  const date = ps ? (week === 1 ? '20260929' : '20261006') : '20260922';
  const els = { entry9: { value: 'Front' }, entryDate: { value: date }, gallusModal: { style: {} } };
  const ctx = vm.createContext({
    _gallusData: { players: [{ name: 'Alice Player', gallusName: 'Alice Player', scores: partial ? scores.map((v, i) => i === 8 ? null : v) : scores }], frontBack: card },
    entryState, courseData: { front: { pars: par, hcps: hc }, back: { pars: par, hcps: hc }, all18: { pars: [...par, ...par], hcps: [...hc, ...hc] } },
    document: { getElementById: id => els[id] || { style: {}, value: '' } }, window: { _importAllBatch: batch ? [] : undefined }, console,
    isPostSeasonEntryMode: () => ps, getPostSeasonContextForDate: d => ps ? { season: 2026, week: String(d) === '20260929' ? 1 : 2 } : null,
    getPostSeasonWeek1Nine: () => week1Nine, fmtDate: d => String(d), confirm: () => true, alert: m => alerts.push(m), buildEntryGrid: async () => {},
    serverRun: (sql, args) => { calls.push({ sql, args }); }, calcGross: h => h.reduce((a, v) => a + (parseInt(v) || 0), 0),
    calcNet: (h, pars) => h.reduce((a, v) => a + (parseInt(v) || 0), 0) - 6, updateCompletedEntryHandicap() {},
    query: sql => /MAX\(Season\)/.test(sql) ? [{ s: 2026 }] : [], getSeasonSettings: () => ({ Skins: 2, Closest: 1 }), currentUser: { name: 'Admin' },
    calcMatchesForDate: async d => { calls.push({ sql: 'MATCHES', args: [d] }); }, saveSkinWinnersForDate: async d => { calls.push({ sql: 'SKINS', args: [d] }); },
    calcEoySkins: () => { calls.push({ sql: 'EOY' }); }, loadScores() {}, reRenderEntry() {}, scheduleScoreClassRefresh() {},
    SERVER_RUN_QUEUE: Promise.resolve(), saveDBToServer: async () => { calls.push({ sql: 'SAVEDB' }); }, parseInt, String, Array, Object, JSON });
  vm.runInContext(extract('psNineForDate') + '\n' + extract('doGallusConfirm', true), ctx);
  return ctx.doGallusConfirm().then(() => ({ calls, alerts, holes: entryState.A1.holes, els, entryState }));
}
const inserts = r => r.calls.filter(c => /INSERT INTO Scores/.test(c.sql));
(async () => {
  // Week 1 is the Back 9 night: a Back card fills grid slots 10-18 (index 9-17) and is saved as ONE Back row on 9/29
  let r = await run();
  assert.deepStrictEqual(J(r.holes.slice(0, 9)), Array(9).fill(''), 'front slots untouched');
  assert.deepStrictEqual(J(r.holes.slice(9)), ['5', '4', '3', '6', '5', '4', '3', '5', '4'], 'back card goes to holes 10-18');
  const ins = inserts(r); assert.strictEqual(ins.length, 1);
  assert.deepStrictEqual(J(ins[0].args.slice(0, 4)), ['Hugh\'s', 'Alice Player', '20260929', 'Back']);
  assert.deepStrictEqual(J(ins[0].args.slice(4, 13)), ['5', '4', '3', '6', '5', '4', '3', '5', '4']);
  assert.strictEqual(ins[0].args[13], 39); assert.strictEqual(ins[0].args[14], 33, 'gross 39, net 33');
  assert(r.calls.some(c => /DELETE FROM Scores .*FrontBack=\?/.test(c.sql) && c.args[2] === 'Back'), 'replaces only that night\'s Back row');
  // post-season: no regular-season Skin/CTP buy-ins, no matches, prize figures refreshed, database saved
  assert(!r.calls.some(c => /INSERT INTO Payments/.test(c.sql)), 'no Skin/CTP buy-ins');
  assert(!r.calls.some(c => c.sql === 'MATCHES') && r.calls.some(c => c.sql === 'EOY') && r.calls.some(c => c.sql === 'SAVEDB'));
  assert.strictEqual(r.entryState.A1._lastSavedBackSig, '5-4-3-6-5-4-3-5-4');
  // Week 2 (Front 9) with a Front card: slots 1-9, saved as Front on 10/6; a Back 9 already entered on 9/29 is not asked about
  r = await run({ week: 2, card: 'Front', preFront: null });
  assert.deepStrictEqual(J(r.holes.slice(0, 9)), ['5', '4', '3', '6', '5', '4', '3', '5', '4']); assert.deepStrictEqual(J(r.holes.slice(9)), Array(9).fill(''));
  assert.deepStrictEqual(J(inserts(r)[0].args.slice(0, 4)), ['Hugh\'s', 'Alice Player', '20261006', 'Front']);
  // the overwrite warning looks only at the nine being imported (a player with a Front 9 already has no warning for a Back card)
  let confirms = 0; r = await run({ preFront: [4, 4, 4, 4, 4, 4, 4, 4, 4] }); assert.strictEqual(inserts(r).length, 1, 'front scores on file do not block a Back import');
  // wrong night: a Back card on the Front 9 night (10/6) is refused with a clear message and nothing is written
  r = await run({ week: 2, card: 'Back' });
  assert.strictEqual(inserts(r).length, 0); assert.strictEqual(r.calls.length, 0); assert(/Back 9, but 20261006 is the Front 9 night/.test(r.alerts[0]), r.alerts[0]);
  assert.deepStrictEqual(J(r.holes), Array(18).fill(''), 'grid untouched');
  r = await run({ week: 2, card: 'Back', batch: true }); assert.strictEqual(r.alerts.length, 0, 'batch import does not pop an alert per card'); assert.strictEqual(r.calls.length, 0);
  // Week 1 setting = Front flips which night is which
  r = await run({ week: 1, week1Nine: 'Front', card: 'Front' }); assert.strictEqual(inserts(r)[0].args[3], 'Front'); assert.strictEqual(inserts(r)[0].args[2], '20260929');
  // an unfinished card stays in the grid but is not saved (and the person is told)
  r = await run({ partial: true }); assert.strictEqual(inserts(r).length, 0); assert(/not complete/.test(r.alerts[0]));
  // regular season is unchanged: one row of 9 with the entry's nine, slots 0-8, Skin/CTP auto-pay path and match calc still run
  r = await run({ ps: false, card: 'Front' });
  assert.strictEqual(inserts(r).length, 1); assert.strictEqual(inserts(r)[0].args[3], 'Front'); assert.strictEqual(inserts(r)[0].args[2], '20260922');
  assert(r.calls.some(c => c.sql === 'MATCHES') && r.calls.some(c => c.sql === 'SKINS') && !r.calls.some(c => c.sql === 'EOY'), 'league-night path unchanged');
  // wiring: the Skins tab date list now includes the post-season nights
  assert(/const skinKeys = getCtpDateKeys\(skinDates\.map\(r => r\.sDate\), season\);/.test(src) && /skSel\.innerHTML = skinKeys\.map\(/.test(src));
  assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]) && ((v) => v[0] > '20261007' || (v[0] === '20261007' && +v[1] >= 1))(src.match(/const APP_VERSION = '([^']+)';/)[1].split('.')));
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
