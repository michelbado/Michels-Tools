/* Stunt Track: 3D stunt driving against the clock, with a track editor.
 * The 3D picture is drawn with WebGL by this file alone (one small shader, flat-coloured triangles, no library).
 * The pieces, the track check and the track code are in lib/stunttrack.js. Best times and "My track" are kept in this browser only. */
(window.DesktopApps = window.DesktopApps || {}).stunt = (() => {
  const W = 800, H = 500, G = 9.8, VMAX = 62, ACC = 11, BRAKE = 24, CRASH_V = 14, STORE = "michels-tools-stunt-track";
  // Steering. The car turns by (steer) x min(TURN_MAX, grip / speed): at low speed a fixed turn rate, above GRIP / TURN_MAX m/s the most sideways
  // acceleration the tyres give (metres per second squared). The corner piece is a quarter circle of only 15 m radius, so the grip decides how fast
  // a corner can be taken: sqrt(grip x radius), about 21 m/s on the plain corner and 25 m/s on the banked one (it was 15 and 18).
  const GRIP_ROAD = 24, GRIP_GRASS = 10, GRIP_BANK = 8, TURN_MAX = 1.5;
  const CRASH_TEXT = { wall: "You drove into a wall.", hard: "You landed too hard.", water: "Splash! You drove into the water.", tree: "You hit a tree.", loop: "You hit the stunt piece: enter it straight and on the road.", slow: "Too slow: the car fell off." };

  /* ---- small vector and matrix helpers (matrices are 16 numbers, column by column) ---- */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  function perspective(fovy, aspect, n, f) { const t = 1 / Math.tan(fovy / 2); return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; }
  function lookAt(e, c, up) { const z = norm(sub(e, c)), x = norm(cross(up, z)), y = cross(z, x); return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]; }
  function mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; }
  const IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

  /* ---- a list of flat-coloured triangles ---- */
  function Mesh() {
    const d = [];
    const m = {
      d,
      tri(a, b, c, col) { const n = norm(cross(sub(b, a), sub(c, a))); for (const p of [a, b, c]) d.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2]); },
      quad(a, b, c, e, col) { m.tri(a, b, c, col); m.tri(a, c, e, col); },
      // a box from eight corners: bottom four (going round), then the top four above them
      hull(b, t, col, top) { m.quad(t[0], t[1], t[2], t[3], top || col); for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; m.quad(b[i], b[j], t[j], t[i], col); } },
      box(cx, cy, cz, sx, sy, sz, col, top) { const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2; m.hull([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], col, top); m.quad([x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0], col); },
    };
    return m;
  }

  function init(root) {
    const GK = window.GameKit, ST = window.StuntTrack, N = ST.N, TILE = ST.TILE, HWM = ST.HW * TILE;
    const g = GK.create(root, "stunt", { W, H });
    const glc = g.q("gl");
    let gl = null;
    try { gl = glc.getContext("webgl", { antialias: true, alpha: false }) || glc.getContext("experimental-webgl"); } catch (e) { gl = null; }

    /* ---- WebGL: one program, two vertex buffers (the world, the car) ---- */
    let prog = null, loc = {}, worldBuf = null, worldCount = 0, carBuf = null, carCount = 0;
    if (gl) {
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, "attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aCol; uniform mat4 uVP; uniform mat4 uM; uniform vec3 uLight; varying vec3 vCol; varying float vFog;" +
        "void main() { vec4 w = uM * vec4(aPos, 1.0); vec3 n = normalize((uM * vec4(aNor, 0.0)).xyz); float l = 0.5 + 0.42 * abs(dot(n, uLight)) + 0.08 * n.y; vCol = aCol * l; gl_Position = uVP * w; vFog = clamp((gl_Position.w - 170.0) / 560.0, 0.0, 1.0); }"));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, "precision mediump float; varying vec3 vCol; varying float vFog; uniform vec3 uFog; uniform vec4 uTint;" +
        "void main() { gl_FragColor = vec4(mix(vCol * uTint.rgb, uFog, vFog), uTint.a); }"));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) gl = null;
      else {
        for (const n of ["aPos", "aNor", "aCol"]) loc[n] = gl.getAttribLocation(prog, n);
        for (const n of ["uVP", "uM", "uLight", "uFog", "uTint"]) loc[n] = gl.getUniformLocation(prog, n);
        worldBuf = gl.createBuffer(); carBuf = gl.createBuffer();
      }
    }
    function upload(buf, mesh) { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.d), gl.STATIC_DRAW); return mesh.d.length / 9; }
    function bind(buf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc.aPos); gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 36, 0);
      gl.enableVertexAttribArray(loc.aNor); gl.vertexAttribPointer(loc.aNor, 3, gl.FLOAT, false, 36, 12);
      gl.enableVertexAttribArray(loc.aCol); gl.vertexAttribPointer(loc.aCol, 3, gl.FLOAT, false, 36, 24);
    }

    /* ---- the car model: x forward, y up, z to the right ---- */
    if (gl) {
      const m = Mesh(), red = hex("#D8242C"), dark = hex("#8E1218"), glass = hex("#1E2C44"), black = hex("#15151A");
      m.box(0, 0.62, 0, 4.2, 0.62, 1.9, red, hex("#E8363E"));
      m.hull([[-1.5, 0.93, -0.8], [0.7, 0.93, -0.8], [0.7, 0.93, 0.8], [-1.5, 0.93, 0.8]], [[-1.2, 1.45, -0.68], [0.2, 1.45, -0.68], [0.2, 1.45, 0.68], [-1.2, 1.45, 0.68]], glass, red);
      m.box(-2.0, 1.25, 0, 0.35, 0.08, 1.9, dark); m.box(-2.0, 1.08, -0.8, 0.12, 0.3, 0.1, dark); m.box(-2.0, 1.08, 0.8, 0.12, 0.3, 0.1, dark);
      for (const x of [-1.35, 1.35]) for (const z of [-0.98, 0.98]) m.box(x, 0.36, z, 0.78, 0.72, 0.36, black);
      m.box(2.1, 0.62, -0.6, 0.06, 0.2, 0.4, hex("#FFF2B0")); m.box(2.1, 0.62, 0.6, 0.06, 0.2, 0.4, hex("#FFF2B0"));
      m.box(-2.1, 0.7, -0.6, 0.06, 0.18, 0.5, hex("#FF5040")); m.box(-2.1, 0.7, 0.6, 0.06, 0.18, 0.5, hex("#FF5040"));
      carCount = upload(carBuf, m);
    }

    /* ---- building the world from the track ---- */
    let grid = null, trace = { ok: false, path: [] }, need = [], trackKey = "0";
    function centre(p, t) {   // the middle of the road at t (0..1): place [u, v] and direction [du, dv]
      if (p === "c" || p === "k") { const a = t * Math.PI / 2; return [-0.5 + 0.5 * Math.sin(a), 0.5 - 0.5 * Math.cos(a), Math.cos(a), Math.sin(a)]; }
      if (p === "x") return [t - 0.5, 0.14 * Math.sin(2 * Math.PI * t), 1, 0.14 * 2 * Math.PI * Math.cos(2 * Math.PI * t)];
      return [t - 0.5, 0, 1, 0];
    }
    function buildWorld() {
      if (!gl) return;
      const m = Mesh();
      const P = (tx, tz, r, u, v, y) => { const w = ST.toWorld(tx, tz, r, u, v); return [w[0], y, w[1]]; };
      const span = N * TILE, far = 2400;
      m.quad([-far, -0.08, -far], [-far, -0.08, span + far], [span + far, -0.08, span + far], [span + far, -0.08, -far], hex("#3E8A32"));
      const road1 = hex("#5C5C66"), road2 = hex("#53535D"), white = hex("#F2F2F2"), yellow = hex("#F0C830"), wall = hex("#A9A9B2"), wall2 = hex("#8C8C96");
      for (let tz = 0; tz < N; tz++) for (let tx = 0; tx < N; tx++) {
        const c = grid[tz * N + tx], x0 = tx * TILE, z0 = tz * TILE;
        m.quad([x0, 0, z0], [x0, 0, z0 + TILE], [x0 + TILE, 0, z0 + TILE], [x0 + TILE, 0, z0], c.p === "W" ? hex("#2E7AD8") : (tx + tz) % 2 ? hex("#4C9A3C") : hex("#469236"));
        const Q = (u, v, y) => P(tx, tz, c.r, u, v, y);
        const M = (um, vm, y) => P(tx, tz, c.r, um / TILE, vm / TILE, y);   // the same in metres
        const obox = (u0, u1, v0, v1, y0, y1, col, top) => m.hull([M(u0, v0, y0), M(u1, v0, y0), M(u1, v1, y0), M(u0, v1, y0)], [M(u0, v0, y1), M(u1, v0, y1), M(u1, v1, y1), M(u0, v1, y1)], col, top);
        if (c.p === "T") {
          for (const t of ST.TREES) {
            const u = t[0] * TILE, v = t[1] * TILE;
            obox(u - 0.35, u + 0.35, v - 0.35, v + 0.35, 0, 2.6, hex("#6A4420"));
            const top = M(u, v, 9), b = [M(u - 2.6, v - 2.6, 2.2), M(u + 2.6, v - 2.6, 2.2), M(u + 2.6, v + 2.6, 2.2), M(u - 2.6, v + 2.6, 2.2)];
            for (let i = 0; i < 4; i++) m.tri(b[i], b[(i + 1) % 4], top, i % 2 ? hex("#1E6A34") : hex("#27803E"));
          }
          continue;
        }
        if (!ST.PIECES[ST.INDEX[c.p]].ends) continue;
        if (c.p === "l" || c.p === "w") {
          // the ribbon of a loop or corkscrew, from the same path the car follows
          const len = ST.railLength(c.p), K = c.p === "l" ? 64 : 48;
          let prev = null;
          for (let i = 0; i <= K; i++) {
            const s = len * i / K, a = ST.rail(c.p, s), b = ST.rail(c.p, Math.min(len, s + 0.3)), a0 = ST.rail(c.p, Math.max(0, s - 0.3));
            const tan = norm(sub(b.pos, a0.pos)), lat = cross(tan, a.up);
            const mid = add(a.pos, a.up, 0.05), L = add(mid, lat, -HWM), R = add(mid, lat, HWM);
            const cur = { L: M(L[0], L[2], L[1]), R: M(R[0], R[2], R[1]), Li: M(L[0] + lat[0] * 0.5, L[2] + lat[2] * 0.5, L[1] + lat[1] * 0.5 + a.up[1] * 0.02), Ri: M(R[0] - lat[0] * 0.5, R[2] - lat[2] * 0.5, R[1] - lat[1] * 0.5 + a.up[1] * 0.02) };
            if (prev) {
              m.quad(prev.Li, prev.Ri, cur.Ri, cur.Li, i % 2 ? road1 : road2);
              m.quad(prev.L, prev.Li, cur.Li, cur.L, i % 2 ? hex("#E0343A") : white); m.quad(prev.Ri, prev.R, cur.R, cur.Ri, i % 2 ? hex("#E0343A") : white);
            }
            prev = cur;
          }
          continue;
        }
        const K = c.p === "s" || c.p === "f" || c.p === "t" || c.p === "e" ? 4 : 14;
        let prev = null;
        for (let i = 0; i <= K; i++) {
          const t = i / K, ce = centre(c.p, t), l = Math.hypot(ce[2], ce[3]), nu = -ce[3] / l, nv = ce[2] / l;
          const e = ST.HW * 0.999, lu = ce[0] - nu * e, lv = ce[1] - nv * e, ru = ce[0] + nu * e, rv = ce[1] + nv * e;
          const hl = ST.surf(c.p, lu, lv).h, hr = ST.surf(c.p, ru, rv).h, hc = ST.surf(c.p, ce[0], ce[1]).h, k = 0.07;
          const cur = { L: Q(lu, lv, hl + 0.05), R: Q(ru, rv, hr + 0.05), Li: Q(lu + nu * k * ST.HW * 2, lv + nv * k * ST.HW * 2, hl + (hr - hl) * k + 0.06), Ri: Q(ru - nu * k * ST.HW * 2, rv - nv * k * ST.HW * 2, hr - (hr - hl) * k + 0.06),
            Cl: Q(ce[0] - nu * 0.006, ce[1] - nv * 0.006, hc + 0.08), Cr: Q(ce[0] + nu * 0.006, ce[1] + nv * 0.006, hc + 0.08), L0: Q(lu, lv, 0), R0: Q(ru, rv, 0), high: Math.max(hl, hr) > 0.06 };
          if (prev) {
            m.quad(prev.L, prev.R, cur.R, cur.L, i % 2 ? road1 : road2);
            m.quad(prev.L, prev.Li, cur.Li, cur.L, white); m.quad(prev.Ri, prev.R, cur.R, cur.Ri, white);
            if (i % 2) m.quad(prev.Cl, prev.Cr, cur.Cr, cur.Cl, yellow);
            if (prev.high || cur.high) { m.quad(prev.L0, prev.L, cur.L, cur.L0, wall); m.quad(prev.R, prev.R0, cur.R0, cur.R, wall); }
          }
          prev = cur;
        }
        if (c.p === "r") m.quad(prev.L, prev.R, prev.R0, prev.L0, wall2);
        if (c.p === "e") {
          const a = ST.cell(grid, tx + ST.DX[c.r], tz + ST.DZ[c.r]), b = ST.cell(grid, tx - ST.DX[c.r], tz - ST.DZ[c.r]);
          if (!a || (a.p !== "e" && a.p !== "r")) m.quad(Q(0.5, -ST.HW, ST.RAMP_H), Q(0.5, ST.HW, ST.RAMP_H), Q(0.5, ST.HW, 0), Q(0.5, -ST.HW, 0), wall2);
          if (!b || (b.p !== "e" && b.p !== "r")) m.quad(Q(-0.5, -ST.HW, ST.RAMP_H), Q(-0.5, ST.HW, ST.RAMP_H), Q(-0.5, ST.HW, 0), Q(-0.5, -ST.HW, 0), wall2);
        }
        if (c.p === "f") {
          for (let i = 0; i < 10; i++) for (let j = 0; j < 2; j++) m.quad(M(-1 + j, -HWM + i, 0.1), M(-1 + j, -HWM + i + 1, 0.1), M(j, -HWM + i + 1, 0.1), M(j, -HWM + i, 0.1), (i + j) % 2 ? hex("#111111") : white);
          obox(-0.3, 0.3, -HWM - 1.1, -HWM - 0.5, 0, 7, hex("#D8DCE8")); obox(-0.3, 0.3, HWM + 0.5, HWM + 1.1, 0, 7, hex("#D8DCE8"));
          obox(-0.35, 0.35, -HWM - 1.1, HWM + 1.1, 5.6, 7, hex("#C8202A"), hex("#E8363E"));
          for (let i = 0; i < 6; i++) obox(-0.4, 0.4, -HWM + 0.4 + i * 1.6, -HWM + 1.2 + i * 1.6, 6, 6.6, white);
        }
        if (c.p === "t") {
          const brick = hex("#9A5A3C"), roof = hex("#7A4630");
          obox(-12, 12, -HWM - 1.6, -HWM - 0.6, 0, 5.6, brick); obox(-12, 12, HWM + 0.6, HWM + 1.6, 0, 5.6, brick);
          obox(-12, 12, -HWM - 1.6, HWM + 1.6, 5.6, 6.6, roof, hex("#5E8A3C"));
        }
      }
      // far away: mountains all around, and trees outside the map
      let seed = 41;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < 18; i++) {
        const a = i / 18 * 6.283 + rnd() * 0.2, d = 640 + rnd() * 260, cx = span / 2 + Math.cos(a) * d, cz = span / 2 + Math.sin(a) * d, b = 150 + rnd() * 130, h = 110 + rnd() * 150;
        const base = [[cx - b, -1, cz - b], [cx + b, -1, cz - b], [cx + b, -1, cz + b], [cx - b, -1, cz + b]], top = [cx + (rnd() - 0.5) * 40, h, cz + (rnd() - 0.5) * 40];
        for (let k = 0; k < 4; k++) m.tri(base[k], base[(k + 1) % 4], top, k % 2 ? hex("#7C86A6") : hex("#8E98B8"));
      }
      for (let i = 0; i < 70; i++) {
        const a = rnd() * 6.283, d = span * 0.72 + 25 + rnd() * 170, x = span / 2 + Math.cos(a) * d, z = span / 2 + Math.sin(a) * d, s = 1.6 + rnd() * 1.6;
        if (x > -8 && x < span + 8 && z > -8 && z < span + 8) continue;
        m.box(x, 1.2, z, 0.6, 2.4, 0.6, hex("#6A4420"));
        const b = [[x - s, 2, z - s], [x + s, 2, z - s], [x + s, 2, z + s], [x - s, 2, z + s]];
        for (let k = 0; k < 4; k++) m.tri(b[k], b[(k + 1) % 4], [x, 5 + s * 2, z], k % 2 ? hex("#1E6A34") : hex("#27803E"));
      }
      worldCount = upload(worldBuf, m);
    }

    /* ---- tracks: the built-in ones and "My track" ---- */
    const sel = g.q("track");
    ST.BUILTIN.forEach((b, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = (i + 1) + ". " + b.name; sel.append(o); });
    { const o = document.createElement("option"); o.value = "my"; o.textContent = "My track"; sel.append(o); }
    function loadMine() { let gr = null; try { gr = ST.decode(window.localStorage.getItem(STORE)); } catch (e) { gr = null; } return gr || ST.BUILTIN[0].grid(); }
    function saveMine() { try { window.localStorage.setItem(STORE, ST.encode(grid)); } catch (e) { /* kept until the page closes */ } }
    function hashOf(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
    function useGrid(gr, key) {
      grid = gr; trace = ST.trace(grid); need = trace.path.filter(p => !p.air);
      trackKey = key === "my" ? "m" + hashOf(ST.encode(grid)) : String(key);
      buildWorld();
    }
    function pickTrack(v) {
      useGrid(v === "my" ? loadMine() : ST.BUILTIN[Number(v)].grid(), v);
      if (state !== "edit") toMenu();
    }

    /* ---- the car and the race ---- */
    const car = { x: 0, z: 0, y: 0, vy: 0, psi: 0, v: 0, hv: 0, air: false, pitch: 0, roll: 0, steer: 0, rail: null, pos: [0, 0, 0], f: [1, 0, 0], up: [0, 1, 0] };
    let state = "menu", raceT = 0, countT = 0, done = 0, why = "", view = 0, eng = null, rec = [], recT = 0, lastTime = 0;
    const ghosts = {};
    let cam = { eye: [0, 5, 0], up: [0, 1, 0], set: false };
    function placeCar() {
      const st = trace.path[0] || { x: 1, z: 1, d: 0 }, w = ST.toWorld(st.x, st.z, st.d, -0.3, 0);
      Object.assign(car, { x: w[0], z: w[1], y: 0, vy: 0, psi: st.d * Math.PI / 2, v: 0, hv: 0, air: false, pitch: 0, roll: 0, steer: 0, rail: null });
      frame(); cam.set = false;
    }
    function frame() {   // forward / up of the car from its heading, pitch and roll (on the ground or in the air)
      const cp = Math.cos(car.pitch), f = [Math.cos(car.psi) * cp, Math.sin(car.pitch), Math.sin(car.psi) * cp];
      let r = norm(cross(f, [0, 1, 0])), up = cross(r, f);
      up = norm(add(up, r, Math.tan(car.roll)));
      car.f = f; car.up = up; car.pos = [car.x, car.y, car.z];
    }
    function showInfo() { const b = g.best("t" + trackKey); g.info(b != null ? "Best " + fmtTime(b / 1000) : "No time yet"); }
    const fmtTime = t => Math.floor(t / 60) + ":" + (t % 60 < 10 ? "0" : "") + (t % 60).toFixed(2);
    function toMenu() {
      state = trace.ok ? "menu" : "bad"; g.playing = false; g.setPaused(false); placeCar(); showInfo();
      g.status(trace.ok ? "Up arrow: gas. Down: brake and reverse. Left and Right: steer. V changes the view, R restarts." : "This track cannot be driven: " + trace.error + " Press Edit track to repair it.");
    }
    function startRun() {
      if (!trace.ok) return;
      placeCar(); state = "count"; countT = 2.4; raceT = 0; done = 1; rec = []; recT = 0; g.playing = true; g.setPaused(false);
      g.sfx.tune([[440, 0.2], [0, 0.6], [440, 0.2], [0, 0.6], [440, 0.2], [0, 0.6], [880, 0.5]], { type: "square", vol: 0.09 });
    }
    function crash(kind) {
      if (state !== "race") return;
      state = "crash"; g.playing = false; why = CRASH_TEXT[kind] || "";
      g.sfx.noise(0.5, { freq: 900, to: 90, vol: 0.5 });
      g.status(why + " Press Enter or R to try again.");
    }
    function finish() {
      state = "done"; g.playing = false; lastTime = raceT;
      const record = g.saveBest(Math.round(raceT * 1000), "t" + trackKey, true);
      if (record) ghosts[trackKey] = rec;
      g.sfx.tune([[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.3]], { type: "triangle", vol: 0.14 });
      g.status("Finished in " + fmtTime(raceT) + "." + (record ? " That is your best time on this track." : "") + " Press Enter to drive again.");
      showInfo();
    }
    const localToWorld = (r, v) => [v[0] * ST.DX[r] - v[2] * ST.DZ[r], v[1], v[0] * ST.DZ[r] + v[2] * ST.DX[r]];
    function railStep(dt, gas, brake, steer) {
      const R = car.rail, len = ST.railLength(R.p), a = ST.rail(R.p, R.s), b = ST.rail(R.p, Math.min(len, R.s + 0.4)), a0 = ST.rail(R.p, Math.max(0, R.s - 0.4));
      const tan = norm(sub(b.pos, a0.pos));
      const acc = gas ? ACC * (1 - Math.pow(car.v / VMAX, 2)) : brake ? -BRAKE : -1;
      car.v += (acc - G * tan[1]) * dt;
      if (a.k === 0) car.v = Math.max(car.v, 2);
      else if (car.v * car.v * a.k + G * a.up[1] < 0 || car.v < 1.5) { crash("slow"); return; }
      car.v = Math.min(car.v, VMAX);
      R.s += car.v * dt; R.off = GK.clamp(R.off + steer * 4 * dt, -3.4, 3.4);
      const lat = cross(tan, a.up), p = add(add(a.pos, lat, R.off), a.up, 0), wp = localToWorld(R.r, p);
      car.f = localToWorld(R.r, tan); car.up = localToWorld(R.r, a.up);
      car.x = (R.tx + 0.5) * TILE + wp[0]; car.z = (R.tz + 0.5) * TILE + wp[2]; car.y = wp[1];
      car.pos = [car.x, car.y, car.z];
      if (R.s >= len) { car.rail = null; car.y = 0; car.vy = 0; car.psi = R.r * Math.PI / 2; car.pitch = 0; car.roll = 0; car.air = false; }
    }
    function groundStep(dt, gas, brake, steer) {
      const a0 = ST.at(grid, car.x, car.z);
      if (!car.air) {
        let acc;
        if (gas) acc = ACC * (1 - Math.pow(Math.max(0, car.v) / VMAX, 2));
        else if (brake) acc = car.v > 0.5 ? -BRAKE : -6;
        else acc = -Math.sign(car.v) * (1 + 0.0009 * car.v * car.v);
        if (!a0.road) acc -= car.v * 0.9;
        car.v = GK.clamp(car.v + acc * dt, -9, VMAX);
        if (!gas && !brake && Math.abs(car.v) < 0.15) car.v = 0;
        car.steer += (steer - car.steer) * Math.min(1, dt * 9);
        const grip = (a0.road ? GRIP_ROAD : GRIP_GRASS) + (a0.p === "k" ? GRIP_BANK : 0);
        car.psi += car.steer * Math.min(TURN_MAX, grip / Math.max(6, Math.abs(car.v))) * dt * (car.v >= 0 ? 1 : -1) * Math.min(1, Math.abs(car.v) / 3);
      }
      const hv = car.air ? car.hv : car.v, cs = Math.cos(car.psi), sn = Math.sin(car.psi);
      let nx = car.x + cs * hv * dt, nz = car.z + sn * hv * dt;
      const lim = 110, span = N * TILE;
      if (nx < -lim || nx > span + lim || nz < -lim || nz > span + lim) { nx = car.x; nz = car.z; car.v = 0; car.hv = 0; }
      const a1 = ST.at(grid, nx, nz), yb = car.y + car.vy * dt - 0.5 * G * dt * dt;
      if (a1.h > yb + 0.7 && Math.abs(hv) > 2) { crash("wall"); return; }
      if (a1.h >= yb - 0.02) {
        if (car.air) {
          const impact = (a1.h - a0.h) / dt - (car.vy - G * dt);
          if (impact > CRASH_V && Math.abs(a1.h - a0.h) < 1) { crash("hard"); return; }
          car.air = false; car.v = hv * 0.97;
          g.sfx.noise(0.12, { freq: 300, vol: Math.min(0.5, impact / 20) });
        } else if (Math.abs(car.v) > 0.5) {
          const slope = GK.clamp((a1.h - a0.h) / (Math.abs(car.v) * dt), -0.6, 0.6);
          car.v -= Math.sign(car.v) * G * slope / Math.sqrt(1 + slope * slope) * dt;
        }
        car.vy = GK.clamp((a1.h - car.y) / dt, -30, 30); car.y = a1.h;
        const want = Math.abs(car.v) > 1 ? Math.atan2(car.vy, Math.abs(car.v)) * Math.sign(car.v) : 0;
        car.pitch += (want - car.pitch) * Math.min(1, dt * 14);
        const rx = -sn, rz = cs, hl = ST.at(grid, nx - rx, nz - rz), hr = ST.at(grid, nx + rx, nz + rz);
        const bank = hl.road && hr.road ? Math.atan2(hl.h - hr.h, 2) : 0;
        car.roll += (bank - car.steer * 0.05 * Math.abs(car.v) / VMAX - car.roll) * Math.min(1, dt * 10);
        if (a1.p === "W") { car.x = nx; car.z = nz; frame(); crash("water"); return; }
        if (a1.tree) { crash("tree"); return; }
        if ((a1.p === "l" || a1.p === "w") && a1.road) {
          const along = Math.cos(car.psi - a1.r * Math.PI / 2), sg = along >= 0 ? 1 : -1;
          if (Math.abs(along) > 0.85 && a1.u * sg < -0.2 && car.v > 0) car.rail = { p: a1.p, tx: a1.tx, tz: a1.tz, r: sg > 0 ? a1.r : (a1.r + 2) % 4, s: (a1.u * sg + 0.5) * TILE, off: GK.clamp(a1.v * sg * TILE, -3.4, 3.4) };
          else if (Math.abs(a1.u) < 0.2 && Math.abs(car.v) > 4) { crash("loop"); return; }
        }
      } else {
        if (!car.air) { car.air = true; car.hv = car.v; }
        car.y = yb; car.vy -= G * dt;
        car.pitch += (Math.atan2(car.vy, Math.max(8, hv)) * 0.6 - car.pitch) * Math.min(1, dt * 4);
        car.roll *= 1 - Math.min(1, dt * 3);
      }
      car.x = nx; car.z = nz;
      frame();
    }
    function stopEngine() { if (eng) { try { eng.osc.stop(); } catch (e) { /* already stopped */ } eng = null; } }
    function engine() {
      const s = g.sfx, want = s.on && s.ac && (state === "race" || state === "count");
      if (!want) { stopEngine(); return; }
      if (!eng) {
        try { const osc = s.ac.createOscillator(), f = s.ac.createBiquadFilter(), gn = s.ac.createGain(); osc.type = "sawtooth"; f.type = "lowpass"; f.frequency.value = 650; gn.gain.value = 0.045; osc.connect(f); f.connect(gn); gn.connect(s.out); osc.start(); eng = { osc }; } catch (e) { return; }
      }
      eng.osc.frequency.setTargetAtTime(50 + 190 * Math.abs(car.v) / VMAX, s.ac.currentTime, 0.06);
    }
    g.onPause = p => { if (p) stopEngine(); };
    g.onSound = on => { if (!on) stopEngine(); };

    function update(dt) {
      if (state === "edit") return;
      if (state === "count") { countT -= dt; if (countT <= 0) state = "race"; }
      if (state === "race") {
        raceT += dt;
        const k = g.keys, gas = k.has("ArrowUp") || k.has("KeyW"), brake = k.has("ArrowDown") || k.has("KeyS"), steer = (k.has("ArrowRight") || k.has("KeyD") ? 1 : 0) - (k.has("ArrowLeft") || k.has("KeyA") ? 1 : 0);
        const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
        for (let i = 0; i < n && state === "race"; i++) { if (car.rail) railStep(h, gas, brake, steer); else groundStep(h, gas, brake, steer); }
        // progress: every road piece in order, then the start again
        const tx = car.rail ? car.rail.tx : Math.floor(car.x / TILE), tz = car.rail ? car.rail.tz : Math.floor(car.z / TILE);
        if (done < need.length && need[done].x === tx && need[done].z === tz) done++;
        else if (done >= need.length && need.length && need[0].x === tx && need[0].z === tz && state === "race") finish();
        recT += dt;
        if (recT >= 0.1) { recT -= 0.1; rec.push([car.pos, car.f, car.up]); }
      }
      // camera
      const flatF = norm([car.f[0], car.rail ? car.f[1] : car.f[1] * 0.4, car.f[2]]), upv = car.rail ? car.up : [0, 1, 0];
      const want = view === 0 ? (car.rail ? add(add(car.pos, car.f, -4.5), car.up, 3) : add(add(car.pos, flatF, -9.5), upv, 3.6)) : add(add(car.pos, car.up, 1.3), car.f, 0.2);
      const k = cam.set && view === 0 ? 1 - Math.exp(-dt * (car.rail ? 30 : 9)) : 1;
      cam.eye = mix(cam.eye, want, k); cam.up = norm(mix(cam.up, view === 0 ? upv : car.up, cam.set ? 1 - Math.exp(-dt * 7) : 1)); cam.set = true;
      if (!car.rail && cam.eye[1] < 0.6) cam.eye[1] = 0.6;
      engine();
    }

    /* ---- drawing: the 3D picture ---- */
    function modelOf(pos, f, up) { const r = norm(cross(f, up)), u = cross(r, f); return [f[0], f[1], f[2], 0, u[0], u[1], u[2], 0, r[0], r[1], r[2], 0, pos[0], pos[1], pos[2], 1]; }
    function draw3d() {
      const c = g.canvas;
      if (glc.width !== c.width || glc.height !== c.height) { glc.width = c.width; glc.height = c.height; }
      for (const p of ["width", "height", "left", "top"]) if (glc.style[p] !== c.style[p]) glc.style[p] = c.style[p];
      gl.viewport(0, 0, glc.width, glc.height);
      gl.clearColor(0.66, 0.84, 0.96, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      gl.useProgram(prog);
      const target = view === 0 ? add(add(car.pos, car.f, 5), car.up, 1) : add(add(car.pos, car.up, 1.3), car.f, 10);
      const vp = mul(perspective(view === 0 ? 1.05 : 1.2, W / H, 0.4, 1800), lookAt(cam.eye, target, cam.up));
      gl.uniformMatrix4fv(loc.uVP, false, new Float32Array(vp));
      gl.uniform3fv(loc.uLight, norm([0.45, 0.8, 0.35])); gl.uniform3f(loc.uFog, 0.74, 0.87, 0.96);
      gl.uniformMatrix4fv(loc.uM, false, new Float32Array(IDENT)); gl.uniform4f(loc.uTint, 1, 1, 1, 1);
      bind(worldBuf); gl.drawArrays(gl.TRIANGLES, 0, worldCount);
      bind(carBuf);
      if (view === 0) { gl.uniformMatrix4fv(loc.uM, false, new Float32Array(modelOf(car.pos, car.f, car.up))); gl.drawArrays(gl.TRIANGLES, 0, carCount); }
      const gh = ghosts[trackKey];
      if (gh && (state === "race" || state === "count")) {
        const i = Math.min(gh.length - 1, Math.floor(raceT / 0.1));
        if (i >= 0 && gh[i] && Math.hypot(gh[i][0][0] - car.pos[0], gh[i][0][2] - car.pos[2]) > 5) {
          gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.uniformMatrix4fv(loc.uM, false, new Float32Array(modelOf(gh[i][0], gh[i][1], gh[i][2]))); gl.uniform4f(loc.uTint, 0.7, 0.9, 1.4, 0.45);
          gl.drawArrays(gl.TRIANGLES, 0, carCount); gl.disable(gl.BLEND);
        }
      }
    }

    /* ---- drawing: pieces seen from above (editor and small map) ---- */
    function pic(ctx, c, x, y, s) {
      ctx.fillStyle = c.p === "W" ? "#2E7AD8" : "#4C9A3C"; ctx.fillRect(x, y, s, s);
      if (c.p === "." || c.p === "W") return;
      ctx.save(); ctx.translate(x + s / 2, y + s / 2); ctx.rotate(c.r * Math.PI / 2); ctx.scale(s, s);
      const hw = ST.HW;
      if (c.p === "T") { ctx.fillStyle = "#1E6A34"; for (const t of ST.TREES) { ctx.beginPath(); ctx.arc(t[0], t[1], 0.11, 0, 6.283); ctx.fill(); } ctx.restore(); return; }
      ctx.strokeStyle = c.p === "e" ? "#8A8A98" : "#56565F"; ctx.lineWidth = hw * 2; ctx.lineCap = "butt";
      ctx.beginPath();
      if (c.p === "c" || c.p === "k") ctx.arc(-0.5, 0.5, 0.5, -Math.PI / 2, 0);
      else if (c.p === "x") { for (let i = 0; i <= 12; i++) { const t = i / 12; ctx.lineTo(t - 0.5, 0.14 * Math.sin(2 * Math.PI * t)); } }
      else { ctx.moveTo(-0.5, 0); ctx.lineTo(0.5, 0); }
      ctx.stroke();
      if (c.p === "k") { ctx.strokeStyle = "#F0C830"; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.arc(-0.5, 0.5, 0.5 + hw - 0.03, -Math.PI / 2, 0); ctx.stroke(); }
      else if (c.p === "f") { ctx.fillStyle = "#FFF"; ctx.fillRect(-0.06, -hw, 0.12, hw * 2); ctx.fillStyle = "#111"; for (let i = 0; i < 4; i++) ctx.fillRect(i % 2 ? 0 : -0.06, -hw + i * hw / 2, 0.06, hw / 2); ctx.fillStyle = "#FFF"; ctx.beginPath(); ctx.moveTo(0.42, 0); ctx.lineTo(0.22, -0.1); ctx.lineTo(0.22, 0.1); ctx.fill(); }
      else if (c.p === "h") { ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.beginPath(); ctx.ellipse(0, 0, 0.26, hw, 0, 0, 6.283); ctx.fill(); }
      else if (c.p === "r") { const gr = ctx.createLinearGradient(-0.5, 0, 0.5, 0); gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(1, "rgba(255,255,255,0.75)"); ctx.fillStyle = gr; ctx.fillRect(-0.5, -hw, 1, hw * 2); ctx.fillStyle = "#C8202A"; ctx.fillRect(0.44, -hw, 0.06, hw * 2); }
      else if (c.p === "e") { ctx.fillStyle = "#33333C"; ctx.fillRect(-0.5, -hw, 1, 0.04); ctx.fillRect(-0.5, hw - 0.04, 1, 0.04); }
      else if (c.p === "l") { ctx.strokeStyle = "#F2F2F2"; ctx.lineWidth = 0.07; ctx.beginPath(); ctx.arc(0, 0, 0.24, 0, 6.283); ctx.stroke(); }
      else if (c.p === "w") { ctx.strokeStyle = "#F2F2F2"; ctx.lineWidth = 0.06; ctx.beginPath(); for (let i = 0; i <= 16; i++) ctx.lineTo(-0.36 + i * 0.045, hw * 0.8 * Math.sin(i / 16 * 6.283)); ctx.stroke(); }
      else if (c.p === "t") { ctx.fillStyle = "#7A4630"; ctx.fillRect(-0.36, -hw - 0.07, 0.72, hw * 2 + 0.14); }
      ctx.restore();
    }

    /* ---- the editor ---- */
    const EX = 18, EY = 26, EC = 32, PXL = 486, PW = 148, PH = 44;
    let pick = 1, pickR = 0;
    function editClick(x, y, e) {
      const gx = Math.floor((x - EX) / EC), gy = Math.floor((y - EY) / EC);
      if (x >= EX && y >= EY && gx >= 0 && gy >= 0 && gx < N && gy < N) {
        const c = grid[gy * N + gx], id = ST.PIECES[pick].id;
        if (e.button === 2 || (c.p === id && id !== "." && id !== "W" && id !== "T")) c.r = (c.r + 1) % 4;
        else grid[gy * N + gx] = { p: id, r: pickR };
        saveMine(); trace = ST.trace(grid); need = trace.path.filter(p => !p.air);
        g.status(trace.ok ? "A closed track of " + need.length + " road pieces. Press Drive to try it." : trace.error);
        return;
      }
      const i = Math.floor((y - EY) / PH), j = Math.floor((x - PXL) / PW);
      if (x >= PXL && y >= EY && j >= 0 && j < 2 && i >= 0 && i * 2 + j < ST.PIECES.length) { if (pick === i * 2 + j) pickR = (pickR + 1) % 4; else pick = i * 2 + j; }
    }
    function drawEdit(ctx) {
      ctx.fillStyle = "#16203A"; ctx.fillRect(0, 0, W, H);
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) pic(ctx, grid[z * N + x], EX + x * EC, EY + z * EC, EC);
      ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1;
      for (let i = 0; i <= N; i++) { ctx.beginPath(); ctx.moveTo(EX + i * EC + 0.5, EY); ctx.lineTo(EX + i * EC + 0.5, EY + N * EC); ctx.moveTo(EX, EY + i * EC + 0.5); ctx.lineTo(EX + N * EC, EY + i * EC + 0.5); ctx.stroke(); }
      if (!trace.ok && trace.at) { ctx.strokeStyle = "#FF3A2A"; ctx.lineWidth = 3; ctx.strokeRect(EX + trace.at[0] * EC + 1.5, EY + trace.at[1] * EC + 1.5, EC - 3, EC - 3); }
      GK.text(ctx, trace.ok ? "Closed track: " + need.length + " road pieces" : "Not a closed track yet", EX, 13, 13, trace.ok ? "#6CFF8A" : "#FFB060");
      GK.text(ctx, "PIECES", PXL, 13, 13, "#9FB8FF");
      ST.PIECES.forEach((p, i) => {
        const x = PXL + (i % 2) * PW, y = EY + Math.floor(i / 2) * PH, on = i === pick;
        GK.rr(ctx, x, y + 2, PW - 6, PH - 6, 5); ctx.fillStyle = on ? "#2E4A9A" : "#1E2A4E"; ctx.fill();
        if (on) { ctx.strokeStyle = "#FFE27A"; ctx.lineWidth = 2; ctx.stroke(); }
        pic(ctx, { p: p.id, r: on ? pickR : 0 }, x + 5, y + 5, 32);
        GK.text(ctx, p.name, x + 43, y + PH / 2 - 1, 11, "#E8EEFF", "left", "normal");
      });
      const ty = EY + 7 * PH + 14;
      ["Click a piece, then click squares on the map.", "Click the chosen piece again, or press T,", "to turn it. Clicking a road piece of the same", "kind on the map turns that one.", "A jump: a ramp, one to three empty or water", "squares, and a ramp facing back.", "Raised road goes between two ramps."].forEach((l, i) => GK.text(ctx, l, PXL, ty + i * 16, 11.5, "#C8D4F0", "left", "normal"));
    }

    /* ---- drawing: dials, map and messages on top of the 3D picture ---- */
    function draw(ctx) {
      ctx.clearRect(0, 0, W, H);
      if (state === "edit") { drawEdit(ctx); return; }
      if (!gl) { ctx.fillStyle = "#16203A"; ctx.fillRect(0, 0, W, H); g.banner("3D is not available", ["This browser has WebGL switched off,", "so the stunt track cannot be drawn."]); return; }
      draw3d();
      ctx.fillStyle = "rgba(8, 12, 34, 0.55)"; GK.rr(ctx, 12, 12, 190, 62, 8); ctx.fill();
      GK.text(ctx, Math.round(Math.abs(car.v) * 3.6) + " km/h", 24, 34, 24, "#FFFFFF");
      ctx.fillStyle = "#2A3060"; GK.rr(ctx, 24, 54, 166, 10, 5); ctx.fill();
      ctx.fillStyle = Math.abs(car.v) / VMAX > 0.85 ? "#FF5A4A" : "#6CFF8A"; GK.rr(ctx, 24, 54, Math.max(10, 166 * Math.abs(car.v) / VMAX), 10, 5); ctx.fill();
      ctx.fillStyle = "rgba(8, 12, 34, 0.55)"; GK.rr(ctx, W / 2 - 90, 12, 180, 62, 8); ctx.fill();
      GK.text(ctx, fmtTime(state === "done" ? lastTime : raceT), W / 2, 34, 24, "#FFE27A", "center");
      const b = g.best("t" + trackKey);
      GK.text(ctx, (b != null ? "best " + fmtTime(b / 1000) + "   " : "") + "piece " + Math.min(done, need.length) + "/" + need.length, W / 2, 60, 12, "#C8D4F0", "center", "normal");
      // small map
      const ms = 7, mx = W - 12 - N * ms, my = 12;
      ctx.globalAlpha = 0.85;
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) pic(ctx, grid[z * N + x], mx + x * ms, my + z * ms, ms);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(8,12,34,0.8)"; ctx.lineWidth = 2; ctx.strokeRect(mx - 1, my - 1, N * ms + 2, N * ms + 2);
      ctx.fillStyle = "#FF2A2A"; ctx.beginPath(); ctx.arc(mx + car.x / TILE * ms, my + car.z / TILE * ms, 3, 0, 6.283); ctx.fill();
      ctx.strokeStyle = "#FFF"; ctx.lineWidth = 1; ctx.stroke();
      if (state === "count") GK.text(ctx, String(Math.max(1, Math.ceil(countT / 0.8))), W / 2, H / 2 - 40, 90, "#FFFFFF", "center");
      else if (state === "race" && raceT < 1) GK.text(ctx, "GO!", W / 2, H / 2 - 40, 90, "#6CFF8A", "center");
      if (state === "menu") g.banner("Stunt Track", ["Drive one lap as fast as you can.", "Loops need speed. Jumps need more.", "Press Enter or click to start."]);
      else if (state === "bad") g.banner("This track is not finished", ["Press Edit track to repair it."]);
      else if (state === "crash") g.banner("Crashed", [why, "Press Enter or click to try again."]);
      else if (state === "done") g.banner("Finished: " + fmtTime(lastTime), [b != null && Math.round(lastTime * 1000) <= b ? "Your best time on this track." : "Best: " + (b != null ? fmtTime(b / 1000) : "-"), "Press Enter or click to drive again."]);
    }

    /* ---- buttons and keys ---- */
    function setEdit(on) {
      const b = g.q("edit");
      if (on) {
        if (sel.value !== "my") { sel.value = "my"; grid = loadMine(); trace = ST.trace(grid); need = trace.path.filter(p => !p.air); }
        trackKey = "m"; state = "edit"; g.playing = false; g.setPaused(false); stopEngine();
        b.textContent = "Drive"; b.classList.add("is-default");
        g.status(trace.ok ? "Editing My track. Click a piece on the right, then squares on the map. Press Drive when it is a closed circuit." : trace.error);
      } else {
        b.textContent = "Edit track"; b.classList.remove("is-default");
        state = "menu"; useGrid(grid, "my"); toMenu();
      }
    }
    g.q("edit").addEventListener("click", () => setEdit(state !== "edit"));
    sel.addEventListener("change", () => { if (state === "edit") { g.q("edit").textContent = "Edit track"; g.q("edit").classList.remove("is-default"); state = "menu"; } pickTrack(sel.value); });
    g.q("new").addEventListener("click", () => { if (state !== "edit") startRun(); });
    function setView() { view = 1 - view; cam.set = false; g.q("view").textContent = view ? "View: driver" : "View: behind"; }
    g.q("view").addEventListener("click", setView);
    g.q("copy").addEventListener("click", () => {
      const code = ST.encode(grid), f = g.q("code");
      f.value = code;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(() => g.status("The track code was copied. Anyone can paste it into the Track code box and press Load code."), () => g.status("The track code is in the box: select it and copy it."));
      else { f.select(); g.status("The track code is in the box: copy it from there."); }
    });
    function loadCode() {
      const gr = ST.decode(g.q("code").value);
      g.q("code").blur();
      if (!gr) { g.status("That is not a track code (it must be " + (N * N) + " letters and digits)."); return; }
      grid = gr; saveMine(); sel.value = "my"; g.q("code").value = "";
      if (state === "edit") { trace = ST.trace(grid); need = trace.path.filter(p => !p.air); g.status(trace.ok ? "Track loaded." : trace.error); }
      else pickTrack("my");
    }
    g.q("load").addEventListener("click", loadCode);
    g.q("code").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); loadCode(); } });
    g.onKey = code => {
      if (state === "edit") { if (code === "KeyT") pickR = (pickR + 1) % 4; return; }
      if (code === "KeyV" || code === "KeyC") { setView(); return; }
      if (code === "KeyR") { startRun(); return; }
      if ((code === "Enter" || code === "Space") && (state === "menu" || state === "crash" || state === "done")) startRun();
    };
    g.onDown = (x, y, e) => {
      if (state === "edit") editClick(x, y, e);
      else if (state === "menu" || state === "crash" || state === "done") startRun();
    };

    pickTrack("0");
    g.start({ update, draw });
    return { destroy() { stopEngine(); g.destroy(); } };
  }
  return { init };
})();
