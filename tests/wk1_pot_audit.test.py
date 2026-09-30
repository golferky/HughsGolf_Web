#!/usr/bin/env python3
"""Test for tools/wk1_pot_audit.py (audit-only tool): builds a synthetic database, runs the audit and checks
the Week 1 money walk, the $1 transfer verdicts, the Kitty-row listing and that the database file is unchanged.
Run: python3 tests/wk1_pot_audit.test.py"""
import hashlib, os, sqlite3, subprocess, sys, tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
TOOL = os.path.join(ROOT, "tools", "wk1_pot_audit.py")

tmp = tempfile.mkdtemp()
db = os.path.join(tmp, "audit.db")
c = sqlite3.connect(db)
c.executescript('''
CREATE TABLE SeasonSettings (League TEXT, Season INT, PostSeasonDt TEXT, PSWeek2Dt TEXT, PSWeek1Nine TEXT, SkinsPS REAL, ClosestPS REAL, EOYSkins REAL);
CREATE TABLE Payments (League TEXT, Player TEXT, Date INT, "Desc" TEXT, Detail TEXT, Earned REAL, DatePaid TEXT, Comment TEXT);
CREATE TABLE Scores (League TEXT, Player TEXT, Date INT, FrontBack TEXT, Gross INT, Net INT,
  "1" INT, "2" INT, "3" INT, "4" INT, "5" INT, "6" INT, "7" INT, "8" INT, "9" INT);
INSERT INTO SeasonSettings VALUES ("Hugh's", 2026, '9/22/2026', NULL, 'Front', 7, 3, 20);
''')
P = lambda *a: c.execute('INSERT INTO Payments VALUES ("Hugh\'s",?,?,?,?,?,?,?)', a)
for i in range(19):                                   # 19 players paid $10 for week 1 and scored
    name = f"Player{i:02d}"
    P(name, 20260922, "EOY Skins", "Payment", 10, "x", "(1st Week)")
    c.execute('INSERT INTO Scores VALUES ("Hugh\'s",?,20260922,"Front",40,36,4,4,4,4,4,4,4,4,4)', (name,))
for hole, who in (("#3", "Player00"), ("#7", "Player01"), ("#9", "Player02")):   # 3 skins at 44.33 (133 / 3 rounded)
    P(who, 20260922, "Skin", hole, 44.33, None, "")
P("Player05", 20260908, "Skin", "Payment", 2, "x", "")                          # regular-season kitty money
P("Kitty", 20260908, "Skin", "Carryover", 6, "x", "regular carryover")          # an existing Skin/Kitty row
c.commit(); c.close()

before = hashlib.sha256(open(db, "rb").read()).hexdigest()
out = subprocess.run([sys.executable, TOOL, db, "2026"], capture_output=True, text=True)
assert out.returncode == 0, out.stderr
o = out.stdout
after = hashlib.sha256(open(db, "rb").read()).hexdigest()
assert before == after, "audit modified the database file"
assert "Read-only: no writes were made" in o and "unchanged" in o

def has(s): assert s in o, f"missing in audit output: {s!r}\n{o[-3500:]}"
has("Week 1 paid players in the pot: 19  x $7 Skins = pot $133.00")
has("skins won (stored rows): 3")
has("each = floor($133.00 / 3) = $44.00;  total paid $132.00")
has("PROPOSED remainder to Skins kitty: $1.00")
has("no payout exceeds the pot: OK")
has("unpaid - safe to restate")
# $1 transfer verdicts under the CURRENT formulas
a = o.index("Option A   "); a2 = o.index("Option A2  "); b = o.index("Option B   ")
assert "DISAPPEARS from the kitty" in o[a:a2]
assert "COUNTED TWICE" in o[a2:b]
assert "COUNTED EXACTLY ONCE" in o[b:]
# Existing Kitty rows listed with Detail/Comment; the new Detail does not collide; a new row on a PS date would read as carryover
has("Detail='Carryover'")
has("Comment='regular carryover'")
has("would Detail 'PS Skin Remainder' collide with an existing Detail? no")
has("WOULD be shown as 'Carryover to next week'")
# current formulas: 19 x... skin kitty = regular collected 2 - 0 paid out (post-season winners excluded) - 0 = $2.00
has("Skins kitty $2.00")

# a PAID row must be flagged as not editable
c = sqlite3.connect(db); c.execute("UPDATE Payments SET DatePaid='9/29/2026' WHERE Detail='#3'"); c.commit(); c.close()
o = subprocess.run([sys.executable, TOOL, db, "2026"], capture_output=True, text=True).stdout
assert "PAID - must NOT be edited" in o
print("ok")
