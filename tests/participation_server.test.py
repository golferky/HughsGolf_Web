"""One central server-side participation check: /run-sql, full-database /save, restore, refresh, test-account owners, current season only."""
import os, sqlite3, tempfile, importlib.util, shutil

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)

tmp = tempfile.mkdtemp()
def new_db(path, flags=True):
    if os.path.exists(path): os.remove(path)
    c = sqlite3.connect(path)
    c.executescript("""
    CREATE TABLE Players (Player TEXT, Officer TEXT, Participates TEXT DEFAULT 'Y', IsTest TEXT DEFAULT 'N', TestOwner TEXT);
    CREATE TABLE Scores (Player TEXT, Date TEXT, League TEXT, Gross INTEGER);
    CREATE TABLE Matches (Player TEXT, Date TEXT, Points INTEGER);
    CREATE TABLE Teams (Player TEXT, Team INTEGER, Grade TEXT, Year INTEGER, League TEXT);
    CREATE TABLE Subs (Player TEXT, Date TEXT, League TEXT);
    CREATE TABLE Payments (Player TEXT, Date TEXT, League TEXT, "Desc" TEXT, Detail TEXT, Earned REAL);
    CREATE TABLE SeasonSettings (League TEXT, Season INTEGER);
    INSERT INTO SeasonSettings VALUES ('Hugh''s', 2026), ('Hugh''s', 2025);
    INSERT INTO Players VALUES ('Real Player','','Y','N',NULL), ('Non Playing Admin','admin','N','N',NULL), ('Viewer Person','','N','N',NULL),
      ('Test Account','','Y','Y','Real Admin'), ('Old Quitter','','N','N',NULL), ('Legacy Blank','',NULL,NULL,NULL),
      ('Real Admin','admin','Y','N',NULL), ('Dev Person','Developer','Y','N',NULL), ('Plain Player Owner','','Y','N',NULL);
    -- history: an old season, and a current-season row that already existed before someone was switched off
    INSERT INTO Scores VALUES ('Old Quitter','20250101','Hugh''s',40), ('Old Quitter','20260401','Hugh''s',44);
    INSERT INTO Payments VALUES ('Old Quitter','20260401','Hugh''s','EOY Skins','Payment',20);
    """)
    c.commit(); c.close()

live = os.path.join(tmp, 'live.db'); new_db(live)
app.DB_PATH = live
S = "'Hugh''s'"

def run_stmt(sql, path=None):
    """Execute one statement the way /run-sql does; return the participation message (None = allowed). Rolls back when blocked."""
    c = sqlite3.connect(path or live); c.row_factory = sqlite3.Row; cur = c.cursor()
    st = app.participation_begin(cur, sql)
    cur.execute(sql)
    msg = app.participation_violation(cur, st)
    c.rollback() if msg else c.commit(); c.close()
    return msg

# ── statements: real participants, in every guarded table ──
for who in ('Real Player', 'Real Admin', 'Legacy Blank', 'Dev Person'):
    assert run_stmt(f"INSERT INTO Scores VALUES ('{who}','20261006',{S},38)") is None, who
    assert run_stmt(f"INSERT INTO Teams VALUES ('{who}',1,'A',2026,{S})") is None, who
# ── non-playing admin, viewer, test account are blocked this season, in every guarded table ──
for who in ('Non Playing Admin', 'Viewer Person', 'Test Account'):
    for sql in (f"INSERT INTO Scores VALUES ('{who}','20261006',{S},38)", f"INSERT INTO Matches VALUES ('{who}','20261006',3)",
                f"INSERT INTO Teams VALUES ('{who}',1,'A',2026,{S})", f"INSERT INTO Subs VALUES ('{who}','20261006',{S})",
                f"INSERT INTO Payments VALUES ('{who}','20261006',{S},'EOY Skins','Payment',10)"):
        msg = run_stmt(sql)
        assert msg and who in msg and 'not a league participant' in msg, (sql, msg)
