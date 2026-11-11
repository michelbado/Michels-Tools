/* Reference card: the data is in lib/ref-dscp.js, the screen is shared (lib/refkit.js). Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).dscp = (() => {
  function init(root) { return window.RefKit.mount(root, "dscp", window.RefData.dscp); }
  return { init };
})();
