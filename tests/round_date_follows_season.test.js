// A Round date in an earlier season must put each tab's Season box on that year (the tabs open on the newest season, whose week list has no such date).
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
function world(playDate) {
  const els = {}, calls = [];
  ['stablefordSeason', 'matchesSeason', 'skinsSeason', 'ctpsSeason', 'sfStandingsSeason', 'matchesDate'].forEach(id => els[id] = { id, value: '', options: [], set innerHTML(h) { this.options = [...h.matchAll(/value="(\d+)"/g)].map(m => ({ value: m[1] })); }, addEventListener() {} });
  const c = vm.createContext({ Array, String, els, calls, window: { _playDate: playDate }, db: {},
    document: { getElementById: id => els[id] || null, querySelectorAll: () => [] },
    query: sql => /DISTINCT Season/.test(sql) ? [{ Season: 2027 }, { Season: 2026 }, { Season: 2025 }].map(r => r) : /MAX\(Season\)/.test(sql) ? [{ s: 2027 }] : [],
    populateStablefordDateDropdown: () => calls.push('sf:' + els.stablefordSeason.value), populateMatchesDateDropdown: () => calls.push('matches:' + els.matchesSeason.value),
    populateSkinsDateDropdown: () => calls.push('skins:' + els.skinsSeason.value), populateCtpsDateDropdown: () => calls.push('ctps:' + els.ctpsSeason.value), loadMatches() {} });
  ['playDateFollowSeason', 'loadStablefordTab', 'initMatchesDate', 'initSkinsTab', 'loadCtpsTab'].forEach(f => vm.runInContext(extract(f), c));
  return { c, els, calls };
}
for (const [fn, season, tag] of [['loadStablefordTab', 'stablefordSeason', 'sf'], ['initMatchesDate', 'matchesSeason', 'matches'], ['initSkinsTab', 'skinsSeason', 'skins'], ['loadCtpsTab', 'ctpsSeason', 'ctps']]) {
  let w = world('20261006'); w.c[fn](); assert.strictEqual(String(w.els[season].value), '2026', fn + ': follows the Round date\'s year'); assert(w.calls.includes(tag + ':2026'), fn + ': the week list is built for 2026');
  w = world(null); w.c[fn](); assert.strictEqual(String(w.els[season].value), '2027', fn + ': no shared date: the newest season');
  w = world('20300101'); w.c[fn](); assert.strictEqual(String(w.els[season].value), '2027', fn + ': a year that is not in the list is ignored');
}
// Stableford standings: follow only when asked (the Round date changed), never when the Season box itself changed
const sfBody = extract('loadSfStandings');
assert(/function loadSfStandings\(followDate\)/.test(sfBody) && /if \(followDate === true\) playDateFollowSeason\(seasonSel\);/.test(sfBody));
assert(/loadStablefordTab\(\); loadSfStandings\(true\);/.test(src), 'a Round date change refreshes the SF standings with it');
assert(/<select id="sfStandingsSeason" onchange="loadSfStandings\(\)">/.test(src), 'the box\'s own change does not follow the date');
console.log('ok');
