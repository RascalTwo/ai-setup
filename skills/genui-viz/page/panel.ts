// Card components for genui-viz. The genui page loads this as ./panel.js (the viz server serves a
// viz's x.ts as x.js) and calls mountPanels(); genui.ts imports it for summarize().
//
// A card is one line of the genui page's `_log/cards` ({ id, pane, spec }); its answer is one line of
// `_log/answers` ({ card, value } or { card, cancelled }). The agent writes the spec, ~250 bytes of
// JSON; everything that draws it lives here, so improving a component redraws every old card too.
//
//   ?card=<id>   one card, live: the floating panel shows this
//   (no query)   every card, newest first, with what was answered: the weekly look back
//
// Shared by every card: change one card's spec, not this file.

// Names borrow from others' catalogs (reference/research.md): inputs follow MCP elicitation's
// requestedSchema, display blocks Adaptive Cards (facts, table, body).

/** Label/value pairs: Adaptive Cards' FactSet. */
type Facts = [string, string][];
/** The yes/no pair confirm and diff share: answers { decision: "yes" | "no", note? }. */
type Decide = { yes?: string; no?: string; danger?: boolean };

export type ChoiceSpec = {
  type: "choice";
  title?: string;
  columns: string[];
  rows: string[][];
  /** Tick any number of rows and send them: answers { indexes } instead of { index }. */
  multi?: boolean;
  submit?: string;
};
export type ConfirmSpec = Decide & { type: "confirm"; title?: string; body?: string; facts?: Facts };
export type DiffSpec = Decide & {
  type: "diff";
  title?: string;
  /** A unified diff (git diff output); bare +/- lines work too. */
  patch: string;
  /** highlight.js language; else each file's extension, else the title's. */
  lang?: string;
  body?: string;
};
/** One MCP elicitation property: flat primitives, enums, multi-select arrays. */
export type FormField = {
  type: "string" | "number" | "integer" | "boolean" | "array";
  title?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  oneOf?: { const: string; title?: string }[];
  format?: "email" | "uri" | "date" | "date-time";
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  items?: { enum?: string[]; anyOf?: { const: string; title?: string }[] };
};
export type FormSpec = {
  type: "form";
  title?: string;
  message?: string;
  submit?: string;
  schema: { required?: string[]; properties: Record<string, FormField> };
};
// Display components: a card of only these returns at once ("shown") unless one sets wait; its
// Done button answers { seen: true }.
export type NoticeSpec = {
  type: "notice";
  title?: string;
  status?: "success" | "info" | "warning" | "error";
  /** Markdown. */
  body?: string;
  facts?: Facts;
};
export type TableSpec = {
  type: "table";
  title?: string;
  columns: string[];
  rows: string[][];
  body?: string;
};
export type CodeSpec = { type: "code"; title?: string; text: string; lang?: string };
/** The escape hatch: your own HTML, CSS and JS (a module: CDN imports work) in a sandboxed frame.
 *  Its JS calls genui.answer({...}) to send data back; genui.sent is what was sent, once answered. */
export type HtmlSpec = { type: "html"; title?: string; html?: string; css?: string; js?: string };
export type ComponentSpec = (
  | ChoiceSpec
  | ConfirmSpec
  | DiffSpec
  | FormSpec
  | NoticeSpec
  | TableSpec
  | CodeSpec
  | HtmlSpec
) & {
  /** Its key in a multi-component card's answer; default its type (type2, type3 when repeated). */
  id?: string;
  /** On a display component: keep `genui show` waiting until Done (or the html's answer). */
  wait?: boolean;
};
/** A card: one component (the spec itself, with a title), or several stacked under one title. */
export type CardSpec = { title: string; components: ComponentSpec[]; wait?: boolean };
export type PanelSpec = CardSpec | (ComponentSpec & { title: string });

/** The components a card stacks, each with its key in the card's answer. */
export function partsOf(spec: PanelSpec): { part: ComponentSpec; key: string }[] {
  const parts = "components" in spec ? spec.components : [spec];
  const seen: Record<string, number> = {};
  return parts.map((part) => {
    const n = (seen[part.type] = (seen[part.type] ?? 0) + 1);
    return { part, key: part.id ?? (n > 1 ? `${part.type}${n}` : part.type) };
  });
}

