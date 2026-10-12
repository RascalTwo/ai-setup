import { arrowMarkers, connect, labelBox, saveHash, loadHash, vizAudit, esc } from "@viz/kit";
import { entries, groups, posterHref, type Entry } from "./catalog.js";

const colors = {
  repo: "#84dcc6",
  install: "#f6bd60",
  agent: "#70a1ff",
  skill: "#b28dff",
  violet: "#b28dff",
  sauce: "#ff6b6b",
  model: "#7bd88f",
  terminal: "#e08bd8",
  upkeep: "#5fd3f3",
};

interface TourNode {
  id: string;
  index: string;
  tag: string;
  title: string;
  color: string;
  cls: string;
  x: number;
  y: number;
  w: number;
  h: number;
  copy: string;
  bullets: string[];
  /** "Go deeper" chips under the bullets: a poster page or an anchor on this page. */
  links?: [label: string, href: string][];
}

const nodes: TourNode[] = [
  {
    id: "repo",
    index: "01",
    tag: "source of truth",
    title: "Public core repo",
    color: colors.repo,
    cls: "main-only",
    x: 70,
    y: 150,
    w: 154,
    h: 100,
    copy: "The `ai-setup` repo is the public, borrowable core. It keeps the agent rules, owned skills, owned tools, external skill manifest, settings, and installer in one place so the live setup does not drift from source control.",
    bullets: [
      "`AGENTS.md` is the canonical rules file; `CLAUDE.md` is a symlink to it, so Claude Code reads the same bytes.",
      "`skills/` holds the 45 owned skills, `tools/` the eight owned tools, `subagents/` the seven reviewers, `settings/` the tracked config for Claude Code, Codex and herdr.",
      "Every skill and tool declares itself in frontmatter; state lives at `~/.agents/state/<name>/`, never in `~/.claude`.",
      "Each skill and tool also has a poster page, linked from the index below.",
    ],
    links: [["Everything in here", "#indexTitle"]],
  },
  {
    id: "installer",
    index: "02",
    tag: "bootstrap",
    title: "Deterministic installer",
    color: colors.install,
    cls: "main-only",
    x: 290,
    y: 150,
    w: 154,
    h: 100,
    copy: "`install.ts` is the small boring engine. It needs only Bun, is idempotent, refuses to overwrite a real file, repairs stale symlinks (and a moved repo), layers private overlays, and optionally installs third-party skills from a manifest.",
    bullets: [
      "Rules go to `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`; owned skills link into both agents' skill paths.",
      "Two MCP servers are registered with both agents: `basic-memory` and `voicemode`. Codex also gets its preferences and the RTK hook merged into `config.toml`.",
      "The herdr keybindings, the image-viewer plugin and the statusline config are wired in too; anything it cannot find (herdr, chafa, Codex) is skipped, not an error.",
      "`bun install.ts --list` shows every source and its skills, plus any live skill belonging to no source.",
    ],
    links: [
      ["How it gets installed", "#installTitle"],
      ["What it can't do", "#manualTitle"],
      ["One pointer", "#pointerTitle"],
    ],
  },
  {
    id: "agents",
    index: "03",
    tag: "two runtimes",
    title: "Claude Code plus Codex",
    color: colors.agent,
    cls: "main-only",
    x: 510,
    y: 150,
    w: 154,
    h: 100,
    copy: "The setup is agent-agnostic by design, but not pretending the two tools are identical. Claude Code is the main daily driver; Codex is maintained as a parity path and backup with equivalent rules, skills, MCP memory, browser tooling, and settings where possible.",
    bullets: [
      "Manual connector/plugin setup covers browser, desktop, Google, and Atlassian access.",
      "Settings differences are documented instead of mirrored blindly: each agent has its own `settings-map.md`.",
      "The one real asymmetry is delegation: Claude Code has four mechanisms, Codex has subagents only.",
    ],
    links: [
      ["What AGENTS.md does", "#agentsTitle"],
      ["What the installer can't do", "#manualTitle"],
    ],
  },
  {
    id: "skills",
    index: "04",
    tag: "capability layer",
    title: "Skills catalog",
    color: colors.skill,
    cls: "main-only secret-only",
    x: 730,
    y: 150,
    w: 154,
    h: 100,
    copy: "Skills are the main capability layer. The repo owns 45 of them, grouped below by what they are for, and `external-skills.json` reproduces community skills through `npx skills` rather than vendoring them.",
    bullets: [
      "Owned, in seven groups: think and plan, sessions and handoffs, make it visible, media and local AI, browser and workplace, delivery and review, cloud and APIs.",
      "Community set: nine repos, among them the Matt Pocock pipeline skills, ponytail, the LN auditors, Anthropic's document skills, find-skills, STRIDE threat modelling, unslop and anidoodle.",
      "Rarely wanted community skills are demoted through `skillOverrides` in the tracked `settings.json`, so they stay installed without competing for the model's attention.",
      "Private overlays add company or personal skills without publishing them.",
    ],
    links: [
      ["Everything in here", "#indexTitle"],
      ["Skills ecosystem map", "#skillsTitle"],
      ["viz", "../skill-viz/"],
    ],
  },
  {
    id: "subagents",
    index: "05",
    tag: "review team",
    title: "Subagents and Ruler",
    color: colors.violet,
    cls: "main-only secret-only",
    x: 950,
    y: 150,
    w: 154,
    h: 100,
    copy: "Seven reviewer subagents (code, docs-currency, fidelity, QA, reuse, security, test) are authored once in Ruler and committed in Claude and Codex native formats. Install only needs Bun; Ruler is reserved for author-time edits.",
    bullets: [
      "`subagents/.claude/agents/*.md` is read by path, not registered with Claude Code: r2-gauntlet and r2-sdlc start a general-purpose agent on the file, so the reviewers cost no tokens in other sessions.",
      "`subagents/.codex/agents/*.toml` feeds Codex; the installer symlinks only that output into place.",
      "Subagents run on Sonnet by default (`CLAUDE_CODE_SUBAGENT_MODEL` in the tracked settings); the main session runs on Opus.",
    ],
    links: [
      ["r2-sdlc", "../skill-r2-sdlc/"],
      ["r2-gauntlet", "../skill-r2-gauntlet/"],
    ],
  },
  {
    id: "memory",
    index: "06",
    tag: "shared recall",
    title: "Basic-memory first",
    color: colors.model,
    cls: "secret-only",
    x: 950,
    y: 480,
    w: 154,
    h: 100,
    copy: "Persistent notes live in `basic-memory`, not in one agent's proprietary memory feature. The rule is explicit: search memory before guessing about project history or prior setup decisions.",
    bullets: [
      "The installer registers it with both agents — `claude mcp add -s user` for Claude Code, `config.toml` for Codex — so they share one note store.",
      "Write rule: if the work already produces markdown, the knowledge goes there. If nothing is being written down, it goes here. Never both.",
      "Memory becomes the first evidence source before docs, web, or recall.",
    ],
  },
  {
    id: "local-models",
    index: "07",
    tag: "local compute",
    title: "Ollama helpers",
    color: colors.model,
    cls: "secret-only",
    x: 730,
    y: 480,
    w: 154,
    h: 100,
    copy: "Ollama supplies cheap local model calls for tasks where cloud vision or heavyweight model tokens are wasteful. Both agents can use the same daemon once models are pulled.",
    bullets: [
      "`read-image-locally` extracts structured screenshot data first, on `gemma4:e4b`, escalating to `gemma4:12b`, and only then to a native read.",
      "`herdr-autolabel` names terminal tabs from the conversation with `qwen2.5-coder:7b`.",
      "Video is local too: `read-video-locally` turns a screen recording into text, and `transcribe-media` handles speech.",
    ],
    links: [
      ["read-image-locally", "../skill-read-image-locally/"],
      ["read-video-locally", "../skill-read-video-locally/"],
      ["herdr-autolabel", "../tool-herdr-autolabel/"],
    ],
  },
  {
    id: "rules",
    index: "08",
    tag: "operating doctrine",
    title: "Rules that steer behavior",
    color: colors.sauce,
    cls: "secret-only",
    x: 510,
    y: 480,
    w: 154,
    h: 100,
    copy: "`AGENTS.md` carries the behavioral defaults: handle voice homophones, make evidence-based claims, prefer skills and MCP tools, verify before calling it done, route delegation deliberately, and default to the laziest solution that works.",
    bullets: [
      "Voice input means ambiguous commands get confirmed instead of guessed.",
      "Non-obvious claims need evidence, starting with memory.",
      "Every deliverable gets a verification phase proportional to risk, and plans are grilled on a live page before they are final.",
    ],
    links: [
      ["What AGENTS.md does", "#agentsTitle"],
      ["Talking to it", "#voiceTitle"],
      ["How I Use AI", "../how-i-use-ai/"],
    ],
  },
  {
    id: "pipeline",
    index: "09",
    tag: "delivery loop",
    title: "Rascal-2 pipeline",
    color: colors.sauce,
    cls: "secret-only",
    x: 290,
    y: 480,
    w: 154,
    h: 100,
    copy: "The r2-sdlc path turns a rough idea into scoped work, implementation, simplification, and layered review. The gauntlet can run the whole review panel and produce one ranked report.",
    bullets: [
      "Local markdown is the configured issue tracker.",
      "BDD-first tests and documentation philosophy are encoded as skills.",
      "Gauntlet aggregates specialist reviewers instead of reading twenty reports.",
      "`r2-pr` opens the PR the house way, with a `pr-viz` review film and page on top; `pr-split` offers to cut a big branch into reviewable pieces first; `github-attach-media` gets the film and images onto GitHub.",
    ],
    links: [
      ["r2-sdlc", "../skill-r2-sdlc/"],
      ["r2-gauntlet", "../skill-r2-gauntlet/"],
      ["r2-pr", "../skill-r2-pr/"],
      ["pr-viz", "../skill-pr-viz/"],
      ["pr-split", "../skill-pr-split/"],
    ],
  },
  {
    id: "sauce",
    index: "10",
    tag: "tour exit",
    title: "Secret sauce",
    color: colors.install,
    cls: "secret-only",
    x: 70,
    y: 480,
    w: 154,
    h: 100,
    copy: "The leverage comes from making defaults executable: a shared rulebook, installable capability catalog, memory-first evidence, local-model shortcuts, review pipelines, and sessions that hand themselves off, all reachable from both Claude Code and Codex.",
    bullets: [
      "Use Claude Code primarily, keep Codex close enough to substitute.",
      "Keep public core and private overlays separate.",
      "Favor small deterministic install steps over a hidden machine-local setup.",
    ],
    links: [["How I Use AI", "../how-i-use-ai/"]],
  },
  {
    id: "ghostty",
    index: "11",
    tag: "terminal emulator",
    title: "Ghostty",
    color: colors.terminal,
    cls: "main-only",
    x: 70,
    y: 810,
    w: 154,
    h: 100,
    copy: "Ghostty is the emulator underneath the whole setup, configured by file rather than by GUI so it can live in version control like everything else. Two changes matter: restoring an audible bell that agents use to get attention, and a macOS permission fix that is easy to misdiagnose.",
    bullets: [
      "`~/.config/ghostty/config` is the only source — reload from the command palette, no GUI prefs.",
      "`bell-features = system,attention,title` restores the alert Terminal.app gave for free. herdr is what raises it now — not a raw BEL relayed by tmux, which left with tmux.",
      'Full Disk Access on `Ghostty.app` stops the recurring "would like to access data from other apps" prompt — `claude` is a bare CLI, so macOS blames the responsible process, which is the terminal.',
    ],
  },
  {
    id: "herdr",
    index: "12",
    tag: "agent multiplexer",
    title: "herdr",
    color: colors.terminal,
    cls: "main-only",
    x: 290,
    y: 810,
    w: 154,
    h: 100,
    copy: "herdr replaces tmux here. Same muscle memory — a prefix key, workspaces, tabs, panes — but it recognizes coding agents as first-class objects, tracks their lifecycle (`idle`, `working`, `blocked`, `done`), and surfaces which one needs you in a sidebar instead of leaving you to guess.",
    bullets: [
      "Custom bindings are `[[keys.command]]` entries; their `description` shows up in the `prefix+?` help panel.",
      "`kitty_graphics = true` is merged in by `install.ts` and needs a full server restart, not a config reload.",
      "`herdr tab|pane|agent|api …` expose the live session over a socket as JSON — which is what everything in stops 13 and 14 is built on.",
      '`[ui.toast] delivery = "system"` is what actually chimes when an agent wants you. That used to be tmux relaying a terminal bell; herdr raises it directly.',
      'The binary is a small personal fork that adds three sidebar-layout keys; on stock herdr they only produce an "unknown config key" warning.',
    ],
  },
  {
    id: "herdr-tools",
    index: "13",
    tag: "owned glue",
    title: "herdr integrations",
    color: colors.terminal,
    cls: "main-only",
    x: 510,
    y: 810,
    w: 154,
    h: 100,
    copy: "None of these ship with herdr. Each is a script in this repo under `tools/`, addressed through the one pointer `install.ts` creates, that turns a generic multiplexer into one shaped around running many Claude Code sessions at once.",
    bullets: [
      "`ttyimgspool` — `PostToolUse` and `UserPromptSubmit` hooks draw every image the agent sees inline in the transcript as a thumbnail (Ctrl+click opens the original full-pane) and spool everything it touches; `prefix+i` browses them in a temporary pane.",
      "`claude-tab` — `prefix+a` opens a popup: type the first prompt, Tab picks the model, the arrows pick the effort, and Enter opens a new tab running `claude --dangerously-skip-permissions` with that prompt.",
      "`run-tab` — `prefix+c` pops a `run>` prompt and runs what you type in a new tab in the current directory; `prefix+shift+c` closes the tab when the command exits and, if you are still watching it, puts you back on the tab you came from.",
      "`herdr-autolabel` — a `Stop` hook renames the tab to a short slug a local ollama model derives from the conversation, so tabs stop being `6 · 7 · 8 · 9`.",
      "`voicemode-hold` — a pane highlights the agent's speech word by word; `prefix+j` holds an utterance mid-word so you can say something into the gap and let it carry on, where `prefix+m` would end the turn outright.",
      "`statusline` and `ai-tidemark` — the status line's widgets (context, cost, 5-hour and weekly windows, cache countdown) also mirror into the herdr sidebar; ai-tidemark records those windows over time and charts them.",
    ],
    links: [
      ["ttyimgspool", "../tool-ttyimgspool/"],
      ["claude-tab", "../tool-claude-tab/"],
      ["run-tab", "../tool-run-tab/"],
      ["herdr-autolabel", "../tool-herdr-autolabel/"],
      ["voicemode-hold", "../tool-voicemode-hold/"],
      ["statusline", "../tool-statusline/"],
      ["ai-tidemark", "../tool-ai-tidemark/"],
    ],
  },
  {
    id: "handoff",
    index: "14",
    tag: "sessions outlive context",
    title: "Handoffs",
    color: colors.terminal,
    cls: "main-only secret-only",
    x: 730,
    y: 810,
    w: 154,
    h: 100,
    copy: "A long session is a prompt-cache problem as much as a context problem. Rather than compacting into a summary, this setup writes a handoff document and starts a fresh session from it. A skill writes the document, a tool does it automatically, and two more skills open and close herdr tabs around it.",
    bullets: [
      "`r2-handoff` writes the document. `split` fans one handoff into one per parallel work stream; `rescue` recovers an abandoned session from its transcript without resuming it, so its expired prompt cache is never rewritten.",
      "`auto-handoff` is the tool: a `Stop` hook at 250k context asks for the handoff, then, once the agent is idle and your prompt box is empty, types `/clear` and `read <handoff> and continue` into the pane. You only notice the context dropped.",
      "It never hands off while a subagent, workflow or shell is still running, and `auto-handoff off` (per pane) or `off --all` switches it off.",
      "`spawn-herdr-tab` opens a fresh top-level session in a new tab — a peer, not a subagent — typically to launch a handoff; `end-session` closes the pane on a direct command.",
    ],
    links: [
      ["auto-handoff", "../tool-auto-handoff/"],
      ["r2-handoff", "../skill-r2-handoff/"],
      ["spawn-herdr-tab", "../skill-spawn-herdr-tab/"],
      ["end-session", "../skill-end-session/"],
    ],
  },
  {
    id: "overlays",
    index: "15",
    tag: "layering",
    title: "Three repos, one catalog",
    color: colors.upkeep,
    cls: "secret-only",
    x: 730,
    y: 1140,
    w: 154,
    h: 100,
    copy: "The public repo is only the bottom layer. Employer skills, machine-local skills, and project skills live in separate repos that never enter the public one, and there is still exactly one installer. All of them collapse into a single flat catalog that both agents read.",
    bullets: [
      "`bun install.ts --overlay ../ai-setup-private` — repeatable and order-independent; overlays ship no installer of their own.",
      "Overlays contribute `skills/` and Codex prefs only. Rules, subagents, settings, and MCP registration stay owned by the public core.",
      "`~/.claude/skills` is a symlink to `~/.agents/skills`, so every live skill sits in one directory no matter which repo it came from.",
    ],
    links: [
      ["One pointer", "#pointerTitle"],
      ["How things declare themselves", "#manifestTitle"],
    ],
  },
  {
    id: "publish",
    index: "16",
    tag: "how public happens",
    title: "Private trunk, public drop",
    color: colors.upkeep,
    cls: "secret-only",
    x: 510,
    y: 1140,
    w: 154,
    h: 100,
    copy: "The branch the work happens on is not the branch the world sees. `private/trunk` carries the real history; `main` is always exactly one parentless commit — a fresh squashed snapshot, force-pushed on purpose. Publishing is an act, not a side effect.",
    bullets: [
      "`squash-to-main.sh` rebuilds `main` as an orphan `commit-tree` snapshot, so the public repo carries no working history.",
      "`scripts/drop-guard-pre-push.sh` enforces that invariant at push time rather than trusting anyone to remember it.",
      "After a drop, `scripts/after-drop.sh` releases any skill that has a new version; `viz` is versioned.",
      "Nothing reaches the public repo because a job ran. It gets there because a human decided to drop it.",
    ],
  },
];

