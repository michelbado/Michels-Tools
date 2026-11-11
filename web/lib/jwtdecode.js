/* JWT decoder: reads a JSON Web Token (header, payload, times, signature part) and points out weak settings. It can also check the
   signature when given a key, using the browser's own crypto; private keys are refused. Works only on the pasted text, sends nothing.
   Decoding is NOT verifying: without a check the contents may be forged. Exports window.JwtDecode. */
(() => {
  "use strict";
  const td = new TextDecoder("utf-8", { fatal: true });
  const b64uBytes = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
  const b64uText = s => td.decode(b64uBytes(s));
  const isB64u = s => /^[A-Za-z0-9_-]*$/.test(s);
  const ALGS = { none: "unsecured (no signature)", HS256: "HMAC with SHA-256 (shared secret)", HS384: "HMAC with SHA-384 (shared secret)", HS512: "HMAC with SHA-512 (shared secret)", RS256: "RSA PKCS#1 v1.5 with SHA-256", RS384: "RSA PKCS#1 v1.5 with SHA-384", RS512: "RSA PKCS#1 v1.5 with SHA-512", PS256: "RSA-PSS with SHA-256", PS384: "RSA-PSS with SHA-384", PS512: "RSA-PSS with SHA-512", ES256: "ECDSA P-256 with SHA-256", ES384: "ECDSA P-384 with SHA-384", ES512: "ECDSA P-521 with SHA-512", EdDSA: "EdDSA (Ed25519 or Ed448)", ES256K: "ECDSA secp256k1 with SHA-256" };
  const CLAIMS = { iss: "issuer: who created the token", sub: "subject: who the token is about", aud: "audience: who the token is meant for", exp: "expiration time", nbf: "not valid before", iat: "issued at", jti: "token ID", azp: "authorised party (the client)", scope: "permissions granted", scp: "permissions granted", nonce: "value tying the token to a login request", sid: "session ID", auth_time: "when the user logged in", acr: "authentication level", amr: "how the user authenticated", email: "e-mail address", name: "name", preferred_username: "user name", roles: "roles", groups: "groups" };

  function when(sec, now) {
    if (typeof sec !== "number" || !Number.isFinite(sec)) return null;
    const d = new Date(sec * 1000); if (Number.isNaN(d.getTime())) return null;
    const diff = Math.round(sec - now / 1000), a = Math.abs(diff);
    const pl = (n, w) => n + " " + w + (n === 1 ? "" : "s");
    const rel = a < 60 ? pl(a, "second") : a < 3600 ? pl(Math.round(a / 60), "minute") : a < 172800 ? pl(Math.round(a / 3600), "hour") : pl(Math.round(a / 86400), "day");
    return { iso: d.toISOString().replace(".000Z", "Z"), rel: diff < 0 ? rel + " ago" : "in " + rel, diff };
  }
  const clean = t => String(t == null ? "" : t).trim().replace(/^authorization\s*:\s*/i, "").replace(/^bearer\s+/i, "").replace(/^["']|["']$/g, "").replace(/\s+/g, "");

  function parse(text, now) {
    now = now == null ? Date.now() : now;
    const tok = clean(text); if (!tok) return { empty: true };
    const parts = tok.split(".");
    if (parts.length === 5) return { error: "This token has five parts: it is an encrypted token (JWE). Its content cannot be read without the decryption key, so there is nothing to show." };
    if (parts.length < 2 || parts.length > 3) return { error: "A JWT has three parts separated by dots (header.payload.signature). This text has " + parts.length + "." };
    if (parts.slice(0, 2).some(p => !p || !isB64u(p))) return { error: "The header and payload must be Base64URL text (letters, digits, - and _). This is not a JWT." };
    let header, payload, hText, pText;
    try { hText = b64uText(parts[0]); header = JSON.parse(hText); } catch { return { error: "The first part does not decode to JSON, so it is not a JWT header." }; }
    if (!header || typeof header !== "object" || Array.isArray(header)) return { error: "The header is not a JSON object." };
    try { pText = b64uText(parts[1]); } catch { return { error: "The second part does not decode to readable text." }; }
    let payloadIsJson = true; try { payload = JSON.parse(pText); } catch { payloadIsJson = false; payload = pText; }
    const notes = [{ level: "warn", text: "This tool only DECODES the token. The signature has not been checked, so everything shown could have been forged. Use \"Check the signature\" with the right key to verify it." }];
    const alg = header.alg, sig = parts[2] === undefined ? "" : parts[2];
    // ---- header
    if (alg === undefined) notes.push({ level: "bad", text: "The header has no \"alg\" (algorithm) field." });
    else if (String(alg).toLowerCase() === "none") notes.push({ level: "bad", text: "alg \"" + alg + "\" means the token is NOT signed. Anyone can write such a token, so a server must reject it. If a server accepted this, anyone could log in as anyone." });
    else if (!ALGS[alg]) notes.push({ level: "warn", text: "\"" + alg + "\" is not a signing algorithm I know." });
    else if (/^HS/.test(alg)) notes.push({ level: "", text: alg + " is a shared-secret signature: everyone who can verify the token can also create one. Fine between two parts of one system; unsuitable when other parties must verify it." });
    if (alg !== undefined && String(alg).toLowerCase() !== "none" && !sig) notes.push({ level: "bad", text: "The header says " + alg + " but the token has no signature part. A server should reject it." });
    if (alg !== undefined && String(alg).toLowerCase() === "none" && sig) notes.push({ level: "warn", text: "alg none, but a signature part is present. It is meaningless." });
    for (const k of ["jku", "x5u", "jwk", "x5c"]) if (k in header) notes.push({ level: "warn", text: "The header carries \"" + k + "\" (a key or the address of a key). A server must never trust a key supplied by the token itself: an attacker can put their own key there." });
    if (typeof header.kid === "string" && /[\/\\'";]|\.\./.test(header.kid)) notes.push({ level: "warn", text: "The key ID (kid) contains characters used in path traversal or injection attacks. A server that uses it in a file path or query must clean it." });
    if (header.typ && String(header.typ).toUpperCase() !== "JWT") notes.push({ level: "", text: "typ is \"" + header.typ + "\", not JWT." });
    if (header.crit) notes.push({ level: "warn", text: "The header has \"crit\" (critical extensions): a server must understand them all or reject the token." });
    // ---- claims
    const rows = [], times = {};
    if (payloadIsJson && payload && typeof payload === "object" && !Array.isArray(payload)) {
      for (const [k, v] of Object.entries(payload)) {
        const isTime = ["exp", "nbf", "iat", "auth_time"].includes(k), w = isTime ? when(v, now) : null;
        if (w) times[k] = w;
        rows.push([k, typeof v === "string" ? v : JSON.stringify(v), (CLAIMS[k] || "") + (w ? (CLAIMS[k] ? ": " : "") + w.iso + " (" + w.rel + ")" : (isTime ? " (not a valid time)" : ""))]);
      }
      if (times.exp) notes.push(times.exp.diff < 0 ? { level: "bad", text: "The token has EXPIRED (" + times.exp.rel + ")." } : { level: "good", text: "The token is still valid for now: it expires " + times.exp.rel + "." });
      else if (!("exp" in payload)) notes.push({ level: "warn", text: "The token has no expiry time (exp): if it leaks it stays valid forever, unless the server limits it some other way." });
      if (times.nbf && times.nbf.diff > 0) notes.push({ level: "warn", text: "The token is not valid yet (nbf is " + times.nbf.rel + ")." });
      if (times.iat && times.iat.diff > 300) notes.push({ level: "warn", text: "The token claims to be issued in the future (" + times.iat.rel + "): the clock of the issuer or of this device is wrong." });
      if (times.exp && times.iat && times.exp.diff + (times.iat ? -times.iat.diff : 0) > 0 && payload.exp - payload.iat > 365 * 86400) notes.push({ level: "warn", text: "The token lives for more than a year (" + Math.round((payload.exp - payload.iat) / 86400) + " days). Long-lived tokens are dangerous if stolen." });
      if (!("iss" in payload) && !("aud" in payload)) notes.push({ level: "", text: "There is no issuer (iss) or audience (aud) claim. A server should check both, so a token made for one service cannot be used on another." });
      if (typeof payload.exp === "number" && payload.exp > 1e11) notes.push({ level: "warn", text: "exp looks like milliseconds. JWT times are in SECONDS since 1970; a millisecond value makes the token valid for thousands of years." });
      if (rows.some(r => /^(email|phone_number|name|given_name|family_name|address|birthdate)$/.test(r[0]))) notes.push({ level: "", text: "The payload holds personal details. A JWT payload is only encoded, not encrypted: anyone who has the token can read it." });
    } else if (!payloadIsJson) notes.push({ level: "", text: "The payload is not JSON; it is shown as text." });
    if (tok.length > 4000) notes.push({ level: "warn", text: "The token is " + tok.length + " characters long. Many servers and browsers limit headers and cookies to about 4 to 8 KB." });
    return { header, payload, headerText: JSON.stringify(header, null, 2), payloadText: payloadIsJson ? JSON.stringify(payload, null, 2) : pText, claims: rows, times, notes, alg, sigLength: sig ? (() => { try { return b64uBytes(sig).length; } catch { return -1; } })() : 0, token: tok, parts: parts.length };
  }

  // ---------- checking the signature ----------
  const pemBody = (s, label) => { const m = new RegExp("-----BEGIN " + label + "-----([\\s\\S]*?)-----END " + label + "-----").exec(s); return m ? Uint8Array.from(atob(m[1].replace(/\s+/g, "")), c => c.charCodeAt(0)) : null; };
  // DER walk: find the SubjectPublicKeyInfo of an X.509 certificate
  function der(b, o) { if (o + 2 > b.length) return null; const tag = b[o]; let len = b[o + 1], p = o + 2; if (len & 0x80) { const n = len & 0x7f; if (n < 1 || n > 4) return null; len = 0; for (let i = 0; i < n; i++) len = len * 256 + b[p++]; } if (p + len > b.length) return null; return { tag, start: p, end: p + len, hdr: o }; }
  function spkiFromCert(b) {
    const cert = der(b, 0); if (!cert || cert.tag !== 0x30) return null;
    const tbs = der(b, cert.start); if (!tbs || tbs.tag !== 0x30) return null;
    let p = tbs.start, e = der(b, p); if (e && e.tag === 0xa0) { p = e.end; }       // optional version
    for (let i = 0; i < 5; i++) { e = der(b, p); if (!e) return null; p = e.end; }   // serial, signature, issuer, validity, subject
    const spki = der(b, p); return spki && spki.tag === 0x30 ? b.slice(spki.hdr, spki.end) : null;
  }
  async function verify(text, keyText, opts) {
    opts = opts || {}; const subtle = globalThis.crypto && globalThis.crypto.subtle;
    const r = parse(text); if (r.error || r.empty) return { ok: false, text: r.error || "Paste a token first." };
    const alg = r.alg, sigB64 = r.token.split(".")[2];
    if (!alg || String(alg).toLowerCase() === "none") return { ok: false, text: "This token has no signature to check (alg none). That is a problem in itself." };
    if (!sigB64) return { ok: false, text: "The token has no signature part." };
    if (!ALGS[alg] || alg === "EdDSA" || alg === "ES256K") return { ok: false, text: "The algorithm " + alg + " cannot be checked here. Supported: HS256/384/512, RS256/384/512, PS256/384/512, ES256/384/512." };
    if (!subtle) return { ok: false, text: "Signature checking needs the browser's crypto, which is only available on https pages and on localhost." };
    const k = String(keyText == null ? "" : keyText).trim(); if (!k) return { ok: false, text: "Enter the key: the secret for HS algorithms, or the public key (PEM or JWK) for the others." };
    if (/PRIVATE KEY/.test(k)) return { ok: false, text: "That is a private key. Never paste a private key into a website: checking only needs the public key. Treat the key as compromised if it has been exposed." };
    const data = new TextEncoder().encode(r.token.split(".").slice(0, 2).join(".")); let sig; try { sig = b64uBytes(sigB64); } catch { return { ok: false, text: "The signature part is not valid Base64URL." }; }
    const hash = "SHA-" + alg.slice(-3), fam = alg.slice(0, 2);
    try {
      let key, algo;
      if (fam === "HS") {
        let raw; if (opts.secretIsBase64) { try { raw = Uint8Array.from(atob(k.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)); } catch { return { ok: false, text: "The secret is not valid Base64." }; } } else raw = new TextEncoder().encode(k);
        key = await subtle.importKey("raw", raw, { name: "HMAC", hash }, false, ["verify"]); algo = "HMAC";
      } else {
        const pubAlg = fam === "RS" ? { name: "RSASSA-PKCS1-v1_5", hash } : fam === "PS" ? { name: "RSA-PSS", hash } : { name: "ECDSA", namedCurve: { ES256: "P-256", ES384: "P-384", ES512: "P-521" }[alg] };
        if (k.startsWith("{")) { let jwk; try { jwk = JSON.parse(k); } catch { return { ok: false, text: "The key looks like JSON but is not valid JSON." }; } if (jwk.d || jwk.p || jwk.q) return { ok: false, text: "That JWK contains private key fields. Remove them: only the public key is needed (and never paste a private key into a website)." }; key = await subtle.importKey("jwk", jwk, pubAlg, false, ["verify"]); }
        else { const spki = pemBody(k, "PUBLIC KEY") || (pemBody(k, "CERTIFICATE") && spkiFromCert(pemBody(k, "CERTIFICATE"))); if (!spki) return { ok: false, text: "I need a public key in PEM form (-----BEGIN PUBLIC KEY-----), a certificate, or a JWK." }; key = await subtle.importKey("spki", spki, pubAlg, false, ["verify"]); }
        algo = fam === "PS" ? { name: "RSA-PSS", saltLength: +alg.slice(-3) / 8 } : fam === "ES" ? { name: "ECDSA", hash } : "RSASSA-PKCS1-v1_5";
      }
      const good = await subtle.verify(algo, key, sig, data);
      return good ? { ok: true, text: "The signature is VALID for this key: the token was signed with the matching " + (fam === "HS" ? "secret" : "private key") + " and has not been changed. (Whether you should trust the key's owner, and the token's times, is a separate question.)" } : { ok: false, text: "The signature does NOT match this key. Either the key is wrong or the token has been changed or forged." };
    } catch (e) { return { ok: false, text: "The key could not be used for " + alg + ": " + (e && e.message ? e.message : "wrong key type") + "." }; }
  }
  const api = { parse, verify, clean, b64uText, spkiFromCert, ALGS };
  if (typeof window !== "undefined") window.JwtDecode = api;
  if (typeof module !== "undefined") module.exports = api;
})();
