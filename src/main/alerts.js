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
  const after = status.next ? 'Depois: ' + status.next.title + ' às ' + engine.fmtHM(new Date(status.nextAt).getHours() * 60 + new Date(status.nextAt).getMinutes()) : '';
  let title;
  let body;
  if (event.type === 'advance') {
    title = 'Em ' + event.minutes + ' min: ' + it.title;
    body = 'Começa às ' + it.startLabel + (event.current && event.current.key !== it.key ? ' · encerre "' + event.current.title + '"' : '');
  } else if (event.type === 'resume') {
    title = 'De volta: ' + it.title;
    body = (event.ended ? event.ended.title + ' terminou · ' : '') + 'até ' + it.endLabel;
  } else {
    title = 'Agora: ' + it.title;
    body = range + (it.subtitle ? ' · ' + it.subtitle : '');
    if (event.others && event.others.length) body += '\nSimultâneo: ' + event.others.map((o) => o.title).join(', ');
  }
  if (event.type !== 'advance' && after) body += '\n' + after;
  return {
    id: event.key + '|' + now,
    key: event.key,
    type: event.type,
    at: event.at,
    firedAt: now,
    title,
    body,
    item: { id: it.id, key: it.key, title: it.title, color: it.color, icon: it.icon, startLabel: it.startLabel, endLabel: it.endLabel },
    sound: event.type === 'advance' ? 'advance' : 'start'
  };
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
        if (now - s.at <= GRACE_MS) {
          due.push(Object.assign({}, s.alert, { id: s.alert.key + '|snooze|' + now, type: 'snooze', firedAt: now, title: '⏰ ' + s.alert.title.replace(/^⏰ /, ''), sound: 'start' }));
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
      this.state.lastAlert = alert;
      delivered.push(alert);
      this.log('Alerta: ' + alert.title + (alert.muted ? ' (silenciado)' : ''));
      this.deliver(alert);
    }
    if (delivered.length) this.saveState();
    return delivered;
  }

  snooze(minutes, alert) {
    const target = alert || this.state.lastAlert;
    if (!target) return null;
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

module.exports = { AlertService, GRACE_MS, MAX_GAP_MS };
