#!/bin/bash
# restart_flask.sh — restart the sandbox Flask server on QNAP
# Run this from your Mac when you need to restart without a full deploy.

QNAP_USER="GaryAdmin"
QNAP_HOST="192.168.1.176"
QNAP_PATH_SSH="/share/CACHEDEV3_DATA/My Stuff/HughsGolf/sandbox"
PYTHON="/share/CACHEDEV1_DATA/.qpkg/Python3/opt/python3/bin/python3"

echo "🔄 Restarting Flask on QNAP..."
ssh -i ~/.ssh/id_ed25519_qnap "$QNAP_USER@$QNAP_HOST" << EOF
  pkill -f 'app.py' 2>/dev/null
  sleep 1
  cd "$QNAP_PATH_SSH"
  nohup $PYTHON app.py > "$QNAP_PATH_SSH/flask_sandbox.log" 2>&1 &
  sleep 1
  echo "✓ Flask restarted."
EOF

echo "✓ Done. Sandbox at http://$QNAP_HOST:8446"
