/* Memory Pairs (age 4 to 7): turn over two cards at a time and find the matching pictures. Starts with 3 pairs and grows slowly. No counting of mistakes. */
(window.DesktopApps = window.DesktopApps || {}).kidmemory = (() => {
  function init(root) {
    const K = window.Kids, kd = root.querySelector(".kd"), stage = root.querySelector("#kidmemory-stage"), modes = root.querySelector("#kidmemory-modes");
    const kit = K.mount(kd, "kidmemory");
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    // [icon, colour]: one fixed, friendly colour per picture so two pictures never look alike
    const PICS = [["sun", "yellow"], ["moon", "purple"], ["fish", "blue"], ["flower", "pink"], ["tree", "green"], ["house", "orange"], ["apple", "red"], ["cat", "orange"], ["cloud", "blue"], ["heart", "red"], ["balloon", "purple"], ["star", "yellow"]];
    const SIZES = [{ pairs: 3, cols: 3 }, { pairs: 4, cols: 4 }, { pairs: 6, cols: 4 }, { pairs: 8, cols: 4 }];
    let size = 0, wins = 0, first = null, lock = false, left = 0, timers = [];
    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };

    SIZES.forEach((s, i) => {
      const b = el("button", "kd-mode", String(s.pairs * 2)); b.type = "button"; b.dataset.size = String(i); b.setAttribute("aria-label", s.pairs * 2 + " cards"); b.title = s.pairs * 2 + " cards";
      b.prepend(K.icon("square", "blue", 26)); modes.append(b); b.addEventListener("click", () => { size = i; wins = 0; paint(); deal(); });
    });
    const paint = () => { for (const b of modes.children) { const on = Number(b.dataset.size) === size; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); } };

    function deal() {
      for (const t of timers) clearTimeout(t); timers = [];
      stage.textContent = ""; first = null; lock = false;
      const s = SIZES[size], chosen = K.shuffle(PICS).slice(0, s.pairs), deck = K.shuffle([...chosen, ...chosen]);
      left = s.pairs;
      const grid = el("div", "kd-cards"); grid.style.gridTemplateColumns = "repeat(" + s.cols + ", minmax(0, 1fr))";
      for (const [icon, color] of deck) {
        const c = el("button", "kd-card"); c.type = "button"; c.dataset.key = icon; c.setAttribute("aria-label", "Card, face down");
        const back = el("div", "kd-face kd-back"), front = el("div", "kd-face kd-front");
        back.append(K.icon("star", "#ffffff")); front.append(K.icon(icon, color)); c.append(back, front);
        c.addEventListener("click", () => flip(c));
        grid.append(c);
      }
      stage.append(grid);
    }
    function flip(c) {
      if (lock || c.classList.contains("up")) return;
      c.classList.add("up"); c.setAttribute("aria-label", "Card: " + c.dataset.key); K.chime("flip");
      if (!first) { first = c; return; }
      const a = first; first = null;
      if (a.dataset.key === c.dataset.key) {
        a.classList.add("matched"); c.classList.add("matched"); K.chime("good");
        if (--left === 0) { lock = true; K.chime("win"); K.celebrate(stage); kit.star(); wins++; if (wins >= 2 && size < SIZES.length - 1) { size++; wins = 0; paint(); } later(deal, 2800); }
      } else {
        lock = true;
        later(() => { a.classList.remove("up"); c.classList.remove("up"); a.setAttribute("aria-label", "Card, face down"); c.setAttribute("aria-label", "Card, face down"); lock = false; }, 1000);
      }
    }
    paint(); deal();
    return { destroy() { for (const t of timers) clearTimeout(t); kit.destroy(); } };
  }
  return { init };
})();
