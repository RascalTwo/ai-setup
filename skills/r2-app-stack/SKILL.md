---
name: r2-app-stack
description: "Joseph's application stack: the language, runtime, framework, lint, format, types, test runners, coverage, visual checks and gates he uses, by kind of app (web app, server, CLI, Python). Use when starting a new app, script, service or repo; choosing a library, framework or tool; setting up tests, lint, types or CI; making a test findable by role; or when asked to \"get this in line with my stack\"."
rascaltwo-ai-setup:
  kind: skill
  state: false
---

# App stack

What Joseph builds with, so a new app starts from his choices instead of from memory. Every standard here comes from two or more of his recent repos (newest wins on a split) or from a decision he made with evidence; each names its sources and where it's enforced. How to test well (scope, stand-ins, flakiness, what coverage means) lives in `r2-testing-paradigm`; this skill says which tools carry it out.

For people: the poster's explorer at `viz-pages/skill-r2-app-stack/` renders this skill from these files, so what a person sees and what you read cannot drift apart.

## Every rule applies to everything

The shared files apply to anything you build: an app, a script, a library, a content site, a one-off tool. The kind pages only add detail. A thing that isn't a listed kind still gets every shared rule; it just has no extra page yet.

## Name the kind, then read

| Building | Read |
|---|---|
| anything in TypeScript | [`reference/shared.md`](reference/shared.md) |
| anything with tests (all of it) | [`reference/test-stack.md`](reference/test-stack.md) |
| anything a person or browser uses (a UI) | [`reference/testable-apps.md`](reference/testable-apps.md) |
| a browser web app | [`reference/kinds/web-app.md`](reference/kinds/web-app.md) |
| an HTTP API, Lambda, or long-running server | [`reference/kinds/server.md`](reference/kinds/server.md) |
| a command-line tool or a repo script | [`reference/kinds/cli.md`](reference/kinds/cli.md) |
| anything in Python | [`reference/kinds/python.md`](reference/kinds/python.md) |
| a content site, published library, browser extension | the shared files only; no kind page yet |
| an existing repo: "get this in line with my stack" | [`reference/adopt.md`](reference/adopt.md) |

A repo often holds several kinds (a web app plus its API plus scripts): read each.

## How a standard is written

Each standard is a rule, a one-line reason, the repos it comes from, and where it is enforced (a lint rule, a gate in the check command, or "not enforced yet"). "Candidate" means one repo does it: use it if it fits, but it isn't a rule. "Not decided yet" means Joseph parked it: record what the repo does and ask before standardising.

## Custom glue

Some standards need code no package provides (the coverage kit, the screenshot approval step, the step helpers). Until it is packaged, copy it from the repo named as its source and keep it under `scripts/` or `test-kit/`. Each piece is marked **to be packaged**: Joseph will extract them into npm and Python packages under the RascalTwo GitHub account once his repos follow this skill. Write as little as the requirement allows, and never drop a requirement because no package does it.

## Changing this skill

A new standard needs two recent repos agreeing, or Joseph's decision. Record the evidence (repo, file, date) next to the rule. When a repo's newer choice contradicts a standard, raise it with Joseph rather than editing either.