# giving an existing row to a non-participant is also blocked
assert run_stmt("UPDATE Scores SET Player='Viewer Person' WHERE Player='Real Player'")
# ── history stays: old seasons are not blocked, nor are edits/deletes of rows already on file, refunds, the Kitty ──
assert run_stmt(f"INSERT INTO Scores VALUES ('Viewer Person','20250601',{S},41)") is None, 'a previous season is history'
assert run_stmt(f"INSERT INTO Teams VALUES ('Viewer Person',2,'B',2025,{S})") is None
assert run_stmt("UPDATE Scores SET Gross=45 WHERE Player='Old Quitter' AND Date='20260401'") is None, 'editing a row that was already there'
assert run_stmt("UPDATE Payments SET Earned=20 WHERE Player='Old Quitter'") is None
assert run_stmt("DELETE FROM Scores WHERE Player='Old Quitter' AND Date='20260401'") is None
assert run_stmt(f"INSERT INTO Payments VALUES ('Old Quitter','20261006',{S},'EOY Skins','Refund',-10)") is None, 'refund'
assert run_stmt(f"INSERT INTO Payments VALUES ('Kitty','20261006',{S},'CTP','Carryover3',3)") is None
assert run_stmt("UPDATE Scores SET Player='New Name' WHERE Player='Real Player'") is None, 'moving rows to a participant is fine'
# a real rename cascade of a switched-off player (Players row renamed first, as the app does) is not blocked; reassigning is
rn = os.path.join(tmp, 'rn.db'); new_db(rn)
assert run_stmt("UPDATE Players SET Player='Old Quitter Jr' WHERE Player='Old Quitter'", rn) is None
assert run_stmt("UPDATE Scores SET Player='Old Quitter Jr' WHERE Player='Old Quitter'", rn) is None, 'rename cascade'
assert run_stmt("UPDATE Payments SET Player='Old Quitter Jr' WHERE Player='Old Quitter'", rn) is None, 'rename cascade (buy-in)'
# nothing from blocked attempts is left behind
c = sqlite3.connect(live)
assert c.execute("SELECT COUNT(*) FROM Scores WHERE Player IN ('Non Playing Admin','Test Account') OR (Player='Viewer Person' AND Date LIKE '2026%')").fetchone()[0] == 0
c.close()

# ── test-account owner: a real admin/developer, not free text / a player / a test account / itself ──
def owner_ok(owner, test='Test Account'):
    new_db(os.path.join(tmp, 'o.db'))
    msg = run_stmt(f"UPDATE Players SET IsTest='Y', TestOwner='{owner}' WHERE Player='Viewer Person'", os.path.join(tmp, 'o.db'))
    return msg is None
assert owner_ok('Real Admin') and owner_ok('Dev Person')
assert not owner_ok('Plain Player Owner'), 'a plain player is not an admin'
assert not owner_ok('Somebody Typed In'), 'free text'
assert not owner_ok(''), 'no owner'
assert not owner_ok('Viewer Person'), 'cannot own itself'
assert not owner_ok('Test Account'), 'another test account cannot be an owner'
msg = None
new_db(os.path.join(tmp, 'o.db'))
msg = run_stmt("UPDATE Players SET IsTest='Y', TestOwner='Nobody' WHERE Player='Viewer Person'", os.path.join(tmp, 'o.db'))
assert msg and 'real admin or developer' in msg

# ── whole-database paths use the SAME rule ──
def derived(sql_list):
    p = os.path.join(tmp, 'incoming.db'); shutil.copy2(live, p)
    c = sqlite3.connect(p)
    for s in sql_list: c.execute(s)
    c.commit(); c.close(); return p
inc = derived([f"INSERT INTO Scores VALUES ('Viewer Person','20261006',{S},38)", f"INSERT INTO Teams VALUES ('Test Account',3,'A',2026,{S})",
               f"INSERT INTO Scores VALUES ('Real Player','20261013',{S},37)"])
rows, invalid = app.participation_check_db(inc, live)
assert sorted((t, p) for _, t, p in rows) == [('Scores', 'Viewer Person'), ('Teams', 'Test Account')], rows
assert not invalid
app.participation_strip(inc, rows)
c = sqlite3.connect(inc)
assert c.execute("SELECT COUNT(*) FROM Scores WHERE Player='Viewer Person' AND Date LIKE '2026%'").fetchone()[0] == 0
assert c.execute("SELECT COUNT(*) FROM Scores WHERE Player='Real Player' AND Date='20261013'").fetchone()[0] == 1, 'real rows in the same save are kept'
c.close()
assert app.participation_check_db(inc, live) == ([], set()), 'clean after the strip'
# flags flipped inside the uploaded file do not bypass it (flagged in the live DB counts)
inc = derived(["UPDATE Players SET Participates='Y' WHERE Player='Viewer Person'", f"INSERT INTO Scores VALUES ('Viewer Person','20261006',{S},38)"])
rows, _ = app.participation_check_db(inc, live); assert [p for _, _, p in rows] == ['Viewer Person']
# history in the file is not an offence; neither is something already in the live DB
inc = derived([f"INSERT INTO Scores VALUES ('Viewer Person','20240601',{S},41)"]); assert app.participation_check_db(inc, live) == ([], set())
assert app.participation_check_db(live, live) == ([], set())
# a bad test-account owner in an uploaded file is refused
inc = derived(["UPDATE Players SET TestOwner='Typed By Hand' WHERE Player='Test Account'"])
assert app.participation_check_db(inc, live)[1] == {'Test Account'}
# no flagged players and no test accounts: fast path, nothing found
clean = os.path.join(tmp, 'clean.db'); new_db(clean)
cc = sqlite3.connect(clean); cc.execute("UPDATE Players SET Participates='Y', IsTest='N', TestOwner=NULL"); cc.commit(); cc.close()
cc = sqlite3.connect(clean); cc.execute(f"INSERT INTO Scores VALUES ('Viewer Person','20261006',{S},38)"); cc.commit(); cc.close()
assert app.participation_check_db(clean, clean) == ([], set())

