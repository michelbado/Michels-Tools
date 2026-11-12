/* Connection Quality: how fast AND how steady is the link between this device and Michel's Tools.
   About five tiny web requests per second go to the server (and, if a CDN such as Cloudflare or Bunny is in front, to the CDN's nearest data centre).
   web/lib/netanalysis.js turns the answers into verdicts. Nothing typed or uploaded by the visitor is used; everything shown
   is computed here. Text is only ever put on the page with textContent. */
(window.DesktopApps = window.DesktopApps || {}).netquality = (() => {
  const NA = window.NetAnalysis, SC = window.SpeedCalc;
  const TICK = 100;                  // ms: origin probe on even ticks (5 a second), edge probe on odd ticks
  const FINE_TICK = 50;              // fine detail (Monitor mode): an origin probe every tick (20 a second), an edge probe every 4th tick
  const FINE_INFLIGHT_MAX = 24;      // fine detail: with this many probes unanswered, more are counted as lost without being sent (a stuck link must not pile up requests)
  const TIMEOUT = 3000;              // ms without an answer = lost
  const QUICK_MS = 30000;
  // the automated tests shorten the quick test by setting window.__nqTest = { quickMs } before pressing Start
  const quickMs = () => (window.__nqTest && window.__nqTest.quickMs) || QUICK_MS;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fmtMs = x => NA.ms(x);

  function init(root, shell) {
    const $ = id => root.querySelector("#netquality-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const mode = () => root.querySelector('input[name="netquality-mode"]:checked').value;
    const speedLevel = () => { const el = root.querySelector('input[name="netquality-speed"]:checked'); return el && SC.LEVELS[el.value] ? el.value : "light"; };
    const planValue = id => { const v = parseFloat($(id).value); return Number.isFinite(v) && v > 0 ? Math.min(v, 100000) : 0; };
    const mb = x => (x / 1e6).toFixed(x < 1e7 ? 1 : 0);
    const SPEED_INPUTS = 'input[name="netquality-speed"], #netquality-plandown, #netquality-planup';
    // The speed test needs the quick test (Monitor mode never transfers data); what the visitor chose last time is remembered in this browser only
    const store = { get(k) { try { return localStorage.getItem("michels-tools-nq-" + k); } catch { return null; } }, set(k, v) { try { localStorage.setItem("michels-tools-nq-" + k, v); } catch { /* private window: fine */ } } };
    function updateSpeedOptions() {
      const off = mode() === "monitor";
      for (const el of root.querySelectorAll(SPEED_INPUTS)) el.disabled = off || !!run;
      $("speedopts").classList.toggle("off", off);
      $("speednote").textContent = off ? "The speed test belongs to the quick test; Monitor mode never transfers data." : "";
    }
    const nq = root.querySelector(".nq");
    let run = null, last = null, uiTimer = 0, observer = null, monTimer = 0;
    // how Monitor mode is offered on this server (tools.conf) and whether somebody else is monitoring right now
    let monInfo = { enabled: true, exclusive: true, minutes: 10, busy: false, fine: true };
    function updateMonitorOption() {
      const radio = root.querySelector('input[name="netquality-mode"][value="monitor"]');
      const blocked = !monInfo.enabled || monInfo.busy;
      $("monlabel").textContent = `Monitor (until I stop it, at most ${monInfo.minutes} minute${monInfo.minutes === 1 ? "" : "s"})`;
      $("monopt").classList.toggle("off", blocked);
      $("monnote").textContent = !monInfo.enabled ? "Switched off on this server." : monInfo.busy ? "In use by another visitor right now. It becomes available when they press Stop." : "";
      radio.disabled = blocked || !!run;
      // fine detail is offered only with Monitor mode, and only if the server allows it
      $("fineopt").hidden = !(radio.checked && !blocked && monInfo.fine);
      if (blocked && radio.checked) root.querySelector('input[name="netquality-mode"][value="quick"]').checked = true;
    }
    async function pollMonitor() {
      try {
        const res = await fetch(new URL("api/monitor", document.baseURI), { cache: "no-store" });
        if (res.ok) { const j = await res.json(); monInfo = { enabled: !!j.enabled, exclusive: !!j.exclusive, minutes: j.minutes || 10, busy: !!j.busy, fine: !!j.fine }; }
      } catch { /* keep what we knew */ }
      updateMonitorOption();
    }
    const releaseMonitor = r => { if (r && r.mode === "monitor") { try { fetch(new URL(`api/monitor?run=${r.id}&release=1`, document.baseURI), { method: "POST", keepalive: true }); } catch { /* the claim ends by itself */ } } };
    const timings = new Map();

    // the browser's own timing of each request (when it started sending, when the answer ended)
    try {
      observer = new PerformanceObserver(list => { for (const e of list.getEntries()) if (/\/api\/ping|\/cdn-cgi\/trace|\/edge-probe\.txt/.test(e.name)) { const l = (timings.get(e.name) || []).filter(x => x.startTime > e.startTime - 30000); l.push(e); timings.set(e.name, l); } });
      observer.observe({ type: "resource", buffered: false });
    } catch { observer = null; }
    async function timingFor(href, sent) {
      for (let k = 0; k < 12; k++) {
        const l = timings.get(href);
        if (l && l.length) {
          // the entry that was started closest to the moment this probe was started
          let bi = 0; for (let i = 1; i < l.length; i++) if (Math.abs(l[i].startTime - sent) < Math.abs(l[bi].startTime - sent)) bi = i;
          const e = l[bi]; l.splice(bi, 1); return e;
        }
        if (!observer) { const l = performance.getEntriesByName(href, "resource"); if (l.length) return l[l.length - 1]; }
        await sleep(8);
      }
      return null;
    }

    function randomId() {
      const a = new Uint8Array(12);
      (globalThis.crypto && crypto.getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); }));
      return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
    }

    /* ---------- one probe ---------- */
    async function probe(r, ch) {
      if (r.fine && ch === "o" && r.inflight >= FINE_INFLIGHT_MAX) {
        // too many unanswered probes: this one is counted as lost, but is not sent (so the server never saw it)
        r.samples.push({ i: r.nextI++, ch, t: performance.now() - r.start, phase: r.phase, lag: r.lastLag, hidden: document.hidden, ok: false, timeout: true, seq: -1, seen: -1, blocked: true });
        return;
      }
      const seq = ch === "o" ? r.seqO++ : r.seqE++;
      const sent = performance.now();
      const s = { i: r.nextI++, ch, t: sent - r.start, phase: r.phase, lag: r.lastLag, hidden: document.hidden, ok: false, timeout: false, seq };
      // On HTTP/1.1 a browser allows 6 connections per server. If stuck probes hold them, an edge probe only waits in the browser's queue and says nothing about the edge: it is left out.
      if (ch === "e" && r.inflight >= 5 && !/^h[23]$/.test(r.proto)) s.queued = true;
      r.samples.push(s);
      const rel = ch === "o" ? `api/ping?run=${r.id}&seq=${seq}${r.mode === "monitor" ? "&mon=1" : ""}${r.fine ? "&f=1" : ""}` : r.edge && r.edge.kind === "cache" ? "edge-probe.txt" : `cdn-cgi/trace?q=${r.id}-${seq}`;
      const href = new URL(rel, document.baseURI).href;
      const ac = new AbortController(), killer = setTimeout(() => ac.abort(), TIMEOUT);
      r.inflight++;
      try {
        const res = await fetch(href, { cache: "no-store", signal: ac.signal, credentials: "same-origin" });
        if (res.status === 429) { r.samples.splice(r.samples.indexOf(s), 1); r.limited = true; return; }   // the server asked us to slow down: not a network result
        if (!res.ok) throw new Error("HTTP " + res.status);
        const body = await res.text();
        clearTimeout(killer);
        const end = performance.now(), e = await timingFor(href, sent);
        // The delay is measured from the moment the probe was started, so time spent waiting for a free connection (a browser
        // allows only 6 per server on HTTP/1.1, and stuck probes occupy them) counts: it is delay the visitor would feel.
        // The browser's own send/receive moments are kept for the direction analysis.
        if (e && e.requestStart > 0 && e.responseEnd > e.requestStart) { s.rs = e.requestStart; s.re = e.responseEnd; if (ch === "e" && e.requestStart - e.startTime > 400) s.queued = true;
          s.rtt = e.responseEnd - e.startTime > 0 ? e.responseEnd - e.startTime : end - sent; if (!r.proto && e.nextHopProtocol) r.proto = e.nextHopProtocol; }
        else s.rtt = end - sent;
        // a cached edge probe that was renewed by the server (every 5 minutes) travelled further than the others: it says nothing about the edge
        if (ch === "e" && r.edge && r.edge.kind === "cache") { if (r.edge.stamp && r.edge.stamp !== body) { r.edge.stamp = body; r.samples.splice(r.samples.indexOf(s), 1); return; } r.edge.stamp = body; }
        if (ch === "o") { const j = JSON.parse(body); if (!Number.isFinite(j.a) || !Number.isFinite(j.s)) throw new Error("bad answer"); s.sa = j.a; s.ss = j.s; if (Number.isFinite(j.u)) s.u = j.u; }
        s.ok = true;
      } catch (err) {
        clearTimeout(killer);
        s.timeout = true; s.failed = err && err.name !== "AbortError";
      } finally {
        r.inflight--;
        if (document.hidden) s.hidden = true;
      }
    }

    /* ---------- the run ---------- */
    // Is a CDN in front of the server? First Cloudflare's own trace page (it names the data centre). Otherwise a small page that
    // the server renews on every request: if two answers 0.7 s apart are identical, something in between kept the first one.
    const detectEdge = () => window.CDN.findEdge(document.baseURI);
    const edgeName = r => (r && r.edge && r.edge.name) || "";
    const edgeShort = r => (edgeName(r) === "the CDN" ? "CDN" : edgeName(r));
    const upFirst = s => s.charAt(0).toUpperCase() + s.slice(1);

    async function start() {
      if (run) return;
      const id = randomId();
      if (mode() === "monitor") {
        await pollMonitor();
        if (!monInfo.enabled || monInfo.busy) { setStatus(!monInfo.enabled ? "Monitor mode is switched off on this server." : "Monitor mode is in use by another visitor right now."); return; }
        try {
          const res = await fetch(new URL(`api/monitor?run=${id}`, document.baseURI), { method: "POST", cache: "no-store" });
          if (!res.ok) { await pollMonitor(); setStatus(res.status === 409 ? "Monitor mode is in use by another visitor right now." : "Monitor mode is not available on this server."); return; }
        } catch { setStatus("Could not reach the server to start monitoring."); return; }
      }
      const fine = mode() === "monitor" && $("fine").checked && monInfo.fine;
      const r = run = { id, fine, tick: fine ? FINE_TICK : TICK, maxMs: monInfo.minutes * 60000, start: 0, samples: [], marks: [], seqO: 0, seqE: 0, nextI: 0, phase: "idle", lastLag: 0, inflight: 0, k: 0, edge: null, proto: "", stopping: false, done: false, phases: [], mode: mode(), load: speedLevel() !== "none" && mode() === "quick", speedLevel: speedLevel(), planDown: planValue("plandown"), planUp: planValue("planup"), used: 0, usedDown: 0, usedUp: 0, speedRes: {}, timer: 0, limited: false };
      $("start").disabled = true; $("stop").disabled = false; $("mark").disabled = false; $("clear").disabled = true; $("copy").disabled = true; $("save").disabled = true; $("savehtml").disabled = true;
      nq.classList.toggle("locked", r.mode === "monitor");
      for (const el of root.querySelectorAll('input[name="netquality-mode"], #netquality-fine, ' + SPEED_INPUTS)) el.disabled = true;
      $("intro").hidden = true; $("results").hidden = false;
      $("verdict").textContent = "Starting..."; $("verdict").className = "verdict";
      setStatus("Looking for a CDN in front of the server...");
      r.edge = await detectEdge();
      if (run !== r) return;
      r.start = performance.now();
      r.phases.push({ phase: "idle", from: 0 });
      setStatus(r.mode === "quick" ? "Testing for 30 seconds. Keep this window in front." : r.fine ? "Monitoring in fine detail (a probe every 50 ms). Press Stop when you have seen enough." : "Monitoring. Press Stop when you have seen enough.");
      // a long run is asked once a minute which lost probes the server did receive (the server remembers a limited number)
      if (r.mode === "monitor") r.seenTimer = setInterval(() => { if (!r.stopping) fetchSeen(r, false); }, 60000);
      scheduleTick(r);
      uiTimer = setInterval(() => refresh(), 1000);
    }

    function scheduleTick(r) {
      const due = r.start + r.k * r.tick, delay = Math.max(0, due - performance.now());
      r.timer = setTimeout(() => tick(r, due), delay);
    }
    function tick(r, due) {
      if (run !== r || r.stopping) return;
      const now = performance.now();
      r.lastLag = Math.max(0, now - due);
      const k = r.k;
      const ch = r.fine ? "o" : k % 2 === 0 ? "o" : (r.edge ? "e" : null);
      if (ch) probe(r, ch);
      if (r.fine && r.edge && k % 4 === 2) probe(r, "e");        // Cloudflare is probed 5 times a second in either mode
      // never try to catch up after the page was paused: skip the ticks that were missed
      r.k = Math.max(k + 1, Math.floor((now - r.start) / r.tick) + 1);
      const elapsed = now - r.start;
      if (r.mode === "monitor" && elapsed >= r.maxMs) { finish(r, `The ${monInfo.minutes} minute limit was reached.`); return; }
      if (r.mode === "quick" && r.phase === "idle" && elapsed >= quickMs()) {
        if (r.load && !r.loadStarted) { r.loadStarted = true; loadPhases(r); } else if (!r.load) { finish(r); return; }
      }
      scheduleTick(r);
    }

    function setPhase(r, phase) {
      const t = performance.now() - r.start;
      const cur = r.phases[r.phases.length - 1];
      if (cur) cur.to = t;
      r.phases.push({ phase, from: t });
      r.phase = phase;
    }

    /* ---------- the speed test: a download, then an upload, while the probes keep running ---------- */
    // Both directions are ONE long request that the page ends as soon as the speed has settled (speedcalc.js decides), or when the data limit
    // of the chosen level is reached. The download is timed by the bytes the page receives; the upload by the bytes the SERVER confirms
    // (the probe answers carry the server's running count), because a browser's own upload progress only says what it handed to the network.
    const LIMITED = "The server asked for a pause between speed tests: wait a minute and try again.";
    async function loadPhases(r) {
      const L = SC.LEVELS[r.speedLevel];
      try {
        setPhase(r, "down"); setStatus(`Measuring the download speed (at most ${mb(L.down)} MB)...`);
        try { r.speedRes.down = await measureDown(r, L); } catch (e) { r.loadNote = e && e.message === "limited" ? LIMITED : "The download part could not be completed."; }
        if (r.stopping) return;
        setPhase(r, "rest"); setStatus("Pausing for the line to calm down..."); await sleep(2500);
        if (r.stopping) return;
        setPhase(r, "up"); setStatus(`Measuring the upload speed (at most ${mb(L.up)} MB)...`);
        try { r.speedRes.up = await measureUp(r, L); } catch (e) { r.loadNote = r.loadNote || (e && e.message === "limited" ? LIMITED : "The upload part could not be completed."); }
        if (r.stopping) return;
        setPhase(r, "rest"); await sleep(1500);
      } finally {
        if (run === r && !r.stopping) finish(r);
      }
    }
    function showLive(r, name, pts, L) {
      r.used = r.usedDown + r.usedUp;
      const t = pts.length ? pts[pts.length - 1].t : 0, now = SC.rate(pts, Math.max(0, t - 1000), t);
      setStatus(`${name}: ${Number.isFinite(now) ? NA.mbit(now) : "..."} so far. Data used: ${mb(r.used)} MB of at most ${mb(L.total)} MB. Press Stop to end the test.`);
    }
    async function measureDown(r, L) {
      const ac = new AbortController(), kill = setTimeout(() => ac.abort(), L.maxMs + 8000), t0 = performance.now(), pts = [{ t: 0, b: 0 }];
      let got = 0, j = null, next = 0;
      try {
        const res = await fetch(new URL(`api/download?kb=${Math.ceil(L.down / 1024) + 512}&run=${r.id}`, document.baseURI), { cache: "no-store", signal: ac.signal });
        if (res.status === 429) throw new Error("limited");
        if (!res.ok || !res.body) throw new Error("failed");
        const rd = res.body.getReader();
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          got += value.length; const t = performance.now() - t0; pts.push({ t, b: got }); r.usedDown = got;
          if (r.stopping) break;
          if (t >= next) { next = t + 150; j = SC.judge(pts, { capBytes: L.down, maxMs: L.maxMs }); showLive(r, "Download", pts, L); if (j.done) break; }
        }
        try { rd.cancel(); } catch { /* already closed */ }
      } finally { clearTimeout(kill); }
      if (!j || !j.done) { pts.push({ t: performance.now() - t0, b: got }); j = SC.judge(pts, { capBytes: Math.min(L.down, got), maxMs: 1 }); }
      return j;
    }
    // the newest answered probe that carries the server's upload count
    const withCount = r => { let best = null; for (const s of r.samples) if (s.ch === "o" && s.ok && Number.isFinite(s.u) && Number.isFinite(s.sa) && (!best || s.sa > best.sa)) best = s; return best; };
    function upPoints(r, base) {
      const pts = [{ t: 0, b: 0 }];
      if (!base) return pts;
      const list = r.samples.filter(s => s.ch === "o" && s.ok && Number.isFinite(s.u) && Number.isFinite(s.sa) && s.sa > base.sa).sort((x, y) => x.sa - y.sa);
      for (const s of list) pts.push({ t: (s.sa - base.sa) / 1000, b: s.u - base.u });
      return pts;
    }
    async function measureUp(r, L) {
      const chunk = new Uint8Array(1 << 20);
      for (let o = 0; o < chunk.length; o += 65536) crypto.getRandomValues(chunk.subarray(o, o + 65536));     // random, so nothing on the way can squeeze it
      const body = new Blob(Array.from({ length: Math.ceil(L.up / chunk.length) }, () => chunk)).slice(0, L.up);
      const base = withCount(r), ac = new AbortController(), t0 = performance.now(), kill = setTimeout(() => ac.abort(), L.maxMs + 8000);
      let finished = false, failure = null;
      fetch(new URL(`api/upload?run=${r.id}`, document.baseURI), { method: "POST", body, cache: "no-store", signal: ac.signal, headers: { "Content-Type": "application/octet-stream" } })
        .then(res => { if (res.status === 429) throw new Error("limited"); return res.text(); }).then(() => { finished = true; }, e => { failure = e; finished = true; });
      let j = null, pts = [];
      while (!r.stopping) {
        await sleep(200);
        pts = upPoints(r, base);
        r.usedUp = pts[pts.length - 1].b;
        j = SC.judge(pts, { capBytes: L.up, maxMs: L.maxMs });
        showLive(r, "Upload", pts, L);
        if (j.done || finished || performance.now() - t0 > L.maxMs + 6000) break;
      }
      const secs = (performance.now() - t0) / 1000, ok = finished && !failure;
      ac.abort(); clearTimeout(kill);
      if (failure && failure.message === "limited") throw failure;
      if (j && j.done && Number.isFinite(j.mbps)) return j;
      pts = upPoints(r, base);
      if (pts.length > 1 && pts[pts.length - 1].b > 0) { j = SC.judge(pts, { capBytes: Math.min(L.up, pts[pts.length - 1].b), maxMs: 1 }); if (j.done && Number.isFinite(j.mbps)) return j; }
      // an older server does not report the count: the whole request, a lower bound (it includes setting up the connection)
      if (ok && secs > 0.05) { r.usedUp = L.up; return { done: true, reason: "limit", mbps: (L.up * 8) / 1e6 / secs, atLeast: true, steady: false, bytes: L.up, ms: secs * 1000 }; }
      return j;
    }

    async function finish(r, why) {
      if (r.stopping) return;
      r.stopping = true; clearTimeout(r.timer); clearInterval(r.seenTimer); clearInterval(uiTimer);
      const cur = r.phases[r.phases.length - 1]; if (cur) cur.to = performance.now() - r.start;
      setStatus("Collecting the last answers...");
      for (let k = 0; k < 40 && r.inflight > 0; k++) await sleep(100);
      await fetchSeen(r);
      r.done = true; r.ended = performance.now() - r.start;
      refresh(true);
      last = { run: r, result: analyzeNow(r) };
      run = null;
      releaseMonitor(r); nq.classList.remove("locked");
      $("start").disabled = false; $("stop").disabled = true; $("mark").disabled = true; $("clear").disabled = false; $("copy").disabled = false; $("save").disabled = false; $("savehtml").disabled = false;
      for (const el of root.querySelectorAll('input[name="netquality-mode"], #netquality-fine')) el.disabled = false;
      updateSpeedOptions();
      pollMonitor();
      setStatus(why ? `Finished. ${why}` : "Finished.");
    }
    function stop() { if (run) finish(run, "Stopped."); }

    // ask the server which of the unanswered probes it did receive
    async function fetchSeen(r, final = true) {
      const now = performance.now() - r.start;
      const lost = r.samples.filter(s => s.ch === "o" && s.timeout && s.seen === undefined && s.seq >= 0 && (final || now - s.t > 4500)).map(s => s.seq);
      const chunks = []; for (let a = 0; a < lost.length; a += 300) chunks.push(lost.slice(a, a + 300));
      if (!chunks.length && final) chunks.push([]);           // still say that this run is finished
      for (let c = 0; c < chunks.length; c++) {
        const part = chunks[c], done = final && c === chunks.length - 1 ? "&done=1" : "";
        try {
          const res = await fetch(new URL(`api/seen?run=${r.id}&seqs=${part.join(",")}${done}`, document.baseURI), { cache: "no-store" });
          if (!res.ok) continue;
          const map = await res.json();
          for (const s of r.samples) if (s.ch === "o" && s.timeout && String(s.seq) in map) s.seen = map[String(s.seq)];
        } catch { /* leave them unknown */ }
      }
    }

    /* ---------- the verdict ---------- */
    const figure = x => (x && Number.isFinite(x.mbps) ? x : null);
    function speedInput(r) { return { level: r.speedLevel, asked: !!r.load, down: figure(r.speedRes.down), up: figure(r.speedRes.up), used: r.used, planDown: r.planDown, planUp: r.planUp }; }
    function analyzeNow(r) {
      const res = NA.analyze(r.samples, { marks: r.marks, timeoutMs: TIMEOUT, speed: speedInput(r), fine: r.fine, edgeName: edgeName(r) });
      if (r.loadNote) res.findings.push({ level: "warn", text: r.loadNote });
      if (r.limited) res.findings.push({ level: "warn", text: "The server asked this device to slow down for a moment, so a few probes were skipped. Wait a minute between tests." });
      return res;
    }

    let lastRefresh = 0;
    function refresh(force) {
      if (!run && !force) return;
      const r = (run || (last && last.run)) || null;
      if (!r) return;
      const now = performance.now();
      if (!force && r.samples.length > 1500 && now - lastRefresh < 2500) return;
      lastRefresh = now;
      const res = analyzeNow(r);
      render(r, res, !force && !r.done);
    }

    /* ---------- showing it ---------- */
    const LEVEL_CLASS = ["good", "good", "warn", "bad"];
    function render(r, res, live) {
      const v = $("verdict");
      v.textContent = res.sentence;
      v.className = "verdict " + (res.qualityLevel === null ? "" : LEVEL_CLASS[res.qualityLevel]);
      const elapsed = (r.ended !== undefined ? r.ended : performance.now() - r.start) / 1000;
      $("progress").textContent = live ? `${Math.floor(elapsed)} s so far, ${res.counts.sent} probes sent${r.mode === "monitor" ? ` (stops by itself after ${monInfo.minutes} minute${monInfo.minutes === 1 ? "" : "s"})` : ""}${r.phase === "down" ? "; downloading now" : r.phase === "up" ? "; uploading now" : ""}${r.load && r.used > 0 ? `; data used ${mb(r.used)} MB of at most ${mb(SC.LEVELS[r.speedLevel].total)} MB` : ""}.` : `Ran for ${Math.round(elapsed)} s, ${res.counts.sent} probes sent to Michel's Tools${r.edge ? ` and ${res.edge ? res.edge.n : 0} to ${edgeName(r)}` : ""}.`;
      const m = res.origin;

      $("latlabel").textContent = res.latency.label; $("latlabel").className = "big " + (["veryclose", "close"].includes(res.latency.key) ? "l0" : res.latency.key === "moderate" ? "l1" : res.latency.key === "far" ? "l2" : res.latency.key === "veryfar" ? "l3" : "");
      const lt = [];
      if (Number.isFinite(res.latency.median)) lt.push(`Typical answer time: ${fmtMs(res.latency.median)}`, `Best ${fmtMs(res.latency.min)}, 95% of answers under ${fmtMs(res.latency.p95)}, worst ${fmtMs(res.latency.max)}`);
      if (res.edge && Number.isFinite(res.edge.median)) lt.push(`${upFirst(edgeShort(r) || "CDN")}${r.edge && r.edge.colo ? " (" + r.edge.colo + ")" : ""} nearest data centre: ${fmtMs(res.edge.median)}`);
      fillLines($("latnums"), lt);
      const sh = NA.speedHeadline(res.speed);
      $("speedlabel").textContent = sh.label; $("speedlabel").className = "big " + sh.cls;
      const sp = res.speed.measured ? NA.speedLines(res.speed) : [r.mode === "monitor" ? "Measured in the quick test only." : r.load ? (r.done ? "No result: see what we found." : "Measured after the quiet part of the test.") : "Not measured: the speed test is set to No transfer."];
      fillLines($("speednums"), sp);

      $("quallabel").textContent = res.quality.label; $("quallabel").className = "big " + (res.qualityLevel === null ? "" : "l" + res.qualityLevel);
      const ql = [];
      if (m.n) ql.push(`Answered: ${m.answered} of ${m.n} probes${m.timeouts ? ` (${m.timeoutPct.toFixed(1)}% got no answer)` : ""}`);
      if (m.answered) ql.push(`Slow probes: ${m.spikes} (${m.spikePct.toFixed(0)}%)`, `Jitter: ${fmtMs(m.jitter)}, longest silence: ${fmtMs(m.longestStall)}`);
      fillLines($("qualnums"), ql);
      const recent = $("recent");
      recent.textContent = "";
      if (r.mode === "monitor" && res.counts.sent > (r.fine ? 600 : 150)) {
        const cut = (performance.now() - r.start) - 60000;
        const part = NA.analyze(r.samples.filter(s => s.t >= cut), { marks: [], timeoutMs: TIMEOUT, fine: r.fine, edgeName: edgeName(r) });
        if (part.qualityLevel !== null) recent.textContent = `Last minute: ${part.quality.label}`;
      }

      const ul = $("findings"); ul.textContent = "";
      const order = { bad: 0, warn: 1, info: 2, good: 3 };
      const finds = res.findings.slice().sort((a, b) => order[a.level] - order[b.level] || (a.at || 0) - (b.at || 0));
      if (!finds.length) { const li = document.createElement("li"); li.className = "info"; li.textContent = "Collecting data..."; ul.append(li); }
      for (const f of finds) {
        const li = document.createElement("li"); li.className = f.level;
        if (f.at !== undefined) { const at = document.createElement("span"); at.className = "at"; at.textContent = NA.mmss(f.at); li.append(at); }
        li.append(document.createTextNode(f.text));
        ul.append(li);
      }
      fillTable(r, res);
      drawGraph(r, res);
      drawDirection(r, res);
      $("meta").textContent = `${r.proto ? "Protocol " + r.proto.toUpperCase() : ""}${r.edge && r.edge.colo ? (r.proto ? " | " : "") + upFirst(edgeName(r)) + " " + r.edge.colo : ""}`;
    }
    function fillLines(el, lines) { el.textContent = ""; for (const l of lines) { const d = document.createElement("div"); d.textContent = l; el.append(d); } }

    function fillTable(r, res) {
      const m = res.origin, rows = [
        ["Probes to Michel's Tools (counted)", `${m.n}`], ["Answered", `${m.answered}`], ["No answer within 3 s", `${m.timeouts} (${(m.timeoutPct || 0).toFixed(1)}%)`],
        ["Probes left out (device busy or tab hidden)", `${m.device}`], ["Median / best / 95% / worst", [m.median, m.min, m.p95, m.max].map(fmtMs).join(" / ")],
        ["Slow probes (far above this link's normal)", `${m.spikes || 0} (${(m.spikePct || 0).toFixed(1)}%), very slow: ${m.bigSpikes || 0}`],
        ["Jitter (average change between answers)", `${fmtMs(m.jitter)} (${Math.round((m.jitterRel || 0) * 100)}% of normal)`], ["Longest silence", fmtMs(m.longestStall)],
        ["Change from start to end", `${Math.round((m.drift || 0) * 100)}%`],
      ];
      if (res.direction.available) rows.push(["Extra delay TO the server (median / 95% / worst)", [res.direction.up.median, res.direction.up.p95, res.direction.up.max].map(fmtMs).join(" / ")], ["Extra delay BACK (median / 95% / worst)", [res.direction.down.median, res.direction.down.p95, res.direction.down.max].map(fmtMs).join(" / ")]);
      if (res.edge) rows.push(["CDN edge: median / answered / no answer", `${fmtMs(res.edge.median)} / ${res.edge.answered} / ${res.edge.timeouts}`]);
      if (res.underLoad) for (const [k, n] of [["down", "During download"], ["up", "During upload"]]) { const p = res.underLoad.phases[k]; if (p) rows.push([`${n}: median / 95% / no answer`, `${fmtMs(p.median)} / ${fmtMs(p.p95)} / ${p.timeouts}`]); }
      const tb = $("table"); tb.textContent = "";
      for (const [k, v] of rows) { const tr = document.createElement("tr"), th = document.createElement("th"), td = document.createElement("td"); th.textContent = k; td.textContent = v; tr.append(th, td); tb.append(tr); }
    }

    /* ---------- the graphs ---------- */
    function setup(cv, fixed) {
      const dpr = fixed ? fixed.dpr : Math.min(2, window.devicePixelRatio || 1), w = fixed ? fixed.w : Math.max(200, cv.clientWidth), h = fixed ? fixed.h : Math.max(60, cv.clientHeight);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      return { ctx, w, h };
    }
    function drawGraph(r, res, target, fixed) {
      const { ctx, w, h } = setup(target || $("graph"), fixed);
      const pad = { l: 46, r: 10, t: 12, b: 20 }, samples = r.samples;
      const duration = Math.max(10000, (r.ended !== undefined ? r.ended : performance.now() - r.start) + 500);
      const answered = samples.filter(s => s.ok).map(s => s.rtt).sort((a, b) => a - b);
      const p99 = answered.length ? answered[Math.floor(answered.length * 0.99)] : 100;
      const ymax = Math.min(3000, Math.max(100, p99 * 1.25, (res.latency.median || 50) * 2));
      const X = t => pad.l + ((w - pad.l - pad.r) * t) / duration, Y = v => pad.t + (h - pad.t - pad.b) * (1 - Math.min(v, ymax) / ymax);
      ctx.font = "11px sans-serif"; ctx.textBaseline = "middle";
      // load phases
      for (const ph of r.phases) if (ph.phase === "down" || ph.phase === "up") {
        const to = ph.to !== undefined ? ph.to : duration;
        ctx.fillStyle = "rgba(59,120,216,0.10)"; ctx.fillRect(X(ph.from), pad.t, Math.max(1, X(to) - X(ph.from)), h - pad.t - pad.b);
        ctx.fillStyle = "#3B78D8"; ctx.textAlign = "left"; ctx.fillText(ph.phase === "down" ? "downloading" : "uploading", X(ph.from) + 3, pad.t + 7);
      }
      // incidents
      for (const inc of res.incidents) if (inc.type === "outage" || inc.type === "stall" || inc.type === "loss") {
        ctx.fillStyle = "rgba(209,45,26,0.13)"; ctx.fillRect(X(inc.start), pad.t, Math.max(2, X(inc.end) - X(inc.start)), h - pad.t - pad.b);
      }
      // grid
      ctx.strokeStyle = "#E4E2D8"; ctx.fillStyle = "#555"; ctx.textAlign = "right"; ctx.lineWidth = 1;
      for (let k = 0; k <= 4; k++) { const v = (ymax * k) / 4, y = Math.round(Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); ctx.fillText(Math.round(v) + " ms", pad.l - 4, y); }
      ctx.textAlign = "center"; const stepS = duration > 240000 ? 60 : duration > 90000 ? 20 : duration > 40000 ? 10 : 5;
      for (let s = 0; s * 1000 <= duration; s += stepS) { const x = Math.round(X(s * 1000)) + 0.5; ctx.beginPath(); ctx.moveTo(x, h - pad.b); ctx.lineTo(x, h - pad.b + 4); ctx.stroke(); ctx.fillText(NA.mmss(s * 1000), x, h - 6); }
      // the line of the typical delay
      if (Number.isFinite(res.latency.median)) { ctx.setLineDash([4, 4]); ctx.strokeStyle = "#9AA"; ctx.beginPath(); ctx.moveTo(pad.l, Y(res.latency.median)); ctx.lineTo(w - pad.r, Y(res.latency.median)); ctx.stroke(); ctx.setLineDash([]); }
      // the probes (smaller dots when there are very many)
      const dotR = samples.length > 4000 ? 1.3 : samples.length > 1500 ? 1.8 : 2.3;
      for (const s of samples) {
        const x = X(s.t);
        if (s.ch === "e") { if (s.ok && !s.deviceBusy) { ctx.fillStyle = "#3B78D8"; ctx.save(); ctx.translate(x, Y(s.rtt)); ctx.rotate(Math.PI / 4); ctx.fillRect(-1.6, -1.6, 3.2, 3.2); ctx.restore(); } continue; }
        if (s.deviceBusy) { ctx.fillStyle = "#A0A0A0"; ctx.beginPath(); ctx.arc(x, h - pad.b - 5, 2.4, 0, 7); ctx.fill(); continue; }
        if (s.timeout) { ctx.strokeStyle = "#D12D1A"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + 9); ctx.stroke(); ctx.fillStyle = "#D12D1A"; ctx.beginPath(); ctx.arc(x, pad.t + 12, 2.6, 0, 7); ctx.fill(); ctx.lineWidth = 1; continue; }
        if (!s.ok) continue;
        ctx.fillStyle = s.spike ? "#E08A00" : "#2A9D3A"; ctx.beginPath(); ctx.arc(x, Y(s.rtt), dotR, 0, 7); ctx.fill();
        if (s.rtt > ymax) { ctx.fillStyle = "#E08A00"; ctx.fillRect(x - 2, pad.t - 1, 4, 3); }
      }
      // marks
      ctx.setLineDash([5, 3]); ctx.strokeStyle = "#7A2E9E"; ctx.fillStyle = "#7A2E9E"; ctx.textAlign = "center";
      for (const t of r.marks) { const x = Math.round(X(t)) + 0.5; ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke(); ctx.fillText("M", x, pad.t - 4); }
      ctx.setLineDash([]);
      if (!target) $("graph").setAttribute("aria-label", `Delay of every probe over time. ${res.sentence}`);
    }
    function drawDirection(r, res, target, fixed) {
      const cv = target || $("dir"), d = res.direction;
      if (!target) cv.hidden = $("dirlegend").hidden = !d.available;
      if (!d.available) return;
      const { ctx, w, h } = setup(cv, fixed), pad = { l: 46, r: 10, t: 6, b: 6 }, mid = h / 2;
      const duration = Math.max(10000, (r.ended !== undefined ? r.ended : performance.now() - r.start) + 500);
      const X = t => pad.l + ((w - pad.l - pad.r) * t) / duration;
      const peak = Math.max(30, d.up.p95 * 1.3, d.down.p95 * 1.3), sc = (mid - pad.t - 2) / peak;
      ctx.strokeStyle = "#999"; ctx.beginPath(); ctx.moveTo(pad.l, mid + 0.5); ctx.lineTo(w - pad.r, mid + 0.5); ctx.stroke();
      ctx.fillStyle = "#555"; ctx.font = "11px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText("to", pad.l - 6, mid - 12); ctx.fillText("back", pad.l - 6, mid + 12);
      for (let k = 0; k < d.t.length; k++) {
        const x = X(d.t[k]);
        ctx.fillStyle = "#3B78D8"; ctx.fillRect(x - 1, mid - Math.min(d.upx[k], peak) * sc, 2, Math.min(d.upx[k], peak) * sc);
        ctx.fillStyle = "#E08A00"; ctx.fillRect(x - 1, mid + 1, 2, Math.min(d.downx[k], peak) * sc);
      }
    }

    /* ---------- buttons ---------- */
    function mark() {
      if (!run) return;
      run.marks.push(performance.now() - run.start);
      const b = $("mark"); b.classList.add("flash"); setTimeout(() => b.classList.remove("flash"), 400);
      setStatus(`Marked at ${NA.mmss(run.marks[run.marks.length - 1])}. Keep going; the report will tell you what the network did at that moment.`);
      refresh();
    }
    function reportText() {
      if (!last) return "";
      const r = last.run;
      return NA.report(last.result, { when: new Date().toLocaleString(), protocol: r.proto ? r.proto.toUpperCase() : "", colo: r.edge && r.edge.colo, edgeName: edgeName(r), seconds: (r.ended || 0) / 1000 });
    }
    async function copy() {
      const t = reportText();
      try { await navigator.clipboard.writeText(t); setStatus("Report copied."); }
      catch { const ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.append(ta); ta.select(); try { document.execCommand("copy"); setStatus("Report copied."); } catch { setStatus("Could not copy: use Save report instead."); } ta.remove(); }
    }
    // one self-contained HTML file: the verdict, both graphs (drawn again at report size), the findings and every indicator
    function saveHtml() {
      if (!last) return;
      const r = last.run, res = last.result;
      const g = document.createElement("canvas"), dcv = document.createElement("canvas");
      drawGraph(r, res, g, { w: 1100, h: 380, dpr: 2 });
      if (res.direction.available) drawDirection(r, res, dcv, { w: 1100, h: 130, dpr: 2 });
      const now = new Date(), pad2 = n => String(n).padStart(2, "0");
      const html = window.NetReport.build(res, {
        when: now.toLocaleString(), host: location.host, protocol: r.proto ? r.proto.toUpperCase() : "", colo: r.edge && r.edge.colo, edgeName: edgeName(r), seconds: (r.ended || 0) / 1000,
        mode: r.mode === "monitor" ? (r.fine ? "Monitor, fine detail (a probe every 50 ms)" : "Monitor") : r.load ? `Quick test with the speed test (${SC.LEVELS[r.speedLevel].label}, up to ${mb(SC.LEVELS[r.speedLevel].total)} MB)` : "Quick test",
        images: { graph: g.toDataURL("image/png"), dir: res.direction.available ? dcv.toDataURL("image/png") : null },
      });
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = `connection-quality-report-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}.html`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      setStatus("HTML report saved.");
    }
    function save() { const blob = new Blob([reportText()], { type: "text/plain;charset=utf-8" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "connection-quality-report.txt"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); setStatus("Report saved."); }
    function clear() {
      if (run) return;
      last = null; $("results").hidden = true; $("intro").hidden = false; $("copy").disabled = $("save").disabled = $("savehtml").disabled = $("clear").disabled = true; $("meta").textContent = ""; setStatus("Ready");
    }

    $("start").addEventListener("click", start);
    $("stop").addEventListener("click", stop);
    $("mark").addEventListener("click", mark);
    $("copy").addEventListener("click", copy);
    $("save").addEventListener("click", save);
    $("savehtml").addEventListener("click", saveHtml);
    $("clear").addEventListener("click", clear);
    root.addEventListener("keydown", e => { if ((e.key === "m" || e.key === "M") && run && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { e.preventDefault(); mark(); } });
    for (const el of root.querySelectorAll('input[name="netquality-mode"]')) el.addEventListener("change", () => { updateMonitorOption(); updateSpeedOptions(); });
    // the speed level and the plan figures are remembered in this browser; on a phone connection or with data saver on, the transfer is off until the visitor chooses
    {
      const saved = store.get("speed"), c = navigator.connection, metered = !!(c && (c.saveData || c.type === "cellular"));
      const pick = saved && SC.LEVELS[saved] ? saved : metered ? "none" : "light";
      root.querySelector('input[name="netquality-speed"][value="' + pick + '"]').checked = true;
      if (!saved && metered) $("speedhint").textContent = "Your browser reports a mobile connection or data saver, so the speed test starts switched off. Choose Light to measure the speed.";
      for (const id of ["plandown", "planup"]) { const v = store.get(id); if (v) $(id).value = v; $(id).addEventListener("change", () => store.set(id, $(id).value)); }
      for (const el of root.querySelectorAll('input[name="netquality-speed"]')) el.addEventListener("change", () => { store.set("speed", speedLevel()); $("speedhint").textContent = ""; });
    }
    updateSpeedOptions();
    updateMonitorOption(); pollMonitor();
    monTimer = setInterval(() => { if (!run) pollMonitor(); }, 8000);
    window.addEventListener("pagehide", () => { if (run) releaseMonitor(run); });
    let rz = 0;
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { const r = run || (last && last.run); if (r && !$("results").hidden) refresh(true); }, 120); }).observe($("content"));

    return { destroy() { if (run) { run.stopping = true; clearTimeout(run.timer); releaseMonitor(run); } clearInterval(uiTimer); clearInterval(monTimer); clearTimeout(rz); if (observer) observer.disconnect(); run = null; } };
  }

  return { init };
})();
