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
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from flask import Flask, send_from_directory, request, jsonify

app = Flask(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DB_PATH    = os.path.join(BASE_DIR, 'HughsGolf.db')
BACKUP_DIR = os.path.join(BASE_DIR, 'backups')
SAVE_TOKEN = 'HughsGolf2026Save'
PORT       = 8445
VERSION    = '20260623.4'
LOG_PATH   = os.environ.get('HUGHSGOLF_LOG', os.path.join(BASE_DIR, 'flask_garyadmin.log'))
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
    return send_from_directory(BASE_DIR, 'HughsGolf.html')


@app.route('/HughsGolf.html')
def html():
    return send_from_directory(BASE_DIR, 'HughsGolf.html')


@app.route('/HughsGolf.db')
def database():
    return send_from_directory(BASE_DIR, 'HughsGolf.db')


@app.route('/save', methods=['POST'])
def save_db():
    token = request.headers.get('X-Save-Token', '')
    if token != SAVE_TOKEN:
        return jsonify({'ok': False, 'error': 'Unauthorized'}), 403

    data = request.get_data()
    if not data:
        return jsonify({'ok': False, 'error': 'Empty body'}), 400

    if os.path.exists(DB_PATH):
        ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
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

    print(f'[{datetime.datetime.now():%H:%M:%S}] DB saved — {len(data):,} bytes')
    return jsonify({'ok': True, 'bytes': len(data)})


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
    expires = datetime.datetime.now() + datetime.timedelta(hours=1)
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

        print(f'[{datetime.datetime.now():%H:%M:%S}] Reset email sent to {player_email} for {player}')
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
    if datetime.datetime.now() > entry['expires']:
        del reset_tokens[player]
        return jsonify({'ok': False, 'error': 'Code expired. Please request a new one.'}), 400
    if entry['token'] != token:
        return jsonify({'ok': False, 'error': 'Incorrect code. Please try again.'}), 400

    # Valid — consume token
    del reset_tokens[player]
    return jsonify({'ok': True})


@app.route('/notify-login', methods=['POST'])
def notify_login():
    """Email the developer whenever someone logs in, with their version."""
    body = request.get_json() or {}
    player  = body.get('player', 'Unknown')
    role    = body.get('role', 'unknown')
    version = body.get('version', 'unknown')
    ip      = body.get('ip', 'unknown')

    gmail_user, gmail_pw = get_gmail_creds()
    if not gmail_user or not gmail_pw:
        return jsonify({'ok': False, 'error': 'Email not configured'}), 500

    dev_email = 'garyrscudder@gmail.com'
    subject = f"HughsGolf activity log"
    body_text = f"""{player} ({role}) logged in — v{version}, ip={ip}, {datetime.datetime.now():%Y-%m-%d %H:%M:%S}
"""
    try:
        msg = MIMEText(body_text)
        msg['From'] = gmail_user
        msg['To'] = dev_email
        msg['Subject'] = subject
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(gmail_user, gmail_pw)
            server.send_message(msg)
        return jsonify({'ok': True})
    except Exception as e:
        print(f'notify_login error: {e}')
        return jsonify({'ok': False, 'error': str(e)}), 500


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

    if not player or not date or not message or not recipients:
        return jsonify({'ok': False, 'error': 'Missing required fields'}), 400

    gmail_user, gmail_pw = get_gmail_creds()
    if not gmail_user or not gmail_pw:
        return jsonify({'ok': False, 'error': 'Email not configured'}), 500

    # Get secretary's email for CC
    secretary_email = None
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT Secretary FROM LeagueParms WHERE Name=\"Hugh's\" AND Season=(SELECT MAX(Season) FROM LeagueParms WHERE Name=\"Hugh's\")")
        sec_row = cur.fetchone()
        secretary_name = sec_row['Secretary'] if sec_row else None
        if secretary_name:
            cur.execute("SELECT Email FROM Players WHERE Player=?", (secretary_name,))
            sec_email_row = cur.fetchone()
            if sec_email_row:
                secretary_email = sec_email_row['Email']
        conn.close()
    except Exception as e:
        print(f'need_sub secretary lookup error: {e}')

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

            # Email
            if r['Email']:
                try:
                    msg = MIMEMultipart()
                    msg['From']    = gmail_user
                    msg['To']      = r['Email']
                    if secretary_email and secretary_email != r['Email']:
                        msg['Cc'] = secretary_email
                    msg['Subject'] = subject
                    msg.attach(MIMEText(message, 'plain'))
                    with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
                        server.login(gmail_user, gmail_pw)
                        recipients_list = [r['Email']]
                        if secretary_email and secretary_email != r['Email']:
                            recipients_list.append(secretary_email)
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

    print(f'[{datetime.datetime.now():%H:%M:%S}] Sub request from {player} for {date}: sent to {sent_count}/{len(recipients)} ({email_count} email, {sms_count} text)')
    return jsonify({'ok': True, 'sent_count': sent_count, 'email_count': email_count, 'sms_count': sms_count, 'failed': failed, 'errors': errors})


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

    print(f'[{datetime.datetime.now():%H:%M:%S}] Payout notification sent to {player} via {", ".join(sent_to)}')
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

    print(f'[{datetime.datetime.now():%H:%M:%S}] Gallus import: {len(result_players)} players, {front_back}')
    return jsonify({'ok': True, 'players': result_players, 'frontBack': front_back})


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
                    print(f'[{datetime.datetime.now():%H:%M:%S}] DuckDNS update ({domain}.duckdns.org): {result}')
            else:
                print(f'[{datetime.datetime.now():%H:%M:%S}] DuckDNS not configured (no token/domain in LeagueParms)')
        except Exception as e:
            print(f'[{datetime.datetime.now():%H:%M:%S}] DuckDNS update error: {e}')

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
                print(f'[{datetime.datetime.now():%H:%M:%S}] Cleared {cleared} stale session(s)')
        except Exception as e:
            print(f'[{datetime.datetime.now():%H:%M:%S}] Session cleanup error: {e}')
def run_server():
    print(f'HughsGolf server v{VERSION} starting on port {PORT}')
    print(f'DB path: {DB_PATH}')
    threading.Thread(target=update_duckdns, daemon=True).start()
    threading.Thread(target=clear_stale_sessions, daemon=True).start()
    app.run(host='0.0.0.0', port=PORT, debug=False)


if __name__ == '__main__':
    run_server()
