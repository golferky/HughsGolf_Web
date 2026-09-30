// Regression test: every $10 EOY Skins entry must be explicitly assigned to Week 1 or Week 2 (or $20 to Both),
// the amount is derived (never typed), and the old typed-amount refund is replaced by a fixed, week-scoped one.
// Run: node tests/post_season_payment_weeks.test.js
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
const plain = v => JSON.parse(JSON.stringify(v));

// ---- Fake database. Season 2026: week 1 = 9/22 (Front), week 2 = 9/29 (Back).
let settings, payments, refundRows, scores, ctpRows, legacyScores = [];
function reset() {
  settings = { PostSeasonDt: '9/22/2026', PSWeek1Nine: 'Front', EOYSkins: 20, SkinsPS: 7, ClosestPS: 3 };
  payments = [];
  refundRows = []; ctpRows = []; scores = {};
}
const runs = [], alerts = [];
function query(sql, params = []) {
  if (/FROM SeasonSettings/.test(sql) && /MAX\(Season\)/.test(sql)) return [{ s: 2026 }];
  if (/SELECT PSWeek2Dt/.test(sql)) return [];
  if (/rowid<>\?/.test(sql)) return payments.filter(p => p.ID !== params[1] && p.Player === params[0]);
  if (/WHERE rowid=\?/.test(sql)) return payments.filter(p => p.ID === params[0]);
  if (/Detail='Refund'/.test(sql)) return refundRows;
  if (/FROM Payments/.test(sql) && /'EOY Skins'/.test(sql)) return payments;
  if (/SELECT DISTINCT Player, CAST\(Date AS INTEGER\) as D/.test(sql)) return legacyScores;
  if (/SELECT DISTINCT Player FROM Scores/.test(sql)) return (scores[`${params[0]}|${params[1]}`] || []).map(Player => ({ Player }));
  if (/'CTP'/.test(sql) && /LIMIT 1/.test(sql)) return ctpRows.some(r => String(r.Date) === String(params[0])) ? [{ 1: 1 }] : [];
  return [];
}
const checks = {};
const el = id => ({ get checked() { return !!checks[id]; }, disabled: false, style: {}, textContent: '', value: '', innerHTML: '' });
let chosenWeek = '';
let promptAnswer = null;
const ctx = vm.createContext({
  query, parseInt, parseFloat, String, Set, Map, Number, Math, Object, Array, JSON, db: true,
  currentUser: { role: 'admin' }, alert: m => alerts.push(m), confirm: () => true,
  prompt: () => promptAnswer,
  document: { getElementById: el, querySelector: sel => (/payEoyWk/.test(sel) && chosenWeek ? { value: chosenWeek } : null) },
  courseData: { all18: {} },
  serverRun: (sql, params) => runs.push({ sql, params }),
  SERVER_RUN_QUEUE: Promise.resolve(), saveDBToServer: async () => {}, renderPostSeasonBreakdown() {}, loadPrizeMoney() {},
  closePaymentModal() {}, loadPayments() {}, dismissEoyPaymentPrompt() {}, setTimeout() {},
  getSeasonSettings: () => settings,
});
['psMdyToInt', 'psAddDaysMdy', 'parsePostSeasonDates', 'getPostSeasonWeek1Nine', 'getPostSeasonWeekEntry',
 'eoyWeeksFromComment', 'eoyCommentForWeeks', 'eoyPaymentForWeeks', 'eoyPaymentConflict', 'computeEoyGrossByWeek',
 'getEoyUnassignedPayments', 'getEoySkinGrossPlayersForWeek', 'getEoyRefundsByPlayer', 'getEoySkinPlayersForWeek',
 'getPostSeasonWeekNoShows', 'getEoyRefundedWeeks', 'psWeekHasCtpResults', 'planPostSeasonRefunds', 'issuePostSeasonRefunds',
 'refundEoyPayment', 'quickPayEoySkins', 'assignEoyPaymentWeeks', 'editEoyPayment', 'readEoyPaymentChoice', 'confirmPaymentForPlayer']
  .forEach(n => vm.runInContext((n === 'issuePostSeasonRefunds' ? 'async ' : '') + extract(n), ctx));

