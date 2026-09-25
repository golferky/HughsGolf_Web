#!/bin/sh
# hughsgolf_ctl.sh — start/stop/check Hugh's Golf on the QNAP.  RUNS ON THE QNAP.
#
#   hughsgolf_ctl.sh live     start|stop|restart|status|ensure
#   hughsgolf_ctl.sh sandbox  start|stop|restart|status|ensure
#   hughsgolf_ctl.sh all      ensure|status        (used by the cron watchdog)
#
# live    = port 8445, folder .../HughsGolf/live
# sandbox = port 8446, folder .../HughsGolf/sandbox
# Each site is identified by the FOLDER its python runs from, so stopping one
# can never touch the other.

BASE="/share/CACHEDEV3_DATA/My Stuff/HughsGolf"
PYTHON="/share/CACHEDEV1_DATA/.qpkg/Python3/opt/python3/bin/python3"
RUN_AS="GaryAdmin"

# The cron watchdog runs as root (QNAP only allows root's crontab). Never run the
# sites as root — switch to GaryAdmin so files/DB stay owned by GaryAdmin.
if [ "$(id -u)" = "0" ] && [ -z "$HG_NO_SU" ]; then
  export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
  for s in sudo /usr/bin/sudo /bin/sudo /sbin/sudo /usr/local/bin/sudo; do
    if command -v "$s" >/dev/null 2>&1; then
      exec "$s" -u "$RUN_AS" env HG_NO_SU=1 /bin/sh "$0" "$@"
    fi
  done
  for s in su /bin/su /usr/bin/su; do
    if command -v "$s" >/dev/null 2>&1; then
      exec "$s" "$RUN_AS" -s /bin/sh -c "HG_NO_SU=1 /bin/sh '$0' $*"
    fi
  done
  if command -v busybox >/dev/null 2>&1 && busybox su --help >/dev/null 2>&1; then
    exec busybox su "$RUN_AS" -s /bin/sh -c "HG_NO_SU=1 /bin/sh '$0' $*"
  fi
  echo "$(date '+%Y-%m-%d %H:%M:%S') WARNING: no sudo/su found; running as root" >> "$BASE/watchdog.log"
fi

site="$1"; action="$2"

setup_site() {
  case "$1" in
    live)    DIR="$BASE/live";    PORT=8445 ;;
    sandbox) DIR="$BASE/sandbox"; PORT=8446 ;;
    *) echo "usage: $0 {live|sandbox|all} {start|stop|restart|status|ensure}"; exit 1 ;;
  esac
  LOG="$DIR/flask_$1.log"
  # Real path (in case part of the path is a symlink) — what /proc/<pid>/cwd reports
  DIR_REAL=$(cd "$DIR" 2>/dev/null && pwd -P || echo "$DIR")
}

# PIDs of python app.py processes whose working folder is $DIR
site_pids() {
  for d in /proc/[0-9]*; do
    case "$( { tr '\000' ' ' < "$d/cmdline"; } 2>/dev/null)" in
      *python3*app.py*) cwd=$(readlink "$d/cwd" 2>/dev/null); { [ "$cwd" = "$DIR" ] || [ "$cwd" = "$DIR_REAL" ]; } && echo "${d#/proc/}" ;;
    esac
  done
}

port_up() {
  if command -v netstat >/dev/null 2>&1; then
    netstat -tln 2>/dev/null | grep -q ":$PORT "
  else  # fallback: look for a LISTEN (state 0A) socket on the port in /proc/net/tcp
    hex=$(printf ':%04X ' "$PORT")
    grep -q "$hex.* 0A " /proc/net/tcp /proc/net/tcp6 2>/dev/null
  fi
}

do_stop() {
  pids=$(site_pids)
  if [ -z "$pids" ]; then echo "[$SITE] not running"; return 0; fi
  echo "[$SITE] stopping PID(s): $pids"
  kill $pids 2>/dev/null
  i=0; while [ $i -lt 10 ] && [ -n "$(site_pids)" ]; do sleep 1; i=$((i+1)); done
  [ -n "$(site_pids)" ] && kill -9 $(site_pids) 2>/dev/null
  return 0
}

do_start() {
  if [ ! -f "$DIR/app.py" ]; then echo "[$SITE] no app.py in $DIR — not starting"; return 1; fi
  if [ -n "$(site_pids)" ]; then echo "[$SITE] already running (PID $(site_pids))"; return 0; fi
  if port_up; then echo "[$SITE] port $PORT is in use by something else — not starting"; return 1; fi
  cd "$DIR" || return 1
  if [ "$SITE" = "sandbox" ] && [ -f "$BASE/live/.is_live" ]; then
    # After cutover (live/.is_live exists): sandbox "Refresh/Compare Live" uses the QNAP live DB.
    # Before cutover it keeps its defaults (the Mac mini live server).
    HUGHSGOLF_LIVE_DB="$BASE/live/HughsGolf.db" HUGHSGOLF_LIVE_URL="http://127.0.0.1:8445" \
    HUGHSGOLF_PORT=$PORT "$PYTHON" app.py >> "$LOG" 2>&1 </dev/null &
  else
    HUGHSGOLF_PORT=$PORT "$PYTHON" app.py >> "$LOG" 2>&1 </dev/null &
  fi
  i=0; while [ $i -lt 15 ] && ! port_up; do sleep 1; i=$((i+1)); done
  if port_up; then echo "[$SITE] started on port $PORT (PID $(site_pids))"; return 0; fi
  echo "[$SITE] FAILED to start — last lines of $LOG:"; tail -15 "$LOG"; return 1
}

do_status() {
  pids=$(site_pids)
  ver=$(curl -s -m 3 "http://127.0.0.1:$PORT/version" 2>/dev/null)
  echo "[$SITE] port $PORT  pid: ${pids:-none}  version: ${ver:-no response}"
}

do_ensure() {
  [ -f "$DIR/app.py" ] || return 0            # site not set up yet
  port_up && return 0
  echo "$(date '+%Y-%m-%d %H:%M:%S') [$SITE] was down; starting" >> "$BASE/watchdog.log"
  do_start >> "$BASE/watchdog.log" 2>&1
}

run() {
  SITE="$1"; setup_site "$1"
  case "$2" in
    start)   do_start ;;
    stop)    do_stop ;;
    restart) do_stop; sleep 1; do_start ;;
    status)  do_status ;;
    ensure)  do_ensure ;;
    *) echo "usage: $0 {live|sandbox|all} {start|stop|restart|status|ensure}"; exit 1 ;;
  esac
}

if [ "$site" = "all" ]; then
  case "$action" in ensure|status) run live "$action"; run sandbox "$action" ;; *) echo "all supports: ensure, status"; exit 1 ;; esac
else
  run "$site" "$action"
fi
