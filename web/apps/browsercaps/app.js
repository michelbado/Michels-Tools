/* Browser capability report. Everything is read from the browser's own objects; no request leaves the page.
   The data object d handed to lib/browsercaps.js: ua, uaData{brands,mobile,platform,platformVersion,architecture,bitness,model}, langs, tz, cookies, online, cores,
   memoryGb, heapLimit, touchPoints, secure, page, proto, screenW/H, innerW/H, dpr, colorDepth, pointer, hover, dark, reduceMotion, highContrast, reduceData,
   feat{id:bool}, webgl{renderer,software}, localStorage, sessionStorage, indexedDB, quota, usage, persisted, media{id:"probably"|"maybe"|""}, perms{name:state}. */
(window.DesktopApps = window.DesktopApps || {}).browsercaps = (() => {
  const t = f => { try { return f(); } catch { return undefined; } };
  const bool = f => { const v = t(f); return v === undefined ? false : !!v; };

  async function collect() {
    const n = navigator, d = {};
    d.ua = n.userAgent || ""; d.langs = Array.from(n.languages || (n.language ? [n.language] : [])); d.tz = t(() => Intl.DateTimeFormat().resolvedOptions().timeZone) || "";
    d.cookies = n.cookieEnabled; d.online = n.onLine; d.cores = n.hardwareConcurrency || 0; d.memoryGb = n.deviceMemory || 0; d.touchPoints = n.maxTouchPoints || 0;
    d.secure = !!window.isSecureContext; d.page = location.protocol;
    const nav = t(() => performance.getEntriesByType("navigation")[0]); d.proto = nav && nav.nextHopProtocol ? nav.nextHopProtocol : "";
    d.screenW = screen.width; d.screenH = screen.height; d.innerW = innerWidth; d.innerH = innerHeight; d.dpr = Math.round((devicePixelRatio || 1) * 100) / 100; d.colorDepth = screen.colorDepth;
    const mq = q => bool(() => matchMedia(q).matches);
    d.dark = mq("(prefers-color-scheme: dark)"); d.reduceMotion = mq("(prefers-reduced-motion: reduce)"); d.highContrast = mq("(prefers-contrast: more)") || mq("(forced-colors: active)"); d.reduceData = mq("(prefers-reduced-data: reduce)") || !!(n.connection && n.connection.saveData);
    d.pointer = mq("(pointer: fine)") ? "mouse or trackpad" : mq("(pointer: coarse)") ? "finger (touch)" : "none"; d.hover = mq("(hover: hover)");
    const mem = t(() => performance.memory); if (mem && mem.jsHeapSizeLimit) d.heapLimit = mem.jsHeapSizeLimit;
    d.mobile = !!(n.userAgentData && n.userAgentData.mobile);

    // features
    const cv = t(() => document.createElement("canvas"));
    const gl2 = t(() => cv && cv.getContext("webgl2")), gl1 = gl2 || t(() => document.createElement("canvas").getContext("webgl") || document.createElement("canvas").getContext("experimental-webgl"));
    d.feat = {
      worker: typeof Worker === "function", blob: typeof Blob === "function" && bool(() => typeof URL.createObjectURL === "function"), fileapi: typeof FileReader === "function" && typeof File === "function",
      canvas: bool(() => document.createElement("canvas").getContext("2d")), bigint: typeof BigInt === "function", textdecoder: typeof TextDecoder === "function" && typeof TextEncoder === "function",
      modules: bool(() => "noModule" in document.createElement("script")), fetchstream: typeof ReadableStream === "function" && typeof Response === "function" && bool(() => "body" in Response.prototype),
      subtle: bool(() => crypto.subtle), wasm: typeof WebAssembly === "object", webgl2: !!gl2, webgl: !!gl1, webgpu: bool(() => n.gpu), webrtc: typeof RTCPeerConnection === "function",
      websocket: typeof WebSocket === "function", webtransport: typeof WebTransport === "function", sw: bool(() => "serviceWorker" in n), sab: typeof SharedArrayBuffer === "function" && !!window.crossOriginIsolated,
      offscreen: typeof OffscreenCanvas === "function", clipboard: bool(() => n.clipboard && n.clipboard.writeText), filepicker: typeof window.showSaveFilePicker === "function", share: typeof n.share === "function",
      notifications: "Notification" in window, compression: typeof CompressionStream === "function", intl: typeof Intl === "object" && typeof Intl.DisplayNames === "function",
      mediarecorder: typeof MediaRecorder === "function", geolocation: "geolocation" in n, bluetooth: "bluetooth" in n, usb: "usb" in n, serial: "serial" in n,
    };
    if (typeof n.pdfViewerEnabled === "boolean") d.feat.pdfviewer = n.pdfViewerEnabled;
    const gl = gl2 || gl1;
    if (gl) {
      const ext = t(() => gl.getExtension("WEBGL_debug_renderer_info")), r = String((ext ? t(() => gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : t(() => gl.getParameter(gl.RENDERER))) || "");
      if (r) d.webgl = { renderer: r.slice(0, 120), software: /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(r) };
      t(() => { const x = gl.getExtension("WEBGL_lose_context"); if (x) x.loseContext(); });
    }

    // storage
    const works = f => { try { f(); return true; } catch { return false; } };
    d.localStorage = works(() => { localStorage.setItem("__caps", "1"); localStorage.removeItem("__caps"); });
    d.sessionStorage = works(() => { sessionStorage.setItem("__caps", "1"); sessionStorage.removeItem("__caps"); });
    d.indexedDB = typeof indexedDB === "object" && indexedDB !== null;

    // media
    const v = t(() => document.createElement("video")), a = t(() => document.createElement("audio"));
    if (v && a) d.media = {
      h264: v.canPlayType('video/mp4; codecs="avc1.42E01E"'), vp9: v.canPlayType('video/webm; codecs="vp9"'), av1: v.canPlayType('video/mp4; codecs="av01.0.05M.08"'), hevc: v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"'),
      aac: a.canPlayType('audio/mp4; codecs="mp4a.40.2"'), opus: a.canPlayType('audio/webm; codecs="opus"'), mp3: a.canPlayType("audio/mpeg"), flac: a.canPlayType("audio/flac"),
    };

    // things that need a moment
    const jobs = [];
    if (n.userAgentData) {
      d.uaData = { brands: Array.from(n.userAgentData.brands || []), mobile: n.userAgentData.mobile, platform: n.userAgentData.platform || "" };
      jobs.push(Promise.resolve(t(() => n.userAgentData.getHighEntropyValues(["platformVersion", "architecture", "bitness", "model"]))).then(h => { if (h) Object.assign(d.uaData, { platformVersion: h.platformVersion || "", architecture: h.architecture || "", bitness: h.bitness || "", model: h.model || "" }); }).catch(() => {}));
    }
    if (n.storage && n.storage.estimate) jobs.push(n.storage.estimate().then(e => { d.quota = e.quota; d.usage = e.usage; }).catch(() => {}));
    if (n.storage && n.storage.persisted) jobs.push(n.storage.persisted().then(p => { d.persisted = p; }).catch(() => {}));
    if (n.permissions && n.permissions.query) {
      d.perms = {};
      for (const [name, key] of [["geolocation", "geolocation"], ["notifications", "notifications"], ["camera", "camera"], ["microphone", "microphone"], ["clipboard-read", "clipboardRead"], ["persistent-storage", "persistentStorage"]]) jobs.push(n.permissions.query({ name }).then(s => { d.perms[key] = s.state; }).catch(() => {}));
    }
    await Promise.all(jobs);
    if (d.perms) { const o = {}; for (const k of ["geolocation", "notifications", "camera", "microphone", "clipboardRead", "persistentStorage"]) if (d.perms[k]) o[k] = d.perms[k]; d.perms = o; }
    return d;
  }

  function init(root) {
    const $ = id => root.querySelector("#browsercaps-" + id);
    const BC = window.BrowserCaps, TK = window.TK;
    const setStatus = m => { $("status").textContent = m; };
    let text = "", gone = false, busy = false;
    async function run() {
      if (busy) return; busy = true;
      $("again").disabled = true; $("copy").disabled = $("save").disabled = true; $("summary").textContent = "Checking...";
      try {
        const d = await collect();
        if (gone) return;
        const m = BC.buildModel(d);
        $("summary").textContent = m.summary;
        TK.notes($("notes"), m.notes);
        TK.render($("sections"), m.sections);
        text = BC.toText(m, { when: new Date().toLocaleString() });
        $("copy").disabled = $("save").disabled = false;
        setStatus("Done.");
      } catch (e) { $("summary").textContent = "The check could not finish."; setStatus("Error: " + (e && e.message ? e.message : "unknown")); }
      finally { busy = false; $("again").disabled = false; }
    }
    $("again").addEventListener("click", run);
    $("copy").addEventListener("click", () => TK.copy(text, setStatus));
    $("save").addEventListener("click", () => TK.save("browser-report.txt", text));
    run();
    return { destroy() { gone = true; } };
  }
  return { init };
})();
