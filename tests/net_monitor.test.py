"""tools/net_monitor.py: ping parsing, summary numbers, plain-English diagnosis, and a simulated run -> CSV -> report."""
import sys; sys.dont_write_bytecode = True
import os, io, csv, datetime, tempfile, importlib.util, contextlib, argparse
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('net_monitor', os.path.join(here, '..', 'tools', 'net_monitor.py'))
nm = importlib.util.module_from_spec(spec); spec.loader.exec_module(nm)

# ping output from macOS and from Linux/QNAP (busybox), and a timeout
assert nm.parse_ping_ms('64 bytes from 192.168.1.1: icmp_seq=0 ttl=64 time=5.735 ms') == 5.735
assert nm.parse_ping_ms('64 bytes from 1.1.1.1: seq=0 ttl=57 time=12.3 ms') == 12.3
assert nm.parse_ping_ms('64 bytes from 192.168.1.1: icmp_seq=0 ttl=64 time<1 ms') == 1.0
assert nm.parse_ping_ms('Request timeout for icmp_seq 0') is None and nm.parse_ping_ms('') is None and nm.parse_ping_ms(None) is None

T0 = datetime.datetime(2026, 10, 13, 8, 0, 0)
def series(name, vals, interval=5):
    return [(T0 + datetime.timedelta(seconds=i * interval), name, 'ping_ms', v) for i, v in enumerate(vals)]
# router fine, basement satellite drops and spikes, internet fine
rows = series('router', [5.0] * 100) + series('sat_Basement', [8, 9, 400, None, None, None, 9, 12, 350, 10] * 10) + series('cloudflare', [20.0] * 100)
s = nm.summarize(rows)
assert s['router']['loss'] == 0 and s['router']['spikes'] == 0 and s['router']['max'] == 5.0
b = s['sat_Basement']
assert b['n'] == 100 and abs(b['loss'] - 30.0) < 1e-9 and b['spikes'] == 20 and b['outage_s'] == 15 and b['max'] == 400, b      # longest gap = 3 missed replies x 5 s
notes = nm.diagnose(s)
assert any('Basement satellite is a weak link' in n for n in notes) and not any('INTERNET' in n or 'ROUTER' in n for n in notes), notes
# router bad
assert any('ROUTER itself' in n for n in nm.diagnose(nm.summarize(series('router', [5, None, 400, 5, None] * 20))))
# local fine, both internet targets bad -> the internet / provider
n2 = nm.diagnose(nm.summarize(series('router', [5.0] * 50) + series('cloudflare', [None, 500, 9] * 20) + series('google', [600, None, 10] * 20)))
assert any('INTERNET is slow' in n for n in n2), n2
# only one internet target bad -> probably that site
n3 = nm.diagnose(nm.summarize(series('router', [5.0] * 50) + series('cloudflare', [None, 500, 9] * 20) + series('google', [10.0] * 60)))
assert any('probably that site' in n for n in n3) and not any('INTERNET is slow' in n for n in n3)
# all good
assert 'Nothing bad recorded' in nm.diagnose(nm.summarize(series('router', [5.0] * 50) + series('cloudflare', [20.0] * 50)))[0]
# percentile helper
assert nm.pct([1, 2, 3, 4, 100], 95) == 100 and nm.pct([], 95) is None

# simulated run: fake probes, stop after 3 rounds, then read the CSV with report
d = tempfile.mkdtemp(); calls = {'sleep': 0}
nm.ping_once = lambda host, timeout_s=2: None if host == '192.168.1.50' else 7.5
nm.dns_ms = lambda name=None: 12.0; nm.web_ms = lambda url=None: 80.0; nm.speed_mbps = lambda url=None: 95.0
def fake_sleep(s):
    calls['sleep'] += 1
    if calls['sleep'] >= 3: raise KeyboardInterrupt()
nm.time.sleep = fake_sleep
args = argparse.Namespace(sat=['Basement=192.168.1.50'], interval=0.01, slow_every=1, speed=True, dir=d)
buf = io.StringIO()
try:
    with contextlib.redirect_stdout(buf): nm.run(args)
except KeyboardInterrupt:
    pass
files = [f for f in os.listdir(d) if f.startswith('net_monitor_') and f.endswith('.csv')]
assert len(files) == 1
rows_csv = list(csv.DictReader(open(os.path.join(d, files[0]))))
assert rows_csv[0].keys() >= {'time', 'target', 'kind', 'value'}
assert {r['target'] for r in rows_csv if r['kind'] == 'ping_ms'} == {'router', 'sat_Basement', 'qnap', 'cloudflare', 'google'}
assert all(r['value'] == '' for r in rows_csv if r['target'] == 'sat_Basement' and r['kind'] == 'ping_ms') and 'NO REPLY' in buf.getvalue()
assert any(r['kind'] == 'down_mbps' and r['value'] == '95.0' for r in rows_csv)
out = io.StringIO()
with contextlib.redirect_stdout(out): nm.report(argparse.Namespace(dir=d, hours=24, interval=5))
text = out.getvalue()
assert 'sat_Basement' in text and 'Basement satellite is a weak link' in text and 'DNS lookup ms' in text and 'Download Mbps' in text and 'Worst hours' in text, text
print('ok')
