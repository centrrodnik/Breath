// ═══════════ ШАР-ЦВЕТОК «как на часах» (перенос render/Flower.kt из «Дыхания 2.3») ═══════════
// Решётка лепестков по спирали подсолнуха: лепесток с относительной позицией u стоит на радиусе R·u^γ,
// размер — доля местного шага. Новые рождаются в центре и выталкивают старые (вдох), на выдохе младшие
// первыми уходят в центр. Лепестки складываются как свет ('lighter'), а сам холст ложится на страницу
// через mix-blend-mode: plus-lighter — так же, как слой PorterDuff.ADD поверх сцены на Android.
// Настройки — со скриншота «шар настройки для демо точки 2.png»: дисков 110, точка 0.25, лепесток 0.80,
// γ 1.5, яркость 100 %; «Облако без краёв» и «Расфокус на выдохе» выключены.

// Ограничение кадров (режим разработчика 3-0-3-0): общее для всех циклов анимации страницы
const FpsCap = {
  ms: 0,                 // 0 — без ограничения, 33 — ~30 FPS
  set(fps) { this.ms = fps ? Math.round(1000 / fps) : 0; },
  /** true — кадр пропустить (с допуском 3 мс на дрожание таймера) */
  skip(last, now) { return this.ms > 0 && last > 0 && now - last < this.ms - 3; }
};

