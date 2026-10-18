// Home is one page: the Home cards with Stats below them; no Home | Stats sub-tabs.
const fs = require('fs'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
assert(!/data-tab="stats"/.test(src) && !/id="tab-stats"/.test(src), 'Stats is no longer its own tab');
const home = src.slice(src.indexOf('id="tab-home"'), src.indexOf('id="tab-play"') > 0 ? src.indexOf('id="tab-play"') : undefined);
const iHome = src.indexOf('id="tab-home"'), iStats = src.indexOf('id="homeStatsSection"');
assert(iHome > 0 && iStats > iHome, 'the Stats block sits inside the Home page');
['statsIndividualView', 'statsRankingsView', 'statsLeadersView', 'statsH2HView', 'statsPlayer', 'statsSummary'].forEach(id => assert(src.indexOf(`id="${id}"`) > iStats, id + ' is under Home'));
assert(/if \(tab === 'home'\) \{ loadHome\(\); loadPlayerStats\(\); \}/.test(src), 'opening Home also loads the stats');
assert(/if \(tabName === 'stats'\) tabName = 'home'/.test(src), 'an old link to the Stats tab opens Home');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
(async () => {
  if (!chromium || !fs.existsSync('/opt/pw-browsers/chromium')) { console.log('ok (browser part skipped)'); return; }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  await p.route('**/*', async r => { const u = r.request().url();
    if (u === 'http://t/HughsGolf.html') return r.fulfill({ body: src, contentType: 'text/html' });
    if (u.startsWith('http://t/vendor/sqljs/')) return r.fulfill({ body: fs.readFileSync(path.join(__dirname, '..', u.replace('http://t/', ''))), contentType: u.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    return r.abort(); });
  await p.goto('http://t/HughsGolf.html'); await p.waitForFunction(() => typeof switchTab === 'function');
  await p.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; window.__loaded = []; loadHome = () => window.__loaded.push('home'); loadPlayerStats = () => window.__loaded.push('stats'); db = {}; currentUser = { name: 'Pat', role: 'player' }; syncTabGroups(); switchTab('home'); });
  assert.deepStrictEqual(await p.evaluate(() => window.__loaded), ['home', 'stats'], 'Home loads the cards and the stats');
  assert.strictEqual(await p.evaluate(() => getComputedStyle(document.getElementById('subTabs')).display), 'none', 'no second row of tabs under Home');
  assert.strictEqual(await p.evaluate(() => getComputedStyle(document.getElementById('homeStatsSection')).display), 'block', 'the Stats block is on the Home page');
  await p.evaluate(() => switchTab('stats')); assert.strictEqual(await p.evaluate(() => document.querySelector('.tab.active').dataset.tab), 'home', 'an old Stats link opens Home');
  await p.evaluate(() => switchTab('matches')); assert.notStrictEqual(await p.evaluate(() => getComputedStyle(document.getElementById('subTabs')).display), 'none', 'other groups keep their tab row');
  assert.deepStrictEqual(errs, [], errs.join('; '));
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
