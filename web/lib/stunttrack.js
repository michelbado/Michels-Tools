/* Stunt Track: the track pieces, the shape of their surface, the check that a track is one closed circuit, and the track code.
 * No drawing in here (apps/stunt draws), so a script can check the built-in tracks.
 *
 * The world is a grid of N x N tiles, TILE metres each; x grows to the east, z to the south, y is up.
 * A piece has a turn 0..3: the way its own "forward" (u) points: 0 east, 1 south, 2 west, 3 north; its "right" (v) is 90 degrees clockwise.
 * Inside a tile, u and v run from -0.5 to 0.5.
 */
window.StuntTrack = (() => {
  "use strict";
  const N = 14, TILE = 30, HW = 5 / TILE, RAMP_H = 5, HILL_H = 3.5, BANK_H = 2.4, LOOP_R = 8, CORK_R = 4;
  const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
  // id, name, and the edges the road leaves by (0 forward, 1 right, 2 back, 3 left); kind groups pieces that behave alike
  const PIECES = [
    { id: ".", name: "Grass", ends: null },
    { id: "s", name: "Straight", ends: [2, 0] },
    { id: "f", name: "Start / finish", ends: [2, 0] },
    { id: "c", name: "Corner", ends: [2, 1] },
    { id: "k", name: "Banked corner", ends: [2, 1] },
    { id: "h", name: "Hill", ends: [2, 0] },
    { id: "r", name: "Ramp", ends: [2, 0] },
    { id: "e", name: "Raised road", ends: [2, 0] },
    { id: "x", name: "Chicane", ends: [2, 0] },
    { id: "l", name: "Loop", ends: [2, 0] },
    { id: "w", name: "Corkscrew", ends: [2, 0] },
    { id: "t", name: "Tunnel", ends: [2, 0] },
    { id: "W", name: "Water", ends: null },
    { id: "T", name: "Trees", ends: null },
  ];
  const INDEX = {};
  PIECES.forEach((p, i) => { INDEX[p.id] = i; });
  const TREES = [[-0.28, -0.25], [0.22, -0.3], [-0.1, 0.24], [0.3, 0.2]];
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  const empty = () => Array.from({ length: N * N }, () => ({ p: ".", r: 0 }));
  const cell = (grid, x, z) => (x < 0 || z < 0 || x >= N || z >= N) ? null : grid[z * N + x];
  const rampShape = t => t < 0.3 ? t * t / 0.51 : (2 * t - 0.3) / 1.7;

  // the surface of one piece at a point inside its tile: height in metres, and whether that point is road
  function surf(p, u, v) {
    switch (p) {
      case "s": case "f": case "t": case "l": case "w": return { h: 0, road: Math.abs(v) < HW };
      case "h": { const road = Math.abs(v) < HW, s = Math.sin(Math.PI * (u + 0.5)); return { h: road ? HILL_H * s * s : 0, road }; }
      case "r": { const road = Math.abs(v) < HW; return { h: road ? RAMP_H * rampShape(u + 0.5) : 0, road }; }
      case "e": { const road = Math.abs(v) < HW; return { h: road ? RAMP_H : 0, road }; }
      case "x": return { h: 0, road: Math.abs(v - 0.14 * Math.sin(2 * Math.PI * (u + 0.5))) < HW };
      case "c": case "k": {
        const du = u + 0.5, dv = v - 0.5, r = Math.sqrt(du * du + dv * dv), road = Math.abs(r - 0.5) < HW;
        if (p === "c" || !road) return { h: 0, road };
        const a = Math.atan2(du, -dv);   // 0 where the road comes in, 90 degrees where it leaves
        return { h: BANK_H * Math.sin(2 * a) * (r - 0.5 + HW) / (2 * HW), road };
      }
      default: return { h: 0, road: false };
    }
  }
  // world position -> the tile, the place inside it, and the surface there
  function at(grid, x, z) {
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE), c = cell(grid, tx, tz);
    if (!c) return { h: 0, road: false, p: ".", tx, tz, u: 0, v: 0, r: 0, out: true };
    const lx = x / TILE - tx - 0.5, lz = z / TILE - tz - 0.5, ux = DX[c.r], uz = DZ[c.r];
    const u = lx * ux + lz * uz, v = -lx * uz + lz * ux, s = surf(c.p, u, v);
    let tree = false;
    if (c.p === "T") for (const t of TREES) if (Math.hypot(u - t[0], v - t[1]) * TILE < 1.6) tree = true;
    return { h: s.h, road: s.road, p: c.p, tx, tz, u, v, r: c.r, tree };
  }
  // local (u, v) of a tile -> world x, z (metres)
  function toWorld(tx, tz, r, u, v) { return [(tx + 0.5 + u * DX[r] - v * DZ[r]) * TILE, (tz + 0.5 + u * DZ[r] + v * DX[r]) * TILE]; }

  // Follow the road from the start piece. Returns { ok, path: [{x, z, d, p, air}], error, at: [x, z] }.
  function trace(grid) {
    const si = grid.findIndex(c => c.p === "f");
    if (si < 0) return { ok: false, error: "The track has no start / finish piece.", path: [] };
    if (grid.filter(c => c.p === "f").length > 1) return { ok: false, error: "The track has more than one start / finish piece.", path: [] };
    let x = si % N, z = (si - x) / N, d = grid[si].r, high = false;
    const sx = x, sz = z, path = [{ x, z, d, p: "f" }];
    for (let step = 0; step < 400; step++) {
      let nx = x + DX[d], nz = z + DZ[d], c = cell(grid, nx, nz);
      const from = cell(grid, x, z);
      // off the high end of a ramp with no raised road ahead: a jump. Look for a ramp facing us across at most three tiles.
      if (high && from.p === "r" && !(c && ((c.p === "e" && c.r % 2 === d % 2) || (c.p === "r" && c.r === (d + 2) % 4)))) {
        let found = false;
        for (let k = 0; k < 4 && !found; k++) {
          const cx = x + DX[d] * (k + 1), cz = z + DZ[d] * (k + 1), cc = cell(grid, cx, cz);
          if (!cc) break;
          if (cc.p === "r" && cc.r === (d + 2) % 4) { found = true; nx = cx; nz = cz; c = cc; }
          else if (PIECES[INDEX[cc.p]].ends) return { ok: false, error: "The jump lands on a piece that is not a ramp facing it.", at: [cx, cz], path };
          else path.push({ x: cx, z: cz, d, p: cc.p, air: true });
        }
        if (!found) return { ok: false, error: "The ramp leads to a jump with no ramp to land on (at most three tiles of gap).", at: [x, z], path };
      }
      if (!c) return { ok: false, error: "The road runs off the edge of the map.", at: [x, z], path };
      const def = PIECES[INDEX[c.p]];
      if (!def.ends) return { ok: false, error: "The road stops: the next tile has no road.", at: [nx, nz], path };
      const back = (d + 2) % 4, e = def.ends.map(k => (c.r + k) % 4), i = e.indexOf(back);
      if (i < 0) return { ok: false, error: "The next piece does not line up with the road (turn it).", at: [nx, nz], path };
      if (nx === sx && nz === sz) {
        if (i !== 0) return { ok: false, error: "The road comes back to the start from the wrong side.", at: [nx, nz], path };
        if (high) return { ok: false, error: "The road reaches the start while still raised.", at: [nx, nz], path };
        return { ok: true, path };
      }
      if (c.p === "r") {
        const upward = i === 0;   // came in by its low end
        if (upward === high) return { ok: false, error: upward ? "A ramp going up cannot start on raised road." : "A ramp going down must be reached at its high end.", at: [nx, nz], path };
        high = upward;
      } else if (c.p === "e") { if (!high) return { ok: false, error: "Raised road must be reached by a ramp.", at: [nx, nz], path }; }
      else if (high) return { ok: false, error: "After raised road a ramp must bring the road down again.", at: [nx, nz], path };
      if (path.some(q => q.x === nx && q.z === nz && !q.air)) return { ok: false, error: "The road crosses itself.", at: [nx, nz], path };
      d = e[1 - i]; x = nx; z = nz;
      path.push({ x, z, d, p: c.p });
    }
    return { ok: false, error: "The road never comes back to the start.", path };
  }

  // The path of the car on a loop or corkscrew, in the tile's own frame: t from 0 to 1 gives position [u, y, v] and "up", in metres.
  const LOOP_LEN = TILE + 2 * Math.PI * LOOP_R, CORK_RUN = TILE - 8, CORK_LEN = 8 + Math.sqrt(CORK_RUN * CORK_RUN + Math.pow(2 * Math.PI * CORK_R, 2));
  function rail(p, s) {
    if (p === "l") {
      const half = TILE / 2;
      if (s < half) return { pos: [s - half, 0, 0], up: [0, 1, 0], k: 0 };
      if (s > half + 2 * Math.PI * LOOP_R) return { pos: [s - half - 2 * Math.PI * LOOP_R, 0, 0], up: [0, 1, 0], k: 0 };
      const a = (s - half) / LOOP_R;
      return { pos: [LOOP_R * Math.sin(a), LOOP_R * (1 - Math.cos(a)), 0], up: [-Math.sin(a), Math.cos(a), 0], k: 1 / LOOP_R };
    }
    const hel = CORK_LEN - 8;
    if (s < 4) return { pos: [s - TILE / 2, 0, 0], up: [0, 1, 0], k: 0 };
    if (s > 4 + hel) return { pos: [TILE / 2 - (CORK_LEN - s), 0, 0], up: [0, 1, 0], k: 0 };
    const q = (s - 4) / hel, a = q * 2 * Math.PI, da = 2 * Math.PI / hel;
    return { pos: [-TILE / 2 + 4 + q * CORK_RUN, CORK_R * (1 - Math.cos(a)), CORK_R * Math.sin(a)], up: [0, Math.cos(a), -Math.sin(a)], k: CORK_R * da * da };
  }
  const railLength = p => p === "l" ? LOOP_LEN : CORK_LEN;

  /* ---- track code: one character for each tile ---- */
  function encode(grid) { return grid.map(c => ALPHA[INDEX[c.p] * 4 + c.r]).join(""); }
  function decode(code) {
    code = String(code || "").replace(/\s+/g, "");
    if (code.length !== N * N) return null;
    const g = [];
    for (const ch of code) { const i = ALPHA.indexOf(ch); if (i < 0 || i >= PIECES.length * 4) return null; g.push({ p: PIECES[i >> 2].id, r: i & 3 }); }
    return g;
  }
  // Build a track by "driving" it: a list of moves from a start tile. S straight, F start, R/L corners, B/b banked right/left, H hill, X chicane,
  // U ramp up, E raised road, D ramp down, J one tile of jump gap (left as it is), O loop, C corkscrew, T tunnel. extras: [[x, z, piece], ...]
  function build(x, z, d, moves, extras) {
    const g = empty();
    const put = (p, r) => { if (cell(g, x, z)) g[z * N + x] = { p, r: ((r % 4) + 4) % 4 }; };
    for (const m of moves) {
      if (m === "R" || m === "B") { put(m === "R" ? "c" : "k", d); d = (d + 1) % 4; }
      else if (m === "L" || m === "b") { put(m === "L" ? "c" : "k", d + 1); d = (d + 3) % 4; }
      else if (m === "D") put("r", d + 2);
      else if (m !== "J") put({ S: "s", F: "f", H: "h", X: "x", U: "r", E: "e", O: "l", C: "w", T: "t" }[m], d);
      x += DX[d]; z += DZ[d];
    }
    (extras || []).forEach(e => { if (cell(g, e[0], e[1]) && g[e[1] * N + e[0]].p === ".") g[e[1] * N + e[0]] = { p: e[2], r: 0 }; });
    return g;
  }
  const BUILTIN = [
    { name: "Sunday Drive", grid: () => build(3, 2, 0, "FSSHSSXSRSSHSSRSSSTSSSSRSXSSSR", [[5, 4, "T"], [6, 5, "T"], [8, 5, "W"], [7, 4, "T"]]) },
    { name: "First Jump", grid: () => build(3, 2, 0, "FSSUJDSSBSSHSSBSUEEDSSSBSSXSSB", [[6, 2, "W"], [5, 5, "T"], [8, 4, "T"]]) },
    { name: "Loop the Loop", grid: () => build(3, 1, 0, "FSSSOSSS" + "R" + "SSCSS" + "R" + "SS" + "L" + "SS" + "R" + "SSUJD" + "R" + "SSXSSSSS" + "R", [[4, 10, "W"], [5, 5, "T"], [6, 8, "T"], [9, 4, "T"]]) },
    { name: "Twister", grid: () => build(3, 1, 0, "FSXS" + "R" + "S" + "L" + "SXS" + "R" + "SS" + "R" + "SXS" + "L" + "S" + "R" + "SSSS" + "R" + "SHSSSS" + "R", [[5, 4, "T"], [9, 5, "W"], [4, 6, "T"], [9, 1, "T"]]) },
    { name: "Big Air", grid: () => build(2, 1, 0, "FSSSS" + "UJJD" + "S" + "B" + "SSSOSSCS" + "B" + "SSUEEEDSSH" + "B" + "SSSHSSST" + "B", [[8, 1, "W"], [9, 1, "W"], [5, 5, "T"], [8, 7, "T"], [4, 8, "W"]]) },
  ];

  return { N, TILE, HW, RAMP_H, LOOP_R, CORK_R, PIECES, INDEX, TREES, DX, DZ, empty, cell, surf, at, toWorld, trace, rail, railLength, encode, decode, build, BUILTIN };
})();
