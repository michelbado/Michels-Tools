/* Screenshot Annotator. The objects and their drawing are in lib/imgannot.js, the pixel work for hidden areas in lib/imgmath.js; this file is the screen.
   The picture comes from a file, a drop or the clipboard and never leaves the browser. */
(window.DesktopApps = window.DesktopApps || {}).imgannotate = (() => {
  function init(root) {
    const $ = id => root.querySelector("#imgannotate-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const P = window.ImgProc, M = window.ImgMath, A = window.ImgAnnot, TK = window.TK;
    const win = root.closest ? root.closest(".window") : null;
    const cv = $("canvas"), cx = cv.getContext("2d");
    const TOOLS = [["select", "Select"], ["arrow", "Arrow"], ["rect", "Box"], ["ellipse", "Ellipse"], ["line", "Line"], ["pen", "Pen"], ["text", "Text"], ["step", "Step 1,2,3"], ["hl", "Highlight"], ["hide", "Hide"]];
    const HINTS = { select: "Click an item to select it: drag to move, drag a square to resize, Delete removes it.", arrow: "Drag from the tail to the point.", rect: "Drag a corner to the opposite corner.", ellipse: "Drag across the area.", line: "Drag from one end to the other.", pen: "Draw freely.", text: "Type the text above, then click where it should go.", step: "Click to place the next number.", hl: "Drag over what to highlight.", hide: "Drag over what to hide: it is really changed in the saved picture." };
    let tool = "arrow", color = A.COLORS[0], bmp = null, baseC = null, work = null, workKey = "", W = 0, H = 0, fname = "screenshot.png";
    let objs = [], sel = -1, drag = null, undo = [], redo = [];

    // ---- controls
    const toolBox = $("tools"), colBox = $("colors");
    for (const [id, label] of TOOLS) { const b = document.createElement("button"); b.type = "button"; b.className = "xp-btn"; b.textContent = label; b.dataset.tool = id; b.setAttribute("aria-pressed", id === tool ? "true" : "false"); b.addEventListener("click", () => setTool(id)); toolBox.append(b); }
    for (const c of A.COLORS) { const b = document.createElement("button"); b.type = "button"; b.dataset.color = c; b.setAttribute("role", "radio"); b.setAttribute("aria-label", "Colour " + c); b.setAttribute("aria-checked", c === color ? "true" : "false"); b.style.backgroundColor = c; b.addEventListener("click", () => setColor(c)); colBox.append(b); }
    function setTool(t) { tool = t; for (const b of toolBox.children) b.setAttribute("aria-pressed", b.dataset.tool === t ? "true" : "false"); $("hint").textContent = HINTS[t]; $("hidebar").hidden = t !== "hide" && !(sel >= 0 && objs[sel] && objs[sel].t === "hide"); cv.style.cursor = t === "select" ? "default" : "crosshair"; }
    function setColor(c) { color = c; $("custom").value = c.length === 7 ? c : "#e5202e"; for (const b of colBox.children) b.setAttribute("aria-checked", b.dataset.color.toLowerCase() === c.toLowerCase() ? "true" : "false"); if (sel >= 0) { const o = objs[sel]; if (o.t !== "hide") { act(() => { o.c = c; }); } } }
    $("custom").addEventListener("input", () => setColor($("custom").value));

    // ---- undo
    const snapshot = () => JSON.stringify(objs);
    function act(fn) { const before = snapshot(); fn(); if (snapshot() !== before) { undo.push(before); if (undo.length > 100) undo.shift(); redo = []; } refresh(); }
    function restore(json) { objs = JSON.parse(json); if (sel >= objs.length) sel = -1; refresh(); }
    $("undo").addEventListener("click", () => { if (!undo.length) return; redo.push(snapshot()); restore(undo.pop()); setStatus("Undone."); });
    $("redo").addEventListener("click", () => { if (!redo.length) return; undo.push(snapshot()); restore(redo.pop()); setStatus("Redone."); });
    function removeSel() { if (sel < 0) return; act(() => { objs.splice(sel, 1); sel = -1; }); setStatus("Removed."); }
    $("del").addEventListener("click", removeSel);
    $("clear").addEventListener("click", () => { if (!objs.length) return; act(() => { objs = []; sel = -1; }); setStatus("All marks removed."); });

    // ---- loading
    async function load(file) {
      TK.notes($("notes"), []); TK.notes($("check"), []); $("done").textContent = "";
      let b; try { b = await P.load(file); } catch (e) { TK.notes($("notes"), [{ level: "bad", text: e.message }]); setStatus("Not opened."); return; }
      if (bmp && bmp.close) bmp.close();
      bmp = b; W = b.width; H = b.height; fname = file.name || "screenshot.png"; baseC = P.toCanvas(b); work = null; workKey = ""; objs = []; sel = -1; undo = []; redo = [];
      cv.width = W; cv.height = H; fit(); $("name").textContent = fname + " (" + W + " × " + H + ")"; $("work").hidden = false; $("intro").hidden = true;
      $("fmt").value = /png|gif|bmp/i.test(file.type || fname) ? "png" : P.kindOf(file); fmtChanged(); refresh(); setStatus("Opened " + fname + ".");
    }
    function fit() { const avail = Math.max(200, ($("work").clientWidth || 800) - 4), z = Math.min(1, avail / W); cv.style.width = Math.round(W * z) + "px"; cv.style.height = Math.round(H * z) + "px"; }
    window.addEventListener("resize", fit);
    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const f = $("file").files[0]; if (f) load(f); $("file").value = ""; });
    $("paste").addEventListener("click", async () => {
      try { const items = await navigator.clipboard.read(); for (const it of items) { const t = it.types.find(x => x.startsWith("image/")); if (t) { const blob = await it.getType(t); load(new File([blob], "pasted-screenshot.png", { type: t })); return; } } setStatus("The clipboard holds no picture."); TK.notes($("notes"), [{ level: "info", text: "The clipboard holds no picture. Copy a screenshot first (for example Win+Shift+S, or PrtScn), then press Ctrl+V here." }]); }
      catch { TK.notes($("notes"), [{ level: "info", text: "This browser did not let the page read the clipboard. Press Ctrl+V with this window in front instead." }]); }
    });
    document.addEventListener("paste", onPaste);
    function onPaste(e) { if (win && !win.classList.contains("active")) return; const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return; const f = [...(e.clipboardData ? e.clipboardData.files : [])].find(x => /^image\//.test(x.type)); if (f) { e.preventDefault(); load(f); } }
    root.addEventListener("dragover", e => e.preventDefault());
    root.addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) load(f); });

    // ---- drawing
    function workCanvas() {
      const hides = objs.filter(o => o.t === "hide"), key = JSON.stringify(hides);
      if (!hides.length) { work = baseC; workKey = ""; return { c: baseC, ok: true }; }
      if (work && work !== baseC && workKey === key) return { c: work, ok: true };
      const c = P.toCanvas(baseC), g = c.getContext("2d", { willReadFrequently: true }); let ok = true; for (const o of hides) if (!A.applyHide(g, W, H, o)) ok = false;
      work = c; workKey = key; return { c, ok };
    }
    function redraw() {
      if (!baseC) return; cx.clearRect(0, 0, W, H); cx.drawImage(workCanvas().c, 0, 0); A.draw(cx, objs, W, H);
      for (const o of objs) if (o.t === "hide") { const r = A.rectOf(o); cx.save(); cx.setLineDash([6, 5]); cx.lineWidth = Math.max(1, W / 900); cx.strokeStyle = "rgba(255,255,255,.9)"; cx.strokeRect(r.x, r.y, r.w, r.h); cx.strokeStyle = "#000"; cx.lineDashOffset = 6; cx.strokeRect(r.x, r.y, r.w, r.h); cx.restore(); }
      if (sel >= 0 && objs[sel]) {
        const b = A.bounds(objs[sel]), k = Math.max(1, W / (parseFloat(cv.style.width) || W)); cx.save(); cx.setLineDash([5 * k, 4 * k]); cx.lineWidth = 1.2 * k; cx.strokeStyle = "#0831D9"; cx.strokeRect(b.x, b.y, b.w, b.h); cx.setLineDash([]); cx.fillStyle = "#fff"; cx.strokeStyle = "#0831D9";
        for (const h of A.handles(objs[sel])) { cx.fillRect(h.x - 5 * k, h.y - 5 * k, 10 * k, 10 * k); cx.strokeRect(h.x - 5 * k, h.y - 5 * k, 10 * k, 10 * k); } cx.restore();
      }
    }
    function refresh() {
      redraw();
      $("undo").disabled = !undo.length; $("redo").disabled = !redo.length; $("del").disabled = sel < 0; $("clear").disabled = !objs.length;
      $("count").textContent = objs.length ? objs.length + " mark" + (objs.length === 1 ? "" : "s") : "";
      const o = sel >= 0 ? objs[sel] : null; $("hidebar").hidden = !(tool === "hide" || (o && o.t === "hide")); $("textbar").hidden = !(tool === "text" || (o && o.t === "text"));
    }
    function syncControls(o) {
      if (!o) return; if (o.t !== "hide" && o.c) { color = o.c; for (const b of colBox.children) b.setAttribute("aria-checked", b.dataset.color.toLowerCase() === o.c.toLowerCase() ? "true" : "false"); if (/^#[0-9a-f]{6}$/i.test(o.c)) $("custom").value = o.c; }
      if (o.t === "text") { $("text").value = o.s; $("tstyle").value = o.style; }
      if (o.t === "hide") { $("hmode").value = o.mode; }
      if (o.t === "rect" || o.t === "ellipse") $("fill").checked = !!o.fill;
    }
    const pos = e => { const b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) * W / b.width, y: (e.clientY - b.top) * H / b.height, k: W / b.width }; };
    function make(t, p) {
      const size = $("size").value, lw = A.lineWidth(size, W, H);
      switch (t) {
        case "arrow": case "line": return { t, x1: p.x, y1: p.y, x2: p.x, y2: p.y, c: color, lw };
        case "rect": case "ellipse": return { t, x: p.x, y: p.y, w: 0, h: 0, c: color, lw, fill: $("fill").checked };
        case "hl": return { t, x: p.x, y: p.y, w: 0, h: 0, c: color === "#FFFFFF" || color === "#111111" ? "#F7D200" : color };
        case "hide": return { t, x: p.x, y: p.y, w: 0, h: 0, mode: $("hmode").value, strength: 7 };
        case "pen": return { t, pts: [[p.x, p.y]], c: color, lw };
      }
    }
    cv.addEventListener("pointerdown", e => {
      if (!baseC || e.button > 0) return; cv.focus(); const p = pos(e); cv.setPointerCapture(e.pointerId); const before = snapshot();
      if (tool === "select") {
        if (sel >= 0) for (const h of A.handles(objs[sel])) if (Math.abs(p.x - h.x) <= 9 * p.k && Math.abs(p.y - h.y) <= 9 * p.k) { drag = { kind: "handle", id: h.id, before }; return; }
        let found = -1; for (let i = objs.length - 1; i >= 0; i--) if (A.hit(objs[i], p.x, p.y, 7 * p.k)) { found = i; break; }
        sel = found; if (found >= 0) { syncControls(objs[found]); drag = { kind: "move", x: p.x, y: p.y, before }; } refresh(); return;
      }
      if (tool === "text") {
        const s = $("text").value; if (!s.trim()) { setStatus("Type the text first."); $("text").focus(); return; }
        act(() => { objs.push({ t: "text", x: p.x, y: p.y, s: s.slice(0, 500), c: color, size: A.fontPx($("size").value, W, H), style: $("tstyle").value }); sel = objs.length - 1; }); setTool("select"); return;
      }
      if (tool === "step") { act(() => { objs.push({ t: "step", x: p.x, y: p.y, n: A.nextStep(objs), c: color, r: Math.round(A.fontPx($("size").value, W, H) * 0.85) }); sel = objs.length - 1; }); return; }
      const o = make(tool, p); objs.push(o); sel = objs.length - 1; drag = { kind: "new", ax: p.x, ay: p.y, before }; refresh();
    });
    cv.addEventListener("pointermove", e => {
      if (!drag) return; const p = pos(e), o = objs[sel]; if (!o) return;
      if (drag.kind === "new") { const sh = e.shiftKey;
        if (o.t === "arrow" || o.t === "line") { let x = p.x, y = p.y; if (sh) { const dx = x - drag.ax, dy = y - drag.ay, a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, l = Math.hypot(dx, dy); x = drag.ax + Math.cos(a) * l; y = drag.ay + Math.sin(a) * l; } o.x2 = x; o.y2 = y; }
        else if (o.t === "pen") o.pts.push([p.x, p.y]);
        else { let w = p.x - drag.ax, h = p.y - drag.ay; if (sh && (o.t === "rect" || o.t === "ellipse")) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; } o.x = drag.ax; o.y = drag.ay; o.w = w; o.h = h; } }
      else if (drag.kind === "move") { A.move(o, p.x - drag.x, p.y - drag.y); drag.x = p.x; drag.y = p.y; }
      else if (drag.kind === "handle") A.dragHandle(o, drag.id, p.x, p.y);
      redraw();
    });
    function end() {
      if (!drag) return; const o = objs[sel], before = drag.before; drag = null;
      if (o && o.t === "pen") o.pts = A.thin(o.pts, Math.max(1, W / 900));
      if (o && (o.t === "rect" || o.t === "ellipse" || o.t === "hl" || o.t === "hide") && Math.abs(o.w) < 3 && Math.abs(o.h) < 3 && before !== undefined && JSON.parse(before).length < objs.length) { objs.pop(); sel = -1; }
      else if (o && (o.t === "arrow" || o.t === "line") && Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 3 && JSON.parse(before).length < objs.length) { objs.pop(); sel = -1; }
      if (snapshot() !== before) { undo.push(before); if (undo.length > 100) undo.shift(); redo = []; }
      refresh();
    }
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
    cv.addEventListener("dblclick", e => { if (tool !== "select" || sel < 0 || objs[sel].t !== "text") return; $("textbar").hidden = false; $("text").focus(); $("text").select(); });
    function key(e) {
      if (win && !win.classList.contains("active")) return; const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !baseC) return;
      const k = e.key;
      if ((k === "Delete" || k === "Backspace") && sel >= 0) { e.preventDefault(); removeSel(); }
      else if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "Z")) { e.preventDefault(); (e.shiftKey ? $("redo") : $("undo")).click(); }
      else if ((e.ctrlKey || e.metaKey) && (k === "y" || k === "Y")) { e.preventDefault(); $("redo").click(); }
      else if (k === "Escape") { sel = -1; refresh(); }
      else if (sel >= 0 && /^Arrow/.test(k)) { e.preventDefault(); const d = e.shiftKey ? 10 : 1, o = objs[sel]; act(() => A.move(o, k === "ArrowLeft" ? -d : k === "ArrowRight" ? d : 0, k === "ArrowUp" ? -d : k === "ArrowDown" ? d : 0)); }
    }
    document.addEventListener("keydown", key);
    // the settings change the selected item
    $("size").addEventListener("change", () => { if (sel < 0) return; const o = objs[sel]; act(() => { if (o.t === "text") o.size = A.fontPx($("size").value, W, H); else if (o.t === "step") o.r = Math.round(A.fontPx($("size").value, W, H) * 0.85); else if (o.lw) o.lw = A.lineWidth($("size").value, W, H); }); });
    $("fill").addEventListener("change", () => { if (sel >= 0 && /^(rect|ellipse)$/.test(objs[sel].t)) act(() => { objs[sel].fill = $("fill").checked; }); });
    $("text").addEventListener("input", () => { if (sel >= 0 && objs[sel].t === "text") { const o = objs[sel]; act(() => { o.s = $("text").value.slice(0, 500) || " "; }); } });
    $("tstyle").addEventListener("change", () => { if (sel >= 0 && objs[sel].t === "text") act(() => { objs[sel].style = $("tstyle").value; }); });
    $("hmode").addEventListener("change", () => { if (sel >= 0 && objs[sel].t === "hide") act(() => { objs[sel].mode = $("hmode").value; }); });

    // ---- saving
    const fmtChanged = () => { $("qlab").hidden = $("fmt").value === "png"; };
    $("fmt").addEventListener("change", fmtChanged); $("q").addEventListener("input", () => { $("qv").textContent = $("q").value; });
    function compose() {
      const c = P.toCanvas(baseC), g = c.getContext("2d", { willReadFrequently: true }); let bad = 0;
      for (const o of objs) if (o.t === "hide" && !A.applyHide(g, W, H, o)) bad++;
      if (bad) throw new Error("the check of the hidden areas failed for " + bad + " area(s), so nothing was saved");
      A.draw(g, objs, W, H); return c;
    }
    $("save").addEventListener("click", async () => {
      if (!baseC) return; TK.notes($("check"), []); $("done").textContent = "Working…"; setStatus("Working…");
      try {
        const c = compose(), kind = $("fmt").value, blob = await P.encode(c, kind, +$("q").value / 100, "#ffffff"), name = M.outName(fname, P.EXT[kind]).replace("-edited", "-annotated");
        P.download(blob, name); const hid = objs.filter(o => o.t === "hide").length;
        $("done").textContent = "Saved " + name + " (" + P.sizeText(blob.size) + ")."; if (hid) TK.notes($("check"), [{ level: "good", text: "Checked: " + hid + " hidden area" + (hid === 1 ? "" : "s") + " changed in the saved pixels (" + objs.filter(o => o.t === "hide" && o.mode === "black").length + " solid black). The original file was not changed." }]);
        setStatus("Saved.");
      } catch (e) { $("done").textContent = "Not saved: " + e.message; setStatus("Not saved."); }
    });
    $("copy").addEventListener("click", async () => {
      if (!baseC) return;
      try { const blob = await P.encode(compose(), "png", 1, "#ffffff"); await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); $("done").textContent = "Copied to the clipboard."; setStatus("Copied."); }
      catch (e) { $("done").textContent = "The browser did not allow copying a picture here (it needs a secure page). Use Save picture instead."; setStatus("Not copied."); }
    });
    setTool("arrow"); refresh();
    return { destroy() { if (bmp && bmp.close) bmp.close(); document.removeEventListener("paste", onPaste); document.removeEventListener("keydown", key); window.removeEventListener("resize", fit); } };
  }
  return { init };
})();
