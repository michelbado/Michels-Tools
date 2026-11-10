/* Shared helpers for the PDF tools. Everything runs in the browser: a PDF is never sent to the server.
   Pure helpers (ranges, dates, XMP, raw scan) have no DOM dependency except where noted. */
window.PDFCommon = (() => {
  const MAX_BYTES = 200 * 1024 * 1024;   // refuse bigger files
  const WARN_BYTES = 100 * 1024 * 1024;  // warn above this
  const MAX_FILES = 1000;                // most files one split may create

  /* ---------- small helpers ---------- */

  function humanSize(n) {
    if (n < 1024) return `${n} bytes`;
    const u = ["KB", "MB", "GB"];
    let v = n / 1024, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
  }

  // a safe name to build output file names from
  function baseName(name) {
    const b = String(name).replace(/\.pdf$/i, "").replace(/[^\w.\- ()]+/g, "_").replace(/\.{2,}/g, "_").replace(/_{2,}/g, "_")
      .replace(/^[. ]+|[. ]+$/g, "").slice(0, 80);
    return b || "document";
  }

  /* ---------- page lists ---------- */

  // "1,3,5-8", "5-3" (backwards), "7-" (to the end), "all", "odd", "even" -> { pages } in the order typed, no repeats
  function parseRanges(text, max) {
    const out = [], seen = new Set();
    const add = n => { if (!seen.has(n)) { seen.add(n); out.push(n); } };
    const tokens = String(text).split(/[,;\s]+/).filter(Boolean);
    const check = n => {
      if (n < 1) return "Pages start at 1.";
      if (n > max) return `Page ${n} does not exist. This document has ${max} page${max === 1 ? "" : "s"}.`;
      return null;
    };
    for (const raw of tokens) {
      const t = raw.toLowerCase();
      let m;
      if (t === "all") { for (let i = 1; i <= max; i++) add(i); continue; }
      if (t === "odd") { for (let i = 1; i <= max; i += 2) add(i); continue; }
      if (t === "even") { for (let i = 2; i <= max; i += 2) add(i); continue; }
      if ((m = /^(\d+)$/.exec(t))) {
        const n = Number(m[1]); const e = check(n); if (e) return { error: e };
        add(n); continue;
      }
      if ((m = /^(\d+)-(\d+)$/.exec(t))) {
        const a = Number(m[1]), b = Number(m[2]);
        let e = check(a) || check(b); if (e) return { error: e };
        if (a <= b) for (let i = a; i <= b; i++) add(i); else for (let i = a; i >= b; i--) add(i);
        continue;
      }
      if ((m = /^(\d+)-$/.exec(t))) {
        const a = Number(m[1]); const e = check(a); if (e) return { error: e };
        for (let i = a; i <= max; i++) add(i);
        continue;
      }
      return { error: `"${raw}" is not a page or a page range. Use something like 1,3,5-8.` };
    }
    return { pages: out };
  }

  // "1-3, 4-10, 11-" -> one group per comma-separated part
  function parseGroups(text, max) {
    const parts = String(text).split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    const groups = [];
    for (const part of parts) {
      const r = parseRanges(part, max);
      if (r.error) return r;
      if (r.pages.length) groups.push(r.pages);
    }
    return { groups };
  }

  // how to cut a document of `total` pages into files -> { groups: [[pages], ...] } or { error }
  function splitPlan(total, mode, param) {
    let groups = [];
    if (mode === "every") {
      const n = Number(param);
      if (!Number.isInteger(n) || n < 1) return { error: "Enter how many pages each file should have, 1 or more." };
      for (let i = 1; i <= total; i += n) {
        const g = [];
        for (let p = i; p < i + n && p <= total; p++) g.push(p);
        groups.push(g);
      }
    } else if (mode === "each") {
      for (let p = 1; p <= total; p++) groups.push([p]);
    } else if (mode === "ranges") {
      if (!String(param).trim()) return { error: "Enter the page ranges, for example 1-3, 4-10." };
      const r = parseGroups(param, total);
      if (r.error) return r;
      groups = r.groups;
      if (!groups.length) return { error: "Enter the page ranges, for example 1-3, 4-10." };
    } else {
      return { error: "Unknown way of splitting." };
    }
    if (groups.length > MAX_FILES) return { error: `That would create ${groups.length.toLocaleString()} files. The limit is ${MAX_FILES.toLocaleString()}.` };
    return { groups };
  }

  // [1,2,3,7,9,10] -> runs [[1,3],[7,7],[9,10]]
  function runs(pages) {
    const out = [];
    for (const p of pages) {
      const last = out[out.length - 1];
      if (last && p === last[1] + 1) last[1] = p; else out.push([p, p]);
    }
    return out;
  }

  // for people: "1-3, 7, 9-10"
  function describePages(pages) {
    return runs(pages).map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(", ");
  }

  // for file names: "1-3_7_9-10"
  function groupLabel(pages) {
    const s = runs(pages).map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join("_");
    return s.length <= 40 ? s : `${pages[0]}-${pages[pages.length - 1]}_${pages.length}pages`;
  }

  /* ---------- PDF dates and the raw file ---------- */

  // "D:20240131123045+01'00'" -> "2024-01-31 12:30:45 (UTC+01:00)"; anything odd is returned as it is
  function formatPdfDate(s) {
    if (s === undefined || s === null || s === "") return "";
    const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}(?:'?\d{2}'?)?)?$/.exec(String(s).trim());
    if (!m) return String(s);
    const [, y, mo = "01", d = "01", h = "00", mi = "00", se = "00", tz] = m;
    let zone = "";
    if (tz === "Z") zone = " (UTC)";
    else if (tz) { const t = tz.replace(/'/g, ""); zone = ` (UTC${t.slice(0, 3)}:${t.slice(3, 5) || "00"})`; }
    return `${y}-${mo}-${d} ${h}:${mi}:${se}${zone}`;
  }

  function indexOfBytes(hay, needle, from = 0) {
    const n = needle.length, first = needle[0], last = hay.length - n;
    outer: for (let i = from; i <= last; i++) {
      if (hay[i] !== first) continue;
      for (let j = 1; j < n; j++) if (hay[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }

  function countBytes(hay, str) {
    const needle = Uint8Array.from(str, c => c.charCodeAt(0));
    let n = 0, i = 0;
    while ((i = indexOfBytes(hay, needle, i)) !== -1) { n++; i += needle.length; }
    return n;
  }

  // facts that can be read straight from the bytes of a file
  function scanRaw(bytes) {
    const head = String.fromCharCode.apply(null, bytes.subarray(0, Math.min(1024, bytes.length)));
    const hm = /%PDF-(\d\.\d)/.exec(head);
    const linearized = /\/Linearized\b/.test(head);
    const eof = countBytes(bytes, "%%EOF");
    return {
      header: hm ? hm[1] : null,
      linearized,
      eofCount: eof,
      revisions: Math.max(eof > 0 ? 1 : 0, eof - (linearized ? 1 : 0)),
      byteRanges: countBytes(bytes, "/ByteRange"),
      hasEncryptKey: countBytes(bytes, "/Encrypt") > 0,
    };
  }

  /* ---------- XMP metadata ---------- */

  const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
  const XMLNS = "http://www.w3.org/2000/xmlns/";
  const MM = "http://ns.adobe.com/xap/1.0/mm/";

  function leafText(el) {
    // rdf:Seq / Bag / Alt -> the items; otherwise the text
    const list = [...el.children].find(c => c.namespaceURI === RDF && /^(Seq|Bag|Alt)$/.test(c.localName));
    if (list) return [...list.children].map(li => (li.textContent || "").trim()).filter(Boolean).join(" | ");
    const desc = [...el.children].find(c => c.namespaceURI === RDF && c.localName === "Description");
    if (desc) return [...desc.attributes].filter(a => a.namespaceURI !== XMLNS && a.namespaceURI !== RDF).map(a => `${a.localName}=${a.value}`).join(", ");
    return (el.textContent || "").trim();
  }

  // -> { props: [{ name: "dc:creator", value }], history: [{ action, agent, when, changed, instanceId }] } or { error }
  function parseXmp(xml, Parser = (typeof DOMParser !== "undefined" ? DOMParser : null)) {
    if (!xml || !Parser) return { props: [], history: [] };
    const doc = new Parser().parseFromString(String(xml), "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return { error: "The XMP block could not be read.", props: [], history: [] };
    const props = [], history = [];
    const descs = [...doc.getElementsByTagNameNS(RDF, "Description")];
    for (const d of descs) {
      for (const a of d.attributes) {
        if (a.namespaceURI === XMLNS || a.namespaceURI === RDF) continue;
        props.push({ name: `${a.prefix || ""}:${a.localName}`.replace(/^:/, ""), value: a.value });
      }
      for (const c of d.children) {
        const name = `${c.prefix || ""}:${c.localName}`.replace(/^:/, "");
        if (c.namespaceURI === MM && c.localName === "History") {
          const seq = [...c.children].find(x => x.namespaceURI === RDF && x.localName === "Seq");
          for (const li of seq ? seq.children : []) {
            const ev = {};
            for (const a of li.attributes) if (a.namespaceURI !== RDF && a.namespaceURI !== XMLNS) ev[a.localName] = a.value;
            for (const x of li.children) ev[x.localName] = (x.textContent || "").trim();
            history.push({ action: ev.action || "", agent: ev.softwareAgent || "", when: ev.when || "", changed: ev.changed || "", instanceId: ev.instanceID || "" });
          }
          continue;
        }
        props.push({ name, value: leafText(c) });
      }
    }
    return { props, history };
  }

  /* ---------- files, downloads ---------- */

  async function readFile(file) {
    if (file.size > MAX_BYTES) throw new Error(`This file is ${humanSize(file.size)}. The limit is ${humanSize(MAX_BYTES)}.`);
    return new Uint8Array(await file.arrayBuffer());
  }

  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // let a file be dropped onto an element
  function enableDrop(el, onFile) {
    el.addEventListener("dragover", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); el.classList.add("dropping"); } });
    el.addEventListener("dragleave", e => { if (e.target === el) el.classList.remove("dropping"); });
    el.addEventListener("drop", e => {
      e.preventDefault();
      el.classList.remove("dropping");
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) onFile(f);
    });
  }

  /* ---------- pdf.js (rendering and reading), loaded when first needed ---------- */

  let pdfjsPromise = null;
  const url = p => new URL(p, document.baseURI).href;

  function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import(url("vendor/pdfjs/pdf.min.mjs")).then(m => {
        m.GlobalWorkerOptions.workerSrc = url("vendor/pdfjs/pdf.worker.min.mjs");
        return m;
      }).catch(e => { pdfjsPromise = null; throw e; });
    }
    return pdfjsPromise;
  }

  // open a PDF for reading. Throws an error whose name is "PasswordException" (code 1 = needed, 2 = wrong).
  async function openPdf(bytes, password) {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),   // pdf.js takes ownership of the buffer it is given, so give it a copy
      password: password || undefined,
      isEvalSupported: false,        // no eval, ever
      enableXfa: false,
      verbosity: 0,                  // report errors only; repair warnings about damaged files are just noise
      disableFontFace: true,         // draw glyphs as paths: nothing to load, nothing for the CSP to block
      standardFontDataUrl: url("vendor/pdfjs/standard_fonts/"),
    });
    return task.promise;
  }

  /* ---------- small picture helpers shared by the stamping tools ---------- */

  // crop a canvas to the pixels that are not transparent
  function trimCanvas(src, pad = 4) {
    const { width: w, height: h } = src;
    const d = src.getContext("2d").getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const out = document.createElement("canvas");
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext("2d").drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  // light pixels become see-through (a photo of a logo on white paper can then sit on a page)
  function whiteToAlpha(canvas) {
    const ctx = canvas.getContext("2d");
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const m = Math.min(d[i], d[i + 1], d[i + 2]);
      d[i + 3] = Math.round(d[i + 3] * Math.min(1, Math.max(0, (246 - m) / 70)));
    }
    ctx.putImageData(img, 0, 0);
  }

  const canvasPng = canvas => new Promise((res, rej) => canvas.toBlob(async b => (b ? res(new Uint8Array(await b.arrayBuffer())) : rej(new Error("Could not make the image"))), "image/png"));

  // a picture file -> a canvas no bigger than maxSide (png, jpg, webp, gif)
  async function imageToCanvas(file, maxSide = 1600) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext("2d", { willReadFrequently: true }).drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c;
  }

  // free a document opened with openPdf (this pdf.js closes documents through their loading task)
  function closePdf(doc) {
    try {
      if (!doc) return;
      if (typeof doc.destroy === "function") doc.destroy();
      else if (doc.loadingTask && typeof doc.loadingTask.destroy === "function") doc.loadingTask.destroy();
    } catch { /* nothing useful to do */ }
  }

  async function renderThumb(page, canvas, targetWidth) {
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: targetWidth / base.width });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;
  }

  return {
    MAX_BYTES, WARN_BYTES, MAX_FILES,
    humanSize, baseName,
    parseRanges, parseGroups, splitPlan, runs, describePages, groupLabel,
    formatPdfDate, countBytes, scanRaw, parseXmp,
    readFile, downloadBlob, enableDrop, loadPdfjs, openPdf, closePdf, renderThumb, trimCanvas, whiteToAlpha, canvasPng, imageToCanvas,
  };
})();