const installFlow: [string, string, string][] = [
  ["Clone core", "`github.com/RascalTwo/ai-setup` is the public source of truth.", colors.repo],
  [
    "Run Bun installer",
    "`bun install.ts` creates or repairs symlinks and appends safe config.",
    colors.install,
  ],
  [
    "Layer overlays",
    "`--overlay <dir>` adds private skills without leaking them into the public repo.",
    colors.skill,
  ],
  [
    "Install externals",
    "`--externals` reproduces third-party skills from `external-skills.json`.",
    colors.violet,
  ],
  [
    "Wire runtimes",
    "Rules, skills, subagents, statusline, Codex prefs, MCP servers, herdr keybindings, and RTK land in the right live paths.",
    colors.agent,
  ],
];

const nodeById = new Map(nodes.map((node) => [node.id, node]));
const svg = document.querySelector<SVGSVGElement>(".map-svg")!;
const defs = document.querySelector<SVGGElement>("#markers")!;
const nodeLayer = document.querySelector<SVGGElement>("#nodes")!;
const edgeLayer = document.querySelector<SVGGElement>("#edges")!;
const detailTitle = document.querySelector<HTMLElement>("#detailTitle")!;
const detailTag = document.querySelector<HTMLElement>("#detailTag")!;
const detailIndex = document.querySelector<HTMLElement>("#detailIndex")!;
const detailCopy = document.querySelector<HTMLElement>("#detailCopy")!;
const detailList = document.querySelector<HTMLElement>("#detailList")!;
const detailLinks = document.querySelector<HTMLElement>("#detailLinks")!;
const tourProgress = document.querySelector<HTMLElement>("#tourProgress")!;
const installFlowEl = document.querySelector<HTMLElement>("#installFlow")!;
const startButtons = document.querySelectorAll<HTMLElement>("[data-start-tour]");
const prevButton = document.querySelector<HTMLButtonElement>("[data-prev-stop]")!;
const nextButton = document.querySelector<HTMLButtonElement>("[data-next-stop]")!;
const tourOrder = nodes.map((node) => node.id);
const routePairs: [string, string][] = tourOrder.slice(1).map((id, i) => [tourOrder[i]!, id]);

