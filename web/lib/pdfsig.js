/* Reading and checking digital signatures in a PDF. Runs in the browser; the file is never uploaded.
   Needs vendor/pkijs.bundle.js (window.pkijs, window.asn1js) and WebCrypto (the browser's, or lib/softcrypto.js on plain http).

   What is checked, per signature:
     - the signed byte range really points at the signature value
     - the signed bytes still produce the digest the signature carries (the document was not changed)
     - the signature value matches the signer's certificate (RSA, RSA-PSS, ECDSA)
     - the certificate details, and whether the certificates in the file link up to each other
     - an embedded or document timestamp, if there is one
   What is NOT checked: whether any authority is trusted, and whether a certificate was revoked.
   Everything read out of the file is untrusted text: callers must show it as plain text only. */
window.PDFSig = (() => {
  const OID = {
    signedData: "1.2.840.113549.1.7.2", tstInfo: "1.2.840.113549.1.9.16.1.4",
    attrSigningTime: "1.2.840.113549.1.9.5", attrMessageDigest: "1.2.840.113549.1.9.4",
    attrTimestampToken: "1.2.840.113549.1.9.16.2.14",
  };
  const HASH = {
    "1.3.14.3.2.26": ["SHA-1", "SHA-1"], "2.16.840.1.101.3.4.2.1": ["SHA-256", "SHA-256"],
    "2.16.840.1.101.3.4.2.2": ["SHA-384", "SHA-384"], "2.16.840.1.101.3.4.2.3": ["SHA-512", "SHA-512"],
    "2.16.840.1.101.3.4.2.4": ["SHA-224", null], "1.2.840.113549.2.5": ["MD5", null],
  };
  const SIGALG = {
    "1.2.840.113549.1.1.1": "RSA", "1.2.840.113549.1.1.5": "RSA with SHA-1", "1.2.840.113549.1.1.11": "RSA with SHA-256",
    "1.2.840.113549.1.1.12": "RSA with SHA-384", "1.2.840.113549.1.1.13": "RSA with SHA-512", "1.2.840.113549.1.1.10": "RSA-PSS",
    "1.2.840.113549.1.1.4": "RSA with MD5", "1.2.840.113549.1.1.14": "RSA with SHA-224",
    "1.2.840.10045.4.1": "ECDSA with SHA-1", "1.2.840.10045.4.3.1": "ECDSA with SHA-224", "1.2.840.10045.4.3.2": "ECDSA with SHA-256",
    "1.2.840.10045.4.3.3": "ECDSA with SHA-384", "1.2.840.10045.4.3.4": "ECDSA with SHA-512", "1.3.101.112": "Ed25519",
    "1.2.840.10045.2.1": "EC", "1.2.840.10040.4.3": "DSA with SHA-1",
  };
  const CURVES = { "1.2.840.10045.3.1.7": "P-256", "1.3.132.0.34": "P-384", "1.3.132.0.35": "P-521" };
  const RDN = { "2.5.4.3": "CN", "2.5.4.10": "O", "2.5.4.11": "OU", "2.5.4.6": "C", "2.5.4.7": "L", "2.5.4.8": "ST", "2.5.4.5": "serialNumber", "1.2.840.113549.1.9.1": "email", "2.5.4.97": "organizationIdentifier", "2.5.4.4": "surname", "2.5.4.42": "givenName", "2.5.4.12": "title", "0.9.2342.19200300.100.1.25": "DC" };
  const EKU = {
    "1.3.6.1.5.5.7.3.4": "email protection", "1.3.6.1.4.1.311.10.3.12": "document signing", "1.2.840.113583.1.1.5": "PDF signing (Adobe)",
    "1.3.6.1.5.5.7.3.8": "time stamping", "1.3.6.1.5.5.7.3.3": "code signing", "1.3.6.1.5.5.7.3.2": "client authentication",
    "1.3.6.1.5.5.7.3.1": "server authentication", "2.5.29.37.0": "any purpose",
  };

  const MAX_SIGNATURES = 100;

  /* ---------- reading the raw bytes (pure) ---------- */

  const latin1 = (b, from, to) => {
    let s = "";
    for (let i = from; i < to; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, Math.min(to, i + 8192)));
    return s;
  };

  function indexOfStr(bytes, str, from = 0) {
    const n = str.length, first = str.charCodeAt(0), last = bytes.length - n;
    outer: for (let i = from; i <= last; i++) {
      if (bytes[i] !== first) continue;
      for (let j = 1; j < n; j++) if (bytes[i + j] !== str.charCodeAt(j)) continue outer;
      return i;
    }
    return -1;
  }

  // every "/ByteRange [a b c d]" in the file -> [{ pos, br: [0, a, c, d] }] (same numbers listed once)
  function findByteRanges(bytes) {
    const out = [], seen = new Set();
    let i = 0;
    while (out.length < MAX_SIGNATURES && (i = indexOfStr(bytes, "/ByteRange", i)) !== -1) {
      const win = latin1(bytes, i, Math.min(bytes.length, i + 200));
      const m = /^\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(win);
      if (m) {
        const br = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
        const key = br.join(",");
        if (!seen.has(key)) { seen.add(key); out.push({ pos: i, br }); }
      }
      i += 10;
    }
    return out;
  }

  // a PDF text string (bytes) -> a JS string
  function decodeText(b) {
    if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) {
      let s = "";
      for (let i = 2; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
      return s;
    }
    if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) {
      let s = "";
      for (let i = 2; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i + 1] << 8) | b[i]);
      return s;
    }
    if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return new TextDecoder("utf-8").decode(b.subarray(3));
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
  }

  // parse a literal (...) or hex <...> string that starts at text[i] -> { bytes, end } or null
  function parsePdfString(text, i) {
    if (text[i] === "<" && text[i + 1] !== "<") {
      const j = text.indexOf(">", i);
      if (j < 0) return null;
      let hex = text.slice(i + 1, j).replace(/\s+/g, "");
      if (!/^[0-9a-fA-F]*$/.test(hex)) return null;
      if (hex.length % 2) hex += "0";
      const out = new Uint8Array(hex.length / 2);
      for (let k = 0; k < out.length; k++) out[k] = parseInt(hex.substr(k * 2, 2), 16);
      return { bytes: out, end: j + 1 };
    }
    if (text[i] === "(") {
      const out = [];
      let depth = 1, k = i + 1;
      while (k < text.length && depth > 0) {
        const ch = text[k];
        if (ch === "\\") {
          const nx = text[k + 1];
          const map = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
          if (nx in map) { out.push(map[nx]); k += 2; continue; }
          if (/[0-7]/.test(nx)) { let o = nx, q = k + 2; while (o.length < 3 && /[0-7]/.test(text[q] || "")) o += text[q++]; out.push(parseInt(o, 8) & 255); k = q; continue; }
          if (nx === "\r" || nx === "\n") { k += nx === "\r" && text[k + 2] === "\n" ? 3 : 2; continue; }
          k += 1; continue;
        }
        if (ch === "(") depth++;
        if (ch === ")") { depth--; if (depth === 0) { k++; break; } }
        out.push(text.charCodeAt(k) & 255);
        k++;
      }
      return depth === 0 ? { bytes: Uint8Array.from(out), end: k } : null;
    }
    return null;
  }

  // "D:20240131123045+01'00'" -> Date (or null)
  function parsePdfDate(s) {
    const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}(?:'?\d{2}'?)?)?/.exec(String(s || "").trim());
    if (!m) return null;
    const [, y, mo = "01", d = "01", h = "00", mi = "00", se = "00", tz] = m;
    let off = 0;
    if (tz && tz !== "Z") { const t = tz.replace(/'/g, ""); off = (t[0] === "-" ? -1 : 1) * (Number(t.slice(1, 3)) * 60 + Number(t.slice(3, 5) || 0)); }
    const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se)) - off * 60000;
    return Number.isNaN(ms) ? null : new Date(ms);
  }

  // the dictionary that holds a signature, without the (huge) signature value: reads /Type, /Filter, /SubFilter, /Name, /M, /Reason ...
  function readDict(bytes, pos, a, c) {
    const lo = Math.max(0, pos - 6000);
    // start of the object: the last "obj" before the byte range (or before the signature value, if that comes first)
    const probeEnd = Math.min(pos, a);
    let start = lo;
    const before = latin1(bytes, lo, probeEnd);
    const mm = [...before.matchAll(/\d+\s+\d+\s+obj\b/g)].pop();
    if (mm) start = lo + mm.index;
    let end = indexOfStr(bytes, "endobj", Math.max(pos, c));
    if (end < 0 || end - Math.max(pos, c) > 8000) end = Math.min(bytes.length, Math.max(pos, c) + 4000);
    // text before the signature value + text after it (the value itself is skipped)
    const text = latin1(bytes, Math.min(start, a), a) + " " + latin1(bytes, Math.min(c, end), end);
    const get = key => {
      const re = new RegExp("/" + key + "(?![A-Za-z])\\s*");
      const m = re.exec(text);
      if (!m) return null;
      const i = m.index + m[0].length;
      if (text[i] === "(" || (text[i] === "<" && text[i + 1] !== "<")) {
        const p = parsePdfString(text, i);
        return p ? decodeText(p.bytes) : null;
      }
      return null;
    };
    const getName = key => { const m = new RegExp("/" + key + "(?![A-Za-z])\\s*/([^\\s/<>\\[\\]()]+)").exec(text); return m ? m[1] : null; };
    return {
      type: getName("Type"), filter: getName("Filter"), subFilter: getName("SubFilter"),
      name: get("Name"), reason: get("Reason"), location: get("Location"), contactInfo: get("ContactInfo"), m: get("M"),
    };
  }

  // find every signature in the file: [{ index, br, contentsBytes|null, problem|null, dict, signedBytes() }]
  function collect(bytes) {
    const out = [];
    findByteRanges(bytes).forEach(({ pos, br }, index) => {
      const [zero, a, c, d] = br;
      const e = { index, byteRange: br, contents: null, problem: null, dict: {}, coverageEnd: c + d };
      try { e.dict = readDict(bytes, pos, a, c); } catch { e.dict = {}; }
      if (zero !== 0 || a > c || c + d > bytes.length || a < 0) {
        e.problem = "The signed byte range does not fit inside this file, so the signature cannot be located.";
      } else {
        const gap = latin1(bytes, a, c);
        const t = gap.trim();
        if (t[0] === "<" && t[t.length - 1] === ">") {
          let hex = t.slice(1, -1).replace(/\s+/g, "");
          if (/^[0-9a-fA-F]*$/.test(hex) && hex.length >= 16) {
            if (hex.length % 2) hex += "0";
            const raw = new Uint8Array(hex.length / 2);
            for (let k = 0; k < raw.length; k++) raw[k] = parseInt(hex.substr(k * 2, 2), 16);
            if (raw.some(x => x !== 0)) e.contents = raw;
            else e.problem = "This signature field was never signed: its signature value is empty.";
          } else e.problem = "The signature value is empty or not valid hexadecimal. This is probably a signature field that was never signed.";
        } else e.problem = "The gap in the signed byte range does not hold a signature value.";
      }
      e.signedBytes = () => {
        const out2 = new Uint8Array(a + d);
        out2.set(bytes.subarray(0, a), 0);
        out2.set(bytes.subarray(c, c + d), a);
        return out2;
      };
      out.push(e);
    });
    return out;
  }

  /* ---------- certificates and CMS (needs pkijs) ---------- */

  const toAB = u8 => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  const hex = (u8, sep = "") => [...u8].map(x => x.toString(16).padStart(2, "0")).join(sep);
  const hashName = oid => (HASH[oid] ? HASH[oid][0] : oid);

  // The browser's own WebCrypto exists only on https or localhost. On a plain http address lib/softcrypto.js stands in for it.
  function nativeCrypto() {
    const c = globalThis.crypto;
    return !!(c && c.subtle && typeof c.subtle.digest === "function");
  }
  const usingSoft = () => !nativeCrypto() && !!window.SoftCrypto;
  function secureCrypto() { return nativeCrypto() || !!window.SoftCrypto; }   // true = signatures can be checked here
  let softInstalled = false;
  function prepareCrypto() {
    if (usingSoft() && !softInstalled) { window.SoftCrypto.install(window.pkijs); softInstalled = true; }
  }

  async function digestOf(algName, data) {
    if (nativeCrypto()) return new Uint8Array(await globalThis.crypto.subtle.digest(algName, data));
    return window.SoftCrypto.digest(algName, data);
  }

  function dnObject(name) {
    const parts = [], o = {};
    try {
      for (const tv of name.typesAndValues) {
        const label = RDN[tv.type] || tv.type;
        const val = String(tv.value.valueBlock.value);
        if (!(label in o)) o[label] = val;
        parts.push(`${label}=${val}`);
      }
    } catch { /* leave what was read */ }
    o.text = parts.join(", ");
    return o;
  }

  function validityDates(cert) {
    return { notBefore: cert.notBefore.value, notAfter: cert.notAfter.value };
  }

  async function certDetails(cert) {
    const subject = dnObject(cert.subject), issuer = dnObject(cert.issuer);
    const { notBefore, notAfter } = validityDates(cert);
    const der = new Uint8Array(cert.toSchema().toBER(false));
    let fingerprint = "";
    try { fingerprint = hex(await digestOf("SHA-256", der), ":").toUpperCase(); } catch { /* no crypto */ }
    let keyText = "", keyKind = "";
    try {
      const spki = cert.subjectPublicKeyInfo, oid = spki.algorithm.algorithmId;
      keyKind = SIGALG[oid] || oid;
      if (oid === "1.2.840.113549.1.1.1") {
        let mod = new Uint8Array(spki.parsedKey.modulus.valueBlock.valueHexView);
        let k = 0; while (k < mod.length && mod[k] === 0) k++;
        const bits = (mod.length - k) * 8 - Math.clz32(mod[k] || 1) + 24;
        keyText = `RSA ${bits} bits`;
      } else if (oid === "1.2.840.10045.2.1") {
        const cv = spki.algorithm.algorithmParams && spki.algorithm.algorithmParams.valueBlock ? String(spki.algorithm.algorithmParams.valueBlock.toString()) : "";
        keyText = `Elliptic curve ${CURVES[cv] || cv}`.trim();
      } else keyText = keyKind;
    } catch { keyText = keyKind || "unknown"; }
    let sigAlg = "";
    try { sigAlg = SIGALG[cert.signatureAlgorithm.algorithmId] || cert.signatureAlgorithm.algorithmId; } catch { /* ignore */ }
    const usage = [], purposes = [];
    let isCA = false;
    for (const ext of cert.extensions || []) {
      try {
        if (ext.extnID === "2.5.29.15" && ext.parsedValue) {
          const v = new Uint8Array(ext.parsedValue.valueBlock.valueHexView);
          const names = ["digital signature", "non-repudiation", "key encipherment", "data encipherment", "key agreement", "certificate signing", "CRL signing"];
          names.forEach((n, bit) => { if (v[0] & (0x80 >> bit)) usage.push(n); });
        } else if (ext.extnID === "2.5.29.37" && ext.parsedValue) {
          for (const p of ext.parsedValue.keyPurposes) purposes.push(EKU[p] || p);
        } else if (ext.extnID === "2.5.29.19" && ext.parsedValue) {
          isCA = !!ext.parsedValue.cA;
        }
      } catch { /* ignore one odd extension */ }
    }
    const selfIssued = (() => { try { return cert.subject.isEqual(cert.issuer); } catch { return false; } })();
    return {
      subject, issuer, serial: hex(new Uint8Array(cert.serialNumber.valueBlock.valueHexView)).toUpperCase(),
      notBefore, notAfter, key: keyText, signatureAlgorithm: sigAlg, fingerprint, usage, purposes, isCA, selfIssued,
    };
  }

  // certificates in the file that link the signer's certificate upwards: [{ cert, details, linkOk }], plus how the chain ends
  async function buildChain(leaf, all) {
    const chain = [leaf], used = new Set([leaf]);
    let cur = leaf;
    for (let guard = 0; guard < 10; guard++) {
      let selfIssued = false;
      try { selfIssued = cur.subject.isEqual(cur.issuer); } catch { /* ignore */ }
      if (selfIssued) break;
      const next = all.find(c => !used.has(c) && c.subject.isEqual(cur.issuer));
      if (!next) break;
      used.add(next); chain.push(next); cur = next;
    }
    const out = [];
    for (let i = 0; i < chain.length; i++) {
      let linkOk = null;
      try { linkOk = await chain[i].verify(i + 1 < chain.length ? chain[i + 1] : undefined); } catch { linkOk = false; }
      out.push({ cert: chain[i], details: await certDetails(chain[i]), linkOk });
    }
    const top = out[out.length - 1];
    let selfIssued = false;
    try { selfIssued = top.cert.subject.isEqual(top.cert.issuer); } catch { /* ignore */ }
    return { chain: out, ends: selfIssued ? "self-signed" : "issuer-not-included" };
  }

  function attrValues(signerInfo, which, oid) {
    const list = which === "signed" ? signerInfo.signedAttrs : signerInfo.unsignedAttrs;
    if (!list) return [];
    return list.attributes.filter(a => a.type === oid).flatMap(a => a.values || []);
  }

  function asDate(asn) {
    try { if (asn && typeof asn.toDate === "function") return asn.toDate(); } catch { /* ignore */ }
    return null;
  }

  // a timestamp token (a CMS ContentInfo): what time it states, who stamped it, whether it matches `expectedHashOf`
  async function readTimestamp(contentInfoSchema, expectedData) {
    const out = { time: null, authority: "", imprintOk: null, tokenSignatureOk: null, error: null };
    try {
      const ci = new pkijs.ContentInfo({ schema: contentInfoSchema });
      const sd = new pkijs.SignedData({ schema: ci.content });
      const raw = sd.encapContentInfo.eContent;
      const inner = asn1js.fromBER(raw.getValue ? raw.getValue() : raw.valueBlock.valueHexView);
      const tst = new pkijs.TSTInfo({ schema: inner.result });
      out.time = tst.genTime;
      const alg = HASH[tst.messageImprint.hashAlgorithm.algorithmId];
      const imprint = new Uint8Array(tst.messageImprint.hashedMessage.valueBlock.valueHexView);
      if (alg && alg[1] && expectedData) out.imprintOk = hex(imprint) === hex(await digestOf(alg[1], expectedData));
      for (const c of sd.certificates || []) {
        if (c instanceof pkijs.Certificate && sd.signerInfos[0]) {
          out.authority = dnObject(c.subject).CN || dnObject(c.subject).O || out.authority;
          break;
        }
      }
      try {
        // pkijs also wants the stamped data, to check the imprint inside the token
        out.tokenSignatureOk = await sd.verify({ signer: 0, data: expectedData ? toAB(expectedData) : undefined, checkChain: false });
      } catch (e) {
        const msg = String(e && e.message || e);
        // a wrong imprint stops pkijs before it checks the token's own signature
        out.tokenSignatureOk = /TSTInfo verification/.test(msg) ? null : false;
        out.error = msg;
      }
    } catch (e) { out.error = String(e && e.message || e); }
    return out;
  }

  const STATUS = {
    valid: "Valid", modified: "Changed after signing", badsig: "Signature does not match", unsupported: "Cannot be checked",
    damaged: "Damaged or empty", insecure: "Cannot be checked here", timestamp: "Timestamp",
  };

  // check one signature found by collect() -> a plain result object (strings, numbers, Dates; no pkijs objects)
  async function checkOne(bytes, e) {
    const r = {
      index: e.index, status: "damaged", headline: "", notes: [], kind: "signature",
      filter: e.dict.filter || "", subFilter: e.dict.subFilter || "", name: e.dict.name || "", reason: e.dict.reason || "",
      location: e.dict.location || "", contact: e.dict.contactInfo || "", pdfTime: e.dict.m ? parsePdfDate(e.dict.m) : null,
      byteRange: e.byteRange, coverageEnd: e.coverageEnd, fileLength: bytes.length,
      coversWholeFile: e.coverageEnd === bytes.length, signer: null, chain: [], chainEnds: "", signingTime: null,
      digestAlgorithm: "", signatureAlgorithm: "", timestamp: null, signerCount: 0, extra: [],
    };
    if (e.dict.type === "DocTimeStamp" || /RFC3161/i.test(r.subFilter)) r.kind = "timestamp";
    if (e.problem || !e.contents) { r.headline = e.problem || "No signature value found."; return r; }
    if (!window.pkijs || !window.asn1js) { r.status = "unsupported"; r.headline = "The signature-reading library did not load."; return r; }
    if (!secureCrypto()) {
      r.status = "insecure";
      r.headline = "This page is not on a secure (https) connection, so the browser does not allow the cryptography needed to check signatures. Open the site through its https address.";
      return r;
    }
    const soft = usingSoft();
    if (soft) {
      prepareCrypto();
      r.notes.push("This address is not https, so the browser's own cryptography is switched off. The check was done with this page's built-in code instead: the result is the same, only slower.");
    }
    if (/x509\.rsa_sha1/i.test(r.subFilter)) {
      r.status = "unsupported"; r.headline = "This signature uses an old format (adbe.x509.rsa_sha1) that this tool cannot check."; return r;
    }
    let asn, ci;
    try {
      asn = asn1js.fromBER(toAB(e.contents));
      if (asn.offset === -1) throw new Error("not valid ASN.1");
      ci = new pkijs.ContentInfo({ schema: asn.result });
      if (ci.contentType !== OID.signedData) throw new Error("not a signed-data structure");
    } catch (err) {
      r.headline = "The signature value is damaged or is not in a format this tool understands (" + (err && err.message || err) + ").";
      return r;
    }
    let signed;
    try {
      const sd = new pkijs.SignedData({ schema: ci.content });
      signed = e.signedBytes();
      r.signerCount = sd.signerInfos.length;
      const certs = (sd.certificates || []).filter(c => c instanceof pkijs.Certificate);

      /* a document timestamp: the token itself is the content */
      if (r.kind === "timestamp") {
        const ts = await readTimestamp(ci.toSchema ? ci.toSchema() : asn.result, signed);
        r.timestamp = ts;
        r.status = ts.imprintOk === false ? "modified" : ts.imprintOk === true && ts.tokenSignatureOk === true ? "valid" : ts.tokenSignatureOk === false ? "badsig" : "unsupported";
        r.headline = r.status === "valid" ? "A trusted-time stamp is attached to the document, and the document has not changed since."
          : r.status === "modified" ? "The document was changed after this timestamp was added." : "The timestamp could not be fully checked.";
        r.signingTime = ts.time;
        if (certs.length) { try { r.signer = await certDetails(certs[0]); } catch { /* ignore */ } }
        return r;
      }

      if (!sd.signerInfos.length) { r.headline = "The signature contains no signer."; return r; }
      const si = sd.signerInfos[0];
      r.digestAlgorithm = hashName(si.digestAlgorithm.algorithmId);
      r.signatureAlgorithm = SIGALG[si.signatureAlgorithm.algorithmId] || si.signatureAlgorithm.algorithmId;
      const st = attrValues(si, "signed", OID.attrSigningTime)[0];
      r.signingTime = asDate(st);

      // signer's certificate and the chain the file carries
      let signerCert = null;
      for (const c of certs) {
        try {
          if (si.sid instanceof pkijs.IssuerAndSerialNumber && c.issuer.isEqual(si.sid.issuer) && c.serialNumber.isEqual(si.sid.serialNumber)) { signerCert = c; break; }
        } catch { /* next */ }
      }
      if (!signerCert && certs.length === 1) signerCert = certs[0];
      if (signerCert) {
        const built = await buildChain(signerCert, certs);
        r.signer = built.chain[0].details;
        r.chain = built.chain.map(x => ({ ...x.details, linkOk: x.linkOk }));
        r.chainEnds = built.ends;
      }

      /* integrity: the signed bytes against the digest, then the signature value */
      const hashInfo = HASH[si.digestAlgorithm.algorithmId];
      if (!hashInfo || !hashInfo[1]) {
        r.status = "unsupported"; r.headline = `The signature uses a digest algorithm (${hashName(si.digestAlgorithm.algorithmId)}) that this browser cannot check.`;
        return r;
      }
      let data = signed;
      if (/pkcs7\.sha1/i.test(r.subFilter) && sd.encapContentInfo.eContent) {
        const want = new Uint8Array(sd.encapContentInfo.eContent.getValue ? sd.encapContentInfo.eContent.getValue() : sd.encapContentInfo.eContent.valueBlock.valueHexView);
        const got = await digestOf("SHA-1", signed);
        if (hex(want) !== hex(got)) { r.status = "modified"; r.headline = "The document was changed after it was signed."; return r; }
        data = null;
      }
      let res = null, failure = null;
      try {
        res = await sd.verify({ signer: 0, data: data ? toAB(data) : undefined, checkChain: false, extendedMode: true });
      } catch (err) { failure = err; }

      if (res && res.signatureVerified === true) {
        r.status = "valid";
        r.headline = "The signature is valid and the document has not been changed since it was signed.";
      } else if (res && res.signatureVerified === false) {
        r.status = "badsig";
        r.headline = "The document content is unchanged, but the signature does not match the signer's certificate. It may have been forged or damaged.";
      } else if (failure && /message digest/i.test(failure.message)) {
        r.status = "modified";
        r.headline = "The document was changed after it was signed.";
      } else if (failure && failure.code === 2) {
        r.status = "unsupported"; r.headline = "The signature does not include the signer's certificate, so it cannot be checked here.";
      } else {
        r.status = "unsupported";
        r.headline = "The signature could not be checked" + (failure && failure.message ? ": " + failure.message.replace(/^Error during verification:\s*/i, "") : ".");
      }
      // the digest alone, so a failed signature value can still be told apart from changed content
      if (r.status === "unsupported" && failure && failure.code !== 2) {
        try {
          const md = attrValues(si, "signed", OID.attrMessageDigest)[0];
          if (md) {
            const same = hex(new Uint8Array(md.valueBlock.valueHexView)) === hex(await digestOf(hashInfo[1], signed));
            if (!same) { r.status = "modified"; r.headline = "The document was changed after it was signed."; }
          }
        } catch { /* keep "unsupported" */ }
      }

      /* an embedded timestamp on the signature */
      const tok = attrValues(si, "unsigned", OID.attrTimestampToken)[0];
      if (tok) r.timestamp = await readTimestamp(tok, new Uint8Array(si.signature.valueBlock.valueHexView));

      /* notes */
      if (hashInfo[0] === "SHA-1") r.notes.push("This signature uses SHA-1, an old algorithm that is considered weak.");
      if (/^RSA (\d+)/.test(r.signer && r.signer.key) && Number(/^RSA (\d+)/.exec(r.signer.key)[1]) < 2048) r.notes.push("The signer's RSA key is shorter than 2048 bits, which is considered weak.");
      if (sd.signerInfos.length > 1) r.notes.push(`This signature has ${sd.signerInfos.length} signers. Only the first was checked.`);
      return r;
    } catch (err) {
      r.status = "damaged"; r.headline = "The signature could not be read: " + (err && err.message || err);
      return r;
    }
  }

  // whole file -> { signatures: [result], length }
  async function analyze(bytes) {
    const found = collect(bytes);
    const signatures = [];
    for (const e of found) signatures.push(await checkOne(bytes, e));
    // later signatures that start after an earlier one ended show how the file grew
    signatures.forEach((s, i) => {
      s.laterBytes = Math.max(0, s.fileLength - s.coverageEnd);
      s.signedOrder = i + 1;
    });
    return { signatures, length: bytes.length };
  }

  return { analyze, collect, findByteRanges, parsePdfString, decodeText, parsePdfDate, readDict, STATUS, secureCrypto };
})();
