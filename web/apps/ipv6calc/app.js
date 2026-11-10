/* IPv6 Calculator. Everything runs in the browser; the maths is in lib/ipv6.js. Text only reaches the page through textContent / value. */
(window.DesktopApps = window.DesktopApps || {}).ipv6calc = (() => {
  const LIMIT = 256;
  function init(root) {
    const $ = id => root.querySelector("#ipv6calc-" + id);
    const setStatus = m => { $("status").textContent = m; };
    let text = "";
    function run() {
      const sv = $("split").value.trim();
      let splitTo = null;
      if (sv !== "") { if (/^\d{1,3}$/.test(sv) && +sv <= 128) splitTo = +sv; }
      const r = window.IPv6.describe($("in").value, splitTo, LIMIT);
      const sb = $("splitbox");
      sb.hidden = true; $("copy").disabled = true;
      if (r.error) { $("summary").textContent = ""; window.TK.notes($("notes"), [{ level: "bad", text: r.error }]); $("sections").textContent = ""; text = ""; return; }
      const notes = r.notes.slice();
      if (sv !== "" && splitTo == null) notes.push({ level: "bad", text: "The split length must be a number from 0 to 128." });
      $("summary").textContent = r.summary;
      window.TK.notes($("notes"), notes);
      window.TK.render($("sections"), r.sections, { copy: true, status: setStatus });
      text = window.TK.toText("IPv6 Calculator (Michel's Tools)", r.sections, notes);
      if (r.split) {
        sb.hidden = false;
        $("splitlegend").textContent = "Split into /" + r.split.prefix;
        $("splitlist").value = r.split.list.join("\n");
        $("splitfoot").textContent = r.split.total.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " prefixes in all" + (r.split.shown < r.split.total ? "; the first " + r.split.shown + " are listed." : ".");
        text += "\nSplit into /" + r.split.prefix + " (" + r.split.shown + " listed)\n" + r.split.list.join("\n") + "\n";
      }
      $("copy").disabled = false;
    }
    const later = window.TK.debounce(run, 150);
    $("in").addEventListener("input", later);
    $("split").addEventListener("input", later);
    $("copy").addEventListener("click", () => window.TK.copy(text, setStatus));
    run();
    return { destroy() {} };
  }
  return { init };
})();
