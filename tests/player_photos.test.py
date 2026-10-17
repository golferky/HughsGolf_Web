"""Player photos: small JPEG files on the server, a random key in the database, session-checked upload / remove, admin removal."""
import sys; sys.dont_write_bytecode = True
import os, sqlite3, tempfile, importlib.util, struct
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
tmp = tempfile.mkdtemp()
app.DB_PATH = os.path.join(tmp, 'HughsGolf.db'); app.PHOTO_DIR = os.path.join(tmp, 'photos')
c = sqlite3.connect(app.DB_PATH)
c.executescript("""CREATE TABLE Players (Player TEXT, Officer TEXT, ActiveSession TEXT, PhotoKey TEXT);
  CREATE TABLE LogTable (log_time TEXT, level TEXT, method TEXT, source TEXT, text TEXT, details TEXT, created_at TEXT);
  INSERT INTO Players VALUES ('Pat Example', 'Player', 'sess-pat', NULL), ('Sam Admin', 'Admin', 'sess-sam', NULL), ('Lee Player', 'Player', 'sess-lee', NULL);""")
c.commit(); c.close()

def jpeg(w, h, pad=0):                      # a minimal JPEG header: SOI, SOF0 with the size, padding, EOI (enough for the size check and storage)
    sof = b'\xff\xc0' + struct.pack('>HBHHB', 11, 8, h, w, 1) + b'\x01\x11\x00'
    return b'\xff\xd8' + b'\xff\xe0' + struct.pack('>H', 16) + b'JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00' + sof + b'\x00' * pad + b'\xff\xd9'

cl = app.app.test_client()
key_of = lambda n: sqlite3.connect(app.DB_PATH).execute('SELECT PhotoKey FROM Players WHERE Player=?', (n,)).fetchone()[0]
upload = lambda body, player='Pat Example', session='sess-pat': cl.post('/upload-my-photo', data=body, headers={'X-Player': player.replace(' ', '%20'), 'X-Session': session, 'Content-Type': 'image/jpeg'})
files = lambda: sorted(os.listdir(app.PHOTO_DIR)) if os.path.isdir(app.PHOTO_DIR) else []

# dimensions
assert app._jpeg_dimensions(jpeg(400, 300)) == (400, 300) and app._jpeg_dimensions(b'GIF89a....') is None and app._jpeg_dimensions(b'') is None and app._jpeg_dimensions(b'\xff\xd8\xff') is None

# the session is checked, and nothing is stored on a refusal
assert upload(jpeg(400, 400), session='wrong').status_code == 403
assert upload(jpeg(400, 400), session='sess-sam').status_code == 403, "another player's session cannot set Pat's photo"
assert upload(jpeg(400, 400), player='Nobody', session='x').status_code == 403
assert files() == [] and key_of('Pat Example') is None

# bad pictures
assert upload(b'not a picture at all').status_code == 400
assert upload(jpeg(4000, 3000)).status_code == 400, 'too many pixels'
assert upload(jpeg(20, 20)).status_code == 400, 'too small'
assert upload(jpeg(400, 400, pad=app.PHOTO_MAX_BYTES + 10)).status_code == 413, 'too many bytes'
assert files() == []

# a good upload: file + random key + log
r = upload(jpeg(400, 400)); j = r.get_json(); assert r.status_code == 200 and j['ok'], j
k1 = j['photoKey']; assert len(k1) == 24 and all(ch in '0123456789abcdef' for ch in k1) and key_of('Pat Example') == k1 and files() == [k1 + '.jpg']
g = cl.get(f'/photos/{k1}.jpg'); assert g.status_code == 200 and g.mimetype == 'image/jpeg' and 'immutable' in g.headers['Cache-Control'] and g.data.startswith(b'\xff\xd8')
# replacing makes a new key and removes the old file (so a cached old picture is never shown)
k2 = upload(jpeg(300, 300)).get_json()['photoKey']; assert k2 != k1 and files() == [k2 + '.jpg'] and key_of('Pat Example') == k2
assert cl.get(f'/photos/{k1}.jpg').status_code == 404

# the photo route only serves keys it made
for bad in ('../HughsGolf', 'abc', 'g' * 24, '0' * 24):
    assert cl.get(f'/photos/{bad}.jpg').status_code == 404, bad

# remove: own session; an admin can remove anyone's; a player cannot remove another's
rm = lambda **b: cl.post('/remove-my-photo', json=b)
assert rm(player='Pat Example', sessionToken='wrong').status_code == 403 and key_of('Pat Example') == k2
ar = lambda **b: cl.post('/admin-remove-photo', json=b)
assert ar(admin='Lee Player', sessionToken='sess-lee', player='Pat Example').status_code == 403, 'a player is not an admin'
assert ar(admin='Sam Admin', sessionToken='wrong', player='Pat Example').status_code == 403, 'admin session is checked too'
assert key_of('Pat Example') == k2
assert ar(admin='Sam Admin', sessionToken='sess-sam', player='Pat Example').status_code == 200 and key_of('Pat Example') == '' and files() == []
upload(jpeg(400, 400), player='Lee Player', session='sess-lee'); assert len(files()) == 1
assert rm(player='Lee Player', sessionToken='sess-lee').status_code == 200 and key_of('Lee Player') == '' and files() == []

# a database without the column gets it on the first upload
c = sqlite3.connect(app.DB_PATH); c.executescript("ALTER TABLE Players RENAME TO P2; CREATE TABLE Players (Player TEXT, Officer TEXT, ActiveSession TEXT); INSERT INTO Players SELECT Player, Officer, ActiveSession FROM P2; DROP TABLE P2;"); c.commit(); c.close()
assert upload(jpeg(400, 400)).status_code == 200 and key_of('Pat Example')

log = [r[0] for r in sqlite3.connect(app.DB_PATH).execute("SELECT text FROM LogTable WHERE method LIKE 'photo_%' ORDER BY rowid")]
assert any('set their photo' in t for t in log) and any('removed the photo of Pat Example' in t for t in log) and any('removed their photo' in t for t in log), log
print('ok')
