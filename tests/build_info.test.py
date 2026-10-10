# /version reports the git commit + PR number from DEPLOYED_COMMIT; the page appends them to the version label.
import os, re, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import app as A
d = tempfile.mkdtemp(); A.BASE_DIR = d
assert A.read_build_info() == {'commit': '', 'pr': None}
open(os.path.join(d, 'DEPLOYED_COMMIT'), 'w').write('ae40258 Merge pull request #83 from golferky/claude/gallus-fix-date\n')
assert A.read_build_info() == {'commit': 'ae40258', 'pr': 83}
open(os.path.join(d, 'DEPLOYED_COMMIT'), 'w').write('abc1234 Some direct commit\n')
assert A.read_build_info() == {'commit': 'abc1234', 'pr': None}
html = open(os.path.join(os.path.dirname(__file__), '..', 'HughsGolf.html')).read()
assert "v.build" in html and "PR #${b.pr}" in html
print('ok')
