#!/bin/sh
# install_autodeploy.sh — RUNS ON THE QNAP (as an administrator). Adds a cron job that runs auto_deploy_sandbox.py every 3 minutes.
#   install:    sh install_autodeploy.sh
#   remove:     sh install_autodeploy.sh remove      (or just create the file  <BASE>/autodeploy/PAUSE  to pause it)
BASE="/share/CACHEDEV3_DATA/My Stuff/HughsGolf"
PY="/share/CACHEDEV1_DATA/.qpkg/Python3/opt/python3/bin/python3"
SCRIPT="$BASE/auto_deploy_sandbox.py"
CRON_FILE="/etc/config/crontab"
CRON_LINE="*/3 * * * * \"$PY\" \"$SCRIPT\" >/dev/null 2>&1"

[ -f "$SCRIPT" ] || { echo "Copy qnap/auto_deploy_sandbox.py to $BASE first (it is not part of a normal deploy)"; exit 1; }
cp "$CRON_FILE" "$CRON_FILE.autodeploy.bak.$(date '+%Y%m%d%H%M%S')" || { echo "Can't back up $CRON_FILE (need admin rights?)"; exit 1; }
grep -v 'auto_deploy_sandbox.py' "$CRON_FILE" > /tmp/hg_crontab.$$
[ "$1" = "remove" ] || echo "$CRON_LINE" >> /tmp/hg_crontab.$$
cp /tmp/hg_crontab.$$ "$CRON_FILE" && rm -f /tmp/hg_crontab.$$
crontab "$CRON_FILE"
/etc/init.d/crond.sh restart >/dev/null 2>&1 || true
if [ "$1" = "remove" ]; then echo "Auto-deploy removed."; else echo "Auto-deploy installed:"; grep auto_deploy_sandbox "$CRON_FILE"; fi
