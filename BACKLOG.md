# Hugh's Golf — Backlog

Last updated: 2026-08-30

---

## 🏌️ Post-Season

- [ ] **Gallus import for PS dates** — When Gallus sends a 9-hole round on a PS date, detect it and store as Front or Back appropriately. Currently deferred until score entry is solid.
- [ ] **18H Gallus seed test** — Gary to play Boone Links round Monday; then test the "Seed from 18H Gallus" button end-to-end.
- [x] **PS scoring rules / points calculation** — No points in PS. Prize money only. Nothing to implement.
- [ ] **PS skins/CTP end-to-end verification** — Confirm `calcEoySkins` handles PS correctly through to payout.
- [x] **PS handicap verification** — Confirmed correct. Both front/back 9 use last regular season Hdcp. PS rounds don't write new handicap records.
- [ ] **Version bump + changelog** — All post-season work this session groups under a single "Post Season" changelog entry. Do at end-of-season cutover.

---

## 📋 Regular Season

- [x] **08/25 Import All full test** — Retested and confirmed.

---

## 🔧 Housekeeping / Tech Debt

- [ ] **End-of-season cutover** — Move all sandbox work to live. Includes: post-season features, Stats tab, prize breakdown panel, Sort by Net/Match toggle, score entry card header, all UI cleanup.
- [ ] **AppChangelog entries** — Write and commit changelog entries for all features built before cutover. Stats tab, Usage panel fixes, admin subnav tracking all need entries.
- [ ] **Page-view tracking audit** — Confirm Gary Mcgolfer tab/subnav views appear correctly in Usage panel after the cross-session DB refresh fix.

---

## 💡 Ideas / Future / Offseason (not committed)

- [ ] Post-season leaderboard / standings tab view
- [ ] Post-season CTP hole designation in settings
- [ ] **Player dashboard / card management** — Players can show/hide and rearrange cards and grids on their own screen. Big task, offseason. More details TBD.
- [x] **Individual player stats** — Stats tab built with per-player scorecard history, AVG row (red shading + hole-by-hole +/- vs par), and Difficulty rank row (1=hardest, 18=easiest).

---

*Update this file at the start/end of each session. Add items here instead of relying on session memory.*
