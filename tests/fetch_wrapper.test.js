// A failed call names the request, a failed GET is retried once, a write is never retried, aborts/server errors are untouched.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
const code = src.slice(src.indexOf('/* fetch-wrapper:start */'), src.indexOf('/* fetch-wrapper:end */'));
assert(code.length > 200 && src.indexOf('/* fetch-wrapper:start */') < src.indexOf("let SAVE_TOKEN = '';"), 'installed before the first fetch');
function make(impl) { const calls = []; const win = { fetch: (u, i) => { calls.push([u, (i && i.method) || 'GET']); return impl(calls.length); } }; vm.runInNewContext(code, { window: win, Promise, setTimeout: (f) => setTimeout(f, 1), Date, String, Object, Error, TypeError }); return { win, calls }; }
const netErr = () => Promise.reject(new TypeError('Failed to fetch'));
(async () => {
  // a GET that fails once then works: retried, caller never sees the blip
  let t = make(n => n === 1 ? netErr() : Promise.resolve({ ok: true, status: 200 }));
  assert.strictEqual((await t.win.fetch('/whos-on?x=1')).status, 200); assert.strictEqual(t.calls.length, 2); assert.strictEqual(t.win.__fetchFailures.length, 0);
  // a GET that keeps failing: one retry, then the error names the request
  t = make(() => netErr());
  await assert.rejects(() => t.win.fetch('http://192.168.1.176:8446/HughsGolf.db?v=1'), e => /Failed to fetch \(GET \/HughsGolf\.db\)/.test(e.message));
  assert.strictEqual(t.calls.length, 2); assert.deepStrictEqual(JSON.parse(JSON.stringify(t.win.__fetchFailures.map(f => [f.method, f.url, f.tries]))), [['GET', '/HughsGolf.db', 2]]);
  // a write is never retried (it could be saved twice)
  t = make(() => netErr());
  await assert.rejects(() => t.win.fetch('/run-sql', { method: 'POST', body: '{}' }), e => /Failed to fetch \(POST \/run-sql\)/.test(e.message));
  assert.strictEqual(t.calls.length, 1);
  // server error codes are responses, not failures: passed through untouched, no retry
  t = make(() => Promise.resolve({ ok: false, status: 500 })); assert.strictEqual((await t.win.fetch('/run-sql')).status, 500); assert.strictEqual(t.calls.length, 1);
  // an abort is not a network failure
  t = make(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  await assert.rejects(() => t.win.fetch('/version'), e => e.name === 'AbortError' && !/\(GET/.test(e.message)); assert.strictEqual(t.calls.length, 1);
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
