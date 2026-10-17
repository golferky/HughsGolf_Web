"""Carrier text gateways: the CarrierGateways table, how each kind of message reaches a player, and the admin actions."""
import sys; sys.dont_write_bytecode = True
import os, sqlite3, tempfile, importlib.util, datetime
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
tmp = tempfile.mkdtemp(); app.DB_PATH = os.path.join(tmp, 'HughsGolf.db')
today = app.now_local().strftime('%Y-%m-%d')
c = sqlite3.connect(app.DB_PATH)
c.executescript("""CREATE TABLE Players (Player TEXT, Officer TEXT, ActiveSession TEXT, Phone TEXT, CellCarrier TEXT, Email TEXT, ContactMethod TEXT);
 CREATE TABLE LogTable (log_time TEXT, level TEXT, method TEXT, source TEXT, text TEXT, details TEXT, created_at TEXT);
 INSERT INTO Players VALUES ('Boss Admin','Admin','sess-boss','502-555-0199','T-Mobile','boss@x.com',''),
   ('Pat Player','Player','sess-pat','502-555-0111','Verizon','pat@x.com','');""")
c.commit(); c.close()
app.ensure_schema()
rows = lambda: {r[0]: r for r in sqlite3.connect(app.DB_PATH).execute('SELECT Carrier, Gateway, Status, ValidatedAt, ValidatedBy, Note, Active FROM CarrierGateways')}

# seeded: every carrier the app knew, T-Mobile is known to work, the rest are untested; running again keeps what the admin set
t = rows(); assert set(t) == {'AT&T', 'Verizon', 'T-Mobile', 'Sprint', 'Boost', 'CBW', 'Cricket', 'Metro', 'US Cellular'}, set(t)
assert t['T-Mobile'][2] == 'validated' and t['T-Mobile'][3] == today and all(r[2] == 'unvalidated' for k, r in t.items() if k != 'T-Mobile')
assert t['Verizon'][1] == 'vtext.com' and t['US Cellular'][1] == 'email.uscc.net'
c = sqlite3.connect(app.DB_PATH); c.execute("UPDATE CarrierGateways SET Status='unavailable', Note='ended' WHERE Carrier='AT&T'"); c.commit(); c.close()
app.ensure_schema(); assert rows()['AT&T'][2] == 'unavailable' and rows()['AT&T'][5] == 'ended'

# names
assert [app.canonical_carrier(x) for x in ('att', 'AT&T', ' t-mobile ', 'TMobile', 'us cellular', 'USCellular', 'Weird Co')] == ['AT&T', 'AT&T', 'T-Mobile', 'T-Mobile', 'US Cellular', 'US Cellular', 'Weird Co']

# status as used for sending
info = app.carrier_info
assert info('T-Mobile')['status'] == 'validated' and info('tmobile')['gateway'] == 'tmomail.net' and info('Verizon')['status'] == 'unvalidated'
assert info('AT&T')['status'] == 'unavailable' and info('Other')['status'] == 'unavailable' and info('Other')['gateway'] == ''
old = (app.now_local() - datetime.timedelta(days=400)).strftime('%Y-%m-%d')
c = sqlite3.connect(app.DB_PATH); c.execute("UPDATE CarrierGateways SET ValidatedAt=? WHERE Carrier='T-Mobile'", (old,)); c.commit(); c.close()
assert info('T-Mobile')['status'] == 'unvalidated' and info('T-Mobile')['retest_due'], 'a validation older than a year expires'
c = sqlite3.connect(app.DB_PATH); c.execute("UPDATE CarrierGateways SET ValidatedAt=? WHERE Carrier='T-Mobile'", (today,)); c.execute("UPDATE CarrierGateways SET Active='N' WHERE Carrier='Cricket'"); c.commit(); c.close()
assert info('T-Mobile')['status'] == 'validated' and info('Cricket')['status'] == 'unavailable', 'an inactive carrier is unavailable'
# an older database with no table falls back to the built-in list (T-Mobile known good, the rest untested)
good_path = app.DB_PATH; app.DB_PATH = os.path.join(tmp, 'old.db'); sqlite3.connect(app.DB_PATH).close()
assert info('t-mobile')['status'] == 'validated' and info('verizon')['status'] == 'unvalidated' and info('verizon')['gateway'] == 'vtext.com' and info('zzz')['status'] == 'unavailable'
app.DB_PATH = good_path

