'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  «Дыхание» 2.7 для ПК — звуковой движок: перенос Synth.kt с Android один к одному
//  (шум моря, стерео-тон, дождь, птицы, костёр, приглушение пауз). Синтез по отсчётам
//  идёт в AudioWorklet — в своём аудиопотоке, анимация страницы ему не мешает.
//  Выход движка → fxOut (общая громкость эффектов) → динамики.
// ═══════════════════════════════════════════════════════════════════════════

/** Код процессора: выполняется внутри AudioWorkletGlobalScope (подключается как Blob) */
function breathSynthWorklet() {
  const sr = sampleRate, PI = Math.PI;
  const BLOCK = 128;
  // ── Константы — как в начале Synth.kt (настройки пользователя «звуки настройки.txt») ──
  const NOISE_LEVEL = 0.015 * 0.33;
  const RAIN_LEVEL = 0.014 * 2.68;
  const BIRDS_LEVEL = 0.6 * 1.78;
  const FIRE_LEVEL = 0.04 * 3 * 1.25 * 3;   // 2.7: костёр базово ×3
  const SEA_CUT = 1010, SEA_Q = 1.6, SEA_WAVE = 25, SEA_WAVE_RATE = 0.11, SEA_FM = 0.9, SEA_AMP_RATE = 0.022, SEA_WIDTH = 0.8;
  const SEA_HOLD_CUT = 150, SEA_FLOOR = 0.4, MUFFLE_MIN_HZ = 425;
  const TONE_BASE = 121, TONE_BEAT = 1.7, TONE_CUT = 1000;
  const Q_DEFAULT = 1.122;

  const rnd = Math.random;
  const sinTurn = p => Math.sin(2 * PI * p);
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

  class Param {
    constructor(v) { this.v = v; this.mode = 0; this.a0 = 0; this.a1 = 0; this.t0 = 0; this.t1 = 0; this.tau = 1; }
    at(t) {
      if (this.mode === 1) return t >= this.t1 ? this.a1 : t <= this.t0 ? this.a0 : this.a0 + (this.a1 - this.a0) * (t - this.t0) / (this.t1 - this.t0);
      if (this.mode === 2) return this.a1 + (this.a0 - this.a1) * Math.exp(-Math.max(0, t - this.t0) / this.tau);
      return this.v;
    }
    linear(from, to, now, dur) {
      if (dur <= 0) { this.mode = 0; this.v = to; return; }
      this.mode = 1; this.a0 = from; this.a1 = to; this.t0 = now; this.t1 = now + dur;
    }
    target(target, now, tau) { this.a0 = this.at(now); this.a1 = target; this.t0 = now; this.tau = tau; this.mode = 2; }
    rampTo(target, now) {
      const cur = this.at(now);
      if (this.mode === 1 && now < this.t1 - 0.03) this.linear(cur, target, now, this.t1 - now); else this.target(target, now, 0.03);
    }
  }

  /** Биквад НЧ (как LowPass в Synth.kt) */
  class LowPass {
    constructor(freq, q = Q_DEFAULT) { this.q = q; this.z1 = 0; this.z2 = 0; this.lastF = -1; this.setFreq(freq); }
    setFreq(fIn) {
      const f = clamp(fIn, 10, sr * 0.45);
      if (Math.abs(f - this.lastF) < 0.01) return;
      this.lastF = f;
      const w0 = 2 * PI * f / sr, alpha = Math.sin(w0) / (2 * this.q), c = Math.cos(w0), a0 = 1 + alpha;
      this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; this.a1 = -2 * c / a0; this.a2 = (1 - alpha) / a0;
    }
    process(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
  }

  /** Биквад RBJ: kind 0 — НЧ, 1 — ВЧ, 2 — полоса; setPeak — колокол */
  class Filter {
    constructor(kind, freq, q) { this.kind = kind; this.q = q; this.z1 = 0; this.z2 = 0; this.setFreq(freq); }
    setFreq(fIn) {
      const f = clamp(fIn, 10, sr * 0.45);
      const w0 = 2 * PI * f / sr, c = Math.cos(w0), al = Math.sin(w0) / (2 * this.q), a0 = 1 + al;
      if (this.kind === 0) { this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; }
      else if (this.kind === 1) { this.b0 = (1 + c) / 2 / a0; this.b1 = -(1 + c) / a0; this.b2 = this.b0; }
      else { this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0; }
      this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
    }
    setPeak(f, db) {
      const a = Math.pow(10, db / 40), w0 = 2 * PI * f / sr, c = Math.cos(w0), al = Math.sin(w0) / (2 * this.q), a0 = 1 + al / a;
      this.b0 = (1 + al * a) / a0; this.b1 = -2 * c / a0; this.b2 = (1 - al * a) / a0; this.a1 = -2 * c / a0; this.a2 = (1 - al / a) / a0;
    }
    process(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
  }

  /** Плавный случайный сигнал 0…1 */
  class Smooth {
    constructor() { this.a = rnd(); this.b = rnd(); this.ph = rnd(); }
    next(rate, d) {
      this.ph += rate * d;
      while (this.ph >= 1) { this.ph -= 1; this.a = this.b; this.b = rnd(); }
      const s = this.ph * this.ph * (3 - 2 * this.ph); return this.a + (this.b - this.a) * s;
    }
  }

  /** Freeverb: 8 гребёнок + 4 всепропускающих на канал, правый сдвинут на 23 отсчёта */
  class Reverb {
    constructor(fb, damp) {
      this.fb = fb; this.damp = damp;
      const k = sr / 44100, bufs = (lens, sp) => lens.map(l => new Float64Array(Math.max(1, Math.floor((l + sp) * k))));
      const combLens = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], apLens = [556, 441, 341, 225];
      this.cb = [bufs(combLens, 0), bufs(combLens, 23)]; this.ab = [bufs(apLens, 0), bufs(apLens, 23)];
      this.ci = [new Int32Array(8), new Int32Array(8)]; this.ai = [new Int32Array(4), new Int32Array(4)];
      this.st = [new Float64Array(8), new Float64Array(8)];
    }
    process(x, ch) {
      let s = 0;
      const c = this.cb[ch], idx = this.ci[ch], store = this.st[ch], damp = this.damp, fb = this.fb;
      for (let n = 0; n < 8; n++) {
        const b = c[n], y = b[idx[n]];
        store[n] = y * (1 - damp) + store[n] * damp;
        b[idx[n]] = x + store[n] * fb;
        if (++idx[n] >= b.length) idx[n] = 0;
        s += y;
      }
      const a = this.ab[ch], ia = this.ai[ch];
      for (let n = 0; n < 4; n++) {
        const b = a[n], bo = b[ia[n]], y = -s + bo;
        b[ia[n]] = s + bo * 0.5;
        if (++ia[n] >= b.length) ia[n] = 0;
        s = y;
      }
      return s;
    }
  }

  /** 4 с розового шума (фильтр Пола Келлета) с кроссфейдом — петля без стыка */
  function makePink() {
    const len = 4 * sr, fade = Math.floor(sr / 2), raw = new Float32Array(len + fade);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
    const out = raw.slice(0, len);
    for (let i = 0; i < fade; i++) { const a = i / fade * PI / 2; out[i] = raw[i] * Math.sin(a) + raw[len + i] * Math.cos(a); }
    return out;
  }
  let pinkBuf = null, whiteBuf = null;
  const pink = () => pinkBuf || (pinkBuf = makePink());
  const white = () => whiteBuf || (whiteBuf = Float32Array.from({ length: 4 * sr }, () => rnd() * 2 - 1));

  // ── Шум моря ──
  class NoiseBed {
    constructor() {
      this.endAt = Infinity;
      this.cutoff = new Param(SEA_CUT); this.waveDepth = new Param(SEA_WAVE);
      this.gain = new Param(0); this.ampDepth = new Param(0);
      this.lp = new LowPass(SEA_CUT, SEA_Q); this.lpR = new LowPass(SEA_CUT, SEA_Q);
      this.pos = 0; this.off = Math.floor(pink().length / 2);
      this.p = new Float64Array(6);
    }
    fadeIn(level, now) { this.gain.linear(0, level, now, 1.5); this.ampDepth.linear(0, level, now, 1.5); }
    ramp(level, now) { this.gain.rampTo(level, now); this.ampDepth.rampTo(level, now); }
    fadeOut(sec, now) {
      this.gain.linear(this.gain.at(now), 0, now, sec); this.ampDepth.linear(this.ampDepth.at(now), 0, now, sec);
      this.endAt = now + sec + 0.05;
    }
    render(l, r, t0) {
      const dt = BLOCK / sr, p = this.p;
      const chaos = sinTurn(p[0]); p[0] += 0.013 * dt;
      const mod = sinTurn(p[1]); p[1] += (0.047 + chaos) * dt;
      const main = sinTurn(p[2]); p[2] += (SEA_WAVE_RATE + SEA_FM * mod) * dt;
      const ampChaos = sinTurn(p[3]); p[3] += 0.009 * dt;
      const ampMod = sinTurn(p[4]); p[4] += (0.029 + 0.014 * ampChaos) * dt;
      const ampMain = sinTurn(p[5]); p[5] += (SEA_AMP_RATE + 0.03 * ampMod) * dt;
      const tm = t0 + dt / 2;
      const fc = this.cutoff.at(tm) + this.waveDepth.at(tm) * main;
      this.lp.setFreq(fc); this.lpR.setFreq(fc);
      const g = this.gain.at(tm) * (1 + SEA_FLOOR) + this.ampDepth.at(tm) * (1 - SEA_FLOOR) * ampMain;
      const buf = pink(), n = buf.length;
      for (let i = 0; i < BLOCK; i++) {
        const a = this.lp.process(buf[this.pos]) * g;
        const b = this.lpR.process(buf[(this.pos + this.off) % n]) * g;
        if (++this.pos >= n) this.pos = 0;
        l[i] += a; r[i] += a * (1 - SEA_WIDTH) + b * SEA_WIDTH;
      }
    }
  }

  // ── Стерео-тон ──
  class Binaural {
    constructor() {
      this.endAt = Infinity;
      this.freqL = new Param(TONE_BASE); this.freqR = new Param(TONE_BASE + TONE_BEAT);
      this.cutoff = new Param(TONE_CUT); this.wave = new Param(1); this.gain = new Param(0);
      this.lpL = new LowPass(TONE_CUT); this.lpR = new LowPass(TONE_CUT);
      this.pL = 0; this.pR = 0;
    }
    render(l, r, t0) {
      const tm = t0 + BLOCK / sr / 2;
      const fl = this.freqL.at(tm) / sr, fr = this.freqR.at(tm) / sr;
      const c = this.cutoff.at(tm); this.lpL.setFreq(c); this.lpR.setFreq(c);
      const g = this.wave.at(tm) * this.gain.at(tm);
      for (let i = 0; i < BLOCK; i++) {
        l[i] += this.lpL.process(sinTurn(this.pL)) * g;
        r[i] += this.lpR.process(sinTurn(this.pR)) * g;
        this.pL += fl; this.pR += fr;
      }
      this.pL -= Math.floor(this.pL); this.pR -= Math.floor(this.pR);
    }
  }

  const dt1 = 1 / sr;
  const noise = () => rnd() * 2 - 1;

  // ── Дождь ──
  class RainBed {
    constructor() {
      this.endAt = Infinity; this.gain = new Param(0); this.level = RAIN_LEVEL;
      this.bpL = new Filter(2, 1650, 0.9); this.bpR = new Filter(2, 1650, 0.9);
      this.lpL = new Filter(0, 330, 1.68); this.lpR = new Filter(0, 330, 1.68);
      this.hpL = new Filter(1, 3750, 0.7); this.hpR = new Filter(1, 3750, 0.7);
      this.pos = 0; this.pg = 0; this.off = Math.floor(sr * 1.37);
      this.ev = []; this.nextTick = -1; this.nextPlink = -1;
    }
    render(l, r, t0) {
      const g0 = this.gain.at(t0), g1 = this.gain.at(t0 + BLOCK * dt1);
      const buf = white(), ev = this.ev;
      if (this.nextTick < 0) { this.nextTick = t0; this.nextPlink = t0 + 0.3; }
      for (let i = 0; i < BLOCK; i++) {
        const tt = t0 + i * dt1;
        const wl = buf[this.pos], wr = buf[(this.pos + this.off) % buf.length];
        if (++this.pos >= buf.length) this.pos = 0;
        const gust = 1 + 0.14 * sinTurn(this.pg); this.pg += 0.05 * dt1;
        let x = (this.bpL.process(wl) * 0.4 + this.lpL.process(wl) * 0.06 + this.hpL.process(wl) * 0.01) * gust;
        let y = (this.bpR.process(wr) * 0.4 + this.lpR.process(wr) * 0.06 + this.hpR.process(wr) * 0.01) * gust;
        if (tt >= this.nextTick) {
          ev.push({ t0: tt, len: 0.0096 * (0.67 + rnd() * 0.67), g: 0.05 + rnd() * 0.12, pan: rnd(), kind: 0, f: new Filter(1, 5200 * (0.625 + rnd() * 0.75), 0.7) });
          this.nextTick = tt + (0.29 + rnd() * 1.43) / 40;
        }
        if (tt >= this.nextPlink) {
          ev.push({ t0: tt, len: 0.005, g: 0.04 + rnd() * 0.08, pan: rnd(), kind: 1, f0: 800 * (0.58 + rnd() * 0.84), ph: 0 });
          this.nextPlink = tt + (0.324 + rnd() * 1.35) / 1.6;
        }
        for (let j = ev.length - 1; j >= 0; j--) {
          const e = ev[j], u = tt - e.t0;
          if (u > e.len * 2.5 + 0.03) { ev.splice(j, 1); continue; }
          let s;
          if (e.kind === 0) s = e.f.process(noise()) * e.g * Math.exp(-u / e.len);
          else {
            e.ph += e.f0 * (1 + 2.5 * (1 - Math.exp(-u / 0.012))) * dt1;
            s = sinTurn(e.ph) * e.g * (u < 0.002 ? u / 0.002 : 1) * Math.exp(-u / e.len);
          }
          x += s * (1 - e.pan) * 1.4; y += s * e.pan * 1.4;
        }
        const g = g0 + (g1 - g0) * i / BLOCK;
        l[i] += x * g; r[i] += y * g;
      }
    }
  }

  // ── Костёр (настройки пользователя «звуки настройки.txt», 2.7) ──
  class FireBed {
    constructor() {
      this.endAt = Infinity; this.gain = new Param(0); this.level = FIRE_LEVEL;
      this.mean = 1.0; this.vari = 0.2; this.speed = 0.1; this.width = 0.18; this.dist = 0.66;
      this.roarVol = 0.05 * 2.4; this.roarFreq = 63; this.roarDepth = 0; this.roarRate = 0.13;
      this.flutVol = 0; this.flutFreq = 140; this.flutRate = 1; this.flutDepth = 0.95;   // «языки пламени» выключены
      this.hissVol = 0.02 * 0.12; this.hissFreq = 10000;
      this.crkVol = 0.5 * 1.6; this.crkRate = 1.1; this.crkCluster = 2; this.crkSpread = 9; this.crkTone = 7600; this.crkLen = 0.6;
      this.popVol = 0.04 * 3.0; this.popRate = 7.5; this.popTone = 2160; this.popRes = 1.0; this.popTail = 0.2;
      this.sizVol = 0.03 * 0.7; this.sizRate = 1.0; this.sizLen = 2.7; this.sizTone = 10000; this.sizWhistle = 0.06;
      this.thdVol = 0.04 * 3.5; this.thdRate = 12;
      this.roarL = new Filter(0, this.roarFreq, 0.8); this.roarR = new Filter(0, this.roarFreq, 0.8);
      this.flL = new Filter(2, this.flutFreq, 0.9); this.flR = new Filter(2, this.flutFreq, 0.9);
      this.hsL = new Filter(1, this.hissFreq, 0.7); this.hsR = new Filter(1, this.hissFreq, 0.7);
      this.sE1 = new Smooth(); this.sE2 = new Smooth(); this.sBr = new Smooth(); this.sFl = new Smooth(); this.sHs = new Smooth();
      this.ev = []; this.t = -1;
      this.nCrk = 0; this.nPop = 0; this.nSiz = 0; this.nThd = 0; this.dl = 0; this.dr = 0;
      this.ka = 1 - Math.exp(-2 * PI * (20000 * Math.pow(1200 / 20000, this.dist)) / sr);
    }
    expo(r) { return r > 0 ? -Math.log(1 - rnd()) / r : 1e9; }
    randn() { return (rnd() + rnd() + rnd() + rnd() - 2) * 1.73; }
    click(t0, g, freq, q, len, pan) { this.ev.push({ k: 0, t0, g, len, life: len * 7, pan, f: new Filter(2, freq, q) }); }
    spawn(t1, e) {
      while (this.nCrk < t1) {
        const n = 1 + Math.floor(rnd() * this.crkCluster); let tc = this.nCrk;
        for (let i = 0; i < n; i++) {
          this.click(tc, this.crkVol * (0.15 + 0.85 * rnd() * rnd()) * (0.6 + 0.6 * e), this.crkTone * Math.pow(2, this.randn() * 0.6), 1.5, this.crkLen / 1000 * (0.5 + rnd()), 0.5 + (rnd() - 0.5) * 0.9);
          tc += this.expo(1000 / this.crkSpread);
        }
        this.nCrk += this.expo(this.crkRate * (0.3 + 1.4 * e));
      }
      while (this.nPop < t1) {
        const t0 = this.nPop, pan = 0.5 + (rnd() - 0.5) * 0.7;
        const fr = this.popTone * Math.pow(2, (rnd() - 0.5) * 1.2), len = 0.006 + rnd() * 0.018;
        this.ev.push({ k: 1, t0, g: this.popVol * (0.5 + 0.5 * rnd()), len, life: len * 8, pan, f: new Filter(2, fr, this.popRes), fr: fr * (1.5 + rnd()), ph: 0 });
        if (rnd() < this.popTail) {
          const n = 2 + Math.floor(rnd() * 5); let tc = t0 + 0.01;
          for (let i = 0; i < n; i++) { tc += 0.005 + rnd() * 0.04; this.click(tc, this.popVol * 0.12 * (0.3 + rnd()), fr * (2 + rnd() * 3), 1.5, 0.0008 + rnd() * 0.0015, clamp(pan + (rnd() - 0.5) * 0.3, 0, 1)); }
        }
        this.nPop += this.expo(this.popRate / 60 * (0.4 + 1.2 * e));
      }
      while (this.nSiz < t1) {
        const len = this.sizLen * (0.6 + rnd() * 0.8);
        this.ev.push({ k: 2, t0: this.nSiz, g: this.sizVol * (0.6 + 0.4 * rnd()), len, life: len, pan: 0.5 + (rnd() - 0.5) * 0.6,
          f: new Filter(2, this.sizTone * (0.8 + rnd() * 0.4), 1.4), fr: 2200 + rnd() * 1800, ph: 0, tex: new Smooth(), vib: new Smooth() });
        this.nSiz += this.expo(this.sizRate / 60);
      }
      while (this.nThd < t1) {
        const t0 = this.nThd, pan = 0.5 + (rnd() - 0.5) * 0.5;
        this.ev.push({ k: 3, t0, g: this.thdVol * (0.6 + 0.4 * rnd()), len: 0.07, life: 0.5, pan, f: new Filter(0, 120 + rnd() * 80, 0.9) });
        const n = 5 + Math.floor(rnd() * 10); let tc = t0;
        for (let i = 0; i < n; i++) { tc += this.expo(30); this.click(tc, this.thdVol * 0.05 * (0.3 + rnd()), 900 + rnd() * 2500, 1.2, 0.0015 + rnd() * 0.003, clamp(pan + (rnd() - 0.5) * 0.4, 0, 1)); }
        this.nThd += this.expo(this.thdRate / 60);
      }
    }
    render(l, r, t0) {
      if (this.t < 0) { this.nCrk = t0; this.nPop = t0 + 0.4; this.nSiz = t0 + 2; this.nThd = t0 + 4; }
      this.t = t0;
      const g0 = this.gain.at(t0), g1 = this.gain.at(t0 + BLOCK * dt1);
      const cb = 64, d = cb * dt1, ev = this.ev;
      for (let i0 = 0; i0 < BLOCK; i0 += cb) {
        const e = clamp(this.mean + this.vari * ((this.sE1.next(this.speed, d) * 2 - 1) * 0.7 + (this.sE2.next(this.speed * 4, d) * 2 - 1) * 0.3), 0.05, 1);
        const fr = this.roarFreq * (0.75 + 0.5 * e); this.roarL.setFreq(fr); this.roarR.setFreq(fr);
        const br = this.sBr.next(this.roarRate, d);
        const gRoar = this.roarVol * (1 - this.roarDepth * (1 - br)) * (0.5 + e);
        const fl = this.sFl.next(this.flutRate, d), ff = this.flutFreq * (0.75 + 0.5 * fl); this.flL.setFreq(ff); this.flR.setFreq(ff);
        const gFl = this.flutVol * ((1 - this.flutDepth) + this.flutDepth * fl * fl * 1.6) * (0.4 + 0.8 * e);
        const hs = this.sHs.next(1.1, d);
        const gHs = this.hissVol * (0.6 + 0.4 * hs) * (0.5 + 0.7 * e);
        this.spawn(this.t + d, e);
        for (let i = i0; i < i0 + cb; i++) {
          const tt = this.t + (i - i0) * dt1;
          const wl = noise(), wr = noise();
          let x = this.roarL.process(wl) * gRoar + this.hsL.process(wl) * gHs;
          let y = this.roarR.process(wr) * gRoar + this.hsR.process(wr) * gHs;
          if (gFl > 0) { x += this.flL.process(wl) * gFl; y += this.flR.process(wr) * gFl; }
          for (let j = ev.length - 1; j >= 0; j--) {
            const v = ev[j], u = tt - v.t0;
            if (u < 0) continue;
            if (u > v.life) { ev.splice(j, 1); continue; }
            let s;
            if (v.k === 1) { v.ph += v.fr * dt1; s = v.f.process(noise()) * Math.exp(-u / v.len) * 2 + sinTurn(v.ph) * 0.25 * Math.exp(-u / (v.len * 0.6)); }
            else if (v.k === 2) {
              const p = u / v.len, env = Math.sin(PI * Math.min(1, p)) * Math.min(1, p * 4), tex = v.tex.next(35, dt1);
              v.ph += v.fr * (1 + 0.01 * (v.vib.next(6, dt1) - 0.5)) * dt1;
              s = (v.f.process(noise()) * (0.3 + tex * tex * 1.4) + sinTurn(v.ph) * 0.06 * this.sizWhistle) * env;
            } else s = v.f.process(noise()) * Math.exp(-u / v.len);
            s *= v.g;
            x += s * (1 - v.pan) * 1.4; y += s * v.pan * 1.4;
          }
          const mid = (x + y) * 0.5, side = (x - y) * 0.5 * this.width;
          this.dl += this.ka * (mid + side - this.dl); this.dr += this.ka * (mid - side - this.dr);
          const g = g0 + (g1 - g0) * i / BLOCK;
          l[i] += this.dl * g; r[i] += this.dr * g;
        }
        this.t += d;
      }
    }
  }

  // ── Птицы: стая из 8 птиц со своими песнями ──
  class BirdsBed {
    constructor() {
      this.endAt = Infinity; this.gain = new Param(0); this.level = BIRDS_LEVEL;
      this.count = 8; this.every = 1.9; this.nearShare = 0; this.far = 0.2; this.farLp = 0.9;
      this.forest = 0.35; this.width = 0.16; this.soft = 1; this.ear = 15;
      this.tone = 2870; this.spread = 0.4; this.speed = 0.8; this.lengthK = 1; this.variety = 0.5;
      this.w = [0.06, 0.1, 0.21, 0.4, 0.25]; this.bright = 0.2; this.vibrato = 0.3; this.attack = 0.040;
      this.ev = []; this.flock = null;
      this.rev = new Reverb(0.78, 0.7); this.sendLp = 0;
      this.kSend = 1 - Math.exp(-2 * PI * 2500 / sr);
      const fs = 16000 * Math.pow(3000 / 16000, this.soft);
      this.lpL = new Filter(0, fs, 0.707); this.lpR = new Filter(0, fs, 0.707);
      this.pkL = new Filter(3, 3500, 0.9); this.pkL.setPeak(3500, -this.ear);
      this.pkR = new Filter(3, 3500, 0.9); this.pkR.setPeak(3500, -this.ear);
    }
    btw(a, b) { return a + rnd() * (b - a); }
    sm(x) { const v = clamp(x, 0, 1); return v * v * (3 - 2 * v); }
    makeSyl(base) {
      const w = this.w, sum = w.reduce((a, b) => a + b, 0);
      let rr = rnd() * sum, type = 0;
      while (rr > w[type] && type < 4) { rr -= w[type]; type++; }
      const o = { type, h2: rnd() * this.bright * 0.18, h3: rnd() * this.bright * 0.05, amp: this.btw(0.7, 1),
        vd: this.vibrato * this.btw(0.005, 0.03), vr: this.btw(5, 12), dur: 0, f0: 0, f1: 0, fp: 0, rep: 1, repGap: 0, drift: 1, after: 0, pts: null, fmR: 0, fmD: 0 };
      const b = (x, y) => this.btw(x, y);
      if (type === 0) { o.dur = b(0.15, 0.45); o.f0 = base * b(0.6, 1.1); o.f1 = o.f0 * b(0.7, 1.4); o.rep = rnd() < 0.3 ? 2 : 1; o.repGap = b(0.05, 0.15); }
      else if (type === 4) { o.dur = b(0.06, 0.18); o.f0 = base * b(0.8, 1); o.fp = o.f0 * b(1.15, 1.5); o.f1 = o.f0 * b(0.85, 1.1); o.rep = 1 + Math.floor(rnd() * 3); o.repGap = b(0.04, 0.1); }
      else if (type === 2) { o.dur = b(0.015, 0.04); o.f0 = base * b(1.2, 1.8); o.f1 = o.f0 * b(0.5, 0.75); o.rep = 1 + Math.floor(rnd() * 4); o.repGap = b(0.06, 0.16); o.vd = 0; }
      else if (type === 1) { o.dur = b(0.02, 0.05); o.f0 = base * b(0.9, 1.4); o.f1 = o.f0 * b(0.7, 1.3); o.rep = 5 + Math.floor(rnd() * 10); o.repGap = b(0.012, 0.04); o.drift = b(0.97, 1.03); o.vd = 0; }
      else { o.dur = b(0.12, 0.3); o.f0 = base * b(0.8, 1.2); o.pts = Array.from({ length: 6 }, () => 1 + (rnd() * 2 - 1) * 0.18); o.fmR = b(25, 45); o.fmD = b(0.01, 0.04); o.f1 = o.f0; }
      o.dur /= this.speed; o.repGap /= this.speed; o.after = this.btw(0.03, 0.14) / this.speed;
      return o;
    }
    makeFlock(t0) {
      return Array.from({ length: this.count }, (_, i) => {
        const near = rnd() < this.nearShare;
        const base = this.tone * (1 + (rnd() * 2 - 1) * this.spread);
        const syl = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => this.makeSyl(base));
        const pattern = syl.map((_, k) => k); if (rnd() < 0.4) pattern.push(0);
        const fc = near ? 12000 : 12000 * Math.pow(2500 / 12000, this.farLp);
        return { g: near ? 0.12 : 0.12 * this.far, pan: this.count > 1 ? 0.5 + (i / (this.count - 1) - 0.5) * this.width * this.btw(0.7, 1) : 0.5,
          ka: 1 - Math.exp(-2 * PI * fc / sr), send: near ? 0.35 : 1, syl, pattern, next: t0 + 0.5 + i * 1.2 + rnd() };
      });
    }
    sing(b, t0) {
      const pat = b.pattern.slice(), v = this.variety;
      if (rnd() < v * 0.5 && pat.length > 1) pat.pop();
      if (rnd() < v * 0.3) pat.push(Math.floor(rnd() * b.syl.length));
      let t = t0;
      for (const idx of pat) {
        const o = b.syl[idx];
        const reps = Math.max(1, Math.round(o.rep * this.lengthK * (1 + (rnd() * 2 - 1) * v * 0.4)));
        let fm = 1 + (rnd() * 2 - 1) * 0.03 * v;
        for (let k = 0; k < reps; k++) {
          const dur = o.dur * (1 + (rnd() * 2 - 1) * 0.1 * v);
          const trillK = o.type === 1 ? 0.75 + 0.25 * Math.sin(PI * (k + 0.5) / reps) : 1;
          this.ev.push({ t0: t, o, dur, fm, amp: o.amp * (0.85 + rnd() * 0.3) * trillK, bird: b, ph: 0, y: 0 });
          t += dur + o.repGap * (0.8 + rnd() * 0.4); fm *= o.drift;
        }
        t += o.after;
      }
      return t;
    }
    render(l, r, t0) {
      const fl = this.flock || (this.flock = this.makeFlock(t0));
      const t1 = t0 + BLOCK * dt1;
      for (const b of fl) while (b.next < t1) { const end = this.sing(b, b.next); b.next = end + this.every * fl.length * this.btw(0.5, 1.5); }
      const g0 = this.gain.at(t0), g1 = this.gain.at(t1), wet = this.forest * 4, ev = this.ev, sm = x => this.sm(x);
      for (let i = 0; i < BLOCK; i++) {
        const tt = t0 + i * dt1;
        let x = 0, y = 0, send = 0;
        for (let j = ev.length - 1; j >= 0; j--) {
          const e = ev[j], q = tt - e.t0;
          if (q < 0) continue;
          if (q > e.dur) { ev.splice(j, 1); continue; }
          const o = e.o, u = q / e.dur;
          let f;
          if (o.type === 4) f = u < 0.5 ? o.f0 + (o.fp - o.f0) * sm(u * 2) : o.fp + (o.f1 - o.fp) * sm(u * 2 - 1);
          else if (o.type === 2) f = o.f1 + (o.f0 - o.f1) * Math.exp(-u * 3);
          else if (o.type === 3) { const p = u * 5, k = Math.min(4, Math.floor(p)), pts = o.pts; f = o.f0 * (pts[k] + (pts[k + 1] - pts[k]) * sm(p - k)) * (1 + o.fmD * sinTurn(o.fmR * q)); }
          else f = o.f0 + (o.f1 - o.f0) * sm(u);
          f *= e.fm * (1 + o.vd * sinTurn(o.vr * q));
          e.ph += f * dt1;
          const a = Math.min(this.attack, e.dur * 0.3), rl = Math.max(0.004, e.dur * 0.35);
          const env = sm(q / Math.max(a, 0.001)) * sm((e.dur - q) / rl) * e.amp;
          let s = (sinTurn(e.ph) + o.h2 * sinTurn(2 * e.ph) + o.h3 * sinTurn(3 * e.ph)) * env * e.bird.g;
          e.y += e.bird.ka * (s - e.y); s = e.y;
          x += s * (1 - e.bird.pan) * 1.4; y += s * e.bird.pan * 1.4; send += s * e.bird.send;
        }
        this.sendLp += this.kSend * (send - this.sendLp);
        x = this.pkL.process(this.lpL.process(x + this.rev.process(this.sendLp * 0.015, 0) * wet));
        y = this.pkR.process(this.lpR.process(y + this.rev.process(this.sendLp * 0.015, 1) * wet));
        const g = g0 + (g1 - g0) * i / BLOCK;
        l[i] += x * g; r[i] += y * g;
      }
    }
  }

  // ── Ночной лес (2.9, вместо стерео-тона) — перенос Synth.NightBed: воздух, листва, сверчки, цикады, сова; эхо и «удалённость» ──
  const NIGHT_LEVEL = 0.15 * 3;
  class NightBed {
    constructor() {
      this.endAt = Infinity; this.gain = new Param(0); this.level = NIGHT_LEVEL;
      this.width = 0.5; this.dist = 0.87; this.echo = 0.3;
      this.ambVol = 0.01 * 0.7; this.ambFreq = 305;
      this.leafVol = 0.01 * 1.2; this.leafFreq = 8000; this.leafGust = 1; this.leafRate = 0.5;
      this.crkVol = 0.1 * 0.5; this.crkCount = 3; this.crkTone = 4600; this.crkSpread = 0.085; this.crkChirp = 0.45; this.crkPulses = 4; this.crkPulseRate = 36; this.crkSync = 0.21;
      this.katVol = 0.06 * 1.5; this.katCount = 3; this.katTone = 7500; this.katAm = 37; this.katLen = 7.3; this.katGap = 17.5;
      this.owlVol = 0.01 * 0.7; this.owlRate = 0.3; this.owlPitch = 330;
      this.ev = []; this.crick = null; this.rev = new Reverb(0.78, 0.7); this.sendLp = 0;
      this.kSend = 1 - Math.exp(-2 * PI * 3000 / sr);
      this.ka = 1 - Math.exp(-2 * PI * 20000 * Math.pow(1500 / 20000, this.dist) / sr);
      this.dl = 0; this.dr = 0;
      this.ambL = new Filter(0, this.ambFreq, 0.7); this.ambR = new Filter(0, this.ambFreq, 0.7);
      this.lfL = new Filter(2, this.leafFreq, 0.7); this.lfR = new Filter(2, this.leafFreq, 0.7);
      this.sLf = new Smooth(); this.sLf2 = new Smooth();
      this.pk = [new Float64Array(7), new Float64Array(7)];
      this.nKat = -1; this.nOwl = -1;
    }
    pink(ch) {
      const b = this.pk[ch], w = rnd() * 2 - 1;
      b[0] = 0.99886 * b[0] + w * 0.0555179; b[1] = 0.99332 * b[1] + w * 0.0750759; b[2] = 0.96900 * b[2] + w * 0.1538520;
      b[3] = 0.86650 * b[3] + w * 0.3104856; b[4] = 0.55000 * b[4] + w * 0.5329522; b[5] = -0.7616 * b[5] - w * 0.0168980;
      const p = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362) * 0.11; b[6] = w * 0.115926; return p;
    }
    btw(a, b) { return a + rnd() * (b - a); }
    sm(x) { const v = clamp(x, 0, 1); return v * v * (3 - 2 * v); }
    expo(r) { return r > 0 ? -Math.log(1 - rnd()) / r : 1e9; }
    panR() { return 0.5 + (rnd() - 0.5) * this.width; }
    cast(t0) {
      return Array.from({ length: this.crkCount }, () => {
        const far = rnd();
        return { f: this.crkTone * (1 + (rnd() * 2 - 1) * this.crkSpread), pan: this.panR(), g: 1 - 0.75 * far,
          ka: 1 - Math.exp(-2 * PI * 14000 * Math.pow(3000 / 14000, far) / sr), next: t0 + rnd() * 1.5, pr: this.crkPulseRate * this.btw(0.9, 1.1) };
      });
    }
    owl(t0) {
      const n = 2 + Math.floor(rnd() * 3), f = this.owlPitch * this.btw(0.93, 1.07), pan = this.panR(), ka = 1 - Math.exp(-2 * PI * 2500 / sr);
      let t = t0;
      for (let i = 0; i < n; i++) {
        const last = i === n - 1, len = last ? this.btw(0.6, 0.9) : this.btw(0.22, 0.4);
        this.ev.push({ k: 2, t0: t, len, f: f * (last ? 0.96 : 1), pan, g: last ? 1 : 0.8, ka, ph: 0, y: 0 });
        t += len + (i === 0 ? this.btw(0.35, 0.6) : this.btw(0.08, 0.18));
      }
    }
    spawn(t0, t1) {
      const cr = this.crick || (this.crick = this.cast(t0));
      if (this.nKat < 0) { this.nKat = t0 + 1 + rnd() * 3; this.nOwl = t0 + 5 + rnd() * 10; }
      const p = 1 / this.crkChirp, s = this.crkSync;
      for (const c of cr) while (c.next < t1) {
        const len = 0.55 / c.pr;
        for (let i = 0; i < this.crkPulses; i++) this.ev.push({ k: 0, t0: c.next + i / c.pr, len, f: c.f * (1 - 0.01 * i), pan: c.pan, g: c.g * (0.85 + 0.15 * rnd()), ka: c.ka, ph: 0, y: 0 });
        let nx = c.next + p * (1 + (1 - s) * (rnd() - 0.5) * 0.8);
        nx += (Math.ceil(nx / p) * p - nx) * s;
        c.next = Math.max(nx, c.next + this.crkPulses / c.pr + 0.05);
      }
      while (this.nKat < t1) {
        let longest = 0;
        for (let i = 0; i < this.katCount; i++) {
          const len = this.katLen * this.btw(0.6, 1.4), f = this.katTone * this.btw(0.88, 1.12); longest = Math.max(longest, len);
          this.ev.push({ k: 1, t0: this.nKat + rnd() * 1.2, len, f, pan: this.panR(), g: this.btw(0.5, 1), ka: 1, ph: 0, y: 0, am: this.katAm * this.btw(0.9, 1.1), bp: new Filter(2, f, 8) });
        }
        this.nKat += longest + this.expo(1 / this.katGap);
      }
      while (this.nOwl < t1) { this.owl(this.nOwl); this.nOwl += this.expo(this.owlRate / 60) + 3; }
    }
    render(l, r, t0) {
      const t1 = t0 + BLOCK * dt1;
      this.spawn(t0, t1);
      const gu = this.sLf.next(this.leafRate, BLOCK * dt1) * 0.7 + this.sLf2.next(this.leafRate * 3.1, BLOCK * dt1) * 0.3;
      const gL = this.leafVol * ((1 - this.leafGust) * 0.5 + this.leafGust * gu * gu * gu * 2);
      const g0 = this.gain.at(t0), g1 = this.gain.at(t1), wet = this.echo * 4, ev = this.ev, sm = x => this.sm(x);
      for (let i = 0; i < BLOCK; i++) {
        const tt = t0 + i * dt1;
        let x = this.ambL.process(this.pink(0)) * this.ambVol + this.lfL.process(rnd() * 2 - 1) * gL;
        let y = this.ambR.process(this.pink(1)) * this.ambVol + this.lfR.process(rnd() * 2 - 1) * gL;
        let send = 0;
        for (let j = ev.length - 1; j >= 0; j--) {
          const e = ev[j], q = tt - e.t0;
          if (q < 0) continue;
          if (q > e.len) { ev.splice(j, 1); continue; }
          const u = q / e.len;
          let s;
          if (e.k === 0) { const en = Math.sin(PI * u); e.ph += e.f * dt1; s = (sinTurn(e.ph) + 0.12 * sinTurn(2 * e.ph)) * en * en * this.crkVol; }
          else if (e.k === 1) { const fd = Math.min(0.6, e.len * 0.2), a = 0.5 + 0.5 * sinTurn(e.am * q); s = e.bp.process(rnd() * 2 - 1) * a * a * sm(q / fd) * sm((e.len - q) / fd) * 3 * this.katVol; }
          else { const fi = e.f * (1 + 0.04 * Math.sin(PI * u) - 0.05 * u * u); e.ph += fi * dt1; s = (sinTurn(e.ph) + 0.15 * sinTurn(2 * e.ph)) * Math.pow(Math.sin(PI * u), 1.5) * this.owlVol; }
          s *= e.g;
          e.y += e.ka * (s - e.y); s = e.y;
          x += s * (1 - e.pan) * 1.4; y += s * e.pan * 1.4; send += s * (e.k === 2 ? 2.5 : 1);
        }
        this.sendLp += this.kSend * (send - this.sendLp);
        x += this.rev.process(this.sendLp * 0.015, 0) * wet;
        y += this.rev.process(this.sendLp * 0.015, 1) * wet;
        this.dl += this.ka * (x - this.dl); this.dr += this.ka * (y - this.dr);
        const g = g0 + (g1 - g0) * i / BLOCK;
        l[i] += this.dl * g; r[i] += this.dr * g;
      }
    }
  }

  class BreathSynth extends AudioWorkletProcessor {
    constructor() {
      super();
      this.t = 0; this.noise = null; this.tone = null; this.night = null; this.beds = [null, null, null]; this.fading = [];
      this.muffleP = new Param(0); this.busL = null; this.busR = null;
      this.al = new Float64Array(BLOCK); this.ar = new Float64Array(BLOCK);
      this.port.onmessage = (e) => { const [cmd, ...a] = e.data; if (this[cmd]) this[cmd](...a); };
    }
    // ── Команды (имена совпадают с методами Synth.kt) ──
    startNoise(vol) { if (!this.noise) { this.noise = new NoiseBed(); this.noise.fadeIn(vol * NOISE_LEVEL, this.t); } }
    stopNoise(fade) { const n = this.noise; if (n) { n.fadeOut(fade, this.t); this.fading.push(n); this.noise = null; } }
    setNoiseVolume(vol) { if (this.noise) this.noise.ramp(vol * NOISE_LEVEL, this.t); }
    noiseMuffle(m) {
      const n = this.noise; if (!n) return;
      const k = clamp(m, 0, 1);
      n.cutoff.target(SEA_CUT - (SEA_CUT - SEA_HOLD_CUT) * k, this.t, 0.05); n.waveDepth.target(SEA_WAVE * (1 - k), this.t, 0.05);
    }
    startTone(gain) { if (!this.tone) { this.tone = new Binaural(); this.tone.gain.linear(0, gain, this.t, 1.5); } }
    stopTone(fade) { const s = this.tone; if (s) { s.gain.linear(s.gain.at(this.t), 0, this.t, fade); s.endAt = this.t + fade + 0.05; this.fading.push(s); this.tone = null; } }
    setToneGain(v) { if (this.tone) this.tone.gain.rampTo(v, this.t); }
    toneTargets(freq, tauF, filter, tauFilter, wave, tauWave, gain, tauGain) {
      const s = this.tone; if (!s) return; const t = this.t;
      s.freqL.target(freq, t, tauF); s.freqR.target(freq + TONE_BEAT, t, tauF);
      s.cutoff.target(filter, t, tauFilter); s.wave.target(wave, t, tauWave); s.gain.target(gain, t, tauGain);
    }
    toneRest(gain) {
      const s = this.tone; if (!s) return; const t = this.t;
      s.freqL.target(TONE_BASE, t, 0.1); s.freqR.target(TONE_BASE + TONE_BEAT, t, 0.1); s.cutoff.target(TONE_CUT, t, 0.1);
      s.wave.target(1, t, 0.1); s.gain.target(gain, t, 0.1);
    }
    startBed(id, vol) {
      if (this.beds[id]) return;
      const b = id === 0 ? new RainBed() : id === 1 ? new BirdsBed() : new FireBed();
      b.gain.linear(0, vol * b.level, this.t, 1.5); this.beds[id] = b;
    }
    stopBed(id, fade) {
      const b = this.beds[id]; if (!b) return;
      b.gain.linear(b.gain.at(this.t), 0, this.t, fade); b.endAt = this.t + fade + 0.05; this.fading.push(b); this.beds[id] = null;
    }
    setBedVolume(id, vol) { const b = this.beds[id]; if (b) b.gain.rampTo(vol * b.level, this.t); }
    muffle(m) { this.muffleP.target(clamp(m, 0, 1), this.t, 0.04); }
    startNight(vol) { if (!this.night) { const b = new NightBed(); b.gain.linear(0, vol * b.level, this.t, 1.5); this.night = b; } }
    stopNight(fade) { const b = this.night; if (b) { b.gain.linear(b.gain.at(this.t), 0, this.t, fade); b.endAt = this.t + fade + 0.05; this.fading.push(b); this.night = null; } }
    setNightVolume(vol) { const b = this.night; if (b) b.gain.rampTo(vol * b.level, this.t); }

    process(inputs, outputs) {
      const out = outputs[0], L = out[0], R = out[1] || out[0];
      const n = L.length;   // 128
      const al = this.al, ar = this.ar, t0 = this.t;
      al.fill(0); ar.fill(0);
      const busy = this.noise || this.tone || this.night || this.fading.length || this.beds[0] || this.beds[1] || this.beds[2];
      if (busy) {
        if (this.noise) this.noise.render(al, ar, t0);
        if (this.tone) this.tone.render(al, ar, t0);
        if (this.night) this.night.render(al, ar, t0);
        for (const b of this.beds) if (b) b.render(al, ar, t0);
        for (let i = this.fading.length - 1; i >= 0; i--) { const s = this.fading[i]; s.render(al, ar, t0); if (t0 > s.endAt) this.fading.splice(i, 1); }
        // Приглушение пауз: срез 18 кГц → 425 Гц по логарифму; почти открыто — фильтр не трогаем
        const mu = this.muffleP.at(t0 + BLOCK / sr / 2);
        if (mu > 0.002) {
          const fl = this.busL || (this.busL = new Filter(0, 18000, 0.707)), fr = this.busR || (this.busR = new Filter(0, 18000, 0.707));
          const fc = 18000 * Math.pow(MUFFLE_MIN_HZ / 18000, mu);
          fl.setFreq(fc); fr.setFreq(fc);
          for (let i = 0; i < BLOCK; i++) { al[i] = fl.process(al[i]); ar[i] = fr.process(ar[i]); }
        } else { this.busL = null; this.busR = null; }
      }
      for (let i = 0; i < n; i++) { L[i] = clamp(al[i], -1, 1); if (R !== L) R[i] = clamp(ar[i], -1, 1); }
      this.t += BLOCK / sr;
      return true;
    }
  }
  registerProcessor('breath-synth', BreathSynth);
}

