/* Browser capability report: turns the facts the page read from the browser (all local; nothing is requested from a server) into a readable
   report and a verdict on whether Michel's Tools will work. Pure; exports window.BrowserCaps. The data object d is described in apps/browsercaps/app.js. */
(() => {
  "use strict";
  // [id, label, group, what it is for / what happens without it]
  const FEATURES = [
    ["worker", "Web Workers", "needed", "Run heavy work in the background. The PDF tools need it."],
    ["blob", "Files and downloads (Blob, object URLs)", "needed", "Needed to save results as files."],
    ["fileapi", "File API (open a file from the computer)", "needed", "Needed to open PDFs, certificates and pictures."],
    ["canvas", "Canvas drawing", "needed", "Needed to show PDF pages and draw graphs."],
    ["bigint", "BigInt", "needed", "Needed by the IPv6 and certificate tools."],
    ["textdecoder", "Text encoding (TextEncoder / TextDecoder)", "needed", "Needed to read pasted and downloaded text."],
    ["modules", "Modern JavaScript (ES modules)", "needed", "PDF pages are drawn by an ES module."],
    ["fetchstream", "Streaming downloads (fetch with a readable body)", "needed", "Used by the Idle-timeout finder's heartbeat test."],
    ["subtle", "Web Crypto (crypto.subtle)", "optional", "Fast encryption and signature checks. Only on https or localhost; Verify Signatures uses a built-in slower fallback without it."],
    ["wasm", "WebAssembly", "other", "Compiled code in the browser; used by many modern web apps."],
    ["webgl2", "WebGL 2", "other", "3D graphics."],
    ["webgl", "WebGL", "other", "3D graphics (older version)."],
    ["webgpu", "WebGPU", "other", "Newer graphics and computing interface."],
    ["webrtc", "WebRTC", "other", "Video calls and peer-to-peer connections."],
    ["websocket", "WebSocket", "other", "Live two-way connections."],
    ["webtransport", "WebTransport", "other", "Live connections over HTTP/3."],
    ["sw", "Service workers", "other", "Offline pages and background work (needs https)."],
    ["sab", "SharedArrayBuffer (cross-origin isolated)", "other", "Fast threads; needs special server headers."],
    ["offscreen", "OffscreenCanvas", "other", "Drawing from a background worker."],
    ["clipboard", "Clipboard API", "other", "Copy buttons. Without it a fallback is used."],
    ["filepicker", "File System Access (save and open dialogs)", "other", "Direct save dialogs; the normal download works without it."],
    ["share", "Web Share", "other", "The system share sheet."],
    ["notifications", "Notifications", "other", "Desktop alerts."],
    ["compression", "CompressionStream", "other", "Built-in zip-style compression."],
    ["intl", "Intl (language and region formatting)", "other", "Names of regions, dates, numbers."],
    ["pdfviewer", "Built-in PDF viewer", "other", "Whether the browser can show PDFs itself."],
    ["mediarecorder", "Recording (MediaRecorder)", "other", "Audio and video capture."],
    ["geolocation", "Geolocation", "other", "Location, with the user's permission."],
    ["bluetooth", "Web Bluetooth", "other", "Talk to Bluetooth devices."],
    ["usb", "WebUSB", "other", "Talk to USB devices."],
    ["serial", "Web Serial", "other", "Talk to serial devices."],
  ];
  const secs = ms => ms < 1024 ? ms + " B" : ms < 1048576 ? (ms / 1024).toFixed(0) + " KB" : ms < 1073741824 ? (ms / 1048576).toFixed(0) + " MB" : (ms / 1073741824).toFixed(1).replace(/\.0$/, "") + " GB";
  const yes = v => v === true ? "yes" : v === false ? "no" : "unknown";
  const protoName = p => ({ "h2": "HTTP/2", "h3": "HTTP/3 (QUIC)", "http/1.1": "HTTP/1.1", "http/1.0": "HTTP/1.0" })[p] || p || "unknown";
  const PERM = { granted: "allowed", denied: "blocked", prompt: "will ask", unknown: "not reported" };

  // best-effort name of the browser from the user-agent string (only for the headline)
  function browserName(ua, brands) {
    const s = String(ua || "");
    const b = (brands || []).map(x => x.brand).filter(x => !/Not.?A.?Brand|Chromium/i.test(x));
    const m = /(Edg|OPR|Firefox|FxiOS|CriOS|Chrome|Safari)\/(\d+(?:\.\d+)*)/.exec(s);
    const names = { Edg: "Microsoft Edge", OPR: "Opera", Firefox: "Firefox", FxiOS: "Firefox", CriOS: "Chrome", Chrome: "Chrome", Safari: "Safari" };
    if (/Edg\//.test(s)) { const e = /Edg\/(\d+(?:\.\d+)*)/.exec(s); return "Microsoft Edge " + e[1]; }
    if (/OPR\//.test(s)) { const e = /OPR\/(\d+(?:\.\d+)*)/.exec(s); return "Opera " + e[1]; }
    if (/(Firefox|FxiOS)\//.test(s)) { const e = /(?:Firefox|FxiOS)\/(\d+(?:\.\d+)*)/.exec(s); return "Firefox " + e[1]; }
    if (/Chrome\/|CriOS\//.test(s)) { const e = /(?:Chrome|CriOS)\/(\d+(?:\.\d+)*)/.exec(s); return (b[0] || "Chrome") + " " + e[1]; }
    if (/Safari\//.test(s) && /Version\/(\d+(?:\.\d+)*)/.test(s)) return "Safari " + /Version\/(\d+(?:\.\d+)*)/.exec(s)[1];
    return m ? names[m[1]] + " " + m[2] : "unknown browser";
  }
  function osName(d) {
    const ua = String(d.ua || ""), p = d.uaData && d.uaData.platform ? d.uaData.platform : "";
    if (p) return p + (d.uaData.platformVersion ? " " + d.uaData.platformVersion : "");
    if (/Windows NT 10/.test(ua)) return "Windows 10 or 11";
    if (/Windows NT/.test(ua)) return "Windows";
    if (/Android (\d+(?:\.\d+)*)/.test(ua)) return "Android " + /Android (\d+(?:\.\d+)*)/.exec(ua)[1];
    if (/(iPhone|iPad)/.test(ua)) return "iOS or iPadOS";
    if (/Mac OS X/.test(ua)) return "macOS";
    if (/CrOS/.test(ua)) return "ChromeOS";
    if (/Linux/.test(ua)) return "Linux";
    return "unknown system";
  }

  function buildModel(d) {
    d = d || {};
    const f = d.feat || {}, notes = [], sections = [];
    const missingNeeded = FEATURES.filter(x => x[2] === "needed" && f[x[0]] === false);
    const overview = [
      ["Browser", browserName(d.ua, d.uaData && d.uaData.brands)], ["System", osName(d)],
      ["Device type", d.uaData && d.uaData.mobile != null ? (d.uaData.mobile ? "phone or tablet" : "computer") : (d.touchPoints > 0 && d.screenW && d.screenW < 900 ? "probably a phone or tablet" : "computer or unknown")],
    ];
    if (d.uaData && d.uaData.architecture) overview.push(["Processor type", d.uaData.architecture + (d.uaData.bitness ? ", " + d.uaData.bitness + " bit" : "")]);
    if (d.uaData && d.uaData.model) overview.push(["Device model", d.uaData.model]);
    if (d.cores) overview.push(["Processor threads", String(d.cores)]);
    if (d.memoryGb) overview.push(["Memory (rounded by the browser)", "about " + d.memoryGb + " GB or more"]);
    if (d.heapLimit) overview.push(["Memory the browser lets one page use", secs(d.heapLimit)]);
    overview.push(["Language", (d.langs && d.langs.length ? d.langs.join(", ") : "unknown")], ["Time zone", d.tz || "unknown"], ["Cookies", d.cookies === false ? "blocked" : d.cookies ? "allowed" : "unknown"], ["Online", d.online === false ? "no (the browser says it is offline)" : "yes"]);
    sections.push({ title: "This browser and device", rows: overview });

    const screenRows = [["Screen", d.screenW ? d.screenW + " x " + d.screenH + " pixels" + (d.dpr ? ", pixel ratio " + d.dpr : "") : "unknown"], ["Window", d.innerW ? d.innerW + " x " + d.innerH + " pixels" : "unknown"]];
    if (d.colorDepth) screenRows.push(["Colour depth", d.colorDepth + " bit"]);
    screenRows.push(["Touch screen", d.touchPoints > 0 ? "yes (" + d.touchPoints + " touch points)" : "no"], ["Pointer", d.pointer || "unknown", d.hover === false ? "No hover: menus that open on hover need a tap." : ""]);
    const prefs = []; if (d.dark) prefs.push("dark mode"); if (d.reduceMotion) prefs.push("reduced motion"); if (d.highContrast) prefs.push("high contrast"); if (d.reduceData) prefs.push("data saver");
    screenRows.push(["Display preferences", prefs.length ? prefs.join(", ") : "none set"]);
    sections.push({ title: "Screen and input", rows: screenRows });

    const net = [["This page was loaded over", protoName(d.proto), d.proto === "http/1.1" ? "HTTP/1.1 allows only 6 connections to a site at a time." : ""], ["Secure context (https or localhost)", yes(d.secure), d.secure ? "" : "Some features (Web Crypto, service workers, clipboard in some browsers) need https."]];
    if (d.page) net.push(["Page address scheme", d.page]);
    sections.push({ title: "Connection of this page", rows: net });

    const needed = FEATURES.filter(x => x[2] === "needed").map(x => [x[1], f[x[0]] === undefined ? "not checked" : f[x[0]] ? "available" : "MISSING", x[3]]);
    needed.push(...FEATURES.filter(x => x[2] === "optional").map(x => [x[1], f[x[0]] === undefined ? "not checked" : f[x[0]] ? "available" : "not available", x[3]]));
    sections.push({ title: "What Michel's Tools needs", rows: needed });

    const other = FEATURES.filter(x => x[2] === "other").map(x => [x[1], f[x[0]] === undefined ? "not checked" : f[x[0]] ? "available" : "not available", x[3]]);
    if (d.webgl && d.webgl.renderer) other.splice(other.findIndex(r => /^WebGL 2/.test(r[0])) + 1, 0, ["Graphics (as the browser reports it)", d.webgl.renderer, d.webgl.software ? "A software renderer: graphics are drawn by the processor, which is slow." : ""]);
    sections.push({ title: "Other browser abilities", rows: other });

    const st = [["Local storage", yes(d.localStorage)], ["Session storage", yes(d.sessionStorage)], ["IndexedDB", yes(d.indexedDB)]];
    if (d.quota) st.push(["Storage allowed for this site", secs(d.quota) + (d.usage != null ? ", " + secs(d.usage) + " used" : "")]);
    if (d.persisted != null) st.push(["Storage kept when space runs low", d.persisted ? "yes" : "no (the browser may clear it)"]);
    sections.push({ title: "Storage", rows: st });

    if (d.media && Object.keys(d.media).length) {
      const names = { h264: "Video: H.264", vp9: "Video: VP9", av1: "Video: AV1", hevc: "Video: H.265 / HEVC", aac: "Audio: AAC", opus: "Audio: Opus", mp3: "Audio: MP3", flac: "Audio: FLAC" };
      sections.push({ title: "Audio and video it can play", rows: Object.keys(names).filter(k => d.media[k] !== undefined).map(k => [names[k], d.media[k] === "" ? "no" : d.media[k] === "probably" ? "yes" : "maybe"]) });
    }
    if (d.perms && Object.keys(d.perms).length) sections.push({ title: "Permissions this site has", rows: Object.entries(d.perms).map(([k, v]) => [{ geolocation: "Location", notifications: "Notifications", camera: "Camera", microphone: "Microphone", clipboardRead: "Reading the clipboard", persistentStorage: "Persistent storage" }[k] || k, PERM[v] || v]) });

    /* verdict */
    let summary, level;
    if (missingNeeded.length) { summary = "This browser is missing " + missingNeeded.length + " feature" + (missingNeeded.length > 1 ? "s" : "") + " that Michel's Tools needs."; level = "bad"; notes.push({ level: "bad", text: "Missing: " + missingNeeded.map(x => x[1]).join("; ") + ". Update the browser, or use a current Chrome, Edge, Firefox or Safari." }); }
    else { summary = browserName(d.ua, d.uaData && d.uaData.brands) + " on " + osName(d) + ": everything Michel's Tools needs is available."; level = "good"; }
    if (f.subtle === false && !missingNeeded.length) notes.push({ level: "", text: "Web Crypto is not available" + (d.secure === false ? " because this page is not on https" : "") + ". Everything still works: Verify Signatures and the Certificate Decoder use a built-in, slower replacement." });
    if (d.secure === false) notes.push({ level: "warn", text: "This page is not in a secure context (plain http). Browsers withhold some features there; use the https address if there is one." });
    if (d.proto === "http/1.1") notes.push({ level: "", text: "The page was loaded over HTTP/1.1. A CDN or proxy that speaks HTTP/2 or HTTP/3 would make busy pages faster." });
    if (d.cookies === false) notes.push({ level: "warn", text: "Cookies are blocked. This site does not need them, but many sites will not work." });
    if (d.localStorage === false || d.indexedDB === false) notes.push({ level: "warn", text: "Browser storage is blocked or unavailable (private mode or strict privacy settings). Saved preferences will not stick." });
    if (d.webgl && d.webgl.software) notes.push({ level: "warn", text: "Graphics are rendered in software. Heavy pages will feel slow; check the graphics driver or hardware acceleration setting." });
    if (d.reduceData) notes.push({ level: "", text: "Data saver is on: some sites send smaller, lower-quality content." });
    if (d.heapLimit && d.heapLimit < 600 * 1048576 && d.cores) notes.push({ level: "", text: "This browser lets a page use only about " + secs(d.heapLimit) + " of memory. Very large PDFs may fail to open." });
    if (d.memoryGb && d.memoryGb <= 2) notes.push({ level: "warn", text: "A device with about " + d.memoryGb + " GB of memory or less: very large PDFs may be slow or fail." });
    if (d.mobile) notes.push({ level: "", text: "On a phone the PDF tools work, but a computer is more comfortable for big files." });
    return { summary, level, notes, sections, missing: missingNeeded.map(x => x[0]) };
  }
  function toText(m, ctx) {
    const out = ["Browser capability report (Michel's Tools)", ctx && ctx.when ? "Taken " + ctx.when : "", "", m.summary, ""];
    for (const n of m.notes) out.push("* " + n.text);
    for (const s of m.sections) { out.push("", s.title); for (const [k, v] of s.rows) out.push("  " + k + ": " + v); }
    out.push("", "Read in the browser itself; nothing was sent to the server.");
    return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
  }
  const api = { FEATURES, buildModel, toText, browserName, osName, protoName };
  if (typeof window !== "undefined") window.BrowserCaps = api;
  if (typeof module !== "undefined") module.exports = api;
})();
