-- Fix Patrick Nerl score on LIVE — 09/01/2026
-- PHDCP should be 4, making Net 37 (currently showing 41 with no PHDCP)
-- Pending confirmation from another admin before running on LIVE

-- Step 1: Fix Scores
UPDATE Scores
SET Net = 37
WHERE Player = 'Patrick Nerl'
  AND CAST(Date AS INTEGER) = 20260901
  AND League = "Hugh's";

-- PHdcp lives in Handicaps, not Scores. Fix it there too:
UPDATE Handicaps SET Hdcp=4, PHdcp=4
WHERE Player = 'Patrick Nerl'
  AND CAST(Date AS INTEGER) = 20260901
  AND League = "Hugh's";

-- Step 2: Patrick (net 37) beats Jason Noble (net 38) — fix match points
UPDATE Matches SET Points = 1
WHERE Player = 'Patrick Nerl'
  AND CAST(Date AS INTEGER) = 20260901
  AND League = "Hugh's";

UPDATE Matches SET Points = 0
WHERE Player = 'Jason Noble'
  AND CAST(Date AS INTEGER) = 20260901
  AND League = "Hugh's";

-- NOTE: Also verify Team_Points for Team 8 after running above.
-- Run on LIVE only after admin confirmation.
