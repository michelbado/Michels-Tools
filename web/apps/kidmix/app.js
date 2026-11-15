/* Colour Mixing (age 3 to 6): drop two paints in the bowl and see what colour they make. "Mix" is free play (new colours earn a star); "Make it" shows a colour to match. Nothing can be lost. */
(window.DesktopApps = window.DesktopApps || {}).kidmix = (() => {
  function init(root) {
    const K = window.Kids, kd = root.querySelector(".kd"), stage = root.querySelector("#kidmix-stage"), modes = root.querySelector("#kidmix-modes");
    const kit = K.mount(kd, "kidmix");
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const hex = c => K.MIX_HEX[c];
    let mode = "mix", bowl = [], target = null, lock = false, timers = [];
    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
    const found = () => { const o = K.store.get(); return Array.isArray(o.mixFound) ? o.mixFound : []; };
    const markFound = c => { const o = K.store.get(), f = found(); if (!f.includes(c)) f.push(c); o.mixFound = f; K.store.set(o); };

    const modeBtn = (id, label, pics) => {
      const b = el("button", "kd-mode"); b.type = "button"; b.dataset.mode = id; b.setAttribute("aria-label", label); b.title = label;
      for (const p of pics) b.append(p); modes.append(b); b.addEventListener("click", () => { mode = id; paintModes(); reset(); });
    };
    modeBtn("mix", "Mix colours freely", [K.icon("ball", "red", 30), K.icon("ball", "yellow", 30)]);
    modeBtn("make", "Make this colour", [K.icon("ball", "orange", 34), K.icon("star", "yellow", 22)]);
    const paintModes = () => { for (const b of modes.children) { b.classList.toggle("on", b.dataset.mode === mode); b.setAttribute("aria-pressed", String(b.dataset.mode === mode)); } };

    // the screen
    const targetBox = el("div", "kd-target"), swatchT = el("div", "kd-swatch big"); targetBox.append(swatchT);
    const potRow = el("div", "kd-row"), pots = [];
    const slots = el("div", "kd-slots"), s1 = el("span", "kd-dotc"), s2 = el("span", "kd-dotc"); slots.append(s1, s2);
    const bowlEl = el("div", "kd-bowl"), fill = el("div", "kd-bowlfill"); bowlEl.append(fill);
    const caption = el("div", "kd-mixcap"); caption.setAttribute("aria-live", "polite");
    const bin = el("button", "kd-bigbtn"); bin.type = "button"; bin.setAttribute("aria-label", "Empty the bowl"); bin.append(K.icon("bin", "#C23A14")); bin.addEventListener("click", () => { if (!lock) { bowl = []; paint(); caption.textContent = ""; } });
    const mid = el("div", "kd-mixmid"); mid.append(slots, bowlEl, bin);
    const coll = el("div", "kd-coll");
    const swatches = {}; for (const c of K.MIX_RESULTS) { const s = el("div", "kd-swatch"); s.dataset.c = c; s.title = c; coll.append(s); swatches[c] = s; }
    stage.append(targetBox, potRow, mid, caption, coll);

    function paintColl() { const f = found(); for (const [c, s] of Object.entries(swatches)) { const on = f.includes(c); s.classList.toggle("found", on); s.style.background = on ? hex(c) : ""; s.setAttribute("aria-label", on ? c + " found" : "not found yet"); } }
    function paint() {
      s1.style.background = bowl[0] ? hex(bowl[0]) : ""; s2.style.background = bowl[1] ? hex(bowl[1]) : "";
      const res = bowl.length === 2 ? K.mix(bowl[0], bowl[1]) : bowl[0];
      fill.style.background = res ? hex(res) : ""; fill.classList.toggle("empty", !res);
    }
    function dotsCaption(a, b, r) {
      caption.textContent = "";
      for (const [c, txt] of [[a, "+"], [b, "="], [r, ""]]) { const d = el("span", "kd-dotc big"); d.style.background = hex(c); caption.append(d); if (txt) caption.append(el("span", "kd-op", txt)); }
      caption.append(el("span", "kd-name", r));
    }
    function add(c) {
      if (lock) return;
      if (bowl.length >= 2) bowl = [];
      bowl.push(c); paint(); K.chime("pop", bowl.length * 3);
      if (bowl.length < 2) { caption.textContent = ""; return; }
      const res = K.mix(bowl[0], bowl[1]); dotsCaption(bowl[0], bowl[1], res);
      bowlEl.classList.remove("pop"); void bowlEl.offsetWidth; bowlEl.classList.add("pop");
      if (mode === "mix") {
        if (!K.POTS.includes(res) && !found().includes(res)) { markFound(res); paintColl(); kit.star(); K.chime("win"); K.celebrate(stage); } else K.chime("good");
      } else if (res === target) {
        lock = true; K.chime("win"); K.celebrate(stage); kit.star(); later(reset, 2600);
      } else {
        K.chime("soft"); lock = true; bowlEl.classList.remove("shake"); void bowlEl.offsetWidth; bowlEl.classList.add("shake");
        later(() => { bowl = []; lock = false; paint(); caption.textContent = ""; }, 1500);
      }
    }
    for (const c of K.POTS) {
      const p = el("button", "kd-pot"); p.type = "button"; p.dataset.c = c; p.setAttribute("aria-label", c + " paint"); p.append(K.icon("ball", hex(c)));
      K.drag(p, {
        start() { if (lock) return false; p.classList.add("drag"); },
        move(dx, dy) { p.style.transform = "translate(" + dx + "px," + dy + "px)"; },
        end(dx, dy, e, cancelled) {
          p.classList.remove("drag");
          const r = p.getBoundingClientRect(), b = bowlEl.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          p.style.transform = "";
          if (cancelled) return;
          if (Math.hypot(dx, dy) < 8 || (cx >= b.left - 20 && cx <= b.right + 20 && cy >= b.top - 20 && cy <= b.bottom + 20)) add(c);
        },
      });
      p.addEventListener("click", e => { if (e.detail === 0) add(c); }); // keyboard
      potRow.append(p); pots.push(p);
    }
    function reset() {
      for (const t of timers) clearTimeout(t); timers = []; lock = false; bowl = []; paint(); caption.textContent = "";
      targetBox.hidden = mode !== "make"; coll.hidden = mode !== "mix";
      if (mode === "make") { let t; do t = K.pick(K.MIX_RESULTS); while (t === target && K.MIX_RESULTS.length > 1); target = t; swatchT.style.background = hex(t); swatchT.setAttribute("aria-label", "Make this colour"); }
    }
    paintModes(); paintColl(); reset();
    return { destroy() { for (const t of timers) clearTimeout(t); kit.destroy(); } };
  }
  return { init };
})();
