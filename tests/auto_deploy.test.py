"""Sandbox auto-deploy poller: only merged PRs, only the sandbox, rolls back on a bad start, never writes outside its folders."""
import sys; sys.dont_write_bytecode = True
import os, io, json, tarfile, tempfile, importlib.util, time
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('ad', os.path.join(here, '..', 'qnap', 'auto_deploy_sandbox.py'))
ad = importlib.util.module_from_spec(spec); spec.loader.exec_module(ad)

def tarball(version='20261022.1-sandbox', html='NEW HTML', extra=None, drop=None):
    files = {'repo/HughsGolf.html': html, 'repo/app.py': f"VERSION = '{version}'\nx = 1\n", 'repo/BACKLOG.md': 'b',
             'repo/vendor/sqljs/a.js': 'js', 'repo/qnap/hughsgolf_ctl.sh': '#!/bin/sh\n'}
    files.update(extra or {})
    for d in drop or []: files.pop(d, None)
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as t:
        for n, c in files.items():
            b = c.encode(); i = tarfile.TarInfo(n); i.size = len(b); t.addfile(i, io.BytesIO(b))
    return buf.getvalue()

def world(sha='a1b2c3d4e5f6', subject='Merge pull request #139 from golferky/x', tar=None):
    base = tempfile.mkdtemp(); sb = os.path.join(base, 'sandbox'); os.makedirs(sb)
    open(os.path.join(sb, 'HughsGolf.html'), 'w').write('OLD HTML'); open(os.path.join(sb, 'app.py'), 'w').write("VERSION = 'old-sandbox'\n")
    open(os.path.join(sb, 'DEPLOYED_COMMIT'), 'w').write('0000000 old\n')
    open(os.path.join(sb, 'HughsGolf.db'), 'w').write('DB'); os.makedirs(os.path.join(sb, 'photos')); open(os.path.join(sb, 'photos', 'p.jpg'), 'w').write('P')
    t = tar if tar is not None else tarball()
    def fetch(url, token=None, timeout=30):
        if '/commits/' in url: return json.dumps({'sha': sha, 'commit': {'message': subject + '\n\nbody'}}).encode()
        assert url.endswith('/' + sha), url; return t
    return base, sb, fetch

calls = []
def run(base, fetch, ok=True, conns=0, now=time.time):
    return ad.run_once(base, fetch, restart=lambda b: (calls.append('restart'), True)[1], version_ok=lambda v: ok, connections=lambda p: conns, now=now)
read = lambda p: open(p).read()

# success: files copied, header file written, db/photos untouched, backup kept
b, sb, f = world(); assert run(b, f) == 'deployed'
assert read(sb + '/HughsGolf.html') == 'NEW HTML' and 'x = 1' in read(sb + '/app.py') and os.path.exists(sb + '/vendor/sqljs/a.js')
assert read(sb + '/DEPLOYED_COMMIT').strip() == 'a1b2c3d Merge pull request #139 from golferky/x'
assert read(sb + '/HughsGolf.db') == 'DB' and read(sb + '/photos/p.jpg') == 'P'
assert os.path.exists(b + '/hughsgolf_ctl.sh')
bk = os.listdir(sb + '/backups/autodeploy'); assert len(bk) == 1 and read(sb + '/backups/autodeploy/' + bk[0] + '/HughsGolf.html') == 'OLD HTML'
assert run(b, f) == 'up-to-date', 'same commit: nothing to do'
# paused
b, sb, f = world(); os.makedirs(b + '/autodeploy'); open(b + '/autodeploy/PAUSE', 'w').write('')
assert run(b, f) == 'paused' and read(sb + '/HughsGolf.html') == 'OLD HTML'
# a direct push (not a merged PR) is ignored
b, sb, f = world(subject='fix typo'); assert run(b, f) == 'not-a-merged-pr' and read(sb + '/HughsGolf.html') == 'OLD HTML'
# a non-sandbox VERSION is refused, nothing changes, and it is not retried
b, sb, f = world(tar=tarball(version='20261022.1')); assert run(b, f) == 'refused' and read(sb + '/HughsGolf.html') == 'OLD HTML'
assert run(b, f) == 'already-failed'
# a missing file is refused
b, sb, f = world(tar=tarball(drop=['repo/vendor/sqljs/a.js'])); assert run(b, f) == 'refused' and read(sb + '/HughsGolf.html') == 'OLD HTML'
# a broken app.py is refused
b, sb, f = world(tar=tarball(extra={'repo/app.py': "VERSION = 'x-sandbox'\ndef (:\n"})); assert run(b, f) == 'refused'
# an archive trying to escape is refused
b, sb, f = world(tar=tarball(extra={'repo/../../evil.txt': 'x'})); assert run(b, f) == 'refused' and not os.path.exists(os.path.join(os.path.dirname(b), 'evil.txt'))
# the sandbox does not come up: previous files go back
b, sb, f = world(); assert run(b, f, ok=False) == 'rolled-back'
assert read(sb + '/HughsGolf.html') == 'OLD HTML' and "old-sandbox" in read(sb + '/app.py') and read(sb + '/DEPLOYED_COMMIT').startswith('0000000')
assert run(b, f) == 'already-failed'
# GitHub unreachable
b, sb, f = world()
def bad(url, token=None, timeout=30): raise OSError('down')
assert run(b, bad) == 'github-error'
# somebody connected: wait, then go after the quiet limit
b, sb, f = world(); t0 = 1000.0
assert run(b, f, conns=2, now=lambda: t0) == 'waiting-for-quiet' and read(sb + '/HughsGolf.html') == 'OLD HTML'
assert run(b, f, conns=2, now=lambda: t0 + 300) == 'waiting-for-quiet'
assert run(b, f, conns=2, now=lambda: t0 + 700) == 'deployed' and not os.path.exists(b + '/autodeploy/waiting_since')
# live is never mentioned in the script's writes
src = read(os.path.join(here, '..', 'qnap', 'auto_deploy_sandbox.py'))
assert '8445' not in src and "'live'" not in src
print('auto_deploy.test.py OK')
