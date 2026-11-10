/* Ping & Traceroute Reader: reads pasted output of ping, tracert/traceroute, mtr/WinMTR and pathping and explains where delay or loss really starts.
   Pure; exports window.PathRead. Nothing is sent anywhere: it only looks at the text it is given. */
(() => {
  "use strict";
  const num = s => parseFloat(String(s).replace(",", "."));
  const median = a => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  const r1 = x => Number.isFinite(x) ? Math.round(x * 10) / 10 : NaN;
  const ms = x => Number.isFinite(x) ? r1(x) + " ms" : "-";
  const pct = x => Number.isFinite(x) ? (Math.round(x * 10) / 10) + "%" : "-";
  const IP4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;
  const isPriv4 = ip => /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  const isCgnat = ip => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
  const kindOfIp = ip => !ip ? "" : isCgnat(ip) ? "carrier" : (isPriv4(ip) || /^(fe80|fc|fd)/i.test(ip)) ? "private" : "public";
  const KIND = { private: "private address (your own network or an ISP's inside)", carrier: "carrier-grade NAT address (your ISP's inside)", public: "public internet" };

  /* ================= ping ================= */
  function parsePing(text) {
    const ev = [], lines = String(text).replace(/\r/g, "").split("\n");
    let sent = null, recv = null, target = "", targetIp = "", err = "";
    let lastSeq = null;
    for (const raw of lines) {
      const l = raw.trim(); if (!l) continue;
      let m;
      if ((m = /^(?:PING|Pinging)\s+(\S+)\s*(?:\(([^)]+)\)|\[([^\]]+)\])?/.exec(l)) && !target) { target = m[1]; targetIp = m[2] || m[3] || ""; if (!targetIp && IP4.test(m[1])) targetIp = m[1]; continue; }
      if ((m = /Reply from ([^\s:]+): bytes=\d+ time([=<])(\d+(?:[.,]\d+)?)\s*ms(?: TTL=(\d+))?/i.exec(l))) { ev.push({ t: "ok", rtt: m[2] === "<" ? Math.max(0.5, num(m[3]) / 2) : num(m[3]), ttl: m[4] ? +m[4] : null, from: m[1] }); continue; }
      if ((m = /(\d+) bytes from ([^\s:]+(?: \([^)]*\))?)[: ].*?(?:icmp_seq[= ](\d+))?.*?(?:ttl[= ](\d+))?.*?time[=<]?\s*(\d+(?:[.,]\d+)?)\s*ms/i.exec(l)) && !/^From /i.test(l)) {
        const seq = /icmp_seq[= ](\d+)/i.exec(l), ttl = /ttl[= ](\d+)/i.exec(l);
        ev.push({ t: "ok", rtt: num(m[5]), ttl: ttl ? +ttl[1] : null, from: m[2], seq: seq ? +seq[1] : null }); continue;
      }
      if (/Request timed out|Request timeout for icmp_seq|no answer yet for icmp_seq/i.test(l)) { ev.push({ t: "lost", why: "timeout", seq: ((/icmp_seq[ =](\d+)/i.exec(l)) || [])[1] ? +(/icmp_seq[ =](\d+)/i.exec(l))[1] : null }); continue; }
      if ((m = /^(?:Reply from|From) ([^\s:]+):?\s*(?:icmp_seq[= ](\d+)\s*)?(Destination (?:host|net|port|protocol|network) unreachable|TTL expired in transit|Time to live exceeded|Destination Net Unreachable|Destination Host Unreachable)/i.exec(l))) {
        ev.push({ t: "err", from: m[1], what: /TTL|Time to live/i.test(m[3]) ? "ttl" : /net/i.test(m[3]) ? "net" : "host", seq: m[2] ? +m[2] : null }); continue;
      }
      if (/General failure|transmit failed|Network is unreachable|Operation not permitted|sendmsg/i.test(l)) { err = err || l; ev.push({ t: "lost", why: "failure" }); continue; }
      if (/could not find host|unknown host|Name or service not known|Temporary failure in name resolution|cannot resolve/i.test(l)) { err = l; continue; }
      if ((m = /Packets: Sent = (\d+), Received = (\d+)/i.exec(l))) { sent = +m[1]; recv = +m[2]; continue; }
      if ((m = /(\d+) packets transmitted, (\d+) (?:packets )?received/i.exec(l))) { sent = +m[1]; recv = +m[2]; continue; }
    }
    // missing icmp_seq numbers between answers are lost packets (Linux/macOS print nothing for them)
    const seqs = ev.filter(e => e.seq != null && e.t === "ok").map(e => e.seq);
    let gaps = 0;
    if (seqs.length > 1) { const lo = Math.min(...seqs), hi = Math.max(...seqs); const have = new Set(ev.filter(e => e.seq != null).map(e => e.seq)); for (let s = lo; s <= hi; s++) if (!have.has(s)) gaps++; }
    return { ev, sent, recv, target, targetIp, err, gaps };
  }
  const initialTtl = t => [32, 64, 128, 255].find(x => x >= t) || 255;

  function analyzePing(text) {
    const p = parsePing(text), notes = [], sections = [];
    const oks = p.ev.filter(e => e.t === "ok"), rtts = oks.map(e => e.rtt), errs = p.ev.filter(e => e.t === "err"), lostEv = p.ev.filter(e => e.t === "lost");
    if (p.err && !oks.length) {
      const dns = /host|resolution|resolve|Name or service/i.test(p.err);
      return { kind: "ping", title: "Ping", summary: dns ? "The name could not be found (a DNS problem, not a network one)." : "ping could not send anything.", notes: [{ level: "bad", text: dns ? "ping never started because the name did not turn into an address. Check the spelling and the DNS server, or ping the IP address directly to tell DNS from network problems." : "ping failed before sending: \"" + p.err.slice(0, 120) + "\". Usually no route or no network connection on this computer." }], sections: [], hops: [] };
    }
    let total = oks.length + errs.length + lostEv.length + p.gaps;
    let received = oks.length, lost = total - received;
    if (p.sent != null && p.recv != null && p.sent >= total - 1) { total = p.sent; received = Math.max(0, p.recv - errs.length); lost = Math.max(0, p.sent - received); }   // Windows counts an 'unreachable' reply as received
    if (!total) return { error: "No ping replies found. Paste the output of ping (Windows or Linux/macOS), including the lines that start with 'Reply from' or '64 bytes from'." };
    const lossPct = total ? 100 * lost / total : 0;
    const med = median(rtts), mean = avg(rtts), mn = rtts.length ? Math.min(...rtts) : NaN, mx = rtts.length ? Math.max(...rtts) : NaN;
    let jit = NaN; if (rtts.length > 1) { let s = 0; for (let i = 1; i < rtts.length; i++) s += Math.abs(rtts[i] - rtts[i - 1]); jit = s / (rtts.length - 1); }
    const rows = [["Packets", total + " sent, " + received + " answered"], ["Loss", pct(lossPct) + " (" + lost + " of " + total + ")"]];
    if (rtts.length) rows.push(["Delay", "best " + ms(mn) + ", typical " + ms(med) + ", average " + ms(mean) + ", worst " + ms(mx)], ["Jitter", ms(jit) + " (average change from one packet to the next)"]);
    const ttls = oks.map(e => e.ttl).filter(x => x != null);
    if (ttls.length) { const t = median(ttls), it = initialTtl(t), os = it === 64 ? "Linux, macOS, Android or a router" : it === 128 ? "Windows" : it === 255 ? "network equipment or Solaris/BSD" : "an older system"; rows.push(["TTL", t + " (started at " + it + ", so about " + (it - t) + " hops away; typical of " + os + ")"]); }
    sections.push({ title: "Numbers", rows });
    /* verdict */
    let summary, level;
    if (received === 0) { summary = "Nothing answered: 100% of the packets were lost."; level = "bad"; }
    else if (lossPct >= 10) { summary = pct(lossPct) + " of the packets were lost: a bad connection."; level = "bad"; }
    else if (lossPct > 0) { summary = pct(lossPct) + " packet loss" + (rtts.length ? ", typical delay " + ms(med) : "") + "."; level = lossPct >= 2 ? "warn" : ""; }
    else { summary = "No loss, typical delay " + ms(med) + "."; level = "good"; }
    /* findings */
    if (received === 0) {
      const hostErr = errs.find(e => e.what === "host" || e.what === "net");
      if (hostErr) notes.push({ level: "bad", text: "Not the target but " + hostErr.from + " answered, saying the destination is unreachable. That router (or your own computer, if it is the first hop) has no way to reach the target: check the cable, Wi-Fi, gateway or routing at that address." });
      else notes.push({ level: "bad", text: "No answer at all. Possible causes: the target is off or blocks ping (many servers do), a firewall drops ICMP, or there is no connection. Test another target (for example your router) to see where it stops." });
    }
    for (const e of errs.filter((x, i, a) => a.findIndex(y => y.from === x.from && y.what === x.what) === i)) {
      if (e.what === "ttl") notes.push({ level: "warn", text: e.from + " reported 'TTL expired in transit': the packet looped or the path is longer than the packet's hop limit." });
      else if (received > 0) notes.push({ level: "warn", text: e.from + " reported the destination unreachable for some packets (" + kindOfIp(e.from) + "): it could not forward them at that moment." });
    }
    if (rtts.length >= 4) {
      const first = rtts[0], rest = rtts.slice(1), rm = median(rest);
      if (first > 3 * rm && first - rm > 20) notes.push({ level: "", text: "Only the first reply was slow (" + ms(first) + " against " + ms(rm) + "). That is normal: the first packet waits for address lookup and route set-up. Ignore it." });
      const spikes = rest.filter(x => x > Math.max(3 * rm, rm + 30)).length;
      if (spikes) notes.push({ level: spikes / rest.length > 0.1 ? "warn" : "", text: spikes + " of " + rest.length + " replies were much slower than usual (more than 3 times the typical " + ms(rm) + "). Short spikes like this point to a busy Wi-Fi link, a loaded router or a congested path." });
      if (jit > 10 && jit > 0.4 * med) notes.push({ level: "warn", text: "The delay jumps around (jitter " + ms(jit) + "). Calls and games suffer from that even when nothing is lost." });
      const half = rtts.length >> 1, a1 = avg(rtts.slice(0, half)), a2 = avg(rtts.slice(half));
      if (rtts.length >= 8 && a2 > 1.8 * a1 && a2 - a1 > 20) notes.push({ level: "warn", text: "The delay grew during the test (" + ms(a1) + " at first, " + ms(a2) + " later). A link filling up (somebody downloading or uploading) causes this." });
    }
    const seq = p.ev.map(e => e.t === "ok" ? 1 : 0); let run = 0, maxRun = 0;
    for (const v of seq) { run = v ? 0 : run + 1; maxRun = Math.max(maxRun, run); }
    if (received > 0 && maxRun >= 3) notes.push({ level: "bad", text: "At least " + maxRun + " packets in a row were lost: the connection dropped out for a moment (an outage, not a steady loss)." });
    else if (received > 0 && lost > 0 && lossPct < 10) notes.push({ level: "", text: "Scattered single losses are common on Wi-Fi and mobile links, and some routers drop ping on purpose. A few percent matters for calls and games, less for browsing." });
    if (received && rtts.length) {
      const m2 = med;
      notes.push({ level: "", text: m2 < 2 ? "A delay under 2 ms: the target is on your own network or very close." : m2 < 20 ? "A delay of " + ms(m2) + ": a nearby server (same city or region)." : m2 < 80 ? "A delay of " + ms(m2) + ": the same country or neighbouring ones." : m2 < 180 ? "A delay of " + ms(m2) + ": another continent or a slow link. Fine for browsing, noticeable in calls and games." : "A delay of " + ms(m2) + " is high. Beyond the speed of light, that means a slow link (satellite, mobile) or a congested path." });
    }
    return { kind: "ping", title: "Ping" + (p.target ? " to " + p.target : ""), summary, level, notes, sections, hops: [], stats: { total, received, lost, lossPct, min: mn, median: med, mean, max: mx, jitter: jit } };
  }

  /* ================= traceroute / tracert ================= */
  // one hop line: "<n>  <anything>" -> { n, ip, name, rtts, stars, flags }
  function parseHopLine(l) {
    const m = /^\s*(\d{1,3})\s+(.*)$/.exec(l);
    if (!m) return null;
    let rest = m[2];
    const hop = { n: +m[1], ip: "", name: "", rtts: [], stars: 0, flags: [], ips: [] };
    // Windows: "Request timed out." / "Destination host unreachable."
    if (/Request timed out/i.test(rest)) { hop.stars = (rest.match(/\*/g) || []).length || 3; return hop; }
    for (const f of rest.matchAll(/ !([A-Z]|\d+)\b/g)) hop.flags.push(f[1]);
    rest = rest.replace(/ !([A-Z]|\d+)\b/g, " ");
    // hosts: "name [ip]" (Windows), "name (ip)" (Unix), or a bare address
    const hostRe = /([A-Za-z0-9._-]+(?:\.[A-Za-z0-9_-]+)*)\s*[\[(]([0-9a-fA-F:.]+)[\])]/g;
    let hm; const named = [];
    while ((hm = hostRe.exec(rest))) { named.push([hm[1], hm[2]]); }
    rest = rest.replace(hostRe, " ");
    for (const [n, ip] of named) { if (!hop.ips.includes(ip)) hop.ips.push(ip); if (!hop.ip) { hop.ip = ip; hop.name = n; } }
    for (const r of rest.matchAll(/(<)?\s*(\d+(?:[.,]\d+)?)\s*ms/gi)) hop.rtts.push(r[1] ? Math.max(0.5, num(r[2]) / 2) : num(r[2]));
    hop.stars = (rest.match(/\*/g) || []).length;
    rest = rest.replace(/(<)?\s*\d+(?:[.,]\d+)?\s*ms/gi, " ").replace(/\*/g, " ");
    for (const t of rest.matchAll(/\b(\d{1,3}(?:\.\d{1,3}){3})\b|\b((?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4})\b/g)) { const ip = t[1] || t[2]; if (!hop.ips.includes(ip)) hop.ips.push(ip); if (!hop.ip) hop.ip = ip; }
    if (!hop.ip && /unreachable/i.test(rest)) hop.flags.push("H");
    return hop;
  }
  const hopStats = h => { const probes = h.rtts.length + h.stars; h.sent = probes; h.loss = probes ? 100 * h.stars / probes : 0; h.best = h.rtts.length ? Math.min(...h.rtts) : NaN; h.avg = avg(h.rtts); h.wrst = h.rtts.length ? Math.max(...h.rtts) : NaN; h.silent = h.rtts.length === 0 && h.ips.length === 0; return h; };

  function parseTrace(text) {
    const lines = String(text).replace(/\r/g, "").split("\n"), hops = [];
    let target = "", targetIp = "", complete = false, header = "";
    for (const l of lines) {
      let m;
      if ((m = /(?:Tracing route to|traceroute6? to|traceroute to)\s+(\S+)\s*(?:\[([^\]]+)\]|\(([^)]+)\))?/i.exec(l))) { target = m[1]; targetIp = m[2] || m[3] || (IP4.test(m[1]) ? m[1] : ""); header = l.trim(); continue; }
      if (/Trace complete/i.test(l)) { complete = true; continue; }
      const h = parseHopLine(l);
      if (h && (h.rtts.length || h.stars || h.ip || h.flags.length)) {
        const prev = hops[hops.length - 1];
        if (prev && prev.n === h.n) { /* a continuation line: more hosts for the same hop */ prev.rtts.push(...h.rtts); prev.stars += h.stars; for (const ip of h.ips) if (!prev.ips.includes(ip)) prev.ips.push(ip); continue; }
        hops.push(h);
      } else if (hops.length && /^\s+(?:\S+\s*[\[(][0-9a-f:.]+[\])]|\d+(?:\.\d+){3})\s+[\d<]/.test(l)) {   // Linux: extra hosts on a following, unnumbered line
        const prev = hops[hops.length - 1], x = parseHopLine("0 " + l.trim());
        if (x) { prev.rtts.push(...x.rtts); prev.stars += x.stars; for (const ip of x.ips) if (!prev.ips.includes(ip)) prev.ips.push(ip); }
      }
    }
    hops.forEach(hopStats);
    return { hops, target, targetIp, complete, header };
  }

  const hopLabel = h => h.silent ? "(no answer)" : (h.name && h.name !== h.ip ? h.name + " [" + h.ip + "]" : h.ip || "?");
  const FLAGS = { H: "the router says the HOST is unreachable", N: "the router says the NETWORK is unreachable", P: "the router says the PROTOCOL is unreachable", F: "the packet needed fragmenting but was not allowed to", S: "source route failed", X: "the router says communication is ADMINISTRATIVELY PROHIBITED (a firewall rule)", A: "communication is administratively prohibited (a firewall rule)", "13": "administratively prohibited (a firewall rule)", "1": "host unreachable", "0": "network unreachable", "3": "port unreachable (the target answered: it was reached)" };

  // shared checks for hop lists from traceroute-like tools. level info: use best RTT, which ignores queueing at the router itself.
  function pathFindings(hops, ctx) {
    const notes = [], live = hops.filter(h => !h.silent && Number.isFinite(h.best));
    ctx = ctx || {};
    /* routing loop: the same address appears at hops that are not neighbours */
    const seen = new Map();
    for (const h of hops) { if (!h.ip) continue; if (seen.has(h.ip) && h.n - seen.get(h.ip) > 1) { notes.push({ level: "bad", text: "The address " + h.ip + " appears at hop " + seen.get(h.ip) + " and again at hop " + h.n + ": a routing loop. Packets circle until they expire. Report it to whoever runs that router." }); break; } if (!seen.has(h.ip)) seen.set(h.ip, h.n); }
    /* administratively prohibited / unreachable flags */
    for (const h of hops) for (const f of h.flags) if (FLAGS[f]) { notes.push({ level: f === "3" ? "" : "bad", text: "Hop " + h.n + " (" + hopLabel(h) + "): " + FLAGS[f] + "." }); }
    /* silent hops in the middle */
    const lastLive = hops.reduce((a, h) => h.silent ? a : h.n, 0);
    const midSilent = hops.filter(h => h.silent && h.n < lastLive);
    if (midSilent.length) notes.push({ level: "", text: "Hop" + (midSilent.length > 1 ? "s " : " ") + midSilent.map(h => h.n).join(", ") + (midSilent.length > 1 ? " do" : " does") + " not answer, but the path continues beyond. That is normal: routers often ignore or rate-limit these probes. It is not a fault." });
    /* the end of the trace */
    const tail = hops.slice(lastLive);
    const reached = ctx.reached;
    if (reached === true) notes.unshift({ level: "good", text: "The target was reached after " + (ctx.reachedAt || lastLive) + " hops." });
    else if (reached === false && tail.length >= 3) notes.unshift({ level: "warn", text: "The trace ends in " + tail.length + " silent hops after hop " + lastLive + " (" + hopLabel(hops[lastLive - 1] || { silent: true }) + ") and never reaches the target. Either a firewall there blocks the probes (the target may still be fine: try opening it), or the path is broken after that point." });
    else if (reached === false) notes.unshift({ level: "warn", text: "The target was not reached in this trace (the last answering hop is " + lastLive + "). The trace may have been stopped early, or the target does not answer probes." });
    /* delay jumps, judged by the BEST time so one slow answer is not mistaken for a slow link */
    let big = null;
    for (let i = 1; i < live.length; i++) { const d = live[i].best - live[i - 1].best; if (d > 25 && d > 0.5 * live[i - 1].best && (!big || d > big.d)) big = { d, a: live[i - 1], b: live[i], i }; }
    if (big) {
      const after = live.slice(big.i), persists = after.every(h => h.best >= big.a.best + 0.7 * big.d);
      notes.push(persists
        ? { level: "warn", text: "The delay jumps by " + ms(big.d) + " between hop " + big.a.n + " and hop " + big.b.n + " (" + hopLabel(big.b) + ") and stays high afterwards. That is a long or slow link there: a sea cable between countries, a satellite or radio hop, or a congested link. Names of the routers often show the place." }
        : { level: "", text: "Hop " + big.b.n + " (" + hopLabel(big.b) + ") looks " + ms(big.d) + " slower than the one before, but the hops after it are fast again. That router is just slow to answer probes aimed at itself; it is not slowing your traffic." });
    }
    /* where the private part ends */
    const firstPub = hops.find(h => kindOfIp(h.ip) === "public");
    const priv = hops.filter(h => h.n < (firstPub ? firstPub.n : 999) && kindOfIp(h.ip) && kindOfIp(h.ip) !== "public");
    if (priv.length) {
      const first = priv[0];
      notes.push({ level: "", text: "Hop " + first.n + " (" + first.ip + ") is " + (first.n === 1 ? "your own router or gateway" : "inside a private network") + (priv.some(h => kindOfIp(h.ip) === "carrier") ? ". Addresses from 100.64.x.x are your ISP's carrier-grade NAT: your connection shares a public address with other customers (inbound connections and port forwarding will not work)." : ".") + (firstPub ? " The public internet starts at hop " + firstPub.n + "." : "") });
    }
    if (live.length && live[0].n === 1 && live[0].best > 10 && kindOfIp(live[0].ip) === "private") notes.push({ level: "warn", text: "Even your first hop (" + live[0].ip + ") takes " + ms(live[0].best) + ". The problem is between this computer and its router: weak Wi-Fi, interference or a busy network. Try a cable." });
    return notes;
  }

  function analyzeTrace(text) {
    const t = parseTrace(text);
    if (!t.hops.length) return { error: "No hops found. Paste the whole output of tracert (Windows) or traceroute (Linux/macOS)." };
    const hops = t.hops, lastAns = hops.filter(h => !h.silent).pop(), tIp = t.targetIp;
    const reached = tIp ? (lastAns && lastAns.ips.includes(tIp) ? true : (t.complete ? undefined : false)) : (t.complete ? true : undefined);
    const reachedAt = reached ? (hops.find(h => h.ips.includes(tIp)) || lastAns || {}).n : undefined;
    const notes = pathFindings(hops, { reached: reached === undefined ? (t.complete ? true : undefined) : reached, reachedAt });
    const fin = lastAns;
    const lossy = hops.filter(h => !h.silent && h.loss > 0 && h.sent >= 3);
    const rows = hops.map(h => [String(h.n), hopLabel(h), kindOfIp(h.ip) === "public" ? "public" : kindOfIp(h.ip) === "carrier" ? "ISP (CGNAT)" : kindOfIp(h.ip) === "private" ? "private" : "", h.rtts.length ? ms(h.best) : "-", h.rtts.length ? ms(h.avg) : "-", h.silent ? "no answer" : pct(h.loss)]);
    const summary = (t.target ? "Route to " + t.target + ": " : "Route: ") + hops.length + " hops" + (reached ? ", target reached" : reached === false ? ", target NOT reached" : "") + (fin && Number.isFinite(fin.best) ? ", " + ms(fin.best) + " at the end" : "") + ".";
    return { kind: "trace", title: "Route" + (t.target ? " to " + t.target : ""), summary, level: reached === false ? "warn" : "", notes, sections: [], table: { heads: ["Hop", "Router", "Where", "Best", "Average", "Lost"], rows }, hops };
  }

  /* ================= mtr / WinMTR ================= */
  function parseMtr(text) {
    const hops = [], lines = String(text).replace(/\r/g, "").split("\n");
    let target = "";
    for (const l of lines) {
      let m;
      if ((m = /^\s*(?:Start:.*|HOST:\s*(\S+))/.exec(l)) && m[1]) { target = m[1]; continue; }
      // mtr -r:  " 3.|-- 203.0.113.1      0.0%   10    1.2   1.3   1.1   2.0   0.3"  (the host may be ???)
      if ((m = /^\s*(\d+)\.\s*\|--\s+(\S+(?: \S+)*?)\s+(\d+(?:\.\d+)?)%?\s+(\d+)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/.exec(l))) {
        hops.push({ n: +m[1], host: m[2], loss: +m[3], sent: +m[4], last: +m[5], avgv: +m[6], best: +m[7], wrst: +m[8], stdev: +m[9] }); continue;
      }
      // WinMTR text export:  "|  192.168.1.1 -    0 |   32 |   32 |    0 |    0 |    2 |    0 |"
      if ((m = /^\|\s*(\S+(?: \S+)*?)\s+-\s+(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|?\s*$/.exec(l))) {
        hops.push({ n: hops.length + 1, host: m[1], loss: +m[2], sent: +m[3], recv: +m[4], best: +m[5], avgv: +m[6], wrst: +m[7], last: +m[8], stdev: NaN }); continue;
      }
    }
    return { hops, target };
  }
  function analyzeMtr(text) {
    const t = parseMtr(text);
    if (!t.hops.length) return { error: "No hops found. Paste the report from  mtr -r  (or the text export of WinMTR)." };
    const hops = t.hops.map(h => { const ip = (IP4.exec(h.host) || [])[1] || ""; return { ...h, ip, name: h.host, avg: h.avgv, silent: h.host === "???" || (h.loss >= 100 && !Number.isFinite(h.avg)), rtts: [], stars: 0, ips: ip ? [ip] : [] }; });
    hops.forEach(h => { if (h.loss >= 100) h.silent = true; });
    const notes = [], endHop = hops[hops.length - 1], tooFew = hops.some(h => h.sent < 10);
    if (tooFew) notes.push({ level: "warn", text: "Only " + Math.min(...hops.map(h => h.sent)) + " packets per hop: too few to judge loss. Run at least 100 (mtr -rwc 100) and let it finish." });
    /* loss: real only if it carries on to the end */
    let culprit = null;
    for (let i = 0; i < hops.length; i++) {
      const h = hops[i]; if (h.loss < 2 || h.silent) continue;
      const later = hops.slice(i + 1).filter(x => !x.silent);
      const persists = later.length ? later.every(x => x.loss >= 0.5 * h.loss) : true;
      if (persists) { culprit = h; break; }
    }
    const endLoss = endHop.loss;
    if (culprit) notes.unshift({ level: endLoss >= 5 ? "bad" : "warn", text: "Real packet loss starts at hop " + culprit.n + " (" + culprit.host + ") and carries on to the end (" + pct(endLoss) + " at the target). The trouble is at that hop or on the link just before it." });
    else if (endLoss < 2) notes.unshift({ level: "good", text: "No loss at the target (" + pct(endLoss) + "). Any loss you see in the middle is routers rate-limiting their own answers and does not affect your traffic." });
    const rateLimited = hops.filter(h => h.loss >= 2 && !h.silent && h !== culprit && endLoss < Math.max(2, 0.5 * h.loss));
    if (rateLimited.length) notes.push({ level: "", text: "Loss at hop" + (rateLimited.length > 1 ? "s " : " ") + rateLimited.map(h => h.n).join(", ") + " does not continue to the end, so it is the router limiting replies to probes, not lost traffic. Ignore it." });
    const midDead = hops.filter(h => h.silent && h.n < hops.length && hops.slice(h.n).some(x => !x.silent));
    if (midDead.length) notes.push({ level: "", text: "Hop" + (midDead.length > 1 ? "s " : " ") + midDead.map(h => h.n).join(", ") + " show 100% loss but later hops answer: those routers simply do not reply to probes. Normal." });
    if (endHop.silent && hops.length > 1) notes.push({ level: "warn", text: "The last hop does not answer at all. The target may block these probes (try opening it), or the path breaks before it." });
    const live = hops.filter(h => !h.silent && Number.isFinite(h.best));
    let big = null; for (let i = 1; i < live.length; i++) { const d = live[i].best - live[i - 1].best; if (d > 25 && d > 0.5 * live[i - 1].best && (!big || d > big.d)) big = { d, a: live[i - 1], b: live[i], i }; }
    if (big) { const persists = live.slice(big.i).every(h => h.best >= big.a.best + 0.7 * big.d); notes.push(persists ? { level: "warn", text: "The delay jumps by " + ms(big.d) + " between hop " + big.a.n + " and hop " + big.b.n + " (" + big.b.host + ") and stays high: a long or slow link there (a sea cable or satellite between countries, or congestion)." } : { level: "", text: "Hop " + big.b.n + " answers " + ms(big.d) + " slower than the previous one, but later hops are fast again: that router is slow to answer probes, which does not slow your traffic." }); }
    if (!endHop.silent && Number.isFinite(endHop.avg) && endHop.wrst > 4 * endHop.avg && endHop.wrst - endHop.avg > 50) notes.push({ level: "warn", text: "At the target the worst answer (" + ms(endHop.wrst) + ") is far above the average (" + ms(endHop.avg) + "): spikes. Bursts of delay like that are felt in calls and games." });
    if (!endHop.silent && Number.isFinite(endHop.stdev) && endHop.stdev > 0.5 * endHop.avg && endHop.stdev > 10) notes.push({ level: "warn", text: "The delay at the target varies a lot (standard deviation " + ms(endHop.stdev) + "): an unsteady connection." });
    const priv = hops.filter(h => kindOfIp(h.ip) && kindOfIp(h.ip) !== "public"), first = hops[0];
    if (first && kindOfIp(first.ip) === "private" && Number.isFinite(first.avg) && first.avg > 10) notes.push({ level: "warn", text: "Your first hop (" + first.host + ") already averages " + ms(first.avg) + ": the problem is between this computer and its router (weak Wi-Fi, a busy network). Try a cable." });
    if (priv.some(h => kindOfIp(h.ip) === "carrier")) notes.push({ level: "", text: "Hops with 100.64.x.x addresses are your ISP's carrier-grade NAT: your connection shares a public address with other customers." });
    const rows = hops.map(h => [String(h.n), h.host, pct(h.loss), String(h.sent), h.silent ? "-" : ms(h.best), h.silent ? "-" : ms(h.avg), h.silent ? "-" : ms(h.wrst)]);
    const summary = (t.target ? "Route to " + t.target + ": " : "Route: ") + hops.length + " hops, " + (endHop.silent ? "the last hop does not answer" : pct(endLoss) + " loss and " + ms(endHop.avg) + " average at the end") + (culprit ? "; real loss starts at hop " + culprit.n : "") + ".";
    return { kind: "mtr", title: "mtr report" + (t.target ? " for " + t.target : ""), summary, level: culprit ? (endLoss >= 5 ? "bad" : "warn") : "good", notes, sections: [], table: { heads: ["Hop", "Router", "Loss", "Sent", "Best", "Average", "Worst"], rows }, hops };
  }

  /* ================= pathping ================= */
  function parsePathping(text) {
    const lines = String(text).replace(/\r/g, "").split("\n"), hops = [];
    let target = "", targetIp = "", inStats = false;
    const hopRows = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i], m = /Tracing route to\s+(\S+)\s*(?:\[([^\]]+)\])?/i.exec(l);
      if (m) { target = m[1]; targetIp = m[2] || (IP4.test(m[1]) ? m[1] : ""); continue; }
      if (/Source to Here/i.test(l)) { inStats = true; continue; }
      if (!inStats) continue;
      // hop row:  "  1    2ms     0/ 100 =  0%     0/ 100 =  0%  192.168.1.1"   or hop 0:  "  0                                           PC [192.168.1.5]"
      let h;
      if ((h = /^\s*(\d+)\s+(?:(<?\d+)ms\s+)?(?:(\d+)\/\s*(\d+)\s*=\s*(\d+)%\s+)?(?:(\d+)\/\s*(\d+)\s*=\s*(\d+)%\s+)?(.*?)\s*$/.exec(l)) && h[9] !== undefined && (h[3] !== undefined || +h[1] === 0)) {
        hopRows.push({ n: +h[1], rtt: h[2] ? Math.max(0.5, num(h[2].replace("<", "")) / (h[2][0] === "<" ? 2 : 1)) : NaN, srcLost: h[3] !== undefined ? +h[3] : NaN, srcSent: h[4] !== undefined ? +h[4] : NaN, srcPct: h[5] !== undefined ? +h[5] : NaN, nodeLost: h[6] !== undefined ? +h[6] : NaN, nodeSent: h[7] !== undefined ? +h[7] : NaN, nodePct: h[8] !== undefined ? +h[8] : NaN, host: h[9], linkPct: NaN });
        continue;
      }
      // link row between nodes:  "                                0/ 100 =  0%   |"
      const lk = /^\s*(\d+)\/\s*(\d+)\s*=\s*(\d+)%\s*\|\s*$/.exec(l);
      if (lk && hopRows.length) hopRows[hopRows.length - 1].linkPct = +lk[3];
    }
    for (const r of hopRows) {
      const ip = (/\[([^\]]+)\]/.exec(r.host) || IP4.exec(r.host) || [])[1] || "";
      hops.push({ n: r.n, flags: [], host: r.host, ip: /^[\d.]+$|:/.test(ip) ? ip : "", name: r.host, rtts: Number.isFinite(r.rtt) ? [r.rtt] : [], stars: 0, ips: ip ? [ip] : [], best: r.rtt, avg: r.rtt, wrst: r.rtt, srcPct: r.srcPct, srcLost: r.srcLost, srcSent: r.srcSent, nodePct: r.nodePct, linkPct: r.linkPct, silent: !Number.isFinite(r.rtt) && r.n !== 0 && !(r.srcSent > 0 && r.srcPct < 100) });
    }
    return { hops, target, targetIp };
  }
  function analyzePathping(text) {
    const t = parsePathping(text);
    if (t.hops.filter(h => h.n > 0).length === 0) return { error: "No statistics found. Paste the output of pathping including the table after 'Computing statistics for ... seconds'." };
    const hops = t.hops, last = hops[hops.length - 1], notes = [];
    const links = hops.filter(h => Number.isFinite(h.linkPct) && h.linkPct >= 2);
    for (const h of links) notes.push({ level: h.linkPct >= 5 ? "bad" : "warn", text: "Real loss of " + h.linkPct + "% on the link AFTER hop " + h.n + " (" + (h.host || "?") + "), between it and the next router. pathping's 'This Node/Link' loss on the | rows is traffic lost on the wire, the part that counts." });
    const nodes = hops.filter(h => h.n > 0 && Number.isFinite(h.nodePct) && h.nodePct >= 5 && !(Number.isFinite(h.linkPct) && h.linkPct >= 2));
    if (nodes.length) notes.push({ level: "", text: "Loss shown on the router lines (hop" + (nodes.length > 1 ? "s " : " ") + nodes.map(h => h.n).join(", ") + ") with a clean link row below is the router limiting its own replies; it does not hurt your traffic." });
    if (last && Number.isFinite(last.srcPct)) notes.unshift({ level: last.srcPct >= 5 ? "bad" : last.srcPct >= 1 ? "warn" : "good", text: "From your computer to the last hop " + last.srcPct + "% of probes were lost (" + last.srcLost + " of " + last.srcSent + ")." });
    const base = pathFindings(hops.filter(h => h.n > 0).map(h => ({ ...h, silent: h.silent })), { reached: undefined });
    for (const n of base) if (!/Even your first hop/.test(n.text) || true) notes.push(n);
    const rows = hops.filter(h => h.n > 0).map(h => [String(h.n), h.host || "", Number.isFinite(h.best) ? ms(h.best) : "-", Number.isFinite(h.srcPct) ? h.srcPct + "%" : "-", Number.isFinite(h.nodePct) ? h.nodePct + "%" : "-", Number.isFinite(h.linkPct) ? h.linkPct + "%" : "-"]);
    return { kind: "pathping", title: "pathping" + (t.target ? " to " + t.target : ""), summary: (t.target ? "Route to " + t.target + ": " : "Route: ") + hops.filter(h => h.n > 0).length + " hops" + (last && Number.isFinite(last.srcPct) ? ", " + last.srcPct + "% loss at the end" : "") + (links.length ? "; real link loss after hop " + links[0].n : "") + ".", level: links.length ? "warn" : "", notes, sections: [], table: { heads: ["Hop", "Router", "Delay", "Loss from you", "Router loss", "Link loss after"], rows }, hops };
  }

  /* ================= entry point ================= */
  function detect(text) {
    const s = String(text);
    if (/WinMTR statistics/i.test(s) || /^\s*HOST:\s/m.test(s) || /\d+\.\|--/.test(s)) return "mtr";
    if (/Source to Here/i.test(s) || /Computing statistics for/i.test(s)) return "pathping";
    if (/(?:Tracing route to|traceroute6? to)\s/i.test(s)) return "trace";
    if (/could not find host|unknown host|Name or service not known|Temporary failure in name resolution|sendmsg: |Network is unreachable/i.test(s)) return "ping";
    if (/\bbytes from\b|Reply from [^\n]*(?:bytes=|unreachable|TTL expired)|Request timed out|Request timeout for icmp|packets transmitted|Packets: Sent =|Pinging |^PING /im.test(s)) return /^\s*\d{1,3}\s+(?:<?\d+\s*ms|\*)/m.test(s) && !/bytes from|bytes=/.test(s) ? "trace" : "ping";
    if (/^\s*\d{1,3}\s+.*(?:\d\s*ms|\*)/m.test(s)) return "trace";
    return "";
  }
  function analyze(text) {
    const s = String(text == null ? "" : text);
    if (!s.trim()) return { error: "Paste the output of ping, tracert, traceroute, mtr or pathping." };
    const k = detect(s);
    if (k === "mtr") return analyzeMtr(s);
    if (k === "pathping") return analyzePathping(s);
    if (k === "trace") return analyzeTrace(s);
    if (k === "ping") return analyzePing(s);
    return { error: "I could not recognise this as ping, tracert, traceroute, mtr, WinMTR or pathping output. Paste the whole output, starting from the command's first line if you can." };
  }
  function toText(r, ctx) {
    const out = ["Ping & Traceroute Reader (Michel's Tools)", ctx && ctx.when ? "Read " + ctx.when : "", "", r.summary, ""];
    for (const n of r.notes) out.push("* " + n.text);
    for (const s of r.sections || []) { out.push("", s.title); for (const [k, v] of s.rows) out.push("  " + k + ": " + v); }
    if (r.table) { out.push("", r.table.heads.join(" | ")); for (const row of r.table.rows) out.push(row.join(" | ")); }
    return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
  }
  const api = { analyze, detect, parsePing, parseTrace, parseMtr, parsePathping, parseHopLine, toText, kindOfIp, median };
  if (typeof window !== "undefined") window.PathRead = api;
  if (typeof module !== "undefined") module.exports = api;
})();
