// Regression test: the Skins tab on a post-season date.
//  * pots use the week's PAID-AND-SCORED players ($7 Skins, $3 CTP); paid no-shows are in neither pot
//  * the week panel shows the money walk ($10 x entries = Skins + CTP + pending refunds), the whole-dollar result and the
//    "remainder to Skins kitty" for each state: preview / calculated / needs Restate / not recorded / stale
//  * viewing NEVER writes (no serverRun, no save): the remainder is recorded only by an officer's Calculate / Restate
//  * week 1 and week 2 never mix
// Week 1 = 9/29/2026 (Back 9): 23 payers = 19 paid-and-scored + 4 confirmed no-shows. Week 2 = 10/6/2026 (Front 9).
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

const scored1 = Array.from({ length: 19 }, (_, i) => 'Play' + String(i + 1).padStart(2, '0'));        // week 1 paid-and-scored
const noShows = ['Dan Bowen', 'Jason Noble', 'Steve Bailey', 'Tim Franxman'];                          // week 1 paid, no score
const week2Only = ['Quinn A', 'Quinn B'];
const eoyRows = [
  ...scored1.map(p => ({ Player: p, Earned: p === 'Play01' ? 20 : 10, Comment: p === 'Play01' ? '(Both Weeks)' : '(1st Week)' })),
  ...noShows.map(p => ({ Player: p, Earned: 10, Comment: '(1st Week)' })),
  ...week2Only.map(p => ({ Player: p, Earned: 10, Comment: '(2nd Week)' })),
];
const holeRow = (p, h) => ({ Player: p, ...Object.fromEntries(h.map((g, i) => [String(i + 1), g])) });
const fours = Array(9).fill(4);
const scoresByDate = {
  20260929: scored1.map(p => holeRow(p, fours)),
  20261006: ['Play01', ...week2Only].map(p => holeRow(p, p === 'Quinn A' ? [3, 4, 4, 4, 4, 4, 4, 4, 4] : fours)),
};
const grossScored = { '20260929|Back': scored1, '20261006|Front': ['Play01', ...week2Only] };

