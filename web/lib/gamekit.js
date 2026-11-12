/* GameKit: what every game in the Games folder shares.
 *
 *   const g = GameKit.create(root, "<app id>", { W, H, pause: true|false });
 *   g.start({ update(dt), draw(ctx) });      // draw() works in a W x H picture, whatever the window size
 *   return { destroy() { g.destroy(); } };
 *
 * It gives: a canvas that always fits its window, a frame loop that stops while the game cannot be seen, keyboard and pointer
 * input (only while the game's window is the active one), on-screen buttons for phones ([data-key] elements), pause, sound
 * (made in the browser, OFF until the player switches it on) and best scores (kept in this browser's localStorage, never sent).
 *
 * The page needs elements with these ids (prefixed with the app id): stage, canvas, and optionally pause, sound, info, status.
 */
window.GameKit = (() => {
  "use strict";

  const STORE = "michels-tools-games";
  const FONT = "Tahoma, Verdana, Arial, sans-serif";

  function readStore() {
    try { const v = JSON.parse(window.localStorage.getItem(STORE) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; }
  }
  function getBest(id, name) {
    const s = readStore();
    return s[id] && typeof s[id][name] === "number" && isFinite(s[id][name]) ? s[id][name] : null;
  }
  function setBest(id, name, value) {
    try { const s = readStore(); (s[id] = s[id] && typeof s[id] === "object" ? s[id] : {})[name] = value; window.localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) { /* storage blocked: scores last until the page closes */ }
  }

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function text(ctx, s, x, y, size, color, align, weight) {
    ctx.font = (weight || "bold") + " " + size + "px " + FONT;
    ctx.textAlign = align || "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color || "#fff";
    ctx.fillText(s, x, y);
  }

  // an off-screen picture, drawn once and reused every frame
  function layer(w, h, scale, paint) {
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const x = c.getContext("2d");
    x.scale(scale, scale);
    paint(x);
    return c;
  }

  function create(root, id, opts) {
    const q = n => root.querySelector("#" + id + "-" + n);
    const canvas = q("canvas"), stage = q("stage"), ctx = canvas.getContext("2d");
    const win = root.closest ? root.closest(".window") : null;
    const pausable = opts.pause !== false;
    const g = {
      id, q, canvas, ctx, W: opts.W, H: opts.H, keys: new Set(), paused: false, playing: false, dirty: true,
      onKey: null, onKeyUp: null, onDown: null, onMove: null, onUp: null,
    };
    let impl = null, raf = 0, last = 0, dead = false, pausedDrawn = false;
    const offs = [];
    const on = (el, ev, fn, o) => { if (!el) return; el.addEventListener(ev, fn, o); offs.push(() => el.removeEventListener(ev, fn, o)); };

    /* ---- size ---- */
    function fit() {
      const r = stage.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) return;
      const s = Math.min(r.width / g.W, r.height / g.H);
      const cw = Math.max(1, Math.floor(g.W * s)), ch = Math.max(1, Math.floor(g.H * s));
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
      canvas.style.left = Math.floor((r.width - cw) / 2) + "px"; canvas.style.top = Math.floor((r.height - ch) / 2) + "px";
      const pw = Math.round(cw * dpr), ph = Math.round(ch * dpr);
      if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
      g.dirty = true;
    }
    g.setSize = (w, h) => { g.W = w; g.H = h; fit(); };
    let ro = null;
    if (typeof ResizeObserver === "function") { ro = new ResizeObserver(fit); ro.observe(stage); } else on(window, "resize", fit);

    /* ---- can the game be seen, and is its window the one in front? ---- */
    const visible = () => canvas.offsetWidth > 0 && !document.hidden;
    const active = () => visible() && (!win || win.classList.contains("active"));

    /* ---- pause ---- */
    function setPaused(p) {
      p = !!p && pausable && g.playing;
      if (p === g.paused) return;
      g.paused = p; pausedDrawn = false; g.keys.clear(); last = 0;
      const b = q("pause"); if (b) b.textContent = p ? "Resume" : "Pause";
      if (g.onPause) g.onPause(p);
    }
    g.setPaused = setPaused;
    g.togglePause = () => setPaused(!g.paused);
    if (pausable) on(q("pause"), "click", () => g.togglePause());

    /* ---- keyboard: only while this window is the active one, and never while typing in a field ---- */
    on(document, "keydown", e => {
      if (!active() || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && t.type !== "range") return;
      if (document.querySelector("dialog[open]")) return;
      if (/^(Arrow|Space|Enter)/.test(e.code)) e.preventDefault();
      if (e.repeat) return;
      if (pausable && e.code === "KeyP") { g.togglePause(); return; }
      if (g.paused) { if (e.code === "Enter" || e.code === "Space") setPaused(false); return; }
      g.keys.add(e.code);
      if (g.onKey) g.onKey(e.code);
    });
    on(document, "keyup", e => { if (g.keys.delete(e.code) && g.onKeyUp) g.onKeyUp(e.code); });
    on(window, "blur", () => { const held = Array.from(g.keys); g.keys.clear(); if (g.onKeyUp) held.forEach(k => g.onKeyUp(k)); });

    /* ---- buttons: a click must not leave the focus on a button (Space would press it again) ---- */
    root.querySelectorAll(".gm-bar button, .gm-bar select").forEach(b => on(b, b.tagName === "SELECT" ? "change" : "click", () => { b.blur(); }));

    /* ---- on-screen keys for phones ---- */
    root.querySelectorAll("[data-key]").forEach(b => {
      const code = b.getAttribute("data-key");
      const down = e => { e.preventDefault(); if (g.paused) { setPaused(false); return; } if (!g.keys.has(code)) { g.keys.add(code); if (g.onKey) g.onKey(code); } };
      const up = e => { e.preventDefault(); if (g.keys.delete(code) && g.onKeyUp) g.onKeyUp(code); };
      on(b, "pointerdown", down); on(b, "pointerup", up); on(b, "pointercancel", up); on(b, "pointerleave", up);
      on(b, "contextmenu", e => e.preventDefault());
    });

    /* ---- pointer, in picture coordinates ---- */
    const pos = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * g.W / (r.width || 1), y: (e.clientY - r.top) * g.H / (r.height || 1) }; };
    on(canvas, "pointerdown", e => {
      if (g.paused) { setPaused(false); return; }
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
      if (g.onDown) { const p = pos(e); g.onDown(p.x, p.y, e); }
    });
    on(canvas, "pointermove", e => { if (!g.paused && g.onMove) { const p = pos(e); g.onMove(p.x, p.y, e); } });
    const pup = e => { if (!g.paused && g.onUp) { const p = pos(e); g.onUp(p.x, p.y, e); } };
    on(canvas, "pointerup", pup); on(canvas, "pointercancel", pup);
    on(canvas, "contextmenu", e => e.preventDefault());

    /* ---- sound: nothing is created until the player switches it on ---- */
    const sfx = g.sfx = {
      on: false, ac: null, out: null, buf: null,
      tone(freq, dur, o) {
        if (!this.on || !this.ac) return;
        o = o || {};
        try {
          const ac = this.ac, t = ac.currentTime + (o.at || 0), osc = ac.createOscillator(), gn = ac.createGain();
          osc.type = o.type || "square";
          osc.frequency.setValueAtTime(Math.max(20, freq), t);
          if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
          gn.gain.setValueAtTime(o.vol == null ? 0.12 : o.vol, t);
          gn.gain.exponentialRampToValueAtTime(0.0008, t + dur);
          osc.connect(gn); gn.connect(this.out);
          osc.start(t); osc.stop(t + dur + 0.03);
        } catch (e) { /* sound is a nicety */ }
      },
      noise(dur, o) {
        if (!this.on || !this.ac) return;
        o = o || {};
        try {
          const ac = this.ac, t = ac.currentTime + (o.at || 0);
          if (!this.buf) {
            this.buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
            const d = this.buf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
          }
          const src = ac.createBufferSource(), f = ac.createBiquadFilter(), gn = ac.createGain();
          src.buffer = this.buf; src.loop = true;
          f.type = o.type || "lowpass"; f.frequency.setValueAtTime(o.freq || 1200, t);
          if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
          gn.gain.setValueAtTime(o.vol == null ? 0.2 : o.vol, t);
          gn.gain.exponentialRampToValueAtTime(0.0008, t + dur);
          src.connect(f); f.connect(gn); gn.connect(this.out);
          src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.03);
        } catch (e) { /* sound is a nicety */ }
      },
      // a short tune: [[frequency, length], ...] played one after the other
      tune(notes, o) { let at = 0; notes.forEach(n => { if (n[0]) this.tone(n[0], n[1] * 0.95, Object.assign({}, o, { at })); at += n[1]; }); },
    };
    function setSound(want) {
      if (want && !sfx.ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { want = false; g.status("This browser cannot play sound."); }
        else {
          try { sfx.ac = new AC(); sfx.out = sfx.ac.createGain(); sfx.out.gain.value = 0.6; sfx.out.connect(sfx.ac.destination); }
          catch (e) { sfx.ac = null; want = false; }
        }
      }
      if (want && sfx.ac && sfx.ac.state === "suspended") sfx.ac.resume().catch(() => {});
      sfx.on = !!want;
      const b = q("sound");
      if (b) { b.textContent = sfx.on ? "Sound: on" : "Sound: off"; b.setAttribute("aria-pressed", sfx.on ? "true" : "false"); b.classList.toggle("is-on", sfx.on); }
      if (g.onSound) g.onSound(sfx.on);
      if (sfx.on) sfx.tone(660, 0.08, { type: "sine" });
    }
    on(q("sound"), "click", () => setSound(!sfx.on));

    /* ---- small helpers ---- */
    g.status = t => { const el = q("status"); if (el) el.textContent = t; };
    g.info = t => { const el = q("info"); if (el) el.textContent = t; };
    g.best = name => getBest(id, name || "best");
    g.saveBest = (value, name, lowerIsBetter) => {
      const old = getBest(id, name || "best");
      if (old == null || (lowerIsBetter ? value < old : value > old)) { setBest(id, name || "best", value); return true; }
      return false;
    };
    // a dark panel with a title and lines of text in the middle of the picture
    g.banner = (title, lines) => {
      const W = g.W, H = g.H, u = Math.min(W, H) / 20;
      lines = lines || [];
      const bh = u * (3.2 + lines.length * 1.25), bw = Math.min(W * 0.86, u * 17);
      ctx.save();
      ctx.fillStyle = "rgba(6, 12, 30, 0.55)"; ctx.fillRect(0, 0, W, H);
      rr(ctx, (W - bw) / 2, (H - bh) / 2, bw, bh, u * 0.5);
      ctx.fillStyle = "rgba(10, 26, 70, 0.92)"; ctx.fill();
      ctx.lineWidth = Math.max(1.5, u * 0.08); ctx.strokeStyle = "#8FB4FF"; ctx.stroke();
      text(ctx, title, W / 2, (H - bh) / 2 + u * 1.5, u * 1.25, "#FFE27A", "center");
      lines.forEach((l, i) => text(ctx, l, W / 2, (H - bh) / 2 + u * (2.95 + i * 1.25), u * 0.72, "#E8EEFF", "center", "normal"));
      ctx.restore();
    };

    /* ---- the frame loop ---- */
    function frame(t) {
      if (dead) return;
      raf = window.requestAnimationFrame(frame);
      if (!visible()) { last = 0; if (g.playing) setPaused(true); return; }
      if (pausable && g.playing && !g.paused && !active()) setPaused(true);
      if (g.paused && !g.playing) setPaused(false);
      if (g.paused && pausedDrawn && !g.dirty) return;
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
      last = t;
      if (!g.paused && dt > 0) impl.update(dt);
      ctx.setTransform(canvas.width / g.W, 0, 0, canvas.height / g.H, 0, 0);
      impl.draw(ctx);
      g.dirty = false;
      if (g.paused) { g.banner("Paused", ["Press P or click here to continue"]); pausedDrawn = true; last = 0; }
    }
    g.start = i => { impl = i; fit(); raf = window.requestAnimationFrame(frame); };
    g.destroy = () => {
      dead = true;
      window.cancelAnimationFrame(raf);
      offs.forEach(f => f());
      if (ro) ro.disconnect();
      if (sfx.ac) { try { sfx.ac.close(); } catch (e) { /* already closed */ } }
      sfx.on = false; sfx.ac = null;
    };
    return g;
  }

  return { create, clamp, rand, randInt, rr, text, layer, FONT };
})();
