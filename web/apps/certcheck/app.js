/* Certificate Package Checker: drop a package (certificate, key, CA bundle, PFX, CSR...) and get one verdict. Logic is in lib/certkit.js; the input box is lib/certui.js.
   Files stay in this browser tab (memory only). Text reaches the page through textContent only. */
(window.DesktopApps = window.DesktopApps || {}).certcheck = (() => {
  const SECTIONS = ["Package", "Key and certificate", "Chain", "Dates", "Names", "Strength", "Files"];
  const MARK = { good: "OK", info: "i", warn: "!", bad: "X" };
  function init(root) {
    const $ = id => root.querySelector("#certcheck-" + id), setStatus = m => { $("status").textContent = m; };
    const TK = window.TK, CK = window.CertKit;
    let report = "", seq = 0, softDone = false, last = null;
    function ensureSoft() { if (softDone) return; softDone = true; if (!(window.crypto && window.crypto.subtle) && window.SoftCrypto) window.SoftCrypto.install(window.pkijs); }
    const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
    const fmt = t => new Date(t).toISOString().slice(0, 10);

    async function run() {
      const my = ++seq; ensureSoft();
      const items = panel.items(), pnotes = panel.notes();
      const out = $("out"); out.textContent = "";
      if (!items.length && !pnotes.length) { $("verdict").hidden = true; $("inv").textContent = ""; $("copy").disabled = $("save").disabled = true; report = ""; setStatus("Ready"); return; }
      setStatus("Checking...");
      const a = await CK.analyze(items, { host: $("host").value, now: Date.now() });
      if (my !== seq) return;
      last = a;
      const v = $("verdict"); v.hidden = false; v.className = "ct-verdict " + a.overall.level; v.textContent = "";
      v.append(el("strong", null, a.overall.title), document.createTextNode(" - " + a.overall.text));
      $("inv").textContent = a.inventory ? "In this package: " + a.inventory + "." : "";

      // the chain
      if (a.chain.length) {
        const fs = el("fieldset"), lg = el("legend", null, "The chain, from the server certificate up"), tb = el("table", "tk-list");
        const hd = el("tr"); for (const h of ["", "Certificate", "Issued by", "Valid until", "Signature"]) hd.append(el("th", null, h)); tb.append(hd);
        a.chain.forEach((x, i) => {
          const c = x.cert, tr = el("tr"), role = i === 0 ? "Server" : c.selfIssued ? "Root" : "Intermediate";
          const sig = i === a.chain.length - 1 && !c.selfIssued ? "(issuer not in the package)" : x.sig === true ? "checked, correct" : x.sig === false ? "WRONG" : "not checked";
          tr.append(el("td", null, (i + 1) + ". " + role), el("td", null, c.cn || c.subject), el("td", null, c.selfIssued ? "itself" : (c.issuer.match(/CN=([^,]+)/) || [0, c.issuer])[1]), el("td", null, fmt(c.notAfter)), el("td", null, sig));
          tb.append(tr);
        });
        fs.append(lg, tb); out.append(fs);
      }
      // the checks, by topic
      const notesFromFiles = pnotes.filter(n => n.text).map(n => ({ section: "Package", level: n.level === "bad" ? "bad" : n.level === "warn" ? "warn" : "info", title: "A file could not be used", text: n.text, fix: "" }));
      const all = notesFromFiles.concat(a.checks);
      const order = { bad: 0, warn: 1, good: 2, info: 3 };
      for (const sec of SECTIONS) {
        const list = all.filter(c => c.section === sec).sort((x, y) => order[x.level] - order[y.level]); if (!list.length) continue;
        const fs = el("fieldset"), lg = el("legend", null, sec), ul = el("ul", "tk-notes");
        for (const c of list) {
          const li = el("li", c.level), t = el("strong", null, c.title); li.append(el("span", "ct-mark", MARK[c.level] + " "), t, el("div", null, c.text));
          if (c.fix) li.append(el("div", "ct-fix", "What to do: " + c.fix));
          ul.append(li);
        }
        fs.append(lg, ul); out.append(fs);
      }
      report = buildReport(a, all);
      $("copy").disabled = $("save").disabled = false;
      setStatus("Done: " + a.overall.title + ".");
    }
    function buildReport(a, all) {
      const L = ["Certificate Package Check (Michel's Tools)", "", "VERDICT: " + a.overall.title + " - " + a.overall.text, a.inventory ? "In this package: " + a.inventory + "." : ""];
      if (a.chain.length) { L.push("", "Chain:"); a.chain.forEach((x, i) => L.push("  " + (i + 1) + ". " + (x.cert.cn || x.cert.subject) + " (valid until " + fmt(x.cert.notAfter) + ")" + (x.sig === false ? " - SIGNATURE WRONG" : ""))); }
      for (const sec of SECTIONS) { const list = all.filter(c => c.section === sec); if (!list.length) continue; L.push("", sec.toUpperCase()); for (const c of list) { L.push("  [" + c.level.toUpperCase() + "] " + c.title); L.push("      " + c.text); if (c.fix) L.push("      What to do: " + c.fix); } }
      L.push("", "Private keys were read in the browser only; nothing was sent anywhere. Trust in the root certificate is not checked.");
      return L.join("\n");
    }
    const panel = window.CertUI.panel($("panel"), { id: "certcheck", onChange: run });
    $("host").addEventListener("input", TK.debounce(run, 250));
    $("copy").addEventListener("click", () => TK.copy(report, setStatus));
    $("save").addEventListener("click", () => TK.save("certificate-check.txt", report));
    return { destroy() { panel.destroy(); report = ""; seq++; } };
  }
  return { init };
})();
