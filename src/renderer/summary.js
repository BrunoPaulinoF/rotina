/* Cartão de resumo: marca de uma vez o que ficou sem resposta hoje. */
(function () {
  'use strict';
  const api = window.rotina;
  const { icon, esc } = window.UI;
  const $ = (id) => document.getElementById(id);

  document.querySelectorAll('[data-i]').forEach((el) => (el.innerHTML = icon(el.dataset.i, 26)));
  $('x').innerHTML = icon('x', 16);
  const close = () => api.action('checkin:closeSummary');
  $('x').onclick = close;
  $('later').onclick = close;

  $('list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-st]');
    if (!b) return;
    b.closest('.it').style.opacity = '.4';
    api.action('checkin:set', { dateKey: b.dataset.date, id: b.dataset.id, status: b.dataset.st, origem: 'resumo' });
  });

  api.on('summary:data', ({ items, today, goal }) => {
    if (!items.length) return close();
    $('list').innerHTML = items.map((i) =>
      '<div class="it" style="--c:' + i.color + '"><span class="ic">' + icon(i.icon, 20) + '</span>' +
      '<div class="t"><b>' + esc(i.title) + '</b><small>' + i.start + '–' + i.end + '</small></div>' +
      '<button class="yn yes" data-st="feito" data-id="' + esc(i.id) + '" data-date="' + i.key.split('|')[0] + '" title="Fiz">✓</button>' +
      '<button class="yn no" data-st="nao-feito" data-id="' + esc(i.id) + '" data-date="' + i.key.split('|')[0] + '" title="Não fiz">✗</button></div>'
    ).join('');
    $('score').innerHTML = today && today.total ? 'Hoje: <b>' + today.feitos + ' de ' + today.total + '</b> feitas (' + Math.round(today.taxa * 100) + '%) · meta ' + goal + '%' : '';
  });
})();
