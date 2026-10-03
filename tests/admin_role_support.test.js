// Officer='Admin' must give admin privileges at login, show as "Admin" on the Players list, and not be demoted by Edit Player.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
const app = fs.readFileSync(__dirname + '/../app.py', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const c = vm.createContext({});
['roleFromOfficerValue', 'playerRoleLabel', 'playerRoleCellHtml', 'officerSelectValue'].forEach(n => vm.runInContext(extract(n), c));
const role = o => vm.runInContext('roleFromOfficerValue', c)(o);
for (const [o, r] of [['Admin', 'admin'], ['admin', 'admin'], [' ADMIN ', 'admin'], ['President', 'admin'], ['Secretary', 'admin'], ['Developer', 'developer'], ['developer', 'developer'], ['', 'player'], [null, 'player'], ['Treasurer', 'player']])
  assert.strictEqual(role(o), r, String(o));
const label = c.playerRoleLabel;
assert.strictEqual(label('Admin').text, 'Admin'); assert.strictEqual(label('Admin').legacy, '');
assert.strictEqual(label('Secretary').text, 'Admin'); assert.strictEqual(label('Secretary').legacy, 'Secretary');
assert.strictEqual(label('developer').text, 'Developer'); assert.strictEqual(label('').text, 'Player');
assert(/>Admin<\/span>/.test(c.playerRoleCellHtml('Admin')));
assert(/\(Secretary\)/.test(c.playerRoleCellHtml('Secretary')));
assert(!/<b>/.test(c.playerRoleCellHtml('Secretary<b>')), 'legacy title is escaped');
assert.strictEqual(c.officerSelectValue('Secretary'), 'admin');
assert.strictEqual(c.officerSelectValue('Admin'), 'admin');
assert.strictEqual(c.officerSelectValue('Developer'), 'developer');
assert.strictEqual(c.officerSelectValue(''), '');
// wiring
const ls = src.slice(src.indexOf('function loginSuccess('));
assert(/role: roleFromOfficerValue\(officer\)/.test(ls.slice(0, 3000)), 'loginSuccess uses the shared rule');
assert(/const role = roleFromOfficerValue\(officerKey\);/.test(src), 'trusted login uses the shared rule');
assert(/>Role<\/th>/.test(src) && /playerRoleCellHtml\(r\.Officer\)/.test(src), 'Players list shows a Role column');
assert(/pmOfficer'\)\.value = officerSelectValue\(r\.Officer\)/.test(src), 'Edit Player loads the level, not the raw title');
assert(/LOWER\(COALESCE\(Officer,''\)\) IN \('admin','secretary','president'\)/.test(app), 'need-sub CC includes Admin');
assert(/LOWER\(COALESCE\(Officer, ''\)\) NOT IN \('developer', 'admin', 'president', 'secretary'\)/.test(app), 'idle cleanup spares Admin');
console.log('ok');
