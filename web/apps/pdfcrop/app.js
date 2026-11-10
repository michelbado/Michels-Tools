/* Crop / Resize Pages: cut margins off pages (by hand or automatically) or change the page size.
   Everything runs in the browser; the file is never uploaded. pdf.js draws the preview, pdf-lib writes the new file.
   Cropping sets the page's visible area; the cut-away part is hidden, NOT erased from the file. */
(window.DesktopApps = window.DesktopApps || {}).pdfcrop = (() => {
  const C = window.PDFCommon;
  const MM = 72 / 25.4;
  const UNITS = { mm: MM, in: 72, pt: 1 };
  const SIZES_MM = { a3: [297, 420], a4: [210, 297], a5: [148, 210], letter: [215.9, 279.4], legal: [215.9, 355.6] };
  const MIN_LEFT = 10;                    // points that must remain of a cropped page
  const NAMES = { a3: "A3", a4: "A4", a5: "A5", letter: "US Letter", legal: "US Legal", custom: "your size" };

  /* ---------- pure helpers (also used by the tests) ---------- */

  const normRot = a => ((((Math.round((Number(a) || 0) / 90) * 90) % 360) + 360) % 360);
  // the part of a page people see: the crop box inside the media box. Boxes are { x, y, width, height }
  function visibleBox(media, crop) {
    if (!crop) return { ...media };
    const x0 = Math.max(media.x, crop.x), y0 = Math.max(media.y, crop.y);
    const x1 = Math.min(media.x + media.width, crop.x + crop.width), y1 = Math.min(media.y + media.height, crop.y + crop.height);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : { ...media };
  }
  // size of the page as displayed (turned pages swap width and height)
  const displaySize = (box, rot) => (rot % 180 ? [box.height, box.width] : [box.width, box.height]);

  // A rectangle given in the page as DISPLAYED (points from the top-left, y down) -> the same area in the page's own coordinates.
  function displayRectToUser(box, rot, dl, dt, dr, db) {
    const w = box.width, h = box.height;
    const toUser = (dx, dy) => {
      switch (rot) {
        case 90: return [dy, dx];
        case 180: return [w - dx, dy];
        case 270: return [w - dy, h - dx];
        default: return [dx, h - dy];
      }
    };
    const a = toUser(dl, dt), b = toUser(dr, db);
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    return { x: box.x + x0, y: box.y + y0, width: x1 - x0, height: y1 - y0 };
  }

  // bounding box of the "inked" (not near white) pixels of RGBA data: { x0, y0, x1, y1 } (x1/y1 exclusive) or null for a blank page
  function inkBox(d, w, h, threshold = 60) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] === 0) continue;
        if (765 - (d[i] + d[i + 1] + d[i + 2]) > threshold) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    }
    return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
  }

  // size (points) of the new page for a page that is shown dw x dh
  function targetSize(size, custom, orient, dw, dh) {
    let [a, b] = size === "custom" ? custom : SIZES_MM[size];
    a *= MM; b *= MM;
    const [pw, ph] = a <= b ? [a, b] : [b, a];
    const land = orient === "landscape" || (orient === "keep" && dw > dh);
    return land ? [ph, pw] : [pw, ph];
  }
  // Fit a page (visible box sw x sh, turned by rot, shown dw x dh) inside a tw x th page with a border.
  // -> { scale, ox, oy (where the shown page starts, from bottom-left), x, y, rotate (degrees) } for pdf-lib's drawPage
  function placeFit(sw, sh, rot, tw, th, border) {
    const [dw, dh] = rot % 180 ? [sh, sw] : [sw, sh];
    const scale = Math.min(Math.max(1, tw - 2 * border) / dw, Math.max(1, th - 2 * border) / dh);
    const ox = (tw - dw * scale) / 2, oy = (th - dh * scale) / 2;
    const th_ = -rot * Math.PI / 180, cos = Math.cos(th_), sin = Math.sin(th_);
    const pts = [[0, 0], [sw * scale, 0], [0, sh * scale], [sw * scale, sh * scale]].map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
    const minx = Math.min(...pts.map(p => p[0])), miny = Math.min(...pts.map(p => p[1]));
    return { scale, ox, oy, x: ox - minx, y: oy - miny, rotate: -rot, dw: dw * scale, dh: dh * scale };
  }
  const parseNum = s => { const v = parseFloat(String(s).trim().replace(",", ".")); return Number.isFinite(v) ? v : NaN; };

  function init(root, shell) {
    const $ = id => root.querySelector("#pdfcrop-" + id);
    const fmt = n => n.toLocaleString();
    const setStatus = m => { $("status").textContent = m; };
    const tick = () => new Promise(r => setTimeout(r, 0));
    const L = () => window.PDFLib;
    let src = null;                    // { name, bytes, doc, pages, sizes: [[w,h] as displayed], signed }
    let cur = 1, sc = 1, token = 0, busy = false;
    let m = { l: 0, t: 0, r: 0, b: 0 };   // manual margins in points, relative to the page being previewed, as displayed
    let autoM = null;                      // margins found automatically for the page being previewed (or null: blank)
    let pageCanvas = null;

    const what = () => root.querySelector('input[name="pdfcrop-what"]:checked').value;
    const how = () => root.querySelector('input[name="pdfcrop-how"]:checked').value;
    const unit = () => $("unit").value;
    const curSize = () => (src ? src.sizes[cur - 1] : [1, 1]);
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

    function closeSrc() { if (src) C.closePdf(src.doc); src = null; }
    function reset() {
      closeSrc(); m = { l: 0, t: 0, r: 0, b: 0 }; autoM = null; pageCanvas = null; cur = 1;
      $("name").textContent = ""; $("work").hidden = true; $("empty").hidden = false; $("file").value = ""; $("npages").textContent = "0";
      setStatus("Ready");
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
        shell.alert(e && e.name === "PasswordException" ? `"${f.name}" is protected by a password. Remove it first, then open it here.` : `This file could not be read as a PDF. ${e && e.message ? e.message : ""}`.trim());
        return;
      }
      if (raw.hasEncryptKey) {
        try { await L().PDFDocument.load(data, { updateMetadata: false }); }
        catch (e) { if (e && (e.name === "EncryptedPDFError" || /is encrypted/i.test(String(e.message)))) { C.closePdf(doc); setStatus("This PDF has restrictions."); shell.alert(`"${f.name}" has restrictions set by its author, so a changed copy cannot be made. Remove the restrictions first.`); return; } }
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
      await gotoPage(1);
    }

    /* ---------- the preview ---------- */
    async function gotoPage(n) {
      if (!src) return;
      cur = clamp(Math.round(n) || 1, 1, src.pages);
      $("pageno").value = String(cur);
      $("prev").disabled = cur <= 1; $("next").disabled = cur >= src.pages;
      await showPage();
    }

    async function showPage() {
      if (!src) return;
      const my = ++token;
      const [W, H] = curSize();
      $("size").textContent = `${(W / MM).toFixed(0)} x ${(H / MM).toFixed(0)} mm`;
      const wrap = $("sheetwrap");
      const availW = Math.max(120, wrap.clientWidth - 28), availH = Math.max(160, wrap.clientHeight - 28);
      let scale, frame = null;
      if (what() === "resize") {
        const p = resizeParams(W, H);
        frame = p ? targetSize(p.size, p.custom, p.orient, W, H) : [W, H];
        const fs = Math.min(availW / frame[0], availH / frame[1]);
        const place = placeFit(W, H, 0, frame[0], frame[1], p ? p.border : 0);
        scale = fs * place.scale; sc = fs;
        frame = { frame, fs, place };
      } else {
        scale = Math.min(availW / W, availH / H); sc = scale;
      }
      scale = Math.max(0.05, scale);
      const page = await src.doc.getPage(cur);
      const vp = page.getViewport({ scale });
      const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      try { await page.render({ canvasContext: ctx, canvas: cv, viewport: vp }).promise; } catch { /* a newer preview replaced this one */ }
      page.cleanup();
      if (my !== token) return;
      pageCanvas = cv;
      const out = $("canvas");
      if (frame) {
        out.width = Math.round(frame.frame[0] * frame.fs); out.height = Math.round(frame.frame[1] * frame.fs);
        const o = out.getContext("2d"); o.fillStyle = "#fff"; o.fillRect(0, 0, out.width, out.height);
        o.drawImage(cv, frame.place.ox * frame.fs, (frame.frame[1] - frame.place.oy - frame.place.dh) * frame.fs, cv.width, cv.height);
        o.strokeStyle = "#0A246A"; o.lineWidth = 1; o.strokeRect(0.5, 0.5, out.width - 1, out.height - 1);
      } else {
        out.width = cv.width; out.height = cv.height; out.getContext("2d").drawImage(cv, 0, 0);
        sc = cv.width / W;
      }
      const sheet = $("sheet"); sheet.style.width = out.width + "px"; sheet.style.height = out.height + "px";
      if (!frame && how() === "auto") computeAuto();
      layoutBox(); update();
    }

    function layoutBox() {
      const crop = what() === "crop";
      const box = $("box"), sheet = $("sheet");
      for (const id of ["box", "sh-t", "sh-b", "sh-l", "sh-r"]) $(id).hidden = !crop;
      if (!crop) return;
      const [W, H] = curSize();
      const mm_ = how() === "auto" ? (autoM || { l: 0, t: 0, r: 0, b: 0 }) : m;
      const w = sheet.clientWidth || W * sc, h = sheet.clientHeight || H * sc;
      const l = mm_.l * sc, t = mm_.t * sc, r = mm_.r * sc, b = mm_.b * sc;
      const set = (el, x, y, ww, hh) => { el.style.left = x + "px"; el.style.top = y + "px"; el.style.width = Math.max(0, ww) + "px"; el.style.height = Math.max(0, hh) + "px"; };
      set(box, l, t, w - l - r, h - t - b);
      set($("sh-t"), 0, 0, w, t); set($("sh-b"), 0, h - b, w, b); set($("sh-l"), 0, t, l, h - t - b); set($("sh-r"), w - r, t, r, h - t - b);
      box.classList.toggle("off", how() === "auto");
    }

    /* ---------- margins: fields <-> points ---------- */
    const toUnit = pts => { const v = pts / UNITS[unit()]; return unit() === "in" ? v.toFixed(3) : v.toFixed(1); };
    function syncFields() {
      const mm_ = how() === "auto" ? (autoM || { l: 0, t: 0, r: 0, b: 0 }) : m;
      $("mt").value = toUnit(mm_.t); $("mb").value = toUnit(mm_.b); $("ml").value = toUnit(mm_.l); $("mr").value = toUnit(mm_.r);
    }
    function readFields() {
      const [W, H] = curSize(), k = UNITS[unit()];
      const get = id => { const v = parseNum($(id).value); return Number.isFinite(v) ? Math.max(0, v * k) : 0; };
      let l = get("ml"), r = get("mr"), t = get("mt"), b = get("mb");
      l = clamp(l, 0, W - MIN_LEFT); r = clamp(r, 0, W - l - MIN_LEFT); t = clamp(t, 0, H - MIN_LEFT); b = clamp(b, 0, H - t - MIN_LEFT);
      m = { l, t, r, b };
    }
    const pad = () => { const v = parseNum($("pad").value); return Number.isFinite(v) ? Math.max(0, v * UNITS[unit()]) : 0; };

    // margins of the previewed page that leave only its content, as shown
    function inkMargins(canvas, scale, padPts, W, H) {
      const d = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
      const b = inkBox(d, canvas.width, canvas.height);
      if (!b) return null;
      const kx = W / canvas.width, ky = H / canvas.height;
      return { l: clamp(b.x0 * kx - padPts, 0, W), t: clamp(b.y0 * ky - padPts, 0, H), r: clamp((canvas.width - b.x1) * kx - padPts, 0, W), b: clamp((canvas.height - b.y1) * ky - padPts, 0, H) };
    }
    function computeAuto() {
      if (!pageCanvas || what() !== "crop") return;
      const [W, H] = curSize();
      autoM = inkMargins(pageCanvas, sc, pad(), W, H);
    }

    /* ---------- what will happen ---------- */
    function resizeParams(W, H) {
      const size = $("psize").value;
      const custom = [parseNum($("cw").value), parseNum($("ch").value)];
      if (size === "custom" && !(custom[0] >= 20 && custom[1] >= 20 && custom[0] <= 5000 && custom[1] <= 5000)) return null;
      return { size, custom, orient: $("orient").value, border: Number($("border").value) * MM };
    }
    function chosen() {
      const mode = $("pmode").value;
      $("ptext").disabled = mode !== "custom";
      return T().selectPages(mode, $("ptext").value, src.pages);
    }
    const T = () => window.PDFText;

    function summary() {
      if (!src) return { empty: "Open a PDF to begin." };
      const sel = chosen();
      if (sel.error) return { error: sel.error };
      if (!sel.pages.length) return { error: "No pages chosen." };
      const k = sel.pages.length, pagesTxt = `${fmt(k)} page${k === 1 ? "" : "s"}`;
      if (what() === "resize") {
        const p = resizeParams(...curSize());
        if (!p) return { error: "Type a width and height between 20 and 5000 mm." };
        for (const n of sel.pages) { const [w, h] = src.sizes[n - 1]; const [tw, th] = targetSize(p.size, p.custom, p.orient, w, h); if (tw - 2 * p.border < 10 || th - 2 * p.border < 10) return { error: "The border is too big for this page size." }; }
        const [tw, th] = targetSize(p.size, p.custom, p.orient, ...curSize());
        return { pages: sel.pages, text: `${pagesTxt} will become ${NAMES[p.size]} (${(Math.min(tw, th) / MM).toFixed(0)} x ${(Math.max(tw, th) / MM).toFixed(0)} mm), each fitted inside the new page without stretching.` };
      }
      if (how() === "auto") return { pages: sel.pages, text: `The empty white edges of ${pagesTxt} will be cut away, keeping a border of ${toUnit(pad())} ${unit()}. Each page is worked out by itself.` };
      if (m.l + m.r + m.t + m.b < 0.5) return { error: "Drag the box on the page, or type how much to cut away." };
      for (const n of sel.pages) { const [w, h] = src.sizes[n - 1]; if (w - m.l - m.r < MIN_LEFT || h - m.t - m.b < MIN_LEFT) return { error: `Page ${n} would have nothing left. Cut away less.` }; }
      return { pages: sel.pages, text: `${pagesTxt} will lose: top ${toUnit(m.t)}, bottom ${toUnit(m.b)}, left ${toUnit(m.l)}, right ${toUnit(m.r)} ${unit()}.` };
    }
    function update() {
      const crop = what() === "crop", auto = how() === "auto";
      $("croppane").hidden = !crop; $("resizepane").hidden = crop;
      for (const e of root.querySelectorAll(".cust")) e.hidden = $("psize").value !== "custom";
      for (const id of ["mt", "mb", "ml", "mr"]) $(id).readOnly = auto;
      $("pad").hidden = $("padlabel").hidden = !auto;
      $("reset").disabled = auto;
      if (auto || document.activeElement === null || !root.contains(document.activeElement) || !/^pdfcrop-m[tblr]$/.test(document.activeElement.id)) syncFields();
      const s = summary(), plan = $("plan");
      plan.classList.toggle("bad", !!s.error);
      plan.textContent = s.error || s.empty || s.text;
      $("go").disabled = busy || !s.pages;
      $("note").textContent = crop
        ? "Cutting away margins only hides them: the cut-away part is still inside the file. Do not use this to hide private information."
        : "Pages are rebuilt on the new size. Bookmarks, links between pages and fillable form fields may not carry over.";
    }

    /* ---------- dragging the box ---------- */
    let drag = null;
    const box = $("box"), sheet = $("sheet");
    box.addEventListener("pointerdown", e => {
      if (how() === "auto" || e.button > 0) return;
      const handle = e.target.dataset && e.target.dataset.h;
      if (!handle && m.l + m.r + m.t + m.b < 0.5) return;   // the box covers the whole page: a drag inside draws a new box (handled by the sheet)
      drag = { x: e.clientX, y: e.clientY, m: { ...m }, h: e.target.dataset && e.target.dataset.h || "move" };
      try { box.setPointerCapture(e.pointerId); } catch { /* ok */ }
      e.preventDefault(); e.stopPropagation();
    });
    sheet.addEventListener("pointerdown", e => {
      if (how() === "auto" || what() !== "crop" || e.button > 0) return;
      const onHandle = e.target.dataset && e.target.dataset.h;
      if (onHandle || ((e.target === box || box.contains(e.target)) && m.l + m.r + m.t + m.b >= 0.5)) return;
      const r = sheet.getBoundingClientRect(), [W, H] = curSize();
      drag = { x: e.clientX, y: e.clientY, h: "new", ax: clamp((e.clientX - r.left) / sc, 0, W), ay: clamp((e.clientY - r.top) / sc, 0, H), m: { ...m } };
      try { sheet.setPointerCapture(e.pointerId); } catch { /* ok */ }
      e.preventDefault();
    });
    const onMove = e => {
      if (!drag) return;
      const [W, H] = curSize();
      let { l, t, r, b } = drag.m;
      if (drag.h === "new") {
        const rect = sheet.getBoundingClientRect();
        const px = clamp((e.clientX - rect.left) / sc, 0, W), py = clamp((e.clientY - rect.top) / sc, 0, H);
        const x0 = Math.min(drag.ax, px), x1 = Math.max(drag.ax, px), y0 = Math.min(drag.ay, py), y1 = Math.max(drag.ay, py);
        l = x0; r = W - x1; t = y0; b = H - y1;
        if (W - l - r < MIN_LEFT) { r = Math.max(0, W - l - MIN_LEFT); }
        if (H - t - b < MIN_LEFT) { b = Math.max(0, H - t - MIN_LEFT); }
      } else {
        const dx = (e.clientX - drag.x) / sc, dy = (e.clientY - drag.y) / sc, h = drag.h;
        if (h === "move") { const cx = clamp(dx, -l, r), cy = clamp(dy, -t, b); l += cx; r -= cx; t += cy; b -= cy; }
        else {
          if (h.includes("w")) l = clamp(drag.m.l + dx, 0, W - r - MIN_LEFT);
          if (h.includes("e")) r = clamp(drag.m.r - dx, 0, W - l - MIN_LEFT);
          if (h.includes("n")) t = clamp(drag.m.t + dy, 0, H - b - MIN_LEFT);
          if (h.includes("s")) b = clamp(drag.m.b - dy, 0, H - t - MIN_LEFT);
        }
      }
      m = { l, t, r, b };
      layoutBox(); syncFields(); update();
    };
    const onUp = () => { drag = null; };
    for (const el of [box, sheet]) { el.addEventListener("pointermove", onMove); el.addEventListener("pointerup", onUp); el.addEventListener("pointercancel", onUp); }

    /* ---------- making the file ---------- */
    async function autoMarginsFor(n) {
      const [W, H] = src.sizes[n - 1];
      const scale = Math.min(1, 2500 / Math.max(W, H));
      const page = await src.doc.getPage(n);
      const vp = page.getViewport({ scale });
      const cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
      const ctx = cv.getContext("2d", { willReadFrequently: true }); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, canvas: cv, viewport: vp }).promise; page.cleanup();
      const r = inkMargins(cv, scale, pad(), W, H);
      cv.width = cv.height = 0;
      return r;
    }
    const keepDetails = (from, to) => {
      const keep = (get, set) => { const v = get.call(from); if (v) set.call(to, v); };
      keep(from.getTitle, to.setTitle); keep(from.getAuthor, to.setAuthor); keep(from.getSubject, to.setSubject); keep(from.getCreator, to.setCreator);
      const kw = from.getKeywords(); if (kw) to.setKeywords([kw]);
      const created = from.getCreationDate(); if (created) to.setCreationDate(created);
      to.setProducer("Michel's Tools"); to.setModificationDate(new Date());
    };

    async function go() {
      const s = summary();
      if (!s.pages || busy) return;
      busy = true; update();
      const P = L(), suffix = what() === "crop" ? "cropped" : "resized";
      try {
        const doc = await P.PDFDocument.load(src.bytes, { updateMetadata: false });
        let result = doc, skipped = 0;
        const set = new Set(s.pages);
        if (what() === "crop") {
          for (let i = 0; i < s.pages.length; i++) {
            const n = s.pages[i];
            setStatus(`Cropping page ${n} (${i + 1} of ${s.pages.length})...`);
            if (i % 4 === 0) await tick();
            const page = doc.getPage(n - 1);
            const vis = visibleBox(page.getMediaBox(), page.getCropBox()), rot = normRot(page.getRotation().angle), [dw, dh] = displaySize(vis, rot);
            const mg = how() === "auto" ? await autoMarginsFor(n) : m;
            if (!mg) { skipped++; continue; }
            const l = clamp(mg.l, 0, dw - MIN_LEFT), r = clamp(mg.r, 0, dw - l - MIN_LEFT), t = clamp(mg.t, 0, dh - MIN_LEFT), b = clamp(mg.b, 0, dh - t - MIN_LEFT);
            const rect = displayRectToUser(vis, rot, l, t, dw - r, dh - b);
            page.setCropBox(rect.x, rect.y, rect.width, rect.height);
          }
          doc.setProducer("Michel's Tools"); doc.setModificationDate(new Date());
        } else {
          const p = resizeParams(...curSize());
          const out = await P.PDFDocument.create();
          for (let i = 0; i < doc.getPageCount(); i++) {
            if (i % 4 === 0) { setStatus(`Building page ${i + 1} of ${doc.getPageCount()}...`); await tick(); }
            const sp = doc.getPage(i);
            if (!set.has(i + 1)) { const [cp] = await out.copyPages(doc, [i]); out.addPage(cp); continue; }
            const vis = visibleBox(sp.getMediaBox(), sp.getCropBox()), rot = normRot(sp.getRotation().angle), [dw, dh] = displaySize(vis, rot);
            const [tw, th] = targetSize(p.size, p.custom, p.orient, dw, dh);
            const pl = placeFit(vis.width, vis.height, rot, tw, th, p.border);
            const np = out.addPage([tw, th]);
            // an empty page (no content at all) has nothing to draw: it just gets the new size. pdf-lib would fail on it when saving.
            const c = sp.node.Contents();
            const hasContent = !!c && !(c instanceof P.PDFArray && c.size() === 0);
            const emb = hasContent ? await out.embedPage(sp, { left: vis.x, bottom: vis.y, right: vis.x + vis.width, top: vis.y + vis.height }) : null;
            if (emb) np.drawPage(emb, { x: pl.x, y: pl.y, xScale: pl.scale, yScale: pl.scale, rotate: P.degrees(pl.rotate) });
          }
          keepDetails(doc, out);
          result = out;
        }
        setStatus("Saving...");
        await tick();
        const bytes = await result.save({ updateFieldAppearances: false });
        const name = `${C.baseName(src.name)}-${suffix}.pdf`;
        C.downloadBlob(new Blob([bytes], { type: "application/pdf" }), name);
        setStatus(`Saved ${name}: ${fmt(result.getPageCount())} pages, ${C.humanSize(bytes.length)}.${skipped ? (skipped === 1 ? " 1 blank page was left as it was." : ` ${fmt(skipped)} blank pages were left as they were.`) : ""}`);
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
    for (const r of root.querySelectorAll('input[name="pdfcrop-what"]')) r.addEventListener("change", () => { update(); showPage(); });
    for (const r of root.querySelectorAll('input[name="pdfcrop-how"]')) r.addEventListener("change", () => { if (how() === "auto") computeAuto(); layoutBox(); update(); });
    $("unit").addEventListener("change", () => { syncFields(); update(); });
    for (const id of ["mt", "mb", "ml", "mr"]) $(id).addEventListener("input", () => { readFields(); layoutBox(); update(); });
    $("pad").addEventListener("input", () => { computeAuto(); layoutBox(); update(); });
    $("reset").addEventListener("click", () => { m = { l: 0, t: 0, r: 0, b: 0 }; layoutBox(); syncFields(); update(); });
    for (const id of ["psize", "orient", "border"]) $(id).addEventListener("change", () => { update(); showPage(); });
    for (const id of ["cw", "ch"]) $(id).addEventListener("input", () => { update(); });
    $("pmode").addEventListener("change", update);
    $("ptext").addEventListener("input", update);
    $("go").addEventListener("click", go);
    let rt = 0;
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { if (src && !$("work").hidden) showPage(); }, 150); }).observe($("sheetwrap"));
    C.enableDrop(root.querySelector(".pcrop"), openSource);
    $("pad").value = (5 * MM / UNITS.mm).toFixed(1);
    update();
    return { destroy() { closeSrc(); clearTimeout(rt); } };
  }

  return { init, normRot, visibleBox, displaySize, displayRectToUser, inkBox, targetSize, placeFit };
})();
