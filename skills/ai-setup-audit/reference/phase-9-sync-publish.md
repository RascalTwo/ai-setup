## Phase 9: Sync & Publish

Because every live entry is a symlink into a repo, edits made during the audit already live in the repo — there is nothing to `cp` back. This phase commits them and, if the public core changed, publishes safely.

### Steps

1. **Confirm no orphaned edits.** Re-run the Phase 3 invariant and the Phase 1 `classify` sweep — every live entry should still resolve into a repo. Fix any BROKEN/ORPHAN/ABSENT before committing.

2. **Re-run the installer** if any skill/overlay/subagent was added, removed, or renamed, so links match the repos:
   ```bash
   bun ~/Desktop/Desktop/Code/ai-setup/install.ts   # overlays come from ~/.agents/overlays.json
   ```
   Run `--list` first: any skill it reports under **NOT IN ANY SOURCE** is live but
   unreproducible — hand-linked, or from a repo missing from the manifest. Add it there.
   `install.ts` is idempotent and self-heals, but is add-only — if a skill was **renamed**, remove the stale `~/.agents/skills/<old>` symlink by hand first (the whole-dir `~/.claude/skills` link means Claude picks up the change automatically).

3. **Subagents** — if a reviewer subagent changed, recompile with Ruler (from `ai-setup/subagents/`) and re-check the `~/.claude/agents` + `~/.codex/agents` links:
   ```bash
   cd ~/Desktop/Desktop/Code/ai-setup/subagents && \
     npx @intellectronica/ruler apply --agents claude,codex --subagents --skills=false --with-mcp=false
   ```

4. **external-skills.json drift** — re-run the Phase 3 orphan/missing checks. If a third-party skill was installed or dropped this session, propose the concrete `external-skills.json` edit (correct `owner/repo: [skills]`) and let the user approve.

5. **README** — if owned skills were added/removed/renamed, ask whether the README skill table needs updating.

6. **Explorables** — confirm Phase 8's refresh is on disk (`viz-pages/`) and rendered clean: the tour, plus any poster you touched (including its regenerated `og.auto.png`). They're committed with everything else in the next step, and deployed below.

7. **Commit to `private/trunk`.** Show `git status` and `git diff` in `ai-setup`, then offer a descriptive commit **on `private/trunk`** (never commit the public snapshot directly).

### Publishing the public core (only if `ai-setup` changed)

The public `main` branch is a squashed snapshot force-pushed by `./squash-to-main.sh`. **Before publishing, a secrets scan is mandatory** — company/client data belongs in the private overlays only. Keep the universal patterns below as-is; swap the `ORG` placeholder for your own org/client identifiers (kept out of this public file on purpose — pull them from your private notes at run time):

```bash
cd ~/Desktop/Desktop/Code/ai-setup
ORG='your-org-slug|client-name|internal-domain'   # fill from private notes; do NOT commit real values here
grep -rInE "$ORG"'|awsapps\.com|[0-9]{12}|/Users/[^/ ]+/|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}' . \
  --include='*.md' --include='*.json' --include='*.ts' | grep -v node_modules
# → Review every hit. Universal patterns can false-positive on intentional
#   placeholders (an all-zeros account id, an example SSO-portal URL) — fine.
#   Real org identifiers, real account numbers, hardcoded home paths, AWS
#   keys, or GitHub tokens are NOT — move them to a private overlay.
```

If clean, publish and verify (reuse the same `$ORG`):
```bash
./squash-to-main.sh    # pushes as a gh account with write (per-call GH_TOKEN), force-pushes main
gh api 'repos/RascalTwo/ai-setup/git/trees/main?recursive=1' --jq '.tree[].path' | grep -iE "$ORG"'|private' || echo "clean"
```
**Deploy the explorables** (only if Phase 8 changed any). The whole `viz-pages/` container — lobby,
tour, and every poster — publishes to GitHub Pages together, on its own path, **not** via
`squash-to-main.sh`:

```bash
DRY_RUN=1 ~/Desktop/Desktop/Code/ai-setup/viz-pages/deploy.sh   # build only, sanity-check first
~/Desktop/Desktop/Code/ai-setup/viz-pages/deploy.sh              # deploy (exit 0 = deployed)
```

It reads `viz-pages/` off disk (works from any branch/state), auto-detects the host from `origin`,
and pushes as a `gh` account with write access via a per-call `GH_TOKEN` — the active account is
never switched, so there is nothing to restore afterwards. Afterwards,
confirm the live page actually renders the refresh:
<https://rascaltwo.github.io/ai-setup/rascal-ai-setup-tour/>. A tour refreshed in Phase 8 but never
deployed leaves the *public* map stale — which is the exact failure this phase exists to prevent.

If a `gh` call fails with "Repository not found" / "Could not resolve to a Repository," the wrong account is active — `gh auth status`, then `gh auth switch -u <repo-owner-account>`, and retry. Restore your usual active account when done. **Private overlay repos publish through their own normal git flow, not `squash-to-main.sh`.**

**Golden rule still applies:** present every change individually. Don't auto-commit or auto-publish.

End with: **"Audit complete. Setup repos are in sync"** (and, if applicable, **"public core published and verified clean"**). **"Anything else you want to revisit?"**
