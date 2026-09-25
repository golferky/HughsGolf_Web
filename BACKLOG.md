# Hugh's Golf — Backlog

Last updated: 2026-09-25

---

## 🏌️ Post-Season *(target: before first PS round, ~late Sept 2026)*

- [ ] **Gallus import for PS dates** — When Gallus sends a 9-hole round on a PS date, detect it and store as Front or Back appropriately. Currently deferred until score entry is solid.
- [ ] **18H Gallus seed test** — Gary to play Boone Links round Monday; then test the "Seed from 18H Gallus" button end-to-end.
- [x] **PS scoring rules / points calculation** — No points in PS. Prize money only. Nothing to implement.
- [ ] **PS skins/CTP end-to-end verification** — Confirm `calcEoySkins` handles PS correctly through to payout.
- [x] **PS handicap verification** — Confirmed correct. Both front/back 9 use last regular season Hdcp. PS rounds don't write new handicap records.
- [ ] **Version bump + changelog** — All post-season work groups under a single "Post Season" changelog entry. Do at end-of-season cutover.
- [ ] **PS skins / CTP split (future)** — Let a player choose Wk1 Skins ($SkinsPS), Wk1 CTP ($ClosestPS), Wk2 Skins, Wk2 CTP separately instead of one EOY Skins buy-in per week. Needs: per-game payment storage, separate skins/CTP eligibility per week, pot + winner calc, refunds, grid "in skins" display, prize money reports. Interim (v20260925.2): post-season EOY amount is fixed by Wk 1 / Wk 2 / Both, no typed amount.
- [ ] **Injured-player exception (Matt McDonald)** — Admins to decide: Matt was injured and Howard subbed all season. Should Matt (or Howard) get an exception for League Championship? If yes, add a per-player CC override. Current rule (v20260925.6): CC eligible = regular roster player with scores both PS weeks; $20 EOY payment not required (champ prizes come from $45 dues); subs not eligible (SUBS_CC_ELIGIBLE = false).
- [ ] **Extra (non-roster) players in post-season** — If a regular returns for post season (e.g. Matt plays the championship) AND his season-long sub still wants EOY skins/CTP (Howard), both need to be on the scorecard. Today the post-season grid is one slot per team/grade (regular OR sub), so there's no slot for Howard once Matt takes his own. Need: add extra post-season-only players to the grid (skins/CTP only, not CC). Not needed for 2026 unless it comes up.
- [ ] **Post-season rules finalized** — Edge cases (all skins tied, all CTPs missed) pending admin discussion on League Board. Update rulebook once consensus reached.

---

## 📋 Regular Season

- [x] **08/25 Import All full test** — Retested and confirmed.

---

## 🔧 Housekeeping / Tech Debt *(target: October 2026 cutover)*

- [x] **End-of-season cutover** — Move all sandbox work to live. QNAP stays live, Mac becomes new sandbox.
- [x] **AppChangelog entries** — Stats tab, Usage panel fixes, admin subnav tracking all documented.
- [x] **Page-view tracking audit** — Gary Mcgolfer tab/subnav views confirmed in Usage panel.

---

## 💡 Ideas / Future / Offseason *(no committed timeframe)*

- [ ] **Twilio SMS notifications** — Text players when Announcements/Rainouts are posted to the League Board, and when they receive a direct message. Requires: Twilio account (~$1/mo number + ~$0.01/msg), `pip install twilio` on QNAP, `TextOptIn` column added to Players table, `+1` prefix applied to existing 10-digit phone numbers. Implement after QNAP cutover alongside the direct messaging feature.
- [ ] **Direct player-to-player / admin-to-player messaging** — Inbox UI (floating panel, accessible from any tab), Messages table, Flask routes (fetch/send/mark-read), badge + toast notification. SMS hookup via Twilio. Build on QNAP after cutover.
- [ ] **Post-season leaderboard / standings tab view**
- [ ] **Post-season CTP hole designation in settings**
- [ ] **Player dashboard / card management** — Players can show/hide and rearrange cards and grids on their own screen. Big task, offseason. More details TBD.
- [ ] **2027 season setup** — New SeasonSettings entry, roster updates, new schedule, rule changes from proposals discussion.

---

## ✅ Completed This Season

- [x] **Individual player stats** — Stats tab built with per-player scorecard history, AVG row (red shading + hole-by-hole +/- vs par), and Difficulty rank row (1=hardest, 18=easiest).
- [x] **League Board separated** — Full board moved to its own tab; Home shows pinned/announcement preview only. Unread badge + toast notification on new posts.
- [x] **Proposals & Suggestion Box** — Admin manages proposed rule changes; players submit suggestions anonymously or named.
- [x] **Post-Season Prize Breakdown panel** — Live skins/CTP/leaderboard breakdown on score entry screen. Clickable summary cards show player detail.
- [x] **Compare with Live** — Side-by-side sandbox vs live DB comparison with auto-collapse on match, summary panel, clickable diff rows.
- [x] **PDF Email History** — Log of past PDF emails shown on the PDFs admin tab.
- [x] **Email Results toast** — Prompts to email results after paying a CTP/skin winner.

---

*Update this file at the start/end of each session. Add items here instead of relying on session memory.*
