-- Calculate historical rainouts from real Hugh's Golf tables only.
-- Intentionally ignores every z_ / Z_ table.
--
-- Rule:
--   Rainout = Tuesday between LeagueParms.StartDate and LeagueParms.EndDate
--             that is missing from Schedule.Date.
--   Known Tuesday holidays/off-weeks are excluded below.
--
-- For the current season, the calculation stops at the current date so future
-- scheduled weeks are not counted as rainouts.

WITH RECURSIVE
league_parms AS (
  SELECT
    Season,
    StartDate,
    EndDate,
    PostSeasonDt,
    COALESCE(NULLIF(Rainouts, ''), '0') AS CurrentRainouts,
    date(
      substr(StartDate, -4) || '-' ||
      printf('%02d', CAST(substr(StartDate, 1, instr(StartDate, '/') - 1) AS INTEGER)) || '-' ||
      printf(
        '%02d',
        CAST(
          substr(
            substr(StartDate, instr(StartDate, '/') + 1),
            1,
            instr(substr(StartDate, instr(StartDate, '/') + 1), '/') - 1
          ) AS INTEGER
        )
      )
    ) AS StartDt,
    date(
      substr(EndDate, -4) || '-' ||
      printf('%02d', CAST(substr(EndDate, 1, instr(EndDate, '/') - 1) AS INTEGER)) || '-' ||
      printf(
        '%02d',
        CAST(
          substr(
            substr(EndDate, instr(EndDate, '/') + 1),
            1,
            instr(substr(EndDate, instr(EndDate, '/') + 1), '/') - 1
          ) AS INTEGER
        )
      )
    ) AS EndDt
  FROM LeagueParms
  WHERE Name = 'Hugh''s'
    AND StartDate IS NOT NULL
    AND EndDate IS NOT NULL
    AND StartDate <> ''
    AND EndDate <> ''
),
bounds AS (
  SELECT
    *,
    CASE
      WHEN CAST(Season AS INTEGER) = CAST(strftime('%Y', 'now', 'localtime') AS INTEGER)
       AND EndDt > date('now', 'localtime')
        THEN date('now', 'localtime')
      ELSE EndDt
    END AS CutoffDt
  FROM league_parms
),
tuesdays(Season, StartDate, EndDate, PostSeasonDt, CurrentRainouts, Dt, CutoffDt) AS (
  SELECT Season, StartDate, EndDate, PostSeasonDt, CurrentRainouts, StartDt, CutoffDt
  FROM bounds
  UNION ALL
  SELECT Season, StartDate, EndDate, PostSeasonDt, CurrentRainouts, date(Dt, '+7 days'), CutoffDt
  FROM tuesdays
  WHERE date(Dt, '+7 days') <= CutoffDt
),
holidays(DateKey, Reason) AS (
  VALUES
    ('20170704', 'Tuesday holiday'),
    ('20230704', 'Tuesday holiday')
),
scheduled_weeks AS (
  SELECT DISTINCT Date AS DateKey
  FROM Schedule
  WHERE League = 'Hugh''s'
),
missing_tuesdays AS (
  SELECT
    t.Season,
    strftime('%Y%m%d', t.Dt) AS DateKey,
    strftime('%m/%d/%Y', t.Dt) AS DisplayDate
  FROM tuesdays t
  LEFT JOIN scheduled_weeks s
    ON s.DateKey = strftime('%Y%m%d', t.Dt)
  LEFT JOIN holidays h
    ON h.DateKey = strftime('%Y%m%d', t.Dt)
  WHERE s.DateKey IS NULL
    AND h.DateKey IS NULL
),
calculated AS (
  SELECT
    lp.Season,
    lp.StartDate,
    lp.EndDate,
    lp.PostSeasonDt,
    lp.CurrentRainouts,
    COUNT(m.DateKey) AS CalculatedRainouts,
    COALESCE(GROUP_CONCAT(m.DisplayDate, ', '), '') AS MissingTuesdays
  FROM league_parms lp
  LEFT JOIN missing_tuesdays m
    ON m.Season = lp.Season
  GROUP BY lp.Season
)
SELECT
  Season,
  StartDate,
  EndDate,
  PostSeasonDt,
  CurrentRainouts AS Current,
  CalculatedRainouts AS NewRainouts,
  MissingTuesdays
FROM calculated
ORDER BY CAST(Season AS INTEGER);

-- To apply this after reviewing the report, uncomment the UPDATE below.
--
-- WITH calculated AS (
--   Paste the same CTE above through calculated here.
-- )
-- UPDATE LeagueParms
-- SET Rainouts = (
--   SELECT CalculatedRainouts
--   FROM calculated
--   WHERE calculated.Season = LeagueParms.Season
-- )
-- WHERE Name = 'Hugh''s'
--   AND EXISTS (
--     SELECT 1
--     FROM calculated
--     WHERE calculated.Season = LeagueParms.Season
--   );
