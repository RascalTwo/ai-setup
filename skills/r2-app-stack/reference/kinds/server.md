# Server or API

Read [`../shared.md`](../shared.md) and [`../test-stack.md`](../test-stack.md) first. Python servers: [`python.md`](python.md).

## Where it runs

**Serverless (AWS Lambda) where it can; a long-running Node server only when it must**, mainly for WebSockets or a connection that outlives a request. **Why:** nothing to keep alive or patch. **Sources:** Wizard Studio and Airtable (Lambda handlers); Timeline Studio sync server (long-running, WebSockets); Joseph's decision 2026-11-07.

## Framework: Hono

**Rule:** Hono 4 with `@hono/zod-openapi`. One route definition (zod schemas for params, query, body and each response status) gives request checking (bad input → 400), typed handler inputs, typed responses (a wrong status or body fails `tsc`), an OpenAPI 3.1 document, and a typed client (`hc`) with no generation step.

**Why:** type safety from one definition, which Joseph ranks first; the same app runs on Lambda (`@hono/aws-lambda`) and as a Node server (`@hono/node-server`, WebSockets via `@hono/node-ws`), so moving between them is not a rewrite; tests call `app.request()` in-process with no port; the smallest Lambda footprint of those tried (core 24 KB, 73 ms import).

**Sources:** hands-on comparison 2026-11-07 (Hono, Fastify, oRPC built the same API: validation, 404, OpenAPI, typed client with a deliberate type error caught, in-process test, Lambda handler on a synthetic API Gateway v2 event, WebSocket echo; all passed under TypeScript 7 strict).

**Known friction:** `@hono/aws-lambda`'s event types clash with `@types/aws-lambda` under `exactOptionalPropertyTypes`; a small adapter function bridges them. `hono/aws-lambda` is deprecated in favour of `@hono/aws-lambda`. The typed client slows the editor as routes grow; split clients per sub-app.

**Risk and fallback:** Hono is mostly one maintainer with no foundation behind it (its headline download count is mostly the MCP SDK depending on it; `@hono/zod-openapi` at about 4.3M a week is the direct-use signal). If that becomes a problem, the fallback is **Fastify 5** with `@fastify/type-provider-zod` (OpenJS Foundation, several maintainers; Timeline Studio uses it). Its typed client comes from the OpenAPI document via `openapi-typescript`, which crashed on TypeScript 7 in November 2026. Express 5 has no built-in request checking or typing, so it doesn't meet the bar.

**Existing servers** on another framework (Express, Fastify, Next.js API routes) keep it until a framework move is its own task; new servers start on Hono.

**Enforced:** not enforced yet.

## Other rules

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| A plain bundled handler for a Lambda: esbuild, minified, one file | small cold start | Wizard Studio (Slack Lambda), Airtable | build script |
| Required config is checked with zod at startup; a missing setting exits non-zero naming it | fail before serving anything | Timeline Studio `s3.ts`, sai-github-automations, scratch servers | a test |
| The API schema is generated from the routes and pinned by a test; clients' types come from it | the client can't drift from the server | Timeline Studio `test/openapi.test.ts`, Loan Bank `docs/openapi.json` → `api.types.ts`, steno `api-types.sh` | a test |
| Tests boot the real app in-process (`app.request`) against fakes of what it doesn't own (storage, third-party APIs) | the most real stand-in short of production; no ports | Timeline Studio (real `server.ts` + in-process `fake-s3.ts`), Airtable `handlers.test.ts`, steno, Loan Bank (Testcontainers) | check command |
| The Lambda entry is tested by invoking it with a synthetic API Gateway event | proves the adapter, not just the app | scratch servers | check command |
