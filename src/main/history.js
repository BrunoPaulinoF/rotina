'use strict';
/**
 * Histórico de conclusão (✓ feito / ✗ não feito) e relatórios de produtividade.
 *
 * Cada dia guarda uma "foto" das atividades que contam na meta, tirada enquanto o dia acontece.
 * Assim, editar ou apagar uma atividade depois não muda o histórico dos dias que já passaram.
 * Dias sem foto (computador desligado o dia todo) ficam fora dos relatórios.
 *
 * Situação de cada atividade:
 *   feito / nao-feito  — respondido pelo usuário (ou por um agente)
 *   pendente           — já acabou hoje e ainda não foi respondida (conta como não feita)
 *   sem-resposta       — de um dia que já passou, sem resposta (conta como não feita)
 *   futuro             — ainda não acabou (fora da conta)
 *   pausado            — terminou com a rotina pausada (fora da conta)
 */

const fs = require('fs');
const path = require('path');
const engine = require('../shared/engine');
const { JsonStore } = require('./store');

const EDIT_DAYS = 7;
const COUNTED = new Set(['feito', 'nao-feito', 'pendente', 'sem-resposta']);

function snapshotItem(i) {
  return {
    key: i.key,
    id: i.id,
    title: i.title,
    start: i.startLabel,
    end: i.endLabel,
    startMs: i.start,
    endMs: i.end,
    category: i.category,
    categoryName: i.categoryName,
    color: i.color,
    icon: i.icon
  };
}

class History {
  constructor(dir) {
    this.store = new JsonStore(path.join(dir, 'historico.json'));
    this.cache = null;
    this.mtime = -1;
  }

  /** Lê do disco quando o arquivo mudou (o app e os agentes podem gravar). */
  data() {
    let mtime = 0;
    try {
      mtime = fs.statSync(this.store.file).mtimeMs;
    } catch (_) { /* ainda não existe */ }
    if (!this.cache || mtime !== this.mtime) {
      const raw = this.store.load();
      this.cache = {
        version: 1,
        dias: raw && raw.dias && typeof raw.dias === 'object' ? raw.dias : {},
        pausas: raw && Array.isArray(raw.pausas) ? raw.pausas : []
      };
      this.mtime = mtime;
    }
    return this.cache;
  }

  save() {
    this.store.save(this.cache);
    try {
      this.mtime = fs.statSync(this.store.file).mtimeMs;
    } catch (_) { /* nada */ }
  }

  /**
   * Atualiza a foto do dia com as atividades que contam na meta, mantendo as respostas.
   * Atividades respondidas que saíram da rotina continuam (aconteceram).
   * Retorna true se algo mudou.
   */
  snapshotDay(config, date) {
    const d = this.data();
    const plan = engine.getDayPlan(config, date);
    const items = plan.items.filter((i) => i.track).map(snapshotItem);
    const day = d.dias[plan.dateKey] || { itens: [], respostas: {} };
    const keep = day.itens.filter((old) => day.respostas[old.key] && !items.some((n) => n.key === old.key));
    const next = items.concat(keep).sort((a, b) => a.startMs - b.startMs);
    if (d.dias[plan.dateKey] && JSON.stringify(next) === JSON.stringify(day.itens)) return false;
    day.itens = next;
    d.dias[plan.dateKey] = day;
    this.save();
    return true;
  }

  editable(dateKey, now) {
    const limit = engine.dateKey(engine.addDays(now, -EDIT_DAYS));
    return dateKey >= limit && dateKey <= engine.dateKey(now);
  }

  /** Registra ✓/✗ (status "feito", "nao-feito" ou null para limpar). */
  setStatus(config, dateKey, id, status, origem, now) {
    if (!this.editable(dateKey, now)) throw new Error('Só dá para marcar atividades dos últimos ' + EDIT_DAYS + ' dias.');
    if (status != null && !['feito', 'nao-feito'].includes(status)) throw new Error('Status inválido: use "feito" ou "nao-feito".');
    const d = this.data();
    if (!d.dias[dateKey]) this.snapshotDay(config, engine.parseDateKey(dateKey));
    const day = d.dias[dateKey];
    const item = day && day.itens.find((i) => i.id === id || i.key === id);
    if (!item) throw new Error('A atividade "' + id + '" não conta na meta nesse dia (ou não existe). Veja ver_dia.');
    if (item.startMs > now) throw new Error('"' + item.title + '" ainda não começou.');
    if (status) day.respostas[item.key] = { status, em: now, origem: origem || 'app' };
    else delete day.respostas[item.key];
    this.save();
    return Object.assign({}, item, { status: this.itemStatus(dateKey, item, now) });
  }

  pausedAt(t) {
    return this.data().pausas.some((p) => t >= p.inicio && (p.fim == null || t < p.fim));
  }

  addPause(now) {
    this.data().pausas.push({ inicio: now, fim: null });
    this.save();
  }

