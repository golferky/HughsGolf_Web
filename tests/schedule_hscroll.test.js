// Schedule Builder: the horizontal scrollbar is always visible and sits right under the table (legend moved below it).
const fs = require('fs'), assert = require('assert'), path = require('path');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
assert(/\.hscroll \{ overflow-x: scroll;/.test(src) && /\.hscroll::-webkit-scrollbar \{ height: 14px; \}/.test(src), 'always-visible scrollbar styling');
assert(/<div class="hscroll">\s*<div id="scheduleBuilder"><\/div>\s*<\/div>\s*<div id="scheduleLegend"><\/div>/.test(src), 'scroller holds only the table; the legend is outside it');
assert(/Scroll sideways to see every date/.test(src));
const fn = src.slice(src.indexOf('function loadScheduleBuilder()'), src.indexOf('function incrementRainouts'));
assert(/const legendHtml = `<div/.test(fn) && /getElementById\('scheduleLegend'\)/.test(fn) && !/html \+= `<div style="margin-top:12px;font-size:11px;display:flex/.test(fn), 'legend is no longer part of the scrolled html');
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) {}
(async () => {
  if (!chromium || !fs.existsSync('/opt/pw-browsers/chromium')) { console.log('ok (browser part skipped)'); return; }
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'], ignoreDefaultArgs: ['--hide-scrollbars'] });
  const p = await b.newPage();
  await p.route('**/*', r => r.request().url() === 'http://t/x.html' ? r.fulfill({ body: src, contentType: 'text/html' }) : r.abort());
  await p.goto('http://t/x.html');
  const r = await p.evaluate(() => { const d = document.createElement('div'); d.className = 'hscroll'; d.style.width = '300px'; d.innerHTML = '<div style="width:900px;height:20px"></div>'; document.body.appendChild(d); return { bar: d.offsetHeight - d.clientHeight, scrolls: d.scrollWidth > d.clientWidth }; });
  assert(r.scrolls && r.bar >= 12, 'a real, visible scrollbar takes space under the content: ' + JSON.stringify(r));
  await b.close(); console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
