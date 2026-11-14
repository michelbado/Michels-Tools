/* SSH Key Inspector. The reading is in lib/sshkey.js; this file only shows it. Everything reaches the page through textContent. Nothing is sent anywhere. */
(window.DesktopApps = window.DesktopApps || {}).sshkey = (() => {
  function init(root) {
    const $ = id => root.querySelector("#sshkey-" + id);
    const S = window.SshKey, TK = window.TK, setStatus = m => { $("status").textContent = m; };
    let last = [];
    const when = d => d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "no limit";
    function show() {
      const out = $("out"), sum = $("summary"); out.textContent = ""; sum.textContent = ""; last = [];
      $("copy").disabled = true; $("save").disabled = true;
      const text = $("in").value; if (!text.trim()) { setStatus("Ready"); return; }
      const r = S.parse(text); let good = 0;
      for (const it of r.items) {
        const box = document.createElement("div"); box.className = "sshkey-key"; out.append(box);
        if (it.error) { const ul = document.createElement("ul"); ul.className = "tk-notes"; box.append(ul); TK.notes(ul, [{ level: "bad", text: (it.line ? "Line " + it.line + ": " : "") + it.error }]); continue; }
        good++; last.push(it);
        const h = document.createElement("h3"); h.textContent = (r.items.length > 1 ? "Line " + it.line + ": " : "") + (it.isCert ? "Certificate for an " : "") + it.kind + (it.bits ? ", " + it.bits + " bits" : ""); box.append(h);
        const ul = document.createElement("ul"); ul.className = "tk-notes"; box.append(ul); TK.notes(ul, it.notes);
        const rows = [["Key type", it.type], ["SHA-256 fingerprint", it.sha256], ["MD5 fingerprint", it.md5]];
        if (it.comment) rows.push(["Comment", it.comment]);
        if (it.format) rows.push(["File", it.format]);
        if (it.curve) rows.push(["Curve", it.curve]);
        if (it.application) rows.push(["Application", it.application]);
        if (it.hosts) rows.push(["Host names", it.hosts.join(", ")]);
        if (it.marker) rows.push(["Marker", it.marker]);
        if (it.private) rows.push(["Passphrase", it.cipher === "none" ? "none" : it.cipher + ", " + it.kdf + (it.kdfRounds ? ", " + it.kdfRounds + " rounds" : "")]);
        const secs = [{ title: "Key", rows, mono: true }];
        if (it.options && it.options.length) secs.push({ title: "Options on this line", rows: it.options.map(o => [o.name + (o.value ? "=" + o.value : ""), o.text]) });
        if (it.isCert) {
          const c = it.cert, ca = S.caInfo(it);
          secs.push({ title: "Certificate", rows: [["Kind", c.type + " certificate"], ["Key ID", c.keyId], ["Serial", c.serial], ["Valid from", when(c.from)], ["Valid until", when(c.until)], ["Names (principals)", c.principals.join(", ") || "(none: any)"],
            ["Signed by", ca ? ca.kind + (ca.bits ? " " + ca.bits + " bits" : "") + " " + ca.sha256 : "(unreadable)"], ["Restrictions (critical options)", c.critical.map(o => o.name + (o.value ? "=" + o.value : "")).join(", ") || "none"],
            ["Extensions", c.extensions.map(o => o.name).join(", ") || "none"]] });
        }
        TK.render((() => { const d = document.createElement("div"); box.append(d); return d; })(), secs, { copy: true, status: setStatus });
        const art = document.createElement("pre"); art.className = "sshkey-art"; art.textContent = it.art; art.setAttribute("aria-label", "Random art picture of the key"); box.append(art);
        const row = document.createElement("div"); row.className = "tk-row"; box.append(row);
        for (const [label, fn] of [["Copy authorized_keys line", () => S.authorizedLine(it)], ["Copy RFC 4716 form", () => S.rfc4716(it)]]) { const b = document.createElement("button"); b.type = "button"; b.className = "xp-btn small"; b.textContent = label; b.addEventListener("click", () => TK.copy(fn(), setStatus)); row.append(b); }
      }
      if (r.truncated) { const p = document.createElement("p"); p.className = "tk-muted"; p.textContent = "Only the first 200 lines are shown."; out.append(p); }
      sum.textContent = good ? good + " key" + (good === 1 ? "" : "s") + " read" + (r.items.length > good ? ", " + (r.items.length - good) + " line(s) not understood." : ".") : "Nothing could be read.";
      $("copy").disabled = !good; $("save").disabled = !good; setStatus(good ? "Read " + good + "." : "Nothing could be read.");
    }
    const text = () => last.map(S.toText).join("\n\n");
    $("in").addEventListener("input", TK.debounce(show, 150));
    $("clear").addEventListener("click", () => { $("in").value = ""; show(); });
    $("copy").addEventListener("click", () => TK.copy(text(), setStatus));
    $("save").addEventListener("click", () => TK.save("ssh-key-report.txt", text()));
    $("open").addEventListener("click", () => $("file").click());
    function loadFile(f) { if (f.size > 4e6) { setStatus("That file is too large for a key file."); return; } f.text().then(t => { $("in").value = t; show(); }); }
    $("file").addEventListener("change", () => { const f = $("file").files[0]; if (f) loadFile(f); $("file").value = ""; });
    root.addEventListener("dragover", e => e.preventDefault());
    root.addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) loadFile(f); });
    return { destroy() {} };
  }
  return { init };
})();
