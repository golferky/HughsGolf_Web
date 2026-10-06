"""IP table + who's-on: heartbeat, login IP check, /whos-on, open-connection parsing."""
import os, sqlite3, tempfile, importlib.util, datetime

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
tmp = tempfile.mkdtemp(); dbp = os.path.join(tmp, 'HughsGolf.db'); app.DB_PATH = dbp
c = sqlite3.connect(dbp)
c.executescript("""
CREATE TABLE Players (Player TEXT, Officer TEXT, Participates TEXT DEFAULT 'Y', IsTest TEXT DEFAULT 'N', TestOwner TEXT);
CREATE TABLE LogTable (log_time TEXT, level TEXT, method TEXT, source TEXT, text TEXT, details TEXT, created_at TEXT);
INSERT INTO Players VALUES ('Alice Player','', 'Y','N',NULL), ('Bob Player','', 'Y','N',NULL), ('Adam Admin','admin','N','N',NULL),
  ('Dee Dev','Developer','Y','N',NULL), ('Tess Test','', 'Y','Y','Adam Admin');
""")
c.commit(); c.close()
app.ensure_schema()
cols = lambda t: {r[1] for r in sqlite3.connect(dbp).execute(f"PRAGMA table_info({t})")}
assert {'Player', 'IP', 'Device', 'FirstSeen', 'LastSeen', 'Hits'} <= cols('PlayerSeen')
assert {'Player', 'LastSeen', 'IP', 'Tab', 'Device'} <= cols('PlayerPresence')

cl = app.app.test_client(); H = {'X-Save-Token': app.SAVE_TOKEN}
def beat(player, ip, tab='home', device='Mac/Chrome', login=False):
    r = cl.post('/heartbeat', json={'player': player, 'tab': tab, 'device': device, 'login': login}, headers={**H, 'X-Forwarded-For': ip})
    return r.status_code, r.get_json()

# token required; blank / unknown players are ignored (not recorded)
assert cl.post('/heartbeat', json={'player': 'Alice Player'}).status_code == 403
assert cl.get('/whos-on').status_code == 403
assert beat('', '1.1.1.1')[1] == {'ok': True, 'recorded': False}
assert beat('Nobody Known', '1.1.1.1')[1]['recorded'] is False
db = lambda: sqlite3.connect(dbp)
assert db().execute("SELECT COUNT(*) FROM PlayerSeen").fetchone()[0] == 0

# login from a new IP: recorded as new, logged; the same IP again is known and counts hits
code, j = beat('Alice Player', '10.0.0.5', login=True)
assert code == 200 and j['ipStatus'] == 'new' and j['sharedWith'] == [], j
assert db().execute("SELECT method, text, details FROM LogTable WHERE method='ip_new'").fetchall() == [('ip_new', 'Alice Player logged in from a new IP', 'ip=10.0.0.5')]
code, j = beat('Alice Player', '10.0.0.5', tab='skins'); assert j['ipStatus'] == 'known'
row = db().execute("SELECT Hits, Device FROM PlayerSeen WHERE Player='Alice Player' AND IP='10.0.0.5'").fetchone(); assert row == (2, 'Mac/Chrome')
# the same player on a second IP is a second row (an IP is not one player)
beat('Alice Player', '203.0.113.9', device='iPhone/Safari')
assert db().execute("SELECT COUNT(*) FROM PlayerSeen WHERE Player='Alice Player'").fetchone()[0] == 2
# another player on a shared IP: not blocked, reported as shared
code, j = beat('Bob Player', '10.0.0.5', login=True)
assert code == 200 and j['ipStatus'] == 'new' and j['sharedWith'] == ['Alice Player'], j
assert 'also_seen_on_ip=Alice Player' in db().execute("SELECT details FROM LogTable WHERE text='Bob Player logged in from a new IP'").fetchone()[0]
# a login from a known IP writes no new-IP log row
n = db().execute("SELECT COUNT(*) FROM LogTable WHERE method='ip_new'").fetchone()[0]; beat('Bob Player', '10.0.0.5', login=True)
assert db().execute("SELECT COUNT(*) FROM LogTable WHERE method='ip_new'").fetchone()[0] == n

