// The QNAP start script uses packages from the big volume and says plainly when flask/tzdata are missing.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), { spawnSync } = require('child_process');
const script = path.join(__dirname, '..', 'qnap', 'hughsgolf_ctl.sh');
const src = fs.readFileSync(script, 'utf8');
assert(spawnSync('sh', ['-n', script]).status === 0, 'valid sh syntax');
assert(/LIBS="\$BASE\/pylibs"/.test(src) && /export PYTHONPATH="\$LIBS/.test(src), 'pylibs is put on PYTHONPATH');
assert(!/\.local|--user/.test(src.replace(/#.*$/gm, '')), 'nothing installs into the home folder');

function run(pythonBody, mkLibs) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hg-'));
  fs.mkdirSync(path.join(base, 'live')); fs.writeFileSync(path.join(base, 'live', 'app.py'), '');
  if (mkLibs) fs.mkdirSync(path.join(base, 'pylibs'));
  const py = path.join(base, 'fakepython'); fs.writeFileSync(py, '#!/bin/sh\n' + pythonBody + '\n', { mode: 0o755 });
  const r = spawnSync('sh', [script, 'live', 'start'], { env: { PATH: process.env.PATH, HG_BASE: base, HG_PYTHON: py, HG_NO_SU: '1' }, encoding: 'utf8', timeout: 20000 });
  fs.rmSync(base, { recursive: true, force: true });
  return r;
}
// missing packages: refuses to start, prints the fix with the pylibs path, never launches app.py
let r = run('case "$*" in *import\\ flask*) exit 1;; *) echo LAUNCHED >&2; exit 0;; esac', false);
assert.notStrictEqual(r.status, 0);
assert(/NOT starting: Python is missing flask and\/or tzdata/.test(r.stdout), r.stdout);
assert(/pip install --no-cache-dir --target ".*\/pylibs" flask tzdata/.test(r.stdout), 'fix command shown');
assert(!/LAUNCHED/.test(r.stderr + r.stdout), 'app.py was not started');
// packages present: the check passes and the start goes ahead
r = run('exit 0', true);
assert(!/NOT starting/.test(r.stdout), 'no refusal when the packages import: ' + r.stdout);
console.log('ok');
