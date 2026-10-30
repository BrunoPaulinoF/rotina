'use strict';
/**
 * Ferramentas para agentes de IA lerem e alterarem a rotina.
 * Usadas pelo servidor MCP e pela linha de comando (src/agent/server.js).
 * Toda gravação passa pela mesma validação do app; o app aberto recarrega o config.json sozinho.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('../shared/engine');
const { JsonStore, normalizeConfig, normalizeState } = require('../main/store');
const { createDefaultConfig } = require('../main/defaults');

function dataDir() {
  return process.env.ROTINA_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Rotina Desktop');
}
const configFile = () => path.join(dataDir(), 'config.json');
const backupFile = () => path.join(dataDir(), 'config.anterior.json');

function load() {
  const raw = new JsonStore(configFile()).load();
  return normalizeConfig(raw || createDefaultConfig());
}

function save(next) {
  const current = configFile();
  if (fs.existsSync(current)) fs.copyFileSync(current, backupFile());
  const cfg = normalizeConfig(next);
  new JsonStore(current).save(cfg);
  return cfg;
}

function loadState() {
  return normalizeState(new JsonStore(path.join(dataDir(), 'state.json')).load());
}

class ToolError extends Error {}
const fail = (msg) => {
  throw new ToolError(msg);
};

const DAY_ALIASES = { dom: 0, domingo: 0, seg: 1, segunda: 1, ter: 2, terca: 2, qua: 3, quarta: 3, qui: 4, quinta: 4, sex: 5, sexta: 5, sab: 6, sabado: 6 };

function dayNum(v) {
  if (Number.isInteger(v) && v >= 0 && v <= 6) return v;
  const k = String(v).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/-feira$/, '');
  if (k in DAY_ALIASES) return DAY_ALIASES[k];
  if (/^[0-6]$/.test(k)) return Number(k);
  return fail('Dia inválido: "' + v + '". Use 0-6 (0 = domingo) ou nomes como "seg", "terça", "sábado".');
}

function parseDate(v) {
  if (v == null || v === '' || v === 'hoje') return engine.startOfDay(Date.now());
  if (v === 'amanha' || v === 'amanhã') return engine.addDays(Date.now(), 1);
  if (v === 'ontem') return engine.addDays(Date.now(), -1);
  return engine.parseDateKey(v) || fail('Data inválida: "' + v + '". Use AAAA-MM-DD, "hoje" ou "amanhã".');
}

const shortItem = (i) => i.startLabel + '–' + i.endLabel + '  ' + i.title + (i.subtitle ? ' — ' + i.subtitle : '') + '  [id: ' + i.id + ', ' + i.categoryName + (i.priority > 0 ? ', compromisso' : '') + (i.alertStart || i.alertAdvance ? '' : ', sem alertas') + ']';

function dayText(cfg, d) {
  const plan = engine.getDayPlan(cfg, d);
  const head = engine.WEEKDAY_NAMES[plan.weekday] + ', ' + engine.fmtLongDate(d) + ' (' + plan.dateKey + ')';
  let note = '';
  if (plan.off) note = '\nExceção: dia livre' + (plan.exception.note ? ' — ' + plan.exception.note : '');
  else if (plan.exception) note = '\nExceção' + (plan.baseDay !== plan.weekday ? ': usando a rotina de ' + engine.WEEKDAY_NAMES[plan.baseDay] : '') + (plan.exception.note ? ' — ' + plan.exception.note : '');
  const w = plan.weekly;
  const weekly = [w.casa && 'Casa: ' + w.casa, w.nota, w.projeto && 'Projeto: ' + w.projeto].filter(Boolean).join(' · ');
  return head + note + (weekly ? '\n' + weekly : '') + '\n' + (plan.items.length ? plan.items.map(shortItem).join('\n') : '(nenhuma atividade)');
}

function overlaps(cfg, a) {
  const s = engine.parseHM(a.start);
  return cfg.activities
    .filter((o) => o.id !== a.id && o.enabled && o.days.some((d) => a.days.includes(d)))
    .filter((o) => {
      const os2 = engine.parseHM(o.start);
      return os2 < s + a.duration && s < os2 + o.duration;
    })
    .map((o) => o.title + ' (' + o.start + ')');
}

/** Converte campos amigáveis (end, dias por nome) para o formato da configuração. */
function activityPatch(args, base) {
  const out = {};
  for (const k of ['title', 'subtitle', 'start', 'category', 'icon', 'priority', 'alertStart', 'alertAdvance', 'enabled']) {
    if (args[k] !== undefined) out[k] = args[k];
  }
  if (args.duration !== undefined) out.duration = Number(args.duration);
  if (args.days !== undefined) out.days = (Array.isArray(args.days) ? args.days : [args.days]).map(dayNum);
  if (args.end !== undefined) {
    const start = engine.parseHM(out.start || (base && base.start));
    const end = engine.parseHM(args.end);
    if (start == null || end == null) fail('Horário inválido em start/end (use HH:MM).');
    out.duration = end > start ? end - start : end + 1440 - start;
  }
  if (out.start !== undefined && engine.parseHM(out.start) == null) fail('Horário de início inválido: "' + out.start + '" (use HH:MM).');
  return out;
}

