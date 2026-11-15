/* The person's own files on the desktop. The server (desktop.go) lists the "desktop" folder next to the program; this file turns each entry into an icon:
   - a .md or .txt file opens in a reader window (Markdown is drawn by lib/minimd.js, plain text is shown as it is),
   - a folder that holds files opens a list in which clicking a file downloads it (the server always sends it as a download, never as a page).
   Everything is put on the page with textContent. If the server has the feature off, nothing happens. */
(() => {
  "use strict";
  const sh = window.Shell;
  if (!sh || typeof sh.setDesktopItems !== "function" || window.DESKTOP_FILES !== true) return;
  const VER = (() => { try { return new URL(document.currentScript.src).searchParams.get("v") || ""; } catch (e) { return ""; } })();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const ICON = { md: "icons/file-md.svg", txt: "icons/file-text.svg" };
  const BY_EXT = {
    md: ICON.md, markdown: ICON.md, txt: ICON.txt, log: ICON.txt, csv: ICON.txt,
    zip: "icons/file-zip.svg", "7z": "icons/file-zip.svg", rar: "icons/file-zip.svg", gz: "icons/file-zip.svg", tgz: "icons/file-zip.svg", tar: "icons/file-zip.svg",
    pdf: "icons/file-pdf.svg", png: "icons/file-image.svg", jpg: "icons/file-image.svg", jpeg: "icons/file-image.svg", gif: "icons/file-image.svg", webp: "icons/file-image.svg", svg: "icons/file-image.svg", bmp: "icons/file-image.svg",
  };
  const fileIcon = name => BY_EXT[(name.split(".").pop() || "").toLowerCase()] || "icons/file.svg";
  const fmtSize = n => n < 1024 ? n + " bytes" : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB" : (n / 1073741824).toFixed(1) + " GB";
  const fmtDate = s => { try { return new Date(s * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch (e) { return ""; } };

  async function getJSON(url) {
    const r = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    let j = null; try { j = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) { const err = new Error((j && j.error) || "HTTP " + r.status); err.status = r.status; throw err; }
    return j;
  }
  let mdLoading = null;
  const loadMd = () => window.MiniMd ? Promise.resolve() : (mdLoading = mdLoading || new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "lib/minimd.js?v=" + VER; s.onload = res; s.onerror = () => { mdLoading = null; rej(new Error("The reader could not be loaded.")); }; document.head.append(s);
  }));

  function textItem(it) {
    return { id: "dfile-" + it.name, title: it.title, icon: ICON[it.ext] || ICON.txt, size: { w: 780, h: 640 }, build(body) {
      const root = el("div", "fwin"), view = el("div", "dfile-body"), status = el("div", "statusbar"), cell = el("span", "cell msg", "Loading...");
      status.append(cell); root.append(view, status); body.append(root);
      getJSON("api/desktop/text?name=" + encodeURIComponent(it.name)).then(async j => {
        if (j.kind === "md") { await loadMd(); view.append(window.MiniMd.render(j.text, document)); }
        else { const pre = el("pre", "dfile-txt"); pre.textContent = j.text; view.append(pre); }
        cell.textContent = it.name + "  ·  " + fmtSize(j.size) + (it.mtime ? "  ·  changed " + fmtDate(it.mtime) : "");
      }).catch(e => { view.append(el("p", "dfile-err", e.status === 413 ? "This file is too large to show here." : "This file could not be opened. It may have been removed.")); cell.textContent = "Not available"; });
    } };
  }

  function folderItem(it) {
    return { id: "dfolder-" + it.name, title: it.title, icon: "icons/folder.svg", size: { w: 680, h: 480 }, build(body) {
      const root = el("div", "fwin"), addr = el("div", "faddr"), field = el("div", "faddr-field"), list = el("div", "dlist"), status = el("div", "statusbar"), cell = el("span", "cell msg", "Loading...");
      const fi = el("img"); fi.src = "icons/folder.svg"; fi.alt = ""; field.append(fi, el("span", null, it.title)); addr.append(el("span", "faddr-label", "Address"), field);
      status.append(cell); root.append(addr, list, status); body.append(root);
      getJSON("api/desktop/folder?name=" + encodeURIComponent(it.name)).then(j => {
        for (const f of j.files) {
          const a = el("a", "drow");
          a.href = "desktop-files/" + encodeURIComponent(it.name) + "/" + encodeURIComponent(f.name); a.setAttribute("download", f.name); a.title = "Download " + f.name;
          const img = el("img"); img.src = fileIcon(f.name); img.alt = "";
          a.append(img, el("span", "dname", f.name), el("span", "dsize", fmtSize(f.size)), el("span", "ddate", f.mtime ? fmtDate(f.mtime) : ""));
          list.append(a);
        }
        cell.textContent = j.files.length + " file" + (j.files.length === 1 ? "" : "s") + "  ·  click a file to download it";
      }).catch(() => { list.append(el("p", "dfile-err", "This folder is empty or no longer available.")); cell.textContent = "Not available"; });
    } };
  }

  let last = 0, busy = false;
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const j = await getJSON("api/desktop");
      sh.setDesktopItems((j.items || []).map(it => it.kind === "folder" ? folderItem(it) : textItem(it)));
    } catch (e) { /* the feature is off or the server is old: nothing to show */ }
    finally { busy = false; last = Date.now(); }
  }
  refresh();
  // coming back to the page picks up files that were added or removed in the meantime
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - last > 30000) refresh(); });
})();
