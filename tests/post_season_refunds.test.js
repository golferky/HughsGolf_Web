// Regression test: post-season no-show refunds are per week and exclude the refunded player from THAT week's
// financial pools only. Weekly entry = SkinsPS + ClosestPS ($7 + $3 = $10). Run: node tests/post_season_refunds.test.js
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
//  Ann both weeks, Ben week 1 only, Cy + Dee week 2 only, Fay both weeks.
let settings, payments, refundRows, scores, ctpRows, skinRows, scoreRows;
function reset() {
  settings = { PostSeasonDt: '9/22/2026', PSWeek1Nine: 'Front', EOYSkins: 20, SkinsPS: 7, ClosestPS: 3 };
  payments = [
    { Player: 'Ann', Earned: 20, Comment: '(Both Weeks)' }, { Player: 'Ben', Earned: 10, Comment: '(1st Week)' },
    { Player: 'Cy', Earned: 10, Comment: '(2nd Week)' }, { Player: 'Dee', Earned: 10, Comment: '(2nd Week)' },
    { Player: 'Fay', Earned: 20, Comment: '(Both Weeks)' },
  ];
  refundRows = []; ctpRows = []; skinRows = []; scoreRows = {};
  scores = { '20260922|Front': ['Ann', 'Fay'], '20260929|Back': ['Ann'] };   // Ben, Cy, Dee, Fay(wk2) are no-shows
}
const runs = [];
const live = () => skinRows.filter(r => !r._del);
const alerts = [];
const par3 = { Hole1: 4, Hole2: 4, Hole3: 3, Hole4: 4, Hole5: 5, Hole6: 4, Hole7: 3, Hole8: 4, Hole9: 5,
               Hole10: 4, Hole11: 4, Hole12: 3, Hole13: 4, Hole14: 5, Hole15: 4, Hole16: 3, Hole17: 4, Hole18: 5 };
