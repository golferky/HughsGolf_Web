# Network monitor (`net_monitor.py`)

Finds out **where** the home network gets slow: each Orbi satellite, the router, the QNAP, or the internet itself.
It pings each of them every 5 seconds, times a DNS lookup and a small HTTPS request once a minute, and logs everything to CSV files.
Only Python 3 is needed; nothing to install.

## 1. Find your satellites' addresses
Orbi app (or `orbilogin.com` / `192.168.1.1`) -> **Attached devices**: each satellite is listed with its IP address (for example `192.168.1.5x`).
Or on the Mac: `arp -a` and look for the Netgear devices.

## 2. Run it (leave it going for a day or two)
On the **Mac mini** (this measures what a Wi-Fi computer sees):
```
cd ~/HughsGolf_Web
python3 tools/net_monitor.py run --sat Basement=192.168.1.XX --sat Upstairs=192.168.1.YY
```
Better still, on the **QNAP** (cabled, so the monitor is not the weak link): copy `net_monitor.py` there and run it with the QNAP's Python,
`/share/CACHEDEV1_DATA/.qpkg/Python3/opt/python3/bin/python3 net_monitor.py run --sat ... &`.
Add `--speed` to also log a ~3 MB download every 10 minutes (shows a busy or capped upload/download link).
Leave the Terminal window open (or use `nohup ... &`). Stop with Ctrl-C. Slow or missing replies are also printed as they happen.
Results go to `~/net_monitor/net_monitor_YYYYMMDD.csv`.

## 3. Read the results
```
python3 tools/net_monitor.py report            # last 24 hours
python3 tools/net_monitor.py report --hours 6
```
You get, per target: loss %, average / 95th-percentile / worst ms, number of spikes (100 ms or more) and the longest stretch with no reply,
plus a plain-English reading and the worst hours of the day. For example: *the Basement satellite is a weak link (router is fine, this
satellite is not)* means move it, or run an Ethernet cable to it; *local network fine but the internet is slow* means the modem or the provider.
