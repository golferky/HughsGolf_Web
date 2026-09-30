# Week 1 pot audit (read-only)

`tools/wk1_pot_audit.py` explains exactly how the post-season **Week 1 Skins pot** is counted, using your own
`HughsGolf.db`. It prints:

1. the configured post-season dates (`PostSeasonDt`, `PSWeek2Dt`, `PSWeek1Nine`) and the $7 + $3 weekly entry;
2. every EOY Skins payment row and how the code classifies it (tagged week, legacy `$20` = both weeks, legacy `$10`, unassigned);
3. every EOY refund row and which week it counts for;
4. every score row on the Week 1 date (holes entered, Gross);
5. the reconciliation: paid → refunded → eligible → scored → **pot players**, naming every player who paid but is not in
   the pot (and why) or who scored but is not eligible;
6. the stored Week 1 skin payouts vs what the current data produces (stale or not).

7. **Money walk (sections 7-9)** for whole-dollar skin payouts: EOY collected, the Week 1 pot, stored vs whole-dollar
   payouts (paid rows flagged), the proposed remainder, the current EOY-pool and Skins-kitty arithmetic, exact before/after
   balances if that remainder were moved to the Skins kitty (three representations, each with a verdict: counted twice /
   disappears / counted exactly once), and every existing `Player='Kitty'` Skin row with its Detail and Comment.

## It cannot change anything
It opens the file with SQLite `mode=ro` plus `PRAGMA query_only=ON` and only runs `SELECT` / `PRAGMA table_info`.
The before/after simulation in section 8 writes only to an in-memory copy made with SQLite's backup API; the file is never written.
It never writes, recalculates, refunds, or edits payments, and it does not touch `HughsGolf.html`. At the end it
confirms the file's size and modified time are unchanged. Still, run it on a copy.

## Run it (on the machine that has the sandbox database)

```sh
cp /path/to/sandbox/HughsGolf.db /tmp/HughsGolf-audit-copy.db
python3 tools/wk1_pot_audit.py /tmp/HughsGolf-audit-copy.db 2026
```

- `/path/to/sandbox/HughsGolf.db` is the sandbox's live database file (the `HughsGolf.db` next to `app.py` on the sandbox host).
- The last argument is the season (optional; defaults to the latest season in the database).
- Needs only Python 3 (standard library). Add `> wk1_audit.txt` to save the output.

Read section 5 first: it lists the pot players and each excluded player with the reason.
