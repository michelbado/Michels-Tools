/* Idle-timeout finder. Two requests are held open by the server (GET /api/hold): one silent, one with a heartbeat. The page times them
   and lib/idleanalysis.js explains the outcome. Text only reaches the page through textContent. window.__idleTest = { secs } is a test hook. */
(window.DesktopApps = window.DesktopApps || {}).idletest = (() => {
  const BEAT = 15;
  const PROTO = { "h2": "HTTP/2", "h3": "HTTP/3 (QUIC)", "http/1.1": "HTTP/1.1", "http/1.0": "HTTP/1.0" };
  function init(root) {
    const $ = id => root.querySelector("#idletest-" + id);
    const A = window.IdleAnalysis, TK = window.TK;
    const setStatus = m => { $("status").textContent = m; };
    let running = false, gone = false, ctl = null, ticker = 0, text = "", maxSecs = 300;

    async function one(kind, secs, signal, t0, onState) {
      const url = new URL(`api/hold?secs=${secs}${kind === "beat" ? "&beat=" + BEAT : ""}&id=${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 8)}`, document.baseURI).href;
      const done = o => { o.planned = secs; if (!o.elapsed) o.elapsed = (performance.now() - t0) / 1000; return o; };
      try {
        const res = await fetch(url, { cache: "no-store", signal, credentials: "same-origin" });
        if (res.status === 409) {   // the browser quietly repeated a request the path had cut: the server says when the first one began
          let age = NaN; try { age = (await res.json()).age / 1000; } catch { /* none */ }
          return done({ ok: false, error: "the browser had to retry", elapsed: Number.isFinite(age) && age > 0 ? age : (performance.now() - t0) / 1000 });
        }
        if (!res.ok) return done({ ok: false, status: res.status, elapsed: (performance.now() - t0) / 1000 });
        let ok = false;
        if (kind === "quiet") { const j = await res.json(); ok = j && j.held === secs; }
        else {
          const rd = res.body.getReader(), dec = new TextDecoder();
          let tail = "";
          for (;;) { const { value, done: fin } = await rd.read(); if (fin) break; tail = (tail + dec.decode(value, { stream: true })).slice(-40); onState({ alive: true }); }
          ok = tail.includes("held " + secs);
        }
        const el = (performance.now() - t0) / 1000;
        let proto = "";
        try { const e = performance.getEntriesByName(url, "resource"); if (e.length) proto = PROTO[e[e.length - 1].nextHopProtocol] || e[e.length - 1].nextHopProtocol || ""; } catch { /* none */ }
        if (ok && el >= secs - 2) return done({ ok: true, elapsed: el, proto });
        return done({ ok: false, elapsed: el, error: ok ? "ended early" : "answer incomplete", proto });
      } catch (e) {
        if (signal.aborted) return done({ ok: false, stopped: true });
        return done({ ok: false, error: "network error" });
      }
    }

    function paint(kind, secs, t0, out) {
      const el = (performance.now() - t0) / 1000, shown = Math.min(el, secs);
      $("fill" + kind).style.width = (100 * shown / secs).toFixed(1) + "%";
      $("num" + kind).textContent = out ? (out.ok ? "survived " + A.sec(secs) : out.stopped ? "stopped at " + A.sec(out.elapsed) : "CUT at " + A.sec(out.elapsed)) : Math.floor(shown) + " s of " + secs + " s";
      if (out && !out.ok && !out.stopped) $("fill" + kind).classList.add("cut");
    }

    async function start() {
      if (running) return;
      const T = window.__idleTest || {};
      const chosen = +root.querySelector("input[name=idletest-len]:checked").value;
      const secs = T.secs || Math.min(chosen, maxSecs);
      running = true; ctl = new AbortController();
      $("start").disabled = true; $("stop").disabled = false; $("copy").disabled = $("save").disabled = true;
      $("summary").textContent = ""; TK.notes($("notes"), []); $("sections").textContent = "";
      $("progress").hidden = false;
      for (const k of ["q", "b"]) { $("fill" + k).style.width = "0"; $("fill" + k).classList.remove("cut"); $("num" + k).textContent = "0 s of " + secs + " s"; }
      setStatus("Waiting. This takes up to " + secs + " seconds. Keep this window open.");
      const t0 = performance.now(), res = {};
      let lastTick = Date.now(), slept = false;
      ticker = setInterval(() => {
        const now = Date.now(); if (now - lastTick > 6000) slept = true; lastTick = now;
        if (!res.q) paint("q", secs, t0); if (!res.b) paint("b", secs, t0);
      }, 250);
      const pq = one("quiet", secs, ctl.signal, t0, () => {}).then(o => { res.q = o; paint("q", secs, t0, o); return o; });
      const pb = one("beat", secs, ctl.signal, t0, () => {}).then(o => { res.b = o; paint("b", secs, t0, o); return o; });
      // if one test is cut, the other may still run for minutes: that is wanted (it shows what a heartbeat does)
      await Promise.all([pq, pb]);
      clearInterval(ticker); ticker = 0;
      running = false;
      if (gone) return;
      $("start").disabled = false; $("stop").disabled = true;
      const r = A.interpret(res.q, res.b, { beat: BEAT, protocol: (res.q && res.q.proto) || (res.b && res.b.proto) || "", slept });
      $("summary").textContent = r.summary;
      TK.notes($("notes"), r.notes);
      TK.render($("sections"), [{ title: "What was measured", rows: r.rows }]);
      text = A.toText(r, { when: new Date().toLocaleString(), host: location.host });
      $("copy").disabled = $("save").disabled = false;
      setStatus(r.kind === "stopped" ? "Stopped." : "Done.");
    }
    function stop() { if (ctl) ctl.abort(); }

    $("start").addEventListener("click", start);
    $("stop").addEventListener("click", stop);
    $("copy").addEventListener("click", () => TK.copy(text, setStatus));
    $("save").addEventListener("click", () => TK.save("idle-timeout.txt", text));
    (async () => {   // what this server allows
      try {
        const res = await fetch(new URL("api/hold", document.baseURI).href, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const j = await res.json();
        if (gone) return;
        maxSecs = Math.max(1, +j.max || 300);
        for (const v of [60, 120, 300]) { const r = $("len" + v); if (v > maxSecs) { r.disabled = true; if (r.checked) r.checked = false; } }
        if (!root.querySelector("input[name=idletest-len]:checked")) { const ok = [300, 120, 60].map(v => $("len" + v)).find(r => !r.disabled); if (ok) ok.checked = true; }
        if (maxSecs < 300) setStatus("Ready. This server allows tests up to " + maxSecs + " seconds.");
      } catch { setStatus("The test is not available on this server."); $("start").disabled = true; }
    })();
    return { destroy() { gone = true; if (ctl) ctl.abort(); if (ticker) clearInterval(ticker); } };
  }
  return { init };
})();
