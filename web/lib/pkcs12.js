/* PFX / PKCS#12 files for the certificate tools: reads them (modern AES files, the old Windows and Java 3DES files, the very old RC2-40 files, files with no
   password at all) and writes them (modern, old-compatible, or with no password). Written with the DER helper in lib/derkit.js and the ciphers in
   lib/oldcrypto.js; the pkijs library in this project cannot read the old encryption schemes. Works in the page and in node, touches nothing else.
   Exports window.Pkcs12. Tested against openssl (pkcs12-test.js). */
(() => {
  "use strict";
  const g = typeof window !== "undefined" ? window : globalThis;
  const D = () => g.DerKit, OC = () => g.OldCrypto, KF = () => g.KeyFmt, SC = () => g.SoftCrypto;
  const OID = {
    data: "1.2.840.113549.1.7.1", encrypted: "1.2.840.113549.1.7.6", signed: "1.2.840.113549.1.7.2",
    keyBag: "1.2.840.113549.1.12.10.1.1", shrouded: "1.2.840.113549.1.12.10.1.2", certBag: "1.2.840.113549.1.12.10.1.3", crlBag: "1.2.840.113549.1.12.10.1.4", secretBag: "1.2.840.113549.1.12.10.1.5", safeBag: "1.2.840.113549.1.12.10.1.6",
    x509: "1.2.840.113549.1.9.22.1", friendly: "1.2.840.113549.1.9.20", localKey: "1.2.840.113549.1.9.21", pbmac1: "1.2.840.113549.1.5.14",
  };
  const HASH = { "1.3.14.3.2.26": "SHA-1", "2.16.840.1.101.3.4.2.4": "SHA-224", "2.16.840.1.101.3.4.2.1": "SHA-256", "2.16.840.1.101.3.4.2.2": "SHA-384", "2.16.840.1.101.3.4.2.3": "SHA-512" };
  const HASH_OID = Object.fromEntries(Object.entries(HASH).map(([k, v]) => [v, k]));
  const ALG_NAME = {
    "1.2.840.113549.1.12.1.1": "RC4 128-bit (very old)", "1.2.840.113549.1.12.1.2": "RC4 40-bit (very old)", "1.2.840.113549.1.12.1.3": "Triple-DES (old Windows and Java)", "1.2.840.113549.1.12.1.4": "2-key Triple-DES (old)",
    "1.2.840.113549.1.12.1.5": "RC2 128-bit (old)", "1.2.840.113549.1.12.1.6": "RC2 40-bit (very old)", "1.2.840.113549.1.5.13": "AES (PBES2, modern)",
  };
  const fail = (code, message) => { const e = new Error(message); e.code = code; return e; };
  const same = (a, b) => OC().eq(a, b);
  const bmpText = u => { let s = ""; for (let i = 0; i + 1 < u.length; i += 2) s += String.fromCharCode((u[i] << 8) | u[i + 1]); return s; };

  // the passwords to try: the typed one; for an empty one both ways the standard allows ("" as 00 00, and nothing at all)
  function variants(password) {
    const oc = OC(), mk = (u, b) => ({ utf8: u, bmp: b });
    if (password) return [mk(oc.utf8(password), oc.bmp(password))];
    return [mk(new Uint8Array(0), oc.bmp("")), mk(new Uint8Array(0), new Uint8Array(0))];
  }
  function attrsOf(b, set) {
    const d = D(), out = { friendlyName: "", localKeyId: "" };
    if (!set) return out;
    for (const a of d.kids(b, set)) { const k = d.kids(b, a); if (!k[1]) continue; const v = d.kids(b, k[1])[0]; if (!v) continue; const o = d.oidOf(b, k[0]); if (o === OID.friendly) out.friendlyName = bmpText(d.content(b, v)); if (o === OID.localKey) out.localKeyId = d.hex(d.content(b, v)); }
    return out;
  }
  function parseBags(b, node, found, ctxInfo, pw) {
    const d = D();
    return Promise.all(d.kids(b, node).map(async bag => {
      const k = d.kids(b, bag), id = d.oidOf(b, k[0]), val = k[1] && k[1].tag === 0xa0 ? d.read(b, k[1].start, k[1].end) : null, at = attrsOf(b, k[2] && k[2].tag === 0x31 ? k[2] : null);
      if (id === OID.certBag && val) {
        const c = d.kids(b, val); if (d.oidOf(b, c[0]) === OID.x509) { const inner = d.read(b, c[1].start, c[1].end); found.certs.push({ der: d.content(b, inner).slice(), friendlyName: at.friendlyName, localKeyId: at.localKeyId }); }
        else found.other.push("a certificate of another type");
      } else if (id === OID.keyBag && val) found.keys.push({ pkcs8: d.whole(b, val).slice(), friendlyName: at.friendlyName, localKeyId: at.localKeyId, shrouded: false });
      else if (id === OID.shrouded && val) {
        const un = await KF().decryptBlob(b, d.kids(b, d.kids(b, val)[0]), d.content(b, d.kids(b, val)[1]), pw);
        found.keys.push({ pkcs8: un, friendlyName: at.friendlyName, localKeyId: at.localKeyId, shrouded: true, alg: d.oidOf(b, d.kids(b, d.kids(b, val)[0])[0]) });
      } else if (id === OID.crlBag) found.other.push("a revocation list (CRL)");
      else if (id === OID.secretBag) found.other.push("a secret value");
      else if (id === OID.safeBag && val) await parseBags(b, d.read(b, val.start, val.end), found, ctxInfo, pw);
      else found.other.push("an item of type " + id);
    }));
  }

  // parse(bytes, password?) -> { status: "ok", certs, keys, info } | { status: "password", wrong } | { status: "error", message }
  async function parse(bytes, password) {
    const d = D(), oc = OC(), b = bytes;
    try {
      const top = d.read(b, 0); if (top.tag !== 0x30 || top.end !== b.length) return { status: "error", message: "This is not a PFX / PKCS#12 file." };
      const c = d.kids(b, top); if (c.length < 2 || c[0].tag !== 2 || d.intOf(b, c[0]) !== 3) return { status: "error", message: "This is not a PFX / PKCS#12 file (version 3)." };
      const ci = d.kids(b, c[1]), coid = d.oidOf(b, ci[0]);
      if (coid === OID.signed) return { status: "error", message: "This PFX is protected with a public key (not a password), which these tools do not read." };
      if (coid !== OID.data) return { status: "error", message: "This PFX has an unknown layout." };
      const authSafeBytes = d.content(b, d.read(b, ci[1].start, ci[1].end));
      const info = { macAlg: "", macIterations: 0, macPresent: false, macChecked: false, protection: [], notes: [] };
      let pw = variants(password)[0], good = null;
      const cands = variants(password);
      if (c[2]) {
        const mac = d.kids(b, c[2]), dig = d.kids(b, mac[0]), alg = d.oidOf(b, d.kids(b, dig[0])[0]), want = d.content(b, dig[1]), salt = d.content(b, mac[1]), iter = mac[2] ? d.intOf(b, mac[2]) : 1;
        info.macPresent = true;
        if (alg === OID.pbmac1) return { status: "error", message: "This PFX uses the newer PBMAC1 integrity protection, which is not supported yet." };
        const h = HASH[alg]; if (!h) return { status: "error", message: "Unsupported integrity algorithm " + alg + "." };
        info.macAlg = h; info.macIterations = iter;
        for (const v of cands) { const key = oc.pkcs12Kdf(h, v.bmp, salt, iter, 3, oc.OUT[h]); if (same(oc.hmac(h, key, authSafeBytes), want)) { good = v; break; } }
        if (!good) return { status: "password", wrong: !!password, how: "PFX" };
        pw = good; info.macChecked = true;
      }
      const found = { certs: [], keys: [], other: [] };
      const asRoot = d.read(authSafeBytes, 0), items = d.kids(authSafeBytes, asRoot);
      for (const it of items) {
        const k = d.kids(authSafeBytes, it), id = d.oidOf(authSafeBytes, k[0]), val = d.read(authSafeBytes, k[1].start, k[1].end);
        if (id === OID.data) {
          const sc = d.content(authSafeBytes, val), before = found.certs.length + found.keys.filter(x => !x.shrouded).length;
          await parseBags(sc, d.read(sc, 0), found, info, pw);
          if (found.certs.length + found.keys.filter(x => !x.shrouded).length > before) info.protection.push("not encrypted");      // certificates or a plain key sit in the open
        }
        else if (id === OID.encrypted) {
          const ed = d.kids(authSafeBytes, val), eci = d.kids(authSafeBytes, ed[1]), alg = d.kids(authSafeBytes, eci[1]), aoid = d.oidOf(authSafeBytes, alg[0]);
          const ct = eci[2] && eci[2].tag === 0x80 ? d.content(authSafeBytes, eci[2]) : eci[2] && eci[2].tag === 0xa0 ? d.content(authSafeBytes, d.read(authSafeBytes, eci[2].start, eci[2].end)) : null;
          if (!ct) throw fail("bad", "the encrypted part of this PFX is damaged");
          let plain = null, lastErr = null;
          for (const v of good ? [good] : cands) { try { plain = await KF().decryptBlob(authSafeBytes, alg, ct, v); pw = v; break; } catch (e) { lastErr = e; if (e.code !== "password") throw e; } }
          if (!plain) return { status: "password", wrong: !!password, how: "PFX" };
          info.protection.push(ALG_NAME[aoid] || aoid);
          await parseBags(plain, d.read(plain, 0), found, info, pw);
        } else found.other.push("a part of type " + id);
      }
      // wrong password with no integrity check: the shrouded key would not decrypt, so we would already have returned
      for (const kk of found.keys) { try { kk.key = KF().readPkcs8(kk.pkcs8); } catch (e) { kk.error = e.message; } if (kk.alg) info.protection.push("key: " + (ALG_NAME[kk.alg] || kk.alg)); }
      info.protection = [...new Set(info.protection)];
      if (!info.macPresent) info.notes.push("This PFX has no integrity check (no MAC), so nothing proves that it was not altered.");
      if (info.protection.every(x => x === "not encrypted") && found.keys.length) info.notes.push("The private key in this PFX is NOT protected by a password: anyone who gets the file can use it.");
      return { status: "ok", certs: found.certs, keys: found.keys, other: found.other, info };
    } catch (e) {
      if (e.code === "password") return { status: "password", wrong: !!password, how: "PFX" };
      return { status: "error", message: e.code ? e.message : "This PFX file could not be read: it is damaged or not a PFX." };
    }
  }

  /* ---------- writing ---------- */
  const rnd = n => { const a = new Uint8Array(n); (g.crypto || require("crypto").webcrypto).getRandomValues(a); return a; };
  const attrs = (name, id) => { const d = D(); return d.set(...(name ? [d.seq(d.oid(OID.friendly), d.set(d.bmpString(name)))] : []), d.seq(d.oid(OID.localKey), d.set(d.octets(id)))); };
  // build({ certs: [DER, ...] (the server certificate first), key: PKCS#8 bytes or null, password: string or "" for none, flavour: "modern" | "compat", name })
  async function build(o) {
    const d = D(), oc = OC(), certs = o.certs || [], password = o.password || "", withPw = password !== "";
    if (!certs.length && !o.key) throw fail("bad", "nothing to put in the PFX");
    const id = certs.length ? SC().digest("SHA-1", certs[0]) : rnd(20);
    const certBags = certs.map((der, i) => d.seq(d.oid(OID.certBag), d.ctx(0, d.seq(d.oid(OID.x509), d.ctx(0, d.octets(der)))), i === 0 ? attrs(o.name, id) : d.set()));
    const items = [];
    if (certBags.length) {
      const sc = d.seq(...certBags);
      if (withPw) {
        const e = await KF().encryptBlob(sc, password, o.flavour === "compat" ? "3des" : "aes256");
        items.push(d.seq(d.oid(OID.encrypted), d.ctx(0, d.seq(d.int(0), d.seq(d.oid(OID.data), e.alg, d.ctxImplicit(0, e.ct))))));
      } else items.push(d.seq(d.oid(OID.data), d.ctx(0, d.octets(sc))));
    }
    if (o.key) {
      let bag;
      if (withPw) { const e = await KF().encryptBlob(o.key, password, o.flavour === "compat" ? "3des" : "aes256"); bag = d.seq(d.oid(OID.shrouded), d.ctx(0, d.seq(e.alg, d.octets(e.ct))), attrs(o.name, id)); }
      else bag = d.seq(d.oid(OID.keyBag), d.ctx(0, o.key), attrs(o.name, id));
      items.push(d.seq(d.oid(OID.data), d.ctx(0, d.octets(d.seq(bag)))));
    }
    const authSafe = d.seq(...items), content = d.seq(d.oid(OID.data), d.ctx(0, d.octets(authSafe)));
    if (!withPw) return d.seq(d.int(3), content);                                     // no password: nothing to protect or to check
    const h = o.flavour === "compat" ? "SHA-1" : "SHA-256", iter = o.flavour === "compat" ? 2048 : 100000, salt = rnd(16), bp = oc.bmp(password);
    const mac = oc.hmac(h, oc.pkcs12Kdf(h, bp, salt, iter, 3, oc.OUT[h]), authSafe);
    return d.seq(d.int(3), content, d.seq(d.seq(d.seq(d.oid(HASH_OID[h]), d.nul()), d.octets(mac)), d.octets(salt), d.int(iter)));
  }

  g.Pkcs12 = { parse, build };
  if (typeof module !== "undefined") module.exports = g.Pkcs12;
})();
