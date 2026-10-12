"""/vendor/sqljs/*: the app serves sql.js itself (no CDN needed to log in); nothing outside that folder is reachable."""
import sys; sys.dont_write_bytecode = True
import os, importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
cl = app.app.test_client()
r = cl.get('/vendor/sqljs/sql-wasm.js'); assert r.status_code == 200 and len(r.data) > 10000 and b'initSqlJs' in r.data
assert 'max-age' in r.headers.get('Cache-Control', '')
r = cl.get('/vendor/sqljs/sql-wasm.wasm'); assert r.status_code == 200 and r.data[:4] == b'\x00asm' and 'wasm' in r.headers['Content-Type']
assert cl.get('/vendor/sqljs/nope.js').status_code == 404
assert cl.get('/vendor/sqljs/../../app.py').status_code == 404
assert cl.get('/vendor/sqljs/%2e%2e/%2e%2e/app.py').status_code == 404
print('ok')
