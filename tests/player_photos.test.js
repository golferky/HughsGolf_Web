// Player photos (client): avatars beside names (initials circles only once someone has a photo), upload / remove calls, cache refresh.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name, asyn) { const i = src.indexOf((asyn ? 'async function ' : 'function ') + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
function world(rows = []) {
  const els = { selfPhotoStatus: { textContent: '', style: {} }, selfPhotoSlot: { innerHTML: '' }, selfPhotoRemove: { style: { display: 'none' } } };
  const sent = [], runs = [], alerts = []; const c = vm.createContext({ els, sent, runs, alerts, rows: rows.slice(), Object, JSON, String, Promise, encodeURIComponent, Math, window: {}, currentUser: { name: 'Sam Admin' },
    localStorage: { getItem: k => ({ 'hg_session_Pat Example': 'sess-pat', 'hg_session_Sam Admin': 'sess-sam' })[k] || null },
    document: { getElementById: id => els[id] || null }, db: {}, hasDbColumn: () => true, escapeHtml: t => String(t).replace(/</g, '&lt;'),
    query: () => c.rows.filter(r => r.PhotoKey).map(r => ({ Player: r.Player, PhotoKey: r.PhotoKey })),
    confirm: () => true, alert: m => alerts.push(m), loadAdminPlayers() {}, SERVER_DB_MODIFIED_MS: 0, SERVER_DB_MODIFIED: 0,
    photoToSquareJpeg: async () => ({ size: 40000, type: 'image/jpeg' }),
    fetch: async (url, opts) => { sent.push({ url, opts }); return { json: async () => c.reply }; } });
  c.reply = { ok: true, photoKey: 'a'.repeat(24), modifiedMs: 7 };
  c.db = { run: (sql, args) => { runs.push({ sql, args }); const r = c.rows.find(x => x.Player === args[1]); if (r) r.PhotoKey = args[0]; } };
  ['playerPhotoMap', 'playerInitials', 'playerAvatar', 'playerSessionToken', 'photoChanged', 'refreshSelfPhoto'].forEach(f => vm.runInContext(extract(f), c));
  ['uploadMyPhoto', 'removeMyPhoto', 'adminRemovePhoto'].forEach(f => vm.runInContext(extract(f, true), c));
  return { c, els, sent, runs, alerts };
}
(async () => {
  // nobody has a photo: no avatars at all (screens look as before)
  let w = world([{ Player: 'Pat Example' }, { Player: 'Lee Player' }]);
  assert.strictEqual(w.c.playerAvatar('Pat Example'), '');
  assert(/>PE</i.test(w.c.playerAvatar('Pat Example', 72, true)), 'the profile can force the initials circle');
  // one person has one: they get the picture, everybody else gets initials
  w = world([{ Player: 'Pat Example', PhotoKey: 'b'.repeat(24) }, { Player: 'Lee Player' }]);
  assert(/<img src="\/photos\/b{24}\.jpg"/.test(w.c.playerAvatar('Pat Example')) && /loading="lazy"/.test(w.c.playerAvatar('Pat Example')));
  assert(/>LP</.test(w.c.playerAvatar('Lee Player')) && !/<img/.test(w.c.playerAvatar('Lee Player')));
  assert.strictEqual(w.c.playerInitials('Mary Ann van Buren'), 'MB'); assert.strictEqual(w.c.playerInitials('Cher'), 'C'); assert.strictEqual(w.c.playerInitials(''), '');
  assert(!/<script/.test(w.c.playerAvatar('<script>x</script>')), 'a name cannot inject markup');
  // upload: sends the shrunken picture with the player's session; this browser's copy and the avatars follow
  w = world([{ Player: 'Pat Example' }, { Player: 'Lee Player' }]); assert.strictEqual(w.c.playerAvatar('Pat Example'), '');
  assert.strictEqual(await w.c.uploadMyPhoto({ name: 'x.heic' }, 'Pat Example'), true);
  const u = w.sent[0]; assert.strictEqual(u.url, '/upload-my-photo'); assert.strictEqual(u.opts.method, 'POST');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(u.opts.headers)), { 'Content-Type': 'image/jpeg', 'X-Player': 'Pat%20Example', 'X-Session': 'sess-pat' });
  assert.strictEqual(u.opts.body.type, 'image/jpeg');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(w.runs[0].args)), ['a'.repeat(24), 'Pat Example']);
  assert(/<img src="\/photos\/a{24}\.jpg"/.test(w.c.playerAvatar('Pat Example')), 'the new photo shows at once (cache refreshed)');
  assert(/>LP</.test(w.c.playerAvatar('Lee Player')), 'and others now get initials'); assert.strictEqual(w.els.selfPhotoStatus.textContent, 'Photo saved.'); assert(/img/.test(w.els.selfPhotoSlot.innerHTML)); assert.strictEqual(w.els.selfPhotoRemove.style.display, '');
  // a refusal or an unreadable picture says so and changes nothing
  w = world([{ Player: 'Pat Example' }]); w.c.reply = { ok: false, error: 'Please sign in again, then try once more.' };
  assert.strictEqual(await w.c.uploadMyPhoto({}, 'Pat Example'), false); assert.strictEqual(w.els.selfPhotoStatus.textContent, 'Please sign in again, then try once more.'); assert.strictEqual(w.runs.length, 0);
  w = world([{ Player: 'Pat Example' }]); w.c.photoToSquareJpeg = async () => { throw new Error('unreadable'); };
  assert.strictEqual(await w.c.uploadMyPhoto({}, 'Pat Example'), false); assert(/JPEG or PNG/.test(w.els.selfPhotoStatus.textContent)); assert.strictEqual(w.sent.length, 0);
  // remove (own) and admin remove
  w = world([{ Player: 'Pat Example', PhotoKey: 'c'.repeat(24) }]);
  assert.strictEqual(await w.c.removeMyPhoto('Pat Example'), true);
  assert.deepStrictEqual(JSON.parse(w.sent[0].opts.body), { player: 'Pat Example', sessionToken: 'sess-pat' }); assert.strictEqual(w.sent[0].url, '/remove-my-photo'); assert.strictEqual(w.runs[0].args[0], '');
  w = world([{ Player: 'Pat Example', PhotoKey: 'c'.repeat(24) }]);
  assert.strictEqual(await w.c.adminRemovePhoto('Pat Example'), true);
  assert.deepStrictEqual(JSON.parse(w.sent[0].opts.body), { admin: 'Sam Admin', sessionToken: 'sess-sam', player: 'Pat Example' }); assert.strictEqual(w.sent[0].url, '/admin-remove-photo');
  w = world([{ Player: 'Pat Example', PhotoKey: 'c'.repeat(24) }]); w.c.reply = { ok: false, error: 'Only an admin can remove another player\'s photo.' };
  assert.strictEqual(await w.c.adminRemovePhoto('Pat Example'), false); assert.deepStrictEqual(w.alerts, ["Only an admin can remove another player's photo."]); assert.strictEqual(w.runs.length, 0);
  // wiring on the screens
  assert(/\$\{playerAvatar\(r\.Player\)\}\$\{r\.Player\}<\/td>/.test(src), 'Standings (individual)');
  assert(/playerAvatar\(r\.a_player\)/.test(src) && /playerAvatar\(r\.b_player\)/.test(src), 'Standings (team)');
  assert(/playerAvatar\(sub \|\| name\)/.test(src) && /playerAvatar\(r\.p1\)/.test(src) && /playerAvatar\(r\.p2\)/.test(src), 'Matches');
  assert(/playerAvatar\(r\.Player, 24\)/.test(src), 'admin Players');
  assert(/ensureCol\('Players', 'PhotoKey', 'TEXT'\)/.test(src), 'the column is added to older databases');
  assert(/id="selfPhotoFile" type="file" accept="image\/\*"/.test(src));
  // the admin's player editor shows the photo with a Remove button only for a player who has one
  const ed = world([{ Player: 'Pat Example', PhotoKey: 'd'.repeat(24) }, { Player: 'Lee Player' }]);
  ed.els.pmPhotoRow = { style: { display: 'none' } }; ed.els.pmPhotoSlot = { innerHTML: '' }; ed.els.pmPhotoRemove = {};
  vm.runInContext(extract('playerEditorPhotoRow'), ed.c);
  ed.c.playerEditorPhotoRow('Pat Example'); assert.strictEqual(ed.els.pmPhotoRow.style.display, 'flex'); assert(/img/.test(ed.els.pmPhotoSlot.innerHTML));
  ed.c.playerEditorPhotoRow('Lee Player'); assert.strictEqual(ed.els.pmPhotoRow.style.display, 'none'); ed.c.playerEditorPhotoRow(''); assert.strictEqual(ed.els.pmPhotoRow.style.display, 'none');
  assert(/playerEditorPhotoRow\(r\.Player\)/.test(src) && /playerEditorPhotoRow\(''\)/.test(src), 'wired into the editor');
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
