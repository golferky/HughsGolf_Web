// Post-season: a future-dated week's score fields are disabled unless LOCAL TEST: ALLOW FUTURE SCORES is on (display only).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const ctx = vm.createContext({ parseInt, Set });
['psFutureLockedNines', 'psFutureLockMessage', 'psTodayInt', 'psSeedLock'].forEach(n => vm.runInContext(extract(n), ctx));
const plain = x => JSON.parse(JSON.stringify(x));
// 2026 post season: Week 1 = back 9 on 9/29, Week 2 = front 9 on 10/6
const meta = { _psWeek1Fb: 'Back', _psDate1: 20260929, _psDate2: 20261006, _psFrontDate: 20261006, _psBackDate: 20260929 };

// 10/1: Week 2 (Front 9) is future -> locked; Week 1 (Back 9) is not
assert.deepStrictEqual(plain(ctx.psFutureLockedNines(meta, 20261001, false)), [{ nine: 'Front', date: 20261006, week: 2 }]);
// override on -> nothing locked
assert.deepStrictEqual(plain(ctx.psFutureLockedNines(meta, 20261001, true)), []);
// 9/28: both weeks future
assert.deepStrictEqual(plain(ctx.psFutureLockedNines(meta, 20260928, false)).map(l => l.week).sort(), [1, 2]);
// the day of / after a week: unlocked (a week is future only when its date is after today)
assert.deepStrictEqual(plain(ctx.psFutureLockedNines(meta, 20261006, false)), []);
assert.deepStrictEqual(plain(ctx.psFutureLockedNines(meta, 20261007, false)), []);
// Week 1 on the Front 9 (rainout swap): the Back 9 is Week 2
const swapped = { _psWeek1Fb: 'Front', _psDate1: 20260929, _psDate2: 20261006, _psFrontDate: 20260929, _psBackDate: 20261006 };
assert.deepStrictEqual(plain(ctx.psFutureLockedNines(swapped, 20261001, false)), [{ nine: 'Back', date: 20261006, week: 2 }]);
// dates derived from _psDate1/_psDate2 when the front/back dates are missing
assert.deepStrictEqual(plain(ctx.psFutureLockedNines({ _psWeek1Fb: 'Back', _psDate1: 20260929, _psDate2: 20261006 }, 20261001, false)), [{ nine: 'Front', date: 20261006, week: 2 }]);
assert.deepStrictEqual(plain(ctx.psFutureLockedNines(null, 20261001, false)), []);
// the exact message
assert.strictEqual(ctx.psFutureLockMessage([{ nine: 'Front', date: 20261006, week: 2 }]), 'Week 2 is future-dated. Enable Local Test: Allow Future Scores to enter test scores.');
assert.strictEqual(ctx.psFutureLockMessage([{ week: 1 }, { week: 2 }]), 'Week 1 and Week 2 are future-dated. Enable Local Test: Allow Future Scores to enter test scores.');

// ---- Seed actions follow the same rule (they write scores too)
// 2026: Week 1 = Back 9 on 9/29, Week 2 = Front 9 on 10/6. Seed 1 writes the Front 9 date, seed 2 the Back 9 date, Gallus both.
const lock = (which, today, ov) => plain(ctx.psSeedLock(which, meta, today, ov));
assert.deepStrictEqual(lock('1', 20261001, false), { locked: true, weeks: [2], message: 'Week 2 is future-dated. Enable Local Test: Allow Future Scores to enter test scores.' }, 'Front 9 seed targets 10/6 = Week 2');
assert.strictEqual(lock('2', 20261001, false).locked, false, 'Back 9 seed targets 9/29: allowed');
assert.deepStrictEqual(lock('gallus', 20261001, false).weeks, [2], 'Gallus seed writes both weeks: locked by Week 2');
assert.strictEqual(lock('gallus', 20260928, false).message, 'Week 1 and Week 2 are future-dated. Enable Local Test: Allow Future Scores to enter test scores.');
['1', '2', 'gallus'].forEach(w => assert.strictEqual(lock(w, 20261001, true).locked, false, 'override unlocks ' + w));
['1', '2', 'gallus'].forEach(w => assert.strictEqual(lock(w, 20261007, false).locked, false, 'past dates are fine ' + w));
assert.strictEqual(ctx.psSeedLock('1', null, 20261001, false).locked, false);
assert(ctx.psTodayInt() > 20260000 && ctx.psTodayInt() < 21000000);

