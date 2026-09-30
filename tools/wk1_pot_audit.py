#!/usr/bin/env python3
"""
READ-ONLY audit of the post-season Week 1 Skins pot.

Nothing is written, recalculated, refunded or modified: the database is opened with SQLite's read-only mode
(file:...?mode=ro) plus PRAGMA query_only=ON, and the script only runs SELECT / PRAGMA table_info statements.
Run it against a COPY of the database anyway (see tools/README-wk1-pot-audit.md).

Usage:   python3 tools/wk1_pot_audit.py /path/to/copy-of-HughsGolf.db [season]      (season defaults to the latest)

It replays the exact rules in HughsGolf.html:
  * getPostSeasonWeekEntry / computeEoyGrossByWeek / getEoyRefundsByPlayer / getEoySkinPlayersForWeek
      -> who is "eligible" for Week 1 (paid for the week, less refunds for the week)
  * calcEoySkins
      -> Week 1 pot = (eligible players with >=1 hole score on the Week 1 date) x SkinsPS,
         payout per skin = pot / number of stored Week 1 skin rows
and prints every payer, refund, score row and the exact reason a player is (not) in the pot.

Sections 7-9 add the Week 1 MONEY WALK used to design the whole-dollar payout / Skins-kitty change:
  7. EOY collected, Week 1 pot, stored vs whole-dollar payouts, remainder, current EOY-pool and Skins-kitty math
  8. exact before/after balances if the remainder were moved to the Skins kitty (simulated on an IN-MEMORY copy,
     never on the file) and whether that dollar is counted twice, disappears, or is counted exactly once
  9. every existing Player='Kitty' Skin row (Detail / Comment) and what the "carryover" readers would show for the
     post-season dates, so a new remainder row cannot be mistaken for a regular carryover
"""
import os, sqlite3, sys, datetime
from pathlib import Path

if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
    print(__doc__); sys.exit(0 if len(sys.argv) > 1 else 2)
db_file = Path(sys.argv[1]).expanduser()
if not db_file.is_file():
    sys.exit(f"Database file not found: {db_file}")
_fingerprint = (db_file.stat().st_size, db_file.stat().st_mtime_ns)      # proves at the end that nothing changed

con = sqlite3.connect(f"{db_file.resolve().as_uri()}?mode=ro", uri=True)   # read-only open
con.execute("PRAGMA query_only=ON")                                          # belt and braces: any write raises
con.row_factory = sqlite3.Row
q = lambda sql, p=(): [dict(r) for r in con.execute(sql, p)]
cols = lambda t: [r["name"] for r in con.execute(f"PRAGMA table_info({t})")]

season = int(sys.argv[2]) if len(sys.argv) > 2 else q("SELECT MAX(Season) s FROM SeasonSettings")[0]["s"]
ss = q('SELECT * FROM SeasonSettings WHERE League="Hugh\'s" AND Season=?', (season,))[0]

def mdy_to_int(s):
    if not s: return None
    m, d, y = [int(x) for x in str(s).split("/")]
    return y * 10000 + m * 100 + d
def add_days(s, n):
    m, d, y = [int(x) for x in str(s).split("/")]
    t = datetime.date(y, m, d) + datetime.timedelta(days=n)
    return f"{t.month}/{t.day}/{t.year}"

week1 = mdy_to_int(ss["PostSeasonDt"])
w2o = mdy_to_int(ss.get("PSWeek2Dt")) if "PSWeek2Dt" in ss else None
week2 = w2o if (w2o and w2o > week1) else mdy_to_int(add_days(ss["PostSeasonDt"], 7))
week1_nine = str(ss.get("PSWeek1Nine") or "Front").strip().upper()
week1_nine = "Back" if week1_nine in ("BACK", "B") else "Front"
skin = float(ss.get("SkinsPS") or 7); ctp = float(ss.get("ClosestPS") or 3)
weekamt = round(skin + ctp, 2); eoy = float(ss.get("EOYSkins") or 20)

