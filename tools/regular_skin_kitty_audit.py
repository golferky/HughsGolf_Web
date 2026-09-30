#!/usr/bin/env python3
"""
READ-ONLY audit of regular-season Skin payouts against the whole-dollar (round DOWN) rule.

It lists every "questionable" payout: a stored winner row whose amount is MORE than
floor(week collected / number of winners). For each one it reports the row ID, date, player, hole, amount, DatePaid
status, the calculated floor amount and the difference, then totals.

Safety: the database path must be supplied explicitly (there is no default and no environment lookup). The file is
opened with SQLite read-only + immutable (file:...?mode=ro&immutable=1) plus PRAGMA query_only=ON, and only SELECT /
PRAGMA statements are run, so it cannot write, recalculate, refund or modify anything, and SQLite creates no journal,
-wal or -shm side files. Output goes to the terminal only. Run it on a COPY of the database (single .db file).

Usage:
    python3 tools/regular_skin_kitty_audit.py /path/to/copy-of-HughsGolf.db
    python3 tools/regular_skin_kitty_audit.py /path/to/copy-of-HughsGolf.db --season 2026
    python3 tools/regular_skin_kitty_audit.py /path/to/copy-of-HughsGolf.db --dates 20260414,20260519

Definitions (mirroring HughsGolf.html):
    collected = SUM(Earned) of Desc='Skin' Detail='Payment' rows for the date
    winners   = Desc='Skin' Detail like '#%' rows (Player != 'Kitty') for the date (one row per won hole)
    floor     = floor(collected / winners)         (whole dollars; any remainder stays in the kitty)
    difference= amount - floor                     (> 0 means the row was paid more than the rule allows)
    DatePaid  = empty  -> UNPAID: the row could still be corrected;   set -> PAID: historical, must stay as recorded
    Post-season dates (SeasonSettings.PostSeasonDt and +7 days / PSWeek2Dt) are skipped: they follow different rules.
The floor is computed from the collected amount and winner count as they are in the database now.
"""
import argparse, datetime, math, sqlite3, sys
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(description="Read-only regular-season Skin kitty audit (whole-dollar floor rule).",
                                 epilog="The database path is required. Use a COPY of the database.")
    ap.add_argument("db", help="explicit path to a COPY of HughsGolf.db (required)")
    ap.add_argument("--season", type=int, help="season year (default: latest season in the database)")
    ap.add_argument("--dates", help="comma-separated YYYYMMDD dates to check (default: every regular-season date)")
    a = ap.parse_args()

    db_file = Path(a.db).expanduser()
    if not db_file.is_file():
        sys.exit(f"Database file not found: {db_file}")
    side = lambda: sorted(p.name for p in db_file.parent.glob(db_file.name + "-*"))
    before = (db_file.stat().st_size, db_file.stat().st_mtime_ns, side())

    con = sqlite3.connect(f"{db_file.resolve().as_uri()}?mode=ro&immutable=1", uri=True)
    con.execute("PRAGMA query_only=ON")
    con.row_factory = sqlite3.Row
    q = lambda sql, p=(): [dict(r) for r in con.execute(sql, p)]
    tables = {r["name"] for r in q("SELECT name FROM sqlite_master WHERE type='table'")}
    for need in ("Payments", "SeasonSettings"):
        if need not in tables:
            sys.exit(f"Not a HughsGolf database: table {need} is missing.")

    season = a.season or q("SELECT MAX(Season) s FROM SeasonSettings")[0]["s"]
    ss = q('SELECT * FROM SeasonSettings WHERE League="Hugh\'s" AND Season=?', (season,))
    ps_dates = set()
    if ss and ss[0].get("PostSeasonDt"):
        def mdy(s):
            m, d, y = [int(x) for x in str(s).split("/")]
            return y * 10000 + m * 100 + d
        w1 = mdy(ss[0]["PostSeasonDt"])
        w2o = mdy(ss[0]["PSWeek2Dt"]) if ss[0].get("PSWeek2Dt") else None
        t = datetime.date(w1 // 10000, w1 // 100 % 100, w1 % 100) + datetime.timedelta(days=7)
        ps_dates = {w1, w2o if (w2o and w2o > w1) else t.year * 10000 + t.month * 100 + t.day}
    lo, hi = season * 10000 + 101, (season + 1) * 10000 + 101

    money = lambda v: ("-" if v < 0 else "") + "$" + f"{abs(v):,.2f}"
    if a.dates:
        dates = [int(d) for d in a.dates.split(",") if d.strip()]
    else:
        dates = [r["d"] for r in q("""SELECT DISTINCT CAST(Date AS INTEGER) d FROM Payments WHERE League="Hugh's" AND "Desc"='Skin'
                                      AND Detail LIKE '#%' AND Player!='Kitty' AND CAST(Date AS INTEGER) >= ? AND CAST(Date AS INTEGER) < ? ORDER BY d""", (lo, hi))]
    dates = [d for d in dates if d not in ps_dates]

    def rule_that_matches(collected, n, each):
        if not n: return "-"
        raw = collected / n
        if abs(raw - round(raw)) < 1e-9: return "exact"
        hits = [name for name, v in (("floor", math.floor(raw)), ("ceil", math.ceil(raw)), ("round-to-nearest", math.floor(raw + 0.5)), ("cents", round(raw, 2)))
                if abs(each - v) < 0.005]
        return "/".join(hits) or "other"

    print("=" * 110)
    print(f"REGULAR-SEASON SKIN PAYOUT AUDIT (read-only)   database: {db_file}   season: {season}")
    print(f"Post-season dates skipped: {sorted(ps_dates) or 'none'}     weeks checked: {len(dates)}")
    print("=" * 110)

    rows_out, weeks = [], []
    for d in dates:
        c = q("""SELECT COALESCE(SUM(CAST(Earned AS REAL)),0) t, COUNT(*) n FROM Payments WHERE League="Hugh's" AND "Desc"='Skin'
                 AND Detail='Payment' AND CAST(Date AS INTEGER)=?""", (d,))[0]
        w = q("""SELECT rowid AS ID, Player, Detail, CAST(Earned AS REAL) Earned, COALESCE(DatePaid,'') DatePaid FROM Payments
                 WHERE League="Hugh's" AND "Desc"='Skin' AND Detail LIKE '#%' AND Player!='Kitty' AND CAST(Date AS INTEGER)=?
                 ORDER BY CAST(REPLACE(Detail,'#','') AS INTEGER), rowid""", (d,))
        if not w: continue
        n = len(w); floor_each = math.floor(c["t"] / n + 1e-9); paid_out = sum(r["Earned"] for r in w)
        bad = [r for r in w if r["Earned"] - floor_each > 0.005]
        if not bad: continue
        weeks.append(dict(date=d, collected=c["t"], n=n, paid_out=paid_out, floor_each=floor_each, floor_total=floor_each * n,
                          rule=rule_that_matches(c["t"], n, w[0]["Earned"]), bad=len(bad)))
        for r in bad:
            rows_out.append(dict(ID=r["ID"], date=d, player=r["Player"], hole=r["Detail"], amount=r["Earned"], paid=r["DatePaid"] != "",
                                 datepaid=r["DatePaid"], floor=floor_each, diff=r["Earned"] - floor_each))

    print("\nQUESTIONABLE PAYOUTS (amount is more than the whole-dollar floor)")
    if not rows_out:
        print("  none found")
    else:
        print(f"  {'row ID':<8}{'date':<10}{'player':<22}{'hole':<6}{'amount':>9}  {'DatePaid':<22}{'floor':>8}{'diff':>8}  status")
        for r in rows_out:
            print(f"  {r['ID']:<8}{r['date']:<10}{r['player']:<22}{r['hole']:<6}{money(r['amount']):>9}  "
                  f"{(r['datepaid'] or '(unpaid)'):<22}{money(r['floor']):>8}{money(r['diff']):>8}  "
                  + ("PAID - historical, must stay as recorded" if r["paid"] else "UNPAID - could be corrected to the floor"))

    print("\nPER-WEEK SUMMARY (weeks with at least one questionable payout)")
    if weeks:
        print(f"  {'date':<10}{'collected':>10}{'winners':>8}{'paid out':>10}{'floor each':>11}{'floor total':>12}{'overpaid':>9}  stored amount matches")
        for k in weeks:
            print(f"  {k['date']:<10}{money(k['collected']):>10}{k['n']:>8}{money(k['paid_out']):>10}{money(k['floor_each']):>11}"
                  f"{money(k['floor_total']):>12}{money(k['paid_out'] - k['floor_total']):>9}  {k['rule']}")

    tot = lambda pred: round(sum(r["diff"] for r in rows_out if pred(r)), 2)
    unpaid, paid = [r for r in rows_out if not r["paid"]], [r for r in rows_out if r["paid"]]
    kitty = None
    if dates or not a.dates:
        coll = q("""SELECT COALESCE(SUM(CAST(Earned AS REAL)),0) t FROM Payments WHERE League="Hugh's" AND "Desc"='Skin' AND Detail='Payment'
                    AND CAST(Date AS INTEGER) >= ? AND CAST(Date AS INTEGER) < ?""", (lo, hi))[0]["t"]
        pay = q("""SELECT COALESCE(SUM(CAST(Earned AS REAL)),0) t FROM Payments WHERE League="Hugh's" AND "Desc"='Skin' AND Detail LIKE '#%'
                   AND Player!='Kitty' AND CAST(Date AS INTEGER) >= ? AND CAST(Date AS INTEGER) < ?""" + (f" AND CAST(Date AS INTEGER) NOT IN ({','.join(str(x) for x in sorted(ps_dates))})" if ps_dates else ""), (lo, hi))[0]["t"]
        xf = q("""SELECT COALESCE(SUM(CAST(Earned AS REAL)),0) t FROM Payments WHERE League="Hugh's" AND "Desc"='Skin' AND Detail='Pool Transfer'
                  AND CAST(Date AS INTEGER) >= ? AND CAST(Date AS INTEGER) < ?""", (lo, hi))[0]["t"]
        kitty = round(coll - pay - xf, 2)
    print("\nTOTALS")
    print(f"  questionable payout rows : {len(rows_out)}   ({len(unpaid)} unpaid, {len(paid)} paid)   in {len(weeks)} week(s)")
    print(f"  total difference vs floor: {money(tot(lambda r: True))}")
    print(f"    on UNPAID rows (could still be corrected): {money(tot(lambda r: not r['paid']))}")
    print(f"    on PAID rows (historical, cannot be changed): {money(tot(lambda r: r['paid']))}")
    if kitty is not None:
        print(f"  Skin kitty as the Prize Money tile computes it now: {money(kitty)}   (collected - winnings paid out - pool transfers, post-season excluded)")
        print(f"    informational only - if every questionable row were at the floor: {money(kitty + tot(lambda r: True))};"
              f" if only the unpaid rows were: {money(kitty + tot(lambda r: not r['paid']))}")

    if "DbChangeLog" in tables and rows_out:
        try:
            print("\nCHANGE-LOG ENTRIES that mention these dates (DbChangeLog, if the app recorded any)")
            seen = False
            for d in sorted({r["date"] for r in rows_out}):
                for x in q("SELECT changed_at, actor, action, summary, source, version FROM DbChangeLog WHERE table_name='Payments' AND (record_key LIKE ? OR summary LIKE ?) ORDER BY id", (f"%{d}%", f"%{d}%")):
                    seen = True; print(f"  {d}  {x['changed_at']}  {x['actor']}  {x['action']}  {x['summary']}  ({x['source']} {x['version']})")
            if not seen: print("  none")
        except sqlite3.Error as e:
            print(f"  (change log not readable: {e})")

    con.close()
    after = (db_file.stat().st_size, db_file.stat().st_mtime_ns, side())
    print("\n" + ("Read-only: no writes were made (file size, modified time and side files unchanged)."
                  if after == before else "WARNING: the database file or its side files changed while this ran (not by this script)."))


if __name__ == "__main__":
    main()
