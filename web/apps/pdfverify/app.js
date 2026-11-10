/* Verify Signatures: reads the digital signatures in a PDF and checks them.
   Everything runs in the browser; the file is never uploaded. Every piece of text shown here comes from the
   file or from its certificates, so it is untrusted: it is only ever put on the page with textContent. */
(window.DesktopApps = window.DesktopApps || {}).pdfverify = (() => {
  const C = window.PDFCommon, S = window.PDFSig;

  const ICON = {
    ok: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="#2E9B2E" stroke="#176317"/><path d="M5 9.4l2.6 2.6L13 6.4" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bad: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="#D6461F" stroke="#8C2A0E"/><path d="M6 6l6 6M12 6l-6 6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
    warn: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18"><path d="M9 1.5L17 16H1z" fill="#FFD21F" stroke="#8A6D00" stroke-linejoin="round"/><path d="M9 6.5v4.5" stroke="#000" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="13.4" r="1" fill="#000"/></svg>',
  };
  const TONE = { valid: "valid", modified: "bad", badsig: "bad", damaged: "warn", unsupported: "warn", insecure: "warn" };
  const ICON_OF = { valid: "ok", bad: "bad", warn: "warn" };

  const pad = n => String(n).padStart(2, "0");
  const fmtDate = d => (d instanceof Date && !Number.isNaN(d.getTime())
    ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} (UTC)` : "");
  const dnLine = dn => (dn && dn.text) || "";
  const whoOf = s => (s ? [s.CN, s.O].filter(Boolean).join(", ") || s.text : "");

  // a short plain-language summary of how much of the file a signature protects
  function coverage(sig) {
    if (sig.coversWholeFile) return "The whole file.";
    const pct = Math.floor(sig.coverageEnd / sig.fileLength * 100);
    return `Only the first ${pct}% of the file (up to byte ${sig.coverageEnd.toLocaleString()} of ${sig.fileLength.toLocaleString()}). ` +
      "The file was extended after this signature. That can be harmless, for example another signature or a timestamp, but changes made after signing are not covered by it.";
  }

  // the rows of one signature, as [label, value, kind?, note?]
  function rowsFor(sig) {
    const rows = [];
    const s = sig.signer;
    if (sig.kind === "timestamp") {
      const t = sig.timestamp;
      rows.push(["Time stamp", t && t.time ? fmtDate(t.time) : "", t && t.imprintOk === false ? "bad" : ""]);
      rows.push(["Stamped by", t && t.authority || (s && whoOf(s.subject)) || ""]);
      rows.push(["Matches the document", t ? (t.imprintOk === true ? "Yes" : t.imprintOk === false ? "No: the document changed after it was stamped" : "Could not be checked") : "", t && t.imprintOk === false ? "bad" : ""]);
      rows.push(["Stamp itself is genuine", t ? (t.tokenSignatureOk === true ? "Yes" : t.tokenSignatureOk === false ? "No" : "Not checked") : ""]);
      rows.push(["Covers", coverage(sig)]);
      return rows;
    }
    rows.push(["Signed by", s ? whoOf(s.subject) : sig.name, "", s && sig.name && s.subject.CN && sig.name !== s.subject.CN ? `The signature field says: ${sig.name}` : ""]);
    if (s && s.subject.email) rows.push(["Email", s.subject.email]);
    if (s) rows.push(["Certificate issued by", whoOf(s.issuer) || dnLine(s.issuer)]);
    const when = sig.signingTime ? fmtDate(sig.signingTime) : (sig.pdfTime ? fmtDate(sig.pdfTime) : "");
    rows.push(["Signed on", when, "", when ? (sig.signingTime ? "The time the signer's computer says. It is only proven if there is a trusted time stamp." : "From the signature field. It is only a claim by the signer.") : ""]);
    if (sig.reason) rows.push(["Reason", sig.reason]);
    if (sig.location) rows.push(["Location", sig.location]);
    if (sig.contact) rows.push(["Contact", sig.contact]);
    if (s) {
      const now = new Date();
      let state = "", kind = "";
      if (s.notAfter < now) { state = `Expired on ${fmtDate(s.notAfter)}`; kind = "warn"; }
      else if (s.notBefore > now) { state = "Not valid yet"; kind = "warn"; }
      rows.push(["Certificate valid", `${fmtDate(s.notBefore)}  to  ${fmtDate(s.notAfter)}`, kind, state || ""]);
      if (sig.signingTime && (sig.signingTime < s.notBefore || sig.signingTime > s.notAfter)) rows.push(["Signed within validity", "No: the signing time is outside the certificate's validity", "warn"]);
      rows.push(["Key and algorithm", [s.key, sig.signatureAlgorithm, sig.digestAlgorithm && `digest ${sig.digestAlgorithm}`].filter(Boolean).join("  |  ")]);
      if (s.usage.length || s.purposes.length) rows.push(["Certificate allows", [s.usage.join(", "), s.purposes.join(", ")].filter(Boolean).join("  |  ")]);
      rows.push(["Fingerprint (SHA-256)", s.fingerprint, "mono"]);
    }
    if (sig.chain.length) {
      const ends = sig.chainEnds === "self-signed"
        ? "The top certificate signs itself. Anyone can make a certificate like this, so it does not by itself prove identity."
        : "The certificate that issued the top one is not included in the file, so the chain cannot be followed further.";
      rows.push(["Certificates in the file", { chain: sig.chain.map((c, i) => `${i + 1}. ${whoOf(c.subject) || dnLine(c.subject)}${c.isCA ? " (certificate authority)" : ""}${c.linkOk === false && i + 1 < sig.chain.length ? "  [does not link to the next]" : ""}`) }, "", ends]);
    }
    const t = sig.timestamp;
    rows.push(["Trusted time stamp", t ? `${t.time ? fmtDate(t.time) : "present"}${t.authority ? ` by ${t.authority}` : ""}` : "None", t && (t.imprintOk === false) ? "bad" : "", t ? (t.imprintOk === true ? "It matches this signature." : t.imprintOk === false ? "It does NOT match this signature." : "Its contents could not be checked.") + " The stamping authority itself was not checked against a trusted list." : ""]);
    rows.push(["Protects", coverage(sig)]);
    if (sig.subFilter) rows.push(["Signature format", `${sig.subFilter}${sig.filter ? `  (${sig.filter})` : ""}`]);
    return rows;
  }

  function reportText(file, res) {
    const L = [`Signature report for ${file.name} (${C.humanSize(file.size)})`, `Signatures found: ${res.signatures.length}`, ""];
    res.signatures.forEach((sig, i) => {
      L.push(`${sig.kind === "timestamp" ? "Document timestamp" : "Signature"} ${i + 1}: ${S.STATUS[sig.status] || sig.status}`, `  ${sig.headline}`);
      for (const [label, value, , note] of rowsFor(sig)) {
        const v = value && typeof value === "object" ? value.chain.join(" -> ") : value;
        L.push(`  ${label}: ${v || "(not set)"}${note ? `  [${note}]` : ""}`);
      }
      sig.notes.forEach(n => L.push(`  Note: ${n}`));
      L.push("");
    });
    L.push("Not checked: whether the signer's certificate is trusted by a recognised authority, or whether it was revoked.");
    return L.join("\n");
  }

  function init(root, shell) {
    const $ = id => root.querySelector("#pdfverify-" + id);
    let report = "";
    const setStatus = m => { $("status").textContent = m; };

    function reset() {
      report = "";
      $("name").textContent = ""; $("file").value = "";
      $("results").hidden = true; $("empty").hidden = false; $("copy").disabled = true;
      $("list").textContent = ""; $("summary").textContent = "";
      setStatus("Ready");
    }

    function cell(tr, label, value, kind, note) {
      const th = document.createElement("th"); th.textContent = label;
      const td = document.createElement("td");
      if (value && typeof value === "object" && value.chain) {
        for (const line of value.chain) { const d = document.createElement("span"); d.className = "chain"; d.textContent = line; td.append(d); }
      } else {
        const empty = value === "" || value === null || value === undefined;
        td.textContent = empty ? "(not set)" : String(value);
        if (empty) td.className = "unset"; else if (kind) td.className = kind;
      }
      if (note) { const n = document.createElement("span"); n.className = "note"; n.textContent = note; td.append(n); }
      tr.append(th, td);
    }

    function render(file, res, emptyFields) {
      const list = $("list");
      list.textContent = "";
      const n = res.signatures.length;
      const sigs = res.signatures.filter(s => s.kind === "signature"), stamps = res.signatures.filter(s => s.kind === "timestamp");
      const good = res.signatures.filter(s => s.status === "valid").length;
      const summary = $("summary");
      summary.className = "summary";
      if (!n) {
        summary.textContent = "No digital signatures were found in this file." + (emptyFields ? ` It does contain ${emptyFields} signature field${emptyFields === 1 ? "" : "s"} that ${emptyFields === 1 ? "was" : "were"} never signed.` : "");
        summary.classList.add("warn");
      } else {
        const bad = res.signatures.filter(s => s.status === "modified" || s.status === "badsig").length;
        const parts = [];
        if (sigs.length) parts.push(`${sigs.length} signature${sigs.length === 1 ? "" : "s"}`);
        if (stamps.length) parts.push(`${stamps.length} document timestamp${stamps.length === 1 ? "" : "s"}`);
        summary.textContent = `${parts.join(" and ")} found: ${good} valid${bad ? `, ${bad} not valid` : ""}${n - good - bad ? `, ${n - good - bad} could not be fully checked` : ""}.`;
        summary.classList.add(bad ? "bad" : n - good ? "warn" : "ok");
      }
      res.signatures.forEach((sig, i) => {
        const fs = document.createElement("fieldset"); fs.className = "sig";
        const lg = document.createElement("legend");
        const tone = TONE[sig.status] || "warn";
        const badge = document.createElement("span"); badge.className = `badge ${tone}`;
        badge.innerHTML = ICON[ICON_OF[tone]];                                 // a constant icon, not file text
        const label = document.createElement("span");
        label.textContent = `${sig.kind === "timestamp" ? "Document timestamp" : "Signature"} ${i + 1} of ${n}: ${S.STATUS[sig.status] || sig.status}`;
        badge.append(label); lg.append(badge); fs.append(lg);
        const h = document.createElement("p"); h.className = `headline ${tone}`; h.textContent = sig.headline; fs.append(h);
        const table = document.createElement("table"); table.className = "kv";
        const tb = document.createElement("tbody");
        for (const [l, v, k, note] of rowsFor(sig)) { const tr = document.createElement("tr"); cell(tr, l, v, k, note); tb.append(tr); }
        table.append(tb); fs.append(table);
        const notes = [...sig.notes];
        if (sig.status === "valid" && sig.kind === "signature") notes.push("Identity not verified: the certificate was not checked against a list of trusted authorities, or for revocation.");
        if (notes.length) { const ul = document.createElement("ul"); ul.className = "notes"; notes.forEach(t => { const li = document.createElement("li"); li.textContent = t; ul.append(li); }); fs.append(ul); }
        list.append(fs);
      });
      $("empty").hidden = true; $("results").hidden = false;
      $("name").textContent = file.name; $("copy").disabled = false;
      report = reportText(file, res);
      setStatus(n ? `${file.name}: ${summary.textContent}` : `${file.name}: no signatures.`);
    }

    async function openFile(file) {
      try {
        setStatus("Reading the file...");
        let bytes;
        try { bytes = await C.readFile(file); } catch (e) { setStatus("Could not read the file."); shell.alert(e.message); return; }
        if (!C.scanRaw(bytes).header) { setStatus("Not a PDF."); shell.alert(`"${file.name}" does not look like a PDF file.`); return; }
        setStatus("Checking signatures...");
        await new Promise(r => setTimeout(r, 0));
        const res = await S.analyze(bytes);
        const emptyFields = Math.max(0, C.countBytes(bytes, "/FT /Sig") + C.countBytes(bytes, "/FT/Sig") - res.signatures.filter(s => s.kind === "signature").length);
        render(file, res, res.signatures.length ? 0 : emptyFields);
      } catch (e) {
        setStatus("Could not check this file.");
        shell.alert(`This file could not be checked. ${e && e.message ? e.message : ""}`.trim());
      }
    }

    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const f = $("file").files[0]; if (f) openFile(f); });
    $("clear").addEventListener("click", reset);
    C.enableDrop($("content"), f => openFile(f));
    $("copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(report); setStatus("Copied the report."); }
      catch {
        const t = document.createElement("textarea");
        t.value = report; t.style.position = "fixed"; t.style.opacity = "0";
        document.body.append(t); t.select();
        let ok = false; try { ok = document.execCommand("copy"); } catch { /* ignore */ }
        t.remove();
        setStatus(ok ? "Copied the report." : "Copy blocked by the browser.");
      }
    });
    return { destroy() {} };
  }

  return { init, rowsFor, coverage, fmtDate };
})();
