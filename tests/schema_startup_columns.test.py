"""Server startup adds the columns the page used to ALTER in on every load; running it again changes nothing."""
import sys; sys.dont_write_bytecode = True
import os, sqlite3, tempfile, importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
app.DB_PATH = os.path.join(tempfile.mkdtemp(), 'HughsGolf.db')
c = sqlite3.connect(app.DB_PATH)
c.executescript("CREATE TABLE Players (Player TEXT, Officer TEXT); CREATE TABLE Payments (League TEXT, Player TEXT, Date TEXT, \"Desc\" TEXT, Detail TEXT, Earned REAL, DatePaid TEXT, Comment TEXT); CREATE TABLE SeasonSettings (League TEXT, Season INTEGER); CREATE TABLE LeagueSettings (League TEXT PRIMARY KEY, DayofWeek TEXT); INSERT INTO LeagueSettings VALUES (\"Hugh's\", 'Tuesday'); CREATE TABLE LogTable (log_time TEXT, level TEXT, method TEXT, source TEXT, text TEXT, details TEXT, created_at TEXT);")
c.commit(); c.close()
cols = lambda t: {r[1] for r in sqlite3.connect(app.DB_PATH).execute(f"PRAGMA table_info({t})")}
app.ensure_schema()
assert 'StartWeek' in cols('LeagueSettings'), cols('LeagueSettings')
assert 'PhotoKey' in cols('Players'), cols('Players')
assert 'PhotoReminders' in cols('Players'), cols('Players')
assert {'ProposedChanges', 'Suggestions'} <= {r[0] for r in sqlite3.connect(app.DB_PATH).execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert 'CellConfirmed' in cols('Players'), cols('Players')
assert {'Carrier', 'Gateway', 'Status', 'ValidatedAt', 'ValidatedBy', 'Note', 'Active'} <= cols('CarrierGateways'), cols('CarrierGateways')
assert sqlite3.connect(app.DB_PATH).execute("SELECT StartWeek FROM LeagueSettings").fetchone()[0] == '2nd', 'existing rows start on the 2nd'
assert {'ChampPlaces', 'StandPlace1', 'StandPlace2', 'StandPlace3', 'Byes'} <= cols('SeasonSettings'), cols('SeasonSettings')
assert {'Version', 'ReleaseDate', 'Category', 'Item', 'Notes', 'AddedBy', 'AddedAt'} <= cols('AppChangelog'), cols('AppChangelog')
d = sqlite3.connect(app.DB_PATH).execute("SELECT sql FROM sqlite_master WHERE name='SeasonSettings'").fetchone()[0]
app.ensure_schema()                                  # second run: no error, nothing added twice
assert sqlite3.connect(app.DB_PATH).execute("SELECT sql FROM sqlite_master WHERE name='SeasonSettings'").fetchone()[0] == d
# an older AppChangelog without Notes / AddedBy gets them
c = sqlite3.connect(app.DB_PATH); c.executescript("DROP TABLE AppChangelog; CREATE TABLE AppChangelog (ID INTEGER PRIMARY KEY AUTOINCREMENT, Version TEXT NOT NULL, ReleaseDate TEXT NOT NULL, Category TEXT NOT NULL, Item TEXT NOT NULL, SortOrder INTEGER DEFAULT 0);"); c.commit(); c.close()
app.ensure_schema(); assert {'Notes', 'AddedBy', 'AddedAt'} <= cols('AppChangelog')
# a database with no SeasonSettings at all is left alone (no crash)
app.DB_PATH = os.path.join(tempfile.mkdtemp(), 'x.db'); _x = sqlite3.connect(app.DB_PATH); _x.executescript('CREATE TABLE Players (Player TEXT); CREATE TABLE Payments (a); CREATE TABLE LogTable (a)'); _x.commit(); _x.close()
app.ensure_schema()
print('ok')
