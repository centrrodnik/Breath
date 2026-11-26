// ═══════════ РЕЖИМ РАЗРАБОТЧИКА, САЛЮТ, «О ПРИЛОЖЕНИИ» (перенос из «Дыхания 2.3») ═══════════
// Код: «Свой режим» → четыре ползунка на комбинацию → 5 быстрых тапов по «Повторения».
// После любого кода ползунки плавно возвращаются к значениям до набора — это ещё и техника пользователя.
// Функции и элементы главного скрипта (customIn, Store, showDialog…) берутся в момент вызова.

/** Салют (2-0-2-7): 6 залпов, искры цветов темы и белые, падают под тяжестью и гаснут */
const Fireworks = (() => {
  let cv = null, ctx = null, rockets = [], sparks = [], start = 0, last = 0, onDone = null, running = false, dpr = 1;
  const glow = new Map();
  /** Готовая светящаяся точка нужного цвета: на кадре только копирование */
  function sprite(color) {
    if (glow.has(color)) return glow.get(color);
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, '#fff'); grd.addColorStop(0.18, color); grd.addColorStop(0.45, color.replace('rgb(', 'rgba(').replace(')', ', 0.35)')); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
    glow.set(color, c);
    return c;
  }
  function burst(rk) {
    const n = 55 + Math.floor(Math.random() * 20);
    const speed = 2.2 + Math.random() * 1.2;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + Math.random() * 0.2;
      const v = speed * (0.55 + 0.45 * Math.random());
      const life = 55 + Math.random() * 35;
      sparks.push({ x: rk.x, y: rk.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life,
        img: sprite(Math.random() < 0.18 ? 'rgb(255, 255, 255)' : rk.color), size: 7 + Math.random() * 5 });
    }
  }
  function frame(t) {
    if (!running) return;
    if (FpsCap.skip(last, t)) { requestAnimationFrame(frame); return; }
    const W = innerWidth, H = innerHeight;
    if (!start) { start = t; last = t; }
    const dt = Math.min((t - last) / 16.667, 4); last = t;
    for (const rk of rockets) {
      if (rk.exploded || t < rk.at) continue;
      rk.y += rk.vy * dt; rk.vy += 0.1 * dt;
      if (rk.vy >= -1.2 || rk.y < H * 0.18) { rk.exploded = true; burst(rk); }
    }
    const drag = Math.pow(0.975, dt);
    sparks = sparks.filter(s => {
      s.vx *= drag; s.vy = s.vy * drag + 0.045 * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      return s.life > 0;
    });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const rk of rockets) {
      if (rk.exploded || t < rk.at) continue;
      const img = sprite(rk.color);
      ctx.globalAlpha = 0.9; ctx.drawImage(img, rk.x - 6, rk.y - 6, 12, 12);
      ctx.globalAlpha = 0.45; ctx.drawImage(img, rk.x - 4, rk.y - rk.vy * 2.5 - 4, 8, 8);   // короткий хвост
    }
    for (const s of sparks) {
      const k = s.life / s.max;
      const flick = k < 0.3 && Math.random() < 0.25 ? 0.3 : 1;
      ctx.globalAlpha = Math.min(1, k * 1.6) * flick;
      ctx.drawImage(s.img, s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
    }
    ctx.globalAlpha = 1;
    if (sparks.length || rockets.some(r => !r.exploded)) requestAnimationFrame(frame);
    else { running = false; ctx.clearRect(0, 0, W, H); const cb = onDone; onDone = null; if (cb) cb(); }
  }
  return {
    /** colors — 'rgb(r, g, b)'; done — когда погаснет последняя искра */
    // 2.9: count/stepMs — новогодний салют 15 залпов × ~620 мс (~10 с); иногда два залпа почти разом
    launch(colors, done, count = 6, stepMs = 650) {
      cv = cv || document.getElementById('fireworks-canvas');
      ctx = ctx || cv.getContext('2d');
      dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
      const H = innerHeight, W = innerWidth, now = performance.now();
      rockets = [];
      for (let i = 0; i < count; i++) {
        // скорость подбирается так, чтобы ракета раскрывалась на ~20–35 % высоты окна
        const top = H * (0.2 + 0.15 * Math.random());
        rockets.push({ x: W * (0.18 + 0.64 * Math.random()), y: H + 10, vy: -Math.sqrt(2 * 0.1 * (H + 10 - top)), color: colors[i % colors.length], at: now + i * stepMs + Math.random() * 250 - (count > 6 && i % 4 === 3 ? stepMs / 2 : 0) });
      }
      sparks = []; start = 0; last = 0; onDone = done || null;
      if (!running) { running = true; requestAnimationFrame(frame); }
    }
  };
})();

