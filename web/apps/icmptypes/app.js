/* Reference card: the data is in lib/ref-icmp.js, the screen is shared (lib/refkit.js). Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).icmptypes = (() => {
  function init(root) { return window.RefKit.mount(root, "icmptypes", window.RefData.icmptypes); }
  return { init };
})();
