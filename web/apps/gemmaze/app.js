/* Gem Maze: the screen. The rules are in lib/gemmaze.js, the levels in lib/gemmaze-levels.js. Progress is kept in this browser only. */
(window.DesktopApps = window.DesktopApps || {}).gemmaze = (() => {
  const S = 48, VIEW = 9, W = 640, H = VIEW * S, TICK = 0.16, PX = VIEW * S;
  const KEYCOL = { r: "#E0342E", g: "#2EA84A", b: "#2E6AE0", y: "#E8C020" };
  const DEATH = { water: "The robot fell into the water.", fire: "The robot walked into the fire.", bomb: "The robot stepped on a bomb.", caught: "A creature caught the robot.", time: "The time ran out." };
  const DIRKEY = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };

  function init(root) {
    const GK = window.GameKit, GM = window.GemMaze, LEVELS = window.GemMazeLevels, g = GK.create(root, "gemmaze", { W, H });
    let n = 0, s = null, prev = null, state = "intro", acc = 0, want = -1, timeLeft = 0, clock = 0, why = "", camX = 0, camY = 0;
    const unlocked = () => Math.min(LEVELS.length, Math.max(1, g.best("level") || 1));

    function fillSelect() {
      const sel = g.q("level"), u = unlocked();
      sel.textContent = "";
      for (let i = 0; i < u; i++) { const o = document.createElement("option"); o.value = String(i); o.textContent = (i + 1) + ". " + LEVELS[i].name; sel.append(o); }
      sel.value = String(Math.min(n, u - 1));
    }
    function snapshot() { return { px: s.px, py: s.py, mon: s.mon.map(m => ({ x: m.x, y: m.y })) }; }
    function start(i) {
      n = GK.clamp(i, 0, LEVELS.length - 1);
      s = GM.load(LEVELS[n]); prev = snapshot(); acc = 0; want = -1; timeLeft = LEVELS[n].time; state = "intro"; g.playing = false; g.setPaused(false);
      camX = GK.clamp(s.px - (VIEW - 1) / 2, 0, Math.max(0, s.w - VIEW)); camY = GK.clamp(s.py - (VIEW - 1) / 2, 0, Math.max(0, s.h - VIEW));
      fillSelect(); showInfo();
      g.status("Level " + (n + 1) + ", " + LEVELS[n].name + ". " + LEVELS[n].hint);
    }
    function showInfo() { g.info("Level " + (n + 1) + " of " + LEVELS.length + "   code " + LEVELS[n].code); }
    function begin() { state = "play"; g.playing = true; }
    function lose(reason) {
      state = "dead"; g.playing = false; why = DEATH[reason] || "";
      g.sfx.tune([[330, 0.12], [262, 0.12], [196, 0.25]], { type: "sawtooth", vol: 0.1 });
      g.status(why + " Press Enter to try the level again.");
    }
    function win() {
      state = "won"; g.playing = false;
      g.saveBest(Math.min(LEVELS.length, n + 2), "level");
      g.sfx.tune([[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.25]], { type: "triangle", vol: 0.14 });
      g.status(n + 1 < LEVELS.length ? "Level cleared. The code of the next level is " + LEVELS[n + 1].code + ". Press Enter to go on." : "You finished every level. Well done.");
      fillSelect();
    }
    const SOUND = { gem: [1200, 0.07, "triangle"], key: [880, 0.08, "square"], door: [300, 0.12, "square"], boots: [660, 0.1, "triangle"], button: [500, 0.06, "square"], teleport: [400, 0.2, "sine"], thief: [200, 0.25, "sawtooth"], push: [150, 0.06, "square"] };
    function tick() {
      prev = snapshot();
      let act = want;
      if (act < 0) for (const k in DIRKEY) if (g.keys.has(k)) { act = DIRKEY[k]; break; }
      want = -1;
      for (const e of GM.step(s, act)) {
        if (SOUND[e]) g.sfx.tone(SOUND[e][0], SOUND[e][1], { type: SOUND[e][2], vol: 0.1, to: e === "teleport" ? 1200 : 0 });
        else if (e === "splash") g.sfx.noise(0.2, { freq: 900, vol: 0.25 });
        else if (e === "boom") g.sfx.noise(0.35, { freq: 700, to: 90, vol: 0.4 });
        if (e === "teleport") prev.px = s.px, prev.py = s.py;
      }
      if (s.dead) lose(s.dead); else if (s.won) win();
    }
    g.onKey = code => {
      if (state === "play") { if (DIRKEY[code] != null) want = DIRKEY[code]; return; }
      if (code !== "Enter" && code !== "Space" && DIRKEY[code] == null) return;
      if (state === "intro") { begin(); if (DIRKEY[code] != null) want = DIRKEY[code]; }
      else if (state === "dead") start(n);
      else if (state === "won" && (code === "Enter" || code === "Space")) start(n + 1 < LEVELS.length ? n + 1 : 0);
    };
    g.onDown = (x, y) => {
      if (state === "intro") { begin(); return; }
      if (state === "dead") { start(n); return; }
      if (state === "won") { start(n + 1 < LEVELS.length ? n + 1 : 0); return; }
      if (x > PX) return;
      const dx = x - (s.px - camX + 0.5) * S, dy = y - (s.py - camY + 0.5) * S;
      want = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    };
    g.q("new").addEventListener("click", () => start(n));
    g.q("level").addEventListener("change", () => start(Number(g.q("level").value) || 0));
    function useCode() {
      const c = g.q("code").value.trim().toUpperCase(), i = LEVELS.findIndex(l => l.code === c);
      g.q("code").value = ""; g.q("code").blur();
      if (i < 0) { g.status("No level has that code."); return; }
      g.saveBest(i + 1, "level"); start(i);
    }
    g.q("go").addEventListener("click", useCode);
    g.q("code").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); useCode(); } });

    function update(dt) {
      clock += dt;
      if (state !== "play") { acc = Math.min(TICK, acc + dt); return; }
      timeLeft -= dt;
      if (timeLeft <= 0) { timeLeft = 0; lose("time"); return; }
      acc += dt;
      while (acc >= TICK && state === "play") { acc -= TICK; tick(); }
    }

    /* ---- drawing ---- */
    function boot(ctx, x, y, kind) {
      const cx = x + S / 2, cy = y + S / 2;
      if (kind === "m") {
        ctx.lineWidth = 7; ctx.strokeStyle = "#D8262A"; ctx.beginPath(); ctx.arc(cx, cy - 2, 10, Math.PI, 0); ctx.stroke();
        ctx.fillStyle = "#D8262A"; ctx.fillRect(cx - 13.5, cy - 2, 7, 9); ctx.fillRect(cx + 6.5, cy - 2, 7, 9);
        ctx.fillStyle = "#E8E8E8"; ctx.fillRect(cx - 13.5, cy + 7, 7, 5); ctx.fillRect(cx + 6.5, cy + 7, 7, 5);
        return;
      }
      const col = kind === "f" ? "#2EA84A" : kind === "h" ? "#E0342E" : "#2E8AE0";
      ctx.fillStyle = col;
      if (kind === "f") { ctx.beginPath(); ctx.moveTo(cx - 5, cy - 13); ctx.lineTo(cx + 5, cy - 13); ctx.lineTo(cx + 13, cy + 12); ctx.lineTo(cx - 13, cy + 12); ctx.closePath(); ctx.fill(); ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 12); ctx.stroke(); return; }
      GK.rr(ctx, cx - 9, cy - 13, 11, 20, 3); ctx.fill(); GK.rr(ctx, cx - 9, cy + 1, 22, 9, 4); ctx.fill();
      if (kind === "s") { ctx.fillStyle = "#D8E4F0"; ctx.fillRect(cx - 12, cy + 11, 27, 3); }
      else { ctx.fillStyle = "#FFB020"; ctx.beginPath(); ctx.moveTo(cx - 6, cy - 2); ctx.lineTo(cx - 3, cy - 9); ctx.lineTo(cx, cy - 2); ctx.closePath(); ctx.fill(); }
    }
    function keyPic(ctx, cx, cy, col, k) {
      ctx.strokeStyle = col; ctx.lineWidth = 4 * k; ctx.beginPath(); ctx.arc(cx - 7 * k, cy, 6 * k, 0, 6.283); ctx.stroke();
      ctx.fillStyle = col; ctx.fillRect(cx - 1 * k, cy - 2 * k, 15 * k, 4 * k); ctx.fillRect(cx + 7 * k, cy, 3 * k, 7 * k); ctx.fillRect(cx + 11 * k, cy, 3 * k, 5 * k);
    }
    function tile(ctx, c, x, y, gx, gy) {
      const cx = x + S / 2, cy = y + S / 2;
      if (c === "#") {
        ctx.fillStyle = "#56627E"; ctx.fillRect(x, y, S, S);
        ctx.fillStyle = "#7E8AA8"; ctx.fillRect(x, y, S, 5); ctx.fillRect(x, y, 5, S);
        ctx.fillStyle = "#333C52"; ctx.fillRect(x, y + S - 5, S, 5); ctx.fillRect(x + S - 5, y, 5, S);
        ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(x + 10, y + 10, S - 20, S - 20);
        return;
      }
      ctx.fillStyle = (gx + gy) % 2 ? "#CDD3DE" : "#D6DBE5"; ctx.fillRect(x, y, S, S);
      if (c === " ") return;
      if (c === "*") {
        const p = 1 + 0.06 * Math.sin(clock * 5 + gx + gy);
        ctx.save(); ctx.translate(cx, cy); ctx.scale(p, p);
        const gr = ctx.createLinearGradient(-12, -14, 12, 14); gr.addColorStop(0, "#B8F8FF"); gr.addColorStop(1, "#1E9AD8");
        ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(13, -3); ctx.lineTo(0, 16); ctx.lineTo(-13, -3); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#0B4A78"; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-13, -3); ctx.lineTo(13, -3); ctx.moveTo(0, -15); ctx.lineTo(-5, -3); ctx.lineTo(0, 16); ctx.lineTo(5, -3); ctx.closePath(); ctx.stroke();
        ctx.restore();
      } else if (KEYCOL[c]) keyPic(ctx, cx, cy, KEYCOL[c], 1);
      else if (KEYCOL[c.toLowerCase()] && c !== c.toLowerCase()) {
        ctx.fillStyle = KEYCOL[c.toLowerCase()]; ctx.fillRect(x + 2, y + 2, S - 4, S - 4);
        ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.fillRect(x + 2, y + 2, S - 4, 6);
        ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(x + 2, y + S - 8, S - 4, 6);
        ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(cx, cy - 3, 5, 0, 6.283); ctx.fill(); ctx.fillRect(cx - 2.5, cy - 1, 5, 11);
      } else if (c === "~") {
        ctx.fillStyle = "#2E7AD8"; ctx.fillRect(x, y, S, S);
        ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 2;
        for (let k = 0; k < 3; k++) { const wy = y + 10 + k * 14, o = Math.sin(clock * 2 + k + gx) * 4; ctx.beginPath(); ctx.moveTo(x + 6 + o, wy); ctx.quadraticCurveTo(x + 16 + o, wy - 5, x + 24 + o, wy); ctx.quadraticCurveTo(x + 32 + o, wy + 5, x + 40 + o, wy); ctx.stroke(); }
      } else if (c === "^") {
        ctx.fillStyle = "#5A1A0A"; ctx.fillRect(x, y, S, S);
        for (let k = 0; k < 3; k++) {
          const fx = x + 10 + k * 14, fh = 20 + 8 * Math.sin(clock * 9 + k * 2 + gx * 3 + gy);
          ctx.fillStyle = "#F0601A"; ctx.beginPath(); ctx.moveTo(fx - 8, y + S - 4); ctx.quadraticCurveTo(fx - 6, y + S - fh, fx, y + S - fh - 8); ctx.quadraticCurveTo(fx + 6, y + S - fh, fx + 8, y + S - 4); ctx.closePath(); ctx.fill();
          ctx.fillStyle = "#FFD040"; ctx.beginPath(); ctx.moveTo(fx - 4, y + S - 4); ctx.quadraticCurveTo(fx, y + S - fh + 2, fx + 4, y + S - 4); ctx.closePath(); ctx.fill();
        }
      } else if (c === "i") {
        ctx.fillStyle = "#C8F0FA"; ctx.fillRect(x, y, S, S);
        ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 8, y + 30); ctx.lineTo(x + 22, y + 10); ctx.moveTo(x + 26, y + 38); ctx.lineTo(x + 38, y + 20); ctx.stroke();
        ctx.strokeStyle = "rgba(90,160,200,0.35)"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, S - 1, S - 1);
      } else if (c === "A" || c === ">" || c === "V" || c === "<") {
        ctx.fillStyle = "#3A4254"; ctx.fillRect(x, y, S, S);
        const d = { A: 0, ">": 1, V: 2, "<": 3 }[c];
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, S, S); ctx.clip(); ctx.translate(cx, cy); ctx.rotate(d * Math.PI / 2);
        ctx.strokeStyle = "#F0C030"; ctx.lineWidth = 4; ctx.lineJoin = "round";
        const o = (clock * 30) % 16;
        for (let k = -3; k <= 3; k++) { const yy = k * 16 - o; ctx.beginPath(); ctx.moveTo(-12, yy + 8); ctx.lineTo(0, yy - 2); ctx.lineTo(12, yy + 8); ctx.stroke(); }
        ctx.restore();
      } else if (c === "o") {
        ctx.fillStyle = "#B8803A"; ctx.fillRect(x + 3, y + 3, S - 6, S - 6);
        ctx.strokeStyle = "#6A4418"; ctx.lineWidth = 3; ctx.strokeRect(x + 4.5, y + 4.5, S - 9, S - 9);
        ctx.beginPath(); ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + S - 6, y + S - 6); ctx.moveTo(x + S - 6, y + 6); ctx.lineTo(x + 6, y + S - 6); ctx.stroke();
      } else if (c === "X") {
        ctx.fillStyle = "#1A1A1A"; ctx.beginPath(); ctx.arc(cx, cy + 3, 13, 0, 6.283); ctx.fill();
        ctx.fillStyle = "#666"; ctx.beginPath(); ctx.arc(cx - 4, cy - 2, 3.5, 0, 6.283); ctx.fill();
        ctx.strokeStyle = "#8A6A3A"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx + 6, cy - 9); ctx.quadraticCurveTo(cx + 12, cy - 16, cx + 9, cy - 19); ctx.stroke();
        ctx.fillStyle = Math.floor(clock * 6) % 2 ? "#FFD040" : "#FF6020"; ctx.beginPath(); ctx.arc(cx + 9, cy - 19, 3, 0, 6.283); ctx.fill();
      } else if (c === "T") {
        ctx.fillStyle = "#39414F"; ctx.beginPath(); ctx.arc(cx, cy, 15, 0, 6.283); ctx.fill();
        ctx.fillStyle = "#3CC86A"; ctx.beginPath(); ctx.arc(cx, cy, 10, 0, 6.283); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.arc(cx - 3, cy - 3, 3.5, 0, 6.283); ctx.fill();
      } else if (c === "x") {
        ctx.fillStyle = "#2E8A4A"; ctx.fillRect(x + 1, y + 1, S - 2, S - 2);
        ctx.fillStyle = "#57C478"; ctx.fillRect(x + 1, y + 1, S - 2, 5); ctx.fillRect(x + 1, y + 1, 5, S - 2);
        ctx.fillStyle = "#1A5A2E"; ctx.fillRect(x + 1, y + S - 6, S - 2, 5); ctx.fillRect(x + S - 6, y + 1, 5, S - 2);
      } else if (c === "_") {
        ctx.strokeStyle = "#2E8A4A"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.strokeRect(x + 5, y + 5, S - 10, S - 10); ctx.setLineDash([]);
      } else if (c === "Q") {
        for (let k = 0; k < 3; k++) { const r = 6 + ((clock * 14 + k * 6) % 18); ctx.strokeStyle = "rgba(150,60,220," + (1 - (r - 6) / 18) + ")"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.283); ctx.stroke(); }
        ctx.fillStyle = "#7A2CC8"; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 6.283); ctx.fill();
      } else if (c === "K") {
        ctx.fillStyle = "#E8C8A0"; ctx.beginPath(); ctx.arc(cx, cy, 14, 0, 6.283); ctx.fill();
        ctx.fillStyle = "#1A1A1A"; ctx.fillRect(cx - 14, cy - 7, 28, 9);
        ctx.fillStyle = "#FFF"; ctx.beginPath(); ctx.arc(cx - 5, cy - 2.5, 2.5, 0, 6.283); ctx.arc(cx + 5, cy - 2.5, 2.5, 0, 6.283); ctx.fill();
        ctx.fillStyle = "#1A1A1A"; ctx.beginPath(); ctx.arc(cx, cy - 6, 14, Math.PI, 0); ctx.fill();
      } else if (c === "E") {
        const open = s.gems === 0;
        ctx.fillStyle = open ? "#1E6A34" : "#6A1E1E"; ctx.fillRect(x + 3, y + 3, S - 6, S - 6);
        ctx.fillStyle = open ? "#6CFF8A" : "#C84A4A"; GK.rr(ctx, x + 10, y + 8, S - 20, S - 12, 8); ctx.fill();
        GK.text(ctx, open ? "EXIT" : String(s.gems), cx, cy + 3, open ? 10 : 16, "#0A200F", "center");
      } else boot(ctx, x, y, c);
    }
    function creature(ctx, t, cx, cy) {
      const bob = Math.sin(clock * 8 + cx) * 1.5;
      ctx.fillStyle = t === 3 ? "#E07A1A" : t === 4 ? "#D82A3A" : "#8A3AD8";
      if (t === 3) { ctx.beginPath(); ctx.ellipse(cx, cy + bob, 15, 12, 0, 0, 6.283); ctx.fill(); ctx.strokeStyle = "#5A2E06"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy - 12 + bob); ctx.lineTo(cx, cy + 12 + bob); for (const k of [-1, 1]) for (const j of [-7, 0, 7]) { ctx.moveTo(cx + k * 13, cy + j + bob); ctx.lineTo(cx + k * 20, cy + j + 3 + bob); } ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(cx, cy - 2 + bob, 15, Math.PI, 0); ctx.lineTo(cx + 15, cy + 14 + bob); ctx.lineTo(cx + 8, cy + 9 + bob); ctx.lineTo(cx, cy + 14 + bob); ctx.lineTo(cx - 8, cy + 9 + bob); ctx.lineTo(cx - 15, cy + 14 + bob); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = "#FFF"; ctx.beginPath(); ctx.arc(cx - 5, cy - 3 + bob, 4, 0, 6.283); ctx.arc(cx + 5, cy - 3 + bob, 4, 0, 6.283); ctx.fill();
      ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(cx - 5, cy - 2 + bob, 1.8, 0, 6.283); ctx.arc(cx + 5, cy - 2 + bob, 1.8, 0, 6.283); ctx.fill();
    }
    function robot(ctx, cx, cy, dir) {
      ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(cx, cy + 17, 13, 4, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = "#39414F"; ctx.fillRect(cx - 9, cy + 10, 6, 7); ctx.fillRect(cx + 3, cy + 10, 6, 7);
      ctx.fillStyle = "#F0C030"; GK.rr(ctx, cx - 12, cy - 4, 24, 16, 4); ctx.fill();
      ctx.fillStyle = "#D8DEE8"; GK.rr(ctx, cx - 10, cy - 18, 20, 15, 4); ctx.fill();
      ctx.strokeStyle = "#39414F"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy - 23); ctx.stroke();
      ctx.fillStyle = "#E0342E"; ctx.beginPath(); ctx.arc(cx, cy - 24, 2.5, 0, 6.283); ctx.fill();
      const ex = dir === 1 ? 3 : dir === 3 ? -3 : 0, ey = dir === 0 ? -2 : dir === 2 ? 2 : 0;
      if (dir !== 0) { ctx.fillStyle = "#1E9AD8"; ctx.beginPath(); ctx.arc(cx - 4 + ex, cy - 11 + ey, 2.6, 0, 6.283); ctx.arc(cx + 4 + ex, cy - 11 + ey, 2.6, 0, 6.283); ctx.fill(); }
      ctx.fillStyle = "#39414F"; ctx.fillRect(cx - 6, cy + 1, 12, 3);
    }
    function wrap(ctx, textStr, x, y, maxW, lh, size, color) {
      ctx.font = "normal " + size + "px " + GK.FONT;
      let line = "";
      for (const w of textStr.split(" ")) {
        if (ctx.measureText(line + w).width > maxW && line) { GK.text(ctx, line.trim(), x, y, size, color, "left", "normal"); y += lh; line = ""; }
        line += w + " ";
      }
      if (line.trim()) GK.text(ctx, line.trim(), x, y, size, color, "left", "normal");
    }
    function draw(ctx) {
      const t = state === "play" ? Math.min(1, acc / TICK) : 1;
      const px = prev.px + (s.px - prev.px) * t, py = prev.py + (s.py - prev.py) * t;
      const tx = GK.clamp(px - (VIEW - 1) / 2, 0, Math.max(0, s.w - VIEW)), ty = GK.clamp(py - (VIEW - 1) / 2, 0, Math.max(0, s.h - VIEW));
      camX += (tx - camX) * 0.25; camY += (ty - camY) * 0.25;
      const offX = s.w < VIEW ? (VIEW - s.w) / 2 : -camX, offY = s.h < VIEW ? (VIEW - s.h) / 2 : -camY;
      ctx.fillStyle = "#1A2030"; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, PX, H); ctx.clip();
      const x0 = Math.max(0, Math.floor(-offX)), y0 = Math.max(0, Math.floor(-offY));
      for (let gy = y0; gy < Math.min(s.h, y0 + VIEW + 1); gy++) for (let gx = x0; gx < Math.min(s.w, x0 + VIEW + 1); gx++) tile(ctx, s.g[gy * s.w + gx], Math.round((gx + offX) * S), Math.round((gy + offY) * S), gx, gy);
      s.mon.forEach((m, i) => { const p = prev.mon[i] || m; creature(ctx, m.t, (p.x + (m.x - p.x) * t + offX + 0.5) * S, (p.y + (m.y - p.y) * t + offY + 0.5) * S); });
      if (state !== "dead" || Math.floor(clock * 6) % 2) robot(ctx, (px + offX + 0.5) * S, (py + offY + 0.5) * S, s.dir);
      ctx.restore();
      // side panel
      const bx = PX + 14;
      ctx.fillStyle = "#101626"; ctx.fillRect(PX, 0, W - PX, H); ctx.fillStyle = "#5A78D8"; ctx.fillRect(PX, 0, 2, H);
      GK.text(ctx, "LEVEL " + (n + 1), bx, 24, 13, "#9FB8FF");
      GK.text(ctx, LEVELS[n].name, bx, 46, 17, "#FFFFFF");
      GK.text(ctx, "TIME", bx, 84, 12, "#9FB8FF");
      GK.text(ctx, String(Math.ceil(timeLeft)), bx, 110, 28, timeLeft < 15 && Math.floor(clock * 4) % 2 ? "#FF5A4A" : "#FFE27A");
      GK.text(ctx, "GEMS LEFT", bx + 96, 84, 12, "#9FB8FF");
      GK.text(ctx, String(s.gems), bx + 96, 110, 28, s.gems ? "#9AF4FF" : "#6CFF8A");
      GK.text(ctx, "KEYS", bx, 152, 12, "#9FB8FF");
      let kx = bx + 14;
      for (const k of "rgby") for (let i = 0; i < s.keys[k]; i++) { keyPic(ctx, kx, 174, KEYCOL[k], 0.75); kx += 30; }
      GK.text(ctx, "BOOTS", bx, 208, 12, "#9FB8FF");
      let bxx = PX + 10;
      ctx.save(); ctx.translate(0, 0);
      for (const b of "fhsm") if (s.boots[b]) { ctx.save(); ctx.translate(bxx, 216); ctx.scale(0.8, 0.8); boot(ctx, 0, 0, b); ctx.restore(); bxx += 42; }
      ctx.restore();
      wrap(ctx, LEVELS[n].hint, bx, 290, W - PX - 26, 18, 13, "#C8D4F0");
      if (state === "intro") g.banner("Level " + (n + 1) + ": " + LEVELS[n].name, ["Press Enter or click to start."]);
      else if (state === "dead") g.banner("Oops", [why, "Press Enter or click to try again."]);
      else if (state === "won") g.banner(n + 1 < LEVELS.length ? "Level cleared" : "All levels finished!", n + 1 < LEVELS.length ? ["Next level code: " + LEVELS[n + 1].code, "Press Enter or click to go on."] : ["Well done.", "Press Enter to start over."]);
    }

    start(Math.max(0, unlocked() - 1));
    g.start({ update, draw });
    return { destroy() { g.destroy(); } };
  }
  return { init };
})();