let activeId: string = loadHash<{ stop: string }>().stop ?? "repo";
if (!nodeById.has(activeId)) activeId = "repo";

function inlineCode(value: string): string {
  return esc(value).replaceAll(/`([^`]+)`/gu, "<code>$1</code>");
}

/** Route colour by the stop an edge leaves: install, secret sauce, terminal layer, provenance. */
function routeColor(fromIndex: number): string {
  if (fromIndex < 4) return colors.install;
  if (fromIndex < 9) return colors.sauce;
  if (fromIndex < 14) return colors.terminal;
  return colors.upkeep;
}

const markerFor = (color: string): string =>
  color === colors.sauce
    ? "danger"
    : color === colors.install
      ? "warn"
      : color === colors.terminal
        ? "terminal"
        : "upkeep";

function renderEdges() {
  defs.innerHTML = arrowMarkers({
    "ah-accent": colors.repo,
    "ah-warn": colors.install,
    "ah-danger": colors.sauce,
    "ah-terminal": colors.terminal,
    "ah-upkeep": colors.upkeep,
  }).replaceAll(/^<defs>|<\/defs>$/gu, "");
  edgeLayer.innerHTML = "";

  for (const [from, to] of routePairs) {
    const a = nodeById.get(from)!;
    const b = nodeById.get(to)!;
    const color = routeColor(tourOrder.indexOf(from));
    const route = document.createElementNS("http://www.w3.org/2000/svg", "path");
    route.setAttribute("d", connect(a, b));
    route.setAttribute("fill", "none");
    route.setAttribute("stroke", color);
    route.setAttribute("stroke-width", "2.5");
    route.setAttribute("stroke-opacity", "0.72");
    route.setAttribute("marker-end", `url(#ah-${markerFor(color)})`);
    route.dataset["vizId"] = `edge-${from}-${to}`;
    edgeLayer.append(route);
  }
}

