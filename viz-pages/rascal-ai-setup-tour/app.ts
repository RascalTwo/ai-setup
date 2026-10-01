import { arrowMarkers, connect, labelBox, saveHash, loadHash, vizAudit, esc } from "/_kit/viz.js";

const colors = {
  repo: "#84dcc6",
  install: "#f6bd60",
  agent: "#70a1ff",
  skill: "#b28dff",
  violet: "#b28dff",
  sauce: "#ff6b6b",
  model: "#7bd88f",
  terminal: "#e08bd8",
  upkeep: "#5fd3f3"
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
}

const nodes: TourNode[] = [
  {
    id: "repo",
    index: "01",
    tag: "source of truth",
    title: "Public core repo",
    color: colors.repo,
    cls: "main-only",
    x: 70, y: 150, w: 154, h: 86,
    copy: "The `ai-setup` repo is the public, borrowable core. It keeps the agent rules, owned skills, external skill manifest, settings notes, and installer in one place so the live setup does not drift from source control.",
    bullets: [
      "`AGENTS.md` is the canonical rules file.",
      "`CLAUDE.md` points to the same bytes for Claude Code.",
      "`tools/` holds the seven owned tools, `skills/` the 40, `subagents/` the reviewers.",
      "Every one of them declares itself in frontmatter; state lives at `~/.agents/state/<name>/`, never in `~/.claude`."
    ]
  },
  {
    id: "installer",
    index: "02",
    tag: "bootstrap",
    title: "Deterministic installer",
    color: colors.install,
    cls: "main-only",
    x: 290, y: 150, w: 154, h: 86,
    copy: "`install.ts` is the small boring engine. It is idempotent, refuses to overwrite real files, repairs stale symlinks, layers private overlays, and optionally installs third-party skills from a manifest.",
    bullets: [
      "Rules go to `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`.",
      "Owned skills link into both agents' skill paths.",
      "Codex gets `basic-memory`, preferences, and the RTK hook merged into config."
    ]
  },
  {
    id: "agents",
    index: "03",
    tag: "two runtimes",
    title: "Claude Code plus Codex",
    color: colors.agent,
    cls: "main-only",
    x: 510, y: 150, w: 154, h: 86,
    copy: "The setup is agent-agnostic by design, but not pretending the two tools are identical. Claude Code is the main daily driver; Codex is maintained as a parity path and backup with equivalent rules, skills, MCP memory, browser tooling, and settings where possible.",
    bullets: [
      "Manual connector/plugin setup covers browser, desktop, Google, and Atlassian access.",
      "Settings differences are documented instead of mirrored blindly.",
      "The same repo explains what cannot be automated."
    ]
  },
  {
    id: "skills",
    index: "04",
    tag: "capability layer",
    title: "Skills catalog",
    color: colors.skill,
    cls: "main-only secret-only",
    x: 730, y: 150, w: 154, h: 86,
    copy: "Skills are the main capability layer. The repo ships owned skills such as `/viz`, audit helpers, local vision, speech-to-text, browser capture, deployment helpers, API wrappers, provider porting, and video/transcript tools. `external-skills.json` reproduces community skills through `npx skills`.",
    bullets: [
      "Community set: eight repos — Matt Pocock pipeline, ponytail, LN auditors, graphify, find-skills, skill-creator, i-have-adhd, and STRIDE threat modelling.",
      "Owned set: `/viz`, grill-me-viz, ai-setup-audit, steelman, timeline-studio-tasks, local image/video reading, render-image-in-terminal, transcribe-media, browser-capture, pptx-from-template, delegate-to-codex, r2-sdlc, pr-viz, r2-pr, upload-to-github, deploy/log helpers, API wrappers, provider porting.",
      "Private overlays add company or personal skills without publishing secrets."
    ]
  },
  {
    id: "subagents",
    index: "05",
    tag: "review team",
    title: "Subagents and Ruler",
    color: colors.violet,
    cls: "main-only secret-only",
    x: 950, y: 150, w: 154, h: 86,
    copy: "The r2-sdlc reviewer subagents are authored once in Ruler and committed in Claude and Codex native formats. Install only needs Bun; Ruler is reserved for author-time edits.",
    bullets: [
      "`subagents/.claude/agents/*.md` feeds Claude Code.",
      "`subagents/.codex/agents/*.toml` feeds Codex.",
      "The installer symlinks both generated outputs into place."
    ]
  },
  {
    id: "memory",
    index: "06",
    tag: "shared recall",
    title: "Basic-memory first",
    color: colors.model,
    cls: "secret-only",
    x: 950, y: 480, w: 154, h: 86,
    copy: "Persistent notes live in `basic-memory`, not in one agent's proprietary memory feature. The rule is explicit: search memory before guessing about project history or prior setup decisions.",
    bullets: [
      "The installer registers it with both agents — `claude mcp add -s user` for Claude Code, `config.toml` for Codex.",
      "Write rule: if the work already produces markdown, the knowledge goes there. If nothing is being written down, it goes here. Never both.",
      "Memory becomes the first evidence source before docs, web, or recall."
    ]
  },
  {
    id: "local-models",
    index: "07",
    tag: "local compute",
    title: "Ollama helpers",
    color: colors.model,
    cls: "secret-only",
    x: 730, y: 480, w: 154, h: 86,
    copy: "Ollama supplies cheap local model calls for tasks where cloud vision or heavyweight model tokens are wasteful. The repo documents `gemma4:e4b` for local vision and `qwen2.5-coder:7b` for graphify.",
    bullets: [
      "`read-image-locally` extracts structured screenshot data first.",
      "`graphify` is pinned to local Ollama in the global rules.",
      "Both agents can use the same daemon once models are pulled."
    ]
  },
  {
    id: "rules",
    index: "08",
    tag: "operating doctrine",
    title: "Rules that steer behavior",
    color: colors.sauce,
    cls: "secret-only",
    x: 510, y: 480, w: 154, h: 86,
    copy: "`AGENTS.md` carries the behavioral defaults: handle voice homophones, make evidence-based claims, prefer skills and MCP tools, verify before calling it done, route delegation deliberately, and default to the laziest solution that works.",
    bullets: [
      "Voice input means ambiguous commands get confirmed instead of guessed.",
      "Non-obvious claims need evidence, starting with memory.",
      "Every deliverable gets a verification phase proportional to risk."
    ]
  },
  {
    id: "pipeline",
    index: "09",
    tag: "delivery loop",
    title: "Rascal-2 pipeline",
    color: colors.sauce,
    cls: "secret-only",
    x: 290, y: 480, w: 154, h: 86,
    copy: "The r2-sdlc path turns a rough idea into scoped work, implementation, simplification, and layered review. The gauntlet can run the whole review panel and produce one ranked report.",
    bullets: [
      "Local markdown is the configured issue tracker.",
      "BDD-first tests and documentation philosophy are encoded as skills.",
      "Gauntlet aggregates specialist reviewers instead of reading twenty reports.",
      "`r2-pr` opens the PR the house way, with a `pr-viz` review film and page on top."
    ]
  },
  {
    id: "sauce",
    index: "10",
    tag: "tour exit",
    title: "Secret sauce",
    color: colors.install,
    cls: "secret-only",
    x: 70, y: 480, w: 154, h: 86,
    copy: "The leverage comes from making defaults executable: a shared rulebook, installable capability catalog, memory-first evidence, local-model shortcuts, and review pipelines that Claude Code and Codex can both reach.",
    bullets: [
      "Use Claude Code primarily, keep Codex close enough to substitute.",
      "Keep public core and private overlays separate.",
      "Favor small deterministic install steps over a hidden machine-local setup."
    ]
  },
  {
    id: "ghostty",
    index: "11",
    tag: "terminal emulator",
    title: "Ghostty",
    color: colors.terminal,
    cls: "main-only",
    x: 70, y: 810, w: 154, h: 86,
    copy: "Ghostty is the emulator underneath the whole setup, configured by file rather than by GUI so it can live in version control like everything else. Two changes matter: restoring an audible bell that agents use to get attention, and a macOS permission fix that is easy to misdiagnose.",
    bullets: [
      "`~/.config/ghostty/config` is the only source — reload from the command palette, no GUI prefs.",
      "`bell-features = system,attention,title` restores the alert Terminal.app gave for free. herdr is what raises it now — not a raw BEL relayed by tmux, which left with tmux.",
      "Full Disk Access on `Ghostty.app` stops the recurring \"would like to access data from other apps\" prompt — `claude` is a bare CLI, so macOS blames the responsible process, which is the terminal."
    ]
  },
  {
    id: "herdr",
    index: "12",
    tag: "agent multiplexer",
    title: "herdr",
    color: colors.terminal,
    cls: "main-only",
    x: 290, y: 810, w: 154, h: 86,
    copy: "herdr replaces tmux here. Same muscle memory — a prefix key, workspaces, tabs, panes — but it recognizes coding agents as first-class objects, tracks their lifecycle (`idle`, `working`, `blocked`, `done`), and surfaces which one needs you in a sidebar instead of leaving you to guess.",
    bullets: [
      "Custom bindings are `[[keys.command]]` entries; their `description` shows up in the `prefix+?` help panel.",
      "`kitty_graphics = true` is merged in by `install.ts` and needs a full server restart, not a config reload.",
      "`herdr tab|pane|agent|api …` expose the live session over a socket as JSON — which is what everything in stop 13 is built on.",
      "`[ui.toast] delivery = \"system\"` is what actually chimes when an agent wants you. That used to be tmux relaying a terminal bell; herdr raises it directly."
    ]
  },
  {
    id: "herdr-tools",
    index: "13",
    tag: "owned glue",
    title: "herdr integrations",
    color: colors.terminal,
    cls: "main-only",
    x: 510, y: 810, w: 154, h: 86,
    copy: "None of these ship with herdr. Each is a script in this repo under `tools/`, addressed through the one pointer `install.ts` creates, that turns a generic multiplexer into one shaped around running many Claude Code sessions at once.",
    bullets: [
      "`ttyimgspool` — `PostToolUse` and `UserPromptSubmit` hooks draw every image the agent sees inline in the transcript as a thumbnail (Ctrl+click opens the original full-pane) and spool everything it touches; `prefix+i` browses them in a temporary pane.",
      "`claude-tab` — `prefix+a` opens a new tab already running `claude --dangerously-skip-permissions` in the current directory.",
      "`run-tab` — `prefix+c` pops a `run>` prompt and runs what you type in a new tab in the current directory; `prefix+shift+c` closes the tab when the command exits and, if you are still watching it, puts you back on the tab you came from.",
      "`herdr-autolabel` — a `Stop` hook renames the tab to a short slug a local ollama model derives from the conversation, so tabs stop being `6 · 7 · 8 · 9`.",
      "`voicemode-hold` — a pane highlights the agent's speech word by word; `prefix+j` holds an utterance mid-word so you can say something into the gap and let it carry on, where `prefix+m` would end the turn outright."
    ]
  },
  {
    id: "overlays",
    index: "14",
    tag: "layering",
    title: "Three repos, one catalog",
    color: colors.upkeep,
    cls: "secret-only",
    x: 510, y: 1140, w: 154, h: 86,
    copy: "The public repo is only the bottom layer. Employer skills, machine-local skills, and project skills live in separate repos that never enter the public one, and there is still exactly one installer. All of them collapse into a single flat catalog that both agents read.",
    bullets: [
      "`bun install.ts --overlay ../ai-setup-private` — repeatable and order-independent; overlays ship no installer of their own.",
      "Overlays contribute `skills/` and Codex prefs only. Rules, subagents, settings, and MCP registration stay owned by the public core.",
      "`~/.claude/skills` is a symlink to `~/.agents/skills`, so every live skill sits in one directory no matter which repo it came from."
    ]
  },
  {
    id: "publish",
    index: "15",
    tag: "how public happens",
    title: "Private trunk, public drop",
    color: colors.upkeep,
    cls: "secret-only",
    x: 290, y: 1140, w: 154, h: 86,
    copy: "The branch the work happens on is not the branch the world sees. `private/trunk` carries the real history; `main` is always exactly one parentless commit — a fresh squashed snapshot, force-pushed on purpose. Publishing is an act, not a side effect.",
    bullets: [
      "`squash-to-main.sh` rebuilds `main` as an orphan `commit-tree` snapshot, so the public repo carries no working history.",
      "`scripts/drop-guard-pre-push.sh` enforces that invariant at push time rather than trusting anyone to remember it.",
      "Nothing reaches the public repo because a job ran. It gets there because a human decided to drop it."
    ]
  }
];

