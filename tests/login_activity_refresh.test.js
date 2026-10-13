// Refreshing Login Activity must not hang: the database download stops after a time limit with a reason, and the Who's On data never blocks the screen.
const fs = require('fs'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
const fnBody = src.slice(src.indexOf('async function loadLoginActivity('), src.indexOf('async function loadLoginActivity(') + 20000);
assert(!/await fetch\('\/whos-on'/.test(fnBody) && /fetchPresenceMap\(\)\.then\(/.test(fnBody) && /renderCurrentlyLoggedIn\(\);\s*\n\s*fetchPresenceMap/.test(fnBody), 'presence loads in the background');
assert(/Refresh failed\$\{window\._dbRefreshWhy/.test(src), 'status says why');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
(async () => {
  if (!chromium || !fs.existsSync('/opt/pw-browsers/chromium')) { console.log('ok (browser part skipped)'); return; }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  await p.route('**/*', async r => { const u = r.request().url(); if (u === 'http://t/HughsGolf.html') return r.fulfill({ body: src, contentType: 'text/html' });
    if (u.startsWith('http://t/vendor/sqljs/')) return r.fulfill({ body: fs.readFileSync(path.join(__dirname, '..', u.replace('http://t/', ''))), contentType: u.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    return r.abort(); });
  await p.goto('http://t/HughsGolf.html'); await p.waitForFunction(() => typeof SQL !== 'undefined' && SQL);
  const out = await p.evaluate(async () => {
    // a connection that never answers
    window.fetch = (u, i) => new Promise((_, rej) => { if (i && i.signal) i.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
    DB_REFRESH_TIMEOUT_MS = 250; PRESENCE_TIMEOUT_MS = 250; ensureSaveToken = async () => 't';
    const t0 = Date.now(); const refreshed = await refreshLiveDbSnapshotForReadOnlyView(); const dbMs = Date.now() - t0;
    const t1 = Date.now(); const presence = await fetchPresenceMap(); const pMs = Date.now() - t1;
    return { refreshed, dbMs, why: window._dbRefreshWhy, presence, pMs };
  });
  assert.strictEqual(out.refreshed, false); assert(out.dbMs < 1500, 'gave up quickly: ' + out.dbMs); assert(/no answer after \d+ s/.test(out.why) && /slow or broken connection/.test(out.why), out.why);
  assert.strictEqual(out.presence, null); assert(out.pMs < 1500, 'presence gave up quickly: ' + out.pMs);
  assert.deepStrictEqual(errs, [], errs.join('; '));
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
