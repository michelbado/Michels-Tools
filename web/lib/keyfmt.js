/* Private keys for the certificate tools: reads every common format (PKCS#1 "RSA PRIVATE KEY", SEC1 "EC PRIVATE KEY", PKCS#8 "PRIVATE KEY", "ENCRYPTED PRIVATE KEY",
   old "Proc-Type: 4,ENCRYPTED" files, DER), asks for the password when there is one, finds the matching public key (SubjectPublicKeyInfo) and writes keys out again
   (PKCS#8, PKCS#8 encrypted, traditional, DER). RSA, EC (P-256, P-384, P-521) and Ed25519. Works in the page and in node; nothing leaves the browser: this file does
   not touch the network, storage or the page. Needs lib/derkit.js, lib/oldcrypto.js and lib/softcrypto.js (looked up when used). Exports window.KeyFmt. */
(() => {
  "use strict";
  const g = typeof window !== "undefined" ? window : globalThis;
  const D = () => g.DerKit, OC = () => g.OldCrypto, SC = () => g.SoftCrypto;
  const O = {
    rsa: "1.2.840.113549.1.1.1", rsapss: "1.2.840.113549.1.1.10", ec: "1.2.840.10045.2.1", ed25519: "1.3.101.112", x25519: "1.3.101.110", ed448: "1.3.101.113", x448: "1.3.101.111", dsa: "1.2.840.10040.4.1",
    pbes2: "1.2.840.113549.1.5.13", pbkdf2: "1.2.840.113549.1.5.12", scrypt: "1.3.6.1.4.1.11591.4.11",
    prf: { "1.2.840.113549.2.7": "SHA-1", "1.2.840.113549.2.8": "SHA-224", "1.2.840.113549.2.9": "SHA-256", "1.2.840.113549.2.10": "SHA-384", "1.2.840.113549.2.11": "SHA-512" },
    cipher: { "2.16.840.1.101.3.4.1.2": ["aes", 16], "2.16.840.1.101.3.4.1.22": ["aes", 24], "2.16.840.1.101.3.4.1.42": ["aes", 32], "1.2.840.113549.3.7": ["des3", 24], "1.3.14.3.2.7": ["des", 8] },
    pbe12: { "1.2.840.113549.1.12.1.1": "RC4-128", "1.2.840.113549.1.12.1.2": "RC4-40", "1.2.840.113549.1.12.1.3": "3DES", "1.2.840.113549.1.12.1.4": "3DES-2KEY", "1.2.840.113549.1.12.1.5": "RC2-128", "1.2.840.113549.1.12.1.6": "RC2-40" },
    pbe5: { "1.2.840.113549.1.5.3": ["MD5", "des"], "1.2.840.113549.1.5.10": ["SHA-1", "des"] },
  };
  const CURVE_OID = { "1.2.840.10045.3.1.7": "P-256", "1.3.132.0.34": "P-384", "1.3.132.0.35": "P-521" };
  const CURVE_NAME = Object.fromEntries(Object.entries(CURVE_OID).map(([k, v]) => [v, k]));
  const bitLen = u => { let i = 0; while (i < u.length && u[i] === 0) i++; return i === u.length ? 0 : (u.length - i - 1) * 8 + (32 - Math.clz32(u[i])); };
  const toBig = u => { let v = 0n; for (const x of u) v = (v << 8n) | BigInt(x); return v; };
  const fromBig = (v, len) => { const o = new Uint8Array(len); for (let i = len - 1; i >= 0; i--) { o[i] = Number(v & 255n); v >>= 8n; } return o; };
  const fail = (code, message) => { const e = new Error(message); e.code = code; return e; };

  /* ---------- the public key that belongs to a private key ---------- */
  const rsaSpki = (n, e) => { const d = D(); return d.seq(d.seq(d.oid(O.rsa), d.nul()), d.bits(d.seq(d.int(n), d.int(e)))); };
  const ecSpki = (curve, point) => { const d = D(); return d.seq(d.seq(d.oid(O.ec), d.oid(CURVE_NAME[curve])), d.bits(point)); };
  const edSpki = pub => { const d = D(); return d.seq(d.seq(d.oid(O.ed25519)), d.bits(pub)); };
  function ecPublic(curve, dBytes) {
    const I = SC()._internals, c = I.CURVES[curve], ops = I.ecFor(curve), k = toBig(dBytes);
    if (k <= 0n || k >= c.n) throw fail("bad", "the EC private value is outside the valid range");
    const P = ops.mul(k, c.gx, c.gy);
    if (!P) throw fail("bad", "the EC private value gives no point");
    const zi = I.modInv(P[2], c.p), zi2 = (zi * zi) % c.p, x = (P[0] * zi2) % c.p, y = (P[1] * ((zi2 * zi) % c.p)) % c.p;
    return OC().concat(new Uint8Array([4]), fromBig(x, c.bytes), fromBig(y, c.bytes));
  }
  // Ed25519 public key from the 32-byte seed (RFC 8032): written out with BigInt, checked against openssl in the tests
  const P25519 = (1n << 255n) - 19n, mod25 = a => ((a % P25519) + P25519) % P25519;
  function pow25(b, e) { let r = 1n; b = mod25(b); while (e > 0n) { if (e & 1n) r = mod25(r * b); b = mod25(b * b); e >>= 1n; } return r; }
  const inv25 = a => pow25(a, P25519 - 2n);
  const D25 = mod25(-121665n * inv25(121666n));
  function edAdd(P, Q) {
    const [x1, y1] = P, [x2, y2] = Q, t = mod25(D25 * x1 * x2 * y1 * y2);
    return [mod25((x1 * y2 + x2 * y1) * inv25(1n + t)), mod25((y1 * y2 + x1 * x2) * inv25(1n - t))];
  }
  function ed25519Public(seed) {
    const h = SC().digest("SHA-512", seed), a0 = h.slice(0, 32); a0[0] &= 248; a0[31] &= 127; a0[31] |= 64;
    let k = 0n; for (let i = 31; i >= 0; i--) k = (k << 8n) | BigInt(a0[i]);
    const By = mod25(4n * inv25(5n)), x2 = mod25((By * By - 1n) * inv25(D25 * By * By + 1n));
    let Bx = pow25(x2, (P25519 + 3n) / 8n); if (mod25(Bx * Bx - x2) !== 0n) Bx = mod25(Bx * pow25(2n, (P25519 - 1n) / 4n)); if (Bx & 1n) Bx = P25519 - Bx;
    let R = [0n, 1n], A = [Bx, By];
    for (let i = 0; i < 255; i++) { if ((k >> BigInt(i)) & 1n) R = edAdd(R, A); A = edAdd(A, A); }
    const out = new Uint8Array(32); let y = R[1]; for (let i = 0; i < 32; i++) { out[i] = Number(y & 255n); y >>= 8n; } if (R[0] & 1n) out[31] |= 0x80;
    return out;
  }

  /* ---------- reading the plain structures ---------- */
  // PKCS#1 RSAPrivateKey
  function fromPkcs1(der) {
    const d = D(), top = d.read(der, 0), c = d.kids(der, top);
    if (top.tag !== 0x30 || c.length < 9 || c.some(x => x.tag !== 2)) throw fail("bad", "this is not an RSA private key");
    if (d.intOf(der, c[0]) !== 0) throw fail("unsupported", "multi-prime RSA keys are not supported");
    const n = d.uintBytes(der, c[1]), e = d.uintBytes(der, c[2]);
    return { type: "rsa", bits: bitLen(n), n, e, pkcs1: der, spki: rsaSpki(n, e), label: "RSA " + bitLen(n) + " bit" };
  }
  // SEC1 ECPrivateKey (with or without the curve inside); curve is given when the PKCS#8 wrapper names it
  function fromSec1(der, curveFromWrapper) {
    const d = D(), top = d.read(der, 0), c = d.kids(der, top);
    if (top.tag !== 0x30 || c.length < 2 || c[0].tag !== 2 || d.intOf(der, c[0]) !== 1 || c[1].tag !== 4) throw fail("bad", "this is not an EC private key");
    let curve = curveFromWrapper || null, pub = null;
    for (const x of c.slice(2)) {
      if (x.tag === 0xa0) { const inner = d.read(der, x.start, x.end); if (inner.tag === 6) curve = CURVE_OID[d.oidOf(der, inner)] || ("unsupported:" + d.oidOf(der, inner)); }
      if (x.tag === 0xa1) { const inner = d.read(der, x.start, x.end); if (inner.tag === 3) pub = d.content(der, inner).subarray(1); }
    }
    if (!curve) throw fail("bad", "the EC key does not say which curve it uses");
    if (curve.startsWith("unsupported:")) throw fail("unsupported", "this EC curve (" + curve.slice(12) + ") is not supported; P-256, P-384 and P-521 are");
    const dv = d.content(der, c[1]), cb = SC()._internals.CURVES[curve].bytes, dPad = dv.length < cb ? OC().concat(new Uint8Array(cb - dv.length), dv) : dv;
    const point = ecPublic(curve, dPad);
    return { type: "ec", curve, bits: SC()._internals.CURVES[curve].bytes === 66 ? 521 : SC()._internals.CURVES[curve].bytes * 8, d: dPad, sec1: der, spki: ecSpki(curve, point), point, pubGiven: pub, label: "EC " + curve };
  }
  // PKCS#8 PrivateKeyInfo
  function fromPkcs8(der) {
    const d = D(), top = d.read(der, 0), c = d.kids(der, top);
    if (top.tag !== 0x30 || c.length < 3 || c[0].tag !== 2 || c[1].tag !== 0x30 || c[2].tag !== 4) throw fail("bad", "this is not a private key");
    const alg = d.kids(der, c[1]), oid = d.oidOf(der, alg[0]), inner = d.content(der, c[2]);
    let key;
    if (oid === O.rsa) key = fromPkcs1(inner);
    else if (oid === O.ec) {
      let curve = null; if (alg[1] && alg[1].tag === 6) curve = CURVE_OID[d.oidOf(der, alg[1])] || ("unsupported:" + d.oidOf(der, alg[1]));
      key = fromSec1(inner, curve);
    } else if (oid === O.ed25519) {
      const r = d.read(inner, 0); if (r.tag !== 4 || r.end - r.start !== 32) throw fail("bad", "bad Ed25519 key");
      const seed = d.content(inner, r); key = { type: "ed25519", bits: 256, seed, spki: edSpki(ed25519Public(seed)), label: "Ed25519" };
    } else if (oid === O.x25519) key = { type: "x25519", bits: 256, spki: null, label: "X25519 (key exchange only)" };
    else {
      const names = { [O.dsa]: "DSA", [O.rsapss]: "RSA-PSS", [O.ed448]: "Ed448", [O.x448]: "X448" };
      throw fail("unsupported", "this is a " + (names[oid] || "key of type " + oid) + " key, which these tools cannot read (RSA, EC and Ed25519 keys are supported)");
    }
    key.pkcs8 = der;
    return key;
  }
  const toPkcs8 = key => {
    if (key.pkcs8) return key.pkcs8;
    const d = D();
    if (key.type === "rsa") return d.seq(d.int(0), d.seq(d.oid(O.rsa), d.nul()), d.octets(key.pkcs1));
    // EC: the inner key keeps the public point and drops the curve (the wrapper names it), like openssl does
    return d.seq(d.int(0), d.seq(d.oid(O.ec), d.oid(CURVE_NAME[key.curve])), d.octets(d.seq(d.int(1), d.octets(key.d), d.ctx(1, d.bits(key.point)))));
  };

  /* ---------- password-protected keys ---------- */
  function pbkdf1(hash, pw, salt, iter, len) { let t = (hash === "MD5" ? (g.HashCalc || {}).md5 : (b => SC().digest(hash, b)))(OC().concat(pw, salt)); for (let i = 1; i < iter; i++) t = (hash === "MD5" ? g.HashCalc.md5 : (b => SC().digest(hash, b)))(t); return t.subarray(0, len); }
  // Decrypts data protected by a password-based algorithm (alg = the parsed AlgorithmIdentifier of der). pw = { utf8, bmp }: the password as bytes in the two
  // forms the standards use (PBES2 takes UTF-8, the old PKCS#12 schemes take UTF-16). Returns the plain bytes; throws code "password" when the password is wrong.
  async function decryptBlob(der, alg, data, pw) {
    const d = D(), oc = OC(), oid = d.oidOf(der, alg[0]), bad = () => fail("password", "wrong password");
    let plain, bs = 8, padded = true;
    try {
      if (oid === O.pbes2) {
        const p = d.kids(der, alg[1]), kdf = d.kids(der, p[0]), koid = d.oidOf(der, kdf[0]);
        if (koid === O.scrypt) throw fail("unsupported", "this is protected with scrypt, which is not supported here; convert it with: openssl pkcs8 -in key.pem -topk8 -v2 aes-256-cbc -v2prf hmacWithSHA256 -out key8.pem");
        if (koid !== O.pbkdf2) throw fail("unsupported", "unknown key derivation " + koid);
        const kp = d.kids(der, kdf[1]); let salt = null, iter = 0, prf = "SHA-1", keyLen = 0;
        for (const x of kp) { if (x.tag === 4) salt = d.content(der, x); else if (x.tag === 2 && !iter) iter = d.intOf(der, x); else if (x.tag === 2) keyLen = d.intOf(der, x); else if (x.tag === 0x30) prf = O.prf[d.oidOf(der, d.kids(der, x)[0])] || null; }
        if (!salt || !iter || !prf) throw fail("unsupported", "unsupported key derivation settings");
        const sch = d.kids(der, p[1]), cipher = O.cipher[d.oidOf(der, sch[0])];
        if (!cipher) throw fail("unsupported", "unsupported cipher " + d.oidOf(der, sch[0]));
        const iv = d.content(der, sch[1]), key = await oc.pbkdf2(prf, pw.utf8, salt, iter, keyLen || cipher[1]);
        bs = cipher[0] === "aes" ? 16 : 8;
        plain = cipher[0] === "aes" ? oc.aesCbc(key, iv, data, true) : oc.desCbc(key, iv, data, true);
      } else if (O.pbe12[oid]) {
        const kind = O.pbe12[oid], pr = d.kids(der, alg[1]), salt = d.content(der, pr[0]), iter = d.intOf(der, pr[1]);
        const kd = (id, len) => oc.pkcs12Kdf("SHA-1", pw.bmp, salt, iter, id, len);
        if (kind === "3DES") plain = oc.desCbc(kd(1, 24), kd(2, 8), data, true);
        else if (kind === "3DES-2KEY") plain = oc.desCbc(kd(1, 16), kd(2, 8), data, true);
        else if (kind === "RC2-40") plain = oc.rc2Cbc(kd(1, 5), 40, kd(2, 8), data, true);
        else if (kind === "RC2-128") plain = oc.rc2Cbc(kd(1, 16), 128, kd(2, 8), data, true);
        else { plain = oc.rc4(kd(1, kind === "RC4-40" ? 5 : 16), data); padded = false; }
      } else if (O.pbe5[oid]) {
        const pr = d.kids(der, alg[1]), salt = d.content(der, pr[0]), iter = d.intOf(der, pr[1]), dk = pbkdf1(O.pbe5[oid][0], pw.utf8, salt, iter, 16);
        plain = oc.desCbc(dk.subarray(0, 8), dk.subarray(8, 16), data, true);
      } else throw fail("unsupported", "unsupported protection " + oid);
    } catch (e) { if (e.code === "unsupported") throw e; throw bad(); }
    const un = padded ? oc.unpad(plain, bs) : plain;
    if (!un) throw bad();
    return un;
  }
  // EncryptedPrivateKeyInfo -> the plain PKCS#8 bytes
  async function decryptEpki(der, password) {
    const d = D(), oc = OC(), top = d.read(der, 0), c = d.kids(der, top), un = await decryptBlob(der, d.kids(der, c[0]), d.content(der, c[1]), { utf8: oc.utf8(password), bmp: oc.bmp(password) });
    try { fromPkcs8(un); } catch (e) { if (e.code === "unsupported") throw e; throw fail("password", "wrong password"); }
    return un;
  }
  // old OpenSSL PEM files with headers: Proc-Type: 4,ENCRYPTED / DEK-Info: AES-256-CBC,<iv>
  function decryptDek(der, dek, password) {
    const oc = OC(), m = /^([A-Z0-9-]+),([0-9A-Fa-f]+)$/.exec(dek || ""); if (!m) throw fail("bad", "unreadable DEK-Info header");
    const iv = D().unhex(m[2].toLowerCase()), spec = { "AES-128-CBC": ["aes", 16], "AES-192-CBC": ["aes", 24], "AES-256-CBC": ["aes", 32], "DES-EDE3-CBC": ["des3", 24], "DES-CBC": ["des", 8] }[m[1]];
    if (!spec) throw fail("unsupported", "unsupported key encryption " + m[1]);
    const { key } = oc.evpBytesToKey(oc.utf8(password), iv.subarray(0, 8), spec[1], iv.length);
    let plain; try { plain = spec[0] === "aes" ? oc.aesCbc(key, iv, der, true) : oc.desCbc(key, iv, der, true); } catch { throw fail("password", "wrong password"); }
    const un = oc.unpad(plain, spec[0] === "aes" ? 16 : 8); if (!un) throw fail("password", "wrong password");
    return un;
  }

  /* ---------- finding out what a file is ---------- */
  const looksPem = b => { try { const s = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 4000)); return /-----BEGIN /.test(s); } catch { return false; } };
  // quick classification for the package checker: "key" | "encrypted-key" | null
  function sniff(input) {
    const d = D(), b = typeof input === "string" ? new TextEncoder().encode(input) : input;
    if (looksPem(b)) {
      for (const blk of d.pemBlocks(new TextDecoder().decode(b))) {
        if (blk.label === "ENCRYPTED PRIVATE KEY") return "encrypted-key";
        if (/PRIVATE KEY$/.test(blk.label)) return blk.headers["Proc-Type"] && /ENCRYPTED/.test(blk.headers["Proc-Type"]) ? "encrypted-key" : "key";
      }
      return null;
    }
    try {
      const top = d.read(b, 0); if (top.tag !== 0x30 || top.end !== b.length) return null;
      const c = d.kids(b, top);
      if (c.length === 2 && c[0].tag === 0x30 && c[1].tag === 4) { const a = d.kids(b, c[0]); if (a[0] && a[0].tag === 6) { const o = d.oidOf(b, a[0]); if (o === O.pbes2 || O.pbe12[o] || O.pbe5[o]) return "encrypted-key"; } }
      if (c.length >= 3 && c[0].tag === 2 && c[1].tag === 0x30 && c[2].tag === 4) { const a = d.kids(b, c[1]); if (a[0] && a[0].tag === 6 && [O.rsa, O.ec, O.ed25519, O.x25519, O.dsa, O.rsapss, O.ed448, O.x448].includes(d.oidOf(b, a[0]))) return "key"; }
      if (c.length >= 9 && c.every(x => x.tag === 2) && d.intOf(b, c[0]) === 0) return "key";                         // PKCS#1
      if (c.length >= 2 && c[0].tag === 2 && d.intOf(b, c[0]) === 1 && c[1].tag === 4) return "key";                     // SEC1
    } catch { /* not DER */ }
    return null;
  }

  // readKey(textOrBytes, password?) -> { status: "ok", key } | { status: "password", wrong: bool } | { status: "error", message }
  async function readKey(input, password) {
    const d = D(), b = typeof input === "string" ? new TextEncoder().encode(input) : input;
    try {
      let der, how = "";
      if (looksPem(b)) {
        const blk = d.pemBlocks(new TextDecoder().decode(b)).find(x => /PRIVATE KEY$/.test(x.label));
        if (!blk || !blk.der) return { status: "error", message: "No readable private key block was found." };
        der = blk.der;
        const encrypted = blk.headers["Proc-Type"] && /ENCRYPTED/.test(blk.headers["Proc-Type"]);
        if (blk.label === "ENCRYPTED PRIVATE KEY") {
          if (password == null || password === "") return { status: "password", wrong: false, how: "ENCRYPTED PRIVATE KEY" };
          der = await decryptEpki(der, password); how = "PKCS#8, password protected";
        } else if (encrypted) {
          if (password == null || password === "") return { status: "password", wrong: false, how: "old-style encrypted PEM (" + (blk.headers["DEK-Info"] || "").split(",")[0] + ")" };
          der = decryptDek(der, blk.headers["DEK-Info"], password); how = "traditional PEM, password protected";
        } else how = { "RSA PRIVATE KEY": "traditional RSA (PKCS#1)", "EC PRIVATE KEY": "traditional EC (SEC1)", "PRIVATE KEY": "PKCS#8", "DSA PRIVATE KEY": "traditional DSA" }[blk.label] || blk.label;
        if (blk.label === "DSA PRIVATE KEY") throw fail("unsupported", "this is a DSA key, which these tools cannot read (RSA, EC and Ed25519 keys are supported)");
        const key = blk.label === "RSA PRIVATE KEY" || (encrypted && blk.label === "RSA PRIVATE KEY") ? fromPkcs1(der) : blk.label === "EC PRIVATE KEY" ? fromSec1(der) : fromPkcs8(der);
        key.how = how; key.encrypted = how.includes("password"); return { status: "ok", key };
      }
      // binary
      der = b; const kind = sniff(b);
      if (kind === "encrypted-key") {
        if (password == null || password === "") return { status: "password", wrong: false, how: "ENCRYPTED PRIVATE KEY (DER)" };
        der = await decryptEpki(der, password);
      }
      const top = d.read(der, 0), c = d.kids(der, top);
      let key;
      if (c[1] && c[1].tag === 0x30) key = fromPkcs8(der); else if (c[0] && c[0].tag === 2 && d.intOf(der, c[0]) === 1 && c[1] && c[1].tag === 4) key = fromSec1(der); else key = fromPkcs1(der);
      key.how = (kind === "encrypted-key" ? "PKCS#8 DER, password protected" : "binary (DER)"); key.encrypted = kind === "encrypted-key";
      return { status: "ok", key };
    } catch (e) {
      if (e.code === "password") return { status: "password", wrong: true };
      return { status: "error", message: e.code ? e.message : "This does not look like a private key I can read." };
    }
  }
  // the same, for a key that is already plain PKCS#8 bytes (coming out of a PFX file)
  const readPkcs8 = der => { const k = fromPkcs8(der); k.how = "from the PFX file"; return k; };

  /* ---------- writing keys ---------- */
  const rnd = n => { const a = new Uint8Array(n); (g.crypto || require("crypto").webcrypto).getRandomValues(a); return a; };
  // Protects bytes with a password. mode "aes256" = PBES2 with PBKDF2-SHA256 and AES-256-CBC (modern); "3des" = the old PKCS#12 3DES scheme that old Windows
  // and Java understand. Returns { alg: the AlgorithmIdentifier as DER, ct: the encrypted bytes }.
  async function encryptBlob(plain, password, mode) {
    const d = D(), oc = OC();
    if (mode === "3des") {
      const salt = rnd(8), iter = 2048, bp = oc.bmp(password), key = oc.pkcs12Kdf("SHA-1", bp, salt, iter, 1, 24), iv = oc.pkcs12Kdf("SHA-1", bp, salt, iter, 2, 8);
      return { alg: d.seq(d.oid("1.2.840.113549.1.12.1.3"), d.seq(d.octets(salt), d.int(iter))), ct: oc.desCbc(key, iv, oc.pad(plain, 8), false) };
    }
    const salt = rnd(16), iv = rnd(16), iter = g.crypto && g.crypto.subtle ? 100000 : 10000, key = await oc.pbkdf2("SHA-256", oc.utf8(password), salt, iter, 32);
    return { alg: d.seq(d.oid(O.pbes2), d.seq(d.seq(d.oid(O.pbkdf2), d.seq(d.octets(salt), d.int(iter), d.seq(d.oid("1.2.840.113549.2.9"), d.nul()))), d.seq(d.oid("2.16.840.1.101.3.4.1.42"), d.octets(iv)))), ct: oc.aesCbc(key, iv, oc.pad(plain, 16), false) };
  }
  async function encryptPkcs8(pkcs8, password, mode) { const e = await encryptBlob(pkcs8, password, mode); return D().seq(e.alg, D().octets(e.ct)); }
  // format: "pkcs8" | "pkcs8-encrypted" | "pkcs8-encrypted-3des" | "traditional" | "der"; returns { text? , bytes?, name }
  async function exportKey(key, format, password) {
    const d = D(), p8 = toPkcs8(key);
    if (format === "pkcs8") return { text: d.pemOut("PRIVATE KEY", p8), name: "key.pem" };
    if (format === "der") return { bytes: p8, name: "key.der" };
    if (format === "pkcs8-encrypted" || format === "pkcs8-encrypted-3des") return { text: d.pemOut("ENCRYPTED PRIVATE KEY", await encryptPkcs8(p8, password, format.endsWith("3des") ? "3des" : "aes256")), name: "key-encrypted.pem" };
    if (format === "traditional") {
      if (key.type === "rsa") return { text: d.pemOut("RSA PRIVATE KEY", key.pkcs1), name: "key.pem" };
      if (key.type === "ec") return { text: d.pemOut("EC PRIVATE KEY", d.seq(d.int(1), d.octets(key.d), d.ctx(0, d.oid(CURVE_NAME[key.curve])), d.ctx(1, d.bits(key.point)))), name: "key.pem" };
      throw fail("unsupported", "an " + key.label + " key has no traditional format: use PKCS#8");
    }
    throw fail("bad", "unknown format");
  }

  g.KeyFmt = { readKey, sniff, readPkcs8, exportKey, encryptPkcs8, encryptBlob, decryptEpki, decryptBlob, toPkcs8, ecPublic, ed25519Public, rsaSpki, ecSpki, edSpki, bitLen };
  if (typeof module !== "undefined") module.exports = g.KeyFmt;
})();