const DISPLAY = new Set(["notice", "table", "code", "html"]);
const asks = (p: ComponentSpec): boolean => !DISPLAY.has(p.type);
/** A card that shows rather than asks: nobody waits on it unless it, or a component, sets wait. */
export const displayOnly = (s: PanelSpec): boolean =>
  !s.wait && partsOf(s).every(({ part }) => !asks(part) && !part.wait);
export type Card = { at?: string; id: string; pane?: string; spec: PanelSpec };
export type Answer = {
  at?: string;
  card: string;
  value?: Record<string, unknown>;
  cancelled?: boolean;
};

type Ctx = {
  live: boolean;
  answer: (value: Record<string, unknown>) => void;
  cancel: () => void;
  /** False when another component in the card has the buttons: draw no Send, just be read. */
  ownButton: boolean;
  /** What was sent, when the card is already answered: draw THAT, not the spec's starting point. */
  sent?: Record<string, unknown>;
};
type Reader = () => Record<string, unknown> | null;
type Component<S> = {
  /** May return a reader for its current state, so another component's button sends it along;
   *  the reader returns null (and shows why) while that state isn't valid to send. */
  render: (root: HTMLElement, spec: S, ctx: Ctx) => void | Reader;
  summary: (spec: S, value: Record<string, unknown>) => string;
};