const DevMode = (() => {
  const sliders = () => [customIn, customHold1, customOut, customHold2];
  const values = () => sliders().map(s => parseInt(s.value, 10) || 0);
  let prev = [4, 4, 4, 4], before = [4, 4, 4, 4], lastChange = 0, toastTimer = null;

  /** Снимок «Своего режима» после загрузки и после возврата ползунков */
  function snapshot() { prev = values(); before = prev.slice(); lastChange = 0; }
  /** Каждый шаг ползунка: после 30 с покоя новое движение начинает новый «набор» */
  function track() {
    const n = performance.now();
    if (n - lastChange > 30000) before = prev.slice();
    lastChange = n;
    prev = values();
  }
  /** Ползунки плавно, по шагу, возвращаются к значениям до набора кода */
  function restore() {
    const target = before.slice();
    if (values().every((v, i) => v === target[i])) { snapshot(); return; }
    const step = () => {
      let moving = false;
      sliders().forEach((s, i) => {
        const v = parseInt(s.value, 10) || 0;
        if (v !== target[i]) { s.value = v + (target[i] > v ? 1 : -1); moving = true; }
      });
      updateSliderLabels();
      if (moving) { setTimeout(step, 35); return; }
      drawClockNotches(); updateMaxSessionTimePreview(); saveSettings();
      snapshot();
    };
    setTimeout(step, 500);
  }

  function toast(text) {
    const el = document.getElementById('dev-toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }
  function vibrate(p) { if (vibrateToggle.checked && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} } }
  /** Подтверждение: вибро, тон-чаша (если звук включён) и плашка внизу */
  function ack(text, on = true) {
    vibrate(on ? [20, 40, 20] : 40);
    playTone(on ? 587 : 293, 250);
    toast(text);
  }
  const onOff = v => v ? 'вкл' : 'выкл';
  const effectsNote = () => ambientToggle.checked ? '' : ' (включите «Эффекты»)';

  /** Салют: меню растворяется, чтобы не закрывать искры, и возвращается, когда погаснет последняя */
  function salute() {
    const hide = !State.active && controlsForm.style.display !== 'none' && controlsForm.style.opacity !== '0.05';
    if (hide) {
      controlsForm.style.transition = 'opacity 0.8s ease';
      controlsForm.style.opacity = '0';
      controlsForm.style.pointerEvents = 'none';
    }
    const colors = CUSTOM_THEMES[themeSelect.value || 'ocean'].slice(0, 3).map(c => 'rgb(' + parseColorStr(c).join(', ') + ')');
    colors.push('rgb(255, 255, 255)');
    Fireworks.launch(colors, () => {
      if (hide && !State.active && controlsForm.style.opacity === '0') {
        controlsForm.style.transition = 'opacity 1.2s ease';
        controlsForm.style.opacity = '1';
        controlsForm.style.pointerEvents = '';
        setTimeout(() => { if (controlsForm.style.opacity === '1') { controlsForm.style.opacity = ''; controlsForm.style.transition = ''; } }, 1300);
      }
    });
    if (soundToggle.checked) for (let i = 0; i < 6; i++) setTimeout(() => playTone(880 + i * 110, 120), 1900 + i * 650);
  }

  function setSnow(snow, rainbow) {
    isSnowActivatedBySecret = snow; isRainbowSnow = rainbow;
    const t = document.getElementById('snow-trigger');
    if (t) t.innerHTML = Icons.svg(snow || rainbow ? 'snowflake' : 'lotus');
    updateAmbientEffects();
  }

  function setUnlockAll(on) {
    Store.flags.unlockAll = on; Store.save();
    if (on) addSpaceOption();
    else if (!spaceBySecret) {
      if (themeSelect.value === 'space') { themeSelect.value = 'ocean'; themeSelect.dispatchEvent(new Event('change')); }
      const sp = themeSelect.querySelector('option[value="space"]');
      if (sp) sp.remove();
    }
    refreshThemeLocks();
    // Выключили — закрытая тема возвращается к «Океану»
    const cur = themeSelect.options[themeSelect.selectedIndex];
    if (!on && cur && cur.dataset.locked === 'true') { themeSelect.value = 'ocean'; themeSelect.dispatchEvent(new Event('change')); }
  }

  function showCodes() {
    const f = Store.flags;
    const rows = [
      ['1-0-1-0', 'счётчик FPS — ' + onOff(f.showFps)],
      ['20-20-20-20', 'все темы открыты — ' + onOff(f.unlockAll)],
      ['2-0-2-7', 'салют'],
      ['7-7-7-7', 'Храмовый хранитель'],
      ['3-0-3-0', '30 FPS — ' + onOff(f.fpsCap === 30)],
      ['5-5-5-5', 'снег — ' + onOff(isSnowActivatedBySecret)],
      ['5-5-4-4', 'радужный снег — ' + onOff(isRainbowSnow)],
      ['1-3-9-3', 'тайное послание'],
      ['8-8-8-8', 'просмотр напоминаний'],
      ['1-2-3-1', 'праздники (снег, гирлянда, новогодняя заставка) — ' + onOff(!!f.holidayTest)],
      ['1-1-1-1', 'этот список']
    ];
    showDialog({ icon: 'sliders', title: 'Режим разработчика',
      text: '«Свой режим» → ползунки на код → 5 тапов по «Повторения».\n\n' + rows.map(r => r[0] + '   ' + r[1]).join('\n'),
      buttons: [{ label: 'Понятно', value: true, kind: 'primary' }] });
  }

  const CODES = {
    '1-1-1-1': () => { vibrate([20, 40, 20]); showCodes(); },
    '1-0-1-0': () => {
      Store.flags.showFps = !Store.flags.showFps; Store.save();
      if (typeof window.setFpsMeter === 'function') window.setFpsMeter(Store.flags.showFps);
      ack('Счётчик FPS: ' + onOff(Store.flags.showFps), Store.flags.showFps);
    },
    '20-20-20-20': () => {
      const on = !Store.flags.unlockAll;
      setUnlockAll(on);
      ack(on ? 'Все темы открыты' : 'Темы снова по минутам практики', on);
    },
    '2-0-2-7': () => { ack('Салют!'); setTimeout(salute, 600); },
    '7-7-7-7': () => {
      ack('Храмовый хранитель');
      // чуть позже: последнее касание уже обработано и не «разбудит» меню
      setTimeout(() => { if (typeof activateTempleKeeper === 'function') activateTempleKeeper(); }, 800);
    },
    '3-0-3-0': () => {
      const on = Store.flags.fpsCap !== 30;
      Store.flags.fpsCap = on ? 30 : 60; Store.save();
      FpsCap.set(on ? 30 : 0);
      ack(on ? 'Режим 30 FPS' : 'Режим 60 FPS', on);
    },
    '5-5-5-5': () => { const on = !isSnowActivatedBySecret; setSnow(on, false); ack('Снег: ' + onOff(on) + (on ? effectsNote() : ''), on); },
    '5-5-4-4': () => { const on = !isRainbowSnow; setSnow(false, on); ack('Радужный снег: ' + onOff(on) + (on ? effectsNote() : ''), on); },
    // Тайный код (в списке 1-1-1-1 его нет): заставка и обучение при запуске
    '9-9-9-9': () => {
      const off = !!Store.flags.introOff;
      showDialog({ tone: 'warn', icon: 'sliders',
        title: off ? 'Включить заставку и обучение?' : 'Отключить заставку и обучение?',
        text: off ? 'При следующем запуске снова появятся заставка «Родник» и обучение — как при самом первом запуске.'
                  : 'Заставка «Родник» и стартовое обучение перестанут показываться при запуске приложения.\nВернуть их можно этим же кодом.',
        buttons: [{ label: 'Отмена', value: false, kind: 'ghost' }, { label: off ? 'Включить' : 'Отключить', value: true, kind: 'primary' }] })
        .then(ok => {
          if (!ok) return;
          Store.flags.introOff = !off;
          if (off) Store.flags.tutorialDone = false;   // включили — обучение покажется снова
          Store.flush();
          ack(off ? 'Заставка и обучение включены' : 'Заставка и обучение отключены', off);
        });
    },
    // ПК 2.8: напоминание сразу — утро / день / вечер / все три (только в Дыхание.exe)
    '8-8-8-8': () => { vibrate([20, 40, 20]); V24.reminderPreview(); },
    // 2.9: проверка праздников — снег и гирлянда как в сезон и сразу новогодняя заставка с салютом
    '1-2-3-1': () => {
      const on = !Store.flags.holidayTest;
      Store.flags.holidayTest = on;
      if (on) { Store.flags.holidaySnow = true; Store.flags.holidayGarland = true; }
      Store.flush();
      V24.applyHoliday(); updateAmbientEffects();
      ack(on ? 'Праздники: вкл — смотрите заставку' : 'Праздники: выкл', on);
      if (on) setTimeout(() => { if (!State.active) V24.playSplash(true); }, 900);
    },
    '1-3-9-3': () => {
      vibrate([30, 100, 30]);
      playTone(528, 400);
      showDialog({ tone: 'cosmic', icon: 'sparkle', title: 'Вы нашли тайное послание',
        text: 'Каждый вдох — маленькое начало, каждый выдох — маленькое отпускание.\nВы уже умеете самое важное: дышать. Остальное приложится.',
        buttons: [{ label: 'Спасибо', value: true, kind: 'primary' }] });
    }
  };

  /** 5 быстрых тапов по «Повторения» в «Своём режиме» */
  function onTrigger() {
    if (patternSelect.value !== 'custom') return;
    const fn = CODES[values().join('-')];
    if (!fn) return;   // неверный код — тишина
    restore();
    fn();
  }

  return { snapshot, track, onTrigger, toast };
})();

/** «О приложении» — отдельная страница (v24.js) */
function showAbout() { V24.openAbout(); }