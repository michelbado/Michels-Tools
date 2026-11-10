/* Images / PDF Converter: pictures -> one PDF (one picture per page), and PDF pages -> PNG or JPG pictures.
   Everything runs in the browser; nothing is uploaded. pdf-lib builds PDFs, pdf.js draws pages, fflate packs ZIP files.
   File names and everything else that comes from a file is shown with textContent only. */
(window.DesktopApps = window.DesktopApps || {}).pdfimages = (() => {
  const C = window.PDFCommon;
  const MAX_PICS = 200, MAX_TOTAL_BYTES = 300 * 1024 * 1024, MAX_PIXELS = 100e6;
  const MAX_PAGE_PIXELS = 80e6, MAX_OUT_BYTES = 600 * 1024 * 1024;
  const MM = 72 / 25.4;
  const SIZES = { a4: [595.28, 841.89], letter: [612, 792] };

  /* ---------- pure helpers (also used by the tests) ---------- */

  // Reads a JPEG's header: { width, height, components, orientation (EXIF, 1 = upright) } or null when it is not a JPEG.
  function jpegInfo(b) {
    if (!b || b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
    const res = { width: 0, height: 0, components: 0, orientation: 1 };
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      if (m === 0xD9 || m === 0xDA) break;
      const len = (b[i + 2] << 8) | b[i + 3];
      if (len < 2) break;
      const seg = i + 4;
      if (m === 0xE1 && b[seg] === 0x45 && b[seg + 1] === 0x78 && b[seg + 2] === 0x69 && b[seg + 3] === 0x66) res.orientation = exifOrientation(b, seg + 6, i + 2 + len) || 1;
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        res.height = (b[seg + 1] << 8) | b[seg + 2];
        res.width = (b[seg + 3] << 8) | b[seg + 4];
        res.components = b[seg + 5];
      }
      i += 2 + len;
    }
    return res;
  }
  function exifOrientation(b, t, end) {
    if (t + 8 > end) return 0;
    const le = b[t] === 0x49;
    const u16 = o => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
    const u32 = o => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
    if (u16(t + 2) !== 42) return 0;
    const ifd = t + u32(t + 4);
    if (ifd + 2 > end) return 0;
    const n = u16(ifd);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > end) return 0;
      if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 0; }
    }
    return 0;
  }

  // Where a w x h picture goes on its page. size: "image" | "a4" | "letter"; orient: auto | portrait | landscape; margin in points.
  // -> { pageW, pageH, x, y, w, h } in points, origin bottom-left.
  function layout(w, h, size, orient, margin) {
    if (size === "image") {
      let iw = w * 0.75, ih = h * 0.75;                 // 96 pixels per inch
      const k = Math.min(1, 1200 / Math.max(iw, ih));
      iw *= k; ih *= k;
      return { pageW: iw + 2 * margin, pageH: ih + 2 * margin, x: margin, y: margin, w: iw, h: ih };
    }
    let [pw, ph] = SIZES[size] || SIZES.a4;
    const land = orient === "landscape" || (orient !== "portrait" && w > h);
    if (land) [pw, ph] = [ph, pw];
    const aw = Math.max(1, pw - 2 * margin), ah = Math.max(1, ph - 2 * margin);
    const k = Math.min(aw / w, ah / h);
    const iw = w * k, ih = h * k;
    return { pageW: pw, pageH: ph, x: (pw - iw) / 2, y: (ph - ih) / 2, w: iw, h: ih };
  }

  const pad = (n, d) => String(n).padStart(d, "0");
  const pictureName = (base, n, total, ext) => `${base}-page-${pad(n, String(total).length)}.${ext}`;
  const kindOf = (type, name) => {
    const t = String(type || "").toLowerCase(), n = String(name || "").toLowerCase();
    if (t === "image/jpeg" || /\.jpe?g$/.test(n)) return "jpeg";
    if (t === "image/png" || /\.png$/.test(n)) return "png";
    return "other";
  };

  function init(root, shell) {
    const $ = id => root.querySelector("#pdfimages-" + id);
    const fmt = n => n.toLocaleString();
    const setStatus = m => { $("status").textContent = m; };
    const tick = () => new Promise(r => setTimeout(r, 0));
    const toBlob = (cv, type, q) => new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error("Could not make the picture."))), type, q));

    /* ---------- tabs ---------- */
    const tabs = [["topdf", $("tab-topdf"), $("panel-topdf")], ["topics", $("tab-topics"), $("panel-topics")]];
    let current = "topdf";
    function selectTab(name) {
      current = name;
      tabs.forEach(([n, tab, panel]) => {
        const on = n === name;
        tab.classList.toggle("on", on); tab.setAttribute("aria-selected", String(on)); tab.tabIndex = on ? 0 : -1; panel.hidden = !on;
      });
      updateCount();
    }
    tabs.forEach(([n, tab], i) => {
      tab.addEventListener("click", () => selectTab(n));
      tab.addEventListener("keydown", e => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        selectTab(next[0]); next[1].focus();
      });
    });
    function updateCount() {
      $("count").textContent = current === "topdf" ? `Pictures: ${fmt(pics.length)}` : `Pages: ${src ? fmt(src.pages) : 0}`;
    }

    /* ================= tab 1: pictures to PDF ================= */
    let pics = [], nextId = 1, busy = false, adding = false;

    function thumbOf(it) {
      const base = it.thumbBase, q = ((it.rot % 360) + 360) % 360;
      const cv = document.createElement("canvas");
      const sw = q % 180 ? base.height : base.width, sh = q % 180 ? base.width : base.height;
      cv.width = sw; cv.height = sh;
      const ctx = cv.getContext("2d");
      ctx.translate(sw / 2, sh / 2); ctx.rotate(q * Math.PI / 180); ctx.drawImage(base, -base.width / 2, -base.height / 2);
      return cv;
    }

    async function addPictures(fileList) {
      if (busy || adding) return;
      adding = true; updatePics();
      const problems = [];
      let total = pics.reduce((s, p) => s + p.bytes.length, 0);
      try {
        for (const f of fileList) {
          if (pics.length >= MAX_PICS) { problems.push(`Only ${MAX_PICS} pictures can be used at once.`); break; }
          setStatus(`Reading ${f.name}...`);
          let data;
          try { data = new Uint8Array(await f.arrayBuffer()); } catch (e) { problems.push(`${f.name}: ${e.message}`); continue; }
          if (total + data.length > MAX_TOTAL_BYTES) { problems.push(`${f.name}: the pictures together would be bigger than ${C.humanSize(MAX_TOTAL_BYTES)}.`); continue; }
          let bmp;
          try { bmp = await createImageBitmap(new Blob([data])); }
          catch { problems.push(`${f.name} could not be read as a picture. JPG, PNG, WebP, GIF and BMP work.`); continue; }
          if (bmp.width * bmp.height > MAX_PIXELS) { bmp.close && bmp.close(); problems.push(`${f.name} is too large (${fmt(bmp.width)} x ${fmt(bmp.height)} pixels).`); continue; }
          const kind = kindOf(f.type, f.name);
          const real = kind === "jpeg" ? jpegInfo(data) : null;
          const k = Math.min(1, 180 / Math.max(bmp.width, bmp.height));
          const tb = document.createElement("canvas");
          tb.width = Math.max(1, Math.round(bmp.width * k)); tb.height = Math.max(1, Math.round(bmp.height * k));
          const tctx = tb.getContext("2d");
          tctx.fillStyle = "#fff"; tctx.fillRect(0, 0, tb.width, tb.height);
          tctx.drawImage(bmp, 0, 0, tb.width, tb.height);
          const it = { id: nextId++, name: f.name, bytes: data, kind: real ? "jpeg" : (kind === "jpeg" ? "other" : kind), jinfo: real, w: bmp.width, h: bmp.height, rot: 0, thumbBase: tb };
          if (bmp.close) bmp.close();
          pics.push(it); total += data.length;
          render();
        }
      } finally { adding = false; }
      if (problems.length) shell.alert(problems.slice(0, 5).join("\n") + (problems.length > 5 ? `\n... and ${problems.length - 5} more.` : ""));
      setStatus(pics.length ? `${fmt(pics.length)} picture${pics.length === 1 ? "" : "s"} ready.` : "Ready");
      updatePics();
    }

    function render() {
      const list = $("list");
      list.textContent = "";
      pics.forEach((it, i) => {
        const li = document.createElement("li");
        li.dataset.id = String(it.id);
        const num = document.createElement("span"); num.className = "num"; num.textContent = String(i + 1);
        const th = document.createElement("span"); th.className = "thumb"; th.append(thumbOf(it));
        const info = document.createElement("span"); info.className = "info";
        const name = document.createElement("div"); name.className = "name"; name.textContent = it.name; name.title = it.name;
        const meta = document.createElement("div"); meta.className = "meta";
        const turned = it.rot % 180 !== 0;
        meta.textContent = `${fmt(turned ? it.h : it.w)} x ${fmt(turned ? it.w : it.h)} pixels, ${C.humanSize(it.bytes.length)}${it.rot ? `, turned ${it.rot} degrees` : ""}`;
        info.append(name, meta);
        const btns = document.createElement("span"); btns.className = "btns";
        const mk = (label, aria, on, disabled) => { const b = document.createElement("button"); b.type = "button"; b.className = "xp-btn small"; b.textContent = label; b.setAttribute("aria-label", `${aria}: ${it.name}`); b.disabled = !!disabled; b.addEventListener("click", on); return b; };
        btns.append(mk("Turn left", "Turn left", () => turn(it.id, -90)), mk("Turn right", "Turn right", () => turn(it.id, 90)),
          mk("Up", "Move up", () => move(it.id, -1), i === 0), mk("Down", "Move down", () => move(it.id, 1), i === pics.length - 1), mk("Remove", "Remove", () => remove(it.id)));
        li.append(num, th, info, btns);
        list.append(li);
      });
      $("empty").hidden = pics.length > 0;
    }
    function turn(id, d) { const it = pics.find(x => x.id === id); if (!it) return; it.rot = (((it.rot + d) % 360) + 360) % 360; render(); refocus(id, d < 0 ? "Turn left" : "Turn right"); }
    function move(id, d) {
      const i = pics.findIndex(x => x.id === id), j = i + d;
      if (i < 0 || j < 0 || j >= pics.length) return;
      [pics[i], pics[j]] = [pics[j], pics[i]];
      render(); updatePics(); refocus(id, d < 0 ? "Up" : "Down");
    }
    function remove(id) { pics = pics.filter(x => x.id !== id); render(); updatePics(); setStatus(pics.length ? "Removed." : "Ready"); }
    function refocus(id, label) {
      const li = $("list").querySelector(`li[data-id="${id}"]`);
      const btns = li ? [...li.querySelectorAll("button")] : [];
      const b = btns.find(x => x.textContent === label && !x.disabled) || btns.find(x => !x.disabled);
      if (b) b.focus();
    }

    const margin = () => Number($("margin").value) * MM;
    function updatePics() {
      const size = $("size").value;
      $("orient").disabled = size === "image";
      const plan = $("plan");
      plan.classList.remove("bad");
      if (!pics.length) plan.textContent = "Add pictures to begin.";
      else {
        const where = size === "image" ? "each page the shape of its picture" : `${size === "a4" ? "A4" : "US Letter"} pages`;
        plan.textContent = `Will create one PDF with ${fmt(pics.length)} page${pics.length === 1 ? "" : "s"}, one picture on each, ${where}.`;
      }
      $("go").disabled = busy || adding || !pics.length;
      $("sort").disabled = busy || adding || pics.length < 2;
      updateCount();
    }

    // embed one picture in the PDF; returns { image, w, h } in pixels as it will appear (turned, upright)
    async function embed(pdf, it) {
      const P = PDFLib;
      if (it.rot === 0) {
        if (it.kind === "jpeg" && it.jinfo && it.jinfo.orientation <= 1 && it.jinfo.components !== 4) {
          const image = await pdf.embedJpg(it.bytes); return { image, w: image.width, h: image.height };
        }
        if (it.kind === "png") {
          try { const image = await pdf.embedPng(it.bytes); return { image, w: image.width, h: image.height }; } catch { /* decode it with the browser instead */ }
        }
      }
      const bmp = await createImageBitmap(new Blob([it.bytes]));
      const q = it.rot, sw = q % 180 ? bmp.height : bmp.width, sh = q % 180 ? bmp.width : bmp.height;
      const cv = document.createElement("canvas"); cv.width = sw; cv.height = sh;
      const ctx = cv.getContext("2d");
      const jpg = it.kind === "jpeg";
      if (jpg) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, sw, sh); }
      ctx.translate(sw / 2, sh / 2); ctx.rotate(q * Math.PI / 180); ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
      if (bmp.close) bmp.close();
      const blob = await toBlob(cv, jpg ? "image/jpeg" : "image/png", 0.92);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      cv.width = cv.height = 0;
      const image = jpg ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
      void P;
      return { image, w: image.width, h: image.height };
    }

    async function createPdf() {
      if (busy || !pics.length) return;
      busy = true; updatePics();
      try {
        const pdf = await PDFLib.PDFDocument.create();
        const m = margin(), size = $("size").value, orient = $("orient").value;
        for (let i = 0; i < pics.length; i++) {
          setStatus(`Adding picture ${i + 1} of ${pics.length}...`);
          await tick();
          const { image, w, h } = await embed(pdf, pics[i]);
          const L = layout(w, h, size, orient, m);
          const page = pdf.addPage([L.pageW, L.pageH]);
          page.drawImage(image, { x: L.x, y: L.y, width: L.w, height: L.h });
        }
        pdf.setProducer("Michel's Tools"); pdf.setCreator("Michel's Tools");
        setStatus("Saving...");
        await tick();
        const bytes = await pdf.save();
        const name = `${C.baseName($("outname").value || "pictures")}.pdf`;
        C.downloadBlob(new Blob([bytes], { type: "application/pdf" }), name);
        setStatus(`Created ${name}: ${fmt(pics.length)} page${pics.length === 1 ? "" : "s"}, ${C.humanSize(bytes.length)}.`);
      } catch (e) {
        setStatus("Could not create the PDF.");
        shell.alert(`Could not create the PDF. ${e && e.message ? e.message : ""}`.trim());
      } finally { busy = false; updatePics(); }
    }

    $("add").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const fl = [...$("file").files]; $("file").value = ""; if (fl.length) addPictures(fl); });
    $("sort").addEventListener("click", () => { pics.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })); render(); updatePics(); setStatus("Sorted by name."); });
    $("clear").addEventListener("click", () => { if (busy || adding) return; pics = []; render(); updatePics(); setStatus("Ready"); });
    $("go").addEventListener("click", createPdf);
    for (const id of ["size", "orient", "margin"]) $(id).addEventListener("change", updatePics);
    const content = $("content");
    content.addEventListener("dragover", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); content.classList.add("dropping"); } });
    content.addEventListener("dragleave", e => { if (e.target === content) content.classList.remove("dropping"); });
    content.addEventListener("drop", e => { e.preventDefault(); content.classList.remove("dropping"); const fl = e.dataTransfer && [...e.dataTransfer.files]; if (fl && fl.length) addPictures(fl); });

    /* ================= tab 2: PDF to pictures ================= */
    let src = null, pbusy = false, cancelled = false;   // src = { name, bytes, doc, pages, sizes: [[w,h] points] }

    function closeSrc() { if (src) C.closePdf(src.doc); src = null; }
    function resetPdf() {
      closeSrc();
      $("pname").textContent = ""; $("presults").hidden = true; $("pempty").hidden = false; $("pdffile").value = "";
      $("pages").value = "";
      setStatus("Ready"); updateCount();
    }

    async function openSource(f) {
      if (pbusy) return;
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
      // respect the author's restrictions: a file that does not allow copying is not turned into pictures
      let perms = null;
      try { perms = await doc.getPermissions(); } catch { /* none */ }
      if (perms) {
        const allowed = new Set(perms instanceof Map ? [...perms.values()] : Array.isArray(perms) ? perms : Object.values(perms));
        if (!allowed.has(0x10)) { C.closePdf(doc); setStatus("This PDF does not allow copying."); shell.alert(`"${f.name}" has restrictions set by its author that do not allow copying its content, so it cannot be turned into pictures. Remove the restrictions first.`); return; }
      }
      closeSrc();
      const sizes = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const p = await doc.getPage(n);
        const vp = p.getViewport({ scale: 1 });
        sizes.push([vp.width, vp.height]);
        p.cleanup();
      }
      src = { name: f.name, bytes: data, doc, pages: doc.numPages, sizes };
      $("pname").textContent = f.name; $("pname").title = f.name;
      $("pempty").hidden = true; $("presults").hidden = false;
      setStatus(`${f.name}: ${fmt(src.pages)} page${src.pages === 1 ? "" : "s"}.`);
      updatePlan();
    }

    function chosenPages() {
      if (!src) return { error: "Open a PDF first." };
      const spec = $("pages").value;
      if (!spec.trim()) return { pages: Array.from({ length: src.pages }, (_, i) => i + 1) };
      return C.parseRanges(spec, src.pages);
    }

    function updatePlan() {
      const plan = $("pplan");
      $("q").disabled = $("fmt").value !== "jpg";
      $("qv").textContent = $("q").value;
      const r = chosenPages();
      const dpi = Number($("dpi").value), ext = $("fmt").value.toUpperCase();
      let bad = false, text;
      if (!src) text = "Open a PDF first.";
      else if (r.error) { bad = true; text = r.error; }
      else if (!r.pages.length) { bad = true; text = "No pages chosen."; }
      else {
        let big = null, maxW = 0, maxH = 0;
        for (const n of r.pages) {
          const [w, h] = src.sizes[n - 1];
          const pw = Math.round(w * dpi / 72), ph = Math.round(h * dpi / 72);
          if (pw * ph > MAX_PAGE_PIXELS && !big) big = { n, pw, ph };
          if (pw * ph > maxW * maxH) { maxW = pw; maxH = ph; }
        }
        if (big) { bad = true; text = `Page ${big.n} would be ${fmt(big.pw)} x ${fmt(big.ph)} pixels, which is too large. Choose a lower detail setting.`; }
        else {
          const k = r.pages.length;
          text = `Will make ${fmt(k)} ${ext} picture${k === 1 ? "" : "s"} at ${dpi} dots per inch (the largest is ${fmt(maxW)} x ${fmt(maxH)} pixels)${k > 1 ? ", packed in one ZIP file" : ""}.`;
        }
      }
      plan.textContent = text; plan.classList.toggle("bad", bad);
      $("pgo").disabled = pbusy || bad || !src;
      updateCount();
    }

    async function makePictures() {
      const r = chosenPages();
      if (pbusy || !src || r.error || !r.pages.length) return;
      pbusy = true; cancelled = false; updatePlan();
      $("cancel").hidden = false; $("pgo").hidden = true;
      const dpi = Number($("dpi").value), jpg = $("fmt").value === "jpg", ext = jpg ? "jpg" : "png";
      const q = Number($("q").value) / 100;
      const base = C.baseName(src.name), files = {};
      let outBytes = 0, lastBlob = null, lastName = "";
      try {
        for (let i = 0; i < r.pages.length; i++) {
          if (cancelled) throw Object.assign(new Error("cancelled"), { cancelled: true });
          const n = r.pages[i];
          setStatus(`Drawing page ${n} (${i + 1} of ${r.pages.length})...`);
          await tick();
          const page = await src.doc.getPage(n);
          const vp = page.getViewport({ scale: dpi / 72 });
          const cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
          const ctx = cv.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
          await page.render({ canvasContext: ctx, canvas: cv, viewport: vp }).promise;
          page.cleanup();
          const blob = await toBlob(cv, jpg ? "image/jpeg" : "image/png", jpg ? q : undefined);
          cv.width = cv.height = 0;
          outBytes += blob.size;
          if (outBytes > MAX_OUT_BYTES) throw Object.assign(new Error(`The pictures would be bigger than ${C.humanSize(MAX_OUT_BYTES)}. Choose fewer pages or a lower detail setting.`), { friendly: true });
          const name = pictureName(base, n, src.pages, ext);
          if (r.pages.length === 1) { lastBlob = blob; lastName = name; }
          else files[name] = new Uint8Array(await blob.arrayBuffer());
        }
        if (r.pages.length === 1) {
          C.downloadBlob(lastBlob, lastName);
          setStatus(`Created ${lastName} (${C.humanSize(lastBlob.size)}).`);
        } else {
          setStatus("Packing the ZIP file...");
          await tick();
          const zip = fflate.zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: 0 }]])), { level: 0 });
          const name = `${base}-pictures.zip`;
          C.downloadBlob(new Blob([zip], { type: "application/zip" }), name);
          setStatus(`Created ${name}: ${fmt(r.pages.length)} pictures, ${C.humanSize(zip.length)}.`);
        }
      } catch (e) {
        if (e && e.cancelled) setStatus("Cancelled. Nothing was downloaded.");
        else { setStatus("Could not make the pictures."); shell.alert(e && e.friendly ? e.message : `Could not make the pictures. ${e && e.message ? e.message : ""}`.trim()); }
      } finally {
        pbusy = false; $("cancel").hidden = true; $("pgo").hidden = false; updatePlan();
      }
    }

    $("open").addEventListener("click", () => $("pdffile").click());
    $("pdffile").addEventListener("change", () => { const f = $("pdffile").files[0]; $("pdffile").value = ""; if (f) openSource(f); });
    $("pclear").addEventListener("click", () => { if (!pbusy) resetPdf(); });
    $("pgo").addEventListener("click", makePictures);
    $("cancel").addEventListener("click", () => { cancelled = true; });
    for (const id of ["pages", "fmt", "dpi", "q"]) $(id).addEventListener(id === "pages" || id === "q" ? "input" : "change", updatePlan);
    C.enableDrop($("pcontent"), openSource);

    render(); updatePics(); updatePlan();
    return { destroy() { pics = []; closeSrc(); } };
  }

  return { init, jpegInfo, layout, pictureName, kindOf };
})();
