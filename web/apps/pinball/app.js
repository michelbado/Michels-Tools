/* Pinball: one table, real ball physics (many small steps per frame so the ball never passes through anything).
 * Everything runs in the browser; the best score is kept in this browser only. */
(window.DesktopApps = window.DesktopApps || {}).pinball = (() => {
  const W = 640, H = 800, TW = 480, R = 11, GRAV = 1150, MAXV = 2400, MID = 224;
  const FLIP_R = 8, FLIP_UP = 22, FLIP_DOWN = 14;
  const fmt = n => Math.round(n).toLocaleString("en-US");

  /* ---- the table: walls are line segments, bumpers and posts are circles ---- */
  const segs = [], circles = [];
  function seg(x1, y1, x2, y2, o) {
    const s = Object.assign({ x1, y1, x2, y2, e: 0.45, r: 0 }, o || {});
    s.dx = x2 - x1; s.dy = y2 - y1; s.len2 = s.dx * s.dx + s.dy * s.dy;
    segs.push(s);
    return s;
  }
  const ARC = 32;
  for (let i = 0; i < ARC; i++) {
    const a0 = Math.PI + Math.PI * i / ARC, a1 = Math.PI + Math.PI * (i + 1) / ARC;
    seg(240 + 220 * Math.cos(a0), 170 + 150 * Math.sin(a0), 240 + 220 * Math.cos(a1), 170 + 150 * Math.sin(a1), { arc: true });
  }
  seg(20, 170, 20, 640); seg(20, 640, 126, 702);                       // left wall and guide
  seg(460, 170, 460, 800);                                             // right wall (outside of the launch lane)
  seg(428, 215, 428, 800); seg(428, 640, 322, 702);                    // lane divider and right guide
  seg(428, 772, 460, 772, { e: 0.05, plunger: true });                 // the ball rests here before launch
  for (const x of [142, 197, 252, 307]) seg(x, 98, x, 132, { r: 3, post: true });   // posts between the top lanes
  const slings = [
    { pts: [[78, 505], [78, 600], [126, 632]], t: 0 },
    { pts: [[370, 505], [370, 600], [322, 632]], t: 0 },
  ];
  slings.forEach((s, i) => {
    const p = s.pts;
    seg(p[0][0], p[0][1], p[2][0], p[2][1], { kick: 430, sling: i, e: 0.3 });
    seg(p[0][0], p[0][1], p[1][0], p[1][1]); seg(p[1][0], p[1][1], p[2][0], p[2][1]);
  });
  const TARGET_Y = [340, 385, 430, 475];
  TARGET_Y.forEach((y, i) => { seg(31, y - 14, 31, y + 14, { target: i, e: 0.5 }); seg(417, y - 14, 417, y + 14, { target: 4 + i, e: 0.5 }); });
  const bumpers = [{ x: 165, y: 255, r: 24, t: 0 }, { x: 285, y: 255, r: 24, t: 0 }, { x: 225, y: 345, r: 24, t: 0 }];
  bumpers.forEach(b => circles.push(b));
  circles.push({ x: 428, y: 215, r: 3 });
  const HOLE = { x: 66, y: 235, r: 15 };
  const LANE_X = [142, 197, 252, 307];

  function init(root) {
    const GK = window.GameKit, g = GK.create(root, "pinball", { W, H });
    const flips = [
      { px: 134, py: 712, len: 74, rest: 0.5, act: -0.55, a: 0.5, w: 0, on: false },
      { px: 314, py: 712, len: 74, rest: Math.PI - 0.5, act: Math.PI + 0.55, a: Math.PI - 0.5, w: 0, on: false },
    ];
    const ball = { x: 444, y: 761, vx: 0, vy: 0, held: 0, live: false, trail: [] };
    let state = "ready", score = 0, balls = 3, mult = 1, power = 0, charging = false, saveT = 0, saveUsed = false, holeCool = 0, stillT = 0, heat = 0;
    let lanes = [false, false, false], targets = new Array(8).fill(false), msg = "", msgT = 0, lampT = 0, holeT = 0;
    const ptr = new Map();

    const say = (t, secs) => { msg = t; msgT = secs || 2; };
    const add = n => { score += n * mult; };
    function showInfo() { const b = g.best(); g.info("Score " + fmt(score) + (b != null ? "   Best " + fmt(b) : "")); }
    function placeBall() { ball.x = 444; ball.y = 772 - R; ball.vx = ball.vy = 0; ball.held = 0; ball.live = false; ball.trail.length = 0; power = 0; charging = false; stillT = 0; heat = 0; }
    function newGame() {
      state = "play"; g.playing = true; g.setPaused(false);
      score = 0; balls = 3; mult = 1; saveT = 0; saveUsed = false; lanes = [false, false, false]; targets.fill(false);
      placeBall(); say("HOLD SPACE TO LAUNCH", 4); showInfo();
      g.status("Hold Space and let go to launch the ball. Left and Right arrows (or Z and M) work the flippers.");
    }
    const inLane = () => ball.x > 430 && ball.y > 640 && Math.abs(ball.vy) < 90 && Math.abs(ball.vx) < 90;

    function drained() {
      if (saveT > 0) { saveT = 0; saveUsed = true; placeBall(); say("BALL SAVED", 2.5); g.sfx.tune([[660, 0.08], [880, 0.12]], { type: "triangle" }); return; }
      balls--; mult = 1; saveUsed = false; saveT = 0; lanes = [false, false, false];
      g.sfx.tune([[330, 0.12], [262, 0.12], [196, 0.25]], { type: "sawtooth", vol: 0.1 });
      if (balls <= 0) {
        state = "over"; g.playing = false;
        const rec = g.saveBest(score);
        g.status(rec && score > 0 ? "Game over. New best score: " + fmt(score) + "." : "Game over. Score " + fmt(score) + ".");
        showInfo();
        return;
      }
      placeBall(); say("BALL " + (4 - balls) + " OF 3", 2.5); showInfo();
    }

    function launch() {
      if (!inLane()) { power = 0; return; }
      ball.vy = -(1150 + 950 * power); ball.vx = 0;
      g.sfx.noise(0.25, { freq: 400, to: 2400, vol: 0.3, type: "bandpass" });
      power = 0;
    }
    function flip(i, on) {
      if (flips[i].on === on) return;
      flips[i].on = on;
      if (on && state === "play") g.sfx.noise(0.04, { freq: 1800, vol: 0.22 });
    }
    function syncInputs() {
      const k = g.keys;
      let L = k.has("ArrowLeft") || k.has("KeyZ") || k.has("ShiftLeft"), Rr = k.has("ArrowRight") || k.has("KeyM") || k.has("Slash") || k.has("ShiftRight");
      let P = k.has("Space") || k.has("ArrowDown");
      for (const v of ptr.values()) { if (v === "L") L = true; else if (v === "R") Rr = true; else P = true; }
      flip(0, L); flip(1, Rr);
      if (P && !charging && state === "play" && inLane()) charging = true;
      if (!P && charging) { charging = false; launch(); }
    }
    g.onKey = code => { if (state !== "play" && (code === "Enter" || code === "Space")) { g.keys.delete(code); newGame(); } };
    g.onDown = (x, y, e) => {
      if (state !== "play") { newGame(); return; }
      ptr.set(e.pointerId, inLane() ? "P" : x < W / 2 ? "L" : "R");
    };
    g.onUp = (x, y, e) => { ptr.delete(e.pointerId); };
    g.onPause = () => { ptr.clear(); };
    g.q("new").addEventListener("click", newGame);

    /* ---- physics ---- */
    function hitSeg(s) {
      let t = ((ball.x - s.x1) * s.dx + (ball.y - s.y1) * s.dy) / s.len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = s.x1 + t * s.dx, py = s.y1 + t * s.dy;
      let nx = ball.x - px, ny = ball.y - py;
      const d2 = nx * nx + ny * ny, rr = R + s.r;
      if (d2 >= rr * rr || d2 === 0) return;
      const d = Math.sqrt(d2);
      nx /= d; ny /= d;
      ball.x = px + nx * rr; ball.y = py + ny * rr;
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn >= 0) return;
      const e = vn > -40 ? 0 : s.e;
      ball.vx -= (1 + e) * vn * nx; ball.vy -= (1 + e) * vn * ny;
      if (vn < -70) {
        if (s.kick) {
          // A slingshot coil needs a moment before it fires again, and it weakens when it fires too often without a flipper playing the ball (heat).
          // Without this the ball could bounce between the two slingshots, or juggle on one, for ever: each kick gave back what the bounce took away.
          const sl = slings[s.sling], power = Math.max(0, Math.min(1, 1 - (heat - 3) / 3));
          if (sl.t <= 0 && power > 0) {
            ball.vx += nx * s.kick * power; ball.vy += ny * s.kick * power; sl.t = 0.14; heat += 1; add(20);
            g.sfx.noise(0.06, { freq: 900, vol: 0.3 * power }); g.sfx.tone(180, 0.07, { to: 90, vol: 0.12 * power });
          }
        }
        else if (s.target != null) hitTarget(s.target);
        else if (vn < -260 && !s.plunger) g.sfx.noise(0.03, { freq: 500, vol: Math.min(0.2, -vn / 6000) });
      }
    }
    function hitTarget(i) {
      add(250);
      if (!targets[i]) {
        targets[i] = true;
        g.sfx.tone(880, 0.09, { type: "triangle", vol: 0.14 });
        const base = i < 4 ? 0 : 4;
        if (targets.slice(base, base + 4).every(Boolean)) {
          add(5000); say((i < 4 ? "LEFT" : "RIGHT") + " BANK  +" + fmt(5000 * mult), 2.5); lampT = 1.2;
          for (let k = 0; k < 4; k++) targets[base + k] = false;
          g.sfx.tune([[784, 0.07], [988, 0.07], [1175, 0.07], [1568, 0.2]], { type: "square", vol: 0.1 });
        }
      } else g.sfx.tone(520, 0.05, { type: "triangle", vol: 0.08 });
    }
    function hitCircle(c) {
      let nx = ball.x - c.x, ny = ball.y - c.y;
      const d2 = nx * nx + ny * ny, rr = R + c.r;
      if (d2 >= rr * rr || d2 === 0) return;
      const d = Math.sqrt(d2);
      nx /= d; ny /= d;
      ball.x = c.x + nx * rr; ball.y = c.y + ny * rr;
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn >= 0) return;
      ball.vx -= 1.6 * vn * nx; ball.vy -= 1.6 * vn * ny;
      if (c.t != null) {
        ball.vx += nx * 380; ball.vy += ny * 380; c.t = 0.16; add(100);
        g.sfx.tone(300, 0.09, { to: 720, type: "square", vol: 0.13 });
      }
    }
    function hitFlipper(f) {
      const cx = Math.cos(f.a), sy = Math.sin(f.a), dx = cx * f.len, dy = sy * f.len;
      let t = ((ball.x - f.px) * dx + (ball.y - f.py) * dy) / (f.len * f.len);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = f.px + t * dx, qy = f.py + t * dy;
      let nx = ball.x - qx, ny = ball.y - qy;
      const d2 = nx * nx + ny * ny, rr = R + FLIP_R;
      if (d2 >= rr * rr || d2 === 0) return;
      const d = Math.sqrt(d2);
      nx /= d; ny /= d;
      ball.x = qx + nx * rr; ball.y = qy + ny * rr;
      const svx = -f.w * (qy - f.py), svy = f.w * (qx - f.px);       // how fast this point of the flipper is moving
      const vn = (ball.vx - svx) * nx + (ball.vy - svy) * ny;
      if (vn >= 0) return;
      heat = 0;                                                      // a flipper has the ball: the slingshots are fresh again
      const e = vn > -60 ? 0 : 0.32;
      ball.vx -= (1 + e) * vn * nx; ball.vy -= (1 + e) * vn * ny;
    }
    function step(h) {
      for (const f of flips) {
        const tgt = f.on ? f.act : f.rest, prev = f.a, dir = Math.sign(tgt - f.a);
        if (dir) { f.a += dir * (f.on ? FLIP_UP : FLIP_DOWN) * h; if ((tgt - f.a) * dir < 0) f.a = tgt; }
        f.w = (f.a - prev) / h;
      }
      if (ball.held > 0) {
        ball.held -= h;
        if (ball.held <= 0) { ball.vx = GK.rand(230, 330); ball.vy = GK.rand(240, 380); holeCool = 1; g.sfx.tone(240, 0.1, { to: 600, vol: 0.14 }); }
        return;
      }
      ball.vy += GRAV * h;
      ball.x += ball.vx * h; ball.y += ball.vy * h;
      for (let i = 0; i < segs.length; i++) hitSeg(segs[i]);
      for (let i = 0; i < circles.length; i++) hitCircle(circles[i]);
      hitFlipper(flips[0]); hitFlipper(flips[1]);
      const v2 = ball.vx * ball.vx + ball.vy * ball.vy;
      if (v2 > MAXV * MAXV) { const k = MAXV / Math.sqrt(v2); ball.vx *= k; ball.vy *= k; }
      // top lanes
      if (ball.y > 104 && ball.y < 126) {
        for (let i = 0; i < 3; i++) if (!lanes[i] && ball.x > LANE_X[i] + 6 && ball.x < LANE_X[i + 1] - 6) {
          lanes[i] = true; add(500); g.sfx.tone(1200, 0.08, { type: "sine", vol: 0.14 });
          if (lanes.every(Boolean)) { lanes = [false, false, false]; if (mult < 6) mult++; say("MULTIPLIER x" + mult, 2.5); lampT = 1.2; g.sfx.tune([[880, 0.07], [1109, 0.07], [1319, 0.07], [1760, 0.2]], { type: "triangle", vol: 0.12 }); }
        }
      }
      // the hole swallows a slow ball, pays, and throws it back
      if (holeCool <= 0 && v2 < 900 * 900) {
        const hx = ball.x - HOLE.x, hy = ball.y - HOLE.y;
        if (hx * hx + hy * hy < 100) { ball.held = 1.1; ball.x = HOLE.x; ball.y = HOLE.y; ball.vx = ball.vy = 0; holeT = 1.1; add(2500); say("HOLE  +" + fmt(2500 * mult), 2); g.sfx.tune([[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.09], [784, 0.09], [1047, 0.2]], { type: "square", vol: 0.09 }); }
      }
      if (!ball.live && ball.x < 418) { ball.live = true; if (!saveUsed) saveT = 10; }
      if (v2 < 64 && ball.y < 600 && ball.x < 428) { stillT += h; if (stillT > 2) { ball.vy -= 260; ball.vx += GK.rand(-120, 120); stillT = 0; } } else stillT = 0;
    }

    let trailT = 0;
    function update(dt) {
      for (const b of bumpers) b.t = Math.max(0, b.t - dt);
      for (const s of slings) s.t = Math.max(0, s.t - dt);
      msgT = Math.max(0, msgT - dt); lampT = Math.max(0, lampT - dt); holeT = Math.max(0, holeT - dt);
      syncInputs();
      if (state !== "play") { const n = Math.ceil(dt * 240), h = dt / n; for (let i = 0; i < n; i++) for (const f of flips) { const tgt = f.on ? f.act : f.rest, dir = Math.sign(tgt - f.a); if (dir) { f.a += dir * FLIP_UP * h; if ((tgt - f.a) * dir < 0) f.a = tgt; } } return; }
      saveT = Math.max(0, saveT - dt); holeCool = Math.max(0, holeCool - dt); heat = Math.max(0, heat - 0.8 * dt);
      if (charging) power = Math.min(1, power + dt / 1.1);
      const before = score;
      const n = Math.max(1, Math.ceil(dt * 720)), h = dt / n;
      for (let i = 0; i < n; i++) { step(h); if (ball.y > H + 30) { drained(); break; } }
      trailT += dt;
      if (trailT > 0.016) { trailT = 0; ball.trail.push(ball.x, ball.y); if (ball.trail.length > 14) ball.trail.splice(0, 2); }
      if (score !== before) showInfo();
    }

    /* ---- drawing ---- */
    function tablePath(x) { x.beginPath(); x.moveTo(20, H); x.lineTo(20, 170); x.ellipse(240, 170, 220, 150, 0, Math.PI, 2 * Math.PI); x.lineTo(460, H); x.closePath(); }
    const back = GK.layer(W, H, 2, x => {
      x.fillStyle = "#05071A"; x.fillRect(0, 0, W, H);
      x.save(); tablePath(x); x.clip();
      const bg = x.createRadialGradient(240, 320, 40, 240, 380, 560);
      bg.addColorStop(0, "#3A2FA8"); bg.addColorStop(0.45, "#1B1870"); bg.addColorStop(1, "#080A2C");
      x.fillStyle = bg; x.fillRect(0, 0, TW, H);
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 170; i++) { const sx = 20 + rnd() * 440, sy = 20 + rnd() * 780, sr = rnd() * 1.3 + 0.3; x.fillStyle = "rgba(255,255,255," + (0.25 + rnd() * 0.6) + ")"; x.beginPath(); x.arc(sx, sy, sr, 0, 6.283); x.fill(); }
      // a ringed planet and a nebula, far away
      const pl = x.createRadialGradient(300, 520, 6, 320, 540, 80);
      pl.addColorStop(0, "rgba(255,170,90,0.55)"); pl.addColorStop(1, "rgba(120,40,120,0.10)");
      x.fillStyle = pl; x.beginPath(); x.arc(320, 540, 62, 0, 6.283); x.fill();
      x.strokeStyle = "rgba(255,210,150,0.35)"; x.lineWidth = 5; x.beginPath(); x.ellipse(320, 540, 98, 20, -0.35, 0, 6.283); x.stroke();
      const nb = x.createRadialGradient(120, 430, 5, 120, 430, 130);
      nb.addColorStop(0, "rgba(90,200,255,0.28)"); nb.addColorStop(1, "rgba(90,200,255,0)");
      x.fillStyle = nb; x.fillRect(0, 280, 280, 300);
      // rings on the floor under the bumpers, arrows to the lanes
      x.strokeStyle = "rgba(255,255,255,0.18)"; x.lineWidth = 2;
      for (const b of bumpers) { x.beginPath(); x.arc(b.x, b.y, b.r + 12, 0, 6.283); x.stroke(); }
      x.fillStyle = "rgba(255,226,122,0.30)";
      for (let i = 0; i < 3; i++) { const cx = (LANE_X[i] + LANE_X[i + 1]) / 2; x.beginPath(); x.moveTo(cx, 150); x.lineTo(cx - 9, 168); x.lineTo(cx + 9, 168); x.closePath(); x.fill(); }
      x.fillStyle = "#0B0D30"; x.fillRect(428, 215, 32, 600);
      x.restore();
      // walls: dark edge, bright metal on top
      for (const pass of [0, 1]) {
        x.lineCap = "round";
        x.strokeStyle = pass ? "#C8D3F2" : "#0A0C2A"; x.lineWidth = pass ? 4 : 8;
        for (const s of segs) { if (s.target != null || s.sling != null || s.plunger) continue; x.lineWidth = (pass ? 4 : 8) + s.r * 2; x.beginPath(); x.moveTo(s.x1, s.y1); x.lineTo(s.x2, s.y2); x.stroke(); }
      }
      x.fillStyle = "#0A0C2A"; x.fillRect(20, 702, 108, 100); x.fillRect(320, 702, 110, 100);
      x.fillStyle = "#1A1F5A"; x.fillRect(24, 720, 96, 80); x.fillRect(328, 720, 96, 80);
      // the side panel
      const pg = x.createLinearGradient(TW, 0, W, 0);
      pg.addColorStop(0, "#0C1038"); pg.addColorStop(1, "#141A52");
      x.fillStyle = pg; x.fillRect(TW, 0, W - TW, H);
      x.fillStyle = "#5A78D8"; x.fillRect(TW, 0, 2, H);
      GK.text(x, "PINBALL", 560, 44, 26, "#FFE27A", "center");
      x.fillStyle = "#5A78D8"; x.fillRect(500, 66, 120, 2);
      const help = ["Left arrow or Z", "left flipper", "", "Right arrow or M", "right flipper", "", "Hold Space", "then let go: launch", "", "P: pause"];
      help.forEach((l, i) => GK.text(x, l, 560, 560 + i * 20, 12, i % 3 === 0 ? "#DCE6FF" : "#8FA2D8", "center", i % 3 === 0 ? "bold" : "normal"));
    });

    function glow(ctx, color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
    function draw(ctx) {
      ctx.drawImage(back, 0, 0, W, H);
      const blink = lampT > 0 && Math.floor(lampT * 10) % 2 === 0;
      // lane lamps
      for (let i = 0; i < 3; i++) {
        const cx = (LANE_X[i] + LANE_X[i + 1]) / 2, lit = lanes[i] || blink;
        ctx.save(); if (lit) glow(ctx, "#FFE27A", 16);
        ctx.fillStyle = lit ? "#FFE27A" : "#4A4520"; ctx.beginPath(); ctx.arc(cx, 115, 9, 0, 6.283); ctx.fill(); ctx.restore();
      }
      // targets
      for (let i = 0; i < 8; i++) {
        const left = i < 4, y = TARGET_Y[i % 4], lit = targets[i] || blink;
        ctx.save(); if (lit) glow(ctx, "#6CFF8A", 12);
        ctx.fillStyle = lit ? "#6CFF8A" : "#B03A4A";
        GK.rr(ctx, left ? 22 : 417, y - 14, 10, 28, 3); ctx.fill(); ctx.restore();
      }
      // hole
      ctx.fillStyle = "#02030C"; ctx.beginPath(); ctx.arc(HOLE.x, HOLE.y, HOLE.r, 0, 6.283); ctx.fill();
      ctx.save(); if (holeT > 0) glow(ctx, "#FF8A3C", 18);
      ctx.strokeStyle = holeT > 0 ? "#FFB060" : "#8A6AD8"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(HOLE.x, HOLE.y, HOLE.r + 2, 0, 6.283); ctx.stroke(); ctx.restore();
      // slingshots
      for (const s of slings) {
        const p = s.pts;
        ctx.save(); if (s.t > 0) glow(ctx, "#FFFFFF", 18);
        ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(p[1][0], p[1][1]); ctx.lineTo(p[2][0], p[2][1]); ctx.closePath();
        ctx.fillStyle = s.t > 0 ? "#FFE8A0" : "#D8483C"; ctx.fill();
        ctx.lineJoin = "round"; ctx.lineWidth = 4; ctx.strokeStyle = "#F4F6FF"; ctx.stroke(); ctx.restore();
      }
      // bumpers
      for (const b of bumpers) {
        const r = b.r + (b.t > 0 ? 3 : 0);
        ctx.save(); if (b.t > 0) glow(ctx, "#FFE27A", 26);
        ctx.fillStyle = "#F4F6FF"; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 6.283); ctx.fill(); ctx.restore();
        const gr = ctx.createRadialGradient(b.x - 6, b.y - 7, 2, b.x, b.y, r - 4);
        if (b.t > 0) { gr.addColorStop(0, "#FFFFFF"); gr.addColorStop(1, "#FFC830"); } else { gr.addColorStop(0, "#FF9A7A"); gr.addColorStop(1, "#B81E2E"); }
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(b.x, b.y, r - 5, 0, 6.283); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, 6.283); ctx.fill();
      }
      // ball-save lamp between the flippers
      GK.text(ctx, "BALL SAVE", MID, 778, 11, saveT > 0 && (saveT > 2 || Math.floor(saveT * 6) % 2) ? "#6CFF8A" : "#2A3A5A", "center");
      // plunger
      const py = 774 + power * 18;
      ctx.fillStyle = "#8A93B8"; ctx.fillRect(441, py + 6, 6, 40);
      ctx.fillStyle = power > 0 ? "#FFB060" : "#D8DEF4"; GK.rr(ctx, 432, py, 24, 8, 3); ctx.fill();
      if (power > 0) { ctx.fillStyle = "#1A1F5A"; ctx.fillRect(464, 640, 8, 130); ctx.fillStyle = power > 0.85 ? "#FF5A4A" : "#6CFF8A"; ctx.fillRect(464, 770 - 130 * power, 8, 130 * power); }
      // flippers
      for (const f of flips) {
        const tx = f.px + Math.cos(f.a) * f.len, ty = f.py + Math.sin(f.a) * f.len;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#5A0C14"; ctx.lineWidth = FLIP_R * 2 + 4; ctx.beginPath(); ctx.moveTo(f.px, f.py); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.strokeStyle = "#F0483C"; ctx.lineWidth = FLIP_R * 2; ctx.beginPath(); ctx.moveTo(f.px, f.py); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(f.px, f.py); ctx.lineTo(f.px + Math.cos(f.a) * (f.len - 6), f.py + Math.sin(f.a) * (f.len - 6)); ctx.stroke();
        ctx.fillStyle = "#F4F6FF"; ctx.beginPath(); ctx.arc(f.px, f.py, 4, 0, 6.283); ctx.fill();
      }
      // ball
      if (state !== "over") {
        const tr = ball.trail;
        for (let i = 0; i < tr.length; i += 2) { ctx.fillStyle = "rgba(200,220,255," + (0.03 + 0.012 * i) + ")"; ctx.beginPath(); ctx.arc(tr[i], tr[i + 1], R * (0.45 + 0.035 * i), 0, 6.283); ctx.fill(); }
        if (ball.held <= 0) {
          ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.arc(ball.x + 3, ball.y + 4, R, 0, 6.283); ctx.fill();
          const gr = ctx.createRadialGradient(ball.x - 4, ball.y - 4, 1, ball.x, ball.y, R);
          gr.addColorStop(0, "#FFFFFF"); gr.addColorStop(0.5, "#C4CCDC"); gr.addColorStop(1, "#5E6880");
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(ball.x, ball.y, R, 0, 6.283); ctx.fill();
        }
      }
      // side panel numbers
      GK.text(ctx, "SCORE", 560, 100, 13, "#9FB8FF", "center");
      ctx.save(); glow(ctx, "#FFB030", 10); GK.text(ctx, fmt(score), 560, 132, score > 9999999 ? 20 : 26, "#FFC848", "center"); ctx.restore();
      GK.text(ctx, "BALL", 560, 186, 13, "#9FB8FF", "center");
      for (let i = 0; i < 3; i++) { ctx.fillStyle = i < balls ? "#D8DEF4" : "#2A3060"; ctx.beginPath(); ctx.arc(536 + i * 24, 212, 8, 0, 6.283); ctx.fill(); }
      GK.text(ctx, "MULTIPLIER", 560, 262, 13, "#9FB8FF", "center");
      GK.text(ctx, "x" + mult, 560, 294, 28, mult > 1 ? "#6CFF8A" : "#FFFFFF", "center");
      GK.text(ctx, "BEST", 560, 348, 13, "#9FB8FF", "center");
      const b = g.best();
      GK.text(ctx, b == null ? "-" : fmt(b), 560, 376, 18, "#8CF08C", "center");
      if (msgT > 0 && state === "play") {
        const words = msg.split("  ");
        GK.rr(ctx, 490, 420, 140, 30 + words.length * 22, 6); ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fill();
        words.forEach((w, i) => GK.text(ctx, w, 560, 446 + i * 22, 13, "#FFE27A", "center"));
      }
      if (state === "ready") g.banner("Pinball", ["Three balls. Light the top lanes to", "raise the multiplier.", "Press Enter or click to start."]);
      else if (state === "over") g.banner("Game over", ["Score " + fmt(score), "Press Enter or click to play again."]);
    }

    showInfo();
    g.start({ update, draw });
    return { destroy() { g.destroy(); } };
  }
  return { init };
})();
