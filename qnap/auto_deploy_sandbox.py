#!/usr/bin/env python3
"""auto_deploy_sandbox.py — RUNS ON THE QNAP (cron, every few minutes). Keeps the SANDBOX on the latest merged pull request.

Every run asks GitHub (outbound only, no open port) for the newest commit of sandbox-enhancements. If it is a merged pull request that is
not what the sandbox already runs, it downloads exactly that commit, checks it, copies the app files into the sandbox folder, restarts the
sandbox, and checks /version. If anything fails it puts the previous files back. It NEVER touches live, any database, photos or backups.

See docs/AUTO_DEPLOY.md.  Pause: create the file  <BASE>/autodeploy/PAUSE .
"""
import io, json, os, re, shutil, subprocess, sys, tarfile, tempfile, time, urllib.request

REPO = os.environ.get('HG_REPO', 'golferky/HughsGolf_Web')
BRANCH = os.environ.get('HG_BRANCH', 'sandbox-enhancements')
BASE = os.environ.get('HG_BASE', '/share/CACHEDEV3_DATA/My Stuff/HughsGolf')
PORT = int(os.environ.get('HG_SANDBOX_PORT', '8446'))
WAIT_FOR_QUIET_MINUTES = 10          # a deploy waits (up to this long) while somebody is connected to the sandbox
KEEP_BACKUPS = 5
APP_FILES = ('HughsGolf.html', 'app.py', 'BACKLOG.md')      # copied into <BASE>/sandbox; vendor/ too; hughsgolf_ctl.sh into <BASE>


def state_dir(base=None):
    d = os.path.join(base or BASE, 'autodeploy'); os.makedirs(d, exist_ok=True); return d

def log(msg, base=None):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(line)
    try:
        with open(os.path.join(state_dir(base), 'autodeploy.log'), 'a') as f: f.write(line + '\n')
    except OSError:
        pass

def http_get(url, token=None, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': 'hughsgolf-autodeploy', **({'Authorization': f'Bearer {token}'} if token else {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def read_token(base):
    p = os.path.join(base, 'autodeploy', 'github_token')          # only needed once the repo is private: a read-only token, chmod 600
    try:
        return open(p).read().strip() or None
    except OSError:
        return None

def deployed_sha(sandbox_dir):
    try:
        return open(os.path.join(sandbox_dir, 'DEPLOYED_COMMIT')).read().split()[0]
    except (OSError, IndexError):
        return ''

def is_merged_pr(subject):
    return bool(re.match(r'Merge pull request #\d+', subject or ''))

def read_version(app_py):
    m = re.search(r"^VERSION\s*=\s*'([^']+)'", open(app_py, encoding='utf-8').read(), re.M)
    return m.group(1) if m else ''

def active_connections(port):
    try:
        out = subprocess.run(['netstat', '-tn'], capture_output=True, text=True, timeout=10).stdout
    except Exception:
        return 0
    return sum(1 for l in out.splitlines() if f':{port} ' in l and 'ESTABLISHED' in l)

def extract_commit(tar_bytes, dest):
    """Unpack a GitHub tarball (one top folder) and return the folder holding the repo files."""
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode='r:gz') as t:
        for m in t.getmembers():                                     # never write outside dest
            if m.name.startswith('/') or '..' in m.name.split('/'):
                raise ValueError('unsafe path in archive: ' + m.name)
        t.extractall(dest)
    tops = [d for d in os.listdir(dest) if os.path.isdir(os.path.join(dest, d))]
    if len(tops) != 1:
        raise ValueError('unexpected archive layout')
    return os.path.join(dest, tops[0])

def check_build(src):
    for f in ('HughsGolf.html', 'app.py', os.path.join('vendor', 'sqljs'), os.path.join('qnap', 'hughsgolf_ctl.sh')):
        if not os.path.exists(os.path.join(src, f)):
            raise ValueError('missing ' + f)
    compile(open(os.path.join(src, 'app.py'), encoding='utf-8').read(), 'app.py', 'exec')
    version = read_version(os.path.join(src, 'app.py'))
    if not version.endswith('-sandbox'):
        raise ValueError(f"VERSION '{version}' is not a sandbox version: refusing")
    return version