function query(sql, params = []) {
  if (/FROM Courses/.test(sql)) return [par3];
  if (/FROM SeasonSettings/.test(sql) && /SELECT \*/.test(sql)) return [settings];
  if (/SELECT PostSeasonDt, EOYSkins as EoySkins/.test(sql)) return [{ PostSeasonDt: settings.PostSeasonDt, EoySkins: settings.EOYSkins }];
  if (/SELECT PSWeek2Dt/.test(sql)) return [];
  if (/FROM Courses/.test(sql)) return [par3];
  if (/Detail='Refund'/.test(sql)) return refundRows;
  if (/FROM Payments/.test(sql) && /'EOY Skins'/.test(sql)) return payments;
  if (/SELECT DISTINCT Player FROM Scores/.test(sql)) return (scores[`${params[0]}|${params[1]}`] || []).map(Player => ({ Player }));
  if (/FROM Scores WHERE Date=(\d+) AND League/.test(sql)) return scoreRows[sql.match(/Date=(\d+)/)[1]] || [];
  if (/FROM Handicaps/.test(sql)) return [{ Hdcp: 0 }];
  if (/'CTP'/.test(sql) && /LIMIT 1/.test(sql) && /Detail LIKE '#%' OR Player='Kitty'/.test(sql))
    return ctpRows.some(r => String(r.Date) === String(params[0])) ? [{ 1: 1 }] : [];
  if (/'Skin'/.test(sql) && /LIMIT 1/.test(sql)) return live().length ? [{ 1: 1 }] : [];
  if (/SELECT rowid as RowID/.test(sql)) return skinRows.map((r, i) => ({ RowID: i + 1, ...r })).filter(r => !r._del);
  if (/SELECT Player, Detail FROM Payments WHERE/.test(sql)) return skinRows.filter(r => String(r.Date) === String(params[0]));
  if (/SELECT DISTINCT p\.Player, p\.Detail/.test(sql)) return skinRows.filter(r => String(r.Date) === String(params[0])).map(r => ({ ...r, Earned: r.Earned }));
  return [];
}
const els = {};
const el = id => els[id] || (els[id] = { innerHTML: '', value: '', style: {}, textContent: '', appendChild(c) { this.innerHTML += c.innerHTML; } });
const seq = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ctx = vm.createContext({
  window: {}, document: { getElementById: el, createElement: () => ({ innerHTML: '', style: {} }) },
  query, parseInt, parseFloat, String, Set, Map, Number, Math, Object, Array, JSON, db: true,
  currentUser: { role: 'admin' }, alert: m => alerts.push(m), confirm: () => true,
  courseData: { all18: {}, front: { hcps: seq, pars: Array(9).fill(4) }, back: { hcps: seq, pars: Array(9).fill(4) } },
  serverRun: (sql, params) => {
    runs.push({ sql, params });
    if (/INSERT INTO Payments/.test(sql) && /'Refund'/.test(sql)) refundRows.push({ Player: params[0], Date: params[1], Earned: params[2], Comment: params[3] });
    if (/INSERT INTO Payments/.test(sql) && /'Skin'/.test(sql)) skinRows.push({ Player: params[0], Date: params[1], Detail: params[2], Earned: params[3] });
    if (/DELETE FROM Payments WHERE Date IN/.test(sql) && /'Skin'/.test(sql)) skinRows = [];
    if (/DELETE FROM Payments WHERE rowid=\?/.test(sql)) skinRows[params[0] - 1]._del = true;
  },
  SERVER_RUN_QUEUE: Promise.resolve(), saveDBToServer: async () => {}, renderPostSeasonBreakdown() {}, loadPrizeMoney() {},
  recalcPostSeasonEoyRefunds: () => ({ noShows: new Set() }), applyCellClasses() {}, isPostSeasonEntryMode: () => true,
  ccRosterEligible: () => true, toDateKey: v => String(v), syncCtpsToSkinsDate() {}, fmtDate: d => d, fmtMoney: v => '$' + Number(v).toFixed(2),
  tbody: id => { els[id] = { innerHTML: '', appendChild(c) { this.innerHTML += c.innerHTML; } }; return els[id]; },
  reconcilePreviousCtpCarryovers: () => 0, getScheduledFrontBack: () => 'Front',
  getSeasonSettings: () => settings,
});
['psMdyToInt', 'psAddDaysMdy', 'parsePostSeasonDates', 'getPostSeasonWeek1Nine', 'getPostSeasonWeekForDate',
 'getPostSeasonWeekEntry', 'eoyWeeksFromComment', 'computeEoyGrossByWeek', 'getEoyUnassignedPayments', 'getEoySkinGrossPlayersForWeek', 'getEoyRefundsByPlayer', 'getEoySkinPlayersForWeek',
 'getPostSeasonContextForDate', 'getPostSeasonCtpInfo', 'getPostSeasonWeekNoShows', 'getEoyRefundedWeeks', 'psWeekHasCtpResults',
 'planPostSeasonRefunds', 'issuePostSeasonRefunds', 'psRefundPanelHtml', 'psWeekSkinValue', 'calcEoySkins', 'loadSkins', 'loadCtps']
  .forEach(n => vm.runInContext((n === 'issuePostSeasonRefunds' ? 'async ' : '') + extract(n), ctx));

const pool = w => Array.from(ctx.getEoySkinPlayersForWeek(2026, w)).sort();
const gross = w => Array.from(ctx.getEoySkinGrossPlayersForWeek(2026, w)).sort();
const refund = (weeks, players) => ctx.issuePostSeasonRefunds(2026, weeks, players);
const nines = v => { const r = {}; v.forEach((g, i) => { r[String(i + 1)] = g; }); return r; };
const skinsStats = date => { els.skinsDate = { value: date }; vm.runInContext('loadSkins()', ctx); return els.skinStatBoxes.innerHTML; };
const ctpHtml = date => { els.ctpsDate = { value: date }; els.ctpsSeason = { value: '2026' }; vm.runInContext('loadCtps()', ctx); return els.ctpsContent.innerHTML; };
const stat = (out, label) => (out.match(new RegExp(`>\\$?(\\d+)</div><div class="lbl">${label}`)) || [])[1];

