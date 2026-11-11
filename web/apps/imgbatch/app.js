/* Batch Pictures. Each picture goes through the same steps (resize, type, hidden data, text mark) one after another; the results are put into one ZIP by the
   vendored fflate. Pictures are read from the files the visitor adds and never leave the browser. Names and messages are shown with textContent only. */
(window.DesktopApps = window.DesktopApps || {}).imgbatch = (() => {
  function init(root) {
    const $ = id => root.querySelector("#imgbatch-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const P = window.ImgProc, M = window.ImgMath, E = window.Exif, TK = window.TK;
    const MAXFILES = 200, MAXOUT = 500 * 1048576;
    let items = [], running = false, stop = false;   // item: { file, tr, st }
    const cell = (tr, cls, text) => { const td = document.createElement("td"); if (cls) td.className = cls; td.textContent = text; tr.append(td); return td; };

    function renderList() {
      const body = $("rows"); body.textContent = "";
      items.forEach((it, i) => {
        const tr = document.createElement("tr"); cell(tr, "", it.file.name); cell(tr, "imgbatch-size", P.sizeText(it.file.size)); it.st = cell(tr, "imgbatch-st", it.msg || "waiting");
        const td = document.createElement("td"), b = document.createElement("button"); b.type = "button"; b.className = "xp-btn small"; b.textContent = "✕"; b.title = "Remove " + it.file.name; b.setAttribute("aria-label", "Remove " + it.file.name); b.disabled = running;
        b.addEventListener("click", () => { items.splice(i, 1); renderList(); update(); }); td.append(b); tr.append(td); body.append(tr); it.tr = tr;
      });
      $("count").textContent = items.length ? items.length + " picture" + (items.length === 1 ? "" : "s") + " (" + P.sizeText(items.reduce((a, x) => a + x.file.size, 0)) + ")" : "No pictures yet. You can also drop pictures onto this window.";
      $("clear").disabled = !items.length || running; $("work").hidden = !items.length;
    }
    function add(files) {
      const notes = []; let n = 0;
      for (const f of files) {
        if (!/^image\/(jpeg|png|webp|gif|bmp)$/.test(f.type) && !/\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name)) { notes.push({ level: "warn", text: f.name + ": not a supported picture, skipped." }); continue; }
        if (f.size > P.MAXMB * 1048576) { notes.push({ level: "warn", text: f.name + ": larger than " + P.MAXMB + " MB, skipped." }); continue; }
        if (items.length >= MAXFILES) { notes.push({ level: "warn", text: "Only " + MAXFILES + " pictures at a time. The rest were skipped." }); break; }
        items.push({ file: f, msg: "waiting" }); n++;
      }
      TK.notes($("notes"), notes); $("result").textContent = ""; renderList(); update(); if (n) setStatus("Added " + n + " picture" + (n === 1 ? "" : "s") + ".");
    }
    const reencode = () => $("rmode").value !== "none" || $("fmt").value !== "keep" || $("wm").value.trim() !== "";
    function update() {
      $("rval").disabled = $("rmode").value === "none"; $("rlab").textContent = $("rmode").value === "pct" ? "Percent" : "Pixels";
      if ($("rmode").value === "pct" && +$("rval").value > 400) $("rval").value = 100;
      $("qlab").hidden = $("fmt").value === "png"; $("wsizev").textContent = $("wsize").value; $("wopv").textContent = $("wop").value; $("qv").textContent = $("q").value;
      const re = reencode(), meta = $("meta").value;
      $("metahelp").textContent = re ? "Because pictures are being resized, converted or marked, they are drawn again and the saved copies carry no hidden data at all (no location, no camera details, no colour profile)." : "Without any other change below, the pictures are not re-compressed: only the hidden data around them changes (JPEG, PNG and WebP). The rotation of a photo is kept, so it does not turn sideways.";
      $("plan").textContent = !items.length ? "" : !re && meta === "keep" ? "Nothing to do yet: choose a change on the right." : re ? "Each picture will be drawn again and saved as a new copy." : "Each picture keeps its exact pixels; only the hidden data changes.";
      $("go").disabled = running || !items.length || (!re && meta === "keep");
    }
    for (const id of ["meta", "rmode", "rval", "fmt", "q", "wm", "wpos", "wsize", "wop", "wcol"]) $(id).addEventListener("input", update);

    async function process(it, used) {
      const f = it.file, re = reencode(), meta = $("meta").value;
      if (!re) {
        const bytes = new Uint8Array(await f.arrayBuffer()), info = E.read(bytes);
        if (!info.format || info.format === "heic" || info.format === "tiff") throw new Error(info.problems[0] || "not supported for lossless cleaning (JPEG, PNG and WebP only)");
        const plan = E.makePlan(info, meta === "all" ? { keep: () => false, keepOrientation: true, drop: info.other.filter(o => !o.keep).map(o => o.id) } : { keep: e => e.ifd !== "gps", dropIfd: ["gps"], drop: [] });
        const out = E.rewrite(bytes, plan), a = E.pictureBytes(bytes), b = E.pictureBytes(out);
        if (a.length !== b.length || !a.every((v, i) => v === b[i])) throw new Error("the check of the picture data failed");
        const r2 = E.read(out); if (meta !== "keep" && r2.groups.some(g => g.id === "gps")) throw new Error("the check found location data still present");
        const ext = (f.name.match(/\.[^.]+$/) || [".jpg"])[0].replace(/^\./, "").toLowerCase();
        return { bytes: out, name: M.outName(f.name, ext === "jpeg" ? "jpg" : ext) };
      }
      const b = await P.load(f); let c;
      try {
        c = P.toCanvas(b);
        const mode = $("rmode").value;
        if (mode !== "none") { const s = M.outSize(mode === "pct" ? "pct" : "long", c.width, c.height, { pct: $("rval").value, long: $("rval").value }); if (s.error) throw new Error(s.error); if (s.w !== c.width || s.h !== c.height) c = P.scale(c, s.w, s.h); }
        const text = $("wm").value.trim();
        if (text) { const cc = document.createElement("canvas"); cc.width = c.width; cc.height = c.height; const g = cc.getContext("2d"); g.drawImage(c, 0, 0); P.watermark(g, cc.width, cc.height, { text, pos: $("wpos").value, sizePct: +$("wsize").value, opacity: +$("wop").value / 100, color: $("wcol").value, outline: true, font: "sans", margin: 3, angle: $("wpos").value === "tile" ? -30 : 0 }); c = cc; }
        const kind = $("fmt").value === "keep" ? P.kindOf(f) : $("fmt").value, blob = await P.encode(c, kind, +$("q").value / 100, "#ffffff");
        return { bytes: new Uint8Array(await blob.arrayBuffer()), name: M.outName(f.name, P.EXT[kind]) };
      } finally { if (b.close) b.close(); }
    }
    $("go").addEventListener("click", async () => {
      if (running) return; running = true; stop = false; $("go").disabled = true; $("stop").hidden = false; $("prog").hidden = false; $("prog").value = 0; $("prog").max = items.length; renderList();
      const out = {}, used = new Set(); let ok = 0, fail = 0, total = 0, before = 0, after = 0, i = 0;
      for (const it of items) {
        if (stop) { it.st.textContent = "not done (stopped)"; continue; }
        it.st.textContent = "working…"; setStatus("Working on " + (i + 1) + " of " + items.length + "…");
        try {
          const r = await process(it, used); let name = r.name, n = 1; while (used.has(name.toLowerCase())) { n++; name = r.name.replace(/(\.[^.]*)$/, "-" + n + "$1"); } used.add(name.toLowerCase());
          total += r.bytes.length; if (total > MAXOUT) throw new Error("the ZIP would be larger than " + P.sizeText(MAXOUT) + " (browser memory); make a second batch");
          out[name] = [r.bytes, { level: 0 }]; ok++; before += it.file.size; after += r.bytes.length;
          it.st.textContent = "done: " + P.sizeText(it.file.size) + " → " + P.sizeText(r.bytes.length); it.tr.className = "ok";
        } catch (e) { fail++; it.st.textContent = "failed: " + e.message; it.tr.className = "bad"; }
        $("prog").value = ++i; await new Promise(r => setTimeout(r, 0));
      }
      $("stop").hidden = true; $("prog").hidden = true; running = false;
      if (!ok) { $("result").textContent = stop ? "Stopped. Nothing to save." : "No picture could be processed, so there is no ZIP."; setStatus("Nothing saved."); renderListKeep(); update(); return; }
      try {
        const zip = fflate.zipSync(out, { level: 0 });
        P.download(new Blob([zip], { type: "application/zip" }), "pictures.zip");
        $("result").textContent = "Saved pictures.zip: " + ok + " picture" + (ok === 1 ? "" : "s") + ", " + P.sizeText(zip.length) + " (originals " + P.sizeText(before) + ")" + (fail ? "; " + fail + " failed (see the list)." : ".") + (stop ? " You stopped early." : "");
        setStatus("Saved pictures.zip.");
      } catch (e) { $("result").textContent = "The ZIP could not be made: " + e.message; setStatus("Not saved."); }
      $("clear").disabled = false; update(); for (const b of root.querySelectorAll(".imgbatch-list button")) b.disabled = false;
    });
    function renderListKeep() { $("clear").disabled = false; for (const b of root.querySelectorAll(".imgbatch-list button")) b.disabled = false; }
    $("stop").addEventListener("click", () => { stop = true; $("stop").hidden = true; setStatus("Stopping after this picture…"); });
    $("clear").addEventListener("click", () => { items = []; $("result").textContent = ""; renderList(); update(); });
    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { add([...$("file").files]); $("file").value = ""; });
    root.addEventListener("dragover", e => e.preventDefault());
    root.addEventListener("drop", e => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) add([...e.dataTransfer.files]); });
    update();
    return { destroy() { stop = true; } };
  }
  return { init };
})();
