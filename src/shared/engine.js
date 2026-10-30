/**
 * Motor de agendamento da Rotina Desktop.
 * Funções puras: recebem a configuração e um instante, devolvem plano do dia,
 * status atual e eventos de alerta. Não depende do Electron (testável com node:test)
 * e também é carregado nas janelas (window.RotinaEngine).
 */
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else window.RotinaEngine = factory();
})(function () {
'use strict';

const MINUTE = 60000;
const DAY_MS = 86400000;

const WEEKDAY_NAMES = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const WEEKDAY_SHORT = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const FALLBACK_CATEGORY = { id: 'basico', name: 'Básico do dia', color: '#7E93A8', icon: 'dot' };

function pad(n) {
  return String(n).padStart(2, '0');
}

/** "06:40" -> 400 (minutos desde 00:00); inválido -> null */
function parseHM(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text == null ? '' : text).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** 400 -> "06:40" (sempre dentro de 24h) */
function fmtHM(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
}

function startOfDay(value) {
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(value, n) {
  const d = startOfDay(value);
  d.setDate(d.getDate() + n);
  return d;
}

function dateKey(value) {
  const d = new Date(value);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Instante (ms) de um dia local + minutos; aceita minutos > 1440 (vira o dia seguinte). */
function atMinutes(day, minutes) {
  const d = startOfDay(day);
  d.setMinutes(minutes);
  return d.getTime();
}

/** "1h 05min", "12min", "45s" */
function fmtDuration(ms, withSeconds) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (withSeconds) {
    if (h > 0) return h + 'h ' + pad(m) + 'min ' + pad(s) + 's';
    if (m > 0) return m + 'min ' + pad(s) + 's';
    return s + 's';
  }
  const roundedMin = Math.ceil(totalSec / 60);
  const hh = Math.floor(roundedMin / 60);
  const mm = roundedMin % 60;
  if (hh > 0) return hh + 'h' + (mm ? ' ' + pad(mm) + 'min' : '');
  return mm + 'min';
}

function fmtLongDate(value) {
  const d = new Date(value);
  return d.getDate() + ' de ' + MONTH_NAMES[d.getMonth()] + ' de ' + d.getFullYear();
}

function categoryMap(config) {
  const map = Object.create(null);
  for (const c of (config && config.categories) || []) map[c.id] = c;
  return map;
}

function findException(config, key) {
  return ((config && config.exceptions) || []).find((e) => e && e.date === key) || null;
}

function resolveDay(config, value) {
  const day = startOfDay(value);
  const key = dateKey(day);
  const weekday = day.getDay();
  const exception = findException(config, key);
  let baseDay = weekday;
  if (exception && Number.isInteger(exception.baseDay) && exception.baseDay >= 0 && exception.baseDay <= 6) {
    baseDay = exception.baseDay;
  }
  return { day, key, weekday, baseDay, exception, off: !!(exception && exception.off) };
}

/** Substitui {casa}, {projeto} e {nota} e remove separadores que sobraram vazios. */
function fillPlaceholders(text, weekly) {
  const filled = String(text || '').replace(/\{(casa|projeto|nota)\}/g, (_, k) => String((weekly && weekly[k]) || '').trim());
  return filled
    .replace(/(\s*[·+]\s*){2,}/g, ' · ')
    .replace(/^\s*[·+]\s*/, '')
    .replace(/\s*[·+]\s*$/, '')
    .trim();
}

// Cache de planos por objeto de configuração (a config é substituída a cada salvamento).
const planCache = new WeakMap();

function getDayPlan(config, value) {
  const r = resolveDay(config, value);
  let byKey = planCache.get(config);
  if (!byKey) {
    byKey = new Map();
    planCache.set(config, byKey);
  }
  const cached = byKey.get(r.key);
  if (cached) return cached;

  const weekly = ((config && config.weekly) || [])[r.weekday] || {};
  const cats = categoryMap(config);
  let acts = [];
  if (!r.off) {
    acts = ((config && config.activities) || []).filter(
      (a) => a && a.enabled !== false && Array.isArray(a.days) && a.days.includes(r.baseDay)
    );
    const removed = (r.exception && Array.isArray(r.exception.removedIds)) ? r.exception.removedIds : [];
    if (removed.length) acts = acts.filter((a) => !removed.includes(a.id));
  }
  if (r.exception && Array.isArray(r.exception.extra)) {
    acts = acts.concat(r.exception.extra.map((a) => Object.assign({}, a, { extra: true })));
  }

  const items = [];
  for (const a of acts) {
    const s = parseHM(a.start);
    const dur = Math.round(Number(a.duration));
    if (s == null || !(dur > 0)) continue;
    const cat = cats[a.category] || FALLBACK_CATEGORY;
    items.push({
      key: r.key + '|' + a.id,
      id: a.id,
      dateKey: r.key,
      title: fillPlaceholders(a.title, weekly) || 'Atividade',
      subtitle: fillPlaceholders(a.subtitle, weekly),
      startMin: s,
      endMin: s + dur,
      duration: dur,
      start: atMinutes(r.day, s),
      end: atMinutes(r.day, s + dur),
      startLabel: fmtHM(s),
      endLabel: fmtHM(s + dur),
      category: cat.id,
      categoryName: cat.name,
      color: cat.color,
      icon: a.icon || cat.icon || 'dot',
      priority: Number(a.priority) || 0,
      alertStart: a.alertStart !== false,
      alertAdvance: a.alertAdvance !== false,
      extra: !!a.extra
    });
  }
  items.sort((x, y) => x.start - y.start || y.priority - x.priority || x.end - y.end);

  const plan = {
    dateKey: r.key,
    weekday: r.weekday,
    baseDay: r.baseDay,
    off: r.off,
    exception: r.exception ? { note: r.exception.note || '', baseDay: r.baseDay, off: r.off } : null,
    weekly,
    items
  };
  byKey.set(r.key, plan);
  return plan;
}

/** Ordena atividades simultâneas: maior prioridade, depois a que começou mais tarde, depois a mais curta. */
function sortPrimary(list) {
  return list.slice().sort((a, b) => b.priority - a.priority || b.start - a.start || a.end - b.end || (a.key < b.key ? -1 : 1));
}

function activeAt(items, t) {
  return items.filter((i) => i.start <= t && t < i.end);
}

function primaryAt(items, t) {
  return sortPrimary(activeAt(items, t))[0] || null;
}

/** Itens de vários dias consecutivos (sem duplicar). */
function itemsBetween(config, fromDay, days) {
  const out = [];
  for (let o = 0; o < days; o++) out.push(...getDayPlan(config, addDays(fromDay, o)).items);
  return out;
}

/**
 * Status em um instante: atividade principal, simultâneas, próxima e transição.
 * Uma "transição" é o próximo instante em que a atividade principal muda.
 */
function getStatus(config, now) {
  const today = startOfDay(now);
  const all = itemsBetween(config, addDays(today, -1), 4);
  const current = sortPrimary(activeAt(all, now));
  const primary = current[0] || null;

  const points = Array.from(new Set(all.flatMap((i) => [i.start, i.end]).filter((t) => t > now))).sort((a, b) => a - b);
  let transitionAt = null;
  let nextPrimary = null;
  for (const t of points) {
    const p = primaryAt(all, t);
    if ((p && p.key) !== (primary && primary.key)) {
      transitionAt = t;
      nextPrimary = p;
      break;
    }
  }
  // Se a transição leva a "tempo livre", a próxima atividade é a próxima que vira principal.
  let next = nextPrimary;
  let nextAt = transitionAt;
  if (!next && transitionAt != null) {
    for (const t of points) {
      if (t <= transitionAt) continue;
      const p = primaryAt(all, t);
      if (p) {
        next = p;
        nextAt = t;
        break;
      }
    }
  }

  const plan = getDayPlan(config, today);
  return {
    now,
    dateKey: plan.dateKey,
    weekday: plan.weekday,
    off: plan.off,
    exceptionNote: plan.exception ? plan.exception.note : '',
    primary,
    others: current.slice(1),
    next,
    nextAt,
    nextResumes: !!(next && next.start < (nextAt || 0)),
    transitionAt,
    remainingMs: primary ? primary.end - now : null,
    toTransitionMs: transitionAt != null ? transitionAt - now : null,
    progress: primary ? Math.min(1, Math.max(0, (now - primary.start) / (primary.end - primary.start))) : 0
  };
}

/**
 * Eventos de alerta com instante em (from, to].
 *  - start: atividade passa a ser a principal no seu início
 *  - resume: uma atividade de maior prioridade terminou e a anterior volta a ser a principal
 *  - advance: aviso antecipado de um "start"
 * Inícios encobertos por atividade de maior prioridade (ex.: família durante o futebol) não alertam.
 */
function getEvents(config, from, to, opts) {
  const advanceMin = opts && opts.advanceEnabled ? Math.max(0, Number(opts.advanceMinutes) || 0) : 0;
  const firstDay = addDays(from, -1);
  const days = Math.ceil((startOfDay(to).getTime() - firstDay.getTime()) / DAY_MS) + 3;
  const all = itemsBetween(config, firstDay, days);
  const events = [];

  for (const item of all) {
    const p = primaryAt(all, item.start);
    if (!p || p.key !== item.key) continue;
    const others = sortPrimary(activeAt(all, item.start)).slice(1);
    if (item.start > from && item.start <= to && item.alertStart) {
      events.push({ type: 'start', at: item.start, item, others, key: 'start|' + item.key + '|' + item.start });
    }
    if (advanceMin > 0 && item.alertAdvance) {
      const at = item.start - advanceMin * MINUTE;
      if (at > from && at <= to) {
        events.push({ type: 'advance', at, item, minutes: advanceMin, current: primaryAt(all, at), key: 'advance|' + item.key + '|' + item.start });
      }
    }
  }

  const ends = Array.from(new Set(all.map((i) => i.end))).filter((t) => t > from && t <= to);
  for (const t of ends) {
    const p = primaryAt(all, t);
    if (!p || p.start >= t || !p.alertStart) continue;
    const ended = all.filter((i) => i.end === t);
    events.push({ type: 'resume', at: t, item: p, ended: sortPrimary(ended)[0] || null, key: 'resume|' + p.key + '|' + t });
  }

  events.sort((a, b) => a.at - b.at || (a.type === 'advance' ? 1 : -1));
  return events;
}

/** Plano de próximos dias para um "dia de referência" (ex.: semana a partir da segunda). */
function weekStart(value) {
  const d = startOfDay(value);
  const wd = d.getDay();
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}

return {
  MINUTE,
  DAY_MS,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  MONTH_NAMES,
  pad,
  parseHM,
  fmtHM,
  fmtDuration,
  fmtLongDate,
  startOfDay,
  addDays,
  dateKey,
  parseDateKey,
  atMinutes,
  resolveDay,
  fillPlaceholders,
  getDayPlan,
  getStatus,
  getEvents,
  sortPrimary,
  activeAt,
  primaryAt,
  weekStart
};
});