(async () => {
  // ================= Before any refund: pools = gross payers per week
  reset();
  assert.deepStrictEqual(pool(1), ['Ann', 'Ben', 'Fay']);
  assert.deepStrictEqual(pool(2), ['Ann', 'Cy', 'Dee', 'Fay']);
  assert.strictEqual(stat(skinsStats('20260922'), 'Skin Pot'), '21');
  assert.strictEqual(stat(skinsStats('20260929'), 'Skin Pot'), '28');

  // ---- Config guard: $7 + $3 must equal EOYSkins / 2
  settings.ClosestPS = 4;
  assert.strictEqual(ctx.getPostSeasonWeekEntry(2026).ok, false);
  await refund([1], ['Ben']);
  assert.strictEqual(refundRows.length, 0, 'refund rejected when SkinsPS + ClosestPS != EOYSkins / 2');
  assert(/\$11 per week/.test(alerts.pop()) , 'explains the mismatch');
  assert(/\$11 per week/.test(ctx.psRefundPanelHtml(2026, 1)) || /Fix the season settings/.test(ctx.psRefundPanelHtml(2026, 1)));
  settings.ClosestPS = 3;

  // ================= Refund Ben (week 1 no-show): $10 = $7 skins + $3 CTP, removed from week 1 ONLY
  await refund([1], ['Ben']);
  assert.deepStrictEqual(plain(refundRows), [{ Player: 'Ben', Date: 20260922, Earned: -10, Comment: 'Missed post-season week 1' }]);
  assert.deepStrictEqual(pool(1), ['Ann', 'Fay'], 'Ben is out of the week 1 pools');
  assert.deepStrictEqual(pool(2), ['Ann', 'Cy', 'Dee', 'Fay'], 'week 2 pool is untouched');
  assert.deepStrictEqual(gross(1), ['Ann', 'Ben', 'Fay'], 'gross list still shows Ben as a paid participant');
  // Skins tab and CTP tab both use the reduced week 1 pool; week 2 unchanged
  assert.strictEqual(stat(skinsStats('20260922'), 'Skin Pot'), '14');
  assert.strictEqual(stat(skinsStats('20260922'), 'CTP Pot'), '6');
  assert.strictEqual(stat(skinsStats('20260929'), 'Skin Pot'), '28');
  assert.strictEqual(stat(skinsStats('20260929'), 'CTP Pot'), '12');
  assert(/2 players × \$3 = <strong>\$6<\/strong>/.test(ctpHtml('20260922')), 'week 1 CTP pot excludes Ben');
  assert(!ctpHtml('20260922').includes('Ben'), 'Ben cannot be picked as a week 1 CTP winner');
  assert(/4 players × \$3 = <strong>\$12<\/strong>/.test(ctpHtml('20260929')), 'week 2 CTP pot unchanged');
  // Still displayed as a no-show, but as "Refunded" with no buttons for him
  assert.deepStrictEqual(Array.from(ctx.getPostSeasonWeekNoShows(2026, 1).noShows), ['Ben']);
  let panel = ctx.psRefundPanelHtml(2026, 1);
  assert(panel.includes('Ben') && /Refunded/.test(panel) && !/issuePostSeasonRefunds\(2026,\[1\],\['Ben'\]\)/.test(panel));

  // ================= No double refund
  const n = refundRows.length;
  await refund([1], ['Ben']);
  assert.strictEqual(refundRows.length, n, 'second refund writes nothing');
  assert(/Nothing to refund/.test(alerts.pop()));
  await refund([1, 2], ['Ben']);          // Ben never paid week 2 -> not a paid no-show there
  assert.strictEqual(refundRows.length, n);

  // ================= Other week: Cy refunded for week 2 doesn't touch week 1, and week 2 pool shrinks
  await refund([2], ['Cy']);
  assert.deepStrictEqual(pool(2), ['Ann', 'Dee', 'Fay']);
  assert.deepStrictEqual(pool(1), ['Ann', 'Fay']);
  assert.strictEqual(stat(skinsStats('20260929'), 'Skin Pot'), '21');
  // Fay played week 1 and missed week 2: refunding week 2 leaves her in week 1
  await refund([2], ['Fay']);
  assert.deepStrictEqual(pool(2), ['Ann', 'Dee']);
  assert.deepStrictEqual(pool(1), ['Ann', 'Fay'], 'Fay still in week 1');
  assert.deepStrictEqual(Array.from(ctx.getEoyRefundedWeeks(2026, 'Fay')), [2]);
  // Bulk / both weeks
  reset();
  scores = { '20260922|Front': ['Ann'], '20260929|Back': ['Ann'] };     // Fay missed both
  await refund([1, 2], ['Fay']);
  assert.deepStrictEqual(refundRows.map(r => [r.Player, r.Date, r.Earned]), [['Fay', 20260922, -10], ['Fay', 20260929, -10]]);
  assert.deepStrictEqual(pool(1), ['Ann', 'Ben']); assert.deepStrictEqual(pool(2), ['Ann', 'Cy', 'Dee']);
  await refund([1, 2], ['Fay']);
  assert.strictEqual(refundRows.length, 2, 'both-week refund is not repeated');

  // ================= An untagged $10 is not assigned to any week: it funds no pool (and cannot be refunded as a week)
  reset();
  payments.push({ Player: 'Gus', Earned: 10, Comment: '' });
  scores = { '20260922|Front': ['Ann'], '20260929|Back': ['Ann'] };
  assert(!pool(1).includes('Gus') && !pool(2).includes('Gus'), 'unassigned payment is in no pool');
  assert.deepStrictEqual(plain(ctx.getEoyUnassignedPayments(2026)).map(u => u.Player), ['Gus']);
  await refund([1], ['Gus']);
  assert.strictEqual(refundRows.length, 0, 'no week-1 entry to refund');
  // A $20 both-weeks payment refunded for week 1 stays in week 2 only
  reset();
  scores = { '20260922|Front': ['Ann'], '20260929|Back': ['Ann', 'Fay'] };
  await refund([1], ['Fay']);
  assert(!pool(1).includes('Fay') && pool(2).includes('Fay'));

  // ================= Legacy combined refund rows are read correctly (no double refund of a legacy "both weeks" row)
  reset();
  scores = { '20260922|Front': ['Ann'], '20260929|Back': ['Ann'] };
  refundRows.push({ Player: 'Fay', Date: 20260922, Earned: -20, Comment: 'Missed both post-season weeks' });
  assert(!pool(1).includes('Fay') && !pool(2).includes('Fay'));
  await refund([1, 2], ['Fay']);
  assert.strictEqual(refundRows.length, 1);
  // legacy partial refund ($5) does not count as a week refund
  reset();
  refundRows.push({ Player: 'Ben', Date: 20260922, Earned: -5, Comment: 'Partial' });
  assert(!pool(1).includes('Ben'), 'a $5 partial refund leaves $5 which does not fund the $10 week');

  // ================= Refund BEFORE CTP results exist: allowed, and the CTP pot is right when winners are later picked
  reset();
  await refund([2], ['Cy']);
  assert.strictEqual(refundRows.length, 1);
  assert(/3 players × \$3 = <strong>\$9<\/strong>/.test(ctpHtml('20260929')));

  // ================= Refund AFTER CTP results exist: blocked with a clear explanation, nothing written
  reset();
  ctpRows.push({ Date: 20260929, Player: 'Dee', Detail: '#12' });        // week 2 winner recorded
  await refund([2], ['Cy']);
  assert.strictEqual(refundRows.length, 0);
  let msg = alerts.pop();
  assert(/CTP results are already recorded/.test(msg) && /reset/i.test(msg) && /CTPs tab/.test(msg));
  assert.deepStrictEqual(pool(2), ['Ann', 'Cy', 'Dee', 'Fay'], 'pool unchanged when blocked');
  assert(/Blocked/.test(ctx.psRefundPanelHtml(2026, 2)) && /CTPs tab/.test(ctx.psRefundPanelHtml(2026, 2)));
  // Week 1 (no CTP results) is unaffected by week 2's CTP results
  await refund([1], ['Ben']);
  assert.strictEqual(refundRows.length, 1);
  // A carryover ("No Winner") record also blocks
  reset();
  ctpRows.push({ Date: 20260922, Player: 'Kitty', Detail: 'Carryover3-Front' });
  await refund([1], ['Ben']);
  assert.strictEqual(refundRows.length, 0);
  // both-week request is all-or-nothing when one week is blocked
  reset();
  scores = { '20260922|Front': ['Ann'], '20260929|Back': ['Ann'] };
  ctpRows.push({ Date: 20260929, Player: 'Ann', Detail: '#16' });
  await refund([1, 2], ['Fay']);
  assert.strictEqual(refundRows.length, 0);
  // Reset CTPs -> refund now works
  ctpRows = [];
  await refund([1, 2], ['Fay']);
  assert.strictEqual(refundRows.length, 2);

  // ================= Stored Skins payouts are restated from the reduced pool after a refund
  reset();
  scores['20260929|Back'] = ['Ann', 'Dee'];
  scoreRows = {
    20260922: [{ Player: 'Ann', ...nines([3, 4, 4, 4, 4, 4, 4, 4, 4]) }, { Player: 'Fay', ...nines([4, 4, 4, 4, 4, 4, 4, 4, 4]) }],
    20260929: [{ Player: 'Ann', ...nines([3, 4, 4, 4, 4, 4, 4, 4, 4]) }, { Player: 'Dee', ...nines([4, 4, 4, 4, 4, 4, 4, 4, 4]) }],
  };
  vm.runInContext('calcEoySkins(2026, true)', ctx);
  // week 1: Ann + Fay scored (Ben no-show) -> $14 pot, 1 skin = $14; week 2: Ann + Dee -> $14
  assert.deepStrictEqual(live().map(r => [r.Player, r.Date, r.Earned]), [['Ann', 20260922, 14], ['Ann', 20260929, 14]]);
  await refund([1], ['Ben']);                     // Ben (no score) leaves the week 1 pool; restated from retained money
  assert.deepStrictEqual(live().map(r => [r.Player, r.Date, r.Earned]), [['Ann', 20260922, 14], ['Ann', 20260929, 14]]);
  // Fay was in week 1; refund her (she is a week 2 no-show only) -> week 2 stays; a NO-SHOW who somehow has stale winner rows is removed
  skinRows.push({ Player: 'Cy', Date: 20260929, Detail: '#12', Earned: 99 });
  await refund([2], ['Cy']);
  assert(!live().some(r => r.Player === 'Cy'), 'refunded player cannot hold a week 2 skin');
  assert(!live().some(r => r.Earned === 99));

  // ================= Money invariant: no pool or payout exceeds the money retained after refunds
  reset();
  scores = { '20260922|Front': ['Ann', 'Fay'], '20260929|Back': ['Ann', 'Dee'] };
  payments.push({ Player: 'Gus', Earned: 10, Comment: '(1st Week)' });
  await refund([1], ['Ben']); await refund([2], ['Cy', 'Fay']); await refund([1], ['Gus']);
  const paidTotal = payments.reduce((a, p) => a + p.Earned, 0);
  const refunded = -refundRows.reduce((a, r) => a + r.Earned, 0);
  const retained = paidTotal - refunded;
  const pools = [1, 2].map(w => pool(w).length * 10);        // $7 skins + $3 CTP per counted player
  assert(pools[0] + pools[1] <= retained + 1e-9, `pools ${pools} exceed retained $${retained}`);
  [1, 2].forEach(w => pool(w).forEach(p => assert(!Array.from(ctx.getEoyRefundedWeeks(2026, p)).includes(w), `${p} refunded for week ${w} but still pooled`)));
  // Per-player: the weeks a player is pooled for cost no more than they retained
  payments.map(p => p.Player).filter((v, i, a) => a.indexOf(v) === i).forEach(pl => {
    const paid = payments.filter(p => p.Player === pl).reduce((a, p) => a + p.Earned, 0);
    const ref = -refundRows.filter(r => r.Player === pl).reduce((a, r) => a + r.Earned, 0);
    const weeksIn = [1, 2].filter(w => pool(w).includes(pl)).length;
    assert(weeksIn * 10 <= paid - ref + 1e-9, `${pl}: in ${weeksIn} weeks but retained only $${paid - ref}`);
  });
  // Skins payouts never exceed that week's retained Skins money
  scoreRows = { 20260922: [{ Player: 'Ann', ...nines([3, 4, 4, 4, 4, 4, 4, 4, 4]) }, { Player: 'Fay', ...nines([4, 4, 4, 4, 4, 4, 4, 4, 4]) }],
                20260929: [{ Player: 'Ann', ...nines([3, 4, 4, 4, 4, 4, 4, 4, 4]) }, { Player: 'Dee', ...nines([4, 4, 4, 4, 4, 4, 4, 4, 4]) }] };
  skinRows = [];
  vm.runInContext('calcEoySkins(2026, true)', ctx);
  [20260922, 20260929].forEach((d, i) => {
    const payout = live().filter(r => r.Date === d).reduce((a, r) => a + r.Earned, 0);
    assert(payout <= pool(i + 1).length * 7 + 0.01, `week ${i + 1} payout $${payout} exceeds retained skins money`);
  });

  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
