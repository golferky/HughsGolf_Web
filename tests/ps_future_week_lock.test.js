// Post-season: a future-dated week's score fields are disabled unless LOCAL TEST: ALLOW FUTURE SCORES is on (display only).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const ctx = vm.createContext({ parseInt, Set });
['psFutureLockedNines', 'psFutureLockMessage'].forEach(n => vm.runInContext(extract(n), ctx));
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
console.log('ok');
