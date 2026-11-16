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

  // A folder from the desktop folder: the desktop icon is the shared folder (a hand under it), the window and the folders inside it use the plain folder.
  // Folders open in the same window (the address bar shows where you are, Up goes back); clicking a file downloads it.
  function folderItem(it) {
    return { id: "dfolder-" + it.name, title: it.title, icon: "icons/folder-shared.svg", winIcon: "icons/folder.svg", size: { w: 700, h: 500 }, build(body) {
      const root = el("div", "fwin"), addr = el("div", "faddr"), field = el("div", "faddr-field"), where = el("span", "dwhere"), up = el("button", "xp-btn small dup", "Up"), list = el("div", "dlist"), status = el("div", "statusbar"), cell = el("span", "cell msg", "Loading...");
      const fi = el("img"); fi.src = "icons/folder.svg"; fi.alt = ""; up.type = "button"; up.title = "Go up one folder"; up.hidden = true;
      field.append(fi, where); addr.append(el("span", "faddr-label", "Address"), field, up);
      status.append(cell); root.append(addr, list, status); body.append(root);
      let path = [it.name], token = 0;
      const href = (p, name) => "desktop-files/" + p.concat(name).map(encodeURIComponent).join("/");
      function show(p) {
        const mine = ++token; path = p; list.textContent = ""; cell.textContent = "Loading..."; where.textContent = p.join("  \u203A  "); up.hidden = p.length < 2;
        getJSON("api/desktop/folder?path=" + encodeURIComponent(p.join("/"))).then(j => {
          if (mine !== token) return; // a newer click came first
          for (const f of j.folders || []) {
            const b = el("button", "drow dfld"); b.type = "button"; b.title = "Open " + f.name;
            const img = el("img"); img.src = "icons/folder.svg"; img.alt = "";
            b.append(img, el("span", "dname", f.name), el("span", "dsize", "Folder"), el("span", "ddate"));
            b.addEventListener("click", () => show(p.concat(f.name)));
            list.append(b);
          }
          for (const f of j.files || []) {
            const a = el("a", "drow");
            a.href = href(p, f.name); a.setAttribute("download", f.name); a.title = "Download " + f.name;
            const img = el("img"); img.src = fileIcon(f.name); img.alt = "";
            a.append(img, el("span", "dname", f.name), el("span", "dsize", fmtSize(f.size)), el("span", "ddate", f.mtime ? fmtDate(f.mtime) : ""));
            list.append(a);
          }
          const nf = (j.folders || []).length, nm = (j.files || []).length;
          cell.textContent = (nf ? nf + " folder" + (nf === 1 ? "" : "s") + ", " : "") + nm + " file" + (nm === 1 ? "" : "s") + "  \u00B7  click a file to download it";
        }).catch(() => { if (mine !== token) return; list.append(el("p", "dfile-err", "This folder is empty or no longer available.")); cell.textContent = "Not available"; });
      }
      up.addEventListener("click", () => { if (path.length > 1) show(path.slice(0, -1)); });
      show(path);
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
