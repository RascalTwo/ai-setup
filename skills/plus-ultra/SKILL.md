---
disable-model-invocation: true
name: plus-ultra
description: Go beyond a finished piece of work — surface what it would take to make it genuinely better, priced, ranked, and honest about what is not worth doing. Mines the compromises already made (trimmed scope, TODOs, skipped tests, "good enough for now") before inventing anything, and is allowed to conclude "ship it". Use when the user says "plus ultra", "/plus-ultra", "go beyond", "how could this be better", "what would you do to make this even better", "if we went further", "what did we leave on the table", "level this up", or asks what to do next on something just finished. Homophones "plus ultra", "plusultra", "plus alta" all mean plus-ultra. Fires AFTER work is declared done — it does not shape the plan (that is `grilling`) or test the decision (that is `steelman`).
---

# Plus Ultra — what it would take to go beyond

## Prime directive — the list is allowed to be empty

"Could this be better?" is a question a model essentially never answers *no* to. Asked
in prose it fills a list every time, blending the two or three real gaps with however
many plausible extras it takes to look responsive. A list that always fills carries no
information — the user cannot tell which entries are load-bearing, so the whole answer
degrades into noise.

The work here is therefore not *generating* improvements. It is making each one **earn
its place**: retrieval before invention, a price on every line, and a genuine option to
conclude the thing is done. **"Nothing — ship it" is a valid output, and sometimes the
correct one.**

## 1. Debts before ideas

Open by *remembering*, not brainstorming. Whoever just did the work is already sitting
on a ledger of compromises they made and moved past:

- scope trimmed to fit — "the simple version for now"
- `TODO`, `FIXME`, stubs, hardcoded values, magic numbers
- error paths left unhandled, edge cases acknowledged and skipped
- tests unwritten or written shallow; a manual check done in place of an automated one
- a workaround chosen over the real fix, and the reason
- anything the work rests on that was *assumed* rather than verified

Walk the session and the diff and collect these first. This is the highest-value
material in the skill, and the part the user cannot get by asking the question
conversationally — a cold brainstorm reaches for what is *interesting* rather than what
is *actually missing*.

If the work is not in context — an older change, a different session — read the artifact
before saying anything: the diff, the files, the test output, the issue it came from.
Speculating about code you have not looked at is how the filler gets in.

## 2. Then invent

Once the ledger is exhausted, reach for what nobody has considered: the direction the
work could take, the capability adjacent to what was built, the change that would make
it *good* rather than merely correct. This is the fun part and it is deliberately
second, because ideas crowd out debts whenever they go first.

## 3. Price every line

Each entry carries an effort estimate and what it buys. "Add retry with backoff · ~20
min · removes the most likely production page" beats "improve error handling" by an
enormous margin — the second one hands the entire judgment back to the user, which is
the labour they invoked this to be spared. Where you genuinely cannot estimate, say so
in place of the price rather than dropping it silently.

## 4. Three buckets

Report in exactly these three, most valuable first within each:

- **Debts** — the work fails at something it was *already supposed to do*; a bar was set
  and the work came in under it. The compromises from step 1, each with its price and
  the risk of leaving it standing.
- **Beyond** — the work does what it was supposed to do, and this would make it do
  *more*. Nobody promised it. Ranked by value over effort.
- **Gold-plating** — what you considered and are **not** recommending, with the reason.
  It points the same direction as **Beyond** and is the reason that bucket needs
  policing: same apparent ambition, negative value once the price is on it.

Sorting test: **was it promised?** Promised-and-missing is a debt; never-promised is
**Beyond**. They divide this way because they are answered by different questions — a
debt is a *risk* call (what breaks if this stays?), a **Beyond** is a *value* call (is
this worth building versus anything else?). Merged into one ranked list, a shiny idea
outranks a missing error handler and the user has to re-sort by hand, which is the
labour this skill exists to spare them.

The third bucket is what makes the other two credible. Naming what you rejected is the
clearest available evidence that you were selecting rather than listing, and it is often
the most useful section on the page: it tells the user which tempting directions are
traps.

## 5. The verdict

Close on a single call — the one thing to do next, or "nothing — ship it." A call, not a
summary of the buckets. Then stop. This skill proposes; it does not execute. Wait for
the user to choose before building anything.

## Where ponytail ends and this begins

`ponytail` runs by default on coding work and strips scope: YAGNI, stdlib over custom,
one line over fifty. This skill is its opposite lens — which is precisely why it is
invoked rather than standing, since the two cannot run at once.

The trap is treating everything ponytail cut as a debt. It is not. A deferral that was
*correct* stays correct, and re-listing it turns this skill into an undo button for the
one that just did its job. A debt is where the work fails at what it was actually
supposed to do. Scope deliberately deferred belongs under **Beyond** only if the reason
to defer it has since weakened — and nowhere at all if it has not.

## When the list feels like filler

The lazy default is reviewing your own work in-context — free, instant, usually enough.
Its weakness is that the author of a piece of work is the worst-positioned party to see
what it is missing; you already judged each of those calls fine once. When the buckets
come out thin, or suspiciously flattering, escalate: spawn an **independent subagent
that has not seen your reasoning**, and give it only the artifact and the goal it was
meant to serve. What it flags that you did not is exactly the material your own
investment hid. Reserve this for work that matters — on a small change the in-context
pass is the right amount of effort.
