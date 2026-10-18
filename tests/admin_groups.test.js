// Admin screens are grouped under a few buttons; developer-only screens sit together; a group nobody could open anything in is hidden.
const fs = require('fs'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
const groups = eval('(' + src.match(/const ADMIN_GROUPS = (\{[\s\S]*?\n\});/)[1] + ')');
const sections = JSON.parse('[' + src.match(/const ADMIN_SECTIONS = \[([^\]]*)\]/)[1].replace(/'/g, '"') + ']');
assert.deepStrictEqual(Object.keys(groups), ['tables', 'messages', 'money', 'logging', 'notes', 'developer']);
const grouped = Object.values(groups).flat();
assert.strictEqual(new Set(grouped).size, grouped.length, 'a screen is in one group only');
sections.forEach(s => assert(s === 'gallus' || grouped.includes(s), s + ' is reachable (grouped, or Gallus Queue on its own)'));
grouped.forEach(s => assert(sections.includes(s), s + ' is a real section'));
const PV_DEV_ONLY = eval(src.match(/const PV_DEV_ONLY_SECTIONS = (\[[^\]]*\])/)[1]);
PV_DEV_ONLY.forEach(s => assert(groups.developer.includes(s), s + ' (developer only) is in the Developer group'));
assert.deepStrictEqual(groups.developer.filter(s => !PV_DEV_ONLY.includes(s)), ['compare'], 'Developer holds the developer-only screens (and Compare Live)');
// the buttons: one group button each, a pill for every grouped screen inside its group's row, Redeploy beside them
for (const [g, list] of Object.entries(groups)) {
  const cap = g[0].toUpperCase() + g.slice(1);
  assert(new RegExp(`id="adminGroup${cap}"`).test(src), 'group button ' + g);
  const row = src.match(new RegExp(`<div id="adminSubnav${cap}" class="admin-subnav">([\\s\\S]*?)\\n    </div>`))[1];
  list.forEach(s => assert(new RegExp(`id="adminBtn${s[0].toUpperCase() + s.slice(1)}"`).test(row), `${s} is in the ${g} row`));
}
assert(/id="adminBtnGallus"[^>]*class="admin-btn"/.test(src) && /id="adminBtnRedeploy" class="admin-btn dev-only"/.test(src));
// behaviour in a real browser
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
(async () => {
  if (!chromium || !fs.existsSync('/opt/pw-browsers/chromium')) { console.log('ok (browser part skipped)'); return; }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1200, height: 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  await p.route('**/*', async r => { const u = r.request().url();
    if (u === 'http://t/HughsGolf.html') return r.fulfill({ body: src, contentType: 'text/html' });
    return r.abort(); });
  await p.goto('http://t/HughsGolf.html'); await p.waitForFunction(() => typeof showAdminSection === 'function');
  await p.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; document.getElementById('tab-admin').classList.add('active');
    for (const n of ['loadAdminPlayers', 'loadAdminTeams', 'loadAdminSubs', 'buildTableList', 'loadScheduleBuilder', 'loadRainoutText', 'loadGallusQueue', 'loadServerLog', 'loadBackups', 'loadLeagueSettings', 'loadLoginActivity', 'populatePdfControls', 'loadPdfEmailHistory', 'loadAdminChangelog', 'loadBacklog', 'loadNewSeasonSetup', 'loadCarriersAdmin', 'loadProposalsAdmin', 'loadExpenses', 'loadCompareSection', 'loadAwardPrizesTab', 'loadBalanceSheet', 'loadPageViews', 'loadWhoson', 'loadBroadcastAdmin', 'loadEmailLog']) window[n] = () => {}; });
  const vis = sel => p.$$eval(sel, els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.id));
  const sets = role => p.evaluate(role => { window.__role = role; ['adminBtnLeaguesettings', 'adminBtnLoginactivity', 'adminBtnBackups', 'adminBtnSql', 'adminBtnCompare'].forEach(id => { const e = document.getElementById(id); if (e) e.style.display = ''; });
    const dev = role === 'developer'; document.getElementById('adminBtnLeaguesettings').style.display = dev ? '' : 'none'; document.getElementById('adminBtnBackups').style.display = dev ? '' : 'none'; document.getElementById('adminBtnSql').style.display = dev ? '' : 'none'; document.getElementById('adminBtnCompare').style.display = 'none'; syncAdminGroupButtons(); }, role);
  await sets('developer'); const devNav = await vis('.admin-nav > button'); ['adminBtnGallus', 'adminGroupTables', 'adminGroupMessages', 'adminGroupMoney', 'adminGroupLogging', 'adminGroupNotes', 'adminGroupDeveloper'].forEach(id => assert(devNav.includes(id), id + ' shows: ' + devNav.join(',')));
  await sets('admin'); const adminNav = await vis('.admin-nav > button'); assert(!adminNav.includes('adminGroupDeveloper'), 'an admin who is not the developer does not see the Developer group: ' + adminNav.join(','));
  await sets('developer'); assert((await vis('.admin-nav > button')).includes('adminGroupDeveloper'), 'the developer does');
  // opening a group opens its first (or last used) screen, and only that group's row shows
  await p.evaluate(() => showAdminSection(adminGroupDefault('messages')));
  assert.strictEqual(await p.evaluate(() => window._adminSection), 'rainout');
  assert.deepStrictEqual(await vis('.admin-subnav.active-admin-subnav'), ['adminSubnavMessages']);
  await p.evaluate(() => showAdminSection('proposals')); await p.evaluate(() => showAdminSection('expenses'));
  assert.deepStrictEqual(await vis('.admin-subnav.active-admin-subnav'), ['adminSubnavMoney']);
  assert.strictEqual(await p.evaluate(() => adminGroupDefault('messages')), 'proposals', 'the group button returns to the screen you last used in it');
  assert.strictEqual(await p.evaluate(() => document.getElementById('adminGroupMoney').className.includes('active-admin-btn')), true);
  assert.strictEqual(await p.evaluate(() => document.getElementById('adminGroupMessages').className.includes('active-admin-btn')), false);
  // an admin (not the developer) opening Developer would land on the first screen they can see: none, so the group is hidden instead
  await sets('admin'); assert.strictEqual(await p.evaluate(() => adminGroupDefault('developer')), 'sql', 'falls back to the first screen if none is visible (the group is hidden anyway)');
  assert.deepStrictEqual(errs, [], errs.join('; '));
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
