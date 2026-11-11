/* Favicon & Icon Generator. File formats, sizes and the snippet text are in lib/imgicon.js; drawing helpers in lib/imgproc.js; the ZIP is built by the vendored fflate.
   The picture is read from the file the visitor opens and never leaves the browser. Everything shown from visitor input uses textContent / .value. */
(window.DesktopApps = window.DesktopApps || {}).imgfavicon = (() => {
  function init(root) {
    const $ = id => root.querySelector("#imgfavicon-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const P = window.ImgProc, I = window.ImgIcon, TK = window.TK;
    let file = null, bmp = null, master = null, icons = null;
    const MASTER = 512;

    function render() {
      if (!bmp) return;
      const c = document.createElement("canvas"); c.width = c.height = MASTER; const g = c.getContext("2d");
      const shape = $("shape").value, r = shape === "circle" ? MASTER / 2 : shape === "rounded" ? MASTER * 0.18 : 0;
      g.save();
      if (r) { g.beginPath(); g.roundRect(0, 0, MASTER, MASTER, r); g.clip(); }
      if (!$("transparent").checked) { g.fillStyle = $("bg").value; g.fillRect(0, 0, MASTER, MASTER); }
      const p = I.place(bmp.width, bmp.height, MASTER, $("fit").value, +$("pad").value);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; g.drawImage(bmp, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh);
      g.restore(); master = c;
      icons = I.SIZES.map(s => ({ spec: s, canvas: s.size === MASTER ? c : P.scale(c, s.size, s.size) }));
      const prev = $("prev"); prev.textContent = "";
      for (const ic of icons) { const f = document.createElement("figure"), cc = document.createElement("canvas"); cc.width = cc.height = ic.spec.size; cc.getContext("2d").drawImage(ic.canvas, 0, 0); if (ic.spec.size > 128) { cc.style.width = "128px"; } const cap = document.createElement("figcaption"); cap.textContent = ic.spec.size + " × " + ic.spec.size; f.append(cc, cap); prev.append(f); }
      $("snippet").value = I.htmlSnippet($("theme").value);
      $("list").textContent = ["favicon.ico"].concat(I.SIZES.map(s => s.name), ["site.webmanifest", "favicon-snippet.html"]).join(", ") + ".";
    }
    async function load(f) {
      TK.notes($("notes"), []); $("done").textContent = "";
      let b; try { b = await P.load(f); } catch (e) { TK.notes($("notes"), [{ level: "bad", text: e.message }]); setStatus("Not opened."); return; }
      if (bmp && bmp.close) bmp.close(); bmp = b; file = f;
      const notes = []; if (Math.min(b.width, b.height) < 512) notes.push({ level: "warn", text: "This picture is smaller than 512 pixels on its short side. The big icons will look soft; a larger logo gives sharper results." });
      if (Math.abs(b.width - b.height) > 2) notes.push({ level: "", text: "The picture is not square. Choose below whether to show it whole (with space around) or fill the square (cutting the long sides)." });
      TK.notes($("notes"), notes);
      $("name").textContent = f.name + " (" + b.width + " × " + b.height + ")"; $("work").hidden = false; render(); setStatus("Opened " + f.name + ".");
    }
    const shownPad = () => { $("padv").textContent = $("pad").value; };
    $("pad").addEventListener("input", () => { shownPad(); render(); });
    for (const id of ["fit", "shape", "transparent", "bg", "theme"]) $(id).addEventListener("input", render);
    const blobBytes = async c => new Uint8Array(await (await P.encode(c, "png", 1)).arrayBuffer());
    async function files() {
      const out = {}, icoList = [];
      for (const ic of icons) { const bytes = await blobBytes(ic.canvas); out[ic.spec.name] = bytes; if (I.ICO_SIZES.includes(ic.spec.size)) icoList.push({ size: ic.spec.size, png: bytes }); }
      return { png: out, ico: I.buildIco(icoList) };
    }
    $("ico").addEventListener("click", async () => {
      if (!icons) return; try { const f = await files(); P.download(new Blob([f.ico], { type: "image/x-icon" }), "favicon.ico"); $("done").textContent = "Saved favicon.ico (" + P.sizeText(f.ico.length) + ", sizes 16, 32 and 48)."; setStatus("Saved."); } catch (e) { $("done").textContent = "Not saved: " + e.message; }
    });
    $("zip").addEventListener("click", async () => {
      if (!icons) return; $("done").textContent = "Working…";
      try {
        const f = await files(), enc = s => new TextEncoder().encode(s), entries = { "favicon.ico": f.ico };
        for (const [n, b] of Object.entries(f.png)) entries[n] = b;
        entries["site.webmanifest"] = enc(I.manifest($("appname").value.trim(), $("short").value.trim(), $("theme").value, $("theme").value));
        entries["favicon-snippet.html"] = enc(I.htmlSnippet($("theme").value));
        const zip = fflate.zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, [v, { level: 0 }]])), { level: 0 });
        P.download(new Blob([zip], { type: "application/zip" }), "favicons.zip"); $("done").textContent = "Saved favicons.zip (" + Object.keys(entries).length + " files, " + P.sizeText(zip.length) + ")."; setStatus("Saved.");
      } catch (e) { $("done").textContent = "Not saved: " + e.message; setStatus("Not saved."); }
    });
    $("copy").addEventListener("click", () => TK.copy($("snippet").value, setStatus));
    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const f = $("file").files[0]; if (f) load(f); $("file").value = ""; });
    root.addEventListener("dragover", e => e.preventDefault());
    root.addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) load(f); });
    return { destroy() { if (bmp && bmp.close) bmp.close(); } };
  }
  return { init };
})();
