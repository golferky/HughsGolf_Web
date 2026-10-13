"""The page, the sql.js engine and the database are sent gzip-compressed to browsers that ask, and raw otherwise."""
import sys; sys.dont_write_bytecode = True
import os, gzip, tempfile, importlib.util, time
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
d = tempfile.mkdtemp(); app.BASE_DIR = d
os.makedirs(os.path.join(d, 'vendor', 'sqljs'))
html = (b'<html>' + b'<div class="row">hello world</div>\n' * 5000 + b'</html>')
db = b'SQLite format 3\x00' + b'INSERT INTO LogTable some repeated log text for the league\n' * 20000
wasm = b'\x00asm\x01\x00\x00\x00' + bytes(range(256)) * 400
open(os.path.join(d, 'HughsGolf.html'), 'wb').write(html); open(os.path.join(d, 'HughsGolf.db'), 'wb').write(db)
open(os.path.join(d, 'vendor', 'sqljs', 'sql-wasm.wasm'), 'wb').write(wasm); open(os.path.join(d, 'tiny.txt'), 'wb').write(b'hi')
cl = app.app.test_client(); GZ = {'Accept-Encoding': 'gzip, deflate, br'}
for path, raw, mt in [('/', html, 'text/html'), ('/HughsGolf.html', html, 'text/html'), ('/HughsGolf.db', db, None), ('/vendor/sqljs/sql-wasm.wasm', wasm, 'wasm')]:
    r = cl.get(path, headers=GZ)
    assert r.status_code == 200 and r.headers['Content-Encoding'] == 'gzip' and r.headers['Vary'] == 'Accept-Encoding', (path, r.status_code, dict(r.headers))
    assert gzip.decompress(r.data) == raw, path + ' decompresses to the original'
    assert int(r.headers['Content-Length']) == len(r.data) and len(r.data) < len(raw) // 2, (path, len(r.data), len(raw))
    if mt: assert mt in r.headers['Content-Type'], r.headers['Content-Type']
    r2 = cl.get(path)                                              # no Accept-Encoding: raw, no Content-Encoding
    assert 'Content-Encoding' not in r2.headers and r2.data == raw, path
    r3 = cl.get(path, headers={**GZ, 'Range': 'bytes=0-99'})       # a range request is never compressed
    assert 'Content-Encoding' not in r3.headers and r3.status_code == 206 and len(r3.data) == 100, (path, r3.status_code)
assert 'no-store' in cl.get('/HughsGolf.html', headers=GZ).headers['Cache-Control'] and 'no-store' in cl.get('/', headers=GZ).headers['Cache-Control'], 'html stays uncacheable'
assert 'max-age=86400' in cl.get('/vendor/sqljs/sql-wasm.wasm', headers=GZ).headers['Cache-Control']
# the compressed copy follows the file: change the database and the next download has the new content
time.sleep(0.02); db2 = db + b'one more saved change\n' * 3000
open(os.path.join(d, 'HughsGolf.db'), 'wb').write(db2)
assert gzip.decompress(cl.get('/HughsGolf.db', headers=GZ).data) == db2
# tiny files are not worth compressing; traversal and unknown files stay 404
assert 'Content-Encoding' not in app.app.test_client().get('/vendor/sqljs/../../tiny.txt', headers=GZ).headers
assert cl.get('/vendor/sqljs/nope.wasm', headers=GZ).status_code == 404
assert cl.get('/vendor/sqljs/%2e%2e/%2e%2e/app.py', headers=GZ).status_code == 404
print('ok')
