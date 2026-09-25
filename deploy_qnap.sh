#!/bin/bash
# deploy_qnap.sh — deploy Hugh's Golf from GIT to the QNAP.   RUN ON THE MAC.
#
#   ./deploy_qnap.sh sandbox     → port 8446, .../HughsGolf/sandbox
#   ./deploy_qnap.sh live        → port 8445, .../HughsGolf/live   (VERSION without -sandbox)
#
# Always deploys exactly what is committed AND pushed on the current branch,
# so what's running always matches GitHub.  Live DB is backed up before every deploy.

set -e
SITE="$1"
QNAP="GaryAdmin@192.168.1.176"
QNAP_IP="192.168.1.176"
BASE="/share/CACHEDEV3_DATA/My Stuff/HughsGolf"
BRANCH="sandbox-enhancements"

case "$SITE" in
  live)    DIR="$BASE/live";    PORT=8445 ;;
  sandbox) DIR="$BASE/sandbox"; PORT=8446 ;;
  *) echo "usage: $0 {sandbox|live}"; exit 1 ;;
esac

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
die() { echo -e "${RED}✗ $*${NC}"; exit 1; }
ok()  { echo -e "${GREEN}✓ $*${NC}"; }

REPO="$(cd "$(dirname "$0")" && git rev-parse --show-toplevel)" || die "run from inside the git repo"
cd "$REPO"

# ── 1. Git must be clean and pushed ─────────────────────────────────────────
[ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] || die "not on $BRANCH (git checkout $BRANCH)"
git diff --quiet HEAD -- HughsGolf.html app.py qnap/ || die "uncommitted changes in HughsGolf.html/app.py/qnap — commit first"
git fetch -q origin "$BRANCH" || die "git fetch failed"
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/$BRANCH)" ] || die "local $BRANCH is not the same as GitHub — pull/push first"
COMMIT="$(git log -1 --format='%h %s')"
ok "git clean and pushed: $COMMIT"

# ── 2. Build the files to upload ────────────────────────────────────────────
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cp HughsGolf.html app.py "$TMP/"
cp qnap/hughsgolf_ctl.sh "$TMP/"
if [ "$SITE" = "live" ]; then
  sed -i '' "s/^VERSION    = '\(.*\)-sandbox'/VERSION    = '\1'/" "$TMP/app.py"
fi
VERSION="$(grep -m1 "^VERSION" "$TMP/app.py" | cut -d"'" -f2)"
[ -n "$VERSION" ] || die "couldn't read VERSION from app.py"
if [ "$SITE" = "live" ] && [[ "$VERSION" == *sandbox* ]]; then die "live VERSION still says sandbox"; fi
if [ "$SITE" = "sandbox" ] && [[ "$VERSION" != *sandbox* ]]; then die "sandbox VERSION must end in -sandbox"; fi
python3 -m py_compile "$TMP/app.py" || die "app.py has a syntax error"
echo "$COMMIT" > "$TMP/DEPLOYED_COMMIT"
ok "built $SITE v$VERSION"

# ── 3. One SSH connection for the whole deploy (password asked once at most) ─
SSH_OPTS=(-o ControlMaster=auto -o ControlPath="/tmp/hg-ssh-%r@%h" -o ControlPersist=120)
[ -f "$HOME/.ssh/id_ed25519_qnap" ] && SSH_OPTS+=(-i "$HOME/.ssh/id_ed25519_qnap")
rsh() { ssh "${SSH_OPTS[@]}" "$QNAP" "$@"; }

echo -e "${YELLOW}Connecting to QNAP...${NC}"
rsh "mkdir -p \"$DIR\"" || die "ssh failed"

ACTIVE=$(rsh "netstat -tn 2>/dev/null | grep -c ':$PORT .*ESTABLISHED' || true")
if [ "${ACTIVE:-0}" -gt 0 ]; then
  echo -e "${YELLOW}⚠ $ACTIVE open connection(s) to $SITE right now.${NC}"
  read -p "Deploy anyway? (y/n) " -n 1 -r; echo
  [[ $REPLY =~ ^[Yy]$ ]] || { echo "Cancelled."; exit 0; }
fi

# ── 4. Back up the live DB ──────────────────────────────────────────────────
if [ "$SITE" = "live" ]; then
  STAMP=$(date +%Y%m%d_%H%M%S)
  rsh "cd \"$DIR\" && if [ -f HughsGolf.db ]; then mkdir -p backups/predeploy && cp HughsGolf.db backups/predeploy/HughsGolf_$STAMP.db && echo backed-up; fi" \
    | grep -q backed-up && ok "live DB backed up: backups/predeploy/HughsGolf_$STAMP.db" || echo "  (no live DB yet — nothing to back up)"
fi

# ── 5. Upload ───────────────────────────────────────────────────────────────
scp -q "${SSH_OPTS[@]}" "$TMP/HughsGolf.html" "$TMP/app.py" "$TMP/DEPLOYED_COMMIT" "$QNAP:$DIR/" || die "upload failed"
scp -q "${SSH_OPTS[@]}" "$TMP/hughsgolf_ctl.sh" "$QNAP:$BASE/" || die "upload of hughsgolf_ctl.sh failed"
rsh "chmod +x \"$BASE/hughsgolf_ctl.sh\""
ok "uploaded to $DIR"

# ── 6. Restart just this site ───────────────────────────────────────────────
if [ "$SITE" = "live" ] && ! rsh "[ -f \"$DIR/HughsGolf.db\" ]"; then
  echo -e "${YELLOW}⚠ No HughsGolf.db in $DIR yet — files uploaded, NOT starting live.${NC}"
  echo "  Copy a database into $DIR, then run:  ssh $QNAP \"sh '$BASE/hughsgolf_ctl.sh' live start\""
  exit 0
fi
rsh "sh \"$BASE/hughsgolf_ctl.sh\" $SITE restart" || die "restart failed (see message above)"

# ── 7. Verify ───────────────────────────────────────────────────────────────
sleep 2
RESP=$(curl -s -m 5 "http://$QNAP_IP:$PORT/version" || true)
if echo "$RESP" | grep -q "\"flaskVersion\":\"$VERSION\""; then
  ok "$SITE is running v$VERSION  →  http://$QNAP_IP:$PORT"
else
  die "version check failed. Got: ${RESP:-no response}"
fi
