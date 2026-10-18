// Post Season > Scores holds the post-season score grid (one entry per season); Play > Scores has regular season nights only.
const fs = require('fs'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
assert(/data-tab="ps_entry">✏️ Scores<\/div>\s*<div class="tab" data-tab="ps_scores">/.test(src) && /id="tab-ps_entry"/.test(src), 'a Scores tab leads the Post Season group');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
(async () => {
  if (!chromium || !fs.existsSync('/opt/pw-browsers/chromium')) { console.log('ok (browser part skipped)'); return; }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  await p.route('**/*', async r => { const u = r.request().url();
    if (u === 'http://t/HughsGolf.html') return r.fulfill({ body: src, contentType: 'text/html' });
    if (u.startsWith('http://t/vendor/sqljs/')) return r.fulfill({ body: fs.readFileSync(path.join(__dirname, '..', u.replace('http://t/', ''))), contentType: u.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    return r.abort(); });
  await p.goto('http://t/HughsGolf.html'); await p.waitForFunction(() => typeof placeEntryFor === 'function' && typeof SQL !== 'undefined' && SQL);
  await p.evaluate(() => {
    const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none';
    db = new SQL.Database();
    db.run(`CREATE TABLE Schedule (League TEXT, Date TEXT); INSERT INTO Schedule VALUES ('Hugh''s','20260915'),('Hugh''s','20260922'),('Hugh''s','20250916'),('Hugh''s','20260929');
            CREATE TABLE SeasonSettings (League TEXT, Season INTEGER, PostSeasonDt TEXT, PSWeek2Dt TEXT);
            INSERT INTO SeasonSettings VALUES ('Hugh''s',2026,'9/29/2026',NULL),('Hugh''s',2025,'9/30/2025',NULL);`);
    document.getElementById('adminScores').style.display = 'block';
  });
  const opts = () => p.evaluate(() => [...document.getElementById('entryDate').options].map(o => o.textContent));
  const where = () => p.evaluate(() => document.getElementById('adminScores').parentNode.id);
  // Play > Scores: regular nights only (the post-season night is left out even though the schedule lists it)
  await p.evaluate(() => placeEntryFor('scorecard')); await p.evaluate(() => populateEntryDates());
  assert.strictEqual(await where(), 'tab-scorecard');
  assert.deepStrictEqual(await opts(), ['09/22/2026', '09/15/2026', '09/16/2025'], 'regular nights only');
  // Post Season > Scores: one entry per season, newest first, and the grid moves there
  const changed = await p.evaluate(() => placeEntryFor('ps_entry')); assert.strictEqual(changed, true);
  assert.strictEqual(await where(), 'tab-ps_entry'); assert.deepStrictEqual(await opts(), ['2026 Post Season', '2025 Post Season']);
  assert.strictEqual(await p.evaluate(() => document.getElementById('entryDate').value), '20260929', 'the latest season is selected');
  assert.strictEqual(await p.evaluate(() => document.getElementById('entryPostSeason').checked), true);
  // and back: starts afresh on a regular night; a state left by the other tab is cleared
  await p.evaluate(() => { entryState = { x: 1 }; entryDirty = true; });
  await p.evaluate(() => placeEntryFor('scorecard'));
  assert.strictEqual(await where(), 'tab-scorecard'); assert.deepStrictEqual(await opts(), ['09/22/2026', '09/15/2026', '09/16/2025']);
  assert.deepStrictEqual(await p.evaluate(() => [Object.keys(entryState).length, entryDirty, activeEntryPostSeasonContext, document.getElementById('entryPostSeason').checked]), [0, false, null, false]);
  assert.strictEqual(await p.evaluate(() => placeEntryFor('scorecard')), false, 'opening the same tab again changes nothing');
  // the right tab for a night
  assert.deepStrictEqual(await p.evaluate(() => ['20260929', '20260922'].map(entryTabFor)), ['ps_entry', 'scorecard']);
  // switching between the two Scores tabs with an unsaved scorecard asks first (declining stays put)
  await p.evaluate(() => { document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === 'scorecard')); entryDirty = true; window.confirm = () => false; refreshTab = () => {}; switchTab('ps_entry'); });
  assert.strictEqual(await p.evaluate(() => document.querySelector('.tab.active').dataset.tab), 'scorecard', 'declined: still on Play > Scores');
  await p.evaluate(() => { window.confirm = () => true; switchTab('ps_entry'); });
  assert.strictEqual(await p.evaluate(() => document.querySelector('.tab.active').dataset.tab), 'ps_entry');
  // the Play round-date bar has no post-season nights, and no bar at all on the post-season Scores tab
  await p.evaluate(() => { document.querySelector('.tab[data-tab="scorecard"]').classList.add('active'); document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'matches')); document.getElementById('matchesDate').innerHTML = '<option value="20260922">x</option>'; syncPlayDateBar(); });
  assert.deepStrictEqual(await p.evaluate(() => [...document.getElementById('playDateSel').options].map(o => o.textContent)), ['09/22/2026', '09/15/2026', '09/16/2025'], 'Play dates: no post season');
  await p.evaluate(() => { document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'ps_entry')); syncPlayDateBar(); });
  assert.strictEqual(await p.evaluate(() => getComputedStyle(document.getElementById('playDateBar')).display), 'none');
  assert.deepStrictEqual(errs, [], errs.join('; '));
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
