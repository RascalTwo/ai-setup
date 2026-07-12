// tldraw-canvas bootstrap
// Inject via mcp__claude-in-chrome__javascript_tool on a tldraw.com tab.
// Defines window.__td — a safe, schema-correct helper surface for Claude.
//
// Why a helper library (vs. Claude hand-rolling editor calls each time):
//   - tldraw validates shape props strictly. Malformed richText crashes the
//     renderer, not just the validator. Each helper produces known-good JSON.
//   - IDs on AI-created shapes get a "shape:ai-" prefix so `cleanup()` can
//     remove just Claude's shapes without touching the user's content.
//   - Rich text is a ProseMirror doc, not a string. `richText()` is the only
//     sanctioned way to build one.
//
// Idempotent: re-injecting replaces the helper (safe to re-run).

(() => {
  if (!window.editor) {
    throw new Error('tldraw editor not found on window — this page is not tldraw.com or not loaded yet');
  }

  const editor = window.editor;

  // ---- ID + rich text ----

  const AI_PREFIX = 'shape:ai-';
  const newId = () => AI_PREFIX + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  // Plain string → ProseMirror doc. Preserves line breaks as separate paragraphs.
  const richText = (str) => {
    const s = String(str ?? '');
    const paragraphs = s.split('\n').map(line => line.length
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph' });
    return { type: 'doc', content: paragraphs.length ? paragraphs : [{ type: 'paragraph' }] };
  };

  const EMPTY_RT = { type: 'doc', content: [{ type: 'paragraph' }] };

  // ---- Enums (empirically derived from validator errors) ----

  const ENUMS = {
    color: ['black','grey','light-violet','violet','blue','light-blue','yellow','orange','green','light-green','light-red','red','white'],
    size: ['s','m','l','xl'],
    geo: ['cloud','rectangle','ellipse','triangle','diamond','pentagon','hexagon','octagon','star','rhombus','rhombus-2','oval','trapezoid','arrow-right','arrow-left','arrow-up','arrow-down','x-box','check-box','heart'],
    font: ['draw','sans','serif','mono'],
    dash: ['draw','solid','dashed','dotted','none'],
    fill: ['none','semi','solid','pattern','fill','lined-fill'],
    align: ['start','middle','end'],
    arrowhead: ['arrow','triangle','square','dot','pipe','diamond','inverted','bar','none'],
    arrowKind: ['arc','elbow'],
  };

  const enumOrDefault = (key, val, fallback) => {
    if (val === undefined || val === null) return fallback;
    if (!ENUMS[key].includes(val)) {
      throw new Error(`Invalid ${key}: ${JSON.stringify(val)}. Valid: ${ENUMS[key].join(', ')}`);
    }
    return val;
  };

  // ---- Create helpers ----

  // Rectangle (or any geo shape) with optional label
  const createBox = ({ x = 0, y = 0, w = 200, h = 100, text = '', color = 'black', fill = 'none', geo = 'rectangle', dash = 'draw', size = 'm', font = 'draw' } = {}) => {
    const id = newId();
    editor.createShape({
      id, type: 'geo', x, y,
      props: {
        w, h,
        geo: enumOrDefault('geo', geo, 'rectangle'),
        color: enumOrDefault('color', color, 'black'),
        fill: enumOrDefault('fill', fill, 'none'),
        dash: enumOrDefault('dash', dash, 'draw'),
        size: enumOrDefault('size', size, 'm'),
        font: enumOrDefault('font', font, 'draw'),
        richText: text ? richText(text) : EMPTY_RT,
      },
    });
    return id;
  };

  // Sticky note
  const createSticky = ({ x = 0, y = 0, text = '', color = 'yellow', size = 'm' } = {}) => {
    const id = newId();
    editor.createShape({
      id, type: 'note', x, y,
      props: {
        color: enumOrDefault('color', color, 'yellow'),
        size: enumOrDefault('size', size, 'm'),
        richText: text ? richText(text) : EMPTY_RT,
      },
    });
    return id;
  };

  // Standalone text (no shape container)
  const createText = ({ x = 0, y = 0, text = '', color = 'black', size = 'm', font = 'draw', textAlign = 'start' } = {}) => {
    const id = newId();
    editor.createShape({
      id, type: 'text', x, y,
      props: {
        color: enumOrDefault('color', color, 'black'),
        size: enumOrDefault('size', size, 'm'),
        font: enumOrDefault('font', font, 'draw'),
        textAlign: enumOrDefault('align', textAlign, 'start'),
        autoSize: true,
        richText: richText(text),
      },
    });
    return id;
  };

  // Frame (groups shapes visually; not a parent — bindings are separate)
  const createFrame = ({ x = 0, y = 0, w = 320, h = 180, name = '', color = 'black' } = {}) => {
    const id = newId();
    editor.createShape({
      id, type: 'frame', x, y,
      props: {
        w, h, name,
        color: enumOrDefault('color', color, 'black'),
      },
    });
    return id;
  };

  // Arrow between two shapes (by id) or two {x,y} points.
  // When given shape ids, creates bindings so the arrow sticks to the shapes
  // as they move. When given points, it's a free-floating arrow.
  const createArrow = ({ from, to, text = '', color = 'black', size = 'm', kind = 'arc', arrowheadEnd = 'arrow', arrowheadStart = 'none' } = {}) => {
    if (!from || !to) throw new Error('createArrow requires from and to');
    const id = newId();

    // Resolve endpoints for initial placement
    const resolve = (endpoint) => {
      if (typeof endpoint === 'string') {
        const shape = editor.getShape(endpoint);
        if (!shape) throw new Error(`Shape not found: ${endpoint}`);
        const bounds = editor.getShapePageBounds(endpoint);
        return { point: { x: bounds.midX, y: bounds.midY }, shapeId: endpoint };
      }
      return { point: endpoint, shapeId: null };
    };
    const a = resolve(from), b = resolve(to);

    editor.createShape({
      id, type: 'arrow', x: 0, y: 0,
      props: {
        kind: enumOrDefault('arrowKind', kind, 'arc'),
        color: enumOrDefault('color', color, 'black'),
        size: enumOrDefault('size', size, 'm'),
        arrowheadEnd: enumOrDefault('arrowhead', arrowheadEnd, 'arrow'),
        arrowheadStart: enumOrDefault('arrowhead', arrowheadStart, 'none'),
        start: { x: a.point.x, y: a.point.y },
        end: { x: b.point.x, y: b.point.y },
        richText: text ? richText(text) : EMPTY_RT,
      },
    });

    // Bind arrow endpoints to shapes if given shape ids (keeps arrow attached as shapes move)
    const bindings = [];
    if (a.shapeId) bindings.push({ fromId: id, toId: a.shapeId, type: 'arrow', props: { terminal: 'start', isPrecise: false, isExact: false, normalizedAnchor: { x: 0.5, y: 0.5 } } });
    if (b.shapeId) bindings.push({ fromId: id, toId: b.shapeId, type: 'arrow', props: { terminal: 'end', isPrecise: false, isExact: false, normalizedAnchor: { x: 0.5, y: 0.5 } } });
    if (bindings.length && typeof editor.createBindings === 'function') {
      try { editor.createBindings(bindings); } catch (e) { /* binding creation is best-effort */ }
    }
    return id;
  };

  // ---- Update / delete ----

  const updateShape = (id, patch) => {
    const shape = editor.getShape(id);
    if (!shape) throw new Error(`Shape not found: ${id}`);
    const next = { id, type: shape.type };
    if ('x' in patch) next.x = patch.x;
    if ('y' in patch) next.y = patch.y;
    if ('rotation' in patch) next.rotation = patch.rotation;
    if ('props' in patch) {
      // If caller passed text:"..." shorthand, convert to richText
      const p = { ...patch.props };
      if ('text' in p) { p.richText = richText(p.text); delete p.text; }
      next.props = p;
    }
    editor.updateShape(next);
    return id;
  };

  const deleteShapes = (ids) => {
    const arr = Array.isArray(ids) ? ids : [ids];
    editor.deleteShapes(arr);
    return arr;
  };

  // Delete only shapes created by this skill (shape:ai-* prefix).
  // Safe to run on any doc — will never touch user content.
  const cleanup = () => {
    const aiShapes = editor.getCurrentPageShapes().filter(s => s.id.startsWith(AI_PREFIX));
    const ids = aiShapes.map(s => s.id);
    if (ids.length) editor.deleteShapes(ids);
    return { deleted: ids.length, ids };
  };

  // ---- Read ----

  // Lightweight canvas summary for LLM context. `full:true` includes richText
  // content; default strips it and returns just plain text for token economy.
  const readCanvas = ({ full = false } = {}) => {
    const shapes = editor.getCurrentPageShapes();
    const summarize = (s) => {
      const out = { id: s.id, type: s.type, x: Math.round(s.x), y: Math.round(s.y) };
      if (s.props?.w) out.w = Math.round(s.props.w);
      if (s.props?.h) out.h = Math.round(s.props.h);
      if (s.props?.color) out.color = s.props.color;
      if (s.props?.geo) out.geo = s.props.geo;
      // Extract plain text from richText for readability
      if (s.props?.richText) {
        const text = plainText(s.props.richText);
        if (text) out.text = text;
      }
      if (s.type === 'arrow') {
        out.start = s.props.start;
        out.end = s.props.end;
        out.arrowheadEnd = s.props.arrowheadEnd;
      }
      if (full) out.raw = s;
      return out;
    };
    return {
      pageId: editor.getCurrentPageId(),
      totalShapes: shapes.length,
      shapes: shapes.map(summarize),
    };
  };

  // Extract plain text from ProseMirror doc (for summaries)
  const plainText = (doc) => {
    if (!doc || !doc.content) return '';
    const out = [];
    const walk = (n) => {
      if (n.type === 'text') out.push(n.text);
      else if (n.content) n.content.forEach(walk);
    };
    doc.content.forEach(walk);
    return out.join(' ').trim();
  };

  // ---- Camera + selection ----

  const zoomToFit = () => editor.zoomToFit();
  const zoomToShapes = (ids) => {
    const arr = Array.isArray(ids) ? ids : [ids];
    editor.select(...arr);
    editor.zoomToSelection();
  };
  const selectShapes = (ids) => editor.select(...(Array.isArray(ids) ? ids : [ids]));
  const clearSelection = () => editor.selectNone();

  // ---- Probe / meta ----

  const probe = () => ({
    ok: true,
    url: location.href,
    pageId: editor.getCurrentPageId(),
    shapeCount: editor.getCurrentPageShapes().length,
    aiShapeCount: editor.getCurrentPageShapes().filter(s => s.id.startsWith(AI_PREFIX)).length,
    registeredTypes: Object.keys(editor.shapeUtils || {}),
  });

  window.__td = {
    // Read
    probe, readCanvas, plainText,
    // Create
    createBox, createSticky, createText, createFrame, createArrow, richText,
    // Mutate
    updateShape, deleteShapes, cleanup,
    // Camera + selection
    zoomToFit, zoomToShapes, selectShapes, clearSelection,
    // Data
    ENUMS, AI_PREFIX,
    // Escape hatch
    editor,
  };

  return probe();
})();
