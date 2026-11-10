/* Connection Quality: turns a list of probe results into verdicts. No screen code here, so it can be tested on its own.

   One probe = one tiny web request to Michel's Tools (origin, "o") or to the CDN's own edge (edge, "e"), sent every 200 ms.
   Sample: { i, ch, t, ok, rtt, timeout, lag, hidden, phase, sa, ss, rs, re, seen }
     i       probe number            ch      "o" origin | "e" edge
     t       when it was sent, ms from the start of the run
     ok/rtt  answered, and how long the answer took (ms)       timeout   no answer in time
     lag     how late the page's own timer fired (ms): the device was busy   hidden   the tab was in the background
     phase   "idle" | "down" | "up"   (what else was running: nothing, a download, an upload)
     sa, ss  when the server received / sent the reply (microseconds of its own clock)
     rs, re  when the browser started sending / finished receiving (ms of its own clock)
     seen    for a timeout, asked afterwards: the server's receive time, or -1 when it never saw the probe

   Speed and quality are judged separately: SPEED is how long answers take (distance), QUALITY is how steady and complete
   they are. A link that always answers in 200 ms is slow but excellent; one that answers in 40 ms but sometimes needs a
   second, or not at all, is fast but poor. */
(() => {
  "use strict";

  /* ---------- small maths ---------- */
  const sortNum = a => a.slice().sort((x, y) => x - y);
  const pct = (sorted, p) => {
    if (!sorted.length) return NaN;
    const k = (sorted.length - 1) * p, lo = Math.floor(k), hi = Math.ceil(k);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
  };
  const median = a => pct(sortNum(a), 0.5);
  const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
  const r1 = x => Math.round(x * 10) / 10;
  const ms = x => (!Number.isFinite(x) ? "?" : x < 10 ? r1(x).toFixed(1) : String(Math.round(x))) + " ms";
  const mmss = t => { const s = Math.max(0, Math.round(t / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  const LEVELS = ["Excellent", "Good", "Unstable", "Poor"];
  const WARMUP = { o: 2, e: 1 };      // the first answers include setting up the connection: left out
  const DEVICE_LAG = 250;             // the page's timer fired this late: the device (not the network) was busy

  /* ---------- speed ---------- */
  function speedLabel(median) {
    if (!Number.isFinite(median)) return { key: "none", label: "No answer" };
    if (median < 30) return { key: "veryclose", label: "Very close" };
    if (median < 80) return { key: "close", label: "Close" };
    if (median < 150) return { key: "moderate", label: "Moderate distance" };
    if (median < 300) return { key: "far", label: "Far away" };
    return { key: "veryfar", label: "Very far away" };
  }

  /* ---------- preparing one series ---------- */
  // The samples of one channel and phase, without warm-up and without moments the device itself was busy.
  function series(samples, ch, phase) {
    const all = samples.filter(s => s.ch === ch && s.phase === phase).sort((a, b) => a.i - b.i);
    const warm = WARMUP[ch] || 0;
    let usable = [], device = 0, warmed = 0, queued = 0;
    for (const s of all) {
      if (phase === "idle" && warmed < warm) { warmed++; continue; }
      if (s.queued) { queued++; continue; }               // an edge probe that only waited in the browser's connection queue

      if (s.hidden || (s.lag || 0) > DEVICE_LAG) { device++; s.deviceBusy = true; continue; }
      usable.push(s);
    }
    return { all, usable, device, queued };
  }

  // the normal delay around each answered sample: a low percentile of its neighbours within +-20 s.
  // Worked out once per second (from at most 240 evenly spread neighbours) so that 12,000 probes are still quick to judge.
  function baselines(ans) {
    const n = ans.length;
    if (!n) return [];
    const globalLow = pct(sortNum(ans.map(s => s.rtt)), 0.15), out = new Array(n), perSecond = new Map();
    let lo = 0, hi = 0;
    for (let k = 0; k < n; k++) {
      const sec = Math.floor(ans[k].t / 1000);
      if (perSecond.has(sec)) { out[k] = perSecond.get(sec); continue; }
      const centre = (sec + 0.5) * 1000;
      while (lo < n && ans[lo].t < centre - 20000) lo++;
      while (hi < n && ans[hi].t <= centre + 20000) hi++;
      const len = hi - lo;
      let v = globalLow;
      if (len >= 8) {
        const stride = Math.max(1, Math.ceil(len / 240)), win = [];
        for (let j = lo; j < hi; j += stride) win.push(ans[j].rtt);
        v = pct(sortNum(win), 0.15);
      }
      perSecond.set(sec, v); out[k] = v;
    }
    return out;
  }
  // how far above this link's normal delay a probe must be to count as slow: 40 ms, or 25 ms in fine mode (20 probes a second),
  // and in both cases at least half of the normal delay. Set by analyze() for the duration of one analysis.
  let spikeFloor = 40;
  let edgeName = "the CDN";            // how the sentences name the CDN in front of the server (set by analyze)
  const upFirst = x => x.charAt(0).toUpperCase() + x.slice(1);
  const spikeThreshold = base => Math.max(spikeFloor, 0.5 * base);

  /* ---------- quality of one series ---------- */
  function measure(ser) {
    const S = ser.usable, ans = S.filter(s => s.ok), timeouts = S.filter(s => s.timeout);
    const m = { n: S.length, answered: ans.length, timeouts: timeouts.length, device: ser.device, queued: ser.queued, enough: S.length >= 20 };
    m.timeoutPct = S.length ? (100 * timeouts.length) / S.length : 0;
    if (!ans.length) { m.level = S.length >= 5 ? 3 : null; m.noAnswer = S.length >= 5; return m; }
    const rtts = ans.map(s => s.rtt), sorted = sortNum(rtts);
    m.min = sorted[0]; m.median = pct(sorted, 0.5); m.p95 = pct(sorted, 0.95); m.max = sorted[sorted.length - 1];
    const base = baselines(ans);
    m.excess = ans.map((s, k) => Math.max(0, s.rtt - base[k]));
    ans.forEach((s, k) => { s.spike = m.excess[k] > spikeThreshold(base[k]); });   // the page colours the dots with this
    m.spikeFloor = spikeFloor;
    m.spikes = ans.filter((s, k) => m.excess[k] > spikeThreshold(base[k])).length;
    m.bigSpikes = ans.filter((s, k) => m.excess[k] > Math.max(150, 2 * base[k])).length;
    m.spikePct = (100 * m.spikes) / ans.length;
    let dj = 0, nj = 0;
    for (let k = 1; k < ans.length; k++) { dj += Math.abs(ans[k].rtt - ans[k - 1].rtt); nj++; }
    m.jitter = nj ? dj / nj : 0;
    m.jitterRel = m.jitter / m.median;
    // the longest time with no answer arriving
    // (a gap in which the device itself was busy or hidden is not the network's silence)
    const deviceAt = ser.all.filter(s => s.deviceBusy || s.queued).map(s => s.i);
    let stall = 0, lastRecv = ans[0].t + ans[0].rtt;
    for (let k = 1; k < ans.length; k++) {
      const recv = ans[k].t + ans[k].rtt;
      if (!deviceAt.some(i => i > ans[k - 1].i && i < ans[k].i)) stall = Math.max(stall, recv - lastRecv);
      lastRecv = recv;
    }
    m.longestStall = stall;
    if (ans.length >= 60) {
      const third = Math.floor(ans.length / 3);
      m.drift = (median(rtts.slice(-third)) - median(rtts.slice(0, third))) / m.median;
    } else m.drift = 0;
    // level per measurement, 0 (excellent) to 3 (poor); the link is as good as its worst measurement
    const lv = {
      timeouts: m.timeoutPct === 0 ? 0 : m.timeoutPct <= 0.5 ? 1 : m.timeoutPct <= 3 ? 2 : 3,
      spikes: m.spikePct <= 2 ? 0 : m.spikePct <= 8 ? 1 : m.spikePct <= 25 ? 2 : 3,
      jitter: m.jitter < 4 || m.jitterRel <= 0.10 ? 0 : m.jitterRel <= 0.25 ? 1 : m.jitterRel <= 0.6 ? 2 : 3,
      stall: m.longestStall <= Math.max(600, 4 * m.median) ? 0 : m.longestStall <= Math.max(1500, 8 * m.median) ? 1 : m.longestStall <= 4000 ? 2 : 3,
      drift: Math.abs(m.drift) <= 0.2 ? 0 : Math.abs(m.drift) <= 0.5 ? 1 : 2,
    };
    m.levels = lv;
    m.level = Math.max(...Object.values(lv));
    return m;
  }

  /* ---------- incidents ---------- */
  function incidents(ser, m, opts) {
    const out = [], S = ser.usable, ans = S.filter(s => s.ok);
    if (!ans.length) return out;
    const base = baselines(ans);
    const exOf = new Map(ans.map((s, k) => [s, Math.max(0, s.rtt - base[k])]));
    const baseOf = new Map(ans.map((s, k) => [s, base[k]]));
    const timeoutLimit = opts.timeoutMs || 3000;

    // 1. probes that got no answer, in groups
    for (let a = 0; a < S.length;) {
      if (!S[a].timeout) { a++; continue; }
      let b = a; while (b + 1 < S.length && S[b + 1].timeout) b++;
      const group = S.slice(a, b + 1), next = S.slice(b + 1).find(s => s.ok);
      const start = group[0].t, end = next ? next.t + next.rtt : group[group.length - 1].t + timeoutLimit;
      const up = group.filter(s => s.seen === -1).length, down = group.filter(s => typeof s.seen === "number" && s.seen >= 0).length, unknown = group.length - up - down;
      let where = "";
      if (up && !down) where = " Michel's Tools never received the request: it was lost on the way there.";
      else if (down && !up) where = " Michel's Tools did receive the request: the reply was lost or too late on the way back.";
      else if (up && down) where = ` Of these, ${up} never arrived and ${down} arrived but the reply did not come back.`;
      const len = group.length;
      out.push({
        type: len >= 3 ? "outage" : "loss", severity: "bad", start, end, count: len, lostUp: up, lostDown: down,
        title: len >= 3 ? "Connection dropped" : "Lost answer" + (len > 1 ? "s" : ""),
        text: `${len} probe${len === 1 ? "" : "s"} in a row got no answer for about ${((end - start) / 1000).toFixed(1)} s.${where}`,
      });
      void unknown;
      a = b + 1;
    }

    // 2. very long answers (stalls), merged when close together
    const stallList = ans.filter(s => exOf.get(s) >= Math.max(800, 4 * baseOf.get(s)));
    for (let a = 0; a < stallList.length;) {
      let b = a; while (b + 1 < stallList.length && stallList[b + 1].t - stallList[b].t < 2500) b++;
      const g = stallList.slice(a, b + 1), worst = Math.max(...g.map(s => s.rtt));
      out.push({
        type: "stall", severity: "bad", start: g[0].t, end: g[g.length - 1].t + g[g.length - 1].rtt, count: g.length,
        title: "Stall", text: `Answers took up to ${ms(worst)} (normally about ${ms(baseOf.get(g[0]))}): everything on this link froze for about ${(worst / 1000).toFixed(1)} s.`,
      });
      a = b + 1;
    }

    // 3. single extra delays of the size a re-sent packet causes (about 0.2-0.5 s, 1 s or 3 s)
    const isoSpikes = ans.filter((s, k) => {
      const ex = exOf.get(s);
      if (ex <= spikeThreshold(base[k]) || ex >= Math.max(800, 4 * base[k]) && ex > 1500) return false;
      const near = [ans[k - 1], ans[k + 1]].filter(Boolean).filter(x => Math.abs(x.t - s.t) < 700);
      return near.every(x => exOf.get(x) <= spikeThreshold(baseOf.get(x)));
    });
    const rto = isoSpikes.filter(s => { const e = exOf.get(s); return (e >= 150 && e <= 650) || (e >= 800 && e <= 1400) || (e >= 2500 && e <= 3600); });
    if (rto.length >= 2 || (rto.length === 1 && m.n >= 20)) {
      const typical = r1(median(rto.map(s => exOf.get(s))));
      out.push({
        type: "rto", severity: rto.length >= 3 ? "warn" : "info", start: rto[0].t, end: rto[rto.length - 1].t + rto[rto.length - 1].rtt, count: rto.length,
        title: "Delays like a re-sent packet",
        text: `${rto.length} answer${rto.length === 1 ? " was" : "s were"} late by a single jump of about ${ms(typical)}, then back to normal. That pattern is typical when one packet is lost and has to be sent again, which makes the web page wait for the resend.`,
      });
    }

    // 4. things that repeat: spikes and lost answers at regular intervals
    const events = [];
    for (const s of S) {
      const isEvent = s.timeout || (s.ok && exOf.get(s) > spikeThreshold(baseOf.get(s)));
      if (isEvent && (!events.length || s.t - events[events.length - 1] > 1500)) events.push(s.t);
    }
    if (events.length >= 4) {
      const gaps = []; for (let k = 1; k < events.length; k++) gaps.push(events[k] - events[k - 1]);
      const P = median(gaps), close = gaps.filter(g => Math.abs(g - P) <= 0.15 * P + 400).length;
      if (close / gaps.length >= 0.6 && P >= 2000) {
        out.push({
          type: "periodic", severity: "warn", start: events[0], end: events[events.length - 1], count: events.length,
          title: "Repeats on a schedule", text: `Delays hit about every ${(P / 1000).toFixed(P >= 10000 ? 0 : 1)} s (${events.length} times). A fixed rhythm usually points to something that works on a timer: a Wi-Fi network scanning for others, a power-saving mode, a backup or sync program, or a shared link with a scheduled job.`,
        });
      }
    }

    // 5. the normal delay changed for good (a different route, a different network)
    const span = (ans[ans.length - 1].t - ans[0].t) / 1000, rate = span > 5 ? Math.min(40, Math.max(1, ans.length / span)) : 5;
    if (ans.length >= 40) {
      const W = Math.max(15, Math.round(3 * rate)), rt = ans.map(s => s.rtt);   // about 3 seconds of probes
      let best = null;
      for (let k = W; k <= ans.length - W; k++) {
        const before = median(rt.slice(k - W, k)), after = median(rt.slice(k, k + W)), diff = after - before;
        if (Math.abs(diff) >= Math.max(30, 0.4 * Math.min(before, after)) && (!best || Math.abs(diff) > Math.abs(best.diff))) best = { k, before, after, diff };
      }
      if (best) {
        const tail = rt.slice(best.k, Math.min(rt.length, best.k + 2 * W)), head = rt.slice(Math.max(0, best.k - 2 * W), best.k);
        const stableAfter = Math.abs(median(tail) - best.after) < 0.25 * best.after + 15, stableBefore = Math.abs(median(head) - best.before) < 0.25 * best.before + 15;
        if (stableAfter && stableBefore) {
          out.push({
            type: "step", severity: "warn", start: ans[best.k].t, end: ans[best.k].t, count: 1,
            title: best.diff > 0 ? "Delay went up and stayed up" : "Delay went down and stayed down",
            text: `At ${mmss(ans[best.k].t)} the normal delay changed from about ${ms(best.before)} to about ${ms(best.after)}. A lasting change like this usually means the traffic started to take a different route or the device moved to a different network (for example Wi-Fi to mobile data).`,
          });
        }
      }
    }

    // 6. two delay levels that keep alternating
    if (ans.length >= 40) {
      const sorted = sortNum(ans.map(s => s.rtt)), lo = Math.floor(sorted.length * 0.2), hi = Math.ceil(sorted.length * 0.8);
      let gapAt = -1, gapSize = 0;
      for (let k = lo; k < hi; k++) if (sorted[k + 1] - sorted[k] > gapSize) { gapSize = sorted[k + 1] - sorted[k]; gapAt = k; }
      if (gapAt >= 0 && gapSize >= Math.max(30, 0.4 * sorted[gapAt])) {
        const cut = (sorted[gapAt] + sorted[gapAt + 1]) / 2, high = ans.map(s => s.rtt > cut);
        let flips = 0; for (let k = 1; k < high.length; k++) if (high[k] !== high[k - 1]) flips++;
        const share = high.filter(Boolean).length / high.length;
        if (flips >= 6 && share >= 0.15 && share <= 0.85) {
          out.push({
            type: "bimodal", severity: "warn", start: ans[0].t, end: ans[ans.length - 1].t, count: flips,
            title: "Two different delays, taking turns",
            text: `Answers fall into two groups, about ${ms(median(sorted.slice(0, gapAt + 1)))} and about ${ms(median(sorted.slice(gapAt + 1)))} (${Math.round(share * 100)}% in the slower group), and keep switching between them. That happens when traffic is shared over two paths (for example a link that uses Wi-Fi and mobile data, or two internet lines).`,
          });
        }
      }
    }
    return out.sort((a, b) => a.start - b.start);
  }

  /* ---------- which way: to the server or back ---------- */
  // Excess delay on the way TO the server and on the way BACK, without needing the two clocks to agree: only changes
  // relative to each direction's own normal level are used. The normal level is the lowest value within +-30 s, so slow clock drift does not matter.
  function direction(ser, lostInfo) {
    const ans = ser.usable.filter(s => s.ok && Number.isFinite(s.sa) && Number.isFinite(s.ss) && Number.isFinite(s.rs) && Number.isFinite(s.re));
    const res = { available: ans.length >= 20, up: null, down: null, dominant: "none", samples: ans.length };
    if (!res.available) return res;
    const up = ans.map(s => s.sa / 1000 - s.rs), down = ans.map(s => s.re - s.ss / 1000);
    // the normal level of each direction: the lowest value within +-30 s (found from per-second minima)
    const rollMin = arr => {
      const buckets = new Map();
      ans.forEach((s, k) => { const b = Math.floor(s.t / 1000), v = buckets.get(b); if (v === undefined || arr[k] < v) buckets.set(b, arr[k]); });
      const lowAt = new Map();
      for (const sec of buckets.keys()) { let lo = Infinity; for (let b = sec - 30; b <= sec + 30; b++) { const v = buckets.get(b); if (v !== undefined && v < lo) lo = v; } lowAt.set(sec, lo); }
      return arr.map((_, k) => lowAt.get(Math.floor(ans[k].t / 1000)));
    };
    const bu = rollMin(up), bd = rollMin(down);
    const ux = up.map((v, k) => Math.max(0, v - bu[k])), dx = down.map((v, k) => Math.max(0, v - bd[k]));
    const stat = x => { const sorted = sortNum(x); return { median: pct(sorted, 0.5), p95: pct(sorted, 0.95), p99: pct(sorted, 0.99), max: sorted[sorted.length - 1], total: x.reduce((a, b) => a + b, 0) }; };
    res.up = stat(ux); res.down = stat(dx); res.upx = ux; res.downx = dx; res.t = ans.map(s => s.t);
    const total = res.up.total + res.down.total;
    // big enough to matter: on average at least 3 ms extra per probe, and spikes of 20 ms or more among the worst 1% (rare but large spikes count)
    res.significant = total / ans.length >= 3 && Math.max(res.up.p99, res.down.p99) >= 20;
    if (res.significant) { const share = res.up.total / total; res.upShare = share; res.dominant = share >= 0.7 ? "up" : share <= 0.3 ? "down" : "both"; }
    res.lostUp = lostInfo.up; res.lostDown = lostInfo.down;
    return res;
  }

  /* ---------- the "I notice a problem" marks ---------- */
  function judgeMarks(marks, ser, edgeSer, m) {
    return marks.map(t => {
      const lo = t - 3500, hi = t + 2000;
      const inWin = ser.all.filter(s => s.t + (s.ok ? s.rtt : 0) >= lo && s.t <= hi && s.phase === "idle");
      const to = inWin.filter(s => s.timeout), dev = inWin.filter(s => s.deviceBusy);
      const ans = inWin.filter(s => s.ok && !s.deviceBusy);
      const base = Number.isFinite(m.median) ? m.median : NaN;
      const worst = ans.length ? Math.max(...ans.map(s => s.rtt)) : NaN;
      let kind, text;
      if (!inWin.length) { kind = "nodata"; text = "No probes were running at that moment."; }
      else if (to.length) { kind = "network"; text = `The network failed at that moment: ${to.length} probe${to.length === 1 ? "" : "s"} got no answer.`; }
      else if (Number.isFinite(worst) && worst > Math.max(2.5 * base, base + 150)) { kind = "network"; text = `The network was slow at that moment: an answer took ${ms(worst)} (normally about ${ms(base)}).`; }
      else if (dev.length) { kind = "device"; text = "Your own device paused the test at that moment (a busy device or a hidden browser tab), so the network cannot be judged."; }
      else { kind = "clear"; text = `Nothing unusual on the link to Michel's Tools at that moment (slowest answer ${ms(worst)}). If something froze for you, look at the device, the app, or another server.`; }
      if (kind === "network" && edgeSer) {
        const e = edgeSer.usable.filter(s => s.t + (s.ok ? s.rtt : 0) >= lo && s.t <= hi);
        const eBad = e.some(s => s.timeout) || (e.filter(s => s.ok).length && Math.max(...e.filter(s => s.ok).map(s => s.rtt)) > Math.max(2.5 * (edgeSer.median || 30), (edgeSer.median || 30) + 150));
        text += eBad ? ` ${edgeName}'s edge was affected too, so the problem is between your device and ${edgeName}.` : ` ${edgeName}'s edge was fine, so the problem is beyond it.`;
      }
      return { t, kind, text };
    });
  }

  /* ---------- delay under load (bufferbloat) ---------- */
  function underLoad(samples, idleMedian) {
    const phases = {};
    for (const ph of ["down", "up"]) {
      const s = samples.filter(x => x.ch === "o" && x.phase === ph && !x.deviceBusy && !(x.hidden || (x.lag || 0) > DEVICE_LAG));
      if (s.length < 8) continue;
      const ans = s.filter(x => x.ok).map(x => x.rtt), sorted = sortNum(ans);
      const p50 = ans.length ? pct(sorted, 0.5) : NaN, p95 = ans.length ? pct(sorted, 0.95) : NaN;
      const delta = p50 - idleMedian, t = s.filter(x => x.timeout).length;
      phases[ph] = { n: s.length, median: p50, p95, delta, timeouts: t, level: !Number.isFinite(delta) ? 3 : delta < 30 ? 0 : delta < 75 ? 1 : delta < 200 ? 2 : 3 };
    }
    const keys = Object.keys(phases);
    if (!keys.length) return null;
    const level = Math.max(...keys.map(k => phases[k].level));
    return { phases, level, label: ["No delay increase", "Small increase", "Noticeable increase", "Large increase"][level] };
  }

  /* ---------- putting it together ---------- */
  function analyze(samples, opts = {}) {
    const before = spikeFloor, beforeName = edgeName;
    spikeFloor = opts.fine ? 25 : 40;
    edgeName = opts.edgeName || "the CDN";
    try { return analyzeOne(samples, opts); } finally { spikeFloor = before; edgeName = beforeName; }
  }

  function analyzeOne(samples, opts) {
    opts = { timeoutMs: 3000, marks: [], ...opts };
    const o = series(samples, "o", "idle"), e = series(samples, "e", "idle");
    const m = measure(o), em = e.all.length ? measure(e) : null;
    const lostInfo = { up: o.usable.filter(s => s.timeout && s.seen === -1).length, down: o.usable.filter(s => s.timeout && typeof s.seen === "number" && s.seen >= 0).length };
    const res = { fine: !!opts.fine, edgeName, counts: { sent: samples.filter(s => s.ch === "o" && s.phase === "idle").length, device: o.device }, origin: m, edge: em, timeoutMs: opts.timeoutMs };

    res.speed = { ...speedLabel(m.median), median: m.median, min: m.min, p95: m.p95, max: m.max, down: opts.downMbps, up: opts.upMbps };
    res.enough = m.enough;
    res.qualityLevel = m.enough || m.noAnswer ? m.level : null;
    res.quality = res.qualityLevel === null ? { label: "Not enough data yet", key: "none" } : { label: LEVELS[res.qualityLevel], key: LEVELS[res.qualityLevel].toLowerCase() };
    res.direction = direction(o, lostInfo);
    res.incidents = m.answered ? incidents(o, m, opts) : [];
    res.marks = judgeMarks(opts.marks, o, e.all.length ? { ...e, median: em && em.median } : null, m);
    res.underLoad = underLoad(samples, m.median);

    // where is the problem: before or beyond the CDN
    res.attribution = null;
    if (em && em.enough && m.enough) {
      const eLevel = em.level, oLevel = m.level;
      let verdict;
      if (eLevel >= 2) verdict = "device-edge";
      else if (oLevel >= 2) verdict = "beyond-edge";
      else verdict = "fine";
      res.attribution = { verdict, edgeLevel: eLevel, originLevel: oLevel, edgeMedian: em.median, originMedian: m.median, extra: m.median - em.median };
    }
    res.findings = findings(res, opts);
    res.sentence = sentence(res);
    return res;
  }

  function sentence(r) {
    if (r.origin.noAnswer) return "No answer from Michel's Tools during the test.";
    if (r.qualityLevel === null) return "Collecting data... a verdict needs at least 20 probes.";
    const goodSpeed = ["veryclose", "close", "moderate"].includes(r.speed.key), goodQ = r.qualityLevel <= 1;
    const phrase = ["very steady", "steady", "unstable", "unreliable"][r.qualityLevel];
    const word = r.speed.key === "veryfar" ? "Very far away" : r.speed.label;
    return `${word} (about ${Math.round(r.speed.median)} ms) ${goodSpeed === goodQ ? "and" : "but"} ${phrase}.`;
  }

  function findings(r, opts) {
    const f = [];
    const m = r.origin;
    if (m.noAnswer) { f.push({ level: "bad", text: "Michel's Tools did not answer. The device may be offline, a firewall may block the test, or the site is down." }); return f; }
    if (r.qualityLevel === null) return f;
    if (r.qualityLevel === 0) f.push({ level: "good", text: `Every probe was answered and the delay stayed within a narrow range (${ms(m.min)} to ${ms(m.p95)} for 95% of probes).` });
    if (m.timeouts) f.push({ level: m.timeoutPct > 3 ? "bad" : "warn", text: `${m.timeouts} of ${m.n} probes (${m.timeoutPct.toFixed(1)}%) got no answer within ${r.timeoutMs / 1000} s.` });
    if (m.spikes && r.qualityLevel >= 1) f.push({ level: m.spikePct > 8 ? "bad" : "warn", text: `${m.spikes} probes (${m.spikePct.toFixed(0)}%) were much slower than this link's normal delay of about ${ms(m.median)}.` });
    if (m.jitterRel > 0.25 && m.jitter >= 4) f.push({ level: m.jitterRel > 0.6 ? "bad" : "warn", text: `The delay jumps around: on average ${ms(m.jitter)} between one answer and the next (${Math.round(m.jitterRel * 100)}% of the normal delay).` });
    if (Math.abs(m.drift) > 0.2) f.push({ level: "warn", text: `The delay ${m.drift > 0 ? "grew" : "shrank"} by ${Math.round(Math.abs(m.drift) * 100)}% from the start of the test to the end.` });
    for (const inc of r.incidents) f.push({ level: inc.severity, text: `${inc.title}: ${inc.text}`, at: inc.start, incident: inc.type });
    const d = r.direction;
    if (d.available && d.significant && r.qualityLevel >= 1) {
      if (d.dominant === "up") f.push({ level: "warn", text: `Most of the extra delay (${Math.round(d.upShare * 100)}%) happens on the way TO Michel's Tools, that is the upload direction. Typical causes: a busy or weak Wi-Fi uplink, a congested upload line, or something uploading in the background.` });
      else if (d.dominant === "down") f.push({ level: "warn", text: `Most of the extra delay (${Math.round((1 - d.upShare) * 100)}%) happens on the way BACK from Michel's Tools, that is the download direction. Typical causes: a congested download line, other people or devices using the same connection, or a busy provider.` });
      else f.push({ level: "info", text: `The extra delay is shared between both directions (${Math.round(d.upShare * 100)}% on the way there, ${Math.round((1 - d.upShare) * 100)}% on the way back).` });
    }
    if (r.attribution) {
      const a = r.attribution;
      if (a.verdict === "device-edge") f.push({ level: "bad", text: `The instability is already present on the way to ${r.edgeName}'s nearest data centre, so it is between your device and ${r.edgeName}: your Wi-Fi, your internet line or your provider.` });
      else if (a.verdict === "beyond-edge") f.push({ level: "bad", text: `${upFirst(r.edgeName)}'s edge answered steadily but Michel's Tools did not, so the problem is beyond ${r.edgeName}: the tunnel, the link between the CDN and the server, or the server, not your device's connection.` });
      else if (a.extra > 5) f.push({ level: "info", text: `About ${ms(a.edgeMedian)} of the delay is the way to ${r.edgeName}'s nearest data centre; the remaining ${ms(a.extra)} is from there to Michel's Tools.` });
    }
    if (r.underLoad) {
      const ul = r.underLoad;
      for (const [ph, name] of [["down", "a download"], ["up", "an upload"]]) {
        const p = ul.phases[ph]; if (!p) continue;
        f.push({ level: ["good", "info", "warn", "bad"][p.level], text: `While ${name} was running the delay went from ${ms(m.median)} to ${ms(p.median)} (${p.delta >= 0 ? "+" : ""}${Math.round(p.delta)} ms)${p.timeouts ? `, and ${p.timeouts} probes got no answer` : ""}. ${p.level >= 2 ? "When the line is busy, calls, games and page loads suffer: this is called bufferbloat, and the router can often be set up to avoid it." : "The link copes well with load."}` });
      }
    }
    if (r.edge && r.edge.queued) f.push({ level: "info", text: `${r.edge.queued} CDN probe${r.edge.queued === 1 ? " was" : "s were"} left out because ${r.edge.queued === 1 ? "it" : "they"} had to wait in the browser's queue for a free connection (this connection uses HTTP/1.1, which allows only 6 at a time while probes are stuck).` });
    if (m.device) f.push({ level: "info", text: `${m.device} probe${m.device === 1 ? " was" : "s were"} left out because the device itself was busy or the tab was in the background. Keep this tab in front during a test.` });
    for (const k of r.marks) f.push({ level: k.kind === "network" ? "bad" : k.kind === "clear" ? "info" : "warn", text: `Your mark at ${mmss(k.t)}: ${k.text}`, at: k.t });
    return f;
  }

  /* ---------- a text report to copy ---------- */
  function report(r, meta = {}) {
    const L = [];
    L.push(`Connection Quality report (Michel's Tools)`);
    if (meta.when) L.push(`Date: ${meta.when}`);
    if (meta.protocol) L.push(`Protocol: ${meta.protocol}`);
    if (meta.colo) L.push(`${meta.edgeName ? upFirst(meta.edgeName) : "CDN"} data centre: ${meta.colo}`);
    L.push(`Duration: ${meta.seconds ? Math.round(meta.seconds) + " s" : "?"}, probes: ${r.counts.sent}`);
    L.push("", `SUMMARY: ${r.sentence}`);
    L.push(`Speed (distance): ${r.speed.label}. Delay: median ${ms(r.speed.median)}, best ${ms(r.speed.min)}, 95% under ${ms(r.speed.p95)}, worst ${ms(r.speed.max)}.`);
    if (Number.isFinite(r.speed.down)) L.push(`Download: ${r.speed.down.toFixed(1)} Mbit/s`);
    if (Number.isFinite(r.speed.up)) L.push(`Upload: ${r.speed.up.toFixed(1)} Mbit/s`);
    L.push(`Quality (stability): ${r.quality.label}. No answer: ${r.origin.timeouts} of ${r.origin.n} (${(r.origin.timeoutPct || 0).toFixed(1)}%). Slow probes (more than ${r.origin.spikeFloor || 40} ms or 50% above normal): ${r.origin.spikes || 0}. Jitter: ${ms(r.origin.jitter)}. Longest silence: ${ms(r.origin.longestStall)}.`);
    L.push("", "FINDINGS:");
    for (const f of r.findings) L.push(`- ${f.level === "bad" ? "[PROBLEM] " : f.level === "warn" ? "[WARNING] " : ""}${f.text}`);
    L.push("", "What this does and does not show: probes are small web requests (layer 7), sent about 5 times a second. Retransmissions cannot be seen directly; they appear as delay jumps. Direction (to/back) is derived from server timestamps.");
    return L.join("\n");
  }

  window.NetAnalysis = { analyze, report, speedLabel, measure, series, LEVELS, DEVICE_LAG, pct, median, ms, mmss };
})();