const esc = (s: unknown): string => String(s).replace(/[&<>"]/gu, (c) => `&#${c.charCodeAt(0)};`);
// Libraries load from a CDN on first use, pinned (viz reference/cdn.md); offline, cards fall back
// to plain text.
type Hljs = {
  getLanguage: (l: string) => unknown;
  highlight: (code: string, o: { language: string; ignoreIllegals: boolean }) => { value: string };
  highlightAuto: (code: string) => { value: string };
};
const HLJS = "https://esm.sh/highlight.js@11.9.0/lib/common"; // ~35 common languages
const MARKED = "https://esm.sh/marked@12";
let hljsLoad: Promise<Hljs | undefined> | undefined;
function hljs(): Promise<Hljs | undefined> {
  if (!hljsLoad) {
    document.head.insertAdjacentHTML(
      "beforeend",
      '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">',
    );
    hljsLoad = import(HLJS).then(
      (m: { default: Hljs }) => m.default,
      () => undefined,
    );
  }
  return hljsLoad;
}
let markedLoad: Promise<((s: string) => string) | undefined> | undefined;

const extOf = (file: string): string | undefined => /\.(\w+)$/u.exec(file)?.[1];
/** Highlighted HTML for code in `lang` (auto-detected when unknown, if `auto`); escaped text before hljs loads. */
function hl(h: Hljs | undefined, code: string, lang: string | undefined, auto = false): string {
  if (h && lang && h.getLanguage(lang))
    return h.highlight(code, { language: lang, ignoreIllegals: true }).value;
  return h && auto ? h.highlightAuto(code).value : esc(code);
}

/** Markdown into el: plain text at once, rendered (code blocks highlighted) once marked loads. */
function md(el: HTMLElement, text: string): void {
  el.classList.add("pn-md", "pn-plain");
  el.textContent = text;
  markedLoad ??= import(MARKED).then(
    (m: { marked: { parse: (s: string) => string } }) => (s: string) => m.marked.parse(s),
    () => undefined,
  );
  void markedLoad.then(async (parse) => {
    if (!parse) return;
    el.classList.remove("pn-plain");
    el.innerHTML = parse(text);
    const blocks = el.querySelectorAll<HTMLElement>("pre code");
    if (!blocks.length) return;
    const h = await hljs();
    for (const b of blocks) {
      b.classList.add("hljs");
      b.innerHTML = hl(h, b.textContent ?? "", /language-(\w+)/u.exec(b.className)?.[1], true);
    }
  });
}

/** The optional markdown body and facts most cards open with. */
function intro(root: HTMLElement, s: { body?: string; facts?: Facts }): void {
  if (s.body) md(root.appendChild(document.createElement("div")), s.body);
  if (s.facts?.length)
    root.insertAdjacentHTML(
      "beforeend",
      `<dl class="pn-facts">${s.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`,
    );
}

/** A card-wide key, except while typing: there only Enter gets through (it sends, as in a form). */
const onKey = (root: HTMLElement, f: (e: KeyboardEvent) => void): void =>
  addEventListener("keydown", (e) => {
    if (!root.isConnected) return; // a demo page swaps cards out; their keys go with them
    const t = e.target;
    const typing =
      t instanceof HTMLTextAreaElement ||
      t instanceof HTMLSelectElement ||
      (t instanceof HTMLInputElement && t.type !== "checkbox");
    if (e instanceof KeyboardEvent && (!typing || (e.key === "Enter" && !(t instanceof HTMLTextAreaElement)))) f(e);
  });

/** Yes / No with an optional note. ⏎ says yes, or ⌘⏎ when it's dangerous. */
function decide(root: HTMLElement, s: Decide, ctx: Ctx, yes: string, no: string): void {
  if (!ctx.live) return; // the history's receipt line says what was decided
  const key = s.danger ? "⌘⏎" : "⏎";
  root.insertAdjacentHTML(
    "beforeend",
    `<div class="pn-actions"><input class="pn-note" placeholder="Note (optional)"><button class="pn-no">${esc(s.no ?? no)}</button><button class="pn-yes${s.danger ? " pn-danger" : ""}">${esc(s.yes ?? yes)} <kbd>${key}</kbd></button></div>`,
  );
  const note = root.querySelector<HTMLInputElement>(".pn-note")!;
  const send = (decision: "yes" | "no"): void =>
    ctx.answer({ decision, ...(note.value.trim() ? { note: note.value.trim() } : {}) });
  root.querySelector(".pn-yes")!.addEventListener("click", () => send("yes"));
  root.querySelector(".pn-no")!.addEventListener("click", () => send("no"));
  onKey(root, (e) => {
    if (e.key === "Enter" && (!s.danger || e.metaKey)) send("yes");
  });
}
const decided = (s: Decide, v: Record<string, unknown>, yes: string, no: string): string =>
  `${v["decision"] === "yes" ? (s.yes ?? yes) : (s.no ?? no)}${v["note"] ? ` — ${String(v["note"])}` : ""}`;

/** A card of display components gets one button: Done (⏎) answers { seen: true } and closes it. */
function done(root: HTMLElement, ctx: Ctx): void {
  root.insertAdjacentHTML(
    "beforeend",
    '<div class="pn-actions"><button class="pn-go">Done <kbd>⏎</kbd></button></div>',
  );
  const go = (): void => ctx.answer({ seen: true });
  root.querySelector(".pn-go")!.addEventListener("click", go);
  onKey(root, (e) => {
    if (e.key === "Enter") go();
  });
}

const tableHtml = (
  columns: string[],
  rows: string[][],
  extra?: (i: number) => string,
  picked?: Set<number>,
): string =>
  `<div class="pn-scroll"><table class="pn-table"><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join("")}${extra ? "<th></th>" : ""}</tr>${rows
    .map(
      (r, i) =>
        `<tr${picked?.has(i) ? ' class="pn-picked"' : ""}>${r.map((c) => `<td>${esc(c)}</td>`).join("")}${extra ? `<td>${extra(i)}</td>` : ""}</tr>`,
    )
    .join("")}</table></div>`;

const choice: Component<ChoiceSpec> = {
  render(root, spec, ctx) {
    const sent = ctx.sent?.["indexes"] ?? (ctx.sent ? [ctx.sent["index"]] : []);
    const picked = new Set((sent as unknown[]).map(Number));
    const off = ctx.live ? "" : " disabled";
    root.innerHTML = tableHtml(
      spec.columns,
      spec.rows,
      (i) =>
        spec.multi
          ? `<label class="pn-tick"><input type="checkbox" data-i="${i}"${picked.has(i) ? " checked" : ""}${off}> <kbd>${i + 1}</kbd></label>`
          : `<button data-i="${i}"${off}>Pick <kbd>${i + 1}</kbd></button>`,
      picked,
    );
    if (!ctx.live) return;
    if (!spec.multi) {
      const pick = (i: number): void => ctx.answer({ index: i });
      for (const b of root.querySelectorAll<HTMLButtonElement>("button[data-i]"))
        b.addEventListener("click", () => pick(Number(b.dataset["i"])));
      onKey(root, (e) => {
        const n = Number(e.key);
        if (n >= 1 && n <= spec.rows.length) pick(n - 1);
      });
      return;
    }
    if (ctx.ownButton)
      root.insertAdjacentHTML(
        "beforeend",
        `<div class="pn-actions"><button class="pn-go">${esc(spec.submit ?? "Send selected")} <kbd>⏎</kbd></button></div>`,
      );
    const boxes = [...root.querySelectorAll<HTMLInputElement>("input[data-i]")];
    const read = (): Record<string, unknown> => ({
      indexes: boxes.filter((b) => b.checked).map((b) => Number(b.dataset["i"])),
    });
    root.querySelector(".pn-go")?.addEventListener("click", () => ctx.answer(read()));
    onKey(root, (e) => {
      const b = boxes[Number(e.key) - 1];
      if (b) b.checked = !b.checked;
      if (e.key === "Enter" && ctx.ownButton) ctx.answer(read());
    });
    return read;
  },
  summary(spec, v) {
    const name = (i: unknown): string => spec.rows[Number(i)]?.[0] ?? `row ${String(i)}`;
    const many = v["indexes"];
    return Array.isArray(many)
      ? `Picked ${many.map(name).join(", ") || "none"}`
      : `Picked ${name(v["index"])}`;
  },
};

const confirm: Component<ConfirmSpec> = {
  render(root, spec, ctx) {
    intro(root, spec);
    decide(root, spec, ctx, "Yes", "No");
  },
  summary: (spec, v) => decided(spec, v, "Yes", "No"),
};

type Line = { k: "file" | "hunk" | "add" | "del" | "ctx"; text: string; a?: number; b?: number; lang?: string | undefined };
/** A unified diff's lines, numbered from its @@ headers, with each file's language. */
function parsePatch(patch: string, lang: string | undefined): Line[] {
  const out: Line[] = [];
  const bare = !/^@@ /mu.test(patch); // just +/- lines: one hunk from line 1
  let a = 1,
    b = 1,
    left = bare ? Infinity : 0, // old + new lines still to come in this hunk
    fileLang = lang;
  for (const line of patch.replace(/\n$/u, "").split("\n")) {
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line);
    if (h) {
      a = Number(h[1]);
      b = Number(h[3]);
      left = Number(h[2] ?? 1) + Number(h[4] ?? 1);
      out.push({ k: "hunk", text: line });
    } else if (line.startsWith("diff --git ")) {
      left = 0; // a new file, even when the last hunk's counts were off (agents miscount them)
    } else if (left <= 0) {
      const f = /^\+\+\+ (?:b\/)?(.+)/u.exec(line); // headers between hunks: name the file
      if (f && f[1] !== "/dev/null") {
        fileLang = lang ?? extOf(f[1]!);
        out.push({ k: "file", text: f[1]! });
      }
    } else if (line.startsWith("+")) {
      out.push({ k: "add", text: line.slice(1), b: b++, lang: fileLang });
      left -= 1;
    } else if (line.startsWith("-")) {
      out.push({ k: "del", text: line.slice(1), a: a++, lang: fileLang });
      left -= 1;
    } else if (!line.startsWith("\\")) {
      out.push({ k: "ctx", text: line.slice(1), a: a++, b: b++, lang: fileLang });
      left -= 2;
    }
  }
  return out;
}

const diff: Component<DiffSpec> = {
  render(root, spec, ctx) {
    intro(root, spec);
    const lines = parsePatch(spec.patch, spec.lang ?? extOf(spec.title ?? ""));
    const adds = lines.filter((l) => l.k === "add").length;
    const dels = lines.filter((l) => l.k === "del").length;
    const box = document.createElement("div");
    box.className = "pn-diff";
    // ponytail: highlights line by line, so a string or comment spanning lines loses its colour mid-way
    const draw = (h?: Hljs): void => {
      box.innerHTML = `<div class="pn-dstat"><b class="pn-plus">+${adds}</b> <b class="pn-minus">−${dels}</b></div>${lines
        .map((l) =>
          l.k === "file" || l.k === "hunk"
            ? `<div class="pn-d${l.k}">${esc(l.text)}</div>`
            : `<div class="pn-d pn-${l.k}"><span class="pn-n">${l.a ?? ""}</span><span class="pn-n">${l.b ?? ""}</span><span class="pn-sign">${l.k === "add" ? "+" : l.k === "del" ? "−" : ""}</span><code>${hl(h, l.text, l.lang) || " "}</code></div>`,
        )
        .join("")}`;
    };
    draw();
    void hljs().then((h) => h && draw(h));
    root.append(box);
    decide(root, spec, ctx, "Approve", "Reject");
  },
  summary: (spec, v) => decided(spec, v, "Approve", "Reject"),
};

const code: Component<CodeSpec> = {
  render(root, spec, _ctx) {
    root.innerHTML = '<pre class="pn-code"><code class="hljs"></code></pre>';
    const el = root.querySelector("code")!;
    const lang = spec.lang ?? extOf(spec.title ?? "");
    el.textContent = spec.text;
    void hljs().then((h) => {
      if (h) el.innerHTML = hl(h, spec.text, lang, true);
    });
  },
  summary: () => "Seen",
};

const notice: Component<NoticeSpec> = {
  render(root, spec, _ctx) {
    if (spec.status)
      root.insertAdjacentHTML(
        "beforeend",
        `<span class="pn-badge pn-${esc(spec.status)}">${esc(spec.status)}</span>`,
      );
    intro(root, spec);
  },
  summary: () => "Seen",
};

const table: Component<TableSpec> = {
  render(root, spec, _ctx) {
    intro(root, spec);
    root.insertAdjacentHTML("beforeend", tableHtml(spec.columns, spec.rows));
  },
  summary: () => "Seen",
};

/** One MCP elicitation field as a native control; arrays of options become checkboxes. */
function field(key: string, f: FormField, required: boolean, value: unknown): string {
  const name = `name="${esc(key)}"`;
  const opts = f.oneOf ?? f.enum?.map((e) => ({ const: e, title: e }));
  const label = `<span>${esc(f.title ?? key)}${required ? " *" : ""}</span>${f.description ? `<small>${esc(f.description)}</small>` : ""}`;
  if (f.type === "boolean")
    return `<label class="pn-check"><input type="checkbox" ${name}${value === true ? " checked" : ""}> ${label}</label>`;
  if (f.type === "array") {
    const items = f.items?.anyOf ?? f.items?.enum?.map((e) => ({ const: e, title: e })) ?? [];
    const on = new Set(Array.isArray(value) ? value : []);
    return `<fieldset class="pn-field"><legend>${label}</legend>${items
      .map(
        (o) =>
          `<label class="pn-check"><input type="checkbox" ${name} value="${esc(o.const)}"${on.has(o.const) ? " checked" : ""}> ${esc(o.title ?? o.const)}</label>`,
      )
      .join("")}</fieldset>`;
  }
  const req = required ? " required" : "";
  const val = value === undefined ? "" : esc(value);
  let control: string;
  if (opts)
    control = `<select ${name}${req}>${required && value !== undefined ? "" : '<option value=""></option>'}${opts
      .map(
        (o) =>
          `<option value="${esc(o.const)}"${o.const === value ? " selected" : ""}>${esc(o.title ?? o.const)}</option>`,
      )
      .join("")}</select>`;
  else if (f.type === "number" || f.type === "integer")
    control = `<input type="number" ${name}${req} step="${f.type === "integer" ? 1 : "any"}"${f.minimum === undefined ? "" : ` min="${f.minimum}"`}${f.maximum === undefined ? "" : ` max="${f.maximum}"`} value="${val}">`;
  else if ((f.maxLength ?? 0) > 120)
    control = `<textarea ${name}${req} maxlength="${f.maxLength}" rows="3">${val}</textarea>`;
  else {
    const types: Record<string, string> = { email: "email", uri: "url", date: "date", "date-time": "datetime-local" };
    const type = types[f.format ?? ""] ?? "text";
    control = `<input type="${type}" ${name}${req}${f.maxLength ? ` maxlength="${f.maxLength}"` : ""} value="${val}">`;
  }
  return `<label class="pn-field">${label}${control}</label>`;
}

const form: Component<FormSpec> = {
  render(root, spec, ctx) {
    if (spec.message) md(root.appendChild(document.createElement("div")), spec.message);
    const req = new Set(spec.schema.required ?? []);
    const props = Object.entries(spec.schema.properties);
    const el = document.createElement("form");
    el.className = "pn-form";
    el.innerHTML = `<fieldset${ctx.live ? "" : " disabled"}>${props
      .map(([k, f]) => field(k, f, req.has(k), ctx.sent ? ctx.sent[k] : f.default))
      .join("")}</fieldset>${ctx.live && ctx.ownButton ? `<div class="pn-actions"><button>${esc(spec.submit ?? "Send")} <kbd>⏎</kbd></button></div>` : ""}`;
    root.append(el);
    if (!ctx.live) return;
    const read = (): Record<string, unknown> | null => {
      if (!el.reportValidity()) return null;
      const value: Record<string, unknown> = {};
      for (const [k, f] of props) {
        const inputs = [...el.querySelectorAll<HTMLInputElement>(`[name="${CSS.escape(k)}"]`)];
        const v = inputs[0]?.value ?? "";
        if (f.type === "boolean") value[k] = inputs[0]?.checked ?? false;
        else if (f.type === "array") value[k] = inputs.filter((i) => i.checked).map((i) => i.value);
        else if (v !== "") value[k] = f.type === "number" || f.type === "integer" ? Number(v) : v;
      }
      return value;
    };
    el.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = ctx.ownButton ? read() : null; // else Enter is the deciding button's
      if (value) ctx.answer(value);
    });
    return read;
  },
  summary: (spec, v) =>
    Object.entries(v)
      .map(([k, x]) => {
        const shown = Array.isArray(x) ? x.join(", ") || "none" : x === true ? "yes" : x === false ? "no" : String(x);
        return `${spec.schema.properties[k]?.title ?? k}: ${shown}`;
      })
      .join(" · "),
};

