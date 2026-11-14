/* SSH key reader: public keys, certificates, authorized_keys and known_hosts lines, RFC 4716 files, and the public half of OpenSSH private key files.
   Gives type, size, fingerprints (SHA-256 and MD5, as ssh-keygen -l shows them), the random-art picture, certificate details, plain-word notes.
   Pure code: reads only what is passed in. The PRIVATE part of a private key file is never read, never decoded, never shown (OpenSSH stores the public key
   in clear text at the start of the file, and that is all this uses). Needs lib/hashcalc.js and lib/softcrypto.js (looked up when used). Exports window.SshKey. */
(() => {
  "use strict";
  const g = typeof window !== "undefined" ? window : globalThis;
  const H = () => g.HashCalc;
  const td = new TextDecoder("utf-8", { fatal: false });
  const MAXLINES = 200, MAXLINE = 20000;

  const KINDS = {
    "ssh-rsa": { name: "RSA", short: "RSA" }, "ssh-dss": { name: "DSA", short: "DSA" }, "ssh-ed25519": { name: "Ed25519", short: "ED25519" },
    "ecdsa-sha2-nistp256": { name: "ECDSA P-256", short: "ECDSA", bits: 256 }, "ecdsa-sha2-nistp384": { name: "ECDSA P-384", short: "ECDSA", bits: 384 }, "ecdsa-sha2-nistp521": { name: "ECDSA P-521", short: "ECDSA", bits: 521 },
    "sk-ssh-ed25519@openssh.com": { name: "Ed25519 on a security key", short: "ED25519-SK" }, "sk-ecdsa-sha2-nistp256@openssh.com": { name: "ECDSA P-256 on a security key", short: "ECDSA-SK", bits: 256 },
  };
  const CERT_SUFFIX = "-cert-v01@openssh.com";
  const isTypeName = s => !!KINDS[s] || (s.endsWith(CERT_SUFFIX) && !!KINDS[s.slice(0, -CERT_SUFFIX.length)]);

  function b64decode(s) {
    s = String(s).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 === 1) return null;
    try { if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64")); const t = atob(s); const o = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) o[i] = t.charCodeAt(i); return o; } catch { return null; }
  }
  function b64encode(b) { let s = ""; for (let i = 0; i < b.length; i += 3) { const n = b[i] << 16 | (b[i + 1] || 0) << 8 | (b[i + 2] || 0); s += "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[n >> 18 & 63] + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[n >> 12 & 63] + (i + 1 < b.length ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[n >> 6 & 63] : "=") + (i + 2 < b.length ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[n & 63] : "="); } return s; }

  // reader over the SSH wire format (RFC 4251): uint32 lengths, strings, mpints
  function reader(b) {
    let p = 0;
    const need = n => { if (n < 0 || p + n > b.length) throw new Error("The key data ends too early."); };
    return {
      get pos() { return p; }, slice(a, z) { return b.subarray(a, z); }, get left() { return b.length - p; },
      u32() { need(4); const v = (b[p] * 16777216) + (b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]); p += 4; return v; },
      u64() { const hi = this.u32(), lo = this.u32(); return BigInt(hi) * 4294967296n + BigInt(lo); },
      str() { const n = this.u32(); need(n); const v = b.subarray(p, p + n); p += n; return v; },
      text() { return td.decode(this.str()); },
    };
  }
  const bitLen = m => { let i = 0; while (i < m.length && m[i] === 0) i++; if (i === m.length) return 0; return (m.length - i) * 8 - Math.clz32(m[i]) + 24; };
  const hex = b => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  const asBig = m => m.length ? BigInt("0x" + hex(m)) : 0n;

  function keyFields(type, r, info) {
    const base = type.endsWith(CERT_SUFFIX) ? type.slice(0, -CERT_SUFFIX.length) : type, k = KINDS[base];
    info.kind = k.name; info.short = k.short; info.base = base;
    if (base === "ssh-rsa") {
      const e = r.str(), n = r.str(); info.bits = bitLen(n); info.exponent = asBig(e).toString();
    } else if (base === "ssh-dss") {
      const p = r.str(); r.str(); r.str(); r.str(); info.bits = bitLen(p);
    } else if (base === "ssh-ed25519") {
      const pk = r.str(); if (pk.length !== 32) throw new Error("An Ed25519 public key is 32 bytes; this one is " + pk.length + ".");
      info.bits = 256;
    } else if (base === "sk-ssh-ed25519@openssh.com") {
      const pk = r.str(); if (pk.length !== 32) throw new Error("An Ed25519 public key is 32 bytes; this one is " + pk.length + ".");
      info.bits = 256; info.application = r.text();
    } else {
      const curve = r.text(), pt = r.str(); info.bits = k.bits; info.curve = curve;
      const want = { 256: "nistp256", 384: "nistp384", 521: "nistp521" }[k.bits];
      if (curve !== want) throw new Error("The curve name (" + curve + ") does not match the key type (" + want + ").");
      const len = Math.ceil(k.bits / 8) * 2 + 1;
      if (pt.length !== len || pt[0] !== 4) throw new Error("The public point must be an uncompressed point of " + len + " bytes.");
      if (base.startsWith("sk-")) info.application = r.text();
    }
  }

  const PERMS = {
    "permit-X11-forwarding": "may use X11 forwarding", "permit-agent-forwarding": "may forward the ssh agent", "permit-port-forwarding": "may forward ports", "permit-pty": "may get a terminal", "permit-user-rc": "~/.ssh/rc runs at login", "no-touch-required": "a security key does not need a touch",
  };
  function certFields(r, info) {
    const c = { nonce: hex(r.str()).length / 2 };
    // the public key fields come first (type specific), then the certificate body
    const from = r.pos; keyFields(info.type, r, info);
    const tn = info.type.slice(0, -CERT_SUFFIX.length), tb = new TextEncoder().encode(tn), body = r.slice(from, r.pos);
    info.plain = new Uint8Array(4 + tb.length + body.length); info.plain.set([tb.length >>> 24, tb.length >>> 16 & 255, tb.length >>> 8 & 255, tb.length & 255]); info.plain.set(tb, 4); info.plain.set(body, 4 + tb.length);
    c.serial = r.u64().toString(); const t = r.u32(); c.type = t === 1 ? "user" : t === 2 ? "host" : "unknown (" + t + ")";
    c.keyId = r.text(); const pr = reader(r.str()); c.principals = []; while (pr.left) c.principals.push(pr.text());
    c.validAfter = r.u64(); c.validBefore = r.u64();
    const readOpts = blob => { const o = reader(blob), out = []; while (o.left) { const name = o.text(), data = o.str(); let val = ""; if (data.length) { try { const d = reader(data); val = d.left >= 4 ? d.text() : ""; if (d.left) val = td.decode(data); } catch { val = td.decode(data); } } out.push({ name, value: val }); } return out; };
    c.critical = readOpts(r.str()); c.extensions = readOpts(r.str());
    r.str(); // reserved
    const ca = r.str(); c.caBlob = ca; r.str(); // signature (not checked)
    info.cert = c;
  }
  const dateOf = (secs) => secs === 0xffffffffffffffffn || secs === 0n ? null : new Date(Number(secs) * 1000);

  // fingerprints of the whole key blob
  function fingerprints(blob) {
    const h = H();
    const sha = h.digestSync("SHA-256", blob), md5 = h.md5(blob);
    return { sha256: "SHA256:" + b64encode(sha).replace(/=+$/, ""), md5: "MD5:" + Array.from(md5, x => x.toString(16).padStart(2, "0")).join(":"), digest: sha };
  }
  // the picture ssh-keygen -lv draws (OpenSSH's "drunken bishop"), from the SHA-256 digest
  function randomart(digest, short, bits) {
    const W = 17, Hh = 9, chars = " .o+=*BOX@%&#/^SE", len = chars.length - 1, f = []; for (let i = 0; i < W; i++) f.push(new Array(Hh).fill(0));
    let x = (W / 2) | 0, y = (Hh / 2) | 0;
    for (let i = 0; i < digest.length; i++) { let inp = digest[i]; for (let b = 0; b < 4; b++) { x += inp & 1 ? 1 : -1; y += inp & 2 ? 1 : -1; x = Math.max(0, Math.min(W - 1, x)); y = Math.max(0, Math.min(Hh - 1, y)); if (f[x][y] < len - 2) f[x][y]++; inp >>= 2; } }
    f[(W / 2) | 0][(Hh / 2) | 0] = len - 1; f[x][y] = len;
    const bar = (label) => { const l = label.length >= W ? label.slice(0, W) : label; const left = Math.floor((W - l.length) / 2); return "+" + "-".repeat(left) + l + "-".repeat(W - l.length - left) + "+"; };
    let title = "[" + short + " " + bits + "]"; if (title.length > W) title = "[" + short + "]"; const out = [bar(title)];
    for (let j = 0; j < Hh; j++) { let row = "|"; for (let i = 0; i < W; i++) row += chars[Math.min(f[i][j], len)]; out.push(row + "|"); }
    out.push(bar("[SHA256]"));
    return out.join("\n");
  }

  // decode one key blob (the bytes that are base64 in the file). Throws an Error with a sentence for the reader.
  function parseBlob(blob) {
    const r = reader(blob), type = r.text();
    if (!/^[\x21-\x7e]+$/.test(type)) throw new Error("This is not an SSH key: the data does not start with a key type name.");
    const info = { type, blob, notes: [] };
    if (type.endsWith(CERT_SUFFIX) && KINDS[type.slice(0, -CERT_SUFFIX.length)]) { info.isCert = true; certFields(r, info); }
    else if (KINDS[type]) keyFields(type, r, info);
    else { info.kind = type; info.unknown = true; info.short = type.toUpperCase(); info.bits = 0; return finish(info); }
    return finish(info);
  }
  function finish(info) {
    const fp = fingerprints(info.plain || info.blob); info.sha256 = fp.sha256; info.md5 = fp.md5; info.art = randomart(fp.digest, info.isCert ? info.short + "-CERT" : info.short, info.bits);
    notes(info); return info;
  }
  const OPTION_TEXT = {
    "restrict": "turns off everything below unless it is allowed again (a good default)", "no-pty": "no terminal", "no-port-forwarding": "no port forwarding", "no-agent-forwarding": "no agent forwarding", "no-X11-forwarding": "no X11 forwarding", "no-user-rc": "~/.ssh/rc is not run",
    "pty": "terminal allowed again", "port-forwarding": "port forwarding allowed again", "agent-forwarding": "agent forwarding allowed again", "X11-forwarding": "X11 forwarding allowed again", "user-rc": "~/.ssh/rc allowed again", "cert-authority": "the key is a certificate authority: it signs certificates that are accepted for this account",
    "verify-required": "a security key must check the user (PIN or fingerprint)", "no-touch-required": "a security key does not need a touch", "touch-required": "a security key needs a touch",
  };
  function describeOption(name, val) {
    const n = name.toLowerCase();
    if (n === "command") return "runs only this command, whatever the client asks for: " + val;
    if (n === "from") return "only accepts logins from these addresses or names: " + val;
    if (n === "environment") return "sets an environment variable: " + val;
    if (n === "permitopen") return "port forwarding only to: " + val;
    if (n === "permitlisten") return "remote forwarding only on: " + val;
    if (n === "principals") return "certificate principals accepted: " + val;
    if (n === "expiry-time") return "stops working at " + val;
    if (n === "tunnel") return "tun device number " + val;
    for (const k of Object.keys(OPTION_TEXT)) if (k.toLowerCase() === n) return OPTION_TEXT[k];
    return "option not recognised by this reader";
  }
  function notes(info) {
    const n = info.notes, base = info.base || info.type;
    if (info.unknown) { n.push({ level: "info", text: "Key type \"" + info.type + "\" is not one this reader knows, so only its fingerprint is shown." }); return; }
    if (base === "ssh-rsa") {
      if (info.bits < 2048) n.push({ level: "bad", text: "An RSA key of " + info.bits + " bits is too small. Current OpenSSH refuses keys below 1024 bits and 2048 is the least anyone should still use; make a new key (Ed25519, or RSA 3072 or more)." });
      else if (info.bits < 3072) n.push({ level: "info", text: "An RSA key of " + info.bits + " bits is acceptable today; 3072 bits or more, or an Ed25519 key, is the usual choice for new keys." });
      else n.push({ level: "good", text: "RSA " + info.bits + " bits: a size that is fine today." });
      if (info.exponent !== "65537") n.push({ level: "warn", text: "The RSA public exponent is " + info.exponent + "; nearly every key uses 65537. Check where this key came from." });
      if (info.bits % 8) n.push({ level: "info", text: "The key size is not a whole number of bytes (" + info.bits + " bits); that is allowed but unusual." });
    } else if (base === "ssh-dss") n.push({ level: "bad", text: "DSA keys are limited to 1024 bits and have been switched off in OpenSSH since version 7.0 (removed in 9.8). Replace this key." });
    else if (base === "ssh-ed25519") n.push({ level: "good", text: "Ed25519: small, fast and the usual choice for new keys." });
    else if (base.startsWith("ecdsa")) n.push({ level: "good", text: info.kind + ": fine. Ed25519 is the more common choice today, but nothing is wrong with this key." });
    else if (base.startsWith("sk-")) n.push({ level: "good", text: "The private half of this key lives in a hardware security key (FIDO2). The application name is \"" + info.application + "\"; a login needs the device." });
    if (info.isCert) certNotes(info);
  }
  function certNotes(info) {
    const c = info.cert, n = info.notes, now = Date.now();
    const a = dateOf(c.validAfter), b = dateOf(c.validBefore);
    c.from = a, c.until = b;
    if (b && b.getTime() < now) n.push({ level: "bad", text: "This certificate expired on " + b.toISOString().replace("T", " ").slice(0, 16) + " UTC." });
    else if (a && a.getTime() > now) n.push({ level: "warn", text: "This certificate is not valid yet; it starts on " + a.toISOString().replace("T", " ").slice(0, 16) + " UTC." });
    else n.push({ level: "good", text: "The dates allow use now." });
    if (!b) n.push({ level: "warn", text: "This certificate never expires. Certificates are meant to be short-lived; a lost one cannot be taken back except through a revocation list." });
    else if (a && b.getTime() - a.getTime() > 366 * 86400 * 1000) n.push({ level: "info", text: "It is valid for " + Math.round((b - a) / 86400000) + " days; short validity (hours or days) limits the harm of a lost key." });
    if (!c.principals.length) n.push({ level: "warn", text: c.type === "host" ? "No host names are listed: a host certificate with no principals is accepted for any host name by clients that trust the CA." : "No user names (principals) are listed: such a certificate is accepted for any account the server allows certificates for." });
    n.push({ level: "info", text: "The signature was not checked: that needs the signing authority's key and a server that trusts it." });
  }

  // the fields before the key type: options (authorized_keys) or host names (known_hosts)
  function splitFields(line) {
    const out = []; let cur = "", q = false, had = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === "\\" && q && line[i + 1] === '"') { cur += '"'; i++; had = true; continue; }
      if (ch === '"') { q = !q; cur += ch; had = true; continue; }
      if (!q && (ch === " " || ch === "\t")) { if (had) { out.push(cur); cur = ""; had = false; } continue; }
      cur += ch; had = true;
    }
    if (had) out.push(cur);
    return out;
  }
  function splitOptions(s) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < s.length; i++) { const ch = s[i]; if (ch === "\\" && q && s[i + 1] === '"') { cur += '"'; i++; continue; } if (ch === '"') { q = !q; continue; } if (ch === "," && !q) { out.push(cur); cur = ""; continue; } cur += ch; }
    if (cur) out.push(cur);
    return out.map(o => { const i = o.indexOf("="); return i < 0 ? { name: o, value: "" } : { name: o.slice(0, i), value: o.slice(i + 1) }; });
  }
  const looksLikeOptions = s => /(^|,)(restrict|no-[a-z0-9-]+|cert-authority|command=|from=|environment=|permit[a-z]*=|principals=|expiry-time=|tunnel=|port-forwarding|pty|agent-forwarding|X11-forwarding|user-rc|verify-required|touch-required)/i.test(s);

  function parsePublicLine(line) {
    const f = splitFields(line);
    let i = -1;
    for (let j = 0; j < f.length - 1 && j < 4; j++) if (isTypeName(f[j])) { const b = b64decode(f[j + 1]); if (b && b.length > 4) { try { if (reader(b).text() === f[j]) { i = j; break; } } catch { /* next */ } } }
    if (i < 0) return null;
    const blob = b64decode(f[i + 1]), info = parseBlob(blob);
    const pre = f.slice(0, i);
    for (const p of pre) {
      if (p[0] === "@") info.marker = p;
      else if (looksLikeOptions(p) && !info.options) info.options = splitOptions(p);
      else if (!info.hosts) info.hosts = p.split(",");
    }
    info.comment = f.slice(i + 2).join(" ");
    if (info.options) {
      for (const o of info.options) o.text = describeOption(o.name, o.value);
      const names = info.options.map(o => o.name.toLowerCase());
      if (!names.includes("restrict") && !names.some(x => x === "command" || x === "from")) info.notes.push({ level: "info", text: "No restrictions are set on this line. A line with restrict, a from= list, or command= limits what the key can do." });
      if (names.includes("command") && !names.includes("restrict")) info.notes.push({ level: "info", text: "command= forces one command, but without restrict (or no-pty and the no-… options) the client may still forward ports or agents." });
    }
    if (info.hosts) {
      const hashed = info.hosts.some(h => h.startsWith("|1|"));
      info.notes.push({ level: "info", text: hashed ? "The host names on this known_hosts line are hashed (|1|...), so they cannot be read back." : "known_hosts line for: " + info.hosts.join(", ") + "." });
    }
    if (info.marker === "@cert-authority") info.notes.push({ level: "info", text: "@cert-authority: this key signs host certificates; hosts matching the pattern are trusted if they present one." });
    if (info.marker === "@revoked") info.notes.push({ level: "warn", text: "@revoked: this key is marked as no longer trusted." });
    return info;
  }

  function parseRfc4716(text) {
    const m = /-{4,}\s*BEGIN SSH2 PUBLIC KEY\s*-{4,}([\s\S]*?)-{4,}\s*END SSH2 PUBLIC KEY\s*-{4,}/.exec(text);
    if (!m) return null;
    let comment = ""; const lines = m[1].split(/\r?\n/).map(s => s.trim()).filter(Boolean), body = [];
    for (let k = 0; k < lines.length; k++) {
      if (/^[A-Za-z-]+:/.test(lines[k])) { let v = lines[k]; while (v.endsWith("\\") && k + 1 < lines.length) v = v.slice(0, -1) + lines[++k]; const mm = /^Comment:\s*"?(.*?)"?$/i.exec(v); if (mm) comment = mm[1]; }
      else body.push(lines[k]);
    }
    const blob = b64decode(body.join("")); if (!blob) throw new Error("The base64 text in this file is not valid.");
    const info = parseBlob(blob); info.comment = comment; info.format = "RFC 4716 (ssh-keygen -e)"; return info;
  }

  function parseOpenSshPrivate(text) {
    const m = /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/.exec(text);
    if (!m) return null;
    const b = b64decode(m[1]); const magic = "openssh-key-v1\0";
    if (!b || td.decode(b.subarray(0, magic.length)) !== magic) throw new Error("This is not a readable OpenSSH private key file.");
    const r = reader(b.subarray(magic.length)), cipher = r.text(), kdf = r.text(), kdfopts = r.str(), nkeys = r.u32();
    if (nkeys !== 1) throw new Error("This file holds " + nkeys + " keys; only files with one key are read.");
    const pub = r.str(), info = parseBlob(pub);
    info.private = true; info.cipher = cipher; info.kdf = kdf; info.format = "OpenSSH private key file";
    if (kdf === "bcrypt") { try { const o = reader(kdfopts); o.str(); info.kdfRounds = o.u32(); } catch { /* ignore */ } }
    info.notes.unshift({ level: info.cipher === "none" ? "bad" : "info", text: info.cipher === "none" ? "This private key file is NOT protected by a passphrase: anyone who gets the file can use the key." : "The private key is protected with a passphrase (" + cipher + ", " + kdf + (info.kdfRounds ? ", " + info.kdfRounds + " rounds" : "") + ")." });
    if (info.cipher !== "none" && info.kdfRounds && info.kdfRounds < 16) info.notes.push({ level: "warn", text: "Only " + info.kdfRounds + " key-derivation rounds: guessing the passphrase is quick. ssh-keygen -a 100 -p -f <file> raises it." });
    info.notes.push({ level: "info", text: "Only the public half stored in clear text at the start of the file was read. The private part was not decoded or shown." });
    return info;
  }
  const looksPemPrivate = text => /-----BEGIN (RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/.test(text);

  // text -> { items: [{ line, ...info } | { line, error }], truncated }
  function parse(text) {
    text = String(text == null ? "" : text); const items = [];
    if (text.length > 4e6) return { items: [{ error: "The text is too long (more than 4 MB)." }] };
    const wrap = (fn, line) => { try { const r = fn(); if (r) { r.line = line; items.push(r); return true; } } catch (e) { items.push({ line, error: e.message }); return true; } return false; };
    if (wrap(() => parseOpenSshPrivate(text), 1)) return { items };
    if (looksPemPrivate(text)) return { items: [{ line: 1, pemPrivate: true, error: "This is a private key in PEM format. This reader does not open private keys. Run ssh-keygen -y -f <keyfile> on your own machine to print its public key, and paste that here." }] };
    if (wrap(() => parseRfc4716(text), 1)) return { items };
    const lines = text.split(/\r?\n/); let truncated = false, n = 0;
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i].trim(); if (!L || L[0] === "#") continue;
      if (++n > MAXLINES) { truncated = true; break; }
      if (L.length > MAXLINE) { items.push({ line: i + 1, error: "This line is too long." }); continue; }
      try { const r = parsePublicLine(L); if (r) { r.line = i + 1; items.push(r); } else items.push({ line: i + 1, error: "Not an SSH public key line. Expected: [options] <key type> <base64 key> [comment]." }); }
      catch (e) { items.push({ line: i + 1, error: e.message }); }
    }
    return { items, truncated };
  }

  // the key in the two usual forms
  function authorizedLine(info) { return info.type + " " + b64encode(info.blob) + (info.comment ? " " + info.comment : ""); }
  function rfc4716(info) {
    const b = b64encode(info.blob), out = ["---- BEGIN SSH2 PUBLIC KEY ----"]; if (info.comment) out.push('Comment: "' + info.comment.replace(/"/g, "'") + '"');
    for (let i = 0; i < b.length; i += 70) out.push(b.slice(i, i + 70));
    out.push("---- END SSH2 PUBLIC KEY ----"); return out.join("\n");
  }
  // a fixed-width text report of one key (for Copy and Save)
  function toText(info) {
    const out = [(info.isCert ? "Certificate: " : "Key: ") + info.kind + (info.bits ? " " + info.bits + " bits" : ""), "Type name: " + info.type, "SHA-256: " + info.sha256, "MD5: " + info.md5];
    if (info.comment) out.push("Comment: " + info.comment);
    if (info.isCert) { const c = info.cert; out.push("Certificate type: " + c.type, "Key ID: " + c.keyId, "Serial: " + c.serial, "Principals: " + (c.principals.join(", ") || "(none)"), "Valid from: " + (c.from ? c.from.toISOString() : "forever"), "Valid until: " + (c.until ? c.until.toISOString() : "forever")); }
    for (const n of info.notes) out.push("* " + n.text);
    return out.join("\n");
  }
  function certCaFingerprint(info) { return info.isCert && info.cert.caBlob ? fingerprints(info.cert.caBlob).sha256 : null; }
  function caInfo(info) { try { return info.isCert ? parseBlob(info.cert.caBlob) : null; } catch { return null; } }

  const api = { parse, parseBlob, parsePublicLine, fingerprints, randomart, authorizedLine, rfc4716, toText, certCaFingerprint, caInfo, KINDS, PERMS, b64decode, b64encode };
  if (typeof window !== "undefined") window.SshKey = api;
  if (typeof module !== "undefined") module.exports = api;
})();
