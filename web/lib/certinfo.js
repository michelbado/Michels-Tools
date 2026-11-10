/* Certificate and CSR reading for the Certificate Decoder. Uses the vendored pkijs/asn1js (window.pkijs, window.asn1js) and lib/softcrypto.js
   for the fingerprints, so it works on plain http too. Pure apart from those: nothing is sent anywhere. Exports window.CertInfo. */
(() => {
  "use strict";
  const g = typeof window !== "undefined" ? window : globalThis;
  const hex = (u8, sep) => Array.from(u8, b => b.toString(16).padStart(2, "0")).join(sep == null ? "" : sep);
  const HEXU = u8 => hex(u8, ":").toUpperCase();
  const ATTR = { "2.5.4.3": "CN", "2.5.4.6": "C", "2.5.4.7": "L", "2.5.4.8": "ST", "2.5.4.9": "STREET", "2.5.4.10": "O", "2.5.4.11": "OU", "2.5.4.5": "serialNumber", "2.5.4.4": "SN", "2.5.4.42": "GN", "2.5.4.12": "title", "2.5.4.15": "businessCategory", "2.5.4.97": "organizationIdentifier", "1.2.840.113549.1.9.1": "emailAddress", "0.9.2342.19200300.100.1.25": "DC", "0.9.2342.19200300.100.1.1": "UID", "1.3.6.1.4.1.311.60.2.1.3": "jurisdictionC", "1.3.6.1.4.1.311.60.2.1.2": "jurisdictionST", "1.3.6.1.4.1.311.60.2.1.1": "jurisdictionL" };
  const SIGALG = { "1.2.840.113549.1.1.5": "SHA-1 with RSA", "1.2.840.113549.1.1.4": "MD5 with RSA", "1.2.840.113549.1.1.11": "SHA-256 with RSA", "1.2.840.113549.1.1.12": "SHA-384 with RSA", "1.2.840.113549.1.1.13": "SHA-512 with RSA", "1.2.840.113549.1.1.10": "RSA-PSS", "1.2.840.10045.4.1": "SHA-1 with ECDSA", "1.2.840.10045.4.3.2": "SHA-256 with ECDSA", "1.2.840.10045.4.3.3": "SHA-384 with ECDSA", "1.2.840.10045.4.3.4": "SHA-512 with ECDSA", "1.3.101.112": "Ed25519", "1.3.101.113": "Ed448" };
  const CURVE = { "1.2.840.10045.3.1.7": "P-256 (prime256v1)", "1.3.132.0.34": "P-384", "1.3.132.0.35": "P-521", "1.3.132.0.10": "secp256k1" };
  const CURVEBITS = { "1.2.840.10045.3.1.7": 256, "1.3.132.0.34": 384, "1.3.132.0.35": 521, "1.3.132.0.10": 256 };
  const EKU = { "1.3.6.1.5.5.7.3.1": "Web server (serverAuth)", "1.3.6.1.5.5.7.3.2": "Web client (clientAuth)", "1.3.6.1.5.5.7.3.3": "Code signing", "1.3.6.1.5.5.7.3.4": "Email protection", "1.3.6.1.5.5.7.3.8": "Time stamping", "1.3.6.1.5.5.7.3.9": "OCSP signing", "2.5.29.37.0": "Any purpose", "1.3.6.1.4.1.311.20.2.2": "Smart card log-on", "1.3.6.1.5.5.7.3.17": "IPsec IKE" };
  const KU = ["Digital signature", "Non-repudiation", "Key encipherment", "Data encipherment", "Key agreement", "Certificate signing", "CRL signing", "Encipher only", "Decipher only"];
  const POLICY = { "2.23.140.1.2.1": "Domain validated (DV)", "2.23.140.1.2.2": "Organization validated (OV)", "2.23.140.1.2.3": "Individual validated", "2.23.140.1.1": "Extended validation (EV)", "2.5.29.32.0": "Any policy" };

  /* ---------- reading the text ---------- */
  const b64 = s => { const bin = atob(s.replace(/\s+/g, "")); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  // text (PEM blocks, or bare base64) -> { items: [{ kind: "cert"|"csr", der }], warnings: [] }
  function extract(text) {
    const out = { items: [], warnings: [] }, s = String(text == null ? "" : text);
    if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(s)) out.warnings.push({ level: "bad", text: "This contains a PRIVATE KEY. Never paste a private key into any website. It was not read and nothing was sent anywhere, but if you have pasted it into other places, treat the key as compromised and replace it." });
    const re = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;
    let m;
    while ((m = re.exec(s))) {
      const label = m[1];
      if (/PRIVATE KEY/.test(label)) continue;
      const kind = /CERTIFICATE REQUEST$/.test(label) ? "csr" : /CERTIFICATE$/.test(label) ? "cert" : null;
      if (!kind) { out.warnings.push({ level: "", text: "Skipped a \"" + label + "\" block; this tool reads certificates and certificate requests." }); continue; }
      try { out.items.push({ kind, der: b64(m[2]) }); } catch { out.warnings.push({ level: "bad", text: "A \"" + label + "\" block is not valid base64." }); }
    }
    if (!out.items.length && !/-----BEGIN/.test(s)) {   // bare base64 (as in an email or a config file)
      const t = s.replace(/\s+/g, "");
      if (t.length > 100 && /^[A-Za-z0-9+/]+=*$/.test(t)) { try { out.items.push({ kind: "auto", der: b64(t) }); } catch { /* not base64 */ } }
    }
    return out;
  }
  const sniff = der => { try { const a = g.asn1js.fromBER(der.buffer.slice(der.byteOffset, der.byteOffset + der.length)); return a.offset === -1 ? null : a.result; } catch { return null; } };

  /* ---------- helpers on parsed objects ---------- */
  const dnParts = name => name.typesAndValues.map(t => [ATTR[t.type] || t.type, String(t.value.valueBlock.value)]);
  const dnText = name => dnParts(name).map(([k, v]) => k + "=" + v).join(", ");
  const cnOf = name => { const p = dnParts(name).find(x => x[0] === "CN"); return p ? p[1] : ""; };
  const bitLength = u8 => { let i = 0; while (i < u8.length && u8[i] === 0) i++; if (i === u8.length) return 0; return (u8.length - i - 1) * 8 + (32 - Math.clz32(u8[i])); };
  const fmtDate = d => d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  const DAY = 86400000;
  const ago = (a, b) => { const d = Math.floor((b - a) / DAY); return d; };
  const ipText = u8 => u8.length === 4 ? Array.from(u8).join(".") : u8.length === 16 ? (g.IPv6 ? g.IPv6.compress(BigInt("0x" + hex(u8))) : hex(u8, ":")) : hex(u8, ":");
  const gnText = a => {   // one GeneralName -> [kind, text]
    const v = a.value;
    switch (a.type) {
      case 2: return ["DNS", String(v)];
      case 1: return ["Email", String(v)];
      case 6: return ["URI", String(v)];
      case 7: return ["IP", ipText(new Uint8Array(v.valueBlock.valueHexView))];
      case 4: return ["Directory", dnText(v)];
      case 8: return ["Registered ID", String(v)];
      default: return ["Other", ""];
    }
  };
  const extOf = (c, oid) => (c.extensions || []).find(e => e.extnID === oid);
  const sha = (name, der) => HEXU(g.SoftCrypto.digest(name, der));

  function keyInfo(spki) {
    const alg = spki.algorithm.algorithmId, pk = spki.parsedKey;
    if (alg === "1.2.840.113549.1.1.1" && pk && pk.modulus) {
      const bits = bitLength(new Uint8Array(pk.modulus.valueBlock.valueHexView));
      return { text: "RSA " + bits + " bit", bits, weak: bits < 2048, family: "RSA" };
    }
    if (alg === "1.2.840.10045.2.1") {
      const oid = spki.algorithm.algorithmParams && spki.algorithm.algorithmParams.valueBlock ? spki.algorithm.algorithmParams.valueBlock.toString() : "";
      return { text: "Elliptic curve " + (CURVE[oid] || oid || "(unknown curve)"), bits: CURVEBITS[oid] || 0, weak: false, family: "EC" };
    }
    if (alg === "1.3.101.112") return { text: "Ed25519", bits: 256, weak: false, family: "Ed" };
    if (alg === "1.3.101.113") return { text: "Ed448", bits: 456, weak: false, family: "Ed" };
    return { text: "Key type " + alg, bits: 0, weak: false, family: "" };
  }

  // A host name against the names in a certificate. Wildcards only for the whole left-most label, and never cross a dot.
  function hostMatches(host, pattern) {
    host = String(host).toLowerCase().replace(/\.$/, ""); pattern = String(pattern).toLowerCase().replace(/\.$/, "");
    if (pattern === host) return true;
    if (!pattern.startsWith("*.")) return false;
    const rest = pattern.slice(2), i = host.indexOf(".");
    return i > 0 && host.slice(i + 1) === rest && rest.includes(".");
  }

  /* ---------- one certificate ---------- */
  function readCert(der) {
    const asn = sniff(der);
    if (!asn) throw new Error("not valid certificate data");
    return new g.pkijs.Certificate({ schema: asn });
  }
  function describeCert(der, now, hostCheck) {
    const c = readCert(der), notes = [], sections = [];
    const subj = dnText(c.subject), iss = dnText(c.issuer), selfIssued = c.subject.isEqual(c.issuer);
    const ki = keyInfo(c.subjectPublicKeyInfo), sigOid = c.signatureAlgorithm.algorithmId, sigName = SIGALG[sigOid] || sigOid;
    const nb = c.notBefore.value, na = c.notAfter.value;
    const bc = extOf(c, "2.5.29.19"), isCA = !!(bc && bc.parsedValue && bc.parsedValue.cA);
    const san = extOf(c, "2.5.29.17"), sans = san ? san.parsedValue.altNames.map(gnText) : [];
    const eku = extOf(c, "2.5.29.37"), ekus = eku ? eku.parsedValue.keyPurposes.map(o => EKU[o] || o) : [];

    // validity and notes
    const days = Math.floor((na - now) / DAY);
    let validity;
    if (now < nb) { validity = "Not valid yet (starts in " + Math.ceil((nb - now) / DAY) + " days)"; notes.push({ level: "bad", text: "This certificate is not valid yet. Check the clock of the device that shows the error, and the start date below." }); }
    else if (now > na) { validity = "Expired " + ago(na, now) + " days ago"; notes.push({ level: "bad", text: "This certificate expired on " + fmtDate(na) + ". It must be renewed." }); }
    else { validity = "Valid, " + days + " days left"; if (days < 14) notes.push({ level: "bad", text: "Only " + days + " days left. Renew it now." }); else if (days < 30) notes.push({ level: "warn", text: days + " days left. Plan the renewal." }); else notes.push({ level: "good", text: "Within its validity period (" + days + " days left)." }); }
    const lifeDays = Math.round((na - nb) / DAY);
    if (!isCA && lifeDays > 398 && ekus.some(x => /Web server/.test(x))) notes.push({ level: "warn", text: "Valid for " + lifeDays + " days. Browsers refuse publicly trusted web certificates that last longer than 398 days (private certificates are not affected)." });
    if (/SHA-1|MD5/.test(sigName)) notes.push({ level: "bad", text: "Signed with " + sigName + ", which is broken. Browsers reject it." });
    if (ki.weak) notes.push({ level: "bad", text: "The key is only " + ki.bits + " bits. 2048 is the minimum accepted today." });
    if (!isCA && ekus.some(x => /Web server/.test(x)) && !sans.some(s => s[0] === "DNS" || s[0] === "IP")) notes.push({ level: "bad", text: "A web server certificate with no Subject Alternative Names: browsers ignore the Common Name and will refuse it." });
    if (selfIssued) notes.push({ level: isCA ? "" : "warn", text: isCA ? "Self-signed root certificate: it is trusted only if it is installed on the device." : "Self-signed: browsers will warn unless it is installed as trusted." });
    if (hostCheck) {
      const names = sans.filter(s => s[0] === "DNS" || s[0] === "IP").map(s => s[1]), pool = names.length ? names : (cnOf(c.subject) ? [cnOf(c.subject)] : []);
      const hit = pool.find(n => hostMatches(hostCheck, n));
      notes.push(hit ? { level: "good", text: "The name " + hostCheck + " is covered (by " + hit + ")." } : { level: "bad", text: "The name " + hostCheck + " is NOT covered by this certificate. Names it covers: " + (pool.join(", ") || "none") + "." });
    }

    sections.push({ title: "Who it is for", rows: [
      ["Subject", subj || "(empty)"], ["Common name", cnOf(c.subject) || "(none)"],
      ["Names (SAN)", sans.length ? sans.map(s => s[0] + ": " + s[1]).join("\n") : "none", sans.length ? "" : "Modern browsers only look at this list."],
    ] });
    sections.push({ title: "Who issued it", rows: [["Issuer", iss || "(empty)"], ["Self-issued", selfIssued ? "yes (issuer and subject are the same)" : "no"]] });
    sections.push({ title: "Validity", rows: [["Valid from", fmtDate(nb)], ["Valid until", fmtDate(na)], ["Status", validity], ["Lifetime", lifeDays + " days"]] });
    sections.push({ title: "Keys and signature", rows: [["Public key", ki.text], ["Signature", sigName], ["Version", "v" + (c.version + 1)], ["Serial number", HEXU(new Uint8Array(c.serialNumber.valueBlock.valueHexView))]] });

    const use = [["Certificate authority", isCA ? "yes (may sign other certificates)" + (bc.parsedValue.pathLenConstraint != null ? ", path length limit " + bc.parsedValue.pathLenConstraint : "") : "no (an end certificate)"]];
    const ku = extOf(c, "2.5.29.15");
    if (ku && ku.parsedValue && ku.parsedValue.valueBlock) {
      const bytes = new Uint8Array(ku.parsedValue.valueBlock.valueHexView), on = [];
      KU.forEach((n, i) => { const byte = bytes[i >> 3] || 0; if (byte & (0x80 >> (i & 7))) on.push(n); });
      use.push(["Key usage" + (ku.critical ? " (critical)" : ""), on.join(", ") || "none"]);
    }
    if (ekus.length) use.push(["Extended key usage", ekus.join(", ")]);
    const pol = extOf(c, "2.5.29.32");
    if (pol && pol.parsedValue.certificatePolicies) {
      const ids = pol.parsedValue.certificatePolicies.map(p => p.policyIdentifier), known = ids.filter(i => POLICY[i]).map(i => POLICY[i]);
      use.push(["Validation level", known.length ? known.join(", ") : "not stated", ids.length ? "Policy ids: " + ids.join(", ") : ""]);
    }
    if (extOf(c, "1.3.6.1.4.1.11129.2.4.2")) use.push(["Certificate Transparency", "signed certificate timestamps are embedded (logged publicly)"]);
    if (extOf(c, "1.3.6.1.5.5.7.1.24")) use.push(["OCSP must-staple", "yes (the server must staple a fresh OCSP answer)"]);
    sections.push({ title: "What it may be used for", rows: use });

    const where = [];
    const aia = extOf(c, "1.3.6.1.5.5.7.1.1");
    if (aia && aia.parsedValue.accessDescriptions) for (const d of aia.parsedValue.accessDescriptions) where.push([d.accessMethod === "1.3.6.1.5.5.7.48.1" ? "OCSP responder" : d.accessMethod === "1.3.6.1.5.5.7.48.2" ? "Issuer certificate" : "Access " + d.accessMethod, gnText(d.accessLocation)[1]]);
    const crl = extOf(c, "2.5.29.31");
    if (crl && crl.parsedValue.distributionPoints) for (const d of crl.parsedValue.distributionPoints) if (Array.isArray(d.distributionPoint)) for (const n of d.distributionPoint) where.push(["Revocation list (CRL)", gnText(n)[1]]);
    if (where.length) sections.push({ title: "Where to check it", rows: where });

    const ski = extOf(c, "2.5.29.14"), aki = extOf(c, "2.5.29.35");
    const ids = [["SHA-256 fingerprint", sha("SHA-256", der)], ["SHA-1 fingerprint", sha("SHA-1", der)]];
    if (ski) ids.push(["Subject key identifier", HEXU(new Uint8Array(ski.parsedValue.valueBlock.valueHexView))]);
    if (aki && aki.parsedValue.keyIdentifier) ids.push(["Authority key identifier", HEXU(new Uint8Array(aki.parsedValue.keyIdentifier.valueBlock.valueHexView))]);
    sections.push({ title: "Fingerprints and identifiers", rows: ids, mono: true });

    const title = (cnOf(c.subject) || subj || "Certificate") + (isCA ? " (CA)" : "");
    return { kind: "cert", title, summary: title + " : " + validity.toLowerCase(), sections, notes, cert: c, subjectDN: subj, issuerDN: iss, isCA, selfIssued, validity };
  }

  /* ---------- a certificate request ---------- */
  async function describeCsr(der) {
    const asn = sniff(der);
    if (!asn) throw new Error("not valid request data");
    const r = new g.pkijs.CertificationRequest({ schema: asn });
    const notes = [], sections = [], ki = keyInfo(r.subjectPublicKeyInfo), sigName = SIGALG[r.signatureAlgorithm.algorithmId] || r.signatureAlgorithm.algorithmId;
    let sans = [];
    for (const a of r.attributes || []) {
      if (a.type === "1.2.840.113549.1.9.14" && a.values && a.values[0]) {
        try { const ex = new g.pkijs.Extensions({ schema: a.values[0] }); const e = ex.extensions.find(x => x.extnID === "2.5.29.17"); if (e) sans = e.parsedValue.altNames.map(gnText); } catch { /* unreadable */ }
      }
    }
    let sigOk = null;
    try { sigOk = await r.verify(); } catch { sigOk = null; }
    if (sigOk === false) notes.push({ level: "bad", text: "The request's own signature does not check out: the request is damaged or was altered." });
    else if (sigOk) notes.push({ level: "good", text: "The request's own signature is valid (it proves whoever made it holds the private key)." });
    if (/SHA-1|MD5/.test(sigName)) notes.push({ level: "bad", text: "Signed with " + sigName + ", which is broken." });
    if (ki.weak) notes.push({ level: "bad", text: "The key is only " + ki.bits + " bits. 2048 is the minimum accepted today." });
    if (!sans.length) notes.push({ level: "warn", text: "No Subject Alternative Names in the request. Browsers ignore the Common Name, so list every host name as a SAN." });
    sections.push({ title: "Who it is for", rows: [["Subject", dnText(r.subject) || "(empty)"], ["Common name", cnOf(r.subject) || "(none)"], ["Names (SAN)", sans.length ? sans.map(s => s[0] + ": " + s[1]).join("\n") : "none"]] });
    sections.push({ title: "Keys and signature", rows: [["Public key", ki.text], ["Signature", sigName], ["Signature check", sigOk === true ? "valid" : sigOk === false ? "INVALID" : "could not be checked"]] });
    sections.push({ title: "Fingerprint", rows: [["SHA-256", sha("SHA-256", der)]], mono: true });
    const title = (cnOf(r.subject) || "Certificate request") + " (request)";
    return { kind: "csr", title, summary: title, sections, notes };
  }

  // Do the certificates form a chain, in the order given? Each should be issued by the next one.
  async function chainInfo(items) {
    const certs = items.filter(i => i.kind === "cert"), rows = [], notes = [];
    if (certs.length < 2) return null;
    for (let i = 0; i < certs.length; i++) {
      const c = certs[i], next = certs[i + 1];
      let link;
      if (next) {
        const byName = c.cert.issuer.isEqual(next.cert.subject);
        let sig = null;
        if (byName) { try { sig = await c.cert.verify(next.cert); } catch { sig = null; } }
        link = byName ? (sig === true ? "issued by the next one (signature checked)" : sig === false ? "name matches the next one, but the SIGNATURE does not verify" : "name matches the next one (signature not checked)") : "NOT issued by the next one";
        if (!byName) notes.push({ level: "bad", text: "Certificate " + (i + 1) + " is not issued by certificate " + (i + 2) + ". The chain is broken or in the wrong order (server first, then intermediates, root last)." });
        else if (sig === false) notes.push({ level: "bad", text: "Certificate " + (i + 1) + " names certificate " + (i + 2) + " as its issuer, but the signature does not verify." });
      } else link = c.selfIssued ? "self-signed root: the end of the chain" : "issuer not included (browsers use the issuer they already trust, or fetch it)";
      rows.push([(i + 1) + ". " + c.title, link]);
    }
    if (!notes.length) notes.push({ level: "good", text: "The " + certs.length + " certificates link up in the right order." });
    return { title: "The chain as pasted", sections: [{ title: "Chain", rows }], notes };
  }

  const api = { extract, describeCert, describeCsr, chainInfo, hostMatches, readCert, dnText, bitLength };
  g.CertInfo = api;
  if (typeof module !== "undefined") module.exports = api;
})();