// the seed functions refuse BEFORE any confirm or write while locked, and proceed to the normal confirm once unlocked
(async () => {
  const sctx = (override) => {
    const log = { alerts: [], confirms: 0, writes: 0, queries: 0 };
    const c = vm.createContext({
      canUsePostSeasonTestMode: () => true, activeEntryPostSeasonContext: { week1: 20260929, week2: 20261006 },
      entryState: { ...meta }, psTodayInt: () => 20261001, futureScoreOverrideEnabled: () => override,
      alert: m => log.alerts.push(m), confirm: () => { log.confirms++; return false; },
      query: () => { log.queries++; return [{ Date: 20260908, players: 'x', cnt: 1 }]; }, serverRun: () => { log.writes++; },
      fmtDate: String, prompt: () => '1', SERVER_RUN_QUEUE: Promise.resolve(), buildEntryGrid() {}, loadScores() {},
    });
    ['psSeedLock'].forEach(n => vm.runInContext(extract(n), c));
    vm.runInContext('async ' + extract('seedPostSeasonTestScores'), c);
    vm.runInContext('async ' + extract('seedPostSeasonFrom18HGallus'), c);
    return { c, log };
  };
  for (const [fn, arg] of [['seedPostSeasonTestScores', 1], ['seedPostSeasonFrom18HGallus', undefined]]) {
    let t = sctx(false);
    await t.c[fn](arg);
    assert.deepStrictEqual(t.log, { alerts: ['Week 2 is future-dated. Enable Local Test: Allow Future Scores to enter test scores.'], confirms: 0, writes: 0, queries: 0 }, fn + ' locked: message only, no query/confirm/write');
    t = sctx(true);
    await t.c[fn](arg);
    assert.strictEqual(t.log.alerts.length, 0, fn + ' unlocked: no lock message'); assert(t.log.confirms >= 1 && t.log.writes === 0, fn + ' reaches its normal confirm (cancelled here, so nothing written)');
  }
  // the Back 9 / Week 1 seed is unaffected on 10/1
  const t2 = sctx(false); await t2.c.seedPostSeasonTestScores(2);
  assert.strictEqual(t2.log.alerts.length, 0, 'seed 2 (9/29) is not locked'); assert(t2.log.confirms >= 1);

  // buttons: tagged, disabled with the message, in the grid build; nothing is written there
  for (const w of ['1', '2', 'gallus']) assert(new RegExp('<button data-seed="' + w + '" onclick="seedPostSeason').test(src), 'button tagged ' + w);
  const sa = src.indexOf('// Seed actions write scores, so they are locked'), sb = src.indexOf('if (blockFutureScores) {\n    // Always disable score inputs');
  const sblock = src.slice(sa, sb);
  assert(sa > 0 && sb > sa && /isPostSeason/.test(sblock) && /psSeedLock\(btn\.dataset\.seed, entryState, todayInt, futureScoreOverrideEnabled\(\)\)/.test(sblock) && /btn\.disabled = lk\.locked/.test(sblock));
  assert(!/serverRun|db\.run|INSERT|UPDATE|DELETE|saveDBToServer/.test(sblock), 'locking the buttons writes nothing');
  assert(/BLOCKED future-dated score/.test(fs.readFileSync(__dirname + '/../app.py', 'utf8')), 'server backstop still present');
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
// wiring: inside buildEntryGrid, post-season only, driven by the override, disables only the locked nine's inputs, writes nothing
const a = src.indexOf('// Post season: lock any future-dated week'), b = src.indexOf('if (blockFutureScores) {\n    // Always disable score inputs');
assert(a > 0 && b > a, 'lock block present before the existing future block');
const block = src.slice(a, b);
assert(/isPostSeason && !blockFutureScores/.test(block) && /psFutureLockedNines\(entryState, todayInt, futureScoreOverrideEnabled\(\)\)/.test(block));
assert(/inp\.disabled = true/.test(block) && /hi < 9 \? 'Front' : 'Back'/.test(block) && /psFutureLockMessage\(locked\)/.test(block));
assert(!/serverRun|db\.run|INSERT|UPDATE|DELETE|saveDBToServer/.test(block), 'the lock never writes anything');
// the checkbox still rebuilds the grid so the lock refreshes, and the server-side block is untouched
assert(/buildEntryGrid\(\);\n\}/.test(src.slice(src.indexOf('function toggleFutureScoreOverride'), src.indexOf('async function pingFutureOverride'))));
assert(/BLOCKED future-dated score/.test(fs.readFileSync(__dirname + '/../app.py', 'utf8')), 'server backstop still present');
