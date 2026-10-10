"""/send-rainout-text: officers only, one text per player via gateway, email fallback, sandbox never really sends."""
import sys; sys.dont_write_bytecode = True
import os, sqlite3, tempfile, importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
tmp = tempfile.mkdtemp(); app.DB_PATH = os.path.join(tmp, 'HughsGolf.db')
c = sqlite3.connect(app.DB_PATH)
c.executescript("""
CREATE TABLE Players (Player TEXT, Phone TEXT, CellCarrier TEXT, Email TEXT, ContactMethod TEXT);
CREATE TABLE LogTable (log_time TEXT, level TEXT, method TEXT, source TEXT, text TEXT, details TEXT, created_at TEXT);
INSERT INTO Players VALUES ('Cell One','502-555-0101','verizon','',''), ('Mail Only','','','m@x.com','email'),
  ('Prefers Email','502-555-0102','att','pe@x.com','email'), ('No Contact','','','',''), ('Fallback','','','fb@x.com','');
""")
c.commit(); c.close()
cl = app.app.test_client(); H = {'X-Save-Token': app.SAVE_TOKEN, 'X-Actor': 'Boss', 'X-Actor-Role': 'admin'}
body = {'players': ['Cell One', 'Mail Only', 'Prefers Email', 'No Contact', 'Fallback', 'Ghost'], 'message': 'Rain out tonight'}
assert cl.post('/send-rainout-text', json=body).status_code == 403
assert cl.post('/send-rainout-text', json=body, headers={**H, 'X-Actor-Role': 'player'}).status_code == 403
assert cl.post('/send-rainout-text', json={'players': [], 'message': 'x'}, headers=H).status_code == 400

sent_to = []
app._send_mail = lambda addrs, subj, text: (sent_to.append((addrs[0], text)) or True)
# sandbox: nothing is really sent, but the result says who would get it
assert 'sandbox' in app.VERSION.lower()
j = cl.post('/send-rainout-text', json=body, headers=H).get_json()
assert j['ok'] and j['simulated'] and not sent_to
assert j['sent'] == ['Cell One', 'Mail Only', 'Prefers Email', 'Fallback'], j
assert [f['player'] for f in j['failed']] == ['No Contact', 'Ghost'], j
# live: real sends, to the carrier gateway for texters and the email address for email-only / no-cell players
app.VERSION = '20261010.5'
j = cl.post('/send-rainout-text', json=body, headers=H).get_json()
assert not j['simulated'] and j['sent'] == ['Cell One', 'Mail Only', 'Prefers Email', 'Fallback']
assert [a for a, _ in sent_to] == ['5025550101@vtext.com', 'm@x.com', 'pe@x.com', 'fb@x.com'], sent_to
assert all(t == 'Rain out tonight' for _, t in sent_to)
assert sqlite3.connect(app.DB_PATH).execute("SELECT COUNT(*) FROM LogTable WHERE method='send_rainout_text'").fetchone()[0] == 2
print('ok')
