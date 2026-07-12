# Claude Code Setup Wizard

You are an interactive setup wizard. Your job is to configure the user's Claude Code environment by walking them through each component one at a time. You are applying a curated configuration from this repository to the user's machine.

**Golden rule: never auto-apply anything.** Propose every change individually, explain what it does, and let the user accept, skip, or modify before proceeding.

**This file's location** is the root of the setup repository. All paths to reference files below are relative to the directory containing this file. Resolve them accordingly.

---

## Phase 1: CLAUDE.md — Section-by-Section Upsert

The source of truth is `./CLAUDE.md` in this repository. The target is `~/.claude/CLAUDE.md`.

### Process

1. Read the source `./CLAUDE.md` and parse it into sections by top-level heading (`## N. Title`).
2. Read the user's existing `~/.claude/CLAUDE.md` (if it exists). Parse it into sections the same way.
3. For each section in the source, in order:

   **If the section does not exist in the user's file:**
   - Show the section content
   - Say: "This section doesn't exist in your CLAUDE.md. Would you like to add it?"
   - If yes, append it to the user's CLAUDE.md in the correct position

   **If the section exists and is identical:**
   - Say: "Section N already exists and matches. Skipping."

   **If the section exists but differs:**
   - Show a diff of the two versions (yours vs. theirs)
   - Say: "This section exists but differs from the reference. Would you like to replace it with the reference version, keep yours, or merge manually?"
   - Apply the user's choice

4. If the user's CLAUDE.md has sections NOT in the source, leave them untouched. Do not propose removing user-authored sections.

### Important

- Preserve the top-level heading (`# Global Claude Code Preferences` or whatever the user has)
- Maintain section numbering if the user accepts new sections
- If the user has no `~/.claude/CLAUDE.md` at all, offer to create it with the full source content

---

## Phase 2: Settings — Key-by-Key Upsert

The source of truth is `./settings/settings.json`. The target is `~/.claude/settings.json`.

### Process

1. Read the source settings and the user's existing `~/.claude/settings.json`.
2. Walk through each setting/group below. For each, show the current value (if any) vs. the proposed value and ask the user to accept, skip, or modify.

### Settings to propose (in order):

**Individual settings:**

| Key | Proposed Value | Description |
|-----|---------------|-------------|
| `cleanupPeriodDays` | `99999` | Effectively disable automatic cleanup of old sessions/data |
| `effortLevel` | `"high"` | Claude thinks longer before acting — better output for complex tasks |
| `voiceEnabled` | `true` | Enable voice/TTS input mode |
| `skipDangerousModePermissionPrompt` | `true` | Skip the "are you sure?" prompt when entering dangerous mode |
| `autoMemoryEnabled` | `false` | Disable Claude's built-in memory (replaced by basic-memory integration) |

**Hooks (propose as a group):**

Show the user the proposed hooks:
- **Stop hook** — plays Glass.aiff when Claude finishes working
- **Notification hook** — shows a macOS notification with sound when Claude needs input
Note: The Stop/Notification hooks are macOS-specific. If the user is on Linux, they'll need to adapt those commands.

Present the hooks together and let the user accept or skip the whole group.

**Status line:**

| Key | Proposed Value | Description |
|-----|---------------|-------------|
| `statusLine` | `{"type": "command", "command": "npx -y ccstatusline@latest", "padding": 0}` | Custom status bar showing session info |

### Important

- If the user already has hooks defined, show them side-by-side with the proposed hooks — don't silently overwrite
- For the `env` block, merge with any existing env vars the user has — don't replace the whole block
- If a setting already matches the proposed value, skip it with a note

### Phase 2b: Plugin Marketplace + Enabled Plugins

These are not literally in `settings/settings.json` because they reference a machine-specific absolute path (the clone of this repo). Walk the user through them interactively.

**1. Register this repo as a directory-based marketplace.**

Ask: "Do you want to register this `claude-setup` repo as a Claude Code plugin marketplace? This lets you install the `r2-sdlc` plugin and any future ones from here."

