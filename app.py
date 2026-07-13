"""
HughsGolf Flask Server
Serves HughsGolf.html + HughsGolf.db and handles DB save + password reset emails.
Run: /share/CACHEDEV2_DATA/.qpkg/Python3/opt/python3/bin/python3 app.py
"""

import os
import shutil
import datetime
import random
import shlex
import string
import smtplib
import sqlite3
import subprocess
import sys
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
DB_PATH    = os.path.join(BASE_DIR, 'HughsGolf.db')
BACKUP_DIR = os.path.join(BASE_DIR, 'backups')
SAVE_TOKEN = 'HughsGolf2026Save'
PORT       = 8445
VERSION    = '20260701.4'
LOG_PATH   = os.environ.get('HUGHSGOLF_LOG', os.path.join(BASE_DIR, 'flask_garyadmin.log'))
DB_TIMEOUT_SECONDS = 15
DB_WRITE_LOCK = threading.RLock()
# ─────────────────────────────────────────────────────────────────────────────

os.makedirs(BACKUP_DIR, exist_ok=True)

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
    """Read Gmail credentials from LeagueParms table."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT Email, EmailPassword FROM LeagueParms WHERE Name=\"Hugh's\" AND Season=2026")
        row = cur.fetchone()
        conn.close()
        if row:
            return row['Email'], row['EmailPassword']
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
    return resp


@app.route('/version')
def version():
    try:
        import re
        with open(os.path.join(BASE_DIR, 'HughsGolf.html'), 'r') as f:
            content = f.read(20000)
        match = re.search(r'v(2026\d+\.\d+)', content)
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
        modified_ms = int(stat.st_mtime * 1000)
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
                content = f.read(20000)
            match = re.search(r'v(2026\d+\.\d+)', content)
            server_version = match.group(1) if match else None
            if server_version and client_version != server_version:
                return jsonify({'ok': False, 'error': 'stale_version', 'serverVersion': server_version, 'flaskVersion': VERSION}), 409
        except Exception:
            pass

    with DB_WRITE_LOCK:
        if os.path.exists(DB_PATH):
            ts = now_local().strftime('%Y%m%d_%H%M%S')
            backup = os.path.join(BACKUP_DIR, f'HughsGolf_{ts}.db')
            shutil.copy2(DB_PATH, backup)
            backups = sorted(
                [f for f in os.listdir(BACKUP_DIR) if f.endswith('.db')],
                reverse=True
            )
            for old in backups[20:]:
                os.remove(os.path.join(BACKUP_DIR, old))

        tmp = DB_PATH + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(data)
        os.replace(tmp, DB_PATH)

    print(f'[{now_local():%H:%M:%S}] DB saved — {len(data):,} bytes')
    return jsonify({'ok': True, 'bytes': len(data)})


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
        os.makedirs(BACKUP_DIR, exist_ok=True)
        files = [f for f in os.listdir(BACKUP_DIR) if f.endswith('.db')]
        files_full = [(f, os.path.join(BACKUP_DIR, f)) for f in files]
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
            backups.append(entry)

        return jsonify({'ok': True, 'backups': backups})
    except Exception as e:
        print(f'[{now_local():%H:%M:%S}] backup_list error: {e}')
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/restore-backup', methods=['POST'])
def restore_backup():
    """Restore a backup file over the live DB, saving the current live DB first."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    body = request.get_json() or {}
    filename = os.path.basename(body.get('filename', ''))
    if not filename:
        return jsonify({'ok': False, 'error': 'No filename provided'}), 400
    src = os.path.join(BACKUP_DIR, filename)
    if not os.path.isfile(src):
        return jsonify({'ok': False, 'error': 'Backup not found'}), 404

    try:
        with DB_WRITE_LOCK:
            os.makedirs(BACKUP_DIR, exist_ok=True)
            ts = now_local().strftime('%Y%m%d_%H%M%S')
            safety_name = f'HughsGolf_{ts}_pre-restore.db'
            safety_path = os.path.join(BACKUP_DIR, safety_name)
            if os.path.exists(DB_PATH):
                shutil.copy2(DB_PATH, safety_path)
            shutil.copy2(src, DB_PATH)
        print(f'[{now_local():%H:%M:%S}] Restored backup {filename} (safety copy: {safety_name})')
        return jsonify({'ok': True, 'restored': filename, 'safetyBackup': safety_name})
    except Exception as e:
        print(f'[{now_local():%H:%M:%S}] restore_backup error: {e}')
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/delete-backup', methods=['POST'])
def delete_backup():
    """Permanently delete a backup file."""
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403
    body = request.get_json() or {}
    filename = os.path.basename(body.get('filename', ''))
    if not filename:
        return jsonify({'ok': False, 'error': 'No filename provided'}), 400
    path = os.path.join(BACKUP_DIR, filename)
    if not os.path.isfile(path):
        return jsonify({'ok': False, 'error': 'Backup not found'}), 404

    try:
        os.remove(path)
        print(f'[{now_local():%H:%M:%S}] Deleted backup {filename}')
        return jsonify({'ok': True, 'deleted': filename})
    except Exception as e:
        print(f'[{now_local():%H:%M:%S}] delete_backup error: {e}')
        return jsonify({'ok': False, 'error': str(e)}), 500


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


