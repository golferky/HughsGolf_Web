// Round date bar: shown on the dated Play tabs only, lists regular + post-season dates, drives the tab you are on.
const fs = require('fs'), assert = require('assert');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
// pure helpers
const vm = require('vm');
function extract(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
const ctx = vm.createContext({ String, Object });
['playDateBuildOptions', 'playDateEntryDate', 'playDateStandAsOfValue'].forEach(f => vm.runInContext(extract(f), ctx));
const plain = x => JSON.parse(JSON.stringify(x));
const ps = [{ week1: 20260929, week2: 20261006 }];
assert.deepStrictEqual(plain(ctx.playDateBuildOptions(['20260915', '20260922'], ps)), [{ date: '20261006', ps: 2 }, { date: '20260929', ps: 1 }, { date: '20260922', ps: 0 }, { date: '20260915', ps: 0 }]);
assert.strictEqual(ctx.playDateEntryDate('20261006', ps), '20260929', 'Week 2 opens the single post-season entry'); assert.strictEqual(ctx.playDateEntryDate('20260922', ps), '20260922');
assert.strictEqual(ctx.playDateStandAsOfValue('20260922', ['', '20260915', '20260922']), '20260922'); assert.strictEqual(ctx.playDateStandAsOfValue('20261013', ['', '20260915', '20260922']), '20260922'); assert.strictEqual(ctx.playDateStandAsOfValue('20260101', ['', '20260915']), null);
assert(/function loadStandings\(\) \{\n  if \(!db\) return;\n  playDateApplyStandings\(\);/.test(src) && /id === 'standAsOf'\) && v === ''/.test(src), 'standings apply + Current clears');
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
  // Standings: shown, and its As of follows the picked date by showing the last round on or before it
  await p.evaluate(() => { document.getElementById('standSeason').innerHTML = '<option value="2026">2026</option>'; document.getElementById('standSeason').value = '2026';
    document.getElementById('standAsOf').innerHTML = '<option value="">Current</option><option value="20260922">9/22</option><option value="20260915">9/15</option>'; document.getElementById('standAsOf').value = ''; window.populateStandAsOf = () => {}; });
  await p.evaluate(() => __active('standings')); s = await state();
  assert.strictEqual(s.shown, 'flex', 'Standings has the date bar too');
  await p.evaluate(() => { window.__calls = []; onPlayDatePicked('20261006'); });   // a post-season night: standings after the latest regular round
  assert.deepStrictEqual(await p.evaluate(() => [window.__calls.slice(), window._playDate, playDateApplyStandings(), document.getElementById('standAsOf').value]), [['refresh:standings'], '20261006', true, '20260922']);
  assert.strictEqual((await state()).value, '20261006', 'the bar keeps showing the date that was picked');
  await p.evaluate(() => { window._playDate = '20260916'; playDateApplyStandings(); }); assert.strictEqual(await p.evaluate(() => document.getElementById('standAsOf').value), '20260915', 'nearest earlier round');
  await p.evaluate(() => { window._playDate = '20260101'; document.getElementById('standAsOf').value = ''; playDateApplyStandings(); }); assert.strictEqual(await p.evaluate(() => document.getElementById('standAsOf').value), '', 'before any round: leave Current');
  await p.evaluate(() => { window._playDate = null; });
  await p.evaluate(() => __active('home')); assert.strictEqual((await state()).shown, 'none');
  // picking a date reloads the tab you are on and remembers it for the others
  await p.evaluate(() => { window.__calls = []; __active('matches'); onPlayDatePicked('20260915'); });
  assert.deepStrictEqual(await p.evaluate(() => [window.__calls.slice(), window._playDate]), [['refresh:matches'], '20260915']);
  // Score Entry: Week 2 opens the one post-season entry; an unsaved scorecard asks first
  await p.evaluate(() => { __active('scorecard'); window.__changed = 0; document.getElementById('entryDate').addEventListener('change', () => window.__changed++); window.confirm = () => (window.__asked = (window.__asked || 0) + 1, false); entryDirty = true; onPlayDatePicked('20261006'); });
  assert.deepStrictEqual(await p.evaluate(() => [document.getElementById('entryDate').value, window.__changed, window.__asked]), ['20260922', 0, 1], 'declined: nothing changes');
  await p.evaluate(() => { window.confirm = () => true; onPlayDatePicked('20261006'); });
  assert.deepStrictEqual(await p.evaluate(() => [document.getElementById('entryDate').value, window.__changed, entryDirty, window._playDate]), ['20260929', 1, false, '20261006']);
  // opening Scores after the date was changed elsewhere: follows it; an unsaved scorecard asks first (declining keeps the Scores date)
  assert(/if \(tab === 'scorecard'\) \{ if \(!courseData\) initEntry\(\); else reRenderEntry\(\); playDateApplyEntry\(\); \}/.test(src), 'wired into refreshTab');
  const entryState2 = () => p.evaluate(() => [document.getElementById('entryDate').value, window.__changed, window._playDate, entryDirty]);
  await p.evaluate(() => { document.getElementById('entryDate').value = '20260922'; window.__changed = 0; entryDirty = false; window._playDate = '20261006'; window.confirm = () => { throw new Error('no prompt expected'); }; playDateApplyEntry(); });
  assert.deepStrictEqual(await entryState2(), ['20260929', 1, '20261006', false], 'clean scorecard: follows (Week 2 -> the post-season entry)');
  await p.evaluate(() => { document.getElementById('entryDate').value = '20260922'; window.__changed = 0; entryDirty = true; window._playDate = '20260929'; window.confirm = () => false; playDateApplyEntry(); });
  assert.deepStrictEqual(await entryState2(), ['20260922', 0, '20260922', true], 'unsaved + declined: stays, shared date follows the Scores date');
  await p.evaluate(() => { window._playDate = '20260929'; window.confirm = () => true; playDateApplyEntry(); });
  assert.deepStrictEqual(await entryState2(), ['20260929', 1, '20260929', false], 'unsaved + accepted: switches');
  await p.evaluate(() => { window._playDate = '20990101'; document.getElementById('entryDate').value = '20260922'; window.__changed = 0; playDateApplyEntry(); }); assert.deepStrictEqual((await entryState2())[0], '20260922', 'a date Score Entry does not have is ignored');
  await p.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; });
  // collapsible by season: 2027 dates added; the list shows the picked date's season open and the others folded
  await p.evaluate(() => { db.run(`INSERT INTO Schedule VALUES ('Hugh''s','20270413'),('Hugh''s','20270420')`); window._playDate = '20260915'; document.getElementById('matchesDate').innerHTML = '<option value="20260915">9/15</option>'; document.getElementById('matchesDate').value = '20260915'; window.__calls = []; __active('matches'); });
  const ui = () => p.evaluate(() => ({ btn: document.getElementById('playDateBtn').textContent.trim(), open: getComputedStyle(document.getElementById('playDatePanel')).display, expanded: document.getElementById('playDateBtn').getAttribute('aria-expanded'),
    heads: [...document.querySelectorAll('#playDatePanel [role=button]')].map(e => [...e.children].map(c => c.textContent.trim()).join(' | ')), opts: [...document.querySelectorAll('#playDatePanel [role=option]')].map(e => e.textContent.trim()) }));
  let u = await ui(); assert.strictEqual(u.btn, '09/15/2026  ▾'); assert.strictEqual(u.open, 'none'); assert.strictEqual(u.expanded, 'false');
  await p.click('#playDateBtn'); u = await ui();
  assert.strictEqual(u.open, 'block'); assert.strictEqual(u.expanded, 'true');
  assert.deepStrictEqual(u.heads, ['▶ 2027 | 2 dates', '▼ 2026 | 4 dates'], u.heads.join('|'));
  assert.deepStrictEqual(u.opts, ['10/06/2026 — Post Season Wk 2', '09/29/2026 — Post Season Wk 1', '09/22/2026', '09/15/2026']);
  assert(u.opts.includes('09/15/2026') && !u.opts.includes('04/13/2027'), 'only the picked season is open');
  await p.click('#playDatePanel [role=button]:has-text("2027")'); u = await ui();
  assert(u.opts.includes('04/13/2027') && u.opts.includes('04/20/2027') && u.opts.includes('09/15/2026'), 'both open'); assert.strictEqual(u.heads[0].startsWith('▼ 2027'), true, u.heads[0]);
  await p.click('#playDatePanel [role=button]:has-text("2026")'); u = await ui(); assert(!u.opts.includes('09/15/2026') && u.opts.includes('04/13/2027'), 'a season folds shut');
  // the real refresh puts Matches on the picked date, so the stub does too
  await p.evaluate(() => { window.__calls = []; refreshTab = tb => { window.__calls.push('refresh:' + tb); const m = document.getElementById('matchesDate'); m.innerHTML = `<option value="${window._playDate}">x</option>`; m.value = window._playDate; }; }); await p.click('[role=option]:has-text("04/20/2027")'); u = await ui();
  assert.strictEqual(u.open, 'none', 'picking closes the list'); assert.strictEqual(u.btn, '04/20/2027  ▾');
  assert.deepStrictEqual(await p.evaluate(() => [window.__calls.slice(), window._playDate, document.getElementById('playDateSel').value]), [['refresh:matches'], '20270420', '20270420']);
  await p.click('#playDateBtn'); assert.strictEqual((await ui()).open, 'block'); await p.keyboard.press('Escape'); assert.strictEqual((await ui()).open, 'none', 'Esc closes');
  await p.click('#playDateBtn'); await p.mouse.click(5, 400); assert.strictEqual((await ui()).open, 'none', 'a click elsewhere closes');
  // the per-tab date boxes are not shown any more (they stay in the page: the tabs' logic reads them)
  assert.deepStrictEqual(await p.evaluate(() => ['entryDate', 'standAsOf', 'matchesDate', 'skinsDate', 'hdcpAsOfDate', 'stablefordDate'].map(id => { const e = document.getElementById(id); return [!!e, e && getComputedStyle(e.closest('.filter-group')).display]; })), Array(6).fill([true, 'none']));
  // Standings and Handicaps: Current (latest) at the top of the list; picking it clears the shared date and the tab's own select
  await p.evaluate(() => { window._playDate = '20260915'; document.getElementById('standAsOf').value = '20260915'; window.__calls = []; refreshTab = t => window.__calls.push('refresh:' + t); __active('standings'); });
  let st = await p.evaluate(() => ({ first: document.getElementById('playDateSel').options[0].textContent, btn: document.getElementById('playDateBtn').textContent.trim() })); assert.strictEqual(st.first, 'Current (latest)'); assert.strictEqual(st.btn, '09/15/2026  ▾');
  await p.click('#playDateBtn'); assert.strictEqual(await p.evaluate(() => document.querySelector('#playDatePanel [role=option]').textContent.trim()), 'Current (latest)');
  await p.click('#playDatePanel [role=option]:has-text("Current (latest)")');
  assert.deepStrictEqual(await p.evaluate(() => [window.__calls.slice(), window._playDate, document.getElementById('standAsOf').value, document.getElementById('playDateBtn').textContent.trim(), document.getElementById('playDateSel').value]), [['refresh:standings'], null, '', 'Current (latest)  ▾', '']);
  await p.evaluate(() => { document.getElementById('hdcpAsOfDate').innerHTML = '<option value="">Current</option><option value="20260915">9/15</option>'; document.getElementById('hdcpAsOfDate').value = ''; window.__calls = []; __active('handicaps'); });
  assert.strictEqual(await p.evaluate(() => document.getElementById('playDateBtn').textContent.trim()), 'Current (latest)  ▾', 'Handicaps open on Current');
  await p.evaluate(() => { onPlayDatePicked('20260915'); }); assert.deepStrictEqual(await p.evaluate(() => [window._playDate, window.__calls.slice()]), ['20260915', ['refresh:handicaps']]);
  await p.evaluate(() => { window.__calls = []; onPlayDatePicked(''); }); assert.deepStrictEqual(await p.evaluate(() => [window._playDate, document.getElementById('hdcpAsOfDate').value, window.__calls.slice()]), [null, '', ['refresh:handicaps']]);
  // another tab with no date chosen yet opens on the latest round that has scores
  await p.evaluate(() => { db.run(`CREATE TABLE IF NOT EXISTS Scores (League TEXT, Date TEXT); INSERT INTO Scores VALUES ('Hugh''s','20260922')`); window._playDate = null; window.__changed2 = 0;
    const m = document.getElementById('matchesDate'); m.innerHTML = '<option value="">-</option><option value="20260922">9/22</option><option value="20260915">9/15</option>'; m.value = ''; m.addEventListener('change', () => window.__changed2++); __active('matches'); });
  await p.waitForTimeout(100);
  assert.deepStrictEqual(await p.evaluate(() => [window._playDate, document.getElementById('matchesDate').value, document.getElementById('playDateBtn').textContent.trim(), window.__changed2]), ['20260922', '20260922', '09/22/2026  ▾', 1], 'defaults to the latest played round and tells the tab');
  assert.deepStrictEqual(errs, [], errs.join('; '));
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