# addresses come from the table (gateway edits count), and an unavailable carrier has no text address
assert app.sms_address('(502) 555-0111', 'verizon') == ('5025550111@vtext.com', None)
assert app.sms_address('502-555-0111', 'AT&T')[0] is None and 'not available' in app.sms_address('502-555-0111', 'AT&T')[1]
assert app.sms_address('', 'Verizon')[0] is None and app.sms_address('12345', 'Verizon')[1] == 'Invalid phone number format' and 'Unknown carrier' in app.sms_address('502-555-0111', 'Nope')[1]
c = sqlite3.connect(app.DB_PATH); c.execute("UPDATE CarrierGateways SET Gateway='vzwpix.com' WHERE Carrier='Verizon'"); c.commit(); c.close()
assert app.sms_address('502-555-0111', 'Verizon')[0] == '5025550111@vzwpix.com'
c = sqlite3.connect(app.DB_PATH); c.execute("UPDATE CarrierGateways SET Gateway='vtext.com' WHERE Carrier='Verizon'"); c.commit(); c.close()

# how a message reaches a player: validated T-Mobile, untested Verizon, unavailable AT&T
P = lambda kind, carrier, email='e@x.com', phone='502-555-0111', cm='', imp=False: app.delivery_plan(kind, phone, carrier, email, cm, imp)
m = lambda p: (p['mode'], bool(p['nudge']))
assert m(P('urgent', 'T-Mobile')) == ('text-first', False), 'tested carrier: text, email only if rejected'
assert m(P('urgent', 'Verizon')) == ('both', False), 'untested carrier: text and email'
assert m(P('urgent', 'AT&T')) == ('email', False) and m(P('urgent', 'Other')) == ('email', False)
assert m(P('urgent', 'Verizon', email='')) == ('text-first', False), 'no email on file: just the text'
assert m(P('urgent', 'AT&T', email='')) == ('none', False)
assert m(P('urgent', 'Verizon', cm='email')) == ('email', False), 'asked for email only: never texted'
assert m(P('urgent', 'Verizon', cm='text')) == ('text-first', False), 'asked for text only: no simultaneous email'
assert m(P('urgent', 'Verizon', phone='')) == ('email', False)
assert m(P('simple', 'T-Mobile')) == ('text-first', False) and m(P('simple', 'Verizon')) == ('text-first', False), 'simple: the text, even if untested'
assert m(P('simple', 'AT&T')) == ('email', False) and m(P('simple', 'AT&T', email='')) == ('none', False)
assert m(P('long', 'T-Mobile')) == ('email', False), 'long, not important: email only'
assert m(P('long', 'T-Mobile', imp=True)) == ('email', True), 'important + tested carrier: email plus a "check your email" text'
assert m(P('long', 'Verizon', imp=True)) == ('email', False) and m(P('long', 'AT&T', imp=True)) == ('email', False), 'no nudge for an untested or unavailable carrier'
assert m(P('long', 'T-Mobile', imp=True, cm='email')) == ('email', False)
assert m(P('long', 'Verizon', email='')) == ('text', False) and m(P('long', 'AT&T', email='')) == ('none', False)

# delivering a plan
sent = []
def ok_send(to, subj, body): sent.append((to[0], body)); return True
def text_rejected(to, subj, body):
    if '@vtext' in to[0] or '@tmomail' in to[0]: return False
    sent.append((to[0], body)); return True
D = lambda plan, send=ok_send, **kw: app.deliver(plan, 'TEXT', "Hugh's Golf", email_body='MAIL', nudge_body='NUDGE', send=send, **kw)
sent.clear(); r = D(P('urgent', 'Verizon')); assert r['sent'] == ['text', 'email'] and [b for _, b in sent] == ['TEXT', 'MAIL']
sent.clear(); r = D(P('urgent', 'T-Mobile')); assert r['sent'] == ['text'] and len(sent) == 1
sent.clear(); r = D(P('urgent', 'T-Mobile'), text_rejected); assert r['sent'] == ['email'] and [a for a, _ in sent] == ['e@x.com'], 'a rejected text falls back to the email'
sent.clear(); r = D(P('urgent', 'T-Mobile', email=''), text_rejected); assert not r['ok'] and r['reason'] == 'send failed'
sent.clear(); r = D(P('urgent', 'AT&T')); assert r['sent'] == ['email'] and sent[0][0] == 'e@x.com'
sent.clear(); r = D(P('long', 'T-Mobile', imp=True)); assert r['sent'] == ['email', 'text'] and [b for _, b in sent] == ['MAIL', 'NUDGE']
sent.clear(); r = D(P('long', 'T-Mobile')); assert r['sent'] == ['email'] and len(sent) == 1
sent.clear(); r = D(P('long', 'Verizon', email='')); assert r['sent'] == ['text'] and sent[0][1] == 'TEXT'
r = D(P('urgent', 'AT&T', email='')); assert not r['ok'] and r['reason']

