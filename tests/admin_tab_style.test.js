// Admin tabs and sub-tabs look like real tabs (rounded top, own background, green + gold when active); the Table Maintenance and Logging tabs have emoji.
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
const css = src.slice(src.indexOf('/* Admin tabs and sub-tabs'), src.indexOf('.eg-input {'));
assert(/\.admin-btn \{[^}]*border-radius:9px 9px 0 0[^}]*background:#e8e0d0/.test(css), 'admin tabs are rounded-top blocks');
assert(/\.active-admin-btn \{[^}]*background:var\(--green\)[^}]*border-bottom:3px solid var\(--gold\)/.test(css), 'active admin tab is green with a gold underline');
assert(/\.admin-subbtn \{[^}]*border-radius:8px 8px 0 0[^}]*background:#e8e0d0/.test(css) && !/\.admin-subbtn \{[^}]*border-radius:20px/.test(css), 'sub-tabs are tabs, no longer pills');
assert(/\.active-admin-btn\.admin-subbtn \{[^}]*background:var\(--green\)/.test(css), 'active sub-tab is green');
['🗂️ Table Maintenance', '📜 Logging', '👥 Players', '⚙️ League Settings'].forEach(t => assert(src.includes('>' + t + '<'), t));
// the code that switches the active tab still relies on the same class names
assert(/_adminBtnBase\(s\) \{ return SUBNAV_SECTIONS\.has\(s\) \? 'admin-subbtn' : 'admin-btn'/.test(src) && /active-admin-btn/.test(src));
assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
console.log('ok');
