# Hugh's Golf on the QNAP

Everything runs on the QNAP (192.168.1.176). The Mac is only for editing code and pushing to GitHub.

| Site    | Port | Folder on QNAP                                        | VERSION        |
|---------|------|-------------------------------------------------------|----------------|
| live    | 8445 | `/share/CACHEDEV3_DATA/My Stuff/HughsGolf/live`       | `YYYYMMDD.N`   |
| sandbox | 8446 | `/share/CACHEDEV3_DATA/My Stuff/HughsGolf/sandbox`    | `YYYYMMDD.N-sandbox` |

Public address: `hughsgolf.duckdns.org:8445` → router port-forward 8445 → the QNAP.
(Before cutover the router forwards 8445 to the Mac mini, 192.168.1.190.)

## Scripts
- **Mac: `./deploy_qnap.sh sandbox|live`** — deploys what is committed *and pushed* on
  `sandbox-enhancements`. Refuses if git is dirty or not pushed. Live: strips `-sandbox`
  from VERSION and backs up the live DB to `live/backups/predeploy/` first. Verifies `/version`.
- **Mac: `./restart_flask.sh sandbox|live`** — restart one site, no deploy.
- **QNAP: `hughsgolf_ctl.sh {live|sandbox} {start|stop|restart|status|ensure}`** and
  `hughsgolf_ctl.sh all {ensure|status}`. Lives in `.../HughsGolf/`. Finds each site by the
  folder its python runs from, so one site can never stop the other.
- **QNAP: `qnap/install_watchdog.sh`** — cron every minute runs `hughsgolf_ctl.sh all ensure`
  (restarts a site that is set up but down, e.g. after a reboot). Log: `.../HughsGolf/watchdog.log`.

## Files in each site folder
`app.py`, `HughsGolf.html`, `HughsGolf.db`, `DEPLOYED_COMMIT` (git commit that's running),
`flask_<site>.log`, `backups/`, optional `update_notice.txt` (message shown on login + under tabs).

## Cutover marker
`live/.is_live` — once it exists, the sandbox's "Compare Live / Refresh from live" uses the
QNAP live DB instead of the Mac mini.
