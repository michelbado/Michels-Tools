/* Certificate Converter logic: from a checked package (server certificate, intermediates, root, key) it makes the files you ask for: PEM files in the right order,
   a PFX with or without a password, the key in another format, DER, P7B, or a ready set of files for Apache, nginx, HAProxy, IIS or Tomcat. Every result comes with the
   openssl command that does the same thing. Pure logic: returns file contents, touches no page, no storage, no network. Exports window.CertConv. Tested with openssl (certconv-test.js). */
(() => {
  "use strict";
  const g = typeof window !== "undefined" ? window : globalThis;
  const D = () => g.DerKit, KF = () => g.KeyFmt, P12 = () => g.Pkcs12;
  const enc = s => new TextEncoder().encode(s);
  const pem = der => D().pemOut("CERTIFICATE", der);
  const safe = s => (String(s || "server").toLowerCase().replace(/^\*\./, "wildcard.").replace(/[^a-z0-9.-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "") || "server").slice(0, 60);
  const q = s => /^[A-Za-z0-9_./-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'";

  // a PKCS#7 (.p7b) holding only certificates
  function p7b(ders) {
    const d = D();
    return d.seq(d.oid("1.2.840.113549.1.7.2"), d.ctx(0, d.seq(d.int(1), d.set(), d.seq(d.oid("1.2.840.113549.1.7.1")), d.ctx(0, ...ders), d.set())));
  }
  const chainOf = (arr, withRoot) => [...arr.intermediates, ...(withRoot && arr.root ? [arr.root] : [])];

  // spec: { kind, base?, includeRoot?, password?, flavour?, keyFormat?, preset? }; returns { files: [{ name, bytes, text?, note }], commands: [string], notes: [string] } or { error }
  async function plan(arr, spec) {
    const d = D(), out = { files: [], commands: [], notes: [] };
    const leaf = arr.leaf, key = arr.key ? arr.key.key : null, base = safe(spec.base || (leaf && (leaf.cn || "server")));
    const add = (name, content, note) => out.files.push(typeof content === "string" ? { name, bytes: enc(content), text: content, note } : { name, bytes: content, note });
    const needLeaf = () => (leaf ? null : { error: "No server certificate was found in the package. Add the certificate first." });
    const needKey = () => (key ? null : { error: "No private key matching the server certificate was found. Add the key (or a PFX that holds it) first." });
    const certPem = pem(leaf ? leaf.der : new Uint8Array(0));
    const chainPems = (root) => chainOf(arr, root).map(c => pem(c.der)).join("");
    switch (spec.kind) {
      case "pem-cert": { const e = needLeaf(); if (e) return e; add(base + ".crt", certPem, "the server certificate only"); out.commands.push("openssl x509 -in input.crt -out " + q(base + ".crt") + "     # PEM output (add -inform DER if the input is binary)"); break; }
      case "pem-fullchain": {
        const e = needLeaf(); if (e) return e;
        add(base + "-fullchain.pem", certPem + chainPems(spec.includeRoot), "server certificate first, then the intermediates" + (spec.includeRoot ? ", then the root" : ""));
        out.commands.push("cat " + q(base + ".crt") + " intermediate.crt" + (spec.includeRoot ? " root.crt" : "") + " > " + q(base + "-fullchain.pem") + "     # server certificate FIRST");
        if (!arr.intermediates.length) out.notes.push("No intermediate certificate was found, so this file holds the server certificate only. Add the intermediates to the package for a complete chain.");
        break;
      }
      case "pem-chain": {
        const list = chainOf(arr, spec.includeRoot !== false); if (!list.length) return { error: "No intermediate or root certificates were found in the package." };
        add(base + "-ca-bundle.pem", list.map(c => pem(c.der)).join(""), "the CA certificates, closest to the server first");
        out.commands.push("cat intermediate.crt" + (arr.root && spec.includeRoot !== false ? " root.crt" : "") + " > " + q(base + "-ca-bundle.pem"));
        break;
      }
      case "pem-all": {
        const e = needLeaf() || needKey(); if (e) return e;
        add(base + "-combined.pem", certPem + chainPems(spec.includeRoot) + (await KF().exportKey(key, "pkcs8")).text, "certificate, chain and PRIVATE KEY in one file (HAProxy style)");
        out.commands.push("cat " + q(base + ".crt") + " intermediate.crt " + q(base + ".key") + " > " + q(base + "-combined.pem"));
        out.notes.push("This file contains the private key. Keep it private and give it restrictive permissions (chmod 600).");
        break;
      }
      case "pfx": {
        const e = needLeaf(); if (e) return e;
        if (!key && !spec.allowNoKey) return needKey();
        const pw = spec.password || "", flavour = spec.flavour === "compat" ? "compat" : "modern";
        const bytes = await P12().build({ certs: [leaf.der, ...chainOf(arr, spec.includeRoot).map(c => c.der)], key: key ? KF().toPkcs8(key) : null, password: pw, flavour, name: spec.friendlyName || (leaf.cn || "") });
        add(base + ".pfx", bytes, pw ? (flavour === "compat" ? "PFX with a password, old-compatible encryption (3DES / SHA-1) for old Windows and Java" : "PFX with a password, modern encryption (AES-256 / SHA-256)") : "PFX with NO password: the key inside is not protected");
        out.commands.push("openssl pkcs12 -export -inkey " + q(base + ".key") + " -in " + q(base + ".crt") + " -certfile chain.pem -name " + q(leaf.cn || base) + " -out " + q(base + ".pfx") + (pw ? "     # asks for a password" : " -passout pass: -keypbe NONE -certpbe NONE -nomac") + (flavour === "compat" && pw ? " -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1" : ""));
        if (!pw) out.notes.push("No password: anyone who gets this file can use the private key. Some systems (for example Windows) accept it, others insist on a password.");
        break;
      }
      case "key": {
        const e = needKey(); if (e) return e;
        const fmt = spec.keyFormat || "pkcs8", pw = spec.password || "";
        if ((fmt === "pkcs8-encrypted" || fmt === "pkcs8-encrypted-3des") && !pw) return { error: "Type a password to protect the key with." };
        let r; try { r = await KF().exportKey(key, fmt, pw); } catch (er) { return { error: er.message }; }
        add(base + (fmt === "der" ? ".key.der" : fmt.startsWith("pkcs8-encrypted") ? "-encrypted.key" : ".key"), r.text != null ? r.text : r.bytes, { pkcs8: "private key in PKCS#8 format (\"BEGIN PRIVATE KEY\")", der: "private key in binary (DER) PKCS#8 format", traditional: "private key in the traditional format (" + (key.type === "rsa" ? "BEGIN RSA PRIVATE KEY" : "BEGIN EC PRIVATE KEY") + ")", "pkcs8-encrypted": "private key protected with a password (AES-256)", "pkcs8-encrypted-3des": "private key protected with a password, old 3DES scheme" }[fmt]);
        out.commands.push({ pkcs8: "openssl pkey -in key.pem -out " + q(base + ".key"), der: "openssl pkey -in key.pem -outform DER -out " + q(base + ".key.der"), traditional: "openssl " + (key.type === "rsa" ? "rsa" : "ec") + " -in key.pem -traditional -out " + q(base + ".key"), "pkcs8-encrypted": "openssl pkcs8 -topk8 -in key.pem -v2 aes-256-cbc -out " + q(base + "-encrypted.key"), "pkcs8-encrypted-3des": "openssl pkcs8 -topk8 -in key.pem -v1 PBE-SHA1-3DES -out " + q(base + "-encrypted.key") }[fmt]);
        if (fmt === "pkcs8" || fmt === "traditional" || fmt === "der") out.notes.push("This key file is not password protected. Keep it private.");
        break;
      }
      case "der-cert": { const e = needLeaf(); if (e) return e; add(base + ".cer", leaf.der, "the server certificate in binary (DER) form, as Windows likes it"); out.commands.push("openssl x509 -in " + q(base + ".crt") + " -outform DER -out " + q(base + ".cer")); break; }
      case "p7b": {
        const e = needLeaf(); if (e) return e; const list = [leaf, ...chainOf(arr, spec.includeRoot)];
        add(base + ".p7b", D().pemOut("PKCS7", p7b(list.map(c => c.der))), "certificates only (no key), PEM text form of a .p7b");
        out.commands.push("openssl crl2pkcs7 -nocrl -certfile " + q(base + "-fullchain.pem") + " -out " + q(base + ".p7b"));
        break;
      }
      case "server": {
        const e = needLeaf(); if (e) return e;
        const p = spec.preset, withKey = p !== "none";
        const full = certPem + chainPems(spec.includeRoot);
        if (["apache", "nginx", "haproxy", "pem-set"].includes(p)) { const e2 = needKey(); if (e2) return e2; }
        const keyPem = key ? (await KF().exportKey(key, "pkcs8")).text : "";
        if (p === "nginx") {
          add(base + "-fullchain.pem", full, "ssl_certificate"); add(base + ".key", keyPem, "ssl_certificate_key (keep private)");
          out.notes.push("nginx:\n  ssl_certificate     /etc/ssl/" + base + "-fullchain.pem;\n  ssl_certificate_key /etc/ssl/" + base + ".key;");
          out.commands.push("cat " + q(base + ".crt") + " intermediate.crt > " + q(base + "-fullchain.pem"));
        } else if (p === "apache") {
          add(base + ".crt", certPem, "SSLCertificateFile"); add(base + "-chain.pem", chainPems(spec.includeRoot), "SSLCertificateChainFile (or SSLCACertificateFile)"); add(base + ".key", keyPem, "SSLCertificateKeyFile (keep private)");
          out.notes.push("Apache:\n  SSLCertificateFile    /etc/ssl/" + base + ".crt\n  SSLCertificateKeyFile /etc/ssl/" + base + ".key\n  SSLCertificateChainFile /etc/ssl/" + base + "-chain.pem     (Apache 2.4.8 and newer: put the chain into SSLCertificateFile instead)");
        } else if (p === "haproxy") {
          add(base + ".pem", full + keyPem, "crt (certificate, chain and key in one file; keep private)");
          out.notes.push("HAProxy:\n  bind :443 ssl crt /etc/haproxy/certs/" + base + ".pem");
          out.commands.push("cat " + q(base + ".crt") + " intermediate.crt " + q(base + ".key") + " > " + q(base + ".pem"));
        } else if (p === "iis" || p === "tomcat") {
          const pw = spec.password || ""; if (!pw && !spec.allowNoPassword) return { error: "Type a password for the PFX file." };
          const bytes = await P12().build({ certs: [leaf.der, ...chainOf(arr, spec.includeRoot).map(c => c.der)], key: KF().toPkcs8(key), password: pw, flavour: spec.flavour === "compat" ? "compat" : "modern", name: leaf.cn || "" });
          add(base + ".pfx", bytes, p === "iis" ? "import into Windows (certlm.msc or IIS Manager)" : "keystore of type PKCS12");
          out.notes.push(p === "iis" ? "IIS / Windows: open certlm.msc, right-click Personal, All Tasks, Import, choose the .pfx and type its password. Old Windows versions (before Windows 10 / Server 2016) may need the old-compatible encryption." : "Tomcat (server.xml connector):\n  keystoreFile=\"conf/" + base + ".pfx\" keystoreType=\"PKCS12\" keystorePass=\"(the PFX password)\"\nJava 8 and older may need the old-compatible encryption.");
        } else return { error: "Choose a server type." };
        void withKey;
        break;
      }
      default: return { error: "Choose what you want to make." };
    }
    return out;
  }

  g.CertConv = { plan, p7b, safe };
  if (typeof module !== "undefined") module.exports = g.CertConv;
})();
