/* Shape Friends (age 3+): drag each shape or ball to the hole or basket that matches. A wrong drop just slides back; nothing can be lost.
   Pictures come from lib/kidskit.js (drawn, no image files). Text reaches the page only through textContent. */
(window.DesktopApps = window.DesktopApps || {}).kidshapes = (() => {
  function init(root) {
    const K = window.Kids, kd = root.querySelector(".kd"), stage = root.querySelector("#kidshapes-stage"), modes = root.querySelector("#kidshapes-modes");
    const kit = K.mount(kd, "kidshapes");
    const SHAPES = ["circle", "square", "triangle", "star", "heart", "diamond"];
    const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
    let mode = "shapes", round = 0, busy = false, remaining = 0, selected = null, targets = [], timers = [];
    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };

    // mode buttons (pictures, no words)
    const modeBtn = (id, label, pics) => {
      const b = el("button", "kd-mode"); b.type = "button"; b.dataset.mode = id; b.setAttribute("aria-label", label); b.title = label;
      for (const p of pics) b.append(p); modes.append(b); b.addEventListener("click", () => { mode = id; round = 0; paintModes(); newRound(); }); return b;
    };
    modeBtn("shapes", "Match the shapes", [K.icon("triangle", "orange", 34), K.icon("circle", "blue", 34)]);
    modeBtn("colours", "Match the colours", [K.icon("ball", "red", 30), K.icon("ball", "green", 30), K.icon("ball", "blue", 30)]);
    const paintModes = () => { for (const b of modes.children) { b.classList.toggle("on", b.dataset.mode === mode); b.setAttribute("aria-pressed", String(b.dataset.mode === mode)); } };

    function hit(cx, cy) {
      let best = null, bd = 1e9;
      for (const t of targets) {
        const r = t.getBoundingClientRect(); if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return t;
        const d = Math.hypot(cx - (r.left + r.width / 2), cy - (r.top + r.height / 2)); if (d < bd) { bd = d; best = t; }
      }
      return best && bd < 0.7 * best.getBoundingClientRect().width ? best : null;
    }
    function place(piece, target) {
      if (busy || !piece.isConnected) return;
      if (selected) { selected.classList.remove("sel"); selected = null; }
      if (!target || target.dataset.key !== piece.dataset.key) { piece.style.transform = ""; K.chime("soft"); return; }
      if (mode === "shapes") { target.textContent = ""; target.append(K.icon(piece.dataset.key, piece.dataset.color, 70)); target.classList.add("full"); }
      else { let box = target.querySelector(".kd-in"); box.append(K.icon("ball", piece.dataset.key, 26)); }
      piece.remove(); K.chime("good");
      if (--remaining === 0) finish();
    }
    function finish() {
      busy = true; K.chime("win"); K.celebrate(stage); kit.star(); round++; later(newRound, 2600);
    }
    function makePiece(key, color, shape) {
      const p = el("button", "kd-piece"); p.type = "button"; p.dataset.key = key; p.dataset.color = color; p.setAttribute("aria-label", (color === key ? "ball" : color + " " + key));
      p.append(K.icon(shape, color));
      K.drag(p, {
        start() { if (busy) return false; p.classList.add("drag"); if (selected) { selected.classList.remove("sel"); selected = null; } },
        move(dx, dy) { p.style.transform = "translate(" + dx + "px," + dy + "px)"; },
        end(dx, dy, e, cancelled) {
          p.classList.remove("drag");
          if (cancelled) { p.style.transform = ""; return; }
          if (Math.hypot(dx, dy) < 8) { p.style.transform = ""; selected = p; p.classList.add("sel"); K.chime("flip"); return; }
          const r = p.getBoundingClientRect(); place(p, hit(r.left + r.width / 2, r.top + r.height / 2));
        },
      });
      p.addEventListener("click", e => { if (e.detail === 0) { if (selected) selected.classList.remove("sel"); selected = p; p.classList.add("sel"); } }); // keyboard
      return p;
    }
    function newRound() {
      for (const t of timers) clearTimeout(t); timers = [];
      stage.textContent = ""; busy = false; selected = null; targets = [];
      const row = el("div", "kd-row"), tray = el("div", "kd-tray"), pieces = [];
      if (mode === "shapes") {
        const k = Math.min(6, 3 + Math.floor(round / 2)), names = K.shuffle(SHAPES).slice(0, k), cols = K.shuffle(K.PALETTE).slice(0, k);
        names.forEach((n, i) => {
          const h = el("div", "kd-hole"); h.dataset.key = n; h.append(K.icon(n, "#CBD7E8", 70)); row.append(h); targets.push(h);
          pieces.push(makePiece(n, cols[i], n));
        });
      } else {
        const k = Math.min(5, 3 + Math.floor(round / 3)), cols = K.shuffle(K.PALETTE).slice(0, k);
        for (const c of cols) {
          const b = el("button", "kd-basket"); b.type = "button"; b.dataset.key = c; b.setAttribute("aria-label", c + " basket");
          b.append(K.icon("basket", c, 100)); b.append(el("div", "kd-in")); row.append(b); targets.push(b);
          pieces.push(makePiece(c, c, "ball"), makePiece(c, c, "ball"));
        }
      }
      for (const t of targets) t.addEventListener("click", () => { if (selected) place(selected, t); });
      remaining = pieces.length;
      for (const p of K.shuffle(pieces)) tray.append(p);
      stage.append(row, tray);
    }
    paintModes(); newRound();
    return { destroy() { for (const t of timers) clearTimeout(t); kit.destroy(); } };
  }
  return { init };
})();
