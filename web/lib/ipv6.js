/* IPv6 maths in BigInt: parsing, the two writing styles (RFC 5952), prefixes, address types, subnets, reverse names.
   Pure functions; used by the IPv6 Calculator and the IP & Number Converter (and tested in Node). Exports window.IPv6. */
(() => {
  "use strict";
  const MAX = (1n << 128n) - 1n;

  // "2001:db8::1", "::ffff:192.0.2.1", "[::1]", "fe80::1%eth0" -> { n: BigInt, zone } or null
  function parse(text) {
    let s = String(text == null ? "" : text).trim();
    if (s[0] === "[" && s[s.length - 1] === "]") s = s.slice(1, -1);
    let zone = "";
    const pct = s.indexOf("%");
    if (pct >= 0) { zone = s.slice(pct + 1); s = s.slice(0, pct); if (!/^[0-9A-Za-z._~-]{1,32}$/.test(zone)) return null; }
    if (!s || /[^0-9A-Fa-f:.]/.test(s) || !s.includes(":")) return null;
    let tail = [];
    const lastColon = s.lastIndexOf(":");
    if (s.includes(".")) {
      const v4 = s.slice(lastColon + 1).split(".");
      if (v4.length !== 4 || v4.some(p => !/^(0|[1-9]\d{0,2})$/.test(p) || +p > 255)) return null;
      tail = [(+v4[0] << 8) | +v4[1], (+v4[2] << 8) | +v4[3]];
      s = s.slice(0, lastColon + 1) + "0:0";           // placeholder groups, replaced below
    }
    const dbl = s.split("::");
    if (dbl.length > 2) return null;
    const side = t => t === "" ? [] : t.split(":");
    const head = side(dbl[0]), rest = dbl.length === 2 ? side(dbl[1]) : [];
    if ([...head, ...rest].some(g => !/^[0-9A-Fa-f]{1,4}$/.test(g))) return null;
    let groups;
    if (dbl.length === 2) {
      const fill = 8 - head.length - rest.length;
      if (fill < 1) return null;                         // "::" must stand for at least one group
      groups = [...head, ...Array(fill).fill("0"), ...rest];
    } else { groups = head; if (groups.length !== 8) return null; }
    const vals = groups.map(g => parseInt(g, 16));
    if (tail.length) { vals[6] = tail[0]; vals[7] = tail[1]; }
    let n = 0n;
    for (const v of vals) n = (n << 16n) | BigInt(v);
    return { n, zone, v4tail: tail.length > 0 };
  }

  const groups = n => { const g = []; for (let i = 7; i >= 0; i--) g.push(Number((n >> BigInt(i * 16)) & 0xffffn)); return g; };
  const expand = n => groups(n).map(g => g.toString(16).padStart(4, "0")).join(":");
  // RFC 5952: lower case, no leading zeros, "::" for the LONGEST run of zero groups (the first if tied), never for a single group
  function compress(n) {
    const g = groups(n);
    let best = -1, bestLen = 0;
    for (let i = 0; i < 8;) {
      if (g[i] !== 0) { i++; continue; }
      let j = i; while (j < 8 && g[j] === 0) j++;
      if (j - i > bestLen) { best = i; bestLen = j - i; }
      i = j;
    }
    const hx = a => a.map(x => x.toString(16)).join(":");
    if (bestLen < 2) return hx(g);
    return hx(g.slice(0, best)) + "::" + hx(g.slice(best + bestLen));
  }
  const v4Of = n => `${Number((n >> 24n) & 255n)}.${Number((n >> 16n) & 255n)}.${Number((n >> 8n) & 255n)}.${Number(n & 255n)}`;
  // ::ffff:192.0.2.1 style (IPv4-mapped); other addresses just use compress()
  const mixed = n => (n >> 32n) === 0xffffn ? "::ffff:" + v4Of(n & 0xffffffffn) : compress(n);

  const maskOf = p => p <= 0 ? 0n : (MAX << BigInt(128 - p)) & MAX;
  const network = (n, p) => n & maskOf(p);
  const last = (n, p) => (n & maskOf(p)) | (MAX ^ maskOf(p));
  const count = p => 1n << BigInt(128 - p);

  // "2001:db8::/32" or a bare address -> { n, prefix (or null), zone }
  function parseCidr(text) {
    const s = String(text == null ? "" : text).trim(), i = s.indexOf("/");
    const a = parse(i < 0 ? s : s.slice(0, i));
    if (!a) return null;
    if (i < 0) return { n: a.n, prefix: null, zone: a.zone };
    const ps = s.slice(i + 1).trim();
    if (!/^\d{1,3}$/.test(ps) || +ps > 128) return null;
    return { n: a.n, prefix: +ps, zone: a.zone };
  }

  // Address blocks, most specific first. [prefix text, label, scope note]
  const BLOCKS = [
    ["::/128", "Unspecified address", "Means 'no address yet'. Never a destination."],
    ["::1/128", "Loopback", "This computer itself."],
    ["::ffff:0:0/96", "IPv4-mapped address", "An IPv4 address written inside IPv6 (used by software, not on the wire)."],
    ["64:ff9b::/96", "NAT64 translation (RFC 6052)", "Reaches IPv4-only servers through a translator."],
    ["64:ff9b:1::/48", "Local-use NAT64 (RFC 8215)", ""],
    ["100::/64", "Discard-only (RFC 6666)", "Traffic sent here is dropped on purpose."],
    ["2001::/32", "Teredo tunnel (RFC 4380)", "IPv6 carried over IPv4 UDP; old and rare."],
    ["2001:db8::/32", "Documentation (RFC 3849)", "Reserved for examples; never used on a real network."],
    ["2001:10::/28", "ORCHID (deprecated)", ""],
    ["2001:20::/28", "ORCHIDv2", ""],
    ["2002::/16", "6to4 tunnel (RFC 3056, deprecated)", "Carries an IPv4 address in bits 17-48."],
    ["3fff::/20", "Documentation (RFC 9637)", "Reserved for examples."],
    ["fc00::/7", "Unique local address (ULA, RFC 4193)", "Private addresses, like 10.x in IPv4. Not routed on the internet."],
    ["fe80::/10", "Link-local", "Only valid on the local link; needs the interface name (fe80::1%eth0)."],
    ["fec0::/10", "Site-local (deprecated)", "Old private range, no longer used."],
    ["ff00::/8", "Multicast", "One-to-many delivery."],
    ["2000::/3", "Global unicast", "Normal internet addresses."],
  ];
  const BLK = BLOCKS.map(([c, label, note]) => { const x = parseCidr(c); return { n: x.n, p: x.prefix, label, note, text: c }; });
  // the most specific block holding the address
  function classify(n) {
    let best = null;
    for (const b of BLK) if (network(n, b.p) === b.n && (!best || b.p > best.p)) best = b;
    return best ? { label: best.label, note: best.note, block: best.text } : { label: "Reserved / unassigned", note: "Not in any block that is in use today.", block: "" };
  }
  function multicastInfo(n) {
    if ((n >> 120n) !== 0xffn) return null;
    const flags = Number((n >> 116n) & 15n), scope = Number((n >> 112n) & 15n);
    const scopes = { 1: "interface-local", 2: "link-local", 3: "realm-local", 4: "admin-local", 5: "site-local", 8: "organization-local", 14: "global" };
    return { scope: scopes[scope] || "scope " + scope, transient: !!(flags & 1), prefixBased: !!(flags & 2), rendezvous: !!(flags & 4) };
  }

  // split a prefix into longer ones; returns { total: BigInt, list: [BigInt starts] (at most limit) }
  function subnets(n, p, newP, limit) {
    if (newP < p || newP > 128) return null;
    const total = 1n << BigInt(newP - p), step = 1n << BigInt(128 - newP), base = network(n, p), list = [];
    for (let i = 0n; i < total && list.length < limit; i++) list.push(base + i * step);
    return { total, list };
  }

  // 32 nibbles reversed: the name used for reverse DNS. A prefix gives the zone that covers it (rounded DOWN to a whole nibble: 4 bits).
  function reverseName(n, prefix) {
    const hex = n.toString(16).padStart(32, "0"), len = prefix == null ? 32 : Math.floor(prefix / 4);
    return hex.slice(0, len).split("").reverse().join(".") + (len ? "." : "") + "ip6.arpa";
  }
  function fromReverse(name) {
    const m = /^((?:[0-9a-f]\.){1,32})ip6\.arpa\.?$/i.exec(String(name).trim());
    if (!m) return null;
    const nib = m[1].split(".").filter(Boolean).reverse();
    return { n: BigInt("0x" + nib.join("").padEnd(32, "0")), prefix: nib.length * 4, full: nib.length === 32 };
  }

  // modified EUI-64 (SLAAC) interface id: ....:XXXX:XXff:feXX:XXXX -> the MAC address, or null
  function macFromEui64(n) {
    const g = groups(n);
    if ((g[5] & 0xff) !== 0xff || (g[6] >> 8) !== 0xfe) return null;
    const b = [g[4] >> 8, g[4] & 255, g[5] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255];
    b[0] ^= 2;
    return b.map(x => x.toString(16).padStart(2, "0")).join(":");
  }
  function solicitedNode(n) { return (0xff02n << 112n) | (1n << 32n) | (0xffn << 24n) | (n & 0xffffffn); }
  // the IPv4 address inside a 6to4 (2002::/16) or Teredo (obfuscated) address, or "" 
  function embeddedV4(n) {
    if ((n >> 112n) === 0x2002n) return v4Of((n >> 80n) & 0xffffffffn);
    return "";
  }


  const big = b => b.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const words = b => b === 1n ? "1 address" : big(b) + " addresses";
  // What the IPv6 Calculator shows for one input. splitTo: optional longer prefix length to split into.
  function describe(text, splitTo, limit) {
    const c = parseCidr(text);
    if (!c) return { error: String(text).trim() ? "That is not a valid IPv6 address or prefix. Example: 2001:db8:abcd:12::1/64" : "Type an IPv6 address, or an address with a prefix length." };
    const n = c.n, p = c.prefix, cls = classify(n), notes = [], sections = [];
    const addr = [["Short form", compress(n)], ["Full form", expand(n)], ["Type", cls.label, cls.note || ""]];
    if (c.zone) addr.push(["Interface (zone)", c.zone]);
    if ((n >> 32n) === 0xffffn) addr.push(["Contained IPv4 address", v4Of(n & 0xffffffffn)]);
    const e4 = embeddedV4(n); if (e4) addr.push(["Embedded IPv4 address", e4, "Inside a 6to4 address"]);
    const mc = multicastInfo(n); if (mc) addr.push(["Multicast scope", mc.scope + (mc.transient ? ", temporary group" : ", permanent group")]);
    addr.push(["Interface identifier (last 64 bits)", groups(n).slice(4).map(x => x.toString(16)).join(":")]);
    const mac = macFromEui64(n);
    if (mac) { addr.push(["MAC address inside it", mac, "This address was built from the network card's MAC (EUI-64), so it identifies the device."]); notes.push({ level: "warn", text: "This address carries the device's MAC address. Privacy extensions (random identifiers) avoid that." }); }
    addr.push(["Reverse DNS name", reverseName(n)]);
    if (!mc) addr.push(["Solicited-node multicast", compress(solicitedNode(n)), "Where neighbours ask who owns this address."]);
    sections.push({ title: "Address", rows: addr, mono: false });
    let summary = compress(n) + (p == null ? "" : "/" + p) + " : " + cls.label;
    if (p != null) {
      const net = network(n, p), lst = last(n, p), rows = [
        ["Prefix", compress(net) + "/" + p], ["First address", compress(net)], ["Last address", compress(lst)],
        ["Number of addresses", words(count(p)), count(p) >= 1n << 64n ? "That is 2^" + (128 - p) + (128 - p === 64 ? ", the usual size of one network (a /64)" : "") : "2^" + (128 - p)],
        ["Number of /64 networks", p <= 64 ? big(1n << BigInt(64 - p)) : "less than one"],
        ["Reverse DNS zone", reverseName(net, p), p % 4 ? "A prefix that does not end on a multiple of 4 bits needs several zones; this one covers the whole range rounded down to " + (Math.floor(p / 4) * 4) + " bits." : ""],
      ];
      sections.push({ title: "Prefix /" + p, rows });
      if (net !== n) notes.push({ level: "", text: "The address is not the first one of its /" + p + " prefix; the prefix itself starts at " + compress(net) + "." });
      if (p > 64 && p < 127) notes.push({ level: "warn", text: "Networks longer than /64 break SLAAC (automatic addresses) on most devices. A normal LAN gets a /64." });
      if (p === 127) notes.push({ level: "", text: "/127 is used on point-to-point links (RFC 6164)." });
      if (p < 48 && cls.label === "Global unicast") notes.push({ level: "", text: "A site normally receives a /48 to /56 from its provider; a /" + p + " is an ISP-sized block." });
      if (splitTo != null) {
        const sp = subnets(n, p, splitTo, limit || 256);
        if (!sp) notes.push({ level: "bad", text: "The new prefix length must be between /" + p + " and /128." });
        else return { summary, notes, sections, split: { prefix: splitTo, total: sp.total, shown: sp.list.length, list: sp.list.map(x => compress(x) + "/" + splitTo) } };
      }
    } else notes.push({ level: "", text: "No prefix length given, so only the address is described. Add /64 (or any length) to see the network." });
    return { summary, notes, sections };
  }

  const api = { describe, MAX, parse, groups, expand, compress, mixed, v4Of, maskOf, network, last, count, parseCidr, classify, multicastInfo, subnets, reverseName, fromReverse, macFromEui64, solicitedNode, embeddedV4 };
  if (typeof window !== "undefined") window.IPv6 = api;
  if (typeof module !== "undefined") module.exports = api;
})();
