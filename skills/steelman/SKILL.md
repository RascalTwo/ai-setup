---
name: steelman
description: Pressure-test a decision, plan, or claim by building the STRONGEST possible case both for AND against it, then handing the human the verdict. Defeats your own motivated reasoning — the AI argues at full strength on the side you're least able to argue yourself. Use when the user says "steelman this", "/steelman", "steel-man", "stress-test this decision", "argue against this", "red-team my plan", "what's the best case against this", "poke holes in this", "am I fooling myself", or before/after committing to something consequential. Homophones "still man", "steal man", "steelman" all mean steelman. NOT the same as grilling (which interviews YOU); this one argues so YOU can judge.
---

# Steelman — argue both sides at full strength, let the human judge

The point of this skill is to defeat **the user's own motivated reasoning**. Once a
person has decided they want something, they are the worst-positioned person alive to
build the case against it — they're invested in the conclusion. That's not a flaw, it's
how minds work. So the AI does the thing the user *can't* do well: construct the
strongest possible opposition at full strength, with zero ego in the outcome.

## Prime directive

**You are the advocate. The human is the judge.** You build both cases as powerfully as
an intelligent partisan would. You do **not** get to decide which wins — you generate the
argument space so the human can decide *well*. The only time you pull the human in
mid-flight is for a fact or assumption you genuinely cannot resolve yourself (a "crux").

This is the inverse of `grilling`: grilling interviews the human to pull *their*
decisions out one question at a time; steelman does the arguing *for* them and only taps
them where their private knowledge or values are the deciding factor. They compose —
grill to shape a plan, steelman to pressure-test it.

Works two ways, same flow: **before** a decision (a pre-mortem — catch it before you pay
for it) or **after** something's built/decided (a red-team). The user says which, or it's
obvious from context.

## Flow

1. **Pin the claim.** State the one thing under debate in a single crisp sentence — the
   decision, plan, or belief. If it's fuzzy or compound, sharpen it (or split it) first;
   a vague claim produces vague arguments. Confirm the sentence with the user if there's
   any ambiguity.

2. **Resolve what you can; flag what you can't.** Look up every *fact* that's knowable
   from the codebase, the web, or memory — do not ask the user things you can find. Note
   the *assumptions* the claim rests on; those are candidate cruxes for step 5.

3. **Strongest case FOR.** Argue *for* the claim as its most capable proponent would —
   the real reasons it's right, the upside, the cost of *not* doing it. No faint praise.

4. **Strongest case AGAINST.** Now argue *against* it at equal strength — the best
   objection, the failure mode, the thing the user is motivated not to see. **No
   strawmen.** If the against-case comes out soft or symmetric with the for-case, you're
   going easy on yourself — see *When opposition feels soft* below.

5. **Surface the cruxes.** Name the few load-bearing points where the decision actually
   turns — the assumptions that, if flipped, flip the answer. For any crux that hinges on
   something only the user knows (their risk tolerance, private context, values, plans you
   can't see), **ask them that one thing.** One crux at a time, not a barrage. Everything
   you *could* resolve yourself, you already did in step 2.

6. **Hand over the verdict.** Present the two cases and the cruxes compactly, then **stop
   and let the user decide.** You may offer a single, clearly-labeled *tentative lean*
   ("if forced, I'd lean X, because crux Y") — but it's subordinate to their call, never a
   substitute for it. Do not proceed to act on the outcome until the user has judged.

## When opposition feels soft

The lazy default is you arguing both sides in-context — free, instant, usually enough.
Its weakness: it's one mind arguing with itself, and can produce a polite, symmetric
both-sides where nothing lands. When the against-case feels toothless on a decision that
matters, escalate: spawn an **independent subagent whose *only* mandate is to kill the
idea** — a dedicated prosecutor with no obligation to be fair. Its independence is the
whole value; feed its best shots back into step 4. Reserve this for consequential calls;
for small ones the in-context pass is the right amount of effort.
