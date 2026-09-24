"""
HughsGolf Flask Server
Serves HughsGolf.html + HughsGolf.db and handles DB save + password reset emails.
Run: /share/CACHEDEV2_DATA/.qpkg/Python3/opt/python3/bin/python3 app.py
"""

import os
import shutil
import datetime
import json
import random
import shlex
import string
import smtplib
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from zoneinfo import ZoneInfo
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from flask import Flask, send_from_directory, request, jsonify

EASTERN = ZoneInfo('America/New_York')

def now_local():
    """Current time in Eastern (handles EST/EDT automatically) — QNAP/server clocks run UTC."""
    return datetime.datetime.now(EASTERN)

app = Flask(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DB_PATH      = os.path.join(BASE_DIR, 'HughsGolf.db')
TEST_DB_PATH = os.path.join(BASE_DIR, 'HughsGolf-test.db')
BACKUP_ROOT_DIR = os.path.join(BASE_DIR, 'backups')
# Backup rules differ by environment:
#   sandbox — shorter cooldown (active dev), smaller rolling window
#   live    — longer cooldown (real user data), larger rolling window
_IS_SANDBOX = 'sandbox' in os.environ.get('HUGHSGOLF_ENV', 'sandbox').lower() or True  # overridden below after VERSION is set
BACKUP_COOLDOWN_MINUTES = 30    # sandbox: 30 min; live: 60 min (set below)
BACKUP_ROLLING_KEEP    = 20     # sandbox: 20; live: 30 (set below)
SAVE_TOKEN = 'HughsGolf2026Save'
PORT       = int(os.environ.get('HUGHSGOLF_PORT', '8446'))
VERSION    = '20260924.1-sandbox'
LOG_PATH   = os.environ.get('HUGHSGOLF_LOG', os.path.join(BASE_DIR, 'flask_garyadmin.log'))
DB_TIMEOUT_SECONDS = 15
DB_WRITE_LOCK = threading.RLock()
PDF_RENDERER_URL = os.environ.get('HUGHSGOLF_PDF_RENDERER_URL', 'http://127.0.0.1:3009/render')
LIVE_DB_PATH   = os.environ.get('HUGHSGOLF_LIVE_DB', '/Users/garyscudder/HughsGolfLive/HughsGolf.db')
LIVE_SERVER_URL = os.environ.get('HUGHSGOLF_LIVE_URL', 'http://192.168.1.190:8445')  # Mac mini live server
# ─────────────────────────────────────────────────────────────────────────────

def backup_env_name():
    return 'sandbox' if 'sandbox' in VERSION.lower() else 'live'

# Set backup tuning based on environment
if 'sandbox' in VERSION.lower():
    BACKUP_COOLDOWN_MINUTES = 30
    BACKUP_ROLLING_KEEP    = 20
else:
    BACKUP_COOLDOWN_MINUTES = 60
    BACKUP_ROLLING_KEEP    = 30

def backup_dir():
    path = os.path.join(BACKUP_ROOT_DIR, backup_env_name())
    os.makedirs(path, exist_ok=True)
    return path

os.makedirs(backup_dir(), exist_ok=True)

def db_modified_ms():
    """Current DB modified time in milliseconds, or 0 if no DB exists."""
    try:
        return int(os.path.getmtime(DB_PATH) * 1000) if os.path.exists(DB_PATH) else 0
    except Exception:
        return 0

def test_db_modified_ms():
    try:
        return int(os.path.getmtime(TEST_DB_PATH) * 1000) if os.path.exists(TEST_DB_PATH) else 0
    except Exception:
        return 0

# In-memory reset tokens: { token: { player, expires } }
reset_tokens = {}

CARRIER_GATEWAYS = {
    'att': 'txt.att.net',
    'at&t': 'txt.att.net',
    'verizon': 'vtext.com',
    'sprint': 'messaging.sprintpcs.com',
    'tmobile': 'tmomail.net',
    't-mobile': 'tmomail.net',
    'boost': 'myboostmobile.com',
    'cbw': 'gocbw.com',
    'cricket': 'sms.cricketwireless.net',
    'metro': 'mymetropcs.com',
    'uscellular': 'email.uscc.net',
    'us cellular': 'email.uscc.net',
}


def sms_address(phone, carrier):
    """Return the email-to-SMS address using the same gateway style as desktop."""
    if not phone or not carrier:
        return None, 'Missing phone or carrier'

    raw_carrier = str(carrier).strip().lower()
    gateway = CARRIER_GATEWAYS.get(raw_carrier.replace(' ', '')) or CARRIER_GATEWAYS.get(raw_carrier)
    if not gateway:
        return None, f'Unknown carrier: {carrier}'

    phone_digits = ''.join(c for c in str(phone) if c.isdigit())
    if len(phone_digits) == 11 and phone_digits.startswith('1'):
        phone_digits = phone_digits[1:]
    if len(phone_digits) != 10:
        return None, 'Invalid phone number format'

    return f'{phone_digits}@{gateway}', None


def get_gmail_creds():
    """Read Gmail credentials from LeagueSettings (falls back to LeagueParms for legacy DBs)."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        # Try new LeagueSettings table first
        try:
            cur.execute("SELECT Email, EmailPassword FROM LeagueSettings WHERE League=\"Hugh's\"")
            row = cur.fetchone()
            if row and row['Email']:
                conn.close()
                return row['Email'], row['EmailPassword']
        except Exception:
            pass
        # Fallback: legacy LeagueParms table
        try:
            cur.execute("SELECT Email, EmailPassword FROM LeagueParms WHERE Name=\"Hugh's\" ORDER BY Season DESC LIMIT 1")
            row = cur.fetchone()
            if row and row['Email']:
                conn.close()
                return row['Email'], row['EmailPassword']
        except Exception:
            pass
        conn.close()
    except Exception as e:
        print(f'get_gmail_creds error: {e}')
    return None, None


@app.route('/get-ip')
def get_ip():
    """Return the caller's IP address (for login/audit logging)."""
    ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    if ip and ',' in ip:
        ip = ip.split(',')[0].strip()
    return jsonify({'ip': ip})


@app.route('/')
def index():
    resp = send_from_directory(BASE_DIR, 'HughsGolf.html')
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    # Remove ETag and Last-Modified so the browser can't get a 304 and use stale content
    resp.headers.remove('ETag')
    resp.headers.remove('Last-Modified')
    return resp


@app.route('/version')
def version():
    try:
        import re
        with open(os.path.join(BASE_DIR, 'HughsGolf.html'), 'r') as f:
            content = f.read(150000)
        match = re.search(r"APP_VERSION\s*=\s*['\"](\d[\d.]+)['\"]", content)
        html_version = match.group(1) if match else VERSION
    except Exception:
        html_version = VERSION
    try:
        db_modified = os.path.getmtime(DB_PATH) if os.path.exists(DB_PATH) else 0
    except Exception:
        db_modified = 0
    return jsonify({'version': html_version, 'flaskVersion': VERSION, 'dbModified': db_modified})


@app.route('/HughsGolf.html')
def html():
    resp = send_from_directory(BASE_DIR, 'HughsGolf.html')
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    return resp


@app.route('/HughsGolf.db')
def database():
    return send_from_directory(BASE_DIR, 'HughsGolf.db')

@app.route('/fetch-live-db')
def fetch_live_db():
    """Sandbox-only: proxy-fetch the live Mac Mini DB for in-browser comparison."""
    if 'sandbox' not in VERSION:
        return jsonify({'error': 'Not available on live'}), 403
    import urllib.request as _req
    live_url = 'http://192.168.1.190:8445/HughsGolf.db'
    try:
        with _req.urlopen(live_url, timeout=10) as resp:
            data = resp.read()
        from flask import Response
        return Response(data, mimetype='application/octet-stream',
                        headers={'Content-Disposition': 'attachment; filename=HughsGolf_live.db'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500







@app.route('/latest-version')
def latest_version():
    """Return the latest commit SHA and version from GitHub."""
    import urllib.request, json
    try:
        url = 'https://api.github.com/repos/golferky/HughsGolf_Web/commits/main'
        req = urllib.request.Request(url, headers={'User-Agent': 'HughsGolf'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        sha = data.get('sha', '')[:7]
        msg = data.get('commit', {}).get('message', '')
        sha_file = '/share/CACHEDEV2_DATA/Web/.last_deployed_sha'
        current = ''
        if os.path.exists(sha_file):
            with open(sha_file) as f:
                current = f.read().strip()[:7]
        return jsonify({'ok': True, 'latest': sha, 'current': current, 'message': msg, 'upToDate': sha == current})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)})


@app.route('/redeploy', methods=['POST'])
def redeploy():
    """Trigger auto-deploy script (Developer only)."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    import subprocess, threading
    def do_deploy():
        sha_file = '/share/CACHEDEV2_DATA/Web/.last_deployed_sha'
        if os.path.exists(sha_file):
            os.remove(sha_file)
        subprocess.run(['/share/CACHEDEV2_DATA/Web/auto_deploy.sh'], check=False)
    threading.Thread(target=do_deploy, daemon=True).start()
    print(f'[{now_local():%H:%M:%S}] Manual redeploy triggered')
    return jsonify({'ok': True, 'message': 'Deploy triggered'})


@app.route('/webhook', methods=['POST'])
def webhook():
    """GitHub webhook — pull latest code and restart Flask."""
    import hmac, hashlib, subprocess, threading
    secret = os.environ.get('WEBHOOK_SECRET', '').encode()
    sig = request.headers.get('X-Hub-Signature-256', '')
    body = request.get_data()
    if secret:
        expected = 'sha256=' + hmac.new(secret, body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return jsonify({'ok': False, 'error': 'Invalid signature'}), 403

    def do_deploy():
        import time
        time.sleep(1)
        subprocess.run(['/share/CACHEDEV2_DATA/Web/auto_deploy.sh'], check=False)

    threading.Thread(target=do_deploy, daemon=True).start()
    print(f'[{now_local():%H:%M:%S}] Webhook received — deploying...')
    return jsonify({'ok': True, 'message': 'Deploy triggered'})


@app.route('/db-info')
def db_info():
    """Return DB file metadata for display in the header."""
    try:
        if not os.path.exists(DB_PATH):
            return jsonify({'ok': False, 'error': 'DB not found'}), 404
        stat = os.stat(DB_PATH)
        modified_ms = db_modified_ms()
        modified_str = datetime.datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S')
        return jsonify({
            'ok': True,
            'filename': os.path.basename(DB_PATH),
            'size': stat.st_size,
            'modified': modified_str,
            'modifiedMs': modified_ms
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/HughsGolf-test.db')
def serve_test_db():
    """Serve test DB (sandbox-only, no auth). Creates copy from main DB on first access."""
    if not os.path.exists(TEST_DB_PATH):
        if os.path.exists(DB_PATH):
            shutil.copy2(DB_PATH, TEST_DB_PATH)
        else:
            return jsonify({'ok': False, 'error': 'No source DB'}), 404
    return send_from_directory(BASE_DIR, 'HughsGolf-test.db')


@app.route('/db-info-test')
def db_info_test():
    try:
        exists = os.path.exists(TEST_DB_PATH)
        if not exists:
            return jsonify({'ok': True, 'filename': 'HughsGolf-test.db', 'size': 0, 'modified': 'not created yet', 'modifiedMs': 0})
        stat = os.stat(TEST_DB_PATH)
        return jsonify({
            'ok': True,
            'filename': 'HughsGolf-test.db',
            'size': stat.st_size,
            'modified': datetime.datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
            'modifiedMs': test_db_modified_ms()
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/save-test', methods=['POST'])
def save_test_db():
    """Save binary DB to HughsGolf-test.db — no backups, simplified stale check."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    data = request.get_data()
    if not data:
        return jsonify({'ok': False, 'error': 'Empty body'}), 400
    with DB_WRITE_LOCK:
        tmp = TEST_DB_PATH + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(data)
        os.replace(tmp, TEST_DB_PATH)
        modified_ms = test_db_modified_ms()
    print(f'[{now_local():%H:%M:%S}] TEST DB saved — {len(data):,} bytes', flush=True)
    return jsonify({'ok': True, 'bytes': len(data), 'modifiedMs': modified_ms})


@app.route('/reset-test-db', methods=['POST'])
def reset_test_db():
    """Copy main DB to test DB — wipes all test data."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    if not os.path.exists(DB_PATH):
        return jsonify({'ok': False, 'error': 'Main DB not found'}), 404
    with DB_WRITE_LOCK:
        shutil.copy2(DB_PATH, TEST_DB_PATH)
        modified_ms = test_db_modified_ms()
    print(f'[{now_local():%H:%M:%S}] Test DB reset from main DB', flush=True)
    return jsonify({'ok': True, 'modifiedMs': modified_ms})


# ── Per-admin test DB helpers ─────────────────────────────────────────────────

def _admin_test_db_path(username):
    """Return the path for a per-admin test DB. Username is sanitized."""
    safe = ''.join(c for c in username.lower() if c.isalnum())[:20] or 'admin'
    return os.path.join(BASE_DIR, f'HughsGolf-test-{safe}.db')

@app.route('/HughsGolf-test-<username>.db')
def serve_admin_test_db(username):
    """Serve per-admin test DB. Creates a copy from sandbox DB on first access."""
    path = _admin_test_db_path(username)
    filename = os.path.basename(path)
    if not os.path.exists(path):
        if os.path.exists(DB_PATH):
            shutil.copy2(DB_PATH, path)
        else:
            return jsonify({'ok': False, 'error': 'No source DB'}), 404
    return send_from_directory(BASE_DIR, filename)

@app.route('/db-info-test-<username>')
def db_info_admin_test(username):
    path = _admin_test_db_path(username)
    filename = os.path.basename(path)
    try:
        exists = os.path.exists(path)
        if not exists:
            return jsonify({'ok': True, 'filename': filename, 'size': 0, 'modified': 'not created yet', 'modifiedMs': 0, 'exists': False})
        stat = os.stat(path)
        return jsonify({
            'ok': True, 'exists': True,
            'filename': filename,
            'size': stat.st_size,
            'modified': datetime.datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
            'modifiedMs': int(stat.st_mtime * 1000)
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/save-test-<username>', methods=['POST'])
def save_admin_test_db(username):
    """Save binary DB to per-admin test file."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    data = request.get_data()
    if not data:
        return jsonify({'ok': False, 'error': 'Empty body'}), 400
    path = _admin_test_db_path(username)
    with DB_WRITE_LOCK:
        tmp = path + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(data)
        os.replace(tmp, path)
        modified_ms = int(os.path.getmtime(path) * 1000)
    print(f'[{now_local():%H:%M:%S}] Test DB saved for {username} — {len(data):,} bytes', flush=True)
    return jsonify({'ok': True, 'bytes': len(data), 'modifiedMs': modified_ms})

@app.route('/rebuild-test-db', methods=['POST'])
def rebuild_admin_test_db():
    """Rebuild a per-admin test DB from sandbox or live source."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    body = request.get_json(force=True, silent=True) or {}
    username = body.get('username', '').strip()
    source   = body.get('source', 'sandbox')  # 'sandbox' or 'live'
    if not username:
        return jsonify({'ok': False, 'error': 'username required'}), 400
    if source == 'live':
        src_path = LIVE_DB_PATH
    else:
        src_path = DB_PATH
    if not os.path.exists(src_path):
        return jsonify({'ok': False, 'error': f'Source DB not found: {src_path}'}), 404
    dest_path = _admin_test_db_path(username)
    with DB_WRITE_LOCK:
        shutil.copy2(src_path, dest_path)
        modified_ms = int(os.path.getmtime(dest_path) * 1000)
    print(f'[{now_local():%H:%M:%S}] Test DB rebuilt for {username} from {source}', flush=True)
    return jsonify({'ok': True, 'modifiedMs': modified_ms})

@app.route('/delete-test-db', methods=['POST'])
def delete_admin_test_db():
    """Delete a per-admin test DB file."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    body = request.get_json(force=True, silent=True) or {}
    username = body.get('username', '').strip()
    if not username:
        return jsonify({'ok': False, 'error': 'username required'}), 400
    path = _admin_test_db_path(username)
    if os.path.exists(path):
        os.remove(path)
        print(f'[{now_local():%H:%M:%S}] Test DB deleted for {username}', flush=True)
    return jsonify({'ok': True})

# ── End per-admin test DB ──────────────────────────────────────────────────────

@app.route('/save-token')
def save_token():
    """Return the save token so the browser can authenticate DB saves."""
    return jsonify({'ok': True, 'token': SAVE_TOKEN})


@app.route('/save', methods=['POST'])
def save_db():
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403

    data = request.get_data()
    if not data:
        return jsonify({'ok': False, 'error': 'Empty body'}), 400

    # Check if client is on an outdated version
    client_version = request.headers.get('X-Client-Version', '')
    if client_version:
        try:
            import re
            with open(os.path.join(BASE_DIR, 'HughsGolf.html'), 'r') as f:
                content = f.read(150000)
            match = re.search(r"APP_VERSION\s*=\s*['\"](\d[\d.]+)['\"]", content)
            server_version = match.group(1) if match else None
            # Strip -sandbox/-local suffix before comparing; only reject if server is strictly NEWER
            sv_clean  = (server_version  or '').replace('-sandbox','').replace('-local','')
            cv_clean  = (client_version  or '').replace('-sandbox','').replace('-local','')
            if sv_clean and cv_clean and sv_clean > cv_clean:
                return jsonify({'ok': False, 'error': 'stale_version', 'serverVersion': server_version, 'flaskVersion': VERSION}), 409
        except Exception:
            pass

    with DB_WRITE_LOCK:
        current_ms = db_modified_ms()
        client_db_modified = request.headers.get('X-DB-Modified-Ms', '').strip()
        try:
            client_ms = int(float(client_db_modified)) if client_db_modified else 0
        except ValueError:
            client_ms = 0
        if current_ms and client_ms and current_ms > client_ms + 1500:
            print(f'[save] STALE_DB rejected: server={current_ms} client={client_ms} diff={current_ms - client_ms}ms', flush=True)
            return jsonify({
                'ok': False,
                'error': 'stale_db',
                'message': 'The server database has newer changes. Reload before saving.',
                'serverModifiedMs': current_ms,
                'clientModifiedMs': client_ms
            }), 409

        if os.path.exists(DB_PATH):
            env_backup_dir = backup_dir()
            existing = sorted(
                [f for f in os.listdir(env_backup_dir) if f.endswith('.db')],
                reverse=True
            )
            # Only create a backup if none exists yet or the newest is older than the cooldown
            do_backup = True
            if existing:
                import re as _re
                m = _re.search(r'(\d{8}_\d{6})', existing[0])
                if m:
                    try:
                        from datetime import datetime as _dt
                        last_ts = _dt.strptime(m.group(1), '%Y%m%d_%H%M%S')
                        age_min = (now_local().replace(tzinfo=None) - last_ts).total_seconds() / 60
                        if age_min < BACKUP_COOLDOWN_MINUTES:
                            do_backup = False
                    except Exception:
                        pass
            if do_backup:
                ts = now_local().strftime('%Y%m%d_%H%M%S')
                _bname = f'HughsGolf_{ts}.db'
                backup = os.path.join(env_backup_dir, _bname)
                shutil.copy2(DB_PATH, backup)
                _write_backup_sidecar(env_backup_dir, _bname, version=VERSION, note='auto')
                existing = sorted(
                    [f for f in os.listdir(env_backup_dir) if f.endswith('.db')],
                    reverse=True
                )
                # Protect the newest backup from each calendar week (weekly anchors)
                _weekly = {}
                for _f in existing:
                    _m2 = _re.search(r'(\d{8})_\d{6}', _f)
                    if _m2:
                        try:
                            _wk = _dt.strptime(_m2.group(1), '%Y%m%d').strftime('%Y-W%W')
                            if _wk not in _weekly:
                                _weekly[_wk] = _f  # existing sorted newest-first → first seen = newest of week
                        except Exception:
                            pass
                _protected = set(existing[:BACKUP_ROLLING_KEEP]) | set(_weekly.values())
                for old in existing:
                    if old not in _protected:
                        os.remove(os.path.join(env_backup_dir, old))

        tmp = DB_PATH + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(data)
        os.replace(tmp, DB_PATH)
        modified_ms = db_modified_ms()

    print(f'[{now_local():%H:%M:%S}] DB saved — {len(data):,} bytes')
    return jsonify({'ok': True, 'bytes': len(data), 'modifiedMs': modified_ms})


@app.route('/backup-list')
def backup_list():
    """List available DB backups with per-date row counts across key tables."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    try:
        limit = int(request.args.get('limit', 40))
    except ValueError:
        limit = 40

    try:
        env_backup_dir = backup_dir()
        files = [f for f in os.listdir(env_backup_dir) if f.endswith('.db')]
        files_full = [(f, os.path.join(env_backup_dir, f)) for f in files]
        files_full.sort(key=lambda x: os.path.getmtime(x[1]), reverse=True)
        files_full = files_full[:limit]

        backups = []
        for fname, fpath in files_full:
            entry = {
                'filename': fname,
                'modified': datetime.datetime.fromtimestamp(os.path.getmtime(fpath), EASTERN).strftime('%Y-%m-%d %I:%M %p'),
                'size': os.path.getsize(fpath),
            }
            try:
                bconn = sqlite3.connect(fpath)
                bconn.row_factory = sqlite3.Row
                bcur = bconn.cursor()
                bcur.execute("SELECT DISTINCT Date FROM Scores ORDER BY Date DESC LIMIT 3")
                recent_dates = [r['Date'] for r in bcur.fetchall()]
                dates = []
                for d in recent_dates:
                    counts = {'Date': d}
                    for tbl, key in [('Scores','scores'),('Matches','matches'),('Payments','payments'),('Subs','subs'),('Handicaps','handicaps')]:
                        try:
                            bcur.execute(f"SELECT COUNT(*) as c FROM {tbl} WHERE Date=?", (d,))
                            counts[key] = bcur.fetchone()['c']
                        except Exception:
                            counts[key] = 0
                    dates.append(counts)
                entry['dates'] = dates
                bconn.close()
            except Exception as e:
                entry['error'] = f'Could not read: {e}'
            # Read sidecar note file if present
            sidecar = os.path.join(env_backup_dir, fname.replace('.db', '.json'))
            if os.path.isfile(sidecar):
                try:
                    import json as _json
                    with open(sidecar) as _sf:
                        entry['meta'] = _json.load(_sf)
                except Exception:
                    pass
            backups.append(entry)

        return jsonify({'ok': True, 'backupEnv': backup_env_name(), 'backupDir': env_backup_dir, 'backups': backups})
    except Exception as e:
        print(f'[{now_local():%H:%M:%S}] backup_list error: {e}')
        return jsonify({'ok': False, 'error': str(e)}), 500


def _write_backup_sidecar(env_backup_dir, backup_name, version='', note='', changelog_ref=''):
    """Write a .json sidecar file alongside a .db backup."""
    import json as _json
    sidecar_name = backup_name.replace('.db', '.json')
    sidecar_path = os.path.join(env_backup_dir, sidecar_name)
    data = {'version': version, 'note': note, 'changelogRef': changelog_ref,
            'created': now_local().strftime('%Y-%m-%d %H:%M:%S')}
    try:
        with open(sidecar_path, 'w') as f:
            _json.dump(data, f)
    except Exception as e:
        print(f'[{now_local():%H:%M:%S}] sidecar write error: {e}')


@app.route('/create-backup', methods=['POST'])
def create_backup():
    """Create a manual checkpoint backup of the current DB."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    if not os.path.exists(DB_PATH):
        return jsonify({'ok': False, 'error': 'Current database not found'}), 404
    body = request.get_json() or {}
    note = str(body.get('note', '')).strip()
    version = str(body.get('version', VERSION)).strip()
    changelog_ref = str(body.get('changelogRef', '')).strip()

    try:
        with DB_WRITE_LOCK:
            env_backup_dir = backup_dir()
            ts = now_local().strftime('%Y%m%d_%H%M%S')
            backup_name = f'HughsGolf_{ts}_manual-checkpoint.db'
            shutil.copy2(DB_PATH, os.path.join(env_backup_dir, backup_name))
        _write_backup_sidecar(env_backup_dir, backup_name, version=version, note=note, changelog_ref=changelog_ref)
        print(f'[{now_local():%H:%M:%S}] Created manual backup {backup_name}')
        return jsonify({'ok': True, 'backup': backup_name})
    except Exception as e:
        print(f'[{now_local():%H:%M:%S}] create_backup error: {e}')
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/save-backup-note', methods=['POST'])
def save_backup_note():
    """Update the sidecar note for an existing backup."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    body = request.get_json() or {}
    filename = os.path.basename(body.get('filename', ''))
    if not filename:
        return jsonify({'ok': False, 'error': 'No filename'}), 400
    env_backup_dir = backup_dir()
    if not os.path.isfile(os.path.join(env_backup_dir, filename)):
        return jsonify({'ok': False, 'error': 'Backup not found'}), 404
    note = str(body.get('note', '')).strip()
    version = str(body.get('version', '')).strip()
    changelog_ref = str(body.get('changelogRef', '')).strip()
    # Merge with existing sidecar if present
    import json as _json
    sidecar_path = os.path.join(env_backup_dir, filename.replace('.db', '.json'))
    existing = {}
    if os.path.isfile(sidecar_path):
        try:
            with open(sidecar_path) as f:
                existing = _json.load(f)
        except Exception:
            pass
    existing['note'] = note
    if version:
        existing['version'] = version
    if changelog_ref is not None:
        existing['changelogRef'] = changelog_ref
    try:
        with open(sidecar_path, 'w') as f:
            _json.dump(existing, f)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/refresh-sandbox-from-live', methods=['POST'])
def refresh_sandbox_from_live():
    """Replace the sandbox DB with the live DB after saving a sandbox safety backup.
    Tries local file path first (Mac dev), falls back to HTTP fetch from live server (QNAP)."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    if 'sandbox' not in VERSION.lower():
        return jsonify({'ok': False, 'error': 'This action is only allowed on the sandbox server'}), 400

    try:
        with DB_WRITE_LOCK:
            env_backup_dir = backup_dir()
            ts = now_local().strftime('%Y%m%d_%H%M%S')
            safety_name = f'HughsGolf_{ts}_pre-live-refresh.db'
            safety_path = os.path.join(env_backup_dir, safety_name)
            if os.path.exists(DB_PATH):
                shutil.copy2(DB_PATH, safety_path)

            source = None
            if os.path.isfile(LIVE_DB_PATH):
                # Local file available (Mac dev environment)
                shutil.copy2(LIVE_DB_PATH, DB_PATH)
                source = LIVE_DB_PATH
            else:
                # Fetch from live server via HTTP (QNAP environment)
                url = f'{LIVE_SERVER_URL}/HughsGolf.db'
                print(f'[{now_local():%H:%M:%S}] Fetching live DB from {url}')
                import urllib.request
                with urllib.request.urlopen(url, timeout=30) as resp:
                    with open(DB_PATH, 'wb') as f:
                        f.write(resp.read())
                source = url

        print(f'[{now_local():%H:%M:%S}] Refreshed sandbox DB from {source} (safety copy: {safety_name})')
        return jsonify({'ok': True, 'source': source, 'safetyBackup': safety_name})
    except Exception as e:
        print(f'[{now_local():%H:%M:%S}] refresh_sandbox_from_live error: {e}')
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/restore-backup', methods=['POST'])
def restore_backup():
    """Restore a backup file over the current DB, saving the current DB first."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    body = request.get_json() or {}
    filename = os.path.basename(body.get('filename', ''))
    if not filename:
        return jsonify({'ok': False, 'error': 'No filename provided'}), 400
    env_backup_dir = backup_dir()
    src = os.path.join(env_backup_dir, filename)
    if not os.path.isfile(src):
        return jsonify({'ok': False, 'error': 'Backup not found'}), 404

    try:
        with DB_WRITE_LOCK:
            env_backup_dir = backup_dir()
            ts = now_local().strftime('%Y%m%d_%H%M%S')
            safety_name = f'HughsGolf_{ts}_pre-restore.db'
            safety_path = os.path.join(env_backup_dir, safety_name)
            if os.path.exists(DB_PATH):
                shutil.copy2(DB_PATH, safety_path)
            shutil.copy2(src, DB_PATH)
        _write_backup_sidecar(env_backup_dir, safety_name, version=VERSION,
                              note=f'Auto safety copy before restoring {filename}')
        print(f'[{now_local():%H:%M:%S}] Restored backup {filename} (safety copy: {safety_name})')
        return jsonify({'ok': True, 'restored': filename, 'safetyBackup': safety_name})
    except Exception as e:
        print(f'[{now_local():%H:%M:%S}] restore_backup error: {e}')
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/delete-backup', methods=['POST'])
def delete_backup():
    """Soft-delete a backup file (moves to trash/ subfolder)."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    body = request.get_json() or {}
    filename = os.path.basename(body.get('filename', ''))
    if not filename:
        return jsonify({'ok': False, 'error': 'No filename provided'}), 400
    path = os.path.join(backup_dir(), filename)
    if not os.path.isfile(path):
        return jsonify({'ok': False, 'error': 'Backup not found'}), 404

    try:
        trash = os.path.join(backup_dir(), 'trash')
        os.makedirs(trash, exist_ok=True)
        shutil.move(path, os.path.join(trash, filename))
        print(f'[{now_local():%H:%M:%S}] Trashed backup {filename}')
        return jsonify({'ok': True, 'deleted': filename})
    except Exception as e:
        print(f'[{now_local():%H:%M:%S}] delete_backup error: {e}')
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/undo-backup-delete', methods=['POST'])
def undo_backup_delete():
    """Restore one or more backups from trash/ back to the backup folder."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    body = request.get_json() or {}
    filenames = body.get('filenames', [])
    if not filenames:
        return jsonify({'ok': False, 'error': 'No filenames provided'}), 400

    trash = os.path.join(backup_dir(), 'trash')
    restored, errors = [], []
    for raw in filenames:
        filename = os.path.basename(raw)
        src = os.path.join(trash, filename)
        dst = os.path.join(backup_dir(), filename)
        if not os.path.isfile(src):
            errors.append(f'{filename}: not in trash')
            continue
        try:
            shutil.move(src, dst)
            restored.append(filename)
            print(f'[{now_local():%H:%M:%S}] Restored from trash: {filename}')
        except Exception as e:
            errors.append(f'{filename}: {e}')
    if errors and not restored:
        return jsonify({'ok': False, 'error': '; '.join(errors)}), 500
    return jsonify({'ok': True, 'restored': restored, 'errors': errors})


@app.route('/send-reset', methods=['POST'])
def send_reset():
    """Generate a reset token and email it to the player."""
    body = request.get_json()
    player = body.get('player', '').strip()
    if not player:
        return jsonify({'ok': False, 'error': 'No player name'}), 400

    # Look up player email from DB
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT Email FROM Players WHERE Player=?", (player,))
        row = cur.fetchone()
        conn.close()
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

    if not row or not row['Email']:
        return jsonify({'ok': False, 'error': 'No email on file for this player. Contact your league officer.'}), 404

    player_email = row['Email']

    # Generate 6-digit token
    token = ''.join(random.choices(string.digits, k=6))
    expires = now_local() + datetime.timedelta(hours=1)
    reset_tokens[player] = {'token': token, 'expires': expires}

    # Send email
    gmail_user, gmail_pw = get_gmail_creds()
    if not gmail_user or not gmail_pw:
        return jsonify({'ok': False, 'error': 'Email not configured'}), 500

    try:
        msg = MIMEMultipart()
        msg['From']    = gmail_user
        msg['To']      = player_email
        msg['Subject'] = "Hugh's Golf League — Password Reset"
        body_text = f"""Hi {player},

Your password reset code for Hugh's Golf League is:

    {token}

Enter this code on the login screen to set a new password.
This code expires in 1 hour.

If you did not request this, please ignore this email.

— Hugh's Golf League
"""
        msg.attach(MIMEText(body_text, 'plain'))
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(gmail_user, gmail_pw)
            server.send_message(msg)

        print(f'[{now_local():%H:%M:%S}] Reset email sent to {player_email} for {player}')
        return jsonify({'ok': True, 'email': player_email[:3] + '***' + player_email[player_email.index('@'):]})

    except Exception as e:
        print(f'send_reset email error: {e}')
        return jsonify({'ok': False, 'error': 'Failed to send email. Check Gmail credentials.'}), 500


@app.route('/verify-reset', methods=['POST'])
def verify_reset():
    """Verify a reset token."""
    body  = request.get_json()
    player = body.get('player', '').strip()
    token  = body.get('token', '').strip()

    entry = reset_tokens.get(player)
    if not entry:
        return jsonify({'ok': False, 'error': 'No reset request found. Please request a new code.'}), 400
    if now_local() > entry['expires']:
        del reset_tokens[player]
        return jsonify({'ok': False, 'error': 'Code expired. Please request a new one.'}), 400
    if entry['token'] != token:
        return jsonify({'ok': False, 'error': 'Incorrect code. Please try again.'}), 400

    # Valid — consume token
    del reset_tokens[player]
    return jsonify({'ok': True})


@app.route('/notify-login', methods=['POST'])
def notify_login():
    """Email the developer whenever someone logs in. On a player's first-ever
    login, also send a distinct email subject and a text via the developer's
    carrier SMS gateway."""
    body = request.get_json() or {}
    player      = body.get('player', 'Unknown')
    role        = body.get('role', 'unknown')
    version     = body.get('version', 'unknown')
    ip          = body.get('ip', 'unknown')
    first_login = bool(body.get('firstLogin', False))

    gmail_user, gmail_pw = get_gmail_creds()
    if not gmail_user or not gmail_pw:
        return jsonify({'ok': False, 'error': 'Email not configured'}), 500

    dev_email = 'garyrscudder@gmail.com'
    subject = f"🎉 First login: {player}" if first_login else "HughsGolf activity log"
    body_text = f"""{player} ({role}) logged in — v{version}, ip={ip}, {now_local():%Y-%m-%d %H:%M:%S}
"""
    sent_to = []
    errors = []

    def ensure_first_login_audit():
        """The SMS is sent server-side, so keep a server-side audit row with it."""
        now = now_local().strftime('%Y-%m-%d %H:%M:%S')
        login_text = f'{player} logged in'
        details = f'role={role} version={version} ip={ip} device=server-notify first_login_sms=1'
        try:
            with DB_WRITE_LOCK:
                conn = sqlite3.connect(DB_PATH, timeout=DB_TIMEOUT_SECONDS)
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()
                cur.execute("SELECT FirstLoginAt FROM Players WHERE Player=?", (player,))
                player_row = cur.fetchone()
                if player_row and not player_row['FirstLoginAt']:
                    cur.execute("UPDATE Players SET FirstLoginAt=? WHERE Player=?", (now, player))
                cur.execute("""
                    SELECT id FROM LogTable
                    WHERE method='login'
                      AND text=?
                      AND log_time >= datetime(?, '-10 minutes')
                    LIMIT 1
                """, (login_text, now))
                if not cur.fetchone():
                    cur.execute("""
                        INSERT INTO LogTable (log_time, level, method, source, text, details, created_at)
                        VALUES (?, 'INFO', 'login', 'HughsGolfServer', ?, ?, ?)
                    """, (now, login_text, details, now))
                conn.commit()
                conn.close()
        except Exception as e:
            print(f'notify_login audit error: {e}')
            errors.append(f'Audit failed: {e}')

    try:
        msg = MIMEText(body_text)
        msg['From'] = gmail_user
        msg['To'] = dev_email
        msg['Subject'] = subject
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(gmail_user, gmail_pw)
            server.send_message(msg)
        sent_to.append('email')
    except Exception as e:
        print(f'notify_login email error: {e}')
        errors.append(f'Email failed: {e}')

    if first_login:
        ensure_first_login_audit()
        try:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("SELECT Phone, CellCarrier FROM Players WHERE Officer='Developer' LIMIT 1")
            dev_row = cur.fetchone()
            conn.close()
        except Exception as e:
            dev_row = None
            errors.append(f'Developer lookup failed: {e}')

        if dev_row and dev_row['Phone'] and dev_row['CellCarrier']:
            addr, err = sms_address(dev_row['Phone'], dev_row['CellCarrier'])
            if addr:
                try:
                    sms_body = f"HughsGolf: {player} ({role}) just logged in for the first time!"
                    sms_msg = MIMEText(sms_body)
                    sms_msg['From'] = gmail_user
                    sms_msg['To'] = addr
                    sms_msg['Subject'] = "HughsGolf"
                    with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
                        server.login(gmail_user, gmail_pw)
                        server.send_message(sms_msg)
                    sent_to.append('sms')
                except Exception as e:
                    print(f'notify_login sms error: {e}')
                    errors.append(f'SMS failed: {e}')
            else:
                errors.append(err)
        else:
            errors.append('Developer phone/carrier not set in Players table')

    print(f'[{now_local():%H:%M:%S}] notify_login for {player}: first_login={first_login}, sent={",".join(sent_to) or "none"}')
    return jsonify({'ok': len(errors) == 0, 'sentTo': sent_to, 'errors': errors})


@app.route('/flask-log')
def flask_log():
    """Return the last N lines of the Flask log."""
    n = request.args.get('lines', 100, type=int)
    n = min(max(n, 10), 1000)
    log_path = LOG_PATH if os.path.exists(LOG_PATH) else os.path.join(BASE_DIR, 'flask.log')
    if not os.path.exists(log_path):
        return jsonify({'ok': False, 'error': 'Log file not found', 'lines': []})
    try:
        with open(log_path, 'r', errors='ignore') as f:
            all_lines = f.readlines()
        tail = all_lines[-n:]
        return jsonify({'ok': True, 'lines': tail, 'total_lines': len(all_lines)})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e), 'lines': []})


@app.route('/restart-server', methods=['POST'])
def restart_server():
    """Restart the QNAP Flask process after a deploy."""
    token = request.headers.get('X-Save-Token', '')
    body = request.get_json(silent=True) or {}
    if not token:
        token = body.get('token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403

    def restart_after_response():
        time.sleep(0.5)
        if os.name == 'nt':
            subprocess.Popen([sys.executable, os.path.abspath(__file__)], cwd=BASE_DIR)
        else:
            cmd = (
                f"sleep 1; cd {shlex.quote(BASE_DIR)}; "
                f"{shlex.quote(sys.executable)} app.py > {shlex.quote(LOG_PATH)} 2>&1 < /dev/null &"
            )
            subprocess.Popen(['sh', '-c', cmd], close_fds=True)
        os._exit(0)

    threading.Thread(target=restart_after_response, daemon=True).start()
    return jsonify({'ok': True, 'message': 'Restarting Flask'})


@app.route('/need-sub', methods=['POST'])
def need_sub():
    """Send a sub request to selected players, CC'ing the secretary."""
    body = request.get_json()
    player     = body.get('player', '').strip()
    date       = body.get('date', '').strip()
    message    = body.get('message', '').strip()
    recipients = body.get('recipients', [])
    skip_email = body.get('skipEmail', False)

    if not player or not date or not message or not recipients:
        return jsonify({'ok': False, 'error': 'Missing required fields'}), 400

    gmail_user, gmail_pw = get_gmail_creds()
    if not gmail_user or not gmail_pw:
        return jsonify({'ok': False, 'error': 'Email not configured'}), 500

    # Get all officers' emails for CC, plus developer BCC
    officer_emails = []
    developer_email = 'garyrscudder@gmail.com'
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT Email FROM Players WHERE Officer IN ('Secretary','President') AND Login='Y' AND Email IS NOT NULL AND Email != ''")
        officer_emails = [r['Email'] for r in cur.fetchall()]
        conn.close()
    except Exception as e:
        print(f'need_sub officer lookup error: {e}')

    subject = f"Hugh's Golf League — Sub Needed for {date}"
    sent_count = 0
    email_count = 0
    sms_count = 0
    failed = []
    errors = []

    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        for recipient in recipients:
            cur.execute("SELECT Email, Phone, CellCarrier FROM Players WHERE Player=?", (recipient,))
            r = cur.fetchone()
            if not r:
                failed.append(recipient)
                continue

            sent_this_one = False

            if skip_email:
                # Test mode — count as sent without actually sending
                sent_this_one = True
                sent_count += 1
                email_count += 1
                continue

            # Email
            if r['Email']:
                try:
                    msg = MIMEMultipart()
                    msg['From']    = gmail_user
                    msg['To']      = r['Email']
                    cc_list = [e for e in officer_emails if e != r['Email']]
                    if cc_list:
                        msg['Cc'] = ', '.join(cc_list)
                    msg['Subject'] = subject
                    msg.attach(MIMEText(message, 'plain'))
                    with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
                        server.login(gmail_user, gmail_pw)
                        recipients_list = [r['Email']] + cc_list
                        if developer_email and developer_email not in recipients_list:
                            recipients_list.append(developer_email)
                        server.sendmail(gmail_user, recipients_list, msg.as_string())
                    sent_this_one = True
                    email_count += 1
                except Exception as e:
                    error = f'Email failed for {recipient}: {e}'
                    errors.append(error)
                    print(f'need_sub {error}')

            # SMS
            if r['Phone'] and r['CellCarrier']:
                addr, err = sms_address(r['Phone'], r['CellCarrier'])
                if addr:
                    try:
                        sms_msg = MIMEText(message)
                        sms_msg['From']    = gmail_user
                        sms_msg['To']      = addr
                        sms_msg['Subject'] = "Hugh's Golf - Sub Needed"
                        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
                            server.login(gmail_user, gmail_pw)
                            server.send_message(sms_msg)
                        sent_this_one = True
                        sms_count += 1
                    except Exception as e:
                        error = f'SMS failed for {recipient}: {e}'
                        errors.append(error)
                        print(f'need_sub {error}')
                else:
                    errors.append(f'SMS skipped for {recipient}: {err}')

            if sent_this_one:
                sent_count += 1
            else:
                failed.append(recipient)

        conn.close()
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

    print(f'[{now_local():%H:%M:%S}] Sub request from {player} for {date}: sent to {sent_count}/{len(recipients)} ({email_count} email, {sms_count} text)')
    return jsonify({'ok': True, 'sent_count': sent_count, 'email_count': email_count, 'sms_count': sms_count, 'failed': failed, 'errors': errors})


def _pdf_escape(value):
    return str(value).replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


def build_text_pdf(title, subtitle, body_text):
    """Build a simple dependency-free PDF attachment from report text."""
    width, height = 792, 612  # letter landscape, points
    margin_x, top_y = 36, 560
    font_size, line_step = 7, 9
    max_chars, max_lines = 150, 58

    raw_lines = [title, subtitle, '', *str(body_text or '').splitlines()]
    wrapped = []
    for raw in raw_lines:
        line = ' '.join(str(raw).replace('\t', '  ').split()) if raw.strip() else ''
        if not line:
            wrapped.append('')
            continue
        while len(line) > max_chars:
            cut = line.rfind(' ', 0, max_chars)
            if cut < 40:
                cut = max_chars
            wrapped.append(line[:cut].rstrip())
            line = line[cut:].lstrip()
        wrapped.append(line)

    pages = [wrapped[i:i + max_lines] for i in range(0, len(wrapped), max_lines)] or [['']]
    objects = {}
    page_ids = []
    next_id = 4

    for page_lines in pages:
        page_id, content_id = next_id, next_id + 1
        next_id += 2
        page_ids.append(page_id)
        content_lines = [f'BT /F1 {font_size} Tf {margin_x} {top_y} Td {line_step} TL']
        for line in page_lines:
            content_lines.append(f'({_pdf_escape(line)}) Tj T*')
        content_lines.append('ET')
        stream = '\n'.join(content_lines).encode('latin-1', 'replace')
        objects[content_id] = b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream'
        objects[page_id] = (
            f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] '
            f'/Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>'
        ).encode()

    objects[1] = b'<< /Type /Catalog /Pages 2 0 R >>'
    objects[2] = f"<< /Type /Pages /Kids [{' '.join(f'{pid} 0 R' for pid in page_ids)}] /Count {len(page_ids)} >>".encode()
    objects[3] = b'<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>'

    output = bytearray(b'%PDF-1.4\n')
    offsets = {0: 0}
    for obj_id in sorted(objects):
        offsets[obj_id] = len(output)
        output.extend(f'{obj_id} 0 obj\n'.encode())
        output.extend(objects[obj_id])
        output.extend(b'\nendobj\n')
    xref_at = len(output)
    max_id = max(objects)
    output.extend(f'xref\n0 {max_id + 1}\n'.encode())
    output.extend(b'0000000000 65535 f \n')
    for obj_id in range(1, max_id + 1):
        output.extend(f'{offsets.get(obj_id, 0):010d} 00000 n \n'.encode())
    output.extend(f'trailer\n<< /Size {max_id + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n'.encode())
    return bytes(output)


def render_html_pdf_via_service(html):
    """Render report HTML through the optional local PDF renderer service."""
    if not PDF_RENDERER_URL:
        raise RuntimeError('PDF renderer service is not configured')

    payload = json.dumps({'html': html}).encode('utf-8')
    req = urllib.request.Request(
        PDF_RENDERER_URL,
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        content_type = resp.headers.get('Content-Type', '')
        data = resp.read()
        if resp.status != 200 or 'application/pdf' not in content_type:
            raise RuntimeError(f'PDF renderer returned HTTP {resp.status}: {data[:300].decode("utf-8", "replace")}')
        return data


def render_html_pdf_locally(html):
    """Render report HTML to PDF using local Playwright/Chromium when installed."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        raise RuntimeError(f'Playwright is not installed: {e}') from e

    with tempfile.TemporaryDirectory() as tmpdir:
        html_path = os.path.join(tmpdir, 'report.html')
        with open(html_path, 'w', encoding='utf-8') as f:
            f.write(html)

        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=['--no-sandbox', '--disable-dev-shm-usage']
            )
            page = browser.new_page(viewport={'width': 1400, 'height': 900})
            page.goto('file://' + html_path, wait_until='networkidle')
            pdf_bytes = page.pdf(
                format='Letter',
                landscape=True,
                print_background=True,
                margin={'top': '0.3in', 'right': '0.3in', 'bottom': '0.3in', 'left': '0.3in'}
            )
            browser.close()
            return pdf_bytes


def render_html_pdf(html):
    """Render report HTML to PDF, preferring the QNAP/container renderer."""
    service_error = None
    if PDF_RENDERER_URL:
        try:
            return render_html_pdf_via_service(html), 'renderer-service', None
        except Exception as e:
            service_error = str(e)
            print(f'PDF renderer service failed, trying local Playwright: {e}')

    try:
        return render_html_pdf_locally(html), 'playwright-local', service_error
    except Exception as e:
        if service_error:
            raise RuntimeError(f'PDF renderer service failed: {service_error}; local Playwright failed: {e}') from e
        raise


@app.route('/send-report-pdf', methods=['POST'])
def send_report_pdf():
    """Email a generated report PDF to players opted into EmailStats."""
    body = request.get_json() or {}
    title = str(body.get('title') or "Hugh's Golf Report").strip()
    subtitle = str(body.get('subtitle') or '').strip()
    report_text = str(body.get('text') or '').strip()
    report_html = str(body.get('html') or '').strip()
    filename = str(body.get('filename') or 'hughs-golf-report.pdf').strip().replace('/', '-').replace('\\', '-')
    requested_recipients = body.get('recipients') or []
    requested_keys = set()
    if isinstance(requested_recipients, list):
        for recipient in requested_recipients:
            if not isinstance(recipient, dict):
                continue
            player_key = str(recipient.get('Player') or recipient.get('player') or '').strip()
            email_key = str(recipient.get('Email') or recipient.get('email') or '').strip().lower()
            if player_key and email_key:
                requested_keys.add((player_key, email_key))
    if not filename.lower().endswith('.pdf'):
        filename += '.pdf'

    if not report_text and not report_html:
        return jsonify({'ok': False, 'error': 'No report content to send'}), 400

    gmail_user, gmail_pw = get_gmail_creds()
    if not gmail_user or not gmail_pw:
        return jsonify({'ok': False, 'error': 'Email not configured'}), 500

    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("""
            SELECT Player, Email FROM Players
            WHERE EmailStats='Y'
              AND Email IS NOT NULL
              AND TRIM(Email) != ''
            ORDER BY Player
        """)
        recipient_rows = cur.fetchall()
        conn.close()
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Recipient lookup failed: {e}'}), 500

    if requested_keys:
        recipients = [
            r for r in recipient_rows
            if (str(r['Player']).strip(), str(r['Email']).strip().lower()) in requested_keys
        ]
    else:
        recipients = recipient_rows

    if not recipients:
        if requested_keys:
            return jsonify({'ok': False, 'error': 'No selected recipients matched EmailStats players with email addresses'}), 400
        return jsonify({'ok': False, 'error': 'No players with EmailStats=Y and an email address'}), 404

    pdf_engine = 'text'
    pdf_warning = None
    if report_html:
        try:
            pdf_bytes, pdf_engine, pdf_warning = render_html_pdf(report_html)
        except Exception as e:
            pdf_warning = str(e)
            print(f'HTML PDF render failed, falling back to text PDF: {e}')
            pdf_bytes = build_text_pdf(title, subtitle, report_text)
    else:
        pdf_bytes = build_text_pdf(title, subtitle, report_text)

    subject = f"Hugh's Golf League - {title}"
    body_text = f"{title}\n{subtitle}\n\nAttached is the latest Hugh's Golf report PDF."
    if pdf_warning and pdf_engine == 'text':
        body_text += "\n\nNote: server HTML PDF rendering is not installed yet, so this email used the fallback text PDF."
    sent_count = 0
    failed = []

    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(gmail_user, gmail_pw)
            for r in recipients:
                try:
                    msg = MIMEMultipart()
                    msg['From'] = gmail_user
                    msg['To'] = r['Email']
                    msg['Subject'] = subject
                    msg.attach(MIMEText(body_text, 'plain'))
                    part = MIMEApplication(pdf_bytes, _subtype='pdf')
                    part.add_header('Content-Disposition', 'attachment', filename=filename)
                    msg.attach(part)
                    server.send_message(msg)
                    sent_count += 1
                except Exception as e:
                    failed.append({'player': r['Player'], 'email': r['Email'], 'error': str(e)})
                    print(f"send_report_pdf failed for {r['Player']} <{r['Email']}>: {e}")
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Email failed: {e}'}), 500

    print(f'[{now_local():%H:%M:%S}] Report PDF "{title}" sent to {sent_count}/{len(recipients)} selected EmailStats player(s) via {pdf_engine}')
    return jsonify({'ok': True, 'sent_count': sent_count, 'recipient_count': len(recipients), 'failed': failed, 'pdf_engine': pdf_engine, 'warning': pdf_warning})


@app.route('/notify-payout', methods=['POST'])
def notify_payout():
    """Send email + SMS (via carrier gateway) notification of a kitty payout or unpaid reminder."""
    body = request.get_json()
    player  = body.get('player', '').strip()
    amount  = body.get('amount', 0)
    source  = body.get('source', '')   # e.g. "Skin Kitty"
    comment = body.get('comment', '')
    recorded_by = body.get('recordedBy', '').strip()
    message_type = body.get('messageType', 'payout')  # 'payout' or 'reminder'

    if not player:
        return jsonify({'ok': False, 'error': 'No player name'}), 400

    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT Email, Phone, CellCarrier FROM Players WHERE Player=?", (player,))
        row = cur.fetchone()
        conn.close()
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

    if not row:
        return jsonify({'ok': False, 'error': 'Player not found'}), 404

    gmail_user, gmail_pw = get_gmail_creds()
    if not gmail_user or not gmail_pw:
        return jsonify({'ok': False, 'error': 'Email not configured'}), 500

    recorded_line = f"Recorded by: {recorded_by}\n\n" if recorded_by else ""

    if message_type == 'reminder':
        subject = "Hugh's Golf League — Unpaid Balance"
        body_text = f"""Hi {player},

Just a friendly reminder that you have an unpaid balance of ${amount:.2f} from {source}.

{comment}

Whenever you get a chance to settle up, that'd be great — no rush.

— Hugh's Golf League
"""
    else:
        subject = "Hugh's Golf League — Payout"
        body_text = f"""Hi {player},

You've received a payout of ${amount:.2f} from the {source}.

{comment}

{recorded_line}A quick reply with "Confirmed" lets us know you received this, though it's not required.

— Hugh's Golf League
"""

    sent_to = []
    errors = []

    # Send to email
    if row['Email']:
        try:
            msg = MIMEMultipart()
            msg['From']    = gmail_user
            msg['To']      = row['Email']
            msg['Subject'] = subject
            msg.attach(MIMEText(body_text, 'plain'))
            with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
                server.login(gmail_user, gmail_pw)
                server.send_message(msg)
            sent_to.append('email')
        except Exception as e:
            errors.append(f'Email failed: {e}')

    # Send to SMS via carrier gateway
    if row['Phone'] and row['CellCarrier']:
        addr, err = sms_address(row['Phone'], row['CellCarrier'])
        if addr:
            try:
                by_text = f" (by {recorded_by})" if recorded_by else ""
                sms_body = f"Hugh's Golf League: ${amount:.2f} payout from {source}{by_text}. {comment} Reply CONFIRMED if received."
                msg = MIMEText(sms_body)
                msg['From']    = gmail_user
                msg['To']      = addr
                msg['Subject'] = "Hugh's Golf League"
                with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
                    server.login(gmail_user, gmail_pw)
                    server.send_message(msg)
                sent_to.append('sms')
            except Exception as e:
                errors.append(f'SMS failed: {e}')
        else:
            errors.append(err)

    if not sent_to:
        return jsonify({'ok': False, 'error': '; '.join(errors) or 'No email or phone on file'}), 404

    print(f'[{now_local():%H:%M:%S}] Payout notification sent to {player} via {", ".join(sent_to)}')
    return jsonify({'ok': True, 'sent_to': sent_to, 'errors': errors})


@app.route('/parse-scorecard', methods=['POST'])
def parse_scorecard():
    """Parse a golf scorecard photo using Claude Haiku vision and return player scores."""
    import base64, re
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403

    # Load Anthropic API key — LeagueParms table first, then env var, then file
    api_key = ''
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT AnthropicApiKey FROM LeagueParms WHERE Name=\"Hugh's\" AND Season=(SELECT MAX(Season) FROM LeagueParms WHERE Name=\"Hugh's\")")
        row = cur.fetchone()
        conn.close()
        if row and row['AnthropicApiKey']:
            api_key = row['AnthropicApiKey'].strip()
    except Exception:
        pass
    if not api_key:
        api_key = os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if not api_key:
        key_file = os.path.join(BASE_DIR, 'anthropic_key.txt')
        if os.path.exists(key_file):
            with open(key_file) as f:
                api_key = f.read().strip()
    if not api_key:
        return jsonify({'ok': False, 'error': 'Anthropic API key not configured. Add AnthropicApiKey to LeagueParms.'}), 500

    if 'image' not in request.files:
        return jsonify({'ok': False, 'error': 'No image provided'}), 400

    img_file = request.files['image']
    img_bytes = img_file.read()
    filename = (img_file.filename or '').lower()

    # Convert HEIC → JPEG if needed
    if filename.endswith('.heic') or filename.endswith('.heif'):
        try:
            from pillow_heif import register_heif_opener
            from PIL import Image
            import io
            register_heif_opener()
            img = Image.open(io.BytesIO(img_bytes))
            buf = io.BytesIO()
            img.save(buf, 'JPEG', quality=90)
            img_bytes = buf.getvalue()
            filename = 'scorecard.jpg'
        except Exception as e:
            return jsonify({'ok': False, 'error': f'HEIC conversion failed (install pillow-heif): {e}'}), 500

    # Determine media type
    if filename.endswith('.png'):
        media_type = 'image/png'
    elif filename.endswith('.gif'):
        media_type = 'image/gif'
    elif filename.endswith('.webp'):
        media_type = 'image/webp'
    else:
        media_type = 'image/jpeg'

    img_b64 = base64.b64encode(img_bytes).decode()

    prompt = (
        "This is a golf scorecard photo. Extract each player's first name (or full name if visible) "
        "and their hole-by-hole gross scores for the 9 holes played.\n\n"
        "Also look for a handwritten note starting with # anywhere on the card (e.g. '#Group 5', '#G5', '#5'). "
        "If found, include it as the 'group' field.\n\n"
        "Return ONLY valid JSON in this exact format with no extra text:\n"
        '{"players":[{"name":"Player Name","scores":[5,4,6,3,5,4,4,3,5]},...],"frontBack":"Front","group":"5"}\n\n'
        "Rules:\n"
        "- scores: exactly 9 integers (gross strokes per hole). Use null for illegible scores.\n"
        "- frontBack: 'Front' for holes 1-9, 'Back' for holes 10-18.\n"
        "- group: the number or label after the # sign. Omit the field entirely if no # note is found.\n"
        "- Ignore par rows, total rows, and handicap rows — only player score rows.\n"
        "- Return ONLY the JSON object, nothing else."
    )

    payload = json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 1024,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": img_b64}},
                {"type": "text", "text": prompt}
            ]
        }]
    }).encode()

    try:
        req = urllib.request.Request(
            'https://api.anthropic.com/v1/messages',
            data=payload,
            headers={
                'x-api-key': api_key,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Anthropic API error: {e}'}), 500

    raw_text = result.get('content', [{}])[0].get('text', '').strip()
    match = re.search(r'\{.*\}', raw_text, re.DOTALL)
    if not match:
        return jsonify({'ok': False, 'error': 'AI could not parse scorecard', 'raw': raw_text}), 500

    try:
        data = json.loads(match.group())
    except Exception as e:
        return jsonify({'ok': False, 'error': f'JSON parse error: {e}', 'raw': raw_text}), 500

    players = data.get('players', [])
    front_back = data.get('frontBack', 'Front')
    group = data.get('group', '')
    print(f'[{now_local():%H:%M:%S}] Photo scorecard parsed: {len(players)} players, {front_back}, group={group or "unknown"}')
    return jsonify({'ok': True, 'players': players, 'frontBack': front_back, 'group': group})


@app.route('/fetch-gallus', methods=['POST'])
def fetch_gallus():
    """Fetch and parse a Gallus Golf scorecard URL."""
    import urllib.request
    from html.parser import HTMLParser

    body = request.get_json()
    url  = body.get('url', '').strip()
    if not url or 'gallusgolf.com' not in url:
        return jsonify({'ok': False, 'error': 'Invalid Gallus Golf URL'}), 400

    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Failed to fetch URL: {e}'}), 500

    # Parse the HTML table
    class TableParser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.in_table = False
            self.in_td = False
            self.rows = []
            self.current_row = []
            self.current_cell = ''

        def handle_starttag(self, tag, attrs):
            if tag == 'table': self.in_table = True
            if tag == 'tr' and self.in_table: self.current_row = []
            if tag in ('td', 'th') and self.in_table: self.in_td = True; self.current_cell = ''

        def handle_endtag(self, tag):
            if tag in ('td', 'th') and self.in_td:
                self.current_row.append(self.current_cell.strip())
                self.in_td = False
            if tag == 'tr' and self.current_row:
                self.rows.append(self.current_row)
                self.current_row = []
            if tag == 'table': self.in_table = False

        def handle_data(self, data):
            if self.in_td: self.current_cell += data

    parser = TableParser()
    parser.feed(html)

    if not parser.rows:
        return jsonify({'ok': False, 'error': 'No table found on page'}), 400

    # Find header row with hole numbers; build column→hole mapping
    hole_row = None
    par_row  = None
    players  = []

    for row in parser.rows:
        if len(row) < 5: continue
        if row[0].lower() in ('hole', 'holes'):
            hole_row = row
        elif row[0].lower().startswith('par'):
            par_row = row
        elif hole_row and row[0] and not row[0].lower().startswith(('hcp','hdcp','handicap')):
            name = row[0].strip()
            if name and name not in ('', 'Hole', 'Par m/w', 'Hcp m/w'):
                players.append({'name': name, 'row': row})

    # Build col_index → hole_number map from hole_row (skips Out/In/Total automatically)
    hole_col_map = {}
    if hole_row:
        for i, cell in enumerate(hole_row):
            s = cell.strip()
            if s.isdigit() and 1 <= int(s) <= 18:
                hole_col_map[i] = int(s)

    # Extract per-player scores using hole column mapping
    parsed_players = []
    for p in players:
        row = p['row']
        if hole_col_map:
            # Precise: only hole columns, builds an 18-element list [H1..H18]
            hole_scores = {}
            for col_i, hole_num in hole_col_map.items():
                val = row[col_i].strip() if col_i < len(row) else ''
                if val.isdigit() and 1 <= int(val) <= 20:
                    hole_scores[hole_num] = int(val)
                else:
                    hole_scores[hole_num] = None
            scores = [hole_scores.get(h) for h in range(1, 19)]
        else:
            # Fallback for non-standard layouts
            scores = []
            for i in range(1, len(row)):
                val = row[i].strip()
                if val.isdigit() and int(val) < 15:
                    scores.append(int(val))
                elif val == '' or not val.isdigit():
                    scores.append(None)
        parsed_players.append({'name': p['name'], 'scores': scores})

    # Determine front or back based on which holes have scores
    front_back = 'Front'
    if parsed_players:
        first = parsed_players[0]['scores']
        if len(first) >= 18 and all(s is None for s in first[:9]) and any(s for s in first[9:18]):
            front_back = 'Back'

    # Trim to 9 holes
    result_players = []
    for p in parsed_players:
        scores = p['scores']
        if front_back == 'Back':
            nine = scores[9:18] if len(scores) >= 18 else scores[:9]
        else:
            nine = scores[:9]
        # Pad to 9
        while len(nine) < 9: nine.append(None)
        nine = nine[:9]
        result_players.append({'name': p['name'], 'scores': nine})

    # Extract recorder from page heading: "Jon Williams's round at ..."
    import re as _re2, html as _html_mod
    recorder = ''
    _hm = _re2.search(r'<h[1-3][^>]*>(.*?)</h[1-3]>', html, _re2.IGNORECASE | _re2.DOTALL)
    if _hm:
        _htxt = _html_mod.unescape(_re2.sub(r'<[^>]+>', '', _hm.group(1))).strip()
        _rm = _re2.search(u"^(.+?)['’‘]s round at ", _htxt, _re2.IGNORECASE)
        if _rm:
            recorder = _rm.group(1).strip()
    # Fallback: first player listed
    if not recorder and result_players:
        recorder = result_players[0]['name']

    print(f'[{now_local():%H:%M:%S}] Gallus import: {len(result_players)} players, {front_back}, recorder={recorder!r}')
    return jsonify({'ok': True, 'players': result_players, 'frontBack': front_back, 'recorder': recorder})



@app.route('/board-posts')
def board_posts():
    """Return all posts and comments directly from the server DB — bypasses sql.js so all users see live data."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    try:
        conn = sqlite3.connect(DB_PATH, timeout=DB_TIMEOUT_SECONDS)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("""CREATE TABLE IF NOT EXISTS Posts (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            Author TEXT, Category TEXT DEFAULT 'General',
            Title TEXT, Body TEXT,
            Pinned INTEGER DEFAULT 0, PostedAt TEXT,
            Audience TEXT DEFAULT 'all'
        )""")
        # Add Audience column if missing (migration for existing DBs)
        try:
            cur.execute("ALTER TABLE Posts ADD COLUMN Audience TEXT DEFAULT 'all'")
            conn.commit()
        except Exception:
            pass
        cur.execute("""CREATE TABLE IF NOT EXISTS PostComments (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            PostID INTEGER, Author TEXT, Body TEXT, PostedAt TEXT
        )""")
        conn.commit()
        posts    = [dict(r) for r in cur.execute("SELECT * FROM Posts ORDER BY Pinned DESC, PostedAt DESC LIMIT 100").fetchall()]
        comments = [dict(r) for r in cur.execute("SELECT * FROM PostComments ORDER BY PostedAt ASC").fetchall()]
        conn.close()
        return jsonify({'ok': True, 'posts': posts, 'comments': comments})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/board-post', methods=['POST'])
def board_post_create():
    """Create a new board post directly in the server DB."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    body     = request.get_json() or {}
    author    = str(body.get('author', '')).strip()
    category  = str(body.get('category', 'General')).strip()
    title     = str(body.get('title', '')).strip()
    text      = str(body.get('body', '')).strip()
    pinned    = 1 if body.get('pinned') else 0
    audience  = str(body.get('audience', 'all')).strip()
    if audience not in ('all', 'admin'):
        audience = 'all'
    posted_at = str(body.get('postedAt', now_local().strftime('%Y-%m-%d %H:%M:%S')))
    if not author or not title or not text:
        return jsonify({'ok': False, 'error': 'Missing fields'}), 400
    try:
        with DB_WRITE_LOCK:
            conn = sqlite3.connect(DB_PATH, timeout=DB_TIMEOUT_SECONDS)
            cur = conn.cursor()
            cur.execute("INSERT INTO Posts (Author,Category,Title,Body,Pinned,PostedAt,Audience) VALUES (?,?,?,?,?,?,?)",
                        (author, category, title, text, pinned, posted_at, audience))
            new_id = cur.lastrowid
            conn.commit()
            conn.close()
        print(f'[{now_local():%H:%M:%S}] Board post by {author}: {title[:40]}')
        return jsonify({'ok': True, 'id': new_id})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/board-comment', methods=['POST'])
def board_comment_create():
    """Add a comment to a board post directly in the server DB."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    body      = request.get_json() or {}
    post_id   = body.get('postId')
    author    = str(body.get('author', '')).strip()
    text      = str(body.get('body', '')).strip()
    posted_at = str(body.get('postedAt', now_local().strftime('%Y-%m-%d %H:%M:%S')))
    if not post_id or not author or not text:
        return jsonify({'ok': False, 'error': 'Missing fields'}), 400
    try:
        with DB_WRITE_LOCK:
            conn = sqlite3.connect(DB_PATH, timeout=DB_TIMEOUT_SECONDS)
            cur = conn.cursor()
            cur.execute("INSERT INTO PostComments (PostID,Author,Body,PostedAt) VALUES (?,?,?,?)",
                        (post_id, author, text, posted_at))
            new_id = cur.lastrowid
            conn.commit()
            conn.close()
        return jsonify({'ok': True, 'id': new_id})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/board-delete-post', methods=['POST'])
def board_delete_post():
    """Delete a board post and all its comments."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    body    = request.get_json() or {}
    post_id = body.get('id')
    if not post_id:
        return jsonify({'ok': False, 'error': 'No post ID'}), 400
    try:
        with DB_WRITE_LOCK:
            conn = sqlite3.connect(DB_PATH, timeout=DB_TIMEOUT_SECONDS)
            cur = conn.cursor()
            cur.execute("DELETE FROM PostComments WHERE PostID=?", (post_id,))
            cur.execute("DELETE FROM Posts WHERE ID=?", (post_id,))
            conn.commit()
            conn.close()
        print(f'[{now_local():%H:%M:%S}] Board post {post_id} deleted')
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/board-delete-comment', methods=['POST'])
def board_delete_comment():
    """Delete a single board comment."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    body       = request.get_json() or {}
    comment_id = body.get('id')
    if not comment_id:
        return jsonify({'ok': False, 'error': 'No comment ID'}), 400
    try:
        with DB_WRITE_LOCK:
            conn = sqlite3.connect(DB_PATH, timeout=DB_TIMEOUT_SECONDS)
            cur = conn.cursor()
            cur.execute("DELETE FROM PostComments WHERE ID=?", (comment_id,))
            conn.commit()
            conn.close()
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/help-content')
def help_content_get():
    """Return all current help content rows."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    try:
        conn = sqlite3.connect(DB_PATH, timeout=DB_TIMEOUT_SECONDS)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("""CREATE TABLE IF NOT EXISTS HelpContent (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            Topic TEXT UNIQUE, Title TEXT, SortOrder INTEGER,
            Content TEXT, UpdatedBy TEXT, UpdatedAt TEXT
        )""")
        cur.execute("""CREATE TABLE IF NOT EXISTS HelpContentHistory (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            Topic TEXT, Title TEXT, Content TEXT,
            UpdatedBy TEXT, UpdatedAt TEXT
        )""")
        conn.commit()
        rows = [dict(r) for r in cur.execute("SELECT * FROM HelpContent ORDER BY SortOrder").fetchall()]
        conn.close()
        return jsonify({'ok': True, 'content': rows})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/help-content/save', methods=['POST'])
def help_content_save():
    """Save/update a help section. Old version is pushed to history first."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    body = request.get_json() or {}
    topic      = str(body.get('topic', '')).strip()
    title      = str(body.get('title', '')).strip()
    content    = str(body.get('content', '')).strip()
    updated_by = str(body.get('updatedBy', 'Admin')).strip()
    sort_order = int(body.get('sortOrder', 0))
    if not topic or not content:
        return jsonify({'ok': False, 'error': 'Missing topic or content'}), 400
    now = now_local().strftime('%Y-%m-%d %H:%M:%S')
    try:
        with DB_WRITE_LOCK:
            conn = sqlite3.connect(DB_PATH, timeout=DB_TIMEOUT_SECONDS)
            cur = conn.cursor()
            # Archive current version to history if it exists
            existing = cur.execute("SELECT Title, Content, UpdatedBy, UpdatedAt FROM HelpContent WHERE Topic=?", (topic,)).fetchone()
            if existing:
                cur.execute("""INSERT INTO HelpContentHistory (Topic, Title, Content, UpdatedBy, UpdatedAt)
                               VALUES (?, ?, ?, ?, ?)""", (topic, existing[0], existing[1], existing[2], existing[3]))
            # Upsert current version
            cur.execute("""INSERT INTO HelpContent (Topic, Title, SortOrder, Content, UpdatedBy, UpdatedAt)
                           VALUES (?, ?, ?, ?, ?, ?)
                           ON CONFLICT(Topic) DO UPDATE SET
                               Title=excluded.Title, SortOrder=excluded.SortOrder,
                               Content=excluded.Content, UpdatedBy=excluded.UpdatedBy, UpdatedAt=excluded.UpdatedAt""",
                        (topic, title, sort_order, content, updated_by, now))
            conn.commit()
            conn.close()
        print(f'[{now_local():%H:%M:%S}] Help content saved: {topic} by {updated_by}')
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/help-content/history/<topic>')
def help_content_history(topic):
    """Return edit history for a help topic."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    try:
        conn = sqlite3.connect(DB_PATH, timeout=DB_TIMEOUT_SECONDS)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        rows = [dict(r) for r in cur.execute(
            "SELECT * FROM HelpContentHistory WHERE Topic=? ORDER BY ID DESC LIMIT 50", (topic,)
        ).fetchall()]
        conn.close()
        return jsonify({'ok': True, 'history': rows})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/help-content/restore', methods=['POST'])
def help_content_restore():
    """Restore a history version as the current content (archives current first)."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    body = request.get_json() or {}
    history_id = body.get('historyId')
    updated_by = str(body.get('updatedBy', 'Admin')).strip()
    if not history_id:
        return jsonify({'ok': False, 'error': 'Missing historyId'}), 400
    now = now_local().strftime('%Y-%m-%d %H:%M:%S')
    try:
        with DB_WRITE_LOCK:
            conn = sqlite3.connect(DB_PATH, timeout=DB_TIMEOUT_SECONDS)
            cur = conn.cursor()
            hist = cur.execute("SELECT Topic, Title, Content FROM HelpContentHistory WHERE ID=?", (history_id,)).fetchone()
            if not hist:
                conn.close()
                return jsonify({'ok': False, 'error': 'History entry not found'}), 404
            topic, title, content = hist
            existing = cur.execute("SELECT Title, Content, UpdatedBy, UpdatedAt FROM HelpContent WHERE Topic=?", (topic,)).fetchone()
            if existing:
                cur.execute("""INSERT INTO HelpContentHistory (Topic, Title, Content, UpdatedBy, UpdatedAt)
                               VALUES (?, ?, ?, ?, ?)""", (topic, existing[0], existing[1], existing[2], existing[3]))
            cur.execute("""INSERT INTO HelpContent (Topic, Title, SortOrder, Content, UpdatedBy, UpdatedAt)
                           VALUES (?, ?, 0, ?, ?, ?)
                           ON CONFLICT(Topic) DO UPDATE SET
                               Content=excluded.Content, UpdatedBy=excluded.UpdatedBy, UpdatedAt=excluded.UpdatedAt""",
                        (topic, title, content, f'{updated_by} (restored)', now))
            conn.commit()
            conn.close()
        print(f'[{now_local():%H:%M:%S}] Help content restored: {topic} by {updated_by}')
        return jsonify({'ok': True, 'topic': topic, 'content': content})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/run-sql', methods=['POST'])
def run_sql():
    """Execute a SQL statement against HughsGolf.db (Developer only — token required)."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403

    body = request.get_json()
    sql  = (body.get('sql') or '').strip()
    if not sql:
        return jsonify({'ok': False, 'error': 'No SQL provided'}), 400

    try:
        with DB_WRITE_LOCK:
            conn = sqlite3.connect(DB_PATH, timeout=DB_TIMEOUT_SECONDS)
            conn.row_factory = sqlite3.Row
            cur  = conn.cursor()
            cur.execute(f'PRAGMA busy_timeout={DB_TIMEOUT_SECONDS * 1000}')
            cur.execute(sql)
            if sql.upper().startswith('SELECT'):
                rows = [dict(r) for r in cur.fetchall()]
                cols = [d[0] for d in cur.description] if cur.description else []
                conn.close()
                return jsonify({'ok': True, 'rows': rows, 'columns': cols, 'rowcount': len(rows)})
            else:
                conn.commit()
                rc = cur.rowcount
                conn.close()
                modified_ms = db_modified_ms()
                print(f'[{now_local():%H:%M:%S}] run-sql: {sql[:80]} — {rc} row(s) affected')
                return jsonify({'ok': True, 'rowcount': rc, 'modifiedMs': modified_ms})
    except Exception as e:
        print(f'[{now_local():%H:%M:%S}] run-sql error: {e}; sql={sql[:200]}')
        return jsonify({'ok': False, 'error': str(e)}), 500


def update_duckdns():
    """Periodically update DuckDNS with current public IP."""
    while True:
        try:
            conn = sqlite3.connect(DB_PATH)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("SELECT DuckDNSToken, DuckDNSDomain FROM LeagueParms WHERE Name=\"Hugh's\" AND Season=(SELECT MAX(Season) FROM LeagueParms WHERE Name=\"Hugh's\")")
            row = cur.fetchone()
            conn.close()

            token  = row['DuckDNSToken']  if row else None
            domain = row['DuckDNSDomain'] if row else None

            if token and domain:
                url = f'https://www.duckdns.org/update?domains={domain}&token={token}&ip='
                with urllib.request.urlopen(url, timeout=10) as resp:
                    result = resp.read().decode().strip()
                    print(f'[{now_local():%H:%M:%S}] DuckDNS update ({domain}.duckdns.org): {result}')
            else:
                print(f'[{now_local():%H:%M:%S}] DuckDNS not configured (no token/domain in LeagueParms)')
        except Exception as e:
            print(f'[{now_local():%H:%M:%S}] DuckDNS update error: {e}')

        time.sleep(300)  # every 5 minutes


def clear_stale_sessions():
    """Periodically clear inactive player sessions; officers/developers stay signed in."""
    while True:
        time.sleep(1800)  # run every 30 minutes
        try:
            conn = sqlite3.connect(DB_PATH)
            cur = conn.cursor()
            # Clear sessions where last login was more than 2 hours ago
            cutoff = (datetime.datetime.utcnow() - datetime.timedelta(hours=2)).strftime('%Y-%m-%d %H:%M:%S')
            cur.execute("""
                UPDATE Players SET ActiveSession=NULL
                WHERE ActiveSession IS NOT NULL
                AND COALESCE(Officer, '') NOT IN ('Developer', 'President', 'Secretary')
                AND Player NOT IN (
                    SELECT DISTINCT text FROM (
                        SELECT REPLACE(text, ' logged in', '') as text, MAX(log_time) as lt
                        FROM LogTable WHERE method='login'
                        GROUP BY REPLACE(text, ' logged in', '')
                        HAVING lt >= ?
                    )
                )
            """, (cutoff,))
            cleared = cur.rowcount
            conn.commit()
            conn.close()
            if cleared > 0:
                print(f'[{now_local():%H:%M:%S}] Cleared {cleared} stale session(s)')
        except Exception as e:
            print(f'[{now_local():%H:%M:%S}] Session cleanup error: {e}')
def ensure_schema():
    """One-time startup check: add columns that may be missing if the live DB
    was ever replaced by an older backup (prevents silent recurring errors)."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        cur.execute("PRAGMA table_info(Players)")
        cols = {row[1] for row in cur.fetchall()}
        if 'ActiveSession' not in cols:
            cur.execute("ALTER TABLE Players ADD COLUMN ActiveSession TEXT")
            print(f'[{now_local():%H:%M:%S}] Schema check: added missing Players.ActiveSession column')
        if 'FirstLoginAt' not in cols:
            cur.execute("ALTER TABLE Players ADD COLUMN FirstLoginAt TEXT")
            print(f'[{now_local():%H:%M:%S}] Schema check: added missing Players.FirstLoginAt column')
        if 'BlockSubs' not in cols:
            cur.execute("ALTER TABLE Players ADD COLUMN BlockSubs TEXT DEFAULT 'N'")
            print(f'[{now_local():%H:%M:%S}] Schema check: added missing Players.BlockSubs column')
        conn.commit()
        # Add AnthropicApiKey to LeagueParms if missing
        cur.execute("PRAGMA table_info(LeagueParms)")
        lp_cols = {row[1] for row in cur.fetchall()}
        if 'AnthropicApiKey' not in lp_cols:
            cur.execute("ALTER TABLE LeagueParms ADD COLUMN AnthropicApiKey TEXT")
            print(f'[{now_local():%H:%M:%S}] Schema check: added missing LeagueParms.AnthropicApiKey column')
        conn.commit()
        # Create HelpContent tables if missing
        cur.execute("""CREATE TABLE IF NOT EXISTS HelpContent (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            Topic TEXT UNIQUE, Title TEXT, SortOrder INTEGER,
            Content TEXT, UpdatedBy TEXT, UpdatedAt TEXT
        )""")
        cur.execute("""CREATE TABLE IF NOT EXISTS HelpContentHistory (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            Topic TEXT, Title TEXT, Content TEXT,
            UpdatedBy TEXT, UpdatedAt TEXT
        )""")
        conn.commit()
        # Create LeagueExpenses table if missing
        cur.execute("""CREATE TABLE IF NOT EXISTS LeagueExpenses (
            ID INTEGER PRIMARY KEY AUTOINCREMENT,
            League TEXT,
            Season INTEGER,
            Date INTEGER,
            Category TEXT,
            Description TEXT,
            Qty REAL,
            UnitCost REAL,
            Amount REAL,
            Note TEXT
        )""")
        conn.commit()
        # Migrate old Food/Drinks/Expense rows from Payments into LeagueExpenses
        cur.execute("SELECT COUNT(*) FROM LeagueExpenses")
        if cur.fetchone()[0] == 0:
            cur.execute("""
                SELECT ID, League, Date, Desc, Detail, Earned, Comment
                FROM Payments
                WHERE League="Hugh's" AND Desc IN ('Food','Drinks','Expense')
            """)
            rows = cur.fetchall()
            for row in rows:
                pid, league, date, desc, detail, earned, comment = row
                season = int(str(date)[:4]) if date else None
                if desc == 'Food' or (desc == 'Expense' and detail == 'Food'):
                    category = 'Food'
                elif desc == 'Drinks' or (desc == 'Expense' and detail == 'Drinks'):
                    category = 'Beer/Drinks'
                else:
                    category = desc
                cur.execute("""
                    INSERT INTO LeagueExpenses (League, Season, Date, Category, Description, Qty, UnitCost, Amount, Note)
                    VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)
                """, (league, season, date, category, detail or desc, earned, comment or ''))
            if rows:
                print(f'[{now_local():%H:%M:%S}] Schema check: migrated {len(rows)} expense rows from Payments to LeagueExpenses')
        conn.commit()
        conn.close()
    except Exception as e:
        print(f'[{now_local():%H:%M:%S}] Schema check error: {e}')

def run_server():
    print(f'HughsGolf server v{VERSION} starting on port {PORT}')
    print(f'DB path: {DB_PATH}')
    ensure_schema()
    if 'sandbox' not in VERSION.lower():
        threading.Thread(target=update_duckdns, daemon=True).start()
    threading.Thread(target=clear_stale_sessions, daemon=True).start()
    app.run(host='0.0.0.0', port=PORT, debug=False)


@app.route('/api/recent-logins')
def recent_logins():
    """Return login events from LogTable since a given id (for admin polling)."""
    since_id = request.args.get('since_id', 0, type=int)
    try:
        with get_db() as con:
            rows = con.execute(
                """SELECT id, log_time, text FROM LogTable
                   WHERE method='login' AND id > ?
                   ORDER BY id ASC LIMIT 20""",
                (since_id,)
            ).fetchall()
        return jsonify([{'id': r['id'], 'log_time': r['log_time'], 'text': r['text']} for r in rows])
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    run_server()
