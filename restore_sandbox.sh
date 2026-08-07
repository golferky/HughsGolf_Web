#!/bin/bash
# restore_sandbox.sh — restore a backup DB to QNAP sandbox and restart Flask
#
# Usage:
#   bash restore_sandbox.sh                         # restores default (7/28) backup
#   bash restore_sandbox.sh HughsGolf_20260728_152751.db   # restores specific backup

QNAP_USER="GaryAdmin"
QNAP_HOST="192.168.1.176"
QNAP_PATH_SSH="/share/CACHEDEV3_DATA/My Stuff/HughsGolf/sandbox"
PYTHON="/share/CACHEDEV1_DATA/.qpkg/Python3/opt/python3/bin/python3"
LOCAL_BACKUPS="/Users/garyscudder/Documents/Codex/2026-06-19/g/sandbox/HughsGolf_Web_sandbox/backups"

# Default backup
DEFAULT="HughsGolf_20260728_152751.db"
BACKUP="${1:-$DEFAULT}"
LOCAL_FILE="$LOCAL_BACKUPS/$BACKUP"

if [ ! -f "$LOCAL_FILE" ]; then
  echo "❌ Backup not found: $LOCAL_FILE"
  echo "Available backups:"
  ls "$LOCAL_BACKUPS"/*.db 2>/dev/null | xargs -I{} basename {}
  exit 1
fi

echo "📂 Restoring: $BACKUP"
scp -i ~/.ssh/id_ed25519_qnap -o ConnectTimeout=30 -o ServerAliveInterval=5 \
  "$LOCAL_FILE" \
  "$QNAP_USER@$QNAP_HOST:$QNAP_PATH_SSH/HughsGolf.db"

if [ $? -ne 0 ]; then
  echo "❌ SCP failed."
  exit 1
fi

echo "🔄 Restarting Flask..."
ssh -i ~/.ssh/id_ed25519_qnap "$QNAP_USER@$QNAP_HOST" << EOF
  pkill -f 'app.py' 2>/dev/null
  sleep 1
  cd "$QNAP_PATH_SSH"
  setsid $PYTHON app.py > "$QNAP_PATH_SSH/flask_sandbox.log" 2>&1 &
  sleep 1
  echo "✓ Flask restarted."
EOF

echo ""
echo "✓ Done. Restored $BACKUP to sandbox."
echo "  → Cmd+R in the browser to reload."
