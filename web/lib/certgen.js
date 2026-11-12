/* CSR and key generator: makes a new private key (RSA 2048/3072/4096 or EC P-256/P-384) and a certificate signing request (CSR) with the names (SAN) and the
   subject fields you give. Uses the browser's own crypto (crypto.subtle: https or localhost) for the key and the signature; the CSR itself is written with
   lib/derkit.js. Nothing is sent anywhere. Exports window.CertGen. Tested with openssl (certgen-test.js). */
(() => {
  "use strict";
  const g = typeof window !== "undefined" ? window : globalThis;
  const D = () => g.DerKit, KF = () => g.KeyFmt;
  const subtle = () => (g.crypto || require("crypto").webcrypto).subtle;
  const TYPES = {
    rsa2048: { label: "RSA 2048 bit (works everywhere)", gen: { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, sign: { name: "RSASSA-PKCS1-v1_5" }, sigOid: "1.2.840.113549.1.1.11", nullParam: true },
    rsa3072: { label: "RSA 3072 bit", gen: { name: "RSASSA-PKCS1-v1_5", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, sign: { name: "RSASSA-PKCS1-v1_5" }, sigOid: "1.2.840.113549.1.1.11", nullParam: true },
    rsa4096: { label: "RSA 4096 bit (slower to make)", gen: { name: "RSASSA-PKCS1-v1_5", modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, sign: { name: "RSASSA-PKCS1-v1_5" }, sigOid: "1.2.840.113549.1.1.11", nullParam: true },
    ec256: { label: "EC P-256 (small and fast, modern)", gen: { name: "ECDSA", namedCurve: "P-256" }, sign: { name: "ECDSA", hash: "SHA-256" }, sigOid: "1.2.840.10045.4.3.2", ec: 32 },
    ec384: { label: "EC P-384", gen: { name: "ECDSA", namedCurve: "P-384" }, sign: { name: "ECDSA", hash: "SHA-384" }, sigOid: "1.2.840.10045.4.3.3", ec: 48 },
  };
  const ATTR = { C: "2.5.4.6", ST: "2.5.4.8", L: "2.5.4.7", O: "2.5.4.10", OU: "2.5.4.11", CN: "2.5.4.3", E: "1.2.840.113549.1.9.1" };
  const ORDER = ["C", "ST", "L", "O", "OU", "CN", "E"];

  /* ---------- checking what was typed ---------- */
  const dnsOk = (n, wildcard) => {
    const wild = wildcard && n.startsWith("*."), body = wild ? n.slice(2) : n;
    if (n.length > 253 || !body || (wild && !body.includes("."))) return false;
    const labels = body.split(".");
    return !/^\d+$/.test(labels[labels.length - 1]) && labels.every(l => /^[A-Za-z0-9_]([A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/.test(l));   // a name that ends in digits would be read as an IP address
  };
  function ipBytes(s) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
    if (m) { const o = m.slice(1).map(Number); return o.every(x => x < 256) ? Uint8Array.from(o) : null; }
    if (!/^[0-9A-Fa-f:.]+$/.test(s) || !s.includes(":")) return null;
    let head = s, tail = ""; const dbl = s.indexOf("::"); if (dbl >= 0) { head = s.slice(0, dbl); tail = s.slice(dbl + 2); if (tail.includes("::")) return null; }
    const hs = head ? head.split(":") : [], ts = tail ? tail.split(":") : [];
    if ([...hs, ...ts].some(x => !/^[0-9A-Fa-f]{1,4}$/.test(x))) return null;
    const missing = 8 - hs.length - ts.length; if (dbl < 0 ? missing !== 0 : missing < 1) return null;
    const all = [...hs, ...Array(dbl < 0 ? 0 : missing).fill("0"), ...ts], out = new Uint8Array(16);
    all.forEach((w, i) => { const v = parseInt(w, 16); out[2 * i] = v >> 8; out[2 * i + 1] = v & 255; });
    return out;
  }
  // input: { type, subject: { CN, O, OU, L, ST, C, E }, names: ["www.example.com", "*.example.com", "10.0.0.1", "mail@example.com"] }
  function check(input) {
    const problems = [], names = [], s = input.subject || {};
    if (!TYPES[input.type]) problems.push("Choose a key type.");
    if (s.C && !/^[A-Za-z]{2}$/.test(s.C)) problems.push("The country must be a two-letter code, for example NL or US.");
    for (const k of ORDER) if (s[k] && s[k].length > (k === "E" ? 128 : 64)) problems.push("The field " + k + " is too long.");
    for (const raw of (input.names || [])) {
      const n = String(raw).trim(); if (!n) continue;
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(n)) names.push({ kind: "Email", value: n });
      else if (ipBytes(n)) names.push({ kind: "IP", value: n });
      else if (dnsOk(n, true)) names.push({ kind: "DNS", value: n.toLowerCase() });
      else problems.push("\"" + n + "\" is not a valid name. Use a host name like www.example.com, a wildcard like *.example.com, an IP address, or an email address.");
    }
    if (!names.length && s.CN && dnsOk(s.CN.trim(), true) && !/@/.test(s.CN)) names.push({ kind: "DNS", value: s.CN.trim().toLowerCase() });
    if (!names.length) problems.push("Add at least one name (host name or IP address). Browsers only use the names in this list.");
    const dup = new Set(); const uniq = names.filter(n => { const k = n.kind + n.value; if (dup.has(k)) return false; dup.add(k); return true; });
    return { problems, names: uniq };
  }

  /* ---------- the CSR ---------- */
  function nameDer(subject) {
    const d = D(), sets = [];
    for (const k of ORDER) { const v = (subject[k] || "").trim(); if (!v) continue; sets.push(d.set(d.seq(d.oid(ATTR[k]), k === "C" ? d.tlv(0x13, new TextEncoder().encode(v.toUpperCase())) : k === "E" ? d.ia5(v) : d.utf8(v)))); }
    return d.seq(...sets);
  }
  function generalNames(names) {
    const d = D(), enc = new TextEncoder();
    return d.seq(...names.map(n => n.kind === "DNS" ? d.tlv(0x82, enc.encode(n.value)) : n.kind === "IP" ? d.tlv(0x87, ipBytes(n.value)) : d.tlv(0x81, enc.encode(n.value))));
  }
  const rsDer = raw => { const d = D(), h = raw.length / 2; return d.seq(d.int(raw.subarray(0, h)), d.int(raw.subarray(h))); };
  // make({ type, subject, names, password?, protect?: "aes256" | "3des" }) -> { csrPem, keyPem, keyProtected, names, summary, command }
  async function make(input) {
    const d = D(), t = TYPES[input.type], chk = check(input);
    if (chk.problems.length) { const e = new Error(chk.problems[0]); e.problems = chk.problems; throw e; }
    if (!subtle()) { const e = new Error("This needs the browser's crypto, which is only available on https pages (or localhost). Open this page over https."); e.code = "nocrypto"; throw e; }
    const pair = await subtle().generateKey(t.gen, true, ["sign", "verify"]);
    const pkcs8 = new Uint8Array(await subtle().exportKey("pkcs8", pair.privateKey)), spki = new Uint8Array(await subtle().exportKey("spki", pair.publicKey));
    const ext = d.seq(d.seq(d.oid("2.5.29.17"), d.octets(generalNames(chk.names))));
    const attrs = d.ctx(0, d.seq(d.oid("1.2.840.113549.1.9.14"), d.set(ext)));
    const info = d.seq(d.int(0), nameDer(input.subject || {}), spki, attrs);
    let sig = new Uint8Array(await subtle().sign(t.sign, pair.privateKey, info));
    if (t.ec) sig = rsDer(sig);
    const csr = d.seq(info, d.seq(d.oid(t.sigOid), ...(t.nullParam ? [d.nul()] : [])), d.bits(sig));
    const key = KF().readPkcs8(pkcs8);
    const pw = input.password || "", protect = pw ? (input.protect === "3des" ? "pkcs8-encrypted-3des" : "pkcs8-encrypted") : "pkcs8";
    const keyOut = await KF().exportKey(key, protect, pw);
    const s = input.subject || {};
    const subj = ORDER.filter(k => (s[k] || "").trim()).map(k => "/" + (k === "E" ? "emailAddress" : k) + "=" + s[k].trim()).join("");
    const command = "openssl req -new -newkey " + (t.ec ? "ec -pkeyopt ec_paramgen_curve:" + t.gen.namedCurve : "rsa:" + t.gen.modulusLength) + " -nodes -keyout server.key -out server.csr -subj \"" + subj + "\" -addext \"subjectAltName=" + chk.names.map(n => (n.kind === "DNS" ? "DNS:" : n.kind === "IP" ? "IP:" : "email:") + n.value).join(",") + "\"";
    return { csrPem: d.pemOut("CERTIFICATE REQUEST", csr), csrDer: csr, keyPem: keyOut.text, keyProtected: !!pw, keyLabel: key.label, names: chk.names, subjectText: subj, command, spki };
  }

  g.CertGen = { TYPES, check, make, ipBytes };
  if (typeof module !== "undefined") module.exports = g.CertGen;
})();
