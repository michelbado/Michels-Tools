/* PDF Info: who made a PDF, with what, when, whether it was edited, and what it contains.
   Everything runs in the browser; the file is never uploaded. All text shown comes from the file
   and is treated as untrusted: it is only ever put on the page as plain text. */
(window.DesktopApps = window.DesktopApps || {}).pdfinfo = (() => {
  const C = window.PDFCommon;

  // permission flags of the PDF standard (what pdf.js reports as allowed)
  const PERMISSIONS = [
    [0x04, "printing"], [0x08, "changing the document"], [0x10, "copying text and images"], [0x20, "adding or changing comments"],
    [0x100, "filling in forms"], [0x200, "reading aloud for accessibility"], [0x400, "inserting, removing or rotating pages"], [0x800, "high-quality printing"],
  ];

  function pageSizeText(w, h) {
    const near = (a, b) => Math.abs(a - b) <= 2;
    const [s, l] = w <= h ? [w, h] : [h, w];
    const named = [["A3", 842, 1191], ["A4", 595, 842], ["A5", 420, 595], ["Letter", 612, 792], ["Legal", 612, 1008]].find(([, a, b]) => near(s, a) && near(l, b));
    const mm = n => Math.round(n * 25.4 / 72);
    return `${mm(w)} x ${mm(h)} mm${named ? ` (${named[0]}${w > h ? ", landscape" : ""})` : ""}`;
  }

  // the same data arrives as a Map/Set/array/object depending on the pdf.js version: read all of them
  const listOf = v => (v == null ? [] : v instanceof Map ? [...v.values()] : v instanceof Set ? [...v] : Array.isArray(v) ? v : Object.values(v));
  const keysOf = v => (v == null ? [] : v instanceof Map ? [...v.keys()] : Array.isArray(v) ? v.map(String) : Object.keys(v));

  // what is not allowed, from what pdf.js says IS allowed (null = no restrictions)
  function describePermissions(allowed) {
    if (!allowed) return "";
    const ok = new Set(listOf(allowed));
    const blocked = PERMISSIONS.filter(([f]) => !ok.has(f)).map(([, n]) => n);
    return blocked.length ? "Not allowed: " + blocked.join(", ") : "";
  }

  function init(root, shell) {
    const $ = id => root.querySelector("#pdfinfo-" + id);
    const fmt = n => n.toLocaleString();
    let pending = null;      // a file waiting for its password
    let summary = "";        // text for Copy summary

    function setStatus(m) { $("status").textContent = m; }

    function reset() {
      pending = null; summary = "";
      $("name").textContent = "";
      $("results").hidden = true;
      $("pwrow").hidden = true;
      $("empty").hidden = false;
      $("copy").disabled = true;
      $("file").value = "";
      setStatus("Ready");
    }

    // a table body from [label, value, kind?, note?] rows; returns the rows as plain text too
    function fill(tbody, rows) {
      tbody.textContent = "";
      const lines = [];
      for (const [label, value, kind, note] of rows) {
        const tr = document.createElement("tr");
        const th = document.createElement("th"); th.textContent = label;
        const td = document.createElement("td");
        const empty = value === "" || value === null || value === undefined;
        td.textContent = empty ? "(not set)" : String(value);
        if (empty) td.className = "unset"; else if (kind) td.className = kind;
        if (note) { const n = document.createElement("span"); n.className = "note"; n.textContent = note; td.append(n); }
        tr.append(th, td);
        tbody.append(tr);
        lines.push(`${label}: ${empty ? "(not set)" : value}`);
      }
      return lines;
    }

    // whatever goes wrong, say so: never leave the window stuck on "Reading the file..."
    async function openFile(file, password) {
      try {
        await openFileInner(file, password);
      } catch (e) {
        setStatus("Could not read this PDF.");
        shell.alert(`This file could not be read. ${e && e.message ? e.message : ""}`.trim());
      }
    }

    async function openFileInner(file, password) {
      setStatus("Reading the file...");
      let bytes;
      try { bytes = await C.readFile(file); } catch (e) { setStatus("Could not read the file."); shell.alert(e.message); return; }
      const raw = C.scanRaw(bytes);
      if (!raw.header) { setStatus("Not a PDF."); shell.alert(`"${file.name}" does not look like a PDF file.`); return; }

      let doc;
      try {
        doc = await C.openPdf(bytes, password);
      } catch (e) {
        if (e && e.name === "PasswordException") {
          pending = file;
          $("results").hidden = true; $("empty").hidden = true; $("pwrow").hidden = false;
          $("pwmsg").textContent = e.code === 2 ? "That password is not correct. Try again." : "This PDF is protected by a password.";
          setStatus("Waiting for the password.");
          $("pw").focus();
          return;
        }
        setStatus("Could not open the PDF.");
        shell.alert(`This file could not be read as a PDF. ${e && e.message ? e.message : ""}`.trim());
        return;
      }
      pending = null;
      $("pwrow").hidden = true;

      const safe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };
      const md = await safe(() => doc.getMetadata(), { info: {}, metadata: null });
      const info = md.info || {};
      const xmpRaw = md.metadata && typeof md.metadata.getRaw === "function" ? md.metadata.getRaw() : "";
      const xmp = C.parseXmp(xmpRaw);
      const xp = n => (xmp.props.find(p => p.name === n) || {}).value || "";

      // page sizes (the first 500 pages are enough to describe a document)
      const sizes = new Map();
      const sample = Math.min(doc.numPages, 500);
      for (let i = 1; i <= sample; i++) {
        const page = await doc.getPage(i);
        const [x0, y0, x1, y1] = page.view;
        let w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
        if (page.rotate % 180 !== 0) [w, h] = [h, w];
        const key = pageSizeText(w, h);
        sizes.set(key, (sizes.get(key) || 0) + 1);
        page.cleanup();
      }
      const sizeList = [...sizes.entries()].sort((a, b) => b[1] - a[1]);
      const sizeText = sizeList.length === 1 ? sizeList[0][0] : sizeList.map(([s, n]) => `${s}: ${fmt(n)} page${n === 1 ? "" : "s"}`).join("; ");

      const attachList = listOf(await safe(() => doc.getAttachments(), null));
      const jsTriggers = keysOf(await safe(() => doc.getJSActions(), null));   // where scripts are hooked in
      const fieldList = listOf(await safe(() => doc.getFieldObjects(), null)).flat();
      const sigFields = fieldList.filter(f => f.type === "signature").length;
      const formFields = fieldList.length - sigFields;
      const allowed = await safe(() => doc.getPermissions(), null);
      const encrypted = raw.hasEncryptKey;

      // ---- File ----
      const fileLines = fill($("t-file"), [
        ["Name", file.name],
        ["Size", `${C.humanSize(file.size)}  (${fmt(file.size)} bytes)`],
        ["PDF version", raw.header || info.PDFFormatVersion || ""],
        ["Pages", fmt(doc.numPages)],
        ["Page size", sizeText],
        ["Fast web view", raw.linearized ? "Yes" : "No"],
        ["Password-protected", encrypted ? (password ? "Yes (opened with the password you entered)" : "Yes (can be opened without a password, but has restrictions)") : "No"],
      ]);

      // ---- Who made it ----
      const whoLines = fill($("t-who"), [
        ["Title", info.Title || xp("dc:title")],
        ["Author", info.Author || xp("dc:creator")],
        ["Subject", info.Subject || xp("dc:description")],
        ["Keywords", info.Keywords || xp("pdf:Keywords")],
        ["Created with (program)", info.Creator || xp("xmp:CreatorTool")],
        ["Converted by (software)", info.Producer || xp("pdf:Producer")],
        ["Created", C.formatPdfDate(info.CreationDate) || xp("xmp:CreateDate")],
        ["Last modified", C.formatPdfDate(info.ModDate) || xp("xmp:ModifyDate")],
        ...Object.entries(info.Custom || {}).map(([k, v]) => [`Custom: ${k}`, String(v)]),
      ]);

      // ---- Edit history ----
      const histRows = [
        ["Saved", raw.revisions <= 1 ? "Once (a single version)" : `${fmt(raw.revisions)} times`,
          raw.revisions > 1 ? "warn" : "", raw.revisions > 1 ? "The file was changed and saved again without being rewritten from scratch. Earlier versions of its content may still be inside it." : ""],
        ["Document ID", xp("xmpMM:DocumentID"), "mono"],
        ["Version ID", xp("xmpMM:InstanceID"), "mono"],
      ];
      const histLines = fill($("t-hist"), histRows);
      const ev = $("t-events"); ev.textContent = "";
      for (const h of xmp.history) {
        const tr = document.createElement("tr");
        for (const v of [h.action, h.agent, h.when, h.changed]) { const td = document.createElement("td"); td.textContent = v; tr.append(td); }
        ev.append(tr);
      }
      $("histwrap").hidden = xmp.history.length === 0;

      // ---- Contents ----
      const sigCount = Math.max(raw.byteRanges, sigFields);
      const riskLines = fill($("t-risk"), [
        ["Digital signatures", sigCount ? `${fmt(sigCount)} found` : "None",
          sigCount ? "" : "", sigCount ? "This tool only counts them. Use Verify Signatures to check them." : ""],
        ["Form fields", formFields ? fmt(formFields) : "None"],
        ["Attached files", attachList.length ? attachList.map(a => `${a.filename || "(unnamed)"}${a.description ? ` (${a.description})` : ""}`).join(", ") : "None", attachList.length ? "warn" : ""],
        ["Scripts (JavaScript)", jsTriggers.length ? "Yes" : "None found", jsTriggers.length ? "warn" : "",
          jsTriggers.length ? `Some PDF viewers run these when the file is opened or used. Found in: ${jsTriggers.slice(0, 5).join(", ")}${jsTriggers.length > 5 ? ", ..." : ""}.` : ""],
        ["Restrictions", encrypted ? (describePermissions(allowed) || "None set") : "None"],
      ]);

      // ---- XMP ----
      $("xmpbox").hidden = xmp.props.length === 0 && !xmp.error;
      const xt = $("t-xmp"); xt.textContent = "";
      for (const p of xmp.props) {
        const tr = document.createElement("tr");
        const a = document.createElement("td"); a.textContent = p.name;
        const b = document.createElement("td"); b.textContent = p.value;
        tr.append(a, b); xt.append(tr);
      }

      summary = ["FILE", ...fileLines, "", "WHO MADE IT", ...whoLines, "", "EDIT HISTORY", ...histLines,
        ...xmp.history.map(h => `  ${h.action} | ${h.agent} | ${h.when} | ${h.changed}`), "", "CONTENTS", ...riskLines].join("\n");

      $("name").textContent = file.name;
      $("empty").hidden = true;
      $("results").hidden = false;
      $("copy").disabled = false;
      setStatus(`${file.name}: ${fmt(doc.numPages)} page${doc.numPages === 1 ? "" : "s"}, ${C.humanSize(file.size)}.`);
      C.closePdf(doc);
    }

    /* ---------- wiring ---------- */

    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const f = $("file").files[0]; if (f) openFile(f); });
    $("clear").addEventListener("click", reset);
    $("pwgo").addEventListener("click", () => { if (pending) openFile(pending, $("pw").value); });
    $("pw").addEventListener("keydown", e => { if (e.key === "Enter" && pending) openFile(pending, $("pw").value); });
    C.enableDrop($("content"), f => openFile(f));
    $("copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(summary); setStatus("Copied the summary."); }
      catch {
        const t = document.createElement("textarea");
        t.value = summary; t.style.position = "fixed"; t.style.opacity = "0";
        document.body.append(t); t.select();
        let ok = false; try { ok = document.execCommand("copy"); } catch { /* ignore */ }
        t.remove();
        setStatus(ok ? "Copied the summary." : "Copy blocked by the browser.");
      }
    });

    return { destroy() {} };
  }

  return { init, pageSizeText, describePermissions };
})();
