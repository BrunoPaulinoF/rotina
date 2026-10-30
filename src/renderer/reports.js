/* Aba Relatórios: produtividade contra a meta, por dia, categoria e atividade. */
(function () {
  'use strict';
  const api = window.rotina;
  const E = window.RotinaEngine;
  const { icon, esc } = window.UI;
  const App = window.App;
  const root = document.getElementById('report');

  const PERIODS = [['semana', 'Esta semana'], ['semana-passada', 'Semana passada'], ['mes', 'Este mês'], ['30dias', 'Últimos 30 dias']];
  let periodo = 'semana';
  const pct = (x) => Math.round(x * 100) + '%';

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (b) {
      periodo = b.dataset.p;
      render();
      return;
    }
    const day = e.target.closest('[data-day]');
    if (day) {
      App.viewDate = day.dataset.day;
      App.showView('hoje');
      window.__loadDay();
    }
    if (e.target.closest('[data-summary]')) api.action('checkin:summary');
  });

  async function render() {
    const r = await api.action('history:report', { periodo });
    const goal = r.meta;
    const chips = '<div class="filter">' + PERIODS.map(([v, l]) => '<button data-p="' + v + '" class="' + (v === periodo ? 'active' : '') + '">' + l + '</button>').join('') + '</div>';
    const head = '<div class="band"><span>' + icon('target', 22) + '</span><h2>RELATÓRIO DE PRODUTIVIDADE</h2><div style="margin-left:auto">' + chips + '</div></div>';

    if (!r.diasComDados) {
      root.innerHTML = '<section class="card">' + head + '<div class="empty"><strong>Ainda não há registros neste período</strong>Marque ✓ (fiz) ou ✗ (não fiz) nas atividades — pela pílula, pelo resumo das ' + App.config.settings.checkin.summaryTimes.join(' e ') + ' ou pela linha do tempo em "Hoje". O que ficar sem resposta conta como não feito.</div></section>';
      return;
    }

    const ok = r.taxa >= goal / 100;
    const kpis =
      '<div class="kpis">' +
      kpi(pct(r.taxa), 'cumprido no período', ok ? 'ok' : 'low', 'Meta: ' + goal + '%') +
      kpi(r.feitos + ' / ' + r.total, 'atividades feitas', '', (r.total - r.feitos) + ' não feitas') +
      kpi(r.diasNaMeta + ' / ' + r.diasComDados, 'dias na meta', r.diasNaMeta / r.diasComDados >= 0.5 ? 'ok' : 'low', 'dias com registro') +
      kpi(String(r.sequencia), r.sequencia === 1 ? 'dia seguido na meta' : 'dias seguidos na meta', r.sequencia ? 'ok' : '', 'sequência atual') +
      '</div>';

    // Gráfico de barras por dia, com a linha da meta.
    const bars = '<div class="bars" style="--goal:' + goal + '">' +
      r.dias.map((d) => {
        const date = E.parseDateKey(d.dateKey);
        return '<button class="bar-col" data-day="' + d.dateKey + '" title="' + esc(E.WEEKDAY_NAMES[d.weekday] + ', ' + E.fmtLongDate(date) + ': ' + d.feitos + ' de ' + d.total + (d.pendentes ? ' (' + d.pendentes + ' sem resposta)' : '')) + '">' +
          '<span class="bar-val">' + pct(d.taxa) + '</span>' +
          '<span class="bar-track"><i class="' + (d.bateuMeta ? 'ok' : 'low') + '" style="height:' + Math.max(2, d.taxa * 100) + '%"></i></span>' +
          '<span class="bar-lbl">' + E.WEEKDAY_SHORT[d.weekday] + '<small>' + date.getDate() + '/' + E.pad(date.getMonth() + 1) + '</small></span></button>';
      }).join('') + '<span class="goal-line"><em>meta ' + goal + '%</em></span></div>';

    const row = (name, color, done, total, extra) => '<div class="rrow"><span class="rdot" style="background:' + color + '"></span><span class="rname">' + esc(name) + '</span>' +
      '<span class="rbar"><i style="width:' + (total ? (done / total) * 100 : 0) + '%;background:' + color + '"></i><b style="left:' + goal + '%"></b></span>' +
      '<span class="rval">' + pct(total ? done / total : 0) + '</span><small class="rcount">' + done + '/' + total + (extra || '') + '</small></div>';

    const cats = r.categorias.map((c) => row(c.nome, c.cor, c.feitos, c.total)).join('');
    const worst = r.atividades.filter((a) => a.taxa < 1).slice(0, 6).map((a) => row(a.titulo, a.cor, a.feitos, a.total)).join('') || '<p class="muted-p">Nenhuma atividade pulada no período. 👏</p>';
    const best = r.atividades.slice().sort((a, b) => b.taxa - a.taxa || b.total - a.total).slice(0, 6).map((a) => row(a.titulo, a.cor, a.feitos, a.total)).join('');
    const pendingToday = App.status && App.status.checkin && App.status.checkin.pending;

    root.innerHTML =
      '<section class="card">' + head +
      '<div class="report-body">' + kpis +
      (pendingToday ? '<div class="report-alert">' + icon('clock', 18) + pendingToday + ' atividade(s) de hoje sem resposta. <button class="btn small" data-summary>Marcar agora</button></div>' : '') +
      '<div class="section-title">Por dia <small>(clique num dia para ver e corrigir as marcações)</small></div>' + bars +
      '</div></section>' +
      '<div class="report-grid">' +
      '<section class="card"><div class="band"><span>' + icon('star', 20) + '</span><h2>POR CATEGORIA</h2></div><div class="report-body">' + cats + '</div></section>' +
      '<section class="card"><div class="band"><span>' + icon('flag', 20) + '</span><h2>MAIS PULADAS</h2></div><div class="report-body">' + worst + '</div></section>' +
      '<section class="card"><div class="band"><span>' + icon('checkCircle', 20) + '</span><h2>MAIS CUMPRIDAS</h2></div><div class="report-body">' + best + '</div></section>' +
      '</div>';
  }

  function kpi(value, label, cls, sub) {
    return '<div class="kpi ' + (cls || '') + '"><strong>' + value + '</strong><span>' + label + '</span><small>' + sub + '</small></div>';
  }

  App.renderReport = render;
  window.__showReport = (p) => {
    if (p) periodo = p;
    App.showView('relatorios');
  };
})();
