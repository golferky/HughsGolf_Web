// The Score Entry player cell (name + Paid + CTP #hole + Sub badges) must not paint over the first hole's score cell.
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
// the sticky player cell clips anything that would spill into the next column
const css = src.match(/\.eg-player \{[^}]*\}/)[0];
assert(/overflow:\s*hidden/.test(css), '.eg-player clips overflow');
// both the sub row and the regular-player row let badges wrap onto a second line instead of overflowing
const rows = [...src.matchAll(/playerTd\.innerHTML = `\s*<div style="display:flex;([^"]*)"/g)].map(m => m[1]);
assert.strictEqual(rows.length, 2, 'sub and regular player cells');
rows.forEach(r => assert(/flex-wrap:wrap/.test(r), 'badge row wraps: ' + r));
// post-season player column is wide enough for name + Paid + #hole + Sub on one line (a 170px column overflowed)
const w = +src.match(/if \(isPostSeason\) \{[^}]*?cg\.innerHTML = '<col style="width:(\d+)px">/s)[1];
assert(w >= 240, 'post-season player column width ' + w);
console.log('ok');
