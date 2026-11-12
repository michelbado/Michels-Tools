/* Road Racer: an arcade-style road drawn strip by strip from the horizon ("pseudo-3D": no 3D library, just perspective maths).
 * Everything, including the cars and trees, is drawn by this file. The best distance is kept in this browser only. */
(window.DesktopApps = window.DesktopApps || {}).racer = (() => {
  const W = 800, H = 500, SEGL = 200, RUMBLE = 3, ROADW = 2000, LANES = 3, CAMH = 1000, DRAW = 170;
  const CAMD = 1 / Math.tan((100 / 2) * Math.PI / 180), PLAYERZ = CAMH * CAMD;
  const MAXS = SEGL * 60, ACCEL = MAXS / 5, BRAKE = -MAXS, DECEL = -MAXS / 5, OFFDECEL = -MAXS / 2, OFFLIMIT = MAXS / 4, CENT = 0.3;
  const FOG = "#F0A868", TOPKMH = 290;
  const easeIn = (a, b, p) => a + (b - a) * p * p;
  const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
  const lerp = (a, b, p) => a + (b - a) * p;

  function init(root) {
    const GK = window.GameKit, g = GK.create(root, "racer", { W, H });

    /* ---- pictures, drawn once ---- */
    function carPic(body, dark, van) {
      return GK.layer(160, van ? 150 : 110, 2, x => {
        const h = van ? 150 : 110, top = van ? 8 : 26;
        x.fillStyle = "rgba(0,0,0,0.35)"; x.beginPath(); x.ellipse(80, h - 6, 76, 8, 0, 0, 6.283); x.fill();
        x.fillStyle = "#15151A"; GK.rr(x, 8, h - 40, 30, 36, 6); x.fill(); GK.rr(x, 122, h - 40, 30, 36, 6); x.fill();
        x.fillStyle = body; GK.rr(x, 6, h - 68, 148, 52, 12); x.fill();
        x.fillStyle = dark; GK.rr(x, 6, h - 34, 148, 18, 8); x.fill();
        x.fillStyle = body; GK.rr(x, 26, top, 108, h - 60 - top + 8, 16); x.fill();
        x.fillStyle = "#18243A"; GK.rr(x, 36, top + 8, 88, van ? 46 : 26, 8); x.fill();
        x.fillStyle = "rgba(255,255,255,0.25)"; x.beginPath(); x.moveTo(44, top + 10); x.lineTo(70, top + 10); x.lineTo(56, top + (van ? 50 : 32)); x.lineTo(40, top + (van ? 50 : 32)); x.closePath(); x.fill();
        x.fillStyle = "#FF3A2A"; GK.rr(x, 12, h - 62, 34, 12, 4); x.fill(); GK.rr(x, 114, h - 62, 34, 12, 4); x.fill();
        x.fillStyle = "#FFD86B"; x.fillRect(14, h - 60, 8, 8); x.fillRect(138, h - 60, 8, 8);
        x.fillStyle = "#F4F4F4"; GK.rr(x, 60, h - 44, 40, 14, 2); x.fill();
        x.fillStyle = "rgba(255,255,255,0.22)"; GK.rr(x, 10, h - 66, 140, 6, 3); x.fill();
      });
    }
    const PLAYER = carPic("#E0262E", "#8E1218");
    const CARS = [carPic("#2F6BE0", "#1B3F8A"), carPic("#F2C230", "#9A7A10"), carPic("#F4F4F4", "#9AA0A8"), carPic("#2FB060", "#176A36"), carPic("#8A4AD8", "#4E2488"), carPic("#F4F4F4", "#7A808A", true)];
    const pine = GK.layer(120, 220, 2, x => {
      x.fillStyle = "#5A3A1E"; x.fillRect(52, 160, 16, 60);
      for (let i = 0; i < 4; i++) {
        const y = 10 + i * 42, w = 34 + i * 20;
        x.fillStyle = "#1E6A34"; x.beginPath(); x.moveTo(60, y); x.lineTo(60 + w, y + 70); x.lineTo(60 - w, y + 70); x.closePath(); x.fill();
        x.fillStyle = "#17522A"; x.beginPath(); x.moveTo(60, y); x.lineTo(60 + w, y + 70); x.lineTo(60, y + 70); x.closePath(); x.fill();
      }
    });
    const leafy = GK.layer(160, 200, 2, x => {
      x.fillStyle = "#5A3A1E"; x.fillRect(70, 110, 20, 90);
      const blobs = [[80, 70, 62, "#2E8A3E"], [44, 90, 40, "#267836"], [116, 92, 42, "#236E32"], [80, 46, 44, "#3A9E4A"], [60, 60, 26, "#48B058"]];
      for (const b of blobs) { x.fillStyle = b[3]; x.beginPath(); x.arc(b[0], b[1], b[2], 0, 6.283); x.fill(); }
    });
    const palm = GK.layer(180, 260, 2, x => {
      x.strokeStyle = "#7A5630"; x.lineWidth = 14; x.lineCap = "round"; x.beginPath(); x.moveTo(84, 258); x.quadraticCurveTo(70, 150, 96, 70); x.stroke();
      x.strokeStyle = "#1F7A3A"; x.lineWidth = 10;
      for (const p of [[10, 90], [30, 30], [96, 6], [160, 34], [176, 96], [60, 120], [140, 124]]) { x.beginPath(); x.moveTo(96, 70); x.quadraticCurveTo((96 + p[0]) / 2, Math.min(70, p[1]) - 30, p[0], p[1]); x.stroke(); }
    });
    const bush = GK.layer(120, 70, 2, x => {
      for (const b of [[30, 46, 26, "#236E32"], [62, 36, 32, "#2E8A3E"], [92, 48, 24, "#267836"]]) { x.fillStyle = b[3]; x.beginPath(); x.arc(b[0], b[1], b[2], 0, 6.283); x.fill(); }
      x.fillStyle = "#236E32"; x.fillRect(8, 50, 104, 20);
    });
    const rock = GK.layer(110, 70, 2, x => {
      x.fillStyle = "#7C7F8A"; x.beginPath(); x.moveTo(6, 68); x.lineTo(20, 26); x.lineTo(52, 6); x.lineTo(88, 22); x.lineTo(106, 68); x.closePath(); x.fill();
      x.fillStyle = "#9FA3AE"; x.beginPath(); x.moveTo(20, 26); x.lineTo(52, 6); x.lineTo(60, 40); x.lineTo(30, 52); x.closePath(); x.fill();
    });
    const board = GK.layer(240, 190, 2, x => {
      x.fillStyle = "#4A4E5A"; x.fillRect(40, 110, 12, 80); x.fillRect(188, 110, 12, 80);
      x.fillStyle = "#10224A"; GK.rr(x, 4, 4, 232, 116, 8); x.fill();
      x.strokeStyle = "#FFD86B"; x.lineWidth = 5; GK.rr(x, 10, 10, 220, 104, 6); x.stroke();
      GK.text(x, "MICHEL'S", 120, 46, 30, "#FFFFFF", "center");
      GK.text(x, "TOOLS", 120, 84, 30, "#FFD86B", "center");
    });
    const gate = GK.layer(520, 260, 2, x => {
      x.fillStyle = "#D8DCE8"; x.fillRect(6, 40, 18, 220); x.fillRect(496, 40, 18, 220);
      x.fillStyle = "#C8202A"; GK.rr(x, 0, 10, 520, 62, 8); x.fill();
      x.fillStyle = "#FFFFFF";
      for (let i = 0; i < 26; i++) if (i % 2 === 0) x.fillRect(i * 20, 60, 20, 12);
      GK.text(x, "CHECKPOINT", 260, 38, 34, "#FFFFFF", "center");
    });
    const SIDE = [{ img: pine, ww: 1.0, hit: 0.2 }, { img: leafy, ww: 1.2, hit: 0.2 }, { img: palm, ww: 1.1, hit: 0.15 }, { img: bush, ww: 0.7, hit: 0.5 }, { img: rock, ww: 0.6, hit: 0.5 }, { img: board, ww: 1.6, hit: 1.2 }];
    const GATE = { img: gate, ww: 3.1, hit: 0 };

    const sky = GK.layer(W, H, 2, x => {
      const s = x.createLinearGradient(0, 0, 0, H * 0.56);
      s.addColorStop(0, "#150F3C"); s.addColorStop(0.4, "#5A2578"); s.addColorStop(0.75, "#E0563C"); s.addColorStop(1, "#FFC870");
      x.fillStyle = s; x.fillRect(0, 0, W, H * 0.56);
      x.fillStyle = FOG; x.fillRect(0, H * 0.56, W, H);
      let seed = 11;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 90; i++) { x.fillStyle = "rgba(255,255,255," + (0.3 + rnd() * 0.6) + ")"; x.beginPath(); x.arc(rnd() * W, rnd() * H * 0.28, rnd() * 1.2 + 0.2, 0, 6.283); x.fill(); }
      // a striped evening sun
      const cx = W * 0.64, cy = H * 0.37, r = 78;
      const halo = x.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 2.4);
      halo.addColorStop(0, "rgba(255,210,120,0.55)"); halo.addColorStop(1, "rgba(255,210,120,0)");
      x.fillStyle = halo; x.fillRect(cx - r * 3, cy - r * 3, r * 6, r * 6);
      x.save(); x.beginPath(); x.arc(cx, cy, r, 0, 6.283); x.clip();
      const sg = x.createLinearGradient(0, cy - r, 0, cy + r);
      sg.addColorStop(0, "#FFF2A0"); sg.addColorStop(0.55, "#FFB040"); sg.addColorStop(1, "#FF4A6A");
      x.fillStyle = sg; x.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      x.fillStyle = "#C8483C";
      for (let i = 0; i < 6; i++) x.fillRect(cx - r, cy + 6 + i * 13, 2 * r, 2 + i * 1.3);
      x.restore();
    });
    function ridge(w, h, color, bumps, seed) {
      return GK.layer(w, h, 1, x => {
        const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        const pts = [];
        for (let i = 0; i <= bumps; i++) pts.push(h * (0.15 + rnd() * 0.7));
        pts[bumps] = pts[0];
        x.fillStyle = color; x.beginPath(); x.moveTo(0, h);
        for (let i = 0; i <= bumps; i++) x.lineTo(i * w / bumps, pts[i]);
        x.lineTo(w, h); x.closePath(); x.fill();
      });
    }
    const farHills = ridge(1600, 150, "#4A2A6E", 16, 5), nearHills = ridge(1600, 110, "#2E3A5A", 26, 9);

    /* ---- the track ---- */
    const segs = [];
    const lastY = () => segs.length ? segs[segs.length - 1].p2.y : 0;
    function addSeg(curve, y) {
      const n = segs.length;
      segs.push({ index: n, curve, sprites: [], cars: [], dark: Math.floor(n / RUMBLE) % 2 === 1, clip: 0,
        p1: { y: lastY(), z: n * SEGL, sx: 0, sy: 0, sw: 0, sc: 0, cz: 0 }, p2: { y, z: (n + 1) * SEGL, sx: 0, sy: 0, sw: 0, sc: 0, cz: 0 } });
    }
    function road(enter, hold, leave, curve, hill) {
      const y0 = lastY(), y1 = y0 + hill * SEGL, total = enter + hold + leave;
      for (let n = 0; n < enter; n++) addSeg(easeIn(0, curve, n / enter), easeInOut(y0, y1, n / total));
      for (let n = 0; n < hold; n++) addSeg(curve, easeInOut(y0, y1, (enter + n) / total));
      for (let n = 0; n < leave; n++) addSeg(easeInOut(curve, 0, n / leave), easeInOut(y0, y1, (enter + hold + n) / total));
    }
    road(40, 40, 40, 0, 0);
    road(50, 50, 50, 2, 20); road(50, 50, 50, -2, -20);
    road(40, 60, 40, 0, 50); road(50, 80, 50, 4, -30);
    road(30, 30, 30, -3, 15); road(30, 30, 30, 3, -15); road(30, 30, 30, -4, 10); road(30, 30, 30, 4, -10);
    road(50, 100, 50, 0, 40); road(60, 80, 60, -5, -50);
    for (let i = 0; i < 4; i++) { road(15, 15, 15, 0, 12); road(15, 15, 15, 0, -12); }
    road(50, 70, 50, 6, 0); road(40, 40, 40, 0, 30); road(50, 90, 50, -3, 20);
    road(40, 50, 40, 5, -40); road(40, 50, 40, -6, 20); road(60, 60, 60, 2, 0);
    road(50, 50, 50, 0, -lastY() / SEGL);
    while (segs.length % 4) addSeg(0, lastY());
    const N = segs.length, TRACK = N * SEGL, QUARTER = N / 4;
    {
      let seed = 23;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let n = 8; n < N; n += 1 + Math.floor(rnd() * 5)) {
        const side = rnd() < 0.5 ? -1 : 1, r = rnd();
        const kind = r < 0.36 ? 0 : r < 0.6 ? 1 : r < 0.74 ? 2 : r < 0.88 ? 3 : r < 0.97 ? 4 : 5;
        segs[n].sprites.push({ s: SIDE[kind], offset: side * (1.35 + SIDE[kind].ww / 2 + rnd() * (kind === 5 ? 0.3 : 4)) });
      }
      for (let q = 0; q < 4; q++) segs[q * QUARTER].sprites.push({ s: GATE, offset: 0 });
    }
    const findSeg = z => segs[Math.floor(z / SEGL) % N];

    /* ---- game state ---- */
    let state = "ready", position = 0, speed = 0, playerX = 0, timeLeft = 0, dist = 0, bgOff = 0, lastQ = 0, lap = 0, msg = "", msgT = 0, bump = 0, steer = 0, eng = null;
    let cars = [];
    function resetCars() {
      for (const s of segs) s.cars.length = 0;
      cars = [];
      for (let i = 0; i < 46; i++) {
        const z = (20 + Math.random() * (N - 30)) * SEGL, kind = Math.floor(Math.random() * CARS.length);
        const car = { z, offset: [-0.67, 0, 0.67][Math.floor(Math.random() * 3)] + GK.rand(-0.08, 0.08), speed: MAXS * GK.rand(0.22, 0.55), img: CARS[kind], ww: kind === 5 ? 0.36 : 0.3, percent: 0 };
        cars.push(car); findSeg(z).cars.push(car);
      }
    }
    function showInfo() { const b = g.best(); g.info("Distance " + (dist / 1000).toFixed(1) + " km" + (b != null ? "   Best " + (b / 1000).toFixed(1) + " km" : "")); }
    function newRace() {
      state = "play"; g.playing = true; g.setPaused(false);
      position = 0; speed = 0; playerX = 0; timeLeft = 34; dist = 0; lastQ = 0; lap = 0; msg = "GO!"; msgT = 1.5;
      resetCars(); showInfo();
      g.status("Up arrow: gas. Down: brake. Left and Right: steer. Reach each checkpoint before the clock runs out.");
      g.sfx.tune([[440, 0.25], [0, 0.1], [440, 0.25], [0, 0.1], [880, 0.5]], { type: "square", vol: 0.1 });
    }
    function stopEngine() { if (eng) { try { eng.osc.stop(); } catch (e) { /* already stopped */ } eng = null; } }
    function engine() {
      const s = g.sfx, want = s.on && s.ac && state === "play";
      if (!want) { stopEngine(); return; }
      if (!eng) {
        try {
          const osc = s.ac.createOscillator(), f = s.ac.createBiquadFilter(), gn = s.ac.createGain();
          osc.type = "sawtooth"; f.type = "lowpass"; f.frequency.value = 700; gn.gain.value = 0.045;
          osc.connect(f); f.connect(gn); gn.connect(s.out); osc.start();
          eng = { osc };
        } catch (e) { return; }
      }
      eng.osc.frequency.setTargetAtTime(55 + 170 * speed / MAXS, s.ac.currentTime, 0.06);
    }
    g.onPause = p => { if (p) stopEngine(); };
    g.onSound = on => { if (!on) stopEngine(); };
    g.onKey = code => { if (state !== "play" && (code === "Enter" || code === "Space")) newRace(); };
    g.onDown = () => { if (state !== "play") newRace(); };
    g.q("new").addEventListener("click", newRace);

    const overlap = (x1, w1, x2, w2) => Math.abs(x1 - x2) < (w1 + w2) / 2;
    function update(dt) {
      msgT = Math.max(0, msgT - dt); bump = Math.max(0, bump - dt);
      const pseg = findSeg(position + PLAYERZ), sp = speed / MAXS, dx = dt * 2 * sp;
      // traffic
      for (const car of cars) {
        const old = findSeg(car.z);
        car.z = (car.z + dt * car.speed) % TRACK;
        car.percent = (car.z % SEGL) / SEGL;
        const now = findSeg(car.z);
        if (old !== now) { old.cars.splice(old.cars.indexOf(car), 1); now.cars.push(car); }
      }
      position = (position + dt * speed) % TRACK;
      const playing = state === "play";
      const left = playing && (g.keys.has("ArrowLeft") || g.keys.has("KeyA")), right = playing && (g.keys.has("ArrowRight") || g.keys.has("KeyD"));
      const gas = playing && (g.keys.has("ArrowUp") || g.keys.has("KeyW")), brake = playing && (g.keys.has("ArrowDown") || g.keys.has("KeyS"));
      steer += ((left ? -1 : 0) + (right ? 1 : 0) - steer) * Math.min(1, dt * 10);
      if (left) playerX -= dx; else if (right) playerX += dx;
      playerX -= dx * sp * pseg.curve * CENT;
      speed += (gas ? ACCEL : brake ? BRAKE : DECEL) * dt;
      if (Math.abs(playerX) > 1) {
        if (speed > OFFLIMIT) speed += OFFDECEL * dt;
        for (const s of pseg.sprites) {
          if (s.s.hit && overlap(playerX, 0.3, s.offset, s.s.hit)) { speed = MAXS / 6; position = (pseg.p1.z - PLAYERZ + TRACK) % TRACK; crash(); break; }
        }
      }
      for (const car of pseg.cars) {
        if (speed > car.speed && overlap(playerX, 0.3, car.offset, car.ww * 0.9)) {
          speed = car.speed * (car.speed / speed); position = (car.z - PLAYERZ + TRACK) % TRACK; crash(); break;
        }
      }
      playerX = GK.clamp(playerX, -2.6, 2.6);
      speed = GK.clamp(speed, 0, MAXS);
      bgOff += pseg.curve * sp * dt * 60;
      if (playing) {
        dist += dt * speed * (TOPKMH / 3.6) / MAXS;
        timeLeft -= dt;
        const q = Math.floor(((position + PLAYERZ) % TRACK) / (QUARTER * SEGL));
        if (q !== lastQ) {
          lastQ = q; if (q === 0) lap++;
          const bonus = Math.max(11, 15 - lap);
          timeLeft += bonus; msg = "CHECKPOINT  +" + bonus + " s"; msgT = 2.2;
          g.sfx.tune([[880, 0.08], [1175, 0.08], [1760, 0.2]], { type: "triangle", vol: 0.13 });
        }
        if (timeLeft <= 0) {
          timeLeft = 0; state = "over"; g.playing = false;
          const rec = g.saveBest(Math.round(dist));
          g.status("Time is up. You drove " + (dist / 1000).toFixed(1) + " km." + (rec && dist > 0 ? " That is your best distance." : ""));
          g.sfx.tune([[392, 0.15], [330, 0.15], [262, 0.3]], { type: "triangle", vol: 0.13 });
        }
        if (Math.floor(dist / 100) !== Math.floor((dist - dt * speed) / 100)) showInfo();
      }
      engine();
    }
    function crash() { if (bump <= 0) { bump = 0.35; g.sfx.noise(0.3, { freq: 700, to: 120, vol: 0.4 }); } }

    /* ---- drawing ---- */
    function project(p, camX, camY, camZ) {
      p.cz = p.z - camZ;
      p.sc = CAMD / p.cz;
      p.sx = Math.round(W / 2 + p.sc * (0 - camX) * W / 2);
      p.sy = Math.round(H / 2 - p.sc * (p.y - camY) * H / 2);
      p.sw = Math.round(p.sc * ROADW * W / 2);
    }
    function quad(ctx, x1, y1, x2, y2, x3, y3, x4, y4, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fill(); }
    function drawSeg(ctx, s, fog) {
      const a = s.p1, b = s.p2, d = s.dark;
      ctx.fillStyle = d ? "#27702F" : "#2E7E37"; ctx.fillRect(0, b.sy, W, a.sy - b.sy);
      const r1 = a.sw / 6, r2 = b.sw / 6;
      quad(ctx, a.sx - a.sw - r1, a.sy, a.sx - a.sw, a.sy, b.sx - b.sw, b.sy, b.sx - b.sw - r2, b.sy, d ? "#D83A3A" : "#F2F2F2");
      quad(ctx, a.sx + a.sw + r1, a.sy, a.sx + a.sw, a.sy, b.sx + b.sw, b.sy, b.sx + b.sw + r2, b.sy, d ? "#D83A3A" : "#F2F2F2");
      quad(ctx, a.sx - a.sw, a.sy, a.sx + a.sw, a.sy, b.sx + b.sw, b.sy, b.sx - b.sw, b.sy, d ? "#55555F" : "#5C5C67");
      if (!d) {
        const l1 = a.sw / 32, l2 = b.sw / 32, w1 = a.sw * 2 / LANES, w2 = b.sw * 2 / LANES;
        for (let lane = 1; lane < LANES; lane++) {
          const x1 = a.sx - a.sw + w1 * lane, x2 = b.sx - b.sw + w2 * lane;
          quad(ctx, x1 - l1, a.sy, x1 + l1, a.sy, x2 + l2, b.sy, x2 - l2, b.sy, "#EDEDED");
        }
      }
      if (fog > 0.01) { ctx.globalAlpha = fog; ctx.fillStyle = FOG; ctx.fillRect(0, b.sy, W, a.sy - b.sy); ctx.globalAlpha = 1; }
    }
    function sprite(ctx, img, ww, sc, x, y, clipY) {
      const dw = ww * sc * ROADW * W / 2, dh = dw * img.height / img.width, dx = x - dw / 2, dy = y - dh;
      const cut = clipY ? Math.max(0, dy + dh - clipY) : 0;
      if (cut < dh && dw > 1) ctx.drawImage(img, 0, 0, img.width, img.height - img.height * cut / dh, dx, dy, dw, dh - cut);
    }
    function draw(ctx) {
      ctx.drawImage(sky, 0, 0, W, H);
      const hz = H * 0.56;
      for (const [img, k, h] of [[farHills, 0.6, 150], [nearHills, 1.2, 110]]) {
        let o = ((bgOff * k) % 1600 + 1600) % 1600;
        ctx.drawImage(img, -o, hz - h + 4); ctx.drawImage(img, 1600 - o, hz - h + 4);
      }
      const base = findSeg(position), bp = (position % SEGL) / SEGL;
      const pseg = findSeg(position + PLAYERZ), pp = ((position + PLAYERZ) % SEGL) / SEGL;
      const playerY = lerp(pseg.p1.y, pseg.p2.y, pp);
      let maxy = H, x = 0, dx = -(base.curve * bp);
      for (let n = 0; n < DRAW; n++) {
        const s = segs[(base.index + n) % N], looped = s.index < base.index;
        const camZ = position - (looped ? TRACK : 0);
        project(s.p1, playerX * ROADW - x, playerY + CAMH, camZ);
        project(s.p2, playerX * ROADW - x - dx, playerY + CAMH, camZ);
        x += dx; dx += s.curve;
        s.clip = maxy;
        if (s.p1.cz <= CAMD || s.p2.sy >= s.p1.sy || s.p2.sy >= maxy) continue;
        const f = n / DRAW;
        drawSeg(ctx, s, 1 - Math.exp(-f * f * 4.5));
        maxy = s.p2.sy;
      }
      for (let n = DRAW - 1; n > 0; n--) {
        const s = segs[(base.index + n) % N];
        if (s.p1.cz <= CAMD) continue;
        ctx.globalAlpha = Math.min(1, (DRAW - n) / 22);
        for (const sp of s.sprites) sprite(ctx, sp.s.img, sp.s.ww, s.p1.sc, s.p1.sx + s.p1.sc * sp.offset * ROADW * W / 2, s.p1.sy, s.clip);
        for (const car of s.cars) {
          const sc = lerp(s.p1.sc, s.p2.sc, car.percent);
          sprite(ctx, car.img, car.ww, sc, lerp(s.p1.sx, s.p2.sx, car.percent) + sc * car.offset * ROADW * W / 2, lerp(s.p1.sy, s.p2.sy, car.percent), s.clip);
        }
        ctx.globalAlpha = 1;
        if (s === pseg) {
          const sc = CAMD / PLAYERZ, dw = 0.3 * sc * ROADW * W / 2, dh = dw * PLAYER.height / PLAYER.width;
          const by = H / 2 - sc * lerp(pseg.p1.y - (playerY + CAMH), pseg.p2.y - (playerY + CAMH), pp) * H / 2;
          const shakeY = (speed / MAXS) * (Math.random() * 1.6) + (bump > 0 ? Math.sin(bump * 60) * 4 : 0);
          ctx.save(); ctx.translate(W / 2 + steer * 6, by + shakeY); ctx.rotate(steer * 0.045);
          ctx.drawImage(PLAYER, -dw / 2, -dh, dw, dh);
          ctx.restore();
        }
      }
      // dashboard
      ctx.fillStyle = "rgba(8, 12, 34, 0.62)"; ctx.fillRect(0, 0, W, 46);
      const kmh = Math.round(speed / MAXS * TOPKMH);
      GK.text(ctx, kmh + " km/h", 18, 24, 22, "#FFFFFF", "left");
      ctx.fillStyle = "#2A3060"; GK.rr(ctx, 150, 16, 150, 14, 7); ctx.fill();
      ctx.fillStyle = speed / MAXS > 0.85 ? "#FF5A4A" : "#6CFF8A"; GK.rr(ctx, 150, 16, Math.max(14, 150 * speed / MAXS), 14, 7); ctx.fill();
      const low = timeLeft < 10 && state === "play";
      GK.text(ctx, "TIME", W / 2 - 46, 24, 13, "#9FB8FF", "right");
      GK.text(ctx, timeLeft.toFixed(1), W / 2 - 38, 24, 26, low && Math.floor(timeLeft * 4) % 2 ? "#FF5A4A" : "#FFE27A", "left");
      GK.text(ctx, (dist / 1000).toFixed(2) + " km", W - 18, 24, 22, "#FFFFFF", "right");
      if (msgT > 0 && state === "play") { ctx.globalAlpha = Math.min(1, msgT * 2); GK.text(ctx, msg, W / 2, 110, 34, "#FFFFFF", "center"); ctx.globalAlpha = 1; }
      if (state === "ready") g.banner("Road Racer", ["Reach each checkpoint before the clock runs out.", "Press Enter or click to start."]);
      else if (state === "over") g.banner("Time is up", ["You drove " + (dist / 1000).toFixed(2) + " km.", "Press Enter or click to race again."]);
    }

    resetCars(); showInfo();
    g.start({ update, draw });
    return { destroy() { stopEngine(); g.destroy(); } };
  }
  return { init };
})();
