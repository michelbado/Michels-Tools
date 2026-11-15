/* Maze Walk: a perfect maze (one way between any two squares) made by a random walk, plus a shortest-path finder.
   Cell flags: N = 1, E = 2, S = 4, W = 8 mean "open to that side". Pure code, also runs in Node. Exports window.KidMaze. */
(() => {
  "use strict";
  const N = 1, E = 2, S = 4, W = 8, DIRS = [[N, 0, -1, S], [E, 1, 0, W], [S, 0, 1, N], [W, -1, 0, E]];
  function make(w, h, rng) {
    const r = rng || Math.random, cells = new Array(w * h).fill(0), seen = new Array(w * h).fill(false), stack = [[0, 0]];
    seen[0] = true;
    while (stack.length) {
      const [x, y] = stack[stack.length - 1], opts = [];
      for (const [bit, dx, dy, back] of DIRS) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && !seen[ny * w + nx]) opts.push([bit, nx, ny, back]); }
      if (!opts.length) { stack.pop(); continue; }
      const [bit, nx, ny, back] = opts[Math.floor(r() * opts.length)];
      cells[y * w + x] |= bit; cells[ny * w + nx] |= back; seen[ny * w + nx] = true; stack.push([nx, ny]);
    }
    return { w, h, cells, start: [0, 0], goal: [w - 1, h - 1] };
  }
  const open = (m, x, y, bit) => (m.cells[y * m.w + x] & bit) !== 0;
  // cells reachable in one step
  function next(m, x, y) { const out = []; for (const [bit, dx, dy] of DIRS) if (open(m, x, y, bit)) out.push([x + dx, y + dy]); return out; }
  // shortest path from a to b as a list of [x, y] including both ends (null if not connected)
  function path(m, a, b) {
    const key = (x, y) => y * m.w + x, prev = new Map([[key(...a), null]]), q = [a];
    while (q.length) {
      const c = q.shift(); if (c[0] === b[0] && c[1] === b[1]) { const p = []; for (let k = key(...c); k != null; k = prev.get(k)) p.unshift([k % m.w, Math.floor(k / m.w)]); return p; }
      for (const n of next(m, c[0], c[1])) { const k = key(...n); if (!prev.has(k)) { prev.set(k, key(...c)); q.push(n); } }
    }
    return null;
  }
  // how big the maze is at a given level: 5 x 5 up to 10 x 10
  const sizeFor = level => Math.min(10, 5 + Math.floor(level));
  const api = { N, E, S, W, DIRS, make, next, path, sizeFor, open };
  if (typeof window !== "undefined") window.KidMaze = api;
  if (typeof module !== "undefined") module.exports = api;
})();
