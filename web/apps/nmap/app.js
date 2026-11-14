/* Screen of the nmap builder: the form is made from the field list in lib/ and the result comes from its build() function (lib/cmdkit.js does the screen). Nothing is run or sent. */
(window.DesktopApps = window.DesktopApps || {}).nmap = (() => {
  function init(root) { const k = window.CmdKit.mount(root, "nmap", window.NmapBuild.builder); return { destroy() { k.destroy(); } }; }
  return { init };
})();
