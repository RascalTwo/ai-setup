# Python

A full standard, as strict as the TypeScript one: every TypeScript practice in [`../shared.md`](../shared.md) and [`../test-stack.md`](../test-stack.md) has its Python counterpart here. Testable-app rules ([`../testable-apps.md`](../testable-apps.md)) apply to Python services too.

## Contents

- Runtime and dependencies
- Types
- Lint and format
- Tests and coverage
- The check command
- Services

## Runtime and dependencies

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| Python ≥ 3.12; standard library only where it can be (a launchd daemon needs no venv) | nothing to install or break | retinue (steno core `deps=[]`, usher `dependencies = []`), ai-setup tools | not enforced yet |
| uv for anything with dependencies; `uv.lock` committed; checks run with `uv run --locked` | reproducible installs | steno, mcp-entra-proxy, unified-graph-mcp `mcp/`, usher (`uv run --script`) | check command |
| Exact pins for the toolchain (`uv add --dev --bounds exact`) | an upgrade is a deliberate change, especially for ruff, whose preview rules change between versions | steno; same rule as TypeScript | not enforced yet |

## Types

**Rule:** basedpyright with `typeCheckingMode = "all"` (every check an error), over source, tests and scripts in one run.

```toml
[tool.basedpyright]
typeCheckingMode = "all"
pythonVersion = "3.13"
```

**Why:** it caught the most of 34 planted bugs (basedpyright 31, mypy 29, Pyrefly 26, pyright strict 24, ty 23) and is the only one with every hygiene check built in: leaking `Any`, unreachable code, missing `@override`, unused and bare ignore comments, import cycles. **Sources:** hands-on comparison 2026-11-07 (`poc-python/`); steno used pyright at `basic`.

- Ignore comments name the rule and give a reason: `# pyright: ignore[reportAny] -- json gives untyped data`. Plain `# type: ignore` is not honoured in `all` mode.
- Rules switched off for a whole repo go in a reason map, as in TypeScript. The two noisy on clean standard-library code were `reportUnusedCallResult` and `reportAny`.
- Adopting on existing code: record today's findings with basedpyright's baseline, so only new problems fail, then pay the baseline down.
- **Risk and fallback:** basedpyright's own additions are mostly one maintainer, on top of Microsoft's pyright (about 13.8M downloads a month). If it stalls, use pyright with its optional checks on (28 of 34 in the comparison). ty (Astral) was beta with checks that may change between releases; look again when it is stable.

**Enforced:** check command; a test pins the setting.

## Lint and format

**Rule:** ruff with every rule on, preview rules included for lint, a reason on every rule switched off, stale `noqa` failing; `ruff format` with defaults except line length.

```toml
[tool.ruff]
line-length = 120

[tool.ruff.lint]
select = ["ALL"]
preview = true  # pinned ruff version, so new preview rules arrive only on a deliberate upgrade
ignore = [
    "COM812",  # conflicts with ruff format (ruff formatter docs)
    "D203",    # mutually exclusive with D211
    "D213",    # mutually exclusive with D212
]

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S101"]  # pytest uses assert
```

**Why:** the same "every category on, every exception explained" rule as oxlint. Line length 120 is Joseph's default. **Sources:** steno `pyproject.toml` (ignores with reasons), mcp-entra-proxy; comparison 2026-11-07 (preview adds 142 rules; only `COM812` conflicts with the formatter). **Enforced:** check command.

- Inline: `# noqa: S603 -- arguments are a fixed list`. RUF100 fails stale ones. Neither ruff nor the type checker requires the reason, so a small meta-test checks every `noqa`, `pyright: ignore`, `pragma: no cover` and `fmt: skip` carries ` -- ` and text. **To be packaged.**
- A meta-test keeps the reasons non-empty and proves ruff and basedpyright ran, as in TypeScript.

## Tests and coverage

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| pytest for anything with a `pyproject.toml`, with `strict = true`; a single-file tool keeps one `test_x.py` run directly | the runtime's usual runner; strict catches mistyped markers and ids | steno, mcp-entra-proxy, unified-graph-mcp `mcp/`; ai-setup `test_*.py` | check command |
| Tests run the real program against a throwaway HOME and fake programs on `PATH`; `conftest.py` strips inherited env such as `GIT_*` | black box, nothing leaks in from the machine | steno (`fake_ssh.py`, `conftest.py`) | check command |
| Given / When / Then step helpers and the living spec, as in [`../test-stack.md`](../test-stack.md) | same reasons as TypeScript | Joseph's decision | lint (to build) |
| coverage.py with `branch = true`; a floor that only rises; 100% on the pure core; `# pragma: no cover -- reason` | same coverage rules as TypeScript | steno (`fail_under=90` ratchet), team accelerator (`--fail-under=100`) | check command |
| Per-test coverage both ways, using coverage.py's dynamic contexts (`dynamic_context = "test_function"`) | same as TypeScript | not yet built in Python | to build |
| mutmut on the pure core; survivors killed or `# pragma: no mutate -- reason` | proof the tests can fail | `r2-testing-paradigm` names it | not enforced yet |

## The check command

One `./check` (or `check.py`) runs format check, lint, types, tests with coverage, cheapest first, every step even after a failure, then exits non-zero if any failed. A fast mode for the pre-commit hook, a full mode for CI, a versioned hook installed by a script. **Sources:** steno `./check`; ai-setup `scripts/check.ts` for the fast mode and hook. Steno has no fast mode and no CI yet.

## Services

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| FastAPI for an HTTP service | Python's equivalent of the Hono choice: schemas drive validation, types and OpenAPI | steno (FastAPI) | candidate (one repo) |
| Settings via pydantic `BaseSettings`, every setting required, failing at import | fail before serving anything | mcp-entra-proxy, unified-graph-mcp `mcp/` | a test |
| Tests boot the real app in-process against fakes | same as TypeScript servers | steno `tests/ui_fixture.py` | check command |
