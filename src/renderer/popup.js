/* Cartão de alerta (canto inferior direito, não rouba o foco). */
(function () {
  'use strict';
  const api = window.rotina;
  const { icon } = window.UI;
  const $ = (id) => document.getElementById(id);

  $('x').innerHTML = icon('x', 16);
  $('x').onclick = () => api.action('dismissAlert');
  $('ok').onclick = () => api.action('dismissAlert');

  api.on('popup:data', ({ alert, seconds, snoozeMinutes }) => {
    document.body.style.setProperty('--c', alert.item.color);
    $('ic').innerHTML = icon(alert.item.icon, 24);
    $('title').textContent = alert.title;
    const lines = String(alert.body || '').split('\n');
    $('body').textContent = lines[0];
    $('hint').textContent = lines.slice(1).join(' · ') || (alert.muted ? 'Som silenciado' : '');
    const m2 = snoozeMinutes === 10 ? 15 : 10;
    $('s1').textContent = 'Adiar ' + snoozeMinutes + ' min';
    $('s2').textContent = m2 + ' min';
    $('s1').onclick = () => api.action('snooze', { minutes: snoozeMinutes });
    $('s2').onclick = () => api.action('snooze', { minutes: m2 });
    const t = $('timer');
    requestAnimationFrame(() => {
      t.style.transitionDuration = seconds + 's';
      t.style.width = '0%';
    });
  });
})();
