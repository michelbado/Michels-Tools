/* Reference card: the data is in lib/ref-dns.js, the screen is shared (lib/refkit.js). Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).dnstypes = (() => {
  function init(root) { return window.RefKit.mount(root, "dnstypes", window.RefData.dnstypes); }
  return { init };
})();
