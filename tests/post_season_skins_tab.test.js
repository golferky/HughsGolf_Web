// Regression test: each post-season week is independent ($10 per week entered = $7 skins + $3 CTP).
// The Skins tab for a post-season date must use only THAT week's EOY Skins payers, that week's
// pots and that week's winners; week 1 and week 2 must never mix.
// Run: node tests/post_season_skins_tab.test.js
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

// Season 2026: week 1 = 9/22, week 2 = 9/29.
//  Ann: both weeks ($20 untagged). Ben: week 1 only. Cy: week 2 only. Dee: week 2 only.
const eoyRows = [
  { Player: 'Ann', Earned: 20, Comment: '' },
  { Player: 'Ben', Earned: 10, Comment: '(1st Week)' },
  { Player: 'Cy', Earned: 10, Comment: '(2nd Week)' },
  { Player: 'Dee', Earned: 10, Comment: '(2nd Week)' },
];
const winnersByDate = {
  20260922: [{ Player: 'Ann', Detail: '#3', Earned: 44, Comment: '' }, { Player: 'Ben', Detail: '#5', Earned: 44, Comment: '' }],
  20260929: [{ Player: 'Dee', Detail: '#11', Earned: 44, Comment: '' }],
};
function query(sql, params = []) {
  if (/Detail='Refund'/.test(sql)) return [];
  if (/SELECT \* FROM SeasonSettings/.test(sql)) return [{ PostSeasonDt: '9/22/2026', SkinsPS: 7, ClosestPS: 3, EOYSkins: 20 }];
  if (/SELECT PSWeek2Dt/.test(sql)) return [];
  if (/FROM Payments/.test(sql) && /'EOY Skins'/.test(sql)) return eoyRows;
  if (/SELECT Player, Detail FROM Payments WHERE/.test(sql))
    return (winnersByDate[params[0]] || []).map(w => ({ Player: w.Player, Detail: w.Detail }));
  if (/SELECT DISTINCT p\.Player, p\.Detail/.test(sql)) {
    assert(!/Date IN \(/.test(sql), 'winner query must be for a single date');
    return winnersByDate[params[0]] || [];
  }
  if (/GROUP BY p\.Player/.test(sql)) return [];
  return [];
}

const els = {};
const el = id => els[id] || (els[id] = { innerHTML: '', value: '', style: {}, textContent: '', appendChild(c) { this.innerHTML += c.innerHTML; } });
const document = { getElementById: el, createElement: () => ({ innerHTML: '', style: {} }) };
const ctx = vm.createContext({
  document, db: true, currentUser: null, query, parseInt, parseFloat, String, Set, Number, Math,
  toDateKey: v => String(v), syncCtpsToSkinsDate() {},
  fmtMoney: v => '$' + Number(v).toFixed(2), tbody: id => { els[id] = { innerHTML: '', appendChild(c) { this.innerHTML += c.innerHTML; } }; return els[id]; },
});
['psMdyToInt', 'psAddDaysMdy', 'getSeasonSettings', 'getPostSeasonWeekForDate', 'parsePostSeasonDates', 'getPostSeasonWeekEntry', 'computeEoyGrossByWeek', 'getEoyRefundsByPlayer', 'getEoySkinPlayersForWeek', 'loadSkins']
  .forEach(n => vm.runInContext(extract(n), ctx));

function load(date) {
  els.skinsDate = { value: date };
  vm.runInContext('loadSkins()', ctx);
  return { stats: els.skinStatBoxes.innerHTML, winners: els.skinWinners.innerHTML, parts: els.skinsParticipants.innerHTML };
}

// ---- Week 1 (9/22): Ann + Ben = 2 players -> $14 skins, $6 CTP; 2 skins won -> $7.00 each
const w1 = load('20260922');
assert(/>2<\/div><div class="lbl">Players In/.test(w1.stats), 'week 1 Players In should be 2');
assert(/\$14<\/div><div class="lbl">Skin Pot/.test(w1.stats), 'week 1 Skin Pot should be 2 x $7');
assert(/\$6<\/div><div class="lbl">CTP Pot/.test(w1.stats), 'week 1 CTP Pot should be 2 x $3');
assert(w1.winners.includes('Ann') && w1.winners.includes('Ben') && !w1.winners.includes('Dee'), 'week 1 winners only');
assert.strictEqual((w1.winners.match(/\$7\.00/g) || []).length, 2);
['Ann', 'Ben'].forEach(n => assert(w1.parts.includes(n), n + ' should be a week 1 participant'));
['Cy', 'Dee'].forEach(n => assert(!w1.parts.includes(n), n + ' must not be a week 1 participant'));

// ---- Week 2 (9/29): Ann + Cy + Dee = 3 players -> $21 skins, $9 CTP; 1 skin won -> $21.00
const w2 = load('20260929');
assert(/>3<\/div><div class="lbl">Players In/.test(w2.stats), 'week 2 Players In should be 3');
assert(/\$21<\/div><div class="lbl">Skin Pot/.test(w2.stats), 'week 2 Skin Pot should be 3 x $7');
assert(/\$9<\/div><div class="lbl">CTP Pot/.test(w2.stats), 'week 2 CTP Pot should be 3 x $3');
assert(w2.winners.includes('Dee') && !w2.winners.includes('Ann') && !w2.winners.includes('Ben'), 'week 2 winners only');
assert.strictEqual((w2.winners.match(/\$21\.00/g) || []).length, 1);
['Ann', 'Cy', 'Dee'].forEach(n => assert(w2.parts.includes(n), n + ' should be a week 2 participant'));
assert(!w2.parts.includes('Ben'), 'Ben (week 1 only) must not be a week 2 participant');
assert(!/\$44/.test(w1.winners + w2.winners), 'stale stored amounts must not be shown');

console.log('ok');
