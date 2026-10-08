// Stats > Individual: the Avg Net row must use the SELECTED player/season rounds, not the previous selection's.
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
const i = src.indexOf('function loadStats');
assert(i >= 0 || true);
const setAt = src.indexOf('window._statsHistory = allHistory;');
const tableAt = src.indexOf("renderHoleTable('Front', 'statsFrontBody');");
const defAt = src.indexOf('function renderHoleTable(fb, containerId)');
assert(setAt > 0 && tableAt > 0 && defAt > 0);
assert(setAt < defAt && setAt < tableAt, 'the selected rounds are stored BEFORE the per-hole tables are built');
assert((src.match(/window\._statsHistory = allHistory;/g) || []).length === 1, 'set in one place only');
assert(/const histForFb = \(window\._statsHistory \|\| \[\]\)\.filter\(r => r\.FrontBack === fb\);/.test(src), 'net average still reads the stored rounds');
assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
console.log('ok');
