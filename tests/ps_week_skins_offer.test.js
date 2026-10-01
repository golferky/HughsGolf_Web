// Scoring a post-season hole for a player who hasn't paid for that week offers that week's skins (never writes anything).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const els = {};
const el = id => els[id] || (els[id] = { id, style: {}, textContent: '', dataset: {}, disabled: false, checked: false });
const writes = [], opened = [];
let radios = [];
const ctx = vm.createContext({
  document: { getElementById: id => id === 'entryGrid' ? { dataset: { postSeasonSeason: '2026' } } : el(id), querySelectorAll: () => radios },
  db: {}, console, parseInt, Set, Event: function () {},
  entryState: { _psWeek1Fb: 'Back' },
  computeEoyGrossByWeek: () => ({ weeks: { 1: new Set(['Tom Goetz']), 2: new Set(['Tom Goetz']) } }),
  getPostSeasonWeekEntry: () => ({ ok: true, total: 10 }),
  openPaymentModal: key => { opened.push(key); },
  serverRun: (...a) => writes.push(a),
});
vm.runInContext('const _psWeekOffersSeen = new Set();', ctx);
['psWeekForHoleIndex', 'psShouldOfferWeekSkins', 'psWeekOfferText', 'maybeOfferPostSeasonWeekSkins', 'closePostSeasonWeekOffer', 'openPaymentModalForWeek']
  .forEach(n => vm.runInContext(extract(n), ctx));
const holes = (...idx) => { const h = Array(18).fill(''); idx.forEach(i => h[i] = '4'); return h; };
const modal = () => els.psWeekOfferModal && els.psWeekOfferModal.style.display;
const offer = (key, hi) => { ctx.maybeOfferPostSeasonWeekSkins(key, hi); };

// Gary: unpaid, scores Week 2 (front 9 when Week 1 is the back 9) -> offered Week 2 only
ctx.entryState.gary = { active: 'Gary Scudder', holes: holes(0) };
offer('gary', 0);
assert.strictEqual(modal(), 'flex', 'modal shown');
assert(/hasn't paid for Week 2/.test(els.psWeekOfferTitle.textContent), els.psWeekOfferTitle.textContent);
assert(/Week 2 Skins & CTP only/.test(els.psWeekOfferBody.textContent));
assert(/no Week 1 score.*can't win the League Championship/.test(els.psWeekOfferNote.textContent), 'CC note');
assert.strictEqual(els.psWeekOfferPay.textContent, 'Pay $10 — Week 2 only');
// only asked once per player per week
els.psWeekOfferModal.style.display = 'none';
offer('gary', 1);
assert.strictEqual(modal(), 'none', 'not asked again for the same week');
// a Week 1 hole (back 9, hi 9..17) is a different week -> asked again, with no CC note
ctx.entryState.gary.holes = holes(0, 9);
offer('gary', 9);
assert.strictEqual(modal(), 'flex');
assert(/Week 1/.test(els.psWeekOfferTitle.textContent));
assert.strictEqual(els.psWeekOfferNote.style.display, 'none', 'no CC note for Week 1');
// a player who already paid for that week is never asked
els.psWeekOfferModal.style.display = 'none';
ctx.entryState.tom = { active: 'Tom Goetz', holes: holes(0, 9) };
offer('tom', 0); offer('tom', 9);
assert.strictEqual(modal(), 'none', 'paid players are not asked');
// "Pay" opens the normal payment modal for that player with only that week selected; nothing is written
radios = ['1', '2', 'both'].map(v => ({ value: v, checked: v === 'both', disabled: true, onchange() { this.fired = true; } }));
Object.assign(el('payEoyCheck'), { disabled: true, checked: false }); el('payEoyAmt').disabled = true;
ctx.openPaymentModalForWeek('gary', 2);
assert.deepStrictEqual(opened, ['gary']);
assert.deepStrictEqual(radios.map(r => r.checked), [false, true, false], 'only Week 2 selected');
assert(radios.every(r => !r.disabled) && els.payEoyCheck.checked && !els.payEoyCheck.disabled);
assert(radios[1].fired, 'amount wiring runs for the chosen week');
assert.strictEqual(writes.length, 0, 'offering/opening writes nothing');
// the helper rules
const seen = new Set();
assert.strictEqual(ctx.psShouldOfferWeekSkins('', 1, new Set(), seen), false);
assert.strictEqual(ctx.psShouldOfferWeekSkins('A', 3, new Set(), seen), false);
assert.strictEqual(ctx.psShouldOfferWeekSkins('A', 1, new Set(['A']), seen), false);
assert.strictEqual(ctx.psShouldOfferWeekSkins('A', 1, new Set(), seen), true);
assert.strictEqual(ctx.psShouldOfferWeekSkins('A', 1, new Set(), seen), false);
// wiring: only manual score typing in post-season mode, only for a real score; Seed / startup paths do not offer
assert(/if \(isPS && parseInt\(val\) > 0\) maybeOfferPostSeasonWeekSkins\(key, hi\);/.test(src), 'onScoreInput offers');
assert.strictEqual([...src.matchAll(/maybeOfferPostSeasonWeekSkins\(/g)].length, 2, 'defined once, called once (onScoreInput)');
assert(/id="psWeekOfferModal"/.test(src));
console.log('ok');
