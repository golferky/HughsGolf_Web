// The Carriers screen and test popup render in a real browser without errors (skipped without the browser).
const fs = require('fs'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
(async () => {
  if (!chromium || !fs.existsSync('/opt/pw-browsers/chromium')) { console.log('ok (browser part skipped)'); return; }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  const calls = [];
  await p.route('**/*', async r => { const u = r.request().url(); if (u === 'http://t/HughsGolf.html') return r.fulfill({ body: src, contentType: 'text/html' });
    if (u.startsWith('http://t/vendor/sqljs/')) return r.fulfill({ body: fs.readFileSync(path.join(__dirname, '..', u.replace('http://t/', ''))), contentType: u.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    if (u === 'http://t/carrier-test') { calls.push('test:' + r.request().postData()); return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, to: '***-***-0111' }) }); }
    if (u === 'http://t/carrier-admin') { const body = JSON.parse(r.request().postData()); calls.push('admin:' + body.action); return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, row: { Carrier: body.carrier, Gateway: 'vtext.com', Status: 'validated', ValidatedAt: '2026-10-18', ValidatedBy: 'Boss Admin', Note: body.note || '', Active: 'Y' }, modifiedMs: 1, player: body.player, confirmed: body.action === 'confirm_player' ? '2026-10-18|5025550111|verizon' : '' }) }); }
    return r.abort(); });
  await p.goto('http://t/HughsGolf.html'); await p.waitForFunction(() => typeof loadCarriersAdmin === 'function');
  await p.evaluate(() => {
    const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none';
    db = new SQL.Database();
    db.run(`CREATE TABLE CarrierGateways (Carrier TEXT PRIMARY KEY, Gateway TEXT, Status TEXT, ValidatedAt TEXT, ValidatedBy TEXT, Note TEXT, Active TEXT);
      INSERT INTO CarrierGateways VALUES ('T-Mobile','tmomail.net','validated','2026-10-01','Boss','', 'Y'), ('Verizon','vtext.com','unvalidated',NULL,NULL,'','Y'), ('AT&T','txt.att.net','unavailable',NULL,'Boss','ended','Y');
      CREATE TABLE Players (Player TEXT, Phone, CellCarrier TEXT, IsTest TEXT, CellConfirmed TEXT); INSERT INTO Players (Player, Phone, CellCarrier, IsTest) VALUES ('Pat Example','502-555-0111','Verizon','N'), ('Boss Admin','502-555-0199','T-Mobile','N'), ('Num Ber',5025550123,'T-Mobile','N');`);
    currentUser = { name: 'Boss Admin', role: 'admin' }; localStorage.setItem('hg_session_Boss Admin', 'sess');
    const ta = document.getElementById('tab-admin'); ta.style.display = 'block'; ta.classList.add('active'); document.getElementById('adminCarriers').style.display = 'block'; loadCarriersAdmin();
  });
  const rows = await p.$$eval('#carriersBody tbody tr', trs => trs.map(t => t.innerText.replace(/\s+/g, ' ').trim()));
  assert.strictEqual(rows.length, 3); assert(/AT&T.*Unavailable.*ended/.test(rows[0]) && /T-Mobile.*Validated/.test(rows[1]) && /Verizon.*Unvalidated/.test(rows[2]), rows.join(' | '));
  // Send test on Verizon: the popup lists Pat, asks to confirm, and offers to mark validated afterwards
  await p.evaluate(() => { window.confirm = () => true; window.prompt = (m, d) => 'got it'; });
  await p.click('button[data-c="Verizon"][onclick*="test"]');
  assert(/Pat Example \(502-555-0111\)/.test(await p.innerText('#carrierTestWho')));
  await p.click('#carrierTestSend'); await p.waitForSelector('#carrierTestOk', { state: 'visible' });
  assert(/Sent to \*\*\*-\*\*\*-0111/.test(await p.innerText('#carrierTestMsg')) && calls[0].startsWith('test:') && /"carrier":"Verizon"/.test(calls[0]) && /"player":"Pat Example"/.test(calls[0]), calls[0]);
  await p.click('#carrierTestOk'); await p.waitForFunction(() => !document.getElementById('carrierTestOk'));
  assert.strictEqual(calls[1], 'admin:validate'); assert.strictEqual(calls[2], 'admin:confirm_player', 'a test that arrived also confirms the player');
  assert(/1 of 3 players confirmed/.test(await p.innerText('#carrierPlayersBody')) && !/Pat Example/.test(await p.innerText('#carrierPlayersBody')), 'Pat is confirmed, so the default list leaves him out');
  await p.selectOption('#carrierPlayerFilter', 'all');
  const pr = await p.$$eval('#carrierPlayersBody tbody tr', trs => trs.map(t => t.innerText.replace(/\s+/g, ' ').trim()));
  assert(pr.length === 3 && /Pat Example.*2026-10-18/.test(pr.join('|')) && /Boss Admin.*Not confirmed/.test(pr.join('|')), pr.join(' | '));
  await p.click('#carrierPlayersBody button[data-p="Boss Admin"][onclick*="test"]'); // opens the popup on this player
  assert.strictEqual(await p.inputValue('#carrierTestWho'), 'Boss Admin'); await p.click('#carrierTestClose');
  assert(/Verizon.*Validated/.test(await p.$eval('#carriersBody', e => e.innerText.replace(/\s+/g, ' '))), 'the table shows the new status');
  // a phone stored as a number (not text) still opens the popup
  await p.click('button[data-c="T-Mobile"][onclick*="test"]');
  assert(/Num Ber \(5025550123\)/.test(await p.innerText('#carrierTestWho')));
  await p.click('#carrierTestClose');
  // Mark unavailable asks for a reason
  await p.click('button[data-c="T-Mobile"][onclick*="unavailable"]'); await p.waitForTimeout(100); assert.strictEqual(calls[3], 'admin:unavailable');
  assert.deepStrictEqual(errs, [], errs.join('; '));
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
