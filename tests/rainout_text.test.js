// Rainout text: who is playing, even batches of <=20, sms link.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
const plain = x => JSON.parse(JSON.stringify(x));
let teams, sched, subs;
const ctx = vm.createContext({ String, parseInt, Set, JSON, encodeURIComponent,
  query: (sql) => /FROM Teams/.test(sql) ? teams : /FROM Schedule/.test(sql) ? (sched ? [sched] : []) : /FROM Subs/.test(sql) ? subs : [] });
['rainoutRoster', 'rainoutBatches', 'rainoutSmsHref', 'rainoutFoursomes'].forEach(f => vm.runInContext(extract(f), ctx));
// batches: even, never more than 20
assert.deepStrictEqual(plain(ctx.rainoutBatches([...Array(24).keys()]).map(b => b.length)), [12, 12]);
assert.deepStrictEqual(plain(ctx.rainoutBatches([...Array(20).keys()]).map(b => b.length)), [20]);
assert.deepStrictEqual(plain(ctx.rainoutBatches([...Array(21).keys()]).map(b => b.length)), [11, 10]);
assert.deepStrictEqual(plain(ctx.rainoutBatches([...Array(41).keys()]).map(b => b.length)), [14, 14, 13]);
assert.deepStrictEqual(plain(ctx.rainoutBatches([])), []);
// roster: teams on the night's schedule, minus subbed-out slots, plus subs
teams = [{ Player: 'A1', Team: 1, Grade: 'A' }, { Player: 'B1', Team: 1, Grade: 'B' }, { Player: 'A2', Team: 2, Grade: 'A' }, { Player: 'B2', Team: 2, Grade: 'B' }, { Player: 'A3', Team: 3, Grade: 'A' }, { Player: 'B3', Team: 3, Grade: 'B' }];
sched = { 1: 1, 2: 2, 3: 0, 4: null }; subs = [{ Player: 'Sub X', Team: 2, Grade: 'B' }];
assert.deepStrictEqual(plain(ctx.rainoutRoster('20261006')), ['A1', 'B1', 'A2', 'Sub X']);
sched = null; subs = []; // no schedule row -> everyone on the roster
assert.deepStrictEqual(plain(ctx.rainoutRoster('20261006')), ['A1', 'B1', 'A2', 'B2', 'A3', 'B3']);
// foursomes: slots pair up (1+2, 3+4); point = flagged regular, else first regular (never a sub if a regular is there)
teams = [{ Player: 'A1', Team: 1, Grade: 'A' }, { Player: 'B1', Team: 1, Grade: 'B' }, { Player: 'A2', Team: 2, Grade: 'A' }, { Player: 'B2', Team: 2, Grade: 'B' }, { Player: 'A3', Team: 3, Grade: 'A' }, { Player: 'B3', Team: 3, Grade: 'B' }, { Player: 'A4', Team: 4, Grade: 'A' }, { Player: 'B4', Team: 4, Grade: 'B' }];
sched = { 1: 1, 2: 2, 3: 3, 4: 4 }; subs = [{ Player: 'Sub X', Team: 2, Grade: 'A' }];
let f = plain(ctx.rainoutFoursomes('20261013', new Set(['B2', 'Sub X'])));
assert.deepStrictEqual(f, [{ point: 'B2', members: ['A1', 'B1', 'Sub X'], fallback: false }, { point: 'A3', members: ['B3', 'A4', 'B4'], fallback: true }]);
f = plain(ctx.rainoutFoursomes('20261013', new Set(['Sub X']))); assert.strictEqual(f[0].point, 'Sub X', 'a flagged sub can be the point person');
sched = null; assert.strictEqual(ctx.rainoutFoursomes('20261013', new Set()), null);
// links
assert.strictEqual(ctx.rainoutSmsHref(['5025550101', '5025550102'], 'Hi there', true), 'sms:/open?addresses=+15025550101,+15025550102&body=Hi%20there');
assert.strictEqual(ctx.rainoutSmsHref(['5025550101'], 'Hi', false), 'sms:+15025550101?body=Hi');
// wiring
assert(/section==='rainout'\) \{ loadScheduleBuilder\(\); loadRainoutText\(\);/.test(src));
assert(/fetch\('\/send-rainout-text'/.test(src));
assert(/name="rainoutMode2" value="point"/.test(src) && /\/rainout-point-people/.test(src), 'point-person option');
assert(/sendRainoutText\(true\)/.test(src) && /rainout-status\?date=/.test(src) && /Text again to the/.test(src), 'test-to-me, confirmation tracker, text-again');
console.log('ok');
