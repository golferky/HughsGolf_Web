// Opening the app must not send ALTER TABLE for columns the database already has (it used to, every load, and the server answered 500).
const fs = require('fs'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
const fn = src.slice(src.indexOf('function ensureAppChangelogTable()'), src.indexOf('function ensureAppChangelogTable()') + 6000);
assert(!/serverRun\(`ALTER TABLE SeasonSettings ADD COLUMN (ChampPlaces|StandPlace|Byes)/.test(fn), 'no unconditional server ALTERs left');
assert(/const ensureCol = \(table, name, ddl\) => \{\s*if \(hasDbColumn\(table, name\)\) return;/.test(fn), 'guarded by hasDbColumn');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
(async () => {
  if (!chromium || !fs.existsSync('/opt/pw-browsers/chromium')) { console.log('ok (browser part skipped)'); return; }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  await p.route('**/*', async r => { const u = r.request().url(); if (u === 'http://t/HughsGolf.html') return r.fulfill({ body: src, contentType: 'text/html' });
    if (u.startsWith('http://t/vendor/sqljs/')) return r.fulfill({ body: fs.readFileSync(path.join(__dirname, '..', u.replace('http://t/', ''))), contentType: u.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    return r.abort(); });
  await p.goto('http://t/HughsGolf.html'); await p.waitForFunction(() => typeof SQL !== 'undefined' && SQL);
  const run = (haveAll) => p.evaluate((haveAll) => {
    db = new SQL.Database(); const sent = []; serverRun = async (sql) => { sent.push(sql); };
    const ss = haveAll ? ', ChampPlaces INTEGER, StandPlace1 REAL, StandPlace2 REAL, StandPlace3 REAL, Byes INTEGER' : '';
    db.run(`CREATE TABLE Players (Player TEXT${haveAll ? ', PhotoKey TEXT' : ''}); CREATE TABLE LeagueSettings (League TEXT${haveAll ? ', StartWeek TEXT' : ''}); CREATE TABLE SeasonSettings (League TEXT, Season INTEGER${ss}); CREATE TABLE AppChangelog (ID INTEGER PRIMARY KEY AUTOINCREMENT, Version TEXT, ReleaseDate TEXT, Category TEXT, Item TEXT, SortOrder INTEGER, Notes TEXT${haveAll ? ', AddedBy TEXT, AddedAt TEXT' : ''})`);
    ensureAppChangelogTable();
    return { alters: sent.filter(s => /^ALTER TABLE/.test(s)), localHas: ['ChampPlaces', 'Byes'].every(c => hasDbColumn('SeasonSettings', c)) && hasDbColumn('AppChangelog', 'AddedBy') };
  }, haveAll);
  const complete = await run(true);
  assert.deepStrictEqual(complete.alters, [], 'columns present: nothing sent to the server');
  const old = await run(false);
  assert.strictEqual(old.alters.length, 9, 'columns missing (SeasonSettings x5 + LeagueSettings.StartWeek + Players.PhotoKey + AddedBy + AddedAt; Notes present): each sent once: ' + JSON.stringify(old.alters));
  assert(old.localHas, 'and added to the local copy');
  assert.deepStrictEqual(errs, [], errs.join('; '));
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
