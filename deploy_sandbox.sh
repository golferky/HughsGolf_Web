#!/bin/bash
# DEPRECATED — deploys from an old Codex folder, not git. Use ./deploy_qnap.sh sandbox
# deploy_sandbox.sh — push sandbox changes to QNAP and restart Flask
# Mac terminal

QNAP_USER="GaryAdmin"
QNAP_HOST="192.168.1.176"
QNAP_PATH_SSH="/share/CACHEDEV3_DATA/My Stuff/HughsGolf/sandbox"
PYTHON="/share/CACHEDEV1_DATA/.qpkg/Python3/opt/python3/bin/python3"
LOCAL="/Users/garyscudder/Documents/Codex/2026-06-19/g/sandbox/HughsGolf_Web_sandbox"
SSH_KEY="$HOME/.ssh/id_ed25519_qnap"

VERSION=$(grep -m1 "APP_VERSION = '" "$LOCAL/HughsGolf.html" | sed "s/.*APP_VERSION = '//;s/'.*//")
echo "🚀 Deploying HughsGolf sandbox v$VERSION"
echo ""
echo "📤 Copying files to QNAP..."
# Use scp to force-copy key files (rsync skips files with matching timestamps)
scp -i "$SSH_KEY" \
  "$LOCAL/HughsGolf.html" \
  "$LOCAL/app.py" \
  "$QNAP_USER@$QNAP_HOST:$QNAP_PATH_SSH/"

# rsync everything else (templates, static assets, etc.) — excludes main files already copied
rsync -av -e "ssh -i $SSH_KEY" \
  --exclude='.git' \
  --exclude='*.log' \
  --exclude='__pycache__' \
  --exclude='.venv_pdf' \
  --exclude='*.pyc' \
  --exclude='node_modules' \
  --exclude='backups' \
  --exclude='HughsGolf.db' \
  --exclude='HughsGolf.html' \
  --exclude='app.py' \
  "$LOCAL/" "$QNAP_USER@$QNAP_HOST:$QNAP_PATH_SSH"

echo ""
echo "🔄 Restarting Flask on QNAP..."
ssh -i "$SSH_KEY" "$QNAP_USER@$QNAP_HOST" bash << EOF
  # Kill whatever is holding port 8446
  OLD_PID=\$(netstat -tlnp 2>/dev/null | awk '/8446/ {split(\$7,a,"/"); print a[1]}')
  if [ -n "\$OLD_PID" ]; then
    echo "  Killing PID \$OLD_PID on port 8446..."
    kill -9 \$OLD_PID 2>/dev/null
    sleep 2
  else
    echo "  No existing process on port 8446."
  fi

  cd "$QNAP_PATH_SSH"
  # Detach from SSH session: redirect stdin from /dev/null, stdout/stderr to log
  # PDF_RENDERER_URL points to Docker container on localhost:3009
  $PYTHON app.py > "$QNAP_PATH_SSH/flask_sandbox.log" 2>&1 </dev/null &
  disown
  sleep 2

  NEW_PID=\$(netstat -tlnp 2>/dev/null | awk '/8446/ {split(\$7,a,"/"); print a[1]}')
  if [ -n "\$NEW_PID" ]; then
    echo "  ✓ Flask restarted (PID \$NEW_PID)."
  else
    echo "  ⚠ Flask may not have started — check flask_sandbox.log"
  fi
EOF

echo ""
echo "✓ Done. v$VERSION → Sandbox: http://$QNAP_HOST:8446"
echo "                    or:     http://hughsgolf-sandbox.duckdns.org:8446"
