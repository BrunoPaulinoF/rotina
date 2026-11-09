'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AlertService, CardQueue } = require('../src/main/alerts');
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

test('atividade curta: início e aviso da próxima no mesmo instante viram um único cartão', () => {
  const s = setup(at('07:14', 50));
  s.svc.tick();
  s.run(at('07:15', 5));
  assert.deepEqual(s.delivered.map((a) => a.type + ':' + a.item.id), ['start:levar-creche']);
  assert.deepEqual(s.delivered[0].notes.map((n) => n.text), ['Depois: Caminhada às 07:20']);
});

test('cartão recebe as partes separadas por tipo de alerta', () => {
  const s = setup(at('08:24', 50));
  s.svc.tick();
  s.run(at('08:30', 5));
  const [adv, start] = s.delivered;
  assert.deepEqual([adv.kicker, adv.heading, adv.time, adv.canSnooze], ['Em 5 min', 'Foco 1: programação', 'Começa às 08:30', false]);
  assert.deepEqual(adv.notes.map((n) => n.text), ['Encerre: Mensagens e e-mails']);
  assert.deepEqual([start.kicker, start.heading, start.time, start.canSnooze], ['Agora', 'Foco 1: programação', '08:30 – 10:30', true]);
  assert.match(start.detail, /tarefa mais importante/);
});

test('aviso antecipado não pode ser adiado nem substitui o alerta adiável', () => {
  const s = setup(at('07:59', 50));
  s.svc.tick();
  s.run(at('08:00', 5)); // início de Mensagens
  s.run(at('08:25', 5)); // aviso antecipado do Foco 1
  assert.equal(s.delivered[s.delivered.length - 1].type, 'advance');
  assert.equal(s.state.lastAlert.item.id, 'mensagens');
  assert.equal(s.svc.snooze(5, s.delivered[s.delivered.length - 1]), null);
  assert.equal(s.state.snoozes.length, 0);
  assert.equal(s.svc.canSnooze(), true);
});

test('alerta adiado não volta se a atividade já acabou', () => {
  const s = setup(at('08:29', 50));
  s.svc.tick();
  s.run(at('08:30', 5));
  const foco = s.state.lastAlert;
  s.svc.snooze(120); // volta às 10:30:05, depois do fim do Foco 1
  s.run(at('10:31'));
  assert.ok(!s.delivered.some((a) => a.type === 'snooze'));
  // E o botão "Adiar" não oferece adiar uma atividade que já acabou.
  s.state.lastAlert = Object.assign({}, foco, { firedAt: at('10:29') });
  assert.equal(s.svc.canSnooze(), false);
});

test('alerta adiado volta como lembrete, com a atividade em destaque', () => {
  const s = setup(at('08:29', 50));
  s.svc.tick();
  s.run(at('08:30', 5));
  s.svc.snooze(5);
  s.run(at('08:35', 10));
  const r = s.delivered[s.delivered.length - 1];
  assert.deepEqual([r.type, r.kicker, r.heading, r.title], ['snooze', 'Lembrete', 'Foco 1: programação', 'Lembrete: Foco 1: programação']);
});

test('fila do cartão: um aviso por vez e descarta o que ficou velho', () => {
  const q = new CardQueue();
  const item = (key, startMs, endMs) => ({ key, startMs, endMs });
  q.push({ id: 'velho', type: 'start', item: item('a', 0, 100) });
  q.push({ id: 'aviso-vencido', type: 'advance', item: item('b', 150, 300) });
  q.push({ id: 'atual', type: 'start', item: item('c', 100, 500) });
  q.push({ id: 'sem-prazo', type: 'notice' });
  assert.equal(q.next(200).id, 'atual');
  assert.equal(q.next(200).id, 'sem-prazo');
  assert.equal(q.next(200), null);
  // O início substitui o aviso antecipado da mesma atividade que ainda estava na fila.
  q.push({ id: 'aviso', type: 'advance', item: item('d', 600, 900) });
  q.push({ id: 'inicio', type: 'start', item: item('d', 600, 900) });
  assert.equal(q.size, 1);
  assert.equal(q.next(610).id, 'inicio');
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
