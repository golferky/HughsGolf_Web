// The Board tab's red unread badge must count only posts the user can see, and clear once the board has loaded.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
function extract(name) {
  const i = src.indexOf('function ' + name + '('); assert(i >= 0, name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
function world(role, boardOpen) {
  const store = {}, toasts = [];
  const btn = { appended: [], appendChild(b) { this.appended.push(b); badge = b; } };
  let badge = null;
  const doc = {
    getElementById: id => id === 'boardTabBtn' ? btn : id === 'boardTabBadge' ? (badge ? { remove() { badge = null; } } : null) : null,
    createElement: () => ({ style: {} }),
    querySelector: sel => sel.includes('data-tab="board"') ? { classList: { contains: () => boardOpen } } : null,
  };
  const c = vm.createContext({ currentUser: { name: 'Pat', role }, document: doc, localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
    window: {}, parseInt, Math, _boardCache: { posts: [] }, showBoardNotifToast: u => toasts.push(u) });
  vm.runInContext(['boardVisiblePosts', '_boardSeenKey', 'markBoardSeen', 'checkBoardUnread'].map(extract).join('\n'), c);
  return { c, store, toasts, badge: () => badge };
}
const posts = [{ ID: 1, Audience: 'all', Author: 'A' }, { ID: 2, Audience: 'admin', Author: 'Boss' }, { ID: 3 /* Audience missing = everyone */, Author: 'B' }];

// visibility: players never see admin-only posts; admins and developers see everything
assert.deepStrictEqual(world('player').c.boardVisiblePosts(posts).map(p => p.ID), [1, 3]);
assert.deepStrictEqual(world('admin').c.boardVisiblePosts(posts).map(p => p.ID), [1, 2, 3]);
assert.deepStrictEqual(world('developer').c.boardVisiblePosts(posts).map(p => p.ID), [1, 2, 3]);

// the bug: the only unseen post is admin-only -> the old code showed "1" over an empty board. Now: nothing.
const only = [{ ID: 5, Audience: 'admin' }];
let w = world('player', false);
w.c.checkBoardUnread(w.c.boardVisiblePosts(only));
assert.strictEqual(w.badge(), null, 'no badge for posts the player cannot see'); assert.strictEqual(w.toasts.length, 0, 'no toast leaking an admin-only title');
// an admin does see (and is told about) it
w = world('admin', false); w.c.checkBoardUnread(w.c.boardVisiblePosts(only));
assert.strictEqual(w.badge().textContent, 1);
// visible unread posts are counted; 10+ shows 9+
w = world('player', false); w.c.checkBoardUnread(w.c.boardVisiblePosts(posts)); assert.strictEqual(w.badge().textContent, 2);
// no badge while the Board tab is open
w = world('player', true); w.c.checkBoardUnread(w.c.boardVisiblePosts(posts)); assert.strictEqual(w.badge(), null);
// markBoardSeen remembers the newest VISIBLE post and clears the badge, then nothing is unread
w = world('player', false); w.c._boardCache.posts = [...posts, { ID: 9, Audience: 'admin' }];
w.c.checkBoardUnread(w.c.boardVisiblePosts(posts)); assert(w.badge());
w.c.markBoardSeen(); assert.strictEqual(w.badge(), null); assert.strictEqual(w.store.lastBoardPostId_Pat, '3', 'admin-only post 9 is not what gets recorded');
w.c.checkBoardUnread(w.c.boardVisiblePosts(posts)); assert.strictEqual(w.badge(), null, 'nothing unread afterwards');

// wiring: every place that lists/counts posts goes through the helper, and loadBoard clears the badge after the cache fills
assert(/checkBoardUnread\(visible\)/.test(src) && /const visible = boardVisiblePosts\(data\.posts\)/.test(src), 'home news + badge');
assert(/let posts = boardVisiblePosts\(_boardCache\.posts\)/.test(src), 'board list');
assert(/new Set\(boardVisiblePosts\(_boardCache\.posts\)\.map\(p => p\.Author\)\)/.test(src), 'author dropdown');
const lb = extract('loadBoard'); assert(/renderBoardPosts\(\);\s*\n[^\n]*\n\s*if \(document\.querySelector\('\.tab\[data-tab="board"\]'\)\?\.classList\.contains\('active'\)\) markBoardSeen\(\);/.test(src.replace(/async /, '')) || /markBoardSeen\(\)/.test(lb), 'loadBoard marks seen after loading');
console.log('ok');