print("=" * 78)
print(f"1. CONFIGURED POST-SEASON  (season {season})")
print(f"   SeasonSettings.PostSeasonDt = {ss['PostSeasonDt']!r}   PSWeek2Dt = {ss.get('PSWeek2Dt')!r}   PSWeek1Nine = {week1_nine}")
print(f"   => Week 1 date {week1}   Week 2 date {week2}")
print(f"   SkinsPS=${skin:g}  ClosestPS=${ctp:g}  weekly entry=${weekamt:g}  EOYSkins=${eoy:g}  (refund/payment rule needs weekly entry == EOYSkins/2 = ${eoy/2:g}: {'OK' if abs(weekamt-eoy/2)<.005 else 'MISMATCH'})")

def weeks_from_comment(c):
    c = (c or "").lower()
    w1 = any(k in c for k in ("1st", "first", "week 1", "wk 1"))
    w2 = any(k in c for k in ("2nd", "second", "week 2", "wk 2"))
    if "both" in c or (w1 and w2): return [1, 2]
    return [1] if w1 else [2] if w2 else []

pays = q('''SELECT rowid AS ID, Player, CAST(Earned AS REAL) Earned, COALESCE(Comment,'') Comment, DatePaid
            FROM Payments WHERE League="Hugh's" AND "Desc"='EOY Skins' AND Detail='Payment' AND CAST(Earned AS REAL)>0
            AND Date >= ? AND Date < ? ORDER BY Player, rowid''', (season * 10000 + 101, (season + 1) * 10000 + 101))
scored_by_date = {}
for w, d in ((1, week1), (2, week2)):
    scored_by_date[w] = {r["Player"] for r in q(
        'SELECT DISTINCT Player FROM Scores WHERE League="Hugh\'s" AND CAST(Date AS INTEGER)=? AND COALESCE(CAST(Gross AS REAL),0)>0', (d,))}

# ---- classify every EOY payment row exactly like computeEoyGrossByWeek
week_paid, why, legacy_single = {}, {}, []
def wp(p): return week_paid.setdefault(p, {1: 0.0, 2: 0.0})
print("=" * 78); print("2. EVERY EOY SKINS PAYMENT ROW AND HOW THE CODE CLASSIFIES IT")
for r in pays:
    wks = weeks_from_comment(r["Comment"]); e = r["Earned"]; note = ""
    if not wks:
        if abs(e - 2 * weekamt) < .005: x = wp(r["Player"]); x[1] += weekamt; x[2] += weekamt; note = "legacy untagged $20 -> BOTH weeks"
        elif abs(e - weekamt) < .005: legacy_single.append(r); note = "legacy untagged $10 -> only the week the player scores in"
        else: note = f"UNASSIGNED (untagged ${e:g}) -> counts for NO week"
    elif abs(e - weekamt * len(wks)) > .005: note = f"UNASSIGNED (tagged {wks} but ${e:g}) -> counts for NO week"
    else:
        x = wp(r["Player"])
        for w in wks: x[w] += weekamt
        note = f"tagged weeks {wks}"
    r["note"] = note
    print(f"   {r['Player']:<24} ${e:>6.2f}  comment={r['Comment']!r:<18} {note}")
for r in legacy_single:
    x = wp(r["Player"])
    wk = next((w for w in (1, 2) if r["Player"] in scored_by_date[w] and x[w] < weekamt - .005), None)
    if wk: x[wk] += weekamt
    r["note"] += f"  => resolved to week {wk}" if wk else "  => no score in either week yet: in NO pool"
    print(f"   (legacy $10) {r['Player']:<20} {r['note']}")

gross1 = sorted(p for p, v in week_paid.items() if v[1] >= weekamt - .005)
print(f"\n   Week 1 GROSS payers (paid for week 1, ignoring refunds): {len(gross1)}")

