/* Merge PDFs: join several PDFs into one, in the order you choose, optionally taking only some pages of each.
   Everything runs in the browser; the files are never uploaded. pdf.js shows the first-page thumbnails, pdf-lib builds the file.
   File names and everything else that comes from a file is shown with textContent only. */
(window.DesktopApps = window.DesktopApps || {}).pdfmerge = (() => {
  const C = window.PDFCommon;
  const MAX_FILES = 100;
  const MAX_TOTAL_BYTES = 400 * 1024 * 1024;
  const NEEDS_UNLOCK = "has a password or restrictions, so it cannot be merged. Remove them first.";

  // "1-3,7" -> { pages } ; "" means every page
  function pagesFor(spec, count) {
    if (!String(spec).trim()) return { pages: Array.from({ length: count }, (_, i) => i + 1) };
    return C.parseRanges(spec, count);
  }

  function init(root, shell) {
    const $ = id => root.querySelector("#pdfmerge-" + id);
    const fmt = n => n.toLocaleString();
    let items = [], nextId = 1, busy = false, adding = false;
    const setStatus = m => { $("status").textContent = m; };

    const isEncryptedError = e => !!e && ((window.PDFLib && PDFLib.EncryptedPDFError && e instanceof PDFLib.EncryptedPDFError) || e.name === "EncryptedPDFError" || /is encrypted/i.test(String(e.message)));

    /* ---------- adding files ---------- */

    async function addFiles(fileList) {
      if (busy || adding) return;
      adding = true; update();
      const problems = [];
      let total = items.reduce((s, it) => s + it.bytes.length, 0);
      try {
        for (const f of fileList) {
          if (items.length >= MAX_FILES) { problems.push(`Only ${MAX_FILES} files can be merged at once.`); break; }
          setStatus(`Reading ${f.name}...`);
          let data;
          try { data = await C.readFile(f); } catch (e) { problems.push(`${f.name}: ${e.message}`); continue; }
          if (total + data.length > MAX_TOTAL_BYTES) { problems.push(`${f.name}: the files together would be bigger than ${C.humanSize(MAX_TOTAL_BYTES)}.`); continue; }
          const raw = C.scanRaw(data);
          if (!raw.header) { problems.push(`${f.name} does not look like a PDF file.`); continue; }
          let doc;
          try { doc = await C.openPdf(data); }
          catch (e) {
            problems.push(e && e.name === "PasswordException" ? `${f.name} is protected by a password. Remove it first.` : `${f.name} could not be read as a PDF.`);
            continue;
          }
          if (raw.hasEncryptKey) {
            try { await PDFLib.PDFDocument.load(data, { updateMetadata: false }); }
            catch (e) { if (isEncryptedError(e)) { C.closePdf(doc); problems.push(`${f.name} ${NEEDS_UNLOCK}`); continue; } }
          }
          const it = { id: nextId++, name: f.name, bytes: data, pages: doc.numPages, spec: "", signed: raw.byteRanges > 0, thumb: null };
          try {
            const page = await doc.getPage(1);
            const cv = document.createElement("canvas");
            await C.renderThumb(page, cv, 110);
            page.cleanup();
            it.thumb = cv;
          } catch { /* no thumbnail: the row still works */ }
          C.closePdf(doc);
          items.push(it); total += data.length;
          render();
        }
      } finally {
        adding = false;
      }
      if (problems.length) shell.alert(problems.slice(0, 5).join("\n") + (problems.length > 5 ? `\n... and ${problems.length - 5} more.` : ""));
      setStatus(items.length ? `${fmt(items.length)} file${items.length === 1 ? "" : "s"} ready.` : "Ready");
      update();
    }

    /* ---------- the list ---------- */

    function render() {
      const list = $("list");
      list.textContent = "";
      items.forEach((it, i) => {
        const li = document.createElement("li");
        li.dataset.id = String(it.id);
        const num = document.createElement("span"); num.className = "num"; num.textContent = String(i + 1);
        const th = document.createElement("span"); th.className = "thumb";
        if (it.thumb) { const c = document.createElement("canvas"); c.width = it.thumb.width; c.height = it.thumb.height; c.getContext("2d").drawImage(it.thumb, 0, 0); th.append(c); }
        const info = document.createElement("span"); info.className = "info";
        const name = document.createElement("div"); name.className = "name"; name.textContent = it.name; name.title = it.name;
        const meta = document.createElement("div"); meta.className = "meta";
        meta.append(document.createTextNode(`${fmt(it.pages)} page${it.pages === 1 ? "" : "s"}, ${C.humanSize(it.bytes.length)}`));
        const chosen = document.createElement("span"); chosen.className = "chosen"; meta.append(chosen);
        if (it.signed) meta.append(document.createTextNode("  |  has a digital signature"));
        info.append(name, meta);
        const pb = document.createElement("span"); pb.className = "pagebox";
        const lab = document.createElement("label"); lab.textContent = "Pages to use"; lab.setAttribute("for", `pdfmerge-spec-${it.id}`);
        const inp = document.createElement("input"); inp.type = "text"; inp.id = `pdfmerge-spec-${it.id}`; inp.className = "xp-field"; inp.value = it.spec;
        inp.placeholder = "All pages"; inp.spellcheck = false; inp.autocomplete = "off";
        inp.addEventListener("input", () => { it.spec = inp.value; refreshRow(li, it); update(); });
        pb.append(lab, inp);
        const btns = document.createElement("span"); btns.className = "btns";
        const mk = (label, aria, on, disabled) => { const b = document.createElement("button"); b.type = "button"; b.className = "xp-btn small"; b.textContent = label; b.setAttribute("aria-label", `${aria}: ${it.name}`); b.disabled = !!disabled; b.addEventListener("click", on); return b; };
        btns.append(mk("Up", "Move up", () => move(it.id, -1), i === 0), mk("Down", "Move down", () => move(it.id, 1), i === items.length - 1), mk("Remove", "Remove", () => remove(it.id)));
        li.append(num, th, info, pb, btns);
        list.append(li);
        refreshRow(li, it);
      });
      $("empty").hidden = items.length > 0;
      $("signedwarn").hidden = !items.some(it => it.signed);
    }

    // shows how many pages of this file will be used, or what is wrong with the page box
    function refreshRow(li, it) {
      const r = pagesFor(it.spec, it.pages);
      const chosen = li.querySelector(".chosen"), inp = li.querySelector("input");
      chosen.textContent = ""; chosen.className = "chosen";
      inp.classList.toggle("invalid", !!r.error);
      if (r.error) { chosen.className = "chosen bad"; chosen.textContent = `  |  ${r.error}`; }
      else if (it.spec.trim()) chosen.textContent = `  |  using ${fmt(r.pages.length)} of ${fmt(it.pages)}`;
    }

    function move(id, d) {
      const i = items.findIndex(x => x.id === id), j = i + d;
      if (i < 0 || j < 0 || j >= items.length) return;
      [items[i], items[j]] = [items[j], items[i]];
      render(); update();
      const li = $("list").querySelector(`li[data-id="${id}"]`);
      const b = li && [...li.querySelectorAll("button")].find(x => !x.disabled && x.textContent === (d < 0 ? "Up" : "Down")) || li && li.querySelector("button:not(:disabled)");
      if (b) b.focus();
    }
    function remove(id) { items = items.filter(x => x.id !== id); render(); update(); setStatus(items.length ? "Removed." : "Ready"); }

    // what Merge would do: { pages: total, error }
    function summary() {
      if (items.length < 2) return { empty: items.length ? "Add at least one more PDF." : "Add PDFs to begin." };
      let total = 0;
      for (const it of items) {
        const r = pagesFor(it.spec, it.pages);
        if (r.error) return { error: `${it.name}: ${r.error}` };
        if (!r.pages.length) return { error: `${it.name}: no pages chosen.` };
        total += r.pages.length;
      }
      return { total };
    }

    function update() {
      const s = summary();
      const plan = $("plan");
      plan.classList.toggle("bad", !!s.error);
      if (s.error) plan.textContent = s.error;
      else if (s.empty) plan.textContent = s.empty;
      else plan.textContent = `Will create one PDF with ${fmt(s.total)} page${s.total === 1 ? "" : "s"} from ${fmt(items.length)} files.`;
      $("go").disabled = busy || adding || !s.total;
      $("sort").disabled = busy || adding || items.length < 2;
      $("nfiles").textContent = fmt(items.length);
      let pages = 0; for (const it of items) { const r = pagesFor(it.spec, it.pages); if (r.pages) pages += r.pages.length; }
      $("npages").textContent = fmt(pages);
    }

    /* ---------- merging ---------- */

    const tick = () => new Promise(r => setTimeout(r, 0));

    async function merge() {
      const s = summary();
      if (!s.total || busy) return;
      busy = true; update();
      try {
        const out = await PDFLib.PDFDocument.create();
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          setStatus(`Adding ${it.name} (${i + 1} of ${items.length})...`);
          await tick();
          let src;
          try { src = await PDFLib.PDFDocument.load(it.bytes, { updateMetadata: false }); }
          catch (e) { if (isEncryptedError(e)) throw Object.assign(new Error(`${it.name} ${NEEDS_UNLOCK}`), { friendly: true }); throw e; }
          const pages = pagesFor(it.spec, it.pages).pages;
          const copied = await out.copyPages(src, pages.map(p => p - 1));
          copied.forEach(p => out.addPage(p));
        }
        out.setProducer("Michel's Tools"); out.setCreator("Michel's Tools");
        setStatus("Saving...");
        await tick();
        const bytes = await out.save();
        const name = `${C.baseName($("outname").value || "merged")}.pdf`;
        C.downloadBlob(new Blob([bytes], { type: "application/pdf" }), name);
        setStatus(`Created ${name}: ${fmt(out.getPageCount())} pages, ${C.humanSize(bytes.length)}.`);
      } catch (e) {
        setStatus("Could not merge the files.");
        shell.alert(e && e.friendly ? e.message : `Could not merge the files. ${e && e.message ? e.message : ""}`.trim());
      } finally {
        busy = false; update();
      }
    }

    /* ---------- wiring ---------- */

    $("add").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const fl = [...$("file").files]; $("file").value = ""; if (fl.length) addFiles(fl); });
    $("sort").addEventListener("click", () => { items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })); render(); update(); setStatus("Sorted by name."); });
    $("clear").addEventListener("click", () => { if (busy || adding) return; items = []; render(); update(); setStatus("Ready"); });
    $("go").addEventListener("click", merge);
    $("outname").addEventListener("input", update);
    // dropping several files at once
    const content = $("content");
    content.addEventListener("dragover", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); content.classList.add("dropping"); } });
    content.addEventListener("dragleave", e => { if (e.target === content) content.classList.remove("dropping"); });
    content.addEventListener("drop", e => { e.preventDefault(); content.classList.remove("dropping"); const fl = e.dataTransfer && [...e.dataTransfer.files]; if (fl && fl.length) addFiles(fl); });

    render(); update();
    return { destroy() { items = []; } };
  }

  return { init, pagesFor };
})();