def install(src, sandbox_dir, base):
    """Copy the app files in; return the backup folder used for a rollback."""
    stamp = time.strftime('%Y%m%d_%H%M%S')
    backup = os.path.join(sandbox_dir, 'backups', 'autodeploy', stamp); os.makedirs(backup, exist_ok=True)
    for f in APP_FILES + ('DEPLOYED_COMMIT',):
        if os.path.exists(os.path.join(sandbox_dir, f)): shutil.copy2(os.path.join(sandbox_dir, f), backup)
    if os.path.isdir(os.path.join(sandbox_dir, 'vendor')): shutil.copytree(os.path.join(sandbox_dir, 'vendor'), os.path.join(backup, 'vendor'))
    olds = sorted(os.listdir(os.path.join(sandbox_dir, 'backups', 'autodeploy')))
    for old in olds[:-KEEP_BACKUPS]: shutil.rmtree(os.path.join(sandbox_dir, 'backups', 'autodeploy', old), ignore_errors=True)
    for f in APP_FILES:
        if os.path.exists(os.path.join(src, f)): shutil.copy2(os.path.join(src, f), sandbox_dir)
    shutil.copytree(os.path.join(src, 'vendor'), os.path.join(sandbox_dir, 'vendor'), dirs_exist_ok=True)
    shutil.copy2(os.path.join(src, 'qnap', 'hughsgolf_ctl.sh'), base)
    return backup

def rollback(backup, sandbox_dir):
    for f in os.listdir(backup):
        p = os.path.join(backup, f)
        if os.path.isdir(p): shutil.copytree(p, os.path.join(sandbox_dir, f), dirs_exist_ok=True)
        else: shutil.copy2(p, sandbox_dir)

def restart_sandbox(base):
    r = subprocess.run(['sh', os.path.join(base, 'hughsgolf_ctl.sh'), 'sandbox', 'restart'], capture_output=True, text=True, timeout=120)
    return r.returncode == 0

def running_version(port):
    try:
        return json.loads(http_get(f'http://127.0.0.1:{port}/version', timeout=5)).get('flaskVersion', '')
    except Exception:
        return ''

def wait_for_version(port, want, seconds=30, _get=None):
    end = time.time() + seconds
    while time.time() < end:
        if (_get or running_version)(port) == want: return True
        time.sleep(2)
    return False


def run_once(base=None, fetch=http_get, restart=restart_sandbox, version_ok=None, connections=active_connections, now=time.time, sleep_fn=None):
    """One pass. Returns a short word for what happened (used by the tests)."""
    base = base or BASE
    sandbox_dir = os.path.join(base, 'sandbox'); sd = state_dir(base)
    if os.path.exists(os.path.join(sd, 'PAUSE')): return 'paused'
    token = read_token(base)
    try:
        info = json.loads(fetch(f'https://api.github.com/repos/{REPO}/commits/{BRANCH}', token))
        sha = info['sha']; subject = info['commit']['message'].split('\n')[0]
    except Exception as e:
        log(f'could not ask GitHub: {e}', base); return 'github-error'
    short = sha[:7]
    if deployed_sha(sandbox_dir) and sha.startswith(deployed_sha(sandbox_dir)): return 'up-to-date'
    if not is_merged_pr(subject):
        return 'not-a-merged-pr'                                    # a push straight to the branch is left for a manual deploy
    failed = os.path.join(sd, 'failed_sha')
    if os.path.exists(failed) and open(failed).read().strip() == sha: return 'already-failed'
    waiting = os.path.join(sd, 'waiting_since')
    if connections(PORT):
        t0 = float(open(waiting).read()) if os.path.exists(waiting) else now()
        open(waiting, 'w').write(str(t0))
        if now() - t0 < WAIT_FOR_QUIET_MINUTES * 60:
            return 'waiting-for-quiet'
    if os.path.exists(waiting): os.remove(waiting)
    log(f'new merge {short}: {subject}', base)
    tmp = tempfile.mkdtemp(prefix='hgdeploy_', dir=sd); backup = None
    try:
        src = extract_commit(fetch(f'https://codeload.github.com/{REPO}/tar.gz/{sha}', token, 120), tmp)
        version = check_build(src)
        backup = install(src, sandbox_dir, base)
        open(os.path.join(sandbox_dir, 'DEPLOYED_COMMIT'), 'w').write(f'{short} {subject}\n')
        ok = restart(base) and (version_ok or (lambda v: wait_for_version(PORT, v)))(version)
        if not ok:
            log(f'{short}: the sandbox did not come up as v{version}: putting the previous files back', base)
            rollback(backup, sandbox_dir); restart(base)
            open(failed, 'w').write(sha); return 'rolled-back'
        log(f'sandbox is running v{version} ({short})', base)
        return 'deployed'
    except Exception as e:
        log(f'{short}: not deployed: {e}', base)
        if backup:
            try: rollback(backup, sandbox_dir)
            except OSError: pass
        open(failed, 'w').write(sha); return 'refused'
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    print(run_once())
