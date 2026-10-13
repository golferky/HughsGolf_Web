#!/usr/bin/env python3
"""
net_monitor.py - watch the home network and show WHERE it gets slow.

It pings every point on the path once every few seconds (router, each Orbi satellite, the QNAP, and the internet), now and then times a
DNS lookup and a small web download, and writes everything to a CSV. Later, `report` tells you which hop is the weak one.

  python3 net_monitor.py run    --sat Basement=192.168.1.50 --sat Upstairs=192.168.1.51      (leave it running)
  python3 net_monitor.py report                                                               (read the results, newest 24 h)

Needs only Python 3 (nothing to install). Best run on something that is cabled to the router (the QNAP), so the monitor itself is not
the weak Wi-Fi link; the Mac mini on Wi-Fi works too, it then measures what a Wi-Fi computer sees.
"""
import argparse, csv, datetime, glob, os, re, shutil, socket, statistics, subprocess, sys, threading, time, urllib.request

DEFAULT_TARGETS = [('router', '192.168.1.1'), ('qnap', '192.168.1.176'), ('cloudflare', '1.1.1.1'), ('google', '8.8.8.8')]
SLOW_MS, VERY_SLOW_MS = 100, 300          # a reply slower than this counts as a spike
DNS_NAME = 'hughsgolf.duckdns.org'
WEB_URL = 'https://www.cloudflare.com/cdn-cgi/trace'                    # tiny page: measures a real HTTPS round trip
SPEED_URL = 'https://speed.cloudflare.com/__down?bytes=3000000'         # ~3 MB: measures download speed (--speed)


def parse_ping_ms(text):
    m = re.search(r'time[=<]\s*([\d.]+)\s*ms', text or '')
    return float(m.group(1)) if m else None


def ping_once(host, timeout_s=2):
    wait = str(int(timeout_s * 1000)) if sys.platform == 'darwin' else str(max(1, int(timeout_s)))      # macOS: ms, Linux/QNAP: seconds
    try:
        out = subprocess.run(['ping', '-c', '1', '-W', wait, host], capture_output=True, text=True, timeout=timeout_s + 3).stdout
    except Exception:
        return None
    return parse_ping_ms(out)


def dns_ms(name=DNS_NAME):
    t = time.time()
    try:
        socket.getaddrinfo(name, 80)
        return (time.time() - t) * 1000
    except Exception:
        return None


def web_ms(url=WEB_URL):
    t = time.time()
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            r.read(2048)
        return (time.time() - t) * 1000
    except Exception:
        return None


def speed_mbps(url=SPEED_URL):
    t = time.time()
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            n = len(r.read())
        return n * 8 / 1e6 / max(time.time() - t, 0.001)
    except Exception:
        return None


# ── running ──────────────────────────────────────────────────────────────────
def run(args):
    if not shutil.which('ping'):
        sys.exit('This computer has no `ping` command, so the monitor cannot measure anything here. Run it on the Mac or the QNAP.')
    targets = list(DEFAULT_TARGETS)
    for s in args.sat or []:
        name, _, ip = s.partition('=')
        if not ip:
            sys.exit(f'--sat needs NAME=IP, got {s!r}')
        targets.insert(1, ('sat_' + name, ip))
    os.makedirs(args.dir, exist_ok=True)
    lock = threading.Lock()
    print(f'Monitoring {", ".join(n + "=" + h for n, h in targets)} every {args.interval}s -> {args.dir}   (Ctrl-C to stop)')
    n = 0
    while True:
        started = time.time()
        stamp = datetime.datetime.now().isoformat(timespec='seconds')
        rows = []

        def probe(kind, name, fn, *a):
            v = fn(*a)
            with lock:
                rows.append((stamp, name, kind, '' if v is None else f'{v:.1f}'))
                if v is None or (kind == 'ping_ms' and v >= SLOW_MS):
                    print(f'{stamp}  {name:<14} {kind:<8} ' + ('NO REPLY' if v is None else f'{v:.0f} ms (slow)'))

        jobs = [threading.Thread(target=probe, args=('ping_ms', name, ping_once, host)) for name, host in targets]
        if n % args.slow_every == 0:
            jobs += [threading.Thread(target=probe, args=('dns_ms', DNS_NAME, dns_ms)), threading.Thread(target=probe, args=('web_ms', 'internet_https', web_ms))]
        if args.speed and n % (args.slow_every * 10) == 0:
            jobs.append(threading.Thread(target=probe, args=('down_mbps', 'internet_speed', speed_mbps)))
        for j in jobs: j.start()
        for j in jobs: j.join()
        path = os.path.join(args.dir, f'net_monitor_{datetime.date.today():%Y%m%d}.csv')
        new = not os.path.exists(path)
        with open(path, 'a', newline='') as f:
            w = csv.writer(f)
            if new: w.writerow(['time', 'target', 'kind', 'value'])
            w.writerows(rows)
        n += 1
        time.sleep(max(0, args.interval - (time.time() - started)))


# ── reporting ────────────────────────────────────────────────────────────────
def load_rows(paths, since=None):
    out = []
    for p in paths:
        with open(p, newline='') as f:
            for r in csv.DictReader(f):
                t = datetime.datetime.fromisoformat(r['time'])
                if since and t < since: continue
                out.append((t, r['target'], r['kind'], float(r['value']) if r['value'] != '' else None))
    return out


