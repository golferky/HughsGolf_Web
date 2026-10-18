// The ↻ button next to the database time: refreshes the data and redraws the current screen; refuses while score entry is unsaved (skipped without the browser).
const fs = require('fs'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
assert(/id="dbRefreshBtn"[^>]*onclick="refreshDataNow\(this\)"/.test(src), 'the header has the refresh button');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
(async () => {
  if (!chromium || !fs.existsSync('/opt/pw-browsers/chromium')) { console.log('ok (browser part skipped)'); return; }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  let dbBytes = null;
  await p.route('**/*', async r => { const u = r.request().url();
    if (u === 'http://t/HughsGolf.html') return r.fulfill({ body: src, contentType: 'text/html' });
    if (u.startsWith('http://t/vendor/sqljs/')) return r.fulfill({ body: fs.readFileSync(path.join(__dirname, '..', u.replace('http://t/', ''))), contentType: u.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    if (u.startsWith('http://t/HughsGolf.db')) return r.fulfill({ body: Buffer.from(dbBytes), contentType: 'application/octet-stream' });
    if (u.startsWith('http://t/db-info')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, modifiedMs: Date.now(), filename: 'HughsGolf.db', modified: 'now', size: 1 }) });
    return r.abort(); });
  await p.goto('http://t/HughsGolf.html'); await p.waitForFunction(() => typeof refreshDataNow === 'function' && typeof SQL !== 'undefined' && SQL);
  // the "server" copy has one more board post than the page's copy
  dbBytes = await p.evaluate(() => { const d = new SQL.Database(); d.run(`CREATE TABLE Marker (n INTEGER); INSERT INTO Marker VALUES (2);`); return Array.from(d.export()); });
  await p.evaluate(() => {
    const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none';
    db = new SQL.Database(); db.run(`CREATE TABLE Marker (n INTEGER); INSERT INTO Marker VALUES (1);`);
    window.__redrawn = []; window.refreshTab = t => window.__redrawn.push(t);
    window.alert = m => (window.__alerts = window.__alerts || []).push(m);
    document.querySelector('.tab[data-tab="home"]')?.classList.add('active');
  });
  await p.click('#dbRefreshBtn');
  await p.waitForFunction(() => window.__redrawn.length === 1);
  assert.strictEqual(await p.evaluate(() => db.exec('SELECT n FROM Marker')[0].values[0][0]), 2, 'the page now has the server copy');
  assert.deepStrictEqual(await p.evaluate(() => window.__redrawn), ['home'], 'and redraws the screen it is on');
  assert.strictEqual(await p.innerText('#dbRefreshBtn'), '↻'); assert.strictEqual(await p.evaluate(() => document.getElementById('dbRefreshBtn').disabled), false);
  // unsaved score entry: nothing is replaced
  await p.evaluate(() => { entryDirty = true; db.run('UPDATE Marker SET n=1'); });
  await p.click('#dbRefreshBtn'); await p.waitForTimeout(150);
  assert.strictEqual(await p.evaluate(() => db.exec('SELECT n FROM Marker')[0].values[0][0]), 1, 'unsaved work is never replaced');
  assert(/not saved yet/.test(await p.evaluate(() => window.__alerts.join('|'))));
  assert.deepStrictEqual(errs, [], errs.join('; '));
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
