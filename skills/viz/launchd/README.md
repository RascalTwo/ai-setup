# launchd agents for the viz server

Two jobs, copied from `~/Library/LaunchAgents` on 2026-08-17 so they can be
remade if the installed copies are lost — which is exactly what happened to
`com.rascaltwo.viz-server-restart.plist`, whose only copy was the installed one.

| Job | What it does |
|---|---|
| `com.rascaltwo.viz-server` | keeps `node server.ts` alive (`KeepAlive`, `RunAtLoad`) |
| `com.rascaltwo.viz-server-restart` | `launchctl kickstart -k`s the server once a night at 04:00 |

Install:

```sh
sed -i '' "s|/Users/YOUR-USER|$HOME|g" launchd/com.rascaltwo.viz-server*.plist
mkdir -p ~/.agents/state/viz-server   # the logs; launchd won't create the dir
cp launchd/com.rascaltwo.viz-server*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rascaltwo.viz-server.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rascaltwo.viz-server-restart.plist
```

The absolute paths in the plists are checked in as `/Users/YOUR-USER/...` — launchd
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

**A launchd job's PATH is `/usr/bin:/bin:/usr/sbin:/sbin` — fixed 2026-09-05.** Nothing
from a login shell's PATH, so while the job itself starts fine (`ProgramArguments` is an
absolute path), every child the server spawned by *name* died with `Executable not found
in $PATH`. That silently broke all of the self-portrait's writes — `manage.ts`
(move/mirror/vendor) and the live preview — from 2026-08-17, when the job started actually
running, since a manually started server had inherited a login shell's PATH. `npx staticrypt`
inside the publish build failed the same way one layer down.

The fix is in the code, not here: the spawns re-enter `process.execPath` (the running node
binary) instead of looking up `node` on PATH. Adding `EnvironmentVariables` to the plist
would have worked too, but only for a launchd start; `process.execPath` is correct however
the server was launched. If you add a job that shells out to something outside `/usr/bin`,
expect this and give it an absolute path.

**Backends that shell out by NAME (podman, gh, kubectl, aws, claude) — fixed 2026-10-03.** Same
cause, one layer further out: a backend's `spawn("podman", ...)` died with `Executable not
found in $PATH`, and the route answered 500. `lib/server/config.ts` now appends the usual tool
dirs (`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/podman/bin`) to
`process.env.PATH`; `node:child_process` spawns inherit it. Still no plist change: it takes
effect on the next server restart, however the server is launched. A tool installed
somewhere else still needs an absolute path.
