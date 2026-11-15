/* Maze Walk (age 5 and up): drag the little robot along the paths to the star. Walls just stop it; nothing can be lost. The maze grows with the stars won. Rules in lib/kidmaze.js. */
(window.DesktopApps = window.DesktopApps || {}).kidmaze = (() => {
  function init(root) {
    const K = window.Kids, M = window.KidMaze, kd = root.querySelector(".kd"), stage = root.querySelector("#kidmaze-stage"), modes = root.querySelector("#kidmaze-modes");
    const kit = K.mount(kd, "kidmaze");
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    modes.remove();
    const canvas = el("canvas", "kd-maze"); canvas.tabIndex = 0; canvas.setAttribute("aria-label", "Maze: drag the robot to the star, or use the arrow keys");
    const help = el("button", "xp-btn small", "Show me the way (grown-ups)"); help.type = "button";
    const wrap = el("div", "kd-mazewrap"); wrap.append(canvas, help); stage.append(wrap);
    const ctx = canvas.getContext("2d");
    let maze, pos, trail, size = 300, cell = 30, dragging = false, showWay = 0, done = false, timers = [];
    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
    const level = () => Math.floor(K.stars.of("kidmaze") / 3);

    function layout() {
      const avail = Math.max(200, Math.min(620, stage.clientWidth - 24, stage.clientHeight - 80 || 620));
      size = Math.floor(avail / maze.w) * maze.w; cell = size / maze.w;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = size * dpr; canvas.height = size * dpr; canvas.style.width = size + "px"; canvas.style.height = size + "px"; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const centre = (x, y) => [(x + 0.5) * cell, (y + 0.5) * cell];
    function draw() {
      ctx.clearRect(0, 0, size, size); ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, size, size);
      // the path walked so far
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#FFCC80"; ctx.lineWidth = cell * 0.4; ctx.beginPath();
      trail.forEach(([x, y], i) => { const [cx, cy] = centre(x, y); if (i) ctx.lineTo(cx, cy); else ctx.moveTo(cx, cy); }); ctx.stroke();
      if (showWay > Date.now()) { const p = M.path(maze, pos, maze.goal); ctx.strokeStyle = "#81C784"; ctx.lineWidth = cell * 0.18; ctx.setLineDash([cell * 0.3, cell * 0.25]); ctx.beginPath(); p.forEach(([x, y], i) => { const [cx, cy] = centre(x, y); if (i) ctx.lineTo(cx, cy); else ctx.moveTo(cx, cy); }); ctx.stroke(); ctx.setLineDash([]); }
      // walls
      ctx.strokeStyle = "#3D6FD8"; ctx.lineWidth = Math.max(4, cell * 0.14);
      ctx.beginPath();
      for (let y = 0; y < maze.h; y++) for (let x = 0; x < maze.w; x++) {
        const c = maze.cells[y * maze.w + x], x0 = x * cell, y0 = y * cell;
        if (!(c & M.N)) { ctx.moveTo(x0, y0); ctx.lineTo(x0 + cell, y0); }
        if (!(c & M.W)) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 + cell); }
        if (y === maze.h - 1 && !(c & M.S)) { ctx.moveTo(x0, y0 + cell); ctx.lineTo(x0 + cell, y0 + cell); }
        if (x === maze.w - 1 && !(c & M.E)) { ctx.moveTo(x0 + cell, y0); ctx.lineTo(x0 + cell, y0 + cell); }
      }
      ctx.stroke();
      // the star
      { const [cx, cy] = centre(...maze.goal), R = cell * 0.36, r = R * 0.45; ctx.fillStyle = "#FDD835"; ctx.strokeStyle = "#E0B000"; ctx.lineWidth = 2; ctx.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? r : R; ctx[i ? "lineTo" : "moveTo"](cx + d * Math.cos(a), cy + d * Math.sin(a)); } ctx.closePath(); ctx.fill(); ctx.stroke(); }
      // the robot
      { const [cx, cy] = centre(...pos), R = cell * 0.34; ctx.fillStyle = "#2F6BD8"; ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(cx - R, cy - R, R * 2, R * 2, R * 0.45); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#FFFFFF"; for (const dx of [-0.42, 0.42]) { ctx.beginPath(); ctx.arc(cx + dx * R, cy - R * 0.1, R * 0.26, 0, 7); ctx.fill(); }
        ctx.fillStyle = "#263238"; for (const dx of [-0.42, 0.42]) { ctx.beginPath(); ctx.arc(cx + dx * R, cy - R * 0.1, R * 0.12, 0, 7); ctx.fill(); }
        ctx.strokeStyle = "#FFFFFF"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy + R * 0.25, R * 0.3, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
    }
    function newMaze() {
      for (const t of timers) clearTimeout(t); timers = []; done = false; showWay = 0;
      const n = M.sizeFor(level()); maze = M.make(n, n); pos = maze.start.slice(); trail = [pos.slice()]; layout(); draw();
    }
    function moveTo(c) {
      const back = trail.length > 1 && trail[trail.length - 2][0] === c[0] && trail[trail.length - 2][1] === c[1];
      if (back) trail.pop(); else trail.push(c.slice());
      pos = c.slice(); K.chime("step");
      if (pos[0] === maze.goal[0] && pos[1] === maze.goal[1]) { done = true; dragging = false; K.chime("win"); K.celebrate(stage); kit.star(); later(newMaze, 2800); }
    }
    // follow the finger: walk along the maze's own paths towards the square under it (a few squares at a time, never through a wall)
    function follow(px, py) {
      if (done) return;
      const t = [Math.max(0, Math.min(maze.w - 1, Math.floor(px / cell))), Math.max(0, Math.min(maze.h - 1, Math.floor(py / cell)))];
      if (t[0] === pos[0] && t[1] === pos[1]) return;
      const p = M.path(maze, pos, t); if (!p || p.length - 1 > 4) return;
      for (const c of p.slice(1)) moveTo(c);
      draw();
    }
    const where = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * size / r.width, (e.clientY - r.top) * size / r.height]; };
    canvas.addEventListener("pointerdown", e => {
      if (done) return; const [x, y] = where(e), [cx, cy] = centre(...pos);
      if (Math.hypot(x - cx, y - cy) > cell * 1.2) { follow(x, y); return; } // a tap next to the robot also moves it
      dragging = true; try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } e.preventDefault();
    });
    canvas.addEventListener("pointermove", e => { if (dragging) { const [x, y] = where(e); follow(x, y); } });
    for (const t of ["pointerup", "pointercancel"]) canvas.addEventListener(t, () => { dragging = false; });
    canvas.addEventListener("keydown", e => {
      const d = { ArrowUp: [M.N, 0, -1], ArrowRight: [M.E, 1, 0], ArrowDown: [M.S, 0, 1], ArrowLeft: [M.W, -1, 0] }[e.key]; if (!d || done) return;
      e.preventDefault(); if (M.open(maze, pos[0], pos[1], d[0])) { moveTo([pos[0] + d[1], pos[1] + d[2]]); draw(); }
    });
    help.addEventListener("click", () => { showWay = Date.now() + 3500; draw(); later(draw, 3600); });
    const onResize = () => { if (maze) { layout(); draw(); } };
    window.addEventListener("resize", onResize);
    newMaze();
    // the window may get its size a moment after the app starts
    later(onResize, 200);
    return { destroy() { for (const t of timers) clearTimeout(t); window.removeEventListener("resize", onResize); kit.destroy(); } };
  }
  return { init };
})();
