# Research — which components genui-viz should borrow

Date: 2026-10-11. Question: grow the genui-viz catalog (today: `choice`, `whatif`) by borrowing from
existing generative-UI systems, with display-only cards as first-class. Every claim below cites a page
that was fetched this session; where a page could not be read, that is said, not guessed.

Fit constraints (from `lib.ts` and `page/panel.ts`): a spec is a JSON object with `type` + `title`
(`TYPES` set in `lib.ts`); a component is `render(root, spec, ctx{live, answer(value), sent})` plus
`summary(spec, value)`; an answer is a flat `Record<string, unknown>` or `{cancelled:true}`.

# Synthesis

## 1. Canonical catalog: who has what

Legend: Y = a named component or schema type exists in the cited source; p = partial or via a
generic container; `-` = not found in the page I read (not proof of absence).

| Kind | Adaptive Cards 1.6 | ChatKit widgets | A2UI basic cat. | MCP elicitation | json-render | Apps SDK / MCP Apps | Claude / ChatGPT visuals |
|---|---|---|---|---|---|---|---|
| text / markdown | TextBlock, RichTextBlock | Text, Title, Caption, Markdown | Text (h1-h5, body, caption) | description only | catalog-defined | HTML | HTML |
| key-value / facts | FactSet | - | - | - | - | HTML | HTML |
| table | Table | - (not in doc) | - | - | - | HTML | HTML |
| list | Container, ColumnSet | ListView, ListViewItem | List | - | - | inline card/carousel | - |
| image | Image, ImageSet | Image | Image, Video, AudioPlayer | - | - | carousel (image required) | HTML/SVG |
| chart | - | - | - | - | - | HTML | HTML (Chart.js/D3/Plotly per press) |
| progress / status | - | Card.status, Badge | - | - | - | - | - |
| confirm / approve | Action.Submit | Card confirm/cancel | Button | action accept/decline/cancel | - | max 1 primary + 1 secondary CTA | - |
| single-select | Input.ChoiceSet | Select | ChoicePicker | string enum / oneOf | Select (example) | HTML | HTML |
| multi-select | Input.ChoiceSet | - | ChoicePicker (array value) | array + items.enum/anyOf | - | HTML | HTML |
| text input | Input.Text | Text(editable), Form | TextField (shortText/longText/number/obscured) | string, minLength/maxLength | - | HTML | HTML |
| number / slider | Input.Number | - | Slider (min/max/value) | number/integer, minimum/maximum | - | HTML | HTML sliders |
| boolean | Input.Toggle | - | CheckBox | boolean | - | HTML | HTML |
| date / time | Input.Date, Input.Time | DatePicker | DateTimeInput (enableDate/enableTime) | string format date, date-time | - | HTML | HTML |
| form | inputs + Action.Submit | Form (`onSubmitAction`) | inputs + Button action | flat object schema | - | HTML | HTML |
| compare / carousel | - | - | Tabs, List horizontal | - | - | inline carousel (3-8 items) | - |
| code / diff | - (no CodeBlock in the 1.6.0 schema file) | - | - | - | - | HTML | HTML |
| raw-HTML escape hatch | - | - | - | - | - | `ui://` text/html;profile=mcp-app | HTML is the whole mechanism |

Sources for the table cells are in the per-system sections. Headline reading: nobody ships a
code/diff or chart component in a declarative catalog; those exist only where the whole UI is
model-written HTML. Facts, table, text, and the input set (text, number, boolean, enum, multi-enum,
date) are the common core.

## 2. Components to build first (ranked for an agent in a terminal)

Shapes keep genui's `type` + `title` envelope. "Borrowed from" names the closest source.

### 1. `confirm` (approve / deny a risky step)
Borrowed from: CopilotKit's `confirmDeletion` HITL example (`respond({confirmed:true})`), the MCP
three-way result accept/decline/cancel, ChatKit `Card` `confirm`/`cancel`, and the ChatGPT rule of at
most one primary and one secondary action.
```json
{"type":"confirm","title":"Delete build/ ?","body":"Removes 212 MB. Not tracked by git.",
 "facts":[["Path","build/"],["Files","1,204"]],"yes":"Delete","no":"Keep","danger":true}
```
Answer: `{"decision":"yes"}` or `{"decision":"no"}`; closing the card keeps the existing
`{cancelled:true}`. This maps one to one onto MCP accept / decline / cancel, so the agent sees the
same three outcomes it already knows.

