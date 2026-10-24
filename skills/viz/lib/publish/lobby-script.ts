// lib/publish/lobby-script.ts — The lobby page's client script (the contents of its <script> element).
//
// Split out of lobby-render.ts; the JS is emitted byte-for-byte. It sorts, filters, toggles the
// list/grid view and reveals spoiler cards, all client-side over the cards the page already holds.

export const LOBBY_SCRIPT = `
  (function(){
    var cards=[].slice.call(document.querySelectorAll("a.card"));
    // Spoiler cards: the FIRST click reveals (unblurs) instead of navigating; a second click
    // opens the viz. So a spoiler is never sprung by a stray click, and never persists across
    // reloads (re-blurs on refresh). Keyboard Enter behaves the same (it fires a click).
    cards.forEach(function(c){
      if(!c.dataset.spoiler)return;
      c.addEventListener("click",function(e){
        if(c.classList.contains("revealed"))return;   // already revealed → let the link open
        e.preventDefault();e.stopPropagation();
        c.classList.add("revealed");
      });
    });
    // Age badge — a clock + relative time that TRACKS whichever time field you're sorting on
    // (created / modified; a Title sort falls back to modified). Rendered client-side so it stays
    // fresh, re-rendered when the key changes, and hovering shows BOTH absolute dates. Runs for
    // every card, even a lone one.
    var CLOCK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    function fmtAgo(ms){
      if(!ms)return "unknown";
      var m=(Date.now()-ms)/60000,h=m/60,d=h/24;
      if(m<1)return "just now";
      if(m<60)return Math.floor(m)+"m ago";
      if(h<24)return Math.floor(h)+"h ago";
      if(d<30)return Math.floor(d)+"d ago";
      if(d<365)return Math.floor(d/30)+"mo ago";
      return Math.floor(d/365)+"y ago";
    }
    function absDate(ms){return ms?new Date(ms).toLocaleString():"unknown";}
    function renderAges(field){                              // field: "created" | "modified"
      cards.forEach(function(c){
        var mt=+c.dataset.mtime||0, ct=+c.dataset.created||0;
        if(!mt&&!ct)return;
        var body=c.querySelector(".card__body")||c;
        var age=c.querySelector(".card__age");
        if(!age){age=document.createElement("div");age.className="card__age";body.appendChild(age);}
        age.innerHTML=CLOCK+"<span>"+field+" "+fmtAgo(field==="created"?ct:mt)+"</span>";
        age.title="created "+absDate(ct)+"  ·  modified "+absDate(mt);
      });
    }
    // Sort control — pick a KEY (modified / created / title) and, INDEPENDENTLY, a direction
    // (down=desc / up=asc) that applies to all three. Default: created, descending. The age badge
    // follows the key (title falls back to modified). Both choices persist per user.
    (function(){
      var bar=document.getElementById("viz-sort"),dirBtn=document.getElementById("viz-sortdir"),grid=document.querySelector(".grid");
      var key="created",dir="desc";
      try{key=localStorage.getItem("viz-sortkey")||key;}catch(e){}
      try{dir=localStorage.getItem("viz-sortdir")||dir;}catch(e){}
      function apply(){
        if(grid&&cards.length>1){
          var arr=cards.slice();
          arr.sort(function(a,b){
            var r;
            if(key==="title")r=(a.dataset.slug||"").localeCompare(b.dataset.slug||"");
            else{var f=key==="created"?"created":"mtime";r=(+a.dataset[f]||0)-(+b.dataset[f]||0);}
            return dir==="desc"?-r:r;
          });
          arr.forEach(function(c){grid.appendChild(c);});
        }
        if(bar)[].slice.call(bar.querySelectorAll(".seg")).forEach(function(s){
          var on=s.dataset.key===key;s.classList.toggle("on",on);s.setAttribute("aria-pressed",on);});
        if(dirBtn){dirBtn.textContent=dir==="desc"?"↓":"↑";dirBtn.dataset.dir=dir;
          dirBtn.title=(dir==="desc"?"Descending":"Ascending")+" — click to toggle";}
        renderAges(key==="created"?"created":"modified");
        try{localStorage.setItem("viz-sortkey",key);localStorage.setItem("viz-sortdir",dir);}catch(e){}
      }
      if(bar)[].slice.call(bar.querySelectorAll(".seg")).forEach(function(s){s.onclick=function(){key=s.dataset.key;apply();};});
      if(dirBtn)dirBtn.onclick=function(){dir=dir==="desc"?"asc":"desc";apply();};
      apply();
    })();
    // View toggle (list <-> grid) — independent of search/facets. Defaults to grid;
    // the user's choice is remembered in localStorage.
    (function(){
      var bar=document.getElementById("viz-viewbar"),group=document.getElementById("viz-view"),grid=document.querySelector(".grid");
      if(!bar||!group||!grid||cards.length<2)return;
      bar.hidden=false;
      var segs=[].slice.call(group.querySelectorAll(".seg"));   // scope to the View group only — .seg also matches the Sort group
      var saved=null;try{saved=localStorage.getItem("viz-view");}catch(e){}
      function set(v){
        grid.classList.toggle("grid--cards",v==="cards");
        segs.forEach(function(s){var on=s.dataset.view===v;s.classList.toggle("on",on);s.setAttribute("aria-pressed",on);});
        try{localStorage.setItem("viz-view",v);}catch(e){}
      }
      segs.forEach(function(s){s.onclick=function(){set(s.dataset.view);};});
      set(saved||"cards");                          // default to grid; user's toggle sticks
    })();
    var toolbar=document.getElementById("viz-toolbar");
    if(cards.length<2)return;                       // nothing worth filtering
    toolbar.hidden=false;
    var search=document.getElementById("viz-search"),facetBox=document.getElementById("viz-facets"),
        count=document.getElementById("viz-count"),empty=document.getElementById("viz-empty");
    var cap=function(s){return s.charAt(0).toUpperCase()+s.slice(1);};
    var uniq=function(a){return a.filter(function(v,i){return v&&a.indexOf(v)===i;});};
    var groups=[
      {key:"Posture",attr:"posture",label:cap,values:uniq(cards.map(function(c){return c.dataset.posture;}))},
      {key:"Tags",attr:"tags",multi:true,label:function(v){return v;},
        values:uniq([].concat.apply([],cards.map(function(c){return c.dataset.tags?c.dataset.tags.split("|"):[];})))},
      {key:"Kind",attr:"kind",label:function(v){return cap(v.replace("-"," "));},
        values:uniq(cards.map(function(c){return c.dataset.kind;}))}
    ];
    var sel={};                                     // group.key -> Set of active values (OR within, AND across)
    groups.forEach(function(g){
      sel[g.key]=new Set();
      if(g.values.length<2)return;                  // one value = pointless facet
      var wrap=document.createElement("span");wrap.className="facet";
      var lab=document.createElement("span");lab.className="facet-label";lab.textContent=g.key;wrap.appendChild(lab);
      g.values.forEach(function(v){
        var chip=document.createElement("button");chip.type="button";chip.className="chip";chip.textContent=g.label(v);
        chip.onclick=function(){
          if(sel[g.key].has(v)){sel[g.key].delete(v);chip.classList.remove("on");}
          else{sel[g.key].add(v);chip.classList.add("on");}
          apply();
        };
        wrap.appendChild(chip);
      });
      facetBox.appendChild(wrap);
    });
    var esc=function(s){return s.replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c];});};
    var rx=function(s){return s.replace(/[.*+?^\${}()|[\\]\\\\]/g,"\\\\$&");};
    function hl(el,terms){                            // wrap each term in <mark>, restore when none
      if(!el)return;
      if(el.dataset.orig==null)el.dataset.orig=el.textContent;
      var raw=el.dataset.orig;
      if(!terms.length){el.textContent=raw;return;}
      var re=new RegExp("("+terms.map(rx).join("|")+")","ig"),out="",last=0,m;
      while((m=re.exec(raw))){
        out+=esc(raw.slice(last,m.index))+"<mark>"+esc(m[0])+"</mark>";
        last=m.index+m[0].length;
        if(m.index===re.lastIndex)re.lastIndex++;
      }
      el.innerHTML=out+esc(raw.slice(last));
    }
    function apply(){
      var terms=search.value.toLowerCase().split(/\\s+/).filter(Boolean),shown=0;
      cards.forEach(function(c){
        var ok=terms.every(function(t){return (c.dataset.search||"").indexOf(t)>=0;});
        groups.forEach(function(g){
          if(!ok||!sel[g.key].size)return;
          if(g.multi){var vals=c.dataset.tags?c.dataset.tags.split("|"):[];ok=vals.some(function(v){return sel[g.key].has(v);});}
          else ok=sel[g.key].has(c.dataset[g.attr]);
        });
        c.style.display=ok?"":"none";
        if(ok){shown++;hl(c.querySelector("h2"),terms);hl(c.querySelector("p"),terms);[].forEach.call(c.querySelectorAll(".tags .tag"),function(t){hl(t,terms);});}
      });
      count.textContent=shown+" / "+cards.length;
      empty.hidden=shown>0;
    }
    search.addEventListener("input",apply);
    document.addEventListener("keydown",function(e){
      if(e.key==="/"&&document.activeElement!==search){e.preventDefault();search.focus();}
      else if(e.key==="Escape"&&document.activeElement===search){search.value="";apply();search.blur();}
    });
    apply();
  })();
`;
