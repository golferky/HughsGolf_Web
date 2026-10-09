// Gallus import: a round that already matches the scorecard is auto-reconciled; anything else is imported to the queue and flagged
// (with the holes that differ) so the admin can check with the scorekeeper.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
let sheet = {}; let boom = false;
const ctx = vm.createContext({ String, parseInt, Array, isDatePostSeason: d => d === '20261006', gallusExistingNine: (n, d, fb, ps) => { if (boom) throw new Error('db'); return sheet[n] || null; } });
['gallusCompareScores', 'gallusMatchFlag'].forEach(n => vm.runInContext(extract(n), ctx));
const g = [4, 4, 5, 3, 4, 4, 4, 3, 5];
sheet = { Ann: ['4', '4', '5', '3', '4', '4', '4', '3', '5'], Bo: ['4', '5', '5', '3', '4', '4', '4', '3', '5'] };
assert.strictEqual(ctx.gallusMatchFlag('Ann', '20260929', 'Front', g), 1, 'identical -> reconciled');
assert.strictEqual(ctx.gallusMatchFlag('Bo', '20260929', 'Front', g), 0, 'a hole differs -> not reconciled');
assert.strictEqual(ctx.gallusMatchFlag('Cy', '20260929', 'Front', g), 0, 'nothing on the sheet -> to be imported, not reconciled');
boom = true; assert.strictEqual(ctx.gallusMatchFlag('Ann', '20260929', 'Front', g), 0, 'a lookup problem never auto-reconciles');
// both insert paths use the flag, and the officer path reports it
assert((src.match(/gallusMatchFlag\(resolvedName, today, frontBack, h\)/g) || []).length === 2, 'Fetch & Import and Import All Pending both auto-reconcile');
assert(!/\n\s*0, sentBy\n/.test(src.slice(src.indexOf('async function _doGallusImportCommit'), src.indexOf('async function _doGallusImportCommit') + 6000)), 'no hard-coded Reconciled=0 left in the officer path');
assert(/all \$\{autoReconciled\.length\} already match the scorecard \(auto-reconciled\)/.test(src) && /not matching the scorecard yet \(see the Gallus Queue\)/.test(src), 'toast says what happened');
// the queue shows the differing holes and who to ask
const q = src.slice(src.indexOf('Already some scores on the scorecard for this player and night'), src.indexOf('Already some scores on the scorecard for this player and night') + 1500);
assert(/_cmp\.status === 'different'/.test(q) && /Differs from the scorecard/.test(q) && /Check with the scorekeeper/.test(q) && /sheet \$\{d\.sheet\} → Gallus \$\{d\.gallus\}/.test(q));
assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
console.log('ok');
