"""Rainout notice: officers only, one individual text per player with a one-tap confirm link, test-to-me, status, public confirm page."""
import sys; sys.dont_write_bytecode = True
import os, re, sqlite3, tempfile, importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
tmp = tempfile.mkdtemp(); app.DB_PATH = os.path.join(tmp, 'HughsGolf.db')
c = sqlite3.connect(app.DB_PATH)
c.executescript("""
CREATE TABLE Players (Player TEXT, Phone TEXT, CellCarrier TEXT, Email TEXT, ContactMethod TEXT);
CREATE TABLE LogTable (log_time TEXT, level TEXT, method TEXT, source TEXT, text TEXT, details TEXT, created_at TEXT);
INSERT INTO Players VALUES ('Cell One','502-555-0101','verizon','',''), ('Mail Only','','','m@x.com','email'),
  ('Prefers Email','502-555-0102','att','pe@x.com','email'), ('No Contact','','','',''), ('Fallback','','','fb@x.com',''),
  ('Boss Admin','502-555-0199','att','boss@x.com','');
""")
c.commit(); c.close()
app.ensure_schema()
cl = app.app.test_client(); H = {'X-Save-Token': app.SAVE_TOKEN, 'X-Actor': 'Boss Admin', 'X-Actor-Role': 'admin'}
PUB = {'base_url': 'https://hughsgolf.example.org'}
body = {'players': ['Cell One', 'Mail Only', 'Prefers Email', 'No Contact', 'Fallback', 'Ghost'], 'message': 'Rain out tonight', 'date': '20261013'}
post = lambda b, h=H, **kw: cl.post('/send-rainout-text', json=b, headers=h, **{**PUB, **kw})
assert post(body, h={}).status_code == 403
assert post(body, h={**H, 'X-Actor-Role': 'player'}).status_code == 403
assert post({'players': [], 'message': 'x', 'date': '20261013'}).status_code == 400
assert post({**body, 'date': ''}).status_code == 400
# the confirm link must work on players' phones: refuse a home-network address for a real send
r = post(body, base_url='http://192.168.1.176:8446'); assert r.status_code == 400 and 'public address' in r.get_json()['error']

sent_to = []
app._send_mail = lambda addrs, subj, text: (sent_to.append((addrs[0], text)) or True)
# sandbox: players are never really texted, but the result says who would get it
assert 'sandbox' in app.VERSION.lower()
j = post(body).get_json()
assert j['ok'] and j['simulated'] and not sent_to
assert j['sent'] == ['Cell One', 'Mail Only', 'Prefers Email', 'Fallback'] and [f['player'] for f in j['failed']] == ['No Contact', 'Ghost'], j
# a test goes to the logged-in officer only, really sent even in the sandbox, with its own link and a TEST prefix
j = post({**body, 'test': True}).get_json()
assert j['test'] and not j['simulated'] and j['sent'] == ['Boss Admin'] and len(sent_to) == 1
assert sent_to[0][0] == '5025550199@txt.att.net' and sent_to[0][1].startswith('TEST: Rain out tonight')
tlink = re.search(r'/r/([0-9a-f]{16})', sent_to[0][1]).group(1)
sent_to.clear()
# live: real, individual sends (gateway for texters, email for email-only / no-cell), each with its own confirm link
app.VERSION = '20261010.6'
j = post(body).get_json()
assert not j['simulated'] and j['sent'] == ['Cell One', 'Mail Only', 'Prefers Email', 'Fallback']
assert [a for a, _ in sent_to] == ['5025550101@vtext.com', 'm@x.com', 'pe@x.com', 'fb@x.com'], sent_to
toks = [re.search(r'https://hughsgolf\.example\.org/r/([0-9a-f]{16})', t).group(1) for _, t in sent_to]
assert len(set(toks)) == 4 and all(t.startswith('Rain out tonight Please tap to confirm - no need to reply:') for _, t in sent_to)
# status: nobody confirmed yet (the test row is not counted)
st = lambda: cl.get('/rainout-status?date=20261013', headers=H).get_json()['rows']
assert [r['player'] for r in st()] == ['Cell One', 'Fallback', 'Mail Only', 'Prefers Email'] and not any(r['confirmedAt'] for r in st())
assert cl.get('/rainout-status?date=20261013').status_code == 403
# public page: GET only shows (never confirms), POST confirms; bad link is a 404
assert cl.get('/r/nope').status_code == 404
page = cl.get(f'/r/{toks[0]}'); assert page.status_code == 200 and b'Got it' in page.data and not any(r['confirmedAt'] for r in st())
page = cl.post(f'/r/{toks[0]}'); assert b'You are confirmed' in page.data
assert [r['player'] for r in st() if r['confirmedAt']] == ['Cell One']
assert b'You are confirmed' in cl.get(f'/r/{toks[0]}').data
# text again to the rest: same links are reused, so the confirmation stays
sent_to.clear()
j = post({**body, 'players': ['Fallback', 'Mail Only', 'Prefers Email']}).get_json()
assert [re.search(r'/r/([0-9a-f]{16})', t).group(1) for _, t in sent_to] == [toks[3], toks[1], toks[2]] and [r['player'] for r in st() if r['confirmedAt']] == ['Cell One']
assert sqlite3.connect(app.DB_PATH).execute("SELECT COUNT(*) FROM LogTable WHERE method='rainout_confirmed'").fetchone()[0] == 1
print('ok')
