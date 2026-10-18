// Skins/CTPs and Stableford exist under Play (regular nights) and under Post Season (post-season nights); one piece of page, moved between the two tabs.
const fs = require('fs'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
assert(/data-tab="ps_skinsview">📍 Skins\/CTPs<\/div>\s*<div class="tab" data-tab="ps_stableford">🏌️ Stableford<\/div>/.test(src), 'both tabs are in the Post Season group');
assert(/id="tab-ps_skinsview"/.test(src) && /id="tab-ps_stableford"/.test(src) && /id="skinsScreen"/.test(src) && /id="stablefordScreen"/.test(src) && /id="sfStandingsBlock"/.test(src));
assert(/switchTab\('ps_skinsview'\)[^>]*>🎯 Post-season Skins: Calculate/.test(src), 'the Award Prizes shortcut opens the post-season Skins/CTPs');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
(async () => {
  if (!chromium || !fs.existsSync('/opt/pw-browsers/chromium')) { console.log('ok (browser part skipped)'); return; }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  await p.route('**/*', async r => { const u = r.request().url();
    if (u === 'http://t/HughsGolf.html') return r.fulfill({ body: src, contentType: 'text/html' });
    if (u.startsWith('http://t/vendor/sqljs/')) return r.fulfill({ body: fs.readFileSync(path.join(__dirname, '..', u.replace('http://t/', ''))), contentType: u.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    return r.abort(); });
  await p.goto('http://t/HughsGolf.html'); await p.waitForFunction(() => typeof placeDualScreen === 'function' && typeof SQL !== 'undefined' && SQL);
  await p.evaluate(() => {
    const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none';
    db = new SQL.Database();
    db.run(`CREATE TABLE SeasonSettings (League TEXT, Season INTEGER, PostSeasonDt TEXT, PSWeek2Dt TEXT);
      INSERT INTO SeasonSettings VALUES ('Hugh''s',2026,'9/29/2026',NULL),('Hugh''s',2025,'9/30/2025',NULL),('Hugh''s',2024,NULL,NULL);
      CREATE TABLE Schedule (League TEXT, Date TEXT); INSERT INTO Schedule VALUES ('Hugh''s','20260915'),('Hugh''s','20260922');
      CREATE TABLE Payments (League TEXT, Player TEXT, Date TEXT, "Desc" TEXT, Detail TEXT); INSERT INTO Payments VALUES ('Hugh''s','Pat','20260915','Skin','Payment'),('Hugh''s','Pat','20260922','Skin','Payment');
      CREATE TABLE Scores (League TEXT, Player TEXT, Date TEXT, Gross INTEGER); INSERT INTO Scores VALUES ('Hugh''s','Pat','20260915',40),('Hugh''s','Pat','20260922',41),('Hugh''s','Pat','20260929',42),('Hugh''s','Pat','20261006',43);`);
    window.loaded = []; loadSkins = () => loaded.push('skins'); loadStableford = () => loaded.push('sf'); loadCtpsTab = () => {}; loadSfStandings = () => loaded.push('sfstand');
    document.getElementById('adminScores'); window.opts = id => [...document.getElementById(id).options].map(o => o.textContent);
    window.where = id => document.getElementById(id).parentNode.id;
  });
  const opts = id => p.evaluate(id => opts(id), id), where = id => p.evaluate(id => where(id), id);
  // Skins/CTPs
  await p.evaluate(() => refreshTab('skins'));
  assert.strictEqual(await where('skinsScreen'), 'tab-skins'); assert.deepStrictEqual(await opts('skinsSeason'), ['2026', '2025', '2024']);
  assert.deepStrictEqual(await opts('skinsDate'), ['09/22/2026', '09/15/2026'], 'Play: regular nights only');
  await p.evaluate(() => refreshTab('ps_skinsview'));
  assert.strictEqual(await where('skinsScreen'), 'tab-ps_skinsview'); assert.deepStrictEqual(await opts('skinsSeason'), ['2026', '2025'], 'Post Season: seasons that have one');
  assert.deepStrictEqual(await opts('skinsDate'), ['10/06/2026 — Post Season Wk 2', '09/29/2026 — Post Season Wk 1']);
  await p.evaluate(() => { document.getElementById('skinsSeason').value = '2025'; populateSkinsDateDropdown(); });
  assert.deepStrictEqual(await opts('skinsDate'), ['10/07/2025 — Post Season Wk 2', '09/30/2025 — Post Season Wk 1'], 'each season has its own post-season nights');
  await p.evaluate(() => refreshTab('skins')); assert.strictEqual(await where('skinsScreen'), 'tab-skins'); assert.deepStrictEqual(await opts('skinsDate'), ['09/22/2026', '09/15/2026'], 'and back to Play');
  // Stableford: nights from the scores, and the team standings only for the regular season
  await p.evaluate(() => refreshTab('stableford'));
  assert.strictEqual(await where('stablefordScreen'), 'tab-stableford'); assert.deepStrictEqual(await opts('stablefordDate'), ['09/22/2026', '09/15/2026']);
  assert.strictEqual(await p.evaluate(() => document.getElementById('sfStandingsBlock').style.display), '');
  await p.evaluate(() => refreshTab('ps_stableford'));
  assert.strictEqual(await where('stablefordScreen'), 'tab-ps_stableford'); assert.deepStrictEqual(await opts('stablefordSeason'), ['2026', '2025']);
  assert.deepStrictEqual(await opts('stablefordDate'), ['10/06/2026 — Post Season Wk 2', '09/29/2026 — Post Season Wk 1']);
  assert.strictEqual(await p.evaluate(() => document.getElementById('sfStandingsBlock').style.display), 'none', 'no team standings for post season');
  assert.strictEqual(await p.evaluate(() => window.loaded.includes('sfstand') && window.loaded.lastIndexOf('sfstand') > window.loaded.lastIndexOf('sf')), false, 'the post-season tab does not load the team standings');
  await p.evaluate(() => jumpToStableford(2026, '20260915'));
  assert.strictEqual(await where('stablefordScreen'), 'tab-stableford', 'the team standings link goes to the regular Stableford');
  assert.deepStrictEqual(errs, [], errs.join('; '));
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
