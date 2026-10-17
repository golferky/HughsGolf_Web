"""Photo reminder: a player without a photo is asked at most three times (counted per player on the server); never with a photo."""
import sys; sys.dont_write_bytecode = True
import os, sqlite3, tempfile, importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
tmp = tempfile.mkdtemp(); app.DB_PATH = os.path.join(tmp, 'HughsGolf.db')
c = sqlite3.connect(app.DB_PATH)
c.executescript("""CREATE TABLE Players (Player TEXT, ActiveSession TEXT, PhotoKey TEXT);
 CREATE TABLE LogTable (log_time TEXT, level TEXT, method TEXT, source TEXT, text TEXT, details TEXT, created_at TEXT);
 INSERT INTO Players VALUES ('Pat Player','sess-pat',NULL), ('Pic Ture','sess-pic','pic_abcdef123456');""")
c.commit(); c.close()
app.ensure_schema()
assert 'PhotoReminders' in [r[1] for r in sqlite3.connect(app.DB_PATH).execute('PRAGMA table_info(Players)')]
cl = app.app.test_client()
ask = lambda who='Pat Player', tok='sess-pat': cl.post('/photo-reminder', json={'player': who, 'sessionToken': tok})
assert ask(tok='wrong').status_code == 403 and ask(who='Nobody').status_code == 403 and cl.post('/photo-reminder', json={}).status_code == 403
got = [ask().get_json() for _ in range(5)]
assert [g['show'] for g in got] == [True, True, True, False, False], got
assert [g.get('count') for g in got[:3]] == [1, 2, 3] and got[0]['max'] == 3
n = lambda who: sqlite3.connect(app.DB_PATH).execute('SELECT PhotoReminders FROM Players WHERE Player=?', (who,)).fetchone()[0]
assert n('Pat Player') == 3
j = ask('Pic Ture', 'sess-pic').get_json(); assert j['ok'] and not j['show'] and n('Pic Ture') in (0, None), 'a player with a photo is never asked'
# an older database with no photo column at all: nothing to ask about
c = sqlite3.connect(app.DB_PATH); c.execute('UPDATE Players SET PhotoReminders=0'); c.commit(); c.close()
# a photo added after two reminders stops them
ask(); ask(); c = sqlite3.connect(app.DB_PATH); c.execute("UPDATE Players SET PhotoKey='pat_0123456789ab' WHERE Player='Pat Player'"); c.commit(); c.close()
assert not ask().get_json()['show'] and n('Pat Player') == 2
print('ok')
