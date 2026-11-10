/* Redact: black out parts of a PDF for good. Boxes are drawn by hand or found by searching the text; every page that has a box is
   drawn to a picture (pdf.js) with the boxes burned in and put into a NEW document (pdf-lib), so the hidden text no longer exists in
   the file. Pages without boxes are copied unchanged. Everything runs in the browser; the file is never uploaded.
   Boxes are kept in "display points": the page as shown (rotation included), 72 per inch, from the top-left corner, y pointing down. */
(window.DesktopApps = window.DesktopApps || {}).pdfredact = (() => {
  const C = window.PDFCommon;
  const PAD = 1.5;                     // points of safety margin around a found piece of text
  const MAX_PIXELS = 30e6, MAX_SIDE = 12000;   // a redacted page is drawn at most this large (a poster is drawn at a lower resolution)
  const JPEG_Q = { 150: 0.86, 200: 0.9, 300: 0.92 };
  const PRESETS = {
    email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
    phone: /(?:\+|00)?\(?\d[\d\s().\-]{6,}\d/g,
    digits: /(?:\d[ \-]?){8,}\d|\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g,
  };
  const PRESET_NAMES = { email: "e-mail addresses", phone: "phone numbers", digits: "long numbers" };

  /* ---------- pure helpers (also used by the tests) ---------- */

  // The box (display points) covering one pdf.js text item, with a safety margin. vt = the page viewport's transform at scale 1.
  function itemRect(vt, it, pad = PAD) {
    const t = it.transform;
    const a = vt[0] * t[0] + vt[2] * t[1], b = vt[1] * t[0] + vt[3] * t[1];
    let c = vt[0] * t[2] + vt[2] * t[3], d = vt[1] * t[2] + vt[3] * t[3];
    const e = vt[0] * t[4] + vt[2] * t[5] + vt[4], f = vt[1] * t[4] + vt[3] * t[5] + vt[5];
    const k = Math.hypot(a, b) || 1, len = Math.max(0, Number(it.width) || 0), ux = (a / k) * len, uy = (b / k) * len;
    if (!Number.isFinite(c) || !Number.isFinite(d) || (Math.abs(c) < 1e-6 && Math.abs(d) < 1e-6)) { const h = Number(it.height) || Math.hypot(a, b); c = -(b / k) * h; d = (a / k) * h; }
    // from a little below the baseline (descenders) to above the capital height; c,d is the font-size vector pointing "up" on the screen
    const pts = [[e - 0.3 * c, f - 0.3 * d], [e + ux - 0.3 * c, f + uy - 0.3 * d], [e + 1.15 * c, f + 1.15 * d], [e + ux + 1.15 * c, f + uy + 1.15 * d]];
    const x0 = Math.min(...pts.map(p => p[0])) - pad, x1 = Math.max(...pts.map(p => p[0])) + pad, y0 = Math.min(...pts.map(p => p[1])) - pad, y1 = Math.max(...pts.map(p => p[1])) + pad;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // Two readings of a page's text items, so a word split over items still matches (joined without a gap) and so does a phrase over items (joined with a space).
  // Each: { text, map: [{ start, end, idx }] }
  function pageTexts(items) {
    return [false, true].map(spaced => {
      let text = ""; const map = [];
      items.forEach((it, idx) => {
        if (typeof it.str !== "string") return;
        if (spaced && text && !/\s$/.test(text) && !/^\s/.test(it.str)) text += " ";
        const start = text.length; text += it.str; map.push({ start, end: text.length, idx });
        if (it.hasEOL) text += "\n";
      });
      return { text, map };
    });
  }
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function termRegex(term) { return new RegExp(esc(String(term).trim()).replace(/\s+/g, "\\s*"), "gi"); }
  const digitCount = s => (s.match(/\d/g) || []).length;
  // the indexes of the text items touched by a search. kind: "text" (term) or a preset name.
  function findItems(items, kind, term) {
    const hit = new Set();
    if (kind === "text" && !String(term || "").trim()) return hit;
    for (const { text, map } of pageTexts(items)) {
      const re = kind === "text" ? termRegex(term) : new RegExp(PRESETS[kind].source, PRESETS[kind].flags);
      let m;
      while ((m = re.exec(text))) {
        if (!m[0]) { re.lastIndex++; continue; }
        if (kind === "phone" && (digitCount(m[0]) < 8 || digitCount(m[0]) > 15)) continue;
        if (kind === "digits" && /^\d/.test(m[0]) && digitCount(m[0]) < 9) continue;
        const s = m.index, e = m.index + m[0].length;
        for (const r of map) if (r.start < e && r.end > s) hit.add(r.idx);
      }
    }
    return hit;
  }
  // the largest drawing scale for a page of w x h points at the wished dpi, within the pixel limits; also says whether it had to be lowered
  function fitScale(w, h, dpi) {
    let k = dpi / 72, reduced = false;
    if (w * k * h * k > MAX_PIXELS || Math.max(w, h) * k > MAX_SIDE) { k = Math.min(Math.sqrt(MAX_PIXELS / (w * h)), MAX_SIDE / Math.max(w, h)); reduced = true; }
    return { k, reduced };
  }
  const sameBox = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;

  function init(root, shell) {
    const $ = id => root.querySelector("#pdfredact-" + id);
    const fmt = n => n.toLocaleString();
    const setStatus = m => { $("status").textContent = m; };
    const tick = () => new Promise(r => setTimeout(r, 0));
    const L = () => window.PDFLib;
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    let src = null;                       // { name, bytes, doc, pages, sizes: [[w, h] displayed], signed }
    let cur = 1, sc = 1, token = 0, busy = false, nextId = 1;
    let boxes = new Map();                // page number -> [{ id, x, y, w, h }]
    let selected = null;                  // box id
    let searches = [];                    // [{ kind, term }] used to look for leftovers in the result
    let textCache = new Map();            // page -> { items, vt }

    const boxesOf = n => boxes.get(n) || [];
    const allBoxes = () => [...boxes.values()].reduce((s, a) => s + a.length, 0);
    const pagesWithBoxes = () => [...boxes.entries()].filter(([, a]) => a.length).map(([n]) => n).sort((a, b) => a - b);

    function closeSrc() { if (src) C.closePdf(src.doc); src = null; }
    function reset() {
      closeSrc(); boxes = new Map(); selected = null; searches = []; textCache = new Map(); cur = 1;
      $("name").textContent = ""; $("work").hidden = true; $("empty").hidden = false; $("file").value = ""; $("npages").textContent = "0";
      $("found").textContent = ""; $("check").hidden = true; $("term").value = "";
      setStatus("Ready"); update();
    }

    /* ---------- opening ---------- */
    async function openSource(f) {
      if (busy) return;
      setStatus("Reading the file...");
      let data;
      try { data = await C.readFile(f); } catch (e) { setStatus("Could not read the file."); shell.alert(e.message); return; }
      const raw = C.scanRaw(data);
      if (!raw.header) { setStatus("Not a PDF."); shell.alert(`"${f.name}" does not look like a PDF file.`); return; }
      let doc;
      try { doc = await C.openPdf(data); }
      catch (e) {
        setStatus("Could not open the PDF.");
        shell.alert(e && e.name === "PasswordException" ? `"${f.name}" is protected by a password. Save a copy without the password first (in your PDF program), then open that copy here.` : `This file could not be read as a PDF. ${e && e.message ? e.message : ""}`.trim());
        return;
      }
      if (raw.hasEncryptKey) {
        try { await L().PDFDocument.load(data, { updateMetadata: false }); }
        catch (e) { if (e && (e.name === "EncryptedPDFError" || /is encrypted/i.test(String(e.message)))) { C.closePdf(doc); setStatus("This PDF has restrictions."); shell.alert(`"${f.name}" has restrictions set by its author, so a changed copy cannot be made.`); return; } }
      }
      reset();
      const sizes = [];
      for (let n = 1; n <= doc.numPages; n++) { const p = await doc.getPage(n); const vp = p.getViewport({ scale: 1 }); sizes.push([vp.width, vp.height]); p.cleanup(); }
      src = { name: f.name, bytes: data, doc, pages: doc.numPages, sizes, signed: raw.byteRanges > 0 };
      $("name").textContent = f.name; $("name").title = f.name;
      $("empty").hidden = true; $("work").hidden = false;
      $("pageno").max = String(src.pages); $("total").textContent = fmt(src.pages); $("npages").textContent = fmt(src.pages);
      $("signedwarn").hidden = !src.signed;
      setStatus(`${f.name}: ${fmt(src.pages)} page${src.pages === 1 ? "" : "s"}.`);
      update();
      await gotoPage(1);
    }

    /* ---------- the preview and the boxes on it ---------- */
    async function gotoPage(n) {
      if (!src) return;
      cur = clamp(Math.round(n) || 1, 1, src.pages);
      $("pageno").value = String(cur);
      $("prev").disabled = cur <= 1; $("next").disabled = cur >= src.pages;
      selected = null;
      await showPage();
    }
    async function showPage() {
      if (!src) return;
      const my = ++token, [W, H] = src.sizes[cur - 1];
      $("pagebox").textContent = `${(W / 72 * 25.4).toFixed(0)} x ${(H / 72 * 25.4).toFixed(0)} mm`;
      const wrap = $("sheetwrap");
      const availW = Math.max(120, wrap.clientWidth - 28), availH = Math.max(160, wrap.clientHeight - 28);
      const scale = Math.max(0.05, Math.min(availW / W, availH / H));
      const page = await src.doc.getPage(cur), vp = page.getViewport({ scale });
      const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
      const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      try { await page.render({ canvasContext: ctx, canvas: cv, viewport: vp }).promise; } catch { /* a newer preview replaced this one */ }
      page.cleanup();
      if (my !== token) return;
      const out = $("canvas"); out.width = cv.width; out.height = cv.height; out.getContext("2d").drawImage(cv, 0, 0);
      sc = cv.width / W;
      layout();
    }
    function layout() {
      const layer = $("boxes"); layer.textContent = "";
      for (const b of boxesOf(cur)) {
        const el = document.createElement("div");
        el.className = "rbox" + (b.id === selected ? " sel" : ""); el.dataset.id = String(b.id);
        el.style.left = b.x * sc + "px"; el.style.top = b.y * sc + "px"; el.style.width = b.w * sc + "px"; el.style.height = b.h * sc + "px";
        layer.append(el);
      }
      $("delsel").disabled = selected == null; $("delpage").disabled = !boxesOf(cur).length;
    }
    function addBox(n, r) {
      const [W, H] = src.sizes[n - 1];
      const x0 = clamp(r.x, 0, W), y0 = clamp(r.y, 0, H), x1 = clamp(r.x + r.w, 0, W), y1 = clamp(r.y + r.h, 0, H);
      if (x1 - x0 < 1 || y1 - y0 < 1) return null;
      const nb = { id: nextId++, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      const list = boxes.get(n) || []; if (list.some(b => sameBox(b, nb))) return null;
      list.push(nb); boxes.set(n, list); return nb;
    }
    function removeBox(id) { for (const [n, list] of boxes) { const i = list.findIndex(b => b.id === id); if (i >= 0) { list.splice(i, 1); if (!list.length) boxes.delete(n); return; } } }

    // drawing with the mouse, a pen or a finger
    let drawing = null;
    const sheet = $("sheet");
    sheet.addEventListener("pointerdown", e => {
      if (!src || (e.pointerType === "mouse" && e.button !== 0)) return;
      const hitBox = e.target.closest && e.target.closest(".rbox");
      if (hitBox) { selected = Number(hitBox.dataset.id); layout(); sheet.focus(); e.preventDefault(); return; }
      const r = sheet.getBoundingClientRect();
      drawing = { x0: e.clientX - r.left, y0: e.clientY - r.top, el: document.createElement("div") };
      drawing.el.className = "rbox draw"; $("boxes").append(drawing.el);
      selected = null; sheet.setPointerCapture(e.pointerId); sheet.focus(); e.preventDefault();
    });
    sheet.addEventListener("pointermove", e => {
      if (!drawing) return;
      const r = sheet.getBoundingClientRect(), x = clamp(e.clientX - r.left, 0, r.width), y = clamp(e.clientY - r.top, 0, r.height);
      const l = Math.min(drawing.x0, x), t = Math.min(drawing.y0, y);
      Object.assign(drawing.el.style, { left: l + "px", top: t + "px", width: Math.abs(x - drawing.x0) + "px", height: Math.abs(y - drawing.y0) + "px" });
    });
    const endDraw = e => {
      if (!drawing) return;
      const d = drawing; drawing = null; d.el.remove();
      const r = sheet.getBoundingClientRect(), x = clamp(e.clientX - r.left, 0, r.width), y = clamp(e.clientY - r.top, 0, r.height);
      if (Math.abs(x - d.x0) >= 4 && Math.abs(y - d.y0) >= 4) { const nb = addBox(cur, { x: Math.min(d.x0, x) / sc, y: Math.min(d.y0, y) / sc, w: Math.abs(x - d.x0) / sc, h: Math.abs(y - d.y0) / sc }); if (nb) selected = nb.id; }
      layout(); update();
    };
    sheet.addEventListener("pointerup", endDraw);
    sheet.addEventListener("pointercancel", () => { if (drawing) { drawing.el.remove(); drawing = null; } });
    root.addEventListener("keydown", e => {
      if ((e.key === "Delete" || e.key === "Backspace") && selected != null && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { e.preventDefault(); removeBox(selected); selected = null; layout(); update(); }
    });
    $("delsel").addEventListener("click", () => { if (selected != null) { removeBox(selected); selected = null; layout(); update(); } });
    $("delpage").addEventListener("click", () => { boxes.delete(cur); selected = null; layout(); update(); });
    $("solid").addEventListener("change", () => root.querySelector(".pred").classList.toggle("solid", $("solid").checked));

    /* ---------- finding text ---------- */
    async function textFor(n) {
      if (textCache.has(n)) return textCache.get(n);
      const page = await src.doc.getPage(n), vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent(); page.cleanup();
      const r = { items: tc.items.filter(it => typeof it.str === "string"), vt: vp.transform };
      textCache.set(n, r); return r;
    }
    async function mark(kind, term) {
      if (!src || busy) return;
      if (kind === "text" && !String(term).trim()) { $("found").textContent = "Type a word or phrase first."; return; }
      busy = true; update();
      let total = 0, any = 0; const hitPages = new Set();
      try {
        for (let n = 1; n <= src.pages; n++) {
          if (n % 3 === 0) { setStatus(`Searching page ${n} of ${src.pages}...`); await tick(); }
          const t = await textFor(n); any += t.items.filter(i => i.str.trim()).length;
          for (const idx of findItems(t.items, kind, term)) if (addBox(n, itemRect(t.vt, t.items[idx]))) { total++; hitPages.add(n); }
        }
        searches.push({ kind, term: String(term || "") });
        const what = kind === "text" ? `"${String(term).trim()}"` : PRESET_NAMES[kind];
        $("found").textContent = total ? `Marked ${fmt(total)} place${total === 1 ? "" : "s"} for ${what} on ${fmt(hitPages.size)} page${hitPages.size === 1 ? "" : "s"} (${C.describePages([...hitPages])}).` : (any ? `Nothing found for ${what}, or it is already marked.` : "This PDF has no text to search (it looks like a scan). Draw boxes by hand instead.");
        setStatus(total ? `Marked ${fmt(total)} places.` : "Nothing new to mark.");
      } catch (e) { setStatus("The search failed."); shell.alert(`The text could not be searched. ${e && e.message ? e.message : ""}`.trim()); }
      finally { busy = false; layout(); update(); }
    }

    /* ---------- the plan ---------- */
    function summary() {
      const pages = pagesWithBoxes(), all = $("all").checked;
      return { n: allBoxes(), pages, all, raster: all ? Array.from({ length: src ? src.pages : 0 }, (_, i) => i + 1) : pages };
    }
    function update() {
      $("nboxes").textContent = fmt(allBoxes());
      const go = $("go"), plan = $("plan");
      if (!src) { plan.className = "plan"; plan.textContent = "Open a PDF to begin."; go.disabled = true; return; }
      const s = summary();
      if (!s.n) { plan.className = "plan"; plan.textContent = "No boxes yet. Draw one on the page, or search for text to mark."; go.disabled = true; return; }
      plan.className = "plan";
      const keep = src.pages - s.raster.length;
      plan.textContent = `${fmt(s.n)} box${s.n === 1 ? "" : "es"} on ${fmt(s.pages.length)} page${s.pages.length === 1 ? "" : "s"} (${C.describePages(s.pages)}). ` + (s.all ? "Every page becomes a picture." : `Those pages become pictures; ${keep ? `the other ${fmt(keep)} page${keep === 1 ? " is" : "s are"} copied unchanged.` : "there are no other pages."}`);
      go.disabled = busy;
      layout();
    }

    /* ---------- making the new file ---------- */
    async function rasterPage(n, bx, dpi) {
      const page = await src.doc.getPage(n), base = page.getViewport({ scale: 1 }), { k, reduced } = fitScale(base.width, base.height, dpi);
      const vp = page.getViewport({ scale: k });
      const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
      const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, canvas: cv, viewport: vp }).promise; page.cleanup();
      ctx.fillStyle = "#000";
      for (const b of bx) ctx.fillRect(Math.floor(b.x * k), Math.floor(b.y * k), Math.ceil(b.w * k) + 1, Math.ceil(b.h * k) + 1);   // one pixel more on every side: no sliver is left
      const blob = await new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error("Could not make the picture"))), "image/jpeg", JPEG_Q[dpi] || 0.88));
      cv.width = cv.height = 0;
      return { bytes: new Uint8Array(await blob.arrayBuffer()), w: base.width, h: base.height, reduced };
    }
    const keepDetails = (from, to) => {
      const keep = (get, set) => { const v = get.call(from); if (v) set.call(to, v); };
      keep(from.getTitle, to.setTitle); keep(from.getAuthor, to.setAuthor); keep(from.getSubject, to.setSubject); keep(from.getCreator, to.setCreator);
      const kw = from.getKeywords(); if (kw) to.setKeywords([kw]);
    };
    const showCheck = (cls, lines) => { const c = $("check"); c.hidden = false; c.className = "check " + cls; c.textContent = ""; lines.forEach((t, i) => { const p = document.createElement("div"); p.textContent = t; if (i) p.style.marginTop = "4px"; c.append(p); }); };

    async function go() {
      const s = summary();
      if (!s.n || busy) return;
      busy = true; update(); $("check").hidden = true;
      const P = L(), dpi = Number($("quality").value) || 150, raster = new Set(s.raster);
      let reducedPages = 0;
      try {
        const doc = await P.PDFDocument.load(src.bytes, { updateMetadata: false });
        const out = await P.PDFDocument.create({ updateMetadata: false });
        for (let i = 0; i < src.pages; i++) {
          const n = i + 1;
          if (i % 2 === 0) { setStatus(`Building page ${n} of ${src.pages}...`); await tick(); }
          if (!raster.has(n)) { const [cp] = await out.copyPages(doc, [i]); out.addPage(cp); continue; }
          const r = await rasterPage(n, boxesOf(n), dpi);
          if (r.reduced) reducedPages++;
          const img = await out.embedJpg(r.bytes), pg = out.addPage([r.w, r.h]);
          pg.drawImage(img, { x: 0, y: 0, width: r.w, height: r.h });
        }
        if ($("keepinfo").checked) keepDetails(doc, out);
        out.setProducer("Michel's Tools"); out.setModificationDate(new Date());
        setStatus("Saving...");
        await tick();
        const bytes = await out.save({ updateFieldAppearances: false });

        // check the new file with the reader itself: a redacted page must hold no text at all
        setStatus("Checking the result...");
        const lines = []; let level = "good", leftovers = [];
        const chk = await C.openPdf(bytes);
        try {
          const stillText = [];
          for (const n of s.raster) { const p = await chk.getPage(n), tc = await p.getTextContent(); p.cleanup(); if (tc.items.some(it => typeof it.str === "string" && it.str.trim())) stillText.push(n); }
          if (stillText.length) { showCheck("bad", [`The check failed: page${stillText.length > 1 ? "s" : ""} ${stillText.join(", ")} still hold text. Nothing was saved. Try again with "Turn every page into a picture".`]); setStatus("Not saved: the check failed."); return; }
          lines.push(`Checked in the new file: ${fmt(s.raster.length)} changed page${s.raster.length === 1 ? " holds" : "s hold"} no text any more.`);
          // words and patterns searched for that still appear on pages that were left as they were
          if (!s.all) for (const q of searches) {
            const pgs = [];
            for (let n = 1; n <= chk.numPages; n++) { if (raster.has(n)) continue; const p = await chk.getPage(n), tc = await p.getTextContent(); p.cleanup(); if (findItems(tc.items.filter(it => typeof it.str === "string"), q.kind, q.term).size) pgs.push(n); }
            if (pgs.length) leftovers.push(`${q.kind === "text" ? `"${q.term.trim()}"` : PRESET_NAMES[q.kind]} still appears on page${pgs.length > 1 ? "s" : ""} ${C.describePages(pgs)}, which had no box.`);
          }
        } finally { C.closePdf(chk); }
        if (leftovers.length) { level = "warn"; lines.push(...leftovers, "Go back, mark those pages too (the search covers every page) and save again."); }
        else if (searches.length && !s.all) lines.push("Nothing you searched for appears anywhere else in the file.");
        if (reducedPages) lines.push(`${reducedPages} very large page${reducedPages === 1 ? " was" : "s were"} drawn at a lower resolution to fit in memory.`);
        const name = `${C.baseName(src.name)}-redacted.pdf`;
        C.downloadBlob(new Blob([bytes], { type: "application/pdf" }), name);
        showCheck(level, lines);
        setStatus(`Saved ${name}: ${fmt(out.getPageCount())} pages, ${C.humanSize(bytes.length)}.`);
      } catch (e) {
        setStatus("Could not make the new file.");
        shell.alert(`Could not make the new file. ${e && e.message ? e.message : ""}`.trim());
      } finally { busy = false; update(); }
    }

    /* ---------- wiring ---------- */
    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const f = $("file").files[0]; $("file").value = ""; if (f) openSource(f); });
    $("clear").addEventListener("click", () => { if (!busy) reset(); });
    $("prev").addEventListener("click", () => gotoPage(cur - 1));
    $("next").addEventListener("click", () => gotoPage(cur + 1));
    $("pageno").addEventListener("change", () => gotoPage(Number($("pageno").value)));
    $("mark").addEventListener("click", () => mark("text", $("term").value));
    $("term").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); mark("text", $("term").value); } });
    for (const b of root.querySelectorAll("[data-preset]")) b.addEventListener("click", () => mark(b.dataset.preset, ""));
    $("all").addEventListener("change", update);
    $("go").addEventListener("click", go);
    let rt = 0;
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { if (src && !$("work").hidden) showPage(); }, 150); }).observe($("sheetwrap"));
    C.enableDrop(root.querySelector(".pred"), openSource);
    update();
    return { destroy() { closeSrc(); clearTimeout(rt); } };
  }

  return { init, itemRect, pageTexts, findItems, termRegex, fitScale, PRESETS };
})();
