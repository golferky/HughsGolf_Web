// Admins and developers can switch the app to "View as Player" and back. It only reduces what is shown, keeps the real role
// for audit/session logic, and never persists.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const adminOnly = src.match(/const ADMIN_ONLY_TABS = new Set\(\[([^\]]*)\]\)/)[1];
function world(role, activeTab = 'admin') {
  const els = { viewAsPlayerBtn: { style: {}, textContent: '' }, viewAsPlayerBanner: { style: {} } };
  const log = [];
  const c = vm.createContext({
    Set, db: {}, document: { getElementById: id => els[id] || null },
    currentUser: role ? { name: 'Pat', role, realRole: role } : null,
    activeTabName: () => c.__tab, __tab: activeTab,
    applyRoleAccess: () => { log.push('applyRoleAccess:' + c.currentUser.role); c.updateViewAsPlayerUi(); },
    switchTab: t => { log.push('switchTab:' + t); c.__tab = t; }, refreshTab: t => log.push('refreshTab:' + t),
  });
  vm.runInContext(`const ADMIN_ONLY_TABS = new Set([${adminOnly}]);`, c);
  ['canAccessTab', 'canViewAsPlayer', 'isViewingAsPlayer', 'actorRole', 'sessionRole', 'updateViewAsPlayerUi', 'setViewAsPlayer', 'toggleViewAsPlayer', 'isPersistentSessionRole'].forEach(n => vm.runInContext(extract(n), c));
  // canAccessTab reads the default role from currentUser at call time
  return { c, els, log };
}

for (const role of ['admin', 'developer']) {
  const w = world(role, 'scorecard');
  w.c.updateViewAsPlayerUi();
  assert.strictEqual(w.els.viewAsPlayerBtn.style.display, '', role + ': the toggle is shown'); assert.strictEqual(w.els.viewAsPlayerBtn.textContent, '👁 View as Player');
  assert.strictEqual(w.els.viewAsPlayerBanner.style.display, 'none');
  // ON: role becomes player everywhere, real role kept, UI updated, current screen re-rendered
  assert.strictEqual(w.c.setViewAsPlayer(true), true);
  assert.strictEqual(w.c.currentUser.role, 'player'); assert.strictEqual(w.c.currentUser.realRole, role);
  assert.strictEqual(w.c.isViewingAsPlayer(), true);
  assert.strictEqual(w.els.viewAsPlayerBanner.style.display, '', 'banner shown'); assert.strictEqual(w.els.viewAsPlayerBtn.textContent, '🛡 Back to Admin Mode');
  assert.deepStrictEqual(w.log, ['applyRoleAccess:player', 'refreshTab:scorecard']);
  assert.strictEqual(w.c.canAccessTab('admin'), false, 'Admin tab hidden while viewing as a player');
  assert.strictEqual(w.c.canAccessTab('payments'), false); assert.strictEqual(w.c.canAccessTab('scorecard'), true);
  assert.strictEqual(w.c.actorRole(), role, 'audit headers keep the real role'); assert.strictEqual(w.c.sessionRole(), role);
  assert.strictEqual(w.c.isPersistentSessionRole(w.c.sessionRole()), true, 'session timeout logic still treats them as an admin');
  // OFF: back to the real role
  w.log.length = 0;
  assert.strictEqual(w.c.toggleViewAsPlayer(), undefined);
  assert.strictEqual(w.c.currentUser.role, role); assert.strictEqual(w.c.isViewingAsPlayer(), false);
  assert.strictEqual(w.els.viewAsPlayerBanner.style.display, 'none'); assert.strictEqual(w.els.viewAsPlayerBtn.textContent, '👁 View as Player');
  assert.strictEqual(w.c.canAccessTab('admin'), true, 'admin tools are back');
  assert.deepStrictEqual(w.log, ['applyRoleAccess:' + role, 'refreshTab:scorecard']);
}

// on the Admin tab: switching to player view leaves it (the player can't open it)
{ const w = world('admin', 'admin'); w.c.setViewAsPlayer(true);
  assert.deepStrictEqual(w.log, ['applyRoleAccess:player', 'switchTab:home'], 'moves off the Admin tab to Home'); }

// a developer in player view is a plain player for every check (dev-only controls too)
{ const w = world('developer', 'home'); w.c.setViewAsPlayer(true); assert.notStrictEqual(w.c.currentUser.role, 'developer'); assert.strictEqual(w.c.currentUser.role, 'player'); }

// players (and logged-out users) can't use it
{ const w = world('player', 'home'); w.c.updateViewAsPlayerUi();
  assert.strictEqual(w.els.viewAsPlayerBtn.style.display, 'none'); assert.strictEqual(w.c.setViewAsPlayer(true), false); assert.strictEqual(w.c.currentUser.role, 'player'); assert.deepStrictEqual(w.log, []);
  const o = world(null, 'home'); o.c.updateViewAsPlayerUi(); assert.strictEqual(o.els.viewAsPlayerBtn.style.display, 'none'); assert.strictEqual(o.c.setViewAsPlayer(true), false); }
// a plain player can never reach admin by calling it with false
{ const w = world('player', 'home'); assert.strictEqual(w.c.setViewAsPlayer(false), false); assert.strictEqual(w.c.currentUser.role, 'player'); }

// wiring: button + banner, real role remembered at login, audit headers and session checks use the real role, logout clears it
assert(/id="viewAsPlayerBtn" onclick="toggleViewAsPlayer\(\)"/.test(src) && /id="viewAsPlayerBanner"/.test(src) && /onclick="setViewAsPlayer\(false\)"/.test(src));
assert(/currentUser\.realRole = currentUser\.role;/.test(src), 'login remembers the real role');
assert.strictEqual((src.match(/'X-Actor-Role': actorRole\(\)/g) || []).length, 7); assert(!/'X-Actor-Role': currentUser\?\.role/.test(src), 'no audit header uses the swapped role');
assert(!/isPersistentSessionRole\(currentUser\.role\)/.test(src), 'session logic uses the real role');
assert(/updateViewAsPlayerUi\(\);\s*\n\s*\n\s*\/\/ League Settings/.test(src), 'applyRoleAccess keeps the toggle in sync');
assert(/currentUser = null;\s*\n\s*updateViewAsPlayerUi\(\);/.test(src), 'logout clears the toggle UI (currentUser is gone, so the mode cannot survive)');
assert(!/localStorage\.setItem\([^)]*viewAs|sessionStorage\.setItem\([^)]*viewAs/i.test(src), 'view-as-player is never persisted');
console.log('ok');
