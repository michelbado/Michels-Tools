/* Blur / Redact. The pixel work (pixelate, blur, black, and the check that it worked) is in lib/imgmath.js; this file marks areas on a canvas and saves.
   The picture is read from the file the visitor opens and never leaves the browser. The hidden parts are really changed in the saved pixels. */
(window.DesktopApps = window.DesktopApps || {}).imgblur = (() => {
  function init(root) {
    const $ = id => root.querySelector("#imgblur-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const P = window.ImgProc, M = window.ImgMath, TK = window.TK;
    let file = null, bmp = null, small = null, scale = 1;
    let boxes = [], sel = -1, drag = null;
    const cv = $("canvas"), cx = cv.getContext("2d");
    const mode = () => root.querySelector('input[name="imgblur-mode"]:checked').value;

    async function load(f) {
      TK.notes($("notes"), []); TK.notes($("check"), []); $("done").textContent = "";
      let b; try { b = await P.load(f); } catch (e) { TK.notes($("notes"), [{ level: "bad", text: e.message }]); setStatus("Not opened."); return; }
      if (bmp && bmp.close) bmp.close();
      bmp = b; file = f; boxes = []; sel = -1;
      scale = Math.min(8, 900 / b.width, 480 / b.height);
      small = P.toCanvas(b, Math.max(1, Math.round(b.width * scale)), Math.max(1, Math.round(b.height * scale)));
      cv.width = small.width; cv.height = small.height;
      $("name").textContent = f.name + " (" + b.width + " × " + b.height + ")"; $("work").hidden = false;
      const k = P.kindOf(f); $("fmt").value = k; fmtChanged(); refresh(); setStatus("Opened " + f.name + ".");
    }
    // apply one area to a canvas context whose pixels are a copy of the picture at `sc` (preview scale or 1 for the real thing). Returns false when the self-check fails.
    function applyBox(g, W, H, bx, sc) {
      const r = { x: bx.x * sc, y: bx.y * sc, w: bx.w * sc, h: bx.h * sc };
      const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y)), x1 = Math.min(W, Math.ceil(r.x + r.w)), y1 = Math.min(H, Math.ceil(r.y + r.h)), w = x1 - x0, h = y1 - y0;
      if (w < 1 || h < 1) return true;
      const id = g.getImageData(x0, y0, w, h);
      let m = bx.mode; if (m === "blur" && w * h > 12e6) m = "pixelate"; // a huge blur would need too much memory: pixelate does the same job
      const info = M.hide(id.data, w, h, { x: 0, y: 0, w, h }, m, bx.strength, sc);
      const ok = !info || M.checkHidden(id.data, w, h, { x: 0, y: 0, w, h }, info);
      const tmp = document.createElement("canvas"); tmp.width = w; tmp.height = h; tmp.getContext("2d").putImageData(id, 0, 0);
      g.save();
      if (bx.shape === "oval") { g.beginPath(); g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); g.clip(); }
      g.drawImage(tmp, x0, y0); g.restore();
      return ok;
    }
    function draw() {
      if (!small) return;
      cx.clearRect(0, 0, cv.width, cv.height); cx.drawImage(small, 0, 0);
      for (const b of boxes) applyBox(cx, cv.width, cv.height, b, scale);
      boxes.forEach((b, i) => {
        const r = { x: b.x * scale, y: b.y * scale, w: b.w * scale, h: b.h * scale };
        cx.save(); cx.lineWidth = i === sel ? 2 : 1; cx.strokeStyle = i === sel ? "#ffffff" : "rgba(255,255,255,0.8)"; cx.setLineDash(i === sel ? [] : [5, 4]);
        if (b.shape === "oval") { cx.beginPath(); cx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); cx.stroke(); cx.strokeStyle = "#000"; cx.lineWidth = 1; cx.setLineDash([5, 4]); cx.stroke(); }
        else { cx.strokeRect(r.x, r.y, r.w, r.h); cx.strokeStyle = "#000"; cx.lineWidth = 1; cx.setLineDash([5, 4]); cx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2); }
        cx.restore();
        if (i === sel) { cx.fillStyle = "#fff"; cx.strokeStyle = "#000"; for (const [hx, hy] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) { cx.fillRect(hx - 5, hy - 5, 10, 10); cx.strokeRect(hx - 5, hy - 5, 10, 10); } }
      });
    }
    function refresh() {
      draw();
      $("del").disabled = sel < 0; $("undo").disabled = !boxes.length; $("clear").disabled = !boxes.length; $("save").disabled = !boxes.length;
      $("count").textContent = boxes.length ? boxes.length + " area" + (boxes.length === 1 ? "" : "s") + " marked." : "No areas yet.";
      $("strlab").hidden = mode() === "black";
    }
    function pos(e) { const b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) * (cv.width / b.width) / scale, y: (e.clientY - b.top) * (cv.height / b.height) / scale, k: cv.width / b.width }; }
    const inBox = (b, p) => b.shape === "oval" ? ((p.x - (b.x + b.w / 2)) / (b.w / 2)) ** 2 + ((p.y - (b.y + b.h / 2)) / (b.h / 2)) ** 2 <= 1 : p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    cv.addEventListener("pointerdown", e => {
      if (!small) return; cv.focus(); const p = pos(e), W = bmp.width, H = bmp.height; cv.setPointerCapture(e.pointerId);
      const slack = 12 * p.k / scale;
      if (sel >= 0) { const b = boxes[sel]; for (const [hx, hy, ax, ay] of [[b.x, b.y, b.x + b.w, b.y + b.h], [b.x + b.w, b.y, b.x, b.y + b.h], [b.x, b.y + b.h, b.x + b.w, b.y], [b.x + b.w, b.y + b.h, b.x, b.y]]) if (Math.abs(p.x - hx) <= slack && Math.abs(p.y - hy) <= slack) { drag = { kind: "size", ax, ay }; return; } }
      for (let i = boxes.length - 1; i >= 0; i--) if (inBox(boxes[i], p)) { sel = i; drag = { kind: "move", dx: p.x - boxes[i].x, dy: p.y - boxes[i].y }; refresh(); return; }
      sel = -1; drag = { kind: "new", ax: p.x, ay: p.y, made: false }; refresh();
    });
    cv.addEventListener("pointermove", e => {
      if (!drag) return; const p = pos(e), W = bmp.width, H = bmp.height;
      if (drag.kind === "new") {
        if (!drag.made) { if (Math.abs(p.x - drag.ax) < 4 / scale && Math.abs(p.y - drag.ay) < 4 / scale) return; boxes.push({ x: drag.ax, y: drag.ay, w: 1, h: 1, mode: mode(), strength: +$("strength").value, shape: $("shape").value }); sel = boxes.length - 1; drag.made = true; }
        Object.assign(boxes[sel], M.drag(drag.ax, drag.ay, p.x, p.y, null, W, H));
      } else if (drag.kind === "move") { const b = boxes[sel]; Object.assign(b, M.fit({ x: p.x - drag.dx, y: p.y - drag.dy, w: b.w, h: b.h }, W, H)); }
      else if (drag.kind === "size") Object.assign(boxes[sel], M.drag(drag.ax, drag.ay, p.x, p.y, null, W, H));
      refresh();
    });
    const end = () => { if (drag && drag.kind === "new" && !drag.made) { /* a plain click on empty picture: nothing to do */ } drag = null; };
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
    cv.addEventListener("keydown", e => { if ((e.key === "Delete" || e.key === "Backspace") && sel >= 0) { e.preventDefault(); removeSel(); } });
    function removeSel() { if (sel < 0) return; boxes.splice(sel, 1); sel = -1; refresh(); setStatus("Area removed."); }
    $("del").addEventListener("click", removeSel);
    $("undo").addEventListener("click", () => { if (!boxes.length) return; boxes.pop(); sel = -1; refresh(); setStatus("Last area removed."); });
    $("clear").addEventListener("click", () => { boxes = []; sel = -1; refresh(); setStatus("All areas removed."); });
    root.querySelectorAll('input[name="imgblur-mode"]').forEach(r => r.addEventListener("change", () => { if (sel >= 0) boxes[sel].mode = mode(); refresh(); }));
    $("strength").addEventListener("input", () => { $("strv").textContent = $("strength").value; if (sel >= 0) boxes[sel].strength = +$("strength").value; refresh(); });
    $("shape").addEventListener("change", () => { if (sel >= 0) boxes[sel].shape = $("shape").value; refresh(); });
    const fmtChanged = () => { $("qlab").hidden = $("fmt").value === "png"; };
    $("fmt").addEventListener("change", fmtChanged);
    $("q").addEventListener("input", () => { $("qv").textContent = $("q").value; });

    $("save").addEventListener("click", async () => {
      if (!bmp || !boxes.length) return;
      TK.notes($("check"), []); $("done").textContent = "Working…"; setStatus("Working…");
      try {
        const c = P.toCanvas(bmp), g = c.getContext("2d", { willReadFrequently: true }); let bad = 0, soft = 0;
        for (const b of boxes) { if (!applyBox(g, c.width, c.height, b, 1)) bad++; if (b.mode === "blur" && b.w * b.h > 12e6) soft++; }
        if (bad) throw new Error("the check of the hidden areas failed for " + bad + " area(s), so nothing was saved");
        const kind = $("fmt").value, blob = await P.encode(c, kind, +$("q").value / 100, "#ffffff"), name = M.outName(file.name, P.EXT[kind]);
        P.download(blob, name);
        const n = boxes.length, bl = boxes.filter(b => b.mode === "black").length;
        $("done").textContent = "Saved " + name + " (" + P.sizeText(blob.size) + ").";
        TK.notes($("check"), [{ level: "good", text: "Checked: " + n + " area" + (n === 1 ? "" : "s") + " hidden in the saved pixels (" + (bl ? bl + " solid black, " : "") + (n - bl) + " pixelated or blurred); the original file was not changed, and the copy carries no camera data." }].concat(n - bl ? [{ level: "warn", text: "Pixelating and blurring are not a guarantee against guessing. For text, numbers, plates or documents, use solid black." }] : []));
        setStatus("Saved.");
      } catch (e) { $("done").textContent = "Not saved: " + e.message; setStatus("Not saved."); }
    });
    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const f = $("file").files[0]; if (f) load(f); $("file").value = ""; });
    root.addEventListener("dragover", e => e.preventDefault());
    root.addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) load(f); });
    return { destroy() { if (bmp && bmp.close) bmp.close(); } };
  }
  return { init };
})();
