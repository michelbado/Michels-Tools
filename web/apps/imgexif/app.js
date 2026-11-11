/* Photo Info & Privacy. All reading and rewriting is in lib/exif.js; this file shows it and asks what to keep. The picture is read from the file the
   visitor opens and never leaves the browser. Everything from the file reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).imgexif = (() => {
  function init(root) {
    const $ = id => root.querySelector("#imgexif-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const X = window.Exif, TK = window.TK;
    const MAXMB = 60;
    let file = null, bytes = null, info = null;
    const rows = []; // {entry, keep: checkbox, text: input|null, tr}
    const others = []; // {item, box}

    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    function reset() { file = bytes = info = null; rows.length = 0; others.length = 0; $("work").hidden = true; $("check").hidden = true; $("result").textContent = ""; TK.notes($("notes"), []); }

    async function load(f) {
      reset(); $("name").textContent = f.name;
      if (f.size > MAXMB * 1024 * 1024) { TK.notes($("notes"), [{ level: "bad", text: "This picture is larger than " + MAXMB + " MB. Please choose a smaller one." }]); setStatus("Too large."); return; }
      let buf; try { buf = new Uint8Array(await f.arrayBuffer()); } catch { TK.notes($("notes"), [{ level: "bad", text: "The file could not be read." }]); return; }
      const r = X.read(buf);
      if (!r.format || r.format === "heic" || r.format === "tiff") { TK.notes($("notes"), r.problems.map(t => ({ level: "bad", text: t }))); setStatus("Not supported."); return; }
      file = f; bytes = buf; info = r;
      show();
      setStatus("Read " + f.name + ".");
    }

    function fmtSize(n) { return n < 1024 ? n + " bytes" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(2) + " MB"; }
    function show() {
      const r = info, notes = [];
      for (const p of r.problems) notes.push({ level: "warn", text: p });
      TK.notes($("notes"), notes);
      $("work").hidden = false;
      // what it gives away
      const all = r.groups.flatMap(g => g.entries), get = (i, t) => all.find(e => e.ifd === i && e.tag === t);
      const rev = [];
      if (r.gps) rev.push({ level: "bad", text: "Location: the exact place where it was taken is stored in this picture." });
      else if (r.groups.some(g => g.id === "gps")) rev.push({ level: "warn", text: "Location fields are present but no usable position could be read." });
      const dt = get("exif", 0x9003) || get("ifd0", 0x0132); if (dt) rev.push({ level: "warn", text: "Time: taken " + dt.value + " (the camera's own clock)." });
      const mk = get("ifd0", 0x010F), md = get("ifd0", 0x0110); if (mk || md) rev.push({ level: "warn", text: "Device: " + [mk && mk.value, md && md.value].filter(Boolean).join(" ") + "." });
      const sn = ["exif:" + 0xA431, "exif:" + 0xA435, "exif:" + 0xA420].map(k => all.find(e => e.ifd + ":" + e.tag === k)).filter(Boolean);
      if (sn.length) rev.push({ level: "bad", text: "Identifiers: " + sn.map(e => e.label.toLowerCase()).join(", ") + " (these can tie the picture to one specific camera)." });
      const who = [get("ifd0", 0x013B), get("exif", 0xA430), get("ifd0", 0x8298)].filter(Boolean); if (who.length) rev.push({ level: "bad", text: "Names: " + who.map(e => e.label.toLowerCase() + " \"" + e.value + "\"").join(", ") + "." });
      if (r.groups.some(g => g.id === "ifd1")) rev.push({ level: "warn", text: "A small embedded preview is stored. It can still show the original, uncropped picture even if the main picture was cropped." });
      for (const o of r.other) if (o.personal) rev.push({ level: "warn", text: o.name + "." });
      if (!rev.length) rev.push({ level: "good", text: r.hasExif ? "Nothing that identifies a place, a person or a device was found." : "This picture has no hidden camera data. You can add some in the box below if you want (a date, a name, a copyright line, a location)." });
      TK.notes($("reveal"), rev);
      const g = $("gps");
      if (r.gps) { g.hidden = false; g.textContent = "Position stored in the picture: " + r.gps.lat.toFixed(6) + ", " + r.gps.lon.toFixed(6) + (r.gps.alt !== null ? " (altitude " + Math.round(r.gps.alt) + " m)" : "") + ". Search these numbers in any map to see the place; this page makes no map request."; } else g.hidden = true;
      // tables
      const box = $("tables"); box.textContent = ""; rows.length = 0;
      const head = el("p", "tk-muted", r.dims ? "Size " + r.dims.w + " × " + r.dims.h + " pixels, " + r.format.toUpperCase() + ", " + fmtSize(r.size) + "." : r.format.toUpperCase() + ", " + fmtSize(r.size) + ".");
      box.append(head);
      for (const grp of r.groups) {
        const fs = el("fieldset"), lg = el("legend", "", grp.title), tb = el("table", "imgexif-tbl");
        fs.append(lg);
        for (const e of grp.entries) {
          const tr = el("tr"), tdk = el("td", "imgexif-k"), th = el("th", "", e.label), td = el("td");
          const cb = el("input"); cb.type = "checkbox"; cb.checked = !e.thumbnail && grp.id !== "interop" ? true : false;
          if (grp.id === "ifd1" || grp.id === "interop") { cb.checked = false; cb.disabled = true; }
          cb.setAttribute("aria-label", "Keep " + e.label); tdk.append(cb);
          const inp = null;
          td.append(document.createTextNode(e.value));
          if (e.personal) { const f = el("span", "imgexif-flag" + (e.personal.kind === "device" ? " device" : ""), e.personal.kind === "place" ? "location" : e.personal.kind === "person" ? "personal" : "device"); f.title = e.personal.why; td.append(f); }
          if (e.tag === 0x927C) { const h = el("span", "tk-hint", "Always removed from the saved copy: its inner structure cannot be copied safely."); td.append(h); cb.checked = false; cb.disabled = true; }
          if (grp.id === "ifd1" || grp.id === "interop") { const h = el("span", "tk-hint", grp.id === "ifd1" ? "Always removed from the saved copy." : "Always removed from the saved copy (technical)."); td.append(h); }
          tr.append(tdk, th, td); tb.append(tr);
          cb.addEventListener("change", sync);
          rows.push({ e, cb, inp, tr, th });
        }
        fs.append(tb); box.append(fs);
      }
      // other data
      const ob = $("other"); ob.textContent = ""; others.length = 0; ob.className = "imgexif-oth";
      const byId = new Map();
      for (const o of r.other) { const g = byId.get(o.id); if (g) { g.n++; g.size += o.size; } else byId.set(o.id, { o, n: 1, size: o.size }); }
      for (const g of byId.values()) {
        const lab = el("label"), cb = el("input"); cb.type = "checkbox"; cb.checked = true;
        lab.append(cb, document.createTextNode(" Keep: " + (g.n > 1 ? g.o.name + " and " + (g.n - 1) + " more of the same kind" : g.o.name) + " (" + fmtSize(g.size) + ")")); ob.append(lab);
        others.push({ o: g.o, cb }); cb.addEventListener("change", sync);
      }
      $("otherbox").hidden = !others.length;
      fillPanel();
      // default: everything kept, nothing changed
      sync();
    }
    // ---- the edit panel ----
    const FIELDS = [["desc", "ifd0", 0x010E], ["artist", "ifd0", 0x013B], ["copy", "ifd0", 0x8298], ["make", "ifd0", 0x010F], ["model", "ifd0", 0x0110], ["soft", "ifd0", 0x0131]];
    const DATES = [["exif", 0x9003], ["exif", 0x9004], ["ifd0", 0x0132]];
    let orig = {};
    const toLocal = t => { const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)$/.exec(String(t).trim()); return m ? m[1] + "-" + m[2] + "-" + m[3] + "T" + m[4] + ":" + m[5] + ":" + m[6] : ""; };
    function fillPanel() {
      const all = info.groups.flatMap(g => g.entries), get = (i, t) => all.find(e => e.ifd === i && e.tag === t);
      orig = {};
      for (const [k, i, t] of FIELDS) { const e = get(i, t); orig[k] = e && e.text ? e.value : ""; $("f-" + k).value = orig[k]; }
      const d = get("exif", 0x9003) || get("ifd0", 0x0132); orig.date = d ? toLocal(d.value) : ""; $("f-date").value = orig.date;
      orig.lat = info.gps ? String(+info.gps.lat.toFixed(6)) : ""; orig.lon = info.gps ? String(+info.gps.lon.toFixed(6)) : "";
      $("f-lat").value = orig.lat; $("f-lon").value = orig.lon; $("sh-h").value = 0; $("sh-m").value = 0;
    }
    const clearPanel = keys => { for (const k of keys) $("f-" + k).value = ""; };
    function sync() { for (const r of rows) { const gone = !r.cb.checked || (r.inp && r.inp.value === "" && r.e.value !== ""); r.th.classList.toggle("imgexif-gone", gone); } }
    const setKeep = fn => { for (const r of rows) if (!r.cb.disabled) r.cb.checked = fn(r.e); for (const o of others) o.cb.checked = fn(null, o.o); sync(); };
    $("all").addEventListener("click", () => { if (info) { setKeep((e, o) => o ? !!o.keep : false); clearPanel(["desc", "artist", "copy", "make", "model", "soft", "date", "lat", "lon"]); setStatus("Everything is unticked except the colour profile; the rotation stays if the box is ticked."); } });
    $("personal").addEventListener("click", () => { if (info) { setKeep((e, o) => o ? !o.personal : !e.personal && e.ifd !== "gps"); clearPanel(["desc", "artist", "copy", "make", "model", "soft", "lat", "lon"]); setStatus("Location, names, serial numbers, comments, camera model and software, and other personal data are unticked."); } });
    $("nogps").addEventListener("click", () => { if (info) { setKeep((e, o) => o ? true : e.ifd !== "gps"); clearPanel(["lat", "lon"]); setStatus("Only the location is unticked."); } });
    $("keep").addEventListener("click", () => { if (info) { setKeep(() => true); fillPanel(); setStatus("Everything is ticked and the boxes show what the picture contains."); } });

    function sameList(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); }
    $("save2").addEventListener("click", () => $("save").click());
    $("save").addEventListener("click", async () => {
      if (!info) return;
      $("check").hidden = true;
      const keepMap = new Map(rows.map(r => [r.e, r.cb.checked]));
      const texts = {};
      for (const r of rows) if (r.inp && r.cb.checked && r.inp.value !== r.e.value) texts[r.e.ifd + ":" + r.e.tag] = r.inp.value;
      for (const r of rows) if (r.inp && r.cb.checked && r.inp.value === "" && r.e.value !== "") texts[r.e.ifd + ":" + r.e.tag] = "";
      const drop = others.filter(o => !o.cb.checked).map(o => o.o.id);
      const set = [], dropIfd = [], bad = [];
      for (const [k, i, t] of FIELDS) { const v = $("f-" + k).value.trim(); if (v !== orig[k]) set.push({ ifd: i, tag: t, entry: v === "" ? null : X.asciiEntry(i, t, v) }); }
      const dv = $("f-date").value, shiftMin = (+$("sh-h").value || 0) * 60 + (+$("sh-m").value || 0);
      if (dv !== orig.date) {
        if (shiftMin) bad.push("Use either a new date or a shift of all dates, not both.");
        else if (dv === "") for (const [i, t] of DATES) set.push({ ifd: i, tag: t, entry: null });
        else { let tx = dv.replace(/-/g, ":").replace("T", " "); if (tx.length === 16) tx += ":00"; if (!/^\d{4}:\d\d:\d\d \d\d:\d\d:\d\d$/.test(tx)) bad.push("The date is not valid."); else for (const [i, t] of DATES) set.push({ ifd: i, tag: t, entry: X.asciiEntry(i, t, tx) }); }
      } else if (shiftMin) {
        const all = info.groups.flatMap(g => g.entries); let n = 0;
        for (const [i, t] of DATES) { const e = all.find(x => x.ifd === i && x.tag === t); if (!e) continue; const sh = X.shiftDate(e.value, shiftMin); if (sh) { set.push({ ifd: i, tag: t, entry: X.asciiEntry(i, t, sh) }); n++; } }
        if (!n) bad.push("This picture has no date to shift. Type a date in the first box instead.");
      }
      const lat = $("f-lat").value.trim(), lon = $("f-lon").value.trim();
      if (lat !== orig.lat || lon !== orig.lon) {
        if (lat === "" && lon === "") dropIfd.push("gps");
        else if (!/^-?\d+([.,]\d+)?$/.test(lat) || !/^-?\d+([.,]\d+)?$/.test(lon)) bad.push("Type both latitude and longitude as plain numbers, for example 48.858333 and 2.351944.");
        else { const g = X.gpsEntries(parseFloat(lat.replace(",", ".")), parseFloat(lon.replace(",", ".")), info.le); if (g.error) bad.push(g.error); else { dropIfd.push("gps"); for (const e of g.entries) set.push({ ifd: "gps", tag: e.tag, entry: e }); } }
      }
      if (bad.length) { TK.notes($("check"), bad.map(t => ({ level: "bad", text: "Nothing was saved. " + t }))); setStatus("Not saved."); return; }
      let out;
      try {
        const plan = X.makePlan(info, { keep: e => keepMap.get(e) !== false, texts, drop, set, dropIfd, keepOrientation: $("rot").checked });
        out = X.rewrite(bytes, plan);
        await verify(out, plan, drop);
      } catch (err) {
        TK.notes($("check"), [{ level: "bad", text: "Nothing was saved: " + err.message }]); setStatus("Not saved."); return;
      }
    });
    // Self-check: read the new file back, make sure what was removed is gone, what was kept is there, and the picture bytes are unchanged.
    async function verify(out, plan, drop) {
      const problems = [];
      const r2 = X.read(out), a2 = r2.groups.flatMap(g => g.entries);
      const want = plan.exif;
      for (const w of want) { const m = a2.find(e => e.ifd === w.ifd && e.tag === w.tag); if (!m) problems.push("a kept item is missing (" + w.ifd + " " + w.tag + ")"); }
      for (const e of a2) if (!want.some(w => w.ifd === e.ifd && w.tag === e.tag)) problems.push("an item that should be gone is still there (" + e.label + ")");
      if (r2.groups.some(g => g.id === "gps") && !want.some(w => w.ifd === "gps")) problems.push("location data is still present");
      for (const id of drop) if (r2.other.some(o => o.id === id)) problems.push("removed data is still present (" + id + ")");
      const p1 = X.pictureBytes(bytes), p2 = X.pictureBytes(out);
      if (p1.length !== p2.length || !p1.every((v, i) => v === p2[i])) problems.push("the picture data changed");
      let decoded = false;
      try { const bm = await createImageBitmap(new Blob([out], { type: "image/" + (info.format === "jpeg" ? "jpeg" : info.format) })); decoded = bm.width > 0; bm.close && bm.close(); } catch { decoded = false; }
      if (!decoded) problems.push("the browser could not open the new picture");
      if (problems.length) { TK.notes($("check"), [{ level: "bad", text: "Nothing was saved because the check of the new file failed: " + problems.join("; ") + "." }]); setStatus("Not saved."); return; }
      const name = file.name.replace(/\.[^.]+$/, "") + "-clean" + (file.name.match(/\.[^.]+$/) || [".jpg"])[0];
      const blob = new Blob([out], { type: file.type || "application/octet-stream" }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      const n = a2.length;
      $("result").textContent = "Saved " + name + " (" + fmtSize(out.length) + ", was " + fmtSize(bytes.length) + ").";
      TK.notes($("check"), [{ level: "good", text: "Checked: the new file opens, the picture data is byte-for-byte the same as the original, " + (r2.gps ? "location data is kept" : "no location data is left") + ", and " + n + " camera data item" + (n === 1 ? "" : "s") + " remain." }]);
      setStatus("Saved " + name + ".");
    }

    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", () => { const f = $("file").files[0]; if (f) load(f); $("file").value = ""; });
    const stop = e => { e.preventDefault(); };
    root.addEventListener("dragover", stop);
    root.addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) load(f); });
    return { destroy() {} };
  }
  return { init };
})();
