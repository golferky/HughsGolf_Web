// Clicking the Admin tab must open an Admin section (it used to ask for 'scores', which now redirects to the Scores tab, so
// the Admin tab looked dead).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const sections = JSON.parse('[' + src.match(/const ADMIN_SECTIONS = \[([^\]]*)\]/)[1].replace(/'/g, '"') + ']');
assert(sections.includes('players') && !sections.includes('scores'), "'scores' is no longer an admin section");
function world(remembered) {
  const calls = [];
  const c = vm.createContext({ db: {}, ADMIN_SECTIONS: sections, window: { _adminSection: remembered }, isSandboxHost: () => false, loadAdminPlayers() {}, location: { port: '' },
    showAdminSection: s => calls.push(s), document: { getElementById: id => ({ addEventListener() {}, style: {} }) } });
  vm.runInContext(extract('loadAdminTab'), c); c.loadAdminTab();
  return calls;
}
assert.deepStrictEqual(world(undefined), ['players'], 'first visit opens Players');
assert.deepStrictEqual(world('gallus'), ['gallus'], 'reopens the section you were last on');
assert.deepStrictEqual(world('scores'), ['players'], 'never asks for the section that moved to the Scores tab');
assert.deepStrictEqual(world('bogus'), ['players'], 'unknown section falls back safely');
// the real showAdminSection records the section (but not the redirect)
const calls = []; const s = vm.createContext({ switchTab: t => calls.push('tab:' + t), pvTrack() {}, window: {}, adminGroupForSection: () => '', ADMIN_GROUPS: { tables: [], logging: [] }, ADMIN_SECTIONS: [], document: { getElementById: () => null, querySelectorAll: () => [] }, adminIdSuffix: x => x, db: null, tryTrustedAutoLogin: () => true, refreshTab() {}, refreshTestModeUi() {}, initHomeCardCollapse() {}, buildTableList() {}, initEntry() {}, Set });
vm.runInContext(extract('showAdminSection'), s);
s.showAdminSection('scores'); assert.deepStrictEqual(calls, ['tab:scorecard']); assert.strictEqual(s.window._adminSection, undefined, 'the redirect is not remembered');
assert(!/function loadAdminTab\(\) \{[^}]*showAdminSection\('scores'\)/.test(src), 'Admin tab no longer defaults to scores');
console.log('ok');
