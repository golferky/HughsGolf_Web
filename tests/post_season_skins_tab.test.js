// Regression test: the Skins tab on a post-season night must build players/pots from EOY Skins
// buy-ins and pull skin winners from BOTH post-season weeks (not zeros from per-night payments).
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

// Season 2026: post season 9/22 (week 1) and 9/29 (week 2). 3 EOY payers, 3 skins won.
const eoyRows = ['Ann', 'Ben', 'Cy'].map(Player => ({ Player, Earned: 20, Comment: '' }));
let winnerSql = '';
function query(sql) {
  if (/SELECT \* FROM SeasonSettings/.test(sql)) return [{ PostSeasonDt: '9/22/2026', SkinsPS: 7, ClosestPS: 3, EOYSkins: 20 }];
  if (/SELECT PSWeek2Dt/.test(sql)) return [];
  if (/FROM Payments/.test(sql) && /'EOY Skins'/.test(sql)) return eoyRows;
  if (/SELECT Player, Detail FROM Payments WHERE Date IN/.test(sql))
    return [{ Player: 'Ann', Detail: '#11' }, { Player: 'Ann', Detail: '#12' }, { Player: 'Ben', Detail: '#3' }];
  if (/SELECT DISTINCT p\.Player, p\.Detail/.test(sql)) {
    winnerSql = sql;
    return [{ Player: 'Ben', Detail: '#3', Earned: 44, Comment: '' }, { Player: 'Ann', Detail: '#11', Earned: 44, Comment: '' },
            { Player: 'Ann', Detail: '#12', Earned: 44, Comment: '' }];
  }
  if (/GROUP BY p\.Player/.test(sql)) return [{ Player: 'Ann', skin_paid: null, ctp_paid: null }];
  return [];
}

const els = {};
const el = id => els[id] || (els[id] = { innerHTML: '', value: '', style: {}, textContent: '', appendChild(c) { this.innerHTML += c.innerHTML; } });
els.skinsDate = { value: '20260929' };
const document = { getElementById: el, createElement: () => ({ innerHTML: '', style: {} }) };
const ctx = vm.createContext({
  document, db: true, currentUser: null, query, parseInt, parseFloat, String, Set, Number, Math,
  toDateKey: v => String(v), syncCtpsToSkinsDate() {},
  fmtMoney: v => '$' + Number(v).toFixed(2), tbody: id => el(id),
});
['psMdyToInt', 'psAddDaysMdy', 'getSeasonSettings', 'parsePostSeasonDates', 'getEoySkinPlayersForWeek', 'loadSkins']
  .forEach(n => vm.runInContext(extract(n), ctx));
vm.runInContext('loadSkins()', ctx);

const stats = els.skinStatBoxes.innerHTML;
assert(/>3<\/div><div class="lbl">Players In/.test(stats), 'Players In should be 3 (EOY payers)');
assert(/\$21<\/div><div class="lbl">Skin Pot/.test(stats), 'Skin Pot should be 3 x $7');
assert(/\$9<\/div><div class="lbl">CTP Pot/.test(stats), 'CTP Pot should be 3 x $3');
// Winners span both weeks and use pot / skins won ($21 / 3 = $7.00), not the stale stored $44
assert(/Date IN \(20260922,20260929\)/.test(winnerSql), 'winner query must cover both post-season dates');
assert.strictEqual((els.skinWinners.innerHTML.match(/\$7\.00/g) || []).length, 3);
assert(!/\$44/.test(els.skinWinners.innerHTML));
// Participants list every EOY payer with skin + CTP amounts
const parts = els.skinsParticipants.innerHTML;
['Ann', 'Ben', 'Cy'].forEach(n => assert(parts.includes(n), n + ' missing from participants'));

console.log('ok');
