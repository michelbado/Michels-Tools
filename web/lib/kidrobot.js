/* Robot Path: the rules and the levels. A robot stands on a grid, faces one way, and follows a list of commands to reach the star.
   Commands: "F" one step forward, "L" turn left, "R" turn right. Walking into a rock or the edge just bumps: the robot stays where it is.
   x grows to the right, y grows downwards; d = 0 north, 1 east, 2 south, 3 west.
   Pure code (also runs in Node): run() plays a program, solve() finds the shortest one, so every level is proven solvable. Exports window.KidRobot. */
(() => {
  "use strict";
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  // w, h, start [x, y, d], goal [x, y], rocks [[x, y], ...]
  const LEVELS = [
    { w: 5, h: 3, start: [0, 1, 1], goal: [3, 1], rocks: [] },
    { w: 5, h: 3, start: [0, 1, 1], goal: [4, 1], rocks: [] },
    { w: 5, h: 5, start: [0, 0, 1], goal: [2, 2], rocks: [] },
    { w: 5, h: 5, start: [0, 4, 1], goal: [3, 2], rocks: [] },
    { w: 5, h: 5, start: [0, 0, 1], goal: [4, 3], rocks: [[2, 0]] },
    { w: 5, h: 5, start: [0, 2, 1], goal: [4, 2], rocks: [[2, 2]] },
    { w: 5, h: 5, start: [0, 4, 0], goal: [4, 0], rocks: [[0, 1], [2, 3], [3, 1]] },
    { w: 6, h: 5, start: [0, 0, 2], goal: [5, 4], rocks: [[0, 2], [2, 3], [3, 1], [4, 3]] },
    { w: 6, h: 5, start: [5, 4, 3], goal: [0, 0], rocks: [[3, 4], [1, 2], [2, 1], [4, 2], [4, 0]] },
    { w: 6, h: 5, start: [4, 3, 1], goal: [0, 1], rocks: [[1, 1], [3, 4], [2, 3], [1, 2], [4, 1], [4, 2]] },
    { w: 6, h: 6, start: [0, 0, 1], goal: [5, 5], rocks: [[1, 0], [1, 2], [2, 2], [3, 1], [3, 3], [4, 3], [2, 4], [5, 4], [0, 4]] },
    { w: 6, h: 6, start: [0, 5, 0], goal: [5, 0], rocks: [[0, 3], [1, 1], [2, 4], [3, 2], [4, 4], [5, 2], [3, 0]] },
  ];

  const blocked = (lv, x, y) => x < 0 || y < 0 || x >= lv.w || y >= lv.h || lv.rocks.some(r => r[0] === x && r[1] === y);
  // plays the program; stops as soon as the robot stands on the star. steps[i] is the state after command i.
  function run(lv, prog) {
    let x = lv.start[0], y = lv.start[1], d = lv.start[2], reached = false, bumps = 0;
    const steps = [];
    for (const c of prog) {
      let bump = false;
      if (c === "L") d = (d + 3) % 4; else if (c === "R") d = (d + 1) % 4;
      else if (c === "F") { const nx = x + DX[d], ny = y + DY[d]; if (blocked(lv, nx, ny)) { bump = true; bumps++; } else { x = nx; y = ny; } }
      steps.push({ x, y, d, c, bump });
      if (x === lv.goal[0] && y === lv.goal[1]) { reached = true; break; }
    }
    return { steps, reached, bumps };
  }
  // breadth-first search over (x, y, d): the length of the shortest program, with the program itself; null if none
  function solve(lv) {
    const key = (x, y, d) => (y * lv.w + x) * 4 + d, seen = new Set([key(...lv.start)]);
    let layer = [{ x: lv.start[0], y: lv.start[1], d: lv.start[2], p: "" }];
    if (lv.start[0] === lv.goal[0] && lv.start[1] === lv.goal[1]) return "";
    while (layer.length) {
      const next = [];
      for (const s of layer) for (const c of ["F", "L", "R"]) {
        let { x, y, d } = s;
        if (c === "L") d = (d + 3) % 4; else if (c === "R") d = (d + 1) % 4; else { const nx = x + DX[d], ny = y + DY[d]; if (blocked(lv, nx, ny)) continue; x = nx; y = ny; }
        const k = key(x, y, d); if (seen.has(k)) continue; seen.add(k);
        const p = s.p + c; if (x === lv.goal[0] && y === lv.goal[1]) return p;
        next.push({ x, y, d, p });
      }
      layer = next;
    }
    return null;
  }
  // the room given in the program strip: the shortest program plus some slack, at least 6 places
  function capacity(lv) { const s = solve(lv); return Math.max(6, (s ? s.length : 6) + 4); }
  const api = { LEVELS, DX, DY, run, solve, capacity, blocked };
  if (typeof window !== "undefined") window.KidRobot = api;
  if (typeof module !== "undefined") module.exports = api;
})();