function renderNodes() {
  nodeLayer.innerHTML = "";
  for (const node of nodes) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.dataset["vizId"] = `node-${node.id}`;
    group.dataset["label"] = node.title;
    group.classList.add(...node.cls.split(" ").filter(Boolean));

    const html = `
      <button type="button" class="node-button" data-node-id="${node.id}" aria-label="Open stop ${node.index}: ${node.title}">
        <div class="node-card ${node.id === activeId ? "active" : ""}" style="--node-color:${node.color}">
          <div class="node-kicker">${node.index}</div>
          <div class="node-title">${node.title}</div>
          <div class="node-tag">${node.tag}</div>
        </div>
      </button>
    `;
    group.insertAdjacentHTML("beforeend", labelBox(node, html));
    nodeLayer.append(group);
  }

  nodeLayer.querySelectorAll<HTMLElement>("[data-node-id]").forEach((button) => {
    button.addEventListener("click", () => setActive(button.dataset["nodeId"]!));
  });
}

function renderDetail() {
  const node = nodeById.get(activeId) ?? nodes[0]!;
  document.documentElement.style.setProperty("--active-color", node.color);
  detailTitle.textContent = node.title;
  detailTag.textContent = node.tag;
  detailIndex.textContent = node.index;
  detailCopy.innerHTML = inlineCode(node.copy);
  detailList.innerHTML = node.bullets
    .map((item) => `<li><span>${inlineCode(item)}</span></li>`)
    .join("");
  detailLinks.innerHTML = (node.links ?? [])
    .map(([label, href]) => {
      const poster = href.startsWith("../");
      return `<a class="detail-link" href="${href}">${esc(label)}${poster ? " ↗" : " ↓"}</a>`;
    })
    .join("");
  detailLinks.hidden = (node.links?.length ?? 0) === 0;
  const currentIndex = tourOrder.indexOf(node.id);
  const nextNode = nodeById.get(tourOrder[Math.min(currentIndex + 1, tourOrder.length - 1)]!)!;
  tourProgress.textContent =
    currentIndex === tourOrder.length - 1
      ? `Stop ${nodes.length} of ${nodes.length}. End of the tour.`
      : `Stop ${currentIndex + 1} of ${nodes.length}. Next: ${nextNode.title}.`;
  prevButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === tourOrder.length - 1;
  document.querySelectorAll(".node-card").forEach((card) => card.classList.remove("active"));
  document.querySelector(`[data-node-id="${node.id}"] .node-card`)?.classList.add("active");
}