/** Обёртка на странице: те же команды, что у Synth.kt; до загрузки процессора команды копятся в очереди */
const Synth = (() => {
  const SINE_LEVEL = 0.035 * 0.4;
  const C = {
    SINE_LEVEL, SINE_HOLD_LEVEL: SINE_LEVEL * 0.9,
    TONE_BASE: 121, TONE_BEAT: 1.7, TONE_CUT: 1000, TONE_FOLLOW: 0.8,
    BED_RAIN: 0, BED_BIRDS: 1, BED_FIRE: 2
  };
  let node = null, ctxOf = null, loading = null, out = null;
  const queue = [];
  let noiseOn = false, toneOn = false, nightOn = false;
  const beds = [false, false, false];

  /** Подключает движок к ctx; dest — вход общей громкости эффектов */
  function attach(ctx, dest) {
    if (ctxOf === ctx) { if (dest !== out && node) { try { node.disconnect(); } catch (e) {} node.connect(dest); } out = dest; return; }
    ctxOf = ctx; out = dest; node = null;
    const url = URL.createObjectURL(new Blob(['(' + breathSynthWorklet.toString() + ')()'], { type: 'application/javascript' }));
    loading = ctx.audioWorklet.addModule(url).then(() => {
      if (ctxOf !== ctx) return;
      node = new AudioWorkletNode(ctx, 'breath-synth', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.connect(out);
      while (queue.length) node.port.postMessage(queue.shift());
    }).catch(e => console.log('Synth worklet:', e));
  }
  const send = (...a) => { if (node) node.port.postMessage(a); else queue.push(a); };

  // Геттеры (*Active) должны остаться геттерами: Object.assign скопировал бы их значение один раз (было всегда false)
  return Object.defineProperties(C, Object.getOwnPropertyDescriptors({
    attach,
    get noiseActive() { return noiseOn; },
    get toneActive() { return toneOn; },
    bedActive: id => beds[id],
    startNoise(v) { if (noiseOn) return; noiseOn = true; send('startNoise', v); },
    stopNoise(fade) { if (!noiseOn) return; noiseOn = false; send('stopNoise', fade); },
    setNoiseVolume: v => send('setNoiseVolume', v),
    noiseMuffle: m => { if (noiseOn) send('noiseMuffle', m); },
    startTone(v) { if (toneOn) return; toneOn = true; send('startTone', v * SINE_LEVEL); },
    stopTone(fade) { if (!toneOn) return; toneOn = false; send('stopTone', fade); },
    setToneGain: g => send('setToneGain', g),
    toneTargets: (...a) => send('toneTargets', ...a),
    toneRest: g => send('toneRest', g),
    startBed(id, v) { if (beds[id]) return; beds[id] = true; send('startBed', id, v); },
    stopBed(id, fade) { if (!beds[id]) return; beds[id] = false; send('stopBed', id, fade); },
    setBedVolume: (id, v) => send('setBedVolume', id, v),
    muffle: m => send('muffle', m),
    // 2.9: ночной лес вместо стерео-тона
    get nightActive() { return nightOn; },
    startNight(v) { if (nightOn) return; nightOn = true; send('startNight', v); },
    stopNight(fade) { if (!nightOn) return; nightOn = false; send('stopNight', fade); },
    setNightVolume: v => send('setNightVolume', v)
  }));
})();
