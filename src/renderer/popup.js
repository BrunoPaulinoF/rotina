/* Cartão de alerta do app (canto inferior direito, não rouba o foco). */
(function () {
  'use strict';
  const api = window.rotina;
  const { icon, esc } = window.UI;
  const $ = (id) => document.getElementById(id);

  // Tempo restante, para continuar de onde parou depois que o mouse sai de cima.
  let startedAt = 0;
  let remainingMs = 0;
  let queuedCount = 0;
  let footNote = '';

  $('x').innerHTML = icon('x', 16);
  $('x').onclick = (e) => {
    e.stopPropagation();
    api.action('dismissAlert');
  };
  $('main').onclick = () => api.action('popup:open');

  $('card').addEventListener('mouseenter', () => {
    remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt));
    api.action('popup:hold', { hold: true });
  });
  $('card').addEventListener('mouseleave', () => {
    startedAt = Date.now();
    api.action('popup:hold', { hold: false, remainingMs });
  });

  $('foot').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.snooze) api.action('snooze', { minutes: Number(b.dataset.snooze), fromCard: true });
    else if (b.dataset.open) api.action('popup:open');
    else api.action('dismissAlert');
  });

  function moreText() {
    if (queuedCount) return queuedCount === 1 ? 'Mais 1 aviso depois deste' : 'Mais ' + queuedCount + ' avisos depois deste';
    return footNote;
  }

  function renderFoot(card, snoozeMinutes) {
    const longer = snoozeMinutes >= 15 ? snoozeMinutes * 2 : 15;
    footNote = card.muted ? 'Som silenciado' : '';
    let html = '';
    if (card.action) {
      html += '<button class="btn small primary" data-open="1">' + esc(card.action.label) + '</button><button class="btn small">Agora não</button>';
    } else {
      html += '<button class="btn small primary">' + icon('check', 14) + 'Entendi</button>';
      if (card.canSnooze) {
        html += '<span class="label" style="margin-left:6px">Adiar</span>' +
          '<button class="btn small" data-snooze="' + snoozeMinutes + '">' + snoozeMinutes + ' min</button>' +
          '<button class="btn small" data-snooze="' + longer + '">' + longer + ' min</button>';
      }
    }
    $('foot').innerHTML = html + '<span class="grow" id="more"></span>';
    $('more').textContent = moreText();
  }

  api.on('popup:queued', (count) => {
    queuedCount = count;
    const more = $('more');
    if (more) more.textContent = moreText();
  });

  api.on('popup:data', ({ card, seconds, snoozeMinutes, queued }) => {
    queuedCount = queued || 0;
    const el = $('card');
    el.style.setProperty('--c', card.item.color);
    $('ic').innerHTML = icon(card.item.icon, 25);
    $('kicker').textContent = card.kicker || '';
    $('time').textContent = card.time || '';
    $('heading').textContent = card.heading || card.title || '';
    $('detail').textContent = card.detail || '';
    $('detail').hidden = !card.detail;

    const notes = card.notes || [];
    $('notes').innerHTML = notes.map((n) => '<div>' + icon(n.icon, 14) + '<span title="' + esc(n.text) + '">' + esc(n.text) + '</span></div>').join('');
    $('notes').hidden = !notes.length;
    $('main').style.paddingBottom = notes.length ? '10px' : '4px';
    renderFoot(card, snoozeMinutes);

    // Recomeça a contagem e a animação de entrada a cada cartão.
    remainingMs = seconds * 1000;
    startedAt = Date.now();
    const t = $('timer');
    t.style.animation = 'none';
    el.style.animation = 'none';
    void el.offsetWidth;
    t.style.animation = '';
    t.style.animationDuration = seconds + 's';
    el.style.animation = '';

    const style = getComputedStyle(document.body);
    const height = el.offsetHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    api.action('popup:ready', { height });
  });
})();