const ACTIVITY_PROPS = {
  title: { type: 'string', description: 'Título exibido.' },
  subtitle: { type: 'string', description: 'Descrição curta. Aceita {casa}, {projeto} e {nota} (preenchidos pelas tarefas do dia da semana).' },
  start: { type: 'string', description: 'Início, HH:MM.' },
  duration: { type: 'integer', description: 'Duração em minutos (1–1440). Alternativa: end.' },
  end: { type: 'string', description: 'Término, HH:MM (calcula a duração; pode passar da meia-noite).' },
  category: { type: 'string', description: 'id da categoria (define a cor). Veja listar_categorias.' },
  icon: { type: 'string', description: 'Ícone: ' + ['sun', 'car', 'walk', 'coffee', 'mail', 'code', 'book', 'stretch', 'utensils', 'briefcase', 'monitor', 'flag', 'home', 'users', 'phone', 'bed', 'church', 'ball', 'cart', 'shirt', 'calendar', 'star', 'moon', 'clock', 'heart', 'droplet', 'dollar', 'target', 'zap', 'list', 'dumbbell', 'lightbulb', 'music', 'dot'].join(', ') },
  priority: { type: 'integer', description: '0 = normal; 10 = compromisso (prevalece sobre atividades simultâneas, ex.: igreja, futebol).' },
  alertStart: { type: 'boolean', description: 'Alerta sonoro no início.' },
  alertAdvance: { type: 'boolean', description: 'Aviso antecipado (minutos definidos em alterar_configuracoes).' },
  enabled: { type: 'boolean', description: 'false tira da rotina sem apagar.' }
};