/** In the frame before your JS runs: genui.answer, genui.sent, Escape, and the frame's height. */
const SHIM = `window.genui = {
  answer: (value) => parent.postMessage({ genui: "answer", value }, "*"),
  sent: __SENT__,
};
addEventListener("keydown", (e) => e.key === "Escape" && parent.postMessage({ genui: "cancel" }, "*"));
new ResizeObserver(() =>
  parent.postMessage({ genui: "height", h: document.documentElement.scrollHeight }, "*"),
).observe(document.body);`;
const FRAME_CSS =
  ":root{color-scheme:dark}body{margin:0;font:14px -apple-system,system-ui,sans-serif;color:#f0efec;background:transparent}";

const html: Component<HtmlSpec> = {
  render(root, spec, ctx) {
    const f = document.createElement("iframe");
    f.className = "pn-html";
    // ponytail: scripts but no same-origin: it can't read this page or its logs; it can still fetch
    f.sandbox.add("allow-scripts");
    const sent = JSON.stringify(ctx.sent ?? null).replace(/</gu, "\\u003c");
    f.srcdoc = `<!doctype html><meta charset="utf-8"><style>${FRAME_CSS}</style><style>${spec.css ?? ""}</style><body>${spec.html ?? ""}<script>${SHIM.replace("__SENT__", sent)}</script><script type="module">${spec.js ?? ""}</script>`;
    addEventListener("message", (e) => {
      if (e.source !== f.contentWindow) return;
      const d = e.data as { genui?: string; h?: number; value?: unknown };
      if (d.genui === "height") f.style.height = `${d.h}px`;
      else if (d.genui === "cancel") ctx.cancel();
      else if (d.genui === "answer" && ctx.live)
        ctx.answer(d.value && typeof d.value === "object" ? (d.value as Record<string, unknown>) : { value: d.value });
    });
    root.append(f);
  },
  summary: (_spec, v) => (v["seen"] === true ? "Seen" : JSON.stringify(v)),
};

