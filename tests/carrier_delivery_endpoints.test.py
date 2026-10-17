"""Sub requests (urgent) and payout notices (long + important) follow the carrier rules. Mail is faked; nothing is sent."""
import sys; sys.dont_write_bytecode = True
import os, sqlite3, tempfile, importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
tmp = tempfile.mkdtemp(); app.DB_PATH = os.path.join(tmp, 'HughsGolf.db')
c = sqlite3.connect(app.DB_PATH)
c.executescript("""CREATE TABLE Players (Player TEXT, Officer TEXT, Login TEXT, Phone TEXT, CellCarrier TEXT, Email TEXT, ContactMethod TEXT, ActiveSession TEXT);
 CREATE TABLE LogTable (log_time TEXT, level TEXT, method TEXT, source TEXT, text TEXT, details TEXT, created_at TEXT);
 INSERT INTO Players VALUES
  ('Tee Mobile','Admin','Y','502-555-0001','T-Mobile','tee@x.com','',NULL),
  ('Ver Izon','Secretary','Y','502-555-0002','Verizon','ver@x.com','',NULL),
  ('At Tee','President','Y','502-555-0003','AT&T','att@x.com','',NULL),
  ('Phone Only','Admin','Y','502-555-0004','T-Mobile','','',NULL),
  ('Mail Pref','Admin','Y','502-555-0005','T-Mobile','mp@x.com','email',NULL);""")
c.commit(); c.close()
app.ensure_schema()
c = sqlite3.connect(app.DB_PATH)                              # every player's text is confirmed (an unconfirmed player is also emailed: see carrier_gateways.test.py)
for _n, _p, _c in c.execute('SELECT Player, Phone, CellCarrier FROM Players').fetchall(): c.execute('UPDATE Players SET CellConfirmed=? WHERE Player=?', ('2026-10-18|' + app._cell_key(_p, _c), _n))
c.commit(); c.close()
c = sqlite3.connect(app.DB_PATH); c.execute("UPDATE CarrierGateways SET Status='unavailable', Note='ended' WHERE Carrier='AT&T'"); c.commit(); c.close()
app.get_gmail_creds = lambda: ('league@example.com', 'pw')
smtp, plain = [], []
class FakeSMTP:
    def __init__(self, *a, **k): pass
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def login(self, *a): pass
    def sendmail(self, frm, to, body): smtp.append(('email', list(to)))
    def send_message(self, msg): smtp.append(('msg', msg['To'], msg.get_payload()))
app._AuditSMTP = FakeSMTP
app._send_mail = lambda to, subj, body: (plain.append((list(to), subj, body)), True)[1]
cl = app.app.test_client(); H = {'X-Save-Token': app.SAVE_TOKEN, 'X-Actor': 'Boss', 'X-Actor-Role': 'admin'}

# a sub request (sent to officers so the eligibility rules do not apply): T-Mobile tested = text only; Verizon untested = text + email; AT&T gone = email
r = cl.post('/need-sub', json={'player': 'Somebody', 'date': '20271012', 'message': 'Need a sub Tuesday', 'recipients': ['Tee Mobile', 'Ver Izon', 'At Tee', 'Phone Only', 'Mail Pref'], 'askOfficers': True}, headers=H)
j = r.get_json(); assert r.status_code == 200 and j['ok'], j
texts = [m[1] for m in smtp if m[0] == 'msg']; emails = [m[1][0] for m in smtp if m[0] == 'email']
assert texts == ['5025550001@tmomail.net', '5025550002@vtext.com', '5025550004@tmomail.net'], texts
assert emails == ['ver@x.com', 'att@x.com', 'mp@x.com'], emails
assert j['sent_count'] == 5 and j['sms_count'] == 3 and j['email_count'] == 3 and j['failed'] == [], j
# the officers still get a copy of a request that went by text only (otherwise nobody would see it)
copies = [p for p in plain if 'sent by text to Tee Mobile' in p[1]]; assert copies and 'garyrscudder@gmail.com' in copies[0][0] and 'tee@x.com' not in copies[0][0]
assert any('sent by text to Phone Only' in p[1] for p in plain)
assert not any('Ver Izon' in p[1] for p in plain), 'a player who also got the email needs no separate officer copy'

# a payout notice is long and important: the email carries it; a tested carrier also gets a short "check your email" text
smtp.clear(); plain.clear()
pay = lambda who, **kw: cl.post('/notify-payout', json={'player': who, 'amount': 12.5, 'source': 'Skin Kitty', 'comment': 'nice', **kw}, headers=H)
assert pay('Tee Mobile').status_code == 200
e1 = [m for m in smtp if m[0] == 'msg']
assert any(m[1] == 'tee@x.com' for m in e1) and any(m[1] == '5025550001@tmomail.net' and 'check your email' in m[2] for m in e1), e1
smtp.clear(); assert pay('Ver Izon').status_code == 200
m2 = [m for m in smtp if m[0] == 'msg']; assert [m[1] for m in m2] == ['ver@x.com'], 'untested carrier: email only, no nudge'
smtp.clear(); assert pay('Phone Only').status_code == 200
m3 = [m for m in smtp if m[0] == 'msg']; assert [m[1] for m in m3] == ['5025550004@tmomail.net'] and '$12.50' in m3[0][2], 'no email on file: the text carries the details'
smtp.clear(); assert pay('Mail Pref').status_code == 200
assert [m[1] for m in smtp if m[0] == 'msg'] == ['mp@x.com'], 'asked for email only: no text'
smtp.clear(); assert pay('At Tee').status_code == 200 and [m[1] for m in smtp if m[0] == 'msg'] == ['att@x.com']
print('ok')
