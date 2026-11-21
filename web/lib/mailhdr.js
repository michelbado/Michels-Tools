/* Email header analysis: the route a message took (Received headers, with the time spent at each hop), the SPF/DKIM/DMARC verdicts,
   and signs of a forged or misleading sender. Pure; exports window.MailHdr. Works on text pasted by the visitor; nothing is sent anywhere. */
(() => {
  "use strict";
  // raw text -> [{ name, value }] in the order given (folded lines joined). Stops at the first empty line (where the body would start).
  function parseHeaders(text) {
    const lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n"), out = [];
    let started = false;
    for (const line of lines) {
      if (line === "" || /^\s*$/.test(line) && started && !/^[ \t]/.test(line)) { if (started) break; else continue; }
      if (/^[ \t]/.test(line) && out.length) { out[out.length - 1].value = (out[out.length - 1].value + " " + line.trim()).trim(); started = true; continue; }
      const m = /^([!-9;-~]+):[ \t]*(.*)$/.exec(line);
      if (m) { out.push({ name: m[1], value: m[2].trim() }); started = true; }
      else if (!started && /^From \S+/.test(line)) continue;          // mbox "From " line
      else if (!out.length) continue;                                  // junk before the headers
      else { out[out.length - 1].value += " " + line.trim(); }
    }
    return out;
  }
  const get = (h, n) => { n = n.toLowerCase(); const x = h.find(e => e.name.toLowerCase() === n); return x ? x.value : ""; };
  const all = (h, n) => { n = n.toLowerCase(); return h.filter(e => e.name.toLowerCase() === n).map(e => e.value); };

  const parseDate = s => { if (!s) return null; const t = Date.parse(String(s).replace(/\s*\([^)]*\)\s*$/, "").trim()); return Number.isFinite(t) ? t : null; };
  const addrOf = v => { const m = /<([^<>]+)>/.exec(v) || /([^\s<>"(),;]+@[^\s<>"(),;]+)/.exec(v); return m ? m[1].trim().toLowerCase() : ""; };
  const domainOf = a => { const i = String(a).lastIndexOf("@"); return i < 0 ? "" : a.slice(i + 1).replace(/[>\s]+$/g, "").toLowerCase(); };
  // example.co.uk and example.com are different "organisational" domains; a short list of two-part public suffixes is enough for the hints below
  const TWO = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "co.in", "com.br", "com.lb", "com.tr", "co.za", "com.mx", "com.sa", "com.eg"]);
  const orgOf = d => { const p = String(d).split("."); if (p.length <= 2) return d; return TWO.has(p.slice(-2).join(".")) ? p.slice(-3).join(".") : p.slice(-2).join("."); };

  const IP4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/, IP6 = /\b((?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4})\b/i;
  const isPrivateIp = ip => /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || /^(::1|fe80|fc|fd)/i.test(ip);
  // "(version=TLS1_2, cipher=TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384)" as written by Exchange; "(version=TLS1_3)" as written by Postfix-like servers
  function tlsOf(t) { const v = /\bversion=([A-Za-z0-9_.]+)/.exec(t), c = /\bcipher=([A-Za-z0-9_-]+)/.exec(t); return v || c ? { version: v ? v[1].replace(/_/g, ".").replace(/^TLS1\./, "TLS 1.") : "", cipher: c ? c[1] : "" } : null; }
  function parseReceived(v) {
    const semi = v.lastIndexOf(";"), main = semi >= 0 ? v.slice(0, semi) : v, date = semi >= 0 ? v.slice(semi + 1) : "";
    const word = (re) => { const m = re.exec(main); return m ? m[1] : ""; };
    const fromFull = (/\bfrom\s+(.+?)(?=\s+(?:by|for|with|id|via)\b|$)/i.exec(main) || [])[1] || "";
    const byFull = (/\bby\s+(.+?)(?=\s+(?:for|with|id|via|from)\b|$)/i.exec(main) || [])[1] || "";
    // the address the receiving server SAW is the one in the (...) after the name the sender announced; the [...] before it is only what the sender claimed
    const ips = []; const addIps = t => { const bracket = /\[([^\]]+)\]/g; let m; while ((m = bracket.exec(t))) { const ip = m[1].replace(/^IPv6:/i, ""); if ((IP4.test(ip) || IP6.test(ip)) && !ips.includes(ip)) ips.push(ip); } };
    const paren = /\(([^)]*)\)/.exec(fromFull); if (paren) addIps(paren[1]);
    if (!ips.length && paren) { const bare = /^\s*((?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4})(?:%\w+)?\s*$/i.exec(paren[1]); if (bare) ips.push(bare[1]); }
    if (!ips.length) addIps(fromFull);
    if (!ips.length) { const x = IP4.exec(fromFull); if (x) ips.push(x[1]); }
    return { from: fromFull.replace(/\s+/g, " ").trim(), fromHost: (fromFull.split(/[\s(]/)[0] || "").trim(), by: byFull.replace(/\s+/g, " ").trim(), byHost: (byFull.split(/[\s(]/)[0] || "").trim(), with: ((/\bwith\s+(.+?)(?=\s*\(|\s+(?:id|for|via)\b|$)/i.exec(main) || [])[1] || "").trim(), tls: tlsOf(main), id: word(/\bid\s+(\S+)/i), ips, when: parseDate(date), raw: v };
  }

  // Authentication-Results: "mx.example.com; spf=pass smtp.mailfrom=a@b; dkim=pass header.d=b header.s=s1; dmarc=fail (p=none) header.from=b"
  function parseAuthResults(v) {
    const res = [], re = /\b(spf|dkim|dmarc|arc|compauth|dkim-atps|auth|iprev)\s*=\s*([a-z]+)([^;]*)/gi; let m;
    const server = (v.split(";")[0] || "").trim().replace(/\s+\d+$/, "");
    while ((m = re.exec(v))) {
      const prop = {}; const pr = /\b([a-z]+\.[a-z-]+)\s*=\s*("[^"]*"|[^\s;]+)/gi; let p;
      while ((p = pr.exec(m[3]))) prop[p[1].toLowerCase()] = p[2].replace(/^"|"$/g, "");
      res.push({ method: m[1].toLowerCase(), result: m[2].toLowerCase(), detail: m[3].trim().replace(/\s+/g, " "), prop, server });
    }
    return res;
  }
  const dur = ms => { const a = Math.abs(ms), s = Math.round(a / 1000); if (s < 1) return a < 1000 ? "under 1 second" : "1 second"; if (s < 120) return s + (s === 1 ? " second" : " seconds"); if (s < 7200) return Math.round(s / 60) + " minutes"; if (s < 172800) return (s / 3600).toFixed(1).replace(/\.0$/, "") + " hours"; return Math.round(s / 86400) + " days"; };
  const fmt = t => t == null ? "no time" : new Date(t).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");

  // X-Forefront-Antispam-Report: "CIP:1.2.3.4;SCL:1;SFV:NSPM;DIR:INT;..." -> { CIP: "1.2.3.4", SCL: "1", ... }
  function kvList(v) { const o = {}; for (const part of String(v || "").split(";")) { const i = part.indexOf(":"); if (i > 0) { const k = part.slice(0, i).trim().toUpperCase(); if (k && !(k in o)) o[k] = part.slice(i + 1).trim(); } } return o; }
  const SFV = { NSPM: "not spam", SPM: "spam", SKI: "filtering skipped (the sender is trusted)", SKN: "filtering skipped (marked not spam by a rule)", SKA: "filtering skipped (allowed by the user or a rule)", SKB: "blocked by the user or a rule", BLK: "blocked by the user or a rule", OFF: "spam filtering off" };
  const CAT = { NONE: "no threat found", SPM: "spam", HSPM: "high-confidence spam", PHSH: "phishing", HPHSH: "high-confidence phishing", MALW: "malware", BULK: "bulk mail", DIMP: "domain impersonation", UIMP: "user impersonation" };
  const DIR = { INT: "inside the organisation (internal)", INB: "inbound from outside", OUT: "outbound to outside" };
  const sclText = n => n < 0 ? "safe (filtering skipped)" : n <= 1 ? "not spam" : n <= 4 ? "probably not spam" : n <= 6 ? "spam" : "high-confidence spam";
  function microsoft(h) {
    const ff = kvList(get(h, "X-Forefront-Antispam-Report")), bcl = (/\bBCL:\s*(-?\d+)/.exec(get(h, "X-Microsoft-Antispam")) || [])[1];
    const scl = get(h, "X-MS-Exchange-Organization-SCL") !== "" ? get(h, "X-MS-Exchange-Organization-SCL") : ff.SCL;
    const rows = [], notes = [];
    if (scl != null && scl !== "" && /^-?\d+$/.test(scl)) rows.push(["Spam score (SCL)", scl + " = " + sclText(+scl)]);
    if (bcl != null) rows.push(["Bulk score (BCL)", bcl + (+bcl === 0 ? " = not bulk mail" : +bcl <= 3 ? " = rarely complained about" : +bcl <= 7 ? " = bulk mail, some complaints" : " = bulk mail, many complaints")]);
    if (ff.SFV) rows.push(["Filter verdict", ff.SFV + " = " + (SFV[ff.SFV] || "see Microsoft's list of SFV values")]);
    if (ff.CAT) rows.push(["Category", ff.CAT.split(",").map(c => c + " = " + (CAT[c] || "?")).join(", ")]);
    if (ff.DIR) rows.push(["Direction", ff.DIR + " = " + (DIR[ff.DIR] || "?")]);
    if (ff.CIP) rows.push(["Connecting IP seen by Microsoft", ff.CIP + (ff.CIP === "255.255.255.255" ? " (none: the message did not arrive over the internet)" : "")]);
    if (ff.IPV) rows.push(["IP filter verdict", ff.IPV + " = " + ({ NLI: "the connecting IP is on no allow or block list", CAL: "the connecting IP is on the organisation's allow list" }[ff.IPV] || "see Microsoft's list of IPV values")]);
    const mb = kvList(get(h, "X-Microsoft-Antispam-Mailbox-Delivery").replace(/\s+/g, "")).DEST;
    if (mb) rows.push(["Delivered to", mb + " = " + ({ I: "the Inbox", J: "the Junk Email folder", C: "a custom folder (a mailbox rule moved it)" }[mb] || "see Microsoft's list of dest values")]);
    if (ff.H) rows.push(["Sending host (HELO)", ff.H]);
    if (ff.LANG) rows.push(["Detected language", ff.LANG]);
    const dir = get(h, "X-MS-Exchange-Organization-MessageDirectionality"), as = get(h, "X-MS-Exchange-Organization-AuthAs");
    if (dir) rows.push(["Message direction", dir]);
    if (as) rows.push(["Authenticated as", as + (/^internal$/i.test(as) ? " (sent by a user inside the organisation)" : /^anonymous$/i.test(as) ? " (not logged in: it came from outside)" : "")]);
    const lat = /^(\d+):(\d+):(\d+)(?:\.(\d+))?$/.exec(get(h, "X-MS-Exchange-Transport-EndToEndLatency"));
    if (lat) rows.push(["Time inside Microsoft 365", ((+lat[1] * 3600 + +lat[2] * 60 + +lat[3]) + (lat[4] ? +("0." + lat[4]) : 0)).toFixed(1) + " seconds"]);
    const ten = get(h, "X-MS-Exchange-CrossTenant-Id"); if (ten) rows.push(["Microsoft 365 tenant ID", ten]);
    const arr = get(h, "X-MS-Exchange-CrossTenant-OriginalArrivalTime"); if (arr) rows.push(["Arrived in Microsoft 365", arr]);
    const lab = get(h, "msip_labels"); if (lab) rows.push(["Sensitivity label", lab]);
    if (/^(yes|true)$/i.test(get(h, "X-MS-Has-Attach"))) rows.push(["Has attachment", "yes (Microsoft's flag)"]);
    if (rows.length && scl != null && /^\d+$/.test(scl) && +scl >= 5) notes.push({ level: "bad", text: "Microsoft's filter scored this message SCL " + scl + ": " + sclText(+scl) + "." });
    else if (ff.CAT && /^(PHSH|HPHSH|MALW|HSPM|SPM)$/.test(ff.CAT.split(",")[0])) notes.push({ level: "bad", text: "Microsoft's filter put this message in the category " + ff.CAT + " (" + (CAT[ff.CAT.split(",")[0]] || "") + ")." });
    else if (rows.length && /^INT$/i.test(ff.DIR || "") && /^internal$/i.test(as)) notes.push({ level: "info", text: "Microsoft 365 recorded this as an internal message: sent by a logged-in user of the same organisation, so SPF/DKIM were not needed for delivery." });
    return { rows, notes, forefront: ff };
  }

  function analyze(text) {
    const h = parseHeaders(text), notes = [];
    if (!h.length) return { error: "No email headers found. Paste the full 'message headers' or 'original message' text: lines like  From: ...  Received: ...  Subject: ..." };
    /* the route */
    const rec = all(h, "Received").map(parseReceived).reverse();      // oldest first
    rec.forEach((r, i) => {
      r.n = i + 1;
      const prev = rec[i - 1];
      r.delay = prev && prev.when != null && r.when != null ? r.when - prev.when : null;
    });
    const times = rec.map(r => r.when).filter(t => t != null);
    const first = times.length ? Math.min(...times) : null, lastT = times.length ? Math.max(...times) : null;
    const dateT = parseDate(get(h, "Date"));
    const total = rec.length > 1 && rec[0].when != null && rec[rec.length - 1].when != null ? rec[rec.length - 1].when - rec[0].when : null;
    let slow = null;
    for (const r of rec) { if (r.delay != null && r.delay > 5 * 60000 && (!slow || r.delay > slow.delay)) slow = r; if (r.delay != null && r.delay < -2000) r.skew = true; }
    if (slow) notes.push({ level: slow.delay > 3600000 ? "bad" : "warn", text: "The biggest wait was " + dur(slow.delay) + " before hop " + slow.n + " (" + (slow.byHost || "unknown server") + "). The delay happened on the way to, or inside, that server." });
    if (rec.some(r => r.skew)) notes.push({ level: "warn", text: "Some hops show a time EARLIER than the hop before. That is a clock that is wrong on one of the servers, not mail travelling backwards; delays around it cannot be trusted." });
    if (total != null && total < 0) notes.push({ level: "warn", text: "The first hop is later than the last one, so the clocks involved disagree." });
    if (dateT != null && first != null && Math.abs(first - dateT) > 10 * 60000) notes.push({ level: "warn", text: "The Date header (" + fmt(dateT) + ") differs from the first server's time (" + fmt(first) + ") by " + dur(first - dateT) + ". The sender's clock or time zone may be wrong." });
    if (!rec.length) notes.push({ level: "warn", text: "There are no Received headers, so the route cannot be shown. Some providers strip them; copy the 'show original' view instead." });
    if (rec.length > 12) notes.push({ level: "warn", text: "More than 12 hops: a long chain, or a mail loop through forwarders." });

    /* authentication */
    const auth = [];
    for (const v of all(h, "Authentication-Results")) auth.push(...parseAuthResults(v));
    const rspf = get(h, "Received-SPF"); if (rspf && !auth.some(a => a.method === "spf")) { const m = /^\s*(pass|fail|softfail|neutral|none|temperror|permerror)/i.exec(rspf); if (m) auth.push({ method: "spf", result: m[1].toLowerCase(), detail: rspf.slice(0, 160), prop: {}, server: "" }); }
    const dkimSigs = all(h, "DKIM-Signature").map(v => { const t = k => { const m = new RegExp("(?:^|[;\\s])" + k + "=([^;]*)", "i").exec(v); return m ? m[1].replace(/\s+/g, "") : ""; }; return { d: t("d").toLowerCase(), s: t("s"), a: t("a") }; });
    const verdict = (m) => { const r = auth.filter(a => a.method === m); if (!r.length) return "not reported"; return r.map(x => x.result).filter((v, i, a) => a.indexOf(v) === i).join(" / "); };
    const bad = a => ["fail", "permerror"].includes(a.result), warn = a => ["softfail", "temperror", "neutral", "none"].includes(a.result);
    for (const a of auth.filter(a => ["spf", "dkim", "dmarc"].includes(a.method))) {
      const what = a.method.toUpperCase();
      if (bad(a)) notes.push({ level: "bad", text: what + " FAILED" + (a.prop["smtp.mailfrom"] ? " for " + a.prop["smtp.mailfrom"] : a.prop["header.d"] ? " for " + a.prop["header.d"] : "") + (a.server ? " (checked by " + a.server + ")" : "") + ". " + (a.method === "spf" ? "The server that sent it is not allowed to send for that domain." : a.method === "dkim" ? "The signature is missing, wrong, or the message was changed on the way." : (/\bp=none\b/i.test(a.detail) ? "The message does not line up with the domain's DMARC policy. That policy is p=none (monitor only), so receivers normally still deliver it." : "The message does not line up with the domain's policy; it may be quarantined or rejected.")) });
      else if (warn(a) && a.result !== "none") notes.push({ level: "warn", text: what + " result: " + a.result + (a.server ? " (checked by " + a.server + ")" : "") + "." });
    }
    if (!auth.length) notes.push({ level: "warn", text: "No SPF/DKIM/DMARC results are in these headers. Either the receiving server did not record them, or this is not the final copy." });

    for (const m of ["dkim", "dmarc"]) { const a = auth.find(x => x.method === m); if (a && a.result === "none" && !auth.some(x => x.method === m && x.result !== "none")) notes.push({ level: "info", text: m === "dkim" ? "The message carries no DKIM signature." + (m === "dkim" && a.detail ? "" : "") : "No DMARC policy was applied" + (a.prop["header.from"] ? " for " + a.prop["header.from"] : "") + ": the domain has none published, or the check was not run." }); }
    const dmp = auth.find(a => a.method === "dmarc" && a.result === "pass" && /\bp=none\b/i.test(a.detail));
    if (dmp) notes.push({ level: "info", text: "DMARC passed, but " + (dmp.prop["header.from"] || "the sender's domain") + " publishes the policy p=none (monitor only): receivers are told not to block mail that fails the check, so forged mail from this domain would still be delivered. Once the reports look clean, p=quarantine or p=reject protects the domain." });
    const ct = get(h, "Content-Type"), tnef = /ms-tnef/i.test(ct) ? ((/name="?([^";]+)/i.exec(ct) || [])[1] || "winmail.dat") : "";
    if (tnef) notes.push({ level: "info", text: "The message body is in Microsoft's TNEF format (" + tnef + "): Outlook packed text, formatting and attachments into one file. Mail programs other than Outlook show it as a single unreadable attachment; the sender can fix it by sending as HTML or Plain Text." });
    const ms = microsoft(h); notes.push(...ms.notes);
    const tlsHops = rec.filter(r => r.tls); const oldTls = tlsHops.filter(r => /^TLS 1\.[01]$|^SSL/i.test(r.tls.version));
    if (oldTls.length) notes.push({ level: "warn", text: "Hop " + oldTls.map(r => r.n).join(", ") + " used an old encryption version (" + oldTls[0].tls.version + ")." });

    /* who it claims to be from */
    const fromRaw = get(h, "From"), from = addrOf(fromRaw), fromD = domainOf(from);
    const rp = addrOf(get(h, "Return-Path")), rpD = domainOf(rp), rtRaw = get(h, "Reply-To"), rt = addrOf(rtRaw), rtD = domainOf(rt);
    const mid = (/<[^@<>]*@([^<>]+)>/.exec(get(h, "Message-ID")) || [])[1] || "";
    if (from && rt && orgOf(rtD) !== orgOf(fromD)) notes.push({ level: "warn", text: "Replies go to a different domain (" + rtD + ") than the one it is from (" + fromD + "). Common in scams; also normal for mailing lists and ticket systems." });
    if (from && rp && rpD && orgOf(rpD) !== orgOf(fromD) && !/^(bounce|mail|email|em|e|mg|send|smtp)/.test(rpD)) { /* bounce domains of senders differ legitimately; shown in the table, only hinted via DMARC */ }
    const disp = /^"?([^"<]*?)"?\s*</.exec(fromRaw);
    if (disp && /@/.test(disp[1]) && addrOf(disp[1]) && domainOf(addrOf(disp[1])) !== fromD) notes.push({ level: "bad", text: "The display name contains a different e-mail address (" + addrOf(disp[1]) + ") than the real sender (" + from + "). Mail programs often show only the name: this is a classic spoofing trick." });
    const dm = auth.find(a => a.method === "dmarc"), dk = auth.filter(a => a.method === "dkim" && a.result === "pass");
    if (from && dkimSigs.length && !dkimSigs.some(s => s.d && orgOf(s.d) === orgOf(fromD)) && !(dm && dm.result === "pass")) notes.push({ level: "warn", text: "The message is DKIM-signed by " + dkimSigs.map(s => s.d).join(", ") + ", not by the sender's own domain (" + fromD + "). Fine for bulk-mail services; otherwise a sign of a forged sender." });
    if (!get(h, "Message-ID")) notes.push({ level: "warn", text: "There is no Message-ID. Real mail servers always add one; scripts often do not." });
    else if (from && mid && orgOf(mid.toLowerCase()) !== orgOf(fromD) && !dkimSigs.some(s => s.d && orgOf(s.d) === orgOf(mid.toLowerCase()))) { /* informational only; shown in the table */ }
    const xo = get(h, "X-Originating-IP");
    const firstIp = rec.length && rec[0].ips.length ? rec[0].ips[0] : "";
    const spam = [["X-Spam-Status", get(h, "X-Spam-Status")], ["X-Spam-Flag", get(h, "X-Spam-Flag")], ["X-Spam-Score", get(h, "X-Spam-Score")], ["X-Spam-Level", get(h, "X-Spam-Level")], ].filter(r => r[1]).concat(ms.rows);

    const keyRows = [
      ["From", fromRaw], ["To", get(h, "To")], ["Subject", get(h, "Subject")], ["Date", get(h, "Date") + (dateT != null ? "" : "")],
      ["Return-Path (bounce address)", get(h, "Return-Path")], ["Reply-To", rtRaw], ["Sender", get(h, "Sender")], ["Message-ID", get(h, "Message-ID")],
      ["Sent with", get(h, "X-Mailer") || get(h, "User-Agent")], ["Original sender IP", xo], ["List-Unsubscribe", get(h, "List-Unsubscribe")],
      ["Thread topic", get(h, "Thread-Topic")], ["Language", [get(h, "Accept-Language") && "accepts " + get(h, "Accept-Language"), get(h, "Content-Language") && "content " + get(h, "Content-Language")].filter(Boolean).join("; ")],
      ["Content type", ct.replace(/;\s*boundary=.*$/i, "")], ["Cc", get(h, "Cc")], ["Delivered-To (final mailbox)", get(h, "Delivered-To")], ["In reply to", get(h, "In-Reply-To")], ["Importance", get(h, "Importance") || get(h, "X-Priority")],
    ].filter(r => r[1]);

    const parts = [];
    parts.push(rec.length ? rec.length + (rec.length === 1 ? " hop" : " hops") + (total != null && rec.length > 1 ? ", " + (total < 0 ? "clock mismatch" : "delivered in " + dur(total)) : "") : "no route information");
    const sv = verdict("spf"), kv = verdict("dkim"), dv = verdict("dmarc");
    parts.push("SPF " + sv + ", DKIM " + kv + ", DMARC " + dv);
    return { headers: h, hops: rec, total, auth, dkimSigs, keyRows, spam, notes, tnef, tls: tlsHops.map(r => ({ n: r.n, ...r.tls })), summary: parts.join(". "), firstIp, from, fromD, firstTime: first, lastTime: lastT };
  }

  const api = { kvList, parseHeaders, parseReceived, parseAuthResults, parseDate, analyze, dur, fmt, orgOf, isPrivateIp };
  if (typeof window !== "undefined") window.MailHdr = api;
  if (typeof module !== "undefined") module.exports = api;
})();
