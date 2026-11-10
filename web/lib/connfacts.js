/* Connection Facts: turns what the page collected into sections of rows and plain-language notes, and into a text report.
   Pure functions (no network, no page): the screen in apps/connfacts/ collects the data and shows this model with textContent. */
(function (root) {
  "use strict";
  const ms = x => (!Number.isFinite(x) ? "?" : x < 10 ? (Math.round(x * 10) / 10).toFixed(1) : String(Math.round(x))) + " ms";
  const secs = x => { const a = Math.abs(x) / 1000; return a < 10 ? a.toFixed(1) + " s" : a < 120 ? Math.round(a) + " s" : a < 7200 ? Math.round(a / 60) + " min" : Math.round(a / 3600) + " h"; };
  const up = v => String(v).charAt(0).toUpperCase() + String(v).slice(1);
  const median = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };

  const PROTOCOLS = { h3: "HTTP/3 (QUIC)", h2: "HTTP/2", "http/1.1": "HTTP/1.1", "http/1.0": "HTTP/1.0" };
  const protocolName = p => PROTOCOLS[String(p || "").toLowerCase()] || (p ? String(p) : "not reported by the browser");

  // What the headers that a proxy or CDN adds mean, in a few words.
  const HEADER_HINTS = {
    "via": "A proxy or CDN handled the request on its way.",
    "x-forwarded-for": "The addresses the request passed through, the first one is yours.",
    "x-forwarded-proto": "How you connected to the proxy: https or http.",
    "x-forwarded-port": "The port you connected to on the proxy.",
    "forwarded": "The standard form of the information in the X-Forwarded headers.",
    "x-real-ip": "Your address, as the proxy saw it.",
    "true-client-ip": "Your address, as the CDN saw it.",
    "cf-connecting-ip": "Your address, as Cloudflare saw it.",
    "fastly-client-ip": "Your address, as Fastly saw it.",
    "cf-ray": "Cloudflare's request number; the letters at the end name the data centre.",
    "cf-visitor": "Cloudflare's note of how you connected.",
    "cloudfront-forwarded-proto": "How you connected to CloudFront.",
  };

  // data: see apps/connfacts/app.js. Every field may be missing.
  function buildModel(d) {
    const sections = [], notes = [];
    const note = (level, text) => notes.push({ level, text });
    const facts = d.facts || {}, edge = d.edge || null, net = d.net || {};
    const hdrs = {};
    for (const h of facts.headers || []) hdrs[String(h.n).toLowerCase()] = h.v;
    const respInfo = d.cdn || { vendor: "", known: false, pop: "", cache: "" };
    const sawProxy = Object.keys(hdrs).length > 0;
    const cdnName = edge ? edge.name : respInfo.known ? respInfo.vendor : "";

    /* ---- you ---- */
    const you = { title: "You, as the site sees you", rows: [] };
    if (facts.ip) you.rows.push(["Public address", `${facts.ip}`, facts.family ? `${facts.family}${facts.family === "IPv6" ? ": the newer address type" : ""}` : ""]);
    else you.rows.push(["Public address", "not available", "The server did not answer."]);
    sections.push(you);

    /* ---- the way to the site ---- */
    const path = { title: "The way to this site", rows: [] };
    if (edge || respInfo.vendor) {
      const name = edge ? edge.name : respInfo.vendor;
      const where = (edge && edge.colo) || respInfo.pop;
      path.rows.push(["Served through", up(name) + (where ? `, data centre ${where}` : ""), edge && edge.kind === "cache" ? "Found because the CDN keeps a test page in its cache." : edge ? "From the CDN's own trace page." : "From the headers of the answer."]);
    } else path.rows.push(["Served through", "no CDN detected", "You seem to connect to the server directly (or the CDN hides itself)."]);
    path.rows.push(["Web protocol", protocolName(d.proto), d.proto === "h3" ? "Newest and fastest on bad links; some firewalls block it." : d.proto === "http/1.1" ? "The oldest in use: only a few requests at a time." : ""]);
    let tls = "";
    if (d.page === "http:") tls = "not encrypted (plain http)";
    else if (edge && edge.trace && edge.trace.tls) tls = `${edge.trace.tls}, reported by ${edge.name}`;
    else if (d.page === "https:") tls = "encrypted (https); the browser does not tell the page which version";
    else tls = "unknown";
    path.rows.push(["Encryption", tls, ""]);
    if (edge && edge.trace && edge.trace.warp && edge.trace.warp !== "off") path.rows.push(["VPN / WARP", edge.trace.warp, "Cloudflare says your traffic comes through its WARP service."]);
    if (Number.isFinite(d.edgeMs)) path.rows.push(["Delay to the CDN's nearest data centre", ms(d.edgeMs), "Typical time for a tiny request to the CDN edge and back."]);
    if (Number.isFinite(d.serverMs)) path.rows.push(["Delay to the site", ms(d.serverMs), Number.isFinite(d.edgeMs) && d.serverMs > d.edgeMs + 5 ? `About ${ms(d.serverMs - d.edgeMs)} of it is from the CDN on to the server.` : "Typical time for a tiny request to this server and back."]);
    sections.push(path);

    /* ---- headers added on the way ---- */
    const hs = { title: "Headers added on the way", rows: [] };
    for (const h of facts.headers || []) hs.rows.push([h.n, h.v, HEADER_HINTS[String(h.n).toLowerCase()] || ""]);
    if (!hs.rows.length) hs.rows.push(["none", "", "The server received no proxy or CDN headers: the request looks direct."]);
    hs.foot = "Only a short list of well-known headers is shown. Cookies and other private headers are never shown, and addresses that belong to the inside of the hosting setup are hidden.";
    sections.push(hs);

    /* ---- your device ---- */
    const dev = { title: "Your device and browser", rows: [] };
    if (net.effectiveType || Number.isFinite(net.downlink) || Number.isFinite(net.rtt)) {
      const bits = [];
      if (net.type) bits.push(net.type);
      if (net.effectiveType) bits.push(`behaves like ${net.effectiveType}`);
      if (Number.isFinite(net.downlink)) bits.push(`about ${net.downlink} Mbit/s down`);
      if (Number.isFinite(net.rtt)) bits.push(`${net.rtt} ms round trip`);
      dev.rows.push(["Connection (browser's estimate)", bits.join(", "), "A rough guess made by the browser, not a measurement."]);
    } else dev.rows.push(["Connection (browser's estimate)", "not available", "Chrome and Edge give this; Firefox and Safari do not."]);
    if (net.saveData) dev.rows.push(["Data saver", "on", "The browser was asked to use less data."]);
    if (net.online === false) dev.rows.push(["Online", "the browser says it is offline", ""]);
    if (d.lang && d.lang.length) dev.rows.push(["Languages", d.lang.slice(0, 4).join(", "), ""]);
    if (d.tz) dev.rows.push(["Time zone", d.tz, ""]);
    if (d.clock && Number.isFinite(d.clock.offsetMs)) {
      const o = d.clock.offsetMs, off = Math.abs(o) >= 5000;
      dev.rows.push(["Clock", off ? `your clock is ${secs(o)} ${o < 0 ? "ahead of" : "behind"} the server` : `correct to within about ${secs(Math.max(1000, d.clock.rtt || 0))}`, off ? "A wrong clock breaks secure connections and sign-ins." : "Compared with the server's clock."]);
      if (off) note(Math.abs(o) >= 120000 ? "bad" : "warn", `Your device's clock is ${secs(o)} ${o < 0 ? "ahead of" : "behind"} the server. Sign-in codes, certificates and secure connections can fail when the clock is off. Switch on automatic time in the device settings.`);
    }
    sections.push(dev);

    /* ---- where the time goes ---- */
    const tm = { title: "Where the time goes", rows: [] };
    const nav = d.nav;
    if (nav) {
      const r = (label, v, hint) => tm.rows.push([label, Number.isFinite(v) ? ms(v) : "n/a", hint]);
      r("Loading this page: finding the address (DNS)", nav.dns, nav.dns < 1 ? "0: the address was already known." : nav.dns > 300 ? "Slow: the DNS server of your network or provider answered late." : "");
      r("Loading this page: connecting", nav.connect, nav.connect < 1 ? "0: an open connection was reused." : "");
      r("Loading this page: secure handshake", nav.tls, nav.tls < 1 && nav.connect < 1 ? "0: an open connection was reused." : "");
      r("Loading this page: waiting for the server", nav.wait, nav.wait > 800 ? "The server (or the CDN behind it) was slow to start answering." : "");
      r("Loading this page: receiving", nav.download, "");
      if (nav.dns > 300) note("warn", `Finding this site's address took ${ms(nav.dns)}: a slow DNS server makes every first visit to a site feel slow. Another DNS server may help.`);
      if (nav.connect + nav.tls > 800) note("warn", `Connecting and the secure handshake took ${ms(nav.connect + nav.tls)} when this page loaded, which points to a slow or lossy link.`);
    }
    if (Number.isFinite(d.warmWait)) tm.rows.push(["A request on the open connection: waiting for the answer", ms(d.warmWait), "Network round trip plus the server's own work."]);
    if (!tm.rows.length) tm.rows.push(["not available", "", "The browser did not give timing details."]);
    sections.push(tm);

    /* ---- notes ---- */
    if (d.page === "http:") note("warn", "This page was loaded without encryption (plain http): anyone on the path can read and change what you do here.");
    if (d.proto === "http/1.1" && d.page === "https:") note("info", "Your connection uses HTTP/1.1, the oldest web protocol: pages load with only a few requests at a time. A proxy, a firewall or an old network device in the path may be forcing this.");
    if (net.effectiveType && /^(slow-2g|2g|3g)$/.test(net.effectiveType)) note("info", `The browser thinks your connection behaves like ${net.effectiveType}, which is slow.`);
    if (net.saveData) note("info", "Data saver is on in your browser; pages may load in a reduced form.");
    if (net.online === false) note("warn", "The browser says this device is offline.");
    if (!edge && !respInfo.vendor && !sawProxy) note("info", "No CDN or proxy was detected: you appear to be talking to the server directly.");
    if (Number.isFinite(d.edgeMs) && d.edgeMs > 150) note("warn", `The CDN's nearest data centre needs ${ms(d.edgeMs)}, which is far. Your provider may route your traffic a long way around.`);
    else if (Number.isFinite(d.edgeMs) && Number.isFinite(d.serverMs) && d.serverMs - d.edgeMs > 150) note("info", `Reaching the CDN takes ${ms(d.edgeMs)} but the site answers after ${ms(d.serverMs)}: most of the delay is between the CDN and the server, not on your side.`);

    // a sentence on top
    const bits = [];
    if (facts.family) bits.push(facts.family);
    bits.push(cdnName ? `through ${cdnName}${(edge && edge.colo) || respInfo.pop ? " (" + ((edge && edge.colo) || respInfo.pop) + ")" : ""}` : "straight to the server");
    if (d.proto) bits.push(protocolName(d.proto));
    const summary = `You are connected over ${bits.join(", ")}.`;
    return { summary, sections, notes };
  }

  function toText(model, meta = {}) {
    const L = [`Connection Facts (Michel's Tools)`];
    if (meta.when) L.push(`Date: ${meta.when}`);
    if (meta.host) L.push(`Site: ${meta.host}`);
    L.push("", model.summary);
    for (const s of model.sections) {
      L.push("", s.title.toUpperCase());
      for (const [k, v, hint] of s.rows) L.push(v === "" ? `- ${k}${hint ? " (" + hint + ")" : ""}` : `- ${k}: ${v}`);
    }
    if (model.notes.length) { L.push("", "NOTES"); for (const n of model.notes) L.push(`- ${n.text}`); }
    L.push("", "Taken in the browser: nothing typed or uploaded is used and nothing is stored on the server.");
    return L.join("\n");
  }

  const api = { buildModel, toText, protocolName, median, ms, secs };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.ConnFacts = api;
})(typeof self !== "undefined" ? self : this);
