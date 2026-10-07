// Regression test: post-season no-show refunds are money OWED back to players, separate from Skin / CTP winnings.
//  * a confirmed no-show refund stays available after the week's CTP / Skin results are recorded
//  * safeguards: no refund for a player with a score, no duplicate refund, no automatic refund
//  * recording a refund does NOT disburse it: it stays "owed / unpaid" (no DatePaid) until an officer marks it paid
//  * Prize Money shows a separate "REFUNDS OWED / UNPAID" amount; the 4 existing Week 1 no-shows show $40 owed
//  * nothing here writes on page load / view, and no Skin winner / CTP / remainder row is ever touched
// Real Week 1 = 9/29/2026 (Back 9): 23 players paid $20 ($460), 19 scored, 4 no-shows.
// Run: node tests/post_season_refunds_owed.test.js
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

// ---------------------------------------------------------------- fake database
const scorers = Array.from({ length: 19 }, (_, i) => 'Play' + String(i + 1).padStart(2, '0'));
const noShows = ['Dan Bowen', 'Jason Noble', 'Steve Bailey', 'Tim Franxman'];
const payments = [...scorers, ...noShows].map((Player, i) => ({ ID: i + 1, Player, Earned: 20, Comment: '(Both Weeks)' }));   // 23 x $20 = $460
const settings = { PostSeasonDt: '9/29/2026', PSWeek1Nine: 'Back', EOYSkins: 20, SkinsPS: 7, ClosestPS: 3 };
const scores = { '20260929|Back': scorers };                      // Week 1 played; Week 2 not played yet
let refundRows, ctpRows, skinRows, nextId, runs, alerts, role;
function reset() {
  refundRows = []; nextId = 500; runs = []; alerts = []; role = 'admin';
  ctpRows = [{ Date: 20260929, Player: 'Play03', Detail: '#12' }, { Date: 20260929, Player: 'Kitty', Detail: 'Carryover16-Back' }];   // Week 1 CTP results recorded
  skinRows = [{ Player: 'Play01', Date: 20260929, Detail: '#10', Earned: 44, DatePaid: '' }, { Player: 'Play01', Date: 20260929, Detail: '#11', Earned: 44, DatePaid: '' },
              { Player: 'Play02', Date: 20260929, Detail: '#12', Earned: 44, DatePaid: '9/30/2026 8:00 AM' }];   // unpaid + PAID winner rows
}
const ledger = () => JSON.stringify({ skinRows, ctpRows });
function query(sql, params = []) {
  if (/FROM SeasonSettings/.test(sql) && /SELECT \*/.test(sql)) return [settings];
  if (/SELECT PSWeek2Dt/.test(sql)) return [];
  if (/Detail='Refund'/.test(sql)) {
    if (/WHERE rowid=\?/.test(sql)) return refundRows.filter(r => r.ID === params[0]).map(r => ({ ...r }));
    return refundRows.map(r => ({ ...r }));
  }
  if (/FROM Payments/.test(sql) && /'EOY Skins'/.test(sql) && /Detail='Payment'/.test(sql)) return payments.map(p => ({ ...p }));
  if (/SELECT DISTINCT Player FROM Scores/.test(sql)) return (scores[`${params[0]}|${params[1]}`] || []).map(Player => ({ Player }));
  if (/SELECT DISTINCT Player, CAST\(Date AS INTEGER\) as D/.test(sql)) return [];
  if (/'CTP'/.test(sql) && /LIMIT 1/.test(sql)) return ctpRows.some(r => String(r.Date) === String(params[0])) ? [{ 1: 1 }] : [];
  return [];
}
function serverRun(sql, params = []) {
  runs.push({ sql, params });
  if (/^INSERT INTO Payments/.test(sql) && /'Refund'/.test(sql)) refundRows.push({ ID: nextId++, Player: params[0], Date: params[1], Earned: params[2], Comment: params[3], DatePaid: /DatePaid/.test(sql) ? 'SET-BY-INSERT' : '' });
  else if (/^UPDATE Payments SET DatePaid=\? WHERE rowid=\?/.test(sql)) { const r = refundRows.find(x => x.ID === params[1] && !x.DatePaid); if (r) r.DatePaid = params[0]; }
}
const confirms = [];
const ctx = vm.createContext({ psSkinAutoAll() {},
  query, serverRun, parseInt, parseFloat, String, Set, Map, Number, Math, Object, Array, JSON, Date, db: true,
  get currentUser() { return { role }; }, alert: m => alerts.push(String(m)), confirm: m => { confirms.push(String(m)); return true; },
  SERVER_RUN_QUEUE: Promise.resolve(), saveDBToServer: async () => { runs.push({ sql: 'SAVE' }); }, renderPostSeasonBreakdown() {}, loadPrizeMoney() {}, calcEoySkins() {},
  fmtDate: d => `${d.slice(4, 6)}/${d.slice(6, 8)}/${d.slice(0, 4)}`, courseData: { all18: {} },
  getSeasonSettings: () => settings,
});
['psMdyToInt', 'psAddDaysMdy', 'parsePostSeasonDates', 'getPostSeasonWeek1Nine', 'getPostSeasonWeekEntry', 'eoyWeeksFromComment', 'eoyCommentForWeeks',
 'computeEoyGrossByWeek', 'getEoySkinGrossPlayersForWeek', 'getEoyRefundsByPlayer', 'getEoySkinPlayersForWeek', 'getEoyRefundedWeeks', 'getEoyRefundRows',
 'getPostSeasonWeekNoShows', 'getEoyUnassignedPayments', 'psWeekHasCtpResults', 'planPostSeasonRefunds', 'getEoyRefundSummary', 'eoyRefundsOwedTileHtml',
 'eoyRefundsDetailHtml', 'psRefundPanelHtml', 'recalcPostSeasonEoyRefunds', 'refundEoyPayment']
  .forEach(n => vm.runInContext(extract(n), ctx));
