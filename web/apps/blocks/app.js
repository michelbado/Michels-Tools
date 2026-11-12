/* Blocks: falling pieces, full rows disappear. Everything runs in the browser; the best score is kept in this browser only. */
(window.DesktopApps = window.DesktopApps || {}).blocks = (() => {
  const COLS = 10, ROWS = 20, C = 28, BX = 22, BY = 20, W = 480, H = 600, PX = 322;
  // each piece: its cells inside a square box of n x n, and its two colours
  const PIECES = {
    I: { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]], c: "#35C9E8" },
    O: { n: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]], c: "#F2D23C" },
    T: { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]], c: "#B065F0" },
    S: { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]], c: "#5BD65B" },
    Z: { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]], c: "#F05A5A" },
    J: { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]], c: "#4C7DF5" },
    L: { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]], c: "#F0A030" },
  };
  const KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0], [0, -2]];
  const LINE_SCORE = [0, 100, 300, 500, 800];

  function init(root) {
    const GK = window.GameKit, g = GK.create(root, "blocks", { W, H });
    let grid, cur, queue, hold, canHold, score, lines, level, state = "ready";
    let fallT, lockT, lockMoves, clearing, clearT, dasDir, dasT, parts = [], shake = 0, flash = 0;

    const newGrid = () => Array.from({ length: ROWS }, () => new Array(COLS).fill(null));
    function refill() {
      const bag = Object.keys(PIECES);
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      queue.push(...bag);
    }
    function make(type) {
      const p = PIECES[type];
      return { type, n: p.n, cells: p.cells.map(c => c.slice()), x: Math.floor((COLS - p.n) / 2), y: type === "I" ? -1 : 0 };
    }
    function hits(cells, x, y) {
      for (const c of cells) {
        const cx = x + c[0], cy = y + c[1];
        if (cx < 0 || cx >= COLS || cy >= ROWS) return true;
        if (cy >= 0 && grid[cy][cx]) return true;
      }
      return false;
    }
    function spawn(type) {
      if (!type) { if (queue.length < 7) refill(); type = queue.shift(); }
      cur = make(type);
      fallT = 0; lockT = 0; lockMoves = 0;
      if (hits(cur.cells, cur.x, cur.y)) { cur = null; gameOver(); }
    }
    function reset() {
      grid = newGrid(); queue = []; refill(); hold = null; canHold = true;
      score = 0; lines = 0; level = 1; clearing = null; parts = []; dasDir = 0;
      state = "play"; g.playing = true; g.setPaused(false);
      spawn();
      g.status("Arrows move and turn, Space drops, C keeps a piece for later, P pauses.");
      showInfo();
    }
    function gameOver() {
      state = "over"; g.playing = false;
      const record = g.saveBest(score);
      g.sfx.tune([[392, 0.14], [330, 0.14], [262, 0.14], [196, 0.3]], { type: "triangle", vol: 0.16 });
      g.status(record && score > 0 ? "Game over. New best score: " + score + "." : "Game over. Score " + score + ".");
      showInfo();
    }
    function showInfo() { const b = g.best(); g.info("Score " + (score || 0) + (b != null ? "   Best " + b : "")); }
    const interval = () => Math.max(0.05, 0.8 * Math.pow(0.82, level - 1));

    function move(dx) {
      if (!cur || hits(cur.cells, cur.x + dx, cur.y)) return false;
      cur.x += dx; touched(); g.sfx.tone(220, 0.03, { vol: 0.04 });
      return true;
    }
    function touched() { if (lockT > 0 && lockMoves < 15) { lockT = 0; lockMoves++; } }
    function rotate(dir) {
      if (!cur || cur.type === "O") return;
      const n = cur.n, cells = cur.cells.map(c => dir > 0 ? [n - 1 - c[1], c[0]] : [c[1], n - 1 - c[0]]);
      for (const k of KICKS) {
        if (!hits(cells, cur.x + k[0], cur.y + k[1])) {
          cur.cells = cells; cur.x += k[0]; cur.y += k[1]; touched();
          g.sfx.tone(440, 0.05, { type: "triangle", vol: 0.08 });
          return;
        }
      }
    }
    function ghostY() { let y = cur.y; while (!hits(cur.cells, cur.x, y + 1)) y++; return y; }
    function hardDrop() {
      if (!cur) return;
      const y = ghostY(); score += (y - cur.y) * 2; cur.y = y; shake = 0.12;
      lock();
    }
    function doHold() {
      if (!cur || !canHold) return;
      const t = cur.type, back = hold;
      hold = t; canHold = false;
      spawn(back || undefined);
      g.sfx.tone(520, 0.06, { type: "sine", vol: 0.1 });
    }
    function lock() {
      const color = PIECES[cur.type].c;
      let above = false;
      for (const c of cur.cells) { const y = cur.y + c[1]; if (y < 0) above = true; else grid[y][cur.x + c[0]] = color; }
      cur = null; canHold = true;
      g.sfx.noise(0.07, { freq: 300, vol: 0.25 });
      if (above) { gameOver(); return; }
      const full = [];
      for (let y = 0; y < ROWS; y++) if (grid[y].every(Boolean)) full.push(y);
      if (full.length) {
        clearing = full; clearT = 0.28; flash = full.length === 4 ? 0.3 : 0;
        for (const y of full) for (let x = 0; x < COLS; x++) for (let k = 0; k < 2; k++) parts.push({ x: BX + (x + 0.5) * C, y: BY + (y + 0.5) * C, vx: GK.rand(-160, 160), vy: GK.rand(-260, -40), life: GK.rand(0.4, 0.8), c: grid[y][x] });
        if (full.length === 4) g.sfx.tune([[523, 0.07], [659, 0.07], [784, 0.07], [1047, 0.18]], { type: "square", vol: 0.1 });
        else g.sfx.tune([[523, 0.06], [784, 0.1]], { type: "square", vol: 0.09 });
      } else spawn();
      showInfo();
    }
    function finishClear() {
      const n = clearing.length;
      grid = grid.filter((r, y) => !clearing.includes(y));
      while (grid.length < ROWS) grid.unshift(new Array(COLS).fill(null));
      clearing = null;
      score += LINE_SCORE[n] * level; lines += n;
      const nl = Math.floor(lines / 10) + 1;
      if (nl > level) { level = nl; g.sfx.tune([[660, 0.08], [880, 0.08], [1320, 0.16]], { type: "triangle", vol: 0.12 }); g.status("Level " + level + ". The pieces fall faster."); }
      showInfo();
      spawn();
    }

    g.onKey = code => {
      if (state !== "play") { if (code === "Enter" || code === "Space") reset(); return; }
      if (!cur) return;
      if (code === "ArrowLeft" || code === "ArrowRight") { dasDir = code === "ArrowLeft" ? -1 : 1; dasT = 0.17; move(dasDir); }
      else if (code === "ArrowUp" || code === "KeyX") rotate(1);
      else if (code === "KeyZ") rotate(-1);
      else if (code === "Space") hardDrop();
      else if (code === "KeyC" || code === "ShiftLeft" || code === "ShiftRight") doHold();
    };
    g.onKeyUp = code => {
      if ((code === "ArrowLeft" && dasDir < 0) || (code === "ArrowRight" && dasDir > 0)) dasDir = g.keys.has("ArrowLeft") ? -1 : g.keys.has("ArrowRight") ? 1 : 0;
    };
    g.onDown = () => { if (state !== "play") reset(); };
    g.q("new").addEventListener("click", reset);

    function update(dt) {
      shake = Math.max(0, shake - dt); flash = Math.max(0, flash - dt);
      for (const p of parts) { p.life -= dt; p.vy += 700 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
      if (parts.length) parts = parts.filter(p => p.life > 0);
      if (state !== "play") return;
      if (clearing) { clearT -= dt; if (clearT <= 0) finishClear(); return; }
      if (!cur) return;
      if (dasDir) { dasT -= dt; while (dasT <= 0) { if (!move(dasDir)) { dasT = 0.045; break; } dasT += 0.045; } }
      const soft = g.keys.has("ArrowDown");
      const iv = soft ? Math.min(interval(), 0.04) : interval();
      fallT += dt;
      while (cur && fallT >= iv) {
        fallT -= iv;
        if (!hits(cur.cells, cur.x, cur.y + 1)) { cur.y++; lockT = 0; if (soft) score++; }
        else { fallT = 0; break; }
      }
      if (cur && hits(cur.cells, cur.x, cur.y + 1)) { lockT += dt; if (lockT >= 0.5) lock(); }
      else lockT = 0;
    }

    /* ---- drawing ---- */
    function block(ctx, x, y, s, color, alpha) {
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.fillStyle = color; ctx.fillRect(x, y, s, s);
      const b = Math.max(2, s * 0.14);
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s, y); ctx.lineTo(x + s - b, y + b); ctx.lineTo(x + b, y + b); ctx.lineTo(x + b, y + s - b); ctx.lineTo(x, y + s); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.moveTo(x + s, y + s); ctx.lineTo(x, y + s); ctx.lineTo(x + b, y + s - b); ctx.lineTo(x + s - b, y + s - b); ctx.lineTo(x + s - b, y + b); ctx.lineTo(x + s, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.fillRect(x + b + 1, y + b + 1, s - 2 * b - 2, (s - 2 * b) * 0.4);
      ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
      ctx.globalAlpha = 1;
    }
    function mini(ctx, type, cx, cy, s) {
      const p = PIECES[type];
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (const c of p.cells) { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); }
      const ox = cx - (x1 - x0 + 1) * s / 2, oy = cy - (y1 - y0 + 1) * s / 2;
      for (const c of p.cells) block(ctx, ox + (c[0] - x0) * s, oy + (c[1] - y0) * s, s, p.c);
    }
    function panel(ctx, x, y, w, h, title) {
      GK.rr(ctx, x, y, w, h, 8);
      ctx.fillStyle = "rgba(8, 14, 40, 0.75)"; ctx.fill();
      ctx.strokeStyle = "#5A78D8"; ctx.lineWidth = 1.5; ctx.stroke();
      GK.text(ctx, title, x + w / 2, y + 14, 12, "#9FB8FF", "center");
    }
    const back = GK.layer(W, H, 2, x => {
      const bg = x.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#1B2A6B"); bg.addColorStop(1, "#0A1030");
      x.fillStyle = bg; x.fillRect(0, 0, W, H);
      x.fillStyle = "#060A1E"; x.fillRect(BX - 4, BY - 4, COLS * C + 8, ROWS * C + 8);
      const wg = x.createLinearGradient(0, BY, 0, BY + ROWS * C);
      wg.addColorStop(0, "#101940"); wg.addColorStop(1, "#070B22");
      x.fillStyle = wg; x.fillRect(BX, BY, COLS * C, ROWS * C);
      x.strokeStyle = "rgba(120,150,255,0.10)"; x.lineWidth = 1;
      for (let i = 1; i < COLS; i++) { x.beginPath(); x.moveTo(BX + i * C + 0.5, BY); x.lineTo(BX + i * C + 0.5, BY + ROWS * C); x.stroke(); }
      for (let j = 1; j < ROWS; j++) { x.beginPath(); x.moveTo(BX, BY + j * C + 0.5); x.lineTo(BX + COLS * C, BY + j * C + 0.5); x.stroke(); }
      x.strokeStyle = "#7C9BFF"; x.lineWidth = 2; x.strokeRect(BX - 3, BY - 3, COLS * C + 6, ROWS * C + 6);
    });

    function draw(ctx) {
      ctx.drawImage(back, 0, 0, W, H);
      ctx.save();
      if (shake > 0) ctx.translate(0, shake * 30);
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
        const c = grid && grid[y][x];
        if (!c) continue;
        if (clearing && clearing.includes(y)) { const t = clearT / 0.28; block(ctx, BX + x * C, BY + y * C, C, Math.floor(t * 8) % 2 ? "#FFFFFF" : c, Math.max(0.15, t)); }
        else block(ctx, BX + x * C, BY + y * C, C, c);
      }
      if (cur) {
        const gy = ghostY(), col = PIECES[cur.type].c;
        ctx.save(); ctx.beginPath(); ctx.rect(BX, BY, COLS * C, ROWS * C); ctx.clip();
        for (const c of cur.cells) {
          const x = BX + (cur.x + c[0]) * C, y = BY + (gy + c[1]) * C;
          ctx.strokeStyle = col; ctx.globalAlpha = 0.55; ctx.lineWidth = 2; ctx.strokeRect(x + 2, y + 2, C - 4, C - 4);
          ctx.globalAlpha = 0.12; ctx.fillStyle = col; ctx.fillRect(x + 2, y + 2, C - 4, C - 4); ctx.globalAlpha = 1;
        }
        for (const c of cur.cells) block(ctx, BX + (cur.x + c[0]) * C, BY + (cur.y + c[1]) * C, C, col);
        ctx.restore();
      }
      ctx.restore();
      for (const p of parts) { ctx.globalAlpha = Math.min(1, p.life * 2); ctx.fillStyle = p.c; ctx.fillRect(p.x - 3, p.y - 3, 6, 6); }
      ctx.globalAlpha = 1;
      if (flash > 0) { ctx.fillStyle = "rgba(255,255,255," + (flash * 0.8) + ")"; ctx.fillRect(BX, BY, COLS * C, ROWS * C); }

      panel(ctx, PX, 20, 138, 190, "NEXT");
      if (queue) for (let i = 0; i < 3 && i < queue.length; i++) mini(ctx, queue[i], PX + 69, 62 + i * 52, i === 0 ? 20 : 15);
      panel(ctx, PX, 222, 138, 84, "HOLD  (C)");
      if (hold) { ctx.globalAlpha = canHold ? 1 : 0.4; mini(ctx, hold, PX + 69, 272, 18); ctx.globalAlpha = 1; }
      panel(ctx, PX, 318, 138, 262, "SCORE");
      GK.text(ctx, String(score || 0), PX + 69, 352, 24, "#FFE27A", "center");
      GK.text(ctx, "LEVEL", PX + 69, 392, 12, "#9FB8FF", "center");
      GK.text(ctx, String(level || 1), PX + 69, 416, 22, "#FFFFFF", "center");
      GK.text(ctx, "ROWS", PX + 69, 454, 12, "#9FB8FF", "center");
      GK.text(ctx, String(lines || 0), PX + 69, 478, 22, "#FFFFFF", "center");
      GK.text(ctx, "BEST", PX + 69, 516, 12, "#9FB8FF", "center");
      const b = g.best();
      GK.text(ctx, b == null ? "-" : String(b), PX + 69, 540, 20, "#8CF08C", "center");

      if (state === "ready") g.banner("Blocks", ["Fill a whole row to clear it.", "Press Enter or click to start."]);
      else if (state === "over") g.banner("Game over", ["Score " + score + "   Rows " + lines + "   Level " + level, "Press Enter or click to play again."]);
    }

    grid = newGrid(); queue = []; score = 0; lines = 0; level = 1;
    showInfo();
    g.start({ update, draw });
    return { destroy() { g.destroy(); } };
  }
  return { init };
})();
