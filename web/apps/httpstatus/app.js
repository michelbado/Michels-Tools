/* Reference card: the data is in lib/ref-http.js, the screen is shared (lib/refkit.js). Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).httpstatus = (() => {
  function init(root) { return window.RefKit.mount(root, "httpstatus", window.RefData.httpstatus); }
  return { init };
})();
