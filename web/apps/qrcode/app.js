/* QR Code maker and reader. Encoding, decoding and the text formats are in lib/qrcode.js. A picture chosen for reading is decoded in the browser and never sent anywhere.
   Nothing found in a code is opened or followed; text from a code reaches the page only through textContent. */
(window.DesktopApps = window.DesktopApps || {}).qrcode = (() => {
  function init(root) {
    const $ = id => root.querySelector("#qrcode-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const Q = window.QR, TK = window.TK;
    let current = null, text = "", readText = "";
    const FIELDS = {
      text: [["text", "Text or web address", "area", "https://example.com"]],
      wifi: [["ssid", "Network name (SSID)"], ["password", "Password"], ["security", "Security", "select", [["WPA", "WPA / WPA2 / WPA3"], ["WEP", "WEP (old)"], ["nopass", "No password"]]], ["hidden", "The network is hidden", "check"]],
      email: [["to", "E-mail address"], ["subject", "Subject (optional)"], ["body", "Message (optional)", "area"]],
      tel: [["number", "Phone number, with the country code, like +44 20 7946 0000"]],
      sms: [["number", "Phone number"], ["message", "Message (optional)", "area"]],
      vcard: [["first", "First name"], ["last", "Last name"], ["org", "Organisation"], ["title", "Job title"], ["phone", "Phone"], ["email", "E-mail"], ["url", "Web address"]],
    };
    const val = {};
    function fields() {
      const box = $("fields"); box.textContent = ""; const k = $("kind").value;
      for (const [id, label, type, extra] of FIELDS[k]) {
        const l = document.createElement("label"); const el = type === "area" ? document.createElement("textarea") : type === "select" ? document.createElement("select") : document.createElement("input");
        if (type === "check") { el.type = "checkbox"; el.className = "xp-check"; l.append(el, document.createTextNode(" " + label)); l.className = "qrcode-check"; }
        else { l.className = "tk-fld"; const b = document.createElement("b"); b.textContent = label; if (type === "area") { el.className = "xp-text tk-in"; el.rows = 3; if (extra) el.placeholder = extra; } else if (type === "select") { el.className = "xp-select"; for (const [v, t] of extra) { const o = document.createElement("option"); o.value = v; o.textContent = t; el.append(o); } } else { el.type = "text"; el.className = "xp-field tk-wide"; el.maxLength = 300; } el.setAttribute("autocomplete", "off"); el.spellcheck = false; l.append(b, el); }
        el.id = "qrcode-f-" + id; el.addEventListener(type === "select" || type === "check" ? "change" : "input", TK.debounce(make, 200)); const row = document.createElement("div"); row.className = "tk-row"; row.append(l); box.append(row);
      }
    }
    const f = id => { const e = root.querySelector("#qrcode-f-" + id); return e ? (e.type === "checkbox" ? e.checked : e.value) : ""; };
    const lum = hex => { const v = parseInt(hex.slice(1), 16), c = [v >> 16 & 255, v >> 8 & 255, v & 255].map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    function make() {
      const k = $("kind").value, p = Q.payload(k, Object.fromEntries(FIELDS[k].map(([id]) => [id, f(id)])));
      current = null; $("outbox").hidden = true; const notes = [];
      if (p.error) { if (FIELDS[k].some(([id]) => f(id) !== "" && f(id) !== false)) notes.push({ level: "warn", text: p.error }); TK.notes($("notes"), notes); setStatus("Ready"); return; }
      text = p.text; if (text === "") { TK.notes($("notes"), []); setStatus("Ready"); return; }
      const e = Q.encode(text, { ecc: $("ecc").value });
      if (!e.ok) { TK.notes($("notes"), [{ level: "bad", text: e.error }]); setStatus("Too long."); return; }
      current = e; const margin = Math.max(0, Math.min(10, Math.floor(Number($("margin").value) || 0))), total = e.size + 2 * margin, target = Number($("size").value), scale = Math.max(1, Math.floor(target / total));
      const cv = $("canvas"); cv.width = cv.height = total * scale; const g = cv.getContext("2d");
      g.clearRect(0, 0, cv.width, cv.height); if (!$("transparent").checked) { g.fillStyle = $("bg").value; g.fillRect(0, 0, cv.width, cv.height); }
      g.fillStyle = $("fg").value; for (let y = 0; y < e.size; y++) for (let x = 0; x < e.size; x++) if (e.modules[y][x]) g.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
      $("outbox").hidden = false;
      const lf = lum($("fg").value), lb = $("transparent").checked ? 1 : lum($("bg").value), ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
      if (ratio < 3) notes.push({ level: "bad", text: "The squares and the background are too alike (contrast " + ratio.toFixed(1) + " : 1). Phones will not be able to read this code. Use dark squares on a light background." });
      else if (lf > lb && !$("transparent").checked) notes.push({ level: "warn", text: "Light squares on a dark background (an inverted code). Many phones read these, but some scanners do not." });
      if (margin < 2) notes.push({ level: "warn", text: "An empty border of less than 2 squares can stop scanners from finding the code. 4 is the standard." });
      if (scale < 3 && e.size > 60) notes.push({ level: "warn", text: "Each square is only " + scale + " pixel" + (scale === 1 ? "" : "s") + " wide in this picture. Choose a larger picture size." });
      TK.notes($("notes"), notes);
      $("info").textContent = "Version " + e.version + " (" + e.size + " × " + e.size + " squares), " + ({ numeric: "digits only", alnum: "capital letters and digits", byte: "any text" })[e.mode] + ", error correction " + e.ecc + ". Picture: " + cv.width + " × " + cv.height + " pixels. The code holds " + (e.mode === "byte" ? new TextEncoder().encode(text).length + " bytes" : text.length + " characters") + ".";
      setStatus("Made.");
    }
    $("kind").addEventListener("change", () => { fields(); make(); });
    for (const id of ["ecc", "size", "fg", "bg", "transparent"]) $(id).addEventListener("change", make); $("margin").addEventListener("input", TK.debounce(make, 200));
    const dl = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); };
    $("png").addEventListener("click", () => { if (!current) return; $("canvas").toBlob(b => { dl(b, "qrcode.png"); setStatus("Saved qrcode.png."); }, "image/png"); });
    $("svg").addEventListener("click", () => { if (!current) return; const m = Math.max(0, Math.min(10, Math.floor(Number($("margin").value) || 0))); dl(new Blob([Q.toSvg(current.modules, { border: m, dark: $("fg").value, light: $("transparent").checked ? null : $("bg").value })], { type: "image/svg+xml" }), "qrcode.svg"); setStatus("Saved qrcode.svg."); });
    $("copy").addEventListener("click", () => TK.copy(text, setStatus));
    // ---- reading ----
    async function read(file) {
      $("result").textContent = ""; $("rcopy").hidden = true; TK.notes($("rnotes"), []); $("fname").textContent = file.name;
      if (file.size > 30 * 1024 * 1024) { TK.notes($("rnotes"), [{ level: "bad", text: "That picture is larger than 30 MB." }]); return; }
      let bmp; try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { TK.notes($("rnotes"), [{ level: "bad", text: "The browser could not open this file as a picture." }]); return; }
      setStatus("Looking for a code…"); await new Promise(r => setTimeout(r, 20));
      let result = null;
      for (const maxSide of [1600, 2600, 900]) {
        const sc = Math.min(1, maxSide / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * sc)), h = Math.max(1, Math.round(bmp.height * sc));
        const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d", { willReadFrequently: true }); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h);
        const r = Q.decodeImage(g.getImageData(0, 0, w, h).data, w, h); if (r.ok) { result = r; break; } result = result || r;
        if (sc === 1) { /* the picture is already smaller than the next sizes: only a smaller try can still help */ }
      }
      if (bmp.close) bmp.close();
      if (!result.ok) { TK.notes($("rnotes"), [{ level: "bad", text: result.error + " Tips: show the whole code with a little empty space around it, keep it flat and sharp, and use a larger or cleaner picture." }]); setStatus("No code read."); return; }
      readText = result.text; const d = Q.describeText(readText), notes = [];
      if (d.warn) notes.push({ level: "warn", text: d.warn });
      if (result.corrected) notes.push({ level: "", text: result.corrected + " damaged byte" + (result.corrected === 1 ? " was" : "s were") + " repaired by the code's built-in error correction." });
      for (const n of result.notes || []) notes.push({ level: "", text: n });
      TK.notes($("rnotes"), notes);
      TK.render($("result"), [{ title: "What the code says (it is not opened or followed)", rows: [["Looks like", d.kind], ["Text", readText.length > 2000 ? readText.slice(0, 2000) + "…" : readText], ["Version / level", "version " + result.version + ", error correction " + result.ecc], ["Data type", (result.modes || []).join(", ")]], mono: true }], { copy: true, status: setStatus });
      $("rcopy").hidden = false; setStatus("Code read.");
    }
    $("rcopy").addEventListener("click", () => TK.copy(readText, setStatus));
    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const fl = $("file").files[0]; $("file").value = ""; if (fl) read(fl); });
    root.addEventListener("dragover", e => e.preventDefault());
    root.addEventListener("drop", e => { e.preventDefault(); const fl = e.dataTransfer && e.dataTransfer.files[0]; if (fl) read(fl); });
    fields(); make();
    return { destroy() {} };
  }
  return { init };
})();
