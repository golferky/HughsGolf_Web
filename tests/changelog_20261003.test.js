// The October 3, 2026 changelog entry: one version/date, valid categories, player-facing text free of audit-script items,
// and the app/server versions bumped so the "What's New" popup appears.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
const app = fs.readFileSync(__dirname + '/../app.py', 'utf8');
const start = src.indexOf("ensureVersion('20261003.1'"); assert(start > 0, 'entry present');
const end = src.indexOf('\n  ]);', start) + 6;
const calls = [];
vm.runInContext(src.slice(start, end), vm.createContext({ ensureVersion: (v, d, e) => calls.push({ v, d, e }) }));
assert.strictEqual(calls.length, 1);
const { v, d, e } = calls[0];
assert.strictEqual(v, '20261003.1'); assert.strictEqual(d, 'October 3, 2026', 'everything is recapped under 10/3');
const cats = new Set(['summary', 'adminsummary', 'enhancement', 'admin', 'bugfix', 'developer']);
e.forEach(([cat, item, notes, ord]) => {
  assert(cats.has(cat), 'valid category: ' + cat); assert(typeof item === 'string' && item.length > 10, 'item text'); assert(typeof notes === 'string'); assert(Number.isInteger(ord));
});
const by = k => e.filter(x => x[0] === k);
assert.strictEqual(by('summary').length, 1); assert.strictEqual(by('adminsummary').length, 1);
assert(by('enhancement').length >= 5 && by('admin').length >= 5 && by('bugfix').length >= 5, 'each audience has entries');
// audit scripts and PR plumbing stay out of everything players (or admins) can read
const publicText = e.filter(x => x[0] !== 'developer').map(x => x[1] + ' ' + x[2]).join(' ');
assert(!/audit|tools\//i.test(publicText), 'no audit scripts in player / admin text');
assert(by('developer').some(x => /audit/i.test(x[1])), 'audit scripts are listed for developers only');
// sort orders unique within a category (display order)
['enhancement', 'admin', 'bugfix', 'developer'].forEach(k => { const o = by(k).map(x => x[3]); assert.strictEqual(new Set(o).size, o.length, k + ' orders are unique'); });
// the specific fixes and features are all recapped
const all = e.map(x => x[1]).join(' | ');
['Scores tab', 'Stableford', 'League Rankings', 'EOY Paid', 'Admin tab', 'Back 9', 'haven\'t paid in', 'Sort by Score', 'Board', 'View as Player', 'Clear one player'].forEach(t => assert(all.includes(t), 'mentions ' + t));
// versions: newer than the last release so the popup shows, and html/server agree
const verOk = v => /^\d{8}\.\d+$/.test(v) && v >= '20261003.1';   // golden rule: every change bumps yyyymmdd.N, so only require 'at least the 10/3 release'
assert(verOk(src.match(/const APP_VERSION = '([^']+)';/)[1])); assert(verOk(app.match(/VERSION\s+= '([^']+)-sandbox'/)[1]));
assert('20261003.1' > '20260928.6');
console.log('ok');