@app.route('/send-report-pdf', methods=['POST'])
def send_report_pdf():
    """Email a generated report PDF to players opted into EmailStats."""
    body = request.get_json() or {}
    title = str(body.get('title') or "Hugh's Golf Report").strip()
    subtitle = str(body.get('subtitle') or '').strip()
    report_text = str(body.get('text') or '').strip()
    filename = str(body.get('filename') or 'hughs-golf-report.pdf').strip().replace('/', '-').replace('\\', '-')
    if not filename.lower().endswith('.pdf'):
        filename += '.pdf'

    if not report_text:
        return jsonify({'ok': False, 'error': 'No report text to send'}), 400

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
        recipients = cur.fetchall()
        conn.close()
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Recipient lookup failed: {e}'}), 500

    if not recipients:
        return jsonify({'ok': False, 'error': 'No players with EmailStats=Y and an email address'}), 404

    pdf_bytes = build_text_pdf(title, subtitle, report_text)
    subject = f"Hugh's Golf League - {title}"
    body_text = f"{title}\n{subtitle}\n\nAttached is the latest Hugh's Golf report PDF."
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

    print(f'[{now_local():%H:%M:%S}] Report PDF "{title}" sent to {sent_count}/{len(recipients)} EmailStats player(s)')
    return jsonify({'ok': True, 'sent_count': sent_count, 'recipient_count': len(recipients), 'failed': failed})


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

    # Find header row with hole numbers
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
            # Player score row
            name = row[0].strip()
            if name and name not in ('', 'Hole', 'Par m/w', 'Hcp m/w'):
                scores = []
                for i in range(1, len(row)):
                    val = row[i].strip()
                    if val.isdigit() and int(val) < 15:
                        scores.append(int(val))
                    elif val == '' or not val.isdigit():
                        scores.append(None)
                players.append({'name': name, 'scores': scores})

    # Determine front or back based on which holes have scores
    front_back = 'Front'
    if players:
        # Check if scores start at position 10 (back 9)
        first = players[0]['scores']
        if len(first) >= 18 and all(s is None for s in first[:9]) and any(s for s in first[9:18]):
            front_back = 'Back'

    # Trim to 9 holes
    result_players = []
    for p in players:
        scores = p['scores']
        if front_back == 'Back':
            nine = scores[9:18] if len(scores) >= 18 else scores[:9]
        else:
            nine = scores[:9]
        # Pad to 9
        while len(nine) < 9: nine.append(None)
        nine = nine[:9]
        result_players.append({'name': p['name'], 'scores': nine})

    print(f'[{now_local():%H:%M:%S}] Gallus import: {len(result_players)} players, {front_back}')
    return jsonify({'ok': True, 'players': result_players, 'frontBack': front_back})



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
                print(f'[{now_local():%H:%M:%S}] run-sql: {sql[:80]} — {rc} row(s) affected')
                return jsonify({'ok': True, 'rowcount': rc})
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
    """Periodically clear ActiveSession for players inactive for over 2 hours."""
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
        conn.close()
    except Exception as e:
        print(f'[{now_local():%H:%M:%S}] Schema check error: {e}')

def run_server():
    print(f'HughsGolf server v{VERSION} starting on port {PORT}')
    print(f'DB path: {DB_PATH}')
    ensure_schema()
    threading.Thread(target=update_duckdns, daemon=True).start()
    threading.Thread(target=clear_stale_sessions, daemon=True).start()
    app.run(host='0.0.0.0', port=PORT, debug=False)


if __name__ == '__main__':
    run_server()
