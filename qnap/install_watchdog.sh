#!/bin/sh
# install_watchdog.sh — RUNS ON THE QNAP (as an administrator).
# Adds a cron job that runs every minute and starts live (8445) and/or sandbox (8446)
# if they are set up but not running — covers QNAP reboots and crashes.
BASE="/share/CACHEDEV3_DATA/My Stuff/HughsGolf"
CTL="$BASE/hughsgolf_ctl.sh"
CRON_FILE="/etc/config/crontab"
# cron needs the path quoted because of the space in "My Stuff"
CRON_LINE="* * * * * /bin/sh \"$CTL\" all ensure >/dev/null 2>&1"

[ -f "$CTL" ] || { echo "Missing $CTL — deploy first"; exit 1; }
chmod +x "$CTL"

cp "$CRON_FILE" "$CRON_FILE.hughsgolf.bak.$(date '+%Y%m%d%H%M%S')" || { echo "Can't back up $CRON_FILE (need admin rights?)"; exit 1; }
# Remove any old Hugh's Golf watchdog lines (e.g. the CACHEDEV2_DATA one) before adding ours
grep -v 'ensure_hughsgolf.sh\|hughsgolf_ctl.sh' "$CRON_FILE" > /tmp/hg_crontab.$$
echo "$CRON_LINE" >> /tmp/hg_crontab.$$
cp /tmp/hg_crontab.$$ "$CRON_FILE" && rm -f /tmp/hg_crontab.$$
crontab "$CRON_FILE"
/etc/init.d/crond.sh restart >/dev/null 2>&1 || true
echo "Watchdog installed:"
grep hughsgolf_ctl "$CRON_FILE"