# ── the routes, end to end (Flask test client) ──
route_live = os.path.join(tmp, 'route.db'); new_db(route_live)
app.DB_PATH = route_live
app.BACKUP_ROOT_DIR = os.path.join(tmp, 'backups'); os.makedirs(app.BACKUP_ROOT_DIR, exist_ok=True)
cl = app.app.test_client(); H = {'X-Save-Token': app.SAVE_TOKEN}
r = cl.post('/run-sql', json={'sql': f"INSERT INTO Scores VALUES ('Viewer Person','20261006',{S},38)"}, headers=H)
assert r.status_code == 403 and r.get_json()['error'] == 'participation' and 'Viewer Person' in r.get_json()['message']
r = cl.post('/run-sql', json={'sql': f"INSERT INTO Scores VALUES ('Real Player','20261006',{S},38)"}, headers=H); assert r.status_code == 200 and r.get_json()['ok']
r = cl.post('/run-sql', json={'sql': "UPDATE Players SET IsTest='Y', TestOwner='Typed' WHERE Player='Viewer Person'"}, headers=H); assert r.status_code == 403
# full-database save: a file with a non-participant row is saved with that row left out, and the reply says so
payload = derived([f"INSERT INTO Scores VALUES ('Test Account','20261006',{S},38)", f"INSERT INTO Scores VALUES ('Legacy Blank','20261006',{S},36)"])
shutil.copy2(route_live, os.path.join(tmp, 'route_before.db'))
r = cl.post('/save', data=open(payload, 'rb').read(), headers=H)
j = r.get_json(); assert r.status_code == 200 and j['ok'], j
assert j['participationStripped'] == [{'table': 'Scores', 'player': 'Test Account'}] and 'Test Account' in j['message']
c = sqlite3.connect(route_live)
assert c.execute("SELECT COUNT(*) FROM Scores WHERE Player='Test Account'").fetchone()[0] == 0
assert c.execute("SELECT COUNT(*) FROM Scores WHERE Player='Legacy Blank' AND Date='20261006'").fetchone()[0] >= 1, 'real rows in the same save are kept'
c.close()
# full save with a hand-typed test owner is refused outright
bad = derived(["UPDATE Players SET TestOwner='Typed By Hand' WHERE Player='Test Account'"])
r = cl.post('/save', data=open(bad, 'rb').read(), headers=H); assert r.status_code == 403 and r.get_json()['error'] == 'participation'
# restoring a backup that would put a non-participant back into this season is refused, and the live DB is untouched
bk = app.backup_dir(); inc = derived([f"INSERT INTO Teams VALUES ('Viewer Person',9,'A',2026,{S})"]); shutil.copy2(inc, os.path.join(bk, 'HughsGolf_20260101_000000.db'))
r = cl.post('/restore-backup', json={'filename': 'HughsGolf_20260101_000000.db'}, headers=H)
assert r.status_code == 409 and r.get_json()['error'] == 'participation', r.get_json()
c = sqlite3.connect(route_live); assert c.execute("SELECT COUNT(*) FROM Teams WHERE Player='Viewer Person' AND Year=2026").fetchone()[0] == 0; c.close()
# a clean backup still restores
shutil.copy2(live, os.path.join(bk, 'HughsGolf_20260102_000000.db'))
r = cl.post('/restore-backup', json={'filename': 'HughsGolf_20260102_000000.db'}, headers=H); assert r.status_code == 200 and r.get_json()['ok'], r.get_json()

# ── schema migration + need-sub (source) ──
old = os.path.join(tmp, 'old.db'); oc = sqlite3.connect(old)
oc.execute("CREATE TABLE Players (Player TEXT, Officer TEXT)"); oc.execute("INSERT INTO Players VALUES ('A','')"); oc.commit(); oc.close()
app.DB_PATH = old
try: app.ensure_schema()
except Exception as e: pass
cols = {r[1] for r in sqlite3.connect(old).execute("PRAGMA table_info(Players)")}
assert {'Participates', 'IsTest', 'TestOwner'} <= cols, cols
assert sqlite3.connect(old).execute("SELECT Participates, IsTest FROM Players").fetchone() == ('Y', 'N')
src = open(os.path.join(here, '..', 'app.py')).read()
assert "COALESCE(Participates,'Y')='N' OR COALESCE(IsTest,'N')='Y'" in src and 'not_participant' in src
# every full-database write path in app.py goes through participation_check_db
for marker in ("def save_db", "def restore_backup", "def refresh_sandbox_from_live"):
    body = src[src.index(marker):src.index('@app.route', src.index(marker))]
    assert 'participation_check_db(' in body, marker
print('ok')
