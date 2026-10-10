// Every day the app is versioned needs a changelog entry (ensureVersion with that date) — keeps the Changelog tab from falling behind.
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
const ver = src.match(/const APP_VERSION = '([^']+)';/)[1], day = ver.split('.')[0];
const have = [...src.matchAll(/ensureVersion\('(\d{8})(?:\.\d+)?'/g)].map(m => m[1]);
assert(have.includes(day), `no ensureVersion changelog entry for ${day} (APP_VERSION ${ver})`);
for (const d of ['20261007', '20261008', '20261009', '20261010']) assert(have.includes(d), 'entry for ' + d);
console.log('ok');
