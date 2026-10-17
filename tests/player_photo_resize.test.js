// A big phone picture becomes a centred 400 x 400 JPEG well under the server's size limit (needs the browser; skipped without it).
const fs = require('fs'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
assert(/PHOTO_MAX_BYTES = 300 \* 1024/.test(fs.readFileSync(__dirname + '/../app.py', 'utf8')));
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
(async () => {
  if (!chromium || !fs.existsSync('/opt/pw-browsers/chromium')) { console.log('ok (browser part skipped)'); return; }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  await p.route('**/*', async r => { const u = r.request().url(); if (u === 'http://t/HughsGolf.html') return r.fulfill({ body: src, contentType: 'text/html' });
    if (u.startsWith('http://t/vendor/sqljs/')) return r.fulfill({ body: fs.readFileSync(path.join(__dirname, '..', u.replace('http://t/', ''))), contentType: u.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    return r.abort(); });
  await p.goto('http://t/HughsGolf.html'); await p.waitForFunction(() => typeof photoToSquareJpeg === 'function');
  const shrink = (w, h) => p.evaluate(async ([w, h]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    for (let i = 0; i < 40; i++) { g.fillStyle = `hsl(${i * 9}, 70%, ${30 + i}%)`; g.fillRect(i * w / 40, 0, w / 40 + 1, h); }
    g.fillStyle = 'white'; g.fillRect(w / 2 - 50, h / 2 - 50, 100, 100);                                            // something in the middle
    const png = await new Promise(r => c.toBlob(r, 'image/png')), out = await photoToSquareJpeg(new File([png], 'x.png', { type: 'image/png' }));
    const bytes = new Uint8Array(await out.arrayBuffer()), bmp = await createImageBitmap(out);
    return { type: out.type, size: out.size, head: [...bytes.slice(0, 3)], w: bmp.width, h: bmp.height, inputBytes: png.size };
  }, [w, h]);
  for (const [w, h] of [[3000, 2000], [1000, 3000], [400, 400], [200, 300]]) {
    const r = await shrink(w, h);
    assert.deepStrictEqual([r.type, r.head, r.w, r.h], ['image/jpeg', [255, 216, 255], 400, 400], `${w}x${h}`);
    assert(r.size < 300 * 1024 && r.size > 500, `${w}x${h}: ${r.size} bytes`);
  }
  assert.deepStrictEqual(errs, [], errs.join('; '));
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
