// The "what's in here" index: every owned skill and tool, one line each, grouped by what it is for.
// Source of truth for the page's index chapter. Names are the directory names under skills/ and
// tools/; each links to its poster at ../skill-<name>/ or ../tool-<name>/.

export type Kind = "skill" | "tool";

export interface Entry {
  name: string;
  kind: Kind;
  group: string;
  blurb: string;
}

export interface Group {
  id: string;
  title: string;
  note: string;
  color: string;
}

export const groups: Group[] = [
  {
    id: "think",
    title: "Think and plan",
    note: "Pressure-test, grill, plan, and push the work past done.",
    color: "#84dcc6",
  },
  {
    id: "sessions",
    title: "Sessions and handoffs",
    note: "Sessions that outlive their context window, and end cleanly.",
    color: "#70a1ff",
  },
  {
    id: "visuals",
    title: "Make it visible",
    note: "Explain with a page, a diagram, or a whiteboard instead of a wall of text.",
    color: "#b28dff",
  },
  {
    id: "media",
    title: "Media and local AI",
    note: "Reading images and video, and speech-to-text, on local models first.",
    color: "#7bd88f",
  },
  {
    id: "workplace",
    title: "Browser and workplace",
    note: "Slack, Confluence, calendars and recordings, driven through a real signed-in browser.",
    color: "#5fd3f3",
  },
  {
    id: "delivery",
    title: "Delivery and review",
    note: "Idea to reviewed PR, plus the CI/CD routines around it.",
    color: "#ff6b6b",
  },
  {
    id: "cloud",
    title: "Cloud, APIs and ports",
    note: "Credentials, identity-provider APIs, and Terraform-provider ports.",
    color: "#f6bd60",
  },
  {
    id: "tools",
    title: "Tools around the terminal",
    note: "Programs, not instructions: hooks, keybindings and widgets that run with no model deciding to.",
    color: "#e08bd8",
  },
];

