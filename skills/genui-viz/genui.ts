#!/usr/bin/env bun
// genui.ts — put a generative UI card in front of the human, and get their answer back.
//
//   bun genui.ts show <spec.json | '{...}' | -> [--pane <id>] [--no-wait] [--timeout <s>] [--json]
//   bun genui.ts wait <card> [--timeout <s>] [--json]
//   bun genui.ts ls [--pending] [--json]
//
// show opens the card (the floating panel glued to the herdr pane --pane, default $HERDR_PANE_ID,
// when helper/ is built; else a browser tab) and waits for the answer, printing one line:
// `✓ <card>: <what was sent>` (display cards: `✓ <card>: shown`, at once). Every card stays in the genui viz with its answer, to look back on.
// The behaviour is lib.ts; this file is the interface.

import { parseArgs } from "node:util";
import {
  addCard,
  answerFor,
  cardUrl,
  cards,
  displayOnly,
  ensurePage,
  openCard,
  parseSpec,
  summarize,
  waitAnswer,
} from "./lib.ts";
import type { Answer, Card } from "./lib.ts";

const USAGE = `usage:
  genui show <spec.json | '{...}' | -> [--pane <id>] [--no-wait] [--timeout <s>] [--json]
  genui wait <card> [--timeout <s>] [--json]
  genui ls [--pending] [--json]`;

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

async function readSpec(arg: string): Promise<string> {
  if (arg === "-") return Bun.stdin.text();
  if (arg.trimStart().startsWith("{")) return arg;
  const f = Bun.file(arg);
  if (!(await f.exists())) throw new Error(`no such spec file: ${arg}`);
  return f.text();
}

function report(json: boolean, card: Card, answer?: Answer): void {
  const summary = summarize(card, answer);
  if (json)
    console.log(
      JSON.stringify({ card: card.id, url: cardUrl(card.id), answered: Boolean(answer), answer, summary }),
    );
  else
    console.log(
      answer || displayOnly(card.spec) ? `✓ ${card.id}: ${summary}` : `… ${card.id}: no answer yet — genui wait ${card.id}`,
    );
}

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    pane: { type: "string" },
    "no-wait": { type: "boolean" },
    timeout: { type: "string" },
    pending: { type: "boolean" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});
const [verb, arg] = positionals;
const json = o.json === true;
if (o.help || !verb) {
  console.log(USAGE);
  process.exit(verb || o.help ? 0 : 2);
}

try {
  await ensurePage();
  if (verb === "show") {
    if (!arg) fail(USAGE);
    const spec = parseSpec(await readSpec(arg));
    const card = await addCard(spec, o.pane ?? process.env["HERDR_PANE_ID"]);
    const shown = openCard(card);
    // A display card has nothing to wait for: it stays up until Done, the agent moves on.
    if (o["no-wait"] || displayOnly(spec)) report(json, card);
    else {
      const answer = await waitAnswer(card.id, Number(o.timeout ?? 600) * 1000);
      if (!answer) shown?.kill(); // nobody's listening any more; don't leave it floating
      report(json, card, answer);
    }
  } else if (verb === "wait") {
    const card = cards().findLast((c) => c.id === arg);
    if (!card) fail(`ERROR: no card ${arg ?? ""}`);
    report(json, card, await waitAnswer(card.id, Number(o.timeout ?? 60) * 1000));
  } else if (verb === "ls") {
    const rows = cards()
      .toReversed()
      .map((card) => ({ card, answer: answerFor(card.id) }))
      .filter((r) => !o.pending || !(r.answer || displayOnly(r.card.spec)));
    if (json) console.log(JSON.stringify(rows));
    else if (rows.length === 0) console.log(o.pending ? "no cards waiting" : "no cards yet");
    else
      for (const { card: c, answer } of rows)
        console.log(`${c.id}  ${c.spec.title}  —  ${summarize(c, answer)}${c.pane ? `  (${c.pane})` : ""}`);
  } else fail(USAGE);
} catch (e) {
  fail(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
}
