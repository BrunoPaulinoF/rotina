'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/shared/engine');
const { createDefaultConfig } = require('../src/main/defaults');
const { normalizeConfig } = require('../src/main/store');

// 2026-11-02 é segunda-feira
const at = (date, hm, sec) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi, sec || 0).getTime();
};
const MON = '2026-11-02';
const TUE = '2026-11-03';
const FRI = '2026-11-06';
const SAT = '2026-11-07';
const SUN = '2026-11-08';

const cfg = () => normalizeConfig(createDefaultConfig());

test('parseHM / fmtHM', () => {
  assert.equal(engine.parseHM('06:40'), 400);
  assert.equal(engine.parseHM('6:05'), 365);
  assert.equal(engine.parseHM('24:00'), null);
  assert.equal(engine.parseHM('abc'), null);
  assert.equal(engine.fmtHM(400), '06:40');
  assert.equal(engine.fmtHM(1440 + 30), '00:30');
});

test('rotina inicial de segunda tem os 19 horários na ordem', () => {
  const plan = engine.getDayPlan(cfg(), new Date(2026, 10, 2));
  const starts = plan.items.map((i) => i.startLabel);
  assert.deepEqual(starts, ['06:40', '07:15', '07:20', '07:50', '08:00', '08:30', '10:30', '11:00', '11:20', '11:45', '13:00', '13:30', '15:00', '16:00', '17:00', '18:00', '18:30', '21:30', '22:00']);
  assert.equal(plan.items.find((i) => i.id === 'casa').subtitle, 'Louça + cozinha');
});

test('atividade atual, restante e próxima', () => {
  const s = engine.getStatus(cfg(), at(MON, '09:00'));
  assert.equal(s.primary.id, 'foco1');
  assert.equal(s.remainingMs, 90 * 60000);
  assert.equal(s.next.id, 'estudo');
  assert.equal(s.toTransitionMs, 90 * 60000);
  assert.ok(Math.abs(s.progress - 0.25) < 1e-9);
});

test('limites exatos: no início a nova atividade já é a atual', () => {
  const s = engine.getStatus(cfg(), at(MON, '10:30'));
  assert.equal(s.primary.id, 'estudo');
  const before = engine.getStatus(cfg(), at(MON, '10:29', 59));
  assert.equal(before.primary.id, 'foco1');
});

test('madrugada: tempo livre e próxima é acordar', () => {
  const s = engine.getStatus(cfg(), at(TUE, '03:00'));
  assert.equal(s.primary, null);
  assert.equal(s.next.id, 'acordar');
  assert.equal(s.nextAt, at(TUE, '06:40'));
});

test('sexta: futebol tem prioridade sobre família e não há tarefa de casa', () => {
  const c = cfg();
  const plan = engine.getDayPlan(c, new Date(2026, 10, 6));
  assert.ok(!plan.items.some((i) => i.id === 'casa'));
  const s = engine.getStatus(c, at(FRI, '18:45'));
  assert.equal(s.primary.id, 'futebol');
  assert.deepEqual(s.others.map((o) => o.id), ['familia']);
  assert.equal(s.next.id, 'familia');
  assert.equal(s.nextAt, at(FRI, '20:00'));
  assert.equal(s.nextResumes, true);
});

test('terça: igreja dentro de família e retorno às 21h', () => {
  const c = cfg();
  const evs = engine.getEvents(c, at(TUE, '18:59'), at(TUE, '21:31'), c.settings.alerts);
  const simple = evs.map((e) => e.type + ':' + e.item.id + '@' + e.item.startLabel);
  assert.ok(simple.includes('start:igreja@19:00'));
  assert.ok(simple.includes('resume:familia@18:30'));
  assert.ok(simple.includes('start:telas@21:30'));
  const resume = evs.find((e) => e.type === 'resume');
  assert.equal(resume.at, at(TUE, '21:00'));
});

test('sexta: início de família encoberto pelo futebol não gera alerta', () => {
  const c = cfg();
  const evs = engine.getEvents(c, at(FRI, '17:59'), at(FRI, '20:01'), c.settings.alerts);
  const simple = evs.map((e) => e.type + ':' + e.item.id);
  assert.ok(simple.includes('start:futebol'));
  assert.ok(!simple.includes('start:familia'));
  assert.ok(simple.includes('resume:familia'));
});

test('aviso antecipado de 5 minutos', () => {
  const c = cfg();
  const evs = engine.getEvents(c, at(MON, '08:24', 59), at(MON, '08:25'), c.settings.alerts);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].type, 'advance');
  assert.equal(evs[0].item.id, 'foco1');
  assert.equal(evs[0].current.id, 'mensagens');
});

