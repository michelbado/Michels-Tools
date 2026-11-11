/* Convert & Compress. Saving and size-fitting are in lib/imgproc.js. The picture is read from the file the visitor opens and never leaves the browser. */
(window.DesktopApps = window.DesktopApps || {}).imgconvert = (() => {
  function init(root) {
    const $ = id => root.querySelector("#imgconvert-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const P = window.ImgProc, M = window.ImgMath, TK = window.TK;
    let file = null, bmp = null, base = null, token = 0, current = null; // current = { blob, kind, w, h, fits, q }
    const cv = $("canvas"), cx = cv.getContext("2d");
    const how = () => root.querySelector('input[name="imgconvert-how"]:checked').value;

    async function load(f) {
      TK.notes($("notes"), []); $("done").textContent = "";
      let b; try { b = await P.load(f); } catch (e) { TK.notes($("notes"), [{ level: "bad", text: e.message }]); setStatus("Not opened."); return; }
      if (bmp && bmp.close) bmp.close();
      bmp = b; file = f; base = P.toCanvas(b);
      $("name").textContent = f.name + " (" + b.width + " × " + b.height + ", " + P.sizeText(f.size) + ")";
      $("work").hidden = false;
      const k = P.kindOf(f); $("fmt").value = k === "png" ? "jpeg" : k === "jpeg" ? "webp" : "jpeg";
      recompute(); setStatus("Opened " + f.name + ".");
    }
    const sizeNow = () => {
      const L = +$("long").value; if (!(L > 0) || L >= Math.max(base.width, base.height)) return { w: base.width, h: base.height };
      const s = M.outSize("long", base.width, base.height, { long: L }); return s.error ? { error: s.error } : { w: s.w, h: s.h };
    };
    let timer = 0;
    function recompute() { clearTimeout(timer); $("save").disabled = true; current = null; $("result").textContent = "Working…"; timer = setTimeout(run, 250); }
    async function run() {
      if (!base) return; const my = ++token, kind = $("fmt").value;
      const sz = sizeNow();
      if (sz.error) { $("result").textContent = sz.error; return; }
      $("bglab").hidden = kind !== "jpeg";
      try {
        const c = sz.w === base.width && sz.h === base.height ? base : P.scale(base, sz.w, sz.h);
        let res;
        if (how() === "kb") { const kb = +$("kb").value; if (!(kb > 0)) { $("result").textContent = "Type a size in kilobytes."; return; } res = await P.fitBytes(c, kind, kb * 1024, $("bg").value); }
        else { const q = +$("q").value / 100; const blob = await P.encode(c, kind, q, $("bg").value); res = { blob, q, fits: true }; }
        if (my !== token) return;
        current = { blob: res.blob, kind, w: c.width, h: c.height };
        const pic = await createImageBitmap(res.blob); if (my !== token) { pic.close && pic.close(); return; }
        const sc = Math.min(8, 900 / pic.width, 480 / pic.height); cv.width = Math.max(1, Math.round(pic.width * sc)); cv.height = Math.max(1, Math.round(pic.height * sc)); cx.clearRect(0, 0, cv.width, cv.height); cx.drawImage(pic, 0, 0, cv.width, cv.height); pic.close && pic.close();
        const saved = file.size ? Math.round((1 - res.blob.size / file.size) * 100) : 0;
        let t = c.width + " × " + c.height + " pixels, " + P.sizeText(res.blob.size) + " (original " + P.sizeText(file.size) + "; " + (saved >= 0 ? saved + "% smaller" : -saved + "% larger") + ")";
        if (kind !== "png") t += ", quality " + Math.round(res.q * 100);
        if (how() === "kb" && !res.fits) t = "Even at the lowest quality the file is " + P.sizeText(res.blob.size) + ", more than the limit. Shrink the picture in step 3. (" + t + ")";
        else if (saved < 0) t += ". The new file is larger than the original: try another type or a lower quality.";
        $("result").textContent = t; $("save").disabled = false;
      } catch (e) { if (my === token) { $("result").textContent = "Not possible: " + e.message; } }
    }
    for (const id of ["fmt", "bg", "kb", "long"]) $(id).addEventListener("input", recompute);
    $("q").addEventListener("input", () => { $("qv").textContent = $("q").value; recompute(); });
    root.querySelectorAll('input[name="imgconvert-how"]').forEach(r => r.addEventListener("change", recompute));
    $("save").addEventListener("click", () => {
      if (!current) return; const ext = P.EXT[current.kind], name = M.outName(file.name, ext);
      P.download(current.blob, name); $("done").textContent = "Saved " + name + " (" + P.sizeText(current.blob.size) + ")."; setStatus("Saved.");
    });
    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const f = $("file").files[0]; if (f) load(f); $("file").value = ""; });
    root.addEventListener("dragover", e => e.preventDefault());
    root.addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) load(f); });
    return { destroy() { clearTimeout(timer); token++; if (bmp && bmp.close) bmp.close(); } };
  }
  return { init };
})();
