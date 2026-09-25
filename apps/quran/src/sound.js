// Procedural paper sounds via Web Audio – no sample files needed.
let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 9000;
    master.connect(soften).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setMuted(m) { muted = m; }
export function isMuted() { return muted; }

function noise() {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 2);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function burst({ t, dur, from, to, q = 0.9, peak = 0.3, attack = 0.35, hp = 300 }) {
  const src = ctx.createBufferSource();
  src.buffer = noise();
  src.loop = true;
  src.loopStart = Math.random() * 1.2;
  src.loopEnd = src.loopStart + 0.7;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = q;
  bp.frequency.setValueAtTime(from, t);
  bp.frequency.exponentialRampToValueAtTime(to, t + dur * 0.55);
  bp.frequency.exponentialRampToValueAtTime(Math.max(120, from * 0.6), t + dur);
  const hpF = ctx.createBiquadFilter();
  hpF.type = 'highpass';
  hpF.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + dur * attack);
  g.gain.exponentialRampToValueAtTime(peak * 0.35, t + dur * 0.75);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(hpF).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function crackle(t, count, spread, level) {
  for (let k = 0; k < count; k++) {
    const tk = t + Math.random() * spread;
    const src = ctx.createBufferSource();
    src.buffer = noise();
    src.loopStart = Math.random() * 1.5;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2200 + Math.random() * 2500;
    const g = ctx.createGain();
    const d = 0.012 + Math.random() * 0.03;
    g.gain.setValueAtTime(0.0001, tk);
    g.gain.exponentialRampToValueAtTime(level * (0.5 + Math.random()), tk + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, tk + d);
    src.connect(hp).connect(g).connect(master);
    src.start(tk, src.loopStart, d + 0.01);
  }
}

function thump(t, freq, level, dur) {
  const src = ctx.createBufferSource();
  src.buffer = noise();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp).connect(g).connect(master);
  src.start(t, Math.random(), dur + 0.02);
}

/**
 * kind: 'page' (thin leaf) or 'cover' (heavy board).
 * duration: seconds the visual flip takes; the sound is timed to it.
 */
export function playFlip(kind = 'page', duration = 0.9) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + 0.01;
  if (kind === 'cover') {
    burst({ t, dur: duration * 0.9, from: 500, to: 1400, q: 0.7, peak: 0.22, attack: 0.4, hp: 180 });
    crackle(t + duration * 0.1, 10, duration * 0.6, 0.12);
    thump(t + duration * 0.88, 260, 0.35, 0.16);
    thump(t + duration * 0.9, 900, 0.12, 0.08);
  } else {
    // lift
    burst({ t, dur: duration * 0.55, from: 1100, to: 3600, q: 0.9, peak: 0.28, attack: 0.3, hp: 400 });
    // fall / slide
    burst({ t: t + duration * 0.45, dur: duration * 0.5, from: 2800, to: 1200, q: 1.1, peak: 0.18, attack: 0.25, hp: 500 });
    crackle(t + duration * 0.05, 14, duration * 0.8, 0.09);
    thump(t + duration * 0.9, 700, 0.14, 0.09);
  }
}

/** A leaf being picked up between the fingers. */
export function playLift() {
  if (!ctx || muted) return;
  const t = ctx.currentTime + 0.005;
  burst({ t, dur: 0.32, from: 1400, to: 3000, q: 1.0, peak: 0.14, attack: 0.3, hp: 500 });
  crackle(t, 5, 0.25, 0.06);
}

/** A leaf settling back where it was. */
export function playSettle() {
  if (!ctx || muted) return;
  const t = ctx.currentTime + 0.005;
  burst({ t, dur: 0.28, from: 2200, to: 900, q: 1.0, peak: 0.1, attack: 0.2, hp: 400 });
  thump(t + 0.2, 600, 0.1, 0.08);
}

// ---------------------------------------------------------------------------
// Ambience: daytime birds + room tone, night-time wind with gusts.
// ---------------------------------------------------------------------------
let amb = null;
let ambNight = 0;