let stored = {};      // date -> [{ID, Player, Detail, Earned, DatePaid}]
let rem = {};         // `${desc}|${detail}|${date}` -> { Earned, Comment }
const writes = [];
function query(sql, params = []) {
  if (/Detail='Refund'/.test(sql)) return [];
  if (/SELECT \* FROM SeasonSettings/.test(sql)) return [{ PostSeasonDt: '9/29/2026', PSWeek1Nine: 'Back', SkinsPS: 7, ClosestPS: 3, EOYSkins: 20, Course: 'X' }];
  if (/SELECT PSWeek2Dt/.test(sql)) return [];
  if (/SELECT DISTINCT Player FROM Scores/.test(sql)) return (grossScored[`${params[0]}|${params[1]}`] || []).map(Player => ({ Player }));
  let m;
  if ((m = sql.match(/FROM Scores WHERE Date=(\d+) AND League/))) return scoresByDate[m[1]] || [];
  if (/FROM Handicaps/.test(sql)) return [{ Hdcp: 0 }];
  if (/rowid AS ID/.test(sql)) return (stored[params[0]] || []).map(r => ({ ...r }));
  if (/SELECT CAST\(Earned AS REAL\) AS Earned, COALESCE\(Comment/.test(sql)) return rem[`${params[0]}|${params[1]}|${params[2]}`] ? [rem[`${params[0]}|${params[1]}|${params[2]}`]] : [];
  if (/SELECT DISTINCT p\.Player, p\.Detail/.test(sql)) return (stored[params[0]] || []).map(r => ({ ...r }));
  if (/FROM Payments/.test(sql) && /'EOY Skins'/.test(sql)) return eoyRows;
  return [];
}
const els = {};
const el = id => els[id] || (els[id] = { innerHTML: '', value: '', style: {}, textContent: '', appendChild(c) { this.innerHTML += c.innerHTML; } });
const seq = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ctx = vm.createContext({
  document: { getElementById: el, createElement: () => ({ innerHTML: '', style: {} }) },
  db: true, currentUser: { role: 'admin' }, query, parseInt, parseFloat, String, Set, Number, Math, Object, Array, JSON,
  PS_SKIN_REM_DETAIL: 'PS Skin Remainder', PS_EOY_REM_DETAIL: 'Skins Kitty Remainder',
  serverRun: (sql, params) => writes.push({ sql, params }), saveDBToServer: async () => { writes.push({ sql: 'SAVE' }); },
  courseData: { front: { hcps: seq, pars: fours }, back: { hcps: seq, pars: fours }, all18: {} }, loadCourse() {},
  toDateKey: v => String(v), syncCtpsToSkinsDate() {}, fmtDate: d => d, fmtMoney: v => '$' + Number(v).toFixed(2),
  tbody: id => { els[id] = { innerHTML: '', appendChild(c) { this.innerHTML += c.innerHTML; } }; return els[id]; },
});
['psMdyToInt', 'psAddDaysMdy', 'getSeasonSettings', 'getPostSeasonWeek1Nine', 'parsePostSeasonDates', 'getPostSeasonWeekForDate', 'getPostSeasonWeekEntry',
 'eoyWeeksFromComment', 'computeEoyGrossByWeek', 'getEoyRefundsByPlayer', 'getEoySkinPlayersForWeek', 'getEoySkinGrossPlayersForWeek',
 'getPostSeasonWeekNoShows', 'getEoyRefundedWeeks', 'psWeekSkinPayout', 'psWeekScorerRows', 'getPostSeasonWeekPotPlayers', 'psSkinFingerprint',
 'psWeekSkinState', 'psWeekPanelHtml', 'psNetHoles', 'psFindWinners', 'psComputeWeekWinners', 'loadSkins']
  .forEach(n => vm.runInContext(extract(n), ctx));
assert(/const PS_SKIN_REM_DETAIL = 'PS Skin Remainder'/.test(html) && /const PS_EOY_REM_DETAIL\s+= 'Skins Kitty Remainder'/.test(html), 'test constants match the app');

function load(date) {
  els.skinsDate = { value: date };
  writes.length = 0;
  vm.runInContext('loadSkins()', ctx);
  assert.strictEqual(writes.length, 0, 'viewing the Skins tab must never write anything');
  return { stats: els.skinStatBoxes.innerHTML, panel: els.psWeekPanel.innerHTML, winners: els.skinWinners.innerHTML, parts: els.skinsParticipants.innerHTML };
}
const row = (ID, Player, Detail, Earned, DatePaid = '') => ({ ID, Player, Detail, Earned, DatePaid });

// ================= Week 1 (9/29), the real situation: 3 stored UNPAID winner rows at $44.33 -> needs Restate
stored = { 20260929: [row(1, 'Play01', '#10', 44.33), row(2, 'Play02', '#13', 44.33), row(3, 'Play03', '#17', 44.33)] };
let r = load('20260929');
assert(/>19<\/div><div class="lbl">Players In/.test(r.stats), 'Players In = 19 paid-and-scored (not 23 payers)');
assert(/\$133<\/div><div class="lbl">Skin Pot/.test(r.stats), 'Skins pot = 19 x $7');
assert(/\$57<\/div><div class="lbl">CTP Pot/.test(r.stats), 'CTP pot = 19 x $3');
assert(r.panel.includes('Entries paid: <b>23</b> × $10 = <b>$230</b>'), r.panel);
assert(r.panel.includes('Skins pot: 19 paid-and-scored × $7 = <b>$133</b>'));
assert(r.panel.includes('CTP pot: 19 paid-and-scored × $3 = <b>$57</b>'));
assert(r.panel.includes('Pending refunds: 4 × $10 = <b>$40</b>'), 'pending refunds are outside both pots');
noShows.forEach(n => assert(r.panel.includes(n), n + ' listed as a pending refund'));
assert(!/Check:/.test(r.panel), '19 + 4 = 23 entries are all accounted for');
assert(/STORED AMOUNTS ARE NOT WHOLE DOLLARS/.test(r.panel) && /\$44\.33/.test(r.panel));
assert(/Whole-dollar result: \$44 each = \$132/.test(r.panel) && /remainder \$1 → Skins kitty/.test(r.panel));
assert(/psSkinCommit\(2026,1,'restate'\)/.test(r.panel), 'officer sees the Restate button');
assert(/\$44\.33/.test(r.winners), 'stored (official) amounts are shown as stored until an officer restates');
// participants = paid-and-scored only
assert(r.parts.includes('Play01') && !noShows.some(n => r.parts.includes(n)) && !r.parts.includes('Quinn A'));

// a non-officer sees no buttons
ctx.currentUser = { role: 'player' };
assert(!/psSkinCommit/.test(load('20260929').panel), 'players get no Calculate/Restate buttons');
ctx.currentUser = { role: 'admin' };

// paid rows: no Restate button, reason shown
stored = { 20260929: [row(1, 'Play01', '#10', 44.33, '9/30/2026'), row(2, 'Play02', '#13', 44.33), row(3, 'Play03', '#17', 44.33)] };
r = load('20260929');
assert(!/psSkinCommit/.test(r.panel) && /already paid/.test(r.panel), 'a paid row blocks the restate');

// ================= Payouts stored in whole dollars but the remainder not recorded yet
stored = { 20260929: [row(1, 'Play01', '#10', 44), row(2, 'Play02', '#13', 44), row(3, 'Play03', '#17', 44)] };
rem = {};
r = load('20260929');
assert(/PAYOUTS STORED, REMAINDER NOT RECORDED/.test(r.panel) && /remainder <b>\$1<\/b>/.test(r.panel));
assert(/psSkinCommit\(2026,1,'calculate'\)/.test(r.panel));

// ================= Calculated: both ledger rows present and matching -> official
const fp = 'players=19;pot=133;skins=3;each=44;rem=1';
rem = { 'Skin|PS Skin Remainder|20260929': { Earned: 1, Comment: fp }, 'EOY Skins|Skins Kitty Remainder|20260929': { Earned: 1, Comment: fp } };
r = load('20260929');
assert(/CALCULATED/.test(r.panel) && /Remainder to Skins kitty: \$1<\/b> \(recorded\)/.test(r.panel), r.panel);
assert(!/psSkinCommit/.test(r.panel), 'nothing left to do once calculated');
assert.strictEqual((r.winners.match(/\$44\.00/g) || []).length, 3);
assert.strictEqual(ctx.psWeekSkinState(2026, 1).recorded, true);

// ================= Stale: pot changed after it was recorded (e.g. a late score) -> not counted, recalculation offered
stored = { 20260929: [row(1, 'Play01', '#10', 44), row(2, 'Play02', '#13', 44)] };     // 2 skins now -> $66 each, rem 1... fingerprint differs
r = load('20260929');
assert(/OUT OF DATE/.test(r.panel) && /counts as \$0/.test(r.panel));
assert.strictEqual(ctx.psWeekSkinState(2026, 1).recorded, false);

// ================= Zero outright winners, calculated: the whole $133 is the remainder
stored = {};
const fp0 = 'players=19;pot=133;skins=0;each=0;rem=133';
rem = { 'Skin|PS Skin Remainder|20260929': { Earned: 133, Comment: fp0 }, 'EOY Skins|Skins Kitty Remainder|20260929': { Earned: 133, Comment: fp0 } };
r = load('20260929');
assert(/CALCULATED/.test(r.panel) && /\$133<\/b> \(recorded\)/.test(r.panel) && /whole week's Skins pot is in the kitty/.test(r.panel));

// ================= Week 2 (10/6): DIFFERENT players, pots and winners; preview (nothing stored)
stored = { 20260929: [row(1, 'Play01', '#10', 44.33)] };
rem = {};
r = load('20261006');
assert(/>3<\/div><div class="lbl">Players In/.test(r.stats), 'week 2: Play01 + 2 week-2-only players');
assert(/\$21<\/div><div class="lbl">Skin Pot/.test(r.stats) && /\$9<\/div><div class="lbl">CTP Pot/.test(r.stats));
assert(r.panel.includes('Entries paid: <b>3</b> × $10 = <b>$30</b>'));
assert(!/Pending refunds/.test(r.panel), 'week 2 has no no-shows');
assert(/PREVIEW - not calculated/.test(r.panel) && /calculates itself as soon as every paid player has all 9 holes scored/.test(r.panel));
assert(/1 outright skin × \$21 \(whole dollars\) = \$21/.test(r.panel) && /remainder \$0/.test(r.panel), r.panel);
assert(r.winners.includes('Quinn A') && r.winners.includes('PREVIEW - calculates automatically'));
assert(!r.winners.includes('Play01') && !r.parts.includes('Play02'), 'week 1 data never appears in week 2');
noShows.forEach(n => assert(!r.parts.includes(n) && !r.panel.includes(n)));

console.log('ok');