### 2. `form` (fill these 3 fields)
Borrowed from: MCP elicitation `requestedSchema` verbatim (flat object, primitive properties only).
```json
{"type":"form","title":"Deploy settings","message":"Pick values for the staging deploy",
 "schema":{"type":"object","required":["env"],"properties":{
  "env":{"type":"string","title":"Environment","oneOf":[{"const":"stg","title":"Staging"},{"const":"prod","title":"Production"}],"default":"stg"},
  "replicas":{"type":"integer","minimum":1,"maximum":10,"default":2},
  "tags":{"type":"array","items":{"type":"string","enum":["a","b","c"]}},
  "notes":{"type":"string","maxLength":200},
  "dryRun":{"type":"boolean","default":true},
  "on":{"type":"string","format":"date"}}}}
```
Answer: the submitted object, e.g. `{"env":"stg","replicas":2,"dryRun":true}`. Supported primitives and
formats are the elicitation list (string with `email|uri|date|date-time`, number/integer with
min/max, boolean, enum via `enum` or `oneOf`, multi-select via array). Models already produce this
schema because it is plain JSON Schema, and `validate` can reject bad specs in `parseSpec`.
Do not allow password/API-key fields (the spec forbids them in form mode).

### 3. `notice` (display-only: "here is a result / status")
Borrowed from: Adaptive Cards `TextBlock` + `FactSet`, ChatKit `Card` (`status`) + `Markdown` + `Badge`.
```json
{"type":"notice","title":"Build finished","status":"success","body":"All 212 tests passed in 41 s.",
 "facts":[["Branch","feat/genui"],["Commit","a1b2c3d"]],"ack":false}
```
Display-only contract (new, our design): `ack:false` (default for display types) makes `genui show`
return at once with `✓ c-id: shown`; `ack:true` adds an OK button and answers `{"seen":true}`. No
surveyed system forces an answer on display content: Adaptive Cards has no required action, and
CopilotKit's `useComponent` is display-only with no response.

### 4. `table` (display, optionally pick rows)
Borrowed from: Adaptive Cards `Table`/`TableRow`/`TableCell`/`TableColumnDefinition` (present in the
1.6.0 schema file), ChatKit `ListView`. Our `choice` already has `columns`+`rows`; make `table` the
display form and let `select` turn it into a choice.
```json
{"type":"table","title":"Failing tests","columns":["Test","File","ms"],
 "rows":[["parses empty","a.test.ts","12"],["rejects NaN","b.test.ts","8"]],
 "select":"many","submit":"Rerun selected"}
```
Answer when `select` is `one` or `many`: `{"indexes":[0,1]}`. Existing `choice` answers `{index}`; keep
`choice` as is for old cards.

### 5. `diff` / `code` (here is a patch; apply?)
No catalog I read ships this: Adaptive Cards 1.6.0 definitions list no CodeBlock, ChatKit's page lists
no code or diff widget, A2UI's basic catalog has none. So this one is ours, in the spirit of
`notice` + `confirm`:
```json
{"type":"diff","title":"src/lib.ts","patch":"@@ -1,3 +1,3 @@\n-old\n+new\n","yes":"Apply","no":"Skip"}
```
Answer: same as `confirm` (`{"decision":"yes"}`). `code` is the display-only twin (`lang`, `text`).
Highest value for a terminal agent (a terminal diff is hard to read in a narrow pane) despite having
no precedent.

### 6. `choice` + multi-select (extend existing)
Borrowed from: MCP multi-select enum (`type:"array"`, `minItems`, `maxItems`, `items.anyOf` with
`const`+`title`), A2UI `ChoicePicker` (value is an array of selected strings; `chips` display style).
Add `multi:true` to `choice`. Answer `{"indexes":[...]}`.