const COMPONENTS: Record<ComponentSpec["type"], Component<never>> = {
  choice,
  confirm,
  diff,
  form,
  notice,
  table,
  code,
  html,
};

const componentOf = (p: ComponentSpec): Component<ComponentSpec> | undefined =>
  COMPONENTS[p.type] as Component<ComponentSpec> | undefined;

/** The one-line receipt for an answer: what the human sent, as the agent will read it. */
export function summarize(card: Card, a?: Answer): string {
  if (!a) return displayOnly(card.spec) ? "shown" : "waiting for an answer";
  if (a.cancelled) return "Cancelled";
  const v = a.value ?? {};
  const parts = partsOf(card.spec);
  if (parts.length === 1) {
    const c = componentOf(parts[0]!.part);
    return c ? c.summary(parts[0]!.part, v) : JSON.stringify(v);
  }
  const said = parts
    .filter(({ key }) => v[key] && typeof v[key] === "object")
    .map(({ part, key }) => componentOf(part)?.summary(part, v[key] as Record<string, unknown>) ?? "")
    .filter(Boolean);
  return said.join(" · ") || (v["seen"] === true ? "Seen" : JSON.stringify(v));
}

async function log<T>(name: string): Promise<T[]> {
  const r = await fetch(`_log/${name}`);
  return r.ok ? ((await r.json()) as T[]) : [];
}

