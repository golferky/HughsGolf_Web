// Post-season Skins/CTP auto-calc also runs when an officer signs in or opens Skins & CTPs / Earned (a fully scored week never re-checked stayed on Preview).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
let officer = true, now = 1000000; const log = []; let commitResult = { 1: false, 2: true }, active = 'ps_skins';
const ctx = vm.createContext({ db: {}, Date: { now: () => now }, window: {}, Promise, console, isOfficerRole: () => officer,
  psCtpAutoAll: async s => { log.push('ctp:' + s); }, psSkinAutoCommit: async (s, w) => { log.push(`skin:${s}:${w}`); return commitResult[w]; },
  document: { querySelector: () => ({ dataset: { tab: active } }) }, loadPsSkins: () => log.push('reload skins'), loadPsEarned: () => log.push('reload earned') });
vm.runInContext(extract('psAutoOnView'), ctx);
(async () => {
  const flush = () => new Promise(r => setTimeout(r, 5));
  ctx.psAutoOnView(2026); await flush();
  assert.deepStrictEqual(log, ['ctp:2026', 'skin:2026:1', 'skin:2026:2', 'reload skins'], 'checks both weeks and redraws the open tab when one calculated');
  log.length = 0; ctx.psAutoOnView(2026); await flush(); assert.deepStrictEqual(log, [], 'throttled');
  now += 20000; commitResult = { 1: false, 2: false }; active = 'ps_earned'; ctx.psAutoOnView(2026); await flush();
  assert.deepStrictEqual(log, ['ctp:2026', 'skin:2026:1', 'skin:2026:2'], 'nothing calculated: no redraw');
  now += 20000; log.length = 0; officer = false; ctx.psAutoOnView(2026); await flush(); assert.deepStrictEqual(log, [], 'players never trigger it');
  now += 20000; officer = true; commitResult = { 1: true, 2: false }; active = 'ps_earned'; log.length = 0; ctx.psAutoOnView(2026); await flush(); assert(log.includes('reload earned'));
  // wiring
  assert(/function loadPsSkins\(\) \{[^]*?psAutoOnView\(season\);/.test(src.slice(src.indexOf('function loadPsSkins() {'), src.indexOf('function loadPsSkins() {') + 400)));
  assert(/function loadPsEarned\(\) \{[^]*?psAutoOnView\(season\);/.test(src.slice(src.indexOf('function loadPsEarned() {'), src.indexOf('function loadPsEarned() {') + 400)));
  assert(/startHeartbeat\(\);[^\n]*\n  if \(isOfficerRole\(\)\) setTimeout\(\(\) => \{ try \{ psAutoOnView\(getCurrentSeason\(\)\); \}/.test(src), 'also at officer sign-in');
  assert(/auto-calculation paused: \$\{escapeHtml\(String\(why\.why\)\)\}/.test(src) && /psSkinAutoEligible\(season, w, psTodayInt\(\)\) : null/.test(src), 'officers see why a week is not calculating');
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
