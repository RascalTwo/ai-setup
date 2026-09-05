// fleet-console backend.
//
// Two channels, deliberately separate:
//
//   /state    — the deterministic status panel. No LLM in this path, ever.
//               `fleet` already returns exactly what the panel needs, so this
//               handler relays it and nothing more. The moment it starts
//               *interpreting* session state, "status is a template, not a
//               thought" is gone — that reasoning belongs to the manager.
//
//   /manager, /say, /reply, /spawn — the conversation channel. The app is a
//               remote head for one long-lived Claude Code session running
//               /fleet. It writes with `herdr agent prompt` and reads the
//               session's own Stop hook. No terminal is ever parsed.

const HOME = process.env.HOME!;
const FLEET = `${HOME}/.claude/skills/fleet/fleet`;
const STATE = `${HOME}/.claude/fleet/state`;
const SPEECH = `${HOME}/.claude/fleet/speech`;

// The pane the app owns. Frozen at tab-creation time by herdr, so it is a
// stable handle even as the session's title drifts with whatever it's doing.
const MANAGER_LABEL = "fleet-manager";

// The viz server is started by launchd, which hands it a minimal PATH that does
// NOT include Homebrew. `fleet` shells out to `herdr`; without it on PATH the
// script prints `[]` and **exits 0**, so a missing binary is indistinguishable
// from a genuinely quiet fleet. That is the one lie this app must never tell.
const PATH = ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH, "/usr/bin", "/bin"]
  .filter(Boolean).join(":");

async function sh(cmd: string[]) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, PATH } });
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code: await p.exited, out, err };
}

const bad = (error: string, status = 500) => Response.json({ error }, { status });

// `fleet` makes several herdr socket calls per run, and the socket serialises
// them. One caller is ~0.4s; several concurrent callers queue against each other
// and it degrades badly — measured at 13-16s with a few pollers running, which
// blew past the frontend's 8s timeout and made the page look broken.
//
// Every open tab polls every 5s, and each poll used to spawn its own `fleet`.
// So: one spawn per window, shared by everyone. Concurrent callers await the
// same in-flight promise rather than starting their own.
//
// This lives on globalThis, not in a module variable, because the viz server
// re-imports api.ts on every request (cache-busted) — module state does not
// survive between calls, but the realm does.
const CACHE_MS = 3000;
const g = globalThis as any;

function refresh(): Promise<any[]> {
  if (g.__fleetInflight) return g.__fleetInflight;
  g.__fleetInflight = (async () => {
    try {
      const { code, out, err } = await sh([FLEET]);
      if (code !== 0) throw new Error(err.trim() || `fleet exited ${code}`);
      const parsed = JSON.parse(out) as any[];
      g.__fleetPanes = parsed;
      g.__fleetAt = Date.now();
      return parsed;
    } finally { g.__fleetInflight = null; }
  })();
  return g.__fleetInflight;
}

// Stale-while-revalidate. A `fleet` spawn measured 4-16s from inside the viz
// server while the identical spawn takes 0.4s from a fresh Bun process or a
// shell — and in the same handler `/bin/echo` returned in 3ms, so the event
// loop is not blocked and the cause is not understood. Rather than have every
// poll wait on it, serve what we have and refresh behind the request: the only
// caller that ever waits is the very first one after a restart.
//
// Staleness is bounded by CACHE_MS and the page shows its own "N ago" clock, so
// a snapshot a few seconds old is visible as such rather than pretending to be
// live.
async function panes(): Promise<any[]> {
  if (!Bun.which("herdr", { PATH })) throw new Error("herdr is not on PATH — an empty fleet here would be a lie");
  const have = g.__fleetPanes !== undefined;
  const fresh = have && Date.now() - g.__fleetAt < CACHE_MS;
  if (fresh) return g.__fleetPanes;
  if (have) { refresh().catch(() => {}); return g.__fleetPanes; }
  return refresh();
}

/** The manager's last turn, straight from its own Stop hook. */
async function lastReply(session: string) {
  const f = Bun.file(`${STATE}/${session}.Stop.json`);
  if (!(await f.exists())) return null;
  const at = f.lastModified;
  const text = JSON.parse(await f.text()).last_assistant_message ?? "";

  // Optional overlay: a short version written for being read aloud. The Stop
  // file is hook-written and cannot be forgotten; this one is written by the
  // manager and can be, so it is matched on freshness and never required.
  // Missing or stale => the frontend speaks the opening of `text` instead.
  let speech: string | null = null;
  const sf = Bun.file(`${SPEECH}/${session}.json`);
  if (await sf.exists() && sf.lastModified >= at - 30_000) {
    speech = JSON.parse(await sf.text()).speech ?? null;
  }
  // A report is never shorter than its own summary. When it is, the manager
  // narrated the plumbing ("spoken version sent") after calling say-aloud, and
  // the Stop hook captured that acknowledgement instead of the report. Telling
  // it not to doesn't hold reliably, so the console repairs it: show the spoken
  // text rather than a written channel that says nothing.
  if (speech && text.trim().length < speech.trim().length) return { at, text: speech, speech };
  return { at, text, speech };
}