['issuePostSeasonRefunds', 'markEoyRefundPaid'].forEach(n => vm.runInContext('async ' + extract(n), ctx));
const run = code => vm.runInContext(code, ctx);
const summary = () => plain(run('getEoyRefundSummary(2026)'));
const refund = (weeks, players) => run(`issuePostSeasonRefunds(2026, [${weeks}], ${JSON.stringify(players)})`);
const refundInserts = () => runs.filter(r => /^INSERT INTO Payments/.test(r.sql) && /'Refund'/.test(r.sql));
const winnerOrCtpWrites = () => runs.filter(r => /^(INSERT INTO|UPDATE|DELETE FROM) Payments/.test(r.sql) && !/'Refund'/.test(r.sql) && !/SET DatePaid=\? WHERE rowid=\? AND "Desc"='EOY Skins' AND Detail='Refund'/.test(r.sql));

(async () => {
  // ================= Existing Week 1 no-shows: $40 owed (nothing recorded yet), listed by name, before anyone clicks anything
  reset();
  let sum = summary();
  assert.deepStrictEqual(sum.notRecorded.map(r => [r.Player, r.week, r.amount]), noShows.map(p => [p, 1, 10]), 'the 4 Week 1 no-shows, $10 each');
  assert.strictEqual(sum.owedTotal, 40); assert.strictEqual(sum.unpaidTotal, 0); assert.strictEqual(sum.paidTotal, 0);
  assert.strictEqual(runs.length, 0, 'building the summary writes nothing (no automatic refunds)');
  let tile = run('eoyRefundsOwedTileHtml(' + JSON.stringify(sum) + ')');
  assert(/REFUNDS OWED \/ UNPAID/.test(tile) && />\$40\.00</.test(tile));
  let detail = run(`eoyRefundsDetailHtml(2026, ${JSON.stringify(sum)}, true)`);
  noShows.forEach(n => assert(detail.includes(n), n + ' listed'));
  assert(/No-show — refund not recorded yet/.test(detail) && /Record refund/.test(detail));
  assert(/\$40\.00/.test(detail) && /separate from Skin \/ CTP winnings/.test(detail));
  assert(!/Record refund|Mark paid/.test(run(`eoyRefundsDetailHtml(2026, ${JSON.stringify(sum)}, false)`)), 'players (non-officers) get no action buttons');
  assert.strictEqual(runs.length, 0, 'rendering writes nothing');
  assert.strictEqual(summary().notRecordedTotal, 40);

  // ================= A no-show refund is still available AFTER the week's CTP (and Skin) results are recorded
  assert(run('psWeekHasCtpResults(20260929)'), 'precondition: Week 1 CTP results exist');
  const ledgerBefore = ledger();
  assert(!/Blocked|CTPs tab/.test(run('psRefundPanelHtml(2026, 1)')) && /Refund week 1/.test(run('psRefundPanelHtml(2026, 1)')), 'the entry-screen panel still offers the refund');
  await refund([1], ['Dan Bowen']);
  assert.strictEqual(refundInserts().length, 1, 'the refund was recorded even though CTP results exist');
  assert(!alerts.some(a => /CTP results/.test(a)), 'no CTP block message');
  assert.strictEqual(ledger(), ledgerBefore, 'stored CTP / Skin rows are unchanged');
  assert.deepStrictEqual(winnerOrCtpWrites(), [], 'a refund writes only its own Refund row');

  // ================= Recorded != disbursed: the refund is owed / unpaid (no DatePaid) until marked paid
  const ins = refundInserts()[0];
  assert(!/DatePaid/.test(ins.sql), 'recording a refund does not set DatePaid');
  assert.deepStrictEqual(plain(ins.params.slice(0, 4)), ['Dan Bowen', 20260929, -10, 'Missed post-season week 1']);
  sum = summary();
  assert.deepStrictEqual(sum.unpaid.map(r => [r.Player, r.week, r.amount, r.paid]), [['Dan Bowen', 1, 10, false]]);
  assert.strictEqual(sum.paid.length, 0); assert.strictEqual(sum.paidTotal, 0, 'nothing is disbursed yet');
  assert.strictEqual(sum.unpaidTotal, 10); assert.strictEqual(sum.notRecordedTotal, 30); assert.strictEqual(sum.owedTotal, 40, 'still $40 owed in total');
  detail = run(`eoyRefundsDetailHtml(2026, ${JSON.stringify(sum)}, true)`);
  assert(/Recorded — unpaid/.test(detail) && /Mark paid/.test(detail) && !/Disbursed/.test(detail));
  assert(/Refunded · unpaid \(\$10\.00 owed\)/.test(run('psRefundPanelHtml(2026, 1)')), 'the entry panel shows it as unpaid');

  // ================= Record the rest (bulk) -> all four are recorded, all four unpaid, still $40
  await refund([1], ['Jason Noble', 'Steve Bailey', 'Tim Franxman']);
  assert.strictEqual(refundInserts().length, 4);
  sum = summary();
  assert.strictEqual(sum.unpaid.length, 4); assert.strictEqual(sum.notRecorded.length, 0);
  assert.strictEqual(sum.unpaidTotal, 40); assert.strictEqual(sum.owedTotal, 40); assert.strictEqual(sum.paidTotal, 0);

  // ================= No double refunds (single, bulk, both weeks), and no refund for a player with a score
  const n = refundInserts().length;
  await refund([1], ['Dan Bowen']);
  await refund([1], noShows);
  await refund([1, 2], ['Dan Bowen']);
  assert.strictEqual(refundInserts().length, n, 'nobody is refunded twice');
  alerts.length = 0;
  await refund([1], ['Play01']);                                  // Play01 has a Week 1 score
  assert(/has a week 1 score/.test(alerts[alerts.length - 1] || ''), alerts.join('|')); assert.strictEqual(refundInserts().length, n);
  await run(`refundEoyPayment('Nobody Paid', 2026, '1')`);
  assert.strictEqual(refundInserts().length, n, 'a player with no entry cannot be refunded');
  assert.strictEqual(summary().notRecorded.length, 0, 'recorded no-shows are no longer listed as "not recorded"');

  // ================= Marking paid moves it to Disbursed and stamps DatePaid; it is idempotent and officer-only
  const danId = refundRows.find(r => r.Player === 'Dan Bowen').ID;
  role = 'player'; runs.length = 0; alerts.length = 0;
  await run(`markEoyRefundPaid(${danId}, 2026)`);
  assert(/Only officers/.test(alerts[0])); assert.strictEqual(runs.length, 0, 'a player cannot mark a refund paid');
  role = 'admin'; alerts.length = 0; runs.length = 0;
  await run(`markEoyRefundPaid(${danId}, 2026)`);
  const upd = runs.filter(r => /^UPDATE Payments SET DatePaid/.test(r.sql));
  assert.strictEqual(upd.length, 1); assert(/"Desc"='EOY Skins' AND Detail='Refund'/.test(upd[0].sql), 'only refund rows can be marked paid');
  assert(!/Earned/.test(upd[0].sql), 'the amount is never touched');
  const dan = refundRows.find(r => r.ID === danId);
  assert(dan.DatePaid && dan.DatePaid !== '', 'DatePaid is set'); assert.strictEqual(dan.Earned, -10, 'still a $10 refund');
  sum = summary();
  assert.deepStrictEqual(sum.paid.map(r => [r.Player, r.amount]), [['Dan Bowen', 10]]);
  assert.strictEqual(sum.paidTotal, 10); assert.strictEqual(sum.unpaidTotal, 30); assert.strictEqual(sum.owedTotal, 30, 'owed drops by the paid $10');
  detail = run(`eoyRefundsDetailHtml(2026, ${JSON.stringify(sum)}, true)`);
  assert(/Refunds disbursed: \$10\.00/.test(detail) && /Disbursed<\/b> · paid /.test(detail));
  assert(/Refunded · paid /.test(run('psRefundPanelHtml(2026, 1)')));
  runs.length = 0; alerts.length = 0;
  await run(`markEoyRefundPaid(${danId}, 2026)`);                 // again: no second write
  assert(/already marked paid/.test(alerts[0])); assert.strictEqual(runs.filter(r => /^UPDATE/.test(r.sql)).length, 0);
  await run(`markEoyRefundPaid(99999, 2026)`);
  assert(/Refund not found/.test(alerts[1]));
  assert.deepStrictEqual(winnerOrCtpWrites(), [], 'marking a refund paid never touches Skin / CTP rows');
  assert.strictEqual(ledger(), ledgerBefore, 'winner rows (paid and unpaid) and CTP rows never changed');

  // ================= Refunds are not mixed into winnings
  const heldSql = html.slice(html.indexOf('const heldRows = query('), html.indexOf('const heldBalance'));
  assert(/Desc IN \('Skin','CTP'\)/.test(heldSql) && !/EOY Skins|Refund/.test(heldSql), 'WINNINGS HELD / UNPAID is Skin / CTP winners only');
  assert(/WINNINGS HELD \/ UNPAID/.test(html) && /refunds are separate/.test(html));
  assert(/eoyRefundsOwedTileHtml\(eoyRefundSum\)/.test(html) && /eoyRefundsDetailHtml\(season, eoyRefundSum, isOfficerOrDev\)/.test(html), 'Prize Money renders the refunds tile + detail');
  // EOY Collected is still gross (payments + transfers only; refunds are not subtracted)
  assert(/const eoyCollected\s*=\s*Math\.round\(\(eoyFromPayments \+ eoyFromTransfers\)/.test(html));

  // ================= No automatic refund / no writes on load or view
  reset(); runs.length = 0;
  run('recalcPostSeasonEoyRefunds(2026)'); run('getEoyRefundSummary(2026)'); run('getEoyRefundRows(2026)'); run('psRefundPanelHtml(2026, 1)');
  run(`eoyRefundsDetailHtml(2026, ${JSON.stringify(summary())}, true)`);
  assert.strictEqual(runs.length, 0, 'the refund readers and renderers never write');
  assert.strictEqual(confirms.length > 0, true);   // (the earlier officer actions asked for confirmation)
  // the only statement anywhere that inserts a Refund row lives in issuePostSeasonRefunds (officer click + confirm)
  const refundInsertAt = [...html.matchAll(/INSERT INTO Payments[^`]*'EOY Skins','Refund'/g)].map(m => m.index);
  assert.strictEqual(refundInsertAt.length, 1, 'exactly one place can record a refund');
  const fnAt = html.lastIndexOf('function ', refundInsertAt[0]);
  assert(/^function issuePostSeasonRefunds\(|^async function issuePostSeasonRefunds\(/.test(html.slice(html.lastIndexOf('\n', fnAt) + 1, fnAt + 40)) || html.slice(fnAt, fnAt + 40).includes('issuePostSeasonRefunds'));

  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
