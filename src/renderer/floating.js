/* Janela flutuante: pílula com a atividade atual e o tempo restante. */
(function () {
  'use strict';
  const api = window.rotina;
  const E = window.RotinaEngine;
  const { icon } = window.UI;
  const $ = (id) => document.getElementById(id);
  let sig = '';
  let flashTimer = null;

  $('open').innerHTML = icon('expand', 12);
  $('close').innerHTML = icon('x', 12);
  $('open').onclick = () => api.action('openMain');
  $('close').onclick = () => api.action('floating:hide');
  // A janela ignora cliques (eles vão para o que está atrás); só os botões capturam o mouse.
  for (const id of ['acts', 'ask']) {
    $(id).addEventListener('mouseenter', () => api.action('floating:mouse', { capture: true }));
    $(id).addEventListener('mouseleave', () => api.action('floating:mouse', { capture: false }));
  }
  let askItem = null;
  const answer = (status) => {
    if (!askItem) return;
    const item = askItem;
    $('ask').hidden = true;
    api.action('floating:mouse', { capture: false });
    api.action('checkin:set', { dateKey: item.key.split('|')[0], id: item.id, status, origem: 'pilula' });
  };
  $('yes').onclick = () => answer('feito');
  $('no').onclick = () => answer('nao-feito');
  document.addEventListener('mouseleave', () => api.action('floating:mouse', { capture: false }));

  function render(s) {
    const p = s.primary;
    const muted = s.muteUntil > s.now;
    const key = (s.paused ? 'P' : '') + (p ? p.key : '-') + (s.next ? s.next.key : '') + (muted ? 'M' : '');
    if (key !== sig) {
      sig = key;
      const pill = $('pill');
      if (s.paused) {
        pill.style.setProperty('--c', '#7E93A8');
        $('ic').innerHTML = icon('pause', 14);
        $('t').textContent = 'Rotina pausada';
      } else if (p) {
        pill.style.setProperty('--c', p.color);
        $('ic').innerHTML = icon(muted ? 'volumeX' : p.icon, 14);
        $('t').textContent = p.title;
      } else {
        pill.style.setProperty('--c', '#7E93A8');
        $('ic').innerHTML = icon('moon', 14);
        $('t').textContent = s.next ? 'Livre · ' + s.next.title : 'Tempo livre';
      }
      pill.title = (p ? p.title + ' (' + p.startLabel + '–' + p.endLabel + ')' : 'Tempo livre') + (s.next ? '\nDepois: ' + s.next.title + ' às ' + UI.timeLabel(s.nextAt) : '');
    }
    const ms = p ? s.remainingMs : s.nextAt ? s.nextAt - s.now : null;
    $('r').textContent = s.paused || ms == null ? '' : E.fmtDuration(ms, ms < 600000);
    $('bar').style.width = p && !s.paused ? (s.progress * 100).toFixed(2) + '%' : '0';

    // Pergunta ✓/✗ perto do fim da atividade (e um tempo depois)
    const ask = s.checkin && s.checkin.prompt;
    if (ask) {
      askItem = ask;
      $('q').textContent = 'Fez ' + ask.title + '?';
      $('q').title = ask.title + ' (' + ask.start + '–' + ask.end + ')';
    } else {
      askItem = null;
    }
    $('ask').hidden = !ask;
  }

  // No alerta, a pílula pisca por alguns segundos (o cartão com "Adiar" aparece no canto).
  api.on('alert', () => {
    const pill = $('pill');
    pill.classList.remove('flash');
    void pill.offsetWidth;
    pill.classList.add('flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => pill.classList.remove('flash'), 6500);
  });
  api.on('config', () => { sig = ''; });
  api.on('status', render);
  api.getStatus().then(render);
})();
