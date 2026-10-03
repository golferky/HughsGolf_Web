// View mode: a developer can view the app as Developer / Admin / Player, an admin as Admin / Player. Modes only ever reduce
// what is shown (never above the real role), keep the real role for audit/session logic, and are never persisted.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const constLine = name => { const m = src.match(new RegExp(`const ${name} = [^;]*;`)); assert(m, name); return m[0]; };
const adminOnly = src.match(/const ADMIN_ONLY_TABS = new Set\(\[([^\]]*)\]\)/)[1];
function world(role, activeTab = 'admin') {
  const els = { viewModeGroup: { style: {}, innerHTML: '' }, viewAsPlayerBanner: { style: {}, innerHTML: '' } };
  const log = [];
  const c = vm.createContext({
    Set, db: {}, document: { getElementById: id => els[id] || null },
    currentUser: role ? { name: 'Pat', role, realRole: role } : null,
    activeTabName: () => c.__tab, __tab: activeTab,
    applyRoleAccess: () => { log.push('applyRoleAccess:' + c.currentUser.role); c.updateViewAsPlayerUi(); },
    switchTab: t => { log.push('switchTab:' + t); c.__tab = t; }, refreshTab: t => log.push('refreshTab:' + t),
  });
  vm.runInContext(`const ADMIN_ONLY_TABS = new Set([${adminOnly}]);` + constLine('VIEW_MODE_RANK') + constLine('VIEW_MODE_LABEL'), c);
  ['canAccessTab', 'viewModes', 'canViewAsPlayer', 'isViewingAsPlayer', 'isViewingBelowRealRole', 'actorRole', 'sessionRole', 'updateViewAsPlayerUi',
   'setViewMode', 'setViewAsPlayer', 'toggleViewAsPlayer', 'isPersistentSessionRole'].forEach(n => vm.runInContext(extract(n), c));
  return { c, els, log };
}
const modes = w => Array.from(w.c.viewModes());
const buttons = w => [...w.els.viewModeGroup.innerHTML.matchAll(/setViewMode\('(\w+)'\)/g)].map(m => m[1]);

// ---- available modes by real role
assert.deepStrictEqual(modes(world('developer')), ['developer', 'admin', 'player'], 'developer: three levels');
assert.deepStrictEqual(modes(world('admin')), ['admin', 'player'], 'admin: two levels, never developer');
assert.deepStrictEqual(modes(world('player')), []); assert.deepStrictEqual(modes(world(null)), []);

