// Regression test: post-season no-show refunds are per week ($10 per week = $7 Skins + $3 CTP).
// A no-show = paid for that week, week has been played, no score for that week's nine.
// Run: node tests/post_season_refunds.test.js
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

// Week 1 = 9/22 (Front), week 2 = 9/29 (Back).
//  Ann both weeks, Ben week 1 only, Cy + Dee week 2 only, Fay both weeks.
const payments = [
  { Player: 'Ann', Earned: 20, Comment: '' }, { Player: 'Ben', Earned: 10, Comment: '(1st Week)' },
  { Player: 'Cy', Earned: 10, Comment: '(2nd Week)' }, { Player: 'Dee', Earned: 10, Comment: '(2nd Week)' },
  { Player: 'Fay', Earned: 20, Comment: '' },
];
let week1Fb = 'Front';
let scores = {};          // "date|fb" -> players with a score
let refundRows = [];      // { Player, Date, Earned, Comment }
const runs = [];
function query(sql, params = []) {
  if (/SELECT PSWeek2Dt/.test(sql)) return [];
  if (/FROM Payments/.test(sql) && /'EOY Skins'/.test(sql) && /Detail='Payment'/.test(sql) && /SUM/.test(sql))
    return [{ t: payments.filter(p => p.Player === params[0]).reduce((a, p) => a + p.Earned, 0) }];
  if (/FROM Payments/.test(sql) && /'EOY Skins'/.test(sql) && /Detail='Refund'/.test(sql) && /SUM/.test(sql))
    return [{ t: refundRows.filter(r => r.Player === params[0]).reduce((a, r) => a + r.Earned, 0) }];
  if (/FROM Payments/.test(sql) && /Detail='Refund'/.test(sql))
    return refundRows.filter(r => r.Player === params[0]).map(r => ({ Date: r.Date, Comment: r.Comment }));
  if (/FROM Payments/.test(sql) && /'EOY Skins'/.test(sql)) return payments;
  if (/FROM Scores/.test(sql)) return (scores[`${params[0]}|${params[1]}`] || []).map(Player => ({ Player }));
  return [];
}
const alerts = [];
const ctx = vm.createContext({
  query, parseInt, parseFloat, String, Set, Number, Math, Object, Array, db: true,
  currentUser: { role: 'admin' }, alert: m => alerts.push(m), confirm: () => true, courseData: { all18: {} },
  serverRun: (sql, params) => { runs.push({ sql, params }); if (/INSERT INTO Payments/.test(sql)) refundRows.push({ Player: params[0], Date: params[1], Earned: params[2], Comment: params[3] }); },
  SERVER_RUN_QUEUE: Promise.resolve(), saveDBToServer: async () => {}, renderPostSeasonBreakdown() {}, loadPrizeMoney() {},
  getSeasonSettings: () => ({ PostSeasonDt: '9/22/2026', PSWeek1Nine: week1Fb, EOYSkins: 20 }),
});
['psMdyToInt', 'psAddDaysMdy', 'parsePostSeasonDates', 'getPostSeasonWeek1Nine', 'getPostSeasonWeekForDate',
 'getEoySkinPlayersForWeek', 'getPostSeasonWeekNoShows', 'getEoyRefundedWeeks', 'planPostSeasonRefunds',
 'issuePostSeasonRefunds', 'psRefundPanelHtml', 'recalcPostSeasonEoyRefunds']
  .forEach(n => vm.runInContext((n === 'issuePostSeasonRefunds' ? 'async ' : '') + extract(n), ctx));