# admin actions need the admin's own signed-in session, and the database must say they are an admin
cl = app.app.test_client()
act = lambda **b: cl.post('/carrier-admin', json={'admin': 'Boss Admin', 'sessionToken': 'sess-boss', **b})
assert cl.post('/carrier-admin', json={'admin': 'Boss Admin', 'sessionToken': 'wrong', 'action': 'validate', 'carrier': 'Verizon'}).status_code == 403
assert cl.post('/carrier-admin', json={'admin': 'Pat Player', 'sessionToken': 'sess-pat', 'action': 'validate', 'carrier': 'Verizon'}).status_code == 403, 'a player is not an admin'
assert rows()['Verizon'][2] == 'unvalidated'
r = act(action='validate', carrier='verizon', note='Pat got it').get_json(); assert r['ok'] and r['row']['Status'] == 'validated' and r['row']['ValidatedAt'] == today and r['row']['ValidatedBy'] == 'Boss Admin' and r['row']['Note'] == 'Pat got it'
assert info('Verizon')['status'] == 'validated'
r = act(action='unavailable', carrier='Verizon', note='carrier ended it').get_json(); assert r['row']['Status'] == 'unavailable' and info('Verizon')['status'] == 'unavailable'
r = act(action='unvalidate', carrier='Verizon').get_json(); assert r['row']['Status'] == 'unvalidated' and r['row']['ValidatedAt'] is None and r['row']['Note'] == 'carrier ended it'
r = act(action='save', carrier='Verizon', gateway='VTEXT.com', note='', active='N').get_json(); assert r['row']['Gateway'] == 'vtext.com' and r['row']['Active'] == 'N' and info('Verizon')['status'] == 'unavailable'
act(action='save', carrier='Verizon', gateway='vtext.com', note='', active='Y')
assert act(action='save', carrier='Verizon', gateway='bad@gateway').status_code == 400 and act(action='save', carrier='Verizon', gateway='no spaces.com').status_code == 400
r = act(action='add', carrier='Mint Mobile', gateway='tmomail.net', note='new').get_json(); assert r['ok'] and r['row']['Status'] == 'unvalidated' and 'Mint Mobile' in rows()
assert act(action='add', carrier='mint mobile', gateway='x.example.com').status_code == 400 and act(action='add', carrier='X', gateway='').status_code == 400
assert act(action='validate', carrier='Nope').status_code == 404 and act(action='explode', carrier='Verizon').status_code == 400
assert 'Mint Mobile' in app._profile_carriers() and 'Other' in app._profile_carriers() and '' in app._profile_carriers(), 'a new carrier can be picked in a profile'
assert sqlite3.connect(app.DB_PATH).execute("SELECT COUNT(*) FROM LogTable WHERE method='carrier_admin'").fetchone()[0] >= 6

# test text: through the chosen carrier's gateway to the player's number; in the sandbox, texting someone else needs the admin's confirmation
texts = []; app._send_mail = lambda to, subj, body: (texts.append((to[0], body)), True)[1]
tst = lambda **b: cl.post('/carrier-test', json={'admin': 'Boss Admin', 'sessionToken': 'sess-boss', 'carrier': 'T-Mobile', 'player': 'Boss Admin', **b})
assert cl.post('/carrier-test', json={'admin': 'Pat Player', 'sessionToken': 'sess-pat', 'carrier': 'Verizon', 'player': 'Pat Player'}).status_code == 403
assert 'sandbox' in app.VERSION.lower()
r = tst(); assert r.status_code == 200 and r.get_json()['to'] == '***-***-0199' and texts[0][0] == '5025550199@tmomail.net' and 'tell Boss Admin' in texts[0][1]
assert tst(player='Pat Player', carrier='Verizon').status_code == 403 and len(texts) == 1, 'the sandbox does not text other people without confirmation'
assert tst(player='Pat Player', carrier='Verizon', confirmed='yes').status_code == 403 and len(texts) == 1
r = tst(player='Pat Player', carrier='Verizon', confirmed=True); assert r.status_code == 200 and texts[-1][0] == '5025550111@vtext.com' and len(texts) == 2
texts.pop()
app.VERSION = '20261017.9'
r = tst(player='Pat Player', carrier='Verizon'); assert r.status_code == 200 and texts[-1][0] == '5025550111@vtext.com'
assert tst(carrier='Nope').status_code == 404
app._send_mail = lambda to, subj, body: False; assert tst().status_code == 502
print('ok')
