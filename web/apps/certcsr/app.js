/* CSR and Key Generator: a new key and a certificate request, made in this browser tab with the browser's own crypto (lib/certgen.js, checked with openssl).
   Nothing is sent anywhere. Text reaches the page through textContent only. */
(window.DesktopApps = window.DesktopApps || {}).certcsr = (() => {
  function init(root) {
    const $ = id => root.querySelector("#certcsr-" + id), setStatus = m => { $("status").textContent = m; };
    const TK = window.TK, CG = window.CertGen, KF = window.KeyFmt;
    let seq = 0, kept = null;
    const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
    for (const [k, t] of Object.entries(CG.TYPES)) { const o = el("option", null, t.label); o.value = k; $("type").append(o); }
    $("type").value = "ec256";
    const hasCrypto = !!(window.crypto && window.crypto.subtle);
    if (!hasCrypto) { $("make").disabled = true; $("warn").textContent = "This tool needs the browser's crypto, which is only available on https pages (or localhost). Open it from the https address of this site."; }
    const togglePw = () => { const on = $("protect").checked; $("pw").disabled = $("pw2").disabled = $("scheme").disabled = !on; };

    function card(name, text, note, secret, type) {
      const c = el("div", "ct-file"), head = el("div", "ct-file-head"); head.append(el("strong", null, name), el("span", "tk-muted", "  " + note));
      const row = el("div", "tk-row"), dl = el("button", "xp-btn"); dl.type = "button"; dl.textContent = "Download";
      dl.addEventListener("click", () => { const blob = new Blob([text], { type: type || "text/plain" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); });
      const cp = el("button", "xp-btn"); cp.type = "button"; cp.textContent = "Copy"; cp.addEventListener("click", () => TK.copy(text, setStatus));
      const tg = el("button", "xp-btn"); tg.type = "button"; tg.textContent = secret ? "Show (private key)" : "Show text";
      const pre = el("textarea", "xp-text tk-in"); pre.readOnly = true; pre.rows = Math.min(14, text.split("\n").length + 1); pre.value = text; pre.hidden = true; pre.spellcheck = false;
      tg.addEventListener("click", () => { pre.hidden = !pre.hidden; tg.textContent = pre.hidden ? (secret ? "Show (private key)" : "Show text") : "Hide"; });
      row.append(dl, cp, tg); c.append(head, row, pre); return c;
    }
    async function make() {
      const my = ++seq, box = $("result"); box.textContent = "";
      const subject = { CN: $("cn").value.trim(), O: $("o").value.trim(), OU: $("ou").value.trim(), L: $("l").value.trim(), ST: $("st").value.trim(), C: $("c").value.trim() };
      const names = $("names").value.split(/\r?\n/).map(s => s.trim()).filter(Boolean), protect = $("protect").checked, pw = protect ? $("pw").value : "";
      const fail = msg => { const ul = el("ul", "tk-notes"); ul.append(el("li", "bad", msg)); box.append(ul); if (box.scrollIntoView) box.scrollIntoView({ block: "nearest" }); setStatus("Not made."); };
      if (protect && !pw) return fail("Type a password for the key, or untick the box.");
      if (protect && pw !== $("pw2").value) return fail("The two passwords are not the same.");
      $("make").disabled = true; setStatus("Making the key" + (/rsa4096/.test($("type").value) ? " (a 4096-bit RSA key can take several seconds)" : "") + "...");
      try {
        const r = await CG.make({ type: $("type").value, subject, names, password: pw, protect: $("scheme").value });
        if (my !== seq) return;
        kept = r;
        const fs = el("fieldset"), lg = el("legend", null, "Your key and request"); fs.append(lg);
        // check our own work: read the request back, check its signature and that it belongs to the key
        const checks = [];
        try {
          const csr = window.CertKit.parseCsr(r.csrDer, "request"), sigOk = await csr.csr.verify(), kr = await KF.readKey(r.keyPem, pw), same = kr.status === "ok" && kr.key.spki.length === csr.spki.length && kr.key.spki.every((v, i) => v === csr.spki[i]);
          checks.push({ level: sigOk ? "good" : "bad", text: sigOk ? "Self-check: the signature on the request is valid." : "Self-check FAILED: the signature on the request is not valid." });
          checks.push({ level: same ? "good" : "bad", text: same ? "Self-check: the key file was read again and it belongs to the request (" + r.keyLabel + ")." : "Self-check FAILED: the key does not belong to the request." });
        } catch { checks.push({ level: "bad", text: "Self-check could not run." }); }
        for (const c of checks) { const ul = el("ul", "tk-notes"); ul.append(el("li", c.level, c.text)); fs.append(ul); }
        fs.append(card("server.csr", r.csrPem, "send this to your certificate authority", false, "application/pkcs10"), card(r.keyProtected ? "server-encrypted.key" : "server.key", r.keyPem, r.keyProtected ? "private key, protected with your password: keep it safe" : "private key, NOT password protected: keep it safe and private", true));
        const nm = el("p", "tk-muted", "Names in the request: " + r.names.map(n => n.value).join(", ") + ". Subject: " + (r.subjectText || "(none)"));
        fs.append(nm, el("h3", null, "What happens next"), el("p", null, "1. Send server.csr to your certificate authority (the text of the file, or the file). 2. Keep the key file. 3. When the certificate arrives, put it together with the key and the CA files in the Certificate Package Checker: it tells you whether everything fits. 4. Install the certificate and the key on your server (the Certificate Converter makes the files for nginx, Apache, IIS and others)."));
        fs.append(el("h3", null, "The same thing with openssl"));
        const rw = el("div", "ct-cmd"), code = el("code", null, r.command), cpb = el("button", "xp-btn small"); cpb.type = "button"; cpb.textContent = "Copy"; cpb.addEventListener("click", () => TK.copy(r.command, setStatus)); rw.append(code, cpb); fs.append(rw);
        box.append(fs); if (box.scrollIntoView) box.scrollIntoView({ block: "start" }); $("clear").disabled = false; setStatus("Done.");
      } catch (e) { fail(e.message || "Something went wrong."); }
      finally { $("make").disabled = !hasCrypto; }
    }
    function wipe() { seq++; kept = null; $("result").textContent = ""; $("pw").value = $("pw2").value = ""; $("clear").disabled = true; setStatus("Wiped."); }
    $("protect").addEventListener("change", togglePw); $("make").addEventListener("click", make); $("clear").addEventListener("click", wipe);
    return { destroy() { kept = null; seq++; $("pw").value = $("pw2").value = ""; } };
  }
  return { init };
})();
