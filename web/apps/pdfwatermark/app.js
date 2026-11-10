/* Watermark & Page Numbers: stamp text or a picture on chosen pages of a PDF, number the pages, add headers and footers.
   Everything runs in the browser; the PDF is never uploaded. pdf.js draws the preview, pdf-lib edits the file.
   Western text becomes real PDF text; other languages are drawn by the browser as a picture of the text, so every
   script the device has fonts for works (Arabic joins and runs right to left, CJK, Hebrew, Greek, Cyrillic...). */
(window.DesktopApps = window.DesktopApps || {}).pdfwatermark = (() => {
  const C = window.PDFCommon, T = window.PDFText;
  const NEEDS_UNLOCK = "This PDF has a password or restrictions, so it cannot be edited. Remove them first, then open it again.";
  const POSITIONS = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"];

  /* ---------- planning one page (pure given `measure`; also used by the tests) ---------- */

  // spec: what the user chose. pageNo/pages: this page and all chosen pages. W, H: the page as shown, in points.
  // measure(text, size) -> { w, h, ... } in points.  Returns { items } or { error }.
  function planItems(spec, pageNo, pages, W, H, measure) {
    const first = pages[0], last = pages[pages.length - 1];
    if (spec.mode === "mark") {
      const opacity = spec.opacity;
      if (spec.kind === "image") {
        if (!spec.image) return { error: "Choose a picture first." };
        const w = Math.min(W, Math.max(4, W * spec.size / 100)), h = w * spec.image.aspect;
        const pl = T.watermarkPlacements(spec, w, h, W, H);
        if (pl.error) return pl;
        return { items: pl.map(p => ({ kind: "image", w, h, opacity, ...p })) };
      }
      const text = String(spec.text).replace(/[\r\n]+/g, " ").trim();
      if (!text) return { error: "Type the watermark text first." };
      const m = measure(text, spec.size);
      const pl = T.watermarkPlacements(spec, m.w, m.h, W, H);
      if (pl.error) return pl;
      return { items: pl.map(p => ({ kind: "text", text, m, w: m.w, h: m.h, size: spec.size, opacity, ...p })) };
    }
    const fields = [];
    if (spec.mode === "numbers") {
      if (!String(spec.format).trim()) return { error: "Type the text for the page numbers, for example Page {n}." };
      fields.push([spec.pos, spec.format]);
    } else {
      for (const pos of POSITIONS) { const t = spec.fields[pos]; if (t && t.trim()) fields.push([pos, t]); }
      if (!fields.length) return { error: "Type something in at least one header or footer box." };
    }
    const vars = { n: T.numberOn(pageNo, first, spec.start), total: T.numberOn(last, first, spec.start), date: spec.date, filename: spec.filename };
    const items = [];
    for (const [pos, tpl] of fields) {
      const text = T.expand(tpl, vars, spec.digits).replace(/[\r\n]+/g, " ").trim();
      if (!text) continue;
      const m = measure(text, spec.size);
      const c = T.edgeCentre(pos, m.w, m.h, W, H, spec.margin);
      items.push({ kind: "text", text, m, w: m.w, h: m.h, size: spec.size, opacity: 1, cx: c.cx, cy: c.cy, angle: 0 });
    }
    return { items };
  }

  const todayText = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

  /* ---------- the window ---------- */

  function init(root, shell) {
    const $ = id => root.querySelector("#pdfwatermark-" + id);
    const fmt = n => n.toLocaleString();
    const radio = name => root.querySelector(`input[name="pdfwatermark-${name}"]:checked`).value;

    let file = null, bytes = null, history = [];
    let pdfDoc = null, total = 0, cur = 1, vp = null, vpScale = 1;
    let image = null;                       // { canvas, aspect } for a picture watermark
    let seeThrough = null, seeThroughTick = -1;   // the page drawn without its white paper, for the "behind" preview
    let added = 0, busy = false, renderTick = 0, epoch = 0, signed = false, previewQueued = false, resizeTimer = 0, ro = null;

    const setStatus = m => { $("status").textContent = m; };
    const isEncryptedError = e => !!e && ((window.PDFLib && PDFLib.EncryptedPDFError && e instanceof PDFLib.EncryptedPDFError) || e.name === "EncryptedPDFError" || /is encrypted/i.test(String(e.message)));

    /* ---------- reading the controls ---------- */

    function getSpec() {
      const mode = radio("mode");
      const spec = {
        mode, family: $("family").value, bold: $("bold").checked, color: $("color").value, digits: $("digits").value,
        filename: file ? file.name : "", date: todayText(),
      };
      if (mode === "mark") {
        spec.kind = radio("kind"); spec.text = $("text").value; spec.size = Number($("wsize").value); spec.layout = radio("layout");
        spec.angle = Number($("angle").value); spec.gap = Number($("gap").value); spec.opacity = Number($("opacity").value) / 100; spec.image = image; spec.behind = $("behind").checked;
      } else if (mode === "numbers") {
        const f = $("nformat").value;
        spec.format = f === "custom" ? $("ncustom").value : f; spec.pos = $("npos").value;
        const st = Number($("nstart").value.trim()); spec.start = Number.isInteger(st) && st >= 0 && st < 100000 ? st : 1;
        spec.size = Number($("tsize").value); spec.margin = Number($("margin").value);
      } else {
        spec.fields = {};
        for (const [pos, id] of [["top-left", "h-left"], ["top-center", "h-center"], ["top-right", "h-right"], ["bottom-left", "f-left"], ["bottom-center", "f-center"], ["bottom-right", "f-right"]]) spec.fields[pos] = $(id).value;
        spec.start = 1; spec.size = Number($("tsize").value); spec.margin = Number($("margin").value);
      }
      return spec;
    }

    // which controls make sense right now
    function syncControls() {
      const mode = radio("mode"), kind = radio("kind"), layout = radio("layout");
      $("p-mark").hidden = mode !== "mark"; $("p-numbers").hidden = mode !== "numbers"; $("p-header").hidden = mode !== "header";
      $("k-text").hidden = kind !== "text"; $("k-image").hidden = kind !== "image";
      const textual = mode !== "mark" || kind === "text";
      $("textstyle").hidden = !textual;
      $("r-size").hidden = mode === "mark"; $("r-margin").hidden = mode === "mark"; $("r-digits").hidden = mode === "mark";
      $("r-angle").hidden = !(mode === "mark" && layout !== "diagonal"); $("r-gap").hidden = !(mode === "mark" && layout === "tile");
      $("ncustom").hidden = $("nformat").value !== "custom";
      $("pages").hidden = radio("to") !== "custom";
      // the watermark size slider means points for text and a share of the page width for a picture
      const ws = $("wsize");
      const wantImage = kind === "image";
      if (ws.dataset.kind !== kind) {
        ws.dataset.kind = kind;
        ws.min = wantImage ? "5" : "10"; ws.max = wantImage ? "100" : "300"; ws.value = wantImage ? "40" : "72";
        $("wsizelabel").textContent = wantImage ? "Width" : "Size";
      }
      $("wsizeval").textContent = ws.value + (wantImage ? "%" : " pt");
      $("angleval").textContent = $("angle").value + "°"; $("gapval").textContent = $("gap").value + " pt";
      $("opacityval").textContent = $("opacity").value + "%"; $("tsizeval").textContent = $("tsize").value + " pt"; $("marginval").textContent = $("margin").value + " pt";
    }

    /* ---------- measuring text ---------- */

    // for the preview: every text is measured (and drawn) with the browser's own text engine
    function previewMeasure(spec) {
      const cache = new Map();
      return (text, size) => {
        const key = text + "|" + size;
        if (!cache.has(key)) {
          const r = T.renderTextCanvas(text, { family: spec.family, bold: spec.bold, size, color: spec.color, scale: Math.min(6, Math.max(1, vpScale * (window.devicePixelRatio || 1))) });
          cache.set(key, { w: r.w, h: r.h, canvas: r.canvas });
        }
        return cache.get(key);
      };
    }

    /* ---------- the preview ---------- */

    function pagesChosen() { return T.selectPages(radio("to"), $("pages").value, total || 1); }

    function schedulePreview() {
      if (previewQueued) return;
      previewQueued = true;
      requestAnimationFrame(() => { previewQueued = false; drawPreview(); });
    }

    function drawPreview() {
      const cv = $("ovl");
      const ctx = cv.getContext("2d");
      ctx.clearRect(0, 0, cv.width, cv.height);
      $("caption").textContent = "";
      if (!vp || !pdfDoc) return;
      const sel = pagesChosen();
      if (sel.error) return;
      if (!sel.pages.includes(cur)) { $("caption").textContent = `Page ${cur} is not one of the chosen pages, so nothing is added to it.`; return; }
      const spec = getSpec();
      const W = vp.width / vpScale, H = vp.height / vpScale;
      const plan = planItems(spec, cur, sel.pages, W, H, previewMeasure(spec));
      if (plan.error) return;
      const k = cv.width / W;                             // canvas pixels per page point
      const behind = spec.mode === "mark" && spec.behind && seeThrough && seeThroughTick === renderTick;
      for (const it of plan.items) {
        ctx.save();
        ctx.translate(it.cx * k, it.cy * k);
        ctx.rotate(-it.angle * Math.PI / 180);
        ctx.globalAlpha = it.opacity;
        const src = it.kind === "image" ? spec.image.canvas : it.m.canvas;
        ctx.drawImage(src, -it.w * k / 2, -it.h * k / 2, it.w * k, it.h * k);
        ctx.restore();
      }
      if (behind) ctx.drawImage(seeThrough, 0, 0, cv.width, cv.height);   // the page's content over the watermark
      if (spec.mode === "mark" && spec.behind && !behind) ensureSeeThrough();
    }

    // draws the current page again WITHOUT the white paper, so the preview can put the watermark underneath what the page paints
    async function ensureSeeThrough() {
      if (!pdfDoc || !vp || seeThroughTick === renderTick || seeThroughTick === -2) return;
      const my = renderTick;
      seeThroughTick = -2;                                   // being made: do not start it twice
      const page = await pdfDoc.getPage(cur);
      const v = page.getViewport({ scale: vpScale });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cv = document.createElement("canvas");
      cv.width = Math.floor(v.width * dpr); cv.height = Math.floor(v.height * dpr);
      try { await page.render({ canvasContext: cv.getContext("2d"), canvas: cv, viewport: v, background: "rgba(0,0,0,0)", transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise; } catch { /* leave it blank */ }
      page.cleanup();
      if (my !== renderTick) { seeThroughTick = -1; schedulePreview(); return; }   // another page was shown meanwhile: build it for that one
      seeThrough = cv; seeThroughTick = my;
      schedulePreview();
    }

    /* ---------- what will happen ---------- */

    function updatePlan() {
      syncControls();
      const plan = $("plan");
      let text = "", bad = false, ok = false;
      if (!pdfDoc) text = "Open a PDF to begin.";
      else {
        const sel = pagesChosen();
        if (sel.error) { text = sel.error; bad = true; }
        else {
          const spec = getSpec();
          // check the choices on a page that is chosen, with a stand-in measurer
          const test = planItems(spec, sel.pages[0], sel.pages, 600, 800, (t, s) => ({ w: Math.max(10, t.length * s * 0.5), h: s * 1.2 }));
          if (test.error) { text = test.error; bad = true; }
          else {
            const what = spec.mode === "mark" ? (spec.behind ? "the watermark behind the page content" : "the watermark") : spec.mode === "numbers" ? "page numbers" : "the header and footer";
            text = `Will add ${what} to ${fmt(sel.pages.length)} page${sel.pages.length === 1 ? "" : "s"}: ${C.describePages(sel.pages)}.`;
            ok = true;
          }
        }
      }
      plan.textContent = text; plan.classList.toggle("bad", bad);
      $("go").disabled = busy || !ok;
      schedulePreview();
    }

    function updateButtons() {
      const has = !!pdfDoc;
      $("undo").disabled = busy || !history.length;
      $("download").disabled = busy || !has || added === 0;
      $("pageno").disabled = !has; $("prev1").disabled = !has || cur <= 1; $("next1").disabled = !has || cur >= total;
      $("added").textContent = fmt(added);
      updatePlan();
    }

    /* ---------- the page preview ---------- */

    async function showPage(n) {
      if (!pdfDoc) return;
      const my = ++renderTick;
      cur = Math.min(Math.max(1, n), total);
      const page = await pdfDoc.getPage(cur);
      const base = page.getViewport({ scale: 1 });
      const avail = Math.max(240, $("stage").clientWidth - 26), availH = Math.max(220, $("stage").clientHeight - 26);
      const scale = Math.min(avail / base.width, availH / base.height, 3);       // the whole page fits in view
      const v = page.getViewport({ scale });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const canvas = $("page"), ovl = $("ovl");
      canvas.width = Math.floor(v.width * dpr); canvas.height = Math.floor(v.height * dpr);
      canvas.style.width = Math.floor(v.width) + "px"; canvas.style.height = Math.floor(v.height) + "px";
      ovl.width = canvas.width; ovl.height = canvas.height; ovl.style.width = canvas.style.width; ovl.style.height = canvas.style.height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      try { await page.render({ canvasContext: ctx, canvas, viewport: v, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise; } catch { /* a page that cannot be drawn stays blank */ }
      page.cleanup();
      if (my !== renderTick) return;
      vp = v; vpScale = scale;
      $("pageno").value = String(cur);
      $("prev1").disabled = cur <= 1; $("next1").disabled = cur >= total;
      drawPreview();
    }

    /* ---------- opening ---------- */

    function clearDoc() {
      epoch++; renderTick++;
      if (pdfDoc) { C.closePdf(pdfDoc); pdfDoc = null; }
      file = bytes = null; history = []; total = 0; cur = 1; vp = null; added = 0; signed = false;
    }

    function reset() {
      clearDoc();
      $("file").value = ""; $("name").textContent = "";
      $("sheet").hidden = true; $("empty").hidden = false; $("signedwarn").hidden = true;
      $("total").textContent = "0"; $("pageno").value = "1"; $("caption").textContent = "";
      setStatus("Ready"); updateButtons();
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
      try { doc = await C.openPdf(data); }
      catch (e) {
        if (e && e.name === "PasswordException") { setStatus("Password-protected PDF."); shell.alert(NEEDS_UNLOCK); }
        else { setStatus("Could not open the PDF."); shell.alert(`This file could not be read as a PDF. ${e && e.message ? e.message : ""}`.trim()); }
        return;
      }
      if (my !== epoch) { C.closePdf(doc); return; }
      if (raw.hasEncryptKey) {
        try { await PDFLib.PDFDocument.load(data, { updateMetadata: false }); }
        catch (e) { if (isEncryptedError(e)) { C.closePdf(doc); setStatus("Restricted PDF."); shell.alert(NEEDS_UNLOCK); return; } }
      }
      file = f; bytes = data; pdfDoc = doc; total = doc.numPages; cur = 1; added = 0; signed = raw.byteRanges > 0;
      $("signedwarn").hidden = !signed;
      $("name").textContent = `${f.name} (${C.humanSize(f.size)})`;
      $("total").textContent = fmt(total);
      $("empty").hidden = true; $("sheet").hidden = false;
      await showPage(1);
      updateButtons();
      setStatus(`${f.name}: ${fmt(total)} page${total === 1 ? "" : "s"}.${f.size > C.WARN_BYTES ? " This is a large file, so it may take a while." : ""}`);
    }

    /* ---------- a picture watermark ---------- */

    async function loadImage() {
      const f = $("imgfile").files[0];
      if (!f) { image = null; $("imgname").textContent = ""; updatePlan(); return; }
      $("imgname").textContent = f.name;
      if (f.size > 15 * 1024 * 1024) { $("imgfile").value = ""; $("imgname").textContent = ""; image = null; shell.alert(`This picture is ${C.humanSize(f.size)}. The limit is ${C.humanSize(15 * 1024 * 1024)}.`); updatePlan(); return; }
      try {
        const c = await C.imageToCanvas(f);
        if ($("white").checked) C.whiteToAlpha(c);
        const t = C.trimCanvas(c, 2) || c;
        image = { canvas: t, aspect: t.height / t.width };
      } catch {
        $("imgfile").value = ""; $("imgname").textContent = ""; image = null;
        shell.alert("That file could not be read as a picture. Try a PNG or JPG.");
      }
      updatePlan();
    }

    /* ---------- editing the file ---------- */

    async function apply() {
      if (busy) return;
      const sel = pagesChosen();
      if (sel.error) return;
      const spec = getSpec();
      busy = true; updateButtons();
      try {
        setStatus("Adding...");
        let doc;
        try { doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false }); }
        catch (e) { if (isEncryptedError(e)) throw Object.assign(new Error(NEEDS_UNLOCK), { friendly: true }); throw e; }
        const textual = spec.mode !== "mark" || spec.kind === "text";
        const font = textual ? await doc.embedFont(PDFLib.StandardFonts[T.FONTS[spec.family][spec.bold ? "pdfBold" : "pdf"]]) : null;
        const rgbColor = PDFLib.rgb(...T.rgb01(spec.color));
        let picture = null;
        if (spec.mode === "mark" && spec.kind === "image") picture = await doc.embedPng(await C.canvasPng(spec.image.canvas));
        const rasters = new Map();
        const measure = (text, size) => {
          if (T.vectorOk(font, text)) { const h = font.heightAtSize(size); return { w: font.widthOfTextAtSize(text, size), h, d: h - font.heightAtSize(size, { descender: false }), vector: true }; }
          const r = T.renderTextCanvas(text, { family: spec.family, bold: spec.bold, size, color: spec.color, scale: 4 });
          return { w: r.w, h: r.h, canvas: r.canvas, vector: false };
        };
        let n = 0;
        for (const p of sel.pages) {
          const page = await pdfDoc.getPage(p);
          const v = page.getViewport({ scale: 1 });
          const plan = planItems(spec, p, sel.pages, v.width, v.height, measure);
          page.cleanup();
          if (plan.error) throw Object.assign(new Error(plan.error), { friendly: true });
          const target = doc.getPage(p - 1);
          for (const it of plan.items) {
            const turn = (v.rotation || 0) + it.angle;                       // the page's own turn plus the item's
            const opts = it.opacity < 1 ? { opacity: it.opacity } : {};
            if (it.kind === "text" && it.m.vector) {
              const pt = T.turned(it.cx, it.cy, -it.w / 2, it.h / 2 - it.m.d, it.angle);    // the start of the text's baseline
              const [x, y] = v.convertToPdfPoint(pt.x, pt.y);
              target.drawText(it.text, { x, y, size: it.size, font, color: rgbColor, rotate: PDFLib.degrees(turn), ...opts });
            } else {
              let img = picture;
              if (it.kind === "text") {                                          // text in another script: a picture of it
                const key = `${it.text}|${it.size}`;
                if (!rasters.has(key)) rasters.set(key, await doc.embedPng(await C.canvasPng(it.m.canvas)));
                img = rasters.get(key);
              }
              const bl = T.bottomLeft(it.cx, it.cy, it.w, it.h, it.angle);
              const [x, y] = v.convertToPdfPoint(bl.x, bl.y);
              target.drawImage(img, { x, y, width: it.w, height: it.h, rotate: PDFLib.degrees(turn), ...opts });
            }
          }
          if (spec.mode === "mark" && spec.behind) {
            // pdf-lib keeps the page's content as [q, original..., Q, our drawing]. Put our drawing first so everything the page paints covers it.
            const contents = target.node.Contents();
            if (contents instanceof PDFLib.PDFArray && contents.size() > 1) { const last = contents.get(contents.size() - 1); contents.remove(contents.size() - 1); contents.insert(0, last); }
          }
          if (++n % 25 === 0) { setStatus(`Adding... ${fmt(n)} of ${fmt(sel.pages.length)} pages`); await new Promise(r => setTimeout(r, 0)); }
        }
        doc.setModificationDate(new Date());
        doc.setProducer("Michel's Tools");
        const out = await doc.save();
        history.push({ bytes, added });
        while (history.length > 8 || history.reduce((s, h) => s + h.bytes.length, 0) > 300 * 1024 * 1024) history.shift();
        bytes = out; added += sel.pages.length;
        if (pdfDoc) C.closePdf(pdfDoc);
        pdfDoc = await C.openPdf(bytes);
        total = pdfDoc.numPages;
        await showPage(Math.min(cur, total));
        setStatus(`Added to ${fmt(sel.pages.length)} page${sel.pages.length === 1 ? "" : "s"}. Use Download PDF to save the result.`);
      } catch (e) {
        setStatus("Could not add it.");
        shell.alert(e && e.friendly ? e.message : `Could not add it. ${e && e.message ? e.message : ""}`.trim());
      } finally { busy = false; updateButtons(); }
    }

    async function undo() {
      if (!history.length || busy) return;
      busy = true; updateButtons();
      try {
        const prev = history.pop();
        bytes = prev.bytes; added = prev.added;
        if (pdfDoc) C.closePdf(pdfDoc);
        pdfDoc = await C.openPdf(bytes); total = pdfDoc.numPages;
        await showPage(Math.min(cur, total));
        setStatus("Undid the last addition.");
      } catch (e) { shell.alert(`Could not undo. ${e && e.message ? e.message : ""}`.trim()); }
      finally { busy = false; updateButtons(); }
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
    $("undo").addEventListener("click", undo);
    $("download").addEventListener("click", download);
    $("go").addEventListener("click", apply);
    $("pickimg").addEventListener("click", () => $("imgfile").click());
    $("imgfile").addEventListener("change", loadImage);
    $("white").addEventListener("change", loadImage);
    // everything else just refreshes the plan and the preview
    root.querySelectorAll("input, select").forEach(el => {
      if (el.type === "file") return;
      el.addEventListener("input", updatePlan);
      el.addEventListener("change", updatePlan);
    });
    $("prev1").addEventListener("click", () => showPage(cur - 1));
    $("next1").addEventListener("click", () => showPage(cur + 1));
    const goTo = () => { const n = Number($("pageno").value.trim()); if (Number.isInteger(n) && n >= 1 && n <= total) showPage(n); else $("pageno").value = String(cur); };
    $("pageno").addEventListener("change", goTo);
    $("pageno").addEventListener("keydown", e => { if (e.key === "Enter") goTo(); });
    C.enableDrop($("content"), f => openFile(f));
    if ("ResizeObserver" in window) {
      ro = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (pdfDoc && !busy) showPage(cur); }, 200); });
      ro.observe($("stage"));
    }

    updateButtons();
    return { destroy() { clearDoc(); clearTimeout(resizeTimer); if (ro) ro.disconnect(); } };
  }

  return { init, planItems, todayText };
})();
