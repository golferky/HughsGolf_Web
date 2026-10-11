# Hugh's Golf — Backlog

Last updated: 2026-10-11

---

## 🏌️ Post-Season *(target: before first PS round, ~late Sept 2026)*

- [ ] **18H Gallus seed test** — (Seed/Clear test buttons are hidden on live.) Gary to play Boone Links round Monday; then test the "Seed from 18H Gallus" button end-to-end.
- [ ] **PS skins/CTP end-to-end verification** — Confirm `calcEoySkins` handles PS correctly through to payout.
- [ ] **PS skins / CTP split (future)** — Let a player choose Wk1 Skins ($SkinsPS), Wk1 CTP ($ClosestPS), Wk2 Skins, Wk2 CTP separately instead of one EOY Skins buy-in per week. Needs: per-game payment storage, separate skins/CTP eligibility per week, pot + winner calc, refunds, grid "in skins" display, prize money reports. Interim (v20260925.2): post-season EOY amount is fixed by Wk 1 / Wk 2 / Both, no typed amount.
- [ ] **Extra (non-roster) players in post-season** — If a regular returns for post season (e.g. Matt plays the championship) AND his season-long sub still wants EOY skins/CTP (Howard), both need to be on the scorecard. Today the post-season grid is one slot per team/grade (regular OR sub), so there's no slot for Howard once Matt takes his own. Need: add extra post-season-only players to the grid (skins/CTP only, not CC). Not needed for 2026 unless it comes up.
- [ ] **Post-season rules finalized** — Edge cases (all skins tied, all CTPs missed) pending admin discussion on League Board. Update rulebook once consensus reached.

---

## 🔧 Housekeeping / Tech Debt *(target: October 2026 cutover)*
- [ ] **Make the GitHub repo private** (still public as of 2026-10-11; after the current bugs/enhancements are done) — Settings → General → Danger Zone → Change visibility. Then:
  - Change `SAVE_TOKEN` in app.py (it has been publicly visible), commit, deploy sandbox + live. Browsers pick up the new token on reload.
    Note: the server also hands this token to any browser via /save-token, so it's a light speed bump, not real security. Real protection = tie writes to a logged-in admin session on the server (future enhancement).
  - Add any outside developers as collaborators (Settings → Collaborators) so they can read docs/SETUP.md.
  - Nothing else changes: deploy_qnap.sh uses Gary's own SSH login; the QNAP never pulls from GitHub.

---

## 💡 Ideas / Future / Offseason *(no committed timeframe)*

