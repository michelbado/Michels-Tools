/* A small DER (ASN.1) reader and writer plus PEM helpers, shared by the certificate tools (keys, PFX files, bundles). Pure; no third-party code.
   read(bytes, pos) -> { tag, cls, constructed, start, end, hdr } for the element at pos (start..end is its content);  kids(bytes, node) lists the children.
   Writers return Uint8Array: seq, set, oid, int, octets, bits, nul, utf8, ctx (explicit/implicit context tags), bmpString, utcOrGen. Exports window.DerKit. */
(() => {
  "use strict";
  const g = typeof window !== "undefined" ? window : globalThis;
  const concat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  const hex = u => Array.from(u, b => b.toString(16).padStart(2, "0")).join("");
  const unhex = s => Uint8Array.from(s.match(/../g) || [], h => parseInt(h, 16));

  /* ---------- reading ---------- */
  // one element; throws on a malformed length (indefinite length is not DER and is refused here)
  function read(b, pos = 0, limit = b.length) {
    if (pos + 2 > limit) throw new Error("DER: truncated");
    const t = b[pos]; let p = pos + 1, len = b[p++];
    if (len & 0x80) { const n = len & 0x7f; if (n === 0 || n > 4 || p + n > limit) throw new Error("DER: bad length"); len = 0; for (let i = 0; i < n; i++) len = len * 256 + b[p++]; }
    if (p + len > limit) throw new Error("DER: element runs past the end");
    return { tag: t, cls: t >> 6, constructed: !!(t & 0x20), num: t & 0x1f, start: p, end: p + len, hdr: p - pos, pos };
  }
  const kids = (b, node) => { const out = []; let p = node.start; while (p < node.end) { const k = read(b, p, node.end); out.push(k); p = k.end; } return out; };
  const content = (b, n) => b.subarray(n.start, n.end);
  const whole = (b, n) => b.subarray(n.pos, n.end);
  const oidOf = (b, n) => { const x = content(b, n), out = [Math.floor(x[0] / 40), x[0] % 40]; let v = 0; for (let i = 1; i < x.length; i++) { v = v * 128 + (x[i] & 127); if (!(x[i] & 128)) { out.push(v); v = 0; } } return out.join("."); };
  const bigOf = (b, n) => { let v = 0n; for (const x of content(b, n)) v = (v << 8n) | BigInt(x); return v; };
  const intOf = (b, n) => Number(bigOf(b, n));
  // an unsigned integer's bytes without the leading zero that DER adds
  const uintBytes = (b, n) => { let c = content(b, n), i = 0; while (i < c.length - 1 && c[i] === 0) i++; return c.subarray(i); };

  /* ---------- writing ---------- */
  const lenBytes = n => n < 128 ? [n] : n < 256 ? [0x81, n] : n < 65536 ? [0x82, n >> 8, n & 255] : n < 16777216 ? [0x83, n >> 16, (n >> 8) & 255, n & 255] : [0x84, n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const tlv = (tag, ...parts) => { const c = concat(...parts); return concat(new Uint8Array([tag, ...lenBytes(c.length)]), c); };
  const seq = (...p) => tlv(0x30, ...p), set = (...p) => tlv(0x31, ...p);
  const octets = u => tlv(0x04, u), bits = (u, unused = 0) => tlv(0x03, new Uint8Array([unused]), u), nul = () => new Uint8Array([5, 0]);
  const utf8 = s => tlv(0x0c, new TextEncoder().encode(s)), ia5 = s => tlv(0x16, new TextEncoder().encode(s));
  const bmpString = s => { const o = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); o[2 * i] = c >> 8; o[2 * i + 1] = c & 255; } return tlv(0x1e, o); };
  const int = v => {                                  // a non-negative number, bigint or the bytes of an unsigned integer
    let u;
    if (v instanceof Uint8Array) { let i = 0; while (i < v.length - 1 && v[i] === 0) i++; u = v.subarray(i); }
    else { let x = BigInt(v); const a = []; do { a.unshift(Number(x & 255n)); x >>= 8n; } while (x > 0n); u = Uint8Array.from(a); }
    return tlv(0x02, u[0] & 0x80 ? concat(new Uint8Array([0]), u) : u);
  };
  const oid = s => {
    const p = s.split(".").map(Number), out = [p[0] * 40 + p[1]];
    for (let i = 2; i < p.length; i++) { let v = p[i]; const t = [v & 127]; v = Math.floor(v / 128); while (v > 0) { t.unshift((v & 127) | 128); v = Math.floor(v / 128); } out.push(...t); }
    return tlv(0x06, Uint8Array.from(out));
  };
  const ctx = (n, ...p) => tlv(0xa0 | n, ...p);                // [n] constructed (explicit)
  const ctxImplicit = (n, u) => tlv(0x80 | n, u);              // [n] primitive (implicit)

  /* ---------- PEM and base64 ---------- */
  const b64 = u => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => { const bin = atob(s.replace(/\s+/g, "")); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const pemOut = (label, der, headers) => `-----BEGIN ${label}-----\n${headers ? headers + "\n\n" : ""}${(b64(der).match(/.{1,64}/g) || []).join("\n")}\n-----END ${label}-----\n`;
  // all PEM blocks of a text: [{ label, headers: { name: value }, der, raw }]   (blocks whose base64 is broken come back with der = null)
  function pemBlocks(text) {
    const out = [], re = /-----BEGIN ([A-Z0-9 ]+)-----\r?\n?([\s\S]*?)-----END \1-----/g; let m;
    while ((m = re.exec(String(text)))) {
      const headers = {}; let body = m[2];
      const lines = body.split(/\r?\n/); let i = 0;
      while (i < lines.length && /^[A-Za-z0-9-]+:\s?/.test(lines[i])) { const k = lines[i].indexOf(":"); headers[lines[i].slice(0, k).trim()] = lines[i].slice(k + 1).trim(); i++; }
      body = lines.slice(i).join("");
      let der = null; try { der = unb64(body); } catch { /* broken base64 */ }
      out.push({ label: m[1], headers, der, raw: m[0] });
    }
    return out;
  }

  g.DerKit = { concat, hex, unhex, read, kids, content, whole, oidOf, bigOf, intOf, uintBytes, seq, set, octets, bits, nul, utf8, ia5, bmpString, int, oid, ctx, ctxImplicit, tlv, b64, unb64, pemOut, pemBlocks };
  if (typeof module !== "undefined") module.exports = g.DerKit;
})();
