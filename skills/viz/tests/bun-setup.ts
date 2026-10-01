// Preloaded by bunfig.toml. Bun's default per-test timeout is 5s, and bunfig has no key to change it
// (a `timeout =` there is silently ignored — measured), so it is set here. Most of this suite drives
// headless Chrome through the real CLI; on a machine running other sessions' suites (load average
// 190 was seen) a launch alone outlives 5s, and the pre-commit hook then blocks on a timeout that
// says nothing about the code. A test that hangs still fails: after three minutes, not five seconds.
import { setDefaultTimeout } from "bun:test";

setDefaultTimeout(180_000);