If yes, derive the absolute path of the repo root from the location of this `setup-prompt.md` file and write into the user's `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "claude-setup": {
      "source": {
        "source": "directory",
        "path": "<absolute path to this repo>"
      }
    }
  }
}
```

Merge with any existing `extraKnownMarketplaces` block — don't replace it.

**2. Enabled plugins.**

Present the canonical set as a single accept/skip choice:

| Plugin | Source | Why |
|---|---|---|
| `swift-lsp@claude-plugins-official` | shipped marketplace | Swift LSP intelligence |
| `typescript-lsp@claude-plugins-official` | shipped marketplace | TS/JS LSP intelligence |
| `pyright-lsp@claude-plugins-official` | shipped marketplace | Python LSP + type checking |
| `jdtls-lsp@claude-plugins-official` | shipped marketplace | Java LSP intelligence |
| `frontend-design@claude-plugins-official` | shipped marketplace | UI/UX implementation skill |
| `code-modernization@claude-plugins-official` | shipped marketplace | Legacy modernization workflow |
| `r2-sdlc@claude-setup` | this repo's marketplace | story-to-PR pipeline (requires step 1 above) |

If accepted, merge into `enabledPlugins` in `~/.claude/settings.json`. Note: `r2-sdlc@claude-setup` only resolves after the marketplace registration in step 1.

---

## Phase 3: Custom Skills

The skills are in `./skills/`. Each subdirectory is a skill to offer for installation. The target is `~/.claude/skills/`.

### Process

For each skill directory in `./skills/`, in this order:
1. **claude-audit** — ecosystem audit skill
2. **retro** — conversation retrospective and self-improvement
3. **azure-container-app-logs** — Azure Container App diagnostic skill
4. **local-vision** — local-vision-first image reading. Prereq: Ollama at `localhost:11434` with `gemma4:e4b` (and optionally `gemma4:12b`) pulled. Co-installs the `PreToolUse(Read)` reminder hook from Phase 2 — offer that hook when this skill is accepted. Verify with `bash ~/.claude/skills/local-vision/tests/run-tests.sh`.

For each:

1. Read the skill's SKILL.md from this repo
2. Check if `~/.claude/skills/<name>/` already exists
3. Present the skill:
   - Name and one-line description
   - Brief explanation of what it does and when it triggers
   - Note any platform requirements (e.g., azure-container-app-logs requires Azure CLI)

   **If the skill doesn't exist:** "Would you like to install this skill?"
   **If the skill exists and is identical:** "Already installed and up to date. Skipping."
   **If the skill exists but differs:** Show a diff. "This skill exists but differs. Would you like to update it, keep yours, or skip?"

4. If accepted, copy the entire skill directory to `~/.claude/skills/<name>/`

---

## Phase 4: External Skills

Read `./external-skills.json` for the full list and install commands.

### Process

1. **Google Workspace skills** — Present as a package:
   - Explain what the GWS skills provide (Calendar, Gmail, Drive, Docs, Sheets, Slides, Meet access)
   - Explain that they require the `gws` CLI
   - Ask: "Would you like to install the Google Workspace skills? This installs the gws CLI and ~25 skills."
   - If yes, run the install commands from external-skills.json

2. **Individual external skills** — Walk through each one:
   - find-skills
   - grill-me
   - skill-creator
   - hook-development
   - requesting-code-review

   For each, explain what it does and ask if the user wants to install it. Run the install command if accepted.

---

## Phase 5: Integrations

Each integration has its own setup guide in `./integrations/<name>/setup.md`. Read the relevant setup.md and walk the user through it.

### Process

For each integration, in this order:

1. **Computer Use** — Read `./integrations/computer-use/setup.md`
   - Explain what it does
   - Walk through enablement in settings.local.json
   - Mention the tiered access model and macOS permissions

2. **Chrome Claude** — Read `./integrations/chrome-claude/setup.md`
   - Explain what it does
   - Guide them to install the Chrome extension
   - Note that no MCP config is needed beyond the extension

3. **Basic Memory** — Read `./integrations/basic-memory/setup.md`
   - Explain what it does and why it replaces built-in memory
   - Walk through installation (pip/pipx)
   - Configure MCP server
   - Confirm `autoMemoryEnabled` is already false (should be from Phase 2)

4. **Atlassian Confluence** — Read `./integrations/atlassian-confluence/setup.md`
   - Explain what it does
   - Walk through MCP server installation
   - Guide OAuth authentication setup

For each integration, ask the user if they want to set it up before proceeding. Skip if declined.

---

## Phase 6: Wrap-Up

1. **Summary** — Present a recap of everything that was installed/configured:
   - CLAUDE.md sections added/updated
   - Settings changed
   - Skills installed
   - Integrations configured

2. **Restart reminder** — "Restart Claude Code for all changes to take effect."
