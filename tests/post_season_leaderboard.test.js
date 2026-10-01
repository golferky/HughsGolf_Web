// Regression test: the live Post-Season Prize Breakdown leaderboard must show running
// scores (not blank "Net — / —") before a player has finished both nines.
// Run: node tests/post_season_leaderboard.test.js
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

const panel = { style: {}, innerHTML: '' };
const grid = { dataset: { postSeasonSeason: '2026' } };
const document = { getElementById: id => id === 'psBreakdownPanel' ? panel : id === 'entryGrid' ? grid : null };
const nine = { nums: Array.from({ length: 18 }, (_, i) => i + 1), hcps: Array.from({ length: 18 }, (_, i) => i + 1) };
const blank = () => Array(18).fill('');
const holes = (back, front) => { const h = blank(); back.forEach((v, i) => h[9 + i] = String(v)); (front || []).forEach((v, i) => h[i] = String(v)); return h; };

const entryState = {
  a: { regular: 'Low Net', phdcp: 4, inSkins: true, holes: holes([4, 4, 4, 4, 4, 4, 4, 4, 4]) },       // back 9 only, gross 36 net 32
  b: { regular: 'High Net', phdcp: 4, inSkins: true, holes: holes([5, 5, 5, 5, 5, 5, 5, 5, 5]) },      // back 9 only, gross 45 net 41
  c: { regular: 'Full Round', phdcp: 4, inSkins: true, holes: holes([5, 5, 5, 5, 5, 5, 5, 5, 5], [5, 5, 5, 5, 5, 5, 5, 5, 5]) }, // gross 90 net 82
  d: { regular: 'No Scores', phdcp: 4, inSkins: true, holes: blank() },
};

const ctx = vm.createContext({
  document, window: {}, entryState, parseInt, parseFloat, Math, Object, Array,
  courseData: { all18: nine },
  getSeasonSettings: () => ({ SkinsPS: 7, ClosestPS: 3 }),
  ccRosterEligible: () => true, psRefundPanelHtml: () => '',
});
['psLeaderboardRanks', 'psLeaderboardShotsBack', 'psWeekSkinPayout', 'getPostSeasonEntryTotals', 'renderPostSeasonBreakdown'].forEach(n => vm.runInContext(extract(n), ctx));
vm.runInContext('renderPostSeasonBreakdown(courseData.all18)', ctx);
const out = panel.innerHTML;

// 1. Partial-round players show real running scores, not dashes
assert(/Net 32 <span[^>]*>\/ 36/.test(out), 'Low Net should show Net 32 / 36');
assert(/Net 41 <span[^>]*>\/ 45/.test(out), 'High Net should show Net 41 / 45');
assert(/Net 82 <span[^>]*>\/ 90/.test(out), 'Full Round should show Net 82 / 90');
// 2. Only the player with no scores has dashes
assert.strictEqual((out.match(/Net — <span/g) || []).length, 1);
// 3. Order: completed round first, then partial rounds by running net, blanks last
const order = ['Full Round', 'Low Net', 'High Net', 'No Scores'].map(n => out.indexOf(n));
assert(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), 'unexpected leaderboard order: ' + order);

console.log('ok');
