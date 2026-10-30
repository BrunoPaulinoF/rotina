'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { History, periodRange } = require('../src/main/history');
const { createDefaultConfig } = require('../src/main/defaults');
const { normalizeConfig } = require('../src/main/store');

const at = (date, hm) => {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).getTime();
};
const MON = '2026-11-02';
const TUE = '2026-11-03';
const setup = () => ({ h: new History(fs.mkdtempSync(path.join(os.tmpdir(), 'rotina-hist-'))), cfg: normalizeConfig(createDefaultConfig()) });
const ids = (day) => day.itens.map((i) => i.id);

test('padrão "hábitos e trabalho": o que conta e o que não conta na meta', () => {
  const { h, cfg } = setup();
  h.snapshotDay(cfg, new Date(2026, 10, 2));
  const d = h.day(MON, at(MON, '05:00'));
  assert.deepEqual(ids(d), ['acordar', 'caminhada', 'mensagens', 'foco1', 'estudo', 'ingles', 'foco2', 'comercial', 'projetos', 'fechar', 'casa', 'telas', 'cama']);
  for (const fora of ['levar-creche', 'buscar-creche', 'cafe', 'pausa', 'almoco', 'familia']) assert.ok(!ids(d).includes(fora), fora);
  // Sexta: futebol (compromisso) não conta; sábado: roupa e mercado contam
  h.snapshotDay(cfg, new Date(2026, 10, 6));
  assert.ok(!ids(h.day('2026-11-06', at(MON, '05:00'))).includes('futebol'));
  h.snapshotDay(cfg, new Date(2026, 10, 7));
  assert.deepEqual(ids(h.day('2026-11-07', at(MON, '05:00'))), ['acordar-sab', 'roupa', 'mercado', 'telas', 'cama']);
});

test('situação ao longo do dia: futuro, pendente (conta como não feito) e respondidas', () => {
  const { h, cfg } = setup();
  h.snapshotDay(cfg, new Date(2026, 10, 2));
  const now = at(MON, '10:00');
  h.setStatus(cfg, MON, 'acordar', 'feito', 'teste', now);
  h.setStatus(cfg, MON, 'caminhada', 'nao-feito', 'teste', now);
  const d = h.day(MON, now);
  const st = Object.fromEntries(d.itens.map((i) => [i.id, i.status]));
  assert.equal(st.acordar, 'feito');
  assert.equal(st.caminhada, 'nao-feito');
  assert.equal(st.mensagens, 'pendente');
  assert.equal(st.foco1, 'futuro');
  assert.deepEqual([d.feitos, d.total, d.pendentes], [1, 3, 1]);
  assert.ok(Math.abs(d.taxa - 1 / 3) < 1e-9);
});

test('no dia seguinte, o que ficou sem resposta conta como não feito', () => {
  const { h, cfg } = setup();
  h.snapshotDay(cfg, new Date(2026, 10, 2));
  h.setStatus(cfg, MON, 'foco1', 'feito', 'teste', at(MON, '10:30'));
  const d = h.day(MON, at(TUE, '08:00'));
  assert.equal(d.itens.find((i) => i.id === 'mensagens').status, 'sem-resposta');
  assert.deepEqual([d.feitos, d.total], [1, 13]);
});

test('janela de ✓/✗: alguns minutos antes do fim e depois, até responder', () => {
  const { h, cfg } = setup();
  h.snapshotDay(cfg, new Date(2026, 10, 2));
  const before = 5 * 60000;
  assert.deepEqual(h.prompts(MON, at(MON, '10:20'), before).map((i) => i.id).slice(-1), ['mensagens']);
  assert.ok(h.prompts(MON, at(MON, '10:26'), before).some((i) => i.id === 'foco1'));
  h.setStatus(cfg, MON, 'foco1', 'feito', 'teste', at(MON, '10:27'));
  assert.ok(!h.prompts(MON, at(MON, '10:28'), before).some((i) => i.id === 'foco1'));
});

