// Regression test: the entry-screen Post-Season Prize Breakdown shows ONE selected week —
// that week's players, $7 Skins pot, $3 CTP pot, winners and payouts. Weeks never mix.
// Run: node tests/post_season_breakdown.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'HughsGolf.html'), 'utf8');
function extract(name) {
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, `function ${name} not found`);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start, i + 1);
}

const slot = (name, w1, w2, holes) => ({ regular: name, sub: null, active: name, inSkins: w1 || w2, inSkinsW1: w1, inSkinsW2: w2, phdcp: 0, holes });
const blank = () => Array(9).fill('');
const fours = () => Array(9).fill('4');
function build(week1Fb) {
  // Front = idx 0-8, Back = idx 9-17. Ann both weeks, Ben week 1 only, Cy + Dee week 2 only.
  const F = { ann: [3,3,5,4,4,4,4,4,4], ben: [4,4,4,4,4,4,4,4,4] };   // week-1 nine (Ann wins 1,2; Ben wins 3)
  const B = { ann: fours(), cy: fours(), dee: [3,4,4,4,4,4,4,4,4] };  // week-2 nine (Dee wins the first hole)
  const w1 = { ann: F.ann.map(String), ben: F.ben.map(String) }, w2 = { ann: B.ann, cy: B.cy, dee: B.dee.map(String) };
  const pack = (a, b) => week1Fb === 'Front' ? [...a, ...b] : [...b, ...a];
  return {
    _psWeek1Fb: week1Fb,
    A: slot('Ann', true, true, pack(w1.ann, w2.ann)),
    B: slot('Ben', true, false, pack(w1.ben, blank())),
    C: slot('Cy', false, true, pack(blank(), w2.cy)),
    D: slot('Dee', false, true, pack(blank(), w2.dee)),
    E: slot('Eve', true, true, pack(blank(), blank())),     // paid both weeks but has NO score: in neither pot
  };
}

const panel = { style: {}, innerHTML: '' };
const grid = { dataset: { postSeasonSeason: '2026' } };
const els = { psBreakdownPanel: panel, entryGrid: grid };
const ctx = vm.createContext({
  window: {}, document: { getElementById: id => els[id] },
  parseInt, parseFloat, String, Set, Math, Number, Object, Array,
  getSeasonSettings: () => ({ SkinsPS: 7, ClosestPS: 3 }),
  ccRosterEligible: () => false, psRefundPanelHtml: () => '', entryState: {}, courseData: { all18: {} },
});
['psWeekForHoleIndex', 'psWeekSkinPayout', 'getPostSeasonEntryTotals', 'renderPostSeasonBreakdown']
  .forEach(n => vm.runInContext(extract(n), ctx));
const nine = { nums: Array.from({ length: 18 }, (_, i) => i + 1), hcps: [...Array(2)].flatMap(() => [1,2,3,4,5,6,7,8,9]) };

function render(week, week1Fb = 'Front') {
  ctx.entryState = build(week1Fb);
  ctx.window._psBreakdownWeek = week;
  ctx.window._psSummaryOpen = 'players';
  vm.runInContext('renderPostSeasonBreakdown(nine)', Object.assign(ctx, { nine }));
  const out = panel.innerHTML;
  return {
    out,
    players: out.split('Players Entered')[1].split('🏆 Leaderboard')[0],
    skins: out.split('Skins Results')[1] || '',
  };
}
const stat = (out, label) => (out.match(new RegExp(`>\\$?(\\d+)</div>\\s*<div[^>]*>${label}`)) || [])[1];

// ---- Week 1 (Front): Ann + Ben paid-and-scored -> $14 skins, $6 CTP (Eve paid, no score: in neither pot);
//      3 skins won -> $4 each whole dollars, $2 remainder preview
let r = render(1);
assert.strictEqual(stat(r.out, 'Skins Pot'), '14');
assert.strictEqual(stat(r.out, 'CTP Pot'), '6');
assert.strictEqual(stat(r.out, 'Players In'), '2');
assert(/2 Players Entered/.test(r.out));
assert(/1 paid player with no score yet/.test(r.out), 'Eve is reported as paid but not scored');
assert(!r.players.includes('Eve'), 'Eve is not counted in the pot players');
assert.strictEqual(stat(r.out, 'Remainder → Skins kitty \\(preview\\)'), '2');
['Ann', 'Ben'].forEach(n => assert(r.players.includes(n)));
['Cy', 'Dee'].forEach(n => assert(!r.players.includes(n), n + ' is not in week 1'));
assert(/Week 1 Skins Results \(Front 9\)/.test(r.out));
assert.strictEqual((r.skins.match(/\$4\.00/g) || []).length, 3, 'three week-1 skins at $4 (whole dollars)');
assert(!/\$4\.67/.test(r.out), 'no cents payouts');
assert(r.skins.includes('Ben') && !r.skins.includes('Dee') && !r.skins.includes('Cy'), 'week 1 winners only');
assert(!/\$21\.00/.test(r.out) && !/\$8\.75/.test(r.out), 'no week 2 / combined values');

// ---- Week 2 (Back): Ann + Cy + Dee -> $21 skins, $9 CTP, 1 skin = $21.00, no remainder
r = render(2);
assert.strictEqual(stat(r.out, 'Skins Pot'), '21');
assert.strictEqual(stat(r.out, 'CTP Pot'), '9');
assert.strictEqual(stat(r.out, 'Players In'), '3');
['Ann', 'Cy', 'Dee'].forEach(n => assert(r.players.includes(n)));
assert(!r.players.includes('Ben'), 'Ben is not in week 2');
assert(!r.players.includes('Eve'), 'Eve (paid, no score) is not a week 2 pot player');
assert.strictEqual(stat(r.out, 'Remainder → Skins kitty \\(preview\\)'), '0');
assert(/Week 2 Skins Results \(Back 9\)/.test(r.out));
assert.strictEqual((r.skins.match(/\$21\.00/g) || []).length, 1);
assert(r.skins.includes('Dee') && !r.skins.includes('Ben') && !r.skins.includes('Ann'), 'week 2 winners only');

// ---- PSWeek1Nine = Back: week 1 is the Back 9; each week still keeps its own players and pot
r = render(1, 'Back');
assert(/Week 1 Skins Results \(Back 9\)/.test(r.out));
assert.strictEqual(stat(r.out, 'Skins Pot'), '14');
assert.strictEqual((r.skins.match(/\$4\.00/g) || []).length, 3);
r = render(2, 'Back');
assert(/Week 2 Skins Results \(Front 9\)/.test(r.out));
assert.strictEqual(stat(r.out, 'Skins Pot'), '21');
assert(r.skins.includes('Dee') && !r.skins.includes('Ben'));

console.log('ok');