test('aviso antecipado desativado globalmente e por atividade', () => {
  const c = cfg();
  const off = Object.assign({}, c.settings.alerts, { advanceEnabled: false });
  assert.equal(engine.getEvents(c, at(MON, '08:24'), at(MON, '08:26'), off).length, 0);
  const c2 = normalizeConfig(Object.assign(createDefaultConfig(), {}));
  c2.activities.find((a) => a.id === 'foco1').alertAdvance = false;
  c2.activities.find((a) => a.id === 'foco1').alertStart = false;
  const evs = engine.getEvents(c2, at(MON, '08:20'), at(MON, '08:31'), c2.settings.alerts);
  assert.equal(evs.length, 0);
});

test('alerta da cama às 22:00 e virada do dia', () => {
  const c = cfg();
  const evs = engine.getEvents(c, at(MON, '21:59', 59), at(MON, '22:00'), c.settings.alerts);
  assert.equal(evs[0].item.id, 'cama');
  const s = engine.getStatus(c, at(MON, '23:00'));
  assert.equal(s.primary, null);
  assert.equal(s.next.id, 'acordar');
  assert.equal(s.next.dateKey, TUE);
});

test('sábado e domingo têm rotinas próprias', () => {
  const c = cfg();
  assert.equal(engine.getStatus(c, at(SAT, '10:00')).primary.id, 'mercado');
  assert.equal(engine.getStatus(c, at(SUN, '19:10')).primary.id, 'planejar');
  assert.equal(engine.getStatus(c, at(SUN, '23:00')).next.id, 'acordar');
});

test('exceção: dia livre não tem atividades nem alertas', () => {
  const c = normalizeConfig(Object.assign(createDefaultConfig(), { exceptions: [{ date: MON, off: true, note: 'Feriado' }] }));
  assert.equal(engine.getDayPlan(c, new Date(2026, 10, 2)).items.length, 0);
  assert.equal(engine.getEvents(c, at(MON, '00:00'), at(MON, '23:59'), c.settings.alerts).length, 0);
  assert.equal(engine.getStatus(c, at(MON, '09:00')).exceptionNote, 'Feriado');
});

test('exceção: usar rotina de outro dia, remover e adicionar atividades', () => {
  const c = normalizeConfig(Object.assign(createDefaultConfig(), {
    exceptions: [{
      date: MON,
      baseDay: 6,
      removedIds: ['mercado'],
      extra: [{ id: 'medico', title: 'Médico', start: '14:00', duration: 60, category: 'compromisso', icon: 'star', priority: 10 }]
    }]
  }));
  const ids = engine.getDayPlan(c, new Date(2026, 10, 2)).items.map((i) => i.id);
  assert.ok(ids.includes('roupa'));
  assert.ok(!ids.includes('mercado'));
  assert.ok(!ids.includes('foco1'));
  assert.ok(ids.includes('medico'));
  assert.equal(engine.getStatus(c, at(MON, '14:30')).primary.id, 'medico');
});

test('atividade que atravessa a meia-noite continua atual no dia seguinte', () => {
  const base = createDefaultConfig();
  base.activities.push({ id: 'virada', title: 'Virada', start: '23:30', duration: 60, days: [1], category: 'basico' });
  const c = normalizeConfig(base);
  const s = engine.getStatus(c, at(TUE, '00:15'));
  assert.equal(s.primary.id, 'virada');
  assert.equal(s.remainingMs, 15 * 60000);
});

test('normalização descarta horários inválidos e mantém dados válidos', () => {
  const base = createDefaultConfig();
  base.activities.push({ title: 'Ruim', start: '25:00', duration: 10, days: [1] });
  base.activities.push({ title: 'Sem dia', start: '10:00', duration: 10, days: [] });
  base.settings.alerts.volume = 7;
  const c = normalizeConfig(base);
  assert.ok(!c.activities.some((a) => a.title === 'Ruim' || a.title === 'Sem dia'));
  assert.equal(c.settings.alerts.volume, 1);
  assert.equal(normalizeConfig(null).activities.length, createDefaultConfig().activities.length);
});

test('placeholders vazios não deixam separadores sobrando', () => {
  assert.equal(engine.fillPlaceholders('Um projeto por dia · {projeto}', { projeto: '' }), 'Um projeto por dia');
  assert.equal(engine.fillPlaceholders('Um projeto por dia · {projeto}', { projeto: 'App' }), 'Um projeto por dia · App');
  assert.equal(engine.fillPlaceholders('Louça + {casa}', { casa: '' }), 'Louça');
});