def pct(vals, p):
    if not vals: return None
    s = sorted(vals); return s[min(len(s) - 1, int(round(p / 100 * (len(s) - 1))))]


def summarize(rows, interval=5):
    """Per ping target: samples, loss %, avg/p95/max ms, spikes, and the longest run of missed replies (seconds)."""
    by = {}
    for t, name, kind, v in sorted(rows, key=lambda r: r[0]):
        if kind == 'ping_ms': by.setdefault(name, []).append((t, v))
    out = {}
    for name, series in by.items():
        ok = [v for _, v in series if v is not None]
        longest = run_len = 0
        for _, v in series:
            run_len = run_len + 1 if v is None else 0
            longest = max(longest, run_len)
        out[name] = dict(n=len(series), loss=100.0 * (len(series) - len(ok)) / len(series), avg=statistics.mean(ok) if ok else None, p95=pct(ok, 95),
                         max=max(ok) if ok else None, spikes=sum(1 for v in ok if v >= SLOW_MS), outage_s=longest * interval)
    return out


def diagnose(summary):
    """Plain-English reading of the summary."""
    bad = lambda s: s and (s['loss'] >= 2 or (s['p95'] or 0) >= SLOW_MS)
    router = summary.get('router'); sats = {k: v for k, v in summary.items() if k.startswith('sat_')}
    net = [summary[k] for k in ('cloudflare', 'google') if k in summary]
    notes = []
    if bad(router):
        notes.append('The ROUTER itself is slow or dropping replies: Wi-Fi congestion/interference, or the router needs attention.')
    for k, s in sats.items():
        if bad(s) and not bad(router):
            notes.append(f'{k[4:]} satellite is a weak link (router is fine, this satellite is not): move it closer, or give it an Ethernet backhaul.')
    if not bad(router) and net and all(bad(s) for s in net):
        notes.append('Local network is fine but the INTERNET is slow or dropping: the modem or your internet provider (check the modem, call the provider with these numbers).')
    elif not bad(router) and any(bad(s) for s in net):
        notes.append('One internet target is bad and the other is fine: that is probably that site, not your connection.')
    if 'qnap' in summary and bad(summary['qnap']) and not bad(router):
        notes.append('The QNAP is slow while the router is fine: the QNAP cable or the satellite it is plugged into.')
    return notes or ['Nothing bad recorded in this period. If it still felt slow, it may be bandwidth (a busy upload link) rather than latency: run with --speed.']


def report(args):
    paths = sorted(glob.glob(os.path.join(args.dir, 'net_monitor_*.csv')))
    if not paths: sys.exit(f'No net_monitor_*.csv files in {args.dir}')
    since = datetime.datetime.now() - datetime.timedelta(hours=args.hours)
    rows = load_rows(paths, since)
    summ = summarize(rows, args.interval)
    print(f'Last {args.hours} h, {len(rows)} measurements\n')
    print(f'{"target":<16}{"samples":>8}{"loss %":>8}{"avg ms":>8}{"p95 ms":>8}{"max ms":>8}{"spikes":>8}{"longest gap":>13}')
    f = lambda v: '-' if v is None else f'{v:.0f}'
    for name, s in sorted(summ.items()):
        print(f'{name:<16}{s["n"]:>8}{s["loss"]:>8.1f}{f(s["avg"]):>8}{f(s["p95"]):>8}{f(s["max"]):>8}{s["spikes"]:>8}{s["outage_s"]:>11}s')
    for kind, label in (('dns_ms', 'DNS lookup ms'), ('web_ms', 'HTTPS round trip ms'), ('down_mbps', 'Download Mbps')):
        v = [r[3] for r in rows if r[2] == kind and r[3] is not None]; fails = sum(1 for r in rows if r[2] == kind and r[3] is None)
        if v or fails: print(f'\n{label}: {len(v)} ok, {fails} failed' + (f', median {statistics.median(v):.0f}, worst {max(v):.0f}, best {min(v):.0f}' if v else ''))
    print('\nReading:'); [print(' -', n) for n in diagnose(summ)]
    # worst hours: where the pain clusters
    hourly = {}
    for t, name, kind, v in rows:
        if kind == 'ping_ms': hourly.setdefault(t.strftime('%a %H:00'), [0, 0])[0 if v is not None and v < SLOW_MS else 1] += 1
    worst = sorted(hourly.items(), key=lambda kv: -kv[1][1] / max(1, sum(kv[1])))[:3]
    if worst: print('\nWorst hours (share of slow or missing replies): ' + ', '.join(f'{h} {100 * b // max(1, a + b)}%' for h, (a, b) in worst))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('run'); r.add_argument('--sat', action='append', help='satellite as NAME=IP (repeat for each)'); r.add_argument('--interval', type=float, default=5)
    r.add_argument('--slow-every', type=int, default=12, help='DNS + HTTPS check every N rounds (default 12 = once a minute)'); r.add_argument('--speed', action='store_true', help='also a ~3 MB download every 10 minutes')
    r.add_argument('--dir', default=os.path.expanduser('~/net_monitor')); r.set_defaults(fn=run)
    q = sub.add_parser('report'); q.add_argument('--hours', type=float, default=24); q.add_argument('--interval', type=float, default=5)
    q.add_argument('--dir', default=os.path.expanduser('~/net_monitor')); q.set_defaults(fn=report)
    a = p.parse_args(); a.fn(a)


if __name__ == '__main__':
    try: main()
    except KeyboardInterrupt: print('\nstopped')
