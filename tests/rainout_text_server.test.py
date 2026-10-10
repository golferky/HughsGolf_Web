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

# ── point-person mode ──
c = sqlite3.connect(app.DB_PATH)
c.executescript("""INSERT INTO Players (Player, Phone, CellCarrier, Email, ContactMethod) VALUES ('Point Pat','502-555-0201','verizon','',''), ('Mem Ann','502-555-0202','verizon','',''), ('Mem Bob','502-555-0203','att','',''), ('Mem Cy','','','',''),
  ('Alone Al','502-555-0204','verizon','','');""")
c.commit(); c.close()
sent_to.clear()
groups = [{'point': 'Point Pat', 'members': ['Mem Ann', 'Mem Bob', 'Mem Cy']}, {'point': 'Ghost', 'members': ['Mem Ann']}, {'point': 'Alone Al', 'members': []}]
pb = {'groups': groups, 'message': 'Rain out tonight', 'date': '20261020', 'players': ['ignored']}
j = post(pb).get_json()
assert j['ok'] and j['sent'] == ['Point Pat'] and [f['player'] for f in j['failed']] == ['Ghost'], j   # empty group dropped; players ignored
assert len(sent_to) == 1 and sent_to[0][0] == '5025550201@vtext.com'
t = sent_to[0][1]; assert "You're the point person for Mem Ann, Mem Bob, Mem Cy" in t and 'tick off who you told' in t
ptok = re.search(r'/r/([0-9a-f]{16})', t).group(1)
rows = cl.get('/rainout-status?date=20261020', headers=H).get_json()['rows']
assert rows == [{'player': 'Point Pat', 'sentAt': rows[0]['sentAt'], 'confirmedAt': '', 'kind': 'point', 'members': ['Mem Ann', 'Mem Bob', 'Mem Cy'], 'told': []}], rows
# the point person's page lists the foursome with text/call links; GET changes nothing
page = cl.get(f'/r/{ptok}').data.decode()
assert 'Mem Ann' in page and 'sms:+15025550202' in page and 'tel:+15025550203' in page and 'I told Mem' in page and 'Got it' in page
assert cl.get('/rainout-status?date=20261020', headers=H).get_json()['rows'][0]['told'] == []
# tick off who was told (only foursome members count); Got it confirms the point person
cl.post(f'/r/{ptok}', data={'told': 'Mem Ann'}); cl.post(f'/r/{ptok}', data={'told': 'Somebody Else'})
page = cl.post(f'/r/{ptok}').data.decode()
r0 = cl.get('/rainout-status?date=20261020', headers=H).get_json()['rows'][0]
assert r0['told'] == ['Mem Ann'] and r0['confirmedAt'] and '✓ told' in page and 'you are confirmed' in page.lower()
# sending a direct (non-point) notice to the same person the same night is a separate link
sent_to.clear(); post({'players': ['Point Pat'], 'message': 'Rain out tonight', 'date': '20261020'})
assert re.search(r'/r/([0-9a-f]{16})', sent_to[0][1]).group(1) != ptok
# test in point mode: only the officer, with the first foursome's members
sent_to.clear(); j = post({**pb, 'test': True}).get_json()
assert j['sent'] == ['Boss Admin'] and sent_to[0][1].startswith('TEST: ') and 'point person for Mem Ann, Mem Bob, Mem Cy' in sent_to[0][1]
# standing point-people list: officers only, replace-all
assert cl.get('/rainout-point-people').status_code == 403
assert cl.post('/rainout-point-people', json={'players': ['Point Pat', 'Mem Bob']}, headers=H).get_json()['players'] == ['Mem Bob', 'Point Pat']
assert cl.post('/rainout-point-people', json={'players': ['Mem Cy']}, headers=H).get_json()['players'] == ['Mem Cy']
print('ok point')
