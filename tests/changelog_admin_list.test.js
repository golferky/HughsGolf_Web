// Admin > Changelog list: newest added first, searchable, marks who added an entry (an entry typed in with a short version used to sort
// below every 20261011.x / 20261012.x release note and fall off a 30-row list).
const fs = require('fs'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
const fn = src.slice(src.indexOf('function loadAdminChangelog()'), src.indexOf('function adminSaveChangelog()'));
assert(/ORDER BY ID DESC/.test(fn) && !/ORDER BY Version DESC/.test(fn), 'newest added first, not by version text');
assert(/AddedBy, AddedAt\) VALUES \(\?,\?,\?,\?,\?,\?,\?,\?\)/.test(src.slice(src.indexOf('function adminSaveChangelog()'), src.indexOf('function adminSaveChangelog()') + 1400)), 'save records who added it');
assert(/id="clSearch"/.test(src) && /id="clCount"/.test(src));
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
(async () => {
  if (!chromium || !fs.existsSync('/opt/pw-browsers/chromium')) { console.log('ok (browser part skipped)'); return; }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  await p.route('**/*', async r => { const u = r.request().url(); if (u === 'http://t/HughsGolf.html') return r.fulfill({ body: src, contentType: 'text/html' });
    if (u.startsWith('http://t/vendor/sqljs/')) return r.fulfill({ body: fs.readFileSync(path.join(__dirname, '..', u.replace('http://t/', ''))), contentType: u.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    return r.abort(); });
  await p.goto('http://t/HughsGolf.html'); await p.waitForFunction(() => typeof SQL !== 'undefined' && SQL);
  const out = await p.evaluate(() => {
    db = new SQL.Database(); ensureAppChangelogTable = () => {};
    db.run(`CREATE TABLE AppChangelog (ID INTEGER PRIMARY KEY AUTOINCREMENT, Version TEXT, ReleaseDate TEXT, Category TEXT, Item TEXT, SortOrder INTEGER DEFAULT 0, Notes TEXT, AddedBy TEXT, AddedAt TEXT)`);
    db.run(`INSERT INTO AppChangelog (Version, ReleaseDate, Category, Item, AddedBy, AddedAt) VALUES ('20261011','October 11, 2026','bugfix','Greg fixed the thing','Greg Lemker','2026-10-11 20:15')`);
    for (let i = 1; i <= 40; i++) db.run(`INSERT INTO AppChangelog (Version, ReleaseDate, Category, Item) VALUES ('20261012.${i}','October 12, 2026','enhancement','Release note ${i}')`);
    const r = [];
    loadAdminChangelog(); r.push(document.getElementById('clRecentList').textContent.includes('Greg fixed the thing'), document.getElementById('clCount').textContent, /added by Greg Lemker/.test(document.getElementById('clRecentList').textContent));
    for (let i = 41; i <= 130; i++) db.run(`INSERT INTO AppChangelog (Version, ReleaseDate, Category, Item) VALUES ('20261012.${i}','October 12, 2026','enhancement','Release note ${i}')`);
    loadAdminChangelog(); r.push(document.getElementById('clRecentList').textContent.includes('Greg fixed the thing'));            // beyond the newest 100
    document.getElementById('clSearch').value = 'greg'; loadAdminChangelog(); r.push(document.getElementById('clRecentList').textContent.includes('Greg fixed the thing'), document.getElementById('clCount').textContent);
    document.getElementById('clSearch').value = 'zzz'; loadAdminChangelog(); r.push(/Nothing matches/.test(document.getElementById('clRecentList').textContent));
    return r;
  });
  assert.deepStrictEqual(out, [true, '41 of 41 entries (newest added first)', true, false, true, '1 of 131 entries match', true], JSON.stringify(out));
  assert.deepStrictEqual(errs, [], errs.join('; '));
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
