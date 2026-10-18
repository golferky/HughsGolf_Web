// The Broadcast screen in a real browser: compose, preview, send, see answers, remind, record an answer (skipped without the browser).
const fs = require('fs'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
(async () => {
  if (!chromium || !fs.existsSync('/opt/pw-browsers/chromium')) { console.log('ok (browser part skipped)'); return; }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  const calls = []; let answered = false;
  const json = (r, o) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
  await p.route('**/*', async r => { const u = r.request().url();
    if (u === 'http://t/HughsGolf.html') return r.fulfill({ body: src, contentType: 'text/html' });
    if (u.startsWith('http://t/vendor/sqljs/')) return r.fulfill({ body: fs.readFileSync(path.join(__dirname, '..', u.replace('http://t/', ''))), contentType: u.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    if (u === 'http://t/broadcast') {
      const body = JSON.parse(r.request().postData()); calls.push(body);
      if (body.action === 'preview') return json(r, { ok: true, recipients: [{ player: 'Pat Example', mode: 'both' }, { player: 'Lee Sample', mode: 'text-first' }, { player: 'Mo Mail', mode: 'email' }, { player: 'Tex Only', mode: 'text', linkInText: true }], skipped: [{ player: 'Opt Out', reason: 'asked not to be contacted' }] });
      if (body.action === 'send') return json(r, { ok: true, id: 7, simulated: false, test: !!body.test, sent: ['Pat Example', 'Lee Sample', 'Mo Mail'], failed: [], skipped: [], via: {} });
      if (body.action === 'list') return json(r, { ok: true, broadcasts: [{ id: 7, title: 'Are you in for 2027?', ask: 'season', year: 2026, createdAt: '2026-10-18 09:00', createdBy: 'Boss Admin', closedAt: '', recipients: 3, answered: answered ? 2 : 1 }] });
      if (body.action === 'status') return json(r, { ok: true, broadcast: { id: 7, title: 'Are you in for 2027?', message: "Hugh's Golf League: are you in for the 2027 season?", ask: 'season', year: 2026, createdAt: '2026-10-18 09:00', createdBy: 'Boss Admin', closedAt: '' },
        labels: ["Yes, I'm in", 'No, not next year', 'Not sure yet'], rows: [{ player: 'Pat Example', answer: 'yes', note: 'love it', answeredAt: '2026-10-18 10:00', via: 'text,email', sentAt: '' }, { player: 'Lee Sample', answer: answered ? 'no' : '', note: '', answeredAt: '', via: 'text', sentAt: '' }, { player: 'Mo Mail', answer: '', note: '', answeredAt: '', via: 'email', sentAt: '' }] });
      if (body.action === 'answer') { answered = true; return json(r, { ok: true }); }
      return json(r, { ok: true });
    }
    return r.abort(); });
  await p.goto('http://t/HughsGolf.html'); await p.waitForFunction(() => typeof loadBroadcastAdmin === 'function');
  await p.evaluate(() => {
    const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none';
    db = new SQL.Database();
    db.run(`CREATE TABLE Teams (League TEXT, Year INTEGER, Player TEXT); INSERT INTO Teams VALUES ("Hugh's",2026,'Pat Example'),("Hugh's",2025,'Old Timer'),("Hugh's",2027,'Next Year');
      CREATE TABLE Players (Player TEXT, IsTest TEXT); INSERT INTO Players VALUES ('Pat Example','N'),('Lee Sample','N'),('Test Account','Y');`);
    currentUser = { name: 'Boss Admin', role: 'admin' }; localStorage.setItem('hg_session_Boss Admin', 'sess');
    window.confirm = () => true; window.alert = m => { (window.__alerts = window.__alerts || []).push(m); };
    const ta = document.getElementById('tab-admin'); ta.style.display = 'block'; ta.classList.add('active'); document.getElementById('adminBroadcast').style.display = 'block'; loadBroadcastAdmin();
  });
  // the form starts from a template for next season, using the latest season's teams
  assert.strictEqual(await p.inputValue('#bcYear'), '2026'); assert.deepStrictEqual(await p.$$eval('#bcYear option', o => o.map(x => x.value)), ['2026', '2025'], 'a season that has not started is not offered');
  assert(/are you in for the 2027 season/.test(await p.inputValue('#bcMsg')) && await p.inputValue('#bcTitle') === 'Are you in for 2027?');
  assert(/Players on a 2026 team/.test(await p.innerText('#bcGroup')));
  // picking players lists everyone but test accounts
  await p.selectOption('#bcGroup', 'names'); const names = await p.$$eval('.bcName', e => e.map(x => x.value)); assert.deepStrictEqual(names, ['Lee Sample', 'Pat Example']);
  await p.check('.bcName[value="Pat Example"]'); await p.selectOption('#bcGroup', 'team');
  // preview says who gets it and who is left out, and asks nothing of anyone
  await p.click('#adminBroadcast >> text=Preview who gets it'); await p.waitForFunction(() => /4 people will get it/.test(document.getElementById('bcResult').innerText));
  const pv = await p.innerText('#bcResult'); assert(/No email on file, so the link is in their text and may not arrive: Tex Only/.test(pv) && /1 by text and email/.test(pv) && /2 by text,/.test(pv) && /1 by email only/.test(pv) && /Opt Out \(asked not to be contacted\)/.test(pv), pv);
  const pc = calls.find(c => c.action === 'preview'); assert(pc && pc.group === 'team' && pc.year === 2026 && JSON.stringify(pc.names) === '["Pat Example"]', JSON.stringify(pc));
  // a test goes through the send action with test=true; the real send previews first, then sends
  await p.click('#adminBroadcast >> text=Send a test to me only'); await p.waitForFunction(() => /Test sent to you/.test(document.getElementById('bcResult').innerText));
  const ts = calls.filter(c => c.action === 'send').at(-1); assert(ts && ts.test === true && ts.ask === 'season');
  await p.click('#adminBroadcast >> text=Send to everyone in the list'); await p.waitForFunction(() => /3 sent/.test(document.getElementById('bcResult').innerText));
  assert(calls.some(c => c.action === 'send' && c.test === false && /2027 season/.test(c.message) && c.title === 'Are you in for 2027?'));
  // the answers panel groups people by answer, and records one by hand
  await p.waitForSelector('#bcDetail');
  await p.waitForFunction(() => /Pat Example/.test(document.getElementById('bcDetail').innerText));
  const det = await p.innerText('#bcDetail'); assert(/Yes, I'm in \(1\)/.test(det) && /love it/.test(det) && /No answer yet \(2\)/.test(det) && /Remind the 2 who haven't answered/.test(det), det);
  await p.selectOption('select[data-p="Lee Sample"]', 'no'); await p.waitForFunction(() => /No, not next year \(1\)/.test(document.getElementById('bcDetail').innerText));
  assert(calls.some(c => c.action === 'answer' && c.player === 'Lee Sample' && c.answer === 'no' && c.id === 7));
  // Refresh reloads the drop-down count as well as the names
  const before = calls.filter(c => c.action === 'list').length; await p.click('#bcDetail >> text=Refresh'); await p.waitForTimeout(200);
  assert(calls.filter(c => c.action === 'list').length > before, 'Refresh asks the server for the list again, not just the names');
  await p.click('text=/Remind the/'); await p.waitForTimeout(200); assert(calls.some(c => c.action === 'send' && c.remindId === 7));
  assert.deepStrictEqual(errs, [], errs.join('; '));
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
