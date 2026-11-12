/* Connection Quality: how fast is a transfer, and when has it run long enough? Pure maths, no screen code, so it can be tested on its own.

   A transfer is a list of points { t, b }: t = milliseconds since the transfer began, b = bytes carried so far (cumulative).
   A line needs a moment to speed up (TCP slow start, buffers filling), so the first second is never used for the figure. The test
   stops as soon as the speed has settled, so a slow line uses only a few MB, or when the data limit is reached.

   judge(points, opts) says what to do now:
     { done: false }                                  keep going
     { done: true, reason, mbps, atLeast, steady }    reason: "steady" | "limit" | "time" | "nodata"
   "atLeast" = the limit stopped the test before the speed settled: the figure is a lower bound ("at least X").
   "steady"  = the last 2.5 seconds agreed within the tolerance.                                                          */
(() => {
  "use strict";

  const MB = 1e6;
  // what each level may spend, per direction (bytes) and at most how long (ms); the title says it to the visitor
  const LEVELS = {
    none: { label: "No transfer", down: 0, up: 0, maxMs: 0, total: 0 },
    light: { label: "Light", down: 10 * MB, up: 5 * MB, maxMs: 8000, total: 15 * MB },
    full: { label: "Full", down: 100 * MB, up: 50 * MB, maxMs: 12000, total: 150 * MB },
  };
  const WARM = 1000, WIN = 1000, STEP = 500, TOL = 0.12, NEED = WARM + WIN + 3 * STEP;   // need 3.5 s before "steady" can be judged: four overlapping windows span the last 2.5 s

  // cumulative bytes at time t (linear between points; the last value beyond the end)
  function bytesAt(pts, t) {
    if (!pts.length || t <= pts[0].t) return pts.length && t >= pts[0].t ? pts[0].b : 0;
    let lo = 0, hi = pts.length - 1;
    if (t >= pts[hi].t) return pts[hi].b;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid; }
    const a = pts[lo], b = pts[hi];
    return b.t === a.t ? b.b : a.b + (b.b - a.b) * (t - a.t) / (b.t - a.t);
  }
  // megabits per second between two moments
  const rate = (pts, t0, t1) => (t1 > t0 ? ((bytesAt(pts, t1) - bytesAt(pts, t0)) * 8) / 1000 / (t1 - t0) : NaN);   // bytes*8 / 1000 / ms = Mbit/s

  // the last four overlapping one-second windows (2.5 s): do they agree?
  function recent(pts, end) {
    const rs = [0, 1, 2, 3].map(k => rate(pts, end - k * STEP - WIN, end - k * STEP));
    if (rs.some(x => !Number.isFinite(x))) return null;
    const sorted = rs.slice().sort((x, y) => x - y), med = (sorted[1] + sorted[2]) / 2;
    const spread = med > 0 ? (sorted[3] - sorted[0]) / med : Infinity;
    return { rs, spread, steady: spread <= TOL };
  }

  function judge(points, o = {}) {
    const cap = o.capBytes, maxMs = o.maxMs, pts = points;
    if (!pts.length) return { done: false };
    const last = pts[pts.length - 1], t = last.t, total = last.b;
    if (cap > 0 && total >= cap) {
      const r = t >= NEED ? recent(pts, t) : null;
      if (r && r.steady) return { done: true, reason: "limit", mbps: rate(pts, t - 2500, t), atLeast: false, steady: true, bytes: total, ms: t };
      return { done: true, reason: "limit", mbps: bestWindow(pts, t), atLeast: true, steady: false, bytes: total, ms: t };
    }
    if (t >= NEED) {
      const r = recent(pts, t);
      if (r && r.steady) return { done: true, reason: "steady", mbps: rate(pts, t - 2500, t), atLeast: false, steady: true, bytes: total, ms: t };
    }
    if (maxMs > 0 && t >= maxMs) {
      if (total <= 0) return { done: true, reason: "nodata", mbps: NaN, atLeast: false, steady: false, bytes: 0, ms: t };
      const from = Math.max(WARM, t - 3000);
      return { done: true, reason: "time", mbps: rate(pts, from, t), atLeast: false, steady: false, bytes: total, ms: t };
    }
    return { done: false };
  }

  // the fastest one-second stretch (or the whole transfer when it was shorter): a lower bound of what the line can carry
  function bestWindow(pts, t) {
    if (t < WIN) return rate(pts, 0, t);
    let best = 0;
    for (let e = WIN; e <= t; e += 100) { const x = rate(pts, e - WIN, e); if (x > best) best = x; }
    const end = rate(pts, t - WIN, t); if (end > best) best = end;
    return best;
  }

  window.SpeedCalc = { LEVELS, judge, rate, bytesAt, bestWindow, WARM, NEED };
})();
