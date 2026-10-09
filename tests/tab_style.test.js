// Top navigation looks like real tabs: dark bar, rounded-top tabs with their own background, an emoji on every tab.
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
const tabs = [...src.matchAll(/<div class="tab(?: active)?" data-tab="([a-z]+)"[^>]*>([^<]*)<\/div>/g)].map(m => ({ key: m[1], label: m[2] }));
assert(tabs.length >= 15, 'all top tabs found: ' + tabs.length);
tabs.forEach(t => assert(/^[^A-Za-z0-9\s]/.test(t.label), `tab ${t.key} starts with an emoji: ${t.label}`));
assert.strictEqual(new Set(tabs.map(t => t.label.split(' ')[0])).size, tabs.length, 'each tab has its own emoji');
const css = src.slice(src.indexOf('/* TABS'), src.indexOf('/* MAIN CONTENT */'));
assert(/\.tabs \{[^}]*background: var\(--green\)/.test(css), 'dark tab bar');
assert(/\.tab \{[^}]*border-radius: 9px 9px 0 0/.test(css) && /\.tab \{[^}]*background: rgba/.test(css), 'each tab is a rounded-top tab with its own background');
assert(/\.tab\.active \{[^}]*background: #fff[^}]*border-bottom-color: var\(--gold\)/.test(css), 'active tab is raised with a gold underline');
assert(/overflow-x: auto/.test(css), 'still scrolls sideways on a phone');
// usage tab names still strip the emoji
assert(/replace\(\/\^\[\^A-Za-z0-9\]\+\/, ''\)/.test(src));
assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
console.log('ok');