(async () => {
  // ---- Before anything is played: nobody is a no-show, no refunds offered
  let r = ctx.getPostSeasonWeekNoShows(2026, 1);
  assert.strictEqual(r.played, false); assert.deepStrictEqual(Array.from(r.noShows), []);
  assert(/no scores yet/.test(ctx.psRefundPanelHtml(2026, 1)));

  // ---- Week 1 played (Front): Ann + Fay scored; Ben did not. Week 2 not played yet.
  scores['20260922|Front'] = ['Ann', 'Fay'];
  r = ctx.getPostSeasonWeekNoShows(2026, 1);
  assert.deepStrictEqual(Array.from(r.noShows), ['Ben'], 'only week 1 payers without a week 1 score');
  r = ctx.getPostSeasonWeekNoShows(2026, 2);
  assert.strictEqual(r.played, false, 'week 2 not played -> nobody is a week 2 no-show yet');
  assert.deepStrictEqual(Array.from(r.noShows), []);
  const panel = ctx.psRefundPanelHtml(2026, 1);
  assert(panel.includes('Ben') && !panel.includes('Cy') && !panel.includes('Dee'));
  assert(/issuePostSeasonRefunds\(2026,\[1\],\['Ben'\]\)/.test(panel));
  assert.strictEqual(ctx.psRefundPanelHtml.length >= 0, true);
  ctx.currentUser = { role: 'player' };
  assert.strictEqual(ctx.psRefundPanelHtml(2026, 1), '', 'refund buttons are officer-only');
  ctx.currentUser = { role: 'admin' };

  // Refund Ben for week 1: $10, dated week 1, tagged week 1
  await ctx.issuePostSeasonRefunds(2026, [1], ['Ben']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(refundRows)), [{ Player: 'Ben', Date: 20260922, Earned: -10, Comment: 'Missed post-season week 1' }]);
  // Idempotent: no second refund, no row written
  await ctx.issuePostSeasonRefunds(2026, [1], ['Ben']);
  assert.strictEqual(refundRows.length, 1);
  assert(/Refunded/.test(ctx.psRefundPanelHtml(2026, 1)));

  // ---- Week 2 played (Back): only Ann scored -> Cy, Dee, Fay are week 2 no-shows; week 2 pool is independent
  scores['20260929|Back'] = ['Ann'];
  r = ctx.getPostSeasonWeekNoShows(2026, 2);
  assert.deepStrictEqual(Array.from(r.noShows), ['Cy', 'Dee', 'Fay']);
  assert(!r.noShows.includes('Ben'), 'Ben paid week 1 only');
  // Fay missed week 2 only (she scored week 1): refunding week 2 must not touch week 1
  await ctx.issuePostSeasonRefunds(2026, [2], ['Fay']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(refundRows[1])), { Player: 'Fay', Date: 20260929, Earned: -10, Comment: 'Missed post-season week 2' });
  assert.deepStrictEqual(Array.from(ctx.getEoyRefundedWeeks(2026, 'Fay')), [2]);

  // ---- Bulk: refund all week 2 no-shows -> $10 each, each dated week 2
  await ctx.issuePostSeasonRefunds(2026, [2], ['Cy', 'Dee']);
  assert.deepStrictEqual(refundRows.slice(2).map(x => [x.Player, x.Date, x.Earned]), [['Cy', 20260929, -10], ['Dee', 20260929, -10]]);

  // ---- Both weeks: a player who missed both weeks gets one $10 row per week; capped at what they paid
  payments.push({ Player: 'Gus', Earned: 20, Comment: '' });
  scores['20260922|Front'].push('Ann'); // unchanged; Gus missed both
  await ctx.issuePostSeasonRefunds(2026, [1, 2], ['Gus']);
  assert.deepStrictEqual(refundRows.filter(x => x.Player === 'Gus').map(x => [x.Date, x.Earned]), [[20260922, -10], [20260929, -10]]);
  // A $10 (single-week) payer can't be refunded twice
  await ctx.issuePostSeasonRefunds(2026, [1, 2], ['Cy']);   // Cy already refunded for week 2, paid only $10
  assert.strictEqual(refundRows.filter(x => x.Player === 'Cy').length, 1, 'never refund more than paid');

  // ---- PSWeek1Nine = Back: week 1 no-shows are judged on the Back nine
  week1Fb = 'Back';
  scores = { '20260922|Back': ['Ann', 'Fay'], '20260929|Front': ['Ann'] };
  payments.length = 0; refundRows.length = 0;
  payments.push({ Player: 'Ann', Earned: 20, Comment: '' }, { Player: 'Ben', Earned: 10, Comment: '(1st Week)' });
  assert.deepStrictEqual(Array.from(ctx.getPostSeasonWeekNoShows(2026, 1).noShows), ['Ben']);
  assert.strictEqual(ctx.getPostSeasonWeekNoShows(2026, 1).fb, 'Back');
  assert.strictEqual(ctx.getPostSeasonWeekNoShows(2026, 2).fb, 'Front');

  // ---- Recalc no longer writes refunds on its own
  runs.length = 0;
  ctx.recalcPostSeasonEoyRefunds(2026);
  assert.strictEqual(runs.length, 0, 'no automatic refund writes');

  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
