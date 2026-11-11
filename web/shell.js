/* Desktop shell: icons, windows, taskbar, Tools menu.
 *
 * To add an app:
 *   1. create web/apps/<id>/ with app.html, app.css, app.js and icon.svg
 *   2. add { id, title, base } to APPS below; ALSO add its id to toolFolders in tools.go (go test checks this; it is what lets a
 *      deployer switch the tool off in tools.conf). Add folder: "<folder id>" to put it inside a
 *      folder (see FOLDERS), leave it out to show the app directly on the desktop
 *   3. prefix every element id in app.html with the app id (e.g. "subnet-ip"): ids are document-wide
 *   4. in app.js: (window.DesktopApps ||= {}).<id> = { init(root, shell) { ...; return { destroy() {} }; } };
 */
(() => {
  "use strict";

  const VERSION = "57"; // bump with the cache-busting ?v= in index.html
  // size: optional default window size { w, h }; omitted = as large as the desktop allows
  // deps: optional shared scripts (under web/lib/) loaded before the app's own script
  const APPS = [
    { id: "aggregator", title: "IP Aggregator", base: "apps/aggregator/", folder: "network" },
    { id: "subnet", title: "Subnet Calculator", base: "apps/subnet/", folder: "network", deps: ["lib/ipv4.js"], size: { w: 900, h: 640 } },
    { id: "splitter", title: "Subnet Splitter", base: "apps/splitter/", folder: "network", deps: ["lib/ipv4.js"], size: { w: 1100, h: 680 } },
    { id: "checker", title: "IP Checker", base: "apps/checker/", folder: "network", deps: ["lib/ipv4.js"], size: { w: 1000, h: 680 } },
    { id: "ipv6calc", title: "IPv6 Calculator", base: "apps/ipv6calc/", folder: "network", deps: ["lib/tk.js", "lib/ipv6.js"], size: { w: 900, h: 720 } },
    { id: "ipconv", title: "IP & Number Converter", base: "apps/ipconv/", folder: "network", deps: ["lib/tk.js", "lib/ipv6.js", "lib/ipconv.js"], size: { w: 860, h: 700 } },
    { id: "maclookup", title: "MAC Lookup", base: "apps/maclookup/", folder: "network", deps: ["lib/tk.js", "lib/maclib.js"], size: { w: 820, h: 680 } },
    { id: "portref", title: "Port Reference", base: "apps/portref/", folder: "reference", deps: ["lib/tk.js", "lib/portdata.js"], size: { w: 980, h: 700 } },
    { id: "certdecode", title: "Certificate Decoder", base: "apps/certdecode/", folder: "network", deps: ["lib/tk.js", "lib/ipv6.js", "vendor/pkijs.bundle.js", "lib/softcrypto.js", "lib/certinfo.js"], size: { w: 980, h: 760 } },
    { id: "mailhdr", title: "Email Header Analyser", base: "apps/mailhdr/", folder: "network", deps: ["lib/tk.js", "lib/mailhdr.js"], size: { w: 1000, h: 760 } },
    { id: "mailauth", title: "SPF, DKIM & DMARC Reader", base: "apps/mailauth/", folder: "network", deps: ["lib/tk.js", "lib/mailauth.js"], size: { w: 1000, h: 760 } },
    { id: "mtucalc", title: "MTU & MSS Calculator", base: "apps/mtucalc/", folder: "network", deps: ["lib/tk.js", "lib/mtucalc.js"], size: { w: 960, h: 760 } },
    { id: "pdfinfo", title: "PDF Info", base: "apps/pdfinfo/", folder: "pdf", deps: ["lib/pdfcommon.js"], size: { w: 880, h: 680 } },
    { id: "pdfverify", title: "Verify Signatures", base: "apps/pdfverify/", folder: "pdf", deps: ["lib/pdfcommon.js", "vendor/pkijs.bundle.js", "lib/softcrypto.js", "lib/pdfsig.js"], size: { w: 980, h: 720 } },
    { id: "pdfmeta", title: "Metadata", base: "apps/pdfmeta/", folder: "pdf", deps: ["lib/pdfcommon.js", "vendor/pdf-lib.min.js"], size: { w: 920, h: 740 } },
    { id: "pdfstamp", title: "Add Image / Signature (not a digital signature)", base: "apps/pdfstamp/", folder: "pdf", deps: ["lib/pdfcommon.js", "vendor/pdf-lib.min.js"], size: { w: 1180, h: 760 } },
    { id: "pdfwatermark", title: "Watermark & Page Numbers", base: "apps/pdfwatermark/", folder: "pdf", deps: ["lib/pdfcommon.js", "lib/pdftext.js", "vendor/pdf-lib.min.js"], size: { w: 1200, h: 780 } },
    { id: "pdfpages", title: "Split / Extract Pages", base: "apps/pdfpages/", folder: "pdf", deps: ["lib/pdfcommon.js", "vendor/pdf-lib.min.js", "vendor/fflate.js"], size: { w: 1100, h: 720 } },
    { id: "pdfmerge", title: "Merge PDFs", base: "apps/pdfmerge/", folder: "pdf", deps: ["lib/pdfcommon.js", "vendor/pdf-lib.min.js"], size: { w: 960, h: 720 } },
    { id: "pdforganize", title: "Organize Pages", base: "apps/pdforganize/", folder: "pdf", deps: ["lib/pdfcommon.js", "vendor/pdf-lib.min.js"], size: { w: 1100, h: 740 } },
    { id: "pdfcrop", title: "Crop / Resize Pages", base: "apps/pdfcrop/", folder: "pdf", deps: ["lib/pdfcommon.js", "lib/pdftext.js", "vendor/pdf-lib.min.js"], size: { w: 1180, h: 760 } },
    { id: "pdfredact", title: "Redact", base: "apps/pdfredact/", folder: "pdf", deps: ["lib/pdfcommon.js", "vendor/pdf-lib.min.js"], size: { w: 1180, h: 780 } },
    { id: "pdfimages", title: "Images / PDF Converter", base: "apps/pdfimages/", folder: "pdf", deps: ["lib/pdfcommon.js", "vendor/pdf-lib.min.js", "vendor/fflate.js"], size: { w: 1000, h: 740 } },
    { id: "pdfextract", title: "Extract Content", base: "apps/pdfextract/", folder: "pdf", deps: ["lib/pdfcommon.js", "vendor/fflate.js"], size: { w: 960, h: 740 } },
    { id: "netquality", title: "Connection Quality", base: "apps/netquality/", folder: "trouble", deps: ["lib/cdn.js", "lib/netanalysis.js", "lib/netreport.js"], size: { w: 1180, h: 780 } },
    { id: "connfacts", title: "Connection Facts", base: "apps/connfacts/", folder: "trouble", deps: ["lib/cdn.js", "lib/connfacts.js"], size: { w: 760, h: 700 } },
    { id: "idletest", title: "Idle-timeout Finder", base: "apps/idletest/", folder: "trouble", deps: ["lib/tk.js", "lib/idleanalysis.js"], size: { w: 820, h: 720 } },
    { id: "pathread", title: "Ping & Traceroute Reader", base: "apps/pathread/", folder: "trouble", deps: ["lib/tk.js", "lib/pathread.js"], size: { w: 1000, h: 760 } },
    { id: "browsercaps", title: "Browser Capability Report", base: "apps/browsercaps/", folder: "trouble", deps: ["lib/tk.js", "lib/browsercaps.js"], size: { w: 860, h: 760 } },
    { id: "httphdr", title: "HTTP Header Reader", base: "apps/httphdr/", folder: "trouble", deps: ["lib/tk.js", "lib/cdn.js", "lib/httphdr.js"], size: { w: 1000, h: 760 } },
    { id: "urlparse", title: "URL Parser", base: "apps/urlparse/", folder: "engineering", deps: ["lib/tk.js", "lib/urlparse.js"], size: { w: 1000, h: 760 } },
    { id: "jwtdecode", title: "JWT Decoder", base: "apps/jwtdecode/", folder: "engineering", deps: ["lib/tk.js", "lib/jwtdecode.js"], size: { w: 1000, h: 780 } },
    { id: "basicauth", title: "Basic Auth Generator", base: "apps/basicauth/", folder: "engineering", deps: ["lib/tk.js", "lib/basicauth.js"], size: { w: 900, h: 720 } },
    { id: "xmljson", title: "XML & JSON Converter", base: "apps/xmljson/", folder: "engineering", deps: ["lib/tk.js", "lib/xmljson.js"], size: { w: 1000, h: 800 } },
    { id: "crontab", title: "Crontab Generator", base: "apps/crontab/", folder: "engineering", deps: ["lib/tk.js", "lib/crontab.js"], size: { w: 1000, h: 800 } },
    { id: "chmodcalc", title: "chmod Calculator", base: "apps/chmodcalc/", folder: "engineering", deps: ["lib/tk.js", "lib/chmodcalc.js"], size: { w: 960, h: 800 } },
    { id: "colorconv", title: "Color Converter", base: "apps/colorconv/", folder: "engineering", deps: ["lib/tk.js", "lib/colorconv.js"], size: { w: 960, h: 780 } },
    { id: "imgexif", title: "Photo Info & Privacy (EXIF)", base: "apps/imgexif/", folder: "images", deps: ["lib/tk.js", "lib/exif.js"], size: { w: 980, h: 780 } },
    { id: "imgresize", title: "Resize / Crop", base: "apps/imgresize/", folder: "images", deps: ["lib/tk.js", "lib/imgmath.js"], size: { w: 1100, h: 780 } },
    { id: "imgblur", title: "Blur / Redact", base: "apps/imgblur/", folder: "images", deps: ["lib/tk.js", "lib/imgmath.js", "lib/imgproc.js"], size: { w: 1100, h: 780 } },
    { id: "imgconvert", title: "Convert & Compress", base: "apps/imgconvert/", folder: "images", deps: ["lib/tk.js", "lib/imgmath.js", "lib/imgproc.js"], size: { w: 1100, h: 780 } },
    { id: "imgwatermark", title: "Watermark", base: "apps/imgwatermark/", folder: "images", deps: ["lib/tk.js", "lib/imgmath.js", "lib/imgproc.js"], size: { w: 1100, h: 800 } },
    { id: "imgbatch", title: "Batch Pictures", base: "apps/imgbatch/", folder: "images", deps: ["lib/tk.js", "lib/exif.js", "lib/imgmath.js", "lib/imgproc.js", "vendor/fflate.js"], size: { w: 1100, h: 800 } },
    { id: "imgfavicon", title: "Favicon & Icon Generator", base: "apps/imgfavicon/", folder: "images", deps: ["lib/tk.js", "lib/imgmath.js", "lib/imgproc.js", "lib/imgicon.js", "vendor/fflate.js"], size: { w: 1100, h: 800 } },
    { id: "dscp", title: "DSCP & QoS Values", base: "apps/dscp/", folder: "reference", deps: ["lib/refkit.js", "lib/ref-dscp.js"], size: { w: 1000, h: 720 } },
    { id: "httpstatus", title: "HTTP Status Codes", base: "apps/httpstatus/", folder: "reference", deps: ["lib/refkit.js", "lib/ref-http.js"], size: { w: 1000, h: 720 } },
    { id: "dnstypes", title: "DNS Record Types", base: "apps/dnstypes/", folder: "reference", deps: ["lib/refkit.js", "lib/ref-dns.js"], size: { w: 1000, h: 720 } },
    { id: "icmptypes", title: "ICMP Types", base: "apps/icmptypes/", folder: "reference", deps: ["lib/refkit.js", "lib/ref-icmp.js"], size: { w: 1000, h: 720 } },
    { id: "tcpref", title: "TCP Reference", base: "apps/tcpref/", folder: "reference", deps: ["lib/refkit.js", "lib/ref-tcp.js"], size: { w: 1000, h: 720 } },
    { id: "ipsecref", title: "IPsec Reference", base: "apps/ipsecref/", folder: "reference", deps: ["lib/refkit.js", "lib/ref-ipsec.js"], size: { w: 1000, h: 720 } },
  ];
  APPS.forEach(a => { a.icon = a.base + "icon.svg"; });

  // A folder is a window that lists its apps; it also becomes a submenu in the Tools menu.
  const FOLDERS = [
    { id: "network", title: "Network Tools", size: { w: 640, h: 500 } },
    { id: "pdf", title: "PDF Tools", size: { w: 700, h: 610 } },
    { id: "trouble", title: "Troubleshooting", size: { w: 640, h: 440 } },
    { id: "engineering", title: "Engineering Tools", size: { w: 640, h: 440 } },
    { id: "images", title: "Image Tools", size: { w: 640, h: 440 } },
    { id: "reference", title: "Reference", size: { w: 640, h: 440 } },
  ];
  // Tools the deployer switched off in tools.conf: the server sends window.TOOLS_OFF (script tools-config.js) before this file.
  // Switched-off apps, and folders that are off or left empty, are removed here, so no icon, menu entry or link remains.
  const OFF = new Set(Array.isArray(window.TOOLS_OFF) ? window.TOOLS_OFF : []);
  for (let i = APPS.length - 1; i >= 0; i--) if (OFF.has(APPS[i].id)) APPS.splice(i, 1);
  for (let i = FOLDERS.length - 1; i >= 0; i--) if (OFF.has(FOLDERS[i].id) || !APPS.some(a => a.folder === FOLDERS[i].id)) FOLDERS.splice(i, 1);
  const FOLDER_ITEMS = FOLDERS.map(f => ({ id: "folder-" + f.id, title: f.title, icon: "icons/folder.svg", kind: "folder", folder: f, size: f.size }));
  const ALL = APPS.concat(FOLDER_ITEMS);
  const appsIn = folder => APPS.filter(a => a.folder === folder.id);

  const $ = id => document.getElementById(id);
  const ws = $("workspace"), tasksEl = $("tasks"), menu = $("startmenu"), startBtn = $("start");
  const mobileMQ = window.matchMedia("(max-width: 699px)");
  const reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");

  const wins = new Map();      // app id -> window record
  const loading = new Map();   // app id -> promise (files loaded once)
  const pending = new Set();   // app ids currently opening
  let zTop = 10;
  let current = null;

  window.DesktopApps = window.DesktopApps || {};

  const MAX_W = 1240, MAX_H = 960, EDGE = 16, CASCADE = 28;

  /* ---------- shared message dialog ---------- */

  const shell = {
    alert(message) {
      $("dlgMsg").textContent = message;
      const d = $("dlg");
      if (typeof d.showModal === "function") {
        if (!d.open) d.showModal();
        $("dlgOk").focus();
      } else {
        window.alert(message);
      }
    },
  };
  window.Shell = shell;
  $("dlgOk").onclick = $("dlgX").onclick = () => $("dlg").close();

  /* ---------- privacy notice: shown as soon as the page opens, until OK is pressed ---------- */

  const notice = $("notice");
  const closeNotice = () => { if (typeof notice.close === "function") notice.close(); else notice.removeAttribute("open"); };
  $("noticeOk").onclick = $("noticeX").onclick = closeNotice;
  if (typeof notice.showModal === "function") notice.showModal(); else notice.setAttribute("open", "");
  $("noticeOk").focus();

  /* ---------- loading an app's files (once) ---------- */

  const scripts = new Map();   // script url -> promise (each file is loaded once)
  function loadScript(src) {
    if (!scripts.has(src)) {
      const p = new Promise((res, rej) => {
        const t = document.createElement("script");
        t.src = src;
        t.onload = res;
        t.onerror = () => { scripts.delete(src); rej(new Error("script failed to load")); };
        document.head.append(t);
      });
      scripts.set(src, p);
    }
    return scripts.get(src);
  }

  function loadApp(app) {
    if (!loading.has(app.id)) {
      const css = new Promise((res, rej) => {
        const l = document.createElement("link");
        l.rel = "stylesheet";
        l.href = `${app.base}app.css?v=${VERSION}`;
        l.onload = res;
        l.onerror = () => rej(new Error("style failed to load"));
        document.head.append(l);
      });
      const js = Promise.all((app.deps || []).map(d => loadScript(`${d}?v=${VERSION}`)))
        .then(() => loadScript(`${app.base}app.js?v=${VERSION}`));
      const html = fetch(`${app.base}app.html?v=${VERSION}`).then(r => {
        if (!r.ok) throw new Error(`page failed to load (${r.status})`);
        return r.text();
      });
      const p = Promise.all([html, css, js]).then(([h]) => { app.html = h; });
      loading.set(app.id, p.catch(e => { loading.delete(app.id); throw e; }));
    }
    return loading.get(app.id);
  }

  /* ---------- opening, focusing ---------- */

  async function openApp(id) {
    const app = ALL.find(a => a.id === id);
    if (!app) return;
    closeMenu();
    const existing = wins.get(id);
    if (existing) {
      if (existing.minimized) restore(existing); else focus(existing);
      return;
    }
    if (pending.has(id)) return;
    pending.add(id);
    try {
      if (app.kind !== "folder") await loadApp(app);
    } catch (e) {
      shell.alert(`Could not open ${app.title}. ${e.message}.`);
      return;
    } finally {
      pending.delete(id);
    }
    createWindow(app);
  }

  function geometry(app) {
    const r = ws.getBoundingClientRect();
    const n = wins.size;
    const size = app.size || { w: MAX_W, h: MAX_H };
    const bw = Math.min(size.w, r.width - 2 * EDGE);
    const bh = Math.min(size.h, r.height - 2 * EDGE);
    return {
      w: Math.max(320, bw - n * CASCADE),
      h: Math.max(240, bh - n * CASCADE),
      x: Math.max(EDGE, Math.round((r.width - bw) / 2)) + n * CASCADE,
      y: EDGE + n * CASCADE,
    };
  }

  function applyGeometry(win) {
    const s = win.el.style;
    s.left = win.x + "px";
    s.top = win.y + "px";
    s.width = win.w + "px";
    s.height = win.h + "px";
  }

  function el(tag, cls, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  }

  const SVG = {
    min: '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="8" width="7" height="2.5" fill="#FFFFFF"/></svg>',
    max: '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#FFFFFF"><rect x="1.5" y="1.5" width="9" height="9" stroke-width="1.2"/><path d="M1.5 2.8h9" stroke-width="2.4"/></svg>',
    restore: '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#FFFFFF"><rect x="1.5" y="3.5" width="7" height="7" stroke-width="1.2"/><path d="M3.5 3.5v-2h7v7h-2" stroke-width="1.2"/><path d="M1.5 4.6h7" stroke-width="2"/></svg>',
    close: '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>',
  };

  function capButton(cls, label, svg, onClick) {
    const b = el("button", "cap " + cls, { type: "button", "aria-label": label, title: label });
    b.innerHTML = svg;
    b.addEventListener("click", e => { e.stopPropagation(); onClick(); });
    return b;
  }

  // the inside of a folder window: an address bar, the apps as large icons, a status bar
  function buildFolderView(item, body) {
    const apps = appsIn(item.folder);
    const root = el("div", "fwin");

    const addr = el("div", "faddr");
    const label = el("span", "faddr-label");
    label.textContent = "Address";
    const field = el("div", "faddr-field");
    const fi = el("img", "", { src: item.icon, alt: "" });
    const ft = el("span");
    ft.textContent = item.title;
    field.append(fi, ft);
    addr.append(label, field);

    const view = el("div", "fview");
    apps.forEach(app => {
      const b = el("button", "ficon", { type: "button", title: app.title });
      const img = el("img", "", { src: app.icon, alt: "" });
      const name = el("span");
      name.textContent = app.title;
      b.append(img, name);
      b.addEventListener("click", () => {
        view.querySelectorAll(".ficon").forEach(i => i.classList.toggle("selected", i === b));
        openApp(app.id);
      });
      view.append(b);
    });

    const status = el("div", "statusbar");
    const cell = el("span", "cell msg");
    cell.textContent = `${apps.length} object${apps.length === 1 ? "" : "s"}`;
    status.append(cell);

    root.append(addr, view, status);
    body.append(root);
  }

  function createWindow(app) {
    const g = geometry(app);
    const win = { app, x: g.x, y: g.y, w: g.w, h: g.h, minimized: false, maximized: false, instance: null };

    const root = el("section", "window", { "aria-labelledby": `wt-${app.id}` });
    const bar = el("header", "titlebar");
    const icon = el("img", "wicon", { src: app.icon, alt: "" });
    const title = el("h1", "wtitle", { id: `wt-${app.id}` });
    title.textContent = app.title;
    const caps = el("div", "caps");
    win.maxBtn = capButton("max", "Maximize", SVG.max, () => toggleMax(win));
    caps.append(
      capButton("min", "Minimize", SVG.min, () => minimize(win)),
      win.maxBtn,
      capButton("close", "Close", SVG.close, () => closeWindow(win)),
    );
    bar.append(icon, title, caps);

    const body = el("div", "win-body");
    if (app.kind === "folder") buildFolderView(app, body);
    else body.innerHTML = app.html;
    root.append(bar, body);
    win.el = root;
    win.body = body;

    // taskbar button
    const btn = el("button", "task", { type: "button", title: app.title });
    const bi = el("img", "", { src: app.icon, alt: "" });
    const bt = el("span");
    bt.textContent = app.title;
    btn.append(bi, bt);
    btn.addEventListener("click", () => {
      if (win.minimized) restore(win);
      else if (current === win) minimize(win);
      else focus(win);
    });
    win.btn = btn;
    tasksEl.append(btn);

    applyGeometry(win);
    ws.append(root);
    wins.set(app.id, win);

    root.addEventListener("pointerdown", () => focus(win), true);
    bar.addEventListener("dblclick", e => { if (!e.target.closest("button")) toggleMax(win); });
    enableDrag(win, bar);

    const mod = app.kind === "folder" ? null : window.DesktopApps[app.id];
    try {
      win.instance = mod && mod.init ? mod.init(body, shell) : null;
    } catch (e) {
      console.error(e);
      closeWindow(win);
      shell.alert(`${app.title} failed to start.`);
      return;
    }

    focus(win);
    animate(win, "open");
  }

  function focus(win) {
    current = win;
    win.el.style.zIndex = String(++zTop);
    refresh();
  }

  function refresh() {
    wins.forEach(w => {
      const active = w === current && !w.minimized;
      w.el.classList.toggle("active", active);
      w.btn.classList.toggle("active", active);
      w.btn.setAttribute("aria-pressed", String(active));
    });
  }

  function topVisible() {
    let best = null;
    wins.forEach(w => {
      if (!w.minimized && (!best || +w.el.style.zIndex > +best.el.style.zIndex)) best = w;
    });
    return best;
  }

  /* ---------- minimize, maximize, close ---------- */

  function animate(win, kind) {
    if (reduceMQ.matches || !win.el.animate) return Promise.resolve();
    const r = win.el.getBoundingClientRect();
    const t = win.btn.getBoundingClientRect();
    const dx = t.left + t.width / 2 - (r.left + r.width / 2);
    const dy = t.top + t.height / 2 - (r.top + r.height / 2);
    const toTask = `translate(${dx}px, ${dy}px) scale(.08)`;
    let frames, opts = { duration: 200, easing: "ease-in-out" };
    if (kind === "minimize") frames = [{ transform: "none", opacity: 1 }, { transform: toTask, opacity: 0 }];
    else if (kind === "restore") frames = [{ transform: toTask, opacity: 0 }, { transform: "none", opacity: 1 }];
    else { frames = [{ transform: "scale(.96)", opacity: 0 }, { transform: "none", opacity: 1 }]; opts = { duration: 140, easing: "ease-out" }; }
    try { return win.el.animate(frames, opts).finished.catch(() => {}); } catch { return Promise.resolve(); }
  }

  function minimize(win) {
    if (win.minimized) return;
    win.minimized = true;
    if (current === win) current = topVisible();
    refresh();
    animate(win, "minimize").then(() => { if (win.minimized) win.el.hidden = true; });
  }

  function restore(win) {
    win.minimized = false;
    win.el.hidden = false;
    focus(win);
    animate(win, "restore");
  }

  function toggleMax(win) {
    win.maximized = !win.maximized;
    win.el.classList.toggle("maximized", win.maximized);
    const label = win.maximized ? "Restore" : "Maximize";
    win.maxBtn.innerHTML = win.maximized ? SVG.restore : SVG.max;
    win.maxBtn.setAttribute("aria-label", label);
    win.maxBtn.title = label;
    focus(win);
  }

  function closeWindow(win) {
    try { win.instance && win.instance.destroy && win.instance.destroy(); } catch (e) { console.error(e); }
    win.el.remove();
    win.btn.remove();
    wins.delete(win.app.id);
    if (current === win) current = topVisible();
    refresh();
  }

  /* ---------- dragging ---------- */

  function enableDrag(win, bar) {
    let drag = null;
    bar.addEventListener("pointerdown", e => {
      if (e.button !== 0 || e.target.closest("button") || win.maximized || mobileMQ.matches) return;
      drag = { px: e.clientX, py: e.clientY, x: win.x, y: win.y };
      bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener("pointermove", e => {
      if (!drag) return;
      const r = ws.getBoundingClientRect();
      win.x = Math.min(Math.max(drag.x + e.clientX - drag.px, 120 - win.w), r.width - 120);
      win.y = Math.min(Math.max(drag.y + e.clientY - drag.py, 0), r.height - 34);
      applyGeometry(win);
    });
    const end = () => { drag = null; };
    bar.addEventListener("pointerup", end);
    bar.addEventListener("pointercancel", end);
  }

  window.addEventListener("resize", () => {
    const r = ws.getBoundingClientRect();
    wins.forEach(w => {
      w.w = Math.min(w.w, Math.max(320, r.width - 8));
      w.h = Math.min(w.h, Math.max(240, r.height - 8));
      w.x = Math.min(Math.max(w.x, 120 - w.w), r.width - 120);
      w.y = Math.min(Math.max(w.y, 0), Math.max(0, r.height - 34));
      applyGeometry(w);
    });
  });

  /* ---------- desktop icons ---------- */

  const iconsEl = $("icons");
  FOLDER_ITEMS.concat(APPS.filter(a => !a.folder)).forEach(app => {
    const b = el("button", "icon", { type: "button", title: app.title });
    const img = el("img", "", { src: app.icon, alt: "" });
    const label = el("span");
    label.textContent = app.title;
    b.append(img, label);
    b.addEventListener("click", e => {
      e.stopPropagation();
      iconsEl.querySelectorAll(".icon").forEach(i => i.classList.toggle("selected", i === b));
      openApp(app.id);
    });
    iconsEl.append(b);
  });
  ws.addEventListener("pointerdown", e => {
    if (e.target === ws || e.target === iconsEl) {
      iconsEl.querySelectorAll(".icon").forEach(i => i.classList.remove("selected"));
      closeMenu();
    }
  });

  /* ---------- Tools menu ---------- */

  const list = $("menuList");
  function menuItem(app) {
    const li = el("li");
    const b = el("button", "", { type: "button" });
    const img = el("img", "", { src: app.icon, alt: "" });
    const s = el("span");
    s.textContent = app.title;
    b.append(img, s);
    b.addEventListener("click", () => openApp(app.id));
    li.append(b);
    return li;
  }

  FOLDER_ITEMS.forEach(item => {
    const li = el("li", "hasSub");
    const row = el("button", "folderrow", { type: "button", "aria-haspopup": "true", "aria-expanded": "false" });
    const img = el("img", "", { src: item.icon, alt: "" });
    const s = el("span");
    s.textContent = item.title;
    const arrow = el("span", "arrow", { "aria-hidden": "true" });
    row.append(img, s, arrow);
    const sub = el("ul", "submenu");
    appsIn(item.folder).forEach(app => sub.append(menuItem(app)));
    const setOpen = open => {
      if (open) { // one folder at a time, so the menu never grows taller than the screen
        list.querySelectorAll(".hasSub.open").forEach(o => { if (o !== li) { o.classList.remove("open"); o.querySelector(".folderrow").setAttribute("aria-expanded", "false"); } });
      }
      li.classList.toggle("open", open);
      row.setAttribute("aria-expanded", String(open));
      if (open && window.matchMedia("(max-width: 699px)").matches) { // phone: the list scrolls; bring the opened folder to the top of it
        list.scrollTop += li.getBoundingClientRect().top - list.getBoundingClientRect().top;
      }
    };
    row.addEventListener("click", () => setOpen(!li.classList.contains("open")));
    row.addEventListener("keydown", e => {
      if (e.key === "ArrowRight") { e.preventDefault(); setOpen(true); const f = sub.querySelector("button"); if (f) f.focus(); }
    });
    sub.addEventListener("keydown", e => {
      if (e.key === "ArrowLeft") { e.preventDefault(); setOpen(false); row.focus(); }
    });
    li.append(row, sub);
    list.append(li);
  });
  APPS.filter(a => !a.folder).forEach(app => list.append(menuItem(app)));

  function closeMenu() {
    menu.hidden = true;
    startBtn.setAttribute("aria-expanded", "false");
    list.querySelectorAll(".hasSub.open").forEach(li => {
      li.classList.remove("open");
      li.querySelector(".folderrow").setAttribute("aria-expanded", "false");
    });
  }
  startBtn.addEventListener("click", e => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    startBtn.setAttribute("aria-expanded", String(open));
    if (open) list.querySelector("button").focus();
  });
  document.addEventListener("pointerdown", e => {
    if (!menu.hidden && !menu.contains(e.target) && !startBtn.contains(e.target)) closeMenu();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !menu.hidden) { closeMenu(); startBtn.focus(); }
  });

  /* ---------- clock and deep link ---------- */

  function tick() {
    $("clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  tick();
  setInterval(tick, 15000);

  const hash = location.hash.slice(1);
  const target = ALL.find(a => a.id === hash || a.id === "folder-" + hash);
  if (target) openApp(target.id);
})();
