// lib/publish/lobby-styles.ts — The lobby page's stylesheet (the contents of its <style> element).
//
// Split out of lobby-render.ts; the CSS is emitted byte-for-byte.

export const LOBBY_CSS = `
  :root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;
    --accent:#58a6ff;--c4:#bc8cff;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}
  *{box-sizing:border-box}html,body{margin:0;height:100%}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);line-height:1.5;
    display:flex;flex-direction:column;align-items:center;padding:48px 11px 64px}
  .wrap{width:100%;max-width:1600px}
  .eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin:0 0 24px}
  .preamble{margin:0 0 28px;color:#cdd6e0;font-size:15px}
  .preamble :where(h1,h2,h3){color:var(--text);letter-spacing:-0.01em;margin:0 0 10px}
  .preamble p{margin:0 0 12px}
  .preamble a{color:var(--accent);text-decoration:none}
  .preamble a:hover{text-decoration:underline}
  .preamble code{font-family:var(--mono);font-size:.92em}
  .grid{display:grid;gap:16px}
  a.card{display:block;text-decoration:none;color:inherit;background:var(--panel);
    border:1px solid var(--border);border-radius:14px;overflow:hidden;transition:.16s}
  a.card:hover{border-color:var(--accent);background:#11203a;transform:translateY(-1px)}
  .card__body{padding:20px 22px}
  .card__thumb{display:none}
  /* List view: OG thumbnail as a full-height strip at the row's left edge, mirroring the
     self-portrait rows. Absolutely positioned so it never breaks the spoiler veil / body
     order; scoped to :not(.grid--cards) so the grid rules below re-lay the same <img> as a
     full-width hero. Thumbless rows (private, or public with no og) get a placeholder strip
     so every row's left edge stays aligned. */
  .grid:not(.grid--cards) a.card{position:relative;padding-left:112px}
  .grid:not(.grid--cards) .card__thumb,
  .grid:not(.grid--cards) a.card:not(.has-thumb)::before{
    position:absolute;left:0;top:0;bottom:0;width:112px;
    object-fit:cover;background:#0b1220;border-right:1px solid var(--border)}
  .grid:not(.grid--cards) .card__thumb{display:block}
  .grid:not(.grid--cards) a.card:not(.has-thumb)::before{content:"";
    background:linear-gradient(135deg,#11203a,#1b2942)}
  .grid:not(.grid--cards) a.card--private:not(.has-thumb)::before{content:"\\1F512";display:flex;
    align-items:center;justify-content:center;font-size:24px;color:var(--muted);
    background:linear-gradient(135deg,#161b22,#20262f)}
  /* Grid / cards view: multi-column, hero image on top, description clamped. */
  .grid.grid--cards{grid-template-columns:repeat(auto-fill,minmax(400px,1fr))}
  .grid--cards a.card{display:flex;flex-direction:column}
  .grid--cards .card__thumb{display:block;width:100%;aspect-ratio:1200/630;object-fit:cover;
    background:#0b1220;border-bottom:1px solid var(--border)}
  .grid--cards a.card:not(.has-thumb) .card__body{padding-top:20px}
  .grid--cards a.card:not(.has-thumb)::before{content:"";display:block;aspect-ratio:1200/630;
    background:linear-gradient(135deg,#11203a,#1b2942);border-bottom:1px solid var(--border)}
  .grid--cards a.card--private:not(.has-thumb)::before{content:"\\1F512";display:flex;
    align-items:center;justify-content:center;font-size:30px;color:var(--muted);
    background:linear-gradient(135deg,#161b22,#20262f)}
  .grid--cards .card__body{padding:16px 18px}
  .grid--cards .card__body p{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .card .tags{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
  .card .tag{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--c4)}
  .card .tag--kind{color:var(--muted);border:1px solid currentColor;border-radius:999px;padding:1px 7px;letter-spacing:.06em}
  .card h2{font-size:19px;margin:7px 0 8px;letter-spacing:-0.01em}
  .card p{margin:0 0 12px;color:#cdd6e0;font-size:14px}
  .card .go{font-size:13.5px;color:var(--accent);font-weight:600}
  .card .go::after{content:" →"}
  .card--private .tag{color:var(--muted)}
  .card--private:hover{border-color:var(--muted)}
  .card .go--locked{color:var(--muted);font-weight:500}
  .card .go--locked::after{content:""}
  /* Spoiler cards: hero image + blurb blurred, with a warning strip, until clicked to reveal.
     The strip sits in normal flow (banner under the hero in grid; top of the card in list). */
  .card__veil{display:flex;align-items:center;gap:8px;padding:9px 18px;cursor:pointer;
    font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;
    color:#f0b429;background:rgba(240,180,41,.1);border-bottom:1px solid rgba(240,180,41,.25)}
  .card__veil span{font-size:13px;line-height:1}
  .card.revealed .card__veil{display:none}
  .card.has-spoiler:not(.revealed) .card__thumb{filter:blur(26px)}
  .card.has-spoiler:not(.revealed) .card__body p{filter:blur(6px);user-select:none}
  .card.has-spoiler:not(.revealed):hover{border-color:#f0b429}
  .toolbar{margin:0 0 22px}
  .search-row{display:flex;align-items:center;gap:12px;margin:0 0 12px}
  #viz-search{flex:1;min-width:0;background:var(--panel);border:1px solid var(--border);border-radius:10px;
    color:var(--text);font:15px/1.4 var(--sans);padding:10px 14px;outline:none}
  #viz-search:focus{border-color:var(--accent)}
  #viz-search::placeholder{color:var(--muted)}
  .viz-count{font-family:var(--mono);font-size:12px;color:var(--muted);white-space:nowrap}
  .facets{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center}
  .facet{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .facet-label{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-right:2px}
  .chip{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;
    color:var(--muted);background:var(--panel);border:1px solid var(--border);border-radius:999px;
    padding:4px 11px;cursor:pointer;user-select:none;transition:.14s;line-height:1.4}
  .chip:hover{border-color:var(--accent);color:var(--text)}
  .chip.on{background:#11203a;border-color:var(--accent);color:var(--accent)}
  .card__age{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:11px;
    letter-spacing:.04em;color:var(--muted);margin-top:10px}
  .card__age svg{width:12px;height:12px;opacity:.85}
  .viewbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 14px}
  .segmented{display:inline-flex;background:var(--panel);border:1px solid var(--border);border-radius:999px;padding:2px}
  .seg{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;
    color:var(--muted);background:none;border:0;border-radius:999px;padding:5px 13px;cursor:pointer;transition:.14s}
  .seg:hover{color:var(--text)}
  .seg.on{background:#11203a;color:var(--accent)}
  .sortwrap{display:inline-flex;align-items:center;gap:8px}
  .segdir{font-family:var(--mono);font-size:14px;line-height:1;color:var(--muted);background:var(--panel);
    border:1px solid var(--border);border-radius:999px;padding:6px 11px;cursor:pointer;transition:.14s;min-width:34px}
  .segdir:hover{color:var(--accent);border-color:var(--accent)}
  .viz-empty{color:var(--muted);text-align:center;padding:40px 0;font-size:15px}
  .card mark{background:rgba(240,136,62,.32);color:inherit;border-radius:3px;padding:0 1px}
  .card .tag mark{background:rgba(240,136,62,.42)}
`;
