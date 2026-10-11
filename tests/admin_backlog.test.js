// Admin > Backlog: BACKLOG.md parsed into sections of open / done items, served to admins, uploaded by the deploy script.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, name); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } }
const plain = x => JSON.parse(JSON.stringify(x));
const ctx = vm.createContext({ String, escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') });
['parseBacklog', 'backlogInline'].forEach(f => vm.runInContext(extract(f), ctx));
const md = `# Title\n\nLast updated: 2026-10-11\n\n---\n\n## Section A *(target: 2027)*\n\n- [ ] **First item** — does a thing.\n  - sub one\n  - sub two\n    continued\n- [x] **Done item** — finished\n- [ ] Plain item without bold\n  more words\n\n---\n\n## Empty section\n\n## Section B\n- [ ] **B item**\n`;
const p = plain(ctx.parseBacklog(md));
assert.strictEqual(p.updated, '2026-10-11');
assert.deepStrictEqual(p.sections.map(s => s.title), ['Section A *(target: 2027)*', 'Section B'], 'empty sections are dropped');
assert.deepStrictEqual(p.sections[0].items[0], { done: false, title: 'First item', text: 'does a thing.', subs: ['sub one', 'sub two continued'] });
assert.strictEqual(p.sections[0].items[1].done, true);
assert.deepStrictEqual(p.sections[0].items[2], { done: false, title: 'Plain item without bold', text: 'more words', subs: [] });
assert.strictEqual(ctx.backlogInline('a **b** `c` <i>'), 'a <b>b</b> <code>c</code> &lt;i&gt;');
// the real file parses into something sensible, including the 2027 items added earlier
const real = plain(ctx.parseBacklog(fs.readFileSync(__dirname + '/../BACKLOG.md', 'utf8')));
const all = real.sections.flatMap(s => s.items);
assert(all.length > 20 && all.some(i => i.done) && all.some(i => !i.done));
['Voice score entry', 'Venmo ID for players', 'Preprinted scorecards'].forEach(t => assert(all.some(i => i.title === t), t));
// wiring
assert(/'backlog'\]/.test(src.match(/const ADMIN_SECTIONS = \[[^\]]*\]/)[0] + "'backlog']") && /ADMIN_SECTIONS = \[[^\]]*'backlog'/.test(src), 'section registered');
assert(/id="adminBtnBacklog"/.test(src) && /id="adminBacklog"/.test(src) && /if \(section==='backlog'\)\s+loadBacklog\(\)/.test(src));
const deploy = fs.readFileSync(__dirname + '/../deploy_qnap.sh', 'utf8');
assert(/cp BACKLOG\.md "\$TMP\/"/.test(deploy) && /scp -q [^\n]*"\$TMP\/BACKLOG\.md"/.test(deploy), 'deploy uploads BACKLOG.md');
console.log('ok');
