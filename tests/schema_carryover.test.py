"""ensure_schema adds SeasonSettings.Carryover (the League Settings form has a Carryover field; the missing column broke the season save)."""
import sys; sys.dont_write_bytecode = True
import os, sqlite3, tempfile, importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py')); app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
tmp = tempfile.mkdtemp(); db = os.path.join(tmp, 'x.db'); app.DB_PATH = db
c = sqlite3.connect(db)
c.executescript("CREATE TABLE Players (Player TEXT, Officer TEXT); CREATE TABLE SeasonSettings (League TEXT, Season INTEGER, Cost REAL, ChampPlaces INTEGER); INSERT INTO SeasonSettings VALUES ('Hugh''s', 2026, 45, 3);")
c.commit(); c.close()
cols = lambda: {r[1] for r in sqlite3.connect(db).execute("PRAGMA table_info(SeasonSettings)")}
assert 'Carryover' not in cols()
app.ensure_schema(); assert 'Carryover' in cols()
assert sqlite3.connect(db).execute("SELECT Cost, ChampPlaces, Carryover FROM SeasonSettings").fetchone() == (45, 3, None), 'existing values untouched'
app.ensure_schema(); assert 'Carryover' in cols(), 'running it again is harmless'
# the statement the sandbox rejected now succeeds
sqlite3.connect(db).execute("UPDATE SeasonSettings SET Cost='45',Carryover='',ChampPlaces='2' WHERE Season='2026'")
# a database with no SeasonSettings table at all is left alone
db2 = os.path.join(tmp, 'y.db'); sqlite3.connect(db2).executescript("CREATE TABLE Players (Player TEXT, Officer TEXT);"); app.DB_PATH = db2; app.ensure_schema()
print('ok')
