/* IP & number converter: every common way to write an IPv4 or IPv6 address, and back. Pure; exports window.IPConv. */
(() => {
  "use strict";
  // resolved on first use: the shell loads the scripts of an app in no fixed order
  let v6 = null;
  const V6 = new Proxy({}, { get: (_, k) => (v6 || (v6 = (typeof window !== "undefined" && window.IPv6) || require("./ipv6.js")))[k] });

  // The forms browsers and old C code (inet_aton) accept: 1 to 4 parts, each decimal, 0x hex or 0 octal; the LAST part fills all remaining bytes.
  function parseV4Loose(text) {
    const s = String(text).trim();
    if (!s) return null;
    const parts = s.split(".");
    if (parts.length > 4) return null;
    const vals = [];
    for (const p of parts) {
      let v;
      if (/^0[xX][0-9a-fA-F]+$/.test(p)) v = BigInt(p);
      else if (/^0[0-7]+$/.test(p)) v = BigInt("0o" + p.slice(1));
      else if (/^(0|[1-9]\d*)$/.test(p)) v = BigInt(p);
      else return null;
      vals.push(v);
    }
    let n = 0n;
    for (let i = 0; i < vals.length - 1; i++) { if (vals[i] > 255n) return null; n = (n << 8n) | vals[i]; }
    const rest = 4 - (vals.length - 1);
    const lastV = vals[vals.length - 1];
    if (lastV >= (1n << BigInt(8 * rest))) return null;
    n = (n << BigInt(8 * rest)) | lastV;
    const strict = parts.length === 4 && parts.every(p => /^(0|[1-9]\d{0,2})$/.test(p));
    return { n, strict };
  }

  const dotted = n => V6.v4Of(n);
  const bin32 = n => n.toString(2).padStart(32, "0");
  const dottedBin = n => bin32(n).match(/.{8}/g).join(".");
  const dottedHex = n => [24n, 16n, 8n, 0n].map(s => "0x" + ((n >> s) & 255n).toString(16).padStart(2, "0")).join(".");
  const dottedOct = n => [24n, 16n, 8n, 0n].map(s => "0" + ((n >> s) & 255n).toString(8)).join(".");
  const v4Arpa = n => [0n, 8n, 16n, 24n].map(s => ((n >> s) & 255n).toString()).join(".") + ".in-addr.arpa";
  const fromV4Arpa = name => {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.in-addr\.arpa\.?$/i.exec(String(name).trim());
    if (!m || [1, 2, 3, 4].some(i => +m[i] > 255)) return null;
    return (BigInt(m[4]) << 24n) | (BigInt(m[3]) << 16n) | (BigInt(m[2]) << 8n) | BigInt(m[1]);
  };

  // text -> { version: 4|6, n: BigInt, how: "what the input was read as", loose: bool } or { error }
  function read(text) {
    const s = String(text == null ? "" : text).trim().replace(/\s+/g, "");
    if (!s) return { error: "Type or paste an address or a number." };
    const r6 = V6.fromReverse(s);
    if (r6) return r6.full ? { version: 6, n: r6.n, how: "an ip6.arpa name" } : { error: "That ip6.arpa name is only part of an address (a prefix), not a whole address." };
    const r4 = fromV4Arpa(s);
    if (r4 != null) return { version: 4, n: r4, how: "an in-addr.arpa name" };
    if (/^0[bB][01]+$/.test(s)) return fromInt(BigInt(s), "a binary number");
    if (/^[01]{8}(\.[01]{8}){3}$/.test(s)) { const n = BigInt("0b" + s.replace(/\./g, "")); return { version: 4, n, how: "dotted binary" }; }
    if (s.includes(":")) {
      const a = V6.parse(s);
      return a ? { version: 6, n: a.n, how: a.v4tail ? "IPv6 with an IPv4 ending" : "an IPv6 address", zone: a.zone } : { error: "That is not a valid IPv6 address." };
    }
    if (/^0[xX][0-9a-fA-F]+$/.test(s) && !s.includes(".")) return fromInt(BigInt(s), "a hexadecimal number");
    if (/^\d+$/.test(s) && s.length > 1 && s[0] !== "0" || s === "0") return fromInt(BigInt(s), "a decimal number");
    const v4 = parseV4Loose(s);
    if (v4) return { version: 4, n: v4.n, how: v4.strict ? "an IPv4 address" : "an IPv4 address in a short or unusual form", loose: !v4.strict };
    if (/^[0-9a-fA-F]{8}$/.test(s) || /^[0-9a-fA-F]{32}$/.test(s)) return fromInt(BigInt("0x" + s), "hexadecimal digits");
    return { error: "I could not read that as an address or a number." };
  }
  function fromInt(b, how) {
    if (b < 0x100000000n) return { version: 4, n: b, how };
    if (b <= V6.MAX) return { version: 6, n: b, how: how + " (too big for IPv4, so read as IPv6)" };
    return { error: "That number is bigger than any IPv6 address (more than 128 bits)." };
  }

  // everything worth showing for a result of read()
  function describe(r) {
    if (r.error) return r;
    const n = r.n, out = { version: r.version, how: r.how, rows: [] };
    if (r.version === 4) {
      const mapped = (0xffffn << 32n) | n;
      out.rows = [
        ["Dotted decimal", dotted(n)], ["Decimal number", n.toString()], ["Hexadecimal number", "0x" + n.toString(16).padStart(8, "0")],
        ["Octal number", "0" + n.toString(8)], ["Binary", bin32(n)], ["Dotted binary", dottedBin(n)], ["Dotted hexadecimal", dottedHex(n)], ["Dotted octal", dottedOct(n)],
        ["Reverse DNS name", v4Arpa(n)], ["As IPv6 (IPv4-mapped)", V6.mixed(mapped)], ["As IPv6 (6to4 prefix)", V6.compress((0x2002n << 112n) | (n << 80n)) + "/48"],
      ];
    } else {
      out.rows = [
        ["Short form", V6.compress(n)], ["Full form", V6.expand(n)], ["Decimal number", n.toString()], ["Hexadecimal number", "0x" + n.toString(16).padStart(32, "0")],
        ["Binary", n.toString(2).padStart(128, "0").match(/.{16}/g).join(" ")], ["Reverse DNS name", V6.reverseName(n)],
      ];
      if ((n >> 32n) === 0xffffn) out.rows.push(["Contained IPv4 address", dotted(n & 0xffffffffn)]);
    }
    return out;
  }

  const api = { parseV4Loose, read, describe, dotted, dottedHex, dottedOct, dottedBin, v4Arpa, fromV4Arpa };
  if (typeof window !== "undefined") window.IPConv = api;
  if (typeof module !== "undefined") module.exports = api;
})();
