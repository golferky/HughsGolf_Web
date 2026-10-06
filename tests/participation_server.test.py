"""Server guard: access role and league participation are independent; non-participants cannot get new league rows."""
import os, re, sqlite3, sys, types, importlib.util, tempfile, json

here = os.path.dirname(os.path.abspath(__file__))
os.environ['HUGHSGOLF_PORT'] = '0'
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)

tmp = tempfile.mkdtemp()
dbp = os.path.join(tmp, 'HughsGolf.db')
app.DB_PATH = dbp
con = sqlite3.connect(dbp)
con.executescript("""
CREATE TABLE Players (Player TEXT, Officer TEXT, Participates TEXT DEFAULT 'Y', IsTest TEXT DEFAULT 'N', TestOwner TEXT);
CREATE TABLE Scores (Player TEXT, Date TEXT, League TEXT, Gross INTEGER);
CREATE TABLE Matches (Player TEXT, Date TEXT, Points INTEGER);
CREATE TABLE Teams (Player TEXT, Team INTEGER, Grade TEXT, Year INTEGER, League TEXT);
CREATE TABLE Subs (Player TEXT, Date TEXT, League TEXT);
CREATE TABLE Payments (Player TEXT, Date TEXT, League TEXT, "Desc" TEXT, Detail TEXT, Earned REAL);
INSERT INTO Players VALUES ('Real Player','', 'Y','N',NULL), ('Non Playing Admin','admin','N','N',NULL),
  ('Viewer Person','', 'N','N',NULL), ('Test Account','', 'Y','Y','Real Player'), ('Old Quitter','', 'N','N',NULL),
  ('Legacy Blank','', NULL, NULL, NULL), ('Real Admin','admin','Y','N',NULL);
INSERT INTO Scores VALUES ('Old Quitter','20250101','Hugh''s',40);   -- history already on file for someone now switched off
""")
con.commit(); con.close()

blocked = lambda sql: app._participation_table_for(sql)
# statement classification
assert blocked("INSERT INTO Scores (Player) VALUES ('x')") == 'scores'
assert blocked("UPDATE Teams SET Team=3 WHERE Player='x'") == 'teams'
assert blocked("INSERT OR REPLACE INTO Subs (Player) VALUES ('x')") == 'subs'
assert blocked("DELETE FROM Scores WHERE Player='x'") is None, 'deletes are never blocked'
assert blocked("UPDATE Scores SET Player='New Name' WHERE Player='Old Name'") is None, 'rename cascade is not blocked'
assert blocked("INSERT INTO Players (Player) VALUES ('x')") is None, 'the Players table itself is not guarded'

def attempt(sql):
    """Run a statement the way /run-sql does; return the names blocked (empty set = allowed)."""
    c = sqlite3.connect(dbp); cur = c.cursor()
    tab = app._participation_table_for(sql) if app._participation_active(cur) else None
    before = app._nonparticipant_rows(cur, tab) if tab else None
    cur.execute(sql)
    new = (app._nonparticipant_rows(cur, tab) - before) if tab else set()
    if new: c.rollback()
    else: c.commit()
    c.close()
    return {n for _, n in new}

# real participants (including a real admin and someone with blank flags) are allowed everywhere
for who in ('Real Player', 'Real Admin', 'Legacy Blank'):
    assert attempt(f"INSERT INTO Scores VALUES ('{who}','20261006','Hugh''s',38)") == set(), who
    assert attempt(f"INSERT INTO Teams VALUES ('{who}',1,'A',2026,'Hugh''s')") == set(), who
# non-playing admin, viewer and test account are blocked in every guarded table
for who in ('Non Playing Admin', 'Viewer Person', 'Test Account'):
    assert attempt(f"INSERT INTO Scores VALUES ('{who}','20261006','Hugh''s',38)") == {who}, who
    assert attempt(f"INSERT INTO Matches VALUES ('{who}','20261006',3)") == {who}
    assert attempt(f"INSERT INTO Teams VALUES ('{who}',1,'A',2026,'Hugh''s')") == {who}
    assert attempt(f"INSERT INTO Subs VALUES ('{who}','20261006','Hugh''s')") == {who}
    assert attempt(f"INSERT INTO Payments VALUES ('{who}','20261006','Hugh''s','EOY Skins','Payment',10)") == {who}, 'buy-in blocked'
# refunds / winnings rows and the kitty pseudo-player are not buy-ins and are allowed
assert attempt("INSERT INTO Payments VALUES ('Old Quitter','20261006','Hugh''s','EOY Skins','Refund',-10)") == set(), 'a refund to someone already paid in'
assert attempt("INSERT INTO Payments VALUES ('Kitty','20261006','Hugh''s','CTP','Carryover3',3)") == set()
# the rolled-back attempts left nothing behind
c = sqlite3.connect(dbp)
assert c.execute("SELECT COUNT(*) FROM Scores WHERE Player IN ('Non Playing Admin','Viewer Person','Test Account')").fetchone()[0] == 0
# history for someone switched off is untouched, and editing it is allowed (no NEW non-participant row)
assert c.execute("SELECT COUNT(*) FROM Scores WHERE Player='Old Quitter'").fetchone()[0] == 1
c.close()
assert attempt("UPDATE Scores SET Gross=41 WHERE Player='Old Quitter'") == set(), 'editing existing history is allowed'
# fast path: with nobody flagged the guard does no work
c = sqlite3.connect(dbp); c.execute("UPDATE Players SET Participates='Y', IsTest='N'"); c.commit()
assert app._participation_active(c.cursor()) is False
c.close()
# schema migration adds the three columns to an old DB, defaulting everyone to a playing, non-test player
old = os.path.join(tmp, 'old.db'); oc = sqlite3.connect(old)
oc.execute("CREATE TABLE Players (Player TEXT, Officer TEXT)"); oc.execute("INSERT INTO Players VALUES ('A','')"); oc.commit(); oc.close()
app.DB_PATH = old
try: app.ensure_schema()
except Exception as e: print('ensure_schema note:', e)
cols = {r[1] for r in sqlite3.connect(old).execute("PRAGMA table_info(Players)")}
assert {'Participates', 'IsTest', 'TestOwner'} <= cols, cols
assert sqlite3.connect(old).execute("SELECT Participates, IsTest FROM Players").fetchone() == ('Y', 'N')
# need-sub refuses a non-participant recipient (source check)
src = open(os.path.join(here, '..', 'app.py')).read()
assert "COALESCE(Participates,'Y')='N' OR COALESCE(IsTest,'N')='Y'" in src and 'not_participant' in src
print('ok')
