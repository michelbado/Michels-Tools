/* Count and Pop (age 3 to 5): tap things one by one to count them, or tap the group that has more. Nothing can be lost. */
(window.DesktopApps = window.DesktopApps || {}).kidcount = (() => {
  function init(root) {
    const K = window.Kids, kd = root.querySelector(".kd"), stage = root.querySelector("#kidcount-stage"), modes = root.querySelector("#kidcount-modes");
    const kit = K.mount(kd, "kidcount");
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    let mode = "count", timers = [], busy = false;
    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
    const level = () => Math.floor(K.stars.of("kidcount") / 4);

    const modeBtn = (id, label, pics, text) => {
      const b = el("button", "kd-mode"); b.type = "button"; b.dataset.mode = id; b.setAttribute("aria-label", label); b.title = label;
      for (const p of pics) b.append(p); if (text) b.append(el("span", null, text)); modes.append(b); b.addEventListener("click", () => { mode = id; paint(); newRound(); });
    };
    modeBtn("count", "Count them", [K.icon("apple", "red", 34)], "1 2 3");
    modeBtn("more", "Which has more?", [K.icon("star", "yellow", 26), K.icon("star", "yellow", 26), K.icon("star", "yellow", 26)], ">");
    const paint = () => { for (const b of modes.children) { b.classList.toggle("on", b.dataset.mode === mode); b.setAttribute("aria-pressed", String(b.dataset.mode === mode)); } };

    function finish() { busy = true; K.chime("win"); K.celebrate(stage); kit.star(); later(newRound, 2600); }

    function countRound() {
      const r = K.countRound(level()), big = el("div", "kd-big", "0"), dots = el("div", "kd-dots"), field = el("div", "kd-field");
      let n = 0;
      big.setAttribute("aria-live", "polite");
      for (let i = 0; i < r.n; i++) {
        const o = el("button", "kd-obj"); o.type = "button"; o.setAttribute("aria-label", "Tap to count"); o.append(K.icon(r.kind, r.color));
        const badge = el("span", "kd-badge"); o.append(badge);
        o.style.transform = "translate(" + Math.round((Math.random() - .5) * 14) + "px," + Math.round((Math.random() - .5) * 14) + "px)";
        o.addEventListener("click", () => {
          if (busy || o.classList.contains("done")) return;
          n++; o.classList.add("done"); o.style.transform = ""; badge.textContent = String(n); big.textContent = String(n); dots.append(el("i")); K.chime("pop", n);
          if (n === r.n) finish();
        });
        field.append(o);
      }
      stage.append(big, dots, field);
    }
    function moreRound() {
      const r = K.moreRound(level()), groups = el("div", "kd-groups"), hint = el("div", "kd-big", "?");
      let wrong = 0;
      for (const [count, other] of [[r.a, r.b], [r.b, r.a]]) {
        const g = el("button", "kd-group"); g.type = "button"; g.setAttribute("aria-label", "Group of things");
        for (let i = 0; i < count; i++) g.append(K.icon(r.kind, r.color));
        const num = el("div", "kd-num"); g.append(num);
        g.addEventListener("click", () => {
          if (busy) return;
          if (count > other) {
            g.classList.add("right"); for (const x of groups.children) x.querySelector(".kd-num").textContent = x.dataset.n; hint.textContent = ">"; K.chime("good"); finish();
          } else { wrong++; g.classList.remove("shake"); void g.offsetWidth; g.classList.add("shake"); K.chime("soft"); if (wrong >= 2) for (const x of groups.children) x.querySelector(".kd-num").textContent = x.dataset.n; }
        });
        g.dataset.n = String(count); groups.append(g);
      }
      stage.append(hint, groups);
    }
    function newRound() {
      for (const t of timers) clearTimeout(t); timers = [];
      stage.textContent = ""; busy = false;
      if (mode === "count") countRound(); else moreRound();
    }
    paint(); newRound();
    return { destroy() { for (const t of timers) clearTimeout(t); kit.destroy(); } };
  }
  return { init };
})();
