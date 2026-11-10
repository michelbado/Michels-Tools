/* Organize Pages: reorder, rotate, delete, duplicate and insert blank pages. Everything runs in the browser; the PDF is
   never uploaded. pdf.js draws the thumbnails, pdf-lib builds the new file.
   The working list is plain data (items); the thumbnails are views of it. */
(window.DesktopApps = window.DesktopApps || {}).pdforganize = (() => {
  const C = window.PDFCommon;
  const BOX = 108;                       // the longest side of a thumbnail, in CSS pixels
  const A4 = [595.28, 841.89];
  const NEEDS_UNLOCK = "This PDF has a password or restrictions, so it cannot be edited. Remove them first, then open it again.";

  /* ---------- pure helpers on the list (also used by the tests) ---------- */

  // move the items in `movingIds` (keeping their order) so they sit just before the item `beforeId` (null = at the end)
  function reorder(items, movingIds, beforeId) {
    const moving = items.filter(it => movingIds.has(it.uid));
    const rest = items.filter(it => !movingIds.has(it.uid));
    const at = beforeId == null ? rest.length : rest.findIndex(it => it.uid === beforeId);
    rest.splice(at < 0 ? rest.length : at, 0, ...moving);
    return rest;
  }

  // move the selected items one step earlier (-1) or later (+1), as a group
  function step(items, selected, dir) {
    const a = items.slice();
    if (dir < 0) { for (let i = 1; i < a.length; i++) if (selected.has(a[i].uid) && !selected.has(a[i - 1].uid)) [a[i - 1], a[i]] = [a[i], a[i - 1]]; }
    else { for (let i = a.length - 2; i >= 0; i--) if (selected.has(a[i].uid) && !selected.has(a[i + 1].uid)) [a[i + 1], a[i]] = [a[i], a[i + 1]]; }
    return a;
  }

  const rotateBy = (angle, delta) => (((angle + delta) % 360) + 360) % 360;

  // the ids from a to b, inclusive, in list order
  function rangeIds(items, aId, bId) {
    const i = items.findIndex(x => x.uid === aId), j = items.findIndex(x => x.uid === bId);
    if (i < 0 || j < 0) return [];
    return items.slice(Math.min(i, j), Math.max(i, j) + 1).map(x => x.uid);
  }

  // the position of the real page a blank page at `index` takes its size from: the nearest one before it, else after it, else -1
  function blankNeighbor(items, index) {
    for (let i = index - 1; i >= 0; i--) if (items[i].src >= 0) return i;
    for (let i = index + 1; i < items.length; i++) if (items[i].src >= 0) return i;
    return -1;
  }

  // where a dragged group would land: the uid it goes before (null = the end). rects: [{uid, left, top, right, bottom}] in reading order
  function dropTarget(rects, draggedIds, px, py) {
    for (const r of rects) {
      if (draggedIds.has(r.uid)) continue;
      if (py < r.top) return r.uid;
      if (py <= r.bottom && px < (r.left + r.right) / 2) return r.uid;
    }
    return null;
  }

  /* ---------- the window ---------- */

  function init(root, shell) {
    const $ = id => root.querySelector("#pdforganize-" + id);
    const fmt = n => n.toLocaleString();
    const grid = $("grid"), marker = $("marker");

    let file = null, bytes = null, pdfDoc = null, total = 0, signed = false;
    let items = [], selected = new Set(), anchor = null, history = [], nextUid = 1;
    let epoch = 0, busy = false, observer = null, focusUid = null;
    const nodes = new Map();             // uid -> element
    const thumbs = new Map();            // source page index -> { canvas, w, h } (CSS-sized to BOX)
    const pending = new Map();           // source page index -> Promise
    let defaultDims = { w: Math.round(BOX * 0.72), h: BOX };
    const queue = []; let running = 0;

    const setStatus = m => { $("status").textContent = m; };
    const isEncryptedError = e => !!e && ((window.PDFLib && PDFLib.EncryptedPDFError && e instanceof PDFLib.EncryptedPDFError) || e.name === "EncryptedPDFError" || /is encrypted/i.test(String(e.message)));

    /* ---------- thumbnails ---------- */

    function dimsOf(src) { const t = thumbs.get(src); return t ? { w: t.w, h: t.h } : defaultDims; }

    function ensureThumb(src) {
      if (thumbs.has(src)) return Promise.resolve(thumbs.get(src));
      if (pending.has(src)) return pending.get(src);
      const my = epoch;
      const p = (async () => {
        const page = await pdfDoc.getPage(src + 1);
        const v1 = page.getViewport({ scale: 1 });
        const k = BOX / Math.max(v1.width, v1.height);
        const cssW = Math.max(8, Math.round(v1.width * k)), cssH = Math.max(8, Math.round(v1.height * k));
        const cv = document.createElement("canvas");
        cv.width = cssW * 2; cv.height = cssH * 2;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
        const vp = page.getViewport({ scale: (cssW * 2) / v1.width });
        try { await page.render({ canvasContext: ctx, canvas: cv, viewport: vp }).promise; } catch { /* a page that cannot be drawn stays blank */ }
        page.cleanup();
        const t = { canvas: cv, w: cssW, h: cssH };
        if (my === epoch) thumbs.set(src, t);
        return t;
      })();
      pending.set(src, p);
      p.finally(() => pending.delete(src));
      return p;
    }

    function pump() {
      while (running < 2 && queue.length) {
        const node = queue.shift();
        running++;
        drawNode(node).finally(() => { running--; pump(); });
      }
    }

    async function drawNode(node) {
      const it = items.find(x => String(x.uid) === node.dataset.uid);
      if (!it || it.src < 0 || !pdfDoc) return;
      const my = epoch;
      let t;
      try { t = await ensureThumb(it.src); } catch { return; }
      if (my !== epoch) return;
      const box = node.querySelector(".box");
      let cv = box.querySelector("canvas");
      if (!cv) { cv = document.createElement("canvas"); box.append(cv); }
      cv.width = t.canvas.width; cv.height = t.canvas.height;
      cv.getContext("2d").drawImage(t.canvas, 0, 0);
      node.dataset.drawn = "1";
      // the real shape of the page is known now: fix every view of this page
      items.forEach((x, i) => { const n = nodes.get(x.uid); if (n) sizeBox(n, x, i); });
    }

    /* ---------- views ---------- */

    function makeNode(it) {
      const el = document.createElement("div");
      el.className = "pg"; el.dataset.uid = String(it.uid);
      el.setAttribute("role", "option"); el.tabIndex = -1;
      const box = document.createElement("div"); box.className = "box";
      const no = document.createElement("span"); no.className = "no";
      const tag = document.createElement("span"); tag.className = "tag";
      el.append(box, no, tag);
      if (it.src < 0) box.classList.add("blank");
      nodes.set(it.uid, el);
      if (observer) observer.observe(el);
      return el;
    }

    function sizeBox(node, it, idx) {
      let d = it.src >= 0 ? dimsOf(it.src) : null;
      if (!d) {                                           // a blank page is as big as the page next to it, as that page is shown now
        const ni = blankNeighbor(items, idx), n = ni >= 0 ? items[ni] : null;
        d = n ? dimsOf(n.src) : defaultDims;
        if (n && n.rot % 180 !== 0) d = { w: d.h, h: d.w };
      }
      const swap = it.rot % 180 !== 0;
      const box = node.querySelector(".box");
      box.style.width = (swap ? d.h : d.w) + "px"; box.style.height = (swap ? d.w : d.h) + "px";
      const cv = box.querySelector("canvas");
      if (cv) { cv.style.width = d.w + "px"; cv.style.height = d.h + "px"; cv.style.transform = `translate(-50%, -50%) rotate(${it.rot}deg)`; }
    }

    function render() {
      $("empty").hidden = items.length > 0;
      const keep = new Set(items.map(x => x.uid));
      for (const [uid, el] of nodes) if (!keep.has(uid)) { if (observer) observer.unobserve(el); el.remove(); nodes.delete(uid); }
      items.forEach((it, i) => {
        const el = nodes.get(it.uid) || makeNode(it);
        if (grid.children[i + 1] !== el) grid.insertBefore(el, grid.children[i + 1] || null);   // children[0] is the empty-state message
        el.querySelector(".no").textContent = it.src < 0 ? `Page ${i + 1}` : `Page ${i + 1}`;
        const bits = [];
        if (it.src < 0) bits.push("blank");
        else if (it.src !== i) bits.push(`was ${it.src + 1}`);
        if (it.rot) bits.push(`turned ${it.rot}`);
        el.querySelector(".tag").textContent = bits.join(", ");
        el.setAttribute("aria-selected", String(selected.has(it.uid)));
        el.setAttribute("aria-label", `Page ${i + 1}${it.src < 0 ? ", blank" : ""}`);
        el.tabIndex = (focusUid === it.uid || (focusUid == null && i === 0)) ? 0 : -1;
        sizeBox(el, it, i);
      });
      refreshButtons();
    }

    function refreshButtons() {
      const has = items.length > 0, sel = selected.size > 0;
      ["rotl", "rotr", "del", "dup", "earlier", "later"].forEach(id => { $(id).disabled = busy || !sel; });
      ["blank", "reverse", "all", "none", "odd", "even", "invert"].forEach(id => { $(id).disabled = busy || !has; });
      $("undo").disabled = busy || !history.length;
      $("download").disabled = busy || !has;
      $("count").textContent = pdfDoc ? `${fmt(items.length)} (was ${fmt(total)})` : "0";
      $("sel").textContent = fmt(selected.size);
    }

    /* ---------- changing the list ---------- */

    const snapshot = () => items.map(x => ({ ...x }));
    // after the list changed, keep the keyboard focus inside the grid: if the focused page went away, the page now in its place gets it
    function keepFocus(hadFocus, oldIndex) {
      if (focusUid == null || !items.some(x => x.uid === focusUid)) focusUid = items.length ? items[Math.min(Math.max(oldIndex, 0), items.length - 1)].uid : null;
      render();
      if (hadFocus && focusUid != null) { const n = nodes.get(focusUid); if (n) n.focus({ preventScroll: true }); }
    }

    function change(fn, message) {
      if (busy) return;
      const hadFocus = grid.contains(document.activeElement), oldIndex = focusUid != null ? posOf(focusUid) : -1;
      history.push(snapshot());
      if (history.length > 100) history.shift();
      fn();
      selected = new Set([...selected].filter(u => items.some(x => x.uid === u)));
      keepFocus(hadFocus, oldIndex);
      if (message) setStatus(message);
    }

    const selectedItems = () => items.filter(x => selected.has(x.uid));
    const plural = (n, a, b) => `${fmt(n)} ${n === 1 ? a : b}`;

    function rotate(delta) {
      const n = selected.size;
      change(() => { for (const it of items) if (selected.has(it.uid)) it.rot = rotateBy(it.rot, delta); }, `Turned ${plural(n, "page", "pages")} ${delta > 0 ? "right" : "left"}.`);
    }
    function del() {
      const n = selected.size;
      change(() => { items = items.filter(x => !selected.has(x.uid)); selected = new Set(); }, items.length === n ? "Deleted every page. Undo brings them back." : `Deleted ${plural(n, "page", "pages")}.`);
    }
    function duplicate() {
      const n = selected.size;
      change(() => {
        const out = [];
        for (const it of items) { out.push(it); if (selected.has(it.uid)) out.push({ ...it, uid: nextUid++ }); }
        items = out;
      }, `Duplicated ${plural(n, "page", "pages")}.`);
    }
    function insertBlank() {
      change(() => {
        let at = items.length;
        for (let i = items.length - 1; i >= 0; i--) if (selected.has(items[i].uid)) { at = i + 1; break; }
        items.splice(at, 0, { uid: nextUid++, src: -1, rot: 0 });
      }, "Inserted a blank page.");
    }
    const moveStep = dir => change(() => { items = step(items, selected, dir); }, dir < 0 ? "Moved earlier." : "Moved later.");
    const reverse = () => change(() => { items = items.slice().reverse(); }, "Reversed the page order.");
    const choose = ids => { selected = new Set(ids); anchor = ids[ids.length - 1] ?? null; render(); };
    const posOf = uid => items.findIndex(x => x.uid === uid);

    function undo() {
      if (!history.length || busy) return;
      const hadFocus = grid.contains(document.activeElement), oldIndex = focusUid != null ? posOf(focusUid) : -1;
      items = history.pop();
      selected = new Set([...selected].filter(u => items.some(x => x.uid === u)));
      keepFocus(hadFocus, oldIndex);
      setStatus("Undid the last change.");
    }

    /* ---------- selecting and dragging ---------- */

    let press = null, drag = null;

    grid.addEventListener("pointerdown", e => {
      if (e.button > 0 || busy) return;
      const pg = e.target.closest(".pg");
      if (!pg) { if (items.length) choose([]); return; }
      const uid = Number(pg.dataset.uid);
      press = { uid, x: e.clientX, y: e.clientY, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, id: e.pointerId };
      focusUid = uid;
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
    });

    function groupFor(uid) { return selected.has(uid) ? new Set(selected) : new Set([uid]); }

    function onMove(e) {
      if (!press) return;
      if (!drag) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
        const ids = groupFor(press.uid);
        if (!selected.has(press.uid)) { selected = new Set([press.uid]); anchor = press.uid; }
        drag = { ids, before: undefined };
        for (const u of ids) { const n = nodes.get(u); if (n) n.classList.add("dragging"); }
        const g = document.createElement("div"); g.className = "ghost"; g.textContent = ids.size === 1 ? "Moving 1 page" : `Moving ${ids.size} pages`;
        document.body.append(g); drag.ghost = g;
        render();
      }
      drag.ghost.style.left = e.clientX + 12 + "px"; drag.ghost.style.top = e.clientY + 12 + "px";
      const gr = grid.getBoundingClientRect();
      if (e.clientY < gr.top + 34) grid.scrollTop -= 14; else if (e.clientY > gr.bottom - 34) grid.scrollTop += 14;
      const rects = items.map(it => { const r = nodes.get(it.uid).getBoundingClientRect(); return { uid: it.uid, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
      drag.before = dropTarget(rects, drag.ids, e.clientX, e.clientY);
      // the drop marker
      const wr = grid.parentElement.getBoundingClientRect();
      let r = null, atEnd = false;
      if (drag.before != null) r = rects.find(x => x.uid === drag.before);
      else { const last = [...rects].reverse().find(x => !drag.ids.has(x.uid)); r = last; atEnd = true; }
      if (r) { marker.hidden = false; marker.style.left = (atEnd ? r.right : r.left) - wr.left - 2 + "px"; marker.style.top = r.top - wr.top + "px"; marker.style.height = r.bottom - r.top + "px"; }
      else marker.hidden = true;
    }

    function endPress() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      if (drag) { drag.ghost.remove(); for (const n of nodes.values()) n.classList.remove("dragging"); marker.hidden = true; }
      const d = drag; press = null; drag = null;
      return d;
    }
    function onCancel() { endPress(); }
    function onUp() {
      const p = press, d = endPress();
      if (!p) return;
      if (d) {
        const n = d.ids.size;
        if (d.before === undefined) return;
        change(() => { items = reorder(items, d.ids, d.before); }, `Moved ${plural(n, "page", "pages")}.`);
        return;
      }
      if (p.ctrl) { const s = new Set(selected); if (s.has(p.uid)) s.delete(p.uid); else s.add(p.uid); selected = s; anchor = p.uid; }
      else if (p.shift && anchor != null) selected = new Set(rangeIds(items, anchor, p.uid));
      else { selected = new Set([p.uid]); anchor = p.uid; }
      render();
      const n = nodes.get(p.uid); if (n) n.focus({ preventScroll: true });
    }

    grid.addEventListener("keydown", e => {
      const pg = e.target.closest(".pg");
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "a" || e.key === "A") { e.preventDefault(); choose(items.map(x => x.uid)); }
        else if (e.key === "z" || e.key === "Z") { e.preventDefault(); undo(); }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") { if (selected.size) { e.preventDefault(); del(); } return; }
      if (!pg) return;
      const uid = Number(pg.dataset.uid), i = posOf(uid);
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); const s = new Set(selected); if (e.shiftKey || s.has(uid) === false) s.add(uid); else s.delete(uid); selected = s; anchor = uid; render(); return; }
      const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const j = Math.min(items.length - 1, Math.max(0, i + dir));
      focusUid = items[j].uid;
      if (e.shiftKey && anchor != null) selected = new Set(rangeIds(items, anchor, focusUid));
      render();
      nodes.get(focusUid).focus();
    });

    /* ---------- opening ---------- */

    function clearDoc() {
      epoch++;
      if (observer) { observer.disconnect(); observer = null; }
      if (pdfDoc) { C.closePdf(pdfDoc); pdfDoc = null; }
      file = bytes = null; total = 0; signed = false; items = []; selected = new Set(); anchor = null; history = []; focusUid = null;
      thumbs.clear(); pending.clear(); queue.length = 0;
      for (const el of nodes.values()) el.remove();
      nodes.clear();
    }

    function reset() {
      clearDoc();
      $("file").value = ""; $("name").textContent = ""; $("signedwarn").hidden = true;
      render(); setStatus("Ready");
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
      file = f; bytes = data; pdfDoc = doc; total = doc.numPages; signed = raw.byteRanges > 0;
      $("signedwarn").hidden = !signed;
      $("name").textContent = `${f.name} (${C.humanSize(f.size)})`;
      try { const p1 = await doc.getPage(1); const v = p1.getViewport({ scale: 1 }); const k = BOX / Math.max(v.width, v.height); defaultDims = { w: Math.round(v.width * k), h: Math.round(v.height * k) }; p1.cleanup(); } catch { /* keep the default shape */ }
      items = Array.from({ length: total }, (_, i) => ({ uid: nextUid++, src: i, rot: 0 }));
      if ("IntersectionObserver" in window) {
        observer = new IntersectionObserver(entries => {
          for (const en of entries) if (en.isIntersecting && !en.target.dataset.queued) { en.target.dataset.queued = "1"; queue.push(en.target); }
          pump();
        }, { root: grid, rootMargin: "300px" });
      }
      render();
      if (!observer) for (const n of nodes.values()) { queue.push(n); }
      pump();
      setStatus(`${f.name}: ${fmt(total)} page${total === 1 ? "" : "s"}.${f.size > C.WARN_BYTES ? " This is a large file, so it may take a while." : ""}`);
    }

    /* ---------- saving ---------- */

    const tick = () => new Promise(r => setTimeout(r, 0));

    async function download() {
      if (!items.length || busy) return;
      busy = true; refreshButtons();
      try {
        setStatus("Building the new PDF...");
        let src;
        try { src = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false }); }
        catch (e) { if (isEncryptedError(e)) throw Object.assign(new Error(NEEDS_UNLOCK), { friendly: true }); throw e; }
        const out = await PDFLib.PDFDocument.create();
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (i % 40 === 39) { setStatus(`Building the new PDF... ${fmt(i + 1)} of ${fmt(items.length)}`); await tick(); }
          if (it.src < 0) {
            let w = A4[0], h = A4[1];
            const ni = blankNeighbor(items, i);
            if (ni >= 0) {                                   // the size of the neighbouring page, as it is shown (own turning included)
              const n = items[ni], ref = src.getPage(n.src), sz = ref.getSize();
              w = sz.width; h = sz.height;
              if (rotateBy(ref.getRotation().angle, n.rot) % 180 === 90) [w, h] = [h, w];
            }
            const page = out.addPage([w, h]);
            if (it.rot) page.setRotation(PDFLib.degrees(it.rot));
          } else {
            const [page] = await out.copyPages(src, [it.src]);
            page.setRotation(PDFLib.degrees(rotateBy(page.getRotation().angle, it.rot)));
            out.addPage(page);
          }
        }
        // keep the document's own details; say what edited it and when
        const keep = (get, set) => { const v = get.call(src); if (v) set.call(out, v); };
        keep(src.getTitle, out.setTitle); keep(src.getAuthor, out.setAuthor); keep(src.getSubject, out.setSubject); keep(src.getCreator, out.setCreator);
        const kw = src.getKeywords(); if (kw) out.setKeywords([kw]);
        const created = src.getCreationDate(); if (created) out.setCreationDate(created);
        out.setProducer("Michel's Tools"); out.setModificationDate(new Date());
        const saved = await out.save();
        const name = `${C.baseName(file.name)}-organized.pdf`;
        C.downloadBlob(new Blob([saved], { type: "application/pdf" }), name);
        setStatus(`Saved ${name}: ${fmt(items.length)} page${items.length === 1 ? "" : "s"}, ${C.humanSize(saved.length)}.`);
      } catch (e) {
        setStatus("Could not build the file.");
        shell.alert(e && e.friendly ? e.message : `Could not build the file. ${e && e.message ? e.message : ""}`.trim());
      } finally { busy = false; refreshButtons(); }
    }

    /* ---------- wiring ---------- */

    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const f = $("file").files[0]; if (f) openFile(f); });
    $("clear").addEventListener("click", () => { if (!busy) reset(); });
    $("undo").addEventListener("click", undo);
    $("download").addEventListener("click", download);
    $("rotl").addEventListener("click", () => rotate(-90));
    $("rotr").addEventListener("click", () => rotate(90));
    $("del").addEventListener("click", del);
    $("dup").addEventListener("click", duplicate);
    $("blank").addEventListener("click", insertBlank);
    $("earlier").addEventListener("click", () => moveStep(-1));
    $("later").addEventListener("click", () => moveStep(1));
    $("reverse").addEventListener("click", reverse);
    $("all").addEventListener("click", () => choose(items.map(x => x.uid)));
    $("none").addEventListener("click", () => choose([]));
    $("odd").addEventListener("click", () => choose(items.filter((_, i) => i % 2 === 0).map(x => x.uid)));
    $("even").addEventListener("click", () => choose(items.filter((_, i) => i % 2 === 1).map(x => x.uid)));
    $("invert").addEventListener("click", () => choose(items.filter(x => !selected.has(x.uid)).map(x => x.uid)));
    C.enableDrop($("content"), f => openFile(f));

    render();
    return { destroy() { clearDoc(); } };
  }

  return { init, reorder, step, rotateBy, rangeIds, blankNeighbor, dropTarget };
})();
