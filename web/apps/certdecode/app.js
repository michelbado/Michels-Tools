/* Certificate Decoder. Reads PEM/DER certificates and CSRs in the browser (lib/certinfo.js, vendored pkijs). Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).certdecode = (() => {
  const MAX_ITEMS = 12, MAX_FILE = 2 << 20;
  function init(root) {
    const $ = id => root.querySelector("#certdecode-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const CI = window.CertInfo, TK = window.TK;
    let text = "", bytes = null, seq = 0, softDone = false;
    function ensureSoft() {   // on plain http there is no WebCrypto: let pkijs use the built-in one for signature checks
      if (softDone) return; softDone = true;
      if (!(window.crypto && window.crypto.subtle) && window.SoftCrypto) window.SoftCrypto.install(window.pkijs);
    }
    async function run() {
      const my = ++seq;
      ensureSoft();
      const out = $("out"); out.textContent = ""; $("summary").textContent = ""; $("copy").disabled = true; text = "";
      let src;
      if (bytes) src = { items: [{ kind: "auto", der: bytes }], warnings: [] };
      else { if (!$("in").value.trim()) { TK.notes($("notes"), []); return; } src = CI.extract($("in").value); }
      const notes = src.warnings.slice(), blocks = [], host = $("host").value.trim();
      if (!src.items.length) { if (!notes.length) notes.push({ level: "bad", text: "No certificate found. Paste text that starts with -----BEGIN CERTIFICATE----- (or CERTIFICATE REQUEST)." }); TK.notes($("notes"), notes); return; }
      if (src.items.length > MAX_ITEMS) { notes.push({ level: "warn", text: "Only the first " + MAX_ITEMS + " are shown." }); src.items = src.items.slice(0, MAX_ITEMS); }
      for (const it of src.items) {
        try {
          if (it.kind === "csr") blocks.push(await CI.describeCsr(it.der));
          else if (it.kind === "cert") blocks.push(CI.describeCert(it.der, Date.now(), host));
          else { try { blocks.push(CI.describeCert(it.der, Date.now(), host)); } catch { blocks.push(await CI.describeCsr(it.der)); } }
        } catch (e) { notes.push({ level: "bad", text: "One item could not be read: it is not valid certificate data." }); }
      }
      if (my !== seq) return;
      const chain = blocks.length > 1 ? await CI.chainInfo(blocks) : null;
      if (my !== seq) return;
      $("summary").textContent = blocks.length === 1 ? blocks[0].summary : blocks.length + " items: " + blocks.map(b => b.title).join(", ");
      if (blocks.length === 1) for (const n of blocks[0].notes) notes.push(n);
      if (chain) for (const n of chain.notes) notes.push(n);
      TK.notes($("notes"), notes);
      const all = [];
      if (chain) all.push({ head: "Chain", sections: chain.sections });
      blocks.forEach((b, i) => all.push({ head: blocks.length > 1 ? (i + 1) + ". " + b.title : "", sections: b.sections, notes: blocks.length > 1 ? b.notes : [] }));
      for (const a of all) {
        const box = document.createElement("div");
        if (a.head) { const h = document.createElement("h3"); h.textContent = a.head; box.append(h); }
        if (a.notes && a.notes.length) { const ul = document.createElement("ul"); ul.className = "tk-notes"; TK.notes(ul, a.notes); box.append(ul); }
        const body = document.createElement("div"); TK.render(body, a.sections, { copy: false }); box.append(body); out.append(box);
      }
      text = TK.toText("Certificate Decoder (Michel's Tools)", all.flatMap(a => [{ title: a.head || "Details", rows: [] }, ...a.sections]), notes);
      $("copy").disabled = false;
      setStatus("Done.");
    }
    const later = TK.debounce(run, 250);
    $("in").addEventListener("input", () => { bytes = null; later(); });
    $("host").addEventListener("input", later);
    $("copy").addEventListener("click", () => TK.copy(text, setStatus));
    $("file").addEventListener("change", async () => {
      const f = $("file").files[0]; if (!f) return;
      if (f.size > MAX_FILE) { setStatus("That file is too large for a certificate."); return; }
      const buf = new Uint8Array(await f.arrayBuffer());
      if (buf[0] === 0x30) { bytes = buf; $("in").value = ""; }          // binary DER
      else { bytes = null; $("in").value = new TextDecoder().decode(buf); }
      run();
    });
    return { destroy() { seq++; } };
  }
  return { init };
})();
