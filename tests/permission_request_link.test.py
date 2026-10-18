"""The permission request to a new possible sub: the link goes in the email (carriers drop texts with links); a text only says to check it."""
import sys; sys.dont_write_bytecode = True
import os, sqlite3, tempfile, importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('hg_app', os.path.join(here, '..', 'app.py'))
app = importlib.util.module_from_spec(spec); spec.loader.exec_module(app)
tmp = tempfile.mkdtemp(); app.DB_PATH = os.path.join(tmp, 'HughsGolf.db')
c = sqlite3.connect(app.DB_PATH); c.executescript("CREATE TABLE Players (Player TEXT); CREATE TABLE LogTable (log_time TEXT, level TEXT, method TEXT, source TEXT, text TEXT, details TEXT, created_at TEXT);"); c.commit(); c.close()
app.ensure_schema()
sent = []; app._send_mail = lambda to, subj, body: (sent.append((to[0], body)), True)[1]
with app.app.test_request_context('/', base_url='https://hughsgolf.example.org'):
    def ask(email, phone, carrier):
        sent.clear(); link, e, t = app._send_permission_request('New Guy', email, phone, carrier, 'Gary', 'tok123'); return link, e, t
    link, e, t = ask('ng@x.com', '502-555-0111', 'Verizon')
    assert e and t and link.endswith('/sub-preferences?t=tok123')
    txt = [s for s in sent if s[0].endswith('@vtext.com')][0][1]; eml = [s for s in sent if s[0] == 'ng@x.com'][0][1]
    assert 'sub-preferences' not in txt and 'check your email' in txt and 'sub-preferences?t=tok123' in eml, sent
    link, e, t = ask('', '502-555-0111', 'Verizon')
    assert t and not e and 'sub-preferences?t=tok123' in sent[0][1], 'no email: the link has to be in the text'
    link, e, t = ask('ng@x.com', '', '')
    assert e and not t and 'sub-preferences?t=tok123' in sent[0][1]
print('ok')
