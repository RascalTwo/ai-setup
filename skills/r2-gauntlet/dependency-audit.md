---
name: dependency-audit
description: Deterministic dependency, CVE, license, and abandonment audit for a single repo. Detects ecosystems (npm/python/go/Actions/containers), runs the matching scanner, and emits high-precision findings. Used by r2-gauntlet's deterministic floor, or standalone to audit one checked-out repo's dependencies.
---

# dependency-audit

High-precision, **deterministic** dependency findings for ONE checked-out repo.
Dependencies are the best good-first generators and the worst place to guess —
so every finding here comes from a tool, not judgment. Run from the repo root.

## 0. Defer to existing automation

If `.github/dependabot.yml` or `renovate.json*` exists, the repo already manages
staleness. Do **not** re-file every outdated dep — emit at most ONE finding only
if such config is *absent* (`type: hygiene-no-dependabot`, bucket `good-first`).

## 1. Detect ecosystems

Presence of a manifest = that ecosystem is in play. Check for:

| Manifest | Ecosystem |
|---|---|
| `package.json` | npm / yarn / pnpm |
| `requirements*.txt`, `pyproject.toml`, `Pipfile` | python |
| `go.mod` | go |
| `pom.xml`, `build.gradle*` | java |
| `.github/workflows/*.yml` | GitHub Actions |
| `Dockerfile`, `*.dockerfile` | container |

## 2. Run the matching scanner

Tools are invoked via the local binary / `pipx` / `brew` — none are assumed installed
globally. If a tool can't run, say so in the finding's evidence and fall back to a
manifest read; never fabricate a version.

**`osv-scanner` privacy rule (MANDATORY):** `osv-scanner` is a Go binary (`brew install
osv-scanner`), **NOT an npm package** — `npx osv-scanner` 404s, never use it. **ALWAYS run
it offline** with `--offline --download-offline-databases`: that pulls the FULL vulnerability
DB to disk and matches on-machine, so **your dependency list is never sent to `osv.dev`**.
Plain `--offline` alone never refreshes the DB; the `--download-offline-databases` flag
re-pulls the whole DB each run (a bulk fetch that reveals nothing about your project) so
matches stay current. Confirmed identical results to an online scan.

- **npm/yarn/pnpm:** `npm outdated --json` (staleness) + `osv-scanner scan source --offline --download-offline-databases --lockfile=package-lock.json --format json` (CVEs). No lockfile → `... --offline --download-offline-databases -r . --format json`.
- **python:** `pipx run pip-audit -f json` (CVEs) + `pipx run pip-audit --outdated` if available; else `osv-scanner scan source --offline --download-offline-databases -r . --format json`.
- **go:** `go run golang.org/x/vuln/cmd/govulncheck@latest ./...` ; staleness via `go list -u -m -json all`.
- **java:** `osv-scanner scan source --offline --download-offline-databases -r . --format json` (reads pom/gradle lockfiles).
- **GitHub Actions:** read each `uses:` ref — flag actions pinned to a floating tag (`@v3`, `@main`) instead of a SHA, and any action whose major version is behind latest.
- **container / cross-ecosystem / license:** `brew list trivy >/dev/null 2>&1 && trivy fs --scanners vuln,license --format json .` — only if trivy is present; it's the heaviest tool, skip silently if absent.

## 3. Currency (staleness — separate from CVEs)

Beyond CVEs, flag EVERY dependency merely behind its latest release. **No threshold** —
one minor behind still counts. Source it from `npm outdated --json` (or the ecosystem
equivalent: `go list -u -m`, `pip-audit --outdated`, gradle/maven versions plugins).

These are INTERNAL findings, not board cards: give each stale dep a `currency: {package,
current, latest, eol}` object (category `chore`, `eol: true` for unmaintained/past-EOL).
The scanner's batcher **collapses every currency finding into ONE "modernize stale deps"
board issue** — they NEVER appear individually, so there is no board noise. The per-dep
granularity exists only so the batch can be **ordered EOL/unmaintained first, then by
major-version distance**.

**Exception — a singular issue when it earns one:** if one upgrade is a substantial
standalone effort (a major framework migration with breaking changes, e.g. `jest` 27→30
across the whole suite), emit it as its own normal finding *without* the `currency` object
(category `chore`/`refactor`, bucket `deep`) so it becomes its own card. Routine bumps stay
in the batch; only a real project graduates out. (CVE bumps are a separate mechanism — see
the `affected` / `dependency_bump` fields.)

## 4. License policy (beyond emitting the string)

Flag, as `type: license-copyleft` (bucket `deep`):
- Any **GPL / AGPL / LGPL** dependency in a repo that ships proprietary/client
  code (no OSI license file of its own, or a permissive one).
- **Unlicensed** packages (no license field) pulled as direct deps.

`npx -y license-checker@latest --json --production` (npm) gives the license map.

## 5. Abandonment heuristic (tools miss this)

Flag, as `type: dependency-abandoned` (bucket `deep`):
- A direct dep with **no upstream release in 2+ years**.
- Upstream repo **archived** or carrying a **deprecation notice** (npm shows
  `"deprecated"` in `npm view <pkg> --json`; PyPI/Go show archived upstream).

Check direct deps only (not the transitive tree) to keep it cheap.

## 6. Emit findings

One finding per distinct problem, each with concrete evidence (the command run +
the line of its output). Finding types this skill produces:

- `dependency-stale` — outdated dep, see §3 currency (emit with category `chore` + a `currency` object; the batcher clumps them, EOL-first).
- `dependency-cve` — known CVE (set `affected` + `dependency_bump`; affected → own issue, not-affected → batched — see the scanner schema).
- `dependency-abandoned` — see §5 (deep).
- `license-copyleft` — see §4 (deep).
- `hygiene-no-dependabot` — see §0 (good-first).
- `actions-unpinned` — floating/outdated Action ref (good-first).

Return these to the caller, which verifies and dedups them. Do not write
to GitHub from this skill.
