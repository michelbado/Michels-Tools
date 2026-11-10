/* Add Image / Signature (not a digital signature).
   Puts a picture on pages of a PDF: a drawn signature, a typed name or a picture file.
   Everything runs in the browser; the PDF is never uploaded. pdf.js draws the preview, pdf-lib edits the file. */
(window.DesktopApps = window.DesktopApps || {}).pdfstamp = (() => {
  const C = window.PDFCommon;

  const FONTS = [
    { label: "Handwriting", css: '"Segoe Script","Bradley Hand","Lucida Handwriting","Comic Sans MS",cursive', style: "" },
    { label: "Flowing script", css: '"Brush Script MT","Snell Roundhand","Apple Chancery","URW Chancery L","Z003",cursive', style: "" },
    { label: "Classic italic", css: 'Georgia,"Times New Roman",serif', style: "italic" },
    { label: "Simple", css: 'Arial,Helvetica,sans-serif', style: "" },
  ];
  const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
  const MAX_IMAGE_SIDE = 1600;
  const NEEDS_UNLOCK = "This PDF has a password or restrictions, so it cannot be edited. Remove them first, then open it again.";

  /* ---------- geometry (pure; also used by the tests) ---------- */

  // fractions of the displayed page: fx, fy = top-left corner, fw = width. aspect = image height / width.
  // Keeps the image inside a page of displayed size W x H and returns it in page units.
  function placeOnPage(place, aspect, W, H) {
    let w = Math.max(1, place.fw * W), h = w * aspect;
    if (w > W) { w = W; h = w * aspect; }
    if (h > H) { h = H; w = h / aspect; }
    const x = Math.min(Math.max(place.fx * W, 0), W - w);
    const y = Math.min(Math.max(place.fy * H, 0), H - h);
    return { x, y, w, h };
  }

  // the same place, kept legal as fractions (used while dragging)
  function clampPlace(place, aspect, W, H) {
    const maxFw = Math.min(1, (1 / aspect) * (H / W));
    const fw = Math.min(Math.max(place.fw, 0.03), maxFw);
    const fh = fw * aspect * (W / H);
    return { fw, fx: Math.min(Math.max(place.fx, 0), 1 - fw), fy: Math.min(Math.max(place.fy, 0), 1 - fh) };
  }

  // which pages a choice means -> { pages } or { error }
  function targetPages(mode, cur, total, text) {
    if (mode === "current") return { pages: [cur] };
    if (mode === "all") return { pages: Array.from({ length: total }, (_, i) => i + 1) };
    if (mode === "first") return { pages: [1] };
    if (mode === "last") return { pages: [total] };
    if (!String(text).trim()) return { error: "Enter the page numbers, for example 1,3,5-8." };
    const r = C.parseRanges(text, total);
    if (r.error) return { error: r.error };
    return { pages: r.pages.slice().sort((a, b) => a - b) };
  }

  // the rectangle (display units, y down, from the top-left) -> what pdf-lib needs for drawImage on that page
  function drawArgs(viewport, rect) {
    const [x, y] = viewport.convertToPdfPoint(rect.x, rect.y + rect.h);     // the image's bottom-left corner
    return { x, y, width: rect.w, height: rect.h, rotate: viewport.rotation || 0 };
  }

  /* ---------- turning pictures into a stamp (needs canvas) ---------- */

  function trimCanvas(src, pad = 6) {
    const ctx = src.getContext("2d");
    const { width: w, height: h } = src;
    const d = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    }
    if (x1 < 0) return null;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const out = document.createElement("canvas");
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext("2d").drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  // light pixels become see-through, so a photo of a signature on white paper can sit on top of a page
  function whiteToAlpha(canvas) {
    const ctx = canvas.getContext("2d");
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const m = Math.min(d[i], d[i + 1], d[i + 2]);
      const keep = Math.min(1, Math.max(0, (246 - m) / 70));
      d[i + 3] = Math.round(d[i + 3] * keep);
    }
    ctx.putImageData(img, 0, 0);
  }

  const pngBytes = canvas => new Promise((res, rej) => canvas.toBlob(async b => (b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error("Could not make the image"))), "image/png"));

  /* ---------- the window ---------- */

  function init(root, shell) {
    const $ = id => root.querySelector("#pdfstamp-" + id);
    const fmt = n => n.toLocaleString();
    const radio = name => root.querySelector(`input[name="pdfstamp-${name}"]:checked`).value;

    let file = null, bytes = null, history = [];
    let pdfDoc = null, total = 0, cur = 1, vp = null;
    let stamp = null;                    // { canvas, w, h }
    let place = { fx: 0.55, fy: 0.78, fw: 0.3 };
    let added = 0, busy = false, renderTick = 0, epoch = 0, signed = false;
    let resizeTimer = 0, ro = null;

    const setStatus = m => { $("status").textContent = m; };

    /* ---------- the stamp ---------- */

    function setStamp(canvas, note) {
      stamp = canvas ? { canvas, w: canvas.width, h: canvas.height } : null;
      const prev = $("prev");
      if (stamp) {
        prev.width = stamp.w; prev.height = stamp.h;
        const pc = prev.getContext("2d"); pc.clearRect(0, 0, prev.width, prev.height); pc.drawImage(canvas, 0, 0);
        $("prevnote").textContent = note || "This is what will be added.";
        const o = $("ovlc"); o.width = stamp.w; o.height = stamp.h;
        const oc = o.getContext("2d"); oc.clearRect(0, 0, o.width, o.height); oc.drawImage(canvas, 0, 0);
      } else {
        prev.width = 10; prev.height = 10;
        $("prevnote").textContent = note || "Nothing to add yet.";
      }
      $("size").disabled = !stamp;
      layoutOverlay();
      ensureVisible();
      updatePlan();
    }

    /* drawing */
    const pad = $("pad"), pctx = pad.getContext("2d", { willReadFrequently: true });
    pctx.lineCap = "round"; pctx.lineJoin = "round";
    let drawing = false, pts = [];
    const penColor = () => root.querySelector('input[name="pdfstamp-pen"]:checked').value;
    const padPoint = e => { const r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * pad.width / r.width, y: (e.clientY - r.top) * pad.height / r.height }; };
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    function strokeStyle() { pctx.strokeStyle = pctx.fillStyle = penColor(); pctx.lineWidth = Number($("width").value) * (pad.width / 450); }
    pad.addEventListener("pointerdown", e => {
      if (e.button !== undefined && e.button > 0) return;
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      drawing = true; strokeStyle();
      const p = padPoint(e); pts = [p];
      pctx.beginPath(); pctx.arc(p.x, p.y, pctx.lineWidth / 2, 0, Math.PI * 2); pctx.fill();
    });
    pad.addEventListener("pointermove", e => {
      if (!drawing) return;
      const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [e];
      for (const ev of list.length ? list : [e]) {
        const p = padPoint(ev); pts.push(p);
        const n = pts.length;
        pctx.beginPath();
        if (n >= 3) { const m0 = mid(pts[n - 3], pts[n - 2]), m1 = mid(pts[n - 2], pts[n - 1]); pctx.moveTo(m0.x, m0.y); pctx.quadraticCurveTo(pts[n - 2].x, pts[n - 2].y, m1.x, m1.y); }
        else { pctx.moveTo(pts[n - 2].x, pts[n - 2].y); pctx.lineTo(p.x, p.y); }
        pctx.stroke();
      }
    });
    const endStroke = () => { if (!drawing) return; drawing = false; updateFromPad(); };
    pad.addEventListener("pointerup", endStroke);
    pad.addEventListener("pointercancel", endStroke);
    function updateFromPad() {
      const t = trimCanvas(pad);
      setStamp(t, t ? "This is what will be added." : "Draw your signature above.");
    }
    function erasePad() { pctx.clearRect(0, 0, pad.width, pad.height); updateFromPad(); }

    /* typing */
    FONTS.forEach((f, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = f.label; $("font").append(o); });
    function updateFromText() {
      const text = $("text").value.trim();
      if (!text) { setStamp(null, "Type your name above."); return; }
      const f = FONTS[Number($("font").value)] || FONTS[0];
      const size = 180;
      const c = document.createElement("canvas");
      let ctx = c.getContext("2d", { willReadFrequently: true });
      const font = `${f.style} ${size}px ${f.css}`.trim();
      ctx.font = font;
      c.width = Math.min(6000, Math.ceil(ctx.measureText(text).width) + 80);
      c.height = Math.ceil(size * 1.7);
      ctx = c.getContext("2d", { willReadFrequently: true });   // resizing a canvas resets its state
      ctx.font = font; ctx.textBaseline = "alphabetic"; ctx.fillStyle = $("tcolor").value;
      ctx.fillText(text, 40, size * 1.2);
      setStamp(trimCanvas(c), "This is what will be added.");
    }

    /* a picture file */
    async function updateFromImage() {
      const f = $("imgfile").files[0];
      if (!f) { setStamp(null, "Choose a picture."); return; }
      $("imgname").textContent = f.name;
      if (f.size > MAX_IMAGE_BYTES) { $("imgfile").value = ""; $("imgname").textContent = ""; setStamp(null, "That picture is too big."); shell.alert(`This picture is ${C.humanSize(f.size)}. The limit is ${C.humanSize(MAX_IMAGE_BYTES)}.`); return; }
      try {
        const bmp = await createImageBitmap(f);
        const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
        c.getContext("2d", { willReadFrequently: true }).drawImage(bmp, 0, 0, c.width, c.height);
        if (bmp.close) bmp.close();
        if ($("white").checked) whiteToAlpha(c);
        const t = trimCanvas(c, 2) || c;
        setStamp(t, "This is what will be added.");
      } catch {
        $("imgfile").value = ""; $("imgname").textContent = "";
        setStamp(null, "That file could not be read as a picture.");
        shell.alert("That file could not be read as a picture. Try a PNG or JPG.");
      }
    }

    function refreshSource() {
      const m = radio("src");
      $("p-draw").hidden = m !== "draw"; $("p-type").hidden = m !== "type"; $("p-image").hidden = m !== "image";
      if (m === "draw") updateFromPad(); else if (m === "type") updateFromText(); else updateFromImage();
    }

    /* ---------- opening a file ---------- */

    function clearDoc() {
      epoch++; renderTick++;
      if (pdfDoc) { C.closePdf(pdfDoc); pdfDoc = null; }
      file = bytes = null; history = []; total = 0; cur = 1; vp = null; added = 0; signed = false;
    }

    function reset() {
      clearDoc();
      $("file").value = ""; $("name").textContent = "";
      $("sheet").hidden = true; $("empty").hidden = false; $("signedwarn").hidden = true;
      $("total").textContent = "0"; $("pageno").value = "1";
      setStatus("Ready"); updateAll();
    }

    async function openFile(f) {
      if (busy) return;
      clearDoc();
      const my = epoch;
      setStatus("Reading the file...");
      let data;
      try { data = await C.readFile(f); } catch (e) { setStatus("Could not read the file."); shell.alert(e.message); return; }
      const raw = C.scanRaw(data);
      if (!raw.header) { setStatus("Not a PDF."); shell.alert(`"${f.name}" does not look like a PDF file.`); return; }
      let doc;
      try {
        doc = await C.openPdf(data);
      } catch (e) {
        if (e && e.name === "PasswordException") { setStatus("Password-protected PDF."); shell.alert(NEEDS_UNLOCK); }
        else { setStatus("Could not open the PDF."); shell.alert(`This file could not be read as a PDF. ${e && e.message ? e.message : ""}`.trim()); }
        return;
      }
      if (my !== epoch) { C.closePdf(doc); return; }
      if (raw.hasEncryptKey) {           // opens for reading but may still refuse to be edited
        try { await PDFLib.PDFDocument.load(data, { updateMetadata: false }); }
        catch (e) { if (isEncryptedError(e)) { C.closePdf(doc); setStatus("Restricted PDF."); shell.alert(NEEDS_UNLOCK); return; } }
      }
      file = f; bytes = data; pdfDoc = doc; total = doc.numPages; cur = 1; added = 0;
      signed = raw.byteRanges > 0;
      $("signedwarn").hidden = !signed;
      $("name").textContent = `${f.name} (${C.humanSize(f.size)})`;
      $("total").textContent = fmt(total);
      $("empty").hidden = true; $("sheet").hidden = false;
      await showPage(1);
      updateAll();
      setStatus(`${f.name}: ${fmt(total)} page${total === 1 ? "" : "s"}.${f.size > C.WARN_BYTES ? " This is a large file, so it may take a while." : ""}`);
    }

    const isEncryptedError = e => !!e && ((window.PDFLib && PDFLib.EncryptedPDFError && e instanceof PDFLib.EncryptedPDFError) || e.name === "EncryptedPDFError" || /is encrypted/i.test(String(e.message)));

    /* ---------- the page preview ---------- */

    async function showPage(n) {
      if (!pdfDoc) return;
      const my = ++renderTick;
      cur = Math.min(Math.max(1, n), total);
      const page = await pdfDoc.getPage(cur);
      const base = page.getViewport({ scale: 1 });
      const avail = Math.max(240, $("stage").clientWidth - 26);
      const scale = Math.min(avail / base.width, 3);
      const v = page.getViewport({ scale });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const canvas = $("page");
      canvas.width = Math.floor(v.width * dpr); canvas.height = Math.floor(v.height * dpr);
      canvas.style.width = Math.floor(v.width) + "px"; canvas.style.height = Math.floor(v.height) + "px";
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      try { await page.render({ canvasContext: ctx, canvas, viewport: v, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise; } catch { /* a page that cannot be drawn stays blank */ }
      page.cleanup();
      if (my !== renderTick) return;
      vp = v;
      $("pageno").value = String(cur);
      $("prev1").disabled = cur <= 1; $("next1").disabled = cur >= total;
      layoutOverlay();
      ensureVisible();
      updatePlan();
    }

    function layoutOverlay() {
      const ovl = $("ovl");
      if (!vp || !stamp) { ovl.hidden = true; return; }
      const aspect = stamp.h / stamp.w;
      place = clampPlace(place, aspect, vp.width, vp.height);
      ovl.hidden = false;
      ovl.style.left = place.fx * vp.width + "px"; ovl.style.top = place.fy * vp.height + "px";
      ovl.style.width = place.fw * vp.width + "px"; ovl.style.height = place.fw * vp.width * aspect + "px";
      $("size").value = String(Math.round(place.fw * 100)); $("sizeval").textContent = Math.round(place.fw * 100) + "%";
    }

    // bring the image into view inside the preview (only the preview scrolls, never the desktop)
    function ensureVisible() {
      const stage = $("stage"), ovl = $("ovl"), sheet = $("sheet");
      if (ovl.hidden || sheet.hidden) return;
      const top = sheet.offsetTop + ovl.offsetTop, bottom = top + ovl.offsetHeight;
      if (top < stage.scrollTop || bottom > stage.scrollTop + stage.clientHeight) stage.scrollTop = Math.max(0, top - (stage.clientHeight - ovl.offsetHeight) / 2);
    }

    /* moving and resizing the image on the page */
    let drag = null;
    $("ovl").addEventListener("pointerdown", e => {
      if (e.button !== undefined && e.button > 0) return;
      e.preventDefault();
      const handle = e.target === $("handle");
      $("ovl").setPointerCapture(e.pointerId);
      $("ovl").focus();
      drag = { handle, px: e.clientX, py: e.clientY, start: { ...place } };
    });
    $("ovl").addEventListener("pointermove", e => {
      if (!drag || !vp || !stamp) return;
      const dx = (e.clientX - drag.px) / vp.width, dy = (e.clientY - drag.py) / vp.height;
      const aspect = stamp.h / stamp.w;
      place = clampPlace(drag.handle ? { ...drag.start, fw: drag.start.fw + dx } : { ...drag.start, fx: drag.start.fx + dx, fy: drag.start.fy + dy }, aspect, vp.width, vp.height);
      layoutOverlay();
    });
    const endDrag = () => { drag = null; };
    $("ovl").addEventListener("pointerup", endDrag);
    $("ovl").addEventListener("pointercancel", endDrag);
    $("ovl").addEventListener("keydown", e => {
      if (!vp || !stamp) return;
      const step = e.shiftKey ? 0.02 : 0.005, aspect = stamp.h / stamp.w;
      const next = { ...place };
      if (e.key === "ArrowLeft") next.fx -= step; else if (e.key === "ArrowRight") next.fx += step;
      else if (e.key === "ArrowUp") next.fy -= step; else if (e.key === "ArrowDown") next.fy += step;
      else if (e.key === "+" || e.key === "=") next.fw += step; else if (e.key === "-") next.fw -= step;
      else return;
      e.preventDefault();
      place = clampPlace(next, aspect, vp.width, vp.height);
      layoutOverlay();
    });
    $("size").addEventListener("input", () => {
      if (!vp || !stamp) return;
      place = clampPlace({ ...place, fw: Number($("size").value) / 100 }, stamp.h / stamp.w, vp.width, vp.height);
      layoutOverlay();
    });

    /* ---------- what will happen ---------- */

    function currentTargets() {
      if (!pdfDoc) return { empty: "Open a PDF to begin." };
      if (!stamp) return { empty: "Make your signature or image first (step 1)." };
      const r = targetPages(radio("to"), cur, total, $("pages").value);
      return r.error ? { error: r.error } : r;
    }

    function updatePlan() {
      $("pages").hidden = radio("to") !== "custom";
      const t = currentTargets();
      const plan = $("plan");
      plan.classList.toggle("bad", !!t.error);
      if (t.error) plan.textContent = t.error;
      else if (t.empty) plan.textContent = t.empty;
      else plan.textContent = `Will add the image to ${fmt(t.pages.length)} page${t.pages.length === 1 ? "" : "s"}: ${C.describePages(t.pages)}.`;
      $("go").disabled = busy || !t.pages;
    }

    function updateAll() {
      const has = !!pdfDoc;
      $("undo").disabled = busy || !history.length;
      $("download").disabled = busy || !has || added === 0;
      $("pageno").disabled = !has; $("prev1").disabled = !has || cur <= 1; $("next1").disabled = !has || cur >= total;
      $("added").textContent = fmt(added);
      updatePlan();
    }

    /* ---------- editing the file ---------- */

    async function apply() {
      const t = currentTargets();
      if (!t.pages || busy) return;
      busy = true; updateAll();
      try {
        setStatus("Adding the image...");
        let doc;
        try { doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false }); }
        catch (e) { if (isEncryptedError(e)) throw Object.assign(new Error(NEEDS_UNLOCK), { friendly: true }); throw e; }
        const img = await doc.embedPng(await pngBytes(stamp.canvas));
        const aspect = stamp.h / stamp.w;
        for (const n of t.pages) {
          const page = await pdfDoc.getPage(n);
          const v = page.getViewport({ scale: 1 });
          const rect = placeOnPage(place, aspect, v.width, v.height);
          const a = drawArgs(v, rect);
          doc.getPage(n - 1).drawImage(img, { x: a.x, y: a.y, width: a.width, height: a.height, rotate: PDFLib.degrees(a.rotate) });
          page.cleanup();
        }
        doc.setModificationDate(new Date());
        doc.setProducer("Michel's Tools");
        const out = await doc.save();
        history.push({ bytes, added });
        while (history.length > 8 || history.reduce((s, h) => s + h.bytes.length, 0) > 300 * 1024 * 1024) history.shift();
        bytes = out; added += t.pages.length;
        await reopen();
        setStatus(`Added the image to ${fmt(t.pages.length)} page${t.pages.length === 1 ? "" : "s"}. Use Download PDF to save the result.`);
      } catch (e) {
        setStatus("Could not add the image.");
        shell.alert(e && e.friendly ? e.message : `Could not add the image. ${e && e.message ? e.message : ""}`.trim());
      } finally {
        busy = false; updateAll();
      }
    }

    // after the bytes changed: load them into the preview again, on the same page
    async function reopen() {
      if (pdfDoc) C.closePdf(pdfDoc);
      pdfDoc = await C.openPdf(bytes);
      total = pdfDoc.numPages;
      await showPage(Math.min(cur, total));
    }

    async function undo() {
      if (!history.length || busy) return;
      busy = true; updateAll();
      try {
        const prev = history.pop();
        bytes = prev.bytes; added = prev.added;
        await reopen();
        setStatus("Undid the last addition.");
      } catch (e) { shell.alert(`Could not undo. ${e && e.message ? e.message : ""}`.trim()); }
      finally { busy = false; updateAll(); }
    }
    function download() {
      if (!bytes) return;
      const name = `${C.baseName(file.name)}-edited.pdf`;
      C.downloadBlob(new Blob([bytes], { type: "application/pdf" }), name);
      setStatus(`Saved ${name} (${C.humanSize(bytes.length)}).`);
    }

    /* ---------- wiring ---------- */

    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const f = $("file").files[0]; if (f) openFile(f); });
    $("clear").addEventListener("click", () => { if (!busy) reset(); });
    root.querySelectorAll('input[name="pdfstamp-src"]').forEach(r => r.addEventListener("change", refreshSource));
    root.querySelectorAll('input[name="pdfstamp-to"]').forEach(r => r.addEventListener("change", updatePlan));
    root.querySelectorAll('input[name="pdfstamp-pen"]').forEach(r => r.addEventListener("change", () => { /* applies to the next stroke */ }));
    $("padclear").addEventListener("click", erasePad);
    $("text").addEventListener("input", updateFromText);
    $("font").addEventListener("change", updateFromText);
    $("tcolor").addEventListener("change", updateFromText);
    $("pickimg").addEventListener("click", () => $("imgfile").click());
    $("imgfile").addEventListener("change", updateFromImage);
    $("white").addEventListener("change", updateFromImage);
    $("pages").addEventListener("input", updatePlan);
    $("prev1").addEventListener("click", () => showPage(cur - 1));
    $("next1").addEventListener("click", () => showPage(cur + 1));
    const goTo = () => { const n = Number($("pageno").value.trim()); if (Number.isInteger(n) && n >= 1 && n <= total) showPage(n); else $("pageno").value = String(cur); };
    $("pageno").addEventListener("change", goTo);
    $("pageno").addEventListener("keydown", e => { if (e.key === "Enter") goTo(); });
    $("go").addEventListener("click", apply);
    $("undo").addEventListener("click", undo);
    $("download").addEventListener("click", download);
    C.enableDrop($("content"), f => openFile(f));
    if ("ResizeObserver" in window) {
      ro = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (pdfDoc && !busy) showPage(cur); }, 200); });
      ro.observe($("stage"));
    }

    refreshSource();
    updateAll();
    return { destroy() { clearDoc(); clearTimeout(resizeTimer); if (ro) ro.disconnect(); } };
  }

  return { init, placeOnPage, clampPlace, targetPages, drawArgs, whiteToAlpha, trimCanvas, FONTS };
})();
