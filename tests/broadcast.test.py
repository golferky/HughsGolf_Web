"""Broadcast: a freeform message to a group with an optional one-tap answer. Mail is faked; nothing is sent."""
import sys; sys.dont_write_bytecode = True
import os, re, sqlite3, tempfile, importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
tmp = tempfile.mkdtemp(); app.DB_PATH = os.path.join(tmp, 'HughsGolf.db')
c = sqlite3.connect(app.DB_PATH)
c.executescript("""CREATE TABLE Players (Player TEXT, Officer TEXT, ActiveSession TEXT, Phone TEXT, CellCarrier TEXT, Email TEXT, ContactMethod TEXT,
   Status TEXT, ContactOK TEXT, Participates TEXT, IsTest TEXT);
 CREATE TABLE Teams (League TEXT, Year INTEGER, Player TEXT);
 CREATE TABLE LogTable (log_time TEXT, level TEXT, method TEXT, source TEXT, text TEXT, details TEXT, created_at TEXT);
 INSERT INTO Players VALUES
  ('Boss Admin','Admin','sess-boss','502-555-0199','T-Mobile','boss@x.com','','','','Y','N'),
  ('Pat Player','Player','sess-pat','502-555-0111','Verizon','pat@x.com','','','','Y','N'),
  ('Reg Ular','Player','s3','502-555-0121','T-Mobile','reg@x.com','','','','Y','N'),
  ('Mail Only','Player','s4','','','mo@x.com','email','','','Y','N'),
  ('No Contact','Player','s5','','','','','','','Y','N'),
  ('Opted Out','Player','s6','502-555-0122','Verizon','oo@x.com','','Approved','N','Y','N'),
  ('Retired Guy','Player','s7','502-555-0123','Verizon','rg@x.com','','','','N','N'),
  ('Test Account','Player','s8','502-555-0124','Verizon','ta@x.com','','','','Y','Y'),
  ('Willing Sub','Player','s9','502-555-0125','Verizon','ws@x.com','','Approved','Y','Y','N'),
  ('Unasked Sub','Player','s10','502-555-0126','Verizon','us@x.com','','Approved','','Y','N'),
  ('Pending One','Player','s11','502-555-0127','Verizon','po@x.com','','Pending','','Y','N');
 INSERT INTO Teams VALUES ("Hugh's",2026,'Boss Admin'),("Hugh's",2026,'Pat Player'),("Hugh's",2026,'Reg Ular'),("Hugh's",2026,'Mail Only'),
   ("Hugh's",2026,'No Contact'),("Hugh's",2026,'Opted Out'),("Hugh's",2026,'Retired Guy'),("Hugh's",2026,'Test Account'),("Hugh's",2026,'Pending One');""")
c.commit(); c.close()
app.ensure_schema()
assert sqlite3.connect(app.DB_PATH).execute("SELECT COUNT(*) FROM sqlite_master WHERE name IN ('Broadcast','BroadcastRecipient')").fetchone()[0] == 2
sent = []
app._send_mail = lambda to, subj, body: (sent.append((list(to)[0], subj, body)), True)[1]
cl = app.app.test_client(); PUB = {'base_url': 'https://hughsgolf.example.org'}
A = {'admin': 'Boss Admin', 'sessionToken': 'sess-boss'}
post = lambda **b: cl.post('/broadcast', json={**A, **b}, **PUB)
# only an admin who is logged in
assert cl.post('/broadcast', json={'admin': 'Pat Player', 'sessionToken': 'sess-pat', 'action': 'list'}, **PUB).status_code == 403
assert cl.post('/broadcast', json={'admin': 'Boss Admin', 'sessionToken': 'wrong', 'action': 'list'}, **PUB).status_code == 403

# who would be sent it: the 2026 roster, minus people who opted out, are not playing, are pending or have no way to be reached
j = post(action='preview', group='team', year=2026).get_json(); assert j['ok']
got = {r['player']: r['mode'] for r in j['recipients']}; skip = {s['player']: s['reason'] for s in j['skipped']}
assert set(got) == {'Boss Admin', 'Pat Player', 'Reg Ular', 'Mail Only'}, got
assert got['Mail Only'] == 'email' and got['Reg Ular'] == 'both' and got['Pat Player'] == 'both', 'unconfirmed players are texted and emailed'
assert skip['Opted Out'] == 'asked not to be contacted' and skip['Retired Guy'] == 'not playing' and skip['Pending One'] == 'pending player' and 'No Contact' in skip and 'Test Account' not in skip, skip
# subs: only people outside the roster who agreed to be contacted
j = post(action='preview', group='subs', year=2026).get_json(); assert [r['player'] for r in j['recipients']] == ['Willing Sub'] and j['skipped'] == [], j
assert {r['player'] for r in post(action='preview', group='all', year=2026).get_json()['recipients']} == {'Boss Admin', 'Pat Player', 'Reg Ular', 'Mail Only', 'Willing Sub'}
j = post(action='preview', group='names', year=2026, names=['Unasked Sub', 'Pat Player']).get_json()
assert [r['player'] for r in j['recipients']] == ['Pat Player'] and j['skipped'] == [{'player': 'Unasked Sub', 'reason': 'has not agreed to be contacted'}], j

