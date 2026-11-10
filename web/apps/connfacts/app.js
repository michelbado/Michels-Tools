/* Connection Facts: what the site sees of the visitor and how the visitor reaches it.
   About fifteen tiny requests go to this site (and to its CDN edge, if there is one); everything shown is worked out in the browser
   by web/lib/connfacts.js. Nothing typed or uploaded is used. Text is only ever put on the page with textContent. */
(window.DesktopApps = window.DesktopApps || {}).connfacts = (() => {
  const CF = window.ConnFacts, CDN = window.CDN;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ROUNDS = 5;        // requests to the site
  const EDGE_ROUNDS = 8;   // requests to the CDN edge

  function init(root, shell) {
    const $ = id => root.querySelector("#connfacts-" + id);
    const setStatus = m => { $("status").textContent = m; };
    let busy = false, model = null, text = "", gone = false;

    // the browser's own timing record of one request (it can arrive a moment after the answer)
    async function entryFor(href) {
      for (let k = 0; k < 10; k++) {
        const l = performance.getEntriesByName(href, "resource");
        if (l.length) return l[l.length - 1];
        await sleep(10);
      }
      return null;
    }
    const fresh = () => Math.random().toString(36).slice(2, 10);

    async function collect() {
      const base = document.baseURI, d = { page: location.protocol, host: location.host, when: new Date().toLocaleString() };
      /* 1. the site: address, clock, headers, delay */
      setStatus("Asking the site what it sees...");
      const rtts = [], waits = [];
      let best = null;
      for (let i = 0; i < ROUNDS && !gone; i++) {
        const href = new URL(`api/facts?n=${fresh()}`, base).href;
        const wall = Date.now(), t0 = performance.now();
        try {
          const res = await fetch(href, { cache: "no-store", credentials: "same-origin" });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const j = await res.json(), t1 = performance.now(), rtt = t1 - t0;
          rtts.push(rtt);
          const e = await entryFor(href);
          if (e) { if (!d.proto && e.nextHopProtocol) d.proto = e.nextHopProtocol; if (e.requestStart > 0 && e.responseStart > e.requestStart) waits.push(e.responseStart - e.requestStart); }
          if (!d.facts) { d.facts = { ip: String(j.ip || ""), family: j.family === "IPv6" ? "IPv6" : j.family === "IPv4" ? "IPv4" : "", headers: Array.isArray(j.headers) ? j.headers.filter(h => h && typeof h.n === "string" && typeof h.v === "string") : [] }; d.cdn = CDN.detect(CDN.fromHeaders(res.headers)); d.respHeaders = CDN.fromHeaders(res.headers); }
          // the server read its clock about half-way through the round trip
          if (Number.isFinite(j.t) && (!best || rtt < best.rtt)) best = { rtt, offsetMs: j.t / 1000 - (wall + rtt / 2) };
        } catch { /* a missing answer is simply not counted */ }
        await sleep(120);
      }
      d.serverMs = CF.median(rtts.length > 2 ? rtts.slice(1) : rtts);   // the first one may include setting up the connection
      d.warmWait = CF.median(waits.length > 2 ? waits.slice(1) : waits);
      if (best) d.clock = best;

      /* 2. the CDN edge */
      if (!gone) {
        setStatus("Looking for a CDN in front of the site...");
        d.edge = await CDN.findEdge(base);
        if (d.edge) {
          setStatus(`Measuring the way to ${d.edge.name}...`);
          const t = [];
          for (let i = 0; i < EDGE_ROUNDS && !gone; i++) {
            const href = new URL(d.edge.kind === "cache" ? "edge-probe.txt" : `cdn-cgi/trace?q=${fresh()}`, base).href;
            const t0 = performance.now();
            try { const res = await fetch(href, { cache: "no-store" }); await res.text(); if (res.ok) t.push(performance.now() - t0); } catch { /* skip */ }
            await sleep(100);
          }
          d.edgeMs = CF.median(t.length > 2 ? t.slice(1) : t);
        }
      }

      /* 3. this page's own loading, the browser's network guess, language, time zone */
      try {
        const n = performance.getEntriesByType("navigation")[0];
        if (n && n.responseStart > 0) {
          const tlsAt = n.secureConnectionStart > 0 ? n.secureConnectionStart : 0;
          d.nav = {
            dns: Math.max(0, n.domainLookupEnd - n.domainLookupStart),
            connect: Math.max(0, (tlsAt || n.connectEnd) - n.connectStart),
            tls: tlsAt ? Math.max(0, n.connectEnd - tlsAt) : 0,
            wait: Math.max(0, n.responseStart - n.requestStart), download: Math.max(0, n.responseEnd - n.responseStart),
          };
          if (!d.proto && n.nextHopProtocol) d.proto = n.nextHopProtocol;
        }
      } catch { /* none */ }
      const c = navigator.connection || {};
      d.net = { effectiveType: c.effectiveType || "", rtt: Number.isFinite(c.rtt) ? c.rtt : NaN, downlink: Number.isFinite(c.downlink) ? c.downlink : NaN, saveData: !!c.saveData, type: c.type || "", online: navigator.onLine };
      d.lang = Array.from(navigator.languages || (navigator.language ? [navigator.language] : []));
      try { d.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { d.tz = ""; }
      return d;
    }

    function render(m) {
      $("summary").textContent = m.summary;
      const nl = $("notes"); nl.textContent = ""; nl.hidden = !m.notes.length;
      for (const n of m.notes) { const li = document.createElement("li"); li.className = n.level; li.textContent = n.text; nl.append(li); }
      const box = $("sections"); box.textContent = "";
      for (const s of m.sections) {
        const fs = document.createElement("fieldset"), lg = document.createElement("legend"), tb = document.createElement("table");
        lg.textContent = s.title; fs.append(lg);
        for (const [k, v, hint] of s.rows) {
          const tr = document.createElement("tr"), th = document.createElement("th"), td = document.createElement("td");
          th.textContent = k; td.textContent = v;
          if (hint) { const h = document.createElement("span"); h.className = "hint"; h.textContent = hint; td.append(h); }
          tr.append(th, td); tb.append(tr);
        }
        fs.append(tb);
        if (s.foot) { const p = document.createElement("p"); p.className = "foot"; p.textContent = s.foot; fs.append(p); }
        box.append(fs);
      }
    }

    async function check() {
      if (busy) return;
      busy = true; $("refresh").disabled = true; $("copy").disabled = $("save").disabled = true;
      $("summary").textContent = "Checking...";
      try {
        const d = await collect();
        if (gone) return;
        model = CF.buildModel(d);
        text = CF.toText(model, { when: d.when, host: d.host });
        render(model);
        $("copy").disabled = $("save").disabled = false;
        $("meta").textContent = d.facts && d.facts.ip ? `${d.facts.ip}${d.proto ? " | " + CF.protocolName(d.proto) : ""}` : "";
        setStatus("Done. " + (d.facts ? "" : "The site did not answer."));
      } catch (err) {
        $("summary").textContent = "The check could not finish.";
        setStatus("Error: " + (err && err.message ? err.message : "unknown"));
      } finally { busy = false; $("refresh").disabled = false; }
    }

    async function copy() {
      try { await navigator.clipboard.writeText(text); setStatus("Copied."); }
      catch { const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.append(ta); ta.select(); try { document.execCommand("copy"); setStatus("Copied."); } catch { setStatus("Copying is blocked here; use Save text."); } ta.remove(); }
    }
    function save() {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "connection-facts.txt"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }

    $("refresh").addEventListener("click", check);
    $("copy").addEventListener("click", copy);
    $("save").addEventListener("click", save);
    check();
    return { destroy() { gone = true; } };
  }

  return { init };
})();
