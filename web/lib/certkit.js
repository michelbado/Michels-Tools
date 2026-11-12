/* Certificate package checker: works out what each file of a package is (certificate, key, CSR, chain, PFX, P7B, public key), opens PFX files and encrypted keys
   when given the password, and judges the whole package: does the key match the certificate, is the chain complete and in the right order, are the dates, names
   and strengths fine. Plain-language verdicts with "what to do" lines. Pure logic: it reads bytes and returns data; it touches no page, no storage, no network.
   Needs lib/certinfo.js (pkijs), derkit.js, keyfmt.js, pkcs12.js, softcrypto.js (all looked up when used). Exports window.CertKit. Tested against openssl (certkit-test.js). */
(() => {
  "use strict";
  const g = typeof window !== "undefined" ? window : globalThis;
  const D = () => g.DerKit, KF = () => g.KeyFmt, P12 = () => g.Pkcs12, CI = () => g.CertInfo, SC = () => g.SoftCrypto;
  const hex = u => Array.from(u, b => b.toString(16).padStart(2, "0")).join("");
  const DAY = 86400000;
  const SIG = {
    "1.2.840.113549.1.1.5": "SHA-1 with RSA", "1.2.840.113549.1.1.4": "MD5 with RSA", "1.2.840.113549.1.1.11": "SHA-256 with RSA", "1.2.840.113549.1.1.12": "SHA-384 with RSA", "1.2.840.113549.1.1.13": "SHA-512 with RSA", "1.2.840.113549.1.1.10": "RSA-PSS",
    "1.2.840.10045.4.1": "SHA-1 with ECDSA", "1.2.840.10045.4.3.2": "SHA-256 with ECDSA", "1.2.840.10045.4.3.3": "SHA-384 with ECDSA", "1.2.840.10045.4.3.4": "SHA-512 with ECDSA", "1.3.101.112": "Ed25519",
  };
  const KU = ["digital signature", "non-repudiation", "key encipherment", "data encipherment", "key agreement", "certificate signing", "CRL signing", "encipher only", "decipher only"];
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  /* ---------- reading one certificate or request ---------- */
  // the SubjectPublicKeyInfo exactly as it sits in the file (certificate: field 6 of the signed part, or 5 for a version 1 certificate; request: field 3)
  function spkiOf(der, isCsr) {
    const d = D(), top = d.read(der, 0), tbs = d.kids(der, d.kids(der, top)[0]);
    const i = isCsr ? 2 : tbs[0].tag === 0xa0 ? 6 : 5;
    return d.whole(der, tbs[i]).slice();
  }
  function altNames(c) {
    const ext = (c.extensions || []).find(e => e.extnID === "2.5.29.17"), out = [];
    if (!ext || !ext.parsedValue) return out;
    for (const a of ext.parsedValue.altNames) {
      if (a.type === 2) out.push({ kind: "DNS", value: String(a.value) });
      else if (a.type === 7) { const u = new Uint8Array(a.value.valueBlock.valueHexView); out.push({ kind: "IP", value: u.length === 4 ? Array.from(u).join(".") : hex(u).match(/.{4}/g).join(":") }); }
      else if (a.type === 1) out.push({ kind: "Email", value: String(a.value) });
      else if (a.type === 6) out.push({ kind: "URI", value: String(a.value) });
    }
    return out;
  }
  const extOf = (c, oid) => (c.extensions || []).find(e => e.extnID === oid);
  const dnKey = name => hex(new Uint8Array(name.toSchema().toBER(false)));
  function keyDesc(spki) {
    const d = D(), top = d.read(spki, 0), alg = d.kids(spki, d.kids(spki, top)[0]), oid = d.oidOf(spki, alg[0]);
    if (oid === "1.2.840.113549.1.1.1") { const body = d.content(spki, d.kids(spki, top)[1]).subarray(1), n = d.uintBytes(body, d.kids(body, d.read(body, 0))[0]); return { type: "RSA", bits: KF().bitLen(n), label: "RSA " + KF().bitLen(n) + " bit" }; }
    if (oid === "1.2.840.10045.2.1") { const cn = { "1.2.840.10045.3.1.7": "P-256", "1.3.132.0.34": "P-384", "1.3.132.0.35": "P-521" }[d.oidOf(spki, alg[1])] || "unknown curve"; return { type: "EC", bits: cn === "P-256" ? 256 : cn === "P-384" ? 384 : cn === "P-521" ? 521 : 0, label: "EC " + cn }; }
    if (oid === "1.3.101.112") return { type: "Ed25519", bits: 256, label: "Ed25519" };
    return { type: "other", bits: 0, label: "key type " + oid };
  }
  function parseCert(der, from) {
    const c = CI().readCert(der), d = D();
    const spki = spkiOf(der, false), bc = extOf(c, "2.5.29.19"), ku = extOf(c, "2.5.29.15"), eku = extOf(c, "2.5.29.37"), ski = extOf(c, "2.5.29.14"), aki = extOf(c, "2.5.29.35"), aia = extOf(c, "1.3.6.1.5.5.7.1.1");
    const kuBits = []; if (ku && ku.parsedValue) { const v = new Uint8Array(ku.parsedValue.valueBlock.valueHexView); KU.forEach((n, i) => { if (v[i >> 3] & (0x80 >> (i & 7))) kuBits.push(n); }); }
    const cn = (c.subject.typesAndValues.find(t => t.type === "2.5.4.3") || { value: { valueBlock: { value: "" } } }).value.valueBlock.value;
    let issuersUrl = ""; if (aia && aia.parsedValue) for (const a of aia.parsedValue.accessDescriptions) if (a.accessMethod === "1.3.6.1.5.5.7.48.2" && a.accessLocation.type === 6) issuersUrl = String(a.accessLocation.value);
    const sigOid = c.signatureAlgorithm.algorithmId;
    return {
      kind: "cert", from, der, cert: c, subject: CI().dnText(c.subject), issuer: CI().dnText(c.issuer), cn: String(cn), subjectKey: dnKey(c.subject), issuerKey: dnKey(c.issuer), selfIssued: c.subject.isEqual(c.issuer),
      notBefore: c.notBefore.value.getTime(), notAfter: c.notAfter.value.getTime(), names: altNames(c), isCA: !!(bc && bc.parsedValue && bc.parsedValue.cA), pathLen: bc && bc.parsedValue && bc.parsedValue.pathLenConstraint !== undefined ? bc.parsedValue.pathLenConstraint : null, hasBc: !!bc,
      keyUsage: kuBits, hasKu: !!ku, eku: eku && eku.parsedValue ? eku.parsedValue.keyPurposes : null, ski: ski && ski.parsedValue ? hex(new Uint8Array(ski.parsedValue.valueBlock.valueHexView)) : "", aki: aki && aki.parsedValue && aki.parsedValue.keyIdentifier ? hex(new Uint8Array(aki.parsedValue.keyIdentifier.valueBlock.valueHexView)) : "",
      issuersUrl, spki, key: keyDesc(spki), sigAlg: SIG[sigOid] || sigOid, sha256: hex(SC().digest("SHA-256", der)), sha1: hex(SC().digest("SHA-1", der)), version: c.version + 1,
    };
  }
  function parseCsr(der, from) {
    const asn = g.asn1js.fromBER(der.buffer.slice(der.byteOffset, der.byteOffset + der.length)); if (asn.offset === -1) throw new Error("bad csr");
    const r = new g.pkijs.CertificationRequest({ schema: asn.result }), spki = spkiOf(der, true);
    let names = [];
    for (const a of (r.attributes || [])) if (a.type === "1.2.840.113549.1.9.14") { try { const exts = new g.pkijs.Extensions({ schema: a.values[0] }); const san = exts.extensions.find(e => e.extnID === "2.5.29.17"); if (san && san.parsedValue) names = san.parsedValue.altNames.filter(x => x.type === 2).map(x => ({ kind: "DNS", value: String(x.value) })); } catch { /* no usable extension list */ } }
    return { kind: "csr", from, der, csr: r, subject: CI().dnText(r.subject), names, spki, key: keyDesc(spki), sigAlg: SIG[r.signatureAlgorithm.algorithmId] || r.signatureAlgorithm.algorithmId, sha256: hex(SC().digest("SHA-256", der)) };
  }

  /* ---------- working out what a file is ---------- */
  const text = b => new TextDecoder("utf-8", { fatal: false }).decode(b);
  function shape(der) {          // "pfx" | "p7" | "cert" | "csr" | "spki" | null
    const d = D();
    try {
      const top = d.read(der, 0); if (top.tag !== 0x30 || top.end !== der.length) return null;
      const c = d.kids(der, top);
      if (c.length >= 2 && c[0].tag === 2 && d.intOf(der, c[0]) === 3 && c[1].tag === 0x30) return "pfx";
      if (c.length === 2 && c[0].tag === 6 && c[1].tag === 0xa0) return d.oidOf(der, c[0]) === "1.2.840.113549.1.7.2" ? "p7" : null;
      if (c.length === 2 && c[0].tag === 0x30 && c[1].tag === 3) { const a = d.kids(der, c[0]); if (a[0] && a[0].tag === 6) return "spki"; }
      if (c.length === 3 && c[0].tag === 0x30 && c[1].tag === 0x30 && c[2].tag === 3) {
        const t = d.kids(der, c[0]);
        if (t.length <= 4 && t[0].tag === 2 && d.intOf(der, t[0]) === 0 && t[1] && t[1].tag === 0x30 && (!t[3] || t[3].tag === 0xa0)) return "csr";
        return "cert";
      }
    } catch { /* not DER */ }
    return null;
  }
  function p7Certs(der) {           // the certificates inside a .p7b (a SignedData with no content)
    const d = D(), top = d.read(der, 0), c = d.kids(der, top), sd = d.read(der, c[1].start, c[1].end), parts = d.kids(der, sd), out = [];
    const certs = parts.find(x => x.tag === 0xa0);
    if (certs) for (const k of d.kids(der, certs)) if (k.tag === 0x30) out.push(d.whole(der, k).slice());
    return out;
  }
  // files: [{ name, bytes }]  ->  { items, notes }. Encrypted keys and PFX files come back as { kind: "locked" } until unlock() is given the password.
  async function classify(files) {
    const d = D(), items = [], notes = [];
    for (const f of files) {
      const b = f.bytes, name = f.name || "(pasted)";
      const addDer = async (der, label) => {
        const sh = shape(der);
        if (sh === "cert") { try { items.push(parseCert(der, name)); } catch { notes.push({ file: name, level: "bad", text: name + ": a certificate was found but it is damaged or unreadable." }); } }
        else if (sh === "csr") { try { items.push(parseCsr(der, name)); } catch { notes.push({ file: name, level: "bad", text: name + ": a certificate request was found but it is damaged." }); } }
        else if (sh === "pfx") { const r = await P12().parse(der, ""); await handlePfx(name, der, r); }
        else if (sh === "p7") { for (const c of p7Certs(der)) { try { items.push(parseCert(c, name + " (inside the P7B)")); } catch { /* skip */ } } }
        else if (sh === "spki") items.push({ kind: "pubkey", from: name, spki: der, key: keyDesc(der) });
        else {
          const k = KF().sniff(der);
          if (k) await handleKey(name, der);
          else notes.push({ file: name, level: "warn", text: name + ": I could not tell what this is" + (label ? " (" + label + ")" : "") + ". It is not a certificate, key, request or PFX that I can read." });
        }
      };
      const handleKey = async (nm, bytes) => {
        const r = await KF().readKey(bytes, "");
        if (r.status === "ok") items.push({ kind: "key", from: nm, key: r.key });
        else if (r.status === "password") items.push({ kind: "locked", what: "key", from: nm, bytes, how: r.how });
        else notes.push({ file: nm, level: "bad", text: nm + ": " + r.message });
      };
      const handlePfx = async (nm, bytes, r) => {
        if (r.status === "ok") expandPfx(nm, r, items, notes);
        else if (r.status === "password") items.push({ kind: "locked", what: "pfx", from: nm, bytes, how: "PFX" });
        else notes.push({ file: nm, level: "bad", text: nm + ": " + r.message });
      };
      if (!b.length) { notes.push({ file: name, level: "warn", text: name + " is empty." }); continue; }
      const t = /-----BEGIN /.test(text(b.subarray(0, 4000))) ? text(b) : null;
      if (t) {
        const blocks = d.pemBlocks(t); let used = 0;
        for (const blk of blocks) {
          if (!blk.der) { notes.push({ file: name, level: "bad", text: name + ": a " + blk.label + " block is damaged (its text is not valid)." }); continue; }
          if (/^(X509 |TRUSTED )?CERTIFICATE$/.test(blk.label)) { used++; try { items.push(parseCert(blk.der, name)); } catch { notes.push({ file: name, level: "bad", text: name + ": a certificate block is damaged or unreadable." }); } }
          else if (/CERTIFICATE REQUEST$/.test(blk.label)) { used++; try { items.push(parseCsr(blk.der, name)); } catch { notes.push({ file: name, level: "bad", text: name + ": a certificate request block is damaged." }); } }
          else if (blk.label === "PKCS7") { used++; try { for (const c of p7Certs(blk.der)) items.push(parseCert(c, name)); } catch { notes.push({ file: name, level: "bad", text: name + ": the PKCS7 block is damaged." }); } }
          else if (/PRIVATE KEY$/.test(blk.label)) { used++; await handleKey(name, new TextEncoder().encode(blk.raw)); }
          else if (blk.label === "PUBLIC KEY") { used++; items.push({ kind: "pubkey", from: name, spki: blk.der, key: keyDesc(blk.der) }); }
          else notes.push({ file: name, level: "info", text: name + ": a \"" + blk.label + "\" block was skipped (not needed here)." });
        }
        if (!blocks.length) notes.push({ file: name, level: "warn", text: name + ": no readable PEM block was found." });
        continue;
      }
      // binary, or bare base64
      let bytes = b;
      const asText = text(b).replace(/\s+/g, "");
      if (b[0] !== 0x30 && asText.length > 60 && /^[A-Za-z0-9+/]+=*$/.test(asText)) { try { bytes = d.unb64(asText); } catch { /* keep the bytes */ } }
      await addDer(bytes);
    }
    return { items, notes };
  }
  function expandPfx(name, r, items, notes) {
    const tag = name + " (inside the PFX)";
    for (const c of r.certs) { try { const it = parseCert(c.der, tag); it.friendlyName = c.friendlyName; it.localKeyId = c.localKeyId; items.push(it); } catch { notes.push({ file: name, level: "bad", text: name + ": a certificate inside the PFX is unreadable." }); } }
    for (const k of r.keys) { if (k.key) items.push({ kind: "key", from: tag, key: k.key, friendlyName: k.friendlyName, localKeyId: k.localKeyId }); else notes.push({ file: name, level: "bad", text: name + ": the key inside the PFX: " + (k.error || "unreadable") }); }
    items.push({ kind: "pfxinfo", from: name, info: r.info, certs: r.certs.length, keys: r.keys.length, other: r.other });
  }
  // gives a locked item its password; returns { ok, items, notes, wrong }
  async function unlock(item, password) {
    const items = [], notes = [];
    if (item.what === "key") {
      const r = await KF().readKey(item.bytes, password);
      if (r.status === "ok") { const k = { kind: "key", from: item.from, key: r.key }; return { ok: true, items: [k], notes }; }
      return { ok: false, wrong: r.status === "password", message: r.message || "wrong password" };
    }
    const r = await P12().parse(item.bytes, password);
    if (r.status === "ok") { expandPfx(item.from, r, items, notes); return { ok: true, items, notes }; }
    return { ok: false, wrong: r.status === "password", message: r.message || "wrong password" };
  }

  /* ---------- judging the package ---------- */
  async function verifies(sub, issuer) { try { return await sub.cert.verify(issuer.cert); } catch { return null; } }
  const fmtDate = t => new Date(t).toISOString().slice(0, 10);
  const nameList = c => c.names.filter(n => n.kind === "DNS" || n.kind === "IP").map(n => n.value);
  const label = c => c.cn || c.subject || "(no name)";
  // a host name against a certificate name (one wildcard label at the left only: *.example.com covers www.example.com, not example.com or a.b.example.com)
  function nameMatches(host, pattern) {
    host = host.toLowerCase(); pattern = pattern.toLowerCase();
    if (host === pattern) return true;
    if (pattern.startsWith("*.")) { const rest = pattern.slice(2); const i = host.indexOf("."); return i > 0 && host.slice(i + 1) === rest && !host.slice(0, i).includes("*"); }
    return false;
  }

  async function analyze(items, opts = {}) {
    const now = opts.now || Date.now(), host = (opts.host || "").trim().toLowerCase();
    const checks = [], add = (section, level, title, text, fix) => checks.push({ section, level, title, text, fix: fix || "" });
    // the same certificate twice (for example in the PFX and in a separate file) counts once
    const seen = new Set(), certs = [], dupes = [];
    for (const it of items.filter(i => i.kind === "cert")) { if (seen.has(it.sha256)) dupes.push(it); else { seen.add(it.sha256); certs.push(it); } }
    const keys = items.filter(i => i.kind === "key"), csrs = items.filter(i => i.kind === "csr"), pubs = items.filter(i => i.kind === "pubkey"), locked = items.filter(i => i.kind === "locked"), pfxs = items.filter(i => i.kind === "pfxinfo");
    const isIssuer = c => certs.some(o => o !== c && o.issuerKey === c.subjectKey && !o.selfIssued);

    /* what is in the package */
    const inv = [];
    if (certs.length) inv.push(certs.length + " certificate" + (certs.length === 1 ? "" : "s"));
    if (keys.length) inv.push(keys.length + " private key" + (keys.length === 1 ? "" : "s"));
    if (csrs.length) inv.push(csrs.length + " certificate request" + (csrs.length === 1 ? "" : "s"));
    if (pubs.length) inv.push(pubs.length + " public key" + (pubs.length === 1 ? "" : "s"));
    if (locked.length) inv.push(locked.length + " locked file" + (locked.length === 1 ? "" : "s") + " (password needed)");
    for (const l of locked) add("Package", "warn", "A password is needed", l.from + " is " + (l.what === "pfx" ? "a PFX file" : "an encrypted private key") + " and cannot be checked until you give its password.", "Type the password in the box for that file.");
    if (!certs.length && !keys.length && !csrs.length && !pubs.length && !locked.length) add("Package", "bad", "Nothing readable", "No certificate, key, request or PFX could be read from what you gave.", "Add your files (.crt .pem .cer .key .csr .pfx .p12 .p7b) or paste the text of the certificate.");
    if (dupes.length) add("Package", "info", "The same certificate appears more than once", dupes.length + " certificate" + (dupes.length === 1 ? " is" : "s are") + " repeated (for example once in a PFX and once in a bundle). Duplicates are counted once.");

    /* the server certificate */
    // the end certificate: one that is not a CA; when every certificate is a CA, only one that has a key in the package, or a lone self-signed one, counts
    let ee = certs.filter(c => !c.isCA);
    if (!ee.length) ee = certs.filter(c => keys.some(k => same(k.key.spki, c.spki)));
    if (!ee.length && certs.length === 1) ee = certs.slice();
    let leaf = null;
    if (ee.length) {
      const withKey = ee.filter(c => keys.some(k => same(k.key.spki, c.spki)) || pfxs.length && false);
      const byHost = host ? ee.filter(c => nameList(c).some(n => nameMatches(host, n)) || (!nameList(c).length && c.cn && nameMatches(host, c.cn))) : [];
      leaf = (withKey.length ? withKey : byHost.length ? byHost : ee)[0];
    }
    const others = ee.filter(c => c !== leaf);
    if (others.length) add("Package", "info", "More than one end certificate", "There are " + ee.length + " end certificates in the package. This check follows \"" + label(leaf) + "\"; the others are: " + others.map(label).join(", ") + ".", "Check them one at a time if you need to.");

    /* key and certificate (and request, and public key) */
    for (const k of keys) {
      const hits = certs.filter(c => same(c.spki, k.key.spki)), csrHits = csrs.filter(r => same(r.spki, k.key.spki));
      const lead = k.from + " (" + k.key.label + ")";
      if (hits.length) add("Key and certificate", "good", "The private key matches the certificate", lead + " belongs to the certificate \"" + label(hits[0]) + "\". They are a pair.", "");
      else if (certs.length && leaf) {
        const owner = csrHits.length ? " It matches the certificate request " + csrHits[0].from + " instead, so the certificate was probably issued for a different request." : "";
        add("Key and certificate", "bad", "The private key does NOT match the certificate", lead + " does not belong to \"" + label(leaf) + "\"." + owner, "Use the key that was created together with the request for this certificate. If the key is lost, make a new key and request (CSR) and get the certificate issued again.");
      } else if (!certs.length) add("Key and certificate", "info", "A key but no certificate", lead + " was read. There is no certificate to compare it with.", csrHits.length ? "" : "Add the certificate to check that they match.");
      if (k.key.encrypted) add("Key and certificate", "info", "The key file is password protected", k.from + " needs its password. A web server asks for it at every start.", "To start a server without typing it, make an unprotected copy in the Certificate Converter (and keep that file safe).");
      else if (!k.from.includes("(inside the PFX)")) add("Key and certificate", "info", "The key file is not password protected", k.from + " can be used by anyone who gets the file. That is normal for a web server key, so keep it private.", "");
    }
    if (!keys.length && certs.length && !locked.some(l => l.what === "key")) add("Key and certificate", "info", "No private key in the package", "Matching the key with the certificate was not checked.", "Add the .key file (or the PFX) to check that they match.");
    for (const p of pubs) { const hit = certs.find(c => same(c.spki, p.spki)) || csrs.find(r => same(r.spki, p.spki)); add("Key and certificate", hit ? "good" : "bad", hit ? "The public key matches" : "The public key does not match", p.from + " (" + p.key.label + ") " + (hit ? "is the public key of \"" + (hit.cn || hit.subject) + "\"." : "does not belong to any certificate or request in the package.")); }
    for (const r of csrs) {
      let sigOk = null; try { sigOk = await r.csr.verify(); } catch { sigOk = null; }
      if (sigOk === false) add("Key and certificate", "bad", "The certificate request is damaged", r.from + ": its own signature is wrong, so a CA would reject it.", "Make the request again.");
      const hit = certs.find(c => same(c.spki, r.spki));
      if (certs.length) add("Key and certificate", hit ? "good" : "info", hit ? "The request matches the certificate" : "The request is not for this certificate", r.from + (hit ? " was the request this certificate \"" + label(hit) + "\" was issued for (same key)." : " has a different key than every certificate in the package."));
      else add("Key and certificate", "info", "A certificate request", r.from + " (" + r.key.label + ", " + (r.names.map(n => n.value).join(", ") || r.subject || "no names") + ") is ready to send to a CA.");
      if (/SHA-1|MD5/.test(r.sigAlg)) add("Strength", "warn", "The request is signed with " + r.sigAlg, r.from + " uses a weak signature that some CAs refuse.", "Make the request again with SHA-256.");
      if (r.key.type === "RSA" && r.key.bits < 2048) add("Strength", "bad", "The request key is too small", r.from + " has a " + r.key.bits + "-bit key. CAs require 2048 or more.", "Make a new key of at least 2048 bits.");
    }
    for (const p of pfxs) {
      const prot = p.info.protection.filter(x => x !== "not encrypted");
      if (p.keys && p.info.protection.length && p.info.protection.every(x => x === "not encrypted")) add("Files", "warn", "The PFX has no password protection", p.from + " holds a private key that is not encrypted. Anyone who gets the file can use the key.", "Protect it: make a new PFX with a password in the Certificate Converter.");
      else if (prot.some(x => /RC2|RC4|very old/.test(x))) add("Files", "warn", "The PFX uses very old encryption", p.from + " is protected with " + prot.join(", ") + ", which is weak by today's standards.", "Make a new PFX with modern encryption in the Certificate Converter (unless an old system needs this one).");
      else if (prot.some(x => /Triple-DES/.test(x))) add("Files", "info", "The PFX uses older (Triple-DES) encryption", p.from + " opens on old Windows and Java systems. Modern systems prefer AES.", "");
      else if (prot.length) add("Files", "good", "The PFX is protected with modern encryption", p.from + ": " + prot.join(", ") + (p.info.macChecked ? ", integrity check passed." : "."), "");
      if (!p.info.macPresent) add("Files", "info", "The PFX has no integrity check", p.from + " has no MAC, so nothing proves that it was not changed.", "");
      p.info.notes.forEach(() => { /* shown above in plain words */ });
    }

    /* the chain */
    let chain = [], chainEnd = "none", missing = null;
    if (leaf) {
      const pool = certs.filter(c => c !== leaf), used = new Set([leaf.sha256]);
      chain = [{ c: leaf, sig: null }]; let cur = leaf;
      for (let depth = 0; depth < 12; depth++) {
        if (cur.selfIssued) { chain[chain.length - 1].sig = await verifies(cur, cur); chainEnd = "root"; break; }
        const cands = pool.filter(p => !used.has(p.sha256) && p.subjectKey === cur.issuerKey);
        if (!cands.length) { chainEnd = "missing"; missing = cur; break; }
        let pick = null, sig = null;
        for (const p of cands) { const s = await verifies(cur, p); if (s === true) { pick = p; sig = true; break; } }
        if (!pick) { pick = cands[0]; sig = await verifies(cur, pick); }
        chain[chain.length - 1].sig = sig; used.add(pick.sha256); chain.push({ c: pick, sig: null }); cur = pick;
      }
      if (chain.length === 1 && chainEnd === "missing") chainEnd = leaf.selfIssued ? "root" : "missing";
      if (leaf.selfIssued && chain.length === 1) add("Chain", "warn", "Self-signed certificate", "\"" + label(leaf) + "\" signed itself: no certificate authority is behind it. Browsers show a warning unless it is installed as trusted on every device that connects.", "Fine for tests and internal use. For the public internet, get a certificate from a CA.");
      else if (chainEnd === "root") {
        const bad = chain.filter(x => x.sig === false);
        if (bad.length) add("Chain", "bad", "A signature in the chain does not verify", "\"" + label(bad[0].c) + "\" says it was issued by the next certificate, but the signature does not check out. The wrong certificate is in the package, or one is damaged.", "Get the correct intermediate certificate from your CA.");
        else add("Chain", "good", "The chain is complete", "From \"" + label(leaf) + "\" up to the root \"" + label(chain[chain.length - 1].c) + "\" every certificate is in the package, and every signature checks out (" + chain.length + " certificate" + (chain.length === 1 ? "" : "s") + ").", "");
        if (chain.length > 1 && chain[chain.length - 1].c.selfIssued && chain.length >= 2) add("Chain", "info", "The root is included", "The root certificate is in the package. Servers do not need to send it (clients already know their roots), so it is harmless but not required.", "For a web server, the server certificate plus the intermediates is enough.");
        for (let i = 1; i < chain.length - 1; i++) { const x = chain[i].c; if (!x.isCA) add("Chain", "bad", "A certificate in the chain is not a CA", "\"" + label(x) + "\" issued another certificate but is not marked as a CA.", "Use the correct intermediate from your CA."); else if (x.hasKu && !x.keyUsage.includes("certificate signing")) add("Chain", "bad", "A CA certificate may not sign certificates", "\"" + label(x) + "\" has no certificate-signing permission.", "Use the correct intermediate from your CA."); }
        add("Chain", "info", "Trust is not checked", "These tools carry no list of trusted root certificates, so they cannot say whether browsers or your systems trust this root. They only prove the package fits together.", "");
      } else if (chainEnd === "missing") {
        const url = missing.issuersUrl, issuerName = (missing.issuer.match(/CN=([^,]+)/) || [0, missing.issuer])[1];
        if (chain.length === 1) add("Chain", "bad", "The chain is incomplete: the issuing certificate is missing", "\"" + label(missing) + "\" was issued by \"" + issuerName + "\", and that certificate is not in the package. This is the most common cause of \"certificate not trusted\" errors: many browsers, and tools such as curl and Java, refuse a server that does not send its intermediate certificate. (It is fine only if the issuer is a root that every client already has.)", url ? "Download the missing certificate from: " + url + " (the address is written inside the certificate), or ask your CA for the \"intermediate\" or \"CA bundle\" file, and add it right after the server certificate." : "Ask your CA for the \"intermediate\" or \"CA bundle\" file and add it right after the server certificate.");
        else add("Chain", "info", "The chain stops at an intermediate certificate", "The last certificate, \"" + label(missing) + "\", was issued by \"" + issuerName + "\", which is not in the package. That is normal when it is a root: servers do not need to send roots. If it is another intermediate, it must be added.", url ? "To be sure, the issuer can be downloaded from: " + url : "");
      }
    } else if (certs.length) {
      // a package of CA certificates only (a bundle): is it a proper chain?
      const roots = certs.filter(c => c.selfIssued), inter = certs.filter(c => !c.selfIssued);
      add("Chain", "info", "A CA bundle without a server certificate", certs.length + " CA certificate" + (certs.length === 1 ? "" : "s") + " (" + inter.length + " intermediate, " + roots.length + " root).", "Add the server certificate to check the complete chain.");
      for (const c of certs) if (!c.selfIssued && !certs.some(o => o !== c && o.subjectKey === c.issuerKey)) add("Chain", "warn", "\"" + label(c) + "\" has no issuer in the bundle", "The certificate that issued it is not in the bundle.", "Add the missing certificate, or use the full bundle from your CA.");
    }
    // order and extras, file by file
    const inChain = new Set(chain.map(x => x.c.sha256));
    const byFile = {}; for (const it of items.filter(i => i.kind === "cert")) (byFile[it.from] = byFile[it.from] || []).push(it);
    for (const [file, list] of Object.entries(byFile)) {
      if (list.length < 2) continue;
      const mine = list.map(x => x.sha256), want = chain.map(x => x.c.sha256).filter(h => mine.includes(h)), got = mine.filter(h => want.includes(h));
      if (leaf && want.length > 1 && got.join() !== want.join()) {
        const reversed = got.slice().reverse().join() === want.join();
        add("Chain", "warn", "The certificates in " + file + " are in the wrong order", (reversed ? "They are listed from the root down. " : "") + "Servers want the server certificate first, then the intermediate that signed it, then the next one up (the root last, or left out).", "Use the Certificate Converter to build the file in the right order.");
      } else if (!leaf && list.length > 1) {
        let fwd = 0, back = 0; for (let i = 0; i + 1 < list.length; i++) { if (list[i].issuerKey === list[i + 1].subjectKey) fwd++; if (list[i + 1].issuerKey === list[i].subjectKey) back++; }
        if (back > fwd) add("Chain", "info", file + " lists the root first", "The certificates run from the root down. Most servers want the opposite order (the certificate closest to the server first).", "The Certificate Converter can reverse them.");
      }
      const extra = list.filter(x => leaf && !inChain.has(x.sha256) && !x.selfIssued && !dupes.includes(x));
      if (extra.length && leaf) add("Chain", "warn", "Certificates that are not part of this chain", file + " also holds: " + extra.map(label).join(", ") + ". They did not sign anything in the chain, so a server should not send them.", "Remove them from the file the server uses.");
    }

    /* dates */
    const dated = chain.length ? chain.map(x => x.c) : certs;
    for (const c of dated) {
      const role = c === leaf ? "The server certificate" : c.selfIssued ? "The root certificate" : "The intermediate certificate", days = Math.floor((c.notAfter - now) / DAY);
      if (now < c.notBefore) add("Dates", "bad", role + " is not valid yet", "\"" + label(c) + "\" starts on " + fmtDate(c.notBefore) + ". If that date has passed, the clock of the checking device is wrong.", "Check the date and time of the computer or server.");
      else if (now > c.notAfter) add("Dates", "bad", role + " has expired", "\"" + label(c) + "\" expired on " + fmtDate(c.notAfter) + " (" + Math.abs(days) + " days ago).", c === leaf ? "Renew the certificate." : "Get the current intermediate from your CA (renewed certificates often reuse the same name).");
      else if (days < 14) add("Dates", "bad", role + " expires very soon", "\"" + label(c) + "\" expires on " + fmtDate(c.notAfter) + ": only " + days + " day" + (days === 1 ? "" : "s") + " left.", "Renew it now.");
      else if (days < 30) add("Dates", "warn", role + " expires soon", "\"" + label(c) + "\" expires on " + fmtDate(c.notAfter) + " (" + days + " days).", "Plan the renewal.");
      else add("Dates", "good", role + " is valid", "\"" + label(c) + "\" is valid until " + fmtDate(c.notAfter) + " (" + days + " days left).", "");
    }
    if (leaf && chain.length > 1) { const early = chain.slice(1).map(x => x.c).find(c => c.notAfter < leaf.notAfter); if (early && now <= early.notAfter) add("Dates", "warn", "An intermediate expires before the server certificate", "\"" + label(early) + "\" expires on " + fmtDate(early.notAfter) + ", before the server certificate (" + fmtDate(leaf.notAfter) + "). The site stops working on the earlier date unless the chain is updated.", "Plan to replace the intermediate in time."); }
    if (leaf) {
      const life = Math.round((leaf.notAfter - leaf.notBefore) / DAY), web = !leaf.eku || leaf.eku.includes("1.3.6.1.5.5.7.3.1");
      if (web && life > 398) add("Dates", "warn", "The server certificate lasts " + life + " days", "Publicly trusted web certificates may not last longer than 398 days (and even shorter for certificates issued after 15 March 2026: 200 days). Browsers reject longer ones. This does not matter for private certificates.", "");
      else if (web && life > 200 && leaf.notBefore >= Date.UTC(2026, 2, 15)) add("Dates", "info", "The server certificate lasts " + life + " days", "Publicly trusted web certificates issued after 15 March 2026 may last at most 200 days. Private certificates are not affected.", "");
    }

    /* names */
    if (leaf) {
      const names = nameList(leaf), pool = names.length ? names : (leaf.cn ? [leaf.cn] : []);
      if (!names.length) add("Names", "bad", "No Subject Alternative Names", "\"" + label(leaf) + "\" has no list of names (SAN). Browsers ignore the Common Name and will refuse it.", "Get a certificate that lists every name in the SAN field.");
      else add("Names", "info", "The certificate covers these names", names.join(", "), "");
      if (host) {
        const hit = pool.find(n => nameMatches(host, n));
        add("Names", hit ? "good" : "bad", hit ? host + " is covered" : host + " is NOT covered", hit ? "The name matches \"" + hit + "\"." : "The certificate is only valid for: " + (pool.join(", ") || "no names") + (host.split(".").length > 2 && pool.some(n => n.startsWith("*.") && n.slice(2) === host.split(".").slice(1).join(".").split(".").slice(1).join(".")) ? ". A wildcard covers one level only." : "."), hit ? "" : "Get a certificate that includes " + host + ", or use the name it was issued for.");
      }
      if (leaf.eku && !leaf.eku.includes("1.3.6.1.5.5.7.3.1")) add("Names", "bad", "Not for web servers", "\"" + label(leaf) + "\" is only meant for " + leaf.eku.map(o => ({ "1.3.6.1.5.5.7.3.2": "client login", "1.3.6.1.5.5.7.3.3": "code signing", "1.3.6.1.5.5.7.3.4": "email" })[o] || o).join(", ") + ", not for a web server.", "Request a certificate with the \"server authentication\" purpose.");
      if (leaf.isCA) add("Names", "warn", "The server certificate is a CA", "\"" + label(leaf) + "\" is marked as a certificate authority. Web servers should use an ordinary end certificate.", "");
      if (leaf.hasKu && leaf.key.type === "RSA" && !leaf.keyUsage.includes("digital signature") && !leaf.keyUsage.includes("key encipherment")) add("Names", "warn", "Unusual key usage", "The permitted uses of \"" + label(leaf) + "\" do not include a normal TLS use (digital signature or key encipherment).", "");
    }

    /* strength */
    for (const c of dated) {
      const role = c === leaf ? "the server certificate" : c.selfIssued ? "the root" : "the intermediate";
      if (c.key.type === "RSA" && c.key.bits < 2048) add("Strength", "bad", "A weak key in " + role, "\"" + label(c) + "\" has a " + c.key.bits + "-bit RSA key. 2048 bits is the minimum accepted today.", "Get a new certificate with a stronger key.");
      else if (c === leaf && c.key.type === "RSA") add("Strength", "good", "Key strength is fine", "\"" + label(c) + "\" uses " + c.key.label + ".", "");
      else if (c === leaf) add("Strength", "good", "Key strength is fine", "\"" + label(c) + "\" uses " + c.key.label + ".", "");
      if (/SHA-1|MD5/.test(c.sigAlg) && !c.selfIssued) add("Strength", "bad", "A weak signature in " + role, "\"" + label(c) + "\" is signed with " + c.sigAlg + ", which is broken. Browsers reject it.", "Get a new certificate signed with SHA-256 or better.");
    }
    const bits = new Set(chain.map(x => x.c.key.type)); void bits;

    // overall
    const bad = checks.filter(c => c.level === "bad").length, warn = checks.filter(c => c.level === "warn").length;
    const overall = bad ? { level: "bad", title: "Problems found", text: bad + " problem" + (bad === 1 ? "" : "s") + (warn ? " and " + warn + " warning" + (warn === 1 ? "" : "s") : "") + " to fix before this package can be used." }
      : warn ? { level: "warn", title: "Usable, with warnings", text: warn + " warning" + (warn === 1 ? "" : "s") + " to look at." }
      : certs.length || keys.length || csrs.length ? { level: "good", title: "Everything fits", text: "No problems were found in this package." } : { level: "bad", title: "Nothing to check", text: "No readable certificate, key or request." };
    return { overall, inventory: inv.join(", "), leaf, chain: chain.map(x => ({ cert: x.c, sig: x.sig })), chainEnd, checks, counts: { bad, warn }, certs, keys, csrs, locked, pfxs, dupes,
      arrangement: { leaf, intermediates: chain.slice(1).filter(x => !x.c.selfIssued).map(x => x.c), root: chain.length ? (chain[chain.length - 1].c.selfIssued ? chain[chain.length - 1].c : null) : null, key: leaf ? keys.find(k => same(k.key.spki, leaf.spki)) || null : keys[0] || null } };
  }

  // one line per item for the "what was found" table
  function describe(it) {
    if (it.kind === "cert") return { what: it.isCA ? (it.selfIssued ? "Root certificate" : "CA / intermediate certificate") : "Certificate", detail: label(it) + " - " + it.key.label + ", valid " + fmtDate(it.notBefore) + " to " + fmtDate(it.notAfter) };
    if (it.kind === "key") return { what: "Private key", detail: it.key.label + " (" + (it.key.how || "") + ")" };
    if (it.kind === "csr") return { what: "Certificate request (CSR)", detail: it.subject + " - " + it.key.label };
    if (it.kind === "pubkey") return { what: "Public key", detail: it.key.label };
    if (it.kind === "locked") return { what: it.what === "pfx" ? "PFX file (locked)" : "Encrypted private key (locked)", detail: "password needed" };
    if (it.kind === "pfxinfo") return { what: "PFX file", detail: it.certs + " certificate" + (it.certs === 1 ? "" : "s") + ", " + it.keys + " key" + (it.keys === 1 ? "" : "s") + "; " + (it.info.protection.join(", ") || "") };
    return { what: it.kind, detail: "" };
  }

  g.CertKit = { classify, unlock, analyze, describe, nameMatches, shape, parseCert, parseCsr };
  if (typeof module !== "undefined") module.exports = g.CertKit;
})();