// ---- developer walks through all three levels
{
  const w = world('developer', 'scorecard'); w.c.updateViewAsPlayerUi();
  assert.deepStrictEqual(buttons(w), ['developer', 'admin', 'player'], 'header shows Developer / Admin / Player');
  assert(/background:#90caf9[^"]*">Developer</.test(w.els.viewModeGroup.innerHTML), 'current mode is highlighted');
  assert.strictEqual(w.els.viewModeGroup.style.display, ''); assert.strictEqual(w.els.viewAsPlayerBanner.style.display, 'none', 'no banner at your own level');

  assert.strictEqual(w.c.setViewMode('admin'), true);
  assert.strictEqual(w.c.currentUser.role, 'admin'); assert.strictEqual(w.c.currentUser.realRole, 'developer');
  assert.strictEqual(w.c.canAccessTab('admin'), true, 'admin view still has the Admin tab');
  assert.strictEqual(w.els.viewAsPlayerBanner.style.display, ''); assert(/Viewing as an Admin/.test(w.els.viewAsPlayerBanner.innerHTML) && /Back to Developer Mode/.test(w.els.viewAsPlayerBanner.innerHTML) && /setViewMode\('developer'\)/.test(w.els.viewAsPlayerBanner.innerHTML));
  assert(/background:#90caf9[^"]*">Admin</.test(w.els.viewModeGroup.innerHTML), 'Admin is now highlighted');
  assert.deepStrictEqual(w.log, ['applyRoleAccess:admin', 'refreshTab:scorecard']);

  w.log.length = 0;
  assert.strictEqual(w.c.setViewMode('player'), true);
  assert.strictEqual(w.c.currentUser.role, 'player'); assert.strictEqual(w.c.isViewingAsPlayer(), true);
  assert.strictEqual(w.c.canAccessTab('admin'), false, 'player view: no Admin tab');
  assert(/Viewing as a Player/.test(w.els.viewAsPlayerBanner.innerHTML) && /Back to Developer Mode/.test(w.els.viewAsPlayerBanner.innerHTML));
  // jump straight from player back up to developer
  assert.strictEqual(w.c.setViewMode('developer'), true);
  assert.strictEqual(w.c.currentUser.role, 'developer'); assert.strictEqual(w.els.viewAsPlayerBanner.style.display, 'none'); assert.strictEqual(w.c.isViewingBelowRealRole(), false);
  // audit + session always use the real role
  w.c.setViewMode('player'); assert.strictEqual(w.c.actorRole(), 'developer'); assert.strictEqual(w.c.sessionRole(), 'developer'); assert.strictEqual(w.c.isPersistentSessionRole(w.c.sessionRole()), true);
}

// ---- admin: two levels, no escalation
{
  const w = world('admin', 'admin'); w.c.updateViewAsPlayerUi();
  assert.deepStrictEqual(buttons(w), ['admin', 'player']);
  assert.strictEqual(w.c.setViewMode('developer'), false, 'an admin can never view (or become) a developer'); assert.strictEqual(w.c.currentUser.role, 'admin');
  assert.strictEqual(w.c.setViewMode('bogus'), false);
  assert.strictEqual(w.c.setViewMode('player'), true);
  assert.deepStrictEqual(w.log, ['applyRoleAccess:player', 'switchTab:home'], 'leaves the Admin tab for Home when going to Player');
  assert(/Back to Admin Mode/.test(w.els.viewAsPlayerBanner.innerHTML));
  assert.strictEqual(w.c.setViewMode('developer'), false, 'still cannot reach developer from the player view'); assert.strictEqual(w.c.currentUser.role, 'player');
  assert.strictEqual(w.c.setViewMode('admin'), true); assert.strictEqual(w.c.currentUser.role, 'admin');
}

// ---- developer on the Admin tab: Admin view keeps it, Player view leaves it
{ const w = world('developer', 'admin'); w.c.setViewMode('admin'); assert.deepStrictEqual(w.log, ['applyRoleAccess:admin', 'refreshTab:admin']);
  w.log.length = 0; w.c.setViewMode('player'); assert.deepStrictEqual(w.log, ['applyRoleAccess:player', 'switchTab:home']); }

// ---- players and logged-out users: nothing available, no escalation
for (const role of ['player', null]) {
  const w = world(role, 'home'); w.c.updateViewAsPlayerUi();
  assert.strictEqual(w.els.viewModeGroup.style.display, 'none'); assert.strictEqual(w.els.viewModeGroup.innerHTML, '');
  for (const m of ['developer', 'admin', 'player']) assert.strictEqual(w.c.setViewMode(m), false, String(role) + ' cannot pick ' + m);
  assert.strictEqual(w.c.canViewAsPlayer(), false); assert.deepStrictEqual(w.log, []);
  if (role) assert.strictEqual(w.c.currentUser.role, 'player');
}

// ---- the old toggle API still works on top of the modes (banner/back button, setViewAsPlayer)
{ const w = world('developer', 'home'); w.c.setViewAsPlayer(true); assert.strictEqual(w.c.currentUser.role, 'player'); w.c.setViewAsPlayer(false); assert.strictEqual(w.c.currentUser.role, 'developer');
  w.c.toggleViewAsPlayer(); assert.strictEqual(w.c.currentUser.role, 'player'); w.c.toggleViewAsPlayer(); assert.strictEqual(w.c.currentUser.role, 'developer');
  const a = world('admin', 'home'); a.c.setViewAsPlayer(true); assert.strictEqual(a.c.currentUser.role, 'player'); a.c.setViewAsPlayer(false); assert.strictEqual(a.c.currentUser.role, 'admin'); }

// ---- wiring
assert(/<span id="viewModeGroup"/.test(src) && !/id="viewAsPlayerBtn"/.test(src), 'header has the 3-way view switcher (old single button replaced)');
assert(/id="viewAsPlayerBanner"/.test(src));
assert(/currentUser\.realRole = currentUser\.role;/.test(src), 'login remembers the real role');
assert.strictEqual((src.match(/'X-Actor-Role': actorRole\(\)/g) || []).length, 7); assert(!/'X-Actor-Role': currentUser\?\.role/.test(src));
assert(!/isPersistentSessionRole\(currentUser\.role\)/.test(src), 'session logic uses the real role');
assert(/updateViewAsPlayerUi\(\);\s*\n\s*\n\s*\/\/ League Settings/.test(src), 'applyRoleAccess keeps the switcher in sync');
assert(/currentUser = null;\s*\n\s*updateViewAsPlayerUi\(\);/.test(src), 'logout clears it');
assert(!/localStorage\.setItem\([^)]*viewMode|sessionStorage\.setItem\([^)]*viewMode|sessionStorage\.setItem\([^)]*viewAs/i.test(src), 'never persisted');
console.log('ok');
