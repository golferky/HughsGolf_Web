#!/usr/bin/env python3
"""
migrate_changelog.py
────────────────────
Adds the AppChangelog table to the live HughsGolf.db and seeds it
with all historical changelog entries.

Usage:
    python3 migrate_changelog.py /path/to/HughsGolf.db

Run ONCE against the live database. Safe to re-run — it skips seeding
if rows already exist.
"""

import sqlite3
import sys
import os

DB_PATH = sys.argv[1] if len(sys.argv) > 1 else 'HughsGolf.db'

if not os.path.exists(DB_PATH):
    print(f"ERROR: DB not found at {DB_PATH}")
    sys.exit(1)

SEED = [
    # (Version, ReleaseDate, Category, Item, SortOrder)
    # Category: 'enhancement' | 'admin' | 'bugfix' | 'developer'

    # ── August 9, 2026 ──
    ('20260809', 'August 9, 2026', 'enhancement',
     'Help tab added — player guide covering the league, app features, and how-to instructions', 1),
    ('20260809', 'August 9, 2026', 'admin',
     'Help tab includes admin-only section with admin feature guides', 2),
    ('20260809', 'August 9, 2026', 'developer',
     'Sandbox red banner now shows on external sandbox DNS access (hughsgolf-sandbox.duckdns.org)', 3),
    ('20260809', 'August 9, 2026', 'developer',
     'BACKLOG: Individual Statistics tab — player-level season stats (definition TBD)', 4),
    ('20260809', 'August 9, 2026', 'developer',
     'BACKLOG: Direct Messages (DMs) — in-app messaging between players; wire push notifications to cell via NTFY, Pushover, or Twilio when a DM arrives', 5),

    # ── August 8, 2026 ──
    ('20260808', 'August 8, 2026', 'enhancement',
     'Payments tab redesigned with recap cards and collapsible sections (This Week, League Dues, Season Summary)', 1),
    ('20260808', 'August 8, 2026', 'enhancement',
     'This Week section shows Collected, Paid Out, Skin Kitty, and Held mini-cards', 2),
    ('20260808', 'August 8, 2026', 'enhancement',
     'Subs now appear in This Week and Season Summary views', 3),
    ('20260808', 'August 8, 2026', 'enhancement',
     'Click any hole number in the scorecard to see a breakdown of all scores, ties, and skin winners', 4),
    ('20260808', 'August 8, 2026', 'enhancement',
     'Collapse/Expand buttons added to Scores and My Scores cards', 5),
    ('20260808', 'August 8, 2026', 'enhancement',
     '"Skins Only (9 Holes)" bar removed from regular 9-hole rounds', 6),
    ('20260808', 'August 8, 2026', 'enhancement',
     'Need a Sub — players can now request a sub directly from the app', 7),
    ('20260808', 'August 8, 2026', 'admin',
     "Warning popup when assigning winners if any scored players haven't paid in", 8),
    ('20260808', 'August 8, 2026', 'admin',
     'CTP unreconciled alert on Prize Money tab when no winner or carryover was recorded', 9),
    ('20260808', 'August 8, 2026', 'bugfix',
     'Handicap bug fix — projected handicap now calculated correctly', 10),
    ('20260808', 'August 8, 2026', 'developer',
     'Switch User locked to developer role + sandbox only', 11),

    # ── August 7, 2026 ──
    ('20260807', 'August 7, 2026', 'enhancement',
     'Photo scorecard import — snap a pic and auto-fill scores', 1),
    ('20260807', 'August 7, 2026', 'enhancement',
     'Gallus batch import — pull multiple rounds from Gallus at once', 2),
    ('20260807', 'August 7, 2026', 'enhancement',
     'Skins shading improvements on scorecard grid', 3),
]

con = sqlite3.connect(DB_PATH)
cur = con.cursor()

# Create table
cur.execute("""
    CREATE TABLE IF NOT EXISTS AppChangelog (
        ID          INTEGER PRIMARY KEY AUTOINCREMENT,
        Version     TEXT NOT NULL,
        ReleaseDate TEXT NOT NULL,
        Category    TEXT NOT NULL,
        Item        TEXT NOT NULL,
        SortOrder   INTEGER DEFAULT 0
    )
""")
con.commit()
print("✓ AppChangelog table ready")

# Seed only if empty
count = cur.execute("SELECT COUNT(*) FROM AppChangelog").fetchone()[0]
if count > 0:
    print(f"  Skipping seed — {count} rows already present")
else:
    cur.executemany(
        "INSERT INTO AppChangelog (Version, ReleaseDate, Category, Item, SortOrder) VALUES (?,?,?,?,?)",
        SEED
    )
    con.commit()
    print(f"✓ Seeded {len(SEED)} changelog entries")

con.close()
print("Done.")
