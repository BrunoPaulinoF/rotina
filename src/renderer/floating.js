/* Janela flutuante compacta. */
(function () {
  'use strict';
  const api = window.rotina;
  const E = window.RotinaEngine;
  const { icon, esc } = window.UI;
  const $ = (id) => document.getElementById(id);
  let snoozeMinutes = 5;
  let sig = '';
  let alertId = null;

  $('open').innerHTML = icon('expand', 16);
  $('close').innerHTML = icon('x', 16);
  $('open').onclick = () => api.action('openMain');
  $('close').onclick = () => api.action('floating:hide');
  $('pin').onclick = () => api.action('floating:alwaysOnTop', { value: !$('pin').classList.contains('on') });
  document.body.addEventListener('dblclick', (e) => {
    if (!e.target.closest('button')) api.action('openMain');
  });

  function render(s) {
    const d = new Date(s.now);
    $('clock').innerHTML = E.pad(d.getHours()) + ':' + E.pad(d.getMinutes()) + '<small>' + E.pad(d.getSeconds()) + '</small>';
    $('day').innerHTML = E.WEEKDAY_NAMES[d.getDay()].split('-')[0] + '<br>' + d.getDate() + '/' + E.pad(d.getMonth() + 1);
    $('pin').innerHTML = icon('pin', 16);
    $('pin').classList.toggle('on', s.alwaysOnTop);
    $('pin').title = s.alwaysOnTop ? 'Sempre visível (ativado)' : 'Sempre visível (desativado)';

    const st = $('state');
    const muted = s.muteUntil > s.now;
    st.textContent = s.paused ? 'PAUSADA' : muted ? 'SEM SOM' : '';
    st.classList.toggle('hidden', !s.paused && !muted);

    const p = s.primary;
    const key = (p ? p.key : '-') + (s.next ? s.next.key : '') + s.nextAt;
    if (key !== sig) {
      sig = key;
      const now = $('now');
      if (p) {
        now.style.setProperty('--c', p.color);
        now.innerHTML = '<span class="ic">' + icon(p.icon, 24) + '</span><span class="t">' + esc(p.title) + '</span><span class="left"><small>RESTAM</small><strong data-rem></strong></span><span class="r">' + p.startLabel + ' – ' + p.endLabel + (s.others.length ? ' · + ' + esc(s.others[0].title) : '') + '</span><i class="bar" data-bar></i>';
      } else {
        now.style.setProperty('--c', '#7E93A8');
        now.innerHTML = '<span class="ic">' + icon('moon', 24) + '</span><span class="t">Tempo livre</span><span class="left"><small>PRÓXIMA EM</small><strong data-rem></strong></span><span class="r">' + (s.off ? 'Dia livre' : 'Sem atividade agora') + '</span>';
      }
      const next = $('next');
      if (s.next) {
        next.innerHTML = '<span style="color:' + s.next.color + '">' + icon(s.next.icon, 14) + '</span><span>Depois:</span><b>' + esc(s.next.title) + '</b><span>' + UI.timeLabel(s.nextAt) + '</span><span class="cnt" data-cnt></span>';
      } else {
        next.innerHTML = '<span>Nada mais programado</span>';
      }
    }
    const rem = document.querySelector('[data-rem]');
    if (rem) rem.textContent = p ? E.fmtDuration(s.remainingMs, s.remainingMs < 600000) : s.nextAt ? E.fmtDuration(s.nextAt - s.now) : '—';
    const bar = document.querySelector('[data-bar]');
    if (bar) bar.style.width = (s.progress * 100).toFixed(2) + '%';
    const cnt = document.querySelector('[data-cnt]');
    if (cnt) cnt.textContent = 'em ' + E.fmtDuration((p ? s.transitionAt : s.nextAt) - s.now, true);
    showAlert(s.alert);
  }

  function showAlert(a) {
    const el = $('alert');
    if (!a) {
      el.classList.add('hidden');
      alertId = null;
      return;
    }
    if (a.id === alertId) return;
    alertId = a.id;
    el.style.setProperty('--c', a.item.color);
    el.innerHTML = '<strong>' + esc(a.title) + '</strong><small>' + esc(a.body.split('\n')[0]) + '</small><div class="acts"><button data-s>Adiar ' + snoozeMinutes + ' min</button><button data-ok>OK</button></div>';
    el.classList.remove('hidden');
    el.querySelector('[data-s]').onclick = () => api.action('snooze', {});
    el.querySelector('[data-ok]').onclick = () => api.action('dismissAlert');
  }

  api.getConfig().then((c) => { snoozeMinutes = c.settings.alerts.snoozeMinutes; });
  api.on('config', (c) => { snoozeMinutes = c.settings.alerts.snoozeMinutes; sig = ''; });
  api.on('status', render);
  api.on('alert', (a) => showAlert(a));
  api.on('alert:dismiss', () => showAlert(null));
  api.getStatus().then(render);
})();