  endPause(now) {
    const open = this.data().pausas.filter((p) => p.fim == null);
    open.forEach((p) => { p.fim = now; });
    if (open.length) this.save();
  }

  itemStatus(dateKey, item, now) {
    const day = this.data().dias[dateKey];
    const r = day && day.respostas[item.key];
    if (r) return r.status;
    if (this.pausedAt(item.endMs)) return 'pausado';
    if (item.endMs > now) return 'futuro';
    return dateKey === engine.dateKey(now) ? 'pendente' : 'sem-resposta';
  }

  /** Atividades do dia com a situação de cada uma e o resumo para a meta. */
  day(dateKey, now) {
    const day = this.data().dias[dateKey];
    if (!day) return null;
    const itens = day.itens.map((i) => Object.assign({}, i, { status: this.itemStatus(dateKey, i, now), editable: this.editable(dateKey, now) }));
    return Object.assign({ dateKey, itens }, summarize(itens));
  }

  /** Atividades que já podem ser respondidas: a partir de alguns minutos antes do fim. */
  prompts(dateKey, now, beforeMs) {
    const day = this.day(dateKey, now);
    if (!day) return [];
    return day.itens.filter((i) => (i.status === 'pendente' || (i.status === 'futuro' && i.endMs - beforeMs <= now)) && i.startMs <= now);
  }

  /** Relatório entre duas datas (inclusive). */
  report(fromKey, toKey, now, goal) {
    const dias = [];
    const byCat = new Map();
    const byAct = new Map();
    let d = engine.parseDateKey(fromKey);
    const end = engine.parseDateKey(toKey);
    while (d <= end) {
      const key = engine.dateKey(d);
      const day = this.day(key, now);
      if (day && day.total > 0) {
        dias.push({ dateKey: key, weekday: d.getDay(), feitos: day.feitos, total: day.total, taxa: day.taxa, pendentes: day.pendentes, bateuMeta: day.taxa >= goal / 100 });
        for (const i of day.itens) {
          if (!COUNTED.has(i.status)) continue;
          const done = i.status === 'feito' ? 1 : 0;
          const c = byCat.get(i.category) || { id: i.category, nome: i.categoryName, cor: i.color, feitos: 0, total: 0 };
          c.feitos += done;
          c.total += 1;
          byCat.set(i.category, c);
          const a = byAct.get(i.id) || { id: i.id, titulo: i.title, cor: i.color, icon: i.icon, feitos: 0, total: 0 };
          a.feitos += done;
          a.total += 1;
          a.titulo = i.title;
          byAct.set(i.id, a);
        }
      }
      d = engine.addDays(d, 1);
    }
    const feitos = dias.reduce((s, x) => s + x.feitos, 0);
    const total = dias.reduce((s, x) => s + x.total, 0);
    const withRate = (x) => Object.assign(x, { taxa: x.total ? x.feitos / x.total : 0 });
    // Sequência: dias seguidos (com dados) batendo a meta, contando de trás para frente.
    let sequencia = 0;
    for (let i = dias.length - 1; i >= 0; i--) {
      if (dias[i].dateKey === engine.dateKey(now) && !dias[i].bateuMeta) continue; // hoje ainda pode virar
      if (!dias[i].bateuMeta) break;
      sequencia++;
    }
    return {
      de: fromKey,
      ate: toKey,
      meta: goal,
      feitos,
      total,
      taxa: total ? feitos / total : 0,
      diasComDados: dias.length,
      diasNaMeta: dias.filter((x) => x.bateuMeta).length,
      sequencia,
      dias,
      categorias: Array.from(byCat.values()).map(withRate).sort((a, b) => b.total - a.total),
      atividades: Array.from(byAct.values()).map(withRate).sort((a, b) => a.taxa - b.taxa || b.total - a.total)
    };
  }
}

function summarize(itens) {
  const counted = itens.filter((i) => COUNTED.has(i.status));
  const feitos = counted.filter((i) => i.status === 'feito').length;
  return {
    feitos,
    naoFeitos: counted.filter((i) => i.status === 'nao-feito' || i.status === 'sem-resposta').length,
    pendentes: itens.filter((i) => i.status === 'pendente').length,
    futuros: itens.filter((i) => i.status === 'futuro').length,
    total: counted.length,
    taxa: counted.length ? feitos / counted.length : 0
  };
}

/** Atalhos de período para relatórios: semana, semana-passada, mes, 30dias. */
function periodRange(periodo, now) {
  const today = engine.startOfDay(now);
  const key = engine.dateKey;
  switch (periodo) {
    case 'semana-passada': {
      const s = engine.addDays(engine.weekStart(today), -7);
      return [key(s), key(engine.addDays(s, 6))];
    }
    case 'mes':
      return [key(new Date(today.getFullYear(), today.getMonth(), 1)), key(today)];
    case '30dias':
      return [key(engine.addDays(today, -29)), key(today)];
    default:
      return [key(engine.weekStart(today)), key(today)];
  }
}

module.exports = { History, periodRange, EDIT_DAYS };
