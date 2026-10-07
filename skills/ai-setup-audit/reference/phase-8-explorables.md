## Contents
- Phase 8: Refresh the Published Explorables
  - A. The tour
    - Find the drift (mechanical check)
  - What to reconcile
  - B. The skill posters
  - Verify the render before moving on

## Phase 8: Refresh the Published Explorables

`ai-setup/viz-pages/` publishes a **lobby** of explorables to GitHub Pages — the public face of
this setup. Two kinds of page live there, and **both drift**:

- **The tour** (`rascal-ai-setup-tour/`) — the onboarding map of the whole setup.
- **The skill posters** (`skill-<atom>/`) — one self-hero card per atom, each selling why that
  atom exists, with a deep dive below the fold.

All of it is **hand-authored HTML** built with this repo's own `/viz` skill. Nothing regenerates
any of it, so it drifts silently every time a skill, MCP server, or subagent changes. **This audit
is the only cadence that catches that.** Treat these as deliverables of the audit, not static
pages — a published page that lies about the setup is worse than no page.

Run this after Phases 1–7, so the refresh reflects both the real inventory and every decision made
this session.

### A. The tour

#### Find the drift (mechanical check)

The tour names skills inline as `<strong>skill-name</strong>`, grouped into district sections
(`Owned core and setup operations`, `Media and local AI`, `Cloud, API, and delivery`,
`External community packs`), plus prose/summary strings that re-enumerate the owned set.

```bash
TOUR=$HOME/Desktop/Desktop/Code/ai-setup/viz-pages/rascal-ai-setup-tour/index.html

echo "--- Owned skills MISSING from the tour (added since the last refresh) ---"
for d in "$HOME"/Desktop/Desktop/Code/ai-setup/skills/*/; do
  n=$(basename "$d"); grep -qF "$n" "$TOUR" || echo "MISSING from tour: $n"
done

echo "--- Names the tour still claims that aren't installed (removed/renamed) ---"
grep -oE '<strong>[a-z0-9][a-z0-9-]{3,}</strong>' "$TOUR" | sed -E 's#</?strong>##g' | sort -u |
while read -r n; do [ -e "$HOME/.agents/skills/$n" ] || echo "possibly STALE in tour: $n"; done
```

The first list is **exact** — act on it. The second is a **heuristic**: the tour uses `<strong>`
for ordinary emphasis too, so eyeball the hits before treating one as stale.

### What to reconcile

Walk each finding against the Phase 1 inventory and this session's decisions:

