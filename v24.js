'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  «Дыхание» 2.4 для ПК — то, что появилось в версии 2.4 на Android:
//  заставка «Родник», стартовое обучение, страница «О приложении», ползунки громкости
//  в практике, звуки природы (дождь, птицы, костёр), голос из записей, общая шина эффектов
//  с «эквалайзером» пауз, подсказка по горячим клавишам (F1).
//  Глобальные Store, State, audioCtx, themeSelect… берутся из index.html в момент вызова.
// ═══════════════════════════════════════════════════════════════════════════
const V24 = (() => {
  const $ = id => document.getElementById(id);
  const S = () => Store.settings;
  const vol = (k, def = 0) => (typeof S()[k] === 'number' ? S()[k] : def);
  const setVol = (k, v) => { S()[k] = v; Store.save(); };
  const uiScale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
  const themeRgb = () => parseColorStr(CUSTOM_THEMES[themeSelect.value || 'ocean'][0]);
  /** Тёмные цвета темы (Магма, Киберпанк) высветлены, чтобы читались на тёмном стекле */
  function readable([r, g, b]) {
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const k = Math.min(0.5, Math.max(0, (0.55 - lum) / 0.55));
    return [r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k].map(Math.round);
  }
  /** Цвет темы, если включён фон; иначе null — стандартный серый */
  const tint = () => (auroraToggle.checked ? readable(themeRgb()) : null);
  const rgba = (c, a) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
  const ctx = () => { initAudioContext(); return audioCtx; };

  // ═══════════ Шина эффектов (2.7): движок synth.js (море, тон, природа, приглушение пауз внутри) и звуки фаз →
  //             общая громкость fxVol → динамики. Свой трек — отдельно, своим ползунком (как на Android 2.5) ═══════════
  // 2.8: fxVol — положение ползунка; громкость = FX_MAX · положение^FX_CURVE (верх +30 %, внизу шаги мельче)
  const FX_MAX = 1.3, FX_CURVE = 1.25;
  const fxGain = pos => FX_MAX * Math.pow(Math.max(0, Math.min(1, pos)), FX_CURVE);
  /** Положение по умолчанию ≈ 0.81 = прежняя полная громкость */
  const FX_DEF = Math.pow(1 / FX_MAX, 1 / FX_CURVE);
  const fxPos = () => vol('fxVol', FX_DEF);
  let bus = null;
  function ensureBus() {
    const c = ctx();
    if (!bus || bus.c !== c) {
      const master = c.createGain();
      master.gain.value = fxGain(fxPos());
      master.connect(c.destination);
      bus = { c, master };
    }
    Synth.attach(c, bus.master);
    return bus;
  }
  /** Вход общей громкости эффектов (для совместимости со старыми вызовами) */
  function busInput() { return ensureBus().master; }
  /** Звуки фаз и финальный аккорд — под общей громкостью, мимо приглушения пауз */
  function fxOut() { return ensureBus().master; }
  function setMaster(v) { setVol('fxVol', v); if (bus) bus.master.gain.setTargetAtTime(fxGain(v), bus.c.currentTime, 0.05); }

  // ═══════════ «Звук фаз» (2.9): свой ползунок; громкость = (положение / 0.8)², 0.8 — прежняя ═══════════
  const PHASE_DEF = 0.8;
  const phasePos = () => vol('phaseVol', PHASE_DEF);
  const phaseGain = () => { const k = phasePos() / PHASE_DEF; return k * k; };
  let phaseNodes = null;
  /** Вход звуков фаз и аккорда: под общей громкостью эффектов; direct — мимо неё (аккорд Хранителя) */
  function phaseOut(direct) {
    const c = ctx(), b = ensureBus();
    if (!phaseNodes || phaseNodes.c !== c || phaseNodes.bus !== b) {
      const a = c.createGain(), d = c.createGain();
      a.connect(b.master); d.connect(c.destination);
      phaseNodes = { c, bus: b, a, d };
    }
    const g = phaseGain(); phaseNodes.a.gain.value = g; phaseNodes.d.gain.value = g;
    return direct ? phaseNodes.d : phaseNodes.a;
  }
  /** Ползунок фаз сдвинули: скрытый sound-toggle (на него опирается старый код) = «не на нуле» */
  let lastPhasePreview = 0;
  function setPhase(v, preview) {
    const was = phasePos();
    setVol('phaseVol', v);
    soundToggle.checked = v > 0; saveSettings();
    if (phaseNodes) { const g = phaseGain(); phaseNodes.a.gain.setTargetAtTime(g, phaseNodes.c.currentTime, 0.03); phaseNodes.d.gain.setTargetAtTime(g, phaseNodes.c.currentTime, 0.03); }
    if (preview && v > 0 && !State.running) {
      if (was <= 0) { playFinalChord(); lastPhasePreview = performance.now(); }
      else if (performance.now() - lastPhasePreview > 1200) { lastPhasePreview = performance.now(); playTone(523, 250); }
    }
  }

  /** Глубина приглушения на паузах (2.7: только легчайшее затухание) */
  const PAUSE_DEPTH = 0.1;
  let pauseM = -1;
  /** Каждый кадр практики: колокол 0.5 − 0.5·cos(2πu) по ходу паузы, пик в середине */
  function setPauseMuffle(m) {
    m *= PAUSE_DEPTH;
    if (Math.abs(m - pauseM) < 0.001 && !(m === 0 && pauseM !== 0)) return;
    pauseM = m;
    Synth.muffle(m); Synth.noiseMuffle(m);
  }
  function onFrame(pt, u) { setPauseMuffle(pt === 'hold' ? 0.5 - 0.5 * Math.cos(2 * Math.PI * u) : 0); }

  // ═══════════ Звуки природы — Synth.RainBed / BirdsBed / FireBed ═══════════
  const KEYS = ['rain', 'birds', 'fire'];   // индексы = Synth.BED_RAIN / BED_BIRDS / BED_FIRE
  const natActive = k => Synth.bedActive(KEYS.indexOf(k));
  function natStart(k, v) { if (v <= 0) return; ensureBus(); Synth.startBed(KEYS.indexOf(k), v); }
  function natStop(k, fade = 0.4) { Synth.stopBed(KEYS.indexOf(k), fade); }
  function natVolume(k, v) { Synth.setBedVolume(KEYS.indexOf(k), v); }
  const natVol = k => vol(k + 'Vol');
  function startNature() { for (const k of KEYS) natStart(k, natVol(k)); }
  function stopNature(fade) { for (const k of KEYS) natStop(k, fade); }

  // ═══════════ Голос: записи sounds/voice/<ключ>.wav + лёгкое эхо (VoiceFx: Freeverb, хвост 0.3 с, «мокрое» 1 %) ═══════════
  const VOICE_FX = { wet: 0.01, predelay: 0, tail: 0.3, room: 0.6, damp: 0.02 };
  function voiceReverb(c, buf) {
    const rate = buf.sampleRate, ch0 = buf.getChannelData(0), ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
    const x = new Float32Array(buf.length); for (let i = 0; i < x.length; i++) x[i] = (ch0[i] + ch1[i]) / 2;
    const pre = Math.floor(VOICE_FX.predelay / 1000 * rate), n = x.length + Math.floor(VOICE_FX.tail * rate), k = rate / 44100;
    const fb = VOICE_FX.room, damp = VOICE_FX.damp;
    function channel(spread) {
      const out = new Float32Array(n);
      const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(c => new Float64Array(Math.max(1, Math.floor((c + spread) * k))));
      const aps = [556, 441, 341, 225].map(c => new Float64Array(Math.max(1, Math.floor((c + spread) * k))));
      const ci = new Int32Array(8), ai = new Int32Array(4), st = new Float64Array(8);
      for (let i = 0; i < n; i++) {
        const src = i - pre, inp = src >= 0 && src < x.length ? x[src] * 0.015 : 0;
        let s = 0;
        for (let q = 0; q < 8; q++) { const b = combs[q], y = b[ci[q]]; st[q] = y * (1 - damp) + st[q] * damp; b[ci[q]] = inp + st[q] * fb; if (++ci[q] >= b.length) ci[q] = 0; s += y; }
        for (let a = 0; a < 4; a++) { const b = aps[a], bo = b[ai[a]], y = -s + bo; b[ai[a]] = s + bo * 0.5; if (++ai[a] >= b.length) ai[a] = 0; s = y; }
        out[i] = s;
      }
      return out;
    }
    const wl = channel(0), wr = channel(23);
    let ed = 0, ew = 0; for (const v of x) ed += v * v; for (let i = 0; i < n; i++) ew += (wl[i] * wl[i] + wr[i] * wr[i]) / 2;
    const g = ew > 0 ? Math.sqrt(VOICE_FX.wet * ed / ew) : 0, fade = Math.floor(0.15 * rate);
    const out = c.createBuffer(2, n, rate), l = out.getChannelData(0), r = out.getChannelData(1);
    let pk = 0;
    for (let i = 0; i < n; i++) {
      const dd = i < x.length ? x[i] : 0, f = i > n - fade ? (n - i) / fade : 1;
      l[i] = (dd + wl[i] * g) * f; r[i] = (dd + wr[i] * g) * f; pk = Math.max(pk, Math.abs(l[i]), Math.abs(r[i]));
    }
    if (pk > 0.99) { const s = 0.99 / pk; for (let i = 0; i < n; i++) { l[i] *= s; r[i] *= s; } }
    return out;
  }
  const voiceBufs = {};
  let voiceSrc = null;
  function loadVoice() {
    const c = ctx();
    for (const k of ['inhale', 'exhale', 'hold', 'prepare', 'finish']) {   // 2.9: «довдох» убран
      if (voiceBufs[k] !== undefined) continue;
      voiceBufs[k] = null;
      fetch('sounds/voice/' + k + '.wav').then(r => r.ok ? r.arrayBuffer() : Promise.reject())
        .then(b => c.decodeAudioData(b)).then(buf => {
          voiceBufs[k] = buf;   // до готовности эха играет исходная запись
          setTimeout(() => { try { voiceBufs[k] = voiceReverb(c, buf); } catch (e) {} }, 50);
        }).catch(() => {});
    }
  }
  // 2.8: «Слова голоса» — выключенные записи не звучат (Settings.voiceMuted: ключи через запятую)
  const VOICE_WORDS = [['prepare', 'Приготовьтесь', 'lotus'], ['inhale', 'Вдох', 'arrowUp'],
    ['hold', 'Пауза', 'pause'], ['exhale', 'Выдох', 'arrowDown'], ['finish', 'Завершение', 'trophy']];
  const voiceMuted = () => new Set((typeof S().voiceMuted === 'string' ? S().voiceMuted : '').split(',').filter(Boolean));
  /** Новая фраза обрывает предыдущую: на быстрых техниках голос не наслаивается. preview — проба, звучит всегда */
  function playVoice(k, preview) {
    const v = vol('voiceVol');
    if (v <= 0) return;
    if (!preview && voiceMuted().has(k)) return;
    const c = ctx(); loadVoice();
    const buf = voiceBufs[k]; if (!buf) return;
    if (voiceSrc) { try { voiceSrc.stop(); } catch (e) {} }
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf; g.gain.value = 0.8 * v * v;   // 2.8: ползунок по квадрату; 2.9: до упора — 80 % прежней («очень громкий»)
    src.connect(g); g.connect(c.destination); src.start();
    voiceSrc = src;
  }
  // ═══════════ Фейдеры меню: голос и природа ═══════════
  const FADERS = [['phase-fader', 'phaseVol'], ['voice-fader', 'voiceVol'], ['rain-fader', 'rainVol'], ['birds-fader', 'birdsVol'], ['fire-fader', 'fireVol']];
  let lastVoicePreview = 0;
  function refreshFaders() {
    const c = auroraToggle.checked ? themeRgb() : [160, 160, 160];   // 2.7: без фона — нейтральный серый
    for (const [id, key] of FADERS) {
      const el = $(id); if (!el) continue;
      const v = key === 'phaseVol' ? phasePos() : vol(key);
      el.querySelector('.fader-fill').style.width = (v * 100) + '%';
      if (v > 0) {
        el.style.boxShadow = `0 0 ${Math.max(4, v * 22)}px ${rgba(c, Math.max(0.15, v * 0.8))}`;
        el.style.borderColor = rgba(c, Math.max(0.2, v * 0.6));
      } else { el.style.boxShadow = 'none'; el.style.borderColor = 'var(--glass-border)'; }
    }
  }
  function bindFaders() {
    for (const [id, key] of FADERS) {
      const el = $(id); if (!el) continue;
      bindFader(el, (e) => {
        const r = el.getBoundingClientRect();
        let v = ((e.clientX || r.left) - r.left) / r.width;
        if (v < 0.03) v = 0; if (v > 0.97) v = 1;
        if (key === 'phaseVol') { setPhase(v, true); refreshFaders(); return; }
        setVol(key, v);
        if (key === 'voiceVol') {
          if (v > 0 && !State.running && performance.now() - lastVoicePreview > 1500) { lastVoicePreview = performance.now(); playVoice('inhale', true); }
        } else {
          const k = key.replace('Vol', '');
          if (!State.running) { if (v > 0) natStart(k, v); else natStop(k); }
          else if (v > 0 && !natActive(k)) natStart(k, v);
          natVolume(k, v);
        }
        refreshFaders();
      }, () => key === 'phaseVol' ? phasePos() : vol(key));
    }
    refreshFaders();
  }

  // ═══════════ Ползунки громкости в практике: слева голос, справа эффекты и (левее) своё аудио ═══════════
  let railsEl = null, railTimer = null, railsShown = false;
  const rails = { voice: false, fx: false, track: false, phase: false };
  const railGet = k => k === 'voice' ? vol('voiceVol') : k === 'track' ? currentMp3Volume : k === 'phase' ? phasePos() : fxPos();
  function railSet(k, v) {
    if (k === 'voice') { setVol('voiceVol', v); refreshFaders(); }
    else if (k === 'phase') { setPhase(v, false); refreshFaders(); }   // 2.9: звук фаз — свой ползунок и в практике
    else if (k === 'track') {
      // Своё аудио — свой ползунок; общий ползунок эффектов его не трогает (2.5)
      currentMp3Volume = v; customAudioPlayer.volume = v;
      if (typeof updateMp3FaderView === 'function') updateMp3FaderView();
      saveSettings();
    } else setMaster(v);
    paintRails(); showRails();
  }
  function buildRails() {
    railsEl = document.createElement('div');
    railsEl.className = 'v24-rails';
    railsEl.innerHTML = `<div class="v24-rail left" data-k="voice"><div class="v24-rail-fill"></div><span class="v24-rail-ic">${Icons.svg('voiceWave')}</span></div>` +
      `<div class="v24-rail left2" data-k="phase"><div class="v24-rail-fill"></div><span class="v24-rail-ic">${Icons.svg('bell')}</span></div>` +
      `<div class="v24-rail right2" data-k="track"><div class="v24-rail-fill"></div><span class="v24-rail-ic">${Icons.svg('music')}</span></div>` +
      `<div class="v24-rail right" data-k="fx"><div class="v24-rail-fill"></div><span class="v24-rail-ic">${Icons.svg('leaf')}</span></div>`;
    document.body.appendChild(railsEl);
    railsEl.querySelectorAll('.v24-rail').forEach(el => {
      const k = el.dataset.k;
      const set = (y) => {
        const r = el.getBoundingClientRect();
        let v = (r.bottom - y) / r.height; v = Math.max(0, Math.min(1, v));
        if (v < 0.03) v = 0; if (v > 0.97) v = 1;
        railSet(k, v);
      };
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag'); set(e.clientY); });
      el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) set(e.clientY); });
      el.addEventListener('pointerup', () => el.classList.remove('drag'));
      el.addEventListener('click', (e) => e.stopPropagation());
      // ПК: колесо мыши над ползунком
      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        railSet(k, Math.max(0, Math.min(1, railGet(k) - Math.sign(e.deltaY) * 0.05)));
      }, { passive: false });
    });
  }
  function paintRails() {
    if (!railsEl) return;
    const c = tint();
    // 2.9: двое на одной стороне — друг над другом (рядом второй заходил на кольцо)
    railsEl.classList.toggle('pairL', rails.voice && rails.phase);
    railsEl.classList.toggle('pairR', rails.fx && rails.track);
    railsEl.querySelectorAll('.v24-rail').forEach(el => {
      const k = el.dataset.k, v = railGet(k);
      el.style.display = rails[k] ? '' : 'none';
      el.style.background = c ? rgba(c, 0.16) : 'rgba(255,255,255,0.08)';
      el.style.borderColor = c ? rgba(c, 0.35) : 'rgba(255,255,255,0.12)';
      const f = el.querySelector('.v24-rail-fill');
      f.style.height = (v * 100) + '%';
      f.style.background = c ? rgba(c, 0.5) : 'rgba(255,255,255,0.24)';
      el.querySelector('.v24-rail-ic').style.opacity = v > 0 ? '0.9' : '0.5';
    });
  }
  function setupRails() {
    rails.voice = vol('voiceVol') > 0;
    rails.fx = currentNoiseVolume > 0 || currentSineVolume > 0 || KEYS.some(k => natVol(k) > 0) || soundToggle.checked;
    rails.track = !!customAudioPlayer._objUrl;
    rails.phase = phasePos() > 0;
    paintRails();
  }
  function showRails() {
    if (!railsEl || !(State.running || State.preparing) || !(rails.voice || rails.fx || rails.track || rails.phase)) return;
    clearTimeout(railTimer);
    if (!railsShown) { railsShown = true; railsEl.classList.add('show'); }
    railTimer = setTimeout(hideRails, 4000);
  }
  function hideRails() {
    clearTimeout(railTimer);
    if (!railsShown || !railsEl) return;
    if (railsEl.querySelector('.drag')) { railTimer = setTimeout(hideRails, 4000); return; }
    railsShown = false; railsEl.classList.remove('show');
  }

  // ═══════════ Хуки практики (вызываются из index.html) ═══════════
  function onPhase(pt, durationMs) {
    if (pt === 'inhale') playVoice('inhale');
    else if (pt === 'exhale') playVoice('exhale');
    else if (pt === 'topup') playVoice('inhale');   // 2.9: «довдох» убран — звучит «вдох»
    else if (pt === 'hold' && durationMs >= 2000) playVoice('hold');   // на секундной паузе слово не успеет прозвучать
  }
  function onStart() {
    loadVoice();
    ensureBus(); startNature(); setupRails();
    if (State.idle) playVoice('prepare');
  }
  function onPause(keepAudio) { hideRails(); setPauseMuffle(0); if (!keepAudio) stopNature(1.5); }
  function onFinish() { playVoice('finish'); hideRails(); setPauseMuffle(0); stopNature(0.4); setTimeout(() => { sendReminder(); if (Store.stats.sessions >= 1) askReminderOnce(); }, 600); }
  function previews() { for (const k of KEYS) if (natVol(k) > 0 && !natActive(k)) natStart(k, natVol(k)); }
  // ═══════════ Меню на время заставки и «О приложении» ═══════════
  function menuFade(show, ms) {
    const f = controlsForm;
    f.style.transition = `opacity ${ms}ms ease`;
    f.style.opacity = show ? '1' : '0';
    f.style.pointerEvents = show ? '' : 'none';
    if (show) setTimeout(() => { if (f.style.opacity === '1') { f.style.opacity = ''; f.style.transition = ''; } }, ms + 50);
  }

  // ═══════════ Полоса ветра (2.9): сплошная однотонная лента, у концов — острие (перенос drawGustRibbon) ═══════════
  function ribbon(g, xs, ys, n, w) {
    if (n < 2) return;
    let total = 0;
    for (let i = 1; i < n; i++) total += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    if (total < 1) return;
    const tip = Math.min(0.18 * total, w * 6), lx = new Float32Array(n), ly = new Float32Array(n);
    let s = 0;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      if (i > 0) s += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let tx = xs[b] - xs[a], ty = ys[b] - ys[a];
      const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
      const k = Math.max(0, Math.min(1, s / tip, (total - s) / tip)), hw = w / 2 * Math.pow(k, 0.75);
      lx[i] = xs[i] - ty * hw; ly[i] = ys[i] + tx * hw;
      if (i === 0) g.moveTo(xs[i] + ty * hw, ys[i] - tx * hw); else g.lineTo(xs[i] + ty * hw, ys[i] - tx * hw);
    }
    for (let i = n - 1; i >= 0; i--) g.lineTo(lx[i], ly[i]);
    g.closePath(); g.fill();
  }

  // ═══════════ Заставка «Родник» (перенос SplashView 2.9) ═══════════
  // newYear — «С Новым годом!» и ~10 с салюта (1–7 января или код 1-2-3-1)
  function splash(done, newYear) {
    const cv = document.createElement('canvas');
    cv.className = 'v24-splash';
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    const logo = new Image(); logo.src = 'rodnik_logo.png';
    const glow = readable(themeRgb());
    const lines = newYear ? ['С Новым', 'годом!'] : ['Помогаем', 'людям'];
    const LETTERS_AT = 900, STEP = 80, IN = 650, PERIOD = 1700, FADE_OUT = newYear ? 10400 : 4100, OUT_LEN = 1400, BLOW = 0.42;
    const chars = [...lines.join('')], total = chars.length;
    // 2.9: каждый запуск — свой ветер; порывы налетают слева, из-за надписи, и сами сдувают буквы
    const rnd = Math.random;
    // 1.0 (правки 2.10): от 1 до 3 порывов случайно. Один — между строк (сдувает обе), два — по строке, три — третий в случайную
    const count = 1 + Math.floor(rnd() * 3);
    const rows = (count === 1 ? [2] : count === 2 ? [0, 1] : [0, 1, rnd() < 0.5 ? 0 : 1]).sort(() => rnd() - 0.5);
    const rowFy = row => row === 0 ? 0.25 + (rnd() - 0.5) * 0.35 : row === 1 ? 0.75 + (rnd() - 0.5) * 0.35 : 0.5 + (rnd() - 0.5) * 0.2;
    const gusts = Array.from({ length: count }, (_, i) => {
      const loop = rnd() < 0.5, life = 1.0 + rnd() * 0.3, v = 200 + rnd() * 90, rad = loop ? 10 + rnd() * 12 : 0;
      return { delay: i * 0.07 + rnd() * 0.08, fx: -0.12 - rnd() * 0.18, fy: rowFy(rows[i]),
        v, slope: (rnd() - 0.5) * 0.3, amp: 5 + rnd() * 10, kw: 2.0 + rnd() * 2.2, ph: rnd() * 6.28, life,
        loopAt: loop ? life * (0.3 + rnd() * 0.3) : -1, rad, loopDir: rnd() < 0.5 ? 1 : -1, loopLen: loop ? Math.PI * rad / v : 1,
        trail: 0.4 + rnd() * 0.2, op: 0.55 + rnd() * 0.25, width: 1.8 + rnd() * 0.9 };
    });
    // У каждой буквы свой «характер» срыва: дальность, подъём/опускание, поворот, разброс момента
    const jDx = chars.map(() => 0.7 + rnd() * 0.7), jDy = chars.map(() => (rnd() - 0.5) * 2), jRot = chars.map(() => (rnd() - 0.5) * 40), jT = chars.map(() => rnd() * 0.08);
    const GUSTS_END = Math.max(...gusts.map(q => q.delay + q.life + q.trail)) * 1000;
    const gustHead = (q, gt) => {
      let lx = 0, ly = 0;
      if (q.loopAt >= 0 && gt > q.loopAt) { const u = Math.min(1, (gt - q.loopAt) / q.loopLen), th = 2 * Math.PI * u; lx = q.rad * Math.sin(th); ly = -q.loopDir * q.rad * (1 - Math.cos(th)); }
      return [q.v * gt + lx, q.slope * q.v * gt + q.amp * (Math.sin(q.kw * gt + q.ph) - Math.sin(q.ph)) + ly];
    };
    const N = 36, gxs = new Float32Array(N + 1), gys = new Float32Array(N + 1);
    function drawGusts(ts, box, k) {
      for (const q of gusts) {
        const gt = ts - q.delay; if (gt <= 0) continue;
        const tEnd = Math.min(gt, q.life), tStart = Math.max(0, gt - q.trail);
        if (tEnd - tStart < 0.01) continue;
        const x0 = box.l + (box.r - box.l) * q.fx, y0 = box.t + (box.b - box.t) * q.fy, birth = Math.min(1, gt / 0.2);
        for (let i = 0; i <= N; i++) { const [hx, hy] = gustHead(q, tStart + (tEnd - tStart) * i / N); gxs[i] = x0 + hx * k; gys[i] = y0 + hy * k; }
        g.fillStyle = `rgba(255,255,255,${q.op * 0.75 * birth})`;
        ribbon(g, gxs, gys, N + 1, q.width * 1.5 * k);
      }
    }
    /** Порыв, который сорвёт букву: ближайший по высоте (раньше — в плюс); момент — когда его голова долетит до буквы */
    function hit(i, cx, cy, box, k) {
      let best = 0, bestScore = Infinity, bestT = 0;
      gusts.forEach((q, gi) => {
        const x0 = box.l + (box.r - box.l) * q.fx, y0 = box.t + (box.b - box.t) * q.fy;
        const gt = Math.max(0, (cx - x0) / (q.v * k)), [, hy] = gustHead(q, gt);
        const score = Math.abs(y0 + hy * k - cy) + gt * 40 * k;
        if (score < bestScore) { bestScore = score; best = gi; bestT = q.delay + gt; }
      });
      return [best, Math.min(bestT + jT[i], 0.62)];
    }
    const ease = x => { x = Math.min(1, Math.max(0, x)); return 1 - (1 - x) ** 3; };
    const smooth = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
    let start = 0, outAt = FADE_OUT, menuSent = false, finished = false;
    menuFade(false, 0);
    cv.addEventListener('pointerdown', () => { const t = performance.now() - start; if (t < outAt) outAt = Math.max(t, LETTERS_AT); });

    function frame(now) {
      if (!start) start = now;
      const t = now - start, dpr = window.devicePixelRatio || 1;
      const w = innerWidth, h = innerHeight;
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      const outRaw = Math.min(1, Math.max(0, (t - outAt) / OUT_LEN)), ts = (t - outAt) / 1000;
      if (t >= outAt + OUT_LEN * 0.8 && !menuSent) { menuSent = true; menuFade(true, 900); cv.style.pointerEvents = 'none'; }

      const k = uiScale();
      const lw = Math.min(w / 3, h * 0.38), lh = logo.naturalWidth ? lw * logo.naturalHeight / logo.naturalWidth : lw;
      // Кегль — от ширины логотипа (образец пользователя «надпись.jpg»): строка ≈ 2/3 логотипа
      const fs = lw * 0.15, gap = lw * 0.09, capH = fs * 0.72, lineStep = fs * 1.15, textH = capH + lineStep;
      const top = (h - (lh + gap + textH)) / 2;
      if (logo.complete && logo.naturalWidth) {
        const a = ease(t / 1000) * (1 - smooth(outRaw / 0.75));
        const s = 0.94 + 0.06 * ease(t / 1400) + 0.04 * smooth(outRaw);
        g.globalAlpha = a;
        g.drawImage(logo, w / 2 - lw * s / 2, top + lh / 2 - lh * s / 2, lw * s, lh * s);
      }
      g.font = `500 ${fs}px "Segoe UI", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      const spacing = 0.03 * fs;
      // Раскладка букв — до рисования: порывам нужна рамка надписи, буквам — момент, когда до них долетит порыв
      const box = { l: w / 2, r: w / 2, t: top + lh + gap, b: top + lh + gap + textH }, pos = [];
      lines.forEach((line, li) => {
        const base = top + lh + gap + capH + li * lineStep;
        const ws = [...line].map(ch => g.measureText(ch).width);
        let x = (w - ws.reduce((a, b) => a + b, 0) - spacing * (line.length - 1)) / 2;
        box.l = Math.min(box.l, x); box.r = Math.max(box.r, w - x);
        [...line].forEach((ch, i) => { pos.push([ch, x + ws[i] / 2, base]); x += ws[i] + spacing; });
      });
      pos.forEach(([ch, cx, base], idx) => {
        const kk = ease((t - LETTERS_AT - idx * STEP) / IN);
        if (kk <= 0) return;
        const [gi, at] = hit(idx, cx, base - capH / 2, box, k), q = gusts[gi];
        const u = Math.min(1, Math.max(0, (ts - at) / BLOW));
        const dx = u * u * (38 + 34 * jDx[idx]) * k;
        const dy = q.slope * dx + (jDy[idx] * 9 - 2) * k * u * u + q.amp * 0.25 * k * Math.sin(Math.PI * u);
        const ph = Math.sin(2 * Math.PI * (t / PERIOD) - idx * 0.5), gl = ph > 0 ? ph ** 6 : 0;   // блик по буквам по очереди
        const a = kk * (0.8 + 0.2 * gl) * (1 - smooth(u));
        if (a <= 0.003) return;
        const x = cx + dx, y = base + (1 - kk) * 12 * k + dy;
        g.save();
        if (u > 0) { g.translate(x, y - capH / 2); g.rotate(jRot[idx] * u * u * Math.PI / 180); g.translate(-x, -(y - capH / 2)); }
        g.globalAlpha = Math.min(1, a);
        g.shadowColor = rgba(glow, Math.min(1, 0.45 + 0.55 * gl));
        g.shadowBlur = (5 + 12 * gl) * k;
        g.fillStyle = '#fff';
        g.fillText(ch, x, y);
        g.restore();
      });
      g.globalAlpha = 1; g.shadowBlur = 0;
      if (t > outAt) drawGusts(ts, box, k);
      if (t >= outAt + Math.max(OUT_LEN, GUSTS_END)) { if (!finished) { finished = true; cv.remove(); menuFade(true, 1); done(); } return; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    if (newYear) setTimeout(newYearFireworks, 500);
  }

  // ═══════════ «Лес» 2.6: порывы ветра (перенос Particles.Gust) ═══════════
  // Голова летит по мягкой волне, у 60 % — петля (R·θ' = 2v); хвост — история точек (не реже раза в «кадр 60 Гц»),
  // тонкий на концах, со свечением; до 3 порывов, на паузах дыхания медленнее. Единицы — CSS px и кадры по 16.7 мс.
  function makeGusts(parent) {
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    parent.insertBefore(cv, parent.firstChild);
    const g = cv.getContext('2d');
    const MAX = 96, r = Math.random, gusts = [], gxs = new Float32Array(MAX), gys = new Float32Array(MAX);
    let nextGust = 40, W = 0, H = 0;
    function spawn() {
      const q = { x0: -0.15 * W + r() * W * 0.65, y0: H * (0.1 + r() * 0.8), v: 2.4 + r() * 1.6, slope: (r() - 0.5) * 0.25,
        amp: 8 + r() * 16, k: 0.025 + r() * 0.035, ph: r() * 6.28, t: 0, life: 90 + r() * 70, loopAt: -1, loopLen: 1, rad: 0, loopDir: 1,
        trailAge: 34 + r() * 22, maxOp: 0.5 + r() * 0.3, width: 1.8 + r() * 1.0,
        xs: new Float32Array(MAX), ys: new Float32Array(MAX), ts: new Float32Array(MAX), first: 0, n: 0 };
      if (r() < 0.6) { q.rad = 14 + r() * 14; q.loopLen = Math.PI * q.rad / q.v; q.loopAt = q.life * (0.25 + r() * 0.35); q.loopDir = r() < 0.5 ? 1 : -1; }
      gusts.push(q);
    }
    function head(q, tt) {
      let lx = 0, ly = 0;
      if (q.loopAt >= 0 && tt > q.loopAt) { const u = Math.min(1, (tt - q.loopAt) / q.loopLen), th = 2 * Math.PI * u; lx = q.rad * Math.sin(th); ly = -q.loopDir * q.rad * (1 - Math.cos(th)); }
      return [q.x0 + q.v * tt + lx, q.y0 + q.slope * q.v * tt + q.amp * Math.sin(q.k * tt + q.ph) + ly];
    }
    return {
      frame(sm, dt) {
        const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
        W = w; H = h;
        nextGust -= dt * (0.5 + 0.5 * sm);
        if (nextGust <= 0 && gusts.length < 3) { spawn(); nextGust = 90 + r() * 150; }
        const step = dt * (0.45 + 0.55 * sm);   // на паузах дыхания ветер стихает, но не замирает
        for (let i = gusts.length - 1; i >= 0; i--) {
          const q = gusts[i], t0 = q.t;
          q.t += step;
          const subs = Math.max(1, Math.ceil(step));
          for (let s = 1; s <= subs; s++) {
            const tk = t0 + step * s / subs;
            // 2.9: голова не гаснет посреди экрана — летит, пока не уйдёт за край; хвост втягивается следом
            if (q.gone) break;
            const [hx, hy] = head(q, tk);
            const m = 24 + q.width * 4;
            if (hx > W + m || hy < -m - q.rad * 2 || hy > H + m + q.rad * 2 || tk > 3000) { q.gone = true; break; }
            if (q.n === MAX) { q.first = (q.first + 1) % MAX; q.n--; }
            const idx = (q.first + q.n) % MAX; q.xs[idx] = hx; q.ys[idx] = hy; q.ts[idx] = tk; q.n++;
          }
          while (q.n > 0 && q.t - q.ts[q.first] > q.trailAge) { q.first = (q.first + 1) % MAX; q.n--; }
          if (q.gone && q.n === 0) gusts.splice(i, 1);
        }
        g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
        // 2.9: сплошная однотонная лента с острыми кончиками (без свечения и сужения по всей длине)
        for (const q of gusts) {
          if (q.n < 2) continue;
          const birth = Math.min(1, q.t / 12);
          for (let i = 0; i < q.n; i++) { const a = (q.first + i) % MAX; gxs[i] = q.xs[a]; gys[i] = q.ys[a]; }
          g.fillStyle = `rgba(255,255,255,${q.maxOp * 0.75 * birth})`;
          ribbon(g, gxs, gys, q.n, q.width * 1.5);
        }
      }
    };
  }
  // ═══════════ Напоминание подышать (ПК 2.8): как на Android — окно с «барабаном» времени ═══════════
  // Срабатывание ведёт хост (Планировщик Windows, «Дыхание.exe --remind»): ему уходит «reminder:{json}».
  const host = () => (window.chrome && window.chrome.webview) ? window.chrome.webview : null;
  const pad2 = n => String(n).padStart(2, '0');
  function reminderState() {
    const s = S();
    return { on: !!s.reminderOn, h: typeof s.reminderH === 'number' ? s.reminderH : 20, m: typeof s.reminderM === 'number' ? s.reminderM : 0 };
  }
  /** Дата последней практики в виде yyyy-MM-dd (в статистике она без нулей: 2026-11-3) */
  function lastDateIso() {
    const d = Store.stats.lastDate; if (!d) return null;
    const [y, m, dd] = d.split('-').map(Number); return `${y}-${pad2(m)}-${pad2(dd)}`;
  }
  let remTimer = 0;
  /** Хосту — с задержкой 0.6 с: прокрутка барабана не перезаводит задачу Планировщика на каждом шаге */
  function sendReminder(now) {
    clearTimeout(remTimer);
    if (!now) { remTimer = setTimeout(() => sendReminder(true), 600); return; }
    const w = host(); if (!w) return;
    const r = reminderState();
    try { w.postMessage('reminder:' + JSON.stringify({ on: r.on, h: r.h, m: r.m, lastDate: lastDateIso() })); } catch (e) {}
  }
  function setReminder(on, h, m) {
    const s = S(); s.reminderOn = on; if (h !== undefined) { s.reminderH = h; s.reminderM = m; }
    Store.save(); sendReminder();
  }

  /** «Барабан» часов и минут (перенос TimeWheel.kt): по кругу, с инерцией и доводкой; колесо мыши — по одному шагу */
  function makeTimeWheel(onChange) {
    const cv = document.createElement('canvas'); cv.className = 'v24-wheel';
    const g = cv.getContext('2d');
    const ROW = 38, STEP = Math.PI / 9, R = ROW / STEP, H = Math.round(R * 2 * 0.92);
    const cols = [{ n: 24, pos: 0, vel: 0, moving: false, snapping: false }, { n: 60, pos: 0, vel: 0, moving: false, snapping: false }];
    const mod = (x, n) => ((x % n) + n) % n;
    const val = c => mod(Math.round(c.pos), c.n);
    let active = -1, lastY = 0, samples = [], raf = 0, lastT = 0;
    function draw() {
      const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 280;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, H);
      const cy = H / 2;
      g.fillStyle = 'rgba(255,255,255,0.08)';
      const rr = ROW / 2.4; g.beginPath(); g.roundRect(8, cy - ROW / 2, w - 16, ROW, rr); g.fill();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      cols.forEach((c, i) => {
        const x = w / 2 + (i === 0 ? -42 : 42), base = Math.floor(c.pos);
        for (let k = -5; k <= 5; k++) {
          const idx = base + k, off = idx - c.pos, a = off * STEP;
          if (Math.abs(a) >= Math.PI / 2) continue;
          const y = cy + R * Math.sin(a), sc = Math.cos(a), near = 1 - Math.min(1, Math.abs(off));
          g.font = `500 ${23 * (0.82 + 0.18 * sc)}px "Segoe UI", system-ui, sans-serif`;
          const al = near > 0.5 ? 0.55 + 0.45 * near : 0.55 * sc * sc;
          g.fillStyle = `rgba(255,255,255,${al})`;
          g.save(); g.translate(x, y); g.scale(1, sc); g.fillText(pad2(mod(idx, c.n)), 0, 1); g.restore();
        }
      });
    }
    function loop(t) {
      const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016; lastT = t;
      let running = false;
      cols.forEach((c, i) => {
        if (i === active || !c.moving) return;
        if (!c.snapping) {
          if (Math.abs(c.vel) > 1.2) { c.pos += c.vel * dt; c.vel *= Math.exp(-dt / 0.33); running = true; }
          else { c.vel = 0; c.snapping = true; }
        }
        if (c.snapping) {
          const target = Math.round(c.pos), diff = target - c.pos;
          if (Math.abs(diff) < 0.002) { c.pos = target; c.snapping = false; c.moving = false; onChange(val(cols[0]), val(cols[1])); }
          else { c.pos += diff * (1 - Math.exp(-dt / 0.06)); running = true; }
        }
      });
      draw();
      if (running || active >= 0) raf = requestAnimationFrame(loop); else { raf = 0; lastT = 0; }
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
    const colAt = e => (e.clientX - cv.getBoundingClientRect().left < cv.clientWidth / 2 ? 0 : 1);
    cv.addEventListener('pointerdown', e => {
      e.stopPropagation(); cv.setPointerCapture(e.pointerId);
      active = colAt(e); const c = cols[active]; c.vel = 0; c.moving = false; c.snapping = false;
      lastY = e.clientY; samples = [[performance.now(), e.clientY]]; kick();
    });
    cv.addEventListener('pointermove', e => {
      if (active < 0) return;
      cols[active].pos -= (e.clientY - lastY) / ROW; lastY = e.clientY;
      samples.push([performance.now(), e.clientY]); if (samples.length > 6) samples.shift(); draw();
    });
    const up = e => {
      if (active < 0) return;
      const c = cols[active], s0 = samples[0], s1 = samples[samples.length - 1];
      const dtv = (s1[0] - s0[0]) / 1000;
      c.vel = dtv > 0.005 && performance.now() - s1[0] < 80 ? -((s1[1] - s0[1]) / dtv) / ROW : 0;
      // Щелчок без движения — шаг к строке, по которой щёлкнули
      if (samples.length <= 2 && Math.abs(c.vel) < 1.5) {
        const off = Math.asin(Math.max(-0.99, Math.min(0.99, (e.clientY - cv.getBoundingClientRect().top - H / 2) / R))) / STEP;
        if (Math.abs(off) > 0.5) c.pos += Math.round(off);
      }
      c.moving = true; active = -1; kick();
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => {
      e.preventDefault(); e.stopPropagation();
      const c = cols[colAt(e)]; c.pos = Math.round(c.pos) + Math.sign(e.deltaY); c.vel = 0; c.moving = true; c.snapping = true; kick();
    }, { passive: false });
    return { el: cv, set(h, m) { cols[0].pos = h; cols[1].pos = m; cols.forEach(c => { c.vel = 0; c.moving = false; }); draw(); }, draw };
  }

  let remEl = null, remWheel = null;
  function buildReminderSheet() {
    remEl = document.createElement('div');
    remEl.className = 'v24-rem';
    remEl.innerHTML = `<div class="v24-rem-card">
      <div class="v24-rem-head">${Icons.svg('bell')}<span>Напоминание подышать</span></div>
      <p class="v24-rem-text">Раз в день — уведомление Windows с мягким звуком и короткой фразой: утром, днём и вечером — свои.\nЕсли в этот день вы уже дышали, напоминание не придёт. Приходит, даже когда «Дыхание» закрыто, — если компьютер включён.</p>
      <label class="checkbox-wrapper wide v24-rem-sw"><span><i data-ic="bell"></i><span class="ic-t">Напоминать каждый день</span></span><input type="checkbox"><div class="switch-toggle"></div></label>
      <div class="v24-rem-time" tabindex="0"><span class="v24-rem-tl">${Icons.svg('timer')}<span>Время</span></span><b class="v24-rem-val">20:00</b><span class="v24-rem-chev">❯</span></div>
      <div class="v24-rem-drop"></div>
      <button type="button" class="app-dialog-btn primary v24-rem-ok">Готово</button>
    </div>`;
    document.body.appendChild(remEl);
    if (typeof Icons.hydrate === 'function') Icons.hydrate(remEl);
    remEl.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.target === remEl) closeReminder(); });
    const sw = remEl.querySelector('.v24-rem-sw input');
    sw.addEventListener('change', () => { applyOn(sw.checked); const r = reminderState(); setReminder(sw.checked, r.h, r.m); });
    const row = remEl.querySelector('.v24-rem-time');
    const toggleDrop = () => { if (!sw.checked) return; remEl.classList.toggle('drop'); if (remEl.classList.contains('drop')) requestAnimationFrame(() => remWheel.draw()); };
    row.addEventListener('click', toggleDrop);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDrop(); } });
    remWheel = makeTimeWheel((h, m) => {
      remEl.querySelector('.v24-rem-val').textContent = pad2(h) + ':' + pad2(m);
      const r = reminderState(); if (r.h !== h || r.m !== m) setReminder(r.on, h, m);
    });
    remEl.querySelector('.v24-rem-drop').appendChild(remWheel.el);
    remEl.querySelector('.v24-rem-ok').onclick = closeReminder;
  }
  function applyOn(on) {
    remEl.querySelector('.v24-rem-time').classList.toggle('off', !on);
    if (!on) remEl.classList.remove('drop');
  }
  const reminderOpen = () => !!remEl && remEl.classList.contains('show');
  function openReminder() {
    if (!remEl) buildReminderSheet();
    const r = reminderState(), c = readable(themeRgb());
    remEl.style.setProperty('--tc', `${c[0]}, ${c[1]}, ${c[2]}`);
    remEl.querySelector('.v24-rem-sw input').checked = r.on;
    remEl.querySelector('.v24-rem-val').textContent = pad2(r.h) + ':' + pad2(r.m);
    applyOn(r.on); remEl.classList.remove('drop');
    remWheel.set(r.h, r.m);
    remEl.classList.add('show');
  }
  function closeReminder() { if (remEl) remEl.classList.remove('show', 'drop'); }

  /** Один раз — после первой завершённой практики (как askReminderOnce на Android) */
  function askReminderOnce() {
    const s = S();
    if (!host() || s.reminderAsked || s.reminderOn) return;
    s.reminderAsked = true; Store.save();
    setTimeout(() => {
      showDialog({ icon: 'bell', title: 'Напоминать подышать?',
        text: 'Даже 1 минута дыхания помогает восстановиться.\nРаз в день придёт уведомление — только если вы ещё не дышали. Время можно выбрать в «Настройках».',
        buttons: [{ label: 'Не нужно', value: false, kind: 'ghost' }, { label: 'Напоминать', value: true, kind: 'primary' }] })
        .then(ok => { if (ok) { const r = reminderState(); setReminder(true, r.h, r.m); DevMode.toast('Напоминание в ' + pad2(r.h) + ':' + pad2(r.m) + ' — время можно поменять в «Настройках»'); } });
    }, 2600);
  }

  /** Режим разработчика 8-8-8-8: показать напоминание сразу (утро / день / вечер / все три подряд) */
  function reminderPreview() {
    const w = host();
    if (!w) { DevMode.toast('Напоминания работают только в «Дыхание.exe»'); return; }
    showDialog({ icon: 'bell', title: 'Просмотр напоминаний', text: 'Уведомление придёт сразу, со звуком. Расписание не меняется.',
      buttons: [{ label: 'Утро', value: '0', kind: 'ghost' }, { label: 'День', value: '1', kind: 'ghost' }, { label: 'Вечер', value: '2', kind: 'ghost' }, { label: 'Все три', value: 'all', kind: 'primary' }],
      cancelValue: null })
      .then(v => {
        if (v === null || v === undefined || v === false) return;
        if (v === 'all') [0, 1, 2].forEach(i => setTimeout(() => w.postMessage('reminderPreview:' + i), 300 + i * 4000));
        else setTimeout(() => w.postMessage('reminderPreview:' + v), 300);
      });
  }

  function addReminderLink() {
    if (!host() || $('v24-rem-link')) return;
    const grid = document.querySelector('#settings-accordion .checkbox-container'); if (!grid) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'v24-rem-link'; b.className = 'v24-rem-link';
    b.innerHTML = Icons.withText('bell', 'Напоминание');
    b.addEventListener('click', e => { e.stopPropagation(); openReminder(); });
    grid.appendChild(b);
  }
  // ═══════════ «Слова голоса» (2.8): переключатель на каждую запись; включили — слово сразу звучит ═══════════
  let vwEl = null;
  function buildVoiceWords() {
    vwEl = document.createElement('div');
    vwEl.className = 'v24-rem v24-vw';
    vwEl.innerHTML = `<div class="v24-rem-card">
      <div class="v24-rem-head">${Icons.svg('voiceWave')}<span>Слова голоса</span></div>
      <p class="v24-rem-text">Выберите слова, которые будут озвучиваться.</p>
      ${VOICE_WORDS.map(([k, label, ic]) => `<label class="checkbox-wrapper wide v24-rem-sw"><span><i data-ic="${ic}"></i><span class="ic-t">${label}</span></span><input type="checkbox" data-k="${k}"><div class="switch-toggle"></div></label>`).join('')}
      <button type="button" class="app-dialog-btn primary v24-rem-ok">Готово</button>
    </div>`;
    document.body.appendChild(vwEl);
    if (typeof Icons.hydrate === 'function') Icons.hydrate(vwEl);
    vwEl.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.target === vwEl) closeVoiceWords(); });
    vwEl.querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener('change', () => {
      S().voiceMuted = [...vwEl.querySelectorAll('input[data-k]')].filter(i => !i.checked).map(i => i.dataset.k).join(',');
      Store.save();
      if (inp.checked) { loadVoice(); playVoice(inp.dataset.k, true); }
    }));
    vwEl.querySelector('.v24-rem-ok').onclick = closeVoiceWords;
  }
  const voiceWordsOpen = () => !!vwEl && vwEl.classList.contains('show');
  function openVoiceWords() {
    if (!vwEl) buildVoiceWords();
    const c = readable(themeRgb()), m = voiceMuted();
    vwEl.style.setProperty('--tc', `${c[0]}, ${c[1]}, ${c[2]}`);
    vwEl.querySelectorAll('input[data-k]').forEach(i => { i.checked = !m.has(i.dataset.k); });
    vwEl.classList.add('show');
  }
  function closeVoiceWords() { if (vwEl) vwEl.classList.remove('show'); }
  function addVoiceWordsLink() {
    const fader = $('voice-fader'); if (!fader || $('v24-vw-link')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'v24-vw-link'; b.className = 'v24-rem-link';
    b.innerHTML = Icons.withText('voiceWave', 'Слова голоса');
    b.addEventListener('click', e => { e.stopPropagation(); openVoiceWords(); });
    fader.insertAdjacentElement('afterend', b);
  }
  // ═══════════ Обучение ═══════════
  let tut = null;   // { steps, i, forced, el }
  const tutorialOpen = () => !!tut;
  function tutorialSteps() {
    const wrap = sel => sel.closest('.select-wrapper') || sel;
    return [
      { t: () => wrap(patternSelect), ic: 'leaf', title: 'Техника дыхания', text: 'Выберите технику — от успокаивающего «Релакса» до бодрящей «Энергии». Значок «i» справа подскажет, чем она полезна.\n\nВ «Своём режиме» появятся четыре ползунка: длительность вдоха, пауз и выдоха в секундах.' },
      { t: () => wrap(themeSelect), ic: 'waves', title: 'Оформление', text: 'Тема меняет цвета, фон и живые эффекты. Новые темы открываются по мере практики — в списке видно, сколько минут осталось.' },
      { t: () => cyclesInput.closest('.slider-group'), ic: 'repeat', title: 'Повторения', text: 'Ползунок задаёт число дыхательных циклов, а в скобках — сколько продлится практика. В «Своём режиме» крайнее правое положение — бесконечная практика.' },
      { t: () => $('settings-accordion'), ic: 'gear', title: 'Настройки', text: 'Здесь включаются надписи, секунды, граница-кольцо, эффекты и фон, выбирается оттенок цветка.' },
      { t: () => $('sounds-accordion'), ic: 'volume', title: 'Звуки', text: 'Звук смены фаз, голос и звуки природы: проведите по строке мышью, чтобы задать громкость; до упора влево — выключено. Можно добавить и свою музыку.' },
      { t: () => $('stats-accordion'), ic: 'chart', title: 'Мои достижения', text: 'Дни подряд, число практик и минуты. Чем больше практики — тем выше ранг и тем больше открытых тем.' },
      { t: () => $('start-btn'), ic: 'play', title: 'Начать', text: 'Следуйте за цветком: он раскрывается на вдохе и собирается на выдохе.\n\nЩёлкните по экрану во время практики — появятся время, повторения и ползунки громкости голоса, эффектов и своего аудио (их можно крутить и колесом мыши). Щелчок по цветку ставит паузу.' },
      { t: () => $('open-instruction-btn'), ic: 'info', title: 'Инструкция и безопасность', text: 'Советы, как дышать легко и безопасно. Отсюда же можно снова пройти это обучение.' },
      { t: () => null, ic: 'sliders', title: 'Горячие клавиши', text: HOTKEYS_TEXT + '\n\nСписок всегда под рукой: F1 или «О приложении» → «Горячие клавиши».' }
    ];
  }
  /** Первый запуск (2.5): заперта инструкция → обязательное обучение; после него инструкцию второй раз не показываем (2.7) */
  let firstRunFlow = false;
  const firstRun = () => firstRunFlow;
  function startTutorial(forced) {
    if (State.active || tut) return;
    closePicker(); closeDialog();
    if (instructionModal.classList.contains('active')) {
      if (instructionLocked) instructionModal.classList.remove('active'); else closeInstruction();
    }
    document.querySelectorAll('.settings-accordion.open, .stats-accordion.open').forEach(a => a.classList.remove('open', 'closing'));
    const mandatory = !forced && firstRunFlow;
    const el = document.createElement('div');
    el.className = 'v24-tut';
    el.innerHTML = `<div class="v24-tut-hole"></div><div class="v24-tut-card">
      <div class="v24-tut-head"><span class="v24-tut-ic"></span><span class="v24-tut-title"></span><span class="v24-tut-count"></span></div>
      <div class="v24-tut-text"></div>
      <label class="v24-tut-check"><input type="checkbox" checked><span>Больше не показывать при запуске</span></label>
      <div class="v24-tut-actions"><button type="button" class="app-dialog-btn ghost" data-a="skip">Пропустить</button><button type="button" class="app-dialog-btn primary" data-a="next">Далее</button></div></div>`;
    document.body.appendChild(el);
    const c = readable(themeRgb());
    el.style.setProperty('--tc', `${c[0]}, ${c[1]}, ${c[2]}`);
    el.querySelector('.v24-tut-check').style.display = forced ? 'none' : '';
    el.addEventListener('pointerdown', e => e.stopPropagation());
    // Обязательное обучение — без «Пропустить»
    if (mandatory) el.querySelector('[data-a=skip]').style.display = 'none';
    el.querySelector('[data-a=skip]').onclick = () => endTutorial();
    el.querySelector('[data-a=next]').onclick = () => nextStep();
    tut = { steps: tutorialSteps(), i: 0, forced, mandatory, el };
    requestAnimationFrame(() => el.classList.add('show'));
    goStep(0);
  }
  function nextStep() { if (!tut) return; if (tut.i + 1 < tut.steps.length) goStep(tut.i + 1); else endTutorial(); }
  function goStep(i) {
    tut.i = i;
    const st = tut.steps[i], el = tut.el, card = el.querySelector('.v24-tut-card');
    card.classList.remove('in');
    const target = st.t();
    if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => {
      if (!tut || tut.i !== i) return;
      el.querySelector('.v24-tut-ic').innerHTML = Icons.svg(st.ic);
      el.querySelector('.v24-tut-title').textContent = st.title;
      el.querySelector('.v24-tut-count').textContent = (i + 1) + ' из ' + tut.steps.length;
      el.querySelector('.v24-tut-text').textContent = st.text;
      el.querySelector('[data-a=next]').textContent = i + 1 < tut.steps.length ? 'Далее' : 'Готово';
      placeStep(target);
      card.classList.add('in');
    }, target ? 380 : 150);
  }
  function placeStep(target) {
    if (!tut) return;
    const el = tut.el, hole = el.querySelector('.v24-tut-hole'), card = el.querySelector('.v24-tut-card');
    const H = innerHeight, gap = 14, pad = 6;
    if (target) {
      const r = target.getBoundingClientRect();
      Object.assign(hole.style, { opacity: '1', left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' });
      const ch = card.offsetHeight;
      let top = (r.top + r.height / 2 < H / 2) ? r.bottom + pad + gap : r.top - pad - gap - ch;
      card.style.top = Math.max(16, Math.min(H - ch - 16, top)) + 'px';
      el.classList.remove('nohole');
    } else {
      Object.assign(hole.style, { opacity: '0', left: '50%', top: '50%', width: '0px', height: '0px' });
      card.style.top = Math.max(16, (H - card.offsetHeight) / 2) + 'px';
      el.classList.add('nohole');
    }
  }
  function endTutorial() {
    if (!tut) return;
    const { forced, el } = tut;
    const dontShow = forced || el.querySelector('.v24-tut-check input').checked;
    tut = null;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
    if (!forced) {
      Store.flags.tutorialDone = dontShow; Store.flush();
      // Инструкцию уже прочли после заставки — второй раз не показываем (правки 2.7)
      if (firstRunFlow) { firstRunFlow = false; setInstructionLock(false); }
    }
    controlsForm.scrollTo && controlsForm.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ═══════════ Горячие клавиши ═══════════
  const HOTKEYS_TEXT = 'Пробел — начать / пауза\nEnter на цветке — начать / пауза\nEsc — пауза; на паузе — сброс; закрыть окно\nF11 — во весь экран и обратно\nСтрелки — двигать выбранный ползунок\nКолесо мыши — громкость в практике\nF1 — эта подсказка';
  function showHotkeys() {
    showDialog({ icon: 'sliders', title: 'Горячие клавиши', text: HOTKEYS_TEXT, buttons: [{ label: 'Понятно', value: true, kind: 'primary' }] });
  }

  // ═══════════ «О приложении» ═══════════
  let aboutEl = null;
  function buildAbout() {
    aboutEl = document.createElement('div');
    aboutEl.className = 'v24-about';
    aboutEl.innerHTML = `<div class="v24-about-page">
      <button type="button" class="v24-about-back" aria-label="Назад">${Icons.svg('back')}</button>
      <h1>О приложении</h1>
      <div class="v24-about-center">
        <img src="rodnik_logo.png" alt="" class="v24-about-logo">
        <div class="v24-about-name">Дыхание</div>
        <p class="v24-about-desc">Спокойный тренажёр дыхания: выберите технику, следуйте за цветком и подарите себе несколько минут тишины.</p>
        <a class="v24-about-link" data-a="ins">Инструкция и безопасность</a>
        <a class="v24-about-link" data-a="tut">Пройти обучение заново</a>
        <a class="v24-about-link" data-a="keys">Горячие клавиши</a>
        <a class="v24-about-link" data-a="mail">Написать автору</a>
        <p class="v24-about-small">Автор и разработчик — Денис Курцев<br>diniz1393@gmail.com</p>
        <p class="v24-about-small">Создано в Центре «Родник»<br>© 2026 Центр «Родник»</p>
      </div></div>`;
    document.body.appendChild(aboutEl);
    aboutEl.addEventListener('pointerdown', e => e.stopPropagation());
    aboutEl.querySelector('.v24-about-back').onclick = closeAbout;
    aboutEl.querySelectorAll('[data-a]').forEach(a => a.onclick = () => {
      const k = a.dataset.a;
      if (k === 'ins') { closeAbout(); setTimeout(() => openInstruction(true), 250); }
      else if (k === 'tut') { closeAbout(); setTimeout(() => startTutorial(true), 350); }
      else if (k === 'keys') showHotkeys();
      else if (k === 'mail') location.href = 'mailto:diniz1393@gmail.com?subject=' + encodeURIComponent('Дыхание');
    });
  }
  const aboutOpen = () => !!aboutEl && aboutEl.classList.contains('show');
  function openAbout() {
    if (!aboutEl) buildAbout();
    const d = $('pattern-desc'); if (d) d.classList.remove('active');
    aboutEl.querySelector('.v24-about-page').scrollTop = 0;
    aboutEl.classList.add('show');
    menuFade(false, 300);
  }
  function closeAbout() {
    if (!aboutOpen()) return;
    aboutEl.classList.remove('show');
    menuFade(true, 500);
  }

  // ═══════════ Клавиатура: Esc закрывает новые окна, F1 — горячие клавиши ═══════════
  // Щипок тачпада приходит как колесо с Ctrl — страницу не масштабируем (в хосте ещё IsPinchZoomEnabled = false)
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (tut) {
      if (e.key === 'Escape') { if (!tut.mandatory) endTutorial(); }
      else if (e.key === 'Enter' || e.key === 'ArrowRight') nextStep();
      if (e.key !== 'F11') { e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }
    if (voiceWordsOpen() && e.key === 'Escape' && !(appDialog && appDialog.classList.contains('active'))) { closeVoiceWords(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (reminderOpen() && e.key === 'Escape' && !(appDialog && appDialog.classList.contains('active'))) { closeReminder(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (aboutOpen() && !(appDialog && appDialog.classList.contains('active'))) {
      if (e.key === 'Escape') { closeAbout(); e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.code === 'Space') { e.stopImmediatePropagation(); return; }
    }
    if (e.key === 'F1') { e.preventDefault(); e.stopImmediatePropagation(); if (!State.active) showHotkeys(); }
  }, true);
  window.addEventListener('resize', () => { if (tut) placeStep(tut.steps[tut.i].t()); });

  // ═══════════ Зимние праздники (2.9): 20.12–14.01 — снегопад и гирлянда, в меню снежинка и лампочка ═══════════
  // 1–7 января — новогодняя заставка с салютом. Выбор снега/гирлянды помнится до конца сезона. Код 1-2-3-1 — проверка
  const F = () => Store.flags;
  const isSeason = d => (d.getMonth() === 11 && d.getDate() >= 20) || (d.getMonth() === 0 && d.getDate() <= 14);
  const seasonYear = d => d.getFullYear() - (d.getMonth() === 0 ? 1 : 0);
  const holidayActive = () => isSeason(new Date()) || !!F().holidayTest;
  const holidaySnow = () => holidayActive() && F().holidaySnow !== false;
  /** 1.0 (правки 2.10): верх панели техники — сюда ложатся снежинки; null, если меню не видно целиком */
  function snowLedge() {
    if (!holidaySnow() || State.active) return null;
    const form = document.getElementById('controls-form');
    if (!form || form.style.display === 'none' || form.classList.contains('blurred') || +getComputedStyle(form).opacity < 0.95) return null;
    if (aboutOpen() || document.querySelector('.v24-splash')) return null;
    const el = form.querySelector('.select-wrapper.with-hint');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || r.top < 0 || r.top > innerHeight) return null;
    return { left: r.left, top: r.top, right: r.right };
  }
  const newYearNow = () => (new Date().getMonth() === 0 && new Date().getDate() <= 7) || !!F().holidayTest;

  function newYearFireworks() {
    Fireworks.launch(['rgb(255, 200, 80)', 'rgb(255, 80, 90)', 'rgb(90, 220, 120)', 'rgb(110, 180, 255)', 'rgb(255, 255, 255)', 'rgb(230, 120, 255)'], null, 15, 620);
    if (soundToggle.checked) setTimeout(() => { try { initAudioContext(); playFinalChord(); } catch (e) {} }, 1200);
  }

  /** Гирлянда по периметру окна (перенос Garland.kt): провод дугами, по две лампочки на дуге, бегущая волна и вспышки */
  let garland = null;
  function makeGarland() {
    const cv = document.createElement('canvas');
    cv.className = 'v24-garland';
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    const COLORS = [[255, 70, 80], [255, 196, 70], [80, 220, 120], [90, 170, 255], [240, 110, 230]];
    const sprites = COLORS.map(([r, gg, b]) => {
      const c = document.createElement('canvas'); c.width = c.height = 48;
      const x = c.getContext('2d'), grd = x.createRadialGradient(24, 24, 0, 24, 24, 24);
      grd.addColorStop(0, '#fff'); grd.addColorStop(0.12, `rgb(${r},${gg},${b})`); grd.addColorStop(0.3, `rgba(${r},${gg},${b},0.55)`); grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      x.fillStyle = grd; x.fillRect(0, 0, 48, 48); return c;
    });
    let bulbs = [], wire = null, W = 0, H = 0, alpha = 0, last = 0, raf = 0;
    function build(w, h) {
      W = w; H = h; bulbs = []; wire = new Path2D();
      const inset = 7, span = 64, sag = 9, x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset;
      const sides = [[x0, y0, x1, y0, 0, 1], [x1, y0, x1, y1, -1, 0], [x1, y1, x0, y1, 0, -1], [x0, y1, x0, y0, 1, 0]];
      let k = 0;
      for (const s of sides) {
        const n = Math.max(1, Math.round(Math.hypot(s[2] - s[0], s[3] - s[1]) / span));
        for (let i = 0; i < n; i++) {
          const ax = s[0] + (s[2] - s[0]) * i / n, ay = s[1] + (s[3] - s[1]) * i / n;
          const bx = s[0] + (s[2] - s[0]) * (i + 1) / n, by = s[1] + (s[3] - s[1]) * (i + 1) / n;
          const cx = (ax + bx) / 2 + s[4] * sag * 2, cy = (ay + by) / 2 + s[5] * sag * 2;
          if (i === 0 && k === 0) wire.moveTo(ax, ay);
          wire.quadraticCurveTo(cx, cy, bx, by);
          for (const u of [0.3, 0.7]) {
            const q = 1 - u, px = q * q * ax + 2 * q * u * cx + u * u * bx, py = q * q * ay + 2 * q * u * cy + u * u * by;
            bulbs.push({ x: px + s[4] * 3, y: py + s[5] * 3, img: sprites[k % sprites.length], phase: k * 0.55, tw: 0.2 + Math.random() * 0.5 });
            k++;
          }
        }
      }
      wire.closePath();
    }
    function frame(t) {
      raf = 0;
      const want = holidayActive() && F().holidayGarland !== false ? (State.active ? 0.5 : 1) : 0;   // в практике — приглушена
      const dt = last ? Math.min(0.1, (t - last) / 1000) : 0; last = t;
      alpha += (want - alpha) * (1 - Math.exp(-dt / 0.45));
      if (want === 0 && alpha < 0.01) { alpha = 0; cv.style.display = 'none'; last = 0; return; }
      cv.style.display = '';
      const dpr = window.devicePixelRatio || 1, w = innerWidth, h = innerHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      if (w !== W || h !== H || !wire) build(w, h);
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      g.globalAlpha = alpha * 0.85; g.strokeStyle = 'rgba(20, 40, 28, 0.85)'; g.lineWidth = 1.2; g.stroke(wire);
      g.globalCompositeOperation = 'lighter';
      const s = t / 1000;
      for (const b of bulbs) {
        const wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * (s / 3) - b.phase);
        const tw = Math.sin(2 * Math.PI * s * b.tw + b.phase * 7), flash = tw > 0.93 ? (tw - 0.93) / 0.07 : 0;
        const br = Math.min(1, 0.5 + 0.45 * wave * wave + 0.25 * flash), size = (4.6 + 1.6 * br) * 4.2;
        g.globalAlpha = alpha * br;
        g.drawImage(b.img, b.x - size / 2, b.y - size / 2, size, size);
      }
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      setTimeout(() => { if (!raf) raf = requestAnimationFrame(frame); }, 30);   // ~30 Гц: яркость меняется плавно
    }
    return { kick() { if (!raf) raf = requestAnimationFrame(frame); } };
  }

  /** Снежинка (снегопад) и лампочка (гирлянда) сверху меню — только в сезон */
  let holidayRow = null;
  function buildHolidayRow() {
    holidayRow = document.createElement('div');
    holidayRow.className = 'v24-holiday';
    holidayRow.innerHTML = `<button type="button" class="v24-hb snow" title="Снегопад">${Icons.svg('snowflake')}</button><span></span>` +
      `<button type="button" class="v24-hb bulb" title="Гирлянда">${Icons.svg('bulb')}</button>`;
    controlsForm.insertBefore(holidayRow, controlsForm.firstChild);
    holidayRow.querySelector('.snow').onclick = () => {
      const on = F().holidaySnow === false; F().holidaySnow = on; Store.flush();
      applyHoliday(); updateAmbientEffects(); playTone(on ? 587 : 293, 250);
      if (typeof DevMode !== 'undefined' && DevMode.toast) DevMode.toast(on ? 'Снегопад' + (ambientToggle.checked ? '' : ' (включите «Эффекты»)') : 'Обычные эффекты темы');
    };
    holidayRow.querySelector('.bulb').onclick = () => {
      const on = F().holidayGarland === false; F().holidayGarland = on; Store.flush();
      applyHoliday(); playTone(on ? 659 : 329, 250);
      if (typeof DevMode !== 'undefined' && DevMode.toast) DevMode.toast(on ? 'Гирлянда' : 'Гирлянда выключена');
    };
  }
  /** Сезон: новый — снег и гирлянда снова включены; строка значков, гирлянда */
  function applyHoliday() {
    const f = F();
    if (holidayActive()) {
      const y = seasonYear(new Date());
      if (f.holidaySeason !== y) { f.holidaySeason = y; f.holidaySnow = true; f.holidayGarland = true; Store.save(); }
    }
    if (!holidayRow) buildHolidayRow();
    holidayRow.style.display = holidayActive() ? '' : 'none';
    holidayRow.querySelector('.snow').classList.toggle('on', f.holidaySnow !== false);
    holidayRow.querySelector('.bulb').classList.toggle('on', f.holidayGarland !== false);
    if (!garland) garland = makeGarland();
    garland.kick();
  }
  /** Заставка по требованию (код 1-2-3-1): меню скрывается и возвращается само */
  function playSplash(newYear) { splash(() => {}, newYear); }

  // ═══════════ Запуск ═══════════
  function init() {
    addReminderLink(); sendReminder();   // ПК 2.8: напоминание (хост перезаводит задачу с текущим путём exe)
    // 2.8: voiceVol теперь положение ползунка (громкость = положение²); прежнее значение было громкостью — пересчёт √, слышно так же
    if (!S().voiceCurve2) { if (typeof S().voiceVol === 'number') S().voiceVol = Math.sqrt(S().voiceVol); S().voiceCurve2 = true; Store.save(); }
    // 2.8: fxVol теперь положение ползунка эффектов; прежнее значение было громкостью — пересчёт в положение с той же громкостью
    if (!S().fxCurve2) { if (typeof S().fxVol === 'number') S().fxVol = Math.pow(S().fxVol / FX_MAX, 1 / FX_CURVE); S().fxCurve2 = true; Store.save(); }
    // 2.9: «Звук фаз» стал ползунком — включённый звучит как прежде (0.8), выключенный остаётся выключенным
    if (typeof S().phaseVol !== 'number') { S().phaseVol = soundToggle.checked ? PHASE_DEF : 0; Store.save(); }
    soundToggle.checked = phasePos() > 0;
    // 2.9: стерео-тон заменён ночным лесом — его громкость (sineVol) один раз сбрасывается в ноль
    if (!S().night29) { S().sineVol = 0; S().night29 = true; Store.save(); currentSineVolume = 0; if (typeof updateSineFaderView === 'function') updateSineFaderView(); }
    addVoiceWordsLink();
    bindFaders();
    applyHoliday(); updateAmbientEffects();
    buildRails();
    // Инструкция: кнопка «Пройти обучение»
    const footer = document.querySelector('#instruction-modal .modal-footer');
    if (footer && !$('v24-tut-btn')) {
      const b = document.createElement('button');
      b.id = 'v24-tut-btn'; b.type = 'button'; b.className = 'modal-btn v24-ghost-btn';
      b.innerHTML = Icons.withText('book', 'Пройти обучение');
      b.onclick = () => {
        if (instructionLocked) { instructionModal.classList.remove('active'); setTimeout(() => startTutorial(false), 420); }
        else { closeInstruction(); setTimeout(() => startTutorial(true), 420); }
      };
      footer.appendChild(b);
    }
    const after = () => {
      if (!Store.flags.tutorialDone && !Store.flags.introOff) { firstRunFlow = true; setTimeout(() => openInstruction(false, true), 300); }
      else if (!Store.flags.hideInstruction) setTimeout(() => openInstruction(false), 300);
    };
    // 1–7 января — новогодняя заставка с салютом, даже при выключенной заставке (9-9-9-9): раз в год
    const ny = newYearNow();
    if (Store.flags.introOff && !ny) after(); else splash(after, ny);
  }

  /** Пока инструкция заперта — кнопка обучения главная: рамка и заливка цвета темы */
  function lockTutorialButton(v) {
    const b = $('v24-tut-btn'); if (!b) return;
    const c = readable(themeRgb());
    b.style.setProperty('border-color', v ? rgba(c, 0.85) : '', v ? 'important' : '');
    b.style.setProperty('background', v ? rgba(c, 0.16) : '', v ? 'important' : '');
    b.style.setProperty('color', v ? '#fff' : '', v ? 'important' : '');
  }

  return { init, busInput, fxOut, phaseOut, applyHoliday, holidaySnow, snowLedge,playSplash, onFrame, firstRun, makeGusts, openReminder, closeReminder, reminderOpen, openVoiceWords, closeVoiceWords, voiceWordsOpen, reminderPreview, sendReminder, lockTutorialButton, onPhase, onStart, onPause, onFinish, previews, refreshFaders, showRails,
           openAbout, closeAbout, tutorialOpen, showHotkeys };
})();
