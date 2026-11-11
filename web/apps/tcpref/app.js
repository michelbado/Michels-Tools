/* Reference card: the data is in lib/ref-tcp.js, the screen is shared (lib/refkit.js). Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).tcpref = (() => {
  function init(root) { return window.RefKit.mount(root, "tcpref", window.RefData.tcpref); }
  return { init };
})();
