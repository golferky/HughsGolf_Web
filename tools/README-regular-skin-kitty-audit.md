# Regular-season Skin kitty audit (read-only)

`tools/regular_skin_kitty_audit.py` finds regular-season Skin winner payouts that are **more than the whole-dollar
(round-down) rule allows**, so you can review them before deciding anything. It is a report only.

For every questionable payout it prints: **row ID, date, player, hole, amount, DatePaid status, the calculated floor
amount, and the difference**, marked `UNPAID - could be corrected` or `PAID - historical, must stay as recorded`. Then it
prints a per-week summary (collected, winners, paid out, floor, which rule the stored amount matches, e.g. `ceil`) and
totals: rows, total difference, and how much of it is on unpaid vs paid rows, plus the Skin kitty as the Prize Money tile
computes it.

The floor for a week is `floor(collected / number of winners)`, where *collected* is the week's Skin buy-ins and
*winners* is the number of stored winner rows. Post-season dates are skipped.

## It cannot change anything
- The database path is **required**; there is no default and no environment lookup.
- The file is opened read-only and immutable (`mode=ro&immutable=1`) with `PRAGMA query_only=ON`, and only `SELECT` /
  `PRAGMA` statements run. No data writes, no recalculation, no refunds, and SQLite creates no journal / `-wal` / `-shm`
  side files. Output is printed to the terminal only (redirect it yourself if you want a file).
- At the end it confirms the database file's size, modified time and side files are unchanged.
- It does not touch `HughsGolf.html`, payments, balances or payouts.

## Run it (on the machine that has the sandbox database)
Make a copy of the single `.db` file first (the audit is read-only anyway; the copy is just a safety habit):

```sh
cp /path/to/sandbox/HughsGolf.db /tmp/HughsGolf-audit-copy.db
python3 tools/regular_skin_kitty_audit.py /tmp/HughsGolf-audit-copy.db
```

Optional arguments: `--season 2026` (default: latest season) and `--dates 20260414,20260519,...` (default: every
regular-season date). Add `> skin_audit.txt` to save the report. Python 3 standard library only.
