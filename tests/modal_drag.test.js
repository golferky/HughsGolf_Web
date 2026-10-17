// Popups can be moved by their title strip (real browser; skipped without it).
const fs = require('fs'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
assert(/function popupDragClamp\(/.test(src) && /pointerType === 'touch'/.test(src));
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
(async () => {
  if (!chromium || !fs.existsSync('/opt/pw-browsers/chromium')) { console.log('ok (browser part skipped)'); return; }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1000, height: 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  await p.route('**/*', async r => { const u = r.request().url(); if (u === 'http://t/HughsGolf.html') return r.fulfill({ body: src, contentType: 'text/html' });
    if (u.startsWith('http://t/vendor/sqljs/')) return r.fulfill({ body: fs.readFileSync(path.join(__dirname, '..', u.replace('http://t/', ''))), contentType: u.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    return r.abort(); });
  await p.goto('http://t/HughsGolf.html'); await p.waitForFunction(() => typeof popupDragClamp === 'function');
  await p.evaluate(() => { const o = document.getElementById('loginOverlay'); if (o) o.style.display = 'none'; });
  // a popup built like the app's: a dimmed full-screen layer (with a click-to-close attribute) holding a centred card
  await p.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', `<div id="tOverlay" onclick="if(event.target===this)this.remove()" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center">
      <div id="tCard" style="background:white;border-radius:12px;padding:24px;width:400px"><div id="tTitle" style="font-size:18px;font-weight:700;margin-bottom:16px">Edit Player</div>
      <input id="tInput" value="hello" style="width:100%;padding:8px"><div id="tBody" style="height:300px">body</div><button id="tBtn">Save</button></div></div>`);
  });
  const rect = id => p.evaluate(id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) }; }, id);
  const r0 = await rect('tCard'), tr = await rect('tTitle');
  // drag by the title: the card follows the mouse
  await p.mouse.move(tr.x + 20, tr.y + 10); await p.mouse.down(); await p.mouse.move(tr.x + 120, tr.y + 60, { steps: 5 }); await p.mouse.up();
  let r1 = await rect('tCard'); assert.deepStrictEqual([r1.x - r0.x, r1.y - r0.y], [100, 50], 'moved with the mouse'); assert.strictEqual(await p.evaluate(() => !!document.getElementById('tOverlay')), true, 'a drag does not close the popup');
  // a second drag continues from where it was left
  await p.mouse.move(tr.x + 120, tr.y + 60); await p.mouse.down(); await p.mouse.move(tr.x + 70, tr.y + 60, { steps: 3 }); await p.mouse.up();
  assert.strictEqual((await rect('tCard')).x - r0.x, 50, 'continues from the new place');
  // not from a field, a button, or below the title strip
  const before = await rect('tCard'), inp = await rect('tInput'), body = await rect('tBody');
  await p.mouse.move(inp.x + 20, inp.y + 5); await p.mouse.down(); await p.mouse.move(inp.x + 220, inp.y + 105, { steps: 3 }); await p.mouse.up();
  await p.mouse.move(body.x + 20, body.y + 100); await p.mouse.down(); await p.mouse.move(body.x + 220, body.y + 200, { steps: 3 }); await p.mouse.up();
  assert.deepStrictEqual(await rect('tCard'), before, 'only the title strip moves it');
  // it cannot be dragged off the screen
  const t2 = await rect('tTitle'); await p.mouse.move(t2.x + 10, t2.y + 5); await p.mouse.down(); await p.mouse.move(t2.x + 4000, t2.y - 4000, { steps: 4 }); await p.mouse.up();
  const off = await rect('tCard'); assert(off.y >= 0 && off.x <= 1000 - 80 && off.r >= 80, JSON.stringify(off));
  await p.mouse.move(off.x + 10, off.y + 5); await p.mouse.down(); await p.mouse.move(off.x - 4000, off.y + 4000, { steps: 4 }); await p.mouse.up();
  const off2 = await rect('tCard'); assert(off2.r >= 80 && off2.y <= 800 - 40, JSON.stringify(off2));
  // clicking the dimmed layer still closes it; the card keeps working otherwise
  await p.evaluate(() => document.getElementById('tOverlay').remove());
  assert.strictEqual(await p.evaluate(() => popupCardFor(document.body)), null, 'no popup, nothing to drag');
  // the clamp itself
  assert.deepStrictEqual(await p.evaluate(() => popupDragClamp({ left: 300, right: 700, top: 100, bottom: 500 }, -5000, -5000)), [-620, -100]);
  assert.deepStrictEqual(await p.evaluate(() => popupDragClamp({ left: 300, right: 700, top: 100, bottom: 500 }, 5000, 5000)), [620, 660]);
  assert.deepStrictEqual(errs, [], errs.join('; '));
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
