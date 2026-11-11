/* Basic Auth Generator. All work is in lib/basicauth.js; this file only shows it. Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).basicauth = (() => {
  function init(root) {
    const $ = id => root.querySelector("#basicauth-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const BA = window.BasicAuth, TK = window.TK;
    function make() {
      const out = $("out"); out.textContent = "";
      const r = BA.encode($("user").value, $("pass").value);
      if (r.empty) { TK.notes($("notes"), []); return; }
      if (r.error) { TK.notes($("notes"), [{ level: "bad", text: r.error }]); return; }
      TK.notes($("notes"), r.notes);
      TK.render(out, [{ title: "The header", rows: r.rows, mono: true }], { copy: true, status: setStatus });
    }
    function read() {
      const out = $("dout"); out.textContent = "";
      const r = BA.decode($("in").value);
      if (r.empty) { TK.notes($("dnotes"), []); return; }
      if (r.error) { TK.notes($("dnotes"), [{ level: "bad", text: r.error }]); return; }
      TK.notes($("dnotes"), r.notes);
      TK.render(out, [{ title: "What it says", rows: r.rows, mono: true }], { copy: true, status: setStatus });
    }
    $("user").addEventListener("input", TK.debounce(make, 150)); $("pass").addEventListener("input", TK.debounce(make, 150));
    $("show").addEventListener("change", () => { $("pass").type = $("show").checked ? "text" : "password"; });
    $("in").addEventListener("input", TK.debounce(read, 150));
    return { destroy() {} };
  }
  return { init };
})();