1. **Skills** — every owned skill added / removed / renamed must be reflected, and a new one placed
   in the **right district** (a local-media skill belongs under "Media and local AI", not "Cloud,
   API, and delivery"). Third-party changes land in "External community packs".
2. **Summary / narration strings** — the tour repeats the owned set in prose (e.g. the
   `"Owned set: …"` line). A skill added to a district but missed here leaves the page
   self-contradictory — grep the skill name and fix **every** hit, not just the first.
3. **MCP servers, subagents, settings, install flow** — if Phase 4/5 changed any of these, the
   stops describing them are stale.
4. **Counts and shape** — the tour advertises "ten stops". If a stop is added or removed, fix the
   count everywhere it appears (headline, map, nav).
5. **Prose accuracy** — a stop describing a workflow that changed this session (a new AGENTS.md
   rule, a retired MCP server, a skill that now delegates to another) needs its *words* updated,
   not just its lists.

### B. The skill posters

Each poster stamps its subject on its card as **`data-atom="<skill-name>"`**. That's deliberate:
it keeps this check a one-second grep instead of a semantic judgment ("is this pitch still
compelling?"), which is slow and fails quietly.

```bash
REPO=$HOME/Desktop/Desktop/Code/ai-setup

echo "--- Posters whose atom NO LONGER EXISTS (renamed/removed skill) — real defect ---"
# NOTE the `&lt;` filter: this skill's own poster documents the data-atom convention
# in prose, and an unfiltered grep matches that literal and reports it as an orphan.
ATOMS=$(grep -rhoE 'data-atom="[^"]+"' "$REPO"/viz-pages/skill-*/index.html 2>/dev/null |
  cut -d'"' -f2 | grep -v '&lt;' | sort -u)
echo "$ATOMS" | while read -r a; do
  [ -d "$REPO/skills/$a" ] || echo "ORPHAN poster: $a (advertises a skill that's gone)"
done

echo "--- Posters advertising a skill that is NOT PUBLISHED (local-only) — real defect ---"
# The check above tests LOCAL disk, so a skill that exists here but was never
# committed passes it while the public site sells something a visitor cannot get.
# Found 2026-08-30: two skill posters were live and linked from the lobby while
# their skills were untracked and absent from `main`.
PUB=$(gh api "repos/$(gh repo view --json nameWithOwner --jq .nameWithOwner)/git/trees/main?recursive=1" \
        --jq '.tree[].path' 2>/dev/null)   # QUOTE the URL — zsh globs on `?`
if [ -n "$PUB" ]; then
  echo "$ATOMS" | while read -r a; do
    echo "$PUB" | grep -qx "skills/$a" || echo "UNPUBLISHED poster: $a (live page, skill not on main)"
  done
else
  echo "(skipped — could not read the published tree; check gh auth)"
fi

echo "--- Owned skills with no poster — a MENU, not a defect ---"
for d in "$REPO"/skills/*/; do
  n=$(basename "$d")
  grep -rqF "data-atom=\"$n\"" "$REPO"/viz-pages/skill-*/index.html 2>/dev/null || echo "no poster: $n"
done
```

Read the two lists **differently** — this is the part that matters:

- **ORPHAN poster** — a real defect, and the worst kind: a published page confidently selling a
  skill that no longer exists. Fix or delete it, and remember it's `public`+`listed`, so it's on
  the lobby right now. Renamed skill → rename the viz dir (`viz move`) and update `data-atom`.
- **no poster** — **not** a defect. Posters are deliberately opt-in; most skills will never have
  one and that's correct. This list exists so adding one is a *decision* rather than an oversight.
  Do not read it out as a to-do list, and do not offer to generate the whole backlog — that's the
  meta-tooling trap. Raise a skill here only if it's genuinely load-bearing and undersold.

Then per **changed** atom: if a skill's behavior moved this session (a new flag, a delegation, a
retired dependency), its poster's **hook, proof, or receipt may now be a lie**. Check the posters
of skills you touched in Phases 2–5 specifically — those are the ones with real drift.

### Verify the render before moving on

These are live pages — a broken edit is invisible in a diff. Always re-render **every viz you
touched**:

```bash
V="$HOME/.claude/skills/viz/viz.ts verify"
BASE=http://127.0.0.1:5180/Desktop/Desktop/Code/ai-setup/viz-pages

# ONE AT A TIME. See the caveat below — never run these concurrently.
bun $V "$BASE/rascal-ai-setup-tour/"            # tour: render only
bun $V "$BASE/skill-<atom>/" --og               # poster: ALSO regenerates og.auto.png
```

Require **`✓ 0 error(s)`**, then read `.verify/<viz>/latest.png` and confirm the layout holds (no
overflowing labels, no orphaned arrows). Fix anything you find before Phase 9 — these are
committed and deployed there.

⚠️ **Two traps, both learned the hard way:**

1. **Two verifies of the SAME viz at once clobber each other.** Each viz writes to its own
   `.verify/<viz>/`, so subagents verifying different pages in parallel are safe; two runs on one
   page share that folder and you may read the other run's screenshot. Verify one page serially.
2. **A poster's `og.auto.png` does not regenerate itself.** Edit a card and the *page* updates
   while the unfurl image stays stale — so chat keeps previewing the old pitch. Any poster whose
   card changed **must** be re-run with `--og`. Confirm it's still exactly 1200×630:
   `sips -g pixelWidth -g pixelHeight <og.auto.png>`.

   ⚠️ **`og.auto.png` is git-ignored** (`viz-pages/.gitignore`) — it is a **build input on disk**,
   not a tracked artifact. Two consequences: committing is not what makes it live (`deploy.sh`
   reads `viz-pages/` **off disk**, so regenerate *before* deploying, not before committing); and
   a **fresh clone has no OG images at all** until `--og` is re-run per viz, which silently
   degrades every unfurl and the lobby's grid thumbnails + auto-montage. If you ever publish from
   a clean checkout, regenerate first.

**Golden rule still applies:** present each change individually. Don't rewrite a page wholesale,
and don't auto-apply.

