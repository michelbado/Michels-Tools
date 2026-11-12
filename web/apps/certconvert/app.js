/* Certificate Converter: PEM, DER, PFX, P7B, keys and ready-made server files from a package you give it. Logic is in lib/certconv.js (checked with openssl);
   the input box is lib/certui.js. Everything stays in this browser tab; files are made here and downloaded from here. Text reaches the page through textContent only. */
(window.DesktopApps = window.DesktopApps || {}).certconvert = (() => {
  const HINTS = {
    pfx: "A PFX (.pfx / .p12) holds the certificate, its chain and the private key in one password-protected file. Windows, IIS, Java and many appliances import it.",
    "pem-fullchain": "nginx and many other servers want the server certificate first, then the intermediates, in one file.",
    "pem-chain": "The CA certificates in the order a server expects (closest to the server first).",
    "pem-cert": "Just the server certificate in PEM text form.",
    "pem-all": "One file with the certificate, the chain and the private key. HAProxy and some appliances use this. The file contains the key: keep it private.",
    key: "Change how the private key is stored: add or remove a password, or switch between the modern and the traditional format.",
    "der-cert": "The same certificate as a binary file. Windows opens .cer files.",
    p7b: "A .p7b file holds certificates (no key). Some Windows and Java tools use it.",
    server: "Pick the server and get the files it needs, plus the lines for its configuration.",
  };
  function init(root) {
    const $ = id => root.querySelector("#certconvert-" + id), setStatus = m => { $("status").textContent = m; };
    const TK = window.TK, CK = window.CertKit, CC = window.CertConv, KF = window.KeyFmt, P12 = window.Pkcs12;
    let softDone = false, seq = 0, made = [];
    const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
    const kb = n => n < 1024 ? n + " bytes" : (n / 1024).toFixed(1) + " KB";
    function ensureSoft() { if (softDone) return; softDone = true; if (!(window.crypto && window.crypto.subtle) && window.SoftCrypto) window.SoftCrypto.install(window.pkijs); }

    const needsPw = () => { const k = $("kind").value; return k === "pfx" || (k === "key" && /encrypted/.test($("keyfmt").value)) || (k === "server" && /iis|tomcat/.test($("preset").value)); };
    function layout() {
      const k = $("kind").value;
      $("presetbox").hidden = k !== "server"; $("keyfmtbox").hidden = k !== "key";
      $("flavourbox").hidden = !(k === "pfx" || (k === "server" && /iis|tomcat/.test($("preset").value)));
      $("pwbox").hidden = !needsPw();
      $("nopwbox").hidden = !(k === "pfx" || k === "server");
      $("rootbox").hidden = ["key", "der-cert", "pem-cert"].includes(k);
      if (k === "pem-chain" && !$("root").dataset.touched) $("root").checked = true;
      if (k !== "pem-chain" && !$("root").dataset.touched) $("root").checked = false;
      $("hint").textContent = HINTS[k] || "";
      const np = $("nopw").checked && !$("nopwbox").hidden; $("pw").disabled = $("pw2").disabled = np;
    }
    async function arrangement() {
      ensureSoft();
      const a = await CK.analyze(panel.items(), {});
      return a;
    }
    function summary(a) {
      const p = $("pkg"); p.textContent = "";
      if (!panel.items().length) return;
      const bits = [];
      if (a.arrangement.leaf) bits.push("server certificate: " + (a.arrangement.leaf.cn || a.arrangement.leaf.subject));
      bits.push(a.arrangement.intermediates.length + " intermediate" + (a.arrangement.intermediates.length === 1 ? "" : "s"));
      bits.push(a.arrangement.root ? "root included" : "no root");
      bits.push(a.arrangement.key ? "private key found" + (a.leaf ? " (matches the certificate)" : "") : a.keys.length ? "a key was found but it does not match the certificate" : "no private key");
      p.textContent = "Found: " + bits.join("; ") + ".";
    }
    async function onPackage() { const a = await arrangement(); summary(a); clearResult(); }
    function clearResult() { made.length = 0; $("result").textContent = ""; }

    /* making */
    function download(name, bytes, type) {
      const blob = new Blob([bytes], { type: type || "application/octet-stream" }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
    async function selfCheck(spec, plan, a, pw) {
      const out = [], key = a.arrangement.key ? a.arrangement.key.key : null, same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
      try {
        for (const f of plan.files) {
          if (/\.pfx$/.test(f.name)) {
            const r = await P12.parse(f.bytes, pw || ""); const okKey = r.status === "ok" && r.keys.length && key && r.keys[0].key && same(r.keys[0].key.spki, key.spki);
            out.push({ level: r.status === "ok" && (!key || okKey) ? "good" : "bad", text: r.status === "ok" ? "Self-check: " + f.name + " was opened again" + (pw ? " with the password" : "") + ": " + r.certs.length + " certificate" + (r.certs.length === 1 ? "" : "s") + (key ? (okKey ? ", and the key matches the certificate." : ", but the key does NOT match.") : ".") : "Self-check FAILED: the new file could not be read back." });
          } else if (/\.key(\.der)?$/.test(f.name) && key) {
            const r = await KF.readKey(f.text != null ? f.text : f.bytes, pw || ""); const okK = r.status === "ok" && same(r.key.spki, key.spki);
            out.push({ level: okK ? "good" : "bad", text: okK ? "Self-check: " + f.name + " was read again and it is the same key." : "Self-check FAILED: the new key file does not read back as the same key." });
          } else if (/\.(pem|crt)$/.test(f.name) && f.text && /BEGIN CERTIFICATE/.test(f.text) && a.arrangement.leaf) {
            const c = await CK.classify([{ name: f.name, bytes: f.bytes }]), certs = c.items.filter(i => i.kind === "cert");
            const first = certs[0] && certs[0].sha256 === a.arrangement.leaf.sha256;
            out.push({ level: certs.length ? "good" : "bad", text: "Self-check: " + f.name + " was read again: " + certs.length + " certificate" + (certs.length === 1 ? "" : "s") + (/fullchain|combined|\.pem$/.test(f.name) && !/ca-bundle|chain\.pem$/.test(f.name) ? (first ? ", the server certificate first." : ".") : ".") });
          }
        }
      } catch { out.push({ level: "bad", text: "Self-check could not run." }); }
      return out;
    }
    function showResult(plan, checks) {
      const box = $("result"); box.textContent = "";
      if (plan.error) { const ul = el("ul", "tk-notes"); ul.append(el("li", "bad", plan.error)); box.append(ul); if (box.scrollIntoView) box.scrollIntoView({ block: "start" }); return; }
      const fs = el("fieldset"), lg = el("legend", null, "Your files"); fs.append(lg);
      for (const c of checks) { const ul = el("ul", "tk-notes"); ul.append(el("li", c.level, c.text)); fs.append(ul); }
      for (const f of plan.files) {
        const card = el("div", "ct-file"), head = el("div", "ct-file-head"); head.append(el("strong", null, f.name), el("span", "tk-muted", "  " + kb(f.bytes.length) + (f.note ? " - " + f.note : "")));
        const row = el("div", "tk-row"), dl = el("button", "xp-btn"); dl.type = "button"; dl.textContent = "Download"; dl.addEventListener("click", () => download(f.name, f.bytes));
        row.append(dl);
        if (f.text != null) {
          const cp = el("button", "xp-btn"); cp.type = "button"; cp.textContent = "Copy"; cp.addEventListener("click", () => TK.copy(f.text, setStatus)); row.append(cp);
          const secret = /PRIVATE KEY/.test(f.text), tg = el("button", "xp-btn"); tg.type = "button"; tg.textContent = secret ? "Show (contains a private key)" : "Show text";
          const pre = el("textarea", "xp-text tk-in"); pre.readOnly = true; pre.rows = Math.min(14, f.text.split("\n").length + 1); pre.value = f.text; pre.hidden = true; pre.spellcheck = false;
          tg.addEventListener("click", () => { pre.hidden = !pre.hidden; tg.textContent = pre.hidden ? (secret ? "Show (contains a private key)" : "Show text") : "Hide"; });
          row.append(tg); card.append(head, row, pre);
        } else card.append(head, row);
        fs.append(card);
      }
      if (plan.files.length > 1 && window.fflate) {
        const z = el("button", "xp-btn"); z.type = "button"; z.textContent = "Download all as a ZIP";
        z.addEventListener("click", () => { const o = {}; for (const f of plan.files) o[f.name] = f.bytes; download("certificate-files.zip", window.fflate.zipSync(o), "application/zip"); });
        const r = el("div", "tk-row"); r.append(z); fs.append(r);
      }
      for (const n of plan.notes) { fs.append(el("pre", "ct-pre", n)); }
      if (plan.commands.length) {
        const h = el("h3", null, "The same thing with openssl"); fs.append(h);
        for (const c of plan.commands) { const r = el("div", "ct-cmd"); const code = el("code", null, c); const cp = el("button", "xp-btn small"); cp.type = "button"; cp.textContent = "Copy"; cp.addEventListener("click", () => TK.copy(c, setStatus)); r.append(code, cp); fs.append(r); }
      }
      box.append(fs);
      if (box.scrollIntoView) box.scrollIntoView({ block: "start" });
    }
    async function make() {
      const my = ++seq; setStatus("Working...");
      const a = await arrangement(), kind = $("kind").value, spec = { kind, includeRoot: $("root").checked && !$("rootbox").hidden };
      if (kind === "server") spec.preset = $("preset").value;
      if (kind === "key") spec.keyFormat = $("keyfmt").value;
      if (!$("flavourbox").hidden) spec.flavour = $("flavour").value;
      let pw = "";
      if (needsPw() && !(($("nopw").checked) && !$("nopwbox").hidden)) {
        pw = $("pw").value;
        if (!pw) { showResult({ error: "Type a password first (or tick \"No password\")." }, []); setStatus("Ready"); return; }
        if (pw !== $("pw2").value) { showResult({ error: "The two passwords are not the same." }, []); setStatus("Ready"); return; }
      } else if (needsPw() && $("nopw").checked) { spec.allowNoPassword = true; }
      spec.password = pw;
      if (a.leaf && a.keys.length && !a.arrangement.key && /pfx|pem-all|key|server/.test(kind) && kind !== "pem-chain") { showResult({ error: "The private key you added does not belong to the server certificate, so this would make a broken file. Add the key that matches it (the Package Checker shows which one does)." }, []); setStatus("Ready"); return; }
      const plan = await CC.plan(a.arrangement, spec);
      if (my !== seq) return;
      const checks = plan.error ? [] : await selfCheck(spec, plan, a, pw);
      if (my !== seq) return;
      made = plan.files || [];
      showResult(plan, checks);
      setStatus(plan.error ? "Nothing made." : "Done: " + plan.files.length + " file" + (plan.files.length === 1 ? "" : "s") + ".");
    }
    const panel = window.CertUI.panel($("panel"), { id: "certconvert", onChange: onPackage });
    for (const id of ["kind", "preset", "keyfmt", "nopw"]) $(id).addEventListener("change", () => { layout(); clearResult(); });
    $("root").addEventListener("change", () => { $("root").dataset.touched = "1"; });
    $("show").addEventListener("change", () => { $("pw").type = $("pw2").type = $("show").checked ? "text" : "password"; });
    $("make").addEventListener("click", make);
    layout();
    return { destroy() { panel.destroy(); made.length = 0; seq++; $("pw").value = $("pw2").value = ""; } };
  }
  return { init };
})();
