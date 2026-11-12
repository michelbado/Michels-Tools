/* OpenSSL Command Helper: the tasks people do with certificates, written as ready openssl commands with plain-language explanations. Pure data and string building:
   nothing is run, nothing is sent. Every command here is tested against a real openssl (sslcmds-test.js). Exports window.SslCmds.
   TASKS: [{ id, group, title, about, fields: [{ id, label, def, type?: "text" | "check" | "select", options?, hint? }], build(v) -> [{ cmd, note }], explain: [[part, meaning]] }] */
(() => {
  "use strict";
  const g = typeof window !== "undefined" ? window : globalThis;
  // shell-safe quoting of a file name or text typed by the visitor (single quotes unless it is plain)
  const q = s => { s = String(s == null ? "" : s); return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'"; };
  const f = (id, label, def, hint, extra) => ({ id, label, def, hint: hint || "", ...(extra || {}) });
  const chk = (id, label, def, hint) => ({ id, label, def: !!def, type: "check", hint: hint || "" });
  const sel = (id, label, options, def, hint) => ({ id, label, def: def || options[0][0], type: "select", options, hint: hint || "" });
  const inform = v => (v.der ? " -inform DER" : "");

  const GROUPS = ["Look at a file", "Does it match?", "Chain and servers", "Convert", "Create"];
  const TASKS = [
    /* ---------- look ---------- */
    { id: "certview", group: GROUPS[0], title: "Read a certificate", about: "Shows who a certificate is for, who issued it, when it is valid and which names it covers.",
      fields: [f("cert", "Certificate file", "cert.pem"), chk("der", "The file is binary (DER), not text", false)],
      build: v => [{ cmd: `openssl x509 -in ${q(v.cert)}${inform(v)} -noout -text`, note: "everything in the certificate" }, { cmd: `openssl x509 -in ${q(v.cert)}${inform(v)} -noout -subject -issuer -dates -ext subjectAltName`, note: "just the main facts" }],
      explain: [["x509", "work with a certificate"], ["-in file", "the file to read"], ["-inform DER", "the file is binary, not PEM text"], ["-noout", "do not print the certificate text again"], ["-text", "print every field in readable form"], ["-ext subjectAltName", "print the list of names (SAN)"]] },
    { id: "certdates", group: GROUPS[0], title: "When does a certificate expire?", about: "Shows the end date, and tells you whether it is still valid after a number of days.",
      fields: [f("cert", "Certificate file", "cert.pem"), f("days", "Warn if it expires within (days)", "30"), chk("der", "The file is binary (DER)", false)],
      build: v => { const d = Math.max(1, parseInt(v.days, 10) || 30); return [{ cmd: `openssl x509 -in ${q(v.cert)}${inform(v)} -noout -enddate`, note: "the end date" }, { cmd: `openssl x509 -in ${q(v.cert)}${inform(v)} -noout -checkend ${d * 86400} && echo "valid for at least ${d} more days" || echo "expires within ${d} days (or has expired)"`, note: "a yes/no answer you can use in a script" }]; },
      explain: [["-enddate", "print the 'not after' date"], ["-checkend N", "succeed only if the certificate is still valid N seconds from now (N = days x 86400)"]] },
    { id: "certnames", group: GROUPS[0], title: "Which names does a certificate cover?", about: "Lists the host names and IP addresses (Subject Alternative Names) a certificate is valid for.",
      fields: [f("cert", "Certificate file", "cert.pem"), chk("der", "The file is binary (DER)", false)],
      build: v => [{ cmd: `openssl x509 -in ${q(v.cert)}${inform(v)} -noout -ext subjectAltName`, note: "the SAN list" }],
      explain: [["-ext subjectAltName", "print only that extension; browsers use this list and ignore the common name"]] },
    { id: "fingerprint", group: GROUPS[0], title: "Fingerprint of a certificate", about: "A short code that identifies one exact certificate, for comparing with what someone told you.",
      fields: [f("cert", "Certificate file", "cert.pem"), sel("alg", "Hash", [["sha256", "SHA-256 (use this)"], ["sha1", "SHA-1 (old systems)"]]), chk("der", "The file is binary (DER)", false)],
      build: v => [{ cmd: `openssl x509 -in ${q(v.cert)}${inform(v)} -noout -fingerprint -${v.alg === "sha1" ? "sha1" : "sha256"}`, note: "the fingerprint" }],
      explain: [["-fingerprint", "print the hash of the whole certificate"], ["-sha256", "which hash to use"]] },
    { id: "csrview", group: GROUPS[0], title: "Read a certificate request (CSR)", about: "Shows the names and the key in a request, and checks that its signature is right.",
      fields: [f("csr", "Request file", "server.csr")],
      build: v => [{ cmd: `openssl req -in ${q(v.csr)} -noout -text -verify`, note: "shows the request and says \"verify OK\" when its signature is correct" }],
      explain: [["req", "work with a certificate request"], ["-verify", "check the signature on the request"], ["-text", "print every field"]] },
    { id: "keyview", group: GROUPS[0], title: "Check a private key", about: "Tells you the type and size of a key and, for RSA, whether the key is consistent.",
      fields: [f("key", "Key file", "server.key")],
      build: v => [{ cmd: `openssl pkey -in ${q(v.key)} -noout -text`, note: "type, size and values (asks for the password if the key has one)" }, { cmd: `openssl rsa -in ${q(v.key)} -check -noout`, note: "RSA keys only: \"RSA key ok\" means it is consistent" }],
      explain: [["pkey", "works with any private key (RSA, EC, Ed25519)"], ["-check", "test that the numbers of an RSA key fit together"]] },
    { id: "pfxview", group: GROUPS[0], title: "See what is inside a PFX", about: "Lists the certificates in a PFX file and how it is protected, without writing any files.",
      fields: [f("pfx", "PFX file", "server.pfx"), chk("legacy", "It is an old file (opening fails with an \"unsupported\" or RC2 message)", false)],
      build: v => [{ cmd: `openssl pkcs12 -in ${q(v.pfx)} -info -nokeys${v.legacy ? " -legacy" : ""}`, note: "asks for the password; prints the certificates and the encryption used" }],
      explain: [["pkcs12", "work with PFX / PKCS#12 files"], ["-info", "print how the file is protected"], ["-nokeys", "do not print the private key"], ["-legacy", "also allow old algorithms such as RC2 (OpenSSL 3)"]] },
    /* ---------- match ---------- */
    { id: "keycert", group: GROUPS[1], title: "Does the key match the certificate?", about: "Compares the public key inside the certificate with the one that belongs to the private key. The two lines must be identical.",
      fields: [f("cert", "Certificate file", "cert.pem"), f("key", "Private key file", "server.key")],
      build: v => [{ cmd: `openssl x509 -in ${q(v.cert)} -noout -pubkey | openssl sha256`, note: "fingerprint of the certificate's public key" }, { cmd: `openssl pkey -in ${q(v.key)} -pubout | openssl sha256`, note: "fingerprint of the key's public half: the same line means a match" }],
      explain: [["-pubkey", "print the public key of the certificate"], ["-pubout", "print the public half of a private key"], ["| openssl sha256", "turn it into a short fingerprint so you can compare by eye"]] },
    { id: "csrkey", group: GROUPS[1], title: "Does the key match the request (CSR)?", about: "The same test for a certificate request.",
      fields: [f("csr", "Request file", "server.csr"), f("key", "Private key file", "server.key")],
      build: v => [{ cmd: `openssl req -in ${q(v.csr)} -noout -pubkey | openssl sha256`, note: "fingerprint of the request's public key" }, { cmd: `openssl pkey -in ${q(v.key)} -pubout | openssl sha256`, note: "fingerprint of the key: the same line means a match" }],
      explain: [["req -noout -pubkey", "print the public key stored in the request"]] },
    { id: "hostcheck", group: GROUPS[1], title: "Does a certificate cover this host name?", about: "Tests a host name against the names in a certificate (wildcards included).",
      fields: [f("cert", "Certificate file", "cert.pem"), f("host", "Host name", "www.example.com")],
      build: v => [{ cmd: `openssl x509 -in ${q(v.cert)} -noout -checkhost ${q(v.host)}`, note: "prints \"does match certificate\" or \"does NOT match certificate\"" }],
      explain: [["-checkhost name", "compare the name with the certificate's names (SAN, then common name)"]] },
    /* ---------- chain and servers ---------- */
    { id: "chainverify", group: GROUPS[2], title: "Verify a certificate against its chain", about: "Checks that the certificate was issued by the intermediate, which was issued by the root: the same check a client does.",
      fields: [f("cert", "Server certificate", "cert.pem"), f("inter", "Intermediate file(s)", "intermediate.pem", "the CA bundle from your CA, without the root"), f("root", "Root file (leave empty to use your system's trusted roots)", "root.pem")],
      build: v => [{ cmd: `openssl verify ${v.root ? "-CAfile " + q(v.root) + " " : ""}${v.inter ? "-untrusted " + q(v.inter) + " " : ""}${q(v.cert)}`, note: "prints \"OK\" when the chain is complete and every signature is right" }],
      explain: [["verify", "check a certificate chain"], ["-CAfile", "the trusted root(s) to end at"], ["-untrusted", "intermediates to use on the way (not trusted by themselves)"]] },
    { id: "fullchain", group: GROUPS[2], title: "Put a chain file together", about: "Servers want the server certificate first, then the intermediate(s). Joining the files in the right order is all it takes.",
      fields: [f("cert", "Server certificate", "cert.pem"), f("inter", "Intermediate file(s)", "intermediate.pem"), f("out", "New file", "fullchain.pem")],
      build: v => [{ cmd: `cat ${q(v.cert)} ${q(v.inter)} > ${q(v.out)}`, note: "server certificate FIRST, then the intermediate(s)" }, { cmd: `openssl crl2pkcs7 -nocrl -certfile ${q(v.out)} | openssl pkcs7 -print_certs -noout`, note: "lists the certificates in the new file so you can check the order" }],
      explain: [["cat a b > c", "write the contents of a and b, in this order, into c"], ["crl2pkcs7 | pkcs7 -print_certs", "a trick to list every certificate of a PEM file"]] },
    { id: "bundlelist", group: GROUPS[2], title: "List the certificates in a bundle", about: "A .pem or CA-bundle file can hold many certificates. This shows each one.",
      fields: [f("bundle", "Bundle file", "ca-bundle.pem")],
      build: v => [{ cmd: `openssl crl2pkcs7 -nocrl -certfile ${q(v.bundle)} | openssl pkcs7 -print_certs -noout`, note: "subject and issuer of every certificate, in file order" }],
      explain: [["crl2pkcs7 -nocrl -certfile", "wrap the certificates of the file in a PKCS#7 container"], ["pkcs7 -print_certs", "print each certificate in it"]] },
    { id: "bundlesplit", group: GROUPS[2], title: "Split a bundle into separate files", about: "Writes each certificate of a bundle to its own file (cert-00.pem, cert-01.pem, ...).",
      fields: [f("bundle", "Bundle file", "ca-bundle.pem"), f("prefix", "Name start for the new files", "cert-")],
      build: v => [{ cmd: `csplit -z -f ${q(v.prefix)} -b %02d.pem ${q(v.bundle)} '/-----BEGIN CERTIFICATE-----/' '{*}'`, note: "Linux and macOS (GNU csplit)" }],
      explain: [["csplit", "cut a file into pieces at a pattern"], ["-z", "drop empty pieces"], ["-b %02d.pem", "number the pieces 00, 01, ... and add .pem"]] },
    { id: "liveserver", group: GROUPS[2], title: "Look at a server's certificate and chain", about: "Connects from YOUR computer to a server and shows what it sends. (This site never connects anywhere for you.)",
      fields: [f("host", "Host name", "www.example.com"), f("port", "Port", "443")],
      build: v => [{ cmd: `openssl s_client -connect ${q(v.host)}:${q(v.port || "443")} -servername ${q(v.host)} -showcerts </dev/null`, note: "the full chain the server sends, and the verification result at the end" }, { cmd: `openssl s_client -connect ${q(v.host)}:${q(v.port || "443")} -servername ${q(v.host)} </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates`, note: "just the server certificate's main facts" }, { cmd: `openssl s_client -connect ${q(v.host)}:${q(v.port || "443")} -servername ${q(v.host)} -verify_return_error </dev/null 2>&1 | grep -E "Verify return code|verify error"`, note: "\"Verify return code: 0 (ok)\" means your system trusts the chain" }],
      explain: [["s_client", "act as a TLS client"], ["-connect host:port", "where to connect"], ["-servername", "the name to ask for (needed when one address serves many sites)"], ["</dev/null", "do not wait for typing; close when done"]] },
    /* ---------- convert ---------- */
    { id: "pfxout", group: GROUPS[3], title: "PFX to PEM files", about: "Takes the key and certificates out of a PFX file.",
      fields: [f("pfx", "PFX file", "server.pfx"), sel("what", "What do you want?", [["all", "Everything in one PEM file"], ["key", "Only the private key"], ["certs", "Only the certificates (no key)"]]), f("out", "New file", "output.pem"), chk("legacy", "It is an old file (RC2 / 40-bit)", false), chk("plain", "Write the key without a password (only for 'everything' and 'key')", true)],
      build: v => { const w = v.what === "key" ? "-nocerts" : v.what === "certs" ? "-nokeys" : ""; const nodes = v.what !== "certs" && v.plain ? " -nodes" : ""; return [{ cmd: `openssl pkcs12 -in ${q(v.pfx)} ${w ? w + " " : ""}${nodes ? "-nodes " : ""}${v.legacy ? "-legacy " : ""}-out ${q(v.out)}`.replace(/ +/g, " "), note: "asks for the PFX password" + (nodes ? "; the key in the new file is NOT protected" : "") }]; },
      explain: [["-nocerts", "leave the certificates out"], ["-nokeys", "leave the key out"], ["-nodes", "do not protect the key with a new password (\"no DES\"), so the key is written as plain text"], ["-legacy", "allow old algorithms (OpenSSL 3)"]] },
    { id: "pemtopfx", group: GROUPS[3], title: "PEM files to a PFX", about: "Joins the certificate, its key and the chain into one password-protected PFX file.",
      fields: [f("key", "Private key", "server.key"), f("cert", "Server certificate", "cert.pem"), f("chain", "Chain / intermediates (optional)", "intermediate.pem"), f("name", "Friendly name", "www.example.com"), f("out", "New file", "server.pfx"), sel("enc", "Encryption", [["modern", "Modern (AES-256)"], ["compat", "Old-compatible (3DES), for old Windows and Java"]])],
      build: v => [{ cmd: `openssl pkcs12 -export -inkey ${q(v.key)} -in ${q(v.cert)}${v.chain ? " -certfile " + q(v.chain) : ""} -name ${q(v.name)} -out ${q(v.out)}${v.enc === "compat" ? " -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1" : ""}`, note: "asks you to choose a password" }],
      explain: [["-export", "make a PFX"], ["-inkey / -in", "the private key and the server certificate"], ["-certfile", "extra certificates (the chain) to put in the file"], ["-name", "the label shown by Windows and Java"], ["-certpbe / -keypbe / -macalg", "choose the old 3DES / SHA-1 protection that old systems understand"]] },
    { id: "der2pem", group: GROUPS[3], title: "DER (binary) to PEM (text)", about: "Windows .cer files are often binary. Most servers want PEM text.",
      fields: [f("in", "Binary certificate", "cert.cer"), f("out", "New PEM file", "cert.pem")],
      build: v => [{ cmd: `openssl x509 -inform DER -in ${q(v.in)} -out ${q(v.out)}`, note: "certificate" }, { cmd: `openssl pkey -inform DER -in ${q(v.in)} -out ${q(v.out)}`, note: "or, if it is a private key instead" }],
      explain: [["-inform DER", "the input is binary"], ["-out", "PEM text is the default output"]] },
    { id: "pem2der", group: GROUPS[3], title: "PEM (text) to DER (binary)", about: "For software and Windows tools that want a binary .cer file.",
      fields: [f("in", "PEM certificate", "cert.pem"), f("out", "New binary file", "cert.cer")],
      build: v => [{ cmd: `openssl x509 -in ${q(v.in)} -outform DER -out ${q(v.out)}`, note: "certificate" }],
      explain: [["-outform DER", "write binary instead of PEM text"]] },
    { id: "p7b2pem", group: GROUPS[3], title: "P7B to PEM", about: "A .p7b file holds certificates (no key). This writes them as PEM.",
      fields: [f("in", "P7B file", "bundle.p7b"), f("out", "New PEM file", "certs.pem"), chk("der", "The file is binary (DER)", false)],
      build: v => [{ cmd: `openssl pkcs7${v.der ? " -inform DER" : ""} -in ${q(v.in)} -print_certs -out ${q(v.out)}`, note: "all certificates of the P7B" }],
      explain: [["pkcs7 -print_certs", "write out the certificates inside"]] },
    { id: "keyformat", group: GROUPS[3], title: "Change the format of a private key", about: "Old software wants \"BEGIN RSA PRIVATE KEY\"; newer software uses \"BEGIN PRIVATE KEY\".",
      fields: [f("in", "Key file", "server.key"), sel("to", "Make it", [["pkcs8", "PKCS#8 (\"BEGIN PRIVATE KEY\", modern)"], ["rsa", "Traditional RSA (\"BEGIN RSA PRIVATE KEY\")"], ["ec", "Traditional EC (\"BEGIN EC PRIVATE KEY\")"]]), f("out", "New file", "server-new.key")],
      build: v => [{ cmd: v.to === "rsa" ? `openssl rsa -in ${q(v.in)} -traditional -out ${q(v.out)}` : v.to === "ec" ? `openssl ec -in ${q(v.in)} -traditional -out ${q(v.out)}` : `openssl pkcs8 -topk8 -nocrypt -in ${q(v.in)} -out ${q(v.out)}`, note: "the key keeps its password only if you add one" }],
      explain: [["-traditional", "the old format that starts with BEGIN RSA / EC PRIVATE KEY"], ["pkcs8 -topk8 -nocrypt", "the modern format, without a password"]] },
    { id: "keyunprotect", group: GROUPS[3], title: "Remove the password from a key", about: "Lets a server start without anyone typing the key's password. The new file is not protected: keep it private.",
      fields: [f("in", "Protected key", "server-encrypted.key"), f("out", "New key file", "server.key")],
      build: v => [{ cmd: `openssl pkey -in ${q(v.in)} -out ${q(v.out)}`, note: "asks for the old password once" }, { cmd: `chmod 600 ${q(v.out)}`, note: "only your own account may read the new file" }],
      explain: [["pkey -in -out", "read the key (asking for its password) and write it back without one"]] },
    { id: "keyprotect", group: GROUPS[3], title: "Add a password to a key", about: "Protects a key file so that it is useless without the password.",
      fields: [f("in", "Key file", "server.key"), f("out", "New protected file", "server-encrypted.key")],
      build: v => [{ cmd: `openssl pkcs8 -topk8 -v2 aes-256-cbc -v2prf hmacWithSHA256 -in ${q(v.in)} -out ${q(v.out)}`, note: "asks you to choose a password" }],
      explain: [["-topk8", "write the key as PKCS#8"], ["-v2 aes-256-cbc", "protect it with AES-256"], ["-v2prf hmacWithSHA256", "derive the encryption key with SHA-256"]] },
    /* ---------- create ---------- */
    { id: "newkeycsr", group: GROUPS[4], title: "New key and certificate request (CSR)", about: "Makes a private key and the request you send to a certificate authority.",
      fields: [f("cn", "Main host name (common name)", "www.example.com"), f("names", "All names, separated by commas", "www.example.com,example.com"), sel("type", "Key type", [["ec", "EC P-256 (modern)"], ["rsa", "RSA 2048 (works everywhere)"]]), f("c", "Country code (optional)", ""), f("o", "Organization (optional)", ""), f("key", "Key file to write", "server.key"), f("csr", "Request file to write", "server.csr")],
      build: v => { const names = String(v.names || v.cn).split(",").map(s => s.trim()).filter(Boolean).map(n => (/^[0-9.]+$|:/.test(n) ? "IP:" : "DNS:") + n).join(","); const subj = (v.c ? "/C=" + v.c : "") + (v.o ? "/O=" + v.o : "") + "/CN=" + v.cn; return [{ cmd: `openssl req -new -newkey ${v.type === "rsa" ? "rsa:2048" : "ec -pkeyopt ec_paramgen_curve:prime256v1"} -nodes -keyout ${q(v.key)} -out ${q(v.csr)} -subj ${q(subj)} -addext ${q("subjectAltName=" + names)}`, note: "makes the key (not password protected) and the request" }]; },
      explain: [["req -new", "make a certificate request"], ["-newkey", "also make a new private key of this type"], ["-nodes", "do not password-protect the new key"], ["-subj", "the name fields of the request"], ["-addext subjectAltName=...", "the list of names (SAN) browsers check"]] },
    { id: "csrkeep", group: GROUPS[4], title: "New request (CSR) for a key you already have", about: "Use this to renew a certificate with the same key.",
      fields: [f("key", "Existing key", "server.key"), f("cn", "Main host name (common name)", "www.example.com"), f("names", "All names, separated by commas", "www.example.com,example.com"), f("csr", "Request file to write", "server.csr")],
      build: v => { const names = String(v.names || v.cn).split(",").map(s => s.trim()).filter(Boolean).map(n => (/^[0-9.]+$|:/.test(n) ? "IP:" : "DNS:") + n).join(","); return [{ cmd: `openssl req -new -key ${q(v.key)} -out ${q(v.csr)} -subj ${q("/CN=" + v.cn)} -addext ${q("subjectAltName=" + names)}`, note: "the key is only read, never changed" }]; },
      explain: [["-key", "sign the request with this existing key"]] },
    { id: "selfsigned", group: GROUPS[4], title: "Self-signed certificate (for tests)", about: "A certificate that signs itself. Browsers will warn unless you install it as trusted.",
      fields: [f("cn", "Host name", "localhost"), f("days", "Valid for (days)", "365"), f("key", "Key file to write", "self.key"), f("cert", "Certificate file to write", "self.crt")],
      build: v => [{ cmd: `openssl req -x509 -newkey rsa:2048 -nodes -keyout ${q(v.key)} -out ${q(v.cert)} -days ${Math.max(1, parseInt(v.days, 10) || 365)} -subj ${q("/CN=" + v.cn)} -addext ${q("subjectAltName=" + (/^[0-9.]+$|:/.test(v.cn) ? "IP:" : "DNS:") + v.cn)}`, note: "one step: new key and a certificate signed by that key" }],
      explain: [["-x509", "make a certificate directly instead of a request"], ["-days", "how long it stays valid"]] },
    { id: "newkey", group: GROUPS[4], title: "New private key only", about: "Makes a key and nothing else.",
      fields: [sel("type", "Key type", [["ec", "EC P-256 (modern)"], ["ec384", "EC P-384"], ["rsa2048", "RSA 2048"], ["rsa4096", "RSA 4096 (slower)"]]), f("out", "Key file to write", "server.key")],
      build: v => [{ cmd: v.type === "ec" ? `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out ${q(v.out)}` : v.type === "ec384" ? `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-384 -out ${q(v.out)}` : `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:${v.type === "rsa4096" ? 4096 : 2048} -out ${q(v.out)}`, note: "the key is not password protected" }, { cmd: `chmod 600 ${q(v.out)}`, note: "only your own account may read it" }],
      explain: [["genpkey", "generate a private key"], ["-algorithm", "the type of key"]] },
  ];

  const byId = Object.fromEntries(TASKS.map(t => [t.id, t]));
  const defaults = id => Object.fromEntries(byId[id].fields.map(x => [x.id, x.def]));
  // the commands of a task for the given values (missing values fall back to the task's defaults)
  const build = (id, values) => byId[id].build({ ...defaults(id), ...(values || {}) });

  g.SslCmds = { TASKS, GROUPS, byId, defaults, build, q };
  if (typeof module !== "undefined") module.exports = g.SslCmds;
})();
