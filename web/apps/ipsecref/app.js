/* Reference card: the data is in lib/ref-ipsec.js, the screen is shared (lib/refkit.js). Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).ipsecref = (() => {
  function init(root) { return window.RefKit.mount(root, "ipsecref", window.RefData.ipsecref); }
  return { init };
})();
