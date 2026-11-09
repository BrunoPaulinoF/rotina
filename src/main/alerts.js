'use strict';
/**
 * Serviço de alertas: a cada "tick" verifica os eventos do motor no intervalo desde o último tick.
 * - Só dispara eventos recentes (até GRACE_MS atrás): com o PC desligado/suspenso, nada atrasado é disparado.
 * - Se o relógio pular (suspensão, hibernação, ajuste de hora), o intervalo perdido é ignorado.
 * - Pausa: nenhum alerta. Silêncio: alerta visual sem som.
 */

const engine = require('../shared/engine');

const GRACE_MS = 60 * 1000;
const MAX_GAP_MS = 90 * 1000;

function describe(event, config, now) {
  const it = event.item;
  const range = it.startLabel + ' – ' + it.endLabel;
  const status = engine.getStatus(config, event.at + 1);
  const nextTime = status.next ? engine.fmtHM(new Date(status.nextAt).getHours() * 60 + new Date(status.nextAt).getMinutes()) : '';
  const after = status.next ? 'Depois: ' + status.next.title + ' às ' + nextTime : '';
  let kicker;
  let time;
  let detail = it.subtitle || '';
  const notes = [];
  if (event.type === 'advance') {
    kicker = 'Em ' + event.minutes + ' min';
    time = 'Começa às ' + it.startLabel;
    if (event.current && event.current.key !== it.key) notes.push({ icon: 'flag', text: 'Encerre: ' + event.current.title });
  } else if (event.type === 'resume') {
    kicker = 'De volta';
    time = 'Até ' + it.endLabel;
    detail = event.ended ? event.ended.title + ' terminou' : detail;
  } else {
    kicker = 'Agora';
    time = range;
    if (event.others && event.others.length) notes.push({ icon: 'users', text: 'Simultâneo: ' + event.others.map((o) => o.title).join(', ') });
  }
  if (event.type !== 'advance' && after) notes.push({ icon: 'chevronRight', text: after });
  return {
    id: event.key + '|' + now,
    key: event.key,
    type: event.type,
    at: event.at,
    firedAt: now,
    // Texto corrido, usado no log e na lista de alertas adiados.
    title: kicker + ': ' + it.title,
    body: [time, detail].filter(Boolean).join(' · ') + notes.map((n) => '\n' + n.text).join(''),
    // Partes separadas, usadas no cartão de alerta.
    kicker,
    heading: it.title,
    time,
    detail,
    notes,
    canSnooze: event.type !== 'advance',
    nextKey: event.type !== 'advance' && status.next ? status.next.key : null,
    item: { id: it.id, key: it.key, title: it.title, color: it.color, icon: it.icon, startLabel: it.startLabel, endLabel: it.endLabel, startMs: it.start, endMs: it.end },
    sound: event.type === 'advance' ? 'advance' : 'start'
  };
}

/**
 * Fila do cartão de alerta: mostra um aviso por vez, sem um apagar o outro.
 * Ao chegar a vez de um aviso, descarta o que já ficou velho (a atividade já começou ou já acabou).
 */
class CardQueue {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(card) {
    // O início de uma atividade torna inútil o aviso antecipado dela que ainda estava na fila.
    if (card.type !== 'advance' && card.item) {
      this.items = this.items.filter((c) => !(c.type === 'advance' && c.item && c.item.key === card.item.key));
    }
    this.items.push(card);
  }

  next(now) {
    while (this.items.length) {
      const card = this.items.shift();
      const it = card.item || {};
      const stale = (card.type === 'advance' && it.startMs <= now) || (it.endMs != null && it.endMs <= now);
      if (!stale) return card;
    }
    return null;
  }
}

class AlertService {
  /**
   * @param {object} o
   * @param {() => number} o.now
   * @param {() => object} o.getConfig
   * @param {object} o.state  estado em tempo de execução (paused, muteUntil, snoozes, lastAlert)
   * @param {() => void} o.saveState
   * @param {(alert: object) => void} o.deliver
   */
  constructor(o) {
    this.now = o.now;
    this.getConfig = o.getConfig;
    this.state = o.state;
    this.saveState = o.saveState || (() => {});
    this.deliver = o.deliver;
    this.log = o.log || (() => {});
    this.last = null;
    this.fired = new Map();
  }

