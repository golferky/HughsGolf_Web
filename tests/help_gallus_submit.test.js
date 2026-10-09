// Help: a how-to for group recorders (Gallus link -> Submit Round), and the officer Gallus help explains the two steps.
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
const a = src.indexOf("helpAccordionItem('help_gallus_submit'"); assert(a > 0, 'how-to exists');
const body = src.slice(a, src.indexOf("helpAccordionItem('help_standings'", a));
assert(/officerOnly|, true\)/.test(body) === false, 'visible to every player (not officer-only)');
['Add to Home Screen', 'Share Scores', '<strong>Copy</strong>', 'Submit Round', 'Submit to Admin', 'one link covers your whole group'.replace(/^o/, 'O')].forEach(t => assert(body.includes(t), t));
assert(src.indexOf("helpAccordionItem('help_gallus_submit'") < src.indexOf("helpAccordionItem('help_standings'"), 'sits with the player help items');
assert(/Two steps, on purpose/.test(src) && /only adds it to the queue: the scorecard is not touched/.test(src), 'officer help explains queue vs post');
assert(!/Send that link to an admin/.test(src), 'old "send the link to an admin" step replaced');
// the Submit Round button the how-to refers to is really on the Home tab
assert(/onclick="showGallusSubmit\(\)"[^>]*>📤 Submit Round<\/button>/.test(src));
assert(/^\d{8}\.\d+$/.test(src.match(/const APP_VERSION = '([^']+)';/)[1]));
console.log('ok');
