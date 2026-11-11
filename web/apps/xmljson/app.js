/* XML & JSON Converter. All conversion is in lib/xmljson.js (the browser's own XML parser reads the XML; external files are never loaded).
   Text only reaches the page through textContent / .value. */
(window.DesktopApps = window.DesktopApps || {}).xmljson = (() => {
  function init(root) {
    const $ = id => root.querySelector("#xmljson-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const XJ = window.XmlJson, TK = window.TK; let result = "";
    const mode = () => (root.querySelector('input[name="xmljson-mode"]:checked') || {}).value || "x2j";
    const HELP = {
      x2j: "Attributes become keys that start with @ (\"@id\"). The text of an element that also has attributes or child elements becomes \"#text\". An element that appears more than once becomes an array. An empty element becomes an empty text. Comments and the DOCTYPE are dropped.",
      j2x: "The reverse of the rules for XML to JSON: keys that start with @ become attributes, \"#text\" becomes the text, arrays become repeated elements, null becomes an empty element. Keys must be valid XML names (no spaces, not starting with a digit).",
    };
    function layout() {
      const m = mode(); $("optx").hidden = m !== "x2j"; $("optj").hidden = m !== "j2x"; $("help").textContent = HELP[m];
      $("inlegend").textContent = m === "x2j" ? "XML" : "JSON"; $("outlegend").textContent = m === "x2j" ? "JSON" : "XML";
      $("in").placeholder = m === "x2j" ? "<library>\n  <book id=\"1\">Dune</book>\n  <book id=\"2\">Emma</book>\n</library>" : "{\n  \"library\": {\n    \"book\": [ { \"@id\": \"1\", \"#text\": \"Dune\" } ]\n  }\n}";
    }
    function run() {
      result = ""; $("out").value = ""; $("copy").disabled = true; $("save").disabled = true; $("swap").disabled = true;
      const indent = Number($("indent").value), m = mode(), src = $("in").value;
      const r = m === "x2j" ? XJ.xmlToJson(src, { indent, arrays: $("arrays").checked, types: $("types").checked }) : XJ.jsonToXml(src, { indent, root: $("root").value, declaration: $("decl").checked });
      if (r.empty) { TK.notes($("notes"), []); setStatus("Ready"); return; }
      if (r.error) { TK.notes($("notes"), [{ level: "bad", text: r.error }]); setStatus("Not converted."); return; }
      result = m === "x2j" ? r.json : r.xml; $("out").value = result; TK.notes($("notes"), r.notes);
      $("copy").disabled = false; $("save").disabled = false; $("swap").disabled = false; setStatus("Converted: " + result.length.toLocaleString("en-US") + " characters.");
    }
    function swap() { const m = mode(); $("in").value = result; (m === "x2j" ? $("m2") : $("m1")).checked = true; layout(); run(); }
    for (const id of ["m1", "m2"]) $(id).addEventListener("change", () => { layout(); run(); });
    for (const id of ["indent", "arrays", "types", "decl"]) $(id).addEventListener("change", run);
    $("root").addEventListener("input", TK.debounce(run, 200));
    $("in").addEventListener("input", TK.debounce(run, 250));
    $("copy").addEventListener("click", () => TK.copy(result, setStatus));
    $("save").addEventListener("click", () => TK.save(mode() === "x2j" ? "converted.json" : "converted.xml", result));
    $("swap").addEventListener("click", swap);
    layout();
    return { destroy() {} };
  }
  return { init };
})();
