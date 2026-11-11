/* Resize / Crop. Geometry is in lib/imgmath.js; this file draws the picture and the crop box on a canvas and saves the result. The picture is read from
   the file the visitor opens and never leaves the browser. Only canvases show the picture (the page's security policy allows no data: or blob: images). */
(window.DesktopApps = window.DesktopApps || {}).imgresize = (() => {
  function init(root) {
    const $ = id => root.querySelector("#imgresize-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const M = window.ImgMath, TK = window.TK;
    const MAXMB = 60, MAXIN = 100e6;
    let file = null, bmp = null, rot = 0, flipH = false, flipV = false;
    let base = null;              // the picture after turning/flipping, as a canvas
    let crop = null;              // {x,y,w,h} in base pixels
    const cv = $("canvas"), cx = cv.getContext("2d");
    let scale = 1;                // canvas pixels per picture pixel
    let drag = null;

    async function load(f) {
      TK.notes($("notes"), []); $("done").textContent = "";
      if (f.size > MAXMB * 1024 * 1024) { TK.notes($("notes"), [{ level: "bad", text: "This picture is larger than " + MAXMB + " MB. Please choose a smaller one." }]); return; }
      let b;
      try { b = await createImageBitmap(f, { imageOrientation: "from-image" }); } catch { TK.notes($("notes"), [{ level: "bad", text: "The browser could not open this file as a picture." }]); setStatus("Not a picture."); return; }
      if (b.width * b.height > MAXIN) { if (b.close) b.close(); TK.notes($("notes"), [{ level: "bad", text: "This picture has more than " + MAXIN / 1e6 + " million pixels, which is too much to edit in a browser." }]); return; }
      if (bmp && bmp.close) bmp.close();
      bmp = b; file = f; rot = 0; flipH = flipV = false;
      $("name").textContent = f.name + " (" + b.width + " × " + b.height + ")";
      $("work").hidden = false;
      const mime = f.type;
      $("fmt").value = mime === "image/png" || mime === "image/gif" || mime === "image/bmp" ? "png" : mime === "image/webp" ? "webp" : "jpeg";
      rebuild(true); setStatus("Opened " + f.name + ".");
    }
    function rebuild(resetCrop) {
      const swap = rot % 2 === 1, W = swap ? bmp.height : bmp.width, H = swap ? bmp.width : bmp.height;
      base = document.createElement("canvas"); base.width = W; base.height = H;
      const g = base.getContext("2d");
      g.save(); g.translate(W / 2, H / 2); g.rotate(rot * Math.PI / 2); g.scale(flipH ? -1 : 1, flipV ? -1 : 1); g.drawImage(bmp, -bmp.width / 2, -bmp.height / 2); g.restore();
      if (resetCrop || !crop) crop = { x: 0, y: 0, w: W, h: H };
      // preview size
      /* small pictures are shown larger */ scale = Math.min(8, 900 / W, 480 / H); cv.width = Math.max(1, Math.round(W * scale)); cv.height = Math.max(1, Math.round(H * scale));
      applyAspect(); updateFields(); draw(); result();
    }
    function draw() {
      if (!base) return;
      cx.clearRect(0, 0, cv.width, cv.height);
      cx.drawImage(base, 0, 0, cv.width, cv.height);
      const r = { x: crop.x * scale, y: crop.y * scale, w: crop.w * scale, h: crop.h * scale };
      cx.fillStyle = "rgba(0,0,0,0.5)";
      cx.fillRect(0, 0, cv.width, r.y); cx.fillRect(0, r.y + r.h, cv.width, cv.height - r.y - r.h); cx.fillRect(0, r.y, r.x, r.h); cx.fillRect(r.x + r.w, r.y, cv.width - r.x - r.w, r.h);
      cx.strokeStyle = "#fff"; cx.lineWidth = 2; cx.strokeRect(r.x, r.y, r.w, r.h);
      cx.strokeStyle = "#000"; cx.lineWidth = 1; cx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
      cx.strokeStyle = "rgba(255,255,255,0.55)"; cx.lineWidth = 1; cx.beginPath();
      for (let i = 1; i < 3; i++) { cx.moveTo(r.x + r.w * i / 3, r.y); cx.lineTo(r.x + r.w * i / 3, r.y + r.h); cx.moveTo(r.x, r.y + r.h * i / 3); cx.lineTo(r.x + r.w, r.y + r.h * i / 3); }
      cx.stroke();
      cx.fillStyle = "#fff"; cx.strokeStyle = "#000";
      for (const [hx, hy] of corners()) { cx.fillRect(hx - 5, hy - 5, 10, 10); cx.strokeRect(hx - 5, hy - 5, 10, 10); }
    }
    function corners() { const r = { x: crop.x * scale, y: crop.y * scale, w: crop.w * scale, h: crop.h * scale }; return [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]; }
    const ratio = () => M.ratio($("aspect").value, base.width, base.height);
    function applyAspect() { const r = ratio(); if (!r) return; const c = crop; const cxm = c.x + c.w / 2, cym = c.y + c.h / 2; let w = c.w, h = w / r; if (h > c.h) { h = c.h; w = h * r; } crop = M.fit({ x: cxm - w / 2, y: cym - h / 2, w, h }, base.width, base.height); }
    function updateFields() { $("cx").value = crop.x; $("cy").value = crop.y; $("cw").value = crop.w; $("ch").value = crop.h; }
    function size() {
      const mode = $("mode").value;
      return M.outSize(mode, crop.w, crop.h, { w: $("w").value, h: $("h").value, lock: $("lock").checked, pct: $("pct").value, long: $("long").value });
    }
    function result() {
      if (!base) return;
      const mode = $("mode").value;
      $("exactrow").hidden = mode !== "exact"; $("pctrow").hidden = mode !== "pct"; $("longrow").hidden = mode !== "long";
      const s = size(), out = $("result");
      if (s.error) { out.textContent = s.error; $("save").disabled = true; return; }
      $("save").disabled = false;
      out.textContent = "Result: " + s.w + " × " + s.h + " pixels" + (s.enlarged ? " (enlarged: it will look soft)" : "") + ".";
      const f = $("fmt").value; $("qlab").hidden = f === "png"; $("bglab").hidden = f !== "jpeg";
    }
    // pointer handling on the picture
    function pos(e) { const b = cv.getBoundingClientRect(); return { x: (e.clientX - b.left) * (cv.width / b.width) / scale, y: (e.clientY - b.top) * (cv.height / b.height) / scale, k: cv.width / b.width }; }
    cv.addEventListener("pointerdown", e => {
      if (!base) return; const p = pos(e); cv.setPointerCapture(e.pointerId);
      const slack = 12 * p.k / scale;
      const cs = [[crop.x, crop.y, crop.x + crop.w, crop.y + crop.h], [crop.x + crop.w, crop.y, crop.x, crop.y + crop.h], [crop.x, crop.y + crop.h, crop.x + crop.w, crop.y], [crop.x + crop.w, crop.y + crop.h, crop.x, crop.y]];
      for (const [hx, hy, ax, ay] of cs) if (Math.abs(p.x - hx) <= slack && Math.abs(p.y - hy) <= slack) { drag = { kind: "size", ax, ay }; return; }
      if (p.x >= crop.x && p.x <= crop.x + crop.w && p.y >= crop.y && p.y <= crop.y + crop.h && (crop.w < base.width || crop.h < base.height)) { drag = { kind: "move", dx: p.x - crop.x, dy: p.y - crop.y }; return; }
      drag = { kind: "new", ax: p.x, ay: p.y, moved: false };
    });
    cv.addEventListener("pointermove", e => {
      if (!drag) return; const p = pos(e), W = base.width, H = base.height;
      if (drag.kind === "move") crop = M.fit({ x: p.x - drag.dx, y: p.y - drag.dy, w: crop.w, h: crop.h }, W, H);
      else { if (drag.kind === "new") { if (Math.abs(p.x - drag.ax) < 3 && Math.abs(p.y - drag.ay) < 3) return; drag.moved = true; } crop = M.drag(drag.ax, drag.ay, p.x, p.y, ratio(), W, H); }
      updateFields(); draw(); result();
    });
    const end = () => { drag = null; };
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);

    for (const id of ["cx", "cy", "cw", "ch"]) $(id).addEventListener("input", () => {
      if (!base) return; const W = base.width, H = base.height, r = ratio(), v = +$(id).value; if (!isFinite(v)) return;
      if (id === "cw") crop = M.setSide(crop, "w", v, r, W, H); else if (id === "ch") crop = M.setSide(crop, "h", v, r, W, H);
      else crop = M.fit({ x: id === "cx" ? v : crop.x, y: id === "cy" ? v : crop.y, w: crop.w, h: crop.h }, W, H);
      draw(); result();
    });
    for (const id of ["cx", "cy", "cw", "ch"]) $(id).addEventListener("change", updateFields);
    $("aspect").addEventListener("change", () => { if (!base) return; if (ratio()) crop = M.biggest(ratio(), base.width, base.height); applyAspect(); updateFields(); draw(); result(); });
    $("cropall").addEventListener("click", () => { if (!base) return; crop = { x: 0, y: 0, w: base.width, h: base.height }; $("aspect").value = "free"; updateFields(); draw(); result(); });
    const turn = f => () => { if (!bmp) return; f(); rebuild(true); };
    $("rotr").addEventListener("click", turn(() => { rot = (rot + 1) % 4; }));
    $("rotl").addEventListener("click", turn(() => { rot = (rot + 3) % 4; }));
    $("fh").addEventListener("click", turn(() => { if (rot % 2 === 0) flipH = !flipH; else flipV = !flipV; }));
    $("fv").addEventListener("click", turn(() => { if (rot % 2 === 0) flipV = !flipV; else flipH = !flipH; }));
    for (const id of ["mode", "pct", "long", "fmt"]) $(id).addEventListener("input", result);
    $("w").addEventListener("input", () => { if ($("lock").checked && crop && +$("w").value > 0) $("h").value = Math.max(1, Math.round(crop.h * $("w").value / crop.w)); result(); });
    $("h").addEventListener("input", () => { if ($("lock").checked && crop && +$("h").value > 0) $("w").value = Math.max(1, Math.round(crop.w * $("h").value / crop.h)); result(); });
    $("mode").addEventListener("change", () => { if ($("mode").value === "exact" && crop && !$("w").value) { $("w").value = crop.w; $("h").value = crop.h; } result(); });
    $("q").addEventListener("input", () => { $("qv").textContent = $("q").value; });

    function toBlob(canvas, type, q) { return new Promise(res => canvas.toBlob(res, type, q)); }
    $("save").addEventListener("click", async () => {
      if (!base) return; const s = size(); if (s.error) return;
      $("done").textContent = "Working…"; setStatus("Working…");
      try {
        const kind = $("fmt").value, mime = "image/" + kind, ext = kind === "jpeg" ? "jpg" : kind;
        // crop to a canvas, then shrink in halves when the reduction is large
        let cur = document.createElement("canvas"); cur.width = crop.w; cur.height = crop.h;
        let g = cur.getContext("2d");
        if (kind === "jpeg") { g.fillStyle = $("bg").value; g.fillRect(0, 0, cur.width, cur.height); }
        g.drawImage(base, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
        for (const [w, h] of M.steps(crop.w, crop.h, s.w, s.h)) {
          if (w === cur.width && h === cur.height) continue;
          const nx = document.createElement("canvas"); nx.width = w; nx.height = h; const gg = nx.getContext("2d"); gg.imageSmoothingEnabled = true; gg.imageSmoothingQuality = "high"; gg.drawImage(cur, 0, 0, w, h); cur = nx;
        }
        const blob = await toBlob(cur, mime, kind === "png" ? undefined : +$("q").value / 100);
        if (!blob) throw new Error("The browser could not create the picture.");
        if (blob.type !== mime) throw new Error("This browser cannot save " + kind.toUpperCase() + " pictures. Choose another type.");
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = M.outName(file.name, ext); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        const kb = blob.size < 1048576 ? (blob.size / 1024).toFixed(1) + " KB" : (blob.size / 1048576).toFixed(2) + " MB";
        $("done").textContent = "Saved " + M.outName(file.name, ext) + ": " + cur.width + " × " + cur.height + ", " + kb + " (original " + (file.size / 1024).toFixed(0) + " KB).";
        setStatus("Saved.");
      } catch (err) { $("done").textContent = "Not saved: " + err.message; setStatus("Not saved."); }
    });

    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const f = $("file").files[0]; if (f) load(f); $("file").value = ""; });
    root.addEventListener("dragover", e => e.preventDefault());
    root.addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) load(f); });
    return { destroy() { if (bmp && bmp.close) bmp.close(); } };
  }
  return { init };
})();
