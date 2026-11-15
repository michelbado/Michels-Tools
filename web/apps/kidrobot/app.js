/* Robot Path (age 6+): line up arrow tiles to guide the robot to the star, then press the green button. The rules and levels are in lib/kidrobot.js. */
(window.DesktopApps = window.DesktopApps || {}).kidrobot = (() => {
  function init(root) {
    const K = window.Kids, R = window.KidRobot, kd = root.querySelector(".kd"), stage = root.querySelector("#kidrobot-stage"), modes = root.querySelector("#kidrobot-modes");
    const kit = K.mount(kd, "kidrobot");
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    modes.remove(); // this game has its own level buttons
    const doneKey = () => { const o = K.store.get(); return Array.isArray(o.robotDone) ? o.robotDone : []; };
    const markDone = i => { const o = K.store.get(), d = doneKey(); if (!d.includes(i)) d.push(i); o.robotDone = d; K.store.set(o); };
    let lvIdx = Math.max(0, R.LEVELS.findIndex((_, i) => !doneKey().includes(i))), prog = [], running = false, timers = [];
    const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
    const ICON = { F: "up", L: "turnL", R: "turnR" }, NAME = { F: "Forward", L: "Turn left", R: "Turn right" };
    let ui = null;

    function build() {
      for (const t of timers) clearTimeout(t); timers = []; running = false; prog = [];
      const lv = R.LEVELS[lvIdx], cap = R.capacity(lv);
      stage.textContent = "";
      const wrap = el("div", "kd-rob"), levels = el("div", "kd-levels");
      R.LEVELS.forEach((_, i) => {
        const b = el("button", "kd-lv" + (i === lvIdx ? " on" : "") + (doneKey().includes(i) ? " won" : ""), String(i + 1)); b.type = "button"; b.setAttribute("aria-label", "Level " + (i + 1)); b.setAttribute("aria-pressed", String(i === lvIdx));
        b.addEventListener("click", () => { lvIdx = i; build(); }); levels.append(b);
      });
      // the board
      const board = el("div", "kd-board"); board.style.gridTemplateColumns = "repeat(" + lv.w + ", 1fr)";
      const cell = Math.max(44, Math.min(78, Math.floor(Math.min(560, stage.clientWidth - 24) / (lv.w + 4.2))));
      board.style.width = cell * lv.w + 8 + "px"; board.style.height = cell * lv.h + 8 + "px";
      for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++) {
        const c = el("div", "kd-cell");
        if (R.blocked(lv, x, y)) c.append(K.icon("rock", "#90A4AE")); else if (x === lv.goal[0] && y === lv.goal[1]) c.append(K.icon("star", "yellow"));
        board.append(c);
      }
      const robot = el("div", "kd-robot"); robot.style.width = 100 / lv.w + "%"; robot.style.height = 100 / lv.h + "%"; const rsvg = K.icon("robot", "blue"); robot.append(rsvg); board.append(robot);
      const place = (x, y, d) => { robot.style.left = x / lv.w * 100 + "%"; robot.style.top = y / lv.h * 100 + "%"; rsvg.style.transform = "rotate(" + d * 90 + "deg)"; };
      // the side: program, commands, message
      const side = el("div", "kd-side"), strip = el("div", "kd-prog"), cmds = el("div", "kd-cmds"), msg = el("div", "kd-msg"), slots = [];
      for (let i = 0; i < cap; i++) { const s = el("div", "kd-slot"); strip.append(s); slots.push(s); }
      const draw = () => { slots.forEach((s, i) => { s.textContent = ""; s.classList.toggle("fill", i < prog.length); if (i < prog.length) s.append(K.icon(ICON[prog[i]], "#1F4A8A")); }); };
      const say = (text, icon, color) => { msg.textContent = ""; if (icon) msg.append(K.icon(icon, color, 34)); msg.append(el("span", null, text)); };
      const cmd = (cls, label, icon, color, fn) => { const b = el("button", "kd-cmd " + cls); b.type = "button"; b.setAttribute("aria-label", label); b.title = label; b.append(K.icon(icon, color)); b.addEventListener("click", fn); cmds.append(b); return b; };
      const btns = [];
      for (const c of ["F", "L", "R"]) btns.push(cmd("", NAME[c], ICON[c], "#1F4A8A", () => { if (running || prog.length >= cap) return; prog.push(c); K.chime("step"); draw(); }));
      btns.push(cmd("", "Take back the last tile", "undo", "#C77A00", () => { if (running) return; prog.pop(); draw(); }));
      btns.push(cmd("", "Clear all tiles", "bin", "#C23A14", () => { if (running) return; prog = []; draw(); place(...lv.start); say("", null); }));
      const go = cmd("go", "Go!", "play", "#3F9A3F", () => runIt());
      const help = el("button", "xp-btn small", "Show me a way (grown-ups)"); help.type = "button";
      help.addEventListener("click", () => { if (running) return; prog = R.solve(lv).split(""); draw(); say("Press the green button.", "play", "#3F9A3F"); });
      side.append(strip, cmds, msg, help);
      place(...lv.start); draw();

      function runIt() {
        if (running || !prog.length) return;
        running = true; for (const b of [...btns, go]) b.disabled = true;
        const res = R.run(lv, prog); say("", null); place(...lv.start);
        res.steps.forEach((s, i) => later(() => {
          slots.forEach((x, j) => x.classList.toggle("now", j === i));
          place(s.x, s.y, s.d);
          if (s.bump) { robot.classList.remove("bump"); void robot.offsetWidth; robot.classList.add("bump"); K.chime("soft"); } else K.chime("step");
        }, 450 * (i + 1)));
        later(() => {
          slots.forEach(x => x.classList.remove("now")); running = false; for (const b of [...btns, go]) b.disabled = false;
          if (res.reached) {
            const first = !doneKey().includes(lvIdx); markDone(lvIdx); K.chime("win"); K.celebrate(stage); if (first) kit.star();
            say("You did it!", "star", "yellow");
            const next = el("button", "kd-bigbtn"); next.type = "button"; next.setAttribute("aria-label", "Next level"); next.append(K.icon("play", "#3F9A3F"));
            next.addEventListener("click", () => { lvIdx = (lvIdx + 1) % R.LEVELS.length; build(); }); msg.append(next);
          } else { say("Not there yet. Change the tiles and try again.", "robot", "blue"); place(...lv.start); }
        }, 450 * (res.steps.length + 1) + 200);
      }
      wrap.append(levels, board, side); stage.append(wrap);
    }
    build();
    return { destroy() { for (const t of timers) clearTimeout(t); kit.destroy(); } };
  }
  return { init };
})();
