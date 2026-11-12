/* Mines: open every square that hides no mine. Everything runs in the browser; best times are kept in this browser only. */
(window.DesktopApps = window.DesktopApps || {}).mines = (() => {
  const LEVELS = [{ c: 9, r: 9, m: 10, name: "Small" }, { c: 16, r: 16, m: 40, name: "Medium" }, { c: 30, r: 16, m: 99, name: "Large" }];
  const S = 32;   // one square, in picture units
  const NUM = ["", "#1F4FD8", "#1E8A2E", "#D62B2B", "#1B2A8A", "#8A1B1B", "#108A8A", "#111111", "#6B6B6B"];

  function init(root) {
    const GK = window.GameKit, g = GK.create(root, "mines", { W: 9 * S, H: 9 * S, pause: false });
    let lv = LEVELS[0], cols, rows, mine, open, flag, near, state, time, opened, flags, boom, hover = -1, flagMode = false;
    let press = null;   // { i, timer, done } while a finger or the mouse is down
    let parts = [];

    const idx = (x, y) => y * cols + x;
    function around(i, fn) {
      const x = i % cols, y = (i - x) / cols;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) fn(idx(nx, ny));
      }
    }
    function reset() {
      cols = lv.c; rows = lv.r;
      const n = cols * rows;
      mine = new Uint8Array(n); open = new Uint8Array(n); flag = new Uint8Array(n); near = new Uint8Array(n);
      state = "ready"; time = 0; opened = 0; flags = 0; boom = -1; parts = []; press = null;
      g.setSize(cols * S, rows * S);
      g.status("Click to open a square. Right-click (or press and hold) to plant a flag. The first click is always safe.");
      showInfo();
    }
    function plant(safe) {
      const n = cols * rows, keep = new Set([safe]);
      if (n - 9 >= lv.m) around(safe, j => keep.add(j));
      let left = lv.m;
      while (left > 0) { const i = Math.floor(Math.random() * n); if (!mine[i] && !keep.has(i)) { mine[i] = 1; left--; } }
      for (let i = 0; i < n; i++) { let k = 0; around(i, j => { k += mine[j]; }); near[i] = k; }
    }
    function showInfo() {
      const b = g.best("t" + LEVELS.indexOf(lv));
      g.info("Mines " + (lv.m - (flags || 0)) + "   Time " + Math.floor(time || 0) + " s" + (b != null ? "   Best " + b + " s" : ""));
    }
    function reveal(i) {
      if (open[i] || flag[i]) return;
      if (state === "ready") { plant(i); state = "play"; }
      if (mine[i]) { lose(i); return; }
      const stack = [i];
      let count = 0;
      while (stack.length) {
        const k = stack.pop();
        if (open[k] || flag[k]) continue;
        open[k] = 1; opened++; count++;
        if (!near[k]) around(k, j => { if (!open[j] && !flag[j]) stack.push(j); });
      }
      g.sfx.tone(count > 3 ? 500 : 700, 0.05, { type: "triangle", vol: 0.1, to: count > 3 ? 900 : 0 });
      if (opened === cols * rows - lv.m) win();
    }
    function chord(i) {
      let f = 0;
      around(i, j => { f += flag[j]; });
      if (f !== near[i]) return;
      around(i, j => { if (state === "play" && !open[j] && !flag[j]) reveal(j); });
    }
    function toggleFlag(i) {
      if (open[i] || state === "won" || state === "lost") return;
      flag[i] = flag[i] ? 0 : 1; flags += flag[i] ? 1 : -1;
      g.sfx.tone(flag[i] ? 880 : 440, 0.05, { type: "square", vol: 0.07 });
      showInfo();
    }
    function lose(i) {
      state = "lost"; boom = i;
      const x = (i % cols + 0.5) * S, y = (Math.floor(i / cols) + 0.5) * S;
      for (let k = 0; k < 40; k++) { const a = Math.random() * 6.283, v = GK.rand(60, 320); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: GK.rand(0.3, 0.9), c: k % 3 ? "#FFB020" : "#FF4020" }); }
      g.sfx.noise(0.6, { freq: 900, to: 80, vol: 0.5 });
      g.status("That was a mine. Press New game to try again.");
    }
    function win() {
      state = "won";
      for (let i = 0; i < mine.length; i++) if (mine[i] && !flag[i]) { flag[i] = 1; flags++; }
      const secs = Math.max(1, Math.floor(time));
      const record = g.saveBest(secs, "t" + LEVELS.indexOf(lv), true);
      g.sfx.tune([[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.25]], { type: "triangle", vol: 0.14 });
      g.status("Cleared in " + secs + " seconds." + (record ? " That is your best time for this size." : ""));
      showInfo();
    }

    const cellAt = (x, y) => (x < 0 || y < 0 || x >= cols * S || y >= rows * S) ? -1 : idx(Math.floor(x / S), Math.floor(y / S));
    function act(i, wantFlag) {
      if (i < 0 || state === "won" || state === "lost") return;
      if (wantFlag) toggleFlag(i);
      else if (open[i]) { if (near[i]) chord(i); }
      else reveal(i);
      showInfo();
    }
    g.onDown = (x, y, e) => {
      const i = cellAt(x, y);
      if (i < 0) return;
      if (state === "won" || state === "lost") return;
      if (e.button === 2) { act(i, true); return; }
      if (e.button === 1) { if (open[i]) act(i, false); return; }
      press = { i, done: false, timer: 0 };
      if (e.pointerType !== "mouse") press.timer = window.setTimeout(() => { if (press && !press.done) { press.done = true; act(press.i, !flagMode); } }, 420);
    };
    g.onMove = (x, y, e) => {
      hover = e.pointerType === "mouse" ? cellAt(x, y) : -1;
      if (press && cellAt(x, y) !== press.i) { window.clearTimeout(press.timer); press = null; }
    };
    g.onUp = (x, y) => {
      if (!press) return;
      window.clearTimeout(press.timer);
      const p = press; press = null;
      if (!p.done && cellAt(x, y) === p.i) act(p.i, flagMode);
    };
    g.canvas.addEventListener("pointerleave", () => { hover = -1; });
    g.q("new").addEventListener("click", reset);
    g.q("level").addEventListener("change", () => { lv = LEVELS[Number(g.q("level").value)] || LEVELS[0]; reset(); });
    g.q("flag").addEventListener("click", () => {
      flagMode = !flagMode;
      const b = g.q("flag");
      b.textContent = "Flag mode: " + (flagMode ? "on" : "off"); b.setAttribute("aria-pressed", flagMode ? "true" : "false"); b.classList.toggle("is-default", flagMode);
      g.status(flagMode ? "Flag mode: a click plants or removes a flag." : "Flag mode off: a click opens a square.");
    });
    g.onKey = code => { if (code === "KeyF") g.q("flag").click(); else if (code === "KeyN" || ((state === "won" || state === "lost") && code === "Enter")) reset(); };

    function update(dt) {
      if (state === "play") { const b = Math.floor(time); time = Math.min(999, time + dt); if (Math.floor(time) !== b) showInfo(); }
      for (const p of parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; }
      if (parts.length) parts = parts.filter(p => p.life > 0);
    }

    /* ---- drawing ---- */
    function drawMine(ctx, cx, cy) {
      ctx.strokeStyle = "#111"; ctx.lineWidth = 2.4; ctx.lineCap = "round";
      ctx.beginPath();
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 4; ctx.moveTo(cx - Math.cos(a) * 11, cy - Math.sin(a) * 11); ctx.lineTo(cx + Math.cos(a) * 11, cy + Math.sin(a) * 11); }
      ctx.stroke();
      const gr = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, 8);
      gr.addColorStop(0, "#666"); gr.addColorStop(1, "#0A0A0A");
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, 7.5, 0, 6.283); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx - 2.6, cy - 2.6, 1.8, 0, 6.283); ctx.fill();
    }
    function drawFlag(ctx, x, y) {
      ctx.fillStyle = "#222"; ctx.fillRect(x + 15, y + 7, 2, 17); ctx.fillRect(x + 10, y + 23, 12, 3);
      ctx.fillStyle = "#E02020"; ctx.beginPath(); ctx.moveTo(x + 15, y + 6); ctx.lineTo(x + 15, y + 17); ctx.lineTo(x + 6, y + 11.5); ctx.closePath(); ctx.fill();
    }
    function draw(ctx) {
      const done = state === "won" || state === "lost";
      for (let i = 0; i < cols * rows; i++) {
        const x = (i % cols) * S, y = Math.floor(i / cols) * S;
        const showMine = state === "lost" && mine[i] && !flag[i];
        if (open[i] || showMine) {
          ctx.fillStyle = i === boom ? "#F04A3A" : "#E4E9F4"; ctx.fillRect(x, y, S, S);
          ctx.strokeStyle = "#A9B4CC"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, S - 1, S - 1);
          if (showMine) drawMine(ctx, x + S / 2, y + S / 2);
          else if (near[i]) GK.text(ctx, String(near[i]), x + S / 2, y + S / 2 + 1, 19, NUM[near[i]], "center");
        } else {
          const pressed = press && press.i === i && !flag[i];
          const gr = ctx.createLinearGradient(x, y, x, y + S);
          if (pressed) { gr.addColorStop(0, "#AEBCDD"); gr.addColorStop(1, "#C3CFEA"); }
          else if (i === hover && !done) { gr.addColorStop(0, "#F4F8FF"); gr.addColorStop(1, "#B9CBF2"); }
          else { gr.addColorStop(0, "#DCE6FA"); gr.addColorStop(1, "#9DB3E2"); }
          ctx.fillStyle = gr; ctx.fillRect(x, y, S, S);
          if (!pressed) {
            ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.fillRect(x, y, S, 2); ctx.fillRect(x, y, 2, S);
            ctx.fillStyle = "rgba(40,60,120,0.45)"; ctx.fillRect(x, y + S - 2, S, 2); ctx.fillRect(x + S - 2, y, 2, S);
          }
          if (flag[i]) {
            drawFlag(ctx, x, y);
            if (state === "lost" && !mine[i]) { ctx.strokeStyle = "#C00000"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + 6, y + 6); ctx.lineTo(x + S - 6, y + S - 6); ctx.moveTo(x + S - 6, y + 6); ctx.lineTo(x + 6, y + S - 6); ctx.stroke(); }
          }
        }
      }
      for (const p of parts) { ctx.globalAlpha = Math.min(1, p.life * 2); ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, 6.283); ctx.fill(); }
      ctx.globalAlpha = 1;
    }

    reset();
    g.start({ update, draw });
    return { destroy() { if (press) window.clearTimeout(press.timer); g.destroy(); } };
  }
  return { init };
})();
