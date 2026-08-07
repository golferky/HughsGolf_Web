#!/bin/bash
# deploy_sandbox.sh — push sandbox changes to QNAP and restart Flask

QNAP_USER="GaryAdmin"
QNAP_HOST="192.168.1.176"
QNAP_PATH="/share/CACHEDEV3_DATA/My\ Stuff/HughsGolf/sandbox"
QNAP_PATH_SSH="/share/CACHEDEV3_DATA/My Stuff/HughsGolf/sandbox"
PYTHON="/share/CACHEDEV1_DATA/.qpkg/Python3/opt/python3/bin/python3"
LOCAL="/Users/garyscudder/Documents/Codex/2026-06-19/g/sandbox/HughsGolf_Web_sandbox"

echo "📤 Syncing files to QNAP..."
rsync -av -e "ssh -i ~/.ssh/id_ed25519_qnap" \
  --exclude='.git' \
  --exclude='*.log' \
  --exclude='__pycache__' \
  --exclude='.venv_pdf' \
  --exclude='*.pyc' \
  --exclude='node_modules' \
  --exclude='backups' \
  --exclude='HughsGolf.db' \
  "$LOCAL/" "$QNAP_USER@$QNAP_HOST:$QNAP_PATH"

echo ""
echo "🔄 Restarting Flask on QNAP..."
ssh -i ~/.ssh/id_ed25519_qnap "$QNAP_USER@$QNAP_HOST" << EOF
  pkill -f 'app.py' 2>/dev/null
  sleep 1
  cd "$QNAP_PATH_SSH"
  setsid $PYTHON app.py > "$QNAP_PATH_SSH/flask_sandbox.log" 2>&1 &
  sleep 1
  echo "✓ Flask restarted."
EOF

echo ""
echo "✓ Done. Sandbox running at http://$QNAP_HOST:8446"