### 7. `steps` / checklist status (display)
Borrowed from: ChatKit `Card.status` and `Badge`; Adaptive Cards has `Container`/`FactSet` only. Thin
evidence of a canonical form, so keep it tiny: `{"type":"steps","title":"...","items":[{"label":"lint","state":"done|running|todo|failed"}]}`.
Only worth building if agents ask for progress cards; skip otherwise.

### 8. `html` (escape hatch, last)
Borrowed from: MCP Apps (`ui://` resource, MIME `text/html;profile=mcp-app`, sandboxed iframe, default
`connect-src 'none'`) and Claude custom visuals (the model writes HTML). Render `srcdoc` in a sandboxed
iframe with no network; answer through a `postMessage` to `ctx.answer`. Powerful but loses
the "improving panel.ts redraws every old card" property, so it ranks last.

`whatif` stays. Number/slider alone is covered by `form` (`number` with min/max).

## 3. Adopt wholesale or mimic?

| Option | For | Against |
|---|---|---|
| Adaptive Cards wholesale | Most mature declarative spec: elements, `Input.*`, `Action.Submit`/`Execute`, versioned schemas up to 1.6.0 | Input values return via the host's Submit handling (`Action.Submit` "gathers up" inputs); we would need a full renderer and the schema is large (about 100 KB JSON); card has no slider/chart; models write it less reliably than flat JSON |
| A2UI wholesale | Google-backed, v0.9.1 current, has Slider/ChoicePicker/DateTimeInput, two-way data model | Adjacency list with ids, `createSurface`/`updateComponents`/`updateDataModel` messages, JSON Pointer bindings: heavy for a 250-byte card; v1.0 is only a candidate |
| Elicitation schema wholesale | Tiny, models know JSON Schema, accept/decline/cancel result | Inputs only; no display, no table, no confirm body |
| Our own small format borrowing names | Keeps `render/summary/answer` shape, cards stay ~250 bytes, redraws old cards | We maintain it; no cross-tool portability |

Pick: mimic, in our own small format, borrowing vocabulary from two sources: **MCP elicitation
`requestedSchema`** for every input (the `form` type, and the accept/decline/cancel answer model) and
**Adaptive Cards** names for display blocks (`facts`, `table`, `body`). Reasons: (a) our envelope is
already one flat component per card; (b) both vocabularies are a few hundred bytes for the common
case; (c) the wholesale options add a renderer, an id graph or a data model the agent must keep in its
head. Revisit if cards need to compose (text + table + inputs in one card): then add a single `card`
type with a `body: [block...]` array, which is exactly the Adaptive Cards shape (`body` of elements plus
`actions`), without importing its schema.

## 4. Is `whatif` shipped anywhere?

Concept: yes, product features. Spec: no, custom. ChatGPT launched interactive math and science
modules with adjustable inputs and live graphs (70+ topics) and Claude's "custom visuals" can include
sliders and buttons; both are first-party or model-written HTML, not a declarative component.
None of the declarative catalogs read (Adaptive Cards, ChatKit, A2UI basic catalog) has a
formula-driven chart or slider-bound series; A2UI has a `Slider` and two-way data model, but no chart
component in the basic catalog list I read. A formula-string `series` spec is ours.

# Per-system sections

