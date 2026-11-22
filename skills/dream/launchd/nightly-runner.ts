// dream nightly runner: the TCC shim launchd starts instead of nightly.sh. See com.rascaltwo.dream.plist.
//
// The dream skill lives under ~/Desktop, which macOS protects with TCC. A LaunchAgent's program is its own
// responsible process, and /bin/bash holds no Desktop grant, so launchd running nightly.sh directly died
// with EPERM (exit 126) for 21 nights. node, once granted Desktop access, passes that grant to its children.
import { spawnSync } from "node:child_process";
import path from "node:path";

const DREAM = path.resolve(import.meta.dirname, "..");
const r = spawnSync("/bin/bash", [path.join(DREAM, "scripts/nightly.sh")], { cwd: DREAM, stdio: "inherit" });
process.exit(r.status ?? 1);
