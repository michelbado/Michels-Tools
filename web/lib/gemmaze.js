/* Gem Maze: the rules of the puzzle, with no drawing in it (the page in apps/gemmaze draws; a script can replay a solution).
 *
 * A level is a list of text rows. One character is one square:
 *   #  wall            (space) floor       @  start            E  exit (opens when every gem is collected)
 *   *  gem             r g b y  keys       R G B Y  doors (each door uses up one key of its colour)
 *   ~  water (needs flippers f)            ^  fire (needs fire boots h)
 *   i  ice (you slide; skates s stop that) A > V <  conveyor up, right, down, left (magnet boots m ignore it)
 *   o  crate (push it; into water it becomes a bridge, onto a bomb both disappear)        X  bomb
 *   T  button: flips every switch wall     x  switch wall, closed                         _  switch wall, open
 *   Q  teleport (to the next one)          K  thief (takes all boots)
 *   1  creature going left-right           2  creature going up-down
 *   3  creature that follows the wall on its left                4  creature that walks towards you
 * Time moves in steps. Each step the player moves one square (or waits); creatures move every second step.
 */
window.GemMaze = (() => {
  "use strict";
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // up, right, down, left
  const CONV = { A: 0, ">": 1, V: 2, "<": 3 };
  const KEYS = "rgby", DOORS = "RGBY", BOOTS = "fhsm";

  function load(level) {
    const rows = level.rows, h = rows.length, w = Math.max.apply(null, rows.map(r => r.length));
    const s = { w, h, g: new Array(w * h).fill("#"), px: 0, py: 0, dir: 2, slide: null, tick: 0, gems: 0, keys: { r: 0, g: 0, b: 0, y: 0 }, boots: { f: false, h: false, s: false, m: false }, mon: [], tele: [], dead: null, won: false };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let c = rows[y][x] || "#";
      if (c === "@") { s.px = x; s.py = y; c = " "; }
      else if (c >= "1" && c <= "4") { s.mon.push({ t: Number(c), x, y, d: c === "2" ? 2 : 1 }); c = " "; }
      else if (c === "*") s.gems++;
      else if (c === "Q") s.tele.push(y * w + x);
      s.g[y * w + x] = c;
    }
    return s;
  }
  function clone(s) {
    return { w: s.w, h: s.h, g: s.g.slice(), px: s.px, py: s.py, dir: s.dir, slide: s.slide, tick: s.tick, gems: s.gems, keys: Object.assign({}, s.keys), boots: Object.assign({}, s.boots), mon: s.mon.map(m => ({ t: m.t, x: m.x, y: m.y, d: m.d })), tele: s.tele, dead: s.dead, won: s.won };
  }
  const at = (s, x, y) => (x < 0 || y < 0 || x >= s.w || y >= s.h) ? "#" : s.g[y * s.w + x];
  const monsterAt = (s, x, y) => s.mon.some(m => m.x === x && m.y === y);

  function canEnter(s, d) {
    const x = s.px + DIRS[d][0], y = s.py + DIRS[d][1], c = at(s, x, y);
    if (c === "#" || c === "x") return false;
    if (DOORS.includes(c)) return s.keys[c.toLowerCase()] > 0;
    if (c === "E") return s.gems === 0;
    if (c === "o") { const b = at(s, x + DIRS[d][0], y + DIRS[d][1]); return (b === " " || b === "~" || b === "X") && !monsterAt(s, x + DIRS[d][0], y + DIRS[d][1]); }
    return true;
  }
  function tryMove(s, d, ev) {
    s.dir = d;
    if (!canEnter(s, d)) { s.slide = null; ev.push("bump"); return; }
    const x = s.px + DIRS[d][0], y = s.py + DIRS[d][1], i = y * s.w + x;
    let c = s.g[i];
    if (DOORS.includes(c)) { s.keys[c.toLowerCase()]--; s.g[i] = c = " "; ev.push("door"); }
    else if (c === "o") {
      const j = (y + DIRS[d][1]) * s.w + x + DIRS[d][0], b = s.g[j];
      s.g[j] = b === " " ? "o" : " "; s.g[i] = c = " ";
      ev.push(b === "~" ? "splash" : b === "X" ? "boom" : "push");
    }
    s.px = x; s.py = y; s.slide = null;
    if (monsterAt(s, x, y)) { s.dead = "caught"; return; }
    if (c === "*") { s.gems--; s.g[i] = " "; ev.push("gem"); }
    else if (KEYS.includes(c)) { s.keys[c]++; s.g[i] = " "; ev.push("key"); }
    else if (BOOTS.includes(c)) { s.boots[c] = true; s.g[i] = " "; ev.push("boots"); }
    else if (c === "~") { if (!s.boots.f) s.dead = "water"; }
    else if (c === "^") { if (!s.boots.h) s.dead = "fire"; }
    else if (c === "X") s.dead = "bomb";
    else if (c === "K") { if (s.boots.f || s.boots.h || s.boots.s || s.boots.m) ev.push("thief"); s.boots = { f: false, h: false, s: false, m: false }; }
    else if (c === "T") { for (let k = 0; k < s.g.length; k++) { if (s.g[k] === "x") s.g[k] = "_"; else if (s.g[k] === "_") s.g[k] = "x"; } ev.push("button"); }
    else if (c === "Q") { const n = s.tele[(s.tele.indexOf(i) + 1) % s.tele.length]; s.px = n % s.w; s.py = (n - s.px) / s.w; ev.push("teleport"); if (monsterAt(s, s.px, s.py)) s.dead = "caught"; }
    else if (c === "E") { s.won = true; ev.push("win"); }
    else if (c === "i" && !s.boots.s) s.slide = d;
    if (ev.length === 0) ev.push("step");
  }
  function moveMonsters(s) {
    const free = (m, d) => { const x = m.x + DIRS[d][0], y = m.y + DIRS[d][1]; return at(s, x, y) === " " && !s.mon.some(o => o !== m && o.x === x && o.y === y); };
    for (const m of s.mon) {
      let d = -1;
      if (m.t === 1 || m.t === 2) { if (free(m, m.d)) d = m.d; else if (free(m, (m.d + 2) % 4)) d = (m.d + 2) % 4; }
      else if (m.t === 3) { for (const k of [3, 0, 1, 2]) { const t = (m.d + k) % 4; if (free(m, t)) { d = t; break; } } }
      else {
        const dx = s.px - m.x, dy = s.py - m.y, hx = dx > 0 ? 1 : 3, vy = dy > 0 ? 2 : 0;
        const order = Math.abs(dx) >= Math.abs(dy) ? [dx ? hx : -1, dy ? vy : -1] : [dy ? vy : -1, dx ? hx : -1];
        for (const t of order) if (t >= 0 && free(m, t)) { d = t; break; }
      }
      if (d >= 0) { m.d = d; m.x += DIRS[d][0]; m.y += DIRS[d][1]; }
      if (m.x === s.px && m.y === s.py) s.dead = "caught";
    }
  }
  // one step of time. act: 0 up, 1 right, 2 down, 3 left, -1 wait. Returns what happened (for sounds).
  function step(s, act) {
    const ev = [];
    if (s.dead || s.won) return ev;
    let d = act;
    const here = s.g[s.py * s.w + s.px];
    if (s.slide != null && here === "i" && !s.boots.s) d = s.slide;
    else {
      s.slide = null;
      if (CONV[here] != null && !s.boots.m) { const f = CONV[here]; if (!(d >= 0 && d % 2 !== f % 2 && canEnter(s, d))) d = f; }
    }
    if (d >= 0) tryMove(s, d, ev);
    if (!s.dead && !s.won && s.tick % 2 === 1) moveMonsters(s);
    s.tick++;
    if (s.dead) ev.push("dead");
    return ev;
  }
  // is the player being moved by the floor (so a key press would be ignored)?
  function forced(s) {
    const here = s.g[s.py * s.w + s.px];
    return (s.slide != null && here === "i" && !s.boots.s) || (CONV[here] != null && !s.boots.m);
  }
  return { load, clone, step, forced, DIRS };
})();
