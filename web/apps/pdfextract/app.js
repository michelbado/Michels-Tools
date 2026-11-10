/* Extract Content: take the text, the pictures and the attached files out of a PDF.
   Everything runs in the browser; the file is never uploaded. pdf.js reads the file, fflate packs ZIP files.
   Everything that comes from the file (text, names) is untrusted and is only ever shown with textContent / value. */
(window.DesktopApps = window.DesktopApps || {}).pdfextract = (() => {
  const C = window.PDFCommon;
  const MAX_PICS = 500, MAX_PIC_PIXELS = 100e6, MAX_OUT_BYTES = 300 * 1024 * 1024, SHOW_CHARS = 300000, MIN_SIDE = 32;

  /* ---------- pure helpers (also used by the tests) ---------- */

  // pdf.js text items -> text with line breaks
  function textFromItems(items) {
    let out = "", lastY = null, lastH = 0;
    for (const it of items) {
      if (typeof it.str !== "string") continue;
      const y = it.transform ? it.transform[5] : null;
      if (out && lastY !== null && y !== null && Math.abs(y - lastY) > Math.max(2, lastH * 0.6) && !out.endsWith("\n")) out += "\n";
      out += it.str;
      if (it.hasEOL) out += "\n";
      if (y !== null) { lastY = y; lastH = it.height || Math.abs(it.transform[3]) || 0; }
    }
    return out.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
  }

  // a file name from inside a PDF made safe to download / put in a ZIP: no folders, no odd characters
  function safeName(name, fallback) {
    let n = String(name == null ? "" : name).split(/[\\/]/).pop();
    n = n.replace(/[\u0000-\u001F\u007F<>:"|?*‪-‮⁦-⁩]/g, "_").replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
    if (n.length > 120) { const m = /(\.[A-Za-z0-9]{1,8})$/.exec(n); n = n.slice(0, 120 - (m ? m[1].length : 0)) + (m ? m[1] : ""); }
    return n || fallback || "file";
  }
  // make names unique inside one ZIP: a.txt, a (2).txt
  function uniqueNames(names) {
    const seen = new Map(), out = [];
    for (const n of names) {
      const key = n.toLowerCase();
      const k = (seen.get(key) || 0) + 1; seen.set(key, k);
      if (k === 1) { out.push(n); continue; }
      const m = /^(.*?)(\.[^.]*)?$/.exec(n);
      out.push(`${m[1]} (${k})${m[2] || ""}`);
    }
    return out;
  }
  const pad = (n, d) => String(n).padStart(d, "0");

  // raw pixels from pdf.js (1 = grey 1 bit, 2 = RGB, 3 = RGBA) -> RGBA bytes, or null
  function toRgba(obj) {
    const { width: w, height: h, data, kind } = obj;
    if (!data || !w || !h) return null;
    const out = new Uint8ClampedArray(w * h * 4);
    if (kind === 3 || data.length === w * h * 4) { out.set(data.subarray ? data.subarray(0, out.length) : data); return out; }
    if (kind === 2 || data.length === w * h * 3) { for (let i = 0, j = 0; i < w * h; i++) { out[j++] = data[i * 3]; out[j++] = data[i * 3 + 1]; out[j++] = data[i * 3 + 2]; out[j++] = 255; } return out; }
    if (kind === 1) {
      const rowBytes = (w + 7) >> 3;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0; const o = (y * w + x) * 4; out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255; }
      return out;
    }
    return null;
  }

  function init(root, shell) {
    const $ = id => root.querySelector("#pdfextract-" + id);
    const fmt = n => n.toLocaleString();
    const setStatus = m => { $("status").textContent = m; };
    const tick = () => new Promise(r => setTimeout(r, 0));
    let src = null;            // { name, bytes, doc, pages }
    let busy = false, cancelled = false;
    let text = "", pics = [], files = [];

    /* ---------- tabs ---------- */
    const tabs = [["text", $("tab-text"), $("panel-text")], ["pics", $("tab-pics"), $("panel-pics")], ["files", $("tab-files"), $("panel-files")]];
    function selectTab(name) {
      tabs.forEach(([n, tab, panel]) => { const on = n === name; tab.classList.toggle("on", on); tab.setAttribute("aria-selected", String(on)); tab.tabIndex = on ? 0 : -1; panel.hidden = !on; });
      $("pagesnote").textContent = name === "files" ? "Pages do not matter for attached files." : "Used for Text and Pictures.";
    }
    tabs.forEach(([n, tab], i) => {
      tab.addEventListener("click", () => selectTab(n));
      tab.addEventListener("keydown", e => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        selectTab(next[0]); next[1].focus();
      });
    });

    function closeSrc() { if (src) C.closePdf(src.doc); src = null; }
    function resetAll() {
      closeSrc(); text = ""; pics = []; files = [];
      $("name").textContent = ""; $("main").hidden = true; $("empty").hidden = false; $("file").value = "";
      $("pages").value = ""; $("textbox").value = ""; $("piclist").textContent = ""; $("filelist").textContent = "";
      $("textinfo").textContent = 'Press "Read the text".'; $("textinfo").classList.remove("bad");
      $("picinfo").textContent = 'Press "Find the pictures".'; $("picinfo").classList.remove("bad");
      for (const id of ["copytext", "savetext", "savepics", "savefiles"]) $(id).disabled = true;
      $("count").textContent = "Pages: 0";
      selectTab("text"); setStatus("Ready");
    }

    /* ---------- opening ---------- */
    async function openSource(f) {
      if (busy) return;
      setStatus("Reading the file...");
      let data;
      try { data = await C.readFile(f); } catch (e) { setStatus("Could not read the file."); shell.alert(e.message); return; }
      if (!C.scanRaw(data).header) { setStatus("Not a PDF."); shell.alert(`"${f.name}" does not look like a PDF file.`); return; }
      let doc;
      try { doc = await C.openPdf(data); }
      catch (e) {
        setStatus("Could not open the PDF.");
        shell.alert(e && e.name === "PasswordException" ? `"${f.name}" is protected by a password. Remove it first, then open it here.` : `This file could not be read as a PDF. ${e && e.message ? e.message : ""}`.trim());
        return;
      }
      let perms = null;
      try { perms = await doc.getPermissions(); } catch { /* none */ }
      if (perms) {
        const allowed = new Set(perms instanceof Map ? [...perms.values()] : Array.isArray(perms) ? perms : Object.values(perms));
        if (!allowed.has(0x10)) { C.closePdf(doc); setStatus("This PDF does not allow copying."); shell.alert(`"${f.name}" has restrictions set by its author that do not allow copying its content. Remove the restrictions first.`); return; }
      }
      resetAll();
      src = { name: f.name, bytes: data, doc, pages: doc.numPages };
      $("name").textContent = f.name; $("name").title = f.name;
      $("empty").hidden = true; $("main").hidden = false;
      $("count").textContent = `Pages: ${fmt(src.pages)}`;
      setStatus(`${f.name}: ${fmt(src.pages)} page${src.pages === 1 ? "" : "s"}.`);
      await listAttachments();
    }

    function chosenPages() {
      const spec = $("pages").value;
      if (!spec.trim()) return { pages: Array.from({ length: src.pages }, (_, i) => i + 1) };
      return C.parseRanges(spec, src.pages);
    }
    const note = (el, msg, bad) => { el.textContent = msg; el.classList.toggle("bad", !!bad); };

    /* ---------- text ---------- */
    async function readText() {
      if (busy || !src) return;
      const r = chosenPages();
      if (r.error) { note($("textinfo"), r.error, true); return; }
      if (!r.pages.length) { note($("textinfo"), "No pages chosen.", true); return; }
      busy = true; $("readtext").disabled = true;
      const parts = [];
      try {
        for (let i = 0; i < r.pages.length; i++) {
          setStatus(`Reading page ${r.pages[i]} (${i + 1} of ${r.pages.length})...`);
          if (i % 5 === 0) await tick();
          const page = await src.doc.getPage(r.pages[i]);
          const tc = await page.getTextContent();
          page.cleanup();
          const t = textFromItems(tc.items);
          parts.push($("marks").checked ? `--- Page ${r.pages[i]} ---\n${t}` : t);
        }
        text = parts.join("\n\n");
        const bare = text.replace(/--- Page \d+ ---/g, "").replace(/\s+/g, "");
        if (!bare.length) {
          text = ""; $("textbox").value = "";
          note($("textinfo"), "No text found on these pages. This PDF may be made of scanned pictures of pages, so there is no text to take out.", true);
          $("copytext").disabled = $("savetext").disabled = true;
          setStatus("No text found.");
        } else {
          const words = (text.replace(/--- Page \d+ ---/g, " ").match(/\S+/g) || []).length;
          $("textbox").value = text.length > SHOW_CHARS ? text.slice(0, SHOW_CHARS) : text;
          note($("textinfo"), `${fmt(r.pages.length)} page${r.pages.length === 1 ? "" : "s"}, ${fmt(bare.length)} characters, about ${fmt(words)} words.${text.length > SHOW_CHARS ? ` Only the first ${fmt(SHOW_CHARS)} characters are shown here; Save and Copy use all of it.` : ""}`, false);
          $("copytext").disabled = $("savetext").disabled = false;
          setStatus("Text ready.");
        }
      } catch (e) {
        setStatus("Could not read the text."); shell.alert(`Could not read the text. ${e && e.message ? e.message : ""}`.trim());
      } finally { busy = false; $("readtext").disabled = false; }
    }
    async function copyText() {
      try { await navigator.clipboard.writeText(text); setStatus("Copied."); }
      catch { $("textbox").value = text.length > SHOW_CHARS ? text.slice(0, SHOW_CHARS) : text; $("textbox").select(); try { document.execCommand("copy"); setStatus("Copied."); } catch { setStatus("Could not copy: select the text and copy it yourself."); } }
    }
    const saveText = () => { const name = `${C.baseName(src.name)}.txt`; C.downloadBlob(new Blob(["﻿", text], { type: "text/plain;charset=utf-8" }), name); setStatus(`Saved ${name}.`); };

    /* ---------- pictures ---------- */
    async function pdfjsImage(page, id) {
      const store = typeof id === "string" && id.startsWith("g_") ? page.commonObjs : page.objs;
      return new Promise(res => { const t = setTimeout(() => res(null), 8000); try { store.get(id, o => { clearTimeout(t); res(o); }); } catch { clearTimeout(t); res(null); } });
    }
    async function imageToCanvas(obj) {
      if (!obj) return null;
      if (obj.bitmap) {
        // pdf.js may hand over an ImageBitmap or a VideoFrame (which has displayWidth instead of width)
        const bw = obj.bitmap.displayWidth || obj.bitmap.width || obj.width, bh = obj.bitmap.displayHeight || obj.bitmap.height || obj.height;
        const cv = document.createElement("canvas"); cv.width = bw; cv.height = bh;
        cv.getContext("2d", { willReadFrequently: true }).drawImage(obj.bitmap, 0, 0, bw, bh); return cv;
      }
      const rgba = toRgba(obj);
      if (!rgba) return null;
      const cv = document.createElement("canvas"); cv.width = obj.width; cv.height = obj.height;
      cv.getContext("2d", { willReadFrequently: true }).putImageData(new ImageData(rgba, obj.width, obj.height), 0, 0);
      return cv;
    }
    const fnv = d => { let h = 2166136261; for (let i = 0; i < d.length; i += 17) { h ^= d[i]; h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
    const toBlob = cv => new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error("Could not make the picture."))), "image/png"));

    async function findPics() {
      if (busy || !src) return;
      const r = chosenPages();
      if (r.error) { note($("picinfo"), r.error, true); return; }
      if (!r.pages.length) { note($("picinfo"), "No pages chosen.", true); return; }
      busy = true; cancelled = false;
      $("findpics").hidden = true; $("cancelpics").hidden = false; $("savepics").disabled = true;
      $("piclist").textContent = ""; pics = [];
      const OPS = (await C.loadPdfjs()).OPS;
      const seen = new Map(); let total = 0, skipped = 0, tooBig = 0, stopped = "";
      const skipTiny = $("skiptiny").checked, base = C.baseName(src.name), digits = String(src.pages).length;
      try {
        scan: for (let i = 0; i < r.pages.length; i++) {
          if (cancelled) { stopped = "Cancelled."; break; }
          const n = r.pages[i];
          setStatus(`Looking at page ${n} (${i + 1} of ${r.pages.length}), ${pics.length} found...`);
          await tick();
          const page = await src.doc.getPage(n);
          let ol;
          try { ol = await page.getOperatorList(); } catch { page.cleanup(); continue; }
          let k = 0;
          for (let j = 0; j < ol.fnArray.length; j++) {
            const fn = ol.fnArray[j];
            if (fn !== OPS.paintImageXObject && fn !== OPS.paintInlineImageXObject && fn !== OPS.paintImageXObjectRepeat) continue;
            const a = ol.argsArray[j];
            const obj = fn === OPS.paintInlineImageXObject ? a[0] : await pdfjsImage(page, a[0]);
            if (!obj) continue;
            const bm = obj.bitmap, w = obj.width || (bm && (bm.displayWidth || bm.width)) || 0, h = obj.height || (bm && (bm.displayHeight || bm.height)) || 0;
            if (!w || !h) continue;
            if (skipTiny && (w < MIN_SIDE || h < MIN_SIDE)) { skipped++; continue; }
            if (w * h > MAX_PIC_PIXELS) { tooBig++; continue; }
            const cv = await imageToCanvas(obj);
            if (!cv) continue;
            const key = `${cv.width}x${cv.height}:${fnv(cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data)}`;
            if (seen.has(key)) { const p = seen.get(key); if (!p.pages.includes(n)) p.pages.push(n); cv.width = cv.height = 0; continue; }
            if (pics.length >= MAX_PICS) { stopped = `Stopped after ${MAX_PICS} pictures.`; cv.width = cv.height = 0; break scan; }
            const blob = await toBlob(cv);
            total += blob.size;
            if (total > MAX_OUT_BYTES) { stopped = `Stopped: the pictures together would be bigger than ${C.humanSize(MAX_OUT_BYTES)}.`; cv.width = cv.height = 0; break scan; }
            const kk = Math.min(1, 120 / Math.max(w, h)), th = document.createElement("canvas");
            th.width = Math.max(1, Math.round(w * kk)); th.height = Math.max(1, Math.round(h * kk));
            th.getContext("2d").drawImage(cv, 0, 0, th.width, th.height);
            cv.width = cv.height = 0;
            k++;
            const p = { name: `${base}-page-${pad(n, digits)}-picture-${k}.png`, blob, w, h, pages: [n], thumb: th };
            seen.set(key, p); pics.push(p);
          }
          page.cleanup();
        }
        showPics(skipped, tooBig, stopped);
      } catch (e) {
        setStatus("Could not look for pictures."); shell.alert(`Could not look for pictures. ${e && e.message ? e.message : ""}`.trim());
      } finally { busy = false; $("findpics").hidden = false; $("cancelpics").hidden = true; }
    }
    function showPics(skipped, tooBig, stopped) {
      const list = $("piclist"); list.textContent = "";
      pics.forEach(p => {
        const li = document.createElement("li");
        const th = document.createElement("span"); th.className = "thumb"; th.append(p.thumb);
        const info = document.createElement("span");
        const nm = document.createElement("div"); nm.className = "name"; nm.textContent = p.name;
        const mt = document.createElement("div"); mt.className = "meta";
        mt.textContent = `${fmt(p.w)} x ${fmt(p.h)} pixels, ${C.humanSize(p.blob.size)}, ${p.pages.length > 1 ? "pages" : "page"} ${C.describePages(p.pages)}`;
        info.append(nm, mt);
        const b = document.createElement("button"); b.type = "button"; b.className = "xp-btn small"; b.textContent = "Save"; b.setAttribute("aria-label", `Save ${p.name}`);
        b.addEventListener("click", () => C.downloadBlob(p.blob, p.name));
        li.append(th, info, b); list.append(li);
      });
      const extra = [skipped ? `${fmt(skipped)} tiny picture${skipped === 1 ? "" : "s"} skipped` : "", tooBig ? `${fmt(tooBig)} too large to take out` : "", stopped].filter(Boolean).join(". ");
      if (!pics.length) note($("picinfo"), `No pictures found on these pages.${extra ? " " + extra + "." : ""} Pages made of scanned images may need a different tool; shapes and text are not pictures.`, true);
      else note($("picinfo"), `Found ${fmt(pics.length)} picture${pics.length === 1 ? "" : "s"}.${extra ? " " + extra + "." : ""}`, false);
      $("savepics").disabled = !pics.length;
      setStatus(stopped || (pics.length ? `${fmt(pics.length)} picture${pics.length === 1 ? "" : "s"} found.` : "No pictures found."));
    }
    async function zipUp(entries, zipName) {
      setStatus("Packing the ZIP file..."); await tick();
      const names = uniqueNames(entries.map(e => e.name)), obj = {};
      for (let i = 0; i < entries.length; i++) obj[names[i]] = [entries[i].bytes || new Uint8Array(await entries[i].blob.arrayBuffer()), { level: 0 }];
      const zip = fflate.zipSync(obj, { level: 0 });
      C.downloadBlob(new Blob([zip], { type: "application/zip" }), zipName);
      setStatus(`Saved ${zipName}: ${fmt(entries.length)} file${entries.length === 1 ? "" : "s"}, ${C.humanSize(zip.length)}.`);
    }

    /* ---------- attached files ---------- */
    async function listAttachments() {
      let att = null;
      try { att = await src.doc.getAttachments(); } catch { /* none */ }
      // this pdf.js gives a Map (name -> details, content fetched by name); older ones gave an object with the content inside
      const found = [];
      if (att instanceof Map) {
        for (const [key, v] of att) {
          let content = v && v.content;
          if (!content && typeof src.doc.getAttachmentContent === "function") { try { content = await src.doc.getAttachmentContent(key); } catch { content = null; } }
          found.push({ filename: (v && (v.filename || v.rawFilename)) || key, raw: v && v.rawFilename, description: v && v.description, content });
        }
      } else if (att) for (const v of Object.values(att)) found.push({ filename: v.filename || v.name, description: v.description, content: v.content });
      files = found.map((a, i) => ({ name: safeName(a.filename, `attachment-${i + 1}`), original: String(a.raw || a.filename || ""), bytes: a.content instanceof Uint8Array ? a.content : new Uint8Array(a.content || 0), description: String(a.description || "") }));
      const ul = $("filelist"); ul.textContent = "";
      files.forEach(f => {
        const li = document.createElement("li"); li.className = "nothumb";
        const info = document.createElement("span");
        const nm = document.createElement("div"); nm.className = "name"; nm.textContent = f.name;
        const mt = document.createElement("div"); mt.className = "meta";
        mt.textContent = `${C.humanSize(f.bytes.length)}${f.description ? `, ${f.description.slice(0, 200)}` : ""}${f.original !== f.name ? `, stored as "${f.original.slice(0, 200)}"` : ""}`;
        info.append(nm, mt);
        const b = document.createElement("button"); b.type = "button"; b.className = "xp-btn small"; b.textContent = "Save"; b.setAttribute("aria-label", `Save ${f.name}`);
        b.addEventListener("click", () => { C.downloadBlob(new Blob([f.bytes], { type: "application/octet-stream" }), f.name); setStatus(`Saved ${f.name}.`); });
        li.append(info, b); ul.append(li);
      });
      note($("fileinfo"), files.length ? `This PDF has ${fmt(files.length)} attached file${files.length === 1 ? "" : "s"}.` : "This PDF has no attached files.", false);
      $("savefiles").disabled = files.length < 2;
      $("tab-files").textContent = files.length ? `Attached files (${files.length})` : "Attached files";
    }

    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const f = $("file").files[0]; $("file").value = ""; if (f) openSource(f); });
    $("clear").addEventListener("click", () => { if (!busy) { resetAll(); $("tab-files").textContent = "Attached files"; } });
    $("readtext").addEventListener("click", readText);
    $("copytext").addEventListener("click", copyText);
    $("savetext").addEventListener("click", saveText);
    $("findpics").addEventListener("click", findPics);
    $("cancelpics").addEventListener("click", () => { cancelled = true; });
    $("savepics").addEventListener("click", () => zipUp(pics.map(p => ({ name: p.name, blob: p.blob })), `${C.baseName(src.name)}-pictures.zip`));
    $("savefiles").addEventListener("click", () => zipUp(files.map(f => ({ name: f.name, bytes: f.bytes })), `${C.baseName(src.name)}-attachments.zip`));
    C.enableDrop(root.querySelector(".pext"), openSource);
    return { destroy() { closeSrc(); text = ""; pics = []; files = []; } };
  }

  return { init, textFromItems, safeName, uniqueNames, toRgba };
})();
