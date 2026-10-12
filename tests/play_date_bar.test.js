// Round date bar: shown on the dated Play tabs only, lists regular + post-season dates, drives the tab you are on.
const fs = require('fs'), assert = require('assert');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
// pure helpers
const vm = require('vm');
function extract(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
const ctx = vm.createContext({ String, Object });
['playDateBuildOptions', 'playDateEntryDate'].forEach(f => vm.runInContext(extract(f), ctx));
const plain = x => JSON.parse(JSON.stringify(x));
const ps = [{ week1: 20260929, week2: 20261006 }];
assert.deepStrictEqual(plain(ctx.playDateBuildOptions(['20260915', '20260922'], ps)), [{ date: '20261006', ps: 2 }, { date: '20260929', ps: 1 }, { date: '20260922', ps: 0 }, { date: '20260915', ps: 0 }]);
assert.strictEqual(ctx.playDateEntryDate('20261006', ps), '20260929', 'Week 2 opens the single post-season entry'); assert.strictEqual(ctx.playDateEntryDate('20260922', ps), '20260922');
assert(/Post Season Wk \$\{o\.ps\}/.test(src) && /id="playDateBar"/.test(src) && /syncPlayDateBar\(\); \} catch \(e\) \{\}\n\}/.test(src));
// in a real browser, with the app's own sql.js and a tiny database (skipped where Playwright/Chromium is not installed)
const path = require('path');
(async () => {
  if (!chromium || !fs.existsSync('/opt/pw-browsers/chromium')) { console.log('ok (browser part skipped: no Playwright/Chromium here)'); return; }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  await p.route('**/*', async r => { const u = r.request().url(); if (u === 'http://t/HughsGolf.html') return r.fulfill({ body: src, contentType: 'text/html' });
    if (u.startsWith('http://t/vendor/sqljs/')) return r.fulfill({ body: fs.readFileSync(path.join(__dirname, '..', u.replace('http://t/', ''))), contentType: u.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    return r.abort(); });
  await p.goto('http://t/HughsGolf.html'); await p.waitForFunction(() => typeof SQL !== 'undefined' && SQL);
  await p.evaluate(() => {
    db = new SQL.Database();
    db.run(`CREATE TABLE Schedule (League TEXT, Date TEXT); INSERT INTO Schedule VALUES ('Hugh''s','20260915'),('Hugh''s','20260922');
            CREATE TABLE SeasonSettings (League TEXT, Season INTEGER, PostSeasonDt TEXT, PSWeek2Dt TEXT); INSERT INTO SeasonSettings VALUES ('Hugh''s',2026,'9/29/2026',NULL);`);
    window.__calls = []; refreshTab = t => window.__calls.push('refresh:' + t);
    document.getElementById('matchesDate').innerHTML = '<option value="20260922">9/22</option>'; document.getElementById('matchesDate').value = '20260922';
    document.getElementById('entryDate').innerHTML = '<option value="20260929">PS</option><option value="20260922">9/22</option>'; document.getElementById('entryDate').value = '20260922';
    window.__active = t => { document.querySelectorAll('.tab').forEach(x => x.classList.remove('active')); document.querySelector(`.tab[data-tab="${t}"]`).classList.add('active'); syncPlayDateBar(); };
  });
  const state = () => p.evaluate(() => ({ shown: getComputedStyle(document.getElementById('playDateBar')).display, value: document.getElementById('playDateSel').value, opts: [...document.getElementById('playDateSel').options].map(o => o.textContent) }));
  await p.evaluate(() => __active('matches')); let s = await state();
  assert.strictEqual(s.shown, 'flex'); assert.strictEqual(s.value, '20260922', 'shows the tab\'s own date');
  assert.deepStrictEqual(s.opts, ['10/06/2026 — Post Season Wk 2', '09/29/2026 — Post Season Wk 1', '09/22/2026', '09/15/2026']);
  await p.evaluate(() => __active('standings')); assert.strictEqual((await state()).shown, 'none', 'Standings has no date');
  await p.evaluate(() => __active('home')); assert.strictEqual((await state()).shown, 'none');
  // picking a date reloads the tab you are on and remembers it for the others
  await p.evaluate(() => { __active('matches'); onPlayDatePicked('20260915'); });
  assert.deepStrictEqual(await p.evaluate(() => [window.__calls.slice(), window._playDate]), [['refresh:matches'], '20260915']);
  // Score Entry: Week 2 opens the one post-season entry; an unsaved scorecard asks first
  await p.evaluate(() => { __active('scorecard'); window.__changed = 0; document.getElementById('entryDate').addEventListener('change', () => window.__changed++); window.confirm = () => (window.__asked = (window.__asked || 0) + 1, false); entryDirty = true; onPlayDatePicked('20261006'); });
  assert.deepStrictEqual(await p.evaluate(() => [document.getElementById('entryDate').value, window.__changed, window.__asked]), ['20260922', 0, 1], 'declined: nothing changes');
  await p.evaluate(() => { window.confirm = () => true; onPlayDatePicked('20261006'); });
  assert.deepStrictEqual(await p.evaluate(() => [document.getElementById('entryDate').value, window.__changed, entryDirty, window._playDate]), ['20260929', 1, false, '20261006']);
  assert.deepStrictEqual(errs, [], errs.join('; '));
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