const installFlow: [string, string, string][] = [
  ["Clone core", "`github.com/RascalTwo/ai-setup` is the public source of truth.", colors.repo],
  ["Run Bun installer", "`bun install.ts` creates or repairs symlinks and appends safe config.", colors.install],
  ["Layer overlays", "`--overlay <dir>` adds private skills without leaking them into the public repo.", colors.skill],
  ["Install externals", "`--externals` reproduces third-party skills from `external-skills.json`.", colors.violet],
  ["Wire runtimes", "Rules, skills, subagents, statusline, Codex prefs, basic-memory, and RTK land in the right live paths.", colors.agent]
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
const tourProgress = document.querySelector<HTMLElement>("#tourProgress")!;
const installFlowEl = document.querySelector<HTMLElement>("#installFlow")!;
const startButton = document.querySelector<HTMLButtonElement>("[data-start-tour]")!;
const prevButton = document.querySelector<HTMLButtonElement>("[data-prev-stop]")!;
const nextButton = document.querySelector<HTMLButtonElement>("[data-next-stop]")!;
const tourOrder = nodes.map((node) => node.id);
const routePairs: [string, string][] = [
  ["repo", "installer"],
  ["installer", "agents"],
  ["agents", "skills"],
  ["skills", "subagents"],
  ["subagents", "memory"],
  ["memory", "local-models"],
  ["local-models", "rules"],
  ["rules", "pipeline"],
  ["pipeline", "sauce"],
  ["sauce", "ghostty"],
  ["ghostty", "herdr"],
  ["herdr", "herdr-tools"],
  ["herdr-tools", "overlays"],
  ["overlays", "publish"]
];

let activeId: string = loadHash<{ stop: string }>().stop || "repo";
if (!nodeById.has(activeId)) activeId = "repo";

function inlineCode(value: string): string {
  return esc(value).replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderEdges() {
  defs.innerHTML = arrowMarkers({
    "ah-accent": colors.repo,
    "ah-warn": colors.install,
    "ah-danger": colors.sauce,
    "ah-terminal": colors.terminal,
    "ah-upkeep": colors.upkeep
  }).replace(/^<defs>|<\/defs>$/g, "");
  edgeLayer.innerHTML = "";

  for (const [from, to] of routePairs) {
    const a = nodeById.get(from)!;
    const b = nodeById.get(to)!;
    const edge = connect(a, b);
    const fromIndex = tourOrder.indexOf(from);
    const color = fromIndex < 4 ? colors.install : fromIndex < 9 ? colors.sauce : fromIndex < 13 ? colors.terminal : colors.upkeep;
    const route = document.createElementNS("http://www.w3.org/2000/svg", "path");
    route.setAttribute("d", edge);
    route.setAttribute("fill", "none");
    route.setAttribute("stroke", color);
    route.setAttribute("stroke-width", "2.5");
    route.setAttribute("stroke-opacity", "0.72");
    route.setAttribute("marker-end", `url(#ah-${color === colors.sauce ? "danger" : color === colors.install ? "warn" : color === colors.terminal ? "terminal" : color === colors.upkeep ? "upkeep" : "accent"})`);
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
      <button type="button" class="node-button" data-node-id="${node.id}" aria-label="Open ${node.title}">
        <div class="node-card ${node.id === activeId ? "active" : ""}" style="--node-color:${node.color}">
          <div class="node-kicker">${node.index}</div>
          <div class="node-title">${node.title}</div>
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
  const node = nodeById.get(activeId) || nodes[0]!;
  document.documentElement.style.setProperty("--active-color", node.color);
  detailTitle.textContent = node.title;
  detailTag.textContent = node.tag;
  detailIndex.textContent = node.index;
  detailCopy.textContent = node.copy;
  detailList.innerHTML = node.bullets.map((item) => `<li><span>${inlineCode(item)}</span></li>`).join("");
  const currentIndex = tourOrder.indexOf(node.id);
  const nextNode = nodeById.get(tourOrder[Math.min(currentIndex + 1, tourOrder.length - 1)]!)!;
  tourProgress.textContent = currentIndex === tourOrder.length - 1
    ? `Stop ${nodes.length} of ${nodes.length}. End of the tour.`
    : `Stop ${currentIndex + 1} of ${nodes.length}. Next: ${nextNode.title}.`;
  prevButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === tourOrder.length - 1;
  document.querySelectorAll(".node-card").forEach((card) => card.classList.remove("active"));
  document.querySelector(`[data-node-id="${node.id}"] .node-card`)?.classList.add("active");
}

function renderLists() {
  installFlowEl.innerHTML = installFlow.map(([title, copy, color], i) => `
    <div class="flow-item" style="--card-color:${color}" data-viz-id="install-${i + 1}" data-label="${title}">
      <strong>${i + 1}. ${title}</strong>
      <span>${inlineCode(copy)}</span>
    </div>
  `).join("");

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

startButton.addEventListener("click", () => setActive("repo"));
prevButton.addEventListener("click", () => move(-1));
nextButton.addEventListener("click", () => move(1));

renderEdges();
renderNodes();
renderLists();
renderDetail();
requestAnimationFrame(() => vizAudit(svg));
