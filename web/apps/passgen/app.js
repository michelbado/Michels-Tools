/* Password & UUID Generator. Everything is made by lib/passgen.js from the browser's secure random generator; nothing is sent or stored. */
(window.DesktopApps = window.DesktopApps || {}).passgen = (() => {
  function init(root) {
    const $ = id => root.querySelector("#passgen-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const G = window.PassGen, TK = window.TK;
    function passwords() {
      const o = { length: Number($("len").value), lower: $("lower").checked, upper: $("upper").checked, digits: $("digits").checked, symbols: $("symbols").checked, noAmbiguous: $("amb").checked, custom: $("custom").value, exclude: $("excl").value };
      const n = Math.max(1, Math.min(20, Math.floor(Number($("count").value)) || 1)), rows = []; let last = null;
      for (let i = 0; i < n; i++) { const r = G.password(o); if (r.error) { TK.notes($("notes"), [{ level: "bad", text: r.error }]); $("pw").textContent = ""; $("rating").textContent = ""; return; } last = r; rows.push(["", r.text]); }
      TK.notes($("notes"), []);
      TK.render($("pw"), [{ title: n + " password" + (n === 1 ? "" : "s"), rows: rows.map((r, i) => [String(i + 1), r[1]]), mono: true }], { copy: true, status: setStatus });
      const rt = G.rate(last.bits);
      $("rating").textContent = "Strength: " + rt.label + ". About " + Math.round(last.bits) + " bits (" + last.poolSize + " possible characters, length " + o.length + "). Guessing it at ten billion tries per second would take " + rt.crack + " on average.";
      setStatus("Generated.");
    }
    function ids() {
      const b = Number($("tokbytes").value), now = Date.now(), u7 = G.uuid7(now), ul = G.ulid(now);
      TK.render($("idout"), [{ title: "New identifiers", rows: [["UUID v4 (random)", G.uuid4(), "the most common kind"], ["UUID v7 (time-ordered)", u7, "starts with the time, so new ones sort after old ones: " + new Date(G.uuid7Time(u7)).toISOString()], ["ULID", ul, "26 characters, sorts by time: " + new Date(G.ulidTime(ul)).toISOString()], ["Token (hex)", G.token(b, "hex"), b * 8 + " bits of randomness"], ["Token (Base64 URL-safe)", G.token(b, "b64"), "safe inside web addresses"]], mono: true }], { copy: true, status: setStatus });
    }
    $("len").addEventListener("input", () => { $("lenv").textContent = $("len").value; passwords(); });
    for (const id of ["lower", "upper", "digits", "symbols", "amb"]) $(id).addEventListener("change", passwords);
    for (const id of ["count", "custom", "excl"]) $(id).addEventListener("input", TK.debounce(passwords, 250));
    $("go").addEventListener("click", passwords); $("ids").addEventListener("click", ids); $("tokbytes").addEventListener("change", ids);
    passwords(); ids();
    return { destroy() {} };
  }
  return { init };
})();
