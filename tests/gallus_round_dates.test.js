// Submit My Round: the date list includes the two post-season dates, and the default is the latest night on or before today.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
const plain = x => JSON.parse(JSON.stringify(x));
const ctx = vm.createContext({ String, Object, query: () => [{ sDate: '20260915' }, { sDate: '20260922' }, { sDate: '20260908' }],
  getSeasonSettings: () => ({ PostSeasonDt: '9/29/2026' }), parsePostSeasonDates: () => ({ week1: 20260929, week2: 20261006 }) });
['gallusRoundDates', 'gallusDefaultRoundDate'].forEach(n => vm.runInContext(extract(n), ctx));
const dates = plain(ctx.gallusRoundDates(2026));
assert.deepStrictEqual(dates.map(d => d.date), ['20260908', '20260915', '20260922', '20260929', '20261006'], 'schedule + both post-season dates, oldest first');
assert.strictEqual(dates[3].label, '09/29/2026 (Post Season Wk 1)'); assert.strictEqual(dates[4].label, '10/06/2026 (Post Season Wk 2)'); assert.strictEqual(dates[0].label, '09/08/2026');
assert.strictEqual(ctx.gallusDefaultRoundDate(dates, '20261009'), '20261006', 'after the post season, default to Week 2 (not the last regular night)');
assert.strictEqual(ctx.gallusDefaultRoundDate(dates, '20260930'), '20260929');
assert.strictEqual(ctx.gallusDefaultRoundDate(dates, '20260901'), '20260908', 'before the first night, the next one');
assert.strictEqual(ctx.gallusDefaultRoundDate([], '20261009'), '20261009');
const sub = extract('showGallusSubmit');
assert(/gallusRoundDates\(season\)/.test(sub) && /roundDates\.map\(r => `<option value="\$\{r\.date\}">\$\{r\.label\}<\/option>`\)/.test(sub), 'player dropdown uses the merged list');
assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
console.log('ok');
// A Week 2 Gallus card must open the post-season entry and be saved on Week 2's date, not Week 1's.
{
  const ctx2 = vm.createContext({ String, getPostSeasonContextForDate: d => (d === '20260929' || d === '20261006') ? { postSeasonDt: '9/29/2026' } : null, parsePostSeasonDates: () => ({ week1: 20260929, week2: 20261006 }) });
  vm.runInContext(extract('gallusEntryDateFor'), ctx2);
  assert.strictEqual(ctx2.gallusEntryDateFor('20261006'), '20260929', 'Week 2 card opens the (single) post-season entry');
  assert.strictEqual(ctx2.gallusEntryDateFor('20260929'), '20260929');
  assert.strictEqual(ctx2.gallusEntryDateFor('20260915'), '20260915', 'regular nights are unchanged');
  const imp = extract('importGallusEntry'); assert(/gallusEntryDateFor\(gi\.Date\)/.test(imp) && /o\.value === entryDateValue/.test(imp), 'queue import opens the right entry');
  const ver = extract('_doVerifyImport'); assert(/date: _gallusVerifyPlayers\[0\]\.date/.test(ver), 'the card date travels with the import');
  const cf = src.slice(src.indexOf('async function doGallusConfirm()'), src.indexOf('async function doGallusConfirm()') + 9000);
  assert(/isDatePostSeason\(String\(_gallusData\.date\)\)/.test(cf) && /const date = isPS \? psDate : document\.getElementById\('entryDate'\)\.value;/.test(cf), 'nine check and score write use the card date in post season');
}
console.log('ok2');
