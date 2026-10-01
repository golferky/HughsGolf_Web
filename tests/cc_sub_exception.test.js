// Regression test: Howard Gorman is a League Championship (CC)-eligible SUB for the 2026 season only.
//  * ccRosterEligible is true for him in 2026 and false for any other season; other subs stay ineligible
//  * he is NOT added to the team roster (isSeasonRosterPlayer stays false) and the exception list is used nowhere else
//    (dues list, regular slots, roster queries are untouched); nothing is written
//  * the leaderboard treats him as eligible (a position, no "SUB · not CC") while other subs keep "SUB · not CC"
//  * no championship tie-break and no placement/payout change was added: equal nets still keep their input order
// Run: node tests/cc_sub_exception.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'HughsGolf.html'), 'utf8');
function extract(name) {
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, `function ${name} not found`);
  let i = html.indexOf('{', start), depth = 0;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start, i + 1);
}
const constLine = name => { const m = html.match(new RegExp(`const ${name} = [^;]*;`)); assert(m, name + ' not found'); return m[0]; };

// ---------------------------------------------------------------- eligibility
const roster = { 2026: ['Brad Pierce', 'Robby Lykes', 'Tom Jennings'], 2025: ['Brad Pierce', 'Robby Lykes', 'Tom Jennings'], 2027: ['Brad Pierce'] };
const writes = [], teamQueries = [];
function query(sql, params = []) {
  if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) writes.push(sql);
  if (/FROM Teams WHERE League=\? AND Year=\? AND Player=\?/.test(sql)) { teamQueries.push(params); return (roster[params[1]] || []).includes(params[2]) ? [{ 1: 1 }] : []; }
  return [];
}
const eligCtx = vm.createContext({ query, parseInt, String });
vm.runInContext([constLine('SUBS_CC_ELIGIBLE'), constLine('CC_SUB_EXCEPTIONS'), extract('isSeasonRosterPlayer'), extract('isCcSubException'), extract('ccRosterEligible')].join('\n'), eligCtx);
const elig = (p, s) => vm.runInContext(`ccRosterEligible(${JSON.stringify(p)}, ${JSON.stringify(s)})`, eligCtx);
const onRoster = (p, s) => vm.runInContext(`isSeasonRosterPlayer(${JSON.stringify(p)}, ${JSON.stringify(s)})`, eligCtx);

assert.strictEqual(elig('Howard Gorman', 2026), true, 'Howard is CC-eligible in 2026');
assert.strictEqual(elig('Howard Gorman', '2026'), true, 'season may arrive as a string');
assert.strictEqual(elig(' Howard Gorman ', 2026), true, 'stray spaces do not matter');
assert.strictEqual(elig('Howard Gorman', 2025), false, '2026 only (2025)');
assert.strictEqual(elig('Howard Gorman', 2027), false, '2026 only (2027)');
assert.strictEqual(elig('Howard Gorman', 2028), false);
assert.strictEqual(elig('Howard Gormann', 2026), false, 'exact name only');
assert.strictEqual(elig('Some Other Sub', 2026), false, 'other subs stay ineligible');
assert.strictEqual(elig('Robby Lykes', 2026), true, 'regular roster players are unchanged');
assert.strictEqual(elig('Robby Lykes', 2027), false, 'roster is per season (unchanged)');

