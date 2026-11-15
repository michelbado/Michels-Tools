/* Odd One Out (age 4 to 7): tap the picture that does not belong. A wrong tap shakes gently; after two, the right one pulses. Nothing can be lost. */
(window.DesktopApps = window.DesktopApps || {}).kidodd = (() => {
  function init(root) {
    const K = window.Kids, kd = root.querySelector(".kd"), stage = root.querySelector("#kidodd-stage"), modes = root.querySelector("#kidodd-modes");
    const kit = K.mount(kd, "kidodd");
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    modes.remove();
    let timers = [], busy = false;
    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
    const level = () => Math.floor(K.stars.of("kidodd") / 4);
    function newRound() {
      for (const t of timers) clearTimeout(t); timers = []; busy = false; stage.textContent = "";
      const r = K.oddRound(level()), q = el("div", "kd-big"), row = el("div", "kd-field"), objs = []; let wrong = 0;
      q.textContent = "?"; // a plain question mark: the picture says it all
      stage.append(q, row, el("p", "tk-muted kd-hintline", "Tap the one that is different."));
      r.items.forEach((it, i) => {
        const o = el("button", "kd-obj"); o.type = "button"; o.setAttribute("aria-label", "Picture " + (i + 1)); o.append(K.icon(it.icon, it.color));
        o.addEventListener("click", () => {
          if (busy) return;
          if (i === r.odd) {
            busy = true; o.classList.add("right"); for (const x of objs) if (x !== o) x.classList.add("dim");
            K.chime("good"); K.chime("win"); K.celebrate(stage); kit.star(); later(newRound, 2600);
          } else {
            wrong++; o.classList.remove("shake"); void o.offsetWidth; o.classList.add("shake"); K.chime("soft");
            if (wrong >= 2) objs[r.odd].classList.add("hint");
          }
        });
        row.append(o); objs.push(o);
      });
    }
    newRound();
    return { destroy() { for (const t of timers) clearTimeout(t); kit.destroy(); } };
  }
  return { init };
})();
