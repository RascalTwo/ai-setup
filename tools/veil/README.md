---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: delete
  integrates:
    claude-code: [PostToolUse, statusline]
  requires:
    commands: [python3, ollama]  # plus `ollama pull d1:2b`
---

# veil

Hides private content from Claude. After every tool call (Bash, Read, WebFetch, browser, MCP, in subagents too), a local decision model (Liquid's `d1:2b` on Ollama: `ollama pull d1:2b`) reads the output in chunks and gives each one a probability that it reveals something on a private list written in plain English; 0.15 or higher blocks it. Blocked chunks become `[veil: withheld]` (a withheld picture for images) before Claude sees them; the session transcript on disk stores the cleaned version too.

## The private list

`~/.config/veil/private.md`, plain English, one thing per line:

```markdown
- My health: doctors, prescriptions, test results, pharmacy orders
- Anything to, from, or about <person>
- Gifts I'm buying for <person>
```

It lives outside every repo, and Claude must never read it. Three things back that up: veil withholds the whole output of any tool call that mentions `config/veil`, withholds any chunk that contains a line of the list, and only the local model ever reads it.

## Fail closed

Claude Code passes the **original** output through when a hook crashes, times out, prints invalid JSON, returns a replacement of the wrong shape, or exits 2 (all tested on 2.1.314). So veil never relies on Claude Code to fail closed:

- Any error while judging (Ollama down, bad model reply) withholds every string and image in the output, keeping its exact shape.
- A watchdog withholds everything at 60 s, whatever is still running. The hook's Claude Code timeout is 90 s so veil always answers first.
- When it fails closed it writes `~/.agents/state/veil/down` (the statusline turns yellow) and shows a macOS notification, at most once per 5 minutes.

## Switching it on

**Off by default.** With d1 the eval's ~120 chunks take ~17 s, but it over-blocks 12–29% of innocent chunks (see Eval), and a very large output can still hit the 60 s deadline and withhold everything.

```bash
veil on           # this herdr pane
veil off
veil on --all     # everywhere (a pane's own "veil off" still wins there)
VEIL=on claude    # one session, from the environment (VEIL=off forces it off)
veil status       # on | off | down
```

The full path is `~/.agents/ai-setup/tools/veil/veil`. Claude may switch it only when you ask in chat.

## Statusline

`tools/statusline/statusline-veil.sh`: 👁 on (watching) · grey 🙈 off (the default) · yellow 👁⚠ failing closed.

## How chunks are cut

- A list item or parsed-JSON record small enough to judge whole (an email, an order) gets one vote, so a sender and its subject are judged together.
- Text goes by paragraph; a long paragraph, or one of 8+ lines (CSV, `ls`, logs, pages without blank lines), goes line by line.
- When d1 flags a multi-line chunk, each line is judged again and only the flagged lines are withheld; a record whose text is JSON (an MCP result) is re-judged record by record. If no part is flagged, the private bit is in the combination and the whole chunk goes. Ordinary record fields (an email's sender and subject) are never split up.
- Images get one vote each and are withheld whole.
- Count fields are not rewritten; the withheld marker sits where the item was.

## Eval

`python3 eval/run_eval.py [model:think ...]` (default `d1:2b:0`) scores models on fake Gmail, Amazon orders, notes, `ls`, a bank CSV, git log, an article and screenshots (about 120 chunks) against `eval/private-test.md` (`VEIL_EVAL_POLICY` swaps the list), and writes a report to `~/.agents/state/veil/`. `VEIL_EVAL_FIXTURES=heldout` swaps in `eval/heldout.py`: new people, items and sources on the same topics that nothing was tuned on. The bar: zero leaks; over-blocking as low as it goes.

Results on a 36 GB Mac (2026-11-01; the 0.15 threshold was picked on `fixtures.py`, then checked on `heldout.py`):

| judge | list | leaks (eval / held-out) | over-blocked (eval / held-out) | time (eval) |
|---|---|---|---|---|
| **d1:2b, p ≥ 0.15, flagged chunks re-judged by line** (default) | default | **0 / 0** | 8/37 / 4/32 | ~17 s |
| same | specific | **0 / 0** | 11/37 / 9/32 | ~19 s |
| d1:2b, p ≥ 0.15, whole chunks only | default | 0 / 0 | 9/37 / 7/32 | ~13 s |
| d1:2b, p ≥ 0.15, whole chunks only | specific | 0 / 0 | 14/37 / 12/32 | ~14 s |
| qwen3.5:9b | default | 3 / 2 | 2–8% / 3/32 | ~72–115 s |
| qwen3.5:9b | specific | 2 / 4 | — / 3/32 | ~83 s |
| d1:2b as a gate in front of qwen3.5:9b | default | 3 / — | — | — |

Older results (2026-10-30):

| strategy | leaks | over-blocked | time |
|---|---|---|---|
| qwen3.5:9b, one chunk per call | 3 (2 with `private-test-specific.md`) | 2–8% | ~115 s |
| qwen3.5:9b, 8 chunks per call | 18 | 21% | 46 s |
| gemma4:12b | 3 | 5% | 2113 s |
| any model with thinking on | — | — | minutes per page: unusable |

## Known limits

- **d1 over-blocks 12–29% of innocent chunks**, mostly one-line items with nothing private in them (calendar events, single orders), which re-judging by line can't rescue. That is the price of its zero leaks; set `MODEL = "qwen3.5:9b"` in `veil` for fewer over-blocks but leaks and ~6x the time.
- **Wording outside the list moves d1 a lot.** A list header saying it was a FAKE eval list cut over-blocks from 13 to 6, so treat any number measured with extra framing as flattered.
- **The model only knows what a small model knows.** It passed "Cracking the Coding Interview" under "job hunting, interview prep" because it didn't know the title is an interview book; spelled out, it blocks it. Write the list concretely (name the people, products and kinds of documents), and treat it as a strong filter, not a guarantee.
- **Wording matters.** "statements, balances and debts" let a payroll-deposit row of a bank CSV through; "statements and transactions (any deposit, payment or charge)" blocked it.
- **Ollama runs one request at a time here, and finishes requests from killed clients.** Other local-model work (or a killed run) can push veil past 60 s, so it fails closed until the queue drains.
- Withheld items leave a marker in place; counts in the output (e.g. `resultSizeEstimate`) are not rewritten.
