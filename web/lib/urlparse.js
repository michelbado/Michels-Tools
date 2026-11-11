/* URL parser: splits a web address into its parts (scheme, user, password, host, port, path, each query parameter, fragment), shows
   what the address really points to, and flags tricks (a name before an @, look-alike international domain names, numbers written in
   unusual ways). Works only on the text it is given and reads nothing from the network. Exports window.UrlParse. */
(() => {
  "use strict";
  const DEFAULT_PORTS = { "http:": 80, "https:": 443, "ftp:": 21, "ws:": 80, "wss:": 443, "ssh:": 22, "sftp:": 22, "ldap:": 389, "ldaps:": 636, "smtp:": 25, "imap:": 143, "imaps:": 993, "pop3:": 110, "pop3s:": 995, "postgres:": 5432, "postgresql:": 5432, "mysql:": 3306, "redis:": 6379, "mongodb:": 27017, "rtsp:": 554 };

  // Punycode (RFC 3492) decoding, so an xn-- name can be shown the way a browser user would read it.
  function punyDecode(input) {
    const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700; let n = 128, i = 0, bias = 72;
    const out = [], b = input.lastIndexOf("-"); for (let j = 0; j < Math.max(b, 0); j++) { if (input.charCodeAt(j) >= 128) throw new Error("bad"); out.push(input.charCodeAt(j)); }
    const adapt = (delta, num, first) => { let k = 0; delta = first ? Math.floor(delta / damp) : delta >> 1; delta += Math.floor(delta / num); for (; delta > ((base - tMin) * tMax) >> 1; k += base) delta = Math.floor(delta / (base - tMin)); return Math.floor(k + (base - tMin + 1) * delta / (delta + skew)); };
    for (let idx = b > 0 ? b + 1 : 0; idx < input.length;) {
      const oldi = i; let w = 1;
      for (let k = base; ; k += base) {
        if (idx >= input.length) throw new Error("bad");
        const c = input.charCodeAt(idx++), digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
        if (digit >= base) throw new Error("bad");
        i += digit * w; const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias; if (digit < t) break; w *= base - t;
      }
      const len = out.length + 1; bias = adapt(i - oldi, len, oldi === 0); n += Math.floor(i / len); i %= len; out.splice(i++, 0, n);
    }
    return String.fromCodePoint(...out);
  }
  const hostToUnicode = h => h.split(".").map(l => { if (/^xn--/i.test(l)) { try { return punyDecode(l.slice(4)); } catch { return l; } } return l; }).join(".");
  const dec = s => { try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; } };
  const decPath = s => { try { return decodeURIComponent(s); } catch { return s; } };

  // Pieces of the original text, since the browser's URL object tidies things (lower case, resolves ./..); the raw form is what was typed.
  function parse(text) {
    let raw = String(text == null ? "" : text).trim();
    if (!raw) return { empty: true };
    const notes = [];
    if (/\s/.test(raw)) { notes.push({ level: "warn", text: "The address contains spaces. Browsers turn them into %20, but many programs reject them." }); raw = raw.replace(/\s/g, "%20"); }
    let u, assumed = false;
    const BAD = { error: "This is not a valid web address. A full address looks like https://user@example.com:8443/path?key=value#part." };
    const hasScheme = /^[A-Za-z][A-Za-z0-9+.\-]*:/.test(raw) && !/^[A-Za-z0-9.\-]+:\d+([\/?#]|$)/.test(raw);   // "host:8080/x" is a host and a port, not a scheme
    try { u = new URL(hasScheme ? raw : "http://" + raw.replace(/^\/\//, "")); assumed = !hasScheme; } catch {
      const pm = /^(?:[A-Za-z][A-Za-z0-9+.\-]*:\/\/)?(?:[^\/?#@]*@)?[^\/?#@:]*(?:\[[^\]]*\])?:(\d+)(?:[\/?#]|$)/.exec(raw);
      if (pm && +pm[1] > 65535) return { error: "The port must be a number from 1 to 65535 (" + pm[1] + " is too big)." };
      return BAD;
    }
    if (!u.hostname && /^(https?|ftp|wss?):$/.test(u.protocol)) return BAD;
    if (assumed) notes.push({ level: "", text: "No scheme (like https://) was given, so http:// was assumed to read the parts." });
    const proto = u.protocol, scheme = proto.replace(/:$/, "");
    const hasAuthority = /^[A-Za-z][A-Za-z0-9+.\-]*:\/\//.test(raw) || assumed;
    const host = u.hostname, unicodeHost = hostToUnicode(host);
    const rawPortText = (/:(\d+)$/.exec((raw.replace(/^[A-Za-z][A-Za-z0-9+.\-]*:\/\//, "").split(/[\/?#]/)[0].replace(/^[^@]*@/, "")).replace(/^\[[^\]]*\]/, "")) || [])[1] || "";
    const rows = [["Scheme (protocol)", scheme, scheme === "https" ? "encrypted" : scheme === "http" ? "NOT encrypted" : ""]];
    if (u.username || u.password) rows.push(["User name", dec(u.username), ""], ["Password", u.password ? dec(u.password) : "(none)", u.password ? "shown in clear: do not share" : ""]);
    rows.push(["Host", host, unicodeHost !== host ? "reads as: " + unicodeHost : ""]);
    const dp = DEFAULT_PORTS[proto];
    rows.push(["Port", u.port || rawPortText || (dp ? String(dp) : "(none)"), (u.port || rawPortText) ? (dp && +(u.port || rawPortText) === dp ? "the default for " + scheme + " written out" : "explicit") : dp ? "default for " + scheme + ", not written in the address" : ""]);
    rows.push(["Path", decPath(u.pathname), u.pathname !== decPath(u.pathname) ? "as sent: " + u.pathname : ""]);
    const segs = u.pathname.split("/").filter(Boolean).map(decPath);
    const params = [...u.searchParams.entries()].map(([k, v]) => ({ key: k, value: v }));
    const seen = {}; for (const p of params) seen[p.key] = (seen[p.key] || 0) + 1;
    if (u.search) rows.push(["Query string", u.search.slice(1), params.length + " parameter" + (params.length === 1 ? "" : "s")]);
    if (u.hash) rows.push(["Fragment", decPath(u.hash.slice(1)), "never sent to the server: only the browser uses it"]);
    // ---- what to be careful about
    const stripScheme = raw.replace(/^[A-Za-z][A-Za-z0-9+.\-]*:\/\//, "");
    const authority = stripScheme.split(/[\/?#]/)[0], atAt = authority.lastIndexOf("@");
    const rawUser = atAt >= 0 ? authority.slice(0, atAt) : "", rawHostPort = authority.slice(atAt + 1), rawHost = rawHostPort.replace(/:\d*$/, "");
    const rawPath = "/" + stripScheme.split(/[?#]/)[0].split("/").slice(1).join("/");
    if (u.password) notes.push({ level: "bad", text: "A password is written inside the address. It ends up in browser history, logs and shared links. Never put passwords in a URL." });
    else if (u.username) {
      const looksLikeSite = /^[^:@\s]+\.[A-Za-z]{2,}$/.test(dec(u.username));
      notes.push({ level: looksLikeSite ? "bad" : "warn", text: looksLikeSite ? "The text before the @ (" + dec(u.username) + ") looks like a web site, but it is only a user name. The address really goes to " + host + ". This is a common phishing trick." : "A user name is written inside the address (before the @). The part before the @ is NOT the site: the site is " + host + "." });
    }
    if (/^xn--|\.xn--/i.test(host)) notes.push({ level: "warn", text: "The host is an international domain name (written as " + host + ", read as " + unicodeHost + "). Letters from other alphabets can look identical to Latin ones: check it is really the site you expect." });
    if (unicodeHost.split(".").some(l => /[a-z]/i.test(l) && /[\u0400-\u04FF\u0370-\u03FF\u0530-\u058F]/.test(l))) notes.push({ level: "bad", text: "One part of the host mixes Latin letters with letters from another alphabet (Cyrillic, Greek or Armenian). That is a classic look-alike attack." });
    if (/^\d+(\.\d+)*$/.test(host) && rawHost !== host && !/^\[/.test(rawHost)) notes.push({ level: "warn", text: "The host was written as \"" + rawHost + "\" but means the address " + host + ". Numbers in decimal, octal or hexadecimal form are used to hide where a link goes." });
    const hostRow = rows.find(r => r[0] === "Host");
    if (/^\[.*\]$/.test(host)) hostRow[2] = "an IPv6 address";
    else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) { const p = host.split(".").map(Number); hostRow[2] = (p[0] === 10 || p[0] === 127 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 169 && p[1] === 254)) ? "a private or local address" : "an IPv4 address (no name)"; }
    const pathRow = rows.find(r => r[0] === "Path");
    if (rawPath !== u.pathname && decPath(rawPath) !== decPath(u.pathname)) pathRow[2] = "tidied by the browser (typed as " + rawPath + ")";
    if (scheme === "http" && !/^(localhost|127\.|\[::1\])/.test(host) && !assumed) notes.push({ level: "warn", text: "http:// is not encrypted: anything sent can be read on the way. Use https:// where the site supports it." });
    if (/%2e%2e|%2f|%5c/i.test(rawPath) || /(^|\/)\.\.(\/|$)/.test(rawPath)) notes.push({ level: "warn", text: "The path contains encoded slashes or dot-segments (../). These are used in path traversal attempts." });
    for (const k of Object.keys(seen)) if (seen[k] > 1) notes.push({ level: "", text: "The parameter \"" + k + "\" appears " + seen[k] + " times. Different programs read the first, the last or all of them." });
    if (params.some(p => /^(password|passwd|pwd|pass|token|access_token|api[_-]?key|apikey|secret|session|sid|auth)$/i.test(p.key) && p.value)) notes.push({ level: "warn", text: "A parameter that looks like a secret (password, token, key) is in the query string. Query strings are stored in logs and history; send secrets in a header or the body instead." });
    if (u.port && (+u.port < 1 || +u.port > 65535)) notes.push({ level: "bad", text: "The port must be 1 to 65535." });
    if (raw.length > 2000) notes.push({ level: "warn", text: "The address is " + raw.length + " characters long. Some browsers, servers and proxies cut addresses over about 2000 characters." });
    return { rows, segments: segs, params, notes, href: u.href, origin: u.origin === "null" ? "" : u.origin, scheme, host, unicodeHost, port: u.port, assumed };
  }
  const api = { parse, punyDecode, hostToUnicode };
  if (typeof window !== "undefined") window.UrlParse = api;
  if (typeof module !== "undefined") module.exports = api;
})();
