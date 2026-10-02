// The Score Entry grid + Post-Season Prize Breakdown live in their own "Scores" tab (not the Admin section): every role can see
// them, players read-only. Old admin entry points keep working by redirecting to the new tab.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
// -- the tab exists for everyone
assert(/<div class="tab" data-tab="scorecard"[^>]*>📝 Scores<\/div>/.test(src), 'Scores tab button');
assert(/<div class="section" id="tab-scorecard"><\/div>/.test(src), 'Scores tab section');
const adminOnly = src.match(/const ADMIN_ONLY_TABS = new Set\(\[([^\]]*)\]\)/)[1];
assert(!/scorecard/.test(adminOnly), 'not admin-only: ' + adminOnly);
const ctx = vm.createContext({ currentUser: { role: 'player' }, Set });
vm.runInContext(`const ADMIN_ONLY_TABS = new Set([${adminOnly}]);` + extract('canAccessTab'), ctx);
assert.strictEqual(ctx.canAccessTab('scorecard', 'player'), true, 'players can open Scores');
assert.strictEqual(ctx.canAccessTab('admin', 'player'), false, 'Admin still admin-only');
assert.strictEqual(ctx.canAccessTab('prizemoney', 'player'), false);

// -- the grid is hosted in the Scores tab, not the Admin tab
assert(/_scoresTabEl = document\.getElementById\('tab-scorecard'\)/.test(src) && /_scoresTabEl\.appendChild\(_scoresEl\)/.test(src));
assert(!/getElementById\('tab-admin'\);\s*\n\s*if \(_scoresEl/.test(src), 'adminScores is no longer moved into the admin tab');

// -- admin section: no Scores button/section; old callers redirect to the new tab
assert(!/id="adminBtnScores"/.test(src), 'admin Scores button removed');
assert(!/const ADMIN_SECTIONS = \[[^\]]*'scores'/.test(src), "'scores' is not an admin section");
const calls = []; 
const a = vm.createContext({ switchTab: t => calls.push(['switchTab', t]), pvTrack: () => calls.push(['pvTrack']) });
vm.runInContext(extract('showAdminSection'), a);
a.showAdminSection('scores');
assert.deepStrictEqual(calls, [['switchTab', 'scorecard']], "showAdminSection('scores') just opens the Scores tab");
// refreshTab loads the grid when the Scores tab is opened
const log = [];
const r = vm.createContext({ db: {}, courseData: null, initEntry: () => log.push('initEntry'), reRenderEntry: () => log.push('reRender'), switchTab: t => log.push('switchTab:' + t), setTimeout: () => {}, highlightCurrentPlayer() {} });
vm.runInContext(extract('refreshTab'), r);
r.refreshTab('scorecard'); assert.deepStrictEqual(log, ['initEntry']);
r.courseData = {}; log.length = 0; r.refreshTab('scorecard'); assert.deepStrictEqual(log, ['reRender']);
log.length = 0; r.refreshTab('scores'); assert.deepStrictEqual(log, ['switchTab:scorecard'], 'legacy "scores" tab name redirects');
// external DB refresh watches the new tab name
assert(/activeTabName\(\) !== 'scorecard'/.test(src) && /targetTab === 'scorecard' && DB_UPDATE_PENDING/.test(src));

// -- players see it read-only: no edit controls
assert(/groupsBtn\.style\.display = isOfficer \? '' : 'none'/.test(src), 'Groups button is officer-only');
assert(/entrySaveBtn\.style\.display\s+= isOfficer/.test(src) && /entryClearBtn\.style\.display = isOfficer/.test(src), 'Submit / Clear are officer-only');
assert(/if \(currentUser\?\.role === 'admin' \|\| currentUser\?\.role === 'developer'\) sepTd\.appendChild\(_egClrBtn\)/.test(src), 'group Clear is officer-only');
assert(/if \(currentUser\?\.role === 'player'\) \{\s*\n\s*inp\.readOnly = true;/.test(src), 'score inputs are read-only for players');
assert(/const hide = currentUser\?\.role === 'player';/.test(src), 'per-nine clear ✕ hidden for players');
assert(/if \(!\(currentUser\?\.role === 'admin' \|\| currentUser\?\.role === 'developer'\) \|\| !season\) return '';/.test(src), 'refund controls are officer-only');
console.log('ok');