# ---- refunds exactly like getEoyRefundsByPlayer
print("=" * 78); print("3. EVERY EOY REFUND ROW")
refunds = {}
for r in q('''SELECT Player, Date, CAST(Earned AS REAL) Earned, COALESCE(Comment,'') Comment FROM Payments
              WHERE League="Hugh's" AND "Desc"='EOY Skins' AND Detail='Refund' AND Date >= ? AND Date < ?''',
           (season * 10000 + 101, (season + 1) * 10000 + 101)):
    amt = abs(r["Earned"]); d = int(r["Date"]); c = r["Comment"].lower()
    e = refunds.setdefault(r["Player"], {1: 0.0, 2: 0.0})
    if d == week2: e[2] += amt; att = "week 2 (dated week 2)"
    elif d == week1:
        if "both" in c or ("week 1" not in c and "week 2" not in c and amt >= 2 * weekamt - .005): e[1] += amt / 2; e[2] += amt / 2; att = "split across both weeks"
        elif "week 2" in c and "week 1" not in c: e[2] += amt; att = "week 2 (by comment)"
        else: e[1] += amt; att = "week 1"
    else: att = "dated outside the post-season dates (counts toward no week)"
    print(f"   {r['Player']:<24} date={d} ${r['Earned']:>7.2f}  comment={r['Comment']!r}  -> {att}")
if not refunds: print("   (none)")

eligible1 = sorted(p for p in gross1 if week_paid[p][1] - refunds.get(p, {1: 0})[1] >= weekamt - .005)

# ---- scores on the Week 1 date, by BOTH criteria used in the code
print("=" * 78); print(f"4. SCORES ON WEEK 1 DATE {week1}")
hole_cols = [c for c in cols("Scores") if c in list("123456789")]
rows = q(f'SELECT Player, FrontBack, Gross, Net, {",".join(chr(34)+c+chr(34) for c in hole_cols)} FROM Scores WHERE League="Hugh\'s" AND CAST(Date AS INTEGER)=?', (week1,))
calc_scorers = {r["Player"] for r in rows if any(r[c] is not None for c in hole_cols)}          # calcEoySkins: any hole non-null
gross_scorers = {r["Player"] for r in rows if (r["Gross"] or 0) > 0}                              # no-show/refund test: Gross > 0
for r in sorted(rows, key=lambda r: r["Player"]):
    holes = sum(1 for c in hole_cols if r[c] is not None)
    print(f"   {r['Player']:<24} {r['FrontBack'] or '?':<6} holes entered={holes}  Gross={r['Gross']}  Net={r['Net']}")
print(f"\n   players with >=1 hole (calcEoySkins rule): {len(calc_scorers)}   players with Gross>0 (no-show rule): {len(gross_scorers)}")

# ---- the reconciliation
print("=" * 78); print("5. WHERE THE COUNT COMES FROM")
paid_all = sorted({r["Player"] for r in pays})
print(f"   distinct EOY payers this season: {len(paid_all)}")
print(f"   Week 1 gross payers: {len(gross1)}   refunded for week 1: {sorted(p for p in gross1 if p not in eligible1)}")
print(f"   Week 1 ELIGIBLE (what the Skins tab counts x ${skin:g}): {len(eligible1)}")
pot_players = sorted(p for p in eligible1 if p in calc_scorers)
print(f"   Week 1 POT PLAYERS used by calcEoySkins (eligible AND >=1 hole score): {len(pot_players)}  -> pot ${len(pot_players)*skin:g}")
print("\n   Eligible but NO score on week 1 (no-shows; excluded from the pot):", sorted(p for p in eligible1 if p not in calc_scorers) or "none")
print("   Scored on week 1 but NOT eligible (excluded from the pot):")
for p in sorted(calc_scorers - set(eligible1)):
    if p in week_paid or any(r["Player"] == p for r in pays):
        reason = []
        if week_paid.get(p, {1: 0})[1] < weekamt - .005: reason.append("EOY payment does not count for week 1 (see section 2: tagged week 2 / unassigned / legacy $10 resolved elsewhere)")
        if refunds.get(p, {1: 0})[1] >= weekamt - .005 or (p in week_paid and week_paid[p][1] - refunds.get(p, {1: 0})[1] < weekamt - .005 and p in gross1): reason.append("refunded for week 1")
        print(f"      {p:<24} {'; '.join(reason) or 'see sections 2-3'}")
    else:
        print(f"      {p:<24} has NO EOY Skins payment at all")

