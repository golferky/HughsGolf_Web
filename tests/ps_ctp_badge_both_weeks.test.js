// Post-season scorecard: CTP badges / CTP holes cover BOTH weeks (Week 2's winners used to be missing).
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
const i = src.indexOf('const ctpDateFilter = isPostSeason'); assert(i > 0, 'ctpDateFilter exists');
const block = src.slice(i, i + 1500);
assert(/Date IN \(\$\{ps\.week1\},\$\{ps\.week2\}\)/.test(block) && /: `Date=\$\{date\}`/.test(block), 'post season: both dates; regular season: the night');
assert(/ctpHoles = query\(`SELECT DISTINCT Detail FROM Payments WHERE \$\{ctpDateFilter\}/.test(block), 'CTP holes use the filter');
assert(/query\(`SELECT Player, Detail FROM Payments WHERE \$\{ctpDateFilter\} AND "Desc"='CTP'/.test(block), 'CTP badges use the filter');
assert(!/WHERE Date=\$\{date\} AND "Desc"='CTP' AND Detail LIKE '#%' AND Player != 'Kitty'/.test(src), 'old single-date badge query is gone');
// the filter's SQL really matches a Week 2 CTP row and not another season's
const ps = { week1: 20260929, week2: 20261006 };
const rows = [{ D: 20260929, P: 'Brad' }, { D: 20261006, P: 'Greg' }, { D: 20260915, P: 'Old' }];
assert.deepStrictEqual(rows.filter(r => [ps.week1, ps.week2].includes(r.D)).map(r => r.P), ['Brad', 'Greg']);
assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
console.log('ok');