function renderLists() {
  installFlowEl.innerHTML = installFlow
    .map(
      ([title, copy, color], i) => `
    <div class="flow-item" style="--card-color:${color}" data-viz-id="install-${i + 1}" data-label="${title}">
      <strong>${i + 1}. ${title}</strong>
      <span>${inlineCode(copy)}</span>
    </div>
  `,
    )
    .join("");
}

// ---- the index: every owned skill and tool, filterable -------------------------------------

type KindFilter = "all" | Kind;
type Kind = Entry["kind"];
const asKind = (v: string | undefined): KindFilter => (v === "skill" || v === "tool" ? v : "all");

const indexEl = document.querySelector<HTMLElement>("#indexGroups")!;
const indexCount = document.querySelector<HTMLElement>("#indexCount")!;
const searchInput = document.querySelector<HTMLInputElement>("#indexSearch")!;
const kindButtons = document.querySelectorAll<HTMLButtonElement>("[data-kind-filter]");
let kindFilter: KindFilter = "all";

const countOf = (kind: KindFilter): number =>
  kind === "all" ? entries.length : entries.filter((e) => e.kind === kind).length;

function renderIndex() {
  const q = searchInput.value.trim().toLowerCase();
  const match = (e: Entry): boolean =>
    (kindFilter === "all" || e.kind === kindFilter) &&
    (!q || `${e.name} ${e.blurb} ${e.kind}`.toLowerCase().includes(q));
  let shown = 0;
  indexEl.innerHTML = groups
    .map((g) => {
      const items = entries.filter((e) => e.group === g.id && match(e));
      if (items.length === 0) return "";
      shown += items.length;
      const cards = items
        .map(
          (e) => `
        <a class="idx-card" href="${posterHref(e)}" data-viz-id="idx-${e.name}" data-label="${e.name}">
          <span class="idx-top"><span class="idx-name">${e.name}</span><span class="idx-kind">${e.kind}</span></span>
          <span class="idx-blurb">${esc(e.blurb)}</span>
        </a>`,
        )
        .join("");
      return `
      <section class="idx-group" style="--g:${g.color}" data-viz-id="idx-group-${g.id}" data-label="${g.title}">
        <h3>${g.title} <span class="idx-n">${items.length}</span></h3>
        <p class="district-note">${g.note}</p>
        <div class="idx-grid">${cards}</div>
      </section>`;
    })
    .join("");
  indexCount.textContent =
    shown === 0
      ? "Nothing matches. Try a verb (read, open, review) or clear the filter."
      : shown === entries.length
        ? `All ${shown} — each links to its poster.`
        : `${shown} of ${entries.length}`;
  kindButtons.forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset["kindFilter"] === kindFilter)),
  );
}

