/* Metadata: read, change or remove the details stored inside a PDF (title, author, program, dates, extra properties,
   the hidden XMP block, older saved versions). Everything runs in the browser; the file is never uploaded.
   Everything shown comes from the file and is untrusted: it is only ever put on the page as plain text. */
(window.DesktopApps = window.DesktopApps || {}).pdfmeta = (() => {
  const C = window.PDFCommon;
  const STD = ["Title", "Author", "Subject", "Keywords", "Creator", "Producer"];
  const DATES = [["CreationDate", "Created"], ["ModDate", "Changed"]];
  const MAX_VALUE = 4000;

  const L = () => window.PDFLib;
  const textOf = o => {
    if (o === undefined || o === null) return "";
    const P = L();
    if (o instanceof P.PDFString || o instanceof P.PDFHexString || o instanceof P.PDFName) return o.decodeText();
    return String(o);
  };

  // everything in the Info dictionary: { std: {Title..}, dates: {CreationDate, ModDate}, custom: [{key, value}] }
  function readInfo(doc) {
    const P = L();
    const res = { std: {}, dates: {}, custom: [] };
    const ref = doc.context.trailerInfo.Info;
    const dict = ref && doc.context.lookup(ref);
    if (!dict || !(dict instanceof P.PDFDict)) return res;
    for (const [k, v] of dict.entries()) {
      const key = k.decodeText();
      const val = textOf(doc.context.lookup(v));
      if (STD.includes(key)) res.std[key] = val;
      else if (DATES.some(d => d[0] === key)) res.dates[key] = val;
      else res.custom.push({ key, value: val });
    }
    return res;
  }

  // the XMP block as text ("" when there is none)
  function readXmp(doc) {
    const P = L();
    const cat = doc.catalog;
    const m = cat.lookup(P.PDFName.of("Metadata"));
    if (!m || !m.contents) return "";
    try {
      const bytes = m instanceof P.PDFRawStream ? P.decodePDFRawStream(m).decode() : m.getContents();
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch { return ""; }
  }

  // Delete every object that nothing in the file points to any more (leftovers of older saved versions, dropped metadata).
  // Returns how many objects were removed.
  function pruneUnreachable(doc) {
    const P = L(), ctx = doc.context;
    const seen = new Set();
    const stack = [];
    const push = o => { if (o) stack.push(o); };
    push(ctx.trailerInfo.Root); push(ctx.trailerInfo.Info); push(ctx.trailerInfo.Encrypt);
    while (stack.length) {
      const o = stack.pop();
      if (o instanceof P.PDFRef) {
        const key = o.toString();
        if (seen.has(key)) continue;
        seen.add(key);
        push(ctx.lookup(o));
      } else if (o instanceof P.PDFDict) {
        for (const v of o.values()) push(v);
      } else if (o instanceof P.PDFStream) {
        push(o.dict);
      } else if (o instanceof P.PDFArray) {
        for (const v of o.asArray()) push(v);
      }
    }
    let removed = 0;
    for (const [ref] of ctx.enumerateIndirectObjects()) {
      if (!seen.has(ref.toString())) { ctx.delete(ref); removed++; }
    }
    return removed;
  }

  // Apply changes to a loaded document.
  // changes: { std: {Title: "..", ...}, touch: bool, dropXmp: bool, dropCustom: [keys], wipe: bool }
  function applyChanges(doc, changes) {
    const P = L(), ctx = doc.context, N = P.PDFName;
    const cat = doc.catalog;
    if (changes.wipe) {
      ctx.trailerInfo.Info = undefined;
      cat.delete(N.of("Metadata")); cat.delete(N.of("PieceInfo"));
      for (const page of doc.getPages()) { page.node.delete(N.of("Metadata")); page.node.delete(N.of("PieceInfo")); }
    } else {
      const info = doc.getInfoDict();
      for (const k of STD) {
        if (!(k in (changes.std || {}))) continue;
        const v = String(changes.std[k]).slice(0, MAX_VALUE);
        if (v === "") info.delete(N.of(k)); else info.set(N.of(k), P.PDFHexString.fromText(v));
      }
      for (const k of changes.dropCustom || []) info.delete(N.of(k));
      if (changes.touch) info.set(N.of("ModDate"), P.PDFString.fromDate(new Date()));
      if (changes.dropXmp) cat.delete(N.of("Metadata"));
    }
    return pruneUnreachable(doc);
  }

  function init(root, shell) {
    const $ = id => root.querySelector("#pdfmeta-" + id);
    const fmt = n => n.toLocaleString();
    let file = null, bytes = null, original = null, busy = false;
    const setStatus = m => { $("status").textContent = m; };
    const isEncryptedError = e => !!e && ((L().EncryptedPDFError && e instanceof L().EncryptedPDFError) || e.name === "EncryptedPDFError" || /is encrypted/i.test(String(e.message)));

    function reset() {
      file = bytes = original = null;
      $("name").textContent = ""; $("results").hidden = true; $("empty").hidden = false;
      $("wipe").disabled = true; $("save").disabled = true; $("file").value = "";
      $("npages").textContent = "0";
      setStatus("Ready");
    }

    async function openFile(f) {
      if (busy) return;
      setStatus("Reading the file...");
      let data;
      try { data = await C.readFile(f); } catch (e) { setStatus("Could not read the file."); shell.alert(e.message); return; }
      const raw = C.scanRaw(data);
      if (!raw.header) { setStatus("Not a PDF."); shell.alert(`"${f.name}" does not look like a PDF file.`); return; }
      let doc;
      try { doc = await L().PDFDocument.load(data, { updateMetadata: false }); }
      catch (e) {
        setStatus("Could not open the PDF.");
        shell.alert(isEncryptedError(e) ? `"${f.name}" is protected by a password or restrictions. Remove them first, then open it here.` : `This file could not be read as a PDF. ${e && e.message ? e.message : ""}`.trim());
        return;
      }
      file = f; bytes = data;
      const info = readInfo(doc), xmp = readXmp(doc);
      original = { info, hasXmp: !!doc.catalog.get(L().PDFName.of("Metadata")), revisions: raw.revisions, signed: raw.byteRanges > 0 };
      fillForm(info, xmp, raw, doc.getPageCount());
      $("name").textContent = f.name; $("name").title = f.name;
      $("empty").hidden = true; $("results").hidden = false;
      $("wipe").disabled = false;
      setStatus("Ready: change the details and save a new copy.");
      update();
    }

    function fillForm(info, xmp, raw, pages) {
      for (const k of STD) $(k.toLowerCase()).value = info.std[k] || "";
      const dates = $("dates"); dates.textContent = "";
      for (const [key, label] of DATES) {
        const tr = document.createElement("tr");
        const th = document.createElement("th"); th.textContent = label;
        const td = document.createElement("td");
        const v = info.dates[key];
        td.textContent = v ? C.formatPdfDate(v) : "(not set)";
        if (!v) td.className = "unset";
        tr.append(th, td); dates.append(tr);
      }
      $("touch").checked = true;
      const cs = $("customset"), tb = $("custom"); tb.textContent = "";
      cs.hidden = !info.custom.length;
      info.custom.forEach((c, i) => {
        const tr = document.createElement("tr");
        const t1 = document.createElement("td");
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.id = `pdfmeta-cust-${i}`; cb.dataset.key = c.key;
        cb.setAttribute("aria-label", `Remove property ${c.key}`);
        cb.addEventListener("change", update);
        t1.append(cb);
        const t2 = document.createElement("td"); t2.textContent = c.key;
        const t3 = document.createElement("td"); t3.textContent = c.value.length > 300 ? c.value.slice(0, 300) + "..." : c.value;
        tr.append(t1, t2, t3); tb.append(tr);
      });
      const parsed = xmp ? C.parseXmp(xmp) : { props: [], history: [] };
      $("xmpbox").hidden = !xmp; $("noxmp").hidden = !!xmp;
      $("dropxmp").checked = !!xmp;
      $("xmpnote").textContent = xmp
        ? `It holds ${fmt(parsed.props.length)} propert${parsed.props.length === 1 ? "y" : "ies"}${parsed.history.length ? ` and ${fmt(parsed.history.length)} edit-history entr${parsed.history.length === 1 ? "y" : "ies"}` : ""}. Some programs show the title and author from here instead of from the boxes above, so remove it if you change them.`
        : "";
      $("revnote").textContent = raw.revisions > 1
        ? `This file was saved ${fmt(raw.revisions)} times on top of each other. Older text from earlier versions may still be inside it; a new copy drops it.`
        : "";
      $("signedwarn").hidden = !(raw.byteRanges > 0);
      $("npages").textContent = fmt(pages);
    }

    function gather() {
      const std = {};
      for (const k of STD) std[k] = $(k.toLowerCase()).value;
      return {
        std,
        touch: $("touch").checked,
        dropXmp: !$("xmpbox").hidden && $("dropxmp").checked,
        dropCustom: [...root.querySelectorAll("#pdfmeta-custom input:checked")].map(c => c.dataset.key),
      };
    }

    // did the visitor change anything?
    function changed() {
      if (!original) return [];
      const g = gather(), out = [];
      for (const k of STD) if ((original.info.std[k] || "") !== g.std[k]) out.push(k.toLowerCase());
      if (g.dropCustom.length) out.push(`${g.dropCustom.length} extra`);
      if (g.dropXmp) out.push("hidden XMP block");
      return out;
    }

    function update() {
      const c = changed();
      const plan = $("plan");
      const long = STD.find(k => $(k.toLowerCase()).value.length > MAX_VALUE);
      plan.classList.toggle("bad", !!long);
      plan.textContent = long ? `${long} is longer than ${fmt(MAX_VALUE)} characters.`
        : c.length ? `Will change: ${c.join(", ")}.` : "Nothing changed yet. Saving anyway will still drop older saved versions and unused leftovers.";
      $("save").disabled = busy || !original || !!long;
    }

    const tick = () => new Promise(r => setTimeout(r, 0));

    async function save(wipe) {
      if (busy || !bytes) return;
      busy = true; update(); $("wipe").disabled = true;
      try {
        setStatus("Rewriting the file...");
        await tick();
        const doc = await L().PDFDocument.load(bytes, { updateMetadata: false });
        const removed = applyChanges(doc, wipe ? { wipe: true } : gather());
        const out = await doc.save({ updateFieldAppearances: false });
        const name = `${C.baseName(file.name)}${wipe ? "-clean" : "-edited"}.pdf`;
        C.downloadBlob(new Blob([out], { type: "application/pdf" }), name);
        setStatus(`Saved ${name} (${C.humanSize(out.length)}). ${fmt(removed)} unused object${removed === 1 ? "" : "s"} dropped.`);
      } catch (e) {
        setStatus("Could not save the file.");
        shell.alert(`Could not save the file. ${e && e.message ? e.message : ""}`.trim());
      } finally {
        busy = false; $("wipe").disabled = !original; update();
      }
    }

    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const f = $("file").files[0]; $("file").value = ""; if (f) openFile(f); });
    $("clear").addEventListener("click", () => { if (!busy) reset(); });
    $("save").addEventListener("click", () => save(false));
    $("wipe").addEventListener("click", () => save(true));
    for (const k of STD) $(k.toLowerCase()).addEventListener("input", update);
    $("dropxmp").addEventListener("change", update);
    $("touch").addEventListener("change", update);
    C.enableDrop($("content"), openFile);
    return { destroy() { bytes = null; } };
  }

  return { init, readInfo, readXmp, applyChanges, pruneUnreachable };
})();
