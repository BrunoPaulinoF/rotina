'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AlertService } = require('../src/main/alerts');
const { createDefaultConfig, createDefaultState } = require('../src/main/defaults');
const { normalizeConfig } = require('../src/main/store');

const at = (hm, sec) => {
  const [h, mi] = hm.split(':').map(Number);
  return new Date(2026, 10, 2, h, mi, sec || 0).getTime(); // segunda-feira
};

function setup(startAt, mutate) {
  const config = normalizeConfig(createDefaultConfig());
  if (mutate) mutate(config);
  const clock = { t: startAt };
  const delivered = [];
  const state = createDefaultState();
  const svc = new AlertService({
    now: () => clock.t,
    getConfig: () => config,
    state,
    deliver: (a) => delivered.push(a)
  });
  /** Avança o relógio segundo a segundo, chamando tick() como o app faz. */
  const run = (until) => {
    while (clock.t < until) {
      clock.t += 1000;
      svc.tick();
    }
  };
  return { svc, clock, delivered, state, run, config };
}

test('transições disparam uma única vez, com aviso antecipado', () => {
  const s = setup(at('08:20'));
  s.svc.tick();
  s.run(at('08:31'));
  assert.deepEqual(s.delivered.map((a) => a.type + ':' + a.item.id), ['advance:foco1', 'start:foco1']);
  assert.match(s.delivered[1].title, /^Agora: Foco 1/);
  assert.match(s.delivered[1].body, /Depois: Estudo de desenvolvimento às 10:30/);
});

test('ao ligar o PC no meio do dia, alertas atrasados não são disparados', () => {
  const s = setup(at('09:15'));
  s.svc.tick();
  s.run(at('09:16'));
  assert.equal(s.delivered.length, 0);
});

test('suspensão/hibernação: salto de relógio ignora o intervalo perdido', () => {
  const s = setup(at('08:20'));
  s.svc.tick();
  s.clock.t = at('11:05'); // voltou da suspensão
  s.svc.tick();
  assert.equal(s.delivered.length, 0);
  s.run(at('11:21'));
  // continua normalmente depois: aviso das 11:15 e início das 11:20
  assert.deepEqual(s.delivered.map((a) => a.type + ':' + a.item.id), ['advance:buscar-creche', 'start:buscar-creche']);
});

test('timer atrasado alguns segundos ainda dispara (tolerância)', () => {
  const s = setup(at('08:29', 50));
  s.svc.tick();
  s.clock.t = at('08:30', 20);
  s.svc.tick();
  assert.deepEqual(s.delivered.map((a) => a.type), ['start']);
});

test('rotina pausada não dispara alertas', () => {
  const s = setup(at('08:20'));
  s.state.paused = true;
  s.svc.tick();
  s.run(at('08:31'));
  assert.equal(s.delivered.length, 0);
});

test('silenciar mantém o alerta visual, marcado como mudo', () => {
  const s = setup(at('08:29', 50));
  s.state.muteUntil = at('09:00');
  s.svc.tick();
  s.run(at('08:30', 5));
  assert.equal(s.delivered.length, 1);
  assert.equal(s.delivered[0].muted, true);
});

test('adiar alerta dispara novamente depois do tempo escolhido', () => {
  const s = setup(at('08:29', 50));
  s.svc.tick();
  s.run(at('08:30', 5));
  assert.equal(s.delivered.length, 1);
  s.svc.snooze(5);
  s.run(at('08:35', 10));
  assert.equal(s.delivered.length, 2);
  assert.equal(s.delivered[1].type, 'snooze');
  assert.equal(s.state.snoozes.length, 0);
});

test('alertas desativados para uma atividade', () => {
  const s = setup(at('08:20'), (c) => {
    const f = c.activities.find((a) => a.id === 'foco1');
    f.alertStart = false;
    f.alertAdvance = false;
  });
  s.svc.tick();
  s.run(at('08:31'));
  assert.equal(s.delivered.length, 0);
});

test('alertas desligados globalmente', () => {
  const s = setup(at('08:20'), (c) => { c.settings.alerts.enabled = false; });
  s.svc.tick();
  s.run(at('08:31'));
  assert.equal(s.delivered.length, 0);
});
