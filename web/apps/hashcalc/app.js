/* Hash & Checksum Calculator. The algorithms are in lib/hashcalc.js. Text and files are hashed in the browser and never sent anywhere. */
(window.DesktopApps = window.DesktopApps || {}).hashcalc = (() => {
  function init(root) {
    const $ = id => root.querySelector("#hashcalc-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const H = window.HashCalc, E = window.EncodeTool, TK = window.TK;
    let fileBytes = null, fileName = "", computed = {}, token = 0;
    const MAXFILE = 200 * 1024 * 1024;
    const src = () => (root.querySelector('input[name="hashcalc-src"]:checked') || {}).value;
    const algs = () => [...root.querySelectorAll(".hashcalc-alg")].filter(c => c.checked).map(c => c.value);
    const bytes = () => src() === "file" ? fileBytes : E.toBytes($("in").value);
    async function run() {
      const my = ++token, b = bytes(); computed = {}; $("verdict").textContent = ""; TK.notes($("notes"), []);
      if (!b || (src() === "text" && !$("in").value)) { $("out").textContent = ""; $("hout").textContent = ""; setStatus(src() === "file" ? "Choose a file." : "Ready"); return; }
      const names = algs(); if (!names.length) { $("out").textContent = ""; TK.notes($("notes"), [{ level: "warn", text: "Tick at least one algorithm." }]); return; }
      setStatus("Working…");
      const t0 = Date.now();
      try {
        const r = await H.hashAll(b, names, async n => { setStatus("Working on " + n + "…"); await new Promise(res => setTimeout(res, 0)); });
        if (my !== token) return;
        const up = $("upper").checked; computed = r;
        const rows = names.map(n => { const info = H.ALGOS.find(a => a.id === n); return [n, up ? r[n].toUpperCase() : r[n], info && info.weak ? "Not safe for security: " + info.weak : (info && info.check ? "A checksum: finds accidental damage, not tampering" : undefined)]; });
        TK.render($("out"), [{ title: (src() === "file" ? fileName + " (" : "Text (") + b.length.toLocaleString("en-US") + " bytes)", rows, mono: true }], { copy: true, status: setStatus });
        verdict(); hmac();
        setStatus("Done in " + (Date.now() - t0) + " ms.");
      } catch (e) { if (my === token) { TK.notes($("notes"), [{ level: "bad", text: "Not possible: " + e.message }]); setStatus("Failed."); } }
    }
    function verdict() {
      const v = $("verdict"), c = H.compare($("expect").value, computed); v.textContent = ""; v.className = "tk-summary";
      if (c.empty || !Object.keys(computed).length) return;
      if (c.invalid) { v.textContent = "That does not look like a hash (it should be hexadecimal digits or Base64)."; return; }
      if (c.match) { v.textContent = "Match: it is the " + c.match + " of this " + (src() === "file" ? "file" : "text") + "."; return; }
      v.textContent = "No match. " + (c.guess ? "It looks like a " + c.guess + " hash (" + c.length + " characters)" + (c.said ? ", and you wrote " + c.said : "") + (Object.keys(computed).includes(c.guess.split(" ")[0]) ? ", but it differs from the one calculated here" : ", which is not ticked above: tick that algorithm") + "." : "Its length (" + c.length + " characters) does not fit any algorithm here.") + (c.close ? " It differs from the " + c.close[0] + " in only one or two characters: check for a typing error." : "");
    }
    function hmac() {
      const o = $("hout"); o.textContent = ""; const key = $("hkey").value, b = bytes(); if (!key || !b) return;
      if (src() === "file" && b.length > 20 * 1024 * 1024) { o.textContent = "HMAC is limited to 20 MB."; return; }
      try { const alg = $("halg").value, h = H.hex(H.hmac(alg, E.toBytes(key), b)); TK.render(o, [{ title: "HMAC-" + alg, rows: [["HMAC-" + alg, $("upper").checked ? h.toUpperCase() : h]], mono: true }], { copy: true, status: setStatus }); } catch (e) { o.textContent = e.message; }
    }
    root.querySelectorAll('input[name="hashcalc-src"]').forEach(r => r.addEventListener("change", () => { $("textbox").hidden = src() !== "text"; $("filebox").hidden = src() !== "file"; run(); }));
    $("in").addEventListener("input", TK.debounce(run, 250));
    root.querySelectorAll(".hashcalc-alg").forEach(c => c.addEventListener("change", run));
    $("upper").addEventListener("change", run);
    $("expect").addEventListener("input", TK.debounce(verdict, 150));
    $("hkey").addEventListener("input", TK.debounce(hmac, 250)); $("halg").addEventListener("change", hmac);
    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", async () => {
      const f = $("file").files[0]; $("file").value = ""; if (!f) return;
      if (f.size > MAXFILE) { TK.notes($("notes"), [{ level: "bad", text: f.name + " is larger than 200 MB." }]); return; }
      setStatus("Reading " + f.name + "…"); try { fileBytes = new Uint8Array(await f.arrayBuffer()); } catch { TK.notes($("notes"), [{ level: "bad", text: "The file could not be read (it may be too large for this device's memory)." }]); return; }
      fileName = f.name; $("fileinfo").textContent = f.name + " (" + f.size.toLocaleString("en-US") + " bytes)"; run();
    });
    return { destroy() { token++; } };
  }
  return { init };
})();
