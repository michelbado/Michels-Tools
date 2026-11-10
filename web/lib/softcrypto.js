/* Soft crypto: the few cryptographic steps needed to CHECK a PDF signature, written in plain JavaScript.
   Browsers only offer WebCrypto (crypto.subtle) on https or localhost, so on a plain http address the signature checker
   would otherwise be unusable. This file stands in for crypto.subtle when it is missing. It only VERIFIES (public data, so
   timing does not matter); it can neither sign nor decrypt, and it is never used when the browser has WebCrypto.

   Provides (window.SoftCrypto):
     digest(name, bytes)   SHA-1, SHA-256, SHA-384, SHA-512
     subtle                a minimal SubtleCrypto: digest, importKey("spki" | "raw"), verify
                           for RSASSA-PKCS1-v1_5, RSA-PSS and ECDSA (P-256, P-384, P-521)
     install(pkijs)        makes pkijs use it
   Constants (hash round constants, curve parameters) are either derived at load time or checked by the tests against
   Node's crypto and OpenSSL; see the test files, not this comment, for the proof. */
(() => {
  "use strict";

  /* ---------- bytes and big numbers ---------- */

  const toBytes = d => {
    if (d instanceof Uint8Array) return d;
    if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    if (d instanceof ArrayBuffer) return new Uint8Array(d);
    throw softError("DataError", "Expected bytes");
  };
  function softError(name, msg) { const e = new Error(msg); e.name = name; return e; }
  const concat = (...parts) => { const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  const equalBytes = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
  const toBig = u8 => { let h = ""; for (const b of u8) h += (b < 16 ? "0" : "") + b.toString(16); return h ? BigInt("0x" + h) : 0n; };
  const fromBig = (n, len) => {
    let h = n.toString(16); if (h.length & 1) h = "0" + h;
    if (h.length / 2 > len) throw softError("DataError", "number too large");
    const out = new Uint8Array(len);
    for (let i = 0; i < h.length / 2; i++) out[len - h.length / 2 + i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  };
  const bitLen = n => (n === 0n ? 0 : n.toString(2).length);
  const byteLen = n => (bitLen(n) + 7) >> 3;
  const mod = (a, m) => { const r = a % m; return r < 0n ? r + m : r; };
  function modPow(b, e, m) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = (r * b) % m; e >>= 1n; if (e) b = (b * b) % m; } return r; }
  function modInv(a, m) {
    let [r0, r1, s0, s1] = [mod(a, m), m, 1n, 0n];
    while (r1 !== 0n) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
    if (r0 !== 1n) throw softError("DataError", "no inverse");
    return mod(s0, m);
  }

  /* ---------- hashes ---------- */
  // round constants are the fractional parts of square and cube roots of the first primes: computed, not typed in

  const primes = n => { const out = []; for (let c = 2; out.length < n; c++) if (out.every(p => c % p)) out.push(c); return out; };
  function iroot(n, k) {
    if (n < 2n) return n;
    const K = BigInt(k);
    let x = 1n << BigInt(Math.ceil(bitLen(n) / k));
    for (;;) { const y = ((K - 1n) * x + n / x ** (K - 1n)) / K; if (y >= x) return x; x = y; }
  }
  const frac = (p, k, bits) => iroot(BigInt(p) << BigInt(bits * k), k) & ((1n << BigInt(bits)) - 1n);

  let T256 = null, T512 = null;
  function tables256() {
    if (T256) return T256;
    const ps = primes(64);
    return (T256 = { K: Int32Array.from(ps, p => Number(frac(p, 3, 32)) | 0), H: Int32Array.from(ps.slice(0, 8), p => Number(frac(p, 2, 32)) | 0) });
  }
  function tables512() {
    if (T512) return T512;
    const ps = primes(80), hi = v => Number(v >> 32n) | 0, lo = v => Number(v & 0xFFFFFFFFn) | 0;
    const K = new Int32Array(160);
    ps.forEach((p, i) => { const v = frac(p, 3, 64); K[2 * i] = hi(v); K[2 * i + 1] = lo(v); });
    const init = list => { const h = new Int32Array(16); list.forEach((p, i) => { const v = frac(p, 2, 64); h[2 * i] = hi(v); h[2 * i + 1] = lo(v); }); return h; };
    return (T512 = { K, H512: init(ps.slice(0, 8)), H384: init(ps.slice(8, 16)) });
  }

  // calls block(data, offset) for every complete block of the padded message
  function eachBlock(data, size, lenBytes, block) {
    const full = data.length - (data.length % size);
    for (let o = 0; o < full; o += size) block(data, o);
    const rest = data.length - full;
    const tail = new Uint8Array(rest + 1 + lenBytes <= size ? size : 2 * size);
    tail.set(data.subarray(full), 0);
    tail[rest] = 0x80;
    const bits = BigInt(data.length) * 8n;
    for (let i = 0; i < 8; i++) tail[tail.length - 1 - i] = Number((bits >> BigInt(8 * i)) & 0xFFn);
    for (let o = 0; o < tail.length; o += size) block(tail, o);
  }
  const word = (d, o) => (d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3];
  function wordsOut(h, bytes) { const out = new Uint8Array(bytes); for (let i = 0; i < bytes; i++) out[i] = (h[i >> 2] >>> (24 - 8 * (i & 3))) & 255; return out; }

  function sha1(data) {
    const h = Int32Array.of(0x67452301, 0xEFCDAB89 | 0, 0x98BADCFE | 0, 0x10325476, 0xC3D2E1F0 | 0), w = new Int32Array(80);
    eachBlock(data, 64, 8, (d, o) => {
      for (let i = 0; i < 16; i++) w[i] = word(d, o + 4 * i);
      for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
      let a = h[0], b = h[1], c = h[2], dd = h[3], e = h[4];
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) { f = (b & c) | (~b & dd); k = 0x5A827999; } else if (i < 40) { f = b ^ c ^ dd; k = 0x6ED9EBA1; } else if (i < 60) { f = (b & c) | (b & dd) | (c & dd); k = 0x8F1BBCDC | 0; } else { f = b ^ c ^ dd; k = 0xCA62C1D6 | 0; }
        const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
        e = dd; dd = c; c = (b << 30) | (b >>> 2); b = a; a = t;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + dd) | 0; h[4] = (h[4] + e) | 0;
    });
    return wordsOut(h, 20);
  }

  function sha256(data) {
    const { K, H } = tables256(), h = H.slice(), w = new Int32Array(64);
    eachBlock(data, 64, 8, (d, o) => {
      for (let i = 0; i < 16; i++) w[i] = word(d, o + 4 * i);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let a = h[0], b = h[1], c = h[2], dd = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g; g = f; f = e; e = (dd + t1) | 0; dd = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + dd) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    });
    return wordsOut(h, 32);
  }

  // SHA-512 / SHA-384: 64-bit words kept as (high, low) pairs of 32-bit integers
  function sha512(data, is384) {
    const { K, H512, H384 } = tables512(), h = (is384 ? H384 : H512).slice();
    const wh = new Int32Array(80), wl = new Int32Array(80);
    eachBlock(data, 128, 16, (d, o) => {
      for (let i = 0; i < 16; i++) { wh[i] = word(d, o + 8 * i); wl[i] = word(d, o + 8 * i + 4); }
      for (let i = 16; i < 80; i++) {
        const h15 = wh[i - 15], l15 = wl[i - 15], h2 = wh[i - 2], l2 = wl[i - 2];
        const s0h = ((h15 >>> 1) | (l15 << 31)) ^ ((h15 >>> 8) | (l15 << 24)) ^ (h15 >>> 7);
        const s0l = ((l15 >>> 1) | (h15 << 31)) ^ ((l15 >>> 8) | (h15 << 24)) ^ ((l15 >>> 7) | (h15 << 25));
        const s1h = ((h2 >>> 19) | (l2 << 13)) ^ ((l2 >>> 29) | (h2 << 3)) ^ (h2 >>> 6);
        const s1l = ((l2 >>> 19) | (h2 << 13)) ^ ((h2 >>> 29) | (l2 << 3)) ^ ((l2 >>> 6) | (h2 << 26));
        const lo = (wl[i - 16] >>> 0) + (s0l >>> 0) + (wl[i - 7] >>> 0) + (s1l >>> 0);
        wl[i] = lo | 0; wh[i] = (wh[i - 16] + s0h + wh[i - 7] + s1h + Math.floor(lo / 4294967296)) | 0;
      }
      let ah = h[0], al = h[1], bh = h[2], bl = h[3], ch = h[4], cl = h[5], dh = h[6], dl = h[7];
      let eh = h[8], el = h[9], fh = h[10], fl = h[11], gh = h[12], gl = h[13], hh = h[14], hl = h[15];
      for (let i = 0; i < 80; i++) {
        const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
        const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
        const chh = (eh & fh) ^ (~eh & gh), chl = (el & fl) ^ (~el & gl);
        const lo1 = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K[2 * i + 1] >>> 0) + (wl[i] >>> 0);
        const t1l = lo1 | 0, t1h = (hh + S1h + chh + K[2 * i] + wh[i] + Math.floor(lo1 / 4294967296)) | 0;
        const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
        const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
        const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch), mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
        const lo2 = (S0l >>> 0) + (mjl >>> 0);
        const t2l = lo2 | 0, t2h = (S0h + mjh + Math.floor(lo2 / 4294967296)) | 0;
        hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
        const lo3 = (dl >>> 0) + (t1l >>> 0);
        el = lo3 | 0; eh = (dh + t1h + Math.floor(lo3 / 4294967296)) | 0;
        dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
        const lo4 = (t1l >>> 0) + (t2l >>> 0);
        al = lo4 | 0; ah = (t1h + t2h + Math.floor(lo4 / 4294967296)) | 0;
      }
      const add = (idx, vh, vl) => { const lo = (h[idx + 1] >>> 0) + (vl >>> 0); h[idx + 1] = lo | 0; h[idx] = (h[idx] + vh + Math.floor(lo / 4294967296)) | 0; };
      add(0, ah, al); add(2, bh, bl); add(4, ch, cl); add(6, dh, dl); add(8, eh, el); add(10, fh, fl); add(12, gh, gl); add(14, hh, hl);
    });
    return wordsOut(h, is384 ? 48 : 64);
  }

  const HASHES = {
    "SHA-1": { fn: sha1, size: 20, oid: [0x2B, 0x0E, 0x03, 0x02, 0x1A] },
    "SHA-256": { fn: sha256, size: 32, oid: [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01] },
    "SHA-384": { fn: d => sha512(d, true), size: 48, oid: [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x02] },
    "SHA-512": { fn: d => sha512(d, false), size: 64, oid: [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x03] },
  };
  const algName = a => (typeof a === "string" ? a : a && a.name) || "";
  function hashInfo(a) {
    const n = algName(a).toUpperCase();
    const h = HASHES[n];
    if (!h) throw softError("NotSupportedError", "Unsupported hash: " + algName(a));
    return { name: n, ...h };
  }
  const digest = (name, data) => hashInfo(name).fn(toBytes(data));

  /* ---------- DER ---------- */

  function readDer(b, pos) {
    if (pos + 2 > b.length) throw softError("DataError", "bad DER");
    const tag = b[pos]; let len = b[pos + 1], p = pos + 2;
    if (len & 0x80) { const n = len & 0x7F; if (n < 1 || n > 4 || p + n > b.length) throw softError("DataError", "bad DER length"); len = 0; for (let i = 0; i < n; i++) len = len * 256 + b[p++]; }
    if (p + len > b.length) throw softError("DataError", "DER overruns its data");
    return { tag, start: p, end: p + len };
  }
  const derLen = n => (n < 128 ? Uint8Array.of(n) : n < 256 ? Uint8Array.of(0x81, n) : Uint8Array.of(0x82, n >> 8, n & 255));
  const der = (tag, ...parts) => { const body = concat(...parts); return concat(Uint8Array.of(tag), derLen(body.length), body); };
  function oidString(b) { const out = [Math.floor(b[0] / 40), b[0] % 40]; let v = 0; for (let i = 1; i < b.length; i++) { v = v * 128 + (b[i] & 127); if (!(b[i] & 128)) { out.push(v); v = 0; } } return out.join("."); }

  /* ---------- RSA ---------- */

  function digestInfos(hi, digestBytes) { // with and without the NULL parameter: both are seen in real signatures
    const oid = der(0x06, Uint8Array.from(hi.oid)), oct = der(0x04, digestBytes);
    return [der(0x30, der(0x30, oid, Uint8Array.of(5, 0)), oct), der(0x30, der(0x30, oid), oct)];
  }
  function rsaPkcs1Verify(key, hi, sig, msg) {
    const { n, e } = key, k = byteLen(n);
    if (sig.length !== k) return false;
    const s = toBig(sig);
    if (s >= n) return false;
    const em = fromBig(modPow(s, e, n), k);
    if (em[0] !== 0 || em[1] !== 1) return false;
    let i = 2; while (i < k && em[i] === 0xFF) i++;
    if (i - 2 < 8 || i >= k || em[i] !== 0) return false;
    const got = em.subarray(i + 1);
    return digestInfos(hi, hi.fn(msg)).some(d => equalBytes(d, got));
  }
  function mgf1(hi, seed, len) {
    const out = new Uint8Array(Math.ceil(len / hi.size) * hi.size);
    for (let c = 0; c * hi.size < len; c++) out.set(hi.fn(concat(seed, Uint8Array.of(c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255))), c * hi.size);
    return out.subarray(0, len);
  }
  function rsaPssVerify(key, hi, sig, msg, sLen) {
    const { n, e } = key, k = byteLen(n), modBits = bitLen(n), emBits = modBits - 1, emLen = Math.ceil(emBits / 8);
    if (sig.length !== k) return false;
    const s = toBig(sig);
    if (s >= n) return false;
    let em;
    try { em = fromBig(modPow(s, e, n), emLen); } catch { return false; }
    if (emLen < hi.size + sLen + 2 || em[emLen - 1] !== 0xBC) return false;
    const maskedDB = em.subarray(0, emLen - hi.size - 1), H = em.subarray(emLen - hi.size - 1, emLen - 1);
    const zeroBits = 8 * emLen - emBits;
    if (zeroBits > 0 && (maskedDB[0] >> (8 - zeroBits)) !== 0) return false;
    const mask = mgf1(hi, H, maskedDB.length), db = new Uint8Array(maskedDB.length);
    for (let i = 0; i < db.length; i++) db[i] = maskedDB[i] ^ mask[i];
    if (zeroBits > 0) db[0] &= 0xFF >> zeroBits;
    const padLen = emLen - hi.size - sLen - 2;
    for (let i = 0; i < padLen; i++) if (db[i] !== 0) return false;
    if (db[padLen] !== 1) return false;
    const salt = db.subarray(db.length - sLen);
    const check = hi.fn(concat(new Uint8Array(8), hi.fn(msg), salt));
    return equalBytes(check, H);
  }

  /* ---------- elliptic curves (short Weierstrass, a = -3), Jacobian coordinates ---------- */

  const CURVES = {
    "P-256": { oid: "1.2.840.10045.3.1.7", bytes: 32,
      p: (1n << 256n) - (1n << 224n) + (1n << 192n) + (1n << 96n) - 1n, n: 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n,
      b: 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604Bn,
      gx: 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296n, gy: 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5n },
    "P-384": { oid: "1.3.132.0.34", bytes: 48,
      p: (1n << 384n) - (1n << 128n) - (1n << 96n) + (1n << 32n) - 1n,
      n: 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFC7634D81F4372DDF581A0DB248B0A77AECEC196ACCC52973n,
      b: 0xB3312FA7E23EE7E4988E056BE3F82D19181D9C6EFE8141120314088F5013875AC656398D8A2ED19D2A85C8EDD3EC2AEFn,
      gx: 0xAA87CA22BE8B05378EB1C71EF320AD746E1D3B628BA79B9859F741E082542A385502F25DBF55296C3A545E3872760AB7n,
      gy: 0x3617DE4A96262C6F5D9E98BF9292DC29F8F41DBD289A147CE9DA3113B5F0B8C00A60B1CE1D7E819D7A431D7C90EA0E5Fn },
    "P-521": { oid: "1.3.132.0.35", bytes: 66,
      p: (1n << 521n) - 1n,
      n: 0x01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409n,
      b: 0x51953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00n,
      gx: 0x00C6858E06B70404E9CD9E3ECB662395B4429C648139053FB521F828AF606B4D3DBAA14B5E77EFE75928FE1DC127A2FFA8DE3348B3C1856A429BF97E7E31C2E5BD66n,
      gy: 0x011839296A789A3BC0045C8A5FB42C7D1BD998F54449579B446817AFBD17273E662C97EE72995EF42640C550B9013FAD0761353C7086A272C24088BE94769FD16650n },
  };
  const curveByOid = oid => Object.keys(CURVES).find(k => CURVES[k].oid === oid);

  function ecOps(c) {
    const { p } = c, INF = null;
    const dbl = P => {
      if (!P || P[1] === 0n) return INF;
      const [X, Y, Z] = P;
      const delta = (Z * Z) % p, gamma = (Y * Y) % p, beta = (X * gamma) % p;
      const alpha = (3n * mod((X - delta) * (X + delta), p)) % p;
      const X3 = mod(alpha * alpha - 8n * beta, p);
      const Z3 = mod((Y + Z) * (Y + Z) - gamma - delta, p);
      const Y3 = mod(alpha * (4n * beta - X3) - 8n * gamma * gamma, p);
      return [X3, Y3, Z3];
    };
    const add = (P, Q) => {
      if (!P) return Q; if (!Q) return P;
      const [X1, Y1, Z1] = P, [X2, Y2, Z2] = Q;
      const Z1Z1 = (Z1 * Z1) % p, Z2Z2 = (Z2 * Z2) % p;
      const U1 = (X1 * Z2Z2) % p, U2 = (X2 * Z1Z1) % p;
      const S1 = (Y1 * Z2 % p * Z2Z2) % p, S2 = (Y2 * Z1 % p * Z1Z1) % p;
      if (U1 === U2) return S1 === S2 ? dbl(P) : INF;
      const H = mod(U2 - U1, p), I = (4n * H * H) % p, J = (H * I) % p, r = mod(2n * (S2 - S1), p), V = (U1 * I) % p;
      const X3 = mod(r * r - J - 2n * V, p);
      const Y3 = mod(r * (V - X3) - 2n * S1 * J, p);
      const Z3 = mod(((Z1 + Z2) * (Z1 + Z2) - Z1Z1 - Z2Z2) * H, p);
      return [X3, Y3, Z3];
    };
    const mul = (k, x, y) => { // double-and-add from the top bit; verification works on public data only
      let R = INF; const A = [x, y, 1n];
      for (let i = bitLen(k) - 1; i >= 0; i--) { R = dbl(R); if ((k >> BigInt(i)) & 1n) R = add(R, A); }
      return R;
    };
    const affineX = P => { if (!P) return null; const zi = modInv(P[2], p), zi2 = (zi * zi) % p; return (P[0] * zi2) % p; };
    return { mul, add, affineX };
  }
  const ecCache = {};
  const ecFor = name => (ecCache[name] = ecCache[name] || ecOps(CURVES[name]));

  function onCurve(c, x, y) { return x > 0n && x < c.p && y >= 0n && y < c.p && mod(y * y, c.p) === mod(x * x * x - 3n * x + c.b, c.p); }

  function ecdsaVerify(key, hi, sig, msg) {
    const c = CURVES[key.curve], L = c.bytes;
    if (sig.length !== 2 * L) return false;
    const r = toBig(sig.subarray(0, L)), s = toBig(sig.subarray(L));
    if (r < 1n || r >= c.n || s < 1n || s >= c.n) return false;
    let e = toBig(hi.fn(msg));
    const extra = hi.size * 8 - bitLen(c.n);
    if (extra > 0) e >>= BigInt(extra);
    const w = modInv(s, c.n), u1 = mod(e * w, c.n), u2 = mod(r * w, c.n);
    const ops = ecFor(key.curve);
    const R = ops.add(ops.mul(u1, c.gx, c.gy), ops.mul(u2, key.x, key.y));
    const x = ops.affineX(R);
    return x !== null && mod(x, c.n) === r;
  }

  /* ---------- keys ---------- */

  function parseSpki(buf) {
    const b = toBytes(buf), top = readDer(b, 0);
    if (top.tag !== 0x30 || top.end !== b.length) throw softError("DataError", "not a SubjectPublicKeyInfo");
    const alg = readDer(b, top.start);
    if (alg.tag !== 0x30) throw softError("DataError", "bad algorithm");
    const oid = readDer(b, alg.start);
    if (oid.tag !== 0x06) throw softError("DataError", "bad algorithm");
    const oidStr = oidString(b.subarray(oid.start, oid.end));
    const bits = readDer(b, alg.end);
    if (bits.tag !== 0x03 || b[bits.start] !== 0) throw softError("DataError", "bad public key");
    const body = b.subarray(bits.start + 1, bits.end);
    if (oidStr === "1.2.840.113549.1.1.1" || oidStr === "1.2.840.113549.1.1.10") {
      const seq = readDer(body, 0);
      if (seq.tag !== 0x30) throw softError("DataError", "bad RSA key");
      const ni = readDer(body, seq.start), ei = readDer(body, ni.end);
      if (ni.tag !== 2 || ei.tag !== 2) throw softError("DataError", "bad RSA key");
      const n = toBig(body.subarray(ni.start, ni.end)), e = toBig(body.subarray(ei.start, ei.end));
      if (n < 3n || e < 3n || !(n & 1n)) throw softError("DataError", "bad RSA key");
      return { kind: "rsa", n, e };
    }
    if (oidStr === "1.2.840.10045.2.1") {
      const cOid = readDer(b, oid.end);
      if (cOid.tag !== 0x06) throw softError("NotSupportedError", "EC parameters must name a curve");
      const curve = curveByOid(oidString(b.subarray(cOid.start, cOid.end)));
      if (!curve) throw softError("NotSupportedError", "Unsupported curve");
      return { kind: "ec", ...ecPoint(curve, body) };
    }
    throw softError("NotSupportedError", "Unsupported key type " + oidStr);
  }
  function ecPoint(curve, pt) {
    const c = CURVES[curve];
    if (pt.length !== 1 + 2 * c.bytes || pt[0] !== 4) throw softError("DataError", "only uncompressed points are supported");
    const x = toBig(pt.subarray(1, 1 + c.bytes)), y = toBig(pt.subarray(1 + c.bytes));
    if (!onCurve(c, x, y)) throw softError("DataError", "the point is not on the curve");
    return { curve, x, y };
  }

  // JSON Web Key: how pkijs hands over public keys
  const b64u = str => { const t = String(str).replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4)); return Uint8Array.from(bin, ch => ch.charCodeAt(0)); };
  function parseJwk(jwk) {
    if (!jwk || typeof jwk !== "object") throw softError("DataError", "bad JWK");
    if (jwk.kty === "RSA") {
      const n = toBig(b64u(jwk.n)), e = toBig(b64u(jwk.e));
      if (n < 3n || e < 3n || !(n & 1n)) throw softError("DataError", "bad RSA key");
      return { kind: "rsa", n, e };
    }
    if (jwk.kty === "EC") {
      if (!CURVES[jwk.crv]) throw softError("NotSupportedError", "Unsupported curve");
      const L = CURVES[jwk.crv].bytes, x = b64u(jwk.x), y = b64u(jwk.y);
      if (x.length > L || y.length > L) throw softError("DataError", "bad point");
      const pt = new Uint8Array(1 + 2 * L); pt[0] = 4; pt.set(x, 1 + L - x.length); pt.set(y, 1 + 2 * L - y.length);
      return { kind: "ec", ...ecPoint(jwk.crv, pt) };
    }
    throw softError("NotSupportedError", "Unsupported key type");
  }

  const CANON = { "RSASSA-PKCS1-V1_5": "RSASSA-PKCS1-v1_5", "RSA-PSS": "RSA-PSS", "ECDSA": "ECDSA" };
  const subtle = {
    async digest(alg, data) { const d = digest(alg, data); return d.buffer.slice(d.byteOffset, d.byteOffset + d.length); },
    async importKey(format, keyData, algorithm, extractable, usages) {
      const name = CANON[algName(algorithm).toUpperCase()];
      if (!name) throw softError("NotSupportedError", "Unsupported algorithm: " + algName(algorithm));
      let pk;
      if (format === "spki") pk = parseSpki(keyData);
      else if (format === "jwk") pk = parseJwk(keyData);
      else if (format === "raw" && name === "ECDSA") pk = { kind: "ec", ...ecPoint(algorithm.namedCurve, toBytes(keyData)) };
      else throw softError("NotSupportedError", "Unsupported key format: " + format);
      const out = { type: "public", extractable: !!extractable, usages: [...(usages || [])], algorithm: { name }, __soft: pk };
      if (name === "ECDSA") {
        if (pk.kind !== "ec" || pk.curve !== algorithm.namedCurve) throw softError("DataError", "key and curve do not match");
        out.algorithm.namedCurve = pk.curve;
      } else {
        if (pk.kind !== "rsa") throw softError("DataError", "this is not an RSA key");
        out.algorithm.hash = { name: hashInfo(algorithm.hash).name };
      }
      return out;
    },
    async verify(algorithm, key, signature, data) {
      const name = CANON[algName(algorithm).toUpperCase()];
      if (!key || !key.__soft || key.algorithm.name !== name) throw softError("InvalidAccessError", "The key does not match the algorithm");
      const sig = toBytes(signature), msg = toBytes(data), pk = key.__soft;
      if (name === "ECDSA") return ecdsaVerify(pk, hashInfo(algorithm.hash), sig, msg);
      const hi = hashInfo(key.algorithm.hash);
      if (name === "RSASSA-PKCS1-v1_5") return rsaPkcs1Verify(pk, hi, sig, msg);
      const sLen = Number(algorithm.saltLength);
      if (!Number.isInteger(sLen) || sLen < 0) throw softError("DataError", "saltLength is required");
      return rsaPssVerify(pk, hi, sig, msg, sLen);
    },
    async exportKey() { throw softError("NotSupportedError", "exportKey is not available"); },
  };

  // makes pkijs use it (only called when the browser has no crypto.subtle)
  function install(pkijs) {
    const rnd = a => (globalThis.crypto && globalThis.crypto.getRandomValues ? globalThis.crypto.getRandomValues(a) : a);
    pkijs.setEngine("soft", { subtle, getRandomValues: rnd }, subtle);
  }

  window.SoftCrypto = { digest, subtle, install, hashes: Object.keys(HASHES), curves: Object.keys(CURVES), _internals: { toBig, fromBig, modPow, modInv, CURVES, ecFor, parseSpki, sha1, sha256, sha512 } };
})();