const pool = w => Array.from(ctx.getEoySkinPlayersForWeek(2026, w)).sort();
const inserts = () => runs.filter(r => /^INSERT INTO Payments/.test(r.sql));
const updates = () => runs.filter(r => /^UPDATE Payments/.test(r.sql));
const lastAlert = () => alerts.pop() || '';

(async () => {
  // ================= Payment for chosen weeks: amount is derived and the tag is explicit
  reset();
  assert.deepStrictEqual(plain(ctx.eoyPaymentForWeeks(2026, '1')), { amt: 10, comment: '(1st Week)', weeks: [1] });
  assert.deepStrictEqual(plain(ctx.eoyPaymentForWeeks(2026, '2')), { amt: 10, comment: '(2nd Week)', weeks: [2] });
  assert.deepStrictEqual(plain(ctx.eoyPaymentForWeeks(2026, 'both')), { amt: 20, comment: '(Both Weeks)', weeks: [1, 2] });
  assert(/Choose Week 1, Week 2 or Both/.test(ctx.eoyPaymentForWeeks(2026, '').error), 'a week is required');
  assert(/Choose Week 1, Week 2 or Both/.test(ctx.eoyPaymentForWeeks(2026, undefined).error));
  settings.ClosestPS = 4;
  assert(/\$11 per week/.test(ctx.eoyPaymentForWeeks(2026, '1').error), 'mismatched settings block payments too');
  settings.ClosestPS = 3;

  // ================= Tagged rows must be $10 per named week; legacy untagged $20 / $10 keep working; odd rows are unassigned
  payments = [
    { ID: 1, Player: 'Ann', Earned: 20, Comment: '(Both Weeks)' },
    { ID: 2, Player: 'Ben', Earned: 10, Comment: '(1st Week)' },
    { ID: 3, Player: 'Cy', Earned: 10, Comment: '(2nd Week)' },
    { ID: 4, Player: 'Old20', Earned: 20, Comment: '' },                 // legacy untagged $20 = both weeks
    { ID: 5, Player: 'Old10', Earned: 10, Comment: '' },                 // legacy untagged $10 = the week they score in
    { ID: 6, Player: 'Odd', Earned: 15, Comment: '(1st Week)' },         // named week but not $10
    { ID: 7, Player: 'Short', Earned: 10, Comment: '(Both Weeks)' },     // both weeks but only $10
    { ID: 9, Player: 'Odd15', Earned: 15, Comment: '' },                 // untagged and not $10/$20
  ];
  legacyScores = [];
  assert.deepStrictEqual(pool(1), ['Ann', 'Ben', 'Old20'], 'legacy $20 is in week 1 with no assignment');
  assert.deepStrictEqual(pool(2), ['Ann', 'Cy', 'Old20'], 'legacy $20 is in week 2 too (paid both weeks)');
  assert.deepStrictEqual(plain(ctx.getEoyUnassignedPayments(2026)).map(u => u.Player), ['Odd', 'Short', 'Odd15'],
    'only rows that fit no rule are "unassigned"; legacy $20 and $10 are not');
  ['Odd', 'Short', 'Odd15'].forEach(n => assert(!pool(1).includes(n) && !pool(2).includes(n), `${n} is unassigned so funds no pool`));
  assert(!pool(1).includes('Old10') && !pool(2).includes('Old10'), 'legacy $10 with no score yet is in no pool');
  // Legacy $20: week 1 has been played -> a score keeps them in; a no-show is a refund candidate (still in the pool until refunded)
  assert.deepStrictEqual(plain(ctx.computeEoyGrossByWeek(2026).legacy).map(l => [l.Player, l.weeks]), [['Old20', [1, 2]], ['Old10', []]]);
  // Legacy $10 goes to the week they have a score for
  legacyScores = [{ Player: 'Old10', D: 20260929 }];
  assert(!pool(1).includes('Old10') && pool(2).includes('Old10'), 'legacy $10 scored in week 2 -> week 2 only');
  legacyScores = [{ Player: 'Old10', D: 20260922 }, { Player: 'Old10', D: 20260929 }];
  assert(pool(1).includes('Old10') && !pool(2).includes('Old10'), 'one $10 funds only one week (the first scored)');
  legacyScores = [];

  // ================= Assigning a row: amount must match, week not already paid
  runs.length = 0;
  ctx.assignEoyPaymentWeeks(7, 2026, 'both');                    // $10 is not two weeks
  assert(/does not match/.test(lastAlert())); assert.strictEqual(updates().length, 0);
  ctx.assignEoyPaymentWeeks(4, 2026, '1');                       // $20 is not one week
  assert(/does not match/.test(lastAlert())); assert.strictEqual(updates().length, 0);
  ctx.assignEoyPaymentWeeks(7, 2026, '');                        // no choice
  assert(/Choose Week 1/.test(lastAlert())); assert.strictEqual(updates().length, 0);
  ctx.assignEoyPaymentWeeks(4, 2026, 'both');                    // legacy $20 already counts for both weeks
  assert(/already paid for week 1 and 2/.test(lastAlert())); assert.strictEqual(updates().length, 0);
  ctx.assignEoyPaymentWeeks(7, 2026, '2');                       // "Short" $10 -> week 2
  assert.deepStrictEqual(plain(updates().map(u => u.params)), [['(2nd Week)', 7]]);
  payments.find(p => p.ID === 7).Comment = '(2nd Week)';         // (what the UPDATE does)
  assert(!pool(1).includes('Short') && pool(2).includes('Short'));
  runs.length = 0;
  payments.push({ ID: 8, Player: 'Ben', Earned: 10, Comment: '' });
  ctx.assignEoyPaymentWeeks(8, 2026, '1');                       // Ben already paid week 1
  assert(/already paid for week 1/.test(lastAlert())); assert.strictEqual(updates().length, 0);
  payments.pop();

  // ================= quickPayEoySkins: derived amount + explicit tag; the passed amount is ignored
  runs.length = 0;
  ctx.quickPayEoySkins('Zed', 2026, 999, '');                    // "Pay Both Weeks" used to write an untagged $20
  ctx.quickPayEoySkins('Yan', 2026, 999, '1');
  ctx.quickPayEoySkins('Xia', 2026, 1, '2');
  assert.deepStrictEqual(plain(inserts().map(r => [r.params[0], r.params[2], r.params[4]])),
    [['Zed', 20, '(Both Weeks)'], ['Yan', 10, '(1st Week)'], ['Xia', 10, '(2nd Week)']]);
  runs.length = 0;
  ctx.quickPayEoySkins('Ann', 2026, 10, '1');                    // Ann already paid week 1
  assert(/already paid for week 1/.test(lastAlert())); assert.strictEqual(inserts().length, 0);
  ctx.quickPayEoySkins('Ann', 2026, 20, '');
  assert(/already paid/.test(lastAlert())); assert.strictEqual(inserts().length, 0);

  // ================= Payment modal: EOY checked with no week chosen writes NOTHING (not even skins/dues)
  runs.length = 0;
  checks.payEoyCheck = true; checks.payDuesCheck = true; checks.paySkinsCheck = true; chosenWeek = '';
  ctx.confirmPaymentForPlayer('Wes', '20260922', 7, 3);
  assert(/every \$10 EOY Skins entry must be assigned to a week/.test(lastAlert()));
  assert.strictEqual(runs.length, 0, 'nothing written when no week is chosen');
  chosenWeek = 'both';
  ctx.confirmPaymentForPlayer('Wes', '20260922', 7, 3);
  const eoy = inserts().find(r => /'EOY Skins'/.test(r.sql));
  assert.deepStrictEqual(plain([eoy.params[3], eoy.params[5]]), [20, '(Both Weeks)']);
  assert(/readEoyPaymentChoice/.test(html.slice(html.indexOf('function confirmPayment()'), html.indexOf('function closePaymentModal'))),
    'the entry-screen payment modal uses the same week check');
  chosenWeek = ''; Object.keys(checks).forEach(k => delete checks[k]);

  // ================= Edit: choose the week; amount is derived; no typed amount
  runs.length = 0; payments = [{ ID: 10, Player: 'Kay', Earned: 20, Comment: '' }, { ID: 11, Player: 'Lou', Earned: 10, Comment: '(1st Week)' }];
  promptAnswer = '';
  ctx.editEoyPayment(10, 2026);
  assert(/Choose Week 1, Week 2 or Both/.test(lastAlert())); assert.strictEqual(updates().length, 0, 'blank choice is refused');
  promptAnswer = '7';
  ctx.editEoyPayment(10, 2026);
  assert(/Choose Week 1/.test(lastAlert())); assert.strictEqual(updates().length, 0, 'a typed amount is not accepted');
  promptAnswer = 'both';
  ctx.editEoyPayment(10, 2026);
  assert.deepStrictEqual(plain(updates().map(u => u.params)), [[20, '(Both Weeks)', 10]]);
  runs.length = 0; payments.push({ ID: 12, Player: 'Lou', Earned: 10, Comment: '' });
  promptAnswer = '1';
  ctx.editEoyPayment(12, 2026);                                  // Lou already has week 1
  assert(/already has another payment for week 1/.test(lastAlert())); assert.strictEqual(updates().length, 0);

  // ================= Old typed-amount refund is gone: fixed, week-scoped, guarded
  assert(!/Enter refund amount/.test(html) && !/Reason for refund \(e\.g\./.test(html), 'typed-amount refund prompts removed');
  reset();
  payments = [{ ID: 1, Player: 'Ann', Earned: 20, Comment: '(Both Weeks)' }, { ID: 2, Player: 'Ben', Earned: 10, Comment: '(1st Week)' },
              { ID: 3, Player: 'Cy', Earned: 10, Comment: '(2nd Week)' }];
  ctx.prompt = () => { throw new Error('refund must not prompt for a typed amount'); };
  runs.length = 0;
  await ctx.refundEoyPayment('Ben', 2026);                       // no week -> refused
  assert(/Choose a week/.test(lastAlert())); assert.strictEqual(inserts().length, 0);
  // Before the round (no scores at all): a cancelled player can be refunded — fixed $10 dated that week
  await ctx.refundEoyPayment('Ben', 2026, '1');
  assert.deepStrictEqual(plain(inserts().map(r => [r.params[0], r.params[1], r.params[2], r.params[3]])),
    [['Ben', 20260922, -10, 'Refunded (no score) week 1']]);
  refundRows.push({ Player: 'Ben', Date: 20260922, Earned: -10, Comment: 'Refunded (no score) week 1' });
  assert.deepStrictEqual(pool(1), ['Ann']); assert.deepStrictEqual(pool(2), ['Ann', 'Cy'], 'other week untouched');
  runs.length = 0;
  await ctx.refundEoyPayment('Ben', 2026, '1');                  // never twice
  assert.strictEqual(inserts().length, 0); assert(/Nothing to refund/.test(lastAlert()));
  // A player who has a score for that week cannot be refunded for it
  scores['20260929|Back'] = ['Cy'];
  await ctx.refundEoyPayment('Cy', 2026, '2');
  assert(/has a week 2 score/.test(lastAlert())); assert.strictEqual(inserts().length, 0);
  // Not paid for that week -> nothing to refund
  await ctx.refundEoyPayment('Cy', 2026, '1');
  assert(/no week 1 entry to refund/.test(lastAlert())); assert.strictEqual(inserts().length, 0);
  // CTP results for the week block it
  ctpRows.push({ Date: 20260929, Player: 'Kitty', Detail: 'Carryover12-Back' });
  await ctx.refundEoyPayment('Ann', 2026, '2');
  assert(/CTP results are already recorded/.test(lastAlert())); assert.strictEqual(inserts().length, 0);
  ctpRows.length = 0;
  // Both weeks for a $20 entry: one fixed $10 row per week, never typed
  await ctx.refundEoyPayment('Ann', 2026, 'both');
  assert.deepStrictEqual(plain(inserts().map(r => [r.params[1], r.params[2]])), [[20260922, -10], [20260929, -10]]);

  // The Prize Money table no longer offers a typed refund; it offers per-week buttons and assign buttons
  const table = html.slice(html.indexOf('const _untagged = paid'), html.indexOf('const _untagged = paid') + 5200);
  assert(/refundEoyPayment\('\$\{_safe\}',\$\{season\},'\$\{w\}'\)/.test(table), 'per-week refund buttons');
  assert(/assignEoyPaymentWeeks\(/.test(table) && /Needs week/.test(table));
  // Legacy untagged $20 / $10 payments are labelled, never flagged "Needs week"
  assert(/_legacyBoth/.test(table) && /Legacy · both weeks/.test(table) && /Legacy · week by score/.test(table));
  assert(/_needsWeek = paid && !_assigned && !_legacyOne/.test(table), 'legacy rows are not "needs week"');
  assert(/_legacyBoth \? \[1, 2\]/.test(table), 'legacy $20 gets per-week refund buttons');

  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
