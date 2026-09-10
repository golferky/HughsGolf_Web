#!/usr/bin/env python3
# Run this once to install the DuckDNS auto-update agent on the Mac mini.
# Edit PUT_TOKEN_HERE below before running.

import os

TOKEN = "8127980c-5c55-4a84-847a-1e4fe2cbd57b"

plist = f"""\
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.garyscudder.duckdns</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/curl</string>
        <string>-s</string>
        <string>https://www.duckdns.org/update?domains=hughsgolf,hughsgolf-sandbox&amp;token={TOKEN}&amp;ip=</string>
    </array>
    <key>StartInterval</key>
    <integer>300</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/garyscudder/Library/Logs/duckdns.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/garyscudder/Library/Logs/duckdns.log</string>
</dict>
</plist>
"""

dest = os.path.expanduser("~/Library/LaunchAgents/com.garyscudder.duckdns.plist")
with open(dest, "w") as f:
    f.write(plist)
print(f"Written to {dest}")
print("Now run:  launchctl load ~/Library/LaunchAgents/com.garyscudder.duckdns.plist")
