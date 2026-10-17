"""My Profile: a player edits their own contact details; the server checks the login session and only accepts the allowed fields."""
import sys; sys.dont_write_bytecode = True
import os, sqlite3, tempfile, importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
app.DB_PATH = os.path.join(tempfile.mkdtemp(), 'HughsGolf.db')
c = sqlite3.connect(app.DB_PATH)
c.executescript("""CREATE TABLE Players (Player TEXT, Email TEXT, Phone TEXT, CellCarrier TEXT, EmailStats TEXT, TextStats TEXT, Officer TEXT, Login TEXT,
  BlockSubs TEXT, ActiveSession TEXT, ContactOK TEXT, ContactMethod TEXT, ConsentAt TEXT);
  CREATE TABLE LogTable (log_time TEXT, level TEXT, method TEXT, source TEXT, text TEXT, details TEXT, created_at TEXT);
  INSERT INTO Players (Player, Email, Phone, CellCarrier, EmailStats, TextStats, Officer, Login, BlockSubs, ActiveSession) VALUES
   ('Pat Example', 'pat@example.com', '859-555-0100', 'Verizon', 'N', 'N', 'Player', 'Y', 'N', 'sess-pat'),
   ('Sam Other', 'sam@example.com', '859-555-0101', 'AT&T', 'N', 'N', 'Admin', 'Y', 'N', 'sess-sam');""")
c.commit(); c.close()
cl = app.app.test_client()
row = lambda n: sqlite3.connect(app.DB_PATH).execute('SELECT Email, Phone, CellCarrier, EmailStats, TextStats, Officer, BlockSubs, ContactOK, ContactMethod FROM Players WHERE Player=?', (n,)).fetchone()
post = lambda **b: cl.post('/update-my-profile', json=b)
ok = dict(player='Pat Example', sessionToken='sess-pat')

# the login session is checked
assert post(player='Pat Example', email='x@y.com').status_code == 403, 'no session'
assert post(player='Pat Example', sessionToken='wrong', email='x@y.com').status_code == 403, 'wrong session'
assert post(player='Pat Example', sessionToken='sess-sam', email='x@y.com').status_code == 403, "another player's session cannot edit Pat"
assert post(player='Nobody', sessionToken='x').status_code == 403
assert row('Pat Example')[0] == 'pat@example.com', 'nothing changed by the refused requests'

# a normal save: contact details, stats, and the phone is tidied
r = post(**ok, email=' pat.new@example.com ', phone='(859) 555-0123', carrier='T-Mobile', emailStats='Y', textStats='Y')
j = r.get_json(); assert r.status_code == 200 and j['ok'], j
assert row('Pat Example')[:5] == ('pat.new@example.com', '859-555-0123', 'T-Mobile', 'Y', 'Y')
assert j['player']['Phone'] == '859-555-0123' and set(j['changed']) == {'Email', 'Phone', 'CellCarrier', 'EmailStats', 'TextStats'}
assert row('Sam Other')[0] == 'sam@example.com', "other players are untouched"
assert post(**ok, phone='1-859-555-0199').get_json()['player']['Phone'] == '859-555-0199', 'a leading 1 is dropped'
assert post(**ok, phone='').get_json()['player']['Phone'] == '', 'a number can be cleared'

# validation
for bad in (dict(email='not-an-email'), dict(phone='12345'), dict(carrier='Nope'), dict(emailStats='maybe'), dict(contact='sometimes')):
    assert post(**ok, **bad).status_code == 400, bad
assert post(**ok, phone='859-555-0123', carrier='T-Mobile', contact='text').status_code == 200
app_conn = sqlite3.connect(app.DB_PATH); app_conn.execute("UPDATE Players SET Email='' WHERE Player='Pat Example'"); app_conn.commit(); app_conn.close()
assert post(**ok, contact='email').status_code == 400, 'email contact needs an email'
assert post(**ok, email='pat@example.com', contact='email').status_code == 200

# sub-request contact choice behaves like the permission page
assert row('Pat Example')[6:] == ('N', 'Y', 'email')
assert post(**ok, contact='none').status_code == 200 and row('Pat Example')[6:] == ('Y', 'N', ''), "'none' means do not ask me to sub"
assert post(**ok, contact='both').status_code == 200 and row('Pat Example')[6:] == ('N', 'Y', 'both')

# only the profile fields can be changed, whatever else is sent
before = row('Pat Example')
post(**ok, officer='Developer', Officer='Developer', login='N', blockSubs='Y', role='admin', handicap=0)
assert row('Pat Example')[5] == 'Player' and row('Pat Example') == before, 'role and other fields are not accepted'
log = [r[0] for r in sqlite3.connect(app.DB_PATH).execute("SELECT text FROM LogTable WHERE method='profile_update' ORDER BY rowid")]
assert log and 'Pat Example updated their profile' in log[0] and 'pat.new@example.com' not in ' '.join(log), 'logged without the values'
print('ok')