const TOOLS = [
  {
    name: 'ver_agora',
    description: 'Mostra o que está acontecendo agora na rotina: atividade atual, simultâneas, tempo restante, próxima atividade, se a rotina está pausada ou silenciada.',
    inputSchema: { type: 'object', properties: {} },
    run() {
      const cfg = load();
      const st = loadState();
      const now = Date.now();
      const s = engine.getStatus(cfg, now);
      const lines = [];
      if (st.paused) lines.push('Rotina PAUSADA (sem alertas).');
      if (st.muteUntil > now) lines.push('Som silenciado até ' + new Date(st.muteUntil).toLocaleTimeString('pt-BR').slice(0, 5) + '.');
      lines.push(s.primary ? 'Agora: ' + shortItem(s.primary) + ' — faltam ' + engine.fmtDuration(s.remainingMs) : 'Agora: tempo livre' + (s.off ? ' (dia livre)' : ''));
      if (s.others.length) lines.push('Simultâneo: ' + s.others.map((o) => o.title).join(', '));
      if (s.next) lines.push('Próxima: ' + s.next.title + ' às ' + engine.fmtHM(new Date(s.nextAt).getHours() * 60 + new Date(s.nextAt).getMinutes()) + (s.nextResumes ? ' (retoma)' : '') + ' — em ' + engine.fmtDuration(s.nextAt - now));
      return lines.join('\n');
    }
  },
  {
    name: 'ver_dia',
    description: 'Lista a rotina de um dia (horários, títulos, ids, categorias), já aplicando exceções da data e tarefas da semana.',
    inputSchema: { type: 'object', properties: { data: { type: 'string', description: 'AAAA-MM-DD, "hoje" (padrão), "amanhã" ou "ontem".' } } },
    run(a) {
      return dayText(load(), parseDate(a.data));
    }
  },
  {
    name: 'ver_semana',
    description: 'Lista a rotina dos 7 dias (segunda a domingo) da semana que contém a data.',
    inputSchema: { type: 'object', properties: { data: { type: 'string', description: 'Qualquer dia da semana desejada (AAAA-MM-DD). Padrão: hoje.' } } },
    run(a) {
      const cfg = load();
      const start = engine.weekStart(parseDate(a.data));
      return [0, 1, 2, 3, 4, 5, 6].map((o) => dayText(cfg, engine.addDays(start, o))).join('\n\n');
    }
  },
  {
    name: 'listar_atividades',
    description: 'Retorna as atividades cadastradas (modelo semanal) em JSON, com id, horário, duração, dias (0 = domingo … 6 = sábado), categoria, ícone, prioridade e alertas. Use os ids para editar ou remover.',
    inputSchema: { type: 'object', properties: { dia: { description: 'Filtra por dia da semana (0-6 ou nome, ex.: "seg").', type: ['string', 'integer'] } } },
    run(a) {
      const cfg = load();
      let list = cfg.activities;
      if (a.dia !== undefined) {
        const d = dayNum(a.dia);
        list = list.filter((x) => x.days.includes(d));
      }
      return list.slice().sort((x, y) => engine.parseHM(x.start) - engine.parseHM(y.start));
    }
  },
  {
    name: 'salvar_atividade',
    description: 'Cria ou altera uma atividade da rotina semanal. Com "id" de uma atividade existente, altera só os campos enviados. Sem id (ou id novo), cria: exige title, start, duration ou end, e days.',
    inputSchema: {
      type: 'object',
      properties: Object.assign({ id: { type: 'string', description: 'id existente para alterar, ou um id novo (opcional) para criar.' }, days: { type: 'array', items: { type: ['integer', 'string'] }, description: 'Dias da semana: 0 = domingo … 6 = sábado, ou nomes ("seg", "sexta").' } }, ACTIVITY_PROPS)
    },
    run(a) {
      const cfg = load();
      const existing = a.id ? cfg.activities.find((x) => x.id === a.id) : null;
      const patch = activityPatch(a, existing);
      let saved;
      if (existing) {
        Object.assign(existing, patch);
        saved = existing;
      } else {
        if (!patch.title || !patch.start || !patch.duration || !patch.days || !patch.days.length) fail('Para criar, informe title, start, duration (ou end) e days.');
        saved = Object.assign({ id: a.id || undefined, subtitle: '', category: 'basico', icon: 'dot', priority: 0, alertStart: true, alertAdvance: true, enabled: true }, patch);
        cfg.activities.push(saved);
      }
      const out = save(cfg);
      const result = out.activities.find((x) => x.id === (saved.id || out.activities[out.activities.length - 1].id)) || out.activities[out.activities.length - 1];
      const ov = overlaps(out, result);
      return { mensagem: existing ? 'Atividade alterada.' : 'Atividade criada.', atividade: result, sobreposicoes: ov.length ? ov : undefined, aviso: ov.length ? 'Durante a sobreposição vale a de maior prioridade (ou a que começou por último).' : undefined };
    }
  },
  {
    name: 'remover_atividade',
    description: 'Remove definitivamente uma atividade da rotina semanal (para só desativar, use salvar_atividade com enabled=false).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run(a) {
      const cfg = load();
      const act = cfg.activities.find((x) => x.id === a.id) || fail('Atividade não encontrada: ' + a.id + '. Veja listar_atividades.');
      cfg.activities = cfg.activities.filter((x) => x.id !== a.id);
      cfg.exceptions.forEach((e) => { e.removedIds = e.removedIds.filter((id) => id !== a.id); });
      save(cfg);
      return 'Atividade removida: ' + act.title + ' (' + act.start + ').';
    }
  },
  {
    name: 'listar_categorias',
    description: 'Lista as categorias (id, nome, cor, ícone). A categoria define a cor da atividade.',
    inputSchema: { type: 'object', properties: {} },
    run() {
      return load().categories;
    }
  },
  {
    name: 'salvar_categoria',
    description: 'Cria ou altera uma categoria. Com id existente, altera os campos enviados.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, color: { type: 'string', description: 'Cor #RRGGBB.' }, icon: { type: 'string' } } },
    run(a) {
      const cfg = load();
      if (a.color && !/^#[0-9a-fA-F]{6}$/.test(a.color)) fail('Cor inválida (use #RRGGBB).');
      const cat = a.id && cfg.categories.find((c) => c.id === a.id);
      if (cat) ['name', 'color', 'icon'].forEach((k) => { if (a[k] !== undefined) cat[k] = a[k]; });
      else {
        if (!a.name) fail('Para criar, informe name.');
        cfg.categories.push({ id: a.id, name: a.name, color: a.color || '#5B8DEF', icon: a.icon || 'dot' });
      }
      return save(cfg).categories;
    }
  },
  {
    name: 'remover_categoria',
    description: 'Remove uma categoria; as atividades dela passam para "basico".',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run(a) {
      if (a.id === 'basico') fail('A categoria "basico" não pode ser removida.');
      const cfg = load();
      if (!cfg.categories.some((c) => c.id === a.id)) fail('Categoria não encontrada: ' + a.id);
      cfg.categories = cfg.categories.filter((c) => c.id !== a.id);
      cfg.activities.forEach((x) => { if (x.category === a.id) x.category = 'basico'; });
      save(cfg);
      return 'Categoria removida.';
    }
  },
  {
    name: 'definir_dia_semana',
    description: 'Define as tarefas fixas de um dia da semana: tarefa doméstica (casa), observação (nota) e projeto paralelo. Aparecem no painel "Semana" e nas atividades com {casa}/{projeto}/{nota}.',
    inputSchema: { type: 'object', properties: { dia: { type: ['string', 'integer'], description: '0-6 ou nome.' }, casa: { type: 'string' }, nota: { type: 'string' }, projeto: { type: 'string' } }, required: ['dia'] },
    run(a) {
      const cfg = load();
      const d = dayNum(a.dia);
      ['casa', 'nota', 'projeto'].forEach((k) => { if (a[k] !== undefined) cfg.weekly[d][k] = a[k]; });
      return save(cfg).weekly[d];
    }
  },
  {
    name: 'salvar_excecao',
    description: 'Cria ou altera uma exceção para uma data específica (feriado, viagem, consulta), sem mudar a rotina semanal. Tipos: "ajustar" (rotina normal do dia, removendo/adicionando atividades), "outro_dia" (usa a rotina de outro dia da semana), "livre" (sem rotina nem alertas, exceto extras).',
    inputSchema: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'AAAA-MM-DD, "hoje" ou "amanhã".' },
        tipo: { type: 'string', enum: ['ajustar', 'outro_dia', 'livre'] },
        usar_rotina_de: { type: ['string', 'integer'], description: 'Para tipo "outro_dia": dia da semana cuja rotina será usada.' },
        nota: { type: 'string' },
        remover_ids: { type: 'array', items: { type: 'string' }, description: 'ids de atividades da rotina que não acontecem nesta data.' },
        restaurar_ids: { type: 'array', items: { type: 'string' }, description: 'ids que voltam a acontecer nesta data.' },
        extras: { type: 'array', description: 'Atividades só desta data (sem "days"). Com id existente, substitui.', items: { type: 'object', properties: Object.assign({ id: { type: 'string' } }, ACTIVITY_PROPS) } },
        remover_extras: { type: 'array', items: { type: 'string' } }
      },
      required: ['data']
    },
    run(a) {
      const cfg = load();
      const date = engine.dateKey(parseDate(a.data));
      let ex = cfg.exceptions.find((e) => e.date === date);
      if (!ex) {
        ex = { date, note: '', off: false, baseDay: null, removedIds: [], extra: [] };
        cfg.exceptions.push(ex);
      }
      if (a.tipo) {
        ex.off = a.tipo === 'livre';
        ex.baseDay = a.tipo === 'outro_dia' ? dayNum(a.usar_rotina_de != null ? a.usar_rotina_de : fail('Informe usar_rotina_de para o tipo "outro_dia".')) : null;
      } else if (a.usar_rotina_de != null) {
        ex.baseDay = dayNum(a.usar_rotina_de);
      }
      if (a.nota !== undefined) ex.note = a.nota;
      (a.remover_ids || []).forEach((id) => { if (!ex.removedIds.includes(id)) ex.removedIds.push(id); });
      ex.removedIds = ex.removedIds.filter((id) => !(a.restaurar_ids || []).includes(id));
      for (const x of a.extras || []) {
        const patch = activityPatch(x, ex.extra.find((e) => e.id === x.id));
        const i = x.id ? ex.extra.findIndex((e) => e.id === x.id) : -1;
        if (i >= 0) Object.assign(ex.extra[i], patch);
        else {
          if (!patch.title || !patch.start || !patch.duration) fail('Cada extra precisa de title, start e duration (ou end).');
          ex.extra.push(Object.assign({ id: x.id || 'x-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), category: 'basico', icon: 'dot' }, patch));
        }
      }
      ex.extra = ex.extra.filter((e) => !(a.remover_extras || []).includes(e.id));
      const out = save(cfg);
      return 'Exceção salva.\n\n' + dayText(out, engine.parseDateKey(date));
    }
  },
  {
    name: 'remover_excecao',
    description: 'Remove a exceção de uma data (o dia volta à rotina normal da semana).',
    inputSchema: { type: 'object', properties: { data: { type: 'string' } }, required: ['data'] },
    run(a) {
      const cfg = load();
      const date = engine.dateKey(parseDate(a.data));
      if (!cfg.exceptions.some((e) => e.date === date)) fail('Não há exceção em ' + date + '.');
      cfg.exceptions = cfg.exceptions.filter((e) => e.date !== date);
      save(cfg);
      return 'Exceção de ' + date + ' removida.';
    }
  },
  {
    name: 'editar_lista',
    description: 'Substitui uma lista de textos da aba "Regras e casa": regras, sono, planejamento (de domingo), lembretes ("Não esquecer"), casaTodoDia; ou a meta (use itens com 1 texto).',
    inputSchema: { type: 'object', properties: { lista: { type: 'string', enum: ['regras', 'sono', 'planejamento', 'lembretes', 'casaTodoDia', 'meta'] }, itens: { type: 'array', items: { type: 'string' } } }, required: ['lista', 'itens'] },
    run(a) {
      const cfg = load();
      if (a.lista === 'meta') cfg.meta = String(a.itens[0] || '');
      else cfg.lists[a.lista] = a.itens;
      const out = save(cfg);
      return a.lista === 'meta' ? out.meta : out.lists[a.lista];
    }
  },
  {
    name: 'alterar_configuracoes',
    description: 'Altera configurações (envie só o que mudar). alertas: enabled, soundStart/soundAdvance (sino, gota, duplo, marimba, harpa, digital, custom, none), volume (0-1), advanceEnabled, advanceMinutes, windowsNotification, popup, popupSeconds, snoozeMinutes. janela_flutuante: enabled, alwaysOnTop, fixedTop, opacity (0.4-1). geral: startWithWindows, closeToTray.',
    inputSchema: { type: 'object', properties: { alertas: { type: 'object' }, janela_flutuante: { type: 'object' }, geral: { type: 'object' } } },
    run(a) {
      const cfg = load();
      Object.assign(cfg.settings.alerts, a.alertas || {});
      Object.assign(cfg.settings.floating, a.janela_flutuante || {});
      Object.assign(cfg.settings.general, a.geral || {});
      return save(cfg).settings;
    }
  },
  {
    name: 'ler_configuracao',
    description: 'Retorna a configuração completa (config.json) para análise ou alterações em lote com substituir_configuracao.',
    inputSchema: { type: 'object', properties: {} },
    run() {
      return load();
    }
  },
  {
    name: 'substituir_configuracao',
    description: 'Substitui a configuração inteira (use o formato de ler_configuracao). Valida tudo; campos inválidos são corrigidos ou descartados. Guarda a versão anterior para desfazer_ultima_alteracao.',
    inputSchema: { type: 'object', properties: { config: { type: 'object' } }, required: ['config'] },
    run(a) {
      const out = save(a.config);
      return 'Configuração substituída: ' + out.activities.length + ' atividades, ' + out.categories.length + ' categorias, ' + out.exceptions.length + ' exceções.';
    }
  },
  {
    name: 'desfazer_ultima_alteracao',
    description: 'Restaura a rotina como estava antes da última alteração feita por estas ferramentas.',
    inputSchema: { type: 'object', properties: {} },
    run() {
      if (!fs.existsSync(backupFile())) fail('Não há alteração para desfazer.');
      const prev = new JsonStore(backupFile()).load() || fail('Cópia anterior ilegível.');
      save(prev);
      return 'Última alteração desfeita.';
    }
  }
];

const INSTRUCTIONS = [
  'Rotina Desktop: rotina pessoal do usuário (Windows, offline). Estas ferramentas leem e alteram a rotina; o app aberto recarrega na hora.',
  'Modelo: atividades semanais (id, start HH:MM, duration em minutos, days 0=domingo…6=sábado, category define a cor, priority 10 = compromisso que prevalece em sobreposições).',
  'Tarefas fixas por dia da semana (casa, nota, projeto) entram nas atividades via {casa}/{projeto}/{nota}.',
  'Para mudar só uma data (feriado, consulta, viagem) use salvar_excecao em vez de mexer na rotina semanal.',
  'Antes de alterar, consulte ver_dia/listar_atividades para obter ids. Toda alteração pode ser revertida com desfazer_ultima_alteracao.'
].join('\n');

async function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new ToolError('Ferramenta desconhecida: ' + name);
  const result = await tool.run(args || {});
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

module.exports = { TOOLS, INSTRUCTIONS, callTool, ToolError, dataDir };
