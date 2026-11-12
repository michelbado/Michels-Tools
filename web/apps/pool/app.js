/* Pool (8-ball) against the computer or a second player on the same screen. Everything runs in the browser.
 * Rules kept simple: pocket your seven balls (plain or striped), then the 8. Potting the 8 early loses. A foul (cue ball potted, nothing hit,
 * or the wrong ball hit first) lets the other player put the cue ball anywhere. */
(window.DesktopApps = window.DesktopApps || {}).pool = (() => {
  const W = 900, H = 560, R = 11, L = 60, T = 60, RT = 840, B = 460, CX = 450, CY = 260;
  const POCKETS = [[L - 4, T - 4, 22], [CX, T - 10, 19], [RT + 4, T - 4, 22], [L - 4, B + 4, 22], [CX, B + 10, 19], [RT + 4, B + 4, 22]];
  const COLORS = ["#FFFFFF", "#F2C21A", "#2456D8", "#D8262A", "#6A2CA8", "#F07A1A", "#1E8A46", "#8A1E26", "#111111"];
  const MAXV = 1500;
  const colorOf = n => COLORS[n > 8 ? n - 8 : n];
  const groupOf = n => n === 0 || n === 8 ? null : n < 8 ? "plain" : "striped";

  function init(root) {
    const GK = window.GameKit, g = GK.create(root, "pool", { W, H, pause: false });
    let balls, cue, turn, groups, phase, shot, aim = 0, mode = "cpu2", names, breakShot, winner = -1, msg = "", msgT = 0, cpuT = 0, cpuPlan = null, downPhase = null, placeOk = true;
    const power = () => Number(g.q("power").value) / 100;
    const human = () => mode === "two" || turn === 0;

    function rack() {
      balls = [{ n: 0, x: 255, y: CY, vx: 0, vy: 0, in: false }];
      cue = balls[0];
      const rest = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      // the two back corners must hold one plain and one striped ball
      const order = [];
      let k = 0;
      for (let row = 0; row < 5; row++) for (let j = 0; j <= row; j++) order.push(row === 2 && j === 1 ? 8 : rest[k++]);
      const a = 10, b = 14;
      if (groupOf(order[a]) === groupOf(order[b])) { const other = order.findIndex((n, i) => i !== a && i !== b && n !== 8 && groupOf(n) !== groupOf(order[a])); [order[b], order[other]] = [order[other], order[b]]; }
      let i = 0;
      for (let row = 0; row < 5; row++) for (let j = 0; j <= row; j++) balls.push({ n: order[i++], x: 630 + row * (R * 2 * 0.866 + 0.6), y: CY + (j - row / 2) * (R * 2 + 0.6), vx: 0, vy: 0, in: false });
    }
    function newGame() {
      mode = g.q("mode").value;
      names = mode === "two" ? ["Player 1", "Player 2"] : ["You", "Computer"];
      rack(); turn = 0; groups = [null, null]; phase = "aim"; breakShot = true; winner = -1; cpuPlan = null; aim = 0;
      say(names[0] + (mode === "two" ? " breaks" : " break"), 2);
      tell();
    }
    function say(t, secs) { msg = t; msgT = secs || 2.5; }
    function tell() {
      const w = g.best("wins");
      g.info(mode === "two" ? "" : "Games won: " + (w || 0));
      if (phase === "over") return;
      const who = names[turn], gr = groups[turn];
      let t = who + (who === "You" ? " are" : " is") + " to play" + (gr ? " the " + gr + " balls" : "") + ". ";
      if (phase === "place") t += human() ? "Foul: put the cue ball anywhere, then click to set it down." : "";
      else if (human()) t += "Move the mouse to aim and click to shoot (touch: drag to aim, then press Shoot). Arrow keys aim finely, Space shoots.";
      g.status(t);
    }
    const onTable = gname => balls.filter(b => !b.in && groupOf(b.n) === gname).length;
    function legalTargets(p) {
      const gr = groups[p];
      if (!gr) return balls.filter(b => !b.in && b.n !== 0 && b.n !== 8);
      const own = balls.filter(b => !b.in && groupOf(b.n) === gr);
      return own.length ? own : balls.filter(b => !b.in && b.n === 8);
    }

    /* ---- shooting and physics ---- */
    function shoot(angle, pw, spin) {
      if (phase !== "aim") return;
      const v = 170 + (MAXV - 170) * GK.clamp(pw, 0.05, 1);
      cue.vx = Math.cos(angle) * v; cue.vy = Math.sin(angle) * v;
      shot = { first: null, potted: [], cueIn: false, spin: spin || 0, dx: Math.cos(angle), dy: Math.sin(angle), wasBreak: breakShot };
      phase = "roll"; breakShot = false; cpuPlan = null;
      g.sfx.noise(0.05, { freq: 2200, vol: 0.2 + pw * 0.3 }); g.sfx.tone(240, 0.05, { vol: 0.1 });
    }
    function nearPocket(b) {
      for (const p of POCKETS) { const dx = b.x - p[0], dy = b.y - p[1]; if (dx * dx + dy * dy < (p[2] + 9) * (p[2] + 9)) return true; }
      return false;
    }
    function stepBalls(h) {
      for (const b of balls) {
        if (b.in) continue;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 0) {
          const ns = sp - (130 + 0.22 * sp) * h;
          if (ns <= 3) { b.vx = b.vy = 0; } else { b.vx *= ns / sp; b.vy *= ns / sp; }
          b.x += b.vx * h; b.y += b.vy * h;
        }
      }
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (a.in) continue;
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          if (b.in) continue;
          const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
          if (d2 >= 4 * R * R || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, push = (2 * R - d) / 2;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel >= 0) continue;
          const before = Math.hypot(a.vx, a.vy);
          const imp = -(1 + 0.95) * rel / 2;
          a.vx -= imp * nx; a.vy -= imp * ny; b.vx += imp * nx; b.vy += imp * ny;
          if (shot && a.n === 0 && shot.first == null) {
            shot.first = b.n;
            if (shot.spin) { a.vx += shot.dx * before * 0.32 * shot.spin; a.vy += shot.dy * before * 0.32 * shot.spin; }
          }
          if (-rel > 40) g.sfx.tone(1500 + Math.random() * 300, 0.03, { type: "triangle", vol: Math.min(0.2, -rel / 3000) });
        }
      }
      for (const b of balls) {
        if (b.in) continue;
        let potted = false;
        for (const p of POCKETS) { const dx = b.x - p[0], dy = b.y - p[1]; if (dx * dx + dy * dy < p[2] * p[2]) { potted = true; break; } }
        if (!potted && (b.x < L - R || b.x > RT + R || b.y < T - R || b.y > B + R)) potted = true;
        if (potted) {
          b.in = true; b.vx = b.vy = 0;
          if (shot) { if (b.n === 0) shot.cueIn = true; else shot.potted.push(b.n); }
          g.sfx.tone(160, 0.18, { to: 60, type: "sine", vol: 0.3 });
          continue;
        }
        if (nearPocket(b)) continue;
        let hit = 0;
        if (b.x < L + R && b.vx < 0) { b.x = L + R; b.vx *= -0.78; hit = Math.abs(b.vx); }
        else if (b.x > RT - R && b.vx > 0) { b.x = RT - R; b.vx *= -0.78; hit = Math.abs(b.vx); }
        if (b.y < T + R && b.vy < 0) { b.y = T + R; b.vy *= -0.78; hit = Math.abs(b.vy); }
        else if (b.y > B - R && b.vy > 0) { b.y = B - R; b.vy *= -0.78; hit = Math.abs(b.vy); }
        if (hit > 60) g.sfx.noise(0.04, { freq: 350, vol: Math.min(0.25, hit / 2500) });
      }
    }
    const moving = () => balls.some(b => !b.in && (b.vx !== 0 || b.vy !== 0));

    function freeSpot(x, y, skip) {
      if (x < L + R || x > RT - R || y < T + R || y > B - R) return false;
      for (const b of balls) { if (b.in || b === skip) continue; if (Math.hypot(b.x - x, b.y - y) < 2 * R + 1) return false; }
      return true;
    }
    function respot(b, x, y) {
      let px = x;
      while (!freeSpot(px, y, b) && px > L + 2 * R) px -= 4;
      b.in = false; b.x = px; b.y = y; b.vx = b.vy = 0;
    }
    function endShot() {
      const s = shot, me = turn, other = 1 - turn, gr = groups[me];
      shot = null;
      const pottedEight = s.potted.includes(8);
      let foul = s.cueIn || s.first == null;
      if (!foul) {
        if (!gr) foul = s.first === 8;
        else if (groupOf(s.first) !== gr) foul = !(s.first === 8 && onTable(gr) === 0 && !s.potted.some(n => groupOf(n) === gr));
      }
      if (pottedEight) {
        if (s.wasBreak) respot(balls.find(b => b.n === 8), 645, CY);
        else {
          const cleared = gr && onTable(gr) === 0 && !s.potted.some(n => groupOf(n) === gr);
          finish(!foul && cleared ? me : other, !foul && cleared ? "The 8 ball is in." : cleared ? "Foul on the 8 ball." : "The 8 ball went in too early.");
          return;
        }
      }
      const others = s.potted.filter(n => n !== 8);
      if (!gr && !foul && !s.wasBreak && others.length) {
        groups[me] = groupOf(others[0]); groups[other] = groups[me] === "plain" ? "striped" : "plain";
        say(names[me] + (names[me] === "You" ? " have" : " has") + " the " + groups[me] + " balls", 2.5);
      }
      const mine = groups[me] ? others.some(n => groupOf(n) === groups[me]) : others.length > 0;
      if (s.cueIn) { cue.in = false; cue.x = 255; cue.y = CY; cue.vx = cue.vy = 0; if (!freeSpot(cue.x, cue.y, cue)) respot(cue, 255, CY); }
      if (foul) {
        turn = other; phase = "place";
        say("Foul" + (s.cueIn ? ": cue ball potted" : s.first == null ? ": no ball hit" : ": wrong ball first"), 2.5);
        g.sfx.tone(140, 0.3, { type: "sawtooth", vol: 0.12 });
        if (!human()) cpuPlace();
      } else {
        if (!mine) turn = other;
        phase = "aim";
      }
      cpuPlan = null; cpuT = 0;
      tell();
    }
    function finish(who, why) {
      winner = who; phase = "over";
      const youWon = mode !== "two" && who === 0;
      if (youWon) g.saveBest((g.best("wins") || 0) + 1, "wins");
      g.sfx.tune(youWon || mode === "two" ? [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.3]] : [[392, 0.15], [330, 0.15], [262, 0.3]], { type: "triangle", vol: 0.14 });
      g.status(why + " " + names[who] + (names[who] === "You" ? " win." : " wins.") + " Press New game to play again.");
      tell();
    }

    /* ---- the computer player ---- */
    function blocked(x1, y1, x2, y2, skipA, skipB) {
      const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
      if (l2 === 0) return false;
      for (const b of balls) {
        if (b.in || b === skipA || b === skipB) continue;
        let t = ((b.x - x1) * dx + (b.y - y1) * dy) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (Math.hypot(b.x - (x1 + t * dx), b.y - (y1 + t * dy)) < 2 * R - 1) return true;
      }
      return false;
    }
    const pocketAim = p => [p[0] + (p[0] < CX - 10 ? 10 : p[0] > CX + 10 ? -10 : 0), p[1] + (p[1] < CY ? 12 : -12)];
    function bestShot(cx, cy) {
      let best = null;
      for (const b of legalTargets(turn)) for (const p of POCKETS) {
        const pa = pocketAim(p), d2 = Math.hypot(pa[0] - b.x, pa[1] - b.y);
        if (d2 < 1) continue;
        const ux = (pa[0] - b.x) / d2, uy = (pa[1] - b.y) / d2, gx = b.x - ux * 2 * R, gy = b.y - uy * 2 * R;
        const d1 = Math.hypot(gx - cx, gy - cy);
        if (d1 < 1) continue;
        const vx = (gx - cx) / d1, vy = (gy - cy) / d1, cos = vx * ux + vy * uy;
        if (cos < 0.3) continue;
        if (blocked(cx, cy, gx, gy, cue, b) || blocked(b.x, b.y, pa[0], pa[1], b, cue)) continue;
        const score = cos * 1.6 - d1 / 1400 - d2 / 1000 + (p[0] !== CX ? 0.1 : 0);
        if (!best || score > best.score) best = { score, angle: Math.atan2(vy, vx), power: GK.clamp(0.3 + (d1 + d2) / 1500 + (1 - cos) * 0.5, 0.3, 0.95), b, ux, uy };
      }
      return best;
    }
    function cpuPlace() {
      let done = false;
      const opts = [];
      for (const b of legalTargets(turn)) for (const p of POCKETS) {
        const pa = pocketAim(p), d = Math.hypot(pa[0] - b.x, pa[1] - b.y);
        if (d < 1 || blocked(b.x, b.y, pa[0], pa[1], b, cue)) continue;
        opts.push({ d, x: b.x - (pa[0] - b.x) / d * 140, y: b.y - (pa[1] - b.y) / d * 140 });
      }
      opts.sort((a, b) => a.d - b.d);
      for (const o of opts) if (freeSpot(o.x, o.y, cue)) { cue.x = o.x; cue.y = o.y; done = true; break; }
      if (!done) for (let i = 0; i < 200 && !done; i++) { const x = GK.rand(L + 30, RT - 30), y = GK.rand(T + 30, B - 30); if (freeSpot(x, y, cue)) { cue.x = x; cue.y = y; done = true; } }
      phase = "aim";
    }
    function cpuThink(dt) {
      if (!cpuPlan) {
        const s = bestShot(cue.x, cue.y), err = mode === "cpu1" ? 0.05 : mode === "cpu3" ? 0.007 : 0.02;
        if (s) cpuPlan = { angle: s.angle + GK.rand(-err, err), power: s.power };
        else {
          const ts = legalTargets(turn).slice().sort((a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y));
          const t = ts.find(b => !blocked(cue.x, cue.y, b.x, b.y, cue, b)) || ts[0];
          cpuPlan = { angle: t ? Math.atan2(t.y - cue.y, t.x - cue.x) + GK.rand(-err, err) : GK.rand(0, 6.283), power: 0.5 };
        }
        if (breakShot) cpuPlan = { angle: GK.rand(-0.02, 0.02), power: 0.95 };
        cpuT = 0;
      }
      cpuT += dt;
      aim += Math.atan2(Math.sin(cpuPlan.angle - aim), Math.cos(cpuPlan.angle - aim)) * Math.min(1, dt * 6);
      if (cpuT > 1.3) { aim = cpuPlan.angle; shoot(cpuPlan.angle, cpuPlan.power, 0); }
    }

    /* ---- input ---- */
    function point(x, y) {
      if (phase === "place" && human()) { const nx = GK.clamp(x, L + R, RT - R), ny = GK.clamp(y, T + R, B - R); placeOk = freeSpot(nx, ny, cue); cue.x = nx; cue.y = ny; }
      else if (phase === "aim" && human()) { if (Math.hypot(x - cue.x, y - cue.y) > 4) aim = Math.atan2(y - cue.y, x - cue.x); }
    }
    g.onDown = (x, y) => { downPhase = phase; point(x, y); };
    g.onMove = (x, y, e) => { if (e.pointerType === "mouse" || e.buttons) point(x, y); };
    g.onUp = (x, y, e) => {
      if (!human() || phase !== downPhase) { downPhase = null; return; }
      downPhase = null;
      if (phase === "place") { placeOk = freeSpot(cue.x, cue.y, cue); if (placeOk) { phase = "aim"; tell(); } else say("Not on top of another ball", 1.5); }
      else if (phase === "aim" && e.pointerType === "mouse" && e.button === 0) shoot(aim, power(), Number(g.q("spin").value));
    };
    g.onKey = code => {
      if (code === "Space" || code === "Enter") { if (phase === "over") newGame(); else if (phase === "aim" && human()) shoot(aim, power(), Number(g.q("spin").value)); }
    };
    g.q("shoot").addEventListener("click", () => { if (phase === "aim" && human()) shoot(aim, power(), Number(g.q("spin").value)); });
    g.q("new").addEventListener("click", newGame);
    g.q("mode").addEventListener("change", newGame);
    g.q("power").addEventListener("change", () => g.q("power").blur());

    function update(dt) {
      msgT = Math.max(0, msgT - dt);
      if (phase === "aim" && human()) {
        const fine = g.keys.has("ShiftLeft") || g.keys.has("ShiftRight") ? 0.15 : 0.9;
        if (g.keys.has("ArrowLeft")) aim -= fine * dt;
        if (g.keys.has("ArrowRight")) aim += fine * dt;
        const p = g.q("power");
        if (g.keys.has("ArrowUp")) p.value = String(Math.min(100, Number(p.value) + 60 * dt + 0.5));
        if (g.keys.has("ArrowDown")) p.value = String(Math.max(5, Number(p.value) - 60 * dt - 0.5));
      }
      if (phase === "aim" && !human()) cpuThink(dt);
      if (phase === "roll") {
        let top = 0;
        for (const b of balls) if (!b.in) top = Math.max(top, Math.abs(b.vx), Math.abs(b.vy));
        const n = Math.max(1, Math.ceil(top * dt / (R * 0.4))), h = dt / n;
        for (let i = 0; i < n; i++) stepBalls(h);
        if (!moving()) endShot();
      }
    }

    /* ---- drawing ---- */
    const table = GK.layer(W, H, 2, x => {
      x.fillStyle = "#1B1410"; x.fillRect(0, 0, W, H);
      const wood = x.createLinearGradient(0, 14, 0, 506);
      wood.addColorStop(0, "#8A5326"); wood.addColorStop(0.5, "#6B3C17"); wood.addColorStop(1, "#4E2A0E");
      GK.rr(x, 14, 14, W - 28, 492, 26); x.fillStyle = wood; x.fill();
      x.strokeStyle = "#2E1806"; x.lineWidth = 3; x.stroke();
      x.strokeStyle = "rgba(255,220,170,0.25)"; x.lineWidth = 2; GK.rr(x, 20, 20, W - 40, 480, 22); x.stroke();
      x.fillStyle = "#0D5A30"; x.fillRect(L - 14, T - 14, RT - L + 28, B - T + 28);
      const cloth = x.createRadialGradient(CX, CY, 40, CX, CY, 520);
      cloth.addColorStop(0, "#22A050"); cloth.addColorStop(0.6, "#178A42"); cloth.addColorStop(1, "#0E6A30");
      x.fillStyle = cloth; x.fillRect(L, T, RT - L, B - T);
      x.strokeStyle = "rgba(0,0,0,0.25)"; x.lineWidth = 2; x.strokeRect(L, T, RT - L, B - T);
      x.strokeStyle = "rgba(255,255,255,0.14)"; x.lineWidth = 1.5; x.beginPath(); x.moveTo(255, T); x.lineTo(255, B); x.stroke();
      x.fillStyle = "rgba(255,255,255,0.3)"; x.beginPath(); x.arc(645, CY, 2.5, 0, 6.283); x.fill();
      for (const p of POCKETS) {
        x.fillStyle = "#2E1806"; x.beginPath(); x.arc(p[0], p[1], p[2] + 5, 0, 6.283); x.fill();
        const pg = x.createRadialGradient(p[0], p[1], 2, p[0], p[1], p[2]);
        pg.addColorStop(0, "#000000"); pg.addColorStop(1, "#15100C");
        x.fillStyle = pg; x.beginPath(); x.arc(p[0], p[1], p[2], 0, 6.283); x.fill();
      }
      x.fillStyle = "#F0E4C8";
      for (let i = 1; i < 8; i++) { if (i === 4) continue; const dx = L + (RT - L) * i / 8; for (const dy of [33, 487]) { x.beginPath(); x.arc(dx, dy, 3, 0, 6.283); x.fill(); } }
      for (let i = 1; i < 4; i++) { const dy = T + (B - T) * i / 4; for (const dx of [33, 867]) { x.beginPath(); x.arc(dx, dy, 3, 0, 6.283); x.fill(); } }
    });
    function drawBall(ctx, n, x, y, r) {
      const c = colorOf(n);
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.clip();
      ctx.fillStyle = n > 8 || n === 0 ? "#FAFAF4" : c; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      if (n > 8) { ctx.fillStyle = c; ctx.fillRect(x - r, y - r * 0.55, 2 * r, r * 1.1); }
      if (n > 0) {
        ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(x, y, r * 0.48, 0, 6.283); ctx.fill();
        GK.text(ctx, String(n), x, y + r * 0.06, r * (n > 9 ? 0.62 : 0.72), "#111", "center");
      }
      const sh = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.1, x, y, r * 1.05);
      sh.addColorStop(0, "rgba(255,255,255,0.55)"); sh.addColorStop(0.35, "rgba(255,255,255,0)"); sh.addColorStop(1, "rgba(0,0,0,0.42)");
      ctx.fillStyle = sh; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      ctx.restore();
    }
    function guide(ctx) {
      const dx = Math.cos(aim), dy = Math.sin(aim);
      let tHit = Infinity, target = null;
      for (const b of balls) {
        if (b.in || b === cue) continue;
        const ox = b.x - cue.x, oy = b.y - cue.y, along = ox * dx + oy * dy;
        if (along <= 0) continue;
        const perp2 = ox * ox + oy * oy - along * along;
        if (perp2 >= 4 * R * R) continue;
        const t = along - Math.sqrt(4 * R * R - perp2);
        if (t < tHit) { tHit = t; target = b; }
      }
      let tWall = Infinity;
      if (dx > 0) tWall = Math.min(tWall, (RT - R - cue.x) / dx); else if (dx < 0) tWall = Math.min(tWall, (L + R - cue.x) / dx);
      if (dy > 0) tWall = Math.min(tWall, (B - R - cue.y) / dy); else if (dy < 0) tWall = Math.min(tWall, (T + R - cue.y) / dy);
      const t = Math.min(tHit, tWall), gx = cue.x + dx * t, gy = cue.y + dy * t;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(cue.x + dx * (R + 2), cue.y + dy * (R + 2)); ctx.lineTo(gx, gy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(gx, gy, R, 0, 6.283); ctx.stroke();
      if (target && tHit <= tWall) {
        const nx = (target.x - gx) / (2 * R), ny = (target.y - gy) / (2 * R);
        ctx.strokeStyle = "rgba(255,226,122,0.8)"; ctx.beginPath(); ctx.moveTo(target.x, target.y); ctx.lineTo(target.x + nx * 70, target.y + ny * 70); ctx.stroke();
        const side = dx * -ny + dy * nx, tx = -ny * Math.sign(side || 1), ty = nx * Math.sign(side || 1);
        ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + tx * 36, gy + ty * 36); ctx.stroke();
      }
      ctx.restore();
      // the cue stick
      const pull = human() ? 10 + power() * 46 : 10 + (cpuPlan ? cpuPlan.power * 46 * Math.min(1, cpuT / 1.1) : 0);
      const sx = cue.x - dx * (R + pull), sy = cue.y - dy * (R + pull);
      ctx.save(); ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(sx + 3, sy + 5); ctx.lineTo(sx - dx * 330 + 3, sy - dy * 330 + 5); ctx.stroke();
      ctx.strokeStyle = "#4A2A12"; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(sx - dx * 200, sy - dy * 200); ctx.lineTo(sx - dx * 330, sy - dy * 330); ctx.stroke();
      ctx.strokeStyle = "#E8C88A"; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(sx - dx * 8, sy - dy * 8); ctx.lineTo(sx - dx * 200, sy - dy * 200); ctx.stroke();
      ctx.strokeStyle = "#3A6EC8"; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - dx * 8, sy - dy * 8); ctx.stroke();
      ctx.restore();
    }
    function tray(ctx, p, x, align) {
      const active = turn === p && phase !== "over", gr = groups[p];
      GK.text(ctx, (active ? "▶ " : "") + names[p], x, 524, 15, active ? "#FFE27A" : "#C8B8A0", align);
      GK.text(ctx, gr ? gr + " balls" : "no group yet", x, 545, 12, "#A89880", align, "normal");
      if (!gr) return;
      const mine = balls.filter(b => b.n !== 0 && groupOf(b.n) === gr);
      mine.sort((a, b) => a.n - b.n);
      mine.forEach((b, i) => {
        const bx = align === "left" ? x + 150 + i * 24 : x - 150 - i * 24;
        if (b.in) drawBall(ctx, b.n, bx, 534, 9); else { ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(bx, 534, 8, 0, 6.283); ctx.stroke(); }
      });
    }
    function draw(ctx) {
      ctx.drawImage(table, 0, 0, W, H);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      for (const b of balls) if (!b.in) { ctx.beginPath(); ctx.arc(b.x + 3, b.y + 4, R, 0, 6.283); ctx.fill(); }
      for (const b of balls) if (!b.in) drawBall(ctx, b.n, b.x, b.y, R);
      if (phase === "place" && human()) { ctx.strokeStyle = placeOk ? "#FFFFFF" : "#FF5A4A"; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(cue.x, cue.y, R + 5, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); }
      if (phase === "aim" && !cue.in) guide(ctx);
      tray(ctx, 0, 30, "left"); tray(ctx, 1, W - 30, "right");
      if (msgT > 0 && phase !== "over") {
        ctx.globalAlpha = Math.min(1, msgT * 2);
        ctx.font = "bold 24px " + GK.FONT;
        const tw = ctx.measureText(msg).width + 40;
        GK.rr(ctx, CX - tw / 2, CY - 22, tw, 44, 10); ctx.fillStyle = "rgba(8,14,34,0.8)"; ctx.fill();
        GK.text(ctx, msg, CX, CY + 1, 24, "#FFE27A", "center");
        ctx.globalAlpha = 1;
      }
      if (phase === "over") g.banner(names[winner] + (names[winner] === "You" ? " win" : " wins"), ["Press Enter or New game to play again."]);
    }

    newGame();
    g.start({ update, draw });
    return { destroy() { g.destroy(); } };
  }
  return { init };
})();
