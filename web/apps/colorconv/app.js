/* Colour Converter. All colour maths is in lib/colorconv.js; this file only shows it. Colours are applied with element.style (allowed by the CSP);
   text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).colorconv = (() => {
  function init(root) {
    const $ = id => root.querySelector("#colorconv-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const CV = window.ColorConv, TK = window.TK;
    const fill = document.createElement("div"); fill.className = "colorconv-fill"; $("swatch").prepend(fill);
    function run() {
      const out = $("out"); out.textContent = "";
      const r = CV.parse($("in").value);
      if (r.empty) { TK.notes($("notes"), []); fill.style.background = "transparent"; return; }
      if (r.error) { TK.notes($("notes"), [{ level: "bad", text: r.error }]); return; }
      const s = CV.show(r.c);
      fill.style.background = "rgba(" + s.r + "," + s.g + "," + s.b + "," + s.a + ")";
      $("sample").style.color = s.text === "#000000" ? "#000000" : "#ffffff";
      $("pick").value = s.hex.slice(0, 7);
      TK.notes($("notes"), s.a < 1 ? [{ level: "", text: "This colour is partly transparent (alpha " + Math.round(s.a * 1000) / 1000 + "). The contrast figures below ignore the transparency and use the solid colour." }] : []);
      TK.render(out, [{ title: "Every way to write it (read as " + r.how + ")", rows: s.rows.map(x => [x[0], x[1], x[2]]), mono: true }, { title: "Contrast (WCAG): is text readable on this colour?", rows: s.contrastRows.concat([["Readable text colour", s.textName]]), foot: "At least 4.5 : 1 is needed for normal text (AA), 3 : 1 for large text, 7 : 1 for the strictest level (AAA)." }], { copy: true, status: setStatus });
      setStatus("Done.");
    }
    const names = $("names");
    for (const n of CV.names()) { const b = document.createElement("button"); b.type = "button"; b.textContent = n; const c = CV.parse(n).c; b.style.background = "rgb(" + c.r + "," + c.g + "," + c.b + ")"; b.style.color = CV.show(c).text; b.addEventListener("click", () => { $("in").value = n; run(); }); names.append(b); }
    $("in").addEventListener("input", TK.debounce(run, 150));
    $("pick").addEventListener("input", () => { $("in").value = $("pick").value; run(); });
    run();
    return { destroy() {} };
  }
  return { init };
})();
