/* Bird Hunt: birds burst out of the grass at a moment and a place you cannot predict; three shots for each flight.
 * Every picture is drawn by this file. The best score is kept in this browser only. */
(window.DesktopApps = window.DesktopApps || {}).birdhunt = (() => {
  const W = 800, H = 500, GRASS = 372, PER_ROUND = 10, HIT_R = 34;
  const KINDS = [
    { body: "#8A5A2E", wing: "#5E3A1A", head: "#1E7A46", beak: "#F0A020" },
    { body: "#4A6EA8", wing: "#2E4670", head: "#22304E", beak: "#F0C030" },
    { body: "#B8402E", wing: "#7A2418", head: "#3A1A14", beak: "#F0D060" },
  ];
  const fmt = n => Math.round(n).toLocaleString("en-US");

  function init(root) {
    const GK = window.GameKit, g = GK.create(root, "birdhunt", { W, H });
    let state = "ready", round = 1, score = 0, shots = 3, marks = [], birdNo = 0, phase = "wait", phaseT = 0, birds = [], parts = [], flash = 0, perfect = false;
    let mx = W / 2, my = H / 2, showCross = false, clouds = [{ x: 120, y: 70, s: 1 }, { x: 430, y: 110, s: 0.7 }, { x: 690, y: 55, s: 1.2 }];

    const need = () => Math.min(9, 5 + round);
    const perFlight = () => (round >= 3 ? 2 : 1);
    const birdSpeed = () => Math.min(540, 190 + round * 30);
    function showInfo() { const b = g.best(); g.info("Score " + fmt(score) + "   Round " + round + (b != null ? "   Best " + fmt(b) : "")); }

    function newGame() {
      state = "play"; g.playing = true; g.setPaused(false);
      round = 1; score = 0; startRound(); showInfo();
      g.status("Birds burst out of the grass without warning. Click (or tap) to shoot: three shots for each flight.");
    }
    function startRound() { marks = new Array(PER_ROUND).fill(0); birdNo = 0; birds = []; nextFlight(); }
    function nextFlight() { phase = "wait"; phaseT = GK.rand(0.7, 2.8); shots = 3; birds = []; }
    function release() {
      const n = Math.min(perFlight(), PER_ROUND - birdNo);
      for (let i = 0; i < n; i++) {
        const a = GK.rand(-2.5, -0.64), sp = birdSpeed() * GK.rand(0.9, 1.1);
        birds.push({ x: GK.rand(110, W - 110), y: GRASS + 24, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, sp, st: "fly", t: 0, turn: GK.rand(0.5, 1.2), flap: Math.random() * 6, rot: 0, kind: KINDS[Math.floor(Math.random() * KINDS.length)], idx: birdNo++ });
      }
      phase = "fly"; phaseT = Math.max(3.6, 6 - round * 0.25);
      g.sfx.tune([[620, 0.07], [520, 0.09]], { type: "square", vol: 0.08 });
    }
    function fire(x, y) {
      if (state !== "play" || phase !== "fly" || shots <= 0) return;
      shots--; flash = 0.07;
      g.sfx.noise(0.22, { freq: 2600, to: 200, vol: 0.5 }); g.sfx.tone(120, 0.12, { to: 50, type: "sawtooth", vol: 0.2 });
      let best = null, bd = HIT_R;
      for (const b of birds) { if (b.st !== "fly") continue; const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } }
      if (best) {
        best.st = "hit"; best.t = 0; marks[best.idx] = 1;
        const pts = (400 + round * 100) * (bd < 12 ? 2 : 1);
        score += pts; showInfo();
        parts.push({ text: (bd < 12 ? "Bullseye  " : "") + "+" + pts, x: best.x, y: best.y - 30, vx: 0, vy: -40, life: 1 });
        for (let i = 0; i < 14; i++) parts.push({ x: best.x, y: best.y, vx: GK.rand(-140, 140), vy: GK.rand(-160, 60), life: GK.rand(0.5, 1.1), c: i % 2 ? best.kind.body : "#FFFFFF", feather: true, rot: Math.random() * 6 });
        g.sfx.tone(900, 0.12, { to: 300, type: "square", vol: 0.12, at: 0.05 });
      }
      if (shots === 0) for (const b of birds) if (b.st === "fly") b.t = Math.max(b.t, phaseT - 0.5);
    }
    g.onDown = (x, y) => { if (state !== "play") { newGame(); return; } mx = x; my = y; fire(x, y); };
    g.onMove = (x, y, e) => { mx = x; my = y; showCross = e.pointerType === "mouse"; };
    g.onKey = code => { if (state !== "play") { if (code === "Enter" || code === "Space") newGame(); } else if (code === "Space") fire(mx, my); };
    g.q("new").addEventListener("click", newGame);

    function update(dt) {
      flash = Math.max(0, flash - dt);
      for (const c of clouds) { c.x += 6 * c.s * dt; if (c.x > W + 120) c.x = -120; }
      for (const p of parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.feather) { p.vy += 220 * dt; p.vx *= 0.97; p.rot += 4 * dt; } }
      if (parts.length) parts = parts.filter(p => p.life > 0);
      if (state !== "play") return;
      if (phase === "wait") { phaseT -= dt; if (phaseT <= 0) release(); return; }
      if (phase === "roundend") {
        phaseT -= dt;
        if (phaseT <= 0) {
          const hits = marks.filter(m => m === 1).length;
          if (hits >= need()) { round++; startRound(); showInfo(); }
          else { state = "over"; g.playing = false; const rec = g.saveBest(score); g.status(rec && score > 0 ? "Game over. New best score: " + fmt(score) + "." : "Game over. Score " + fmt(score) + "."); g.sfx.tune([[392, 0.15], [330, 0.15], [262, 0.15], [196, 0.3]], { type: "triangle", vol: 0.13 }); showInfo(); }
        }
        return;
      }
      // birds in the air
      let busy = false;
      for (const b of birds) {
        b.t += dt; b.flap += dt * 16;
        if (b.st === "fly") {
          busy = true;
          b.turn -= dt;
          if (b.turn <= 0) { const a = GK.rand(-Math.PI, Math.PI); b.vx = Math.cos(a) * b.sp; b.vy = Math.sin(a) * b.sp * 0.8; b.turn = GK.rand(0.5, 1.3); }
          b.x += b.vx * dt; b.y += b.vy * dt;
          if (b.x < 36) { b.x = 36; b.vx = Math.abs(b.vx); } else if (b.x > W - 36) { b.x = W - 36; b.vx = -Math.abs(b.vx); }
          if (b.y < 34) { b.y = 34; b.vy = Math.abs(b.vy); } else if (b.y > GRASS - 46 && b.t > 0.5) { b.y = GRASS - 46; b.vy = -Math.abs(b.vy); }
          if (b.t > phaseT) { b.st = "away"; b.vx *= 0.3; b.vy = -b.sp * 1.5; marks[b.idx] = 2; }
        } else if (b.st === "hit") {
          busy = true;
          if (b.t > 0.32) { b.st = "fall"; b.vx = 0; b.vy = 60; }
        } else if (b.st === "fall") {
          busy = true;
          b.vy += 900 * dt; b.y += b.vy * dt; b.rot += 9 * dt;
          if (b.y > GRASS + 30) { b.st = "gone"; g.sfx.noise(0.08, { freq: 260, vol: 0.3 }); }
        } else if (b.st === "away") {
          busy = true;
          b.x += b.vx * dt; b.y += b.vy * dt;
          if (b.y < -50) b.st = "gone";
        }
      }
      if (!busy) {
        if (birdNo >= PER_ROUND) {
          const hits = marks.filter(m => m === 1).length;
          perfect = hits === PER_ROUND;
          if (perfect) { score += 5000; showInfo(); }
          phase = "roundend"; phaseT = 3;
          if (hits >= need()) g.sfx.tune([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.25]], { type: "triangle", vol: 0.13 });
        } else nextFlight();
      }
    }

    /* ---- drawing ---- */
    const scene = GK.layer(W, H, 2, x => {
      const s = x.createLinearGradient(0, 0, 0, GRASS + 20);
      s.addColorStop(0, "#3E9AE0"); s.addColorStop(0.7, "#A8DCF6"); s.addColorStop(1, "#E4F6FC");
      x.fillStyle = s; x.fillRect(0, 0, W, H);
      const sun = x.createRadialGradient(660, 90, 10, 660, 90, 120);
      sun.addColorStop(0, "rgba(255,250,210,1)"); sun.addColorStop(0.25, "rgba(255,240,170,0.9)"); sun.addColorStop(1, "rgba(255,240,170,0)");
      x.fillStyle = sun; x.fillRect(520, -40, 280, 260);
      x.fillStyle = "#8FC8A0"; x.beginPath(); x.moveTo(0, 330); x.bezierCurveTo(140, 250, 260, 300, 380, 320); x.bezierCurveTo(520, 270, 660, 280, 800, 318); x.lineTo(800, 400); x.lineTo(0, 400); x.closePath(); x.fill();
      x.fillStyle = "#6FB582"; x.beginPath(); x.moveTo(0, 360); x.bezierCurveTo(180, 310, 320, 350, 470, 350); x.bezierCurveTo(600, 320, 720, 340, 800, 350); x.lineTo(800, 400); x.lineTo(0, 400); x.closePath(); x.fill();
      // a big tree
      x.fillStyle = "#5A3A1E"; x.beginPath(); x.moveTo(96, 390); x.lineTo(108, 230); x.lineTo(86, 170); x.lineTo(104, 176); x.lineTo(116, 214); x.lineTo(128, 160); x.lineTo(142, 166); x.lineTo(134, 236); x.lineTo(150, 390); x.closePath(); x.fill();
      for (const b of [[120, 130, 70, "#2E8A3E"], [70, 160, 46, "#267836"], [172, 162, 48, "#236E32"], [120, 92, 48, "#3A9E4A"], [96, 118, 30, "#48B058"]]) { x.fillStyle = b[3]; x.beginPath(); x.arc(b[0], b[1], b[2], 0, 6.283); x.fill(); }
      for (const b of [[610, 356, 34, "#2E8A3E"], [650, 348, 40, "#267836"], [694, 360, 30, "#2E8A3E"]]) { x.fillStyle = b[3]; x.beginPath(); x.arc(b[0], b[1], b[2], 0, 6.283); x.fill(); }
    });
    const grass = GK.layer(W, H - GRASS + 30, 2, x => {
      let seed = 3;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const gr = x.createLinearGradient(0, 20, 0, 158);
      gr.addColorStop(0, "#3E9A3E"); gr.addColorStop(1, "#1E5A22");
      x.fillStyle = gr; x.fillRect(0, 30, W, 130);
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 150; i++) {
        const bx = rnd() * W, bh = 16 + rnd() * 26, lean = (rnd() - 0.5) * 14, by = 34 + pass * 6;
        x.fillStyle = pass ? "#4CB04C" : "#2E8A32";
        x.beginPath(); x.moveTo(bx - 5, by); x.lineTo(bx + lean, by - bh); x.lineTo(bx + 5, by); x.closePath(); x.fill();
      }
      x.fillStyle = "rgba(10, 30, 14, 0.55)"; GK.rr(x, 14, 78, W - 28, 66, 10); x.fill();
      x.strokeStyle = "rgba(255,255,255,0.35)"; x.lineWidth = 1.5; x.stroke();
    });
    function drawBird(ctx, b) {
      ctx.save();
      ctx.translate(b.x, b.y);
      const facing = b.vx < 0 ? -1 : 1;
      if (b.st === "fall") ctx.rotate(b.rot); else if (b.st === "fly" || b.st === "away") ctx.rotate(GK.clamp(Math.atan2(b.vy, Math.abs(b.vx)) * 0.45, -0.6, 0.6) * facing);
      ctx.scale(facing, 1);
      const k = b.kind, shocked = b.st === "hit", w = shocked ? -1 : Math.sin(b.flap);
      ctx.fillStyle = k.wing; ctx.beginPath(); ctx.moveTo(-26, -2); ctx.lineTo(-42, -8); ctx.lineTo(-40, 6); ctx.closePath(); ctx.fill();   // tail
      ctx.fillStyle = k.wing; ctx.beginPath(); ctx.moveTo(-10, -4); ctx.quadraticCurveTo(-6, -8 - w * 34, 12, -6 - w * 40); ctx.quadraticCurveTo(8, -10 - w * 14, 12, -4); ctx.closePath(); ctx.fill();   // far wing
      ctx.fillStyle = k.body; ctx.beginPath(); ctx.ellipse(-4, 0, 25, 14, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.28)"; ctx.beginPath(); ctx.ellipse(-2, 6, 18, 6, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = "#F4F4F4"; ctx.fillRect(15, -9, 5, 14);   // collar
      ctx.fillStyle = k.head; ctx.beginPath(); ctx.arc(27, -8, 11, 0, 6.283); ctx.fill();
      ctx.fillStyle = k.beak; ctx.beginPath(); ctx.moveTo(36, -11); ctx.lineTo(52, -7); ctx.lineTo(36, -3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(30, -11, shocked ? 4.4 : 3.2, 0, 6.283); ctx.fill();
      ctx.fillStyle = "#000000"; ctx.beginPath(); ctx.arc(31, -11, 1.5, 0, 6.283); ctx.fill();
      ctx.fillStyle = k.wing; ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-16, -2); ctx.quadraticCurveTo(-12, -6 - w * 38, 6, -4 - w * 46); ctx.quadraticCurveTo(4, -8 - w * 14, 10, 0); ctx.closePath(); ctx.fill(); ctx.stroke();   // near wing
      ctx.restore();
    }
    function cloud(ctx, c) {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (const p of [[0, 0, 26], [28, -10, 30], [58, 0, 24], [26, 8, 28]]) { ctx.beginPath(); ctx.arc(c.x + p[0] * c.s, c.y + p[1] * c.s, p[2] * c.s, 0, 6.283); ctx.fill(); }
    }
    function draw(ctx) {
      ctx.drawImage(scene, 0, 0, W, H);
      for (const c of clouds) cloud(ctx, c);
      for (const b of birds) if (b.st !== "gone") drawBird(ctx, b);
      for (const p of parts) {
        ctx.globalAlpha = Math.min(1, p.life * 2);
        if (p.text) GK.text(ctx, p.text, p.x, p.y, 18, "#FFFFFF", "center");
        else { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.beginPath(); ctx.ellipse(0, 0, 7, 2.6, 0, 0, 6.283); ctx.fill(); ctx.restore(); }
      }
      ctx.globalAlpha = 1;
      ctx.drawImage(grass, 0, GRASS - 30, W, H - GRASS + 30);
      // the board in the grass: shots, birds of this round, score
      const hy = GRASS + 81;
      GK.text(ctx, "SHOTS", 34, hy - 14, 11, "#CFE8CF", "left");
      for (let i = 0; i < 3; i++) { ctx.fillStyle = i < shots ? "#F0C030" : "rgba(255,255,255,0.15)"; GK.rr(ctx, 34 + i * 18, hy - 2, 11, 24, 3); ctx.fill(); if (i < shots) { ctx.fillStyle = "#C8202A"; ctx.fillRect(34 + i * 18, hy + 12, 11, 10); } }
      GK.text(ctx, "ROUND " + round + "   NEED " + need() + " OF " + PER_ROUND, W / 2, hy - 14, 11, "#CFE8CF", "center");
      for (let i = 0; i < PER_ROUND; i++) {
        const bx = W / 2 - (PER_ROUND - 1) * 13 + i * 26, m = marks[i];
        ctx.fillStyle = m === 1 ? "#F04A3A" : m === 2 ? "rgba(255,255,255,0.18)" : "#F4F4F4";
        ctx.beginPath(); ctx.ellipse(bx - 2, hy + 10, 9, 6, 0, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.arc(bx + 7, hy + 6, 4.4, 0, 6.283); ctx.fill();
        if (i === need() - 1) { ctx.fillStyle = "#FFE27A"; ctx.fillRect(bx + 12.5, hy - 2, 2, 24); }
      }
      GK.text(ctx, "SCORE", W - 34, hy - 14, 11, "#CFE8CF", "right");
      GK.text(ctx, fmt(score), W - 34, hy + 10, 22, "#FFFFFF", "right");
      if (showCross && state === "play") {
        ctx.strokeStyle = "#C8202A"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(mx, my, 14, 0, 6.283); ctx.moveTo(mx - 22, my); ctx.lineTo(mx - 6, my); ctx.moveTo(mx + 6, my); ctx.lineTo(mx + 22, my); ctx.moveTo(mx, my - 22); ctx.lineTo(mx, my - 6); ctx.moveTo(mx, my + 6); ctx.lineTo(mx, my + 22); ctx.stroke();
      }
      if (flash > 0) { ctx.fillStyle = "rgba(255,255,255," + (flash * 5) + ")"; ctx.fillRect(0, 0, W, H); }
      if (state === "ready") g.banner("Bird Hunt", ["Birds burst out of the grass without warning.", "Three shots for each flight.", "Press Enter or click to start."]);
      else if (state === "over") g.banner("Game over", ["Score " + fmt(score) + "   reached round " + round, "Press Enter or click to play again."]);
      else if (phase === "roundend") {
        const hits = marks.filter(m => m === 1).length, ok = hits >= need();
        g.banner(ok ? (perfect ? "Perfect round!  +5,000" : "Round " + round + " cleared") : "Not enough birds", [hits + " of " + PER_ROUND + " hit, " + need() + " needed.", ok ? "Next round: faster birds." : ""]);
      }
    }

    showInfo();
    g.start({ update, draw });
    return { destroy() { g.destroy(); } };
  }
  return { init };
})();