export const entries: Entry[] = [
  // Think and plan
  {
    name: "steelman",
    kind: "skill",
    group: "think",
    blurb: "Argues the strongest case for and against a decision, then hands over the verdict.",
  },
  {
    name: "plus-ultra",
    kind: "skill",
    group: "think",
    blurb:
      "After work is done: what would make it genuinely better, priced and ranked. May conclude ship it.",
  },
  {
    name: "grill-me-viz",
    kind: "skill",
    group: "think",
    blurb:
      "Grilling on a live page: prototypes to react to, options side by side, answers picked or spoken.",
  },
  {
    name: "timeline-studio-tasks",
    kind: "skill",
    group: "think",
    blurb:
      "One task plan with real dependencies, so nothing mentioned or left unfinished dies with the session.",
  },
  {
    name: "delegate-to-codex",
    kind: "skill",
    group: "think",
    blurb:
      "Hands a scoped task to the headless Codex CLI, billed to ChatGPT instead of Claude tokens.",
  },
  {
    name: "ai-setup-audit",
    kind: "skill",
    group: "think",
    blurb:
      "The recurring health check for this whole setup: symlinks, skills, MCP, settings, subagents.",
  },
  {
    name: "documandments",
    kind: "skill",
    group: "think",
    blurb: "Documentation discipline: first decide whether the doc should exist at all.",
  },
  // Sessions and handoffs
  {
    name: "r2-handoff",
    kind: "skill",
    group: "sessions",
    blurb:
      "Hands a conversation to a fresh agent; splits it per parallel stream; rescues an abandoned session.",
  },
  {
    name: "spawn-herdr-tab",
    kind: "skill",
    group: "sessions",
    blurb:
      "Opens a new herdr tab running a fresh Claude Code or Codex session, with model, effort and first prompt.",
  },
  {
    name: "end-session",
    kind: "skill",
    group: "sessions",
    blurb: "Closes this session's herdr pane, on a direct command and nothing softer.",
  },
  // Make it visible
  {
    name: "viz",
    kind: "skill",
    group: "visuals",
    blurb:
      "Live HTML/CSS/JS pages, diagrams and decks with a local server, a verify gate, and publishing. This tour is one.",
  },
  {
    name: "tldraw-canvas",
    kind: "skill",
    group: "visuals",
    blurb: "Reads and edits a tldraw whiteboard: shapes, sticky notes, arrows, frames.",
  },
  // Media and local AI
  {
    name: "read-image-locally",
    kind: "skill",
    group: "media",
    blurb:
      "Structured extraction from a screenshot on a local vision model, before spending Claude vision tokens.",
  },
  {
    name: "render-image-in-terminal",
    kind: "skill",
    group: "media",
    blurb: "Shows an image inline in the Claude Code transcript when you ask to see one.",
  },
  {
    name: "read-video-locally",
    kind: "skill",
    group: "media",
    blurb: "Says what a video shows, narrated or silent, as text, with no vision tokens.",
  },
  {
    name: "transcribe-media",
    kind: "skill",
    group: "media",
    blurb: "The one speech-to-text engine: Parakeet v3 first, Whisper as the fallback.",
  },
  {
    name: "extract-video-subtitles",
    kind: "skill",
    group: "media",
    blurb: "Pulls embedded caption tracks out of a video with FFmpeg; falls back to transcription.",
  },
  {
    name: "extract-gdrive-transcript",
    kind: "skill",
    group: "media",
    blurb: "Gets the full, speaker-attributed transcript of a recording on Google Drive.",
  },
  // Browser and workplace
  {
    name: "browser-capture",
    kind: "skill",
    group: "workplace",
    blurb: "Screenshots, GIFs and smooth video of your own signed-in Chrome, saved to disk.",
  },
  {
    name: "ui-narration",
    kind: "skill",
    group: "workplace",
    blurb:
      "A synthetic cursor, highlight box and click pulse, so a recording shows what was clicked and when.",
  },
  {
    name: "slack-in-browser",
    kind: "skill",
    group: "workplace",
    blurb: "Reads and reacts in Slack by calling its web API from inside your signed-in tab.",
  },
  {
    name: "confluence-editor",
    kind: "skill",
    group: "workplace",
    blurb:
      "Surgical edits to an existing Confluence page in Chrome, left as a draft for a human to publish.",
  },
  {
    name: "publish-markdown-to-confluence",
    kind: "skill",
    group: "workplace",
    blurb: "Replaces a Confluence page's body from a local markdown file, tables and links kept.",
  },
  {
    name: "sync-webex-to-google-calendar",
    kind: "skill",
    group: "workplace",
    blurb: "Mirrors meetings from the Webex desktop app into Google Calendar, one way.",
  },
  // Delivery and review
  {
    name: "r2-sdlc",
    kind: "skill",
    group: "delivery",
    blurb: "Story to PR: understand, design, strict TDD, simplify, then two tiers of review.",
  },
  {
    name: "r2-gauntlet",
    kind: "skill",
    group: "delivery",
    blurb: "Runs every reviewer and auditor on a change and returns one deduped, ranked report.",
  },
  {
    name: "r2-pr",
    kind: "skill",
    group: "delivery",
    blurb:
      "Opens or updates a PR the house way: a local draft you approve, a pr-viz walkthrough on top.",
  },
  {
    name: "pr-viz",
    kind: "skill",
    group: "delivery",
    blurb:
      "Turns a PR or diff into a narrated review film plus a page a reviewer can approve from.",
  },
  {
    name: "pr-split",
    kind: "skill",
    group: "delivery",
    blurb:
      "Splits a branch into smaller PRs that sum back to the original, one local branch per piece.",
  },
  {
    name: "r2-testing-paradigm",
    kind: "skill",
    group: "delivery",
    blurb:
      "The testing philosophy: what scope to test at, real versus fake, coverage and mutation.",
  },
  {
    name: "r2-sdlc-documentation-philosophy",
    kind: "skill",
    group: "delivery",
    blurb:
      "The documentation contract r2-sdlc adds on top of documandments: doc strings and review checklists.",
  },
  {
    name: "github-attach-media",
    kind: "skill",
    group: "delivery",
    blurb: "Gets a renderable GitHub URL for an image or video, including in private repos.",
  },
  {
    name: "trigger-github-deploy",
    kind: "skill",
    group: "delivery",
    blurb: "Kicks off a deploy workflow against the current branch and watches it.",
  },
  {
    name: "wait-for-github-workflow",
    kind: "skill",
    group: "delivery",
    blurb: "Polls a GitHub Actions run until it finishes.",
  },
  {
    name: "analyze-github-workflow-failure",
    kind: "skill",
    group: "delivery",
    blurb: "Reads a failed Actions run's logs and finds the root cause.",
  },
  {
    name: "diagnose-azure-container-app",
    kind: "skill",
    group: "delivery",
    blurb: "Finds why a container app will not start, from system events and console logs.",
  },
  {
    name: "diagnose-terraform-unknown-error",
    kind: "skill",
    group: "delivery",
    blurb: "Extracts the real HTTP request and response behind an opaque Terraform provider error.",
  },
  {
    name: "reorder-github-project-board-by-depth",
    kind: "skill",
    group: "delivery",
    blurb:
      "Sorts a Projects board column by blocking depth, so the first card is what can start now.",
  },
  // Cloud, APIs and ports
  {
    name: "aws-creds",
    kind: "skill",
    group: "cloud",
    blurb:
      "Short-lived AWS credentials from any IAM Identity Center portal, usable from the shell.",
  },
  {
    name: "okta-api",
    kind: "skill",
    group: "cloud",
    blurb: "The Okta management API as named operations.",
  },
  {
    name: "ping-api",
    kind: "skill",
    group: "cloud",
    blurb: "The PingOne management API as named operations.",
  },
  {
    name: "port-terraform-provider-to-ansible",
    kind: "skill",
    group: "cloud",
    blurb: "Ports a Terraform provider to an Ansible collection with measured parity.",
  },
  {
    name: "port-terraform-provider-to-k8s-operator",
    kind: "skill",
    group: "cloud",
    blurb: "Ports a Terraform provider to a Kubernetes operator with measured parity.",
  },
  {
    name: "port-terraform-provider-to-powershell-dsc",
    kind: "skill",
    group: "cloud",
    blurb: "Ports a Terraform provider to a PowerShell DSC module with measured parity.",
  },
  {
    name: "omnissa-horizon-vdi",
    kind: "skill",
    group: "cloud",
    blurb: "Drives a remote Windows desktop through Horizon Client on a virtual display.",
  },
  // Tools
  {
    name: "auto-handoff",
    kind: "tool",
    group: "tools",
    blurb:
      "Auto-compact, but with a handoff: at 250k context it writes one, clears, and continues from it.",
  },
  {
    name: "claude-tab",
    kind: "tool",
    group: "tools",
    blurb:
      "prefix+a: a popup for the first prompt, model and effort, then a new tab running Claude Code.",
  },
  {
    name: "run-tab",
    kind: "tool",
    group: "tools",
    blurb: "prefix+c: type a command, and it runs in a new tab in the current directory.",
  },
  {
    name: "herdr-autolabel",
    kind: "tool",
    group: "tools",
    blurb:
      "A Stop hook that renames the tab to what the conversation is about now, via a local model.",
  },
  {
    name: "ttyimgspool",
    kind: "tool",
    group: "tools",
    blurb:
      "Every image the agent sees appears inline in the transcript; prefix+i browses them all.",
  },
  {
    name: "voicemode-hold",
    kind: "tool",
    group: "tools",
    blurb:
      "A pane that highlights the agent's speech word by word, and a key that holds it mid-word.",
  },
  {
    name: "statusline",
    kind: "tool",
    group: "tools",
    blurb: "The Claude Code status line: context, cost, usage windows, cache countdown.",
  },
  {
    name: "ai-tidemark",
    kind: "tool",
    group: "tools",
    blurb: "Records how much of each rate-limit window you used, with a dashboard.",
  },
];

/** Poster path for an entry, relative to this page. */
export const posterHref = (e: Entry): string => `../${e.kind}-${e.name}/`;
