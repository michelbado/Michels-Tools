/* Shared IPv4 helpers for the network apps. Pure functions, no DOM.
   Addresses are plain Numbers in 0 .. 2^32-1. */
window.IPv4 = (() => {
  const TOTAL = 4294967296;

  function ipToInt(s) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s).trim());
    if (!m) return null;
    let n = 0;
    for (let i = 1; i <= 4; i++) {
      const o = Number(m[i]);
      if (o > 255) return null;
      n = n * 256 + o;
    }
    return n;
  }
  const intToIp = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  const maskInt = p => (p === 0 ? 0 : (0xFFFFFFFF << (32 - p)) >>> 0);

  // dotted netmask -> prefix length, or null when the mask is not contiguous
  function maskToPrefix(s) {
    const n = ipToInt(s);
    if (n === null) return null;
    const inv = (~n) >>> 0;
    if ((inv & (inv + 1)) !== 0) return null;
    let p = 0;
    for (let x = n; x; x = (x << 1) >>> 0) p++;
    return p;
  }

  // "10.0.0.5", "10.0.0.5/24", "10.0.0.5 255.255.255.0", "10.0.0.5/255.255.255.0"
  // -> { ip, ipText, prefix|null } or null when invalid
  function parseInput(text) {
    const parts = String(text).trim().split(/[\s/]+/).filter(Boolean);
    if (parts.length < 1 || parts.length > 2) return null;
    const ip = ipToInt(parts[0]);
    if (ip === null) return null;
    let prefix = null;
    if (parts.length === 2) {
      prefix = /^\d{1,2}$/.test(parts[1]) ? Number(parts[1]) : maskToPrefix(parts[1]);
      if (prefix === null || prefix > 32) return null;
    }
    return { ip, ipText: parts[0], prefix };
  }

  // the block an address belongs to at a given prefix length
  function blockOf(ip, prefix) {
    const mask = maskInt(prefix);
    const start = (ip & mask) >>> 0;
    const end = (start | (~mask >>> 0)) >>> 0;
    return { start, end, prefix, size: Math.pow(2, 32 - prefix) };
  }

  // everything about one subnet: strings for display plus integer bounds
  function subnetInfo(addr, prefix) {
    const b = blockOf(addr, prefix);
    const mask = maskInt(prefix);
    let first, last, hosts, broadcast = intToIp(b.end), note = "";
    if (prefix <= 30) {
      first = b.start + 1; last = b.end - 1; hosts = b.size - 2;
    } else if (prefix === 31) {
      first = b.start; last = b.end; hosts = 2;
      broadcast = "n/a"; note = "Point-to-point link (RFC 3021): both addresses are usable, no broadcast.";
    } else {
      first = b.start; last = b.start; hosts = 1;
      broadcast = "n/a"; note = "Single host address.";
    }
    return {
      prefix, network: intToIp(b.start), broadcast,
      mask: intToIp(mask), wildcard: intToIp((~mask) >>> 0),
      first: intToIp(first), last: intToIp(last),
      total: b.size, hosts, note,
      startInt: b.start, endInt: b.end, firstInt: first, lastInt: last,
    };
  }

  function trailingZeros(n) {
    if (n === 0) return 32;
    let z = 0;
    while (((n >>> z) & 1) === 0) z++;
    return z;
  }

  // the fewest CIDR blocks that cover start..end exactly: [{ start, prefix }]
  function rangeToCidrs(start, end) {
    const out = [];
    let cur = start;
    while (cur <= end) {
      let size = trailingZeros(cur);
      const remaining = end - cur + 1;
      while (Math.pow(2, size) > remaining) size--;
      out.push({ start: cur, prefix: 32 - size });
      cur += Math.pow(2, size);
    }
    return out;
  }

  // sort and merge overlapping or touching [start, end] ranges
  function mergeRanges(ranges) {
    const r = ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out = [];
    for (const [s, e] of r) {
      const last = out[out.length - 1];
      if (last && s <= last[1] + 1) { if (e > last[1]) last[1] = e; }
      else out.push([s, e]);
    }
    return out;
  }

  const cidrText = (start, prefix) => `${intToIp(start)}/${prefix}`;

  return { TOTAL, ipToInt, intToIp, maskInt, maskToPrefix, parseInput, blockOf, subnetInfo, rangeToCidrs, mergeRanges, cidrText };
})();