// He stays a sub everywhere else: not on the roster, nothing written
assert.strictEqual(onRoster('Howard Gorman', 2026), false, 'NOT added to the team roster');
assert.strictEqual(writes.length, 0, 'nothing is written');
assert(!/INSERT INTO Teams[^`]*Howard/.test(html), 'no roster insert mentions him');
const codeMentions = html.split('\n').filter(l => /Howard Gorman/.test(l) && !/^const CC_SUB_EXCEPTIONS/.test(l) && !/Gallus import workflow/.test(l));   // (one old changelog sentence mentions him)
assert.deepStrictEqual(codeMentions, [], 'the name appears only in the exception list');

// The exception list is referenced ONLY by isCcSubException (not by dues, roster, slots, payouts ...)
const uses = [...html.matchAll(/CC_SUB_EXCEPTIONS/g)].map(m => m.index);
const fnAt = i => { const up = html.slice(0, i); let m, last = null; const re = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm; while ((m = re.exec(up))) last = m[1]; return last; };
assert.strictEqual(uses.length, 2, 'declared once and used once');
assert.strictEqual(fnAt(uses[1]), 'isCcSubException');
assert(/SUBS_CC_ELIGIBLE \|\| isSeasonRosterPlayer\(player, season\) \|\| isCcSubException\(player, season\)/.test(html));
// every consumer of CC eligibility goes through ccRosterEligible (no other eligibility path was added)
assert.strictEqual([...html.matchAll(/isCcSubException\(/g)].length, 2, 'isCcSubException: its definition and its one use');

// ---------------------------------------------------------------- leaderboard
const panel = { style: {}, innerHTML: '' };
let gridSeason = '2026';
const grid = { get dataset() { return { postSeasonSeason: gridSeason }; } };
const nine = { nums: Array.from({ length: 18 }, (_, i) => i + 1), hcps: Array.from({ length: 18 }, (_, i) => i + 1) };
const holes = gross => { const h = Array(18).fill(''); gross.forEach((v, i) => h[9 + i] = String(v)); return h; };
// nine back-9 scores with phdcp 0 -> Net = Gross: 34/35/35/35/36 and Gross ties broken nowhere
const slot = (name, sub, gross, phdcp = 0) => ({ regular: sub ? 'Regular ' + name : name, sub: sub ? name : null, phdcp, inSkins: true, holes: holes(gross) });
const g = total => { const a = Array(9).fill(4); let over = total - 36; for (let i = 0; i < over; i++) a[i] += 1; return a; };     // a 9-hole card totalling `total`
function render(states, season = '2026') {
  gridSeason = season;
  const entryState = {}; states.forEach((s, i) => { entryState['k' + i] = s; });
  const ctx = vm.createContext({
    document: { getElementById: id => id === 'psBreakdownPanel' ? panel : id === 'entryGrid' ? grid : null }, window: {}, entryState,
    parseInt, parseFloat, Math, Object, Array, String, Set, query, courseData: { all18: nine },
    getSeasonSettings: () => ({ SkinsPS: 7, ClosestPS: 3 }), psRefundPanelHtml: () => '',
  });
  vm.runInContext([constLine('SUBS_CC_ELIGIBLE'), constLine('CC_SUB_EXCEPTIONS'), extract('isSeasonRosterPlayer'), extract('isCcSubException'), extract('ccRosterEligible'),
    extract('psLeaderboardRanks'), extract('psLeaderboardShotsBack'), extract('psCcPrizeSchedule'), extract('psLeaderboardCcPotential'), extract('psWeekSkinPayout'), extract('getPostSeasonEntryTotals'), extract('renderPostSeasonBreakdown')].join('\n'), ctx);
  vm.runInContext('renderPostSeasonBreakdown(courseData.all18)', ctx);
  return panel.innerHTML;
}
// Row = the leaderboard grid line for a player (from the medal/position to the closing Net)
const rowOf = (out, name) => { const i = out.indexOf(name); assert(i >= 0, name + ' missing'); const s = out.lastIndexOf('<div style="display:grid', i); return out.slice(s, out.indexOf('</div>', i) + 6); };
const order = (out, names) => names.map(n => [n, out.indexOf(n)]).sort((a, b) => a[1] - b[1]).map(x => x[0]);

const states = [
  slot('Brad Pierce', false, g(37)),                 // Net 37
  slot('Robby Lykes', false, g(39)),                 // Net 39
  slot('Howard Gorman', true, g(41)),                // sub
  slot('Tom Jennings', false, g(42)),
  slot('Other Sub', true, g(43)),                    // another sub: stays ineligible
];
// Make nets equal for the three-way tie: phdcp 4/6/7 -> net 35 each
states[1].phdcp = 4; states[2].phdcp = 6; states[3].phdcp = 7; states[0].phdcp = 3;
let out = render(states);
const howard = rowOf(out, 'Howard Gorman'), other = rowOf(out, 'Other Sub');
assert(!/SUB · not CC/.test(howard), 'Howard is eligible: no "SUB · not CC" label');
assert(/SUB · not CC/.test(other), 'another sub keeps "SUB · not CC"');
assert(/🥇|🥈|🥉|\d+\./.test(howard.replace(/Howard Gorman[\s\S]*$/, '')) , 'Howard gets a championship position');
assert(/<span[^>]*text-align:center">—<\/span>/.test(other), 'the ineligible sub gets no position');
// positions count eligible players only; the three players level on net share 2nd (tied places), the sub is "—"
const positions = [...out.matchAll(/<span style="font-weight:700;text-align:center">([^<]+)<\/span>/g)].map(m => m[1]);
assert.deepStrictEqual(positions, ['🥇', '🥈T2', '🥈T2', '🥈T2', '—'], 'eligible players ranked 1,T2,T2,T2; the ineligible sub is "—"');
assert.strictEqual(positions.filter(p => p === '—').length, 1);
// shots back: own column with a header; leader "Leader", the others negative (-1), the sub blank
assert(/>Back<\/span>/.test(out), 'Back column header');
assert(/>CC \$<\/span>/.test(out), 'CC $ column header');
// fixture: Brad 1st ($100), three tied for 2nd split 2nd+3rd ($50+$25)/3 = $25, sub none
assert.strictEqual((out.match(/color:#1a4d1a" title="Potential League Championship prize at the current standings">\$100<\/span>/g) || []).length, 1);
assert.strictEqual((out.match(/standings">\$25<\/span>/g) || []).length, 3);
assert.strictEqual((out.match(/>Leader<\/span>/g) || []).length, 1);
assert.strictEqual((out.match(/title="Shots behind the leader">-1<\/span>/g) || []).length, 3, 'three players are -1');
assert(!/>\+\d/.test(out.replace(/<[^>]*>/g, m => '')), 'no positive shots back');

// In any other season he is a plain sub again
out = render(states, '2025');
assert(/SUB · not CC/.test(rowOf(out, 'Howard Gorman')), 'in 2025 Howard is a sub that is not CC-eligible');

// No tie-break was added: equal nets keep their INPUT order (reverse the input, the order reverses)
const tied = ['Robby Lykes', 'Howard Gorman', 'Tom Jennings'];
out = render(states);
const forward = order(out, tied);
out = render([states[0], states[3], states[2], states[1], states[4]]);
const reversed = order(out, tied);
assert.deepStrictEqual(forward, tied, 'equal nets are listed in input order');
assert.deepStrictEqual(reversed, [...tied].reverse(), 'reversing the input reverses the tied players: no tie-break rule exists');
const sortBlock = html.slice(html.indexOf('const leaderboard = [...lbPlayers]'), html.indexOf('const hasAnyScore'));
assert(/return a\.runNet - b\.runNet;/.test(sortBlock) && !/runGross\s*-|localeCompare|Gross/.test(sortBlock.replace(/runGross: .*/g, '')), 'the leaderboard comparator is unchanged (no tie-break)');

console.log('ok');