# ---- stored skin payouts
print("=" * 78); print("6. STORED WEEK 1 SKIN PAYOUTS vs CURRENT DATA")
sk = q('''SELECT rowid AS ID, Player, Detail, CAST(Earned AS REAL) Earned FROM Payments WHERE League="Hugh's" AND "Desc"='Skin'
          AND Detail LIKE '#%' AND Player!='Kitty' AND CAST(Date AS INTEGER)=? ORDER BY CAST(REPLACE(Detail,'#','') AS INTEGER)''', (week1,))
for r in sk: print(f"   rowid {r['ID']:<7} {r['Player']:<24} {r['Detail']:<5} stored Earned = ${r['Earned']:.2f}")
n = len(sk)
if n:
    stored = {round(r["Earned"], 2) for r in sk}
    exp_now = round(len(pot_players) * skin / n, 2)
    print(f"\n   skins won (stored rows): {n}")
    for label, cnt in (("current pot players", len(pot_players)), ("eligible players (Skins tab)", len(eligible1)), ("your 23 - 3 = 20", 20), ("19", 19)):
        print(f"      {label:<30}: {cnt:>2} x ${skin:g} / {n} = ${round(cnt*skin/n,2):.2f}" + ("   <== matches stored" if round(cnt*skin/n, 2) in stored else ""))
    print("   VERDICT:", "stored payout equals what current data produces (NOT stale)" if exp_now in stored
          else f"stored payout {sorted(stored)} != ${exp_now:.2f} that current data produces -> STALE (a recalculation would change it)")
else:
    print("   no stored week 1 skin rows")
# =====================================================================================================
# 7-9: WEEK 1 MONEY WALK (still read-only: the only writes below go to an in-memory COPY, never the file)
# =====================================================================================================
import math
from decimal import Decimal

lo, hi = season * 10000 + 101, (season + 1) * 10000 + 101
money = lambda v: ("-$" if v < 0 else "$") + f"{abs(v):,.2f}"
L = "League=\"Hugh's\""

def scalar(c, sql, p=()):
    return float(c.execute(sql, p).fetchone()[0] or 0)

def balances(c):
    """The same SQL the Prize Money tab uses (loadPrizeMoney), evaluated for the whole season."""
    b = {}
    b["eoy_payments"] = scalar(c, f"SELECT COALESCE(SUM(Earned),0) FROM Payments WHERE {L} AND \"Desc\"='EOY Skins' AND Detail='Payment' AND Date >= ? AND Date < ?", (lo, hi))
    b["eoy_transfers"] = scalar(c, f"SELECT COALESCE(SUM(Earned),0) FROM Payments WHERE {L} AND \"Desc\"='EOY Skins' AND Detail='Pool Transfer' AND Date >= ? AND Date < ?", (lo, hi))
    b["eoy_collected"] = round(b["eoy_payments"] + b["eoy_transfers"], 2)
    b["eoy_paid_out"] = scalar(c, f"SELECT COALESCE(SUM(Earned),0) FROM Payments WHERE {L} AND \"Desc\"='EOY Skins' AND Detail NOT IN ('Payment','Refund','Pool Transfer') AND Date >= ? AND Date < ?", (lo, hi))
    b["eoy_balance"] = round(b["eoy_collected"] - b["eoy_paid_out"], 2)
    b["skin_collected"] = scalar(c, f"SELECT COALESCE(SUM(Earned),0) FROM Payments WHERE {L} AND Desc='Skin' AND Detail='Payment' AND Date >= ? AND Date < ?", (lo, hi))
    b["skin_paid_out"] = scalar(c, f"SELECT COALESCE(SUM(Earned),0) FROM Payments WHERE {L} AND Desc='Skin' AND Detail LIKE '#%' AND Player != 'Kitty' AND Date >= ? AND Date < ? AND Date NOT IN (?,?)", (lo, hi, week1, week2))
    b["skin_transfer_out"] = scalar(c, f"SELECT COALESCE(SUM(Earned),0) FROM Payments WHERE {L} AND Desc='Skin' AND Detail='Pool Transfer' AND Date >= ? AND Date < ?", (lo, hi))
    b["skin_kitty"] = round(b["skin_collected"] - b["skin_paid_out"] - b["skin_transfer_out"], 2)
    b["combined"] = round(b["eoy_balance"] + b["skin_kitty"], 2)
    return b

