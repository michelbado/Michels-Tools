/* CDN recognition, shared by Connection Quality and Connection Facts. Pure functions, no network access.
   Input is a plain object of response headers with lower-case names. The answer is a best guess from well-known headers;
   an unknown CDN is reported as "a proxy or CDN" rather than guessed. */
(function (root) {
  "use strict";
  const g = (h, k) => String(h[k] == null ? "" : h[k]);

  // Each entry: name, test(h), pop(h) = the data centre as the CDN names it, cache(h) = hit / miss text (if given).
  const VENDORS = [
    { name: "Cloudflare", test: h => "cf-ray" in h || /cloudflare/i.test(g(h, "server")),
      pop: h => (/-([A-Za-z]{3})$/.exec(g(h, "cf-ray")) || [])[1] || "", cache: h => g(h, "cf-cache-status") },
    { name: "Bunny CDN", test: h => /^bunnycdn/i.test(g(h, "server")) || "cdn-pullzone" in h || "cdn-requestid" in h,
      pop: h => (/^BunnyCDN-([A-Za-z0-9]+)-/i.exec(g(h, "server")) || [])[1] || "", cache: h => g(h, "cdn-cache") },
    { name: "Amazon CloudFront", test: h => "x-amz-cf-id" in h || "x-amz-cf-pop" in h || /cloudfront/i.test(g(h, "via")),
      pop: h => g(h, "x-amz-cf-pop"), cache: h => g(h, "x-cache") },
    { name: "Fastly", test: h => "fastly-debug-digest" in h || /cache-[a-z0-9]+-[A-Za-z]{3}/.test(g(h, "x-served-by")),
      pop: h => { const m = /-([A-Za-z]{3})\d*$/.exec(g(h, "x-served-by").split(",").pop().trim()); return m ? m[1].toUpperCase() : ""; }, cache: h => g(h, "x-cache") },
    { name: "Akamai", test: h => /akamai/i.test(g(h, "server")) || Object.keys(h).some(k => k.startsWith("x-akamai")),
      pop: () => "", cache: h => g(h, "x-cache") },
    { name: "Azure Front Door", test: h => "x-azure-ref" in h, pop: () => "", cache: h => g(h, "x-cache") },
    { name: "KeyCDN", test: h => /keycdn/i.test(g(h, "server")) || "x-edge-location" in h, pop: h => g(h, "x-edge-location"), cache: h => g(h, "x-cache") },
  ];


  function detect(h) {
    h = h || {};
    for (const v of VENDORS) {
      if (v.test(h)) {
        const cache = String(v.cache(h) || "").trim();
        return { vendor: v.name, known: true, pop: String(v.pop(h) || "").trim(), cache };
      }
    }
    const hint = g(h, "via") || g(h, "x-cache") || (("age" in h) ? "age header present" : "");
    if (hint) return { vendor: "a proxy or CDN", known: false, pop: "", cache: g(h, "x-cache"), hint: hint.slice(0, 120) };
    return { vendor: "", known: false, pop: "", cache: "" };
  }

  // Cloudflare's /cdn-cgi/trace: lines of key=value. Only counts when it has a colo= line.
  function parseTrace(text) {
    const o = {};
    for (const line of String(text).split("\n")) { const i = line.indexOf("="); if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + 1).trim().slice(0, 100); }
    return /^[A-Za-z0-9]{2,5}$/.test(o.colo || "") ? o : null;
  }

  // Name used in sentences: "Cloudflare", "Bunny CDN" or "the CDN".
  function displayName(edge) { return edge && edge.known && edge.vendor ? edge.vendor : "the CDN"; }

  // Did a cache answer? Two answers of /edge-probe.txt are the same only when something kept the first one.
  function sameStamp(a, b) { return /^edge-probe \d{10,}\s*$/.test(a) && a === b; }

  // Plain headers object from a fetch Headers (lower-case names).
  function fromHeaders(headers) {
    const o = {};
    try { headers.forEach((v, k) => { o[String(k).toLowerCase()] = v; }); } catch { /* none */ }
    return o;
  }

  // Is a CDN in front of the server? First Cloudflare's own trace page (it names the data centre). Otherwise a small page that the server
  // renews on every request: two answers 0.7 s apart that are identical prove that something in between kept the first one.
  // Resolves to { kind: "trace"|"cache", vendor, name, colo, trace?, stamp?, headers } or null. Needs a browser (fetch).
  async function findEdge(base) {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    try {
      const res = await fetch(new URL("cdn-cgi/trace", base), { cache: "no-store" });
      if (res.ok) { const tr = parseTrace(await res.text()); if (tr) return { kind: "trace", vendor: "Cloudflare", name: "Cloudflare", colo: tr.colo, trace: tr }; }
    } catch { /* try the next way */ }
    try {
      const url = new URL("edge-probe.txt", base);
      const x = await fetch(url, { cache: "no-store" });
      if (!x.ok) return null;
      const tx = await x.text(), headers = fromHeaders(x.headers), info = detect(headers);
      await wait(700);
      const y = await fetch(url, { cache: "no-store" });
      if (!y.ok) return null;
      const ty = await y.text();
      if (!sameStamp(tx, ty)) return null;
      return { kind: "cache", vendor: info.vendor, name: displayName(info), colo: info.pop || "", stamp: ty, headers };
    } catch { return null; }
  }

  const api = { detect, parseTrace, displayName, sameStamp, fromHeaders, findEdge };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CDN = api;
})(typeof self !== "undefined" ? self : this);
