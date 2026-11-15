/* Kids kit: shared by the four children's games (Shape Friends, Count and Pop, Memory Pairs, Robot Path).
   - Every picture is drawn here as SVG (no image files, nothing loaded from anywhere).
   - Sound is WebAudio and OFF until a grown-up taps the Sound button.
   - Stars are kept only in this browser (localStorage key michels-tools-kids) and are never sent.
   - After 15 minutes of play a gentle "time for a break" card appears; a grown-up can allow a little more.
   Pure helpers (rnd, shuffle, countRound, moreRound) also run in Node for tests. Exports window.Kids. */
(() => {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const COLORS = { red: "#E53935", blue: "#1E88E5", yellow: "#FDD835", green: "#43A047", orange: "#FB8C00", purple: "#8E24AA", pink: "#EC407A" };
  const PALETTE = Object.keys(COLORS);

  // ---- random helpers (rnd is injectable so tests are repeatable) ----------------------------------------------------
  const rnd = (n, r) => Math.floor((r || Math.random)() * n);
  const pick = (a, r) => a[rnd(a.length, r)];
  function shuffle(a, r) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = rnd(i + 1, r); [b[i], b[j]] = [b[j], b[i]]; } return b; }

  // ---- rounds for Count and Pop ----------------------------------------------------------------------------------------
  // level 0.. : how many things may be counted. Counting rounds go 1..3, 1..5, then up to 8 and 10; always at least 1.
  const maxCount = level => level < 2 ? 3 : level < 4 ? 5 : level < 7 ? 8 : 10;
  function countRound(level, r) { const m = maxCount(level); return { n: 1 + rnd(m, r), kind: pick(["apple", "balloon", "star", "fish"], r), color: pick(["red", "blue", "yellow", "green", "orange", "purple"], r) }; }
  // two groups, never equal; the gap shrinks with the level so it stays easy at first
  function moreRound(level, r) {
    const m = Math.max(3, maxCount(level)), gap = level < 2 ? 2 : 1;
    let a, b; do { a = 1 + rnd(m, r); b = 1 + rnd(m, r); } while (Math.abs(a - b) < gap);
    return { a, b, kind: pick(["apple", "balloon", "star", "fish"], r), color: pick(["red", "blue", "yellow", "green", "orange", "purple"], r) };
  }

  // ---- Odd One Out: one picture does not belong ------------------------------------------------------------------------------
  const SHAPE_ICONS = ["circle", "square", "triangle", "star", "heart", "diamond"];
  const GROUPS = { sky: ["sun", "moon", "cloud", "star"], plants: ["tree", "flower", "apple"], shapes: ["circle", "square", "triangle", "diamond"] }; // no picture is in two groups
  // level 0: a different shape; 1: a different colour too; 2 and up: a different kind of thing too. More pictures as the level grows. Exactly one is odd.
  function oddRound(level, r) {
    const n = level < 3 ? 4 : level < 5 ? 5 : 6, type = pick(level < 1 ? ["shape"] : level < 2 ? ["shape", "colour"] : ["shape", "colour", "group"], r);
    let items, oddItem;
    if (type === "shape") {
      const s = pick(SHAPE_ICONS, r), c = pick(PALETTE, r); let o; do o = pick(SHAPE_ICONS, r); while (o === s);
      items = Array.from({ length: n - 1 }, () => ({ icon: s, color: c })); oddItem = { icon: o, color: c };
    } else if (type === "colour") {
      const s = pick(SHAPE_ICONS, r), c = pick(PALETTE, r); let o; do o = pick(PALETTE, r); while (o === c);
      items = Array.from({ length: n - 1 }, () => ({ icon: s, color: c })); oddItem = { icon: s, color: o };
    } else {
      const names = Object.keys(GROUPS), a = pick(names, r); let b; do b = pick(names, r); while (b === a);
      const pool = shuffle(GROUPS[a], r);
      items = Array.from({ length: n - 1 }, (_, i) => ({ icon: pool[i % pool.length], color: pick(PALETTE, r) })); oddItem = { icon: pick(GROUPS[b], r), color: pick(PALETTE, r) };
    }
    const odd = rnd(n, r); items.splice(odd, 0, oddItem);
    return { type, items, odd };
  }

  // ---- Colour Mixing -----------------------------------------------------------------------------------------------------
  const POTS = ["red", "yellow", "blue", "white"];
  const MIX_HEX = { red: "#E53935", yellow: "#FDD835", blue: "#1E88E5", white: "#FFFFFF", orange: "#FB8C00", green: "#43A047", purple: "#8E24AA", pink: "#F48FB1", cream: "#FFF59D", sky: "#81D4FA" };
  const MIXES = { "red+yellow": "orange", "blue+yellow": "green", "blue+red": "purple", "red+white": "pink", "white+yellow": "cream", "blue+white": "sky" }; // keys sorted
  const mix = (a, b) => a === b ? a : MIXES[[a, b].sort().join("+")] || null;
  const MIX_RESULTS = [...new Set(Object.values(MIXES))];

  // ---- pictures ---------------------------------------------------------------------------------------------------------
  const rays = (n, r0, r1) => Array.from({ length: n }, (_, i) => { const a = i * 2 * Math.PI / n; return ["line", { x1: 50 + r0 * Math.cos(a), y1: 50 + r0 * Math.sin(a), x2: 50 + r1 * Math.cos(a), y2: 50 + r1 * Math.sin(a), stroke: "$", "stroke-width": 8, "stroke-linecap": "round" }]; });
  const starPts = (cx, cy, R, r) => Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? r : R; return (cx + d * Math.cos(a)).toFixed(1) + "," + (cy + d * Math.sin(a)).toFixed(1); }).join(" ");
  // "$" = the main colour; every other colour is fixed
  const ICONS = {
    circle: () => [["circle", { cx: 50, cy: 50, r: 42 }]],
    square: () => [["rect", { x: 10, y: 10, width: 80, height: 80, rx: 12 }]],
    triangle: () => [["polygon", { points: "50,10 92,86 8,86", stroke: "$", "stroke-width": 8, "stroke-linejoin": "round" }]],
    diamond: () => [["polygon", { points: "50,6 92,50 50,94 8,50", stroke: "$", "stroke-width": 6, "stroke-linejoin": "round" }]],
    star: () => [["polygon", { points: starPts(50, 54, 46, 20), stroke: "$", "stroke-width": 6, "stroke-linejoin": "round" }]],
    heart: () => [["path", { d: "M50 88 C10 58 6 30 28 18 C40 12 50 22 50 30 C50 22 60 12 72 18 C94 30 90 58 50 88 Z" }]],
    moon: () => [["path", { d: "M64 8 C34 12 14 32 14 56 C14 78 34 92 56 92 C72 92 86 84 92 72 C60 76 40 54 46 28 C48 20 54 12 64 8 Z" }]],
    sun: () => [["circle", { cx: 50, cy: 50, r: 24 }], ...rays(8, 34, 46)],
    fish: () => [["ellipse", { cx: 44, cy: 50, rx: 34, ry: 24 }], ["polygon", { points: "74,50 96,30 96,70" }], ["circle", { cx: 30, cy: 44, r: 6, fill: "#fff" }], ["circle", { cx: 29, cy: 44, r: 3, fill: "#263238" }]],
    flower: () => [...[0, 1, 2, 3, 4].map(i => { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; return ["circle", { cx: 50 + 26 * Math.cos(a), cy: 50 + 26 * Math.sin(a), r: 18 }]; }), ["circle", { cx: 50, cy: 50, r: 13, fill: "#FFD54F" }]],
    tree: () => [["rect", { x: 43, y: 58, width: 14, height: 34, rx: 3, fill: "#8D6E63" }], ["circle", { cx: 50, cy: 38, r: 30 }]],
    house: () => [["rect", { x: 16, y: 44, width: 68, height: 46, rx: 4 }], ["polygon", { points: "8,48 50,10 92,48", fill: "#8D6E63" }], ["rect", { x: 42, y: 62, width: 16, height: 28, rx: 3, fill: "#FFF8E1" }]],
    apple: () => [["circle", { cx: 50, cy: 58, r: 34 }], ["path", { d: "M50 26 C50 18 52 12 58 8", stroke: "#6D4C41", "stroke-width": 5, "stroke-linecap": "round", fill: "none" }], ["ellipse", { cx: 64, cy: 20, rx: 13, ry: 7, fill: "#43A047", transform: "rotate(-25 64 20)" }]],
    cat: () => [["circle", { cx: 50, cy: 58, r: 34 }], ["polygon", { points: "18,38 22,6 46,26" }], ["polygon", { points: "82,38 78,6 54,26" }], ["circle", { cx: 38, cy: 54, r: 5, fill: "#263238" }], ["circle", { cx: 62, cy: 54, r: 5, fill: "#263238" }], ["polygon", { points: "44,66 56,66 50,74", fill: "#F48FB1" }]],
    cloud: () => [["circle", { cx: 32, cy: 58, r: 22 }], ["circle", { cx: 56, cy: 44, r: 26 }], ["circle", { cx: 76, cy: 62, r: 18 }], ["rect", { x: 32, y: 58, width: 44, height: 22, rx: 8 }]],
    balloon: () => [["ellipse", { cx: 50, cy: 42, rx: 30, ry: 36 }], ["polygon", { points: "50,76 43,88 57,88" }], ["path", { d: "M50 88 C42 94 58 96 50 100", stroke: "#78909C", "stroke-width": 3, fill: "none" }], ["ellipse", { cx: 38, cy: 28, rx: 6, ry: 10, fill: "#fff", opacity: ".35" }]],
    ball: () => [["circle", { cx: 50, cy: 50, r: 42 }], ["circle", { cx: 36, cy: 34, r: 10, fill: "#fff", opacity: ".45" }]],
    basket: () => [["polygon", { points: "12,34 88,34 76,90 24,90", stroke: "$", "stroke-width": 4, "stroke-linejoin": "round" }], ["rect", { x: 6, y: 24, width: 88, height: 14, rx: 7, fill: "#000", opacity: ".18" }]],
    robot: () => [["line", { x1: 50, y1: 16, x2: 50, y2: 28, stroke: "#546E7A", "stroke-width": 5, "stroke-linecap": "round" }], ["circle", { cx: 50, cy: 13, r: 6, fill: "#FF7043" }], ["rect", { x: 20, y: 28, width: 60, height: 56, rx: 14 }], ["circle", { cx: 38, cy: 50, r: 8, fill: "#fff" }], ["circle", { cx: 62, cy: 50, r: 8, fill: "#fff" }], ["circle", { cx: 38, cy: 48, r: 4, fill: "#263238" }], ["circle", { cx: 62, cy: 48, r: 4, fill: "#263238" }], ["rect", { x: 36, y: 66, width: 28, height: 6, rx: 3, fill: "#fff" }], ["polygon", { points: "50,0 60,12 40,12", fill: "#FFEB3B" }]],
    rock: () => [["polygon", { points: "12,82 20,46 44,26 74,32 90,60 80,86", stroke: "$", "stroke-width": 6, "stroke-linejoin": "round" }], ["polygon", { points: "34,52 50,38 62,50 48,60", fill: "#fff", opacity: ".25" }]],
    up: () => [["polygon", { points: "50,8 86,48 64,48 64,92 36,92 36,48 14,48", stroke: "$", "stroke-width": 4, "stroke-linejoin": "round" }]],
    turnR: () => [["path", { d: "M16 92 V50 Q16 26 40 26 H58 V10 L92 36 L58 62 V44 H44 Q40 44 40 50 V92 Z", stroke: "$", "stroke-width": 3, "stroke-linejoin": "round" }]],
    turnL: () => [["path", { d: "M16 92 V50 Q16 26 40 26 H58 V10 L92 36 L58 62 V44 H44 Q40 44 40 50 V92 Z", stroke: "$", "stroke-width": 3, "stroke-linejoin": "round", transform: "translate(100 0) scale(-1 1)" }]],
    play: () => [["polygon", { points: "24,10 92,50 24,90", stroke: "$", "stroke-width": 6, "stroke-linejoin": "round" }]],
    undo: () => [["path", { d: "M38 16 L10 44 L38 72 V54 C60 54 74 62 84 88 C84 54 66 36 38 36 Z", stroke: "$", "stroke-width": 3, "stroke-linejoin": "round" }]],
    bin: () => [["rect", { x: 18, y: 24, width: 64, height: 10, rx: 4 }], ["rect", { x: 40, y: 12, width: 20, height: 12, rx: 4 }], ["path", { d: "M24 40 H76 L70 92 H30 Z", stroke: "$", "stroke-width": 4, "stroke-linejoin": "round" }]],
    note: () => [["circle", { cx: 34, cy: 76, r: 16 }], ["rect", { x: 46, y: 14, width: 8, height: 62 }], ["path", { d: "M50 14 C70 18 84 28 80 48 C74 36 64 32 50 32 Z" }]],
  };
  function icon(name, color, size) {
    const c = COLORS[color] || color || "#78909C", draw = ICONS[name] || ICONS.circle, svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    if (size) { svg.setAttribute("width", size); svg.setAttribute("height", size); }
    const g = document.createElementNS(NS, "g"); g.setAttribute("fill", c);
    for (const [tag, attrs] of draw()) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v === "$" ? c : v); g.append(e); }
    svg.append(g); return svg;
  }

  // ---- a little storage: sound choice and stars ---------------------------------------------------------------------
  const KEY = "michels-tools-kids";
  const store = {
    get() { try { const o = JSON.parse(localStorage.getItem(KEY) || "{}"); return o && typeof o === "object" ? o : {}; } catch { return {}; } },
    set(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* private window: stars simply are not kept */ } },
  };
  const stars = {
    total() { const s = store.get().stars || {}; return Object.values(s).reduce((a, b) => a + (Number(b) || 0), 0); },
    of(game) { const s = store.get().stars || {}; return Number(s[game]) || 0; },
    add(game) { const o = store.get(); o.stars = o.stars || {}; o.stars[game] = (Number(o.stars[game]) || 0) + 1; store.set(o); return o.stars[game]; },
    clear() { const o = store.get(); delete o.stars; store.set(o); },
  };

  // ---- sound (off by default) ----------------------------------------------------------------------------------------------
  const sound = { on: false, ctx: null };
  const SCALE = [262, 294, 330, 349, 392, 440, 494, 523, 587, 659];
  function tone(freq, at, dur, vol, type) {
    const c = sound.ctx; if (!c) return;
    const o = c.createOscillator(), g = c.createGain(); o.type = type || "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, c.currentTime + at); g.gain.exponentialRampToValueAtTime(vol || 0.12, c.currentTime + at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
    o.connect(g).connect(c.destination); o.start(c.currentTime + at); o.stop(c.currentTime + at + dur + 0.05);
  }
  function chime(kind, n) {
    if (!sound.on) return;
    try {
      if (!sound.ctx) sound.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (sound.ctx.state === "suspended") sound.ctx.resume();
      if (kind === "good") { tone(523, 0, .18); tone(659, .12, .26); }
      else if (kind === "soft") tone(220, 0, .2, .08, "triangle");
      else if (kind === "pop") tone(SCALE[Math.min(SCALE.length - 1, Math.max(0, (n || 1) - 1))], 0, .22, .14, "triangle");
      else if (kind === "flip") tone(392, 0, .08, .08, "triangle");
      else if (kind === "step") tone(330, 0, .07, .07, "triangle");
      else if (kind === "win") [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .11, .3));
    } catch { /* no sound available: the game works without it */ }
  }

  // ---- shared look of the bar, stars and break card ----------------------------------------------------------------------
  const BREAK_MS = 15 * 60000, MORE_MS = 5 * 60000;
  // root: the game's .kd element. Expects .kd-snd (button), .kd-starn (number) and .kd-starsvg (holder) in the bar. Returns { star(), destroy() }.
  function mount(root, game) {
    const snd = root.querySelector(".kd-snd"), num = root.querySelector(".kd-starn"), holder = root.querySelector(".kd-starsvg");
    if (holder) { holder.textContent = ""; holder.append(icon("star", "yellow", 26)); }
    const o = store.get(); sound.on = !!o.sound;
    const paint = () => { if (num) num.textContent = String(stars.total()); if (snd) { snd.textContent = sound.on ? "Sound: on" : "Sound: off"; snd.setAttribute("aria-pressed", String(sound.on)); snd.classList.toggle("is-on", sound.on); } };
    paint();
    if (snd) snd.addEventListener("click", () => { sound.on = !sound.on; const s = store.get(); s.sound = sound.on; store.set(s); paint(); chime("good"); });
    // the break card
    let played = 0, limit = BREAK_MS, shown = false;
    const card = document.createElement("div"); card.className = "kd-break"; card.hidden = true;
    const box = document.createElement("div"); box.className = "kd-breakbox";
    const pic = document.createElement("div"); pic.className = "kd-breakpic"; pic.append(icon("moon", "yellow", 72), icon("cloud", "blue", 72));
    const msg = document.createElement("p"); msg.textContent = "Nice playing! A little break is good for little brains.";
    const more = document.createElement("button"); more.type = "button"; more.className = "xp-btn"; more.textContent = "Play a bit more (grown-ups)";
    more.addEventListener("click", () => { limit = played + MORE_MS; shown = false; card.hidden = true; });
    box.append(pic, msg, more); card.append(box); root.append(card);
    const timer = setInterval(() => {
      if (!root.isConnected || document.hidden) return;
      played += 10000;
      if (!shown && played >= limit) { shown = true; card.hidden = false; }
    }, 10000);
    return {
      star() { stars.add(game); paint(); },
      repaint: paint,
      destroy() { clearInterval(timer); },
      // for tests: pretend this many milliseconds were played
      _skip(ms) { played += ms; if (!shown && played >= limit) { shown = true; card.hidden = false; } },
    };
  }

  // little stars that fall from the top of a board
  function celebrate(host) {
    for (let i = 0; i < 16; i++) {
      const s = document.createElement("span"); s.className = "kd-conf"; s.append(icon(pick(["star", "heart", "circle", "diamond"]), pick(PALETTE), 22));
      s.style.left = (4 + Math.random() * 92) + "%"; s.style.animationDelay = (Math.random() * 0.5) + "s"; host.append(s);
      setTimeout(() => s.remove(), 2200);
    }
  }

  // dragging with the finger or the mouse. h.start(e) may return false to refuse; h.move(dx, dy, e); h.end(dx, dy, e, cancelled)
  function drag(el, h) {
    let id = null, sx = 0, sy = 0;
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", e => {
      if (id != null || (e.button != null && e.button > 0)) return;
      if (h.start && h.start(e) === false) return;
      id = e.pointerId; sx = e.clientX; sy = e.clientY; try { el.setPointerCapture(id); } catch { /* ignore */ }
      e.preventDefault();
    });
    el.addEventListener("pointermove", e => { if (e.pointerId === id) h.move(e.clientX - sx, e.clientY - sy, e); });
    const up = e => { if (e.pointerId !== id) return; const dx = e.clientX - sx, dy = e.clientY - sy; id = null; h.end(dx, dy, e, e.type === "pointercancel"); };
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  }

  const api = { GROUPS, SHAPE_ICONS, oddRound, POTS, MIX_HEX, MIXES, mix, MIX_RESULTS, COLORS, PALETTE, ICONS, rnd, pick, shuffle, maxCount, countRound, moreRound, icon, store, stars, sound, chime, mount, celebrate, drag, BREAK_MS };
  if (typeof window !== "undefined") window.Kids = api;
  if (typeof module !== "undefined") module.exports = api;
})();
