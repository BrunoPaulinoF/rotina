/* Sons sintetizados com Web Audio (sem arquivos), ou arquivo escolhido pelo usuário. Janela oculta. */
(function () {
  'use strict';
  let ctx = null;

  function context() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** Nota com envelope suave: ataque curto e decaimento exponencial. */
  function note(freq, start, dur, vol, type, master) {
    const c = context();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(master);
    o.start(start);
    o.stop(start + dur + 0.05);
    return o;
  }

  const PRESETS = {
    sino(t, m) {
      note(880, t, 1.8, 0.5, 'sine', m);
      note(1760, t, 1.2, 0.12, 'sine', m);
      note(2640, t, 0.6, 0.05, 'sine', m);
    },
    gota(t, m) {
      const c = context();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(1400, t);
      o.frequency.exponentialRampToValueAtTime(520, t + 0.18);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.55, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(m);
      o.start(t);
      o.stop(t + 0.4);
    },
    duplo(t, m) {
      note(659.25, t, 0.45, 0.45, 'sine', m);
      note(987.77, t + 0.22, 0.9, 0.45, 'sine', m);
    },
    marimba(t, m) {
      [523.25, 659.25, 783.99].forEach((f, i) => {
        note(f, t + i * 0.13, 0.5, 0.42, 'triangle', m);
        note(f * 4, t + i * 0.13, 0.08, 0.06, 'sine', m);
      });
    },
    harpa(t, m) {
      [392, 493.88, 587.33, 783.99, 987.77].forEach((f, i) => note(f, t + i * 0.08, 1.2, 0.28, 'triangle', m));
    },
    digital(t, m) {
      note(1046.5, t, 0.09, 0.12, 'square', m);
      note(1046.5, t + 0.16, 0.09, 0.12, 'square', m);
    }
  };

  let player = null;

  window.rotina.on('audio:play', ({ name, volume, file }) => {
    const vol = Math.max(0, Math.min(1, Number(volume)));
    if (vol <= 0) return;
    if (file) {
      if (player) player.pause();
      player = new Audio(file);
      player.volume = vol;
      player.play().catch(() => {});
      return;
    }
    const c = context();
    const master = c.createGain();
    master.gain.value = vol;
    master.connect(c.destination);
    (PRESETS[name] || PRESETS.sino)(c.currentTime + 0.03, master);
  });
})();
