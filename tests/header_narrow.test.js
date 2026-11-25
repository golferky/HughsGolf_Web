// The header wraps into rows on narrow screens (phones, folding phones): no sideways scroll, the version line stays whole, the tab bar is the pinned part.
const fs = require('fs'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
assert(/@media \(max-width: 1180px\)\s*\{\s*header \{ position: static; height: auto;/.test(src), 'narrow-screen header rules');
assert(/class="header-ver"/.test(src), 'the version block can be styled on its own');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
(async () => {
  if (!chromium || !fs.existsSync('/opt/pw-browsers/chromium')) { console.log('ok (browser part skipped)'); return; }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const measure = async w => {
    const p = await b.newPage({ viewport: { width: w, height: 800 } });
    await p.route('**/*', async r => { const u = r.request().url();
      if (u === 'http://t/HughsGolf.html') return r.fulfill({ body: src, contentType: 'text/html' });
      if (u.startsWith('http://t/vendor/sqljs/')) return r.fulfill({ body: fs.readFileSync(path.join(__dirname, '..', u.replace('http://t/', ''))), contentType: u.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
      return r.abort(); });
    await p.goto('http://t/HughsGolf.html'); await p.waitForFunction(() => typeof switchTab === 'function');
    await p.evaluate(() => { const $ = id => document.getElementById(id);
      $('loginOverlay').style.display = 'none';
      $('appVersionDisplay').textContent = 'v20261114.2-sandbox · PR #141 · a0280aa'; $('dbVersionDisplay').textContent = 'DB 11/25, 9:17 AM';
      const wk = $('weeksLeftBanner'); wk.style.display = 'inline'; wk.textContent = '11 weeks left in 1st Half';
      const u = $('loggedInUser'); u.style.display = 'inline'; u.textContent = 'Gary Scudder';
      ['changePwBtn', 'switchUserBtn', 'logoutBtn'].forEach(id => $(id).style.display = 'inline-block');
      const v = $('viewModeGroup'); v.style.display = 'inline'; v.innerHTML = 'View: <button>Developer</button> <button>Admin</button> <button>Player</button>';
      $('dbStatus').textContent = 'HughsGolf.db'; });
    const r = await p.evaluate(() => { const h = document.querySelector('header'), ver = document.getElementById('appVersionDisplay').getBoundingClientRect();
      return { docW: document.documentElement.scrollWidth, headerH: h.offsetHeight, pos: getComputedStyle(h).position, tabTop: getComputedStyle(document.querySelector('.tabwrap')).top, verLines: Math.round(ver.height / parseFloat(getComputedStyle(document.getElementById('appVersionDisplay')).lineHeight || 16)) }; });
    await p.close(); return r;
  };
  for (const w of [360, 540, 720, 1000]) {
    const r = await measure(w);
    assert.strictEqual(r.docW, w, `${w}px: the page must not scroll sideways (scrollWidth ${r.docW})`);
    assert.strictEqual(r.pos, 'static', `${w}px: the header scrolls away`); assert.strictEqual(r.tabTop, '0px', `${w}px: the tab bar pins to the top`);
    assert(r.headerH > 60, `${w}px: the header wraps into rows`);
  }
  const wide = await measure(1300);
  assert.strictEqual(wide.pos, 'sticky'); assert.strictEqual(wide.headerH, 60, 'wide screens keep the one-line 60px header'); assert.strictEqual(wide.tabTop, '60px');
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