test('editar a rotina depois não muda o histórico dos dias passados', () => {
  const { h, cfg } = setup();
  h.snapshotDay(cfg, new Date(2026, 10, 2));
  h.setStatus(cfg, MON, 'estudo', 'feito', 'teste', at(MON, '11:00'));
  const changed = normalizeConfig(Object.assign(createDefaultConfig(), {}));
  changed.activities = changed.activities.filter((a) => a.id !== 'estudo');
  // a foto de hoje é refeita, mas a atividade respondida é mantida
  h.snapshotDay(changed, new Date(2026, 10, 2));
  assert.ok(ids(h.day(MON, at(MON, '12:00'))).includes('estudo'));
  assert.equal(h.day(MON, at(MON, '12:00')).itens.find((i) => i.id === 'estudo').title, 'Estudo de desenvolvimento');
});

test('rotina pausada: atividades que terminam na pausa ficam fora da conta', () => {
  const { h, cfg } = setup();
  h.snapshotDay(cfg, new Date(2026, 10, 2));
  h.addPause(at(MON, '08:00'));
  h.endPause(at(MON, '11:00'));
  const st = Object.fromEntries(h.day(MON, at(MON, '12:00')).itens.map((i) => [i.id, i.status]));
  assert.equal(st.mensagens, 'pausado');
  assert.equal(st.foco1, 'pausado');
  assert.equal(st.caminhada, 'pendente');
});

test('limites: só os últimos 7 dias, só atividades que contam, não antes de começar', () => {
  const { h, cfg } = setup();
  const now = at(MON, '09:00');
  assert.throws(() => h.setStatus(cfg, '2026-10-20', 'foco1', 'feito', 't', now), /últimos 7 dias/);
  assert.throws(() => h.setStatus(cfg, MON, 'almoco', 'feito', 't', now), /não conta na meta/);
  assert.throws(() => h.setStatus(cfg, MON, 'estudo', 'feito', 't', now), /ainda não começou/);
  assert.throws(() => h.setStatus(cfg, MON, 'foco1', 'talvez', 't', now), /Status inválido/);
  // marcar um dia passado sem foto (PC desligado) cria a foto e registra
  h.setStatus(cfg, '2026-10-30', 'foco1', 'feito', 't', now);
  assert.equal(h.day('2026-10-30', now).feitos, 1);
});

test('relatório: taxa geral, dias na meta, categorias, mais puladas e sequência', () => {
  const { h, cfg } = setup();
  const days = ['2026-11-02', '2026-11-03', '2026-11-04'];
  days.forEach((k, n) => {
    const d = new Date(2026, 10, 2 + n);
    h.snapshotDay(cfg, d);
    const items = h.day(k, at(k, '05:00')).itens;
    // 1º e 3º dias: tudo feito menos caminhada; 2º dia: quase nada
    items.forEach((i) => {
      const ok = n !== 1 ? i.id !== 'caminhada' : i.id === 'foco1';
      h.setStatus(cfg, k, i.id, ok ? 'feito' : 'nao-feito', 't', at('2026-11-05', '08:00'));
    });
  });
  const r = h.report('2026-11-02', '2026-11-05', at('2026-11-05', '08:00'), 70);
  assert.equal(r.diasComDados, 3);
  assert.equal(r.diasNaMeta, 2);
  assert.equal(r.sequencia, 1);
  assert.equal(r.atividades[0].id, 'caminhada');
  assert.equal(r.atividades[0].taxa, 0);
  assert.ok(r.categorias.some((c) => c.id === 'trabalho'));
  assert.ok(r.taxa > 0.5 && r.taxa < 0.8);
});

test('atalhos de período', () => {
  const now = at('2026-11-05', '10:00'); // quinta
  assert.deepEqual(periodRange('semana', now), ['2026-11-02', '2026-11-05']);
  assert.deepEqual(periodRange('semana-passada', now), ['2026-10-26', '2026-11-01']);
  assert.deepEqual(periodRange('mes', now), ['2026-11-01', '2026-11-05']);
  assert.deepEqual(periodRange('30dias', now), ['2026-10-07', '2026-11-05']);
});
