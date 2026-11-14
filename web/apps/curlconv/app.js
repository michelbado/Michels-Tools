/* curl Converter. The reading and writing of code is in lib/curlconv.js; this file only shows it. Everything reaches the page through textContent. Nothing is run or sent. */
(window.DesktopApps = window.DesktopApps || {}).curlconv = (() => {
  const EXAMPLES = [
    ["POST with JSON", "curl -X POST 'https://api.example.com/v1/items' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: Bearer YOUR_TOKEN' \\\n  -d '{\"name\":\"test\",\"count\":3}'"],
    ["Form upload", "curl -F 'title=Report' -F 'file=@report.pdf;type=application/pdf' https://example.com/upload"],
    ["Basic login, follow redirects", "curl -u alice:secret -L --max-time 20 https://example.com/private"],
    ["GET with a query", "curl -G https://example.com/search --data-urlencode 'q=network tools' -d 'page=2' -H 'Accept: application/json'"],
    ["Browser request (Copy as cURL)", "curl 'https://example.com/api/me' -H 'accept: application/json' -H 'cookie: session=abc123' -H 'user-agent: Mozilla/5.0' --compressed"],
  ];
  function init(root) {
    const $ = id => root.querySelector("#curlconv-" + id);
    const C = window.CurlConv, TK = window.TK, setStatus = m => { $("status").textContent = m; };
    const sel = $("example"), o0 = document.createElement("option"); o0.value = ""; o0.textContent = "Choose…"; sel.append(o0);
    EXAMPLES.forEach((e, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = e[0]; sel.append(o); });
    sel.addEventListener("change", () => { if (sel.value !== "") { $("in").value = EXAMPLES[+sel.value][1]; sel.value = ""; show(); } });
    function show() {
      const out = $("out"), sum = $("summary"), text = $("in").value; out.textContent = ""; sum.textContent = "";
      if (!text.trim()) { TK.notes($("notes"), []); setStatus("Ready"); return; }
      const r = C.convert(text);
      if (r.error) { TK.notes($("notes"), [{ level: "bad", text: r.error }]); setStatus("Not converted."); return; }
      TK.notes($("notes"), r.notes); sum.textContent = r.request.method + " " + r.request.url;
      TK.render(out.appendChild(document.createElement("div")), [{ title: "What the request is", rows: r.summary }], { status: setStatus });
      for (const [title, code, file] of [["JavaScript (fetch, Node 18+ or a browser)", r.fetch, "request.mjs"], ["Python (requests)", r.python, "request.py"], ["Go (net/http)", r.go, "main.go"], ["PowerShell (Invoke-WebRequest, PowerShell 7)", r.powershell, "request.ps1"]]) {
        const fs = document.createElement("fieldset"), lg = document.createElement("legend"); lg.textContent = title; fs.append(lg);
        const pre = document.createElement("pre"); pre.className = "cmdkit-pre"; pre.textContent = code; pre.tabIndex = 0; fs.append(pre);
        const row = document.createElement("div"); row.className = "tk-row";
        const c = document.createElement("button"); c.type = "button"; c.className = "xp-btn small"; c.textContent = "Copy"; c.addEventListener("click", () => TK.copy(code, setStatus)); row.append(c);
        const s = document.createElement("button"); s.type = "button"; s.className = "xp-btn small"; s.textContent = "Save as " + file; s.addEventListener("click", () => TK.save(file, code)); row.append(s); fs.append(row); out.append(fs);
      }
      setStatus("Converted.");
    }
    $("in").addEventListener("input", TK.debounce(show, 150));
    $("clear").addEventListener("click", () => { $("in").value = ""; show(); });
    return { destroy() {} };
  }
  return { init };
})();
