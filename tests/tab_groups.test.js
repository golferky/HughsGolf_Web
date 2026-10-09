// Tab groups: every old tab keeps its key and section; groups only choose which tabs are on screen.
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
const layout = {};
for (const m of src.matchAll(/<div class="subtab-group" data-group="([a-z]+)"[^>]*>([\s\S]*?)\n    <\/div>/g)) layout[m[1]] = [...m[2].matchAll(/data-tab="([a-z]+)"/g)].map(x => x[1]);
assert.deepStrictEqual(layout, {
  home: ['home', 'stats'], play: ['scorecard', 'matches', 'stableford', 'skins', 'handicaps'], standings: ['standings'],
  money: ['payments', 'prizemoney'], league: ['schedule', 'noshows', 'board', 'whatsnew', 'help'], admin: ['admin'] }, 'group layout');
// every tab still has its section
Object.values(layout).flat().forEach(k => assert(src.includes(`id="tab-${k}"`), 'section for ' + k));
// the group logic hooks into the existing switch, the role check, the Board badge and jumpToStableford
const sw = src.slice(src.indexOf('function switchTab('), src.indexOf('function switchTab(') + 900);
assert(/syncTabGroups\(\);\s*pvTrack\(targetTab\)/.test(sw), 'switchTab syncs the groups and still tracks the tab key');
assert(/canAccessTab\(t, role\)[\s\S]{0,200}syncTabGroups\(\)/.test(src), 'role visibility re-syncs the groups');
assert((src.match(/syncTabGroups\(\)/g) || []).length >= 6, 'called from the badge, jumpToStableford and role code too');
assert(/localStorage\.setItem\('lastTab:' \+ activeGroup, activeTab\)/.test(src) && /localStorage\.getItem\('lastTab:' \+ group\)/.test(src), 'remembers the last tab of each group');
console.log('ok');
