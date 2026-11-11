/* JWT Decoder. All reading and checking is in lib/jwtdecode.js; this file only shows it. Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).jwtdecode = (() => {
  function init(root) {
    const $ = id => root.querySelector("#jwtdecode-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const JD = window.JwtDecode, TK = window.TK; let text = "", last = null;
    function pre(title, body) { const fs = document.createElement("fieldset"), lg = document.createElement("legend"), ta = document.createElement("textarea"); lg.textContent = title; ta.className = "xp-text tk-in"; ta.readOnly = true; ta.spellcheck = false; ta.rows = Math.min(14, Math.max(3, body.split("\n").length)); ta.value = body; fs.append(lg, ta); return fs; }
    function run() {
      const out = $("out"); out.textContent = ""; $("copy").disabled = true; text = ""; $("verify").hidden = true; $("result").hidden = true; last = null;
      const r = JD.parse($("in").value);
      if (r.empty) { $("summary").textContent = ""; TK.notes($("notes"), []); return; }
      if (r.error) { $("summary").textContent = ""; TK.notes($("notes"), [{ level: "bad", text: r.error }]); return; }
      last = r;
      const exp = r.times.exp; $("summary").textContent = "Algorithm " + (r.alg === undefined ? "(none given)" : r.alg) + (exp ? (exp.diff < 0 ? ". Expired " : ". Expires ") + exp.rel : ". No expiry time");
      TK.notes($("notes"), r.notes);
      out.append(pre("Header", r.headerText), pre("Payload", r.payloadText));
      if (r.claims.length) { const holder = document.createElement("div"); TK.render(holder, [{ title: "Claims explained", rows: r.claims.map(c => [c[0], c[1], c[2]]), mono: true }], { copy: false }); out.append(holder); }
      $("verify").hidden = !(r.alg && String(r.alg).toLowerCase() !== "none");
      $("keylabel").textContent = /^HS/.test(r.alg || "") ? "Secret" : "Public key, certificate or JWK";
      $("b64row").hidden = !/^HS/.test(r.alg || "");
      const lines = ["JWT Decoder (Michel's Tools)", $("summary").textContent, "", "NOT verified: this only decodes the token.", ""]; for (const n of r.notes) lines.push("* " + n.text);
      lines.push("", "Header", r.headerText, "", "Payload", r.payloadText); for (const [k, v, h] of r.claims) lines.push("  " + k + ": " + v + (h ? " (" + h + ")" : ""));
      text = lines.join("\n"); $("copy").disabled = false; setStatus("Done. The signature has NOT been checked.");
    }
    async function check() {
      const res = await JD.verify($("in").value, $("key").value, { secretIsBase64: $("b64").checked });
      TK.notes($("result"), [{ level: res.ok ? "good" : "bad", text: res.text }]); setStatus(res.ok ? "Signature valid." : "Signature check failed.");
    }
    $("in").addEventListener("input", TK.debounce(run, 250));
    $("check").addEventListener("click", check);
    $("copy").addEventListener("click", () => TK.copy(text, setStatus));
    return { destroy() {} };
  }
  return { init };
})();