const postAnswer = async (a: Answer): Promise<void> => {
  await fetch("_log/answers", { method: "POST", body: JSON.stringify(a) });
  window.close(); // the terminal shows what was sent; a browser tab ignores this
};

/** One card, drawn. `post` receives the answer: the genui page logs it; a demo (the poster) can
 *  show it instead. */
export function cardBox(
  card: Card,
  answer: Answer | undefined,
  live: boolean,
  post: (a: Answer) => void | Promise<void> = postAnswer,
): HTMLElement {
  const box = document.createElement("section");
  box.className = "pn-card";
  box.innerHTML = `<h1>${esc(card.spec.title)}</h1><p class="pn-receipt" ${answer || !live ? "" : "hidden"}></p>`;
  const receipt = box.querySelector<HTMLElement>(".pn-receipt")!;
  receipt.textContent = `${answer ? "Sent: " : ""}${summarize(card, answer)}`;
  let sending = false;
  const send = async (a: Answer): Promise<void> => {
    if (sending) return; // two components' keys can fire on one press; the first one counts
    sending = true;
    await post(a);
  };
  const parts = partsOf(card.spec);
  const single = parts.length === 1;
  const readers: [string, Reader][] = [];
  // One component answers as itself; in a stack, the card answers { key: value } for every
  // component with something to say, the one whose button was pressed last.
  const answerAs = (key: string) => (value: Record<string, unknown>) => {
    if (single) return void send({ card: card.id, value });
    const all = readers.map(([k, read]) => [k, read()] as const);
    if (all.some(([, v]) => v === null)) return; // a form says what's wrong; nothing is sent
    void send({ card: card.id, value: { ...Object.fromEntries(all), [key]: value } });
  };
  const sent = answer?.value;
  // Confirm, diff and a one-pick choice end the card with their own buttons; forms and multi-picks
  // in the same card then lose their Send and ride along on that answer.
  const decider = parts.some(
    ({ part }) => part.type === "confirm" || part.type === "diff" || (part.type === "choice" && !part.multi),
  );
  for (const { part, key } of parts) {
    const body = document.createElement("div");
    body.className = "pn-body";
    if (!single && part.title) body.innerHTML = `<h2>${esc(part.title)}</h2>`;
    box.insertBefore(body, receipt);
    const c = componentOf(part);
    if (!c) {
      body.append(`No "${part.type}" component in panel.ts.`);
      continue;
    }
    const mine = single ? sent : (sent?.[key] as Record<string, unknown> | undefined);
    const read = c.render(body, part, {
      live,
      answer: answerAs(key),
      cancel: () => void send({ card: card.id, cancelled: true }),
      ownButton: single || !decider,
      ...(mine ? { sent: mine } : {}),
    });
    if (read) readers.push([key, read]);
  }
  if (live && !parts.some(({ part }) => asks(part))) {
    const end = document.createElement("div");
    box.insertBefore(end, receipt);
    done(end, {
      live,
      answer: (value) => void send({ card: card.id, value }),
      cancel: () => {},
      ownButton: true,
    });
  }
  if (live)
    addEventListener("keydown", (e) => {
      if (!(e instanceof KeyboardEvent) || !box.isConnected) return;
      if (e.key === "Escape") void send({ card: card.id, cancelled: true });
    });
  return box;
}

