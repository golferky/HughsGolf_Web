# Sandbox auto-deploy (push-to-deploy, sandbox only)

**Goal:** when you merge a pull request into `sandbox-enhancements`, the sandbox (port 8446) updates itself within about 3 minutes. No `./deploy_qnap.sh sandbox` needed.
**Live (8445) is never touched.** Live stays manual: `./deploy_qnap.sh live` (which backs up the database first).

## How it works
The QNAP asks GitHub (outbound only, no open port, no webhook) every 3 minutes: "what is the newest commit on `sandbox-enhancements`?"

1. Paused (`PAUSE` file)? Stop.
2. Same commit as `sandbox/DEPLOYED_COMMIT`? Stop.
3. Not a *Merge pull request #N* commit? Stop (a direct push is left for a manual deploy).
4. Same commit that failed before? Stop (no retry loop).
5. Someone connected to the sandbox? Wait, up to 10 minutes, then go anyway.
6. Download exactly that commit, check it (required files present, `app.py` compiles, `VERSION` ends in `-sandbox`).
7. Back up the current app files, copy the new ones in, write `DEPLOYED_COMMIT` (so the header shows version + PR# + commit), restart the sandbox.
8. Check `http://127.0.0.1:8446/version` reports the new version. If not, put the old files back, restart, and remember the bad commit.

Log: `<BASE>/autodeploy/autodeploy.log`.

## What it never touches
Live, any database, photos, or the existing backups. It writes only to `<BASE>/sandbox` (`HughsGolf.html`, `app.py`, `BACKLOG.md`, `vendor/`, `DEPLOYED_COMMIT`, `backups/autodeploy/`), `<BASE>/hughsgolf_ctl.sh`, and `<BASE>/autodeploy/`. The last 5 backups are kept.

## Install (one time, by you, on the QNAP)
1. Copy `qnap/auto_deploy_sandbox.py` and `qnap/install_autodeploy.sh` to `<BASE>` (`/share/CACHEDEV3_DATA/My Stuff/HughsGolf`).
2. Run once manually to watch it work: `python3 auto_deploy_sandbox.py` (should say `up-to-date` or deploy).
3. `sh install_autodeploy.sh` adds the cron line (the crontab is backed up first).

Remove: `sh install_autodeploy.sh remove`. Pause without removing: create the file `<BASE>/autodeploy/PAUSE` (delete it to resume).

## Notes
- Polling every 3 minutes stays well under GitHub's unauthenticated limit (60/hour). If the repo becomes private, save a read-only token in `<BASE>/autodeploy/github_token` (`chmod 600`).
- It coexists with `./deploy_qnap.sh sandbox`; both write the same files and `DEPLOYED_COMMIT`.
- The old `/webhook` and `/redeploy` endpoints in `app.py` are not used by this; don't enable them on live.
