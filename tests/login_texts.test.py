"""A text to the officers who want one whenever someone logs in (the developer unless they opted out), throttled, never to yourself."""
import sys; sys.dont_write_bytecode = True
import os, sqlite3, tempfile, importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
tmp = tempfile.mkdtemp(); app.DB_PATH = os.path.join(tmp, 'HughsGolf.db')
c = sqlite3.connect(app.DB_PATH)
c.executescript("""CREATE TABLE Players (Player TEXT, Officer TEXT, ActiveSession TEXT, Phone TEXT, CellCarrier TEXT, Email TEXT, FirstLoginAt TEXT);
 CREATE TABLE LogTable (id INTEGER PRIMARY KEY AUTOINCREMENT, log_time TEXT, level TEXT, method TEXT, source TEXT, text TEXT, details TEXT, created_at TEXT);
 INSERT INTO Players VALUES ('Dev Eloper','Developer','sess-dev','502-555-0001','T-Mobile','dev@x.com',NULL),
   ('Ad Min','Admin','sess-ad','502-555-0002','T-Mobile','ad@x.com',NULL),
   ('Pat Player','Player','sess-pat','502-555-0003','T-Mobile','pat@x.com',NULL),
   ('No Phone','Admin','sess-np','','','np@x.com',NULL);""")
c.commit(); c.close()
app.ensure_schema()
app.get_gmail_creds = lambda: ('league@example.com', 'pw')
mail, texts = [], []
class FakeSMTP:
    def __init__(self, *a, **k): pass
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def login(self, *a): pass
    def send_message(self, msg): mail.append((msg['To'], msg['Subject']))
app._AuditSMTP = FakeSMTP
app._send_mail = lambda to, subj, body: (texts.append((to[0], body)), True)[1]
cl = app.app.test_client()
login = lambda who, role='player', first=False: cl.post('/notify-login', json={'player': who, 'role': role, 'version': 'v', 'ip': '1.2.3.4', 'firstLogin': first})
setting = lambda who, v: (lambda c2: (c2.execute('UPDATE Players SET LoginTexts=? WHERE Player=?', (v, who)), c2.commit(), c2.close()))(sqlite3.connect(app.DB_PATH))
# rules
assert app._login_text_on('Developer', None) and app._login_text_on('Developer', 'Y') and not app._login_text_on('Developer', 'N'), 'the developer: on unless they said no'
assert not app._login_text_on('Admin', None) and app._login_text_on('Admin', 'Y') and not app._login_text_on('Admin', 'N') and not app._login_text_on('Player', 'Y'), 'an admin: only if they said yes; a player never'
# every login texts the developer (and the email still goes)
r = login('Pat Player'); assert r.get_json()['ok'] and 'sms' in r.get_json()['sentTo'] and 'email' in r.get_json()['sentTo']
assert texts == [('5025550001@tmomail.net', 'HughsGolf: [sandbox] Pat Player (player) logged in.')], texts
# the same person reloading is not texted again within the gap; a first login always is; another person is
login('Pat Player'); assert len(texts) == 1, 'throttled'
login('Pat Player', first=True); assert len(texts) == 2 and 'for the first time' in texts[1][1]
login('Ad Min', 'admin'); assert [t[0] for t in texts[2:]] == ['5025550001@tmomail.net'], 'another login texts the developer (not the admin: not opted in)'
# opting out
texts.clear(); app._LOGIN_TEXT_LAST.clear(); setting('Dev Eloper', 'N'); login('Pat Player'); assert texts == [], 'the developer opted out'
# an admin who opts in is texted too, but never about their own login; one with no phone is skipped
app._LOGIN_TEXT_LAST.clear(); setting('Ad Min', 'Y'); setting('No Phone', 'Y'); setting('Dev Eloper', 'Y'); login('Pat Player')
assert sorted(t[0] for t in texts) == ['5025550001@tmomail.net', '5025550002@tmomail.net'], texts
texts.clear(); app._LOGIN_TEXT_LAST.clear(); login('Ad Min', 'admin'); assert [t[0] for t in texts] == ['5025550001@tmomail.net'], 'not texted about their own login'
# production versions do not say [sandbox]
texts.clear(); app._LOGIN_TEXT_LAST.clear(); app.VERSION = '20261021.1'; login('Pat Player'); assert texts[0][1] == 'HughsGolf: Pat Player (player) logged in.'
app.VERSION = '20261021.1-sandbox'
# My Profile: an officer can turn it off and on; a player cannot set it
prof = lambda who, tok, **b: cl.post('/update-my-profile', json={'player': who, 'sessionToken': tok, **b})
r = prof('Dev Eloper', 'sess-dev', loginTexts='N'); assert r.status_code == 200 and r.get_json()['player']['LoginTexts'] == 'N', r.get_json()
r = prof('Dev Eloper', 'sess-dev', loginTexts='Y'); assert r.get_json()['player']['LoginTexts'] == 'Y'
assert prof('Dev Eloper', 'sess-dev', loginTexts='maybe').status_code == 400
r = prof('Pat Player', 'sess-pat', loginTexts='Y'); assert r.status_code == 200 and sqlite3.connect(app.DB_PATH).execute("SELECT LoginTexts FROM Players WHERE Player='Pat Player'").fetchone()[0] in (None, ''), 'a player cannot turn it on'
print('ok')