# a test goes only to the admin, in the sandbox too
msg = 'Hugh\'s Golf: are you in for 2027?'
r = post(action='send', test=True, title='Season 2027', message=msg, ask='season', group='team', year=2026).get_json()
assert r['ok'] and r['test'] and r['sent'] == ['Boss Admin'] and not r['simulated'], r
assert {s[0] for s in sent} == {'5025550199@tmomail.net', 'boss@x.com'} and any('TEST: ' in s[2] and '/b/' in s[2] for s in sent), sent
assert post(action='list').get_json()['broadcasts'] == [], 'a test is not listed'
# the sandbox never texts real players
assert 'sandbox' in app.VERSION.lower(); sent.clear()
r = post(action='send', title='Season 2027', message=msg, ask='season', group='team', year=2026).get_json()
assert r['ok'] and r['simulated'] and len(r['sent']) == 4 and not sent
# a real send (not the sandbox)
app.VERSION = '20261018.6'; sent.clear()
r = cl.post('/broadcast', json={**A, 'action': 'send', 'title': 'Season 2027', 'message': msg, 'ask': 'season', 'group': 'team', 'year': 2026}, base_url='http://192.168.1.176:8446').get_json()
assert not r['ok'] and 'public address' in r['error']
sent.clear()
r = post(action='send', title='Season 2027', message=msg, ask='season', group='team', year=2026).get_json()
assert r['ok'] and not r['simulated'] and sorted(r['sent']) == ['Boss Admin', 'Mail Only', 'Pat Player', 'Reg Ular'] and r['via']['Mail Only'] == ['email'] and set(r['via']['Pat Player']) == {'text', 'email'}, r
assert len(r['skipped']) == 4 and any('hughsgolf.example.org/b/' in s[2] for s in sent if s[0].endswith('vtext.com')), sent
bid = r['id']
lst = post(action='list').get_json()['broadcasts']; assert len(lst) == 2 and lst[0]['id'] == bid and lst[0]['recipients'] == 4 and lst[0]['answered'] == 0
tok = {p: t for p, t in sqlite3.connect(app.DB_PATH).execute('SELECT Player, Token FROM BroadcastRecipient WHERE BroadcastId=?', (bid,))}
assert set(tok) == {'Boss Admin', 'Mail Only', 'Pat Player', 'Reg Ular'}

# the player's page: viewing answers nothing; a button records it; the answer can be changed
page = cl.get(f'/b/{tok["Pat Player"]}'); assert page.status_code == 200 and b'are you in for 2027' in page.data and b'Yes, I&#x27;m in' in page.data
ans = lambda who: sqlite3.connect(app.DB_PATH).execute('SELECT Answer, Note FROM BroadcastRecipient WHERE Token=?', (tok[who],)).fetchone()
assert ans('Pat Player') == (None, None)
p = cl.post(f'/b/{tok["Pat Player"]}', data={'answer': 'yes', 'note': 'wouldn\'t miss it'}); assert b'you answered' in p.data and ans('Pat Player') == ('yes', "wouldn't miss it")
cl.post(f'/b/{tok["Pat Player"]}', data={'answer': 'maybe'}); assert ans('Pat Player')[0] == 'maybe'
cl.post(f'/b/{tok["Pat Player"]}', data={'answer': 'bogus'}); assert ans('Pat Player')[0] == 'maybe'
assert cl.get('/b/nope').status_code == 404
cl.post(f'/b/{tok["Reg Ular"]}', data={'answer': 'no'})
# the admin's view, and recording an answer for someone who told them in person
st = post(action='status', id=bid).get_json(); assert st['ok'] and st['labels'][0] == "Yes, I'm in"
by = {r['player']: r['answer'] for r in st['rows']}; assert by == {'Boss Admin': '', 'Mail Only': '', 'Pat Player': 'maybe', 'Reg Ular': 'no'}, by
assert post(action='answer', id=bid, player='Mail Only', answer='yes').status_code == 200 and ans('Mail Only')[0] == 'yes'
assert post(action='answer', id=bid, player='Nobody', answer='yes').status_code == 404 and post(action='answer', id=bid, player='Mail Only', answer='zzz').status_code == 400
# remind: only the people who have not answered, with the same links
sent.clear()
r = post(action='send', remindId=bid).get_json(); assert r['ok'] and r['sent'] == ['Boss Admin'] and r['id'] == bid, r
assert any(tok['Boss Admin'] in s[2] for s in sent)
# closing stops answers
assert post(action='close', id=bid).status_code == 200
cl.post(f'/b/{tok["Boss Admin"]}', data={'answer': 'yes'}); assert ans('Boss Admin')[0] is None
assert b'closed' in cl.get(f'/b/{tok["Boss Admin"]}').data and post(action='send', remindId=bid).status_code == 400
assert post(action='reopen', id=bid).status_code == 200
cl.post(f'/b/{tok["Boss Admin"]}', data={'answer': 'yes'}); assert ans('Boss Admin')[0] == 'yes'
# an announcement without a question has no link
sent.clear(); r = post(action='send', title='Banquet', message='Banquet is Oct 30 at 6.', ask='', group='names', names=['Pat Player'], year=2026).get_json()
assert r['ok'] and r['sent'] == ['Pat Player'] and not any('/b/' in s[2] for s in sent), sent
assert post(action='send', title='', message='x', group='team').status_code == 400
print('ok')
