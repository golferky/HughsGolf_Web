// Top navigation: groups on a dark bar, the active group's tabs on a bar under it. Both are real tabs with emoji.
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
const groups = [...src.matchAll(/<div class="gtab(?: active)?" data-group="([a-z]+)">([^<]*)/g)].map(m => ({ key: m[1], label: m[2] }));
assert.deepStrictEqual(groups.map(g => g.key), ['home', 'play', 'money', 'league', 'admin']);
groups.forEach(g => assert(/^[^A-Za-z0-9\s]/.test(g.label), `group ${g.key} starts with an emoji: ${g.label}`));
const tabs = [...src.matchAll(/<div class="tab(?: active)?" data-tab="([a-z]+)"[^>]*>([^<]*)<\/div>/g)].map(m => ({ key: m[1], label: m[2] }));
assert(tabs.length === 16, 'all 16 tabs are still there: ' + tabs.length);
tabs.forEach(t => assert(/^[^A-Za-z0-9\s]/.test(t.label), `tab ${t.key} starts with an emoji: ${t.label}`));
assert.strictEqual(new Set(tabs.map(t => t.label.split(' ')[0])).size, tabs.length, 'each tab has its own emoji');
const css = src.slice(src.indexOf('/* TABS'), src.indexOf('/* MAIN CONTENT */'));
assert(/\.tabs \{[^}]*background: var\(--green\)/.test(css), 'dark group bar');
assert(/\.gtab \{[^}]*border-radius: 9px 9px 0 0/.test(css) && /\.gtab \{[^}]*background: rgba/.test(css), 'groups are rounded-top tabs');
assert(/\.gtab\.active \{[^}]*background: #fff[^}]*border-bottom-color: var\(--gold\)/.test(css), 'active group is raised with a gold underline');
assert(/\.tab \{[^}]*border-radius: 8px 8px 0 0/.test(css) && /\.tab\.active \{[^}]*background: var\(--green\)/.test(css), 'sub-tabs are tabs; the active one is green');
assert(/overflow-x: auto/.test(css), 'still scrolls sideways on a phone');
assert(/replace\(\/\^\[\^A-Za-z0-9\]\+\/, ''\)/.test(src), 'usage tab names still strip the emoji');
assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
console.log('ok');