- [ ] **Twilio SMS notifications** — (Rainout texts already go out through each player's carrier gateway, PRs #87–#90; Twilio would add the board/DM texts, replies and opt-in.) Text players when Announcements/Rainouts are posted to the League Board, and when they receive a direct message. Requires: Twilio account (~$1/mo number + ~$0.01/msg), `pip install twilio` on QNAP, `TextOptIn` column added to Players table, `+1` prefix applied to existing 10-digit phone numbers. Implement after QNAP cutover alongside the direct messaging feature.
- [ ] **Direct player-to-player / admin-to-player messaging** — Inbox UI (floating panel, accessible from any tab), Messages table, Flask routes (fetch/send/mark-read), badge + toast notification. SMS hookup via Twilio. Build on QNAP after cutover.
- [ ] **Post-season CTP hole designation in settings** — Today the CTP holes are the course's par 3s for the nine being played; this would let an admin choose them in League Settings.
- [ ] **Player dashboard / card management** — Players can show/hide and rearrange cards and grids on their own screen. Big task, offseason. More details TBD.
- [ ] **Future Enhancements tab (2027)** — New top-level tab. Move Stableford under it as a sub-tab. Add sub-tab "Scratch Skin Game" (skins on gross scores, no handicaps).
- [ ] **Preprinted scorecards** — (2027 consideration) Printable scorecards prefilled with the night's data (date, tee/side, players, pars, handicaps/strokes per hole). Details TBD.
- [ ] **Labels for non-preprinted scorecards** — (2027 consideration) Printable labels (e.g., Avery sheets) with player name, handicap and strokes per hole, to stick on blank scorecards. Details TBD.
- [ ] **Venmo ID for players** — (2027 consideration) Optional Venmo ID on each player record (Edit Player), for players who want to pay or be paid by Venmo. Possible uses: show it on the Payments/Award Prizes screens, link or copy button for dues. Details TBD.
- [ ] **Voice score entry** — (2027 consideration) Mic button on the score-entry screen using the browser's speech recognition (Safari needs a tap to start + mic permission). Flow: (1) pick the group first (voice or tap; groups come from the night's Matches/Schedule, falling back to the card's own player list); (2) say the player's name and match it against only that group's ~4 players, showing "Gary Scudder?" Yes/No (No = tap-to-pick from the others; a "Sub / other player" option searches the whole player file with the same validation; mishearings like Garry/Carrie fall back to the picker, never a guess); (3) only after the name is confirmed, say the scores as a run of single digits, e.g. "544455444" (also accepts "5 4 4 4…" or spoken words); (4) preview the row and tap to confirm before saving, then move to the next player. Rules: card length comes from league settings (9 or 18 holes) and the digit count must match exactly, otherwise the row is flagged and left for the user to fix, never guessed; no double-digit scores allowed (max 9 per hole, each digit = one hole); a 0 is rejected. Optional later shortcut once the name step is trusted: name and digits in one sentence ("Gary 544455444"). Optional later: short nickname on the player record for matching. Needs a signal/typing fallback. Details TBD.
- [ ] **Offline score entry** — Site is unusable without internet. Scores will be entered on a computer (laptop), not a phone. Need: app opens offline (laptop loads the site once while online beforehand), scores saved on the laptop, auto-upload when a connection returns, clear "not yet synced" indicator.
- [ ] **2027 season setup** — New SeasonSettings entry, roster updates, new schedule, rule changes from proposals discussion.
  - Gallus TournamentHost yearly setup (https://manager.gallusgolf.com/TournamentHost/7b446045) as a wizard step: event details (name, dates, 4:00 PM Boone Links, Individuals/Stroke, In App Scoring, logo) + Gallus checklist: 1 Rounds, 2 League Roster, 3 Groups, 4 Flights, 5 Leaderboards, 6 Materials. Idea: export schedule/roster from HughsGolf for Gallus. More details from Gary TBD.

---

## ✅ Completed This Season

### October 2026 (all in the Changelog tab with PR numbers)

- [x] **Balance Sheet pool ledgers** — Each grid is its own collapsible panel; rows expand to show who paid; EOY pool, Skins and CTP kitties. (PRs #54–#59)
- [x] **Post-season skins calculate automatically** — No approval needed once a week is fully scored; cursor jumps to the next nine. (PRs #60, #61)
- [x] **Undo paid and pay buttons** — Officers can undo a paid prize; mark paid / undo on the Balance Sheet and Award CTP Winners. (PRs #63, #68)
- [x] **Stats fixes** — Avg Net used another player's rounds; Season dropdown lists only seasons with scores. (PRs #64, #65)
- [x] **Post-season CTP amounts follow the pot** — And the regular-season CTP kitty no longer counts post-season CTP winners. (PRs #66, #67, #69)
- [x] **Real tabs and tab groups** — Home, Play, Post Season, Money, League, Admin with sub-tabs; Standings under Play. (PRs #70–#73)
- [x] **Post Season tab for everyone** — Scores, Standings, Skins & CTPs, Earned with one Season dropdown. (PRs #74, #75)
- [x] **Gallus queue improvements** — Change a round's date (also when reconciled), compare with the scorecard before importing, auto-reconcile matches, fewer pop-ups, clearer duplicate prompt. (PRs #77–#83, #85)
- [x] **Version shows PR number and git commit** — In the header and on the login screen. (PR #84)
- [x] **Rainout Text** — Roster of who is playing (including post-season nights), text everyone with a one-tap Got it link, optional point-person mode, test to me, group-text batches of 20 or fewer, unreachable players handed to a point person. (PRs #87–#90)
- [x] **Admin Backlog page** — This list, shown to admins in the app. (PR #91)

### Earlier items

- [x] **Gallus import for PS dates** — Post-season Gallus rounds are detected and saved as Front/Back on the card's own date; Week 2 cards are saved on Week 2. (PR #76)
- [x] **Injured-player exception (Matt McDonald)** — Decided and built as the League Championship sub exception (Howard Gorman, 2026) in the leaderboard and the Stableford award. (PRs #29, #30)
- [x] **Post-season leaderboard / standings tab view** — The Post Season tab (Scores, Standings, Skins & CTPs, Earned) and the Scores tab leaderboard are visible to everyone. (PRs #74, #75)
- [x] **Version bump + changelog** — Changelog is current through Oct 11 with PR numbers, one entry per day, and a test fails if a day is missing. (PR #86)
- [x] **PS scoring rules / points calculation** — No points in PS, prize money only.
- [x] **PS handicap verification** — Both nines use the last regular-season handicap; PS rounds write no new handicap records.
- [x] **08/25 Import All full test** — Retested and confirmed.
- [x] **End-of-season cutover** — All sandbox work moved to live; QNAP is live, the Mac is the sandbox.
- [x] **AppChangelog entries** — Stats tab, Usage panel fixes and admin subnav tracking documented.
- [x] **Page-view tracking audit** — Tab and subnav views confirmed in the Usage panel.
- [x] **Individual player stats** — Stats tab built with per-player scorecard history, AVG row (red shading + hole-by-hole +/- vs par), and Difficulty rank row (1=hardest, 18=easiest).
- [x] **League Board separated** — Full board moved to its own tab; Home shows pinned/announcement preview only. Unread badge + toast notification on new posts.
- [x] **Proposals & Suggestion Box** — Admin manages proposed rule changes; players submit suggestions anonymously or named.
- [x] **Post-Season Prize Breakdown panel** — Live skins/CTP/leaderboard breakdown on score entry screen. Clickable summary cards show player detail.
- [x] **Compare with Live** — Side-by-side sandbox vs live DB comparison with auto-collapse on match, summary panel, clickable diff rows.
- [x] **PDF Email History** — Log of past PDF emails shown on the PDFs admin tab.
- [x] **Email Results toast** — Prompts to email results after paying a CTP/skin winner.

---

*Update this file at the start/end of each session. Add items here instead of relying on session memory.*
