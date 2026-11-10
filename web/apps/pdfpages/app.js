/* Split / Extract Pages. Everything runs in the browser; the PDF is never uploaded.
   pdf.js draws the page thumbnails, pdf-lib builds the new files. */
(window.DesktopApps = window.DesktopApps || {}).pdfpages = (() => {
  const C = window.PDFCommon;
  const COLORS = ["#4C8BF5", "#E8873A", "#3DAE5D", "#B552D9", "#D9A521", "#2BA7B5"];
  const pad = (n, width) => String(n).padStart(width, "0");

  function init(root, shell) {
    const $ = id => root.querySelector("#pdfpages-" + id);
    const fmt = n => n.toLocaleString();
    const getMode = () => root.querySelector('input[name="pdfpages-mode"]:checked').value;
    const getHow = () => root.querySelector('input[name="pdfpages-how"]:checked').value;

    let file = null, bytes = null;
    let pdfDoc = null;          // pdf.js document (thumbnails)
    let srcDoc = null;          // pdf-lib document (copying pages), loaded when first needed
    let total = 0;
    let selected = [];          // pages to keep, in the order they will appear
    let thumbs = [];            // thumbnail elements, index = page - 1
    let observer = null;
    let busy = false;
    let epoch = 0;              // changes whenever another file is opened, so old drawing work stops

    const setStatus = m => { $("status").textContent = m; };

    /* ---------- opening a file ---------- */

    function clearDoc() {
      epoch++;
      if (observer) { observer.disconnect(); observer = null; }
      if (pdfDoc) { C.closePdf(pdfDoc); pdfDoc = null; }
      file = bytes = srcDoc = null; total = 0; selected = []; thumbs = [];
    }

    function reset() {
      clearDoc();
      $("file").value = "";
      $("name").textContent = "";
      $("grid").textContent = "";
      const e = document.createElement("div");
      e.className = "empty"; e.id = "pdfpages-empty";
      e.textContent = "Open a PDF, or drop one here. It is read inside your browser and is not uploaded.";
      $("grid").append(e);
      $("pages").value = "";
      setStatus("Ready");
      update();
    }

    async function openFile(f) {
      if (busy) return;
      clearDoc();
      const my = epoch;
      setStatus("Reading the file...");
      let data;
      try { data = await C.readFile(f); } catch (e) { setStatus("Could not read the file."); shell.alert(e.message); return; }
      if (!C.scanRaw(data).header) { setStatus("Not a PDF."); shell.alert(`"${f.name}" does not look like a PDF file.`); return; }
      let doc;
      try {
        doc = await C.openPdf(data);
      } catch (e) {
        if (e && e.name === "PasswordException") {
          setStatus("Password-protected PDF.");
          shell.alert("This PDF is protected by a password, so its pages cannot be copied. Remove the password first, then open it again.");
        } else {
          setStatus("Could not open the PDF.");
          shell.alert(`This file could not be read as a PDF. ${e && e.message ? e.message : ""}`.trim());
        }
        return;
      }
      if (my !== epoch) { C.closePdf(doc); return; }
      file = f; bytes = data; pdfDoc = doc; total = doc.numPages; selected = [];
      $("name").textContent = `${f.name} (${C.humanSize(f.size)})`;
      $("pages").value = "";
      await buildGrid(my);
      update();
      setStatus(`${f.name}: ${fmt(total)} page${total === 1 ? "" : "s"}.${f.size > C.WARN_BYTES ? " This is a large file, so it may take a while." : ""}`);
    }

    /* ---------- thumbnails ---------- */

    async function buildGrid(my) {
      const grid = $("grid");
      grid.textContent = "";
      thumbs = [];
      let ratio = 1.414;
      try { const p1 = await pdfDoc.getPage(1); const [x0, y0, x1, y1] = p1.view; ratio = Math.abs(y1 - y0) / Math.abs(x1 - x0) || 1.414; p1.cleanup(); } catch { /* keep the default */ }
      if (my !== epoch) return;
      const frag = document.createDocumentFragment();
      for (let n = 1; n <= total; n++) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "thumb"; b.dataset.page = String(n);
        b.setAttribute("aria-label", `Page ${n}`);
        const box = document.createElement("span"); box.className = "box";
        box.style.height = Math.round(104 * ratio) + "px";
        const no = document.createElement("span"); no.className = "no"; no.textContent = `Page ${n}`;
        const part = document.createElement("span"); part.className = "part";
        b.append(box, no, part);
        b.addEventListener("click", () => onThumb(n));
        frag.append(b);
        thumbs.push(b);
      }
      grid.append(frag);
      // draw thumbnails as they scroll into view, two at a time
      const queue = [];
      let running = 0;
      const pump = () => {
        while (running < 2 && queue.length) {
          const t = queue.shift();
          running++;
          drawThumb(t, my).finally(() => { running--; pump(); });
        }
      };
      if ("IntersectionObserver" in window) {
        observer = new IntersectionObserver(entries => {
          for (const en of entries) if (en.isIntersecting && !en.target.dataset.drawn) { en.target.dataset.drawn = "1"; observer.unobserve(en.target); queue.push(en.target); }
          pump();
        }, { root: grid, rootMargin: "300px" });
        thumbs.forEach(t => observer.observe(t));
      } else {
        thumbs.forEach(t => { t.dataset.drawn = "1"; queue.push(t); });
        pump();
      }
    }

    async function drawThumb(t, my) {
      if (my !== epoch || !pdfDoc) return;
      try {
        const page = await pdfDoc.getPage(Number(t.dataset.page));
        if (my !== epoch) return;
        const canvas = document.createElement("canvas");
        await C.renderThumb(page, canvas, 208);
        page.cleanup();
        if (my !== epoch) return;
        const box = t.querySelector(".box");
        box.style.height = "";
        box.textContent = "";
        box.append(canvas);
      } catch { /* a page that cannot be drawn simply stays blank; it can still be selected */ }
    }

    /* ---------- selection and the plan ---------- */

    function onThumb(n) {
      if (busy || getMode() !== "extract") return;
      const i = selected.indexOf(n);
      if (i >= 0) selected.splice(i, 1); else selected.push(n);
      $("pages").value = C.describePages(selected);
      update();
    }

    function setSel(list) { selected = list; $("pages").value = C.describePages(selected); update(); }

    // what Create would do now: { groups } or { error } or { empty }
    function currentPlan() {
      if (!pdfDoc) return { empty: "Open a PDF to begin." };
      if (getMode() === "extract") {
        const r = C.parseRanges($("pages").value, total);
        if (r.error) return { error: r.error };
        if (!selected.length) return { empty: "Select the pages to keep: click them on the right, or type them on the left." };
        return { groups: [selected.slice()] };
      }
      const how = getHow();
      return C.splitPlan(total, how, how === "every" ? $("n").value.trim() : $("ranges").value);
    }

    function update() {
      const extract = getMode() === "extract";
      $("opt-extract").hidden = !extract;
      $("opt-split").hidden = extract;
      root.querySelector(".ppg").classList.toggle("splitting", !extract);
      const how = getHow();
      $("ranges").hidden = how !== "ranges"; $("rangenote").hidden = how !== "ranges";
      ["pages", "all", "none", "odd", "even", "invert"].forEach(id => { $(id).disabled = !pdfDoc || busy; });
      $("total").textContent = fmt(total);

      const plan = currentPlan();
      const planEl = $("plan");
      planEl.classList.toggle("bad", !!plan.error);
      let counted = 0;
      if (plan.error) planEl.textContent = plan.error;
      else if (plan.empty) planEl.textContent = plan.empty;
      else {
        const g = plan.groups;
        counted = g.reduce((s, x) => s + x.length, 0);
        if (extract) planEl.textContent = `Will create 1 PDF with ${fmt(g[0].length)} page${g[0].length === 1 ? "" : "s"}: ${C.describePages(g[0])}.`;
        else if (g.length === 1) planEl.textContent = `Will create 1 PDF with ${fmt(g[0].length)} page${g[0].length === 1 ? "" : "s"}: ${C.describePages(g[0])}.`;
        else planEl.textContent = `Will create ${fmt(g.length)} PDFs in one ZIP file: ` + g.slice(0, 6).map(C.describePages).join("  |  ") + (g.length > 6 ? `  |  and ${fmt(g.length - 6)} more` : "") + ".";
      }
      $("sel").textContent = fmt(counted);

      // thumbnails: highlight the selection, or show which part each page goes into
      const inSel = new Set(selected);
      const partOf = new Map();
      if (!extract && plan.groups) plan.groups.forEach((g, i) => g.forEach(p => { if (!partOf.has(p)) partOf.set(p, i); }));
      thumbs.forEach((t, i) => {
        const n = i + 1;
        t.classList.toggle("on", extract && inSel.has(n));
        t.setAttribute("aria-pressed", String(extract && inSel.has(n)));
        const part = t.querySelector(".part");
        if (!extract && partOf.has(n)) { t.dataset.part = String(partOf.get(n)); t.style.setProperty("--part", COLORS[partOf.get(n) % COLORS.length]); part.textContent = `File ${partOf.get(n) + 1}`; }
        else { delete t.dataset.part; t.style.removeProperty("--part"); part.textContent = extract && inSel.has(n) ? `Keep #${selected.indexOf(n) + 1}` : ""; }
      });

      const go = $("go");
      go.disabled = busy || !plan.groups;
      go.textContent = plan.groups && plan.groups.length > 1 ? `Create ${fmt(plan.groups.length)} PDFs (ZIP)` : "Create PDF";
    }

    /* ---------- creating the files ---------- */

    const NEEDS_UNLOCK = "This PDF has a password or restrictions, so its pages cannot be copied. Remove them first, then open it again.";
    const isEncryptedError = e => !!e && ((window.PDFLib && PDFLib.EncryptedPDFError && e instanceof PDFLib.EncryptedPDFError) || e.name === "EncryptedPDFError" || /is encrypted/i.test(String(e.message)));

    async function getSrc() {
      if (!srcDoc) srcDoc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
      return srcDoc;
    }

    async function makePdf(src, pages) {
      const out = await PDFLib.PDFDocument.create();
      const copied = await out.copyPages(src, pages.map(p => p - 1));
      copied.forEach(p => out.addPage(p));
      out.setProducer("Michel's Tools");
      out.setCreator("Michel's Tools");
      return out.save();
    }

    const tick = () => new Promise(r => setTimeout(r, 0));

    async function create() {
      const plan = currentPlan();
      if (!plan.groups || busy) return;
      busy = true; update();
      const base = C.baseName(file.name);
      try {
        setStatus("Reading the pages...");
        let src;
        try { src = await getSrc(); } catch (e) {
          if (isEncryptedError(e)) throw Object.assign(new Error(NEEDS_UNLOCK), { friendly: true });
          throw e;
        }
        const groups = plan.groups;
        if (groups.length === 1) {
          const out = await makePdf(src, groups[0]);
          const name = `${base}-pages-${C.groupLabel(groups[0])}.pdf`;
          C.downloadBlob(new Blob([out], { type: "application/pdf" }), name);
          setStatus(`Created ${name} (${C.humanSize(out.length)}).`);
        } else {
          const files = {};
          const digits = String(groups.length).length;
          for (let i = 0; i < groups.length; i++) {
            setStatus(`Creating file ${fmt(i + 1)} of ${fmt(groups.length)}...`);
            await tick();
            files[`${base}-part-${pad(i + 1, digits)}-pages-${C.groupLabel(groups[i])}.pdf`] = await makePdf(src, groups[i]);
          }
          setStatus("Packing the ZIP file...");
          await tick();
          const zip = fflate.zipSync(files, { level: 0 });   // PDFs are already compressed
          const name = `${base}-split.zip`;
          C.downloadBlob(new Blob([zip], { type: "application/zip" }), name);
          setStatus(`Created ${name}: ${fmt(groups.length)} PDFs, ${C.humanSize(zip.length)}.`);
        }
      } catch (e) {
        setStatus("Could not create the file.");
        shell.alert(e && e.friendly ? e.message : e && e.message ? `Could not create the file. ${e.message}` : "Could not create the file.");
      } finally {
        busy = false; update();
      }
    }

    /* ---------- wiring ---------- */

    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const f = $("file").files[0]; if (f) openFile(f); });
    $("clear").addEventListener("click", () => { if (!busy) reset(); });
    root.querySelectorAll('input[name="pdfpages-mode"], input[name="pdfpages-how"]').forEach(r => r.addEventListener("change", update));
    $("pages").addEventListener("input", () => {
      const r = C.parseRanges($("pages").value, total);
      if (!r.error) selected = r.pages;
      update();
    });
    $("n").addEventListener("input", update);
    $("ranges").addEventListener("input", update);
    $("all").addEventListener("click", () => setSel(Array.from({ length: total }, (_, i) => i + 1)));
    $("none").addEventListener("click", () => setSel([]));
    $("odd").addEventListener("click", () => setSel(Array.from({ length: total }, (_, i) => i + 1).filter(n => n % 2 === 1)));
    $("even").addEventListener("click", () => setSel(Array.from({ length: total }, (_, i) => i + 1).filter(n => n % 2 === 0)));
    $("invert").addEventListener("click", () => { const s = new Set(selected); setSel(Array.from({ length: total }, (_, i) => i + 1).filter(n => !s.has(n))); });
    $("go").addEventListener("click", create);
    C.enableDrop($("content"), f => openFile(f));

    update();
    return { destroy() { clearDoc(); } };
  }

  return { init };
})();
