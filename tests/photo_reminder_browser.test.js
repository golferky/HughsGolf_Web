// The photo reminder popup in a real browser (skipped without the browser).
const fs = require('fs'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
(async () => {
  if (!chromium || !fs.existsSync('/opt/pw-browsers/chromium')) { console.log('ok (browser part skipped)'); return; }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  const asked = []; let reply = { ok: true, show: true, count: 2, max: 3 };
  await p.route('**/*', async r => { const u = r.request().url();
    if (u === 'http://t/HughsGolf.html') return r.fulfill({ body: src, contentType: 'text/html' });
    if (u.startsWith('http://t/vendor/sqljs/')) return r.fulfill({ body: fs.readFileSync(path.join(__dirname, '..', u.replace('http://t/', ''))), contentType: u.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    if (u === 'http://t/photo-reminder') { asked.push(JSON.parse(r.request().postData())); return r.fulfill({ contentType: 'application/json', body: JSON.stringify(reply) }); }
    return r.abort(); });
  await p.goto('http://t/HughsGolf.html'); await p.waitForFunction(() => typeof maybeShowPhotoReminder === 'function');
  await p.evaluate(() => {
    const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none';
    db = new SQL.Database();
    db.run(`CREATE TABLE Players (Player TEXT, PhotoKey TEXT, PhotoReminders INTEGER, IsTest TEXT);
      INSERT INTO Players VALUES ('Pat Example',NULL,1,'N'),('Pic Ture','pic_abcdef123456',0,'N'),('Test Account',NULL,0,'Y');`);
    currentUser = { name: 'Pat Example', role: 'player' }; localStorage.setItem('hg_session_Pat Example', 'sess');
    window.showPlayerSelfEditModal = n => { window.__opened = n; };
  });
  await p.evaluate(() => maybeShowPhotoReminder('Pat Example')); await p.waitForSelector('#photoReminderOverlay');
  const txt = await p.innerText('#photoReminderOverlay'); assert(/Add your photo/.test(txt) && /Reminder 2 of 3\./.test(txt), txt);
  assert.deepStrictEqual(asked.map(a => [a.player, a.sessionToken]), [['Pat Example', 'sess']]);
  // once per browser session: a second call (a page reload) does not ask the server again
  await p.click('#photoReminderLater'); assert.strictEqual(await p.$('#photoReminderOverlay'), null);
  await p.evaluate(() => maybeShowPhotoReminder('Pat Example')); await p.waitForTimeout(100); assert.strictEqual(asked.length, 1); assert.strictEqual(await p.$('#photoReminderOverlay'), null);
  // Add photo opens My Profile; the last reminder says so
  await p.evaluate(() => { sessionStorage.clear(); }); reply = { ok: true, show: true, count: 3, max: 3 };
  await p.evaluate(() => maybeShowPhotoReminder('Pat Example')); await p.waitForSelector('#photoReminderOverlay');
  assert(/last time we will ask/.test(await p.innerText('#photoReminderOverlay')));
  await p.click('#photoReminderAdd'); assert.strictEqual(await p.evaluate(() => window.__opened), 'Pat Example'); assert.strictEqual(await p.$('#photoReminderOverlay'), null);
  // nothing shows when the server says no, or the player has a photo, or is a test account (and the server is not even asked)
  await p.evaluate(() => sessionStorage.clear()); reply = { ok: true, show: false }; const n0 = asked.length;
  await p.evaluate(() => maybeShowPhotoReminder('Pat Example')); await p.waitForTimeout(150); assert.strictEqual(await p.$('#photoReminderOverlay'), null); assert.strictEqual(asked.length, n0 + 1);
  await p.evaluate(() => { sessionStorage.clear(); return Promise.all([maybeShowPhotoReminder('Pic Ture'), maybeShowPhotoReminder('Test Account')]); });
  assert.strictEqual(asked.length, n0 + 1, 'a player with a photo and a test account are not even counted');
  assert.deepStrictEqual(errs, [], errs.join('; '));
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
