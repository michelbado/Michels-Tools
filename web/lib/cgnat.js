/* CGNAT port-block calculator. Subscribers (private addresses) are laid out one after the other over a pool of public addresses; each one gets
   a fixed block of ports ("deterministic" layout, as in RFC 7422). From the layout you can answer both questions an operator is asked:
   "which public address and ports does this subscriber use?" and "who was behind this public address and port?". Pure arithmetic on what is typed,
   IPv4 only. Vendors lay the blocks out in their own way: this is the plain sequential layout, and the page says so. Exports window.CgNat. */
(() => {
  "use strict";
  const ipToInt = s => {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s).trim());
    if (!m) return null;
    let n = 0;
    for (let i = 1; i <= 4; i++) { const o = Number(m[i]); if (o > 255) return null; n = n * 256 + o; }
    return n;
  };
  const intToIp = n => [Math.floor(n / 16777216) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

  // "a.b.c.d", "a.b.c.d/len", "a.b.c.d-e.f.g.h" (also "a.b.c.d - e.f.g.h"), separated by new lines, commas, semicolons or spaces
  function parseRanges(text) {
    const ranges = [], errors = [], notes = [];
    const src = String(text || "").replace(/#.*$/gm, "").replace(/\s*-\s*/g, "-").split(/[\s,;]+/).filter(Boolean);
    let total = 0;
    for (const tok of src) {
      let m;
      if ((m = /^([\d.]+)\/(\d{1,2})$/.exec(tok))) {
        const ip = ipToInt(m[1]), len = Number(m[2]);
        if (ip === null || len > 32) { errors.push("Not a valid network: " + tok); continue; }
        const size = Math.pow(2, 32 - len), start = Math.floor(ip / size) * size;
        if (start !== ip) notes.push(tok + " has host bits set; the whole network " + intToIp(start) + "/" + len + " is used.");
        ranges.push({ start, count: size, label: intToIp(start) + "/" + len }); total += size;
      } else if ((m = /^([\d.]+)-([\d.]+)$/.exec(tok))) {
        const a = ipToInt(m[1]), b = ipToInt(m[2]);
        if (a === null || b === null) { errors.push("Not a valid range: " + tok); continue; }
        if (b < a) { errors.push("The range ends before it starts: " + tok); continue; }
        ranges.push({ start: a, count: b - a + 1, label: intToIp(a) + "-" + intToIp(b) }); total += b - a + 1;
      } else {
        const a = ipToInt(tok);
        if (a === null) { errors.push("Not an address, network or range: " + tok); continue; }
        ranges.push({ start: a, count: 1, label: tok }); total += 1;
      }
    }
    for (let i = 0; i < ranges.length; i++) for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i], b = ranges[j];
      if (a.start < b.start + b.count && b.start < a.start + a.count) errors.push("These overlap: " + a.label + " and " + b.label);
    }
    return { ranges, total, errors, notes };
  }

  const idxOf = (ranges, ip) => { let base = 0; for (const r of ranges) { if (ip >= r.start && ip < r.start + r.count) return base + (ip - r.start); base += r.count; } return -1; };
  const addrAt = (ranges, i) => { for (const r of ranges) { if (i < r.count) return r.start + i; i -= r.count; } return null; };

  // Smallest network (prefix length) that holds n addresses
  const prefixFor = n => { let len = 32; while (len > 0 && Math.pow(2, 32 - len) < n) len--; return len; };

  function ports(o) {
    const portStart = o.portStart == null ? 1024 : Number(o.portStart), portEnd = o.portEnd == null ? 65535 : Number(o.portEnd);
    if (!Number.isInteger(portStart) || !Number.isInteger(portEnd) || portStart < 1 || portEnd > 65535 || portStart > portEnd) return { error: "The port range must lie between 1 and 65535, first port not above the last." };
    const usable = portEnd - portStart + 1;
    let blockSize, perIp;
    if (o.mode === "perip") {
      perIp = Number(o.perIp);
      if (!Number.isInteger(perIp) || perIp < 1) return { error: "Subscribers per public address must be a whole number, at least 1." };
      if (perIp > usable) return { error: "That is more subscribers per address than there are ports (" + usable + ")." };
      blockSize = Math.floor(usable / perIp);
    } else {
      blockSize = Number(o.blockSize);
      if (!Number.isInteger(blockSize) || blockSize < 1) return { error: "Ports per subscriber must be a whole number, at least 1." };
      if (blockSize > usable) return { error: "A block of " + blockSize + " ports does not fit in the port range (" + usable + " ports)." };
      perIp = Math.floor(usable / blockSize);
    }
    return { portStart, portEnd, usable, blockSize, perIp, unused: usable - blockSize * perIp };
  }

  // o: { subs: parseRanges() result, pool: parseRanges() result, portStart, portEnd, mode: "ports"|"perip", blockSize, perIp }
  function plan(o) {
    const p = ports(o);
    if (p.error) return { error: p.error };
    if (!o.subs || !o.subs.total) return { error: "Enter the private addresses of the subscribers (for example 100.64.0.0/10)." };
    if (!o.pool || !o.pool.total) return { error: "Enter the public pool (for example 203.0.113.0/24)." };
    const subsTotal = o.subs.total, poolTotal = o.pool.total, capacity = poolTotal * p.perIp;
    const ipsNeeded = Math.ceil(subsTotal / p.perIp);
    const notes = [];
    if (subsTotal > capacity) notes.push({ level: "bad", text: "The pool is too small: " + subsTotal.toLocaleString("en-US") + " subscribers need " + ipsNeeded.toLocaleString("en-US") + " public addresses at " + p.blockSize + " ports each, and the pool has " + poolTotal.toLocaleString("en-US") + ". The last " + (subsTotal - capacity).toLocaleString("en-US") + " subscribers get nothing in this layout. Make the pool bigger or the blocks smaller." });
    else if (subsTotal < capacity / 2) notes.push({ level: "info", text: "The pool is more than twice as big as needed: " + ipsNeeded.toLocaleString("en-US") + " addresses are enough for " + subsTotal.toLocaleString("en-US") + " subscribers at " + p.blockSize + " ports each." });
    if (p.blockSize < 500) notes.push({ level: "warn", text: "Only " + p.blockSize + " ports per subscriber is tight: one modern web page or a few apps can open hundreds of connections at once, and a subscriber who runs out of ports sees sites fail to load. Operators commonly give 1,000 to 4,000 or more (RFC 6888 asks that the limit be configurable)." });
    if (p.unused) notes.push({ level: "info", text: p.unused + " port" + (p.unused === 1 ? "" : "s") + " at the end of each public address are left unused (the ports do not divide evenly into blocks)." });
    for (const r of o.subs.ranges) { const a = r.start, e = r.start + r.count - 1; if (!(inRange(a, e, 167772160, 184549375) || inRange(a, e, 2886729728, 2887778303) || inRange(a, e, 3232235520, 3232301055) || inRange(a, e, 1681915904, 1686110207))) notes.push({ level: "warn", text: r.label + " is not private address space (10/8, 172.16/12, 192.168/16, or 100.64/10 shared address space for CGNAT, RFC 6598)." }); }
    for (const r of o.pool.ranges) { const a = r.start, e = r.start + r.count - 1; if (inRange(a, e, 167772160, 184549375) || inRange(a, e, 2886729728, 2887778303) || inRange(a, e, 3232235520, 3232301055) || inRange(a, e, 1681915904, 1686110207) || inRange(a, e, 2130706432, 2147483647)) notes.push({ level: "warn", text: "The public pool " + r.label + " touches private or loopback space; real public addresses are expected here." }); }
    for (const a of o.subs.ranges) for (const b of o.pool.ranges) if (a.start < b.start + b.count && b.start < a.start + a.count) notes.push({ level: "bad", text: "The subscriber range " + a.label + " and the pool " + b.label + " overlap." });
    return { portStart: p.portStart, portEnd: p.portEnd, usable: p.usable, blockSize: p.blockSize, perIp: p.perIp, unused: p.unused,
      subs: o.subs.ranges, pool: o.pool.ranges, subsTotal, poolTotal, capacity, ipsNeeded, poolPrefix: prefixFor(ipsNeeded), fits: subsTotal <= capacity, notes };
  }
  function inRange(a, e, lo, hi) { return a >= lo && e <= hi; }

  // Subscriber index -> public address and port block
  function blockOf(pl, i) {
    const pubIdx = Math.floor(i / pl.perIp), slot = i % pl.perIp;
    const first = pl.portStart + slot * pl.blockSize;
    return { index: i, publicIp: intToIp(addrAt(pl.pool, pubIdx)), portFirst: first, portLast: first + pl.blockSize - 1, slot: slot + 1 };
  }

  function forward(pl, ipText) {
    const ip = ipToInt(ipText);
    if (ip === null) return { error: "That is not an IPv4 address." };
    const i = idxOf(pl.subs, ip);
    if (i < 0) return { error: intToIp(ip) + " is not in the subscriber range you entered." };
    if (i >= pl.capacity) return { error: intToIp(ip) + " is subscriber number " + (i + 1).toLocaleString("en-US") + ", but the pool only serves " + pl.capacity.toLocaleString("en-US") + " (see the warning above): it would get no ports." };
    return blockOf(pl, i);
  }

  function reverse(pl, ipText, portText) {
    const ip = ipToInt(ipText), port = Number(portText);
    if (ip === null) return { error: "That is not an IPv4 address." };
    if (!/^\d+$/.test(String(portText).trim()) || port < 1 || port > 65535) return { error: "The port must be a number from 1 to 65535." };
    const pi = idxOf(pl.pool, ip);
    if (pi < 0) return { error: intToIp(ip) + " is not in the public pool you entered." };
    if (port < pl.portStart) return { error: "Port " + port + " is below the first translated port (" + pl.portStart + "): in this layout no subscriber is given it." };
    if (port > pl.portEnd) return { error: "Port " + port + " is above the last translated port (" + pl.portEnd + "): in this layout no subscriber is given it." };
    const slot = Math.floor((port - pl.portStart) / pl.blockSize);
    if (slot >= pl.perIp) return { error: "Port " + port + " lies in the unused ports at the end of the range: no subscriber has it." };
    const i = pi * pl.perIp + slot;
    if (i >= pl.subsTotal) return { error: "Nobody: the subscriber range has only " + pl.subsTotal.toLocaleString("en-US") + " addresses, so this block is not used." };
    const b = blockOf(pl, i);
    return { privateIp: intToIp(addrAt(pl.subs, i)), publicIp: b.publicIp, portFirst: b.portFirst, portLast: b.portLast, index: i, slot: b.slot };
  }

  // How many public addresses a number of subscribers needs; or how big a block a pool allows
  function sizing(o) {
    const n = Number(o.subscribers);
    if (!Number.isInteger(n) || n < 1) return { error: "The number of subscribers must be a whole number, at least 1." };
    const p = ports(Object.assign({}, o, o.pool ? { mode: "perip", perIp: Math.max(1, Math.ceil(n / Number(o.pool))) } : {}));
    if (p.error) return { error: p.error };
    const ips = Math.ceil(n / p.perIp);
    return { subscribers: n, blockSize: p.blockSize, perIp: p.perIp, ips, prefix: prefixFor(ips), poolSize: Math.pow(2, 32 - prefixFor(ips)), unused: p.unused };
  }

  function table(pl, from, count) {
    const rows = [], end = Math.min(pl.subsTotal, pl.capacity, from + count);
    for (let i = Math.max(0, from); i < end; i++) { const b = blockOf(pl, i); rows.push([intToIp(addrAt(pl.subs, i)), b.publicIp, b.portFirst + "-" + b.portLast]); }
    return rows;
  }
  function csv(pl, max) {
    const n = Math.min(pl.subsTotal, pl.capacity);
    if (n > (max || 200000)) return null;
    const out = ["private_ip,public_ip,port_first,port_last"];
    for (let i = 0; i < n; i++) { const b = blockOf(pl, i); out.push(intToIp(addrAt(pl.subs, i)) + "," + b.publicIp + "," + b.portFirst + "," + b.portLast); }
    return out.join("\n") + "\n";
  }

  const api = { ipToInt, intToIp, parseRanges, plan, forward, reverse, sizing, table, csv, prefixFor, ports, idxOf, addrAt };
  if (typeof window !== "undefined") window.CgNat = api;
  if (typeof module !== "undefined") module.exports = api;
})();
