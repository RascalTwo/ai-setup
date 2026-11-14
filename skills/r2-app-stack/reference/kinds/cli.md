# Command-line tool or repo script

Read [`../shared.md`](../shared.md) and [`../test-stack.md`](../test-stack.md) first. Python tools: [`python.md`](python.md).

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| Node 24 running TypeScript directly (`#!/usr/bin/env node`, type stripping, no build) | one runtime, no build to drift; Bun is being dropped | Wizard Studio ("Node runs every script"), Airtable, Loan Bank `check.ts` and `ops/*.ts` | `engines` field |
| Scripts are linted, formatted and type-checked like the app (their own `tsc -p` program) | scripts break as easily as the app | Timeline Studio `scripts/`, Wizard Studio `scripts/` | check command |
| Tests run the real CLI as a user would: a throwaway HOME, git repo or temp dir, and fake programs on `PATH` for anything it shells out to | black box at the CLI's own surface | ai-setup `tools/kelpie/kelpie.test.ts`, retinue usher, steno `fake_ssh.py` | check command |
| A tool or script a person runs that writes, deletes or deploys has a dry run (`--dry-run`, or dry-run by default); a deploy-on-push pipeline is exempt | see what it would do before it does it | Wizard Studio `deploy.sh`, Airtable deploy, sai-github-automations, retinue usher, rascaltwo.com `cleanup-images.yml` | review |
| Required settings fail at start with the setting's name | same as every kind | sai-github-automations (`GITHUB_PA_TOKEN`), steno (`STENO_DATA`) | a test |

Existing Bun tools (`#!/usr/bin/env bun`: ai-setup `tools/`, viz, pairwise-sorter) move to Node when touched; the adopt step lists them.
