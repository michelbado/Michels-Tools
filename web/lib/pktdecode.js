/* Packet header decoder: reads the bytes of one packet (a hex dump from tcpdump -x, Wireshark, a C array or plain hex) and explains every header
   in plain words: Ethernet (with VLAN tags), PPPoE, MPLS, ARP, IPv4, IPv6 with extension headers, TCP (with options), UDP, ICMP, ICMPv6, GRE, ESP, AH,
   VXLAN, DHCP and DNS. Checks the checksums it can and says what looks wrong. Pure functions; nothing is sent anywhere. Exports window.PktDecode. */
(() => {
  "use strict";
  const h2 = n => (n < 16 ? "0" : "") + n.toString(16);
  const hex = (b, s, e, sep) => { const o = []; for (let i = s; i < e; i++) o.push(h2(b[i])); return o.join(sep == null ? " " : sep); };
  const u16 = (b, o) => b[o] * 256 + b[o + 1];
  const u32 = (b, o) => b[o] * 16777216 + b[o + 1] * 65536 + b[o + 2] * 256 + b[o + 3];
  const mac = (b, o) => hex(b, o, o + 6, ":");
  const ip4 = (b, o) => b[o] + "." + b[o + 1] + "." + b[o + 2] + "." + b[o + 3];
  function ip6(b, o) {
    const g = []; for (let i = 0; i < 8; i++) g.push(u16(b, o + 2 * i));
    let bs = -1, bl = 0;
    for (let i = 0; i < 8;) { if (g[i] !== 0) { i++; continue; } let j = i; while (j < 8 && g[j] === 0) j++; if (j - i > bl && j - i >= 2) { bs = i; bl = j - i; } i = j; }
    const t = g.map(x => x.toString(16));
    return bs < 0 ? t.join(":") : t.slice(0, bs).join(":") + "::" + t.slice(bs + bl).join(":");
  }
  const ETYPE = { 0x0800: "IPv4", 0x0806: "ARP", 0x8035: "RARP", 0x8100: "802.1Q VLAN tag", 0x88a8: "802.1ad (QinQ) VLAN tag", 0x86dd: "IPv6", 0x8847: "MPLS unicast", 0x8848: "MPLS multicast", 0x8863: "PPPoE discovery", 0x8864: "PPPoE session", 0x88cc: "LLDP", 0x8809: "Slow protocols (LACP)", 0x88e5: "MACsec" };
  const PROTO = { 0: "IPv6 hop-by-hop options", 1: "ICMP", 2: "IGMP", 4: "IP-in-IP", 6: "TCP", 17: "UDP", 41: "IPv6-in-IP", 43: "IPv6 routing header", 44: "IPv6 fragment header", 46: "RSVP", 47: "GRE", 50: "ESP", 51: "AH", 58: "ICMPv6", 59: "no next header", 60: "IPv6 destination options", 89: "OSPF", 103: "PIM", 112: "VRRP", 115: "L2TP", 132: "SCTP", 135: "IPv6 mobility header", 139: "HIP", 140: "Shim6" };
  const PORTS = { 20: "ftp-data", 21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns", 67: "dhcp server", 68: "dhcp client", 69: "tftp", 80: "http", 110: "pop3", 123: "ntp", 143: "imap", 161: "snmp", 162: "snmp trap", 179: "bgp", 389: "ldap", 443: "https", 465: "smtps", 500: "isakmp (IKE)", 514: "syslog", 546: "dhcpv6 client", 547: "dhcpv6 server", 587: "submission", 636: "ldaps", 993: "imaps", 995: "pop3s", 1812: "radius", 1813: "radius accounting", 3306: "mysql", 3389: "rdp", 4500: "ipsec nat-t", 4789: "vxlan", 5060: "sip", 5432: "postgresql", 8080: "http-alt" };
  const port = p => p + (PORTS[p] ? " (" + PORTS[p] + ")" : "");
  const ICMP4 = { 0: "Echo reply", 3: "Destination unreachable", 4: "Source quench", 5: "Redirect", 8: "Echo request", 9: "Router advertisement", 10: "Router solicitation", 11: "Time exceeded", 12: "Parameter problem", 13: "Timestamp request", 14: "Timestamp reply", 17: "Address mask request", 18: "Address mask reply" };
  const UNREACH4 = { 0: "network unreachable", 1: "host unreachable", 2: "protocol unreachable", 3: "port unreachable", 4: "fragmentation needed but DF set (path MTU)", 5: "source route failed", 6: "network unknown", 7: "host unknown", 9: "network administratively prohibited", 10: "host administratively prohibited", 13: "communication administratively prohibited" };
  const ICMP6 = { 1: "Destination unreachable", 2: "Packet too big", 3: "Time exceeded", 4: "Parameter problem", 128: "Echo request", 129: "Echo reply", 130: "Multicast listener query", 131: "Multicast listener report", 133: "Router solicitation", 134: "Router advertisement", 135: "Neighbor solicitation", 136: "Neighbor advertisement", 137: "Redirect", 143: "Multicast listener report v2" };
  const UNREACH6 = { 0: "no route to destination", 1: "administratively prohibited", 2: "beyond scope of source address", 3: "address unreachable", 4: "port unreachable", 5: "source address failed policy", 6: "reject route" };
  const PPPPROTO = { 0x0021: "IPv4", 0x0057: "IPv6", 0xc021: "LCP (link control)", 0xc023: "PAP (password authentication)", 0xc223: "CHAP (challenge authentication)", 0x8021: "IPCP (IPv4 configuration)", 0x8057: "IPv6CP (IPv6 configuration)", 0xc025: "LQR", 0x80fd: "CCP (compression)" };
  const PPPOE_CODE = { 0x09: "PADI (discovery initiation)", 0x07: "PADO (offer)", 0x19: "PADR (request)", 0x65: "PADS (session confirmation)", 0xa7: "PADT (terminate)", 0x00: "session data" };
  const DSCP = { 0: "CS0 / best effort", 8: "CS1", 10: "AF11", 12: "AF12", 14: "AF13", 16: "CS2", 18: "AF21", 20: "AF22", 22: "AF23", 24: "CS3", 26: "AF31", 28: "AF32", 30: "AF33", 32: "CS4", 34: "AF41", 36: "AF42", 38: "AF43", 40: "CS5", 46: "EF (voice)", 48: "CS6", 56: "CS7" };

  // ---- reading text into bytes ----
  // Accepts plain hex (spaces, colons, commas, 0x), C arrays, tcpdump -x / -xx / -X ("0x0000:  4500 003c ...  E..<"), and Wireshark / tshark hex dumps
  // ("0000  45 00 00 3c ...   E..<"). The ASCII column and tcpdump's summary lines are dropped.
  function parseHex(text) {
    const lines = String(text).replace(/\r/g, "").split("\n").map(s => s.replace(/^\s+|\s+$/g, "")).filter(Boolean);
    if (!lines.length) return { error: "Paste the bytes of a packet." };
    const offRe = /^(0x)?([0-9a-f]{4,8})(:?)\s+(.*)$/i;
    const dump = lines.some(l => { const m = offRe.exec(l); return m && /^0+$/.test(m[2]) && /^[0-9a-f]{2}/i.test(m[4]) && (m[3] || m[1] || lines.some(x => /^(0x)?0*10:?\s/i.test(x))); });
    const out = []; let format = dump ? "hex dump with offsets" : "plain hex", more = false;
    if (dump) {
      for (const line of lines) {
        const m = offRe.exec(line); if (!m || !/^[0-9a-f]+$/i.test(m[2]) || !/^[0-9a-f]{2}/i.test(m[4])) continue;
        if (out.length && /^0+$/.test(m[2])) { more = true; break; }   // a second dump starts (more packets, or tshark's "reassembled" copy): only the first is read
        const body = m[4], quad = /^[0-9a-f]{4}(\s|$)/i.test(body);
        const cut = body.search(quad ? / {2,}/ : / {3,}/), area = cut >= 0 ? body.slice(0, cut) : body;
        let n = 0;
        for (const t of area.split(/\s+/)) {
          if (!/^([0-9a-f]{2}|[0-9a-f]{4})$/i.test(t) || n >= 16) break;
          for (let i = 0; i < t.length; i += 2) { out.push(parseInt(t.slice(i, i + 2), 16)); n++; }
        }
      }
    } else {
      for (let line of lines) {
        if (/0x[0-9a-f]{1,2}\s*,/i.test(line)) format = "C array";
        line = line.replace(/\/\/.*$|\/\*.*?\*\//g, "").replace(/0x/gi, " ").replace(/[{};]/g, " ");
        for (const t of line.split(/[\s,:.-]+/).filter(Boolean)) {
          if (!/^[0-9a-f]+$/i.test(t)) return { error: "Cannot read \"" + t.slice(0, 20) + "\" as hexadecimal. Paste only the hex bytes (a dump with offsets and text is fine)." };
          if (t.length % 2) return { error: "\"" + t.slice(0, 20) + "\" has an odd number of hex digits: bytes come in pairs." };
          for (let i = 0; i < t.length; i += 2) out.push(parseInt(t.slice(i, i + 2), 16));
        }
      }
    }
    if (!out.length) return { error: "No hex bytes found." };
    return { bytes: Uint8Array.from(out), format, more };
  }

  // ---- checksums ----
  function sum16(b, s, e, init) {
    let t = init || 0;
    for (let i = s; i + 1 < e; i += 2) t += b[i] * 256 + b[i + 1];
    if ((e - s) % 2) t += b[e - 1] * 256;
    while (t > 0xffff) t = (t & 0xffff) + (t >>> 16);
    return t;
  }
  const pseudo4 = (b, o, proto, len) => sum16(b, o + 12, o + 20) + proto + len;
  function pseudo6(b, o, proto, len, srcOff, dstOff) { return sum16(b, srcOff, srcOff + 16) + sum16(b, dstOff, dstOff + 16) + len + proto; }
  const fold = t => { while (t > 0xffff) t = (t & 0xffff) + (t >>> 16); return t; };

  // ---- the decoder ----
  // opts.link: "auto" | "eth" | "ip" | "ip4" | "ip6" | "sll" | "ppp"
  function decode(b, opts) {
    opts = opts || {};
    const layers = [], notes = [];
    const st = { b, layers, notes, wireLen: opts.wireLength || null };
    const link = opts.link || "auto";
    let kind = link;
    if (kind === "auto") kind = autoDetect(b);
    if (kind === "eth") eth(st, 0);
    else if (kind === "sll") sll(st, 0);
    else if (kind === "ppp") ppp(st, 0, 0, true);
    else if (kind === "ip4" || kind === "ip") ipv4(st, 0);
    else if (kind === "ip6") ipv6(st, 0);
    else notes.push({ level: "bad", text: "Cannot tell what this packet starts with. Choose the first layer yourself." });
    const covered = layers.length ? layers[layers.length - 1].end : 0;
    if (layers.length && covered < b.length && !st.noTrailer) {
      const extra = b.length - covered;
      layers.push({ name: "trailer", title: "Left over: " + extra + " byte" + (extra === 1 ? "" : "s"), start: covered, end: b.length, fields: [{ name: "Bytes", value: hex(b, covered, Math.min(b.length, covered + 32)) + (extra > 32 ? " ..." : ""), start: covered, len: extra }], summary: extra + " trailing bytes" });
      if (extra <= 18 && st.paddedOK) notes.push({ level: "info", text: "The " + extra + " bytes at the end are Ethernet padding: frames shorter than 60 bytes are padded, and it is normal." });
      else notes.push({ level: "info", text: extra + " bytes remain after the last header (padding, a trailer such as an FCS, or data of a layer this tool does not read)." });
    }
    const chain = layers.filter(l => l.name !== "trailer").map(l => l.short || l.name).join(" > ");
    return { layers, notes, bytes: b, chain, summary: st.summary || chain, kind };
  }

  function autoDetect(b) {
    if (b.length < 14) return b.length && (b[0] >> 4) === 4 ? "ip4" : b.length && (b[0] >> 4) === 6 ? "ip6" : "unknown";
    const v = b[0] >> 4;
    // a raw IP packet starts with 4 or 6 and has a consistent length
    if (v === 4 && (b[0] & 15) >= 5 && u16(b, 2) >= 20 && u16(b, 2) <= b.length + 0 && (u16(b, 2) === b.length || b.length >= 20)) {
      const et = u16(b, 12); if (!(et === 0x0800 || et === 0x86dd || et === 0x0806 || et === 0x8100)) return "ip4";
    }
    if (v === 6 && b.length >= 40 && u16(b, 4) + 40 <= b.length + 0 && u16(b, 4) + 40 >= b.length - 0) { const et = u16(b, 12); if (!(et === 0x0800 || et === 0x86dd || et === 0x0806 || et === 0x8100)) return "ip6"; }
    const et = u16(b, 12);
    if (et >= 0x0600 || et <= 1500) return "eth";
    if (u16(b, 0) <= 4 && u16(b, 2) === 1 && b.length > 16) return "sll";
    return "eth";
  }

  const L = (st, name, title, start, end, fields, extra) => { const l = Object.assign({ name, title, start, end, fields }, extra || {}); st.layers.push(l); return l; };
  const F = (name, value, start, len, note) => ({ name, value, start, len, note });
  const warn = (st, text, level) => st.notes.push({ level: level || "warn", text });

  function eth(st, o) {
    const b = st.b;
    if (b.length < o + 14) { warn(st, "Only " + (b.length - o) + " bytes: an Ethernet header is 14.", "bad"); return; }
    const dst = mac(b, o), src = mac(b, o + 6); let et = u16(b, o + 12), p = o + 14;
    const f = [F("Destination MAC", dst + (dst === "ff:ff:ff:ff:ff:ff" ? "  (broadcast)" : (b[o] & 1 ? "  (multicast)" : "")), o, 6), F("Source MAC", src + (b[o + 6] & 1 ? "  (a multicast source address is invalid)" : ""), o + 6, 6)];
    if (b[o + 6] & 1) warn(st, "The source MAC address has the group bit set: no real device sends from such an address.");
    const tags = [];
    while ((et === 0x8100 || et === 0x88a8) && b.length >= p + 4) {
      const tci = u16(b, p), vid = tci & 0xfff;
      f.push(F(et === 0x8100 ? "VLAN tag (802.1Q)" : "Outer VLAN tag (802.1ad)", "VLAN " + vid + ", priority " + (tci >> 13) + (tci & 0x1000 ? ", drop-eligible" : ""), p - 2, 4));
      tags.push(vid); et = u16(b, p + 2); p += 4;
    }
    f.push(F("Type", "0x" + et.toString(16).padStart(4, "0") + (ETYPE[et] ? "  " + ETYPE[et] : et <= 1500 ? "  (a length: 802.3 frame)" : "  (unknown)"), p - 2, 2));
    st.paddedOK = true;
    L(st, "eth", "Ethernet" + (tags.length ? " + VLAN " + tags.join("/") : ""), o, p, f, { short: "Ethernet" + (tags.length ? "/VLAN" : ""), summary: src + " > " + dst });
    st.ethSummary = src + " > " + dst;
    next(st, et, p);
  }

  function sll(st, o) {
    const b = st.b; if (b.length < o + 16) { warn(st, "Too short for a Linux cooked header (16 bytes).", "bad"); return; }
    const types = { 0: "to us", 1: "broadcast", 2: "multicast", 3: "to another host", 4: "sent by us" }, et = u16(b, o + 14);
    L(st, "sll", "Linux cooked capture", o, o + 16, [F("Packet type", types[u16(b, o)] || String(u16(b, o)), o, 2), F("Link type", String(u16(b, o + 2)), o + 2, 2), F("Address length", String(u16(b, o + 4)), o + 4, 2), F("Address", hex(b, o + 6, o + 6 + Math.min(8, u16(b, o + 4)), ":"), o + 6, 8), F("Protocol", "0x" + et.toString(16).padStart(4, "0") + (ETYPE[et] ? "  " + ETYPE[et] : ""), o + 14, 2)], { short: "Linux cooked" });
    next(st, et, o + 16);
  }

  function next(st, et, p) {
    if (et === 0x0800) ipv4(st, p); else if (et === 0x86dd) ipv6(st, p); else if (et === 0x0806) arp(st, p);
    else if (et === 0x8864) pppoeSession(st, p); else if (et === 0x8863) pppoeDisc(st, p);
    else if (et === 0x8847 || et === 0x8848) mpls(st, p);
    else if (et === 0x88cc) { const l = L(st, "lldp", "LLDP (link-layer discovery)", p, st.b.length, [F("Data", st.b.length - p + " bytes of LLDP; this tool does not read its details", p, st.b.length - p)], { short: "LLDP" }); st.noTrailer = true; }
    else if (et <= 1500 && st.b.length >= p + 3) { llc(st, p); }
    else if (p < st.b.length) warn(st, "The type 0x" + et.toString(16) + " is not one this tool reads; the rest of the packet is not decoded.", "info");
  }

  function llc(st, p) {
    const b = st.b; const dsap = b[p], ssap = b[p + 1], ctl = b[p + 2];
    L(st, "llc", "LLC (802.2)", p, p + 3, [F("DSAP", "0x" + h2(dsap) + (dsap === 0x42 ? " (spanning tree)" : ""), p, 1), F("SSAP", "0x" + h2(ssap), p + 1, 1), F("Control", "0x" + h2(ctl), p + 2, 1)], { short: "LLC" });
    if (dsap === 0x42) { st.noTrailer = true; warn(st, "Spanning tree (STP) frame; its fields are not decoded here.", "info"); }
  }

  function arp(st, p) {
    const b = st.b; if (b.length < p + 28) { warn(st, "ARP needs 28 bytes; " + (b.length - p) + " present.", "bad"); return; }
    const op = u16(b, p + 6), ht = u16(b, p), pt = u16(b, p + 2);
    const ops = { 1: "request (who has ...?)", 2: "reply (... is at ...)" }, sha = mac(b, p + 8), spa = ip4(b, p + 14), tha = mac(b, p + 18), tpa = ip4(b, p + 24);
    const gratuitous = spa === tpa;
    L(st, "arp", "ARP", p, p + 28, [F("Hardware type", ht + (ht === 1 ? " Ethernet" : ""), p, 2), F("Protocol type", "0x" + pt.toString(16).padStart(4, "0") + (pt === 0x800 ? " IPv4" : ""), p + 2, 2), F("Address lengths", b[p + 4] + " and " + b[p + 5], p + 4, 2),
      F("Operation", op + " " + (ops[op] || ""), p + 6, 2), F("Sender MAC", sha, p + 8, 6), F("Sender IP", spa, p + 14, 4), F("Target MAC", tha + (op === 1 && tha === "00:00:00:00:00:00" ? "  (unknown: that is what the request asks)" : ""), p + 18, 6), F("Target IP", tpa, p + 24, 4)],
      { short: "ARP", summary: op === 1 ? "Who has " + tpa + "? Tell " + spa : spa + " is at " + sha });
    st.summary = op === 1 ? "ARP: who has " + tpa + "? Tell " + spa : op === 2 ? "ARP: " + spa + " is at " + sha : "ARP operation " + op;
    if (gratuitous) warn(st, "Sender and target address are the same: a gratuitous ARP (a device announcing itself or checking for a duplicate address).", "info");
    st.paddedOK = true;
  }

  function pppoeDisc(st, p) {
    const b = st.b; if (b.length < p + 6) { warn(st, "PPPoE header is 6 bytes.", "bad"); return; }
    const code = b[p + 1], sid = u16(b, p + 2), len = u16(b, p + 4);
    const tags = []; let i = p + 6; const end = Math.min(b.length, p + 6 + len);
    const TN = { 0x0101: "Service-Name", 0x0102: "AC-Name", 0x0103: "Host-Uniq", 0x0104: "AC-Cookie", 0x0105: "Vendor-Specific", 0x0110: "Relay-Session-ID", 0x0201: "Service-Name-Error", 0x0202: "AC-System-Error", 0x0203: "Generic-Error" };
    while (i + 4 <= end) { const t = u16(b, i), l = u16(b, i + 2); tags.push(F("Tag " + (TN[t] || "0x" + t.toString(16)), l ? hex(b, i + 4, Math.min(end, i + 4 + l)) : "(empty)", i, 4 + l)); i += 4 + l; }
    L(st, "pppoed", "PPPoE discovery", p, end, [F("Version / type", b[p].toString(16) === "11" ? "1 / 1" : "0x" + h2(b[p]), p, 1), F("Code", "0x" + h2(code) + " " + (PPPOE_CODE[code] || ""), p + 1, 1), F("Session ID", String(sid), p + 2, 2), F("Payload length", String(len), p + 4, 2)].concat(tags), { short: "PPPoE discovery", summary: PPPOE_CODE[code] });
    st.summary = "PPPoE " + (PPPOE_CODE[code] || "code " + code);
    st.paddedOK = true;
  }

  function pppoeSession(st, p) {
    const b = st.b; if (b.length < p + 8) { warn(st, "PPPoE session header plus PPP protocol is 8 bytes.", "bad"); return; }
    const sid = u16(b, p + 2), len = u16(b, p + 4);
    L(st, "pppoe", "PPPoE session", p, p + 6, [F("Version / type", b[p] === 0x11 ? "1 / 1" : "0x" + h2(b[p]), p, 1), F("Code", "0x" + h2(b[p + 1]) + (b[p + 1] === 0 ? " session data" : ""), p + 1, 1), F("Session ID", String(sid), p + 2, 2), F("Payload length", String(len) + " (PPP header and data)", p + 4, 2)], { short: "PPPoE" });
    ppp(st, p + 6, len, false);
  }
  function ppp(st, p, len, standalone) {
    const b = st.b; if (standalone && b[p] === 0xff && b[p + 1] === 0x03) p += 2;
    if (b.length < p + 2) { warn(st, "Too short for the PPP protocol field.", "bad"); return; }
    let proto = b[p], plen = 1; if (!(proto & 1)) { proto = u16(b, p); plen = 2; }
    L(st, "ppp", "PPP", p, p + plen, [F("Protocol", "0x" + proto.toString(16).padStart(plen * 2, "0") + " " + (PPPPROTO[proto] || "(unknown)"), p, plen)], { short: "PPP" });
    p += plen;
    if (proto === 0x0021) ipv4(st, p); else if (proto === 0x0057) ipv6(st, p);
    else if (proto === 0xc021 || proto === 0x8021 || proto === 0x8057 || proto === 0xc023 || proto === 0xc223) pppControl(st, p, proto);
  }
  function pppControl(st, p, proto) {
    const b = st.b; if (b.length < p + 4) return;
    const CODES = { 1: "Configure-Request", 2: "Configure-Ack", 3: "Configure-Nak", 4: "Configure-Reject", 5: "Terminate-Request", 6: "Terminate-Ack", 7: "Code-Reject", 8: "Protocol-Reject", 9: "Echo-Request", 10: "Echo-Reply", 11: "Discard-Request" };
    const AUTH = { 1: "Authenticate-Request / Challenge", 2: "Authenticate-Ack / Response", 3: "Authenticate-Nak / Success", 4: "Failure" };
    const code = b[p], id = b[p + 1], len = u16(b, p + 2), isAuth = proto === 0xc023 || proto === 0xc223;
    const fl = [F("Code", code + " " + ((isAuth ? (proto === 0xc223 ? { 1: "Challenge", 2: "Response", 3: "Success", 4: "Failure" } : { 1: "Authenticate-Request", 2: "Authenticate-Ack", 3: "Authenticate-Nak" }) : CODES)[code] || ""), p, 1), F("Identifier", String(id), p + 1, 1), F("Length", String(len), p + 2, 2)];
    L(st, "pppctl", (PPPPROTO[proto] || "PPP").replace(/ \(.*/, "") + " message", p, Math.min(b.length, p + len), fl, { short: (PPPPROTO[proto] || "PPP").replace(/ \(.*/, "") });
    st.summary = (PPPPROTO[proto] || "PPP").replace(/ \(.*/, "") + " " + ((isAuth ? AUTH : CODES)[code] || code);
  }

  function mpls(st, p) {
    const b = st.b, f = []; let i = p, n = 0;
    while (i + 4 <= b.length && n < 16) { const v = u32(b, i), label = v >>> 12, tc = (v >> 9) & 7, bos = (v >> 8) & 1, ttl = v & 255; f.push(F("Label " + (n + 1), label + ", traffic class " + tc + ", TTL " + ttl + (bos ? ", bottom of stack" : ""), i, 4)); i += 4; n++; if (bos) break; }
    L(st, "mpls", "MPLS (" + n + " label" + (n === 1 ? "" : "s") + ")", p, i, f, { short: "MPLS" });
    if (i < b.length) { const v = b[i] >> 4; if (v === 4) ipv4(st, i); else if (v === 6) ipv6(st, i); else warn(st, "After the MPLS labels the payload is not recognised as IP (it could be Ethernet in a pseudowire).", "info"); }
  }

  // ---- IPv4 ----
  const IP4OPT = { 0: "End of list", 1: "No-op", 7: "Record route", 68: "Timestamp", 130: "Security", 131: "Loose source route", 137: "Strict source route", 148: "Router alert" };
  function ipv4(st, o) {
    const b = st.b;
    if (b.length < o + 20) { warn(st, "Only " + (b.length - o) + " bytes left: an IPv4 header is at least 20.", "bad"); return; }
    const ver = b[o] >> 4, ihl = (b[o] & 15) * 4, tos = b[o + 1], total = u16(b, o + 2), id = u16(b, o + 4), ff = u16(b, o + 6), ttl = b[o + 8], proto = b[o + 9], ck = u16(b, o + 10);
    const flags = (ff >> 13) & 7, fo = (ff & 0x1fff) * 8, df = !!(flags & 2), mf = !!(flags & 1);
    const src = ip4(b, o + 12), dst = ip4(b, o + 16);
    if (ver !== 4) { warn(st, "The version field says " + ver + ", not 4: this is not IPv4 (wrong starting layer?).", "bad"); return; }
    if (ihl < 20) { warn(st, "The header length field is " + ihl + " bytes; the minimum is 20.", "bad"); return; }
    const hdrEnd = o + ihl, avail = b.length >= hdrEnd;
    const f = [F("Version", "4", o, 1), F("Header length", ihl + " bytes" + (ihl > 20 ? " (has options)" : ""), o, 1), F("DSCP / ECN", "DSCP " + (tos >> 2) + (DSCP[tos >> 2] ? " (" + DSCP[tos >> 2] + ")" : "") + ", ECN " + (tos & 3) + ["", " (ECN-capable)", " (ECN-capable)", " (congestion experienced)"][tos & 3], o + 1, 1),
      F("Total length", total + " bytes", o + 2, 2), F("Identification", "0x" + id.toString(16).padStart(4, "0") + " (" + id + ")", o + 4, 2),
      F("Flags", (df ? "Don't Fragment" : "may fragment") + (mf ? ", More Fragments" : "") + (flags & 4 ? ", reserved bit set" : ""), o + 6, 1), F("Fragment offset", fo + " bytes", o + 6, 2),
      F("TTL", String(ttl), o + 8, 1), F("Protocol", proto + " " + (PROTO[proto] || "(unknown)"), o + 9, 1)];
    let ckNote = "";
    if (avail) { const ok = sum16(b, o, hdrEnd) === 0xffff; ckNote = ok ? "  (correct)" : "  (WRONG)"; if (!ok) warn(st, "The IPv4 header checksum is wrong. If this packet was captured on the machine that sent it, that is usually harmless (checksum offload: the network card fills it in later); on a received packet it means damage."); }
    f.push(F("Header checksum", "0x" + ck.toString(16).padStart(4, "0") + ckNote, o + 10, 2), F("Source", src, o + 12, 4), F("Destination", dst, o + 16, 4));
    if (ihl > 20 && avail) {
      let i = o + 20; const names = [];
      while (i < hdrEnd) { const t = b[i]; if (t === 0) { names.push("End of list"); break; } if (t === 1) { names.push("No-op"); i++; continue; } const l = b[i + 1]; if (!(l >= 2) || i + l > hdrEnd) { names.push("broken option"); break; } names.push((IP4OPT[t] || "option " + t) + " (" + l + " bytes)"); i += l; }
      f.push(F("Options", names.join(", "), o + 20, ihl - 20));
    }
    const dstClass = ipv4Class(dst), srcClass = ipv4Class(src);
    if (srcClass) f[f.length - 2].value += "  (" + srcClass + ")"; if (dstClass) f[f.length - 1].value += "  (" + dstClass + ")";
    L(st, "ip4", "IPv4", o, Math.min(b.length, hdrEnd), f, { short: "IPv4", summary: src + " > " + dst });
    st.l3 = { v: 4, o, src, dst, proto };
    if (!avail) { warn(st, "The capture ends inside the IPv4 header.", "bad"); return; }
    if (total < ihl) { warn(st, "The total length (" + total + ") is smaller than the header (" + ihl + ").", "bad"); return; }
    const end = o + total, have = b.length;
    if (end > have) warn(st, "The packet says it is " + total + " bytes but only " + (have - o) + " were captured: the capture was cut short (a small snapshot length such as tcpdump -s 96, or a truncated paste). Checksums cannot be checked and the data is partial.", "warn");
    else if (end < have && st.paddedOK && have - end <= 18) { /* ethernet padding: handled by the trailer note */ }
    st.l3.end = Math.min(end, have); st.l3.complete = end <= have; st.l3.frag = mf || fo > 0;
    if (ttl <= 1) warn(st, "TTL is " + ttl + ": a router will drop this packet and send back an ICMP time exceeded message.", "info");
    if (fo > 0 || mf) {
      warn(st, mf && fo === 0 ? "This is the first fragment of a split packet (More Fragments is set). Only this fragment carries the TCP or UDP header; the others have none, so filters on ports do not match them." : "This is a fragment (offset " + fo + " bytes): it carries no TCP or UDP header, so it cannot be decoded on its own.", "info");
      if (fo > 0) { L(st, "frag", "IPv4 fragment data", hdrEnd, st.l3.end, [F("Data", (st.l3.end - hdrEnd) + " bytes at offset " + fo + " of the original packet", hdrEnd, st.l3.end - hdrEnd)], { short: "fragment" }); st.noTrailer = false; return; }
    }
    if (df && ttl > 0 && proto !== 1) { /* nothing to say */ }
    transport(st, proto, hdrEnd, st.l3.end, 4);
  }
  function ipv4Class(a) {
    const [x, y] = a.split(".").map(Number);
    if (a === "255.255.255.255") return "limited broadcast"; if (x >= 224 && x <= 239) return "multicast"; if (x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168)) return "private";
    if (x === 100 && y >= 64 && y <= 127) return "shared address space (CGNAT)"; if (x === 127) return "loopback"; if (x === 169 && y === 254) return "link-local"; if (a === "0.0.0.0") return "unspecified";
    if (x === 192 && y === 0 && a.startsWith("192.0.2.") || a.startsWith("198.51.100.") || a.startsWith("203.0.113.")) return "documentation range"; return "";
  }

  // ---- IPv6 ----
  function ipv6(st, o) {
    const b = st.b;
    if (b.length < o + 40) { warn(st, "Only " + (b.length - o) + " bytes left: an IPv6 header is 40.", "bad"); return; }
    const vtf = u32(b, o), ver = vtf >>> 28, tc = (vtf >>> 20) & 255, fl = vtf & 0xfffff, plen = u16(b, o + 4);
    if (ver !== 6) { warn(st, "The version field says " + ver + ", not 6: this is not IPv6 (wrong starting layer?).", "bad"); return; }
    let nh = b[o + 6]; const hl = b[o + 7], src = ip6(b, o + 8), dst = ip6(b, o + 24);
    const f = [F("Version", "6", o, 1), F("Traffic class", "DSCP " + (tc >> 2) + (DSCP[tc >> 2] ? " (" + DSCP[tc >> 2] + ")" : "") + ", ECN " + (tc & 3), o, 2), F("Flow label", "0x" + fl.toString(16).padStart(5, "0"), o + 1, 3), F("Payload length", plen + " bytes" + (plen === 0 ? " (0: jumbo payload or no payload)" : ""), o + 4, 2),
      F("Next header", nh + " " + (PROTO[nh] || ""), o + 6, 1), F("Hop limit", String(hl), o + 7, 1), F("Source", src + ip6Class(b, o + 8), o + 8, 16), F("Destination", dst + ip6Class(b, o + 24), o + 24, 16)];
    L(st, "ip6", "IPv6", o, o + 40, f, { short: "IPv6", summary: src + " > " + dst });
    const end = Math.min(b.length, o + 40 + plen);
    if (o + 40 + plen > b.length) warn(st, "The header says " + plen + " bytes follow but only " + (b.length - o - 40) + " were captured: the capture was cut short. Checksums cannot be checked.");
    st.l3 = { v: 6, o, src, dst, srcOff: o + 8, dstOff: o + 24, complete: o + 40 + plen <= b.length, end };
    if (hl <= 1) warn(st, "Hop limit is " + hl + ": a router will drop this packet and send back an ICMPv6 time exceeded message.", "info");
    let p = o + 40;
    for (let guard = 0; guard < 12; guard++) {
      if (nh === 0 || nh === 43 || nh === 60 || nh === 135) {
        if (p + 8 > end) { warn(st, "The extension header is cut short.", "bad"); return; }
        const l = 8 + b[p + 1] * 8, n2 = b[p]; if (nh === 43 && b[p + 3] > 0) st.l3.routing = true;
        if (p + l > end) { warn(st, "The extension header is longer than the packet.", "bad"); return; }
        const fs = [F("Next header", n2 + " " + (PROTO[n2] || ""), p, 1), F("Length", l + " bytes", p + 1, 1)];
        if (nh === 43) fs.push(F("Routing type", String(b[p + 2]) + (b[p + 2] === 0 ? " (RH0: deprecated, a security risk)" : b[p + 2] === 2 ? " (Mobile IPv6)" : b[p + 2] === 4 ? " (segment routing, SRH)" : ""), p + 2, 1), F("Segments left", String(b[p + 3]), p + 3, 1));
        if (nh === 0) { let i = p + 2; const names = []; while (i < p + l) { const t = b[i]; if (t === 0) { names.push("Pad1"); i++; continue; } const ol = b[i + 1]; names.push(({ 1: "PadN", 5: "Router Alert (MLD, RSVP)", 0xc2: "Jumbo payload" })[t] || "option " + t); i += 2 + ol; } fs.push(F("Options", names.join(", "), p + 2, l - 2)); }
        L(st, "ip6ext", PROTO[nh][0].toUpperCase() + PROTO[nh].slice(1), p, p + l, fs, { short: nh === 0 ? "hop-by-hop" : nh === 43 ? "routing" : "dest options" });
        nh = n2; p += l; continue;
      }
      if (nh === 44) {
        if (p + 8 > end) { warn(st, "The fragment header is cut short.", "bad"); return; }
        const n2 = b[p], fo = (u16(b, p + 2) >> 3) * 8, mf = u16(b, p + 2) & 1, fid = u32(b, p + 4);
        L(st, "ip6frag", "IPv6 fragment header", p, p + 8, [F("Next header", n2 + " " + (PROTO[n2] || ""), p, 1), F("Fragment offset", fo + " bytes", p + 2, 2), F("More fragments", mf ? "yes" : "no", p + 3, 1), F("Identification", "0x" + fid.toString(16), p + 4, 4)], { short: "fragment" });
        if (mf || fo > 0) st.l3.frag = true;
        warn(st, fo === 0 ? "A first fragment (IPv6 extension headers like this one sit in front of the TCP/UDP header, so a filter such as 'tcp' may not see it)." : "A later fragment (offset " + fo + "): no TCP or UDP header here.", "info");
        if (fo > 0) { L(st, "frag", "IPv6 fragment data", p + 8, end, [F("Data", (end - p - 8) + " bytes", p + 8, end - p - 8)], { short: "fragment" }); return; }
        nh = n2; p += 8; continue;
      }
      break;
    }
    st.l3.o6end = p; st.l3.nh = nh;
    transport(st, nh, p, end, 6);
  }
  function ip6Class(b, o) {
    const a = u16(b, o), z = [0, 1, 2, 3, 4, 5, 6, 7].every(i => i === 7 ? u16(b, o + 14) === 1 : u16(b, o + 2 * i) === 0), un = [0, 1, 2, 3, 4, 5, 6, 7].every(i => u16(b, o + 2 * i) === 0);
    if (z) return "  (loopback)"; if (un) return "  (unspecified)"; if (b[o] === 0xff) { const sc = b[o + 1] & 15; return "  (multicast, scope " + ({ 1: "interface", 2: "link-local", 4: "admin", 5: "site", 8: "organisation", 14: "global" }[sc] || sc) + (a === 0xff02 && u16(b, o + 2) === 0 && b[o + 11] === 1 && b[o + 12] === 0xff ? ", solicited-node" : "") + ")"; }
    if ((a & 0xffc0) === 0xfe80) return "  (link-local)"; if ((a & 0xfe00) === 0xfc00) return "  (unique local)"; if ((a & 0xe000) === 0x2000) return a === 0x2001 && u16(b, o + 2) === 0xdb8 ? "  (documentation range)" : "  (global unicast)"; return "";
  }

  // ---- transport and above ----
  function transport(st, proto, p, end, ver) {
    const b = st.b;
    if (proto === 6) tcp(st, p, end, ver); else if (proto === 17) udp(st, p, end, ver);
    else if (proto === 1 && ver === 4) icmp4(st, p, end); else if (proto === 58 && ver === 6) icmp6(st, p, end);
    else if (proto === 47) gre(st, p, end); else if (proto === 50) esp(st, p, end); else if (proto === 51) ah(st, p, end, ver);
    else if (proto === 4) ipv4(st, p); else if (proto === 41) ipv6(st, p);
    else if (proto === 59) { /* nothing follows */ }
    else if (p < end) { L(st, "l4", PROTO[proto] || "Protocol " + proto, p, end, [F("Data", (end - p) + " bytes", p, end - p)], { short: PROTO[proto] || "proto " + proto }); warn(st, "Protocol " + proto + (PROTO[proto] ? " (" + PROTO[proto] + ")" : "") + " is not decoded by this tool.", "info"); }
  }
  function l4check(st, p, end, proto, ver, ckOff) {
    const b = st.b, l3 = st.l3; if (!l3) return null;
    if (l3.frag) return "cannot be checked here: this is a fragment of a larger packet";
    if (l3.routing) return "cannot be checked here: the checksum uses the final destination from the routing header";
    if (!l3.complete || end > b.length) return "cannot be checked (the packet is cut short)";
    const len = end - p;
    let t = ver === 4 ? pseudo4(b, l3.o, proto, len) : pseudo6(b, l3.o, proto, len, l3.srcOff, l3.dstOff);
    return fold(sum16(b, p, end, t)) === 0xffff ? "correct" : "WRONG";
  }

  function dataLayer(st, p, end) {
    const b = st.b, n = end - p; if (n <= 0) return;
    const shown = Math.min(n, 32), txt = Array.from(b.slice(p, p + shown), x => (x >= 32 && x < 127 ? String.fromCharCode(x) : ".")).join("");
    L(st, "data", "Data (" + n + " byte" + (n === 1 ? "" : "s") + ")", p, end, [F("First bytes", hex(b, p, p + shown) + (n > shown ? " ..." : ""), p, shown), F("As text", txt + (n > shown ? " ..." : ""), p, shown)], { short: "data" });
  }
  function tcp(st, p, end, ver) {
    const b = st.b;
    if (end - p < 20) { warn(st, "Only " + (end - p) + " bytes for TCP: the header is at least 20 (cut short, or not TCP).", "bad"); return; }
    const sp = u16(b, p), dp = u16(b, p + 2), seq = u32(b, p + 4), ack = u32(b, p + 8), off = (b[p + 12] >> 4) * 4, fl = u16(b, p + 12) & 0x1ff, win = u16(b, p + 14), ck = u16(b, p + 16), urg = u16(b, p + 18);
    const FN = [[0x100, "NS"], [0x80, "CWR"], [0x40, "ECE"], [0x20, "URG"], [0x10, "ACK"], [0x08, "PSH"], [0x04, "RST"], [0x02, "SYN"], [0x01, "FIN"]];
    const names = FN.filter(x => fl & x[0]).map(x => x[1]);
    const flagText = names.length ? names.join(" ") : "none";
    const f = [F("Source port", port(sp), p, 2), F("Destination port", port(dp), p + 2, 2), F("Sequence number", String(seq), p + 4, 4), F("Acknowledgment number", String(ack) + (fl & 0x10 ? "" : "  (not used: ACK is not set)"), p + 8, 4),
      F("Header length", off + " bytes" + (off > 20 ? " (has options)" : ""), p + 12, 1), F("Flags", flagText + "  (0x" + fl.toString(16).padStart(3, "0") + ")", p + 12, 2), F("Window", String(win) + (win === 0 ? "  (zero: the sender must stop)" : ""), p + 14, 2)];
    if (off < 20 || p + off > end) { warn(st, "The TCP header length field (" + off + ") does not fit; the packet is cut short or damaged.", "bad"); L(st, "tcp", "TCP", p, end, f, { short: "TCP" }); return; }
    const c = l4check(st, p, end, 6, ver);
    f.push(F("Checksum", "0x" + ck.toString(16).padStart(4, "0") + (c ? "  (" + c + ")" : ""), p + 16, 2), F("Urgent pointer", String(urg) + (fl & 0x20 ? "" : "  (not used: URG is not set)"), p + 18, 2));
    let shift = null, mss = null, tsval = null;
    if (off > 20) {
      let i = p + 20; const lst = [];
      while (i < p + off) {
        const k = b[i]; if (k === 0) { lst.push("End of options"); break; } if (k === 1) { lst.push("No-op"); i++; continue; }
        const l = b[i + 1]; if (!(l >= 2) || i + l > p + off) { lst.push("broken option"); warn(st, "A TCP option is damaged or cut short.", "bad"); break; }
        let t = ({ 2: "MSS", 3: "Window scale", 4: "SACK permitted", 5: "SACK", 8: "Timestamps", 28: "User timeout", 29: "TCP-AO", 30: "Multipath TCP", 34: "Fast Open" })[k] || "option " + k;
        if (k === 2 && l === 4) { mss = u16(b, i + 2); t += " " + mss; } else if (k === 3 && l === 3) { shift = b[i + 2]; t += " " + shift + " (x" + Math.pow(2, shift) + ")"; } else if (k === 8 && l === 10) { tsval = u32(b, i + 2); t += " val " + u32(b, i + 2) + " echo " + u32(b, i + 6); } else if (k === 5) t += " (" + ((l - 2) / 8) + " block" + ((l - 2) / 8 === 1 ? "" : "s") + ")";
        lst.push(t); i += l;
      }
      f.push(F("Options", lst.join(", "), p + 20, off - 20));
    }
    const dataLen = end - p - off, ackOnly = names.join() === "ACK";
    const syn = (fl & 2) && !(fl & 0x10);
    L(st, "tcp", "TCP", p, p + off, f, { short: "TCP", summary: sp + " > " + dp + " [" + names.join(",") + "]" });
    st.summary = (st.l3 ? st.l3.src + ":" + sp + " > " + st.l3.dst + ":" + dp : "") + " TCP " + (names.join(",") || "no flags") + (dataLen ? ", " + dataLen + " bytes of data" : "");
    // meaning
    if (fl & 2 && fl & 1) warn(st, "SYN and FIN are both set: not valid in normal traffic; scanners and some attacks send it.", "warn");
    else if (!fl) warn(st, "No TCP flag is set (a \"null\" packet): not valid in normal traffic; some port scanners send it.", "warn");
    else if ((fl & 0x29) === 0x29) warn(st, "FIN, PSH and URG together (an \"Xmas\" packet): not normal traffic; some port scanners send it.", "warn");
    else if (syn && (fl & 4)) warn(st, "SYN and RST are both set: not valid.", "warn");
    if ((fl & 2) && !(fl & 0x10)) warn(st, "A SYN: the client opens a connection" + (mss ? "; it announces MSS " + mss + (shift != null ? ", window scaling x" + Math.pow(2, shift) : ", no window scaling") : "") + ". The window field in a SYN is never scaled.", "info");
    else if ((fl & 2) && (fl & 0x10)) warn(st, "A SYN/ACK: the server accepts the connection" + (mss ? " and announces MSS " + mss + (shift != null ? ", window scaling x" + Math.pow(2, shift) : ", no window scaling (the client's scaling is off too)") : "") + ".", "info");
    if (fl & 4) warn(st, (fl & 0x10 ? "A reset (RST/ACK)" : "A reset (RST)") + ": the connection is refused or torn down at once. Seen in reply to a SYN, it means nothing listens on that port or a firewall rejects it.", "info");
    if (win === 0 && !(fl & 4) && !(fl & 2)) warn(st, "Window 0: the receiver's buffer is full; the sender must wait. Repeated zero windows mean a slow receiving application.", "info");
    if (c === "WRONG") warn(st, "The TCP checksum is wrong. On a packet captured at the sender that is usually checksum offload (the card fills it in later); on a received packet it means the data was damaged or altered.");
    if (mss && st.l3 && st.l3.v === 4 && mss > 1460) warn(st, "MSS " + mss + " is more than 1460, which fits a 1500-byte link only with a bigger MTU (jumbo frames).", "info");
    st.l4 = { sp, dp, dataLen, p: p + off, end, proto: 6 };
    const n0 = st.layers.length; app(st, "tcp", sp, dp, p + off, end, dataLen); if (st.layers.length === n0) dataLayer(st, p + off, end);
  }

  function udp(st, p, end, ver) {
    const b = st.b;
    if (end - p < 8) { warn(st, "Only " + (end - p) + " bytes for UDP: the header is 8.", "bad"); return; }
    const sp = u16(b, p), dp = u16(b, p + 2), len = u16(b, p + 4), ck = u16(b, p + 6);
    let c = null;
    if (ck === 0 && ver === 4) c = "not used: allowed in IPv4"; else if (ck === 0) { c = "ZERO: not allowed in IPv6"; warn(st, "A UDP checksum of 0 is not allowed over IPv6 (except for some tunnels).", "warn"); } else if (len >= 8 && p + len <= end) c = l4check(st, p, p + len, 17, ver);
    if (len < 8) { warn(st, "The UDP length field (" + len + ") is below 8.", "bad"); }
    else if (p + len > end) warn(st, "The UDP length says " + len + " bytes but " + (end - p) + " are present: cut short.", "warn");
    L(st, "udp", "UDP", p, p + 8, [F("Source port", port(sp), p, 2), F("Destination port", port(dp), p + 2, 2), F("Length", len + " bytes (header and data)", p + 4, 2), F("Checksum", "0x" + ck.toString(16).padStart(4, "0") + (c ? "  (" + c + ")" : ""), p + 6, 2)], { short: "UDP", summary: sp + " > " + dp });
    if (c === "WRONG") warn(st, "The UDP checksum is wrong. On a packet captured at the sender that is usually checksum offload; on a received packet it means the data was damaged.");
    const e2 = Math.min(end, p + len), dl = Math.max(0, e2 - p - 8);
    st.summary = (st.l3 ? st.l3.src + ":" + sp + " > " + st.l3.dst + ":" + dp : "") + " UDP, " + dl + " bytes of data";
    st.l4 = { sp, dp, dataLen: dl, p: p + 8, end: e2, proto: 17 };
    const n0 = st.layers.length; app(st, "udp", sp, dp, p + 8, e2, dl); if (st.layers.length === n0) dataLayer(st, p + 8, e2);
  }

  function icmp4(st, p, end) {
    const b = st.b; if (end - p < 8) { warn(st, "ICMP needs at least 8 bytes.", "bad"); return; }
    const t = b[p], c = b[p + 1], ck = u16(b, p + 2);
    const ok = st.l3 && st.l3.complete ? (fold(sum16(b, p, end)) === 0xffff ? "correct" : "WRONG") : null;
    const f = [F("Type", t + " " + (ICMP4[t] || ""), p, 1), F("Code", c + (t === 3 ? " " + (UNREACH4[c] || "") : ""), p + 1, 1), F("Checksum", "0x" + ck.toString(16).padStart(4, "0") + (ok ? "  (" + ok + ")" : ""), p + 2, 2)];
    let sumTxt = ICMP4[t] || "ICMP type " + t;
    if (t === 0 || t === 8) { f.push(F("Identifier", String(u16(b, p + 4)), p + 4, 2), F("Sequence", String(u16(b, p + 6)), p + 6, 2), F("Data", (end - p - 8) + " bytes", p + 8, end - p - 8)); sumTxt += " id " + u16(b, p + 4) + " seq " + u16(b, p + 6); }
    else if (t === 3 && c === 4) f.push(F("Next-hop MTU", String(u16(b, p + 6)), p + 6, 2));
    else if (t === 5) f.push(F("Gateway", ip4(b, p + 4), p + 4, 4));
    if (t === 3) sumTxt += ": " + (UNREACH4[c] || "code " + c);
    L(st, "icmp", "ICMP", p, Math.min(end, t === 0 || t === 8 ? end : p + 8), f, { short: "ICMP", summary: sumTxt });
    st.summary = (st.l3 ? st.l3.src + " > " + st.l3.dst + " " : "") + "ICMP " + sumTxt;
    if (ok === "WRONG") warn(st, "The ICMP checksum is wrong.");
    if (t === 3 && c === 4) warn(st, "Fragmentation needed: the packet did not fit and Don't Fragment was set. The next-hop MTU above is the size that does fit; this is how path MTU discovery works, and blocking these messages causes connections that hang on large packets.", "info");
    if (t === 3 && (c === 9 || c === 10 || c === 13)) warn(st, "A device on the way refuses the traffic on purpose (a firewall or ACL with a reject rule).", "info");
    if ((t === 3 || t === 11 || t === 4 || t === 5) && end - p > 8) { const q = p + 8; L(st, "icmpq", "The packet this message is about (quoted)", q, end, [F("Quoted data", (end - q) + " bytes: the start of the original packet", q, end - q)], { short: "quoted" }); const save = st.l3; st.paddedOK = false; st.quoted = true; const sv = st.summary; ipv4q(st, q, end); st.summary = sv; st.l3 = save; }
  }
  // a quoted packet may be cut short on purpose: decode quietly
  function ipv4q(st, q, end) {
    const b = st.b; if (end - q < 20 || b[q] >> 4 !== 4) return; const ihl = (b[q] & 15) * 4; if (end - q < ihl + 4) return;
    const proto = b[q + 9], s = ip4(b, q + 12), d = ip4(b, q + 16);
    const fl = [F("Source", s, q + 12, 4), F("Destination", d, q + 16, 4), F("Protocol", proto + " " + (PROTO[proto] || ""), q + 9, 1)];
    if ((proto === 6 || proto === 17) && end - q >= ihl + 4) fl.push(F("Ports", port(u16(b, q + ihl)) + " > " + port(u16(b, q + ihl + 2)), q + ihl, 4));
    st.layers[st.layers.length - 1].fields = st.layers[st.layers.length - 1].fields.concat([F("About this connection", s + " > " + d + " " + (PROTO[proto] || proto) + (fl.length > 3 ? ", " + fl[3].value : ""), q, Math.min(end - q, ihl + 4))]);
  }

  function icmp6(st, p, end) {
    const b = st.b; if (end - p < 4) { warn(st, "ICMPv6 needs at least 4 bytes.", "bad"); return; }
    const t = b[p], c = b[p + 1], ck = u16(b, p + 2);
    const ok = l4check(st, p, end, 58, 6);
    const f = [F("Type", t + " " + (ICMP6[t] || ""), p, 1), F("Code", c + (t === 1 ? " " + (UNREACH6[c] || "") : ""), p + 1, 1), F("Checksum", "0x" + ck.toString(16).padStart(4, "0") + (ok ? "  (" + ok + ")" : ""), p + 2, 2)];
    let sumTxt = ICMP6[t] || "ICMPv6 type " + t;
    if ((t === 128 || t === 129) && end - p >= 8) { f.push(F("Identifier", String(u16(b, p + 4)), p + 4, 2), F("Sequence", String(u16(b, p + 6)), p + 6, 2), F("Data", (end - p - 8) + " bytes", p + 8, end - p - 8)); sumTxt += " id " + u16(b, p + 4) + " seq " + u16(b, p + 6); }
    else if (t === 2 && end - p >= 8) { f.push(F("MTU", String(u32(b, p + 4)), p + 4, 4)); sumTxt += " (MTU " + u32(b, p + 4) + ")"; }
    else if ((t === 135 || t === 136) && end - p >= 24) {
      const tgt = ip6(b, p + 8); f.push(F(t === 135 ? "Reserved" : "Flags", t === 136 ? ((b[p + 4] & 0x80 ? "Router " : "") + (b[p + 4] & 0x40 ? "Solicited " : "") + (b[p + 4] & 0x20 ? "Override" : "")).trim() || "none" : "0", p + 4, 4), F("Target address", tgt, p + 8, 16));
      sumTxt += " for " + tgt; ndOptions(st, f, p + 24, end);
    }
    else if (t === 134 && end - p >= 16) { f.push(F("Hop limit", String(b[p + 4]), p + 4, 1), F("Flags", (b[p + 5] & 0x80 ? "Managed (use DHCPv6 for addresses) " : "") + (b[p + 5] & 0x40 ? "Other (DHCPv6 for other settings) " : "") || "none", p + 5, 1), F("Router lifetime", u16(b, p + 6) + " s" + (u16(b, p + 6) === 0 ? " (not a default router)" : ""), p + 6, 2), F("Reachable time", u32(b, p + 8) + " ms", p + 8, 4), F("Retrans timer", u32(b, p + 12) + " ms", p + 12, 4)); ndOptions(st, f, p + 16, end); }
    else if (t === 133 && end - p >= 8) ndOptions(st, f, p + 8, end);
    L(st, "icmp6", "ICMPv6", p, end, f, { short: "ICMPv6", summary: sumTxt });
    st.summary = (st.l3 ? st.l3.src + " > " + st.l3.dst + " " : "") + "ICMPv6 " + sumTxt;
    if (ok === "WRONG") warn(st, "The ICMPv6 checksum is wrong.");
    if (t === 2) warn(st, "Packet Too Big: the packet did not fit a link. IPv6 routers never fragment, so the sender must send smaller packets; blocking this message makes connections hang on large packets.", "info");
    if ((t === 135 || t === 136 || t === 133 || t === 134) && st.l3 && st.l3.v === 6 && b[st.l3.o + 7] !== 255) warn(st, "Neighbor discovery messages must have hop limit 255; this one has " + b[st.l3.o + 7] + " (it may have crossed a router: hosts ignore it).");
  }
  function ndOptions(st, f, i, end) {
    const b = st.b, NT = { 1: "Source link-layer address", 2: "Target link-layer address", 3: "Prefix information", 5: "MTU", 25: "Recursive DNS server", 31: "DNS search list" };
    while (i + 8 <= end) {
      const t = b[i], l = b[i + 1] * 8; if (!l || i + l > end) break;
      let v = hex(b, i + 2, i + l);
      if ((t === 1 || t === 2) && l === 8) v = mac(b, i + 2); else if (t === 5) v = String(u32(b, i + 4)); else if (t === 3 && l === 32) v = ip6(b, i + 16) + "/" + b[i + 2] + ", valid " + u32(b, i + 4) + " s, preferred " + u32(b, i + 8) + " s" + (b[i + 3] & 0x40 ? ", SLAAC" : "") + (b[i + 3] & 0x80 ? ", on-link" : "");
      f.push(F("Option: " + (NT[t] || "type " + t), v, i, l)); i += l;
    }
  }

  function gre(st, p, end) {
    const b = st.b; if (end - p < 4) { warn(st, "GRE needs at least 4 bytes.", "bad"); return; }
    const fl = u16(b, p), pt = u16(b, p + 2); let i = p + 4; const f = [F("Flags", (fl & 0x8000 ? "checksum " : "") + (fl & 0x2000 ? "key " : "") + (fl & 0x1000 ? "sequence " : "") || "none", p, 2), F("Protocol", "0x" + pt.toString(16).padStart(4, "0") + (ETYPE[pt] ? " " + ETYPE[pt] : pt === 0x6558 ? " Ethernet (transparent bridging)" : ""), p + 2, 2)];
    if (fl & 0x8000) i += 4; if (fl & 0x2000) { f.push(F("Key", String(u32(b, i)), i, 4)); i += 4; } if (fl & 0x1000) { f.push(F("Sequence", String(u32(b, i)), i, 4)); i += 4; }
    L(st, "gre", "GRE tunnel", p, i, f, { short: "GRE" });
    if (pt === 0x0800) ipv4(st, i); else if (pt === 0x86dd) ipv6(st, i); else if (pt === 0x6558) eth(st, i);
  }
  function esp(st, p, end) {
    const b = st.b; if (end - p < 8) { warn(st, "ESP needs at least 8 bytes.", "bad"); return; }
    L(st, "esp", "ESP (IPsec)", p, end, [F("SPI", "0x" + u32(b, p).toString(16).padStart(8, "0") + " (" + u32(b, p) + ")", p, 4), F("Sequence number", String(u32(b, p + 4)), p + 4, 4), F("Encrypted data", (end - p - 8) + " bytes: IV, payload, padding and integrity tag. Nothing inside can be read without the keys.", p + 8, end - p - 8)], { short: "ESP" });
    warn(st, "ESP is encrypted: the packet's contents cannot be shown. The SPI and sequence number are the only readable fields; a stalled sequence number or a missing SPI match on the peer explains many IPsec problems.", "info");
    st.summary = (st.l3 ? st.l3.src + " > " + st.l3.dst + " " : "") + "ESP SPI 0x" + u32(b, p).toString(16);
  }
  function ah(st, p, end, ver) {
    const b = st.b; if (end - p < 12) { warn(st, "AH needs at least 12 bytes.", "bad"); return; }
    const nh = b[p], len = (b[p + 1] + 2) * 4;
    L(st, "ah", "AH (IPsec)", p, Math.min(end, p + len), [F("Next header", nh + " " + (PROTO[nh] || ""), p, 1), F("Length", len + " bytes", p + 1, 1), F("SPI", "0x" + u32(b, p + 4).toString(16), p + 4, 4), F("Sequence number", String(u32(b, p + 8)), p + 8, 4)], { short: "AH" });
    transport(st, nh, p + len, end, ver);
  }

  // ---- applications ----
  function app(st, kind, sp, dp, p, end, dl) {
    const b = st.b, ports = [sp, dp];
    if (kind === "udp" && (ports.includes(67) || ports.includes(68))) return dhcp(st, p, end);
    if (kind === "udp" && dp === 4789 && dl >= 8) return vxlan(st, p, end);
    if (ports.includes(53) && dl > 0) return dns(st, p, end, kind);
    if (kind === "udp" && (ports.includes(546) || ports.includes(547)) && dl > 0) { const t = b[p], T = { 1: "SOLICIT", 2: "ADVERTISE", 3: "REQUEST", 4: "CONFIRM", 5: "RENEW", 6: "REBIND", 7: "REPLY", 8: "RELEASE", 9: "DECLINE", 11: "INFORMATION-REQUEST", 12: "RELAY-FORW", 13: "RELAY-REPL" }; L(st, "dhcp6", "DHCPv6", p, end, [F("Message type", t + " " + (T[t] || ""), p, 1), F("Data", (end - p - 1) + " bytes of options (not decoded here)", p + 1, end - p - 1)], { short: "DHCPv6" }); st.summary = "DHCPv6 " + (T[t] || t); return; }
    if (kind === "tcp" && dl > 0 && (ports.includes(443) || ports.includes(993) || ports.includes(465) || ports.includes(995))) {
      if (b[p] === 0x16 && b[p + 1] === 3 && dl >= 6) { const hs = b[p + 5], HN = { 1: "ClientHello", 2: "ServerHello", 11: "Certificate", 12: "ServerKeyExchange", 14: "ServerHelloDone", 16: "ClientKeyExchange", 20: "Finished" }; L(st, "tls", "TLS handshake record", p, Math.min(end, p + 6), [F("Record type", "22 handshake", p, 1), F("Version", b[p + 1] + "." + b[p + 2], p + 1, 2), F("Handshake type", hs + " " + (HN[hs] || ""), p + 5, 1)], { short: "TLS" }); st.summary += " (TLS " + (HN[hs] || "handshake") + ")"; }
      else if (b[p] === 0x17 && b[p + 1] === 3) L(st, "tls", "TLS application data", p, Math.min(end, p + 5), [F("Record type", "23 application data (encrypted)", p, 1)], { short: "TLS" });
      return;
    }
    if (kind === "tcp" && dl > 0 && (ports.includes(80) || ports.includes(8080)) && /^(GET|POST|PUT|HEAD|DELETE|OPTIONS|PATCH|HTTP\/)/.test(String.fromCharCode(...Array.from(b.slice(p, Math.min(end, p + 8)))))) { const line = String.fromCharCode(...Array.from(b.slice(p, Math.min(end, p + 120)))).split(/\r?\n/)[0]; L(st, "http", "HTTP (clear text)", p, end, [F("First line", line, p, Math.min(end - p, line.length))], { short: "HTTP" }); st.summary += " (" + line.slice(0, 60) + ")"; warn(st, "HTTP in clear text: anyone on the path can read it.", "info"); }
  }

  function dns(st, p, end, kind) {
    const b = st.b; let o = p;
    if (kind === "tcp") { if (end - p < 2) return; o = p + 2; }
    if (end - o < 12) return;
    const id = u16(b, o), fl = u16(b, o + 2), qd = u16(b, o + 4), an = u16(b, o + 6), ns = u16(b, o + 8), ar = u16(b, o + 10);
    const qr = fl >> 15, op = (fl >> 11) & 15, rc = fl & 15;
    const RC = { 0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN (the name does not exist)", 4: "NOTIMP", 5: "REFUSED" };
    const TY = { 1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 12: "PTR", 15: "MX", 16: "TXT", 28: "AAAA", 33: "SRV", 43: "DS", 46: "RRSIG", 48: "DNSKEY", 64: "SVCB", 65: "HTTPS", 255: "ANY", 257: "CAA" };
    function name(i) { const labels = []; let g = 0, jumped = false, next = -1; for (;;) { if (i >= end || g++ > 100) return null; const l = b[i]; if (l === 0) { if (!jumped) next = i + 1; break; } if ((l & 0xc0) === 0xc0) { if (i + 1 >= end) return null; if (!jumped) next = i + 2; jumped = true; i = o + (((l & 0x3f) << 8) | b[i + 1]); continue; } if (l > 63 || i + 1 + l > end) return null; labels.push(String.fromCharCode(...Array.from(b.slice(i + 1, i + 1 + l)))); i += 1 + l; } return { n: labels.join(".") || ".", next }; }
    const f = [F("Transaction ID", "0x" + id.toString(16).padStart(4, "0"), o, 2), F("Flags", (qr ? "response" : "query") + (op ? ", opcode " + op : "") + (qr && fl & 0x400 ? ", authoritative" : "") + (fl & 0x200 ? ", truncated (retry over TCP)" : "") + (fl & 0x100 ? ", recursion desired" : "") + (qr && fl & 0x80 ? ", recursion available" : "") + (qr ? ", " + (RC[rc] || "rcode " + rc) : ""), o + 2, 2),
      F("Counts", qd + " question, " + an + " answer, " + ns + " authority, " + ar + " additional", o + 4, 8)];
    let i = o + 12, qtext = "";
    for (let k = 0; k < qd && i < end; k++) { const n = name(i); if (!n) break; const ty = u16(b, n.next), cl = u16(b, n.next + 2); f.push(F("Question", n.n + "  type " + (TY[ty] || ty) + (cl !== 1 ? ", class " + cl : ""), i, n.next + 4 - i)); if (!qtext) qtext = n.n + " " + (TY[ty] || ty); i = n.next + 4; }
    L(st, "dns", "DNS" + (kind === "tcp" ? " (over TCP)" : ""), o, Math.min(end, i), f, { short: "DNS", summary: (qr ? "response " : "query ") + qtext });
    st.summary = (st.l3 ? st.l3.src + " > " + st.l3.dst + " " : "") + "DNS " + (qr ? "response" : "query") + " " + qtext + (qr ? " " + (RC[rc] || "").split(" ")[0] + ", " + an + " answer" + (an === 1 ? "" : "s") : "");
    if (fl & 0x200) warn(st, "The truncated bit is set: the answer did not fit in a UDP packet and the client must ask again over TCP. If TCP port 53 is blocked, such lookups fail.", "info");
    if (qr && rc === 3) warn(st, "NXDOMAIN: the resolver says this name does not exist.", "info");
    if (qr && rc === 2) warn(st, "SERVFAIL: the resolver could not get an answer (a broken delegation, DNSSEC failure, or an unreachable server).", "info");
    if (qr && rc === 5) warn(st, "REFUSED: the server will not answer this client (an access list, or recursion is off).", "info");
    st.noTrailer = false;
  }

  function vxlan(st, p, end) {
    const b = st.b; const vni = (b[p + 4] << 16) | (b[p + 5] << 8) | b[p + 6];
    L(st, "vxlan", "VXLAN", p, p + 8, [F("Flags", "0x" + h2(b[p]) + (b[p] & 8 ? " (VNI valid)" : " (VNI flag not set)"), p, 1), F("VNI (network identifier)", String(vni), p + 4, 3)], { short: "VXLAN" });
    eth(st, p + 8);
  }

  function dhcp(st, p, end) {
    const b = st.b, D = typeof window !== "undefined" ? window.DhcpOpt : (typeof require !== "undefined" ? require("./dhcpopt.js") : null);
    if (!D) { L(st, "dhcp", "DHCP", p, end, [F("Data", (end - p) + " bytes (the DHCP reader is not loaded)", p, end - p)], { short: "DHCP" }); return; }
    const m = D.decodeMessage(b.slice(p, end));
    if (m.error) { L(st, "dhcp", "DHCP", p, end, [F("Data", m.error, p, end - p)], { short: "DHCP" }); warn(st, m.error, "warn"); return; }
    const f = m.fields.map(x => F(x.name, x.value, p + x.start, x.len));
    for (const o of m.options) f.push(F("Option " + o.code + " " + o.name, (o.text || "") + (o.lines && o.lines.length > 1 && o.text.length > 160 ? "" : ""), p + 240, 0));
    L(st, "dhcp", "DHCP", p, end, f, { short: "DHCP", summary: m.type });
    st.summary = (st.l3 ? st.l3.src + " > " + st.l3.dst + " " : "") + "DHCP " + (m.type || "message") + " from " + m.mac + (m.yiaddr !== "0.0.0.0" ? ", address " + m.yiaddr : "") + ", transaction 0x" + m.xid;
    for (const n of m.notes) st.notes.push(n);
    if (m.giaddr !== "0.0.0.0") warn(st, "This message came through a DHCP relay (" + m.giaddr + ").", "info");
    if (m.type === "NAK") warn(st, "A DHCP NAK: the server refuses the address the client asked for (wrong network after moving, or the lease is gone). The client starts again with a DISCOVER.", "info");
    if (m.type === "DISCOVER" || m.type === "REQUEST") { const r = m.options.find(o => o.code === 82); if (r) warn(st, "Option 82 (relay agent information) is present: the switch or relay says which port the client is on.", "info"); }
  }

  const api = { parseHex, decode, ip6, hex, ETYPE, PROTO, sum16 };
  if (typeof window !== "undefined") window.PktDecode = api;
  if (typeof module !== "undefined") module.exports = api;
})();
