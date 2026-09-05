# launchd agents for the viz server

Two jobs, copied from `~/Library/LaunchAgents` on 2026-08-17 so they can be
remade if the installed copies are lost — which is exactly what happened to
`com.rascaltwo.viz-server-restart.plist`, whose only copy was the installed one.

| Job | What it does |
|---|---|
| `com.rascaltwo.viz-server` | keeps `bun server.ts` alive (`KeepAlive`, `RunAtLoad`) |
| `com.rascaltwo.viz-server-restart` | `launchctl kickstart -k`s the server once a night at 04:00 |

Install:

```sh
sed -i '' "s|/Users/YOUR-USER|$HOME|g" launchd/com.rascaltwo.viz-server*.plist
cp launchd/com.rascaltwo.viz-server*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rascaltwo.viz-server.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rascaltwo.viz-server-restart.plist
```

The two absolute paths in the plists are checked in as `/Users/YOUR-USER/...` — launchd
does **not** expand `$HOME`, so they have to be real paths on disk, and a real one here
would be a username published to a public repo. Hence the `sed` above.

**`com.rascaltwo.viz-server`'s `WorkingDirectory` was stale — fixed 2026-08-17.** It
pointed at `explorables/skills/viz`; the skill now lives at `ai-setup/skills/viz`. The
symptom was `launchctl list` showing no PID and exit status **78** (`EX_CONFIG`) — while
the 04:00 restart job dutifully kickstarted a job that could not start, so the server had
in fact been running unmanaged (a stray process from a manual start) rather than under
launchd. Both the installed plist and this copy now carry the corrected path.

`com.rascaltwo.viz-server-restart.plist` was reconstructed from launchd's in-memory copy
(`launchctl print gui/501/com.rascaltwo.viz-server-restart`); `RunAtLoad` could not be
recovered from that dump and is deliberately absent. See the comment in the file.
