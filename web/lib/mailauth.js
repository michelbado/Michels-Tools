/* SPF, DKIM and DMARC record reader: explains pasted DNS TXT records in plain words and finds mistakes. It cannot look anything up
   (no DNS access, nothing is sent anywhere): SPF "include" records are not followed, so the lookup count it gives is a lower bound.
   Pure; exports window.MailAuth. */
(() => {
  "use strict";

  // ---------- reading the pasted text ----------
  // A TXT record is often pasted with quotes, split into several quoted strings, or inside a zone-file line. Join the strings.
  function unquote(s) {
    s = String(s == null ? "" : s).replace(/\r\n?/g, "\n").trim();
    const parts = []; const re = /"((?:[^"\\]|\\.)*)"/g; let m;
    while ((m = re.exec(s))) parts.push(m[1].replace(/\\(.)/g, "$1"));
    if (parts.length) return parts.join("");
    return s.replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim();
  }
  // Split whatever was pasted into separate records: one per line, but quoted strings and bracketed zone-file entries can span lines.
  function splitRecords(text) {
    const lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n"), out = [];
    let cur = "", depth = 0, quotes = 0;
    const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; depth = 0; quotes = 0; };
    for (const line of lines) {
      if (!line.trim() && !cur) continue;
      if (!line.trim()) { flush(); continue; }
      cur += (cur ? "\n" : "") + line;
      for (const ch of line) { if (ch === '"') quotes++; else if (ch === "(") depth++; else if (ch === ")") depth--; }
      if (quotes % 2 === 0 && depth <= 0) flush();
    }
    flush();
    return out;
  }
  function kindOf(v) {
    if (/\bv=spf1\b/i.test(v)) return "spf";
    if (/\bv=DMARC1\b/i.test(v)) return "dmarc";
    if (/\bv=DKIM1\b/i.test(v)) return "dkim";
    if (/(^|;)\s*p=[A-Za-z0-9+\/=\s]{16,}/.test(v) && /(^|;)\s*(k|h|t|s)=/i.test(v)) return "dkim";
    if (/(^|;)\s*p=[A-Za-z0-9+\/=\s]{40,}\s*;?\s*$/.test(v)) return "dkim";
    if (/\bv=spf2/i.test(v)) return "spf";
    return "";
  }

  // ---------- small helpers ----------
  const isIPv4 = s => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every(n => +n <= 255);
  function isIPv6(s) {
    if (!/^[0-9A-Fa-f:.]+$/.test(s) || !s.includes(":")) return false;
    let v4 = false;
    if (s.includes(".")) { const i = s.lastIndexOf(":"); if (!isIPv4(s.slice(i + 1))) return false; s = s.slice(0, i) + ":0:0"; v4 = true; }
    const dbl = s.split("::"); if (dbl.length > 2) return false;
    const groups = x => (x === "" ? [] : x.split(":"));
    const g = dbl.map(groups);
    if (g.some(a => a.some(h => !/^[0-9A-Fa-f]{1,4}$/.test(h)))) return false;
    const n = g.reduce((t, a) => t + a.length, 0);
    return dbl.length === 2 ? n <= 7 : n === 8 || (v4 && n === 8);
  }
  const isDomainSpec = s => /^[A-Za-z0-9._%{}+\-\/,=:]+$/.test(s) && s.length > 0;
  const b64decode = s => { try { return Uint8Array.from(atob(s.replace(/\s+/g, "")), c => c.charCodeAt(0)); } catch { return null; } };
  const dnsNote = len => len > 450 ? { level: "warn", text: "This record is " + len + " characters long. DNS answers over UDP are safest below about 450 bytes: very long records can get cut off or fail through some resolvers." }
    : null;
  const longString = len => len > 255 ? { level: "", text: "A single DNS text string can hold at most 255 characters. At " + len + " characters this record has to be stored as several quoted strings; most DNS control panels do the split for you, and receivers join the pieces." } : null;

  // ---------- SPF ----------
  const Q = { "+": ["Pass", "mail from here is accepted"], "-": ["Fail", "mail from here is rejected"], "~": ["Softfail", "mail from here is accepted but marked suspicious"], "?": ["Neutral", "no statement about mail from here"] };
  function spf(raw) {
    const text = unquote(raw), notes = [], rows = [], res = { kind: "spf", text, notes, rows };
    const terms = text.split(/\s+/).filter(Boolean);
    if (!terms.length || !/^v=spf1$/i.test(terms[0])) {
      notes.push({ level: "bad", text: /^v=spf2/i.test(terms[0] || "") ? "This is an SPF2.0 / Sender ID record, which is obsolete. Publish a record that starts with v=spf1." : "An SPF record must start with v=spf1." });
      res.summary = "Not a valid SPF record"; return res;
    }
    let lookups = 0, allIdx = -1, redirect = null, count = {}; const seen = new Set();
    terms.slice(1).forEach((t, idx) => {
      let m = /^([+\-~?])?(all|include|a|mx|ptr|ip4|ip6|exists)(?:([:\/])(.*))?$/i.exec(t), mod = /^([A-Za-z][A-Za-z0-9_.\-]*)=(.*)$/.exec(t);
      if (m && mod && /^(redirect|exp)$/i.test(mod[1])) m = null;
      if (m) {
        const q = m[1] || "+", name = m[2].toLowerCase(), arg = m[3] === ":" ? m[4] : "", cidr = m[3] === "/" ? m[4] : "";
        count[name] = (count[name] || 0) + 1;
        const key = q + name + ":" + arg; if (seen.has(key) && name !== "all") notes.push({ level: "warn", text: "\"" + t + "\" appears more than once." }); seen.add(key);
        let plain = "";
        if (name === "all") { allIdx = idx; plain = "every other sender: " + Q[q][1] + " (" + Q[q][0] + ")"; }
        else if (name === "include") { lookups++; plain = arg ? "also use the SPF record of " + arg + " (" + Q[q][0] + " if it matches)" : "missing the domain after include:"; if (!arg) notes.push({ level: "bad", text: "\"" + t + "\": include needs a domain, like include:_spf.example.com." }); else if (!isDomainSpec(arg)) notes.push({ level: "bad", text: "\"" + t + "\" is not a valid domain." }); }
        else if (name === "a" || name === "mx") { lookups++; const d = arg.split("/")[0], net = m[3] === "/" ? cidr : (arg.includes("/") ? arg.slice(arg.indexOf("/") + 1) : ""); plain = "the " + (name === "a" ? "address (A/AAAA) records" : "mail servers (MX)") + " of " + (d || "this domain") + (net ? " and the networks around them (/" + net + ")" : "") + " (" + Q[q][0] + ")"; if (d && !isDomainSpec(d)) notes.push({ level: "bad", text: "\"" + t + "\" is not a valid domain." }); }
        else if (name === "ptr") { lookups++; plain = "senders whose reverse DNS name is under " + (arg || "this domain") + " (" + Q[q][0] + ")"; notes.push({ level: "warn", text: "ptr is deprecated by the SPF standard: it is slow, unreliable and many receivers ignore it. Replace it with ip4, ip6 or include." }); }
        else if (name === "exists") { lookups++; plain = "senders for which the DNS name " + (arg || "?") + " exists (" + Q[q][0] + ")"; if (!arg) notes.push({ level: "bad", text: "\"" + t + "\": exists needs a domain." }); }
        else if (name === "ip4" || name === "ip6") {
          const v = (m[3] === ":" ? m[4] : ""), [addr, len] = v.split("/");
          const okAddr = name === "ip4" ? isIPv4(addr || "") : isIPv6(addr || ""), max = name === "ip4" ? 32 : 128;
          const okLen = len === undefined || (/^\d{1,3}$/.test(len) && +len <= max);
          if (!okAddr || !okLen || m[3] !== ":") { notes.push({ level: "bad", text: "\"" + t + "\" is not a valid " + (name === "ip4" ? "IPv4" : "IPv6") + " address or network." }); plain = "invalid address"; }
          else {
            const bits = len === undefined ? max : +len; plain = (bits === max ? "the single address " + addr : "the network " + addr + "/" + bits) + " (" + Q[q][0] + ")";
            if (bits === 0) notes.push({ level: "bad", text: "\"" + t + "\" covers every address on the internet." });
            else if (name === "ip4" && bits < 16) notes.push({ level: "warn", text: "\"" + t + "\" covers " + Math.pow(2, 32 - bits).toLocaleString("en-US") + " addresses: check that you really own or control all of them." });
            else if (name === "ip6" && bits < 32) notes.push({ level: "warn", text: "\"" + t + "\" is a very large IPv6 network: check that you really control all of it." });
          }
        }
        if (allIdx >= 0 && idx > allIdx) notes.push({ level: "warn", text: "\"" + t + "\" comes after \"all\" and is ignored: put \"all\" last." });
        rows.push([t, name, plain]);
      } else if (mod) {
        const n = mod[1].toLowerCase();
        if (n === "redirect") { lookups++; redirect = mod[2]; rows.push([t, "redirect", "use the SPF record of " + (mod[2] || "?") + " instead of this one"]); if (!mod[2]) notes.push({ level: "bad", text: "redirect needs a domain." }); }
        else if (n === "exp") rows.push([t, "exp", "text shown to senders who fail: " + mod[2]]);
        else { rows.push([t, "unknown modifier", "ignored by receivers"]); notes.push({ level: "", text: "\"" + t + "\" is an unknown modifier; receivers ignore it." }); }
      } else {
        rows.push([t, "unknown", "not understood"]);
        notes.push({ level: "bad", text: "\"" + t + "\" is not a valid SPF term. If this is a typo, receivers will give a permanent error (permerror) and treat your SPF as broken." });
      }
    });
    if (allIdx >= 0) {
      const w = terms.slice(1)[allIdx], q = /^[+\-~?]/.test(w) ? w[0] : "+";
      if (q === "+") notes.push({ level: "bad", text: "\"" + w + "\" lets ANYONE send mail as your domain and pass SPF. Use -all (or ~all while you are still testing)." });
      else if (q === "?") notes.push({ level: "warn", text: "\"?all\" says nothing about unlisted senders, so SPF gives no protection. Use ~all or -all." });
      else if (q === "~") notes.push({ level: "good", text: "\"~all\" (softfail): unlisted senders are marked suspicious but usually still delivered. A common choice; -all is stricter once you are sure the list is complete." });
      else notes.push({ level: "good", text: "\"-all\": mail from unlisted senders is rejected. This is the strictest setting. Make sure every legitimate sender is listed first." });
      if (redirect) notes.push({ level: "warn", text: "A redirect= modifier is ignored when the record also contains \"all\"." });
    } else if (!redirect) notes.push({ level: "warn", text: "The record ends without \"all\" or \"redirect=\", so unlisted senders get a neutral result: it protects nothing. Add ~all or -all at the end." });
    if (lookups > 10) notes.push({ level: "bad", text: "This record already needs " + lookups + " DNS lookups, and SPF allows at most 10 per check. Receivers will give a permanent error and treat your SPF as failed. Remove include/a/mx terms or replace them with ip4/ip6." });
    else if (lookups === 10) notes.push({ level: "warn", text: "This record uses all 10 allowed DNS lookups, and every include: adds lookups of its own that cannot be counted here, so it is probably over the limit." });
    else if (lookups > 0) notes.push({ level: "", text: "This record uses " + lookups + " of the 10 DNS lookups SPF allows (include, a, mx, ptr, exists and redirect each count one). Each include: also adds the lookups inside the record it points to, which cannot be counted here, so the real number is higher." });
    else notes.push({ level: "good", text: "No DNS lookups are needed (only fixed addresses), so the 10-lookup limit cannot be a problem." });
    const l = longString(text.length), d = dnsNote(text.length); if (l) notes.push(l); if (d) notes.push(d);
    if (count.mx > 1 || count.a > 2) notes.push({ level: "", text: "Several a/mx terms: each mx can also cost extra lookups for the mail server names." });
    res.lookups = lookups;
    const bad = notes.filter(n => n.level === "bad").length, warn = notes.filter(n => n.level === "warn").length;
    res.summary = bad ? "SPF record with " + bad + " problem" + (bad > 1 ? "s" : "") : warn ? "SPF record is valid, with " + warn + " thing" + (warn > 1 ? "s" : "") + " to improve" : "SPF record looks good";
    res.publish = "Publish it as a TXT record at the domain itself (the bare domain), and keep only ONE v=spf1 record per domain: two records make SPF fail.";
    return res;
  }

  // ---------- generic tag=value parser (DKIM and DMARC) ----------
  function tags(text) {
    const out = [], seen = {};
    for (const part of text.split(";")) {
      const p = part.trim(); if (!p) continue;
      const i = p.indexOf("="); if (i < 0) { out.push({ k: "", v: p, bad: true }); continue; }
      const k = p.slice(0, i).trim().toLowerCase(), v = p.slice(i + 1).trim();
      out.push({ k, v, dup: !!seen[k] }); seen[k] = true;
    }
    return out;
  }
  const getTag = (t, k) => { const x = t.find(e => e.k === k); return x ? x.v : undefined; };

  // ---------- DMARC ----------
  function dmarc(raw) {
    const text = unquote(raw), t = tags(text), notes = [], rows = [], res = { kind: "dmarc", text, notes, rows };
    if (!t.length || t[0].k !== "v" || !/^DMARC1$/i.test(t[0].v)) {
      notes.push({ level: "bad", text: t.some(e => e.k === "v" && /^DMARC1$/i.test(e.v)) ? "v=DMARC1 must be the first tag in the record." : "A DMARC record must start with v=DMARC1." });
      res.summary = "Not a valid DMARC record"; return res;
    }
    const known = { v: 1, p: 1, sp: 1, pct: 1, rua: 1, ruf: 1, adkim: 1, aspf: 1, fo: 1, ri: 1, rf: 1, np: 1, psd: 1, t: 1 };
    const pol = v => ({ none: "monitor only: do nothing about failing mail, just send reports", quarantine: "treat failing mail as suspicious (usually the spam folder)", reject: "reject failing mail" })[String(v).toLowerCase()];
    const p = getTag(t, "p"), sp = getTag(t, "sp"), rua = getTag(t, "rua");
    for (const e of t) {
      if (e.bad) { notes.push({ level: "bad", text: "\"" + e.v + "\" is not a tag=value pair." }); continue; }
      if (e.dup) notes.push({ level: "bad", text: "The tag \"" + e.k + "\" appears more than once." });
      let plain = "";
      switch (e.k) {
        case "v": plain = "version"; break;
        case "p": plain = pol(e.v) ? "policy for the domain: " + pol(e.v) : "not a valid policy"; if (!pol(e.v)) notes.push({ level: "bad", text: "p=" + e.v + " is not valid: use none, quarantine or reject." }); break;
        case "sp": plain = pol(e.v) ? "policy for subdomains: " + pol(e.v) : "not a valid policy"; if (!pol(e.v)) notes.push({ level: "bad", text: "sp=" + e.v + " is not valid: use none, quarantine or reject." }); break;
        case "np": plain = pol(e.v) ? "policy for subdomains that do not exist: " + pol(e.v) : "not a valid policy"; break;
        case "pct": { const n = /^\d{1,3}$/.test(e.v) ? +e.v : -1; plain = n >= 0 && n <= 100 ? "the policy applies to " + n + "% of failing mail" : "not a valid percentage"; if (n < 0 || n > 100) notes.push({ level: "bad", text: "pct must be a number from 0 to 100." }); break; }
        case "adkim": plain = /^[rs]$/i.test(e.v) ? (/^s$/i.test(e.v) ? "DKIM alignment: strict (the signing domain must match the From domain exactly)" : "DKIM alignment: relaxed (subdomains of the From domain are fine)") : "not valid (use r or s)"; if (!/^[rs]$/i.test(e.v)) notes.push({ level: "bad", text: "adkim must be r or s." }); break;
        case "aspf": plain = /^[rs]$/i.test(e.v) ? (/^s$/i.test(e.v) ? "SPF alignment: strict (the envelope domain must match the From domain exactly)" : "SPF alignment: relaxed (subdomains of the From domain are fine)") : "not valid (use r or s)"; if (!/^[rs]$/i.test(e.v)) notes.push({ level: "bad", text: "aspf must be r or s." }); break;
        case "rua": case "ruf": {
          const dests = e.v.split(",").map(x => x.trim()).filter(Boolean);
          plain = (e.k === "rua" ? "daily summary reports go to " : "detailed failure reports go to ") + dests.join(", ");
          for (const d of dests) { if (!/^mailto:[^\s@,]+@[^\s@,!]+(![0-9]+[kmgt]?)?$/i.test(d)) notes.push({ level: "bad", text: e.k + " destination \"" + d + "\" is not a valid mailto: address." }); }
          break; }
        case "fo": plain = "when to send failure reports: " + e.v.split(":").map(x => ({ "0": "when all checks fail", "1": "when any check fails", d: "when DKIM fails", s: "when SPF fails" })[x.trim()] || "?" + x).join("; "); if (!/^[01ds](:[01ds])*$/i.test(e.v)) notes.push({ level: "bad", text: "fo must be made of 0, 1, d and s separated by colons." }); break;
        case "ri": plain = /^\d+$/.test(e.v) ? "send summary reports every " + e.v + " seconds (about " + Math.round(+e.v / 3600) + " hours)" : "not a number"; if (!/^\d+$/.test(e.v)) notes.push({ level: "bad", text: "ri must be a number of seconds." }); break;
        case "rf": plain = "report format: " + e.v; break;
        case "t": plain = "testing mode (DMARCbis): " + e.v; break;
        default: plain = "unknown tag, ignored"; notes.push({ level: "", text: "The tag \"" + e.k + "\" is not part of DMARC and receivers ignore it." });
      }
      rows.push([e.k + "=" + e.v, known[e.k] ? e.k : "unknown", plain]);
    }
    if (p === undefined) {
      if (rua) notes.push({ level: "warn", text: "There is no p= policy tag. Because rua= is present, receivers treat it as p=none (monitoring only), but the record should state a policy." });
      else notes.push({ level: "bad", text: "The p= policy tag is missing, so this DMARC record is invalid and receivers ignore it." });
    } else if (/^none$/i.test(p)) notes.push({ level: "warn", text: "p=none only monitors: failing mail is still delivered. That is the right first step while you read the reports, but it gives no protection against forged mail. Move to quarantine and then reject once all your legitimate mail passes." });
    else if (/^quarantine$/i.test(p)) notes.push({ level: "good", text: "p=quarantine: failing mail is treated as suspicious. Good protection; reject is the strongest." });
    else if (/^reject$/i.test(p)) notes.push({ level: "good", text: "p=reject: mail that fails DMARC is rejected. This is the strongest protection against forged mail." });
    const pct = getTag(t, "pct");
    if (pct !== undefined && /^\d+$/.test(pct) && +pct < 100 && p && !/^none$/i.test(p)) notes.push({ level: "warn", text: "pct=" + pct + ": only " + pct + "% of failing mail gets the " + p.toLowerCase() + " policy; the rest gets the next weaker one. Move to pct=100 when ready." });
    if (sp === undefined && p && !/^none$/i.test(p)) notes.push({ level: "", text: "No sp= tag: subdomains follow the main policy (p=" + p.toLowerCase() + ")." });
    if (rua === undefined) notes.push({ level: "warn", text: "There is no rua= tag, so you will receive no summary reports and cannot see who sends mail as your domain. Add rua=mailto:dmarc@yourdomain." });
    else notes.push({ level: "", text: "If a report address is on a DIFFERENT domain, that other domain must publish a permission record (yourdomain._report._dmarc.otherdomain), or receivers will not send reports there." });
    if (getTag(t, "ruf") !== undefined) notes.push({ level: "", text: "ruf= asks for detailed failure reports. Many large mail providers do not send them, and they can contain parts of real messages, so handle them as personal data." });
    const a = getTag(t, "adkim"), s = getTag(t, "aspf");
    if ((a && /^s$/i.test(a)) || (s && /^s$/i.test(s))) notes.push({ level: "", text: "Strict alignment is stricter than most senders need: mail sent from a subdomain, or through a service that signs with a subdomain, will fail." });
    const l = longString(text.length), d = dnsNote(text.length); if (l) notes.push(l); if (d) notes.push(d);
    const bad = notes.filter(n => n.level === "bad").length;
    res.summary = bad ? "DMARC record with " + bad + " problem" + (bad > 1 ? "s" : "") : p === undefined ? "DMARC record without a policy" : "DMARC policy: " + p.toLowerCase() + (/^reject$/i.test(p) ? " (strongest)" : /^quarantine$/i.test(p) ? " (good)" : " (monitoring only)");
    res.policy = p ? p.toLowerCase() : "";
    res.publish = "Publish it as a TXT record at _dmarc.<your domain>, for example _dmarc.example.com.";
    return res;
  }

  // ---------- DKIM ----------
  function der(b, off) { // one DER element: { tag, start, len, end }
    if (off + 2 > b.length) return null;
    const tag = b[off]; let len = b[off + 1], p = off + 2;
    if (len & 0x80) { const n = len & 0x7f; if (n < 1 || n > 4 || p + n > b.length) return null; len = 0; for (let i = 0; i < n; i++) len = len * 256 + b[p++]; }
    if (p + len > b.length) return null;
    return { tag, start: p, len, end: p + len };
  }
  function bitLen(b, e) { // significant bits of an INTEGER
    let i = e.start; while (i < e.end - 1 && b[i] === 0) i++;
    if (i >= e.end) return 0;
    let v = b[i], bits = 0; while (v) { bits++; v >>= 1; }
    return (e.end - i - 1) * 8 + bits;
  }
  // RSA public key in a DKIM p= value: usually SubjectPublicKeyInfo; some people paste the bare PKCS#1 key.
  function rsaInfo(b) {
    const o = der(b, 0); if (!o || o.tag !== 0x30) return null;
    const first = der(b, o.start); if (!first) return null;
    if (first.tag === 0x02) { const second = der(b, first.end); if (!second || second.tag !== 0x02) return null; return { bits: bitLen(b, first), exp: second.len ? Array.from(b.slice(second.start, second.end)).reduce((t, x) => t * 256 + x, 0) : 0, format: "PKCS#1" }; }
    if (first.tag !== 0x30) return null;
    const oid = der(b, first.start); if (!oid || oid.tag !== 0x06) return null;
    const oidHex = Array.from(b.slice(oid.start, oid.end)).map(x => x.toString(16).padStart(2, "0")).join("");
    const bs = der(b, first.end); if (!bs || bs.tag !== 0x03) return null;
    if (oidHex !== "2a864886f70d010101") return { other: oidHex };
    const inner = der(b, bs.start + 1); if (!inner || inner.tag !== 0x30) return null;
    const n = der(b, inner.start), e = n && der(b, n.end); if (!n || n.tag !== 0x02 || !e || e.tag !== 0x02) return null;
    return { bits: bitLen(b, n), exp: Array.from(b.slice(e.start, e.end)).reduce((t, x) => t * 256 + x, 0), format: "SubjectPublicKeyInfo" };
  }
  function dkim(raw) {
    const text = unquote(raw), t = tags(text), notes = [], rows = [], res = { kind: "dkim", text, notes, rows };
    const k = (getTag(t, "k") || "rsa").toLowerCase(), pRaw = getTag(t, "p");
    const first = t[0];
    if (first && first.k === "v" && !/^DKIM1$/i.test(first.v)) notes.push({ level: "bad", text: "v= must be DKIM1 (or left out)." });
    if (t.some((e, i) => e.k === "v" && i > 0)) notes.push({ level: "bad", text: "If v= is present it must be the first tag." });
    for (const e of t) {
      if (e.bad) { notes.push({ level: "bad", text: "\"" + e.v + "\" is not a tag=value pair." }); continue; }
      if (e.dup) notes.push({ level: "bad", text: "The tag \"" + e.k + "\" appears more than once." });
      let plain = "";
      switch (e.k) {
        case "v": plain = "version"; break;
        case "k": plain = /^(rsa|ed25519)$/i.test(e.v) ? "key type: " + e.v.toLowerCase() : "unknown key type"; if (!/^(rsa|ed25519)$/i.test(e.v)) notes.push({ level: "bad", text: "k=" + e.v + " is not a supported key type (rsa or ed25519)." }); break;
        case "p": plain = e.v ? "the public key (" + e.v.replace(/\s+/g, "").length + " characters)" : "EMPTY: this key has been revoked"; break;
        case "h": plain = "allowed hash algorithms: " + e.v; break;
        case "s": plain = "service type: " + e.v; break;
        case "t": plain = e.v.split(":").map(x => ({ y: "testing mode: failures should not be treated as errors", s: "strict: only the exact domain may use this key, not subdomains" })[x.trim().toLowerCase()] || "unknown flag " + x).join("; "); break;
        case "n": plain = "note for humans: " + e.v; break;
        case "g": plain = "granularity (obsolete)"; break;
        default: plain = "unknown tag, ignored";
      }
      rows.push([e.k + "=" + (e.k === "p" && e.v.length > 40 ? e.v.replace(/\s+/g, "").slice(0, 28) + "..." : e.v), e.k, plain]);
    }
    if (pRaw === undefined) notes.push({ level: "bad", text: "The p= tag (the public key) is missing: this record cannot verify anything." });
    else if (pRaw === "") notes.push({ level: "warn", text: "p= is empty: this key is REVOKED. Messages signed with it will fail. That is correct only if you retired this selector on purpose." });
    else {
      const bytes = b64decode(pRaw);
      if (!bytes) notes.push({ level: "bad", text: "The p= value is not valid base64: it may contain characters that were changed or cut when it was copied." });
      else if (k === "ed25519") {
        if (bytes.length === 32) notes.push({ level: "good", text: "Ed25519 key of the right size (32 bytes). Not every receiver verifies Ed25519 yet, so most senders sign with both an RSA and an Ed25519 key." });
        else if (bytes.length === 44 && bytes[0] === 0x30) notes.push({ level: "bad", text: "This Ed25519 key is wrapped in a certificate-style envelope. A DKIM record needs the raw 32-byte key only." });
        else notes.push({ level: "bad", text: "An Ed25519 key must be exactly 32 bytes; this one is " + bytes.length + "." });
      } else {
        const info = rsaInfo(bytes);
        if (!info) notes.push({ level: "bad", text: "The p= value does not decode to an RSA public key. If it was copied from a longer key file, check you took the whole key and nothing else." });
        else if (info.other) notes.push({ level: "bad", text: "The key is not an RSA key, but k=rsa says it is." });
        else {
          res.bits = info.bits;
          if (info.bits < 1024) notes.push({ level: "bad", text: "RSA key of " + info.bits + " bits: far too weak. Receivers may reject it. Use 2048 bits." });
          else if (info.bits < 2048) notes.push({ level: "warn", text: "RSA key of " + info.bits + " bits. 1024 still works but is considered weak; use 2048 bits." });
          else notes.push({ level: "good", text: "RSA key of " + info.bits + " bits: a good size." });
          if (info.format === "PKCS#1") notes.push({ level: "warn", text: "This is the bare RSA key, not the standard wrapped format (SubjectPublicKeyInfo). Many verifiers still accept it, but the standard form is safer." });
          rows.push(["key size", "key", info.bits + " bits, public exponent " + info.exp]);
        }
      }
    }
    const tt = getTag(t, "t");
    if (tt && /(^|:)\s*y\s*(:|$)/i.test(tt)) notes.push({ level: "warn", text: "t=y (testing mode) is on. Receivers are told not to treat failures as real problems. Remove it once DKIM works." });
    const h = getTag(t, "h"); if (h && !/sha256/i.test(h)) notes.push({ level: "warn", text: "h= allows only " + h + ". SHA-1 signing is obsolete: allow sha256." });
    const s = getTag(t, "s"); if (s && !/^(\*|email)(:(\*|email))*$/i.test(s)) notes.push({ level: "warn", text: "s=" + s + " is not a service type receivers know (use * or email)." });
    const l = longString(text.length), d = dnsNote(text.length); if (l) notes.push(l); if (d && text.length > 450 && !(res.bits && res.bits >= 2048)) notes.push(d);
    const bad = notes.filter(n => n.level === "bad").length, warn = notes.filter(n => n.level === "warn").length;
    res.summary = bad ? "DKIM key with " + bad + " problem" + (bad > 1 ? "s" : "") : pRaw === "" ? "DKIM key is revoked" : warn ? "DKIM key is valid, with " + warn + " thing" + (warn > 1 ? "s" : "") + " to improve" : "DKIM key looks good";
    res.publish = "Publish it as a TXT record at <selector>._domainkey.<your domain>, for example mail2026._domainkey.example.com. The selector is the s= value of the DKIM-Signature header of a message.";
    return res;
  }

  // ---------- everything pasted ----------
  function analyze(text) {
    const recs = splitRecords(text), results = [];
    if (!recs.length) return { empty: true, results, summary: "", notes: [] };
    const notes = [];
    for (const r of recs) {
      const v = unquote(r), kind = kindOf(v);
      if (kind === "spf") results.push(spf(r));
      else if (kind === "dmarc") results.push(dmarc(r));
      else if (kind === "dkim") results.push(dkim(r));
      else results.push({ kind: "", text: v, notes: [{ level: "bad", text: "This is not recognised as an SPF, DKIM or DMARC record. SPF starts with v=spf1, DMARC with v=DMARC1, and a DKIM key has a p= tag (and usually v=DKIM1)." }], rows: [], summary: "Not recognised" });
    }
    const spfs = results.filter(r => r.kind === "spf").length;
    if (spfs > 1) notes.push({ level: "bad", text: "You pasted " + spfs + " SPF records. A domain may have only ONE v=spf1 record: with two, SPF fails for every message. Merge them into a single record (if they belong to different domains, ignore this)." });
    const dm = results.filter(r => r.kind === "dmarc").length;
    if (dm > 1) notes.push({ level: "bad", text: "You pasted " + dm + " DMARC records. A domain may have only one; with two, receivers ignore DMARC." });
    const counts = { spf: spfs, dkim: results.filter(r => r.kind === "dkim").length, dmarc: dm };
    const parts = []; if (counts.spf) parts.push(counts.spf + " SPF"); if (counts.dmarc) parts.push(counts.dmarc + " DMARC"); if (counts.dkim) parts.push(counts.dkim + " DKIM");
    return { results, notes, counts, summary: parts.length ? "Read " + parts.join(", ") + " record" + (results.length > 1 ? "s" : "") : "Nothing recognised" };
  }

  const api = { analyze, splitRecords, unquote, kindOf, spf, dmarc, dkim, isIPv4, isIPv6, rsaInfo };
  if (typeof window !== "undefined") window.MailAuth = api;
  if (typeof module !== "undefined") module.exports = api;
})();