const Flower = (() => {
  const REST_R = 0.15, BLUR_LEVELS = 10, SPRITE = 96;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const P = { count: 110, gain: 1.0, dot: 0.25, petal: 0.80, gamma: 1.5, defocus: false };

  const WATCH = { bands: [0x9ccaff, 0x82bcff, 0x68aeff, 0x4c9eff, 0x3c90ff, 0x3080ff], haze: 0x1440c8 };
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const mixRgb = (a, b, t) => {
    const r = lerp(a >> 16 & 255, b >> 16 & 255, t), g = lerp(a >> 8 & 255, b >> 8 & 255, t), bl = lerp(a & 255, b & 255, t);
    return (r << 16) | (g << 8) | bl | 0;
  };
  const rgba = (rgb, a) => `rgba(${rgb >> 16 & 255},${rgb >> 8 & 255},${rgb & 255},${Math.min(1, Math.max(0, a))})`;
  /** Палитра из цвета темы: полосы светлеют к центру, дымка — тёмный насыщенный тон того же цвета */
  function fromTheme(base) {
    const w = [0.55, 0.45, 0.34, 0.22, 0.12, 0];
    return { bands: w.map(k => mixRgb(base, 0xffffff, k)), haze: mixRgb(base, 0x000000, 0.45) };
  }

  // ───── Состояние на кадр (всё, что зависит от фазы) ─────
  function newState() { const s = {}; setRest(s, REST_R); return s; }
  function setTop(st, rf) {
    Object.assign(st, { kind: 'h1', u: 1, rf, f: 0, tw: 0, hole: 0, fill: 0, nPow: 1.4, lateA: 0, late: 0, cross: 0, expoW: 0, wash: 1, exW: 0, fillLayer: 0 });
  }
  function setRest(st, rf) {
    Object.assign(st, { kind: 'h2', u: 1, rf, f: 1, tw: 0.35, hole: 0, fill: 1, nPow: 3, lateA: 1, late: 1, cross: 0, expoW: 1, wash: 0, exW: 1, fillLayer: 0 });
  }
  const LERP_KEYS = ['f', 'tw', 'hole', 'fill', 'nPow', 'lateA', 'late', 'cross', 'expoW', 'wash', 'exW', 'fillLayer'];
  const restTmp = {};
  const rfOfScale = s => REST_R + (1 - REST_R) * Math.min(1, Math.max(0, (s - 0.7) / 0.35));

  /**
   * Фаза приложения → состояние цветка. Размер меняется равномерно всю фазу; эффекты ролика идут по
   * «времени ролика» uw: вдох 0…0.6, выдох 0…0.74. Начало вдоха плавно выходит из паузы, конец выдоха равен паузе.
   * type: 'inhale' | 'topup' | 'exhale' | 'hold' | 'other'
   */
  function stateFor(st, type, u, startScale, endScale) {
    const a = rfOfScale(startScale), b = rfOfScale(endScale);
    if (type === 'inhale' || type === 'topup') {
      const uw = 0.6 * u;
      st.kind = 'in'; st.u = uw;
      st.rf = lerp(a, b, smooth(0, 1, u));
      st.f = 0.7 * (1 - smooth(0.45, 0.95, st.rf));
      st.tw = 0.35 * (1 - smooth(0.1, 0.5, uw)); st.hole = 0; st.fill = 0;
      st.nPow = 1.4; st.lateA = 0; st.late = 0; st.cross = 0;
      st.expoW = 0; st.wash = 1; st.exW = 0; st.fillLayer = 0;
      if (type === 'inhale') {
        setRest(restTmp, st.rf);
        const k = smooth(0, 0.25, u);
        for (const key of LERP_KEYS) st[key] = lerp(restTmp[key], st[key], k);
      }
    } else if (type === 'exhale') {
      const uw = 0.74 * u;
      st.kind = 'out'; st.u = uw;
      st.rf = lerp(a, b, smooth(0, 1, u));
      st.f = 0.55 * smooth(0.08, 0.2, uw) + 0.45 * smooth(0.34, 0.46, uw);
      st.hole = smooth(0.05, 0.17, uw) * (1 - smooth(0.32, 0.42, uw));
      st.tw = 0.35 * smooth(0.1, 0.3, uw);
      st.fill = smooth(0.17, 0.3, uw);
      st.nPow = 3;
      st.lateA = smooth(0.28, 0.46, uw);
      st.late = smooth(0.3, 0.44, uw);
      st.cross = smooth(0.28, 0.42, uw) * (1 - smooth(0.6, 0.72, uw));
      st.expoW = 1; st.wash = 0; st.exW = 1;
      // «Облако без краёв» выключено — заливка центра в полную силу (в стенде множитель 1 вместо 0.35)
      st.fillLayer = st.fill * (1 - smooth(0.28, 0.46, uw));
    } else if (a >= 0.6) setTop(st, a);
    else setRest(st, a);
  }

  // ───── Спрайты и градиенты (пересобираются при смене палитры) ─────
  let palette = null, paletteKey = '';
  let sprites = [];
  const G = {};

  function gradientCanvas(cols, pos) {
    const c = document.createElement('canvas');
    c.width = c.height = SPRITE;
    const g = c.getContext('2d');
    const r = SPRITE / 2;
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    for (let i = 0; i < cols.length; i++) grd.addColorStop(pos[i], cols[i]);
    g.fillStyle = grd; g.fillRect(0, 0, SPRITE, SPRITE);
    return c;
  }
  /** Лепесток для сложения: ровный диск с лёгким светлым центром; soft — степень размытия */
  function makeSprite(rgb, soft) {
    const sharp = [[0, 0.80, 0.25], [0.15, 0.78, 0.2], [0.26, 0.75, 0.1], [0.80, 0.70, 0], [0.90, 0.20, 0], [0.96, 0, 0]];
    const softS = [[0, 0.5, 0.3], [0.2, 0.42, 0.18], [0.45, 0.24, 0.05], [0.7, 0.09, 0], [0.88, 0.02, 0], [1, 0, 0]];
    const pos = [], cols = [];
    for (let k = 0; k < 6; k++) {
      let p = Math.min(1, lerp(sharp[k][0], softS[k][0], soft));
      if (k > 0 && p <= pos[k - 1]) p = Math.min(1, pos[k - 1] + 0.0001);
      pos.push(p);
      cols.push(rgba(mixRgb(rgb, 0xffffff, lerp(sharp[k][2], softS[k][2], soft)), lerp(sharp[k][1], softS[k][1], soft)));
    }
    return gradientCanvas(cols, pos);
  }

  function setPalette(p, key) {
    if (paletteKey === key && palette) return;
    palette = p; paletteKey = key;
    // Расфокус выключен: нужна только резкая ступень спрайтов (как в стенде lvl = 0)
    sprites = p.bands.map(b => [makeSprite(b, 0)]);
    const g = (cols, pos) => ({ cols, pos });
    const hc = p.haze;
    const cc = mixRgb(hc, p.bands[5], 0.2);
    G.haze = g([rgba(cc, 1), rgba(cc, 0.8), rgba(cc, 0.35), rgba(cc, 0)], [0, 0.55, 0.8, 1]);
    const xc = mixRgb(hc, p.bands[5], 0.15);
    G.cross = g([rgba(xc, 0.22), rgba(xc, 0.42), rgba(xc, 0.3), rgba(xc, 0)], [0, 0.3, 0.65, 1]);
    G.fringe = g([rgba(hc, 0), rgba(hc, 0.1), rgba(hc, 0.38), rgba(hc, 0.18), rgba(hc, 0)], [0, 0.6, 0.82, 0.92, 1]);
    const bc = mixRgb(hc, p.bands[4], 0.6);
    G.base = g([rgba(bc, 0.5), rgba(bc, 0.58), rgba(bc, 0.66), rgba(bc, 0)], [0, 0.5, 0.8, 1]);
    const ic = p.bands[2];
    G.fill = g([rgba(ic, 0.8), rgba(ic, 0.78), rgba(ic, 0.4), rgba(ic, 0)], [0, 0.6, 0.85, 1]);
    G.hole = g(['rgba(0,0,0,0.6)', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0)'], [0, 0.35, 1]);
    G.wash = g(['rgba(235,232,255,0.95)', 'rgba(215,220,255,0.75)', 'rgba(200,215,255,0)'], [0, 0.6, 1]);
    G.core = g(['rgba(245,238,255,0.8)', 'rgba(225,215,255,0.55)', 'rgba(210,200,255,0)'], [0, 0.5, 1]);
    G.red = g(['rgba(255,50,60,0.85)', 'rgba(255,50,60,0.4)', 'rgba(255,50,60,0)'], [0, 0.55, 1]);
    G.blue = g(['rgba(40,120,255,0.45)', 'rgba(40,120,255,0)'], [0, 1]);
    for (const k in G) G[k].grad = null;   // градиенты создаются в контексте холста при первой отрисовке
  }

  // ───── Отрисовка ─────
  let spin = 0, lastT = 0;

  /** Градиент единичного радиуса, растянутый на r; общая прозрачность — через globalAlpha */
  function radial(c, g, x, y, r, alpha) {
    if (alpha <= 0.003 || r <= 0) return;
    if (!g.grad) {
      g.grad = c.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.cols.forEach((col, i) => g.grad.addColorStop(g.pos[i], col));
    }
    c.save(); c.translate(x, y); c.scale(r, r);
    c.globalAlpha = Math.min(1, alpha);
    c.fillStyle = g.grad; c.fillRect(-1, -1, 2, 2);
    c.restore();
  }

  /** Цветок с центром (0,0) на уже сдвинутом холсте; rmax — полный радиус, t — время, мс */
  function draw(c, st, rmax, t) {
    if (!palette) return;
    const dt = lastT ? Math.min(t - lastT, 100) / 1000 : 0;
    lastT = t;
    spin += dt * 0.12;

    const rf = st.rf, f = P.defocus ? st.f : 0, tw = st.tw, hole = st.hole, fill = st.fill;
    const expoIn = smooth(0.35, 0.95, rf), expoOut = smooth(0.15, 0.62, rf);
    const R = rmax * rf;
    const expo = 1 + 3.5 * (1 - lerp(expoIn, expoOut, st.expoW));
    c.globalCompositeOperation = 'lighter';

    // Дымка: «облачко» объёма, на выдохе — шире
    radial(c, G.haze, 0, 0, R * 1.6 + rmax * 0.23, 0.04 + 0.5 * f);
    // «Ромб» дымки: два вытянутых по диагоналям пятна
    if (st.cross > 0.02) {
      const dr = R * 1.3 + rmax * 0.68;
      for (let k = 0; k < 2; k++) {
        c.save(); c.rotate(spin * 1.6 + 0.75 + k * Math.PI / 2); c.scale(1, 0.5);
        radial(c, G.cross, 0, 0, dr, st.cross);
        c.restore();
      }
    }
    // Густо-синяя кайма у края цветка
    radial(c, G.fringe, 0, 0, R * 1.2, 1);
    // Подложка под узором точек
    radial(c, G.base, 0, 0, R * 0.92, smooth(0.55, 0.95, rf) * (1 - f * 0.6));
    // Центр, залитый светом на выдохе
    radial(c, G.fill, 0, 0, R * 0.95, st.fillLayer);

    // ── Лепестки (сложение света) ──
    const n = Math.max(3, P.count * Math.pow(rf, st.nPow));
    const drawCount = Math.ceil(n);
    const breathe = 1 + 0.012 * Math.sin(t / 1000 * 1.7);
    const minDisc = rmax * 0.011;
    const alpha = P.gain * 1.3 * (1 + (expo - 1) * 0.3) * (1 + 0.4 * f + 0.8 * fill) * (1 - 0.5 * st.lateA);
    const area = 2 * Math.PI * P.gamma / n;
    const blurPx = f * rmax * 0.085;
    for (let i = 0; i < drawCount; i++) {
      const m = n - i;
      if (m <= 0) continue;
      const u = m / n;
      const rr = R * Math.pow(u, P.gamma) * breathe;
      const ang = -i * GOLDEN + spin + tw * Math.pow(1 - u, 1.5);
      const x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
      const sp = R * Math.sqrt(area * Math.pow(u, 2 * P.gamma - 1));
      const q = P.dot + (P.petal - P.dot) * smooth(0.3, 0.85, u);
      let dr = sp * q;
      if (dr < minDisc) dr = minDisc;
      const fade = smooth(0, 1.2, m);
      const d = (dr + blurPx) / 0.96;
      const cover = 1 / (1 + 2.6 * q * q);
      const holeK = 1 - hole * 0.3 * (1 - smooth(0.04, 0.25, u));
      const edgeDim = 1 - 0.55 * Math.min(1, (expo - 1) / 2) * smooth(0.4, 0.9, u);
      const exDim = lerp(1, (1 - 0.5 * f * smooth(0.45, 1, u)) * (1 - 0.6 * fill * (1 - smooth(0.55, 0.9, u))), st.exW);
      let a = Math.min(1, alpha * cover * fade * holeK * edgeDim * exDim * (1 - 0.25 * Math.pow(u, 4)));
      a *= dr / (dr + blurPx * 0.8);
      if (a <= 0.004) continue;
      c.globalAlpha = a;
      c.drawImage(sprites[Math.min(5, (u * 6) | 0)][0], x - d, y - d, d * 2, d * 2);
    }
    c.globalAlpha = 1;

    // Тёмная воронка в центре на выдохе
    if (hole > 0.01) {
      c.globalCompositeOperation = 'destination-out';
      radial(c, G.hole, 0, 0, R * 0.42, hole);
      c.globalCompositeOperation = 'lighter';
    }
    // Пересвет маленького шара на вдохе
    if (st.wash > 0.01 && expo > 1.02) radial(c, G.wash, 0, 0, R * 0.98, Math.min(1, 0.6 * (expo - 1) / 3.5) * st.wash);
    // Белое ядро в точке покоя
    const core = 1 - smooth(REST_R, 0.3, rf);
    radial(c, G.core, 0, 0, rmax * (0.11 + 0.05 * core), core);
    // Блики камеры: красный «хвост» и синий ореол
    const k = 1 - smooth(REST_R + 0.02, 0.4, rf);
    if (k > 0.01) {
      const dir = 2.75, off = rmax * 0.24;
      radial(c, G.red, Math.cos(dir) * off, Math.sin(dir) * off * 0.5, rmax * 0.3, k);
      radial(c, G.blue, -Math.cos(dir) * off * 0.6, -Math.sin(dir) * off * 0.3, rmax * 0.14, k);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  // ───── Холст на странице и свой цикл кадров ─────
  const RMAX = 100;                  // полный радиус цветка, CSS px (кольцо — 127.5)
  const HALF = Math.ceil(RMAX * 2.3);
  let canvas = null, ctx = null, dpr = 1;
  let enabled = false, running = false, lastFrame = 0;
  const state = newState();
  /** Фаза практики задаётся из updateAnimation; null — брать масштаб шара из CSS (пауза, финиш) */
  let phase = null;
  let scaleOf = () => 0.7, isVisible = () => false;

  function ensureCanvas(host) {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'flower-canvas';
    canvas.style.width = canvas.style.height = HALF * 2 + 'px';
    canvas.style.marginLeft = canvas.style.marginTop = -HALF + 'px';
    canvas.style.mixBlendMode = 'plus-lighter';
    canvas.style.opacity = '0.85';   // на цветном фоне свет складывается с ним — шар чуть тише, чем на чёрном
    host.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }
  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = canvas.height = Math.round(HALF * 2 * dpr);
    for (const k in G) G[k].grad = null;
  }

  function frame(t) {
    running = false;
    if (!enabled) return;
    if (!isVisible()) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    running = true;
    requestAnimationFrame(frame);
    if (FpsCap.skip(lastFrame, t)) return;
    lastFrame = t;
    if (phase) stateFor(state, phase.type, phase.u, phase.start, phase.end);
    else { const s = scaleOf(); stateFor(state, 'hold', 1, s, s); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, HALF * dpr, HALF * dpr);
    draw(ctx, state, RMAX, t);
  }

  return {
    WATCH, fromTheme,
    /** host — обёртка шара; scale() — текущий масштаб шара; visible() — виден ли экран практики */
    init(host, scale, visible) { ensureCanvas(host); scaleOf = scale; isVisible = visible; },
    /** style: 'flower' | 'flowerTheme' | 'classic'; themeRgb — основной цвет темы 0xRRGGBB */
    setStyle(style, themeRgb) {
      enabled = style !== 'classic';
      if (canvas) canvas.style.display = enabled ? '' : 'none';
      if (style === 'flower') setPalette(WATCH, 'watch');
      else if (enabled) setPalette(fromTheme(themeRgb), 'theme-' + themeRgb);
      this.kick();
    },
    setPhase(type, u, start, end) { phase = { type, u, start, end }; },
    clearPhase() { phase = null; },
    kick() { if (enabled && canvas && !running) { running = true; lastT = 0; requestAnimationFrame(frame); } },
    params: P
  };
})();
