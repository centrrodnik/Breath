// ═══════════ ЗВУКИ-ЧАШИ (перенос Synth.BowlVoice из «Дыхания 2.3») ═══════════
// Поющая чаша: основа и неровные обертоны ×2.71 и ×5.13, каждый тон — пара близких частот с биением ~1 Гц
// (медленное «пение» громкости), пары разведены по каналам — объём в наушниках. Звук нарастает из тишины
// по половине косинуса (касание, а не удар), хвост плавно уходит в ноль — без щелчков.
// Звук считается один раз в AudioBuffer (кэш по частоте) и играет через НЧ-фильтр 2-го порядка, как на Android.
const Bowl = (() => {
  const cache = new Map();

  function render(ctx, base, o) {
    const key = [ctx.sampleRate, base, o.attack, o.decayK, o.beatK, o.length, o.peak].join('|');
    if (cache.has(key)) return cache.get(key);
    const sr = ctx.sampleRate, n = Math.ceil(o.length * sr);
    const buf = ctx.createBuffer(2, n, sr);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const ratio = [1.0, 2.71, 5.13], amp = [1.0, 0.32, 0.07];
    const tau = [2.2 * o.decayK, 1.3 * o.decayK, 0.6 * o.decayK];
    const beat = [1.1 * o.beatK, 0.9 * o.beatK, 1.6 * o.beatK];
    const TWO_PI = Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const tt = i / sr;
      const attack = tt < o.attack ? 0.5 - 0.5 * Math.cos(Math.PI * tt / o.attack) : 1;
      const tail = Math.min(1, (o.length - tt) / 0.8);
      const e = o.peak * attack * tail;
      let sl = 0, sr2 = 0;
      for (let k = 0; k < 3; k++) {
        const a = amp[k] * Math.exp(-tt / tau[k]);
        const fa = base * ratio[k];
        const x = Math.sin(TWO_PI * fa * tt) * a, y = Math.sin(TWO_PI * (fa + beat[k]) * tt) * a;
        sl += 0.65 * x + 0.35 * y; sr2 += 0.35 * x + 0.65 * y;
      }
      L[i] = sl * e; R[i] = sr2 * e;
    }
    cache.set(key, buf);
    return buf;
  }

  function play(ctx, base, o, dest) {
    const src = ctx.createBufferSource();
    src.buffer = render(ctx, base, o);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = o.cutoff; lp.Q.value = 0.707;
    src.connect(lp); lp.connect(dest || ctx.destination);
    src.start();
    src.onended = () => { try { src.disconnect(); lp.disconnect(); } catch (e) {} };
  }

  return {
    /** Тон смены фазы: чаша на октаву ниже ноты фазы, касание 250 мс, звучит ~5 с */
    // 2.7: звуки фаз — под общей громкостью эффектов (V24.fxOut), мимо приглушения пауз
    phase(ctx, freq) { play(ctx, freq / 2, { attack: 0.25, decayK: 1.0, beatK: 1.0, length: 5.0, peak: 0.04, cutoff: 1800 }, typeof V24 !== 'undefined' ? V24.phaseOut() : null); },   // 2.9: громкость «Звука фаз»
    /** Гонг «Храмового хранителя»: большая низкая чаша, нарастает 0.6 с, неторопливое «пение», звучит ~9 с */
    temple(ctx) { play(ctx, 98, { attack: 0.6, decayK: 1.9, beatK: 0.65, length: 9.0, peak: 0.07, cutoff: 1200 }); }
  };
})();
