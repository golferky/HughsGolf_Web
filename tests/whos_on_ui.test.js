// Who's On screen: renderer, nav/section wiring, check-in at login, test accounts hidden by default.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const c = vm.createContext({});
['whosonAgeText', 'whosonRender'].forEach(n => vm.runInContext(extract(n), c));
const data = {
  people: [
    { player: 'Alice Player', role: 'player', participates: true, isTest: false, online: true, secondsAgo: 20, tab: 'skins', device: 'Mac/Chrome', ip: '10.0.0.5', otherPlayersOnIp: ['Bob Player'], knownIps: 2 },
    { player: 'Bob Player', role: 'player', participates: true, isTest: false, online: false, secondsAgo: 1500, tab: 'home', device: 'iPhone/Safari', ip: '10.0.0.5', otherPlayersOnIp: ['Alice Player'], knownIps: 1 },
    { player: 'Adam Admin', role: 'admin', participates: false, isTest: false, online: true, secondsAgo: 5, tab: 'admin', device: 'Mac/Safari', ip: '192.0.2.7', otherPlayersOnIp: [], knownIps: 1 },
    { player: 'Tess Test', role: 'player', participates: true, isTest: true, online: true, secondsAgo: 5, tab: 'home', device: 'Mac/Chrome', ip: '198.51.100.4', otherPlayersOnIp: [], knownIps: 1 },
    { player: '<b>Evil</b>', role: 'player', participates: true, isTest: false, online: true, secondsAgo: 5, tab: '<i>x</i>', device: '', ip: '1.1.1.1', otherPlayersOnIp: [], knownIps: 1 }],
  connections: [{ ip: '10.0.0.5', count: 2, players: ['Alice Player', 'Bob Player'], unknown: false }, { ip: '45.33.14.197', count: 1, players: [], unknown: true }] };
let out = c.whosonRender(data);
assert(/Alice Player/.test(out.people) && /Bob Player/.test(out.people) && /Adam Admin/.test(out.people), 'real accounts shown');
assert(!/Tess Test/.test(out.people), 'test accounts are hidden by default');
assert(/Tess Test/.test(c.whosonRender(data, { showTest: true }).people) && /\(test\)/.test(c.whosonRender(data, { showTest: true }).people), 'optional: show test accounts');
assert(/\(admin\)/.test(out.people) && /\(not playing\)/.test(out.people), 'role and participation are shown independently');
assert(/● on now/.test(out.people) && /○ 25m ago/.test(out.people), 'on now vs last seen');
assert(/skins/.test(out.people) && /Mac\/Chrome/.test(out.people) && /10\.0\.0\.5/.test(out.people), 'tab, device, IP');
assert(/Bob Player/.test(out.people.match(/Alice Player[\s\S]*?<\/tr>/)[0]) && /\(2 IPs\)/.test(out.people), 'also seen on this IP, and how many IPs a player has used');
assert(!/<b>Evil/.test(out.people) && /&lt;b&gt;Evil/.test(out.people) && !/<i>x/.test(out.people), 'names and tabs are escaped');
// summary counts only the shown people; test accounts do not count as on now
assert(/>3<\/div><div[^>]*>On now/.test(out.summary.replace(/\s+/g, ' ')), 'on now = Alice, Adam, Evil (not the test account)');
assert(/>3<\/div><div[^>]*>Open connections/.test(out.summary) && /Unknown IPs/.test(out.summary) && />1<\/div><div[^>]*>Unknown IPs/.test(out.summary));
assert(/unknown/.test(out.connections) && /Alice Player, Bob Player/.test(out.connections) && /45\.33\.14\.197/.test(out.connections));
// empty states
const empty = c.whosonRender({ people: [], connections: [] });
assert(/Nobody has checked in yet/.test(empty.people) && /No open connections reported/.test(empty.connections));
// age text
[[null, 'unknown'], [10, 'just now'], [300, '5m ago'], [7200, '2h ago'], [200000, '2d ago']].forEach(([s, e]) => assert.strictEqual(c.whosonAgeText(s), e));
// wiring: button, section, lists, loader, routes, login check-in, logout stops it, version
assert(/id="adminBtnWhoson"/.test(src) && /id="adminWhoson"/.test(src) && /id="whosonShowTest"/.test(src));
assert(/const ADMIN_SECTIONS = \[[^\]]*'whoson'/.test(src) && /logging: \[[^\]]*'whoson'/.test(src));
assert(/if \(section==='whoson'\)\s+loadWhoson\(\);\s*\n\s*else stopWhosonRefresh\(\);/.test(src));
assert(/startHeartbeat\(\);\s*\/\/ Who's On/.test(src), 'check in at login');
assert(/clearInterval\(window\._heartbeatTimer\)/.test(src), 'stops at logout');
assert(/'\/heartbeat', '\/whos-on'/.test(src), 'known server routes');
assert(/!currentUser\?\.name \|\| \(document\.hidden && !login\)/.test(src), 'no check-in when nobody is logged in or the tab is hidden (except at login)');
assert(/HEARTBEAT_MS = 60000/.test(src));
assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]) && src.match(/const APP_VERSION = '([^']+)';/)[1] >= '20261006.4');
console.log('ok');
