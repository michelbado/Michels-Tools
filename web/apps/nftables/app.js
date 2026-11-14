/* Screen of the nftables builder: the form is made from the field list in lib/ and the result comes from its build() function (lib/cmdkit.js does the screen). Nothing is run or sent. */
(window.DesktopApps = window.DesktopApps || {}).nftables = (() => {
  function init(root) { const k = window.CmdKit.mount(root, "nftables", window.NftBuild.builder); return { destroy() { k.destroy(); } }; }
  return { init };
})();
