/* Watermark. Drawing is in lib/imgproc.js (watermark), placement maths in lib/imgmath.js. The picture and the logo are read from the files the visitor opens and never leave the browser. */
(window.DesktopApps = window.DesktopApps || {}).imgwatermark = (() => {
  function init(root) {
    const $ = id => root.querySelector("#imgwatermark-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const P = window.ImgProc, M = window.ImgMath, TK = window.TK;
    let file = null, bmp = null, small = null, scaleP = 1, logo = null;
    const cv = $("canvas"), cx = cv.getContext("2d");
    const radio = n => root.querySelector('input[name="imgwatermark-' + n + '"]:checked');
    const opts = () => ({ text: $("text").value, image: radio("kind").value === "logo" ? logo : null, pos: $("tile").checked ? "tile" : radio("pos").value, sizePct: +$("size").value, opacity: +$("opacity").value / 100, angle: +$("angle").value, color: $("color").value, outline: $("outline").checked, font: $("font").value, margin: 3, gap: 40 });

    async function load(f) {
      TK.notes($("notes"), []); $("done").textContent = "";
      let b; try { b = await P.load(f); } catch (e) { TK.notes($("notes"), [{ level: "bad", text: e.message }]); setStatus("Not opened."); return; }
      if (bmp && bmp.close) bmp.close();
      bmp = b; file = f; scaleP = Math.min(8, 900 / b.width, 480 / b.height);
      small = P.toCanvas(b, Math.max(1, Math.round(b.width * scaleP)), Math.max(1, Math.round(b.height * scaleP)));
      $("name").textContent = f.name + " (" + b.width + " × " + b.height + ")";
      $("work").hidden = false; $("fmt").value = P.kindOf(f) === "png" ? "png" : P.kindOf(f) === "webp" ? "webp" : "jpeg"; fmtChanged();
      draw(); setStatus("Opened " + f.name + ".");
    }
    function draw() {
      if (!small) return; cv.width = small.width; cv.height = small.height; cx.clearRect(0, 0, cv.width, cv.height); cx.drawImage(small, 0, 0);
      if (radio("kind").value === "logo" && !logo) return;
      P.watermark(cx, cv.width, cv.height, opts());
    }
    const fmtChanged = () => { $("qlab").hidden = $("fmt").value === "png"; };
    const shown = (id) => { $(id + "v").textContent = $(id).value; };
    for (const id of ["size", "opacity", "angle"]) $(id).addEventListener("input", () => { shown(id); draw(); });
    $("q").addEventListener("input", () => shown("q"));
    for (const id of ["text", "color", "font", "outline", "tile"]) $(id).addEventListener("input", draw);
    root.querySelectorAll('input[name="imgwatermark-pos"], input[name="imgwatermark-kind"]').forEach(r => r.addEventListener("change", draw));
    $("fmt").addEventListener("change", fmtChanged);
    $("openlogo").addEventListener("click", () => $("logofile").click());
    $("logofile").addEventListener("change", async () => {
      const f = $("logofile").files[0]; $("logofile").value = ""; if (!f) return;
      try { const b = await P.load(f); logo = b; $("logoname").textContent = f.name + " (" + b.width + " × " + b.height + ")"; root.querySelector('input[name="imgwatermark-kind"][value="logo"]').checked = true; draw(); }
      catch (e) { TK.notes($("notes"), [{ level: "bad", text: "Logo: " + e.message }]); }
    });
    $("save").addEventListener("click", async () => {
      if (!bmp) return; const o = opts();
      if (o.image === null && radio("kind").value === "logo") { TK.notes($("notes"), [{ level: "bad", text: "Choose a logo picture first, or switch to Text." }]); return; }
      if (!o.image && !String(o.text).trim()) { TK.notes($("notes"), [{ level: "bad", text: "Type the text of the mark first." }]); return; }
      TK.notes($("notes"), []); $("done").textContent = "Working…"; setStatus("Working…");
      try {
        const c = P.toCanvas(bmp), n = P.watermark(c.getContext("2d"), c.width, c.height, o);
        const kind = $("fmt").value, blob = await P.encode(c, kind, +$("q").value / 100, "#ffffff"), name = M.outName(file.name, P.EXT[kind]);
        P.download(blob, name); $("done").textContent = "Saved " + name + " (" + c.width + " × " + c.height + ", " + P.sizeText(blob.size) + ", " + n + " mark" + (n === 1 ? "" : "s") + ")."; setStatus("Saved.");
      } catch (e) { $("done").textContent = "Not saved: " + e.message; setStatus("Not saved."); }
    });
    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const f = $("file").files[0]; if (f) load(f); $("file").value = ""; });
    root.addEventListener("dragover", e => e.preventDefault());
    root.addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) load(f); });
    return { destroy() { if (bmp && bmp.close) bmp.close(); if (logo && logo.close) logo.close(); } };
  }
  return { init };
})();