# presence: latest tab/device/IP per player
for who, ip in (('Adam Admin', '192.0.2.7'), ('Dee Dev', '192.0.2.8'), ('Tess Test', '198.51.100.4')): beat(who, ip, tab='admin')
assert db().execute("SELECT Tab, IP FROM PlayerPresence WHERE Player='Alice Player'").fetchone() == ('home', '203.0.113.9')

# old presence is offline; the others are on now
old = (datetime.datetime.utcnow() - datetime.timedelta(minutes=25)).strftime('%Y-%m-%d %H:%M:%S')
cc = db(); cc.execute("UPDATE PlayerPresence SET LastSeen=? WHERE Player='Bob Player'", (old,)); cc.commit(); cc.close()
app.open_connection_ips = lambda: ['10.0.0.5', '10.0.0.5', '203.0.113.9', '45.33.14.197']
j = cl.get('/whos-on', headers=H).get_json(); assert j['ok']
by = {p['player']: p for p in j['people']}
assert by['Alice Player']['online'] is True and by['Bob Player']['online'] is False and 1400 < by['Bob Player']['secondsAgo'] < 1700
assert by['Adam Admin']['role'] == 'admin' and by['Adam Admin']['participates'] is False and by['Dee Dev']['role'] == 'developer'
assert by['Tess Test']['isTest'] is True and by['Alice Player']['isTest'] is False
assert by['Bob Player']['otherPlayersOnIp'] == ['Alice Player'] and by['Alice Player']['knownIps'] == 2
# open connections matched to players; an IP nobody has used is unknown
conns = {x['ip']: x for x in j['connections']}
assert conns['10.0.0.5']['count'] == 2 and conns['10.0.0.5']['players'] == ['Alice Player', 'Bob Player'] and conns['10.0.0.5']['unknown'] is False
assert conns['203.0.113.9']['players'] == ['Alice Player']
assert conns['45.33.14.197']['unknown'] is True and conns['45.33.14.197']['players'] == []
assert j['connections'][0]['ip'] == '10.0.0.5', 'busiest first'

# /proc/net/tcp parsing: ESTABLISHED to our port only (IPv4, v4-mapped IPv6); listeners and other ports are ignored
hdr = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n"
v4 = hdr + ("   0: 0100007F:1F2E 0500000A:E8C0 01 00000000:00000000 00:00000000 00000000  1000 0 1 1 0 0 0\n"      # 127.0.0.1:7982 <- 10.0.0.5, port 0x1F2E
            "   1: 0100007F:1F2E 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000 0 2 1 0 0 0\n"      # LISTEN
            "   2: 0100007F:0050 0600000A:E8C1 01 00000000:00000000 00:00000000 00000000  1000 0 3 1 0 0 0\n")      # a different port
assert app.parse_proc_tcp(v4, 0x1F2E) == ['10.0.0.5']
v6 = hdr + ("   0: 00000000000000000000000000000000:1F2E 0000000000000000FFFF00000500000A:E8C0 01 00000000:00000000 00:00000000 00000000 1000 0 4 1 0 0 0\n"   # ::ffff:10.0.0.5
            "   1: 00000000000000000000000000000000:1F2E B80D0120000000000000000001000000:E8C1 01 00000000:00000000 00:00000000 00000000 1000 0 5 1 0 0 0\n")  # 2001:db8::1
assert app.parse_proc_tcp(v6, 0x1F2E) == ['10.0.0.5', '2001:0db8:0000:0000:0000:0000:0000:0001'], app.parse_proc_tcp(v6, 0x1F2E)
assert app.parse_proc_tcp('', 8445) == [] and app.parse_proc_tcp(hdr + 'garbage line\n', 8445) == []
# the routes are known to the server-log "suspicious route" check (source check)
html = open(os.path.join(here, '..', 'HughsGolf.html')).read()
assert "'/heartbeat', '/whos-on'" in html
print('ok')
