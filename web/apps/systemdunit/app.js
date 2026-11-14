/* Screen of the systemdunit builder: the form is made from the field list in lib/ and the result comes from its build() function (lib/cmdkit.js does the screen). Nothing is run or sent. */
(window.DesktopApps = window.DesktopApps || {}).systemdunit = (() => {
  function init(root) { const k = window.CmdKit.mount(root, "systemdunit", window.SystemdUnit.builder); return { destroy() { k.destroy(); } }; }
  return { init };
})();
