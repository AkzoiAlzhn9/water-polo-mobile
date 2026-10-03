// Синтезированный звук: свисток, сирена, всплески, трибуны.
WP.Audio = (function () {
  let ctx = null, master = null, bus = null, crowdGain = null, noiseBuf = null, muted = false;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return; }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.7;
    master.connect(ctx.destination);
    // Акустика крытого бассейна: плитка и вода дают длинный гулкий хвост (~2,4 с)
    bus = ctx.createGain(); bus.connect(master);
    const rev = ctx.createConvolver(), len2 = Math.floor(ctx.sampleRate * 2.4);
    const ir = ctx.createBuffer(2, len2, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < len2; i++) { const t = i / len2; ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * (i < ctx.sampleRate * 0.012 ? 0.3 : 1); }
    }
    rev.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.32;
    const pre = ctx.createBiquadFilter(); pre.type = 'lowpass'; pre.frequency.value = 5200;
    bus.connect(pre); pre.connect(rev); rev.connect(wet); wet.connect(master);
    // Буфер розового шума
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    // Гул трибун
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 700; lp.Q.value = 0.5;
    crowdGain = ctx.createGain(); crowdGain.gain.value = 0.05;
    src.connect(lp); lp.connect(crowdGain); crowdGain.connect(bus);
    src.start();
  }

  function noise(dur, type, freq, q, gain, attack) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + (attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  function whistle(kind) {
    if (!ctx) return;
    const blasts = kind === 'long' ? [[0, 0.75]] : kind === 'double' ? [[0, 0.22], [0.3, 0.6]] : [[0, 0.24]];
    for (const [off, dur] of blasts) {
      const t = ctx.currentTime + off;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 3050;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 27;
      const lg = ctx.createGain(); lg.gain.value = 170;
      lfo.connect(lg); lg.connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
      g.gain.setValueAtTime(0.16, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(bus);
      o.start(t); lfo.start(t); o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
    }
  }

  function horn() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
    g.gain.setValueAtTime(0.12, t + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
    f.connect(g); g.connect(bus);
    for (const fr of [233, 350, 466]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr;
      o.connect(f); o.start(t); o.stop(t + 1.1);
    }
  }

  function clang() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [fr, gv] of [[1180, 0.12], [2630, 0.06], [3900, 0.03]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gv, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.62);
    }
  }

  let lastSplash = 0;
  function splash(strength) {
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - lastSplash < 0.05) return;
    lastSplash = now;
    const s = Math.min(1, strength);
    noise(0.18 + s * 0.35, 'lowpass', 900 + s * 1800, 0.7, 0.05 + s * 0.22, 0.005);
  }

  function slap() { noise(0.09, 'highpass', 1800, 0.7, 0.12, 0.002); }
  function whoosh() { noise(0.25, 'bandpass', 1200, 1.2, 0.06, 0.08); }
  function net() { noise(0.35, 'bandpass', 500, 0.8, 0.14, 0.01); }

  let cheerUntil = 0;
  function cheer(big) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const dur = big ? 4.5 : 2.2;
    cheerUntil = t + dur;
    crowdGain.gain.cancelScheduledValues(t);
    crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
    crowdGain.gain.linearRampToValueAtTime(big ? 0.34 : 0.14, t + 0.35);
    crowdGain.gain.linearRampToValueAtTime(0.05, t + dur);
  }

  let lastTension = -1;
  function tension(v) {
    if (!ctx || !crowdGain || ctx.currentTime < cheerUntil || v === lastTension) return;
    lastTension = v;
    crowdGain.gain.setTargetAtTime(0.045 + v * 0.05, ctx.currentTime, 1.5);
  }

  // Реакции трибун: «у-у-у» на штангу и сейв, свист на удаление хозяев, одобрение
  function sweep(dur, f0, f1, q, gain, type) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.linearRampToValueAtTime(f1, t + dur * 0.4); f.frequency.linearRampToValueAtTime(f0 * 0.8, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  let lastCrowd = 0;
  function crowd(kind) {
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - lastCrowd < 0.8) return;
    lastCrowd = now;
    if (kind === 'ooh') { sweep(1.4, 380, 820, 3, 0.2); sweep(1.4, 700, 1300, 4, 0.08); }
    else if (kind === 'boo') { sweep(1.8, 220, 300, 2, 0.16, 'lowpass'); for (let i = 0; i < 3; i++) setTimeout(() => whistleFan(), 150 + i * 260); }
    else if (kind === 'cheer') sweep(1.2, 600, 1100, 1.2, 0.12);
  }
  function whistleFan() {
    if (!ctx) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(2200 + Math.random() * 900, t); o.frequency.linearRampToValueAtTime(1800 + Math.random() * 600, t + 0.5);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.025, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.6);
  }
  // Ритмичные хлопки в такт
  let clapTimer = null;
  function clapping(on) {
    if (!ctx) return;
    if (on && !clapTimer) {
      clapTimer = setInterval(() => { noise(0.07, 'highpass', 1400, 0.8, 0.09, 0.002); setTimeout(() => noise(0.06, 'highpass', 1600, 0.8, 0.06, 0.002), 18); }, 560);
    } else if (!on && clapTimer) { clearInterval(clapTimer); clapTimer = null; }
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.7;
    if (m) clapping(false);
  }

  return { init, whistle, horn, clang, splash, slap, whoosh, net, cheer, tension, crowd, clapping, setMuted, get muted() { return muted; } };
})();