kindButtons.forEach((b) =>
  b.addEventListener("click", () => {
    kindFilter = asKind(b.dataset["kindFilter"]);
    renderIndex();
  }),
);
searchInput.addEventListener("input", renderIndex);

// Counts quoted in prose come from the catalog, so they cannot drift from the index.
document.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
  el.textContent = String(countOf(asKind(el.dataset["count"])));
});
document.querySelectorAll<HTMLElement>("[data-stops]").forEach((el) => {
  el.textContent = String(nodes.length);
});

// ---- chapter nav: highlight the chapter being read -----------------------------------------

const navLinks = [...document.querySelectorAll<HTMLAnchorElement>(".chapter-nav a[href^='#']")];
const navTargets = navLinks
  .map((a) => document.querySelector<HTMLElement>(a.getAttribute("href")!))
  .filter((el): el is HTMLElement => el !== null);

function markNav() {
  let current = navTargets[0];
  for (const el of navTargets) if (el.getBoundingClientRect().top < 140) current = el;
  for (const a of navLinks)
    a.classList.toggle("on", a.getAttribute("href") === `#${current?.id ?? ""}`);
}

function setActive(id: string): void {
  activeId = id;
  saveHash({ stop: activeId });
  renderDetail();
}

function move(delta: number): void {
  const currentIndex = tourOrder.indexOf(activeId);
  const nextIndex = Math.max(0, Math.min(tourOrder.length - 1, currentIndex + delta));
  setActive(tourOrder[nextIndex]!);
}

startButtons.forEach((b) =>
  b.addEventListener("click", () => {
    setActive("repo");
    document.querySelector("#mapTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }),
);
prevButton.addEventListener("click", () => move(-1));
nextButton.addEventListener("click", () => move(1));
addEventListener("scroll", markNav, { passive: true });

renderEdges();
renderNodes();
renderLists();
renderDetail();
renderIndex();
markNav();
requestAnimationFrame(() => {
  vizAudit(svg);
});