print("=" * 78); print("7. WEEK 1 MONEY WALK  (whole season; same SQL as the Prize Money tab; 'as of' date = end of season)")
base = balances(con)
ev = q(f"SELECT COUNT(*) n, COALESCE(SUM(CAST(Earned AS REAL)),0) t FROM Payments WHERE {L} AND \"Desc\"='EOY Skins' AND Detail='Payment' AND Date >= ? AND Date < ?", (lo, hi))[0]
refund_total = scalar(con, f"SELECT COALESCE(SUM(CAST(Earned AS REAL)),0) FROM Payments WHERE {L} AND \"Desc\"='EOY Skins' AND Detail='Refund' AND Date >= ? AND Date < ?", (lo, hi))
print(f"   a) EOY Skins collected: {ev['n']} payment rows = {money(ev['t'])}   (refund rows total {money(refund_total)}; the tab's EOY math does NOT subtract them)")
print(f"      Week 1 gross payers x ${weekamt:g} = {len(gross1)} x {weekamt:g} = {money(len(gross1) * weekamt)}   (Week 1 share; the rest is Week 2 / unassigned)")
pot = round(len(pot_players) * skin, 2)
print(f"   b) Week 1 paid players in the pot: {len(pot_players)}  x ${skin:g} Skins = pot {money(pot)}")
print(f"      (eligible for week 1 AND >=1 hole score on {week1}; their ${ctp:g} x {len(pot_players)} = {money(len(pot_players) * ctp)} is the week 1 CTP pot)")
print("   c) STORED Week 1 skin winner payouts:")
stored_rows = q("SELECT rowid AS ID, Player, Detail, CAST(Earned AS REAL) Earned, COALESCE(DatePaid,'') DatePaid FROM Payments "
                f"WHERE {L} AND \"Desc\"='Skin' AND Detail LIKE '#%' AND Player!='Kitty' AND CAST(Date AS INTEGER)=? "
                "ORDER BY CAST(REPLACE(Detail,'#','') AS INTEGER)", (week1,))
