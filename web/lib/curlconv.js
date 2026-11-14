/* curl converter: reads a curl command line (as copied from a browser's "Copy as cURL", a manual or a chat) and writes the same request as JavaScript fetch, Python requests,
   Go net/http and PowerShell. Pure text work: nothing is run and no request is made. Exports window.CurlConv. */
(() => {
  "use strict";
  // ---- reading the shell text ----
  function tokenize(src) {
    const out = [], ops = []; let cur = "", had = false, i = 0;
    const s = String(src).replace(/\\\r?\n/g, " ").replace(/^\s*\$\s+/, "");
    const push = () => { if (had) { out.push(cur); cur = ""; had = false; } };
    while (i < s.length) {
      const ch = s[i];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { push(); i++; continue; }
      if (ch === "'") { const e = s.indexOf("'", i + 1); if (e < 0) throw new Error("A single quote is never closed."); cur += s.slice(i + 1, e); had = true; i = e + 1; continue; }
      if (ch === "$" && s[i + 1] === "'") {
        let j = i + 2, t = "";
        while (j < s.length && s[j] !== "'") {
          if (s[j] === "\\") { const n = s[j + 1]; j += 2; const m = { n: "\n", t: "\t", r: "\r", "\\": "\\", "'": "'", '"': '"', a: "\x07", b: "\b", f: "\f", v: "\v", e: "\x1b" }; if (n === "x") { const h = /^[0-9a-fA-F]{1,2}/.exec(s.slice(j)); if (h) { t += String.fromCharCode(parseInt(h[0], 16)); j += h[0].length; } } else if (n === "u") { const h = /^[0-9a-fA-F]{1,4}/.exec(s.slice(j)); if (h) { t += String.fromCharCode(parseInt(h[0], 16)); j += h[0].length; } } else if (/[0-7]/.test(n)) { const h = /^[0-7]{0,2}/.exec(s.slice(j))[0]; t += String.fromCharCode(parseInt(n + h, 8)); j += h.length; } else t += m[n] !== undefined ? m[n] : "\\" + n; }
          else t += s[j++];
        }
        if (j >= s.length) throw new Error("A $'...' quote is never closed."); cur += t; had = true; i = j + 1; continue;
      }
      if (ch === '"') {
        let j = i + 1, t = "";
        while (j < s.length && s[j] !== '"') { if (s[j] === "\\" && /["\\$`]/.test(s[j + 1] || "")) { t += s[j + 1]; j += 2; } else t += s[j++]; }
        if (j >= s.length) throw new Error("A double quote is never closed."); cur += t; had = true; i = j + 1; continue;
      }
      if (ch === "\\") { if (i + 1 < s.length) { cur += s[i + 1]; had = true; } i += 2; continue; }
      if (ch === "|" || ch === ";" || ch === "&" || ch === ">" || ch === "<") { push(); const m = /^(\|\||&&|>>|[|;&<>])/.exec(s.slice(i)); ops.push(m[0]); i += m[0].length; continue; }
      cur += ch; had = true; i++;
    }
    push(); return { words: out, ops };
  }

  // curl options: [takesValue]. Long names also listed by their short letter.
  const LONG = {
    request: ["X", 1], header: ["H", 1], data: ["d", 1], "data-ascii": ["d", 1], "data-raw": ["data-raw", 1], "data-binary": ["data-binary", 1], "data-urlencode": ["data-urlencode", 1], form: ["F", 1], "form-string": ["form-string", 1],
    user: ["u", 1], cookie: ["b", 1], "user-agent": ["A", 1], referer: ["e", 1], output: ["o", 1], "max-time": ["m", 1], "connect-timeout": ["connect-timeout", 1], proxy: ["x", 1], url: ["url", 1], "upload-file": ["T", 1], json: ["json", 1],
    "write-out": ["w", 1], retry: ["retry", 1], "retry-delay": ["retry-delay", 1], range: ["r", 1], resolve: ["resolve", 1], cacert: ["cacert", 1], cert: ["E", 1], key: ["key", 1], config: ["K", 1], "cookie-jar": ["c", 1], "proxy-user": ["U", 1],
    "oauth2-bearer": ["oauth2-bearer", 1], "max-redirs": ["max-redirs", 1], "limit-rate": ["limit-rate", 1], interface: ["interface", 1], "dump-header": ["D", 1], trace: ["trace", 1], "trace-ascii": ["trace-ascii", 1], "keepalive-time": ["keepalive-time", 1], "expect100-timeout": ["expect100-timeout", 1],
    head: ["I", 0], silent: ["s", 0], "show-error": ["S", 0], location: ["L", 0], insecure: ["k", 0], verbose: ["v", 0], include: ["i", 0], get: ["G", 0], globoff: ["g", 0], fail: ["f", 0], "fail-with-body": ["fail-with-body", 0], "remote-name": ["O", 0], compressed: ["compressed", 0],
    "http1.1": ["http1.1", 0], http2: ["http2", 0], http3: ["http3", 0], ipv4: ["4", 0], ipv6: ["6", 0], "no-keepalive": ["no-keepalive", 0], "path-as-is": ["path-as-is", 0], netrc: ["n", 0], "progress-bar": ["#", 0], "location-trusted": ["location-trusted", 0],
    "tr-encoding": ["tr-encoding", 0], "no-buffer": ["N", 0], anyauth: ["anyauth", 0], basic: ["basic", 0], digest: ["digest", 0], ntlm: ["ntlm", 0], negotiate: ["negotiate", 0], "create-dirs": ["create-dirs", 0], "no-progress-meter": ["no-progress-meter", 0], "tlsv1.2": ["tlsv1.2", 0], "tlsv1.3": ["tlsv1.3", 0],
  };
  const SHORT = {}; for (const [, [sh, v]] of Object.entries(LONG)) if (sh.length === 1) SHORT[sh] = { name: sh, val: v };

  function parseCurl(text) {
    const t = tokenize(text); const w = t.words;
    if (!w.length) return { error: "Paste a curl command." };
    let i = 0; if (/^(curl|curl\.exe)$/i.test(w[0])) i = 1; else if (!/^-/.test(w[0]) && !/^[a-z]+:\/\//i.test(w[0]) && !/^[\w.-]+\.[a-z]{2,}/i.test(w[0])) return { error: "This does not start with curl." };
    const r = { method: null, headers: [], data: [], form: [], urls: [], flags: {}, ignored: [], notes: [], user: null, cookie: null, ua: null, referer: null, timeout: null, proxy: null, json: [], upload: null };
    const opt = (name, val) => {
      switch (name) {
        case "X": r.method = val.toUpperCase(); break; case "H": r.headers.push(val); break;
        case "d": r.data.push({ kind: "d", v: val }); break; case "data-raw": r.data.push({ kind: "raw", v: val }); break; case "data-binary": r.data.push({ kind: "bin", v: val }); break; case "data-urlencode": r.data.push({ kind: "enc", v: val }); break;
        case "F": r.form.push({ v: val, str: false }); break; case "form-string": r.form.push({ v: val, str: true }); break;
        case "u": r.user = val; break; case "b": r.cookie = val; break; case "A": r.ua = val; break; case "e": r.referer = val; break; case "m": r.timeout = parseFloat(val); break; case "x": r.proxy = val; break;
        case "url": r.urls.push(val); break; case "T": r.upload = val; break; case "json": r.json.push(val); break;
        case "I": r.flags.head = true; break; case "L": r.flags.location = true; break; case "k": r.flags.insecure = true; break; case "G": r.flags.get = true; break; case "compressed": r.flags.compressed = true; break; case "s": case "S": case "v": case "i": case "g": case "f": case "N": case "#": case "4": case "6": case "O": case "n": break;
        case "o": case "w": case "c": case "D": r.ignored.push("-" + (name.length === 1 ? "" : "-") + name + " " + val); break;
        case "U": case "oauth2-bearer": r.ignored.push("--" + name); break;
        default: r.ignored.push((name.length === 1 ? "-" : "--") + name);
      }
    };
    let endOpts = false;
    for (; i < w.length; i++) {
      const a = w[i];
      if (!endOpts && a === "--") { endOpts = true; continue; }
      if (!endOpts && a.startsWith("--") && a.length > 2) {
        let name = a.slice(2), val = null; const eq = name.indexOf("="); if (eq > 0) { val = name.slice(eq + 1); name = name.slice(0, eq); }
        let d = LONG[name]; if (!d) { const cands = Object.keys(LONG).filter(k => k.startsWith(name)); if (cands.length === 1) d = LONG[cands[0]], name = cands[0]; }
        if (!d) { r.ignored.push("--" + name); continue; }
        const key = d[0];
        if (d[1]) { if (val === null) { if (i + 1 >= w.length) return { error: "--" + name + " needs a value." }; val = w[++i]; } opt(key, val); } else opt(key, null);
      } else if (!endOpts && a.startsWith("-") && a.length > 1) {
        for (let j = 1; j < a.length; j++) {
          const c = a[j], d = SHORT[c];
          if (!d) { r.ignored.push("-" + c); continue; }
          if (d.val) { let val = a.slice(j + 1); if (!val) { if (i + 1 >= w.length) return { error: "-" + c + " needs a value." }; val = w[++i]; } opt(c, val); break; }
          opt(c, null);
        }
      } else r.urls.push(a);
    }
    if (t.ops.length) r.notes.push({ level: "warn", text: "The command contains shell operators (" + [...new Set(t.ops)].join(" ") + "). Only the curl part is converted; pipes, redirects and && are not." });
    if (!r.urls.length) return { error: "No URL found in the command." };
    return finish(r);
  }
  const b64 = s => { const bytes = new TextEncoder().encode(s); let bin = ""; for (const x of bytes) bin += String.fromCharCode(x); return typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64"); };
  const MIME = { txt: "text/plain", html: "text/html", htm: "text/html", xml: "application/xml", json: "application/json", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", csv: "text/csv", css: "text/css", js: "text/javascript", zip: "application/zip", gz: "application/gzip", mp4: "video/mp4", mp3: "audio/mpeg" };
  const guessType = f => { const m = /\.([A-Za-z0-9]+)$/.exec(f); return m && MIME[m[1].toLowerCase()] ? MIME[m[1].toLowerCase()] : null; };
  const urlenc = s => { let o = ""; for (const b of new TextEncoder().encode(s)) { const c = String.fromCharCode(b); o += /[A-Za-z0-9._~-]/.test(c) ? c : c === " " ? "+" : "%" + b.toString(16).toUpperCase().padStart(2, "0"); } return o; };

  function finish(r) {
    const n = r.notes;
    let url = r.urls[0]; if (r.urls.length > 1) n.push({ level: "warn", text: "The command has " + r.urls.length + " URLs; only the first is converted." });
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) { url = "http://" + url; n.push({ level: "info", text: "curl assumes http:// when the URL has no scheme; it was added." }); }
    if (/[\[\]{}]/.test(url.replace(/^[a-z]+:\/\/\[[0-9a-f:.]+\]/i, "")) && !r.globoff) n.push({ level: "info", text: "The URL has [ ] or { } characters; curl treats them as ranges and lists unless -g is given." });
    const headers = []; for (const h of r.headers) { const i = h.indexOf(":"); if (i < 0) { if (h.endsWith(";")) headers.push({ name: h.slice(0, -1).trim(), value: "", empty: true }); else n.push({ level: "warn", text: "Header \"" + h + "\" has no colon and was skipped." }); continue; } const name = h.slice(0, i).trim(), value = h.slice(i + 1).trim(); if (!value) { headers.push({ name, value: "", remove: true }); } else headers.push({ name, value }); }
    const has = k => headers.some(h => h.name.toLowerCase() === k.toLowerCase() && !h.remove);
    const setH = (k, v) => { if (!has(k)) headers.push({ name: k, value: v }); };
    const out = { url, headers: headers.filter(h => !h.remove), method: r.method, body: null, form: null, flags: r.flags, user: null, proxy: r.proxy, timeout: r.timeout, notes: n, ignored: r.ignored, files: [] };
    if (r.ua) setH("User-Agent", r.ua);
    if (r.referer) setH("Referer", r.referer);
    if (r.cookie) { if (r.cookie.includes("=")) setH("Cookie", r.cookie); else n.push({ level: "info", text: "-b " + r.cookie + " names a cookie file; the cookies in it are not included." }); }
    if (r.user) { const i = r.user.indexOf(":"); out.user = i < 0 ? { name: r.user, pass: "" } : { name: r.user.slice(0, i), pass: r.user.slice(i + 1) }; if (i < 0) n.push({ level: "info", text: "curl would ask for the password; none is included." }); if (!has("Authorization")) headers.push({ name: "Authorization", value: "Basic " + b64(out.user.name + ":" + out.user.pass), auto: "basic" }); out.headers = headers.filter(h => !h.remove); }
    if (r.flags.compressed) { if (!has("Accept-Encoding")) n.push({ level: "info", text: "--compressed: the libraries below already ask for gzip and unpack it." }); }
    // body
    if (r.json.length) { out.body = { text: r.json.map(x => x).join(""), json: true }; setH("Content-Type", "application/json"); setH("Accept", "application/json"); }
    else if (r.form.length) {
      out.form = r.form.map(f => { const i = f.v.indexOf("="); if (i < 0) { n.push({ level: "warn", text: "-F " + f.v + " has no = and was skipped." }); return null; } const name = f.v.slice(0, i); let val = f.v.slice(i + 1), type = null, fname = null;
        if (!f.str) { const mt = /;\s*type=([^;]+)\s*$/.exec(val); if (mt) { type = mt[1]; val = val.slice(0, mt.index); } }
        if (!f.str && val[0] === "@") { out.files.push(val.slice(1)); return { name, file: val.slice(1), type: type || guessType(val.slice(1)) }; }
        if (!f.str && val[0] === "<") { out.files.push(val.slice(1)); return { name, fileText: val.slice(1) }; }
        return { name, value: val }; }).filter(Boolean);
      if (out.form.some(f => f.file || f.fileText)) n.push({ level: "info", text: "The code reads the file(s) you named with -F name=@file: " + out.files.join(", ") + ". Change the path to where the file really is." });
    } else if (r.data.length) {
      const parts = [], hasFile = [];
      for (const d of r.data) {
        let v = d.v;
        if (d.kind === "enc") { const m = /^([^=@]*)([=@])([\s\S]*)$/.exec(v); if (!m) v = urlenc(v); else if (m[2] === "@") { hasFile.push(m[3]); v = (m[1] ? m[1] + "=" : "") + "<contents of " + m[3] + " encoded>"; } else v = (m[1] ? m[1] + "=" : "") + urlenc(m[3]); }
        else if ((d.kind === "d" || d.kind === "bin") && v[0] === "@") { hasFile.push(v.slice(1)); if (d.kind === "d") n.push({ level: "info", text: "-d @" + v.slice(1) + " sends the file's contents with newlines removed; the code below sends the file as it is." }); parts.push({ file: v.slice(1) }); continue; }
        parts.push(d.kind === "d" || d.kind === "enc" ? { text: v } : { text: v });
      }
      if (hasFile.length) { out.files.push(...hasFile); n.push({ level: "info", text: "The body comes from a file (" + hasFile.join(", ") + "). The code reads that file: change the path to where it is." }); }
      if (parts.length === 1 && parts[0].file) out.body = { file: parts[0].file };
      else out.body = { text: parts.map(p => (p.file ? "<file " + p.file + ">" : p.text)).join("&") };
      if (r.flags.get) { out.query = out.body.text || ""; out.body = null; }
      else setH("Content-Type", "application/x-www-form-urlencoded");
    }
    if (r.upload) { out.body = { file: r.upload }; out.files.push(r.upload); if (!r.method) out.method = "PUT"; }
    if (out.query) { const sep = out.url.includes("?") ? (out.url.endsWith("?") || out.url.endsWith("&") ? "" : "&") : "?"; out.url += sep + out.query; }
    if (!out.method) out.method = r.flags.head ? "HEAD" : out.body || out.form ? "POST" : "GET";
    if (r.flags.head && r.method && r.method !== "HEAD") n.push({ level: "info", text: "-I asks for headers only; with -X " + r.method + " curl still sends " + r.method + "." });
    out.headers = headers.filter(h => !h.remove);
    if (out.form && has("Content-Type") && /multipart/i.test(headers.find(h => h.name.toLowerCase() === "content-type").value)) { out.headers = out.headers.filter(h => h.name.toLowerCase() !== "content-type"); n.push({ level: "info", text: "The Content-Type header of the multipart form was left out so the library can add the boundary." }); }
    if (r.ignored.length) n.push({ level: "info", text: "Not converted (no effect on the request itself): " + [...new Set(r.ignored)].join(" ") + "." });
    if (/^https?:\/\/[^/]*@/.test(out.url)) n.push({ level: "info", text: "The URL contains a user name or password; it is kept in the URL." });
    return out;
  }

  // ---- writing code ----
  const js = s => JSON.stringify(String(s));
  const py = s => { const t = String(s); return "'" + t.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + "'"; };
  const goS = s => JSON.stringify(String(s)).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const ps = s => "'" + String(s).replace(/'/g, "''") + "'";
  const hdrNoAuto = r => r.headers;

  function toFetch(r) {
    const L = [], o = [];
    if (r.method !== "GET") o.push("  method: " + js(r.method) + ",");
    if (r.headers.length) o.push("  headers: {\n" + r.headers.map(h => "    " + js(h.name) + ": " + js(h.value)).join(",\n") + "\n  },");
    if (r.form) { L.push("const form = new FormData();"); for (const f of r.form) { if (f.file) L.push("form.append(" + js(f.name) + ", new Blob([await readFile(" + js(f.file) + ")]" + (f.type ? ", { type: " + js(f.type) + " }" : "") + "), " + js(f.file.split("/").pop()) + ");"); else if (f.fileText) L.push("form.append(" + js(f.name) + ", await readFile(" + js(f.fileText) + ", \"utf8\"));"); else L.push("form.append(" + js(f.name) + ", " + js(f.value) + ");"); } o.push("  body: form,"); if (r.files.length) L.unshift("import { readFile } from \"node:fs/promises\";"); }
    else if (r.body && r.body.file) { L.unshift("import { readFile } from \"node:fs/promises\";"); o.push("  body: await readFile(" + js(r.body.file) + "),"); }
    else if (r.body) o.push("  body: " + js(r.body.text) + ",");
    if (!r.flags.location) o.push("  redirect: \"manual\",");
    if (r.timeout) o.push("  signal: AbortSignal.timeout(" + Math.round(r.timeout * 1000) + "),");
    const lines = L.length ? L.join("\n") + "\n\n" : "";
    const head = "const response = await fetch(" + js(r.url) + (o.length ? ", {\n" + o.join("\n") + "\n}" : "") + ");\n";
    return lines + head + (r.method === "HEAD" ? "console.log(response.status, [...response.headers]);\n" : "console.log(response.status);\nconsole.log(await response.text());\n") + (r.flags.insecure ? "\n// -k (skip certificate checks): fetch has no switch for it; in Node set NODE_TLS_REJECT_UNAUTHORIZED=0 for a test, never in production.\n" : "") + (r.proxy ? "\n// -x " + r.proxy + ": fetch needs a proxy agent (for example undici's ProxyAgent) to use a proxy.\n" : "");
  }
  function toPython(r) {
    const L = ["import requests", ""], a = [];
    const hdr = r.headers.filter(h => !(h.auto === "basic"));
    if (hdr.length) { L.push("headers = {"); for (const h of hdr) L.push("    " + py(h.name) + ": " + py(h.value) + ","); L.push("}", ""); }
    if (r.form) { L.push("files = ["); for (const f of r.form) { if (f.file) L.push("    (" + py(f.name) + ", (" + py(f.file.split("/").pop()) + ", open(" + py(f.file) + ", \"rb\")" + (f.type ? ", " + py(f.type) : "") + ")),"); else if (f.fileText) L.push("    (" + py(f.name) + ", (None, open(" + py(f.fileText) + ").read())),"); else L.push("    (" + py(f.name) + ", (None, " + py(f.value) + ")),"); } L.push("]", ""); }
    a.push(py(r.url)); if (hdr.length) a.push("headers=headers");
    if (r.form) a.push("files=files"); else if (r.body && r.body.file) a.push("data=open(" + py(r.body.file) + ", \"rb\")"); else if (r.body) a.push("data=" + py(r.body.text) + (/[^\x00-\x7f]/.test(r.body.text) ? ".encode(\"utf-8\")" : ""));
    if (r.user) a.push("auth=(" + py(r.user.name) + ", " + py(r.user.pass) + ")");
    if (r.flags.insecure) a.push("verify=False"); if (!r.flags.location) a.push("allow_redirects=False"); if (r.timeout) a.push("timeout=" + r.timeout);
    if (r.proxy) a.push("proxies={\"http\": " + py(r.proxy) + ", \"https\": " + py(r.proxy) + "}");
    L.push("response = requests.request(" + py(r.method) + ", " + a.join(", ") + ")", "print(response.status_code)", r.method === "HEAD" ? "print(response.headers)" : "print(response.text)");
    return L.join("\n") + "\n";
  }
  function toGo(r) {
    const imp = ["fmt", "io", "net/http"], pre = [];
    if (r.body && r.body.text !== undefined || (r.body && r.body.file) || r.form) imp.push("strings");
    if (r.form) { imp.push("bytes", "mime/multipart"); } if (r.body && r.body.file || r.form && r.form.some(f => f.file || f.fileText)) imp.push("os");
    if (r.flags.insecure) imp.push("crypto/tls"); if (r.timeout) imp.push("time"); if (r.proxy) imp.push("net/url");
    if (r.form && r.form.some(f => f.file)) imp.push("path/filepath"); if (r.form && r.form.some(f => f.file && f.type)) imp.push("net/textproto");
    const set = [...new Set(imp)].sort();
    const L = ["package main", "", "import (", ...set.map(x => "\t\"" + x + "\""), ")", "", "func main() {"]; let body = "nil";
    if (r.form) {
      L.push("\tvar buf bytes.Buffer", "\tmw := multipart.NewWriter(&buf)");
      for (const f of r.form) { if (f.file) L.push("\t{", "\t\tdata, err := os.ReadFile(" + goS(f.file) + ")", "\t\tif err != nil {\n\t\t\tpanic(err)\n\t\t}", f.type ? "\t\th := textproto.MIMEHeader{}\n\t\th.Set(\"Content-Disposition\", fmt.Sprintf(\"form-data; name=%q; filename=%q\", " + goS(f.name) + ", filepath.Base(" + goS(f.file) + ")))\n\t\th.Set(\"Content-Type\", " + goS(f.type) + ")\n\t\tpart, _ := mw.CreatePart(h)" : "\t\tpart, _ := mw.CreateFormFile(" + goS(f.name) + ", filepath.Base(" + goS(f.file) + "))", "\t\tpart.Write(data)", "\t}"); else if (f.fileText) L.push("\t{", "\t\tdata, err := os.ReadFile(" + goS(f.fileText) + ")", "\t\tif err != nil {\n\t\t\tpanic(err)\n\t\t}", "\t\tmw.WriteField(" + goS(f.name) + ", string(data))", "\t}"); else L.push("\tmw.WriteField(" + goS(f.name) + ", " + goS(f.value) + ")"); }
      L.push("\tmw.Close()"); body = "&buf";
    } else if (r.body && r.body.file) { L.push("\tf, err := os.Open(" + goS(r.body.file) + ")", "\tif err != nil {\n\t\tpanic(err)\n\t}", "\tdefer f.Close()"); body = "f"; }
    else if (r.body) body = "strings.NewReader(" + goS(r.body.text) + ")";
    if (body === "nil" && set.includes("strings") === false) { /* strings not needed */ }
    L.push("\treq, err := http.NewRequest(" + goS(r.method) + ", " + goS(r.url) + ", " + body + ")", "\tif err != nil {\n\t\tpanic(err)\n\t}");
    for (const h of r.headers) { if (h.auto === "basic") continue; L.push("\treq.Header.Set(" + goS(h.name) + ", " + goS(h.value) + ")"); }
    if (r.form) L.push("\treq.Header.Set(\"Content-Type\", mw.FormDataContentType())");
    if (r.user) L.push("\treq.SetBasicAuth(" + goS(r.user.name) + ", " + goS(r.user.pass) + ")");
    const cl = []; if (!r.flags.location) cl.push("\t\tCheckRedirect: func(req *http.Request, via []*http.Request) error {\n\t\t\treturn http.ErrUseLastResponse\n\t\t},"); if (r.timeout) cl.push("\t\tTimeout: " + Math.round(r.timeout * 1000) + " * time.Millisecond,");
    const tr = []; if (r.flags.insecure) tr.push("\t\t\tTLSClientConfig: &tls.Config{InsecureSkipVerify: true},"); if (r.proxy) tr.push("\t\t\tProxy: http.ProxyURL(mustURL(" + goS(r.proxy) + ")),");
    if (tr.length) cl.push("\t\tTransport: &http.Transport{\n" + tr.join("\n") + "\n\t\t},");
    L.push("\tclient := &http.Client{" + (cl.length ? "\n" + cl.join("\n") + "\n\t" : "") + "}", "\tresp, err := client.Do(req)", "\tif err != nil {\n\t\tpanic(err)\n\t}", "\tdefer resp.Body.Close()", "\tdata, _ := io.ReadAll(resp.Body)", "\tfmt.Println(resp.StatusCode)", "\tfmt.Println(string(data))", "}");
    if (r.proxy) L.push("", "func mustURL(s string) *url.URL {", "\tu, err := url.Parse(s)", "\tif err != nil {\n\t\tpanic(err)\n\t}", "\treturn u", "}");
    let code = L.join("\n") + "\n";
    // drop unused imports (strings when a body is a file etc.)
    for (const im of ["strings", "os", "io", "fmt"]) { const nm = im.split("/").pop(); const uses = code.split("\n").slice(code.split("\n").indexOf(")") + 1).join("\n"); if (!new RegExp("\\b" + nm + "\\.").test(uses)) code = code.replace("\t\"" + im + "\"\n", ""); }
    return code;
  }
  function toPowerShell(r) {
    const L = [], a = ["-Uri " + ps(r.url), "-Method " + r.method];
    const hdr = r.headers.filter(h => !(h.auto === "basic"));
    if (hdr.length) { L.push("$headers = @{"); for (const h of hdr) L.push("    " + ps(h.name) + " = " + ps(h.value)); L.push("}", ""); a.push("-Headers $headers"); }
    if (r.user) { L.push("$secure = ConvertTo-SecureString " + ps(r.user.pass) + " -AsPlainText -Force", "$cred = New-Object System.Management.Automation.PSCredential(" + ps(r.user.name) + ", $secure)", ""); a.push("-Credential $cred", "-Authentication Basic", "-AllowUnencryptedAuthentication"); }
    if (r.form) { L.push("$form = [ordered]@{"); for (const f of r.form) { if (f.file) L.push("    " + ps(f.name) + " = Get-Item -Path " + ps(f.file)); else if (f.fileText) L.push("    " + ps(f.name) + " = Get-Content -Raw -Path " + ps(f.fileText)); else L.push("    " + ps(f.name) + " = " + ps(f.value)); } L.push("}", ""); a.push("-Form $form"); }
    else if (r.body && r.body.file) a.push("-InFile " + ps(r.body.file)); else if (r.body) a.push("-Body " + ps(r.body.text));
    if (r.flags.insecure) a.push("-SkipCertificateCheck"); if (!r.flags.location) a.push("-MaximumRedirection 0"); if (r.timeout) a.push("-TimeoutSec " + Math.ceil(r.timeout)); if (r.proxy) a.push("-Proxy " + ps(r.proxy));
    L.push("$response = Invoke-WebRequest " + a.join(" `\n    "), "$response.StatusCode", "$response.Content");
    return L.join("\n") + "\n";
  }
  function summary(r) {
    const rows = [["Method", r.method], ["URL", r.url]]; for (const h of r.headers) rows.push(["Header " + h.name, h.auto ? "Basic ... (from -u)" : h.value]);
    if (r.user) rows.push(["Login (-u)", r.user.name + ":" + (r.user.pass ? "(password)" : "")]);
    if (r.body) rows.push(["Body", r.body.file ? "contents of " + r.body.file : r.body.text.length > 200 ? r.body.text.slice(0, 200) + "…" : r.body.text]);
    if (r.form) for (const f of r.form) rows.push(["Form field " + f.name, f.file ? "file " + f.file : f.fileText ? "text from " + f.fileText : f.value]);
    rows.push(["Follows redirects", r.flags.location ? "yes (-L)" : "no"]); if (r.flags.insecure) rows.push(["Certificate check", "off (-k)"]); if (r.timeout) rows.push(["Time limit", r.timeout + " s"]); if (r.proxy) rows.push(["Proxy", r.proxy]);
    return rows;
  }
  function convert(text) {
    let r; try { r = parseCurl(text); } catch (e) { return { error: e.message }; }
    if (r.error) return r;
    return { request: r, summary: summary(r), notes: r.notes, fetch: toFetch(r), python: toPython(r), go: toGo(r), powershell: toPowerShell(r) };
  }
  const api = { tokenize, parseCurl, convert, toFetch, toPython, toGo, toPowerShell, summary };
  if (typeof window !== "undefined") window.CurlConv = api;
  if (typeof module !== "undefined") module.exports = api;
})();
