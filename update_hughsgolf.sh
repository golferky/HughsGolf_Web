#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# HughsGolf Mac Update Script
# Usage: ./update_hughsgolf.sh [--no-db] [--no-git] [--deploy]
#   --no-db     skip copying DB from NAS
#   --no-git    skip GitHub push
#   --deploy    copy files to NAS and restart Flask there
# ─────────────────────────────────────────────────────────────────────────────

WEBCODE="/Users/garyscudder/HughsGolf/WebCode"
NAS_WEB="/Volumes/Web"
DOWNLOADS="$HOME/Downloads"
QNAP_USER="GaryAdmin"
QNAP_HOST="192.168.1.176"
QNAP_WEB="/share/CACHEDEV2_DATA/Web"
PYTHON="/share/CACHEDEV2_DATA/.qpkg/Python3/opt/python3/bin/python3"
QNAP_KEY="$HOME/.ssh/qnap_key"

echo "═══════════════════════════════════════"
echo "  HughsGolf Update Script"
echo "═══════════════════════════════════════"

cd "$WEBCODE"

# ── Step 1: Copy downloaded files if present ─────────────────────────────────
echo ""
echo "📁 Checking Downloads folder for new files..."
CHANGED=0

if [ -f "$DOWNLOADS/app.py" ]; then
    cp "$DOWNLOADS/app.py" "$WEBCODE/app.py"
    echo "  ✓ Copied app.py from Downloads"
    rm "$DOWNLOADS/app.py"
    CHANGED=1
fi

if [ -f "$DOWNLOADS/HughsGolf.html" ]; then
    cp "$DOWNLOADS/HughsGolf.html" "$WEBCODE/HughsGolf.html"
    echo "  ✓ Copied HughsGolf.html from Downloads"
    rm "$DOWNLOADS/HughsGolf.html"
    CHANGED=1
fi

# ── Step 1b: Copy and run any patch_*.py files from Downloads ─────────────────
PATCH_RAN=0
for PATCH in "$DOWNLOADS"/patch_*.py; do
    [ -f "$PATCH" ] || continue
    PNAME=$(basename "$PATCH")
    cp "$PATCH" "$WEBCODE/$PNAME"
    echo "  ✓ Copied $PNAME from Downloads"
    rm "$PATCH"
    echo "  🔧 Running $PNAME..."
    python3 "$WEBCODE/$PNAME"
    if [ $? -eq 0 ]; then
        echo "  ✓ $PNAME completed successfully"
        CHANGED=1
        PATCH_RAN=1
    else
        echo "  ✗ $PNAME failed — check output above"
    fi
done

if [ $PATCH_RAN -eq 0 ] && [ ! -f "$DOWNLOADS/app.py" ] && [ ! -f "$DOWNLOADS/HughsGolf.html" ]; then
    echo "  (no new files found)"
fi

# ── Step 2: Copy DB from NAS ─────────────────────────────────────────────────
if [[ "$*" != *"--no-db"* ]]; then
    echo ""
    echo "💾 Copying DB from NAS..."
    if [ -d "$NAS_WEB" ]; then
        cp "$NAS_WEB/HughsGolf.db" "$WEBCODE/HughsGolf.db"
        echo "  ✓ Copied HughsGolf.db from NAS"
    else
        echo "  ⚠ NAS not mounted — skipping DB copy"
        echo "    Mount it with: open smb://GarysNas/Web"
    fi
fi

# ── Step 3: Show versions ─────────────────────────────────────────────────────
echo ""
echo "📋 Current versions:"
VER_APP=$(grep "^VERSION" "$WEBCODE/app.py" 2>/dev/null | cut -d"'" -f2)
VER_HTML=$(grep -o 'v202[0-9]*\.[0-9]*' "$WEBCODE/HughsGolf.html" 2>/dev/null | head -1)
echo "  app.py:         ${VER_APP:-unknown}"
echo "  HughsGolf.html: ${VER_HTML:-unknown}"

# ── Step 4: Git commit and push ───────────────────────────────────────────────
if [[ "$*" != *"--no-git"* && $CHANGED -eq 1 ]]; then
    echo ""
    echo "📤 Pushing to GitHub..."
    git add app.py HughsGolf.html .gitignore 2>/dev/null
    VER="${VER_HTML:-update}"
    git commit -m "$VER" 2>/dev/null && git push origin main && echo "  ✓ Pushed to GitHub" || echo "  ⚠ Git push failed"
fi

# ── Step 5: Deploy to QNAP ───────────────────────────────────────────────────
if [[ "$*" == *"--deploy"* ]]; then
    echo ""
    echo "🚀 Deploying to QNAP..."
    scp -i "$QNAP_KEY" "$WEBCODE/app.py" "$QNAP_USER@$QNAP_HOST:$QNAP_WEB/app.py" && echo "  ✓ Copied app.py to QNAP"
    scp -i "$QNAP_KEY" "$WEBCODE/HughsGolf.html" "$QNAP_USER@$QNAP_HOST:$QNAP_WEB/HughsGolf.html" && echo "  ✓ Copied HughsGolf.html to QNAP"
    scp -i "$QNAP_KEY" "$WEBCODE/restart_flask.sh" "$QNAP_USER@$QNAP_HOST:$QNAP_WEB/restart_flask.sh" && echo "  ✓ Copied restart_flask.sh to QNAP"
    echo "  🔄 Restarting Flask on QNAP..."
    ssh -i "$QNAP_KEY" "$QNAP_USER@$QNAP_HOST" "chmod +x $QNAP_WEB/restart_flask.sh && $QNAP_WEB/restart_flask.sh" && echo "  ✓ Flask restarted on QNAP"
    # Update last deployed SHA so Redeploy button knows current version
    CURRENT_SHA=$(git rev-parse HEAD)
    ssh -i "$QNAP_KEY" "$QNAP_USER@$QNAP_HOST" "echo '$CURRENT_SHA' > $QNAP_WEB/.last_deployed_sha" && echo "  ✓ Updated deployed SHA"
fi

# ── Step 6: Restart Flask locally ─────────────────────────────────────────────
echo ""
echo "🔄 Restarting Flask locally..."
pkill -f "app.py" 2>/dev/null
PID_ON_PORT=$(lsof -ti:8445 2>/dev/null)
if [ -n "$PID_ON_PORT" ]; then kill $PID_ON_PORT 2>/dev/null; echo "  ✓ Killed process on port 8445"; fi
sleep 2

python3 app.py &
sleep 2

echo ""
echo "✅ Done! HughsGolf running at:"
echo "   http://localhost:8445"
if [[ "$*" == *"--deploy"* ]]; then
echo "   http://garyscloud.myqnapcloud.com:8445 (QNAP)"
fi
echo "═══════════════════════════════════════"
