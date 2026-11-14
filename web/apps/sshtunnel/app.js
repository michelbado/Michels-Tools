/* Screen of the sshtunnel builder: the form is made from the field list in lib/ and the result comes from its build() function (lib/cmdkit.js does the screen). Nothing is run or sent. */
(window.DesktopApps = window.DesktopApps || {}).sshtunnel = (() => {
  function init(root) { const k = window.CmdKit.mount(root, "sshtunnel", window.SshTunnel.builder); return { destroy() { k.destroy(); } }; }
  return { init };
})();
