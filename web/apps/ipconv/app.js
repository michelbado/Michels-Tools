/* IP & Number Converter. Everything runs in the browser; the work is in lib/ipconv.js. Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).ipconv = (() => {
  function init(root) {
    const $ = id => root.querySelector("#ipconv-" + id);
    const setStatus = m => { $("status").textContent = m; };
    function run() {
      const r = window.IPConv.read($("in").value);
      if (r.error) { $("summary").textContent = ""; window.TK.notes($("notes"), [{ level: $("in").value.trim() ? "bad" : "", text: r.error }]); $("sections").textContent = ""; return; }
      const d = window.IPConv.describe(r), notes = [];
      if (r.loose) notes.push({ level: "warn", text: "This is not the usual a.b.c.d form, but browsers and many tools still read it as " + window.IPConv.dotted(r.n) + ". Attackers use forms like this to hide where a link really goes." });
      if (r.version === 6 && r.zone) notes.push({ level: "", text: "The interface name (%" + r.zone + ") is not part of the number." });
      $("summary").textContent = (r.version === 4 ? "IPv4 " + window.IPConv.dotted(r.n) : "IPv6 " + window.IPv6.compress(r.n)) + " (read as " + r.how + ")";
      window.TK.notes($("notes"), notes);
      window.TK.render($("sections"), [{ title: "Every way to write it", rows: d.rows, mono: true }], { copy: true, status: setStatus });
    }
    $("in").addEventListener("input", window.TK.debounce(run, 150));
    run();
    return { destroy() {} };
  }
  return { init };
})();
