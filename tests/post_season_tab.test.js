// Post Season tab: read-only Scores / Standings / Skins & CTPs / Earned built from the database through shared helpers.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name, pre = '') {
  const i = src.indexOf(pre + 'function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const plain = x => JSON.parse(JSON.stringify(x));
const ctx = vm.createContext({ Math, parseFloat, parseInt, String, Object, Array, JSON, Number, console, window: {}, courseData: null, loadCourse() {}, escapeHtml: x => String(x), fmtDate: d => d,
  ccRosterEligible: p => !/^Sub/.test(p), refreshTab() {}, document: { getElementById: () => null, querySelector: () => null }, getCurrentSeason: () => 2026,
  query: () => [{ Season: 2026 }, { Season: 2025 }] });
['psLeaderboardRanks', 'psLeaderboardShotsBack', 'psLeaderboardCcPotential', 'psCcPrizeSchedule', 'psCcMissedWeek', 'psTabSeasons', 'psTabSeason', 'psTabMoney', 'psTabFillYear', 'psTabHeader', 'psBoardBuild', 'psEarnedBuild'].forEach(n => vm.runInContext(extract(n), ctx));
const ps = { week1: 20260929, week2: 20261006 };
const sc = (p, D, g, n) => ({ Player: p, D, Gross: g, Net: n });

// Standings: both weeks needed, lowest total net wins, ties share a place, subs and missed weeks do not place
let b = ctx.psBoardBuild([sc('Ann', ps.week1, 40, 36), sc('Ann', ps.week2, 41, 37), sc('Bo', ps.week1, 39, 35), sc('Bo', ps.week2, 42, 38), sc('Cy', ps.week1, 38, 34), sc('Dee', ps.week1, 45, 40), sc('Dee', ps.week2, 42, 38), sc('Sub Sam', ps.week1, 30, 28), sc('Sub Sam', ps.week2, 30, 28)], ps, p => ctx.ccRosterEligible(p), 20261007);
assert.deepStrictEqual(plain(b.rows.map(r => r.name)), ['Sub Sam', 'Ann', 'Bo', 'Dee', 'Cy'], 'two-week players first, lowest net first; one-week player last');
assert.deepStrictEqual(plain(b.ranks), [null, 1, 1, 3, null], 'Ann and Bo tie at 73 -> T1, Dee 3rd; the sub and the player who missed week 2 do not place');
assert.strictEqual(b.rows.find(r => r.name === 'Cy').ccMissed, 2, 'Cy missed week 2, which is over');
assert.strictEqual(b.rows.find(r => r.name === 'Ann').runNet, 73);
// before week 2 is over, a one-week player is still in the running
b = ctx.psBoardBuild([sc('Cy', ps.week1, 38, 34)], ps, () => true, 20260930);
assert.strictEqual(b.rows[0].ccMissed, 0); assert.deepStrictEqual(plain(b.ranks), [1]);
// Earned: skins + CTP + championship + refunds, paid vs owed, everyone listed, richest first
const pay = [{ Player: 'Tom', d: 'Skin', t: '#15', e: 44, dp: '10/8/2026', D: ps.week1 }, { Player: 'Tom', d: 'CTP', t: '#12', e: 28, dp: '', D: ps.week1 },
  { Player: 'Ann', d: 'League Championship', t: 'Earned-1st', e: 100, dp: '', D: 20261231 }, { Player: 'Dan', d: 'EOY Skins', t: 'Refund', e: -10, dp: '10/8/2026', D: ps.week1 }];
const earned = ctx.psEarnedBuild(pay);
assert.deepStrictEqual(plain(earned.map(e => [e.name, e.total, e.paid, e.owed])), [['Ann', 100, 0, 100], ['Tom', 72, 44, 28], ['Dan', 10, 10, 0]]);
assert.strictEqual(earned.find(e => e.name === 'Dan').refund, 10, 'a refund shows as a positive amount');
// season picker
assert.strictEqual(ctx.psTabSeason(), 2026); ctx.window._psTabSeason = 2025; assert.strictEqual(ctx.psTabSeason(), 2025); ctx.window._psTabSeason = 1999; assert.strictEqual(ctx.psTabSeason(), 2026, 'unknown season falls back');
assert.strictEqual(ctx.psTabMoney(28), '$28.00');
// one Season dropdown for the whole tab (top bar), filled for the selected year; the screens no longer carry their own
const sel = { innerHTML: '', value: '', disabled: false };
ctx.document.getElementById = id => id === 'psYearSelect' ? sel : null;
const h = ctx.psTabHeader('Standings', 2025, 'note');
assert(/Post Season 2025 — Standings/.test(h) && !/<select/.test(h), 'screen header names the year, no dropdown of its own');
assert(/<option value="2026">2026<\/option><option value="2025">2025<\/option>/.test(sel.innerHTML) && sel.value === '2025' && sel.disabled === false, 'top dropdown lists the post-season years and shows the selected one');
assert(/<select id="psYearSelect" onchange="psTabSetSeason\(this\.value\)">/.test(src) && /data-group="postseason"[\s\S]{0,900}psYearSelect/.test(src), 'dropdown lives in the Post Season sub-tab bar');

// wiring: loaders registered, read-only, tabs and sections exist
const loaders = ['loadPsScores', 'loadPsStandings', 'loadPsSkins', 'loadPsEarned', 'psTabGather'].map(n => extract(n));
assert(!/serverRun|INSERT |DELETE |UPDATE /.test(loaders.join('\n')), 'the Post Season tab only reads');
['ps_scores:loadPsScores', 'ps_standings:loadPsStandings', 'ps_skins:loadPsSkins', 'ps_earned:loadPsEarned'].forEach(x => { const [t, f] = x.split(':'); assert(new RegExp(`tab === '${t}'\\) ${f}\\(\\)`).test(src), 'refreshTab calls ' + f); assert(src.includes(`id="tab-${t}"`) && src.includes(`data-tab="${t}"`), t); });
assert(/data-group="postseason">🏁 Post Season/.test(src), 'always-visible top tab (no season/date condition)');
assert(!/ADMIN_ONLY_TABS = new Set\([^)]*ps_/.test(src), 'every player can see all four screens');
assert(/psLeaderboardRanks\(rows, p => p\.roster && !p\.ccMissed\)/.test(extract('psBoardBuild')) && /psLeaderboardCcPotential\(board\.rows/.test(extract('loadPsStandings')), 'uses the shared leaderboard helpers');
console.log('ok');
