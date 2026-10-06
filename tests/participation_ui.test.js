// League participation is separate from the access role: helpers, pickers, Edit Player form, Players list.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const J = x => JSON.parse(JSON.stringify(x));
function ctx(cols = true, players = []) {
  const c = vm.createContext({ db: {}, hasDbColumn: (t, col) => cols && ['Participates', 'IsTest', 'TestOwner'].includes(col),
    query: (sql, args) => { if (/FROM Players WHERE .*ORDER BY Player/.test(sql) && /Participates/.test(sql)) return players.filter(p => String(p.Participates ?? 'Y').toUpperCase() !== 'N' && String(p.IsTest ?? 'N').toUpperCase() !== 'Y').map(p => ({ Player: p.Player })); return []; } });
  ['roleFromOfficerValue', 'playersHaveParticipationColumns', 'participantRowOk', 'participantSql', 'leaguePlayerNames', 'participationLabel', 'participationCellHtml'].forEach(n => vm.runInContext(extract(n), c));
  return c;
}
const c = ctx();
// the four examples: role and participation vary independently
const nonPlayingAdmin = { Player: 'A', Officer: 'admin', Participates: 'N', IsTest: 'N' };
const normalPlayer = { Player: 'P', Officer: '', Participates: 'Y', IsTest: 'N' };
const viewer = { Player: 'V', Officer: '', Participates: 'N', IsTest: 'N' };
const testAcct = { Player: 'T', Officer: '', Participates: 'Y', IsTest: 'Y', TestOwner: 'P' };
assert.strictEqual(c.roleFromOfficerValue(nonPlayingAdmin.Officer), 'admin'); assert.strictEqual(c.participantRowOk(nonPlayingAdmin), false, 'admin access, participation off');
assert.strictEqual(c.roleFromOfficerValue(normalPlayer.Officer), 'player'); assert.strictEqual(c.participantRowOk(normalPlayer), true, 'player access, participation on');
assert.strictEqual(c.participantRowOk(viewer), false, 'participation off whatever the access');
assert.strictEqual(c.participantRowOk(testAcct), false, 'a test account is never a participant, even with Participates=Y');
assert.strictEqual(c.participantRowOk({ Player: 'Old', Officer: 'Developer' }), true, 'blank flags = unchanged (a developer who plays still plays)');
assert.strictEqual(c.participantRowOk({ Participates: null, IsTest: null }), true);
assert.strictEqual(c.roleFromOfficerValue('developer'), 'developer'); // role mapping untouched by participation
// SQL fragment: real condition when the columns exist, always-true on an old DB
assert(/COALESCE\(p\.Participates,'Y'\)!='N' AND COALESCE\(p\.IsTest,'N'\)!='Y'/.test(c.participantSql('p')));
assert.strictEqual(ctx(false).participantSql('p'), '1=1');
// picker list: only participants
const all = [nonPlayingAdmin, normalPlayer, viewer, testAcct, { Player: 'Blank' }];
assert.deepStrictEqual(J(ctx(true, all).leaguePlayerNames()), ['P', 'Blank']);
// labels for the Players list
assert.deepStrictEqual(J(c.participationLabel(normalPlayer)), { kind: 'on', text: 'Plays', owner: '' });
assert.deepStrictEqual(J(c.participationLabel(nonPlayingAdmin)), { kind: 'off', text: 'Not playing', owner: '' });
assert.deepStrictEqual(J(c.participationLabel(testAcct)), { kind: 'test', text: 'Test', owner: 'P' });
assert(/owner: P/.test(c.participationCellHtml(testAcct)) && /\(no owner\)/.test(c.participationCellHtml({ IsTest: 'Y' })));
assert(/Not playing/.test(c.participationCellHtml(viewer)) && /Plays/.test(c.participationCellHtml(normalPlayer)));
// every league picker uses the participant list; none still lists all Players
['loadAdminTeams', 'loadAdminSubs', 'openSubPicker'].forEach(n => {
  const body = src.slice(src.indexOf('function ' + n + '('), src.indexOf('function ' + n + '(') + 6000).split(/\nfunction /)[0];
  assert(/leaguePlayerNames\(\)/.test(body), n + ' lists participants only');
});
assert(/function showKittyPay[\s\S]{0,900}participantSql\(\)/.test(src), 'prize payout picker');
assert(/AND \$\{participantSql\('p'\)\}\s*\n\s*AND COALESCE\(p\.Status/.test(src), 'need-a-sub candidates exclude non-participants');
const buildGrid = extract('buildEntryGrid');
assert(/leaguePlayerNames\(\)/.test(buildGrid), 'score entry grid');
// Edit Player: fields, owner required for a test account, saved on both the server and the local copy, audited
['pmParticipates', 'pmIsTest', 'pmTestOwner'].forEach(id => assert(new RegExp('id="' + id + '"').test(src), id));
assert(/Choose who owns this test account/.test(src), 'a test account needs an owner');
assert(/Participates='\$\{part\.Participates\}',IsTest='\$\{part\.IsTest\}',TestOwner=/.test(src), 'server UPDATE');
assert(/UPDATE Players SET Participates=\?,IsTest=\?,TestOwner=\? WHERE Player=\?/.test(src), 'local copy');
assert(/\.\.\.\(playersHaveParticipationColumns\(\) \? participationFormValues\(\) : \{\}\)/.test(src), 'audit snapshot');
// Players list: a Plays column before Role, header and cell in step
assert(/>Plays<\/th>\s*<th[^>]*>Role<\/th>/.test(src) && /participationCellHtml\(r\)[\s\S]{0,200}playerRoleCellHtml\(r\.Officer\)/.test(src));
// the role save never touches participation and vice versa
assert(!/Officer='\$\{part/.test(src));
// login stats: an explicitly marked test account is excluded
assert(/COALESCE\(IsTest,'N'\)='Y' LIMIT 1/.test(src));
// version bump (golden rule)
assert(/const APP_VERSION = '20261006\.2';/.test(src));
console.log('ok');
