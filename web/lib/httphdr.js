/* HTTP response header reader: explains pasted response headers (from curl -I / -i / -v, a browser's developer tools, or a proxy log)
   and checks the security headers, cookies, caching, CORS and what the server gives away. Works only on pasted text: it makes no request.
   Cookie VALUES are never shown or copied (they can be session secrets). Pure; exports window.HttpHdr. */
(() => {
  "use strict";
  const STATUS = { 100: "Continue", 101: "Switching Protocols", 200: "OK", 201: "Created", 202: "Accepted", 204: "No Content", 206: "Partial Content", 301: "Moved Permanently", 302: "Found (temporary redirect)", 303: "See Other", 304: "Not Modified", 307: "Temporary Redirect", 308: "Permanent Redirect", 400: "Bad Request", 401: "Unauthorized (login needed)", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 408: "Request Timeout", 410: "Gone", 413: "Payload Too Large", 421: "Misdirected Request", 429: "Too Many Requests", 500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout", 520: "Web server returned an unknown error (Cloudflare)", 521: "Web server is down (Cloudflare)", 522: "Connection timed out (Cloudflare)", 523: "Origin unreachable (Cloudflare)", 524: "A timeout occurred (Cloudflare)" };

  // ---------- reading the pasted text ----------
  // -> { responses: [{ line, version, status, reason, headers: [{ name, value }] }], request: bool }
  function parse(text) {
    const lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
    const responses = []; let cur = null, request = false;
    for (let raw of lines) {
      if (/^\* /.test(raw) || /^> /.test(raw) && !/^> *$/.test(raw)) { if (/^> (GET|POST|HEAD|PUT|DELETE|OPTIONS|PATCH) /.test(raw)) request = true; continue; }
      raw = raw.replace(/^< ?/, "");
      const line = raw.replace(/\s+$/, "");
      const st = /^(HTTP\/\d(?:\.\d)?)\s+(\d{3})(?:\s+(.*))?$/i.exec(line);
      if (st) { cur = { line: line.trim(), version: st[1].toUpperCase(), status: +st[2], reason: (st[3] || "").trim(), headers: [] }; responses.push(cur); continue; }
      if (/^(GET|POST|HEAD|PUT|DELETE|OPTIONS|PATCH) \S+ HTTP\/\d/i.test(line)) { request = true; continue; }
      if (!line.trim()) { continue; }
      if (/^[ \t]/.test(raw) && cur && cur.headers.length) { cur.headers[cur.headers.length - 1].value += " " + line.trim(); continue; }
      const m = /^(:?[A-Za-z0-9!#$%&'*+.^_`|~-]+):[ \t]*(.*)$/.exec(line);
      if (m) {
        if (!cur) { cur = { line: "", version: "", status: 0, reason: "", headers: [] }; responses.push(cur); }
        cur.headers.push({ name: m[1], value: m[2].trim() });
      }
    }
    for (const r of responses) { const s = r.headers.find(h => h.name.toLowerCase() === ":status"); if (s && !r.status) { r.status = +s.value || 0; r.version = r.version || "HTTP/2"; } r.headers = r.headers.filter(h => h.name.toLowerCase() !== ":status"); }
    return { responses, request };
  }

  const getAll = (r, n) => r.headers.filter(h => h.name.toLowerCase() === n).map(h => h.value);
  const get = (r, n) => { const a = getAll(r, n); return a.length ? a[0] : undefined; };
  const lowerMap = r => { const o = {}; for (const h of r.headers) { const k = h.name.toLowerCase(); o[k] = o[k] === undefined ? h.value : o[k] + ", " + h.value; } return o; };
  const cut = (s, n) => (s.length > n ? s.slice(0, n) + " ..." : s);

  // ---------- the checks ----------
  // each returns { name, level: good|warn|bad|missing|info, value, text }
  function hsts(r) {
    const v = get(r, "strict-transport-security");
    if (v === undefined) return { name: "Strict-Transport-Security", level: "missing", value: "", text: "Not sent. Once the whole site works over https, add this header so browsers never try plain http again (only https answers should carry it)." };
    const age = /max-age\s*=\s*"?(\d+)/i.exec(v), sub = /includesubdomains/i.test(v), pre = /preload/i.test(v);
    if (!age) return { name: "Strict-Transport-Security", level: "bad", value: v, text: "No max-age value: browsers ignore this header." };
    const n = +age[1];
    if (n === 0) return { name: "Strict-Transport-Security", level: "bad", value: v, text: "max-age=0 switches HSTS OFF in browsers that already saw it." };
    if (n < 15552000) return { name: "Strict-Transport-Security", level: "warn", value: v, text: "max-age is only " + (n < 86400 ? n + " seconds" : Math.round(n / 86400) + " days") + ". Use at least 180 days, ideally one year (31536000)." };
    let t = "Browsers will use https only for " + Math.round(n / 86400) + " days" + (sub ? ", subdomains included" : "") + ".";
    if (pre && (!sub || n < 31536000)) t += " \"preload\" needs includeSubDomains and a max-age of at least one year to be accepted for the browsers' preload list.";
    return { name: "Strict-Transport-Security", level: "good", value: v, text: t };
  }
  function cspParse(v) { const d = {}; for (const part of v.split(";")) { const t = part.trim().split(/\s+/); if (t[0]) { const k = t[0].toLowerCase(); if (!(k in d)) d[k] = t.slice(1); } } return d; }
  function csp(r) {
    const v = get(r, "content-security-policy"), ro = get(r, "content-security-policy-report-only");
    if (v === undefined) {
      if (ro !== undefined) return { name: "Content-Security-Policy", level: "warn", value: cut(ro, 200), text: "Only the Report-Only version is sent: violations are reported but nothing is blocked. Switch to Content-Security-Policy when the reports are clean." };
      return { name: "Content-Security-Policy", level: "missing", value: "", text: "Not sent. A CSP limits where scripts, styles and frames may come from and is the main defence against injected scripts." };
    }
    const d = cspParse(v), issues = [], good = [];
    const script = d["script-src"] || d["default-src"], scriptName = d["script-src"] ? "script-src" : "default-src";
    let sev = 0;
    if (!script) { issues.push("neither script-src nor default-src is set, so scripts are not restricted"); sev = Math.max(sev, 1); }
    else {
      const t = script.map(x => x.toLowerCase()), nonceOrHash = t.some(x => /^'(nonce-|sha(256|384|512)-)/.test(x)), dyn = t.includes("'strict-dynamic'");
      if (t.includes("'unsafe-inline'") && !nonceOrHash && !dyn) { issues.push(scriptName + " allows 'unsafe-inline': any injected inline script runs"); sev = 2; }
      if (t.includes("'unsafe-eval'")) { issues.push(scriptName + " allows 'unsafe-eval'"); sev = Math.max(sev, 1); }
      if (t.includes("*") || t.includes("https:") || t.includes("http:") || t.includes("data:")) { issues.push(scriptName + " allows scripts from " + (t.includes("*") ? "any host (*)" : t.includes("data:") ? "data: URLs" : "any " + (t.includes("http:") ? "http" : "https") + " host")); sev = Math.max(sev, t.includes("*") || t.includes("data:") ? 2 : 1); }
      if (nonceOrHash || dyn) good.push("uses a nonce, hash or 'strict-dynamic'");
    }
    const info = [];
    if (!("object-src" in d) && !(d["default-src"] || []).includes("'none'")) info.push("no object-src 'none'");
    if (!("base-uri" in d)) info.push("no base-uri");
    if (!("frame-ancestors" in d)) info.push("no frame-ancestors");
    if ("upgrade-insecure-requests" in d) good.push("upgrades http requests to https");
    const level = sev === 2 ? "bad" : sev === 1 ? "warn" : "good";
    let text = issues.length ? "Problems: " + issues.join("; ") + "." : "No dangerous script source found.";
    if (good.length) text += " Good: " + good.join(", ") + ".";
    if (info.length) text += " Could add: " + info.join(", ") + ".";
    return { name: "Content-Security-Policy", level, value: cut(v, 200), text };
  }
  function xcto(r) {
    const v = get(r, "x-content-type-options");
    if (v === undefined) return { name: "X-Content-Type-Options", level: "missing", value: "", text: "Not sent. Add \"nosniff\" so browsers do not guess a file's type and run, for example, an uploaded text file as a script." };
    return /nosniff/i.test(v) ? { name: "X-Content-Type-Options", level: "good", value: v, text: "Browsers will not guess content types." } : { name: "X-Content-Type-Options", level: "bad", value: v, text: "The only valid value is \"nosniff\"." };
  }
  function frame(r) {
    const v = get(r, "x-frame-options"), c = get(r, "content-security-policy"), fa = c !== undefined && "frame-ancestors" in cspParse(c);
    if (fa) return { name: "Clickjacking protection", level: "good", value: v !== undefined ? "X-Frame-Options: " + v + "; CSP frame-ancestors" : "CSP frame-ancestors", text: "The Content-Security-Policy frame-ancestors directive controls who may put this page in a frame." };
    if (v === undefined) return { name: "Clickjacking protection", level: "missing", value: "", text: "Neither X-Frame-Options nor a CSP frame-ancestors directive: other sites can put this page in a hidden frame. Add frame-ancestors 'none' (or 'self') to the CSP." };
    if (/^\s*(deny|sameorigin)\s*$/i.test(v)) return { name: "Clickjacking protection", level: "good", value: "X-Frame-Options: " + v, text: "Framing is " + (/deny/i.test(v) ? "blocked" : "limited to the same site") + "." };
    if (/allow-from/i.test(v)) return { name: "Clickjacking protection", level: "warn", value: "X-Frame-Options: " + v, text: "ALLOW-FROM is obsolete and ignored by current browsers. Use CSP frame-ancestors." };
    return { name: "Clickjacking protection", level: "bad", value: "X-Frame-Options: " + v, text: "Not a valid value (use DENY or SAMEORIGIN, or better a CSP frame-ancestors)." };
  }
  function referrer(r) {
    const v = get(r, "referrer-policy");
    if (v === undefined) return { name: "Referrer-Policy", level: "missing", value: "", text: "Not sent. Browsers today default to strict-origin-when-cross-origin, which is reasonable, but saying it explicitly protects older browsers." };
    const last = v.split(",").map(x => x.trim().toLowerCase()).filter(Boolean).pop() || "";
    if (/^(unsafe-url|no-referrer-when-downgrade)$/.test(last)) return { name: "Referrer-Policy", level: "warn", value: v, text: last + " sends the full address of this page (with its path and query) to other sites. Prefer strict-origin-when-cross-origin or no-referrer." };
    if (/^(no-referrer|same-origin|strict-origin|strict-origin-when-cross-origin|origin|origin-when-cross-origin|)$/.test(last)) return { name: "Referrer-Policy", level: "good", value: v, text: "Limits what other sites learn about where visitors came from." };
    return { name: "Referrer-Policy", level: "bad", value: v, text: "\"" + last + "\" is not a valid policy." };
  }
  function perms(r) {
    const v = get(r, "permissions-policy"), old = get(r, "feature-policy");
    if (v !== undefined) return { name: "Permissions-Policy", level: "good", value: cut(v, 200), text: "Controls which browser features (camera, microphone, location ...) this page and its frames may use." };
    if (old !== undefined) return { name: "Permissions-Policy", level: "warn", value: "Feature-Policy: " + cut(old, 160), text: "Only the old Feature-Policy header is sent; browsers now use Permissions-Policy." };
    return { name: "Permissions-Policy", level: "missing", value: "", text: "Not sent. Optional but recommended: switch off browser features the site does not use, such as camera=(), microphone=(), geolocation=()." };
  }

  // ---------- cookies ----------
  function cookies(r) {
    const out = [];
    for (const raw of getAll(r, "set-cookie")) {
      const parts = raw.split(";").map(s => s.trim()), eq = parts[0].indexOf("="), name = eq < 0 ? parts[0] : parts[0].slice(0, eq);
      const attrs = {}; for (const p of parts.slice(1)) { const i = p.indexOf("="); attrs[(i < 0 ? p : p.slice(0, i)).toLowerCase()] = i < 0 ? true : p.slice(i + 1); }
      const secure = "secure" in attrs, httpOnly = "httponly" in attrs, same = typeof attrs.samesite === "string" ? attrs.samesite.toLowerCase() : "";
      const sessionish = /(sess|sid|auth|token|jwt|login|csrf|xsrf)/i.test(name), issues = []; let level = "good";
      const raise = (l, t) => { issues.push(t); if (l === "bad" || (l === "warn" && level !== "bad")) level = l; };
      if (!secure) raise(sessionish ? "bad" : "warn", "no Secure flag: the cookie is also sent over plain http");
      if (!httpOnly) raise(sessionish ? "bad" : "warn", "no HttpOnly flag: scripts on the page can read it" + (sessionish ? " (this looks like a session or login cookie)" : ""));
      if (!same) issues.push("no SameSite: browsers treat it as Lax");
      else if (same === "none" && !secure) raise("bad", "SameSite=None without Secure: browsers reject the cookie");
      else if (same === "none") issues.push("SameSite=None: sent on cross-site requests, which is needed only for embedding");
      if (/^__host-/i.test(name) && !(secure && attrs.path === "/" && !("domain" in attrs))) raise("bad", "a __Host- cookie needs Secure, Path=/ and no Domain");
      if (/^__secure-/i.test(name) && !secure) raise("bad", "a __Secure- cookie needs the Secure flag");
      const ma = attrs["max-age"]; if (typeof ma === "string" && +ma > 31536000 * 2) issues.push("lives longer than two years");
      if ("domain" in attrs && attrs.domain) issues.push("Domain=" + attrs.domain + ": also sent to subdomains");
      out.push({ name, level, flags: [secure ? "Secure" : "", httpOnly ? "HttpOnly" : "", same ? "SameSite=" + attrs.samesite : "", attrs.path ? "Path=" + attrs.path : "", typeof ma === "string" ? "Max-Age=" + ma : ("expires" in attrs ? "Expires" : "session")].filter(Boolean).join("; "), text: issues.length ? issues.join("; ") + "." : "Well protected." });
    }
    return out;
  }

  // ---------- main ----------
  function analyze(text, cdnDetect) {
    const p = parse(text);
    if (!p.responses.length || (p.request && p.responses.every(x => !x.line))) return { empty: !String(text || "").trim(), error: String(text || "").trim() ? (p.request ? "This looks like a request, not a response. Paste the response headers (curl -I https://example.com, or Response Headers in the browser's developer tools)." : "No HTTP headers found. Paste lines like \"Content-Type: text/html\" (curl -I shows them).") : "", checks: [], sections: [], notes: [], cookies: [], chain: [], summary: "" };
    const r = p.responses[p.responses.length - 1], lm = lowerMap(r), notes = [], sections = [];
    const checks = [hsts(r), csp(r), xcto(r), frame(r), referrer(r), perms(r)];
    // less central, shown only when present or wrong
    const xss = get(r, "x-xss-protection"); if (xss !== undefined && !/^\s*0/.test(xss)) checks.push({ name: "X-XSS-Protection", level: "warn", value: xss, text: "Obsolete: current browsers ignore it, and in old ones it could even create holes. Remove it, or set it to 0 and rely on the CSP." });
    for (const [h, what] of [["cross-origin-opener-policy", "isolates the page from windows it opens or that open it"], ["cross-origin-resource-policy", "limits which sites may load this resource"], ["cross-origin-embedder-policy", "requires embedded resources to opt in (needed for some powerful browser features)"]]) {
      const v = get(r, h); if (v !== undefined) checks.push({ name: h.replace(/(^|-)(\w)/g, (m, a, b) => a + b.toUpperCase()), level: "info", value: v, text: "Present: " + what + "." });
    }
    // cookies, caching
    const ck = cookies(r), cc = get(r, "cache-control") || "";
    if (ck.length && /(^|[ ,])public\b/i.test(cc) && !/private|no-store/i.test(cc)) checks.push({ name: "Cache-Control with cookies", level: "bad", value: cc, text: "A response that sets a cookie is marked public: shared caches (CDN, proxy) may store it and hand the same cookie to other visitors." });
    else if (ck.length && cc === "") checks.push({ name: "Cache-Control with cookies", level: "warn", value: "", text: "A response that sets a cookie has no Cache-Control. Add private or no-store unless you are sure no cache between you and the visitor stores it." });
    // CORS
    const acao = get(r, "access-control-allow-origin"), acac = get(r, "access-control-allow-credentials");
    if (acao !== undefined) {
      if (acao === "*" && /^true$/i.test(acac || "")) checks.push({ name: "CORS", level: "bad", value: "Allow-Origin: *, Allow-Credentials: true", text: "This combination is invalid and browsers refuse it. It usually means the server echoes any origin for logged-in requests: check that." });
      else if (acao.toLowerCase() === "null") checks.push({ name: "CORS", level: "warn", value: "Allow-Origin: null", text: "Allowing the origin \"null\" lets sandboxed pages and local files read the response. Avoid it." });
      else if (acao === "*") checks.push({ name: "CORS", level: "info", value: "Allow-Origin: *", text: "Any website may read this response from a browser. Fine for public data; wrong for anything private." });
      else checks.push({ name: "CORS", level: "info", value: "Allow-Origin: " + acao + (acac ? ", Allow-Credentials: " + acac : ""), text: "Only " + acao + " may read this response from a browser." });
    }
    // information disclosure
    for (const h of ["server", "x-powered-by", "x-aspnet-version", "x-aspnetmvc-version", "x-generator", "x-runtime"]) {
      const v = get(r, h); if (v === undefined) continue;
      const ver = /\d+\.\d+/.test(v), name = h.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join("-");
      checks.push({ name, level: ver ? "warn" : "info", value: v, text: ver ? "Gives away the exact software version, which helps an attacker pick known vulnerabilities. Hide the version number." : "Names the software behind the site. Harmless on its own; less is better." });
    }
    // redirects
    const chain = p.responses.map(x => ({ status: x.status, reason: STATUS[x.status] || x.reason, location: get(x, "location") || "" }));
    // tables
    const ct = get(r, "content-type"), ce = get(r, "content-encoding"), te = get(r, "transfer-encoding"), cl = get(r, "content-length"), alt = get(r, "alt-svc");
    const head = [["Status", (r.status ? r.status + " " + (STATUS[r.status] || r.reason) : "(not given)"), r.version ? r.version : ""]];
    if (r.version) head[0][2] = r.version === "HTTP/2" || r.version === "HTTP/3" ? r.version + " (modern)" : r.version === "HTTP/1.0" ? "HTTP/1.0: very old, no persistent connections by default" : r.version;
    if (ct !== undefined) head.push(["Content type", ct, /text\/html/i.test(ct) && !/charset/i.test(ct) ? "No charset given: browsers guess the character set" : ""]);
    if (cl !== undefined) head.push(["Content length", cl + " bytes", ""]);
    if (ce !== undefined) head.push(["Compression", ce, ""]); else if (ct && /(text|json|javascript|xml|svg)/i.test(ct) && cl !== undefined && +cl > 1400) head.push(["Compression", "none", "A text answer of this size would usually be compressed (gzip or br)"]);
    if (te !== undefined) head.push(["Transfer encoding", te, ""]);
    for (const [k, h] of [["Date", "date"], ["Last modified", "last-modified"], ["ETag", "etag"], ["Expires", "expires"], ["Age", "age"], ["Vary", "vary"], ["Location", "location"]]) { const v = get(r, h); if (v !== undefined) head.push([k, v, h === "age" ? "seconds this copy has been stored in a cache" : ""]); }
    if (cc) head.push(["Cache-Control", cc, cacheWords(cc)]);
    if (alt !== undefined) head.push(["Alt-Svc", cut(alt, 120), /h3/i.test(alt) ? "The site offers HTTP/3 (QUIC)" : ""]);
    sections.push({ title: "The answer", rows: head });
    // who answered
    const via = [];
    let det = null; try { det = cdnDetect ? cdnDetect(lm) : null; } catch { det = null; }
    if (det && det.known) via.push(["CDN or proxy", det.vendor + (det.pop ? ", data centre " + det.pop : ""), ""]);
    if (det && det.cache) via.push(["Cache result", det.cache, /hit/i.test(det.cache) ? "served from the cache" : /miss|expired|dynamic|bypass/i.test(det.cache) ? "fetched from the origin server" : ""]);
    for (const h of ["via", "x-cache", "x-served-by", "cf-ray", "x-request-id", "x-amz-cf-pop", "cf-cache-status"]) { const v = get(r, h); if (v !== undefined && !(det && det.cache === v)) via.push([h, cut(v, 120), ""]); }
    if (via.length) sections.push({ title: "Who answered", rows: via });
    // counts
    const core = checks.slice(0, 6), present = core.filter(c => c.level !== "missing").length, bad = checks.filter(c => c.level === "bad").length + ck.filter(c => c.level === "bad").length, warn = checks.filter(c => c.level === "warn").length + ck.filter(c => c.level === "warn").length;
    if (p.responses.length > 1) notes.push({ level: "", text: "The paste holds " + p.responses.length + " responses (a redirect chain). The LAST one is analysed: " + (chain[chain.length - 1].status || "?") + "." });
    if (r.status >= 300 && r.status < 400 && !get(r, "location")) notes.push({ level: "bad", text: "A redirect (" + r.status + ") without a Location header goes nowhere." });
    if (r.status >= 500) notes.push({ level: "bad", text: "The server answered with an error (" + r.status + " " + (STATUS[r.status] || "") + ")." });
    if (/^(52\d)$/.test(String(r.status))) notes.push({ level: "warn", text: "A 52x status comes from Cloudflare, not from your server: it could not get a proper answer from the origin." });
    if (p.request) notes.push({ level: "", text: "Request lines in the paste were ignored." });
    const summary = "Status " + (r.status || "?") + ". Security headers: " + present + " of 6 present" + (bad ? ", " + bad + " problem" + (bad > 1 ? "s" : "") : "") + (warn ? ", " + warn + " to improve" : "") + ".";
    return { responses: p.responses.length, status: r.status, checks, sections, cookies: ck, chain, notes, summary, present, bad, warn };
  }
  function cacheWords(cc) {
    const w = [], t = cc.toLowerCase();
    if (/no-store/.test(t)) w.push("never stored"); if (/no-cache/.test(t)) w.push("must be rechecked before reuse"); if (/\bprivate\b/.test(t)) w.push("only the visitor's browser may store it"); if (/\bpublic\b/.test(t)) w.push("shared caches may store it");
    const m = /max-age=(\d+)/.exec(t); if (m) w.push("fresh for " + (+m[1] >= 86400 ? Math.round(+m[1] / 86400) + " days" : +m[1] >= 3600 ? Math.round(+m[1] / 3600) + " hours" : +m[1] + " seconds"));
    const s = /s-maxage=(\d+)/.exec(t); if (s) w.push("shared caches: " + s[1] + " seconds"); if (/immutable/.test(t)) w.push("never changes"); return w.join("; ");
  }
  const LEVEL = { good: "Good", warn: "Improve", bad: "Problem", missing: "Missing", info: "Info" };
  function toText(a) {
    const out = ["HTTP Header Reader (Michel's Tools)", a.summary, ""];
    for (const n of a.notes) out.push("* " + n.text);
    out.push("", "Security and other checks");
    for (const c of a.checks) out.push("  [" + LEVEL[c.level] + "] " + c.name + (c.value ? ": " + c.value : "") + " - " + c.text);
    if (a.cookies.length) { out.push("", "Cookies (values are not shown)"); for (const c of a.cookies) out.push("  [" + LEVEL[c.level] + "] " + c.name + " (" + c.flags + ") - " + c.text); }
    for (const s of a.sections) { out.push("", s.title); for (const [k, v, h] of s.rows) out.push("  " + k + ": " + v + (h ? " (" + h + ")" : "")); }
    return out.join("\n");
  }

  const api = { parse, analyze, toText, LEVEL, cspParse };
  if (typeof window !== "undefined") window.HttpHdr = api;
  if (typeof module !== "undefined") module.exports = api;
})();
