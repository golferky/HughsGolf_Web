# Hugh's Golf on the QNAP

Setting up a copy somewhere else (laptop, other server)? See [docs/SETUP.md](../docs/SETUP.md).

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

## Python packages (flask, tzdata) — keep them OFF the home folder
On the QNAP `/share/homes` is a **16 MB memory disk wiped at every reboot**, so `pip install --user` there vanishes and the
sites fail with `No module named 'flask'` / `No time zone found with key America/New_York`. Install once onto the big volume:

    /share/CACHEDEV1_DATA/.qpkg/Python3/opt/python3/bin/python3 -m pip install --no-cache-dir \
        --target "/share/CACHEDEV3_DATA/My Stuff/HughsGolf/pylibs" flask tzdata

`hughsgolf_ctl.sh` adds that `pylibs` folder to `PYTHONPATH`, and checks the packages before starting a site (it prints the
fix above instead of failing silently).
