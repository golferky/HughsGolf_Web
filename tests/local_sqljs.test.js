// The page must not depend on an outside CDN to start: sql.js is served by the app (/vendor/sqljs/), the CDN is only a backup,
// and a total failure is shown on the login screen instead of leaving it blank.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
assert(/<script src="\/vendor\/sqljs\/sql-wasm\.js"><\/script>/.test(src), 'engine script comes from the app');
assert(!/<script src="https:\/\/cdnjs[^"]*sql-wasm/.test(src), 'no blocking CDN script tag for sql.js');
assert(!/^\s*initSqlJs\(\{ locateFile/m.test(src), 'no direct top-level initSqlJs call that can throw before the page is set up');
function extract(name, pre = '') { const i = src.indexOf(pre + 'function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
const calls = []; let cdnLoads = 0, failLocal = false, defined = true;
const ctx = vm.createContext({ Promise, Error, console, document: { createElement: () => ({}), head: { appendChild: s => { cdnLoads++; ctx.initSqlJs = async o => { calls.push('cdn-script:' + o.locateFile('x.wasm')); return 'SQL'; }; setTimeout(() => s.onload(), 0); } } } });
vm.runInContext("const SQLJS_LOCAL = '/vendor/sqljs/', SQLJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/';", ctx);
vm.runInContext(extract('loadScriptOnce'), ctx); vm.runInContext(extract('startSqlJs', 'async '), ctx);
(async () => {
  // local engine present and its wasm loads: used as is
  ctx.initSqlJs = async o => { calls.push(o.locateFile('x.wasm')); return 'SQL'; };
  assert.strictEqual(await ctx.startSqlJs(), 'SQL'); assert.deepStrictEqual(calls, ['/vendor/sqljs/x.wasm']); assert.strictEqual(cdnLoads, 0);
  // local wasm not found: same engine, wasm from the CDN
  calls.length = 0; let n = 0; ctx.initSqlJs = async o => { calls.push(o.locateFile('x.wasm')); if (++n === 1) throw new Error('404'); return 'SQL'; };
  assert.strictEqual(await ctx.startSqlJs(), 'SQL'); assert.deepStrictEqual(calls, ['/vendor/sqljs/x.wasm', 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/x.wasm']);
  // no local script at all: the CDN script is added and used
  calls.length = 0; ctx.initSqlJs = undefined;
  assert.strictEqual(await ctx.startSqlJs(), 'SQL'); assert.strictEqual(cdnLoads, 1);
  // the failure path tells the person on the login screen
  assert(/loginVersionDisplay[\s\S]{0,300}could not load its database engine/.test(src));
  const deploy = fs.readFileSync(__dirname + '/../deploy_qnap.sh', 'utf8');
  assert(/scp -q -r [^\n]*vendor "\$QNAP:\$DIR\/"/.test(deploy), 'deploy uploads vendor/');
  ['sql-wasm.js', 'sql-wasm.wasm'].forEach(f => assert(fs.statSync(__dirname + '/../vendor/sqljs/' + f).size > 10000, f));
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