  /** Esquece o intervalo desde o último tick (usar ao retomar da suspensão ou ao mudar a hora). */
  resetClock() {
    this.last = this.now();
  }

  isMuted(now) {
    return (this.state.muteUntil || 0) > now;
  }

  tick() {
    const now = this.now();
    const config = this.getConfig();
    if (this.last == null || now < this.last - 2000 || now - this.last > MAX_GAP_MS) {
      if (this.last != null) this.log('Salto de relógio detectado; alertas do intervalo ignorados.');
      this.last = now - 1000;
    }
    const from = Math.max(this.last, now - GRACE_MS);
    const a = config.settings.alerts;
    const due = [];

    for (const ev of engine.getEvents(config, from, now, a)) {
      if (this.fired.has(ev.key)) continue;
      this.fired.set(ev.key, now);
      due.push(describe(ev, config, now));
    }

    // Quando uma atividade começa, o cartão já diz "Depois: ...": o aviso antecipado
    // dessa próxima, no mesmo instante, seria repetição (e tocaria dois sons).
    const covered = new Set(due.filter((d) => d.nextKey).map((d) => d.nextKey));
    for (let i = due.length - 1; i >= 0; i--) {
      if (due[i].type === 'advance' && covered.has(due[i].item.key)) due.splice(i, 1);
    }

    // Alertas adiados
    if (this.state.snoozes.length) {
      const keep = [];
      let changed = false;
      for (const s of this.state.snoozes) {
        if (s.at > now) {
          keep.push(s);
          continue;
        }
        changed = true;
        const ended = s.alert.item && s.alert.item.endMs != null && s.alert.item.endMs <= now;
        if (now - s.at <= GRACE_MS && !ended) {
          const heading = s.alert.heading || (s.alert.item && s.alert.item.title) || s.alert.title;
          due.push(Object.assign({}, s.alert, { id: s.alert.key + '|snooze|' + now, type: 'snooze', firedAt: now, kicker: 'Lembrete', title: 'Lembrete: ' + heading, heading, canSnooze: true, sound: 'start' }));
        }
      }
      if (changed) {
        this.state.snoozes = keep;
        this.saveState();
      }
    }

    this.last = now;
    this.prune(now);

    const delivered = [];
    if (this.state.paused || !a.enabled) return delivered;
    for (const alert of due) {
      alert.muted = this.isMuted(now);
      // Aviso antecipado não se adia: voltaria dizendo "em 5 min" com a atividade já começada.
      if (alert.canSnooze !== false) this.state.lastAlert = alert;
      delivered.push(alert);
      this.log('Alerta: ' + alert.title + (alert.muted ? ' (silenciado)' : ''));
      this.deliver(alert);
    }
    if (delivered.length) this.saveState();
    return delivered;
  }

  /** O último alerta ainda pode ser adiado? (recente e com a atividade em andamento) */
  canSnooze() {
    const last = this.state.lastAlert;
    if (!last || last.canSnooze === false) return false;
    const now = this.now();
    const endMs = last.item && last.item.endMs;
    return now - last.firedAt < 60 * 60000 && (endMs == null || endMs > now);
  }

  snooze(minutes, alert) {
    const target = alert || this.state.lastAlert;
    if (!target || target.canSnooze === false) return null;
    const at = this.now() + Math.max(1, Number(minutes) || 5) * 60000;
    this.state.snoozes = this.state.snoozes.filter((s) => s.alert.key !== target.key);
    this.state.snoozes.push({ at, alert: target });
    this.saveState();
    this.log('Alerta adiado ' + minutes + ' min: ' + target.title);
    return at;
  }

  prune(now) {
    if (this.fired.size < 200) return;
    for (const [k, t] of this.fired) if (now - t > engine.DAY_MS) this.fired.delete(k);
  }
}

module.exports = { AlertService, CardQueue, describe, GRACE_MS, MAX_GAP_MS };
