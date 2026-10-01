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
// post-season grid: the player column fits name + Paid + Sub, but the TOTAL width must not grow past what fit before (1098px
// with a 170px player column), or the right-hand columns (Hdcp) are cut off / need horizontal scrolling
const cols = src.match(/if \(isPostSeason\) \{[^}]*?cg\.innerHTML = ([\s\S]*?);\n  \} else/)[1];
const player = +cols.match(/width:(\d+)px/)[1];
assert(player >= 190, 'player column wide enough for name + Paid + Sub: ' + player);
const total = player + 18 * 38 + 48 * 2 + 52 + 48 + 48;
assert(total <= 1130, 'post-season grid total width ' + total + 'px would overflow a ~1140px viewport');
console.log('ok');
