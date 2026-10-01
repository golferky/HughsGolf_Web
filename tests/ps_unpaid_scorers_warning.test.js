// Regression test: the "players have scores but haven't paid in" warning (warnIfUnpaidScorers) on POST-SEASON nights.
// Post-season is paid through EOY Skins (tagged to a week), not per-night Skin/CTP rows, so a paid EOY player on
// 9/29 (Week 1) or 10/6 (Week 2) must NOT be flagged. Regular-season nights keep the per-night payment rule unchanged.
// Run: node tests/ps_unpaid_scorers_warning.test.js
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

// Season 2026: Week 1 = 9/29 (Back 9), Week 2 = 10/6 (Front 9); 9/22 is a regular-season night.
//  Ann paid both weeks; Ben Week 1 only; Cy Week 2 only; Dee Week 1 only; Eve and Fay never paid EOY.
const eoyRows = [
  { Player: 'Ann', Earned: 20, Comment: '(Both Weeks)' }, { Player: 'Ben', Earned: 10, Comment: '(1st Week)' },
  { Player: 'Cy', Earned: 10, Comment: '(2nd Week)' }, { Player: 'Dee', Earned: 10, Comment: '(1st Week)' },
];
let refundRows = [];
const scoresByDate = {
  20260922: ['Ann', 'Zed'],                      // regular season: Ann has a per-night payment, Zed does not
  20260929: ['Ann', 'Ben', 'Dee', 'Eve'],        // Week 1: Eve never paid
  20261006: ['Ann', 'Cy', 'Ben', 'Fay'],         // Week 2: Ben paid only Week 1; Fay never paid
};
const nightPayments = { 20260922: ['Ann'] };     // per-night Skin/CTP 'Payment' rows (regular season)
const writes = [];
function query(sql, params = []) {
  if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes.push(sql);
  if (/SELECT DISTINCT Player FROM Scores/.test(sql)) return (scoresByDate[params[1]] || []).map(Player => ({ Player }));
  if (/SELECT DISTINCT Player FROM Payments WHERE League=\? AND Date=\? AND Desc IN \('Skin','CTP'\)/.test(sql)) return (nightPayments[params[1]] || []).map(Player => ({ Player }));
  if (/Detail='Refund'/.test(sql)) return refundRows;
  if (/SELECT PostSeasonDt, EOYSkins as EoySkins FROM SeasonSettings/.test(sql)) return [{ PostSeasonDt: '9/29/2026', EoySkins: 20 }];
  if (/SELECT PSWeek2Dt/.test(sql)) return [];
  if (/SELECT \* FROM SeasonSettings/.test(sql)) return [{ PostSeasonDt: '9/29/2026', PSWeek1Nine: 'Back', SkinsPS: 7, ClosestPS: 3, EOYSkins: 20 }];
  if (/FROM Payments/.test(sql) && /'EOY Skins'/.test(sql)) return eoyRows;
  if (/SELECT DISTINCT Player, CAST\(Date AS INTEGER\) as D/.test(sql)) return [];
  return [];
}
let confirmText = null, confirmAnswer = true;
const ctx = vm.createContext({ query, parseInt, parseFloat, String, Set, Map, Number, Math, Object, Array, JSON,
  confirm: t => { confirmText = t; return confirmAnswer; } });
['psMdyToInt', 'psAddDaysMdy', 'getSeasonSettings', 'parsePostSeasonDates', 'getPostSeasonWeekForDate', 'getPostSeasonWeekEntry', 'eoyWeeksFromComment',
 'computeEoyGrossByWeek', 'getEoyRefundsByPlayer', 'getEoySkinPlayersForWeek', 'getPostSeasonContextForDate', 'warnIfUnpaidScorers']
  .forEach(n => vm.runInContext(extract(n), ctx));
const warn = date => { confirmText = null; const r = vm.runInContext(`warnIfUnpaidScorers(${date})`, ctx); return { result: r, text: confirmText }; };
const flagged = text => text ? text.split('\n').slice(2).filter(l => l && !/^The pot/.test(l)) : [];

// ---- Week 1 (9/29): paid EOY players Ann, Ben, Dee are NOT flagged; only Eve (never paid) is
let r = warn(20260929);
assert(r.text, 'a real unpaid scorer still triggers the warning');
assert.deepStrictEqual(flagged(r.text), ['Eve']);
assert(/1 player has scores but hasn't paid in/.test(r.text));

// ---- Week 2 (10/6): Ann + Cy paid Week 2; Ben paid only Week 1 and Fay never paid -> those two are flagged
r = warn(20261006);
assert.deepStrictEqual(flagged(r.text).sort(), ['Ben', 'Fay']);
assert(!/Ann|Cy/.test(r.text.split('\n').slice(2).join('\n')), 'paid Week 2 players are not listed');

// ---- A fully paid week: no popup at all, the action proceeds
scoresByDate[20260929] = ['Ann', 'Ben', 'Dee'];
r = warn(20260929);
assert.strictEqual(r.text, null, 'all scorers paid -> no popup'); assert.strictEqual(r.result, true);
scoresByDate[20261006] = ['Ann', 'Cy'];
r = warn(20261006);
assert.strictEqual(r.text, null); assert.strictEqual(r.result, true);

// ---- A refund removes the player from that week's paid pool (net of refunds)
refundRows = [{ Player: 'Dee', Date: 20260929, Earned: -10, Comment: 'Missed post-season week 1' }];
scoresByDate[20260929] = ['Ann', 'Dee'];
r = warn(20260929);
assert.deepStrictEqual(flagged(r.text), ['Dee'], 'refunded for the week -> no longer counted as paid in');
refundRows = [];

// ---- The user's answer is passed through (Cancel stops the action)
scoresByDate[20260929] = ['Eve']; confirmAnswer = false;
assert.strictEqual(warn(20260929).result, false, 'Cancel returns false'); confirmAnswer = true;

// ---- Regular season is unchanged: per-night Skin/CTP payment rows decide; an EOY payment does not count there
r = warn(20260922);
assert.deepStrictEqual(flagged(r.text), ['Zed'], 'Ann has a per-night payment; Zed does not');
nightPayments[20260922] = [];
r = warn(20260922);
assert.deepStrictEqual(flagged(r.text).sort(), ['Ann', 'Zed'], 'an EOY payment does not make a regular-season scorer "paid in"');

assert.strictEqual(writes.length, 0, 'the validation never writes');
assert(/getPostSeasonContextForDate\(date\)/.test(extract('warnIfUnpaidScorers')), 'post-season branch is in the warning only');
console.log('ok');
