"""
HughsGolf Flask Server
Serves HughsGolf.html + HughsGolf.db and handles DB save + password reset emails.
Run: /share/CACHEDEV2_DATA/.qpkg/Python3/opt/python3/bin/python3 app.py
"""

import os
import shutil
import datetime
import random
import string
import smtplib
import sqlite3
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
VERSION    = '20260614.4'
# ─────────────────────────────────────────────────────────────────────────────

os.makedirs(BACKUP_DIR, exist_ok=True)

# In-memory reset tokens: { token: { player, expires } }
reset_tokens = {}


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


@app.route('/notify-payout', methods=['POST'])
def notify_payout():
    """Send email + SMS (via carrier gateway) notification of a kitty payout."""
    body = request.get_json()
    player  = body.get('player', '').strip()
    amount  = body.get('amount', 0)
    source  = body.get('source', '')   # e.g. "Skin Kitty"
    comment = body.get('comment', '')

    if not player:
        return jsonify({'ok': False, 'error': 'No player name'}), 400

    # Carrier email-to-SMS gateways
    CARRIER_GATEWAYS = {
        'verizon':   'vtext.com',
        'att':       'txt.att.net',
        'at&t':      'txt.att.net',
        't-mobile':  'tmomail.net',
        'tmobile':   'tmomail.net',
        'sprint':    'messaging.sprintpcs.com',
        'cricket':   'sms.cricketwireless.net',
        'boost':     'sms.myboostmobile.com',
        'metro':     'mymetropcs.com',
        'us cellular': 'email.uscc.net',
        'uscellular': 'email.uscc.net',
    }

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

    subject = "Hugh's Golf League — Payout"
    body_text = f"""Hi {player},

You've received a payout of ${amount:.2f} from the {source}.

{comment}

A quick reply with "Confirmed" lets us know you received this, though it's not required.

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
        carrier_key = row['CellCarrier'].strip().lower()
        gateway = CARRIER_GATEWAYS.get(carrier_key)
        if gateway:
            phone_digits = ''.join(c for c in str(row['Phone']) if c.isdigit())
            if len(phone_digits) == 10:
                sms_address = f'{phone_digits}@{gateway}'
                try:
                    sms_body = f"Hugh's Golf League: ${amount:.2f} payout from {source}. {comment} Reply CONFIRMED if received."
                    msg = MIMEText(sms_body)
                    msg['From']    = gmail_user
                    msg['To']      = sms_address
                    msg['Subject'] = "Hugh's Golf League"
                    with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
                        server.login(gmail_user, gmail_pw)
                        server.send_message(msg)
                    sent_to.append('sms')
                except Exception as e:
                    errors.append(f'SMS failed: {e}')
            else:
                errors.append('Invalid phone number format')
        else:
            errors.append(f'Unknown carrier: {row["CellCarrier"]}')

    if not sent_to:
        return jsonify({'ok': False, 'error': '; '.join(errors) or 'No email or phone on file'}), 404

    print(f'[{datetime.datetime.now():%H:%M:%S}] Payout notification sent to {player} via {", ".join(sent_to)}')
    return jsonify({'ok': True, 'sent_to': sent_to, 'errors': errors})



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


if __name__ == '__main__':
    print(f'HughsGolf server v{VERSION} starting on port {PORT}')
    print(f'DB path: {DB_PATH}')
    app.run(host='0.0.0.0', port=PORT, debug=False)