export async function mountPanels(root: HTMLElement = document.body): Promise<void> {
  const [cards, answers] = await Promise.all([log<Card>("cards"), log<Answer>("answers")]);
  const answerOf = (id: string): Answer | undefined => answers.findLast((a) => a.card === id);
  const id = new URLSearchParams(location.search).get("card");
  root.replaceChildren();
  if (id) {
    const card = cards.findLast((c) => c.id === id);
    if (!card) {
      root.textContent = `No card ${id} in this viz.`;
      return;
    }
    document.title = card.spec.title;
    root.append(cardBox(card, answerOf(id), !answerOf(id)));
    return;
  }
  root.classList.add("pn-history");
  const h = document.createElement("h1");
  h.className = "pn-history-title";
  h.textContent = `Panels · ${cards.length} card${cards.length === 1 ? "" : "s"}`;
  root.append(h);
  for (const card of cards.toReversed()) {
    const box = cardBox(card, answerOf(card.id), false);
    const meta = document.createElement("p");
    meta.className = "pn-meta";
    meta.textContent = [
      card.at && new Date(card.at).toLocaleString(),
      card.pane && `pane ${card.pane}`,
      card.id,
    ]
      .filter(Boolean)
      .join(" · ");
    box.prepend(meta);
    root.append(box);
  }
}