function makeAmbience() {
  const dayGain = ctx.createGain();
  const nightGain = ctx.createGain();
  dayGain.gain.value = 1;
  nightGain.gain.value = 0;
  dayGain.connect(master);
  nightGain.connect(master);

  // --- day: distant room tone (very quiet filtered noise) ---
  const dayNoise = ctx.createBufferSource();
  dayNoise.buffer = noise();
  dayNoise.loop = true;
  const dayLp = ctx.createBiquadFilter();
  dayLp.type = 'lowpass';
  dayLp.frequency.value = 420;
  const dayLevel = ctx.createGain();
  dayLevel.gain.value = 0.035;
  dayNoise.connect(dayLp).connect(dayLevel).connect(dayGain);
  dayNoise.start();

  // --- night: wind. A low body layer plus a higher whistling layer, with gusts every few seconds. ---
  const windLayer = (freq, q, level, lfoRate, lfoDepth) => {
    const src = ctx.createBufferSource();
    src.buffer = noise();
    src.loop = true;
    src.loopStart = Math.random();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = level;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = lfoRate;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = lfoDepth;
    lfo.connect(lfoGain).connect(gain.gain);
    // slow drift of the filter centre so the whistle wanders
    const drift = ctx.createOscillator();
    drift.frequency.value = lfoRate * 0.37;
    const driftGain = ctx.createGain();
    driftGain.gain.value = freq * 0.35;
    drift.connect(driftGain).connect(bp.frequency);
    src.connect(bp).connect(gain).connect(nightGain);
    src.start(); lfo.start(); drift.start();
    return gain;
  };
  const windBody = windLayer(180, 0.7, 0.07, 0.07, 0.035);
  const windHigh = windLayer(720, 2.2, 0.018, 0.11, 0.012);
  const gustGain = ctx.createGain();
  gustGain.gain.value = 1;

  const timers = [];
  const scheduleGust = () => {
    const t = ctx.currentTime;
    const len = 2.5 + Math.random() * 3.5;
    for (const [g, peak] of [[windBody, 0.14], [windHigh, 0.045]]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(peak, t + len * 0.45);
      g.gain.linearRampToValueAtTime(peak * 0.35, t + len);
    }
    timers.push(setTimeout(scheduleGust, (len + 3 + Math.random() * 6) * 1000));
  };

  // --- day: birds ---
  const chirp = (t, f0, f1, dur, pan) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.9, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    osc.connect(g).connect(p).connect(dayGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  };

  const scheduleBirds = () => {
    if (ambNight < 0.5 && ctx.state === 'running') {
      const t = ctx.currentTime + 0.05;
      const n = 1 + Math.floor(Math.random() * 4);
      const base = 2200 + Math.random() * 1800;
      const pan = (Math.random() - 0.5) * 1.4;
      for (let k = 0; k < n; k++) {
        const dur = 0.07 + Math.random() * 0.09;
        chirp(t + k * (dur + 0.05 + Math.random() * 0.08), base * (0.9 + Math.random() * 0.2), base * (1.3 + Math.random() * 0.4), dur, pan);
      }
    }
    timers.push(setTimeout(scheduleBirds, 1500 + Math.random() * 5000));
  };
  scheduleBirds();
  scheduleGust();
  return { dayGain, nightGain, timers };
}

/** Start (or resume) the ambience loop. Safe to call repeatedly. */
export function startAmbience() {
  if (!ctx || amb) return;
  amb = makeAmbience();
  applyAmbience();
}

function applyAmbience() {
  if (!amb) return;
  const t = ctx.currentTime;
  const day = muted ? 0 : 1 - ambNight;
  const night = muted ? 0 : ambNight;
  amb.dayGain.gain.cancelScheduledValues(t);
  amb.nightGain.gain.cancelScheduledValues(t);
  amb.dayGain.gain.setTargetAtTime(day, t, 0.6);
  amb.nightGain.gain.setTargetAtTime(night, t, 0.6);
}

/** 0 = day, 1 = night. */
export function setAmbienceNight(v) {
  ambNight = v;
  applyAmbience();
}

export function refreshAmbienceMute() { applyAmbience(); }
