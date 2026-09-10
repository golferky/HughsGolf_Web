#!/usr/bin/env python3
import os

plist = """\
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.garyscudder.hughsgolfsandbox</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>/Users/garyscudder/Documents/Codex/2026-06-19/g/sandbox/HughsGolf_Web_sandbox/app.py</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/garyscudder/Documents/Codex/2026-06-19/g/sandbox/HughsGolf_Web_sandbox</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>StandardOutPath</key>
    <string>/Users/garyscudder/Documents/Codex/2026-06-19/g/sandbox/HughsGolf_Web_sandbox/hughsgolfsandbox.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/garyscudder/Documents/Codex/2026-06-19/g/sandbox/HughsGolf_Web_sandbox/hughsgolfsandbox.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
"""

dest = os.path.expanduser("~/Library/LaunchAgents/com.garyscudder.hughsgolfsandbox.plist")
with open(dest, "w") as f:
    f.write(plist)
print(f"Written to {dest}")
