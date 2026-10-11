"""/backlog-md: admins only, serves the BACKLOG.md that sits next to the app."""
import sys; sys.dont_write_bytecode = True
import os, tempfile, importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
app.BASE_DIR = tempfile.mkdtemp()
cl = app.app.test_client(); H = {'X-Save-Token': app.SAVE_TOKEN, 'X-Actor': 'Boss', 'X-Actor-Role': 'admin'}
assert cl.get('/backlog-md').status_code == 403
assert cl.get('/backlog-md', headers={**H, 'X-Actor-Role': 'player'}).status_code == 403
r = cl.get('/backlog-md', headers=H); assert r.status_code == 404 and not r.get_json()['ok']       # not deployed yet
open(os.path.join(app.BASE_DIR, 'BACKLOG.md'), 'w', encoding='utf-8').write('# Hugh\'s Golf — Backlog\n\n## A\n- [ ] **Item** — ✅ text\n')
j = cl.get('/backlog-md', headers=H).get_json()
assert j['ok'] and '**Item** — ✅ text' in j['text'] and j['modified'] > 0
assert cl.get('/backlog-md', headers={**H, 'X-Actor-Role': 'developer'}).get_json()['ok']
print('ok')
