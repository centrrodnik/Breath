// ═══════════ ЗНАЧКИ (перенос ui/Icons.kt из «Дыхания 2.x») ═══════════
// Тонкие линейные значки вместо эмодзи: контур на сетке 24×24, линия 1.6, скруглённые концы.
// Цвет — currentColor, поэтому значок всегда в тон надписи рядом.
const Icons = (() => {
  const f2 = v => +v.toFixed(2);
  function Path() {
    const d = [];
    const p = {
      d,
      M(x, y) { d.push(`M${f2(x)} ${f2(y)}`); return p; },
      L(x, y) { d.push(`L${f2(x)} ${f2(y)}`); return p; },
      C(a, b, c, e, x, y) { d.push(`C${f2(a)} ${f2(b)} ${f2(c)} ${f2(e)} ${f2(x)} ${f2(y)}`); return p; },
      Q(a, b, x, y) { d.push(`Q${f2(a)} ${f2(b)} ${f2(x)} ${f2(y)}`); return p; },
      Z() { d.push('Z'); return p; },
      raw(s) { d.push(s); return p; },
      toString() { return d.join(''); }
    };
    return p;
  }
  const circle = (p, x, y, r) => p.raw(`M${f2(x - r)} ${f2(y)}a${r} ${r} 0 1 0 ${f2(2 * r)} 0a${r} ${r} 0 1 0 ${f2(-2 * r)} 0Z`);
  const line = (p, ...xy) => { p.M(xy[0], xy[1]); for (let i = 2; i < xy.length; i += 2) p.L(xy[i], xy[i + 1]); };
  const rrect = (p, l, t, r, b, rad) => p.raw(`M${f2(l + rad)} ${f2(t)}H${f2(r - rad)}a${rad} ${rad} 0 0 1 ${rad} ${rad}V${f2(b - rad)}a${rad} ${rad} 0 0 1 ${-rad} ${rad}H${f2(l + rad)}a${rad} ${rad} 0 0 1 ${-rad} ${-rad}V${f2(t + rad)}a${rad} ${rad} 0 0 1 ${rad} ${-rad}Z`);
  // Как Path.addArc(RectF, start, sweep) в Android: новый контур, углы в градусах, по часовой при sweep > 0
  function arc(p, l, t, r, b, startDeg, sweepDeg) {
    const cx = (l + r) / 2, cy = (t + b) / 2, rx = (r - l) / 2, ry = (b - t) / 2;
    const a0 = startDeg * Math.PI / 180, a1 = (startDeg + sweepDeg) * Math.PI / 180;
    p.M(cx + rx * Math.cos(a0), cy + ry * Math.sin(a0));
    p.raw(`A${f2(rx)} ${f2(ry)} 0 ${Math.abs(sweepDeg) > 180 ? 1 : 0} ${sweepDeg > 0 ? 1 : 0} ${f2(cx + rx * Math.cos(a1))} ${f2(cy + ry * Math.sin(a1))}`);
  }
  function sparkle(p, cx, cy, r) {
    const k = r * 0.18;
    p.M(cx, cy - r).Q(cx + k, cy - k, cx + r, cy).Q(cx + k, cy + k, cx, cy + r).Q(cx - k, cy + k, cx - r, cy).Q(cx - k, cy - k, cx, cy - r).Z();
  }
  function arcArrow(p, cx, cy, r, startDeg, sweepDeg) {
    arc(p, cx - r, cy - r, cx + r, cy + r, startDeg, sweepDeg);
    const end = (startDeg + sweepDeg) * Math.PI / 180;
    const ex = cx + r * Math.cos(end), ey = cy + r * Math.sin(end);
    const dir = sweepDeg > 0 ? 1 : -1;
    const tx = -Math.sin(end) * dir, ty = Math.cos(end) * dir;
    for (const a of [-0.6, 0.6]) {
      const ca = Math.cos(Math.PI + a), sa = Math.sin(Math.PI + a);
      const hx = tx * ca - ty * sa, hy = tx * sa + ty * ca;
      p.M(ex, ey).L(ex + hx * 3.2, ey + hy * 3.2);
    }
  }

  // Каждое описание возвращает { s: контур, f: заливка?, extra: доп. SVG-элементы? }
  const DEFS = {
    leaf(p) { p.M(5, 19).C(5, 10, 10, 5, 19, 5).C(19, 14, 14, 19, 5, 19).Z(); line(p, 5, 19, 13, 11); },
    square(p) { rrect(p, 5, 5, 19, 19, 3.5); },
    wave(p) { p.M(2, 12).C(5, 5, 9, 5, 12, 12).C(15, 19, 19, 19, 22, 12); },
    wind(p) {
      p.M(3, 9).L(14, 9).C(17.5, 9, 17.5, 4.5, 14.5, 4.5);
      p.M(3, 13).L(18, 13).C(21.5, 13, 21.5, 17.5, 18.5, 17.5);
      line(p, 3, 17, 10, 17);
    },
    // Полумесяц: круг (12,12,8) минус круг (16.5,8.5,7) — дуги между точками пересечения
    moon(p) {
      const ax = 12, ay = 12, ar = 8, bx = 16.5, by = 8.5, br = 7;
      const dx = bx - ax, dy = by - ay, dd = Math.hypot(dx, dy);
      const a = (ar * ar - br * br + dd * dd) / (2 * dd), h = Math.sqrt(ar * ar - a * a);
      const mx = ax + a * dx / dd, my = ay + a * dy / dd;
      const p1x = mx - h * dy / dd, p1y = my + h * dx / dd;   // нижняя правая
      const p2x = mx + h * dy / dd, p2y = my - h * dx / dd;   // верхняя
      p.M(p2x, p2y).raw(`A${ar} ${ar} 0 1 0 ${f2(p1x)} ${f2(p1y)}`).raw(`A${br} ${br} 0 0 1 ${f2(p2x)} ${f2(p2y)}`).Z();
    },
    drop(p) { p.M(12, 3).C(9, 7, 5, 10.5, 5, 14.5).C(5, 18.5, 8.1, 21.5, 12, 21.5).C(15.9, 21.5, 19, 18.5, 19, 14.5).C(19, 10.5, 15, 7, 12, 3).Z(); },
    sun(p) { circle(p, 12, 12, 4); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; line(p, 12 + 7 * Math.cos(a), 12 + 7 * Math.sin(a), 12 + 9.5 * Math.cos(a), 12 + 9.5 * Math.sin(a)); } },
    sliders(p, f) { line(p, 6, 4, 6, 20); line(p, 12, 4, 12, 20); line(p, 18, 4, 18, 20); circle(f, 6, 8, 2.3); circle(f, 12, 15, 2.3); circle(f, 18, 10, 2.3); },
    waves(p) { for (const y of [9, 15]) { p.M(3, y); for (let i = 0; i < 3; i++) { const x = 3 + i * 6; p.C(x + 1.5, y - 2.5, x + 4.5, y - 2.5, x + 6, y); } } },
    sunset(p) {
      line(p, 3, 18, 21, 18); arc(p, 6, 12, 18, 24, 180, 180);
      for (const deg of [225, 270, 315]) { const a = deg * Math.PI / 180; line(p, 12 + 8.5 * Math.cos(a), 18 + 8.5 * Math.sin(a), 12 + 11 * Math.cos(a), 18 + 11 * Math.sin(a)); }
    },
    tree(p) { line(p, 12, 3, 17, 10, 14.5, 10, 19, 16, 5, 16, 9.5, 10, 7, 10); p.Z(); line(p, 12, 16, 12, 21); },
    stars(p) { sparkle(p, 10, 13, 7); sparkle(p, 18.5, 5.5, 2.8); sparkle(p, 19, 17.5, 2); },
    flame(p) {
      p.M(12, 3).C(14, 7, 18, 9, 18, 14.5).C(18, 18.5, 15.3, 21, 12, 21)
        .C(8.7, 21, 6, 18.5, 6, 14.5).C(6, 11.5, 8, 9.5, 9, 8).C(9.3, 10.5, 10.5, 11.5, 11, 11.8)
        .C(11.5, 8.5, 11, 5.5, 12, 3).Z();
    },
    diamond(p) { line(p, 12, 3, 20, 12, 12, 21, 4, 12); p.Z(); line(p, 12, 8.5, 15.5, 12, 12, 15.5, 8.5, 12); p.Z(); },
    fullmoon(p) { circle(p, 12, 12, 8); circle(p, 9.5, 10, 1.6); circle(p, 14.5, 14.5, 1.1); circle(p, 14.3, 8.6, 0.8); },
    planet(p) { circle(p, 12, 12, 5.5); return '<ellipse cx="12" cy="12" rx="10.5" ry="2.7" transform="rotate(-20 12 12)"/>'; },
    repeat(p) { arcArrow(p, 12, 12, 7.5, -50, 300); },
    reset(p) { arcArrow(p, 12, 12, 7.5, 230, -300); },
    gear(p) { circle(p, 12, 12, 3); circle(p, 12, 12, 6.5); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; line(p, 12 + 6.5 * Math.cos(a), 12 + 6.5 * Math.sin(a), 12 + 9 * Math.cos(a), 12 + 9 * Math.sin(a)); } },
    chart(p) { line(p, 6, 19, 6, 13); line(p, 12, 19, 12, 6); line(p, 18, 19, 18, 10); },
    play(p) { line(p, 8, 5, 19, 12, 8, 19); p.Z(); },
    info(p, f) { circle(p, 12, 12, 9); line(p, 12, 11, 12, 16.5); circle(f, 12, 7.8, 1.1); },
    arrows(p) { line(p, 8, 19, 8, 5); line(p, 4.5, 8.5, 8, 5, 11.5, 8.5); line(p, 16, 5, 16, 19); line(p, 12.5, 15.5, 16, 19, 19.5, 15.5); },
    arrowUp(p) { line(p, 12, 19, 12, 5); line(p, 7, 10, 12, 5, 17, 10); },
    arrowDown(p) { line(p, 12, 5, 12, 19); line(p, 7, 14, 12, 19, 17, 14); },
    text(p) { line(p, 5, 6, 19, 6); line(p, 12, 6, 12, 19); line(p, 9.5, 19, 14.5, 19); },
    timer(p) { circle(p, 12, 13, 7.5); line(p, 12, 13, 12, 9.2); line(p, 10, 3, 14, 3); line(p, 12, 3, 12, 5.5); },
    bell(p) {
      p.M(6, 16).L(6, 11).C(6, 7.7, 8.7, 5, 12, 5).C(15.3, 5, 18, 7.7, 18, 11).L(18, 16).L(19.5, 17.5).L(4.5, 17.5).Z();
      line(p, 10.5, 20.5, 13.5, 20.5); line(p, 12, 3, 12, 5);
    },
    metronome(p) { line(p, 9, 3.5, 15, 3.5, 19, 20.5, 5, 20.5); p.Z(); line(p, 12, 16.5, 16.5, 7); },
    circle(p) { circle(p, 12, 12, 7.5); },
    ring(p) { circle(p, 12, 12, 7.5); line(p, 12, 2.5, 12, 4.5); line(p, 21.5, 12, 19.5, 12); line(p, 12, 21.5, 12, 19.5); line(p, 2.5, 12, 4.5, 12); },
    vibrate(p) { rrect(p, 8, 4, 16, 20, 2); line(p, 4.5, 9, 4.5, 15); line(p, 19.5, 9, 19.5, 15); line(p, 1.8, 10.5, 1.8, 13.5); line(p, 22.2, 10.5, 22.2, 13.5); },
    voice(p) { rrect(p, 3.5, 4.5, 20.5, 16, 4); line(p, 8.5, 16, 7.5, 20, 12.5, 16); },
    sparkle(p) { sparkle(p, 11, 13, 7.5); sparkle(p, 18.5, 5.5, 2.8); },
    aurora(p) { p.M(3, 18).C(6, 8, 10, 6, 12, 12).C(14, 18, 18, 16, 21, 6); line(p, 3, 21, 21, 21); },
    headphones(p) { arc(p, 4, 5, 20, 21, 180, 180); rrect(p, 3, 13, 7.5, 20.5, 1.8); rrect(p, 16.5, 13, 21, 20.5, 1.8); },
    music(p) { circle(p, 7.8, 18, 2.3); circle(p, 16.8, 16, 2.3); line(p, 10.1, 18, 10.1, 6, 19.1, 4, 19.1, 16); },
    check(p) { line(p, 5, 12.5, 10, 17.5, 19, 7); },
    volume(p) { line(p, 4, 9.5, 8, 9.5, 13, 5, 13, 19, 8, 14.5, 4, 14.5); p.Z(); arc(p, 11, 8, 19, 16, -45, 90); arc(p, 9, 5, 23, 19, -45, 90); },
    sprout(p) {
      line(p, 12, 21, 12, 12);
      p.M(12, 13).C(12, 9, 9.5, 7, 5.5, 7).C(5.5, 11, 8, 13, 12, 13);
      p.M(12, 11).C(12, 7, 14.5, 5, 18.5, 5).C(18.5, 9, 16, 11, 12, 11);
    },
    lotus(p) {
      p.M(12, 4).C(15, 7.5, 15, 13, 12, 17).C(9, 13, 9, 7.5, 12, 4);
      p.M(12, 17).C(8, 17, 4.5, 14, 3.5, 9.5).C(7.5, 9.5, 10.5, 12.5, 12, 17);
      p.M(12, 17).C(16, 17, 19.5, 14, 20.5, 9.5).C(16.5, 9.5, 13.5, 12.5, 12, 17);
      line(p, 6, 20.5, 18, 20.5);
    },
    crown(p) { line(p, 4, 18, 3.5, 8, 8.5, 12, 12, 6, 15.5, 12, 20.5, 8, 20, 18); p.Z(); line(p, 4.5, 20.8, 19.5, 20.8); },
    heart(p) {
      p.M(12, 20).C(5, 15.5, 3, 12, 3, 9).C(3, 6.5, 5, 4.5, 7.5, 4.5).C(9.5, 4.5, 11, 5.5, 12, 7.5)
        .C(13, 5.5, 14.5, 4.5, 16.5, 4.5).C(19, 4.5, 21, 6.5, 21, 9).C(21, 12, 19, 15.5, 12, 20).Z();
    },
    trash(p) { line(p, 4, 6.5, 20, 6.5); line(p, 9, 6.5, 9.5, 4, 14.5, 4, 15, 6.5); line(p, 6, 6.5, 7, 20, 17, 20, 18, 6.5); line(p, 10, 10, 10, 16.5); line(p, 14, 10, 14, 16.5); },
    lock(p, f) { rrect(p, 5, 11, 19, 20.5, 2); p.M(8, 11).L(8, 8); arc(p, 8, 4, 16, 12, 180, 180); p.M(16, 8).L(16, 11); circle(f, 12, 15.5, 1.2); },
    pause(p) { line(p, 9, 5, 9, 19); line(p, 15, 5, 15, 19); },
    trophy(p) {
      p.M(7, 4).L(17, 4).L(17, 9).C(17, 12, 15, 14.5, 12, 14.5).C(9, 14.5, 7, 12, 7, 9).Z();
      p.M(7, 6).C(3.5, 6, 3.5, 11, 7.6, 11);
      p.M(17, 6).C(20.5, 6, 20.5, 11, 16.4, 11);
      line(p, 12, 14.5, 12, 18); line(p, 9, 18, 15, 18); line(p, 8, 20.5, 16, 20.5);
    },
    pin(p) { line(p, 9.5, 3.5, 14.5, 3.5); line(p, 10, 3.5, 10, 9, 7, 13, 17, 13, 14, 9, 14, 3.5); line(p, 12, 13, 12, 21); },
    snowflake(p) {
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 - Math.PI / 2;
        line(p, 12, 12, 12 + 9 * Math.cos(a), 12 + 9 * Math.sin(a));
        const mx = 12 + 6 * Math.cos(a), my = 12 + 6 * Math.sin(a);
        for (const s of [-0.6, 0.6]) line(p, mx, my, mx + 2.6 * Math.cos(a + s), my + 2.6 * Math.sin(a + s));
      }
    },
    // 2.9: лампочка гирлянды — колба-капля на цоколе, сверху провод
    bulb(p) {
      p.M(12, 8.5).C(16.2, 8.5, 17.5, 13.5, 15.8, 17).C(15, 18.8, 13.6, 20.5, 12, 20.5).C(10.4, 20.5, 9, 18.8, 8.2, 17).C(6.5, 13.5, 7.8, 8.5, 12, 8.5).Z();
      rrect(p, 9.8, 5.5, 14.2, 8.5, 0.8);
      p.M(3, 3.5).Q(8, 6.5, 12, 5.5).Q(16, 6.5, 21, 3.5);
    },
    // ── 2.4: звуки природы, голос, «О приложении», обучение ──
    rain(p) {
      p.M(7, 15).C(4, 15, 3, 11.5, 6.2, 10.4).C(6.6, 7, 11, 5.3, 13.3, 8.2).C(15.6, 6.6, 19.2, 8.2, 18.8, 11.2).C(21.4, 11.6, 21.2, 15, 18, 15).Z();
      line(p, 8.5, 18, 7.5, 20.5); line(p, 12.5, 18, 11.5, 20.5); line(p, 16.5, 18, 15.5, 20.5);
    },
    bird(p) { p.M(2.5, 13).Q(7, 8, 12, 13.5).Q(17, 8, 21.5, 13); p.M(13.5, 6.5).Q(15.3, 4.6, 17.2, 6.8).Q(19.1, 4.6, 21, 6.5); },
    campfire(p) {
      p.M(12, 3.5).C(15.5, 6.8, 16.8, 9.6, 16.8, 12).C(16.8, 14.6, 14.6, 16.2, 12, 16.2).C(9.4, 16.2, 7.2, 14.6, 7.2, 12)
        .C(7.2, 10, 8.5, 8.6, 9.6, 7.4).C(10, 9.2, 10.8, 10, 11.8, 10.3).C(11.3, 8, 11.3, 5.8, 12, 3.5).Z();
      line(p, 4.5, 21, 19.5, 17.5); line(p, 4.5, 17.5, 19.5, 21);
    },
    voiceWave(p) {
      circle(p, 9, 8.5, 3.6); p.M(3, 20).C(3, 15.5, 5.5, 13.5, 9, 13.5).C(12.5, 13.5, 15, 15.5, 15, 20);
      arc(p, 14, 5, 19, 12, -60, 120); arc(p, 15.5, 2.5, 22.5, 14.5, -60, 120);
    },
    back(p) { line(p, 15, 4.5, 7.5, 12, 15, 19.5); },
    book(p) {
      p.M(12, 6.5).C(9.5, 4.8, 6, 4.8, 3.5, 5.8).L(3.5, 18.8).C(6, 17.8, 9.5, 17.8, 12, 19.5)
        .C(14.5, 17.8, 18, 17.8, 20.5, 18.8).L(20.5, 5.8).C(18, 4.8, 14.5, 4.8, 12, 6.5).Z();
      line(p, 12, 6.5, 12, 19.5);
    },
    // ПК: развернуть окно на весь экран
    expand(p) { line(p, 4, 9, 4, 4, 9, 4); line(p, 15, 4, 20, 4, 20, 9); line(p, 20, 15, 20, 20, 15, 20); line(p, 9, 20, 4, 20, 4, 15); }
  };

  const cache = {};
  /** SVG-разметка значка; cls — доп. класс */
  function svg(name, cls = '') {
    if (!(name in cache)) {
      const def = DEFS[name];
      if (!def) return '';
      const p = Path(), f = Path();
      const extra = def(p, f) || '';
      const fill = f.d.length ? `<path d="${f}" fill="currentColor" stroke="none"/>` : '';
      cache[name] = `<path d="${p}"/>${extra}${fill}`;
    }
    return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cache[name]}</svg>`;
  }
  /** «[значок] текст» как HTML (текст экранируется) */
  function withText(name, text) {
    const t = String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return svg(name) + (t ? `<span class="ic-t">${t}</span>` : '');
  }
  /** Ставит значок name перед текстом элемента */
  function set(el, name, text) { if (el) el.innerHTML = withText(name, text); }
  /** <i data-ic="name"> в разметке → SVG */
  function hydrate(root = document) {
    // <i> заменяется самим значком: тогда работает отступ «.ic + .ic-t»
    root.querySelectorAll('[data-ic]').forEach(el => { el.outerHTML = svg(el.dataset.ic); });
  }
  return { svg, withText, set, hydrate, has: n => n in DEFS };
})();
