// Oct 11 issues: medals follow the prize places, skins preview says who it waits on, "currently logged in" status, played dates.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
const plain = x => JSON.parse(JSON.stringify(x));
let rows = [];
const ctx = vm.createContext({ String, Set, JSON, Date, escapeHtml: s => String(s), SESSION_TIMEOUT: 30 * 60 * 1000, roleFromOfficerValue: o => /admin|developer/i.test(o || '') ? 'admin' : 'player',
  isPersistentSessionRole: r => r === 'admin' || r === 'developer', whosonAgeText: s => s < 60 ? 'just now' : Math.round(s / 60) + 'm ago', psWeekScorerRows: () => rows });
['psPaidPlaces', 'psMedalLabel', 'loggedInStatusHtml', 'psWeekWaitingOn'].forEach(f => vm.runInContext(extract(f), ctx));
// medals: two paid places -> 3rd place has no medal, just "3."; three paid places -> bronze; ties keep the T
assert.strictEqual(ctx.psPaidPlaces([100, 50]), 2); assert.strictEqual(ctx.psPaidPlaces([100, 50, 25]), 3); assert.strictEqual(ctx.psPaidPlaces([100, 0, 0]), 1); assert.strictEqual(ctx.psPaidPlaces([]), 0);
assert.strictEqual(ctx.psMedalLabel(1, false, 2), '🥇'); assert.strictEqual(ctx.psMedalLabel(2, false, 2), '🥈');
assert.strictEqual(ctx.psMedalLabel(3, false, 2), '3.'); assert.strictEqual(ctx.psMedalLabel(3, false, 3), '🥉');
assert.strictEqual(ctx.psMedalLabel(4, false, 3), '4.'); assert.strictEqual(ctx.psMedalLabel(2, true, 2), '🥈T2'); assert.strictEqual(ctx.psMedalLabel(3, true, 2), 'T3'); assert.strictEqual(ctx.psMedalLabel(null, false, 2), '—');
// skins preview: who is still short of 9 holes
rows = [{ Player: 'Zed', 1: 4, 2: 5, 3: 4, 4: 3, 5: 4, 6: 5, 7: 4, 8: 3, 9: 4 }, { Player: 'Amy', 1: 5, 2: 4, 3: null, 4: '', 5: 4, 6: null, 7: null, 8: null, 9: null }, { Player: 'Bo', 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4, 9: null }];
assert.deepStrictEqual(plain(ctx.psWeekWaitingOn({ date: 20261006, potPlayers: ['Zed', 'Amy', 'Bo'] })), [{ player: 'Amy', holes: 3 }, { player: 'Bo', holes: 8 }]);
rows = []; assert.deepStrictEqual(plain(ctx.psWeekWaitingOn({ date: 1, potPlayers: [] })), []);
// currently logged in: real activity, not login age; admins never "time out"
const pres = { Alice: { online: true, secondsAgo: 30 }, Bob: { online: false, secondsAgo: 600 }, Cy: { online: false, secondsAgo: 3 * 3600 }, Dee: { online: false, secondsAgo: 3 * 3600 } };
assert(/on now/.test(ctx.loggedInStatusHtml({ Player: 'Alice', Officer: '' }, pres, 90)) && !/timed out|ended/.test(ctx.loggedInStatusHtml({ Player: 'Alice', Officer: '' }, pres, 90)));
assert(/last seen 10m ago/.test(ctx.loggedInStatusHtml({ Player: 'Bob', Officer: '' }, pres, 90)));
assert(/session probably ended/.test(ctx.loggedInStatusHtml({ Player: 'Cy', Officer: '' }, pres, 200)), 'a player idle for hours');
assert(!/ended/.test(ctx.loggedInStatusHtml({ Player: 'Dee', Officer: 'Admin' }, pres, 200)), 'admins do not time out');
assert(/logged in 45m ago/.test(ctx.loggedInStatusHtml({ Player: 'Nobody', Officer: 'Admin' }, pres, 45)) && !/timed out/.test(ctx.loggedInStatusHtml({ Player: 'Nobody', Officer: '' }, null, 45)));
// wiring
assert(/\.map\(r => String\(r\.D\)\)\);/.test(src.slice(src.indexOf('Check which dates have scores (played)'), src.indexOf('Check which dates have scores (played)') + 400)), 'builder played dates are strings');
assert(/playedDates\.has\(String\(d\)\)/.test(src));
assert(/Date\.now\(\) - \(window\._lastActivityAt \|\| Date\.now\(\)\) > SESSION_TIMEOUT/.test(src) && /window\._lastActivityAt = Date\.now\(\)/.test(src));
assert(/waiting on \$\{waiting\.map/.test(src));
console.log('ok');
