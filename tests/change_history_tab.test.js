// League tab for the release list is called Change History (the Admin page that adds entries keeps the name Changelog).
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../HughsGolf.html', 'utf8');
assert(/<div class="tab" data-tab="whatsnew">🆕 Change History<\/div>/.test(src), 'tab label');
assert(/margin-bottom:4px">📋 Change History<\/div>/.test(src), 'page title');
assert(!/data-tab="whatsnew">[^<]*Changelog/.test(src), 'old tab name gone');
assert(/id="adminBtnChangelog" class="admin-subbtn">📝 Changelog<\/button>/.test(src) && /shows on League ▸ Change History/.test(src), 'admin entry form keeps its name and says where entries show');
console.log('ok');