n = len(stored_rows)
stored_total = round(sum(r["Earned"] for r in stored_rows), 2)
proposed_each = int(Decimal(str(pot)) // n) if n else 0          # whole dollars, rounded DOWN
remainder = round(pot - proposed_each * n, 2)                    # zero winners -> the whole pot
for r in stored_rows:
    print(f"      rowid {r['ID']:<7} {r['Player']:<24} {r['Detail']:<5} stored {money(r['Earned']):>9}   DatePaid={r['DatePaid'] or '(unpaid)'}")
if not n: print("      (none)")
print(f"      skins won (stored rows): {n}   stored total {money(stored_total)}   vs pot {money(pot)}: "
      + (f"stored payouts EXCEED the pot by {money(stored_total - pot)}" if stored_total > pot + .005 else f"stored payouts are {money(pot - stored_total)} under the pot"))
print("   d) WHOLE-DOLLAR proposed payout (floor of pot / skins won):")
if n:
    print(f"      each = floor({money(pot)} / {n}) = {money(proposed_each)};  total paid {money(proposed_each * n)}")
    for r in stored_rows:
        print(f"      {r['Player']:<24} {r['Detail']:<5} {money(r['Earned']):>9} -> {money(proposed_each):>9}   "
              + ("PAID - must NOT be edited" if r["DatePaid"] else "unpaid - safe to restate"))
else:
    print("      no outright skins stored for week 1 -> each = $0.00 and the WHOLE pot is the remainder")
print(f"   e) PROPOSED remainder to Skins kitty: {money(remainder)}")
print(f"      check: paid {money(proposed_each * n)} + remainder {money(remainder)} = {money(proposed_each * n + remainder)} vs pot {money(pot)}: "
      f"{'OK' if abs(proposed_each * n + remainder - pot) < .005 else 'MISMATCH'};  no payout exceeds the pot: {'OK' if proposed_each * n <= pot + .005 else 'VIOLATED'}")
print("   f) CURRENT EOY-pool balance (loadPrizeMoney):")
print(f"      EOY 'Payment' rows {money(base['eoy_payments'])} + EOY 'Pool Transfer' rows {money(base['eoy_transfers'])} = collected {money(base['eoy_collected'])}")
print(f"      - EOY-desc paid out (Detail not Payment/Refund/Pool Transfer) {money(base['eoy_paid_out'])}  =  EOY pool balance {money(base['eoy_balance'])}")
print("      NOTE: post-season skin winners are Desc='Skin', so they are NOT in 'EOY-desc paid out': the EOY balance still contains the")
print("      week 1 pot that is paid to winners.")
print("   g) CURRENT Skins-kitty balance (loadPrizeMoney):")
print(f"      Skin 'Payment' rows {money(base['skin_collected'])} - winners paid out (post-season dates excluded by psKittyExclude) {money(base['skin_paid_out'])}"
      f" - Skin 'Pool Transfer' rows {money(base['skin_transfer_out'])}  =  Skins kitty {money(base['skin_kitty'])}")
print(f"      Combined (EOY pool + Skins kitty) = {money(base['combined'])}")

print("=" * 78); print("8. BEFORE / AFTER IF THE REMAINDER WERE MOVED TO THE SKINS KITTY  (simulated on an IN-MEMORY copy; the file is untouched)")
R = remainder if remainder > 0 else 1.00
print(f"   Transfer amount used: {money(R)}" + ("" if remainder > 0 else "   (no remainder today, so a hypothetical $1.00 is used)"))
INS = f"INSERT INTO Payments (League,Player,Date,\"Desc\",Detail,Earned,DatePaid,Comment) VALUES (\"Hugh's\",'Kitty',?,?,?,?,?,?)"
def scenario(title, rows, extra_kitty=0.0):
    m = sqlite3.connect(":memory:"); con.backup(m)               # reading the read-only file into memory
    print(f"   {title}")
    try:
        for r in rows: m.execute(INS, r)
        a = balances(m)
    except sqlite3.Error as e:
        print(f"      could not simulate: {e}"); m.close(); return
    m.close()
    k_after = round(a["skin_kitty"] + extra_kitty, 2)
    dk, de = round(k_after - base["skin_kitty"], 2), round(a["eoy_balance"] - base["eoy_balance"], 2)
    print(f"      Skins kitty : {money(base['skin_kitty']):>10} -> {money(k_after):>10}   (change {money(dk)})")
    print(f"      EOY pool    : {money(base['eoy_balance']):>10} -> {money(a['eoy_balance']):>10}   (change {money(de)})")
    print(f"      Combined    : {money(base['combined']):>10} -> {money(round(k_after + a['eoy_balance'], 2)):>10}")
    if abs(dk - R) < .005 and abs(de + R) < .005: v = "COUNTED EXACTLY ONCE (kitty +R, EOY pool -R: the dollar moved)"
    elif abs(dk - R) < .005 and abs(de) < .005:   v = "COUNTED TWICE (kitty +R while the EOY pool still contains the same dollar)"
    elif abs(dk) < .005 and abs(de) < .005:       v = "DISAPPEARS from the kitty (current formulas ignore the row; the dollar stays only in the EOY balance)"
    elif abs(dk) < .005 and abs(de + R) < .005:   v = "DISAPPEARS (EOY pool -R, nothing credited to the kitty)"
    else:                                         v = "OTHER - review the numbers above"
    print(f"      VERDICT: {v}")
scenario("Option A   new row Desc='Skin' Player='Kitty' Detail='PS Skin Remainder' +R, CURRENT formulas (no code change):",
         [(week1, "Skin", "PS Skin Remainder", R, None, "audit simulation")])
scenario("Option A2  same row, IF the kitty formula were changed to add it (kitty +R added arithmetically), EOY pool untouched:",
         [(week1, "Skin", "PS Skin Remainder", R, None, "audit simulation")], extra_kitty=R)
scenario("Option B   existing 'Pool Transfer' rows with NEGATIVE amounts: Skin -R (credits the kitty) + EOY Skins -R (debits the pool), CURRENT formulas:",
         [(week1, "Skin", "Pool Transfer", -R, None, "audit simulation: to Skin kitty"),
          (week1, "EOY Skins", "Pool Transfer", -R, None, "audit simulation: from EOY pool")])
print("   (Simulations only. Today the app can transfer Skin -> EOY; the reverse direction is not in the UI.)")

print("=" * 78); print("9. EVERY EXISTING Player='Kitty' ROW WITH Desc='Skin'   (Desc='EOY Skins' shown for comparison)")
for desc in ("Skin", "EOY Skins"):
    rows9 = q("SELECT rowid AS ID, Date, Detail, CAST(Earned AS REAL) Earned, COALESCE(DatePaid,'') DatePaid, COALESCE(Comment,'') Comment "
              f"FROM Payments WHERE {L} AND Player='Kitty' AND \"Desc\"=? ORDER BY Date, rowid", (desc,))
    print(f"   Desc='{desc}': {len(rows9)} rows (all seasons)")
    for r in rows9:
        flags = []
        if int(r["Date"]) in (week1, week2): flags.append("<-- ON A POST-SEASON DATE")
        if not (lo <= int(r["Date"]) < hi): flags.append("(other season)")
        print(f"      rowid {r['ID']:<7} Date={r['Date']} Detail={r['Detail']!r:<24} Earned={money(r['Earned']):>9} DatePaid={r['DatePaid']!r} Comment={r['Comment']!r} {' '.join(flags)}")
details = sorted({r["Detail"] for r in q(f"SELECT Detail FROM Payments WHERE {L} AND Player='Kitty' AND \"Desc\"='Skin'")})
print(f"   distinct Detail values among Skin/Kitty rows: {details or 'none'}")
print(f"   would Detail 'PS Skin Remainder' collide with an existing Detail? {'YES' if 'PS Skin Remainder' in details else 'no'}")
for d in (week1, week2):
    hit = q("SELECT Earned FROM Payments WHERE CAST(Date AS INTEGER)=? AND Desc='Skin' AND Player='Kitty'", (d,))
    print(f"   'Carryover to next week' reader (Skins tab / PDF: Desc='Skin' AND Player='Kitty' on {d}) finds: "
          + (f"{money(float(hit[0]['Earned']))} -> that row IS shown as a carryover today" if hit
             else "nothing -> a NEW Skin/Kitty row on this date WOULD be shown as 'Carryover to next week' unless that reader is changed"))
print("=" * 78)
con.close()
_after = (db_file.stat().st_size, db_file.stat().st_mtime_ns)
print("Read-only: no writes were made" + (" (file size and modified time unchanged)." if _after == _fingerprint else " -- WARNING: the file changed while this ran (something else touched it, not this script)."))