async function findManager() {
  const all = await panes();
  const m = all.find((p) => p.label === MANAGER_LABEL);
  if (!m) return { found: false as const };
  return { found: true as const, ...m, reply: await lastReply(m.session) };
}

export default {
  "/state": async () => {
    try {
      // `fleet` drops $HERDR_PANE_ID, which self-excludes the manager when the
      // manager runs it — but this server runs outside any pane, so it would
      // otherwise list its own brain as a work session and inflate the counts.
      // The Manager tab already shows that session's health.
      const all = (await panes()).filter((p) => p.label !== MANAGER_LABEL);
      return Response.json({ panes: all, at: Date.now() });
    } catch (e: any) { return bad(e.message); }
  },

  // One session in full. `fleet` truncates last_message to 400 chars — enough to
  // say what a session is asking, not enough to answer it — so the untruncated
  // text is read straight from the Stop file.
  "/session": async (req: Request) => {
    try {
      const pane = new URL(req.url).searchParams.get("pane");
      const p = (await panes()).find((x) => x.pane === pane);
      if (!p) return bad("that pane is gone", 404);
      const reply = await lastReply(p.session);
      return Response.json({ ...p, text: reply?.text ?? "", at: reply?.at ?? 0 });
    } catch (e: any) { return bad(e.message); }
  },

  // Send to a WORKER session (not the manager). `expect` is the Stop mtime the
  // UI was rendered against: if the session has taken a turn since, the thing
  // you were answering is gone, and a bare "y" typed into a session running
  // --dangerously-skip-permissions becomes a new instruction rather than an
  // approval. Check-then-send — overridable, because sometimes you mean it.
  "/tell": async (req: Request) => {
    try {
      const { pane, text, expect, force } = await req.json();
      if (!pane || !text?.trim()) return bad("pane and text are required", 400);

      const p = (await panes()).find((x) => x.pane === pane);
      if (!p) return bad("that pane is gone", 404);
      if (p.focused) return bad("you are in that pane right now — type there instead", 409);

      const now = (await lastReply(p.session))?.at ?? 0;
      if (!force && expect && now !== expect) {
        return Response.json({ error: "that session moved on since you looked", moved: true, at: now }, { status: 409 });
      }
      const { code, err } = await sh(["herdr", "agent", "prompt", pane, text]);
      if (code !== 0) return bad(err.trim() || `herdr agent prompt exited ${code}`);
      return Response.json({ ok: true, since: now });
    } catch (e: any) { return bad(e.message); }
  },

  "/manager": async () => {
    try {
      return Response.json(await findManager());
    } catch (e: any) { return bad(e.message); }
  },

  // Send text to the manager. Returns the Stop mtime observed *before* writing,
  // so the frontend can poll for it to advance — which is the only honest proof
  // the session actually took a turn on the input, as opposed to herdr merely
  // having typed it somewhere.
  "/say": async (req: Request) => {
    try {
      const { text } = await req.json();
      if (!text?.trim()) return bad("empty message", 400);

      const m = await findManager();
      if (!m.found) return bad("no manager pane — spawn one first", 409);

      // Hard rule: never write to a pane whose `focused` is true. That is the
      // user, in that pane, right now — two writers on one stdin, no lock.
      // Enforced here in code rather than trusted to a prompt.
      if (m.focused) return bad("you are in that pane right now — type there instead", 409);

      const since = m.reply?.at ?? 0;
      const { code, err } = await sh(["herdr", "agent", "prompt", m.pane, text]);
      if (code !== 0) return bad(err.trim() || `herdr agent prompt exited ${code}`);
      return Response.json({ ok: true, since, pane: m.pane });
    } catch (e: any) { return bad(e.message); }
  },

  // Poll for a turn newer than `since`. Also returns the raw pane tail so a
  // message that never lands is *visibly* stuck rather than silently lost —
  // the phone can't walk over and look at the pane, so the pane comes here.
  "/reply": async (req: Request) => {
    try {
      const since = Number(new URL(req.url).searchParams.get("since") ?? 0);
      const m = await findManager();
      if (!m.found) return Response.json({ found: false });
      const fresh = m.reply && m.reply.at > since ? m.reply : null;
      return Response.json({ found: true, status: m.herdr_status, signal: m.signal, reply: fresh });
    } catch (e: any) { return bad(e.message); }
  },

  // Raw terminal for any pane; defaults to the manager. This is the escape hatch
  // for a phone — you can't walk over and look, so the pane comes to you.
  "/pane": async (req: Request) => {
    try {
      let pane = new URL(req.url).searchParams.get("pane");
      if (!pane) {
        const m = await findManager();
        if (!m.found) return bad("no manager pane", 409);
        pane = m.pane;
      }
      const { code, out, err } = await sh(["herdr", "pane", "read", pane]);
      if (code !== 0) return bad(err.trim() || `herdr pane read exited ${code}`);
      return Response.json({ tail: out.split("\n").slice(-24).join("\n") });
    } catch (e: any) { return bad(e.message); }
  },

  // Close the manager. This is the only piece of the console that costs anything
  // to leave running — the viz server and the tailscale routes are free, and an
  // idle Claude session burns nothing until it takes a turn. The app respawns on
  // demand, so stopping it is cheap and reversible, not a teardown.
  "/stop": async () => {
    try {
      const m = await findManager();
      if (!m.found) return Response.json({ ok: true, alreadyStopped: true });
      const { out } = await sh(["herdr", "tab", "list"]);
      const tab = JSON.parse(out)?.result?.tabs?.find((t: any) => t.label === MANAGER_LABEL)?.tab_id;
      if (!tab) return bad("found the manager pane but not its tab");
      const closed = await sh(["herdr", "tab", "close", tab]);
      if (closed.code !== 0) return bad(closed.err.trim() || "herdr tab close failed");
      return Response.json({ ok: true, wasWorking: m.herdr_status === "working" });
    } catch (e: any) { return bad(e.message); }
  },

  // Adopt-or-spawn. The recipe (and its mandatory read-back) is lifted from the
  // fleet skill: `agent start` reporting interactive_ready and `agent prompt`
  // reporting agent_prompted both mean herdr succeeded, NOT that the agent
  // received anything. Prompt too early and the keystrokes vanish while every
  // call reports success. `pane read` is the only honest confirmation.
  "/spawn": async () => {
    try {
      const existing = await findManager();
      if (existing.found) return Response.json({ ok: true, adopted: true, pane: existing.pane });

      const created = await sh(["herdr", "tab", "create", "--no-focus", "--cwd", HOME, "--label", MANAGER_LABEL]);
      if (created.code !== 0) return bad(created.err.trim() || "herdr tab create failed");
      const root = JSON.parse(created.out)?.result?.root_pane;
      const pane = root?.pane_id, tab = root?.tab_id;
      if (!pane) return bad(`could not read pane id from: ${created.out.slice(0, 200)}`);

      // A freshly created tab is not immediately an available shell — `agent
      // start` fails with `agent_pane_busy` if called straight after `tab
      // create`. Nothing in the API announces readiness, so poll for it.
      let started: Awaited<ReturnType<typeof sh>> | null = null;
      for (let i = 0; i < 12; i++) {
        started = await sh(["herdr", "agent", "start", MANAGER_LABEL, "--kind", "claude",
                            "--pane", pane, "--", "--dangerously-skip-permissions"]);
        if (started.code === 0 && !/agent_pane_busy/.test(started.out + started.err)) break;
        await Bun.sleep(1000);
      }
      if (!started || started.code !== 0 || /agent_pane_busy/.test(started.out + started.err)) {
        // Don't leak a dead tab on every failed attempt — a spawn button that
        // litters is worse than one that just fails.
        if (tab) await sh(["herdr", "tab", "close", tab]);
        return bad(started?.err.trim() || started?.out.trim() || "herdr agent start never became ready");
      }

      await Bun.sleep(5000);
      await sh(["herdr", "agent", "prompt", pane, "/fleet"]);
      await Bun.sleep(5000);
      const { out: tail } = await sh(["herdr", "pane", "read", pane]);

      // A pane showing 0% context and the default title has never had a turn.
      const landed = !/0\/1\.0M \(0%\)/.test(tail);
      return Response.json({ ok: true, adopted: false, pane, landed, tail: tail.split("\n").slice(-16).join("\n") });
    } catch (e: any) { return bad(e.message); }
  },
};
