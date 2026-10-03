// The post-season Scores table must put Back 9 scores under Back and Front 9 scores under Front, even when the grid shows the
// Back 9 first (Week 1 = Back 9): it used to read the inputs in screen order and so swapped the nines.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const inp = (hi, v) => ({ dataset: { hi: String(hi) }, value: String(v) });
// a row's inputs in SCREEN order for a back-first season: holes 10-18 (hi 9..17) then holes 1-9 (hi 0..8)
const backFirst = (back, front) => [...back.map((v, i) => inp(9 + i, v)), ...front.map((v, i) => inp(i, v))];
const frontFirst = (front, back) => [...front.map((v, i) => inp(i, v)), ...back.map((v, i) => inp(9 + i, v))];
const nines = (g) => Array(9).fill(g / 9);                 // 9 holes totalling g (g divisible by 9)
function run(rowInputs, phdcp = 4) {
  const tr = { dataset: { slotkey: 'k1' }, querySelectorAll: () => rowInputs };
  const c = vm.createContext({ document: { querySelectorAll: () => [tr] }, entryGridLooksPostSeason: () => true, entryState: { k1: { active: 'Brad Pierce', phdcp, holes: Array(18).fill('') } }, parseInt, Number, Array, Object, String });
  vm.runInContext(extract('getPostSeasonEntryTotals') + extract('collectVisiblePostSeasonScoreRows'), c);
  return JSON.parse(JSON.stringify(c.collectVisiblePostSeasonScoreRows()));
}

// Week 1 = Back 9 only (the bug): 37 on the Back 9 shown FIRST on screen; Front 9 empty
const w1 = run(backFirst([4, 4, 4, 4, 4, 4, 4, 4, 5], Array(9).fill('')))[0];     // gross 37
assert.strictEqual(w1.BackGross, 37, 'the Back 9 score lands under Back');
assert.strictEqual(w1.BackNet, 33); assert.strictEqual(w1.FrontGross, null, 'Front stays empty'); assert.strictEqual(w1.FrontNet, null);
assert.strictEqual(w1.FrontBack, 'Back'); assert.strictEqual(w1.Rounds, 1);

// both nines, back-first screen order: each nine under its own column, 18-hole totals correct
const both = run(backFirst([4, 4, 4, 4, 4, 4, 4, 4, 5], [5, 5, 5, 5, 5, 5, 5, 5, 5]))[0];      // Back 37, Front 45
assert.strictEqual(both.BackGross, 37); assert.strictEqual(both.FrontGross, 45); assert.strictEqual(both.Gross, 82); assert.strictEqual(both.Net, 74);
assert.strictEqual(both.FrontBack, 'Front+Back'); assert.strictEqual(both.Rounds, 2);

// Week 2 = Front 9 only in a back-first season: stays Front
const w2 = run(backFirst(Array(9).fill(''), [5, 5, 5, 5, 5, 5, 5, 5, 5]))[0];
assert.strictEqual(w2.FrontGross, 45); assert.strictEqual(w2.BackGross, null);

// front-first seasons (screen order = hole order) are unchanged
const ff = run(frontFirst([5, 5, 5, 5, 5, 5, 5, 5, 5], [4, 4, 4, 4, 4, 4, 4, 4, 5]))[0];
assert.strictEqual(ff.FrontGross, 45); assert.strictEqual(ff.BackGross, 37);
// an input without a hole index falls back to its screen position (old behaviour), never throws
const legacy = run([...Array(9)].map((_, i) => ({ dataset: {}, value: '4' })).concat([...Array(9)].map(() => ({ dataset: {}, value: '' }))))[0];
assert.strictEqual(legacy.FrontGross, 36);
// the source no longer maps inputs by screen order
assert(!/const holes = inputs\.map\(inp => \(inp\.value \|\| ''\)\.trim\(\)\);/.test(src), 'no screen-order mapping left');
console.log('ok');