## OpenAI Apps SDK (ChatGPT apps)
- Display modes: inline, inline card ("confirmations, basic actions, or small amounts of structured
  data"), inline carousel (3-8 items, every item has an image), fullscreen, picture-in-picture. Card
  rule: "up to two actions maximum, with one primary CTA and one optional secondary CTA"; avoid
  nested scrolling, tabs, deep navigation. [UI guidelines](https://developers.openai.com/apps-sdk/concepts/ui-guidelines)
- Data flow: tool result `structuredContent` reaches the widget via `ui/notifications/tool-result`
  (alias `window.openai.toolOutput`); the widget calls tools via `tools/call` (`window.openai.callTool`),
  sends a chat message via `ui/message` (`sendFollowUpMessage`), tells the model about a selection
  without a message via `ui/update-model-context`; widget state via `window.openai.setWidgetState`.
  [Build a ChatGPT UI](https://developers.openai.com/apps-sdk/build/chatgpt-ui)
- Format: arbitrary HTML app, not a component catalog. Display vs interactive is not split by type; the
  widget decides.

## OpenAI ChatKit widgets
- Catalog (props): containers `Card` (`size`, `status`, `confirm`, `cancel`, `asForm`), `ListView`
  (`limit`, `ListViewItem`); `Box`, `Row`, `Col`, `Spacer`, `Divider`, `Transition`; text `Text`, `Title`,
  `Caption`, `Markdown`, `Badge`, `Icon`, `Image`; inputs/actions `Button` (`onClickAction`, `submit`),
  `DatePicker`, `Select` (`options` of `{label,value}`), `Form` (`onSubmitAction`). The page does not
  document Table, Chart, Checkbox, RadioGroup, Textarea.
  [Widgets guide](https://developers.openai.com/api/docs/guides/chatkit-widgets)
- Spec: JSON, generated in the Widget Builder (per a search summary of the docs; the builder itself was
  not opened).
- Answer flow: actions go to the server's `ChatKitServer.action` by default (or `handler="client"` and
  `onAction`); an action is `{type, payload}`; inputs inside a `Form` add their values to the payload
  keyed by `name` (dotted names nest); validation enforces `required` and `pattern`. Payloads are
  untrusted. [Actions](https://developers.openai.com/api/docs/guides/chatkit-actions)
- Display vs interactive: same tree; interactivity is `*Action` props.

## ChatGPT "interactive visuals"
- Launched March 2026 for math and science: an explanation plus an interactive module where inputs
  change graphs and results; 70+ concepts at launch (search-result summary of OpenAI's
  [announcement](https://openai.com/index/new-ways-to-learn-math-and-science-in-chatgpt/); the page itself
  returned 403 to my fetch, so detail rests on the search summary and [release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes), also 403).
  A release-notes entry dated 2026-10-07 reportedly says ChatGPT can combine text, visuals and
  interactive elements; I could not read it, treat as unverified.
- No developer-facing spec found for it.

## Anthropic: MCP elicitation
- Form mode `requestedSchema` is "a restricted subset of JSON Schema": flat objects with primitive
  properties only. Types: string (`minLength`, `maxLength`, `format` of `email|uri|date|date-time`),
  number/integer (`minimum`, `maximum`), boolean, enum (single via `enum` or `oneOf[{const,title}]`;
  multi via array with `items.enum` or `anyOf`, `minItems`, `maxItems`), all with `default`.
  Nested objects and arrays of objects are "intentionally not supported".
- Result: `{"action":"accept"|"decline"|"cancel","content":{...}}`. Servers MUST NOT request
  passwords, API keys etc. in form mode; use URL mode (`mode:"url"`, introduced in 2025-11-25).
- In the draft spec the request is delivered inside an `InputRequiredResult` and answered on a retried
  request. [Elicitation (draft)](https://modelcontextprotocol.io/specification/draft/client/elicitation)
- Display vs interactive: elicitation is input-only.

## Anthropic: MCP Apps and MCP-UI
- MCP Apps: tools link a `ui://` resource through `_meta.ui.resourceUri`; MIME
  `text/html;profile=mcp-app`; views run in a sandboxed iframe with a restrictive default CSP
  (`connect-src 'none'`). View to host: `ui/initialize`, `tools/call`, `ui/message`,
  `ui/update-model-context`; host to view: `ui/notifications/tool-input`, `tool-result`. Display modes
  `inline`, `fullscreen`, `pip`. Stable spec 2026-01-26.
  [Spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx),
  [repo](https://github.com/modelcontextprotocol/ext-apps). SEP-1865 is linked from the repo as a
  discussion PR (#1865).
- MCP-UI predates it and fed into it: resource types rawHtml, externalUrl, remoteDom; UI actions
  `tool`, `prompt`, `link`, `notify`, `intent` handled by the host's `onUIAction`.
  [mcp-ui](https://github.com/idosal/mcp-ui)

## Anthropic: Claude custom visuals and artifacts
- "Custom visuals in chat" (beta, web and desktop only): Claude writes HTML; they are inline and
  ephemeral; buttons and sliders work; in chat a click inside a visual sends a follow-up prompt to
  Claude; can be saved as an artifact. Artifacts are persistent and shareable.
  [Custom visuals](https://support.claude.com/en/articles/13979539-custom-visuals-in-chat-and-cowork),
  [Artifacts](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them)
  (second page seen only as a search result).
- No declarative component catalog; the answer path is "click sends a prompt".

## Google A2UI
- Protocol for agents to describe UI declaratively; Apache 2.0, created by Google with CopilotKit and
  community; v0.9.1 current, v1.0 candidate (adds `actionResponse`). Agents may only use components
  from a pre-approved catalog. [a2ui.org](https://a2ui.org/)
- Messages: `createSurface`, `updateComponents` (flat array of `{id, component}`, one `id:"root"`),
  `updateDataModel` (JSON Pointer), `deleteSurface`.
  [Spec v0.9](https://a2ui.org/specification/v0.9-a2ui/)
- Basic catalog: Text (`variant` h1-h5, caption, body), Image, Icon, Video, AudioPlayer, Row, Column,
  List, Card (one child), Tabs, Divider, Modal, Button (`primary|borderless|default`, `action`),
  CheckBox, TextField (`shortText|longText|number|obscured`), ChoicePicker (array value; `checkbox|chips`;
  `filterable`), Slider (`min`,`max`,`value`), DateTimeInput (`enableDate`,`enableTime`, ISO 8601).
  [Basic catalog guide](https://a2ui.org/specification/v0.9.1-basic-catalog-implementation-guide/)
- Answers: inputs write to a local data model; nothing is sent until a Button `action` with `event`
  (`name`, `context`) fires, then the client sends an `action` message (`name`, `surfaceId`,
  `sourceComponentId`, `timestamp`, `context`), optionally with the whole data model (`sendDataModel`).

## Vercel AI SDK and json-render
- AI SDK: tools become typed UI parts `tool-<name>` with states `input-available`,
  `output-available`, `output-error`; the app renders components from them.
  [Generative UI](https://ai-sdk.dev/docs/ai-sdk-ui/generative-user-interfaces)
- Human response: client-side tools without `execute`, answered with `addToolOutput({toolCallId, output})`;
  approval gates use `toolApproval` on `streamText` and `addToolApprovalResponse` (the older
  `needsApproval` is described as deprecated). [Tool usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage)
- json-render (exists): vercel-labs, Apache-2.0. Spec is JSON with `root` and a flat `elements` map of
  `{type, props, children:[ids]}`; a Zod-typed catalog limits what the model may use
  (`defineCatalog`, `defineRegistry`); built-in `setState` action; "36 pre-built shadcn/ui components"
  (only Card, Stack, Heading, Button, Select named in what I read); renderers for React, Vue, Svelte,
  React Native, and `@json-render/ink` (a terminal renderer) plus `@json-render/mcp`.
  [README](https://github.com/vercel-labs/json-render),
  [docs](https://json-render.dev/docs). Action return values were not described.

## CopilotKit, AG-UI
- Display-only: `useComponent` registers a React component the agent can call; no response.
  [Generative UI](https://docs.copilotkit.ai/generative-ui)
- Human-in-the-loop: `useHumanInTheLoop({name, description, parameters (Zod), render})`; `render`
  gets `status` (InProgress, Executing, Complete), `args`, `respond`, `result`; "The agent remains
  paused until `respond` is called". `renderAndWaitForResponse` is the older `useCopilotAction`
  pattern it replaces. [Reference](https://docs.copilotkit.ai/reference/hooks/useHumanInTheLoop),
  [search summary of migration](https://docs.copilotkit.ai/reference/v1/hooks/useHumanInTheLoop)
- AG-UI events: lifecycle, text message, tool call (`ToolCallStart/Args/End/Result`), state
  (`StateSnapshot`, `StateDelta` as JSON Patch), activity, reasoning. A run pauses by finishing with
  an `interrupt` outcome; the client resumes with a new run whose `resume` array answers each open
  interrupt. [Events](https://docs.ag-ui.com/concepts/events)

## assistant-ui
- No `makeAssistantToolUI` on the current docs page I read; tool UIs are `render` functions on a
  toolkit built with `defineToolkit`. Tool kinds: client (has `execute`), `backend` (render only),
  `human` (render collects input and calls `addResult` once). `status` types: running,
  requires-action, incomplete, complete. `interrupt`/`resume` and `approval`/`respondToApproval` for
  mid-run questions and gates. Prebuilt: `ToolFallback`, `ToolGroup`, `OptionList`.
  [Tool UI](https://www.assistant-ui.com/docs/tools/tool-ui)
- A UI is code, not a spec; nothing to borrow but the human-tool contract (answer once).

## Thesys C1
- Partly found. Actions: `<C1Component onAction>` receives `{type, params}` (examples
  `continue_conversation`, `open_url`); `<C1Chat>` handles form submit itself; buttons carry
  `llmFriendlyMessage` and `humanFriendlyMessage` (search-result summary of docs.thesys.dev pages).
- docs.thesys.dev now redirects to [openui.com/docs](https://www.openui.com/docs), which describes
  "OpenUI Lang" and says you define the component library; it lists no components and never mentions
  C1. I could not find C1's component list; not guessing one.

## LangGraph / LangChain
- Generative UI: graph nodes call `push_ui_message("weather", props, message=...)` (JS `typedUi`); the
  client renders with `LoadExternalComponent`; components are React code registered in `langgraph.json`
  under `ui`, loaded into a shadow DOM. A component can call `submit` to send a new human message.
  [Generative UI](https://docs.langchain.com/langsmith/generative-ui-react)
- Human response: `interrupt()` pauses, payload is any JSON value, resume with
  `Command(resume=...)` on the same `thread_id`; `response_schema` (langgraph>=1.2.12) describes the
  expected resume input. The HITL middleware decision types (approve/edit/reject) were not on the page
  I read. [Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)

## Microsoft Adaptive Cards
- JSON card: root `AdaptiveCard` with `version`, `body` (elements) and `actions`; elements stack
  vertically; `ColumnSet` for side by side.
  [Getting started](https://learn.microsoft.com/en-us/adaptive-cards/authoring-cards/getting-started)
- Schema file 1.6.0 definitions include: TextBlock, RichTextBlock, Image, ImageSet, Media, Container,
  ColumnSet/Column, FactSet/Fact, Table/TableRow/TableCell/TableColumnDefinition, ActionSet; inputs
  `Input.Text|Number|Date|Time|Toggle|ChoiceSet`; actions `Action.Submit|Execute|OpenUrl|ShowCard|ToggleVisibility`.
  Schema versions 1.1.0 to 1.6.0 exist in the repo; no CodeBlock, Carousel, Rating, ProgressBar or Chart
  in that file. [schema 1.6.0](https://github.com/microsoft/AdaptiveCards/blob/main/schemas/1.6.0/adaptive-card.json),
  [schemas dir](https://github.com/microsoft/AdaptiveCards/tree/main/schemas)
- Answer: `Action.Submit` gathers all inputs into an object and sends it through a host-defined channel;
  `Action.Execute` "gathers input fields, merges with optional data field, and sends an event to the
  client". The schema explorer page ([adaptivecards.microsoft.com](https://adaptivecards.microsoft.com/explorer/))
  returned 404, so per-element property detail was not read.
- Display vs interactive: one tree; inputs and actions are optional elements.

# Not found or not verified
- Anthropic's own announcement post for custom visuals; only the help-center article and press via search.
- OpenAI's visual-explanations announcement and release notes: 403 on fetch.
- Thesys C1 component list. ChatKit Table/Chart. CopilotKit "Controlled/Declarative/Open-ended" pages.
- Adaptive Cards per-element property tables (explorer unreachable); json-render's 36 component names.
