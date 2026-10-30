/* Janela principal: painel "Hoje", linha do tempo, semana e regras. Configurações ficam em settings.js. */
(function () {
  'use strict';

  const api = window.rotina;
  const E = window.RotinaEngine;
  const { icon, esc } = window.UI;
  const $ = (sel) => document.querySelector(sel);

  const DAY_COLORS = ['#7A8BA0', '#2F67D8', '#36A64A', '#7C4DDB', '#F07A24', '#E0405A', '#17A398'];

  const App = (window.App = {
    config: null,
    status: null,
    view: 'hoje',
    viewDate: null,
    weekRef: null,
    plan: null,
    saving: false,
    lastDateKey: null,
    commit,
    toast,
    openModal,
    closeModal,
    hydrateIcons,
    showView,
    renderSettings: () => {},
    renderReport: () => {},
    hist: null
  });

  function hydrateIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach((el) => {
      if (el.dataset.done) return;
      el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 18);
      el.dataset.done = '1';
    });
  }

  // ---------- utilidades ----------
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
  }

  async function commit(mutator, opts) {
    const o = opts || {};
    const draft = JSON.parse(JSON.stringify(App.config));
    mutator(draft);
    App.saving = true;
    try {
      App.config = await api.saveConfig(draft);
    } finally {
      App.saving = false;
    }
    await afterConfigChange(o.rerender);
    if (!o.silent) toast(o.msg || 'Salvo');
    return App.config;
  }

  function openModal(html) {
    closeModal();
    const root = $('#modal-root');
    root.innerHTML = '<div class="modal-backdrop"><div class="modal" role="dialog">' + html + '</div></div>';
    const backdrop = root.firstChild;
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) closeModal();
    });
    hydrateIcons(root);
    return backdrop.firstChild;
  }

  function closeModal() {
    $('#modal-root').innerHTML = '';
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // ---------- navegação ----------
  function showView(view) {
    if (!['hoje', 'semana', 'relatorios', 'regras', 'config'].includes(view)) view = 'hoje';
    App.view = view;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    if (view === 'semana') renderWeek();
    if (view === 'relatorios') App.renderReport();
    if (view === 'regras') renderRules();
    if (view === 'config') App.renderSettings();
  }
  window.__showView = showView;

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) showView(b.dataset.view);
  });

  // ---------- topo e ações rápidas ----------
  function renderTopActions(s) {
    const pause = $('#btn-pause');
    pause.innerHTML = icon(s.paused ? 'play' : 'pause', 18);
    pause.title = s.paused ? 'Retomar rotina' : 'Pausar rotina';
    pause.classList.toggle('warn', s.paused);
    const mute = $('#btn-mute');
    const muted = s.muteUntil > s.now;
    mute.innerHTML = icon(muted ? 'volumeX' : 'volume', 18);
    mute.title = muted ? 'Som silenciado até ' + UI.timeLabel(s.muteUntil) + ' — clique para reativar' : 'Silenciar por 30 min';
    mute.classList.toggle('warn', muted);
    const fl = $('#btn-floating');
    fl.innerHTML = icon('pip', 18);
    fl.title = s.floatingVisible ? 'Ocultar janela flutuante' : 'Mostrar janela flutuante';
    fl.classList.toggle('on', s.floatingVisible);

    const qs = $('#q-snooze');
    qs.disabled = !s.canSnooze;
    qs.innerHTML = icon('clock', 16) + 'Adiar ' + App.config.settings.alerts.snoozeMinutes + ' min';
    const qm = $('#q-mute');
    qm.classList.toggle('on', muted);
    qm.innerHTML = icon(muted ? 'volume' : 'volumeX', 16) + (muted ? 'Reativar som' : 'Silenciar 30 min');
    const qp = $('#q-pause');
    qp.classList.toggle('on', s.paused);
    qp.innerHTML = icon(s.paused ? 'play' : 'pause', 16) + (s.paused ? 'Retomar' : 'Pausar');

    const strip = $('#state-strip');
    const msgs = [];
    if (s.paused) msgs.push(icon('pause', 16) + ' Rotina pausada — nenhum alerta será disparado.');
    else if (!s.alertsEnabled) msgs.push(icon('bellOff', 16) + ' Alertas desativados nas configurações.');
    if (muted && !s.paused) msgs.push(icon('volumeX', 16) + ' Som silenciado até ' + UI.timeLabel(s.muteUntil) + '.');
    if (s.simulated) msgs.push(icon('clock', 16) + ' Relógio simulado (modo de teste).');
    strip.innerHTML = msgs.join('<span style="opacity:.4">|</span>');
    strip.classList.toggle('hidden', !msgs.length);
    strip.classList.toggle('paused', s.paused);
  }

  const togglePause = () => api.action(App.status.paused ? 'resume' : 'pause');
  const toggleMute = () => (App.status.muteUntil > App.status.now ? api.action('unmute') : api.action('mute', { minutes: 30 }));
  $('#btn-pause').addEventListener('click', togglePause);
  $('#q-pause').addEventListener('click', togglePause);
  $('#btn-mute').addEventListener('click', toggleMute);
  $('#q-mute').addEventListener('click', toggleMute);
  $('#btn-floating').addEventListener('click', () => api.action('floating:toggle'));
  $('#q-snooze').addEventListener('click', () => api.action('snooze', {}).then(() => toast('Alerta adiado')));

  // ---------- banner de alerta ----------
  let bannerId = null;
  function renderBanner(alert) {
    const el = $('#banner');
    if (!alert) {
      el.classList.add('hidden');
      bannerId = null;
      return;
    }
    if (alert.id === bannerId) return;
    bannerId = alert.id;
    const m = App.config.settings.alerts.snoozeMinutes;
    el.style.setProperty('--c', alert.item.color);
    el.innerHTML =
      '<div class="b-icon">' + icon(alert.item.icon, 24) + '</div>' +
      '<div class="b-text"><strong>' + esc(alert.title) + '</strong><small>' + esc(alert.body) + '</small></div>' +
      '<button class="btn" data-snooze>' + icon('clock', 16) + 'Adiar ' + m + ' min</button>' +
      '<button class="btn" data-ok>' + icon('check', 16) + 'OK</button>';
    el.classList.remove('hidden');
    el.querySelector('[data-snooze]').onclick = () => api.action('snooze', {});
    el.querySelector('[data-ok]').onclick = () => api.action('dismissAlert');
  }

  // ---------- relógio e cartões ----------
  function renderClock(s) {
    const c = UI.clockParts(s.now);
    $('#clock-hm').textContent = c.hm;
    $('#clock-s').textContent = c.s;
    $('#clock-weekday').textContent = E.WEEKDAY_NAMES[new Date(s.now).getDay()];
    $('#clock-date').textContent = E.fmtLongDate(s.now);
    const note = $('#day-note');
    const text = s.off ? 'Dia livre' + (s.exceptionNote ? ': ' + s.exceptionNote : '') : s.exceptionNote ? 'Exceção: ' + s.exceptionNote : '';
    note.textContent = text;
    note.classList.toggle('hidden', !text);
  }

  let nowSig = '';
  function renderNow(s) {
    const el = $('#now-card');
    const p = s.primary;
    const sig = (p ? p.key : 'free') + '|' + s.others.map((o) => o.key).join(',') + '|' + (s.next ? s.next.key : '');
    if (sig !== nowSig) {
      nowSig = sig;
      if (p) {
        el.className = 'card now-card';
        el.style.setProperty('--c', p.color);
        el.innerHTML =
          '<span class="label"><span class="pulse"></span>AGORA · ' + esc(p.categoryName.toUpperCase()) + '</span>' +
          '<div class="row"><div class="big-icon">' + icon(p.icon, 30) + '</div><div><h3>' + esc(p.title) + '</h3>' + (p.subtitle ? '<p>' + esc(p.subtitle) + '</p>' : '') + '</div></div>' +
          '<div class="times"><span class="range">' + p.startLabel + ' – ' + p.endLabel + '</span><span class="remain"><small>TEMPO RESTANTE</small><strong data-remain></strong></span></div>' +
          '<div class="progress"><i data-progress></i></div>' +
          (s.others.length ? '<div class="also">' + s.others.map((o) => '<span>' + icon(o.icon, 14) + 'Simultâneo: ' + esc(o.title) + '</span>').join('') + '</div>' : '');
      } else {
        el.className = 'card now-card free';
        el.style.removeProperty('--c');
        el.innerHTML =
          '<span class="label">TEMPO LIVRE</span>' +
          '<div class="row"><div class="big-icon">' + icon('moon', 30) + '</div><div><h3>' + (s.off ? 'Dia livre' : 'Nenhuma atividade agora') + '</h3><p>Aproveite sem culpa.</p></div></div>' +
          '<div class="times"><span class="range"></span><span class="remain"><small>PRÓXIMA EM</small><strong data-remain></strong></span></div>';
      }
    }
    const remain = el.querySelector('[data-remain]');
    if (remain) remain.textContent = p ? E.fmtDuration(s.remainingMs, s.remainingMs < 3600000) : s.nextAt ? E.fmtDuration(s.nextAt - s.now) : '—';
    const bar = el.querySelector('[data-progress]');
    if (bar) bar.style.width = (s.progress * 100).toFixed(2) + '%';
  }

  let nextSig = '';
  function renderNext(s) {
    const el = $('#next-card');
    const n = s.next;
    const sig = n ? n.key + '|' + s.nextAt : 'none';
    if (sig !== nextSig) {
      nextSig = sig;
      if (n) {
        el.style.setProperty('--c', n.color);
        const when = s.nextResumes ? 'Volta às ' + UI.timeLabel(s.nextAt) : 'Às ' + n.startLabel + ' – ' + n.endLabel;
        const dayHint = n.dateKey !== s.dateKey && !s.nextResumes ? ' (amanhã)' : '';
        el.innerHTML =
          '<div class="n-icon">' + icon(n.icon, 24) + '</div>' +
          '<div class="n-label">' + (s.nextResumes ? 'DEPOIS (RETOMA)' : 'PRÓXIMA ATIVIDADE') + '</div>' +
          '<div class="n-title">' + esc(n.title) + '</div>' +
          '<div class="n-foot"><span>' + when + dayHint + '</span><span class="n-count" data-count></span></div>';
      } else {
        el.style.removeProperty('--c');
        el.innerHTML = '<div class="n-icon">' + icon('check', 24) + '</div><div class="n-label">PRÓXIMA ATIVIDADE</div><div class="n-title">Nada programado</div>';
      }
    }
    const c = el.querySelector('[data-count]');
    if (c) {
      const ms = (s.primary ? s.transitionAt : s.nextAt) - s.now;
      c.textContent = 'em ' + E.fmtDuration(ms, ms < 3600000 * 3);
    }
  }

  // Placar real do dia: atividades feitas sobre as que já deviam ter acontecido.
  let histSig = '';
  function renderMeta(s) {
    $('#meta-text').textContent = App.config.meta;
    const c = s.checkin || {};
    const t = c.today;
    $('#meta-bar-wrap').style.setProperty('--goal', (c.goal || 70) + '%');
    const pct = t && t.total ? Math.round(t.taxa * 100) : 0;
    const bar = $('#meta-bar');
    bar.style.width = pct + '%';
    bar.classList.toggle('below', !!(t && t.total && pct < c.goal));
    $('#meta-count').textContent = !c.enabled ? 'Registro desligado' : t && t.total ? 'Hoje: ' + t.feitos + ' de ' + t.total + ' (' + pct + '%)' : 'Hoje: nada para contar ainda';
    const pend = $('#meta-pending');
    pend.classList.toggle('hidden', !c.pending);
    pend.textContent = c.pending ? c.pending + (c.pending === 1 ? ' atividade sem resposta — marcar agora' : ' atividades sem resposta — marcar agora') : '';
    // Recarrega as marcações da linha do tempo quando o placar de hoje muda.
    const sig = t ? [t.feitos, t.naoFeitos, t.pendentes, t.futuros].join('|') : '';
    if (sig !== histSig) {
      histSig = sig;
      if (App.viewDate === s.dateKey) loadHist().then(paintMarks);
    } else if (Math.floor(s.now / 60000) !== lastMarkMinute) {
      // Botões aparecem quando a atividade começa.
      lastMarkMinute = Math.floor(s.now / 60000);
      paintMarks();
    }
  }
  let lastMarkMinute = 0;

  $('#meta-pending').addEventListener('click', () => api.action('checkin:summary'));

  // ---------- ✓/✗ na linha do tempo ----------
  async function loadHist() {
    App.hist = await api.action('history:day', { dateKey: App.viewDate });
    return App.hist;
  }

  const MARK_TITLES = { feito: 'Feito', 'nao-feito': 'Não feito', pendente: 'Sem resposta — conta como não feito se ficar assim', 'sem-resposta': 'Ficou sem resposta (contou como não feito)', pausado: 'Rotina pausada — fora da meta', futuro: 'Ainda não começou' };

  function paintMarks() {
    const byKey = new Map(((App.hist && App.hist.itens) || []).map((i) => [i.key, i]));
    document.querySelectorAll('#timeline .tl-item').forEach((li) => {
      const box = li.querySelector('.ck');
      if (!box) return;
      const h = byKey.get(li.dataset.key);
      li.classList.remove('st-feito', 'st-nao-feito', 'st-pendente', 'st-sem-resposta');
      if (!h) {
        box.innerHTML = '';
        return;
      }
      li.classList.add('st-' + h.status);
      const started = h.startMs <= (App.status ? App.status.now : Date.now());
      if (!h.editable || !started || h.status === 'pausado') {
        box.innerHTML = h.status === 'feito' ? '<span class="ck-static yes">✓</span>' : h.status === 'nao-feito' || h.status === 'sem-resposta' ? '<span class="ck-static no">✗</span>' : '';
        box.title = MARK_TITLES[h.status] || '';
        return;
      }
      box.title = MARK_TITLES[h.status] || '';
      box.innerHTML =
        '<button class="ck-btn yes' + (h.status === 'feito' ? ' on' : '') + '" data-ck="feito" title="Fiz">✓</button>' +
        '<button class="ck-btn no' + (h.status === 'nao-feito' ? ' on' : '') + '" data-ck="nao-feito" title="Não fiz">✗</button>';
    });
  }

  $('#timeline').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ck]');
    if (!b) return;
    const li = b.closest('.tl-item');
    const h = App.hist && App.hist.itens.find((i) => i.key === li.dataset.key);
    if (!h) return;
    // Clicar de novo na marcação atual apaga a marcação.
    const status = h.status === b.dataset.ck ? null : b.dataset.ck;
    const r = await api.action('checkin:set', { dateKey: App.viewDate, id: h.id, status, origem: 'app' });
    if (!r.ok) return toast(r.error);
    await loadHist();
    paintMarks();
  });

  // ---------- linha do tempo ----------
  function renderDayPicker() {
    const sel = E.parseDateKey(App.viewDate);
    const start = E.weekStart(sel);
    const todayKey = App.status.dateKey;
    let html = '<button data-step="-1" title="Dia anterior">' + icon('chevronLeft', 16) + '</button>';
    for (let o = 0; o < 7; o++) {
      const d = E.addDays(start, o);
      const k = E.dateKey(d);
      html += '<button data-key="' + k + '" class="' + (k === App.viewDate ? 'sel ' : '') + (k === todayKey ? 'today' : '') + '" title="' + E.WEEKDAY_NAMES[d.getDay()] + ', ' + E.fmtLongDate(d) + '">' + E.WEEKDAY_SHORT[d.getDay()] + '</button>';
    }
    html += '<button data-step="1" title="Próximo dia">' + icon('chevronRight', 16) + '</button><span class="sep"></span><button data-today title="Voltar para hoje">Hoje</button>';
    $('#day-picker').innerHTML = html;
  }

  $('#day-picker').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.key) App.viewDate = b.dataset.key;
    else if (b.dataset.step) App.viewDate = E.dateKey(E.addDays(E.parseDateKey(App.viewDate), Number(b.dataset.step)));
    else if (b.hasAttribute('data-today')) App.viewDate = App.status.dateKey;
    loadDay();
  });

  window.__loadDay = () => loadDay();
  async function loadDay() {
    App.plan = await api.getDayPlan(App.viewDate);
    await loadHist();
    renderDayPicker();
    renderTimeline();
    paintMarks();
    if (App.status) renderMeta(App.status);
  }

  function renderTimeline() {
    const plan = App.plan;
    const d = E.parseDateKey(plan.dateKey);
    const isToday = plan.dateKey === App.status.dateKey;
    let tag = '';
    if (plan.off) tag = '<span class="tag">Dia livre' + (plan.exception && plan.exception.note ? ': ' + esc(plan.exception.note) : '') + '</span>';
    else if (plan.exception) tag = '<span class="tag">Exceção' + (plan.baseDay !== plan.weekday ? ' · rotina de ' + E.WEEKDAY_NAMES[plan.baseDay].toLowerCase() : '') + (plan.exception.note ? ': ' + esc(plan.exception.note) : '') + '</span>';
    $('#timeline-head').innerHTML =
      '<strong>' + E.WEEKDAY_NAMES[d.getDay()] + (isToday ? ' (hoje)' : '') + '</strong><span>' + E.fmtLongDate(d) + '</span>' + tag +
      '<span class="spacer"></span><span>' + plan.items.length + ' atividades</span>';

    if (!plan.items.length) {
      $('#timeline').innerHTML = '<li class="empty"><strong>Nenhuma atividade neste dia</strong>Adicione atividades em Configurações → Atividades.</li>';
      return;
    }
    const html = plan.items.map((it) => {
      const overlapped = plan.items.some((o) => o !== it && o.start < it.start && it.start < o.end);
      const highlight = it.priority > 0;
      const bellOff = !it.alertStart && !it.alertAdvance;
      return '<li class="tl-item' + (overlapped ? ' overlap' : '') + (highlight ? ' highlight' : '') + '" data-key="' + esc(it.key) + '">' +
        '<div class="tl-time">' + it.startLabel + '</div>' +
        '<div class="tl-bar" style="--c:' + it.color + '">' +
        '<span class="tl-icon">' + icon(it.icon, 22) + '</span>' +
        '<div class="tl-text"><strong>' + esc(it.title) + '</strong>' + (it.subtitle ? '<small>' + esc(it.subtitle) + '</small>' : '') + '</div>' +
        '<div class="tl-side">' +
        (highlight ? '<span class="tl-tag">COMPROMISSO</span>' : '') +
        (overlapped ? '<span class="tl-tag">SIMULTÂNEO</span>' : '') +
        '<span class="tl-tag" data-now hidden>AGORA</span>' +
        (it.track ? '<span class="ck"></span>' : '') +
        '<span class="tl-range">' + it.startLabel + '–' + it.endLabel + '</span>' +
        '<button class="tl-bell' + (bellOff ? ' off' : '') + '" data-bell="' + esc(it.id) + '" data-extra="' + (it.extra ? '1' : '') + '" title="' + (bellOff ? 'Alertas desativados — clique para ativar' : 'Clique para desativar os alertas desta atividade') + '">' + icon(bellOff ? 'bellOff' : 'bell', 16) + '</button>' +
        '</div>' +
        '<div class="tl-progress"><i></i></div>' +
        '</div></li>';
    }).join('');
    $('#timeline').innerHTML = html;
    updateTimelineStates(App.status, true);
  }

  let lastCurrentKey = null;
  function updateTimelineStates(s, force) {
    if (!App.plan) return;
    const activeKeys = new Set([s.primary, ...s.others].filter(Boolean).map((i) => i.key));
    const byKey = new Map(App.plan.items.map((i) => [i.key, i]));
    let currentEl = null;
    document.querySelectorAll('#timeline .tl-item').forEach((li) => {
      const it = byKey.get(li.dataset.key);
      if (!it) return;
      const isPrimary = s.primary && s.primary.key === it.key;
      const done = it.end <= s.now;
      li.classList.toggle('done', done);
      li.classList.toggle('current', !!isPrimary);
      const nowTag = li.querySelector('[data-now]');
      if (nowTag) nowTag.hidden = !activeKeys.has(it.key);
      if (isPrimary) {
        currentEl = li;
        li.querySelector('.tl-progress i').style.width = (s.progress * 100).toFixed(2) + '%';
      }
    });
    const key = s.primary ? s.primary.key : null;
    if (currentEl && (force || key !== lastCurrentKey)) {
      // rola só a lista (scrollIntoView rolaria também a página)
      const list = $('#timeline');
      list.scrollTo({ top: currentEl.offsetTop - list.clientHeight / 2 + currentEl.offsetHeight / 2, behavior: force ? 'auto' : 'smooth' });
    }
    lastCurrentKey = key;
  }

  $('#timeline').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bell]');
    if (!b) return;
    toggleActivityAlerts(b.dataset.bell, b.dataset.extra === '1' ? App.plan.dateKey : null);
  });

  function toggleActivityAlerts(id, extraDate) {
    commit((c) => {
      let a = c.activities.find((x) => x.id === id);
      if (extraDate) {
        const ex = c.exceptions.find((x) => x.date === extraDate);
        a = ex && ex.extra.find((x) => x.id === id);
      }
      if (!a) return;
      const on = !(a.alertStart || a.alertAdvance);
      a.alertStart = on;
      a.alertAdvance = on;
    }, { msg: 'Alertas da atividade atualizados' });
  }

  // ---------- semana ----------
  async function renderWeek() {
    if (!App.weekRef) App.weekRef = App.status.dateKey;
    const plans = await api.getWeek(App.weekRef);
    const first = E.parseDateKey(plans[0].dateKey);
    const last = E.parseDateKey(plans[6].dateKey);
    $('#week-nav').innerHTML =
      '<button data-w="-7">' + icon('chevronLeft', 14) + '</button>' +
      '<span>' + first.getDate() + '/' + E.pad(first.getMonth() + 1) + ' a ' + last.getDate() + '/' + E.pad(last.getMonth() + 1) + '</span>' +
      '<button data-w="7">' + icon('chevronRight', 14) + '</button><button data-w="0">Esta semana</button>';

    const todayKey = App.status.dateKey;
    $('#week-days').innerHTML = plans.map((p) => {
      const w = App.config.weekly[p.weekday];
      const compromissos = p.items.filter((i) => i.priority > 0);
      const casa = w.casa ? '<b>Casa:</b> ' + esc(w.casa) : '';
      const line = [casa, esc(w.nota)].filter(Boolean).join(' · ');
      let exc = '';
      if (p.off) exc = 'Dia livre' + (p.exception && p.exception.note ? ': ' + esc(p.exception.note) : '');
      else if (p.exception) exc = 'Exceção' + (p.exception.note ? ': ' + esc(p.exception.note) : '');
      return '<div class="wd' + (p.dateKey === todayKey ? ' today' : '') + '">' +
        '<div class="wd-badge" style="background:' + DAY_COLORS[p.weekday] + '"><div>' + E.WEEKDAY_SHORT[p.weekday] + '<small>' + E.parseDateKey(p.dateKey).getDate() + '/' + E.pad(E.parseDateKey(p.dateKey).getMonth() + 1) + '</small></div></div>' +
        '<div class="wd-body">' +
        (line ? '<div class="wd-line">' + line + '</div>' : '') +
        (exc ? '<div class="wd-exc">' + exc + '</div>' : '') +
        (compromissos.length ? '<div class="wd-chips">' + compromissos.map((c) => '<span class="chip" style="--c:' + c.color + '">' + icon(c.icon, 14) + esc(c.title) + ' ' + c.startLabel + '–' + c.endLabel + '</span>').join('') + '</div>' : '') +
        ([1, 2, 3, 4, 5].includes(p.weekday) ? '<label class="wd-project"><b>Projeto:</b><input data-project="' + p.weekday + '" value="' + esc(w.projeto) + '" placeholder="Qual projeto paralelo neste dia?"></label>' : '') +
        '</div></div>';
    }).join('');

    renderWeekGrid(plans);
  }

  $('#week-nav').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-w]');
    if (!b) return;
    const step = Number(b.dataset.w);
    App.weekRef = step === 0 ? App.status.dateKey : E.dateKey(E.addDays(E.parseDateKey(App.weekRef), step));
    renderWeek();
  });

  $('#week-days').addEventListener('change', (e) => {
    const input = e.target.closest('[data-project]');
    if (!input) return;
    const wd = Number(input.dataset.project);
    commit((c) => { c.weekly[wd].projeto = input.value.trim(); }, { msg: 'Projeto salvo' });
  });

  function renderWeekGrid(plans) {
    const PPM = 0.8; // pixels por minuto
    let minStart = 24 * 60;
    let maxEnd = 0;
    plans.forEach((p) => p.items.forEach((i) => {
      minStart = Math.min(minStart, i.startMin);
      maxEnd = Math.max(maxEnd, Math.min(i.endMin, 24 * 60));
    }));
    if (minStart > maxEnd) {
      minStart = 6 * 60;
      maxEnd = 23 * 60;
    }
    const startH = Math.floor(minStart / 60);
    const endH = Math.ceil(maxEnd / 60);
    const height = (endH - startH) * 60 * PPM;
    const todayKey = App.status.dateKey;
    const now = new Date(App.status.now);
    const nowMin = now.getHours() * 60 + now.getMinutes();

    let html = '<div></div>';
    plans.forEach((p) => {
      const d = E.parseDateKey(p.dateKey);
      html += '<div class="wg-head' + (p.dateKey === todayKey ? ' today' : '') + '">' + E.WEEKDAY_SHORT[p.weekday] + '<small>' + d.getDate() + '/' + E.pad(d.getMonth() + 1) + '</small></div>';
    });
    let hours = '';
    for (let h = startH; h <= endH; h++) hours += '<span style="top:' + (h - startH) * 60 * PPM + 'px">' + E.pad(h) + ':00</span>';
    html += '<div class="wg-hours" style="height:' + height + 'px">' + hours + '</div>';
    plans.forEach((p) => {
      let blocks = '';
      p.items.forEach((i) => {
        const top = Math.max(0, (i.startMin - startH * 60) * PPM);
        const bottom = Math.min(height, (Math.min(i.endMin, 1440) - startH * 60) * PPM);
        const h = Math.max(14, bottom - top - 1);
        const past = i.end <= App.status.now;
        blocks += '<div class="wg-block' + (i.priority > 0 ? ' hi' : '') + (past ? ' past' : '') + (h < 18 ? ' tiny' : '') + '" style="--c:' + i.color + ';top:' + top + 'px;height:' + h + 'px" title="' + esc(i.startLabel + '–' + i.endLabel + ' ' + i.title) + '">' +
          esc(i.title) + (h > 30 ? '<small>' + i.startLabel + '–' + i.endLabel + '</small>' : '') + '</div>';
      });
      if (p.dateKey === todayKey && nowMin >= startH * 60 && nowMin <= endH * 60) blocks += '<div class="wg-now" style="top:' + (nowMin - startH * 60) * PPM + 'px"></div>';
      html += '<div class="wg-col' + (p.dateKey === todayKey ? ' today' : '') + '" style="height:' + height + 'px;background-size:100% ' + 60 * PPM + 'px">' + blocks + '</div>';
    });
    $('#week-grid').innerHTML = html;
  }

  // ---------- regras e casa ----------
  function renderRules() {
    const c = App.config;
    const L = c.lists;
    const band = (ic, title) => '<div class="band"><span>' + icon(ic, 22) + '</span><h2>' + title + '</h2></div>';
    const checks = (arr) => '<ul>' + arr.map((x) => '<li><span class="check">' + icon('check', 13) + '</span><span>' + esc(x) + '</span></li>').join('') + '</ul>';
    const dots = (arr) => '<ul>' + arr.map((x) => '<li><span class="dot"></span><span>' + esc(x) + '</span></li>').join('') + '</ul>';
    const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const specific = [1, 2, 3, 4, 5, 6, 0].filter((d) => c.weekly[d].casa).map((d) => '<b>' + dayNames[d] + '</b>: ' + esc(c.weekly[d].casa));
    const remColors = [['#D8ECFB', '#2391EA', 'droplet'], ['#FBE0E6', '#E0405A', 'pause'], ['#FFF0C2', '#C98A00', 'dollar'], ['#D5F3EF', '#0FA597', 'users'], ['#EDE3FB', '#7C4DDB', 'heart']];
    const reminders = L.lembretes.map((x, i) => {
      const rc = remColors[i % remColors.length];
      return '<div class="reminder"><span class="r-ico" style="background:' + rc[0] + ';color:' + rc[1] + '">' + icon(rc[2], 26) + '</span>' + esc(x) + '</div>';
    }).join('');

    $('#rules-grid').innerHTML =
      '<section class="card">' + band('star', 'REGRAS DA ROTINA') + checks(L.regras) + '</section>' +
      '<section class="card">' + band('home', 'CASA') + '<div class="house"><div><h4>Todo dia</h4>' + dots(L.casaTodoDia) + '</div><div><h4>Dias específicos</h4><ul>' + specific.map((x) => '<li><span class="dot"></span><span>' + x + '</span></li>').join('') + '</ul></div></div></section>' +
      '<section class="card">' + band('moon', 'SONO') + dots(L.sono) + '</section>' +
      '<section class="card">' + band('calendar', 'PLANEJAMENTO DE DOMINGO (20 MIN)') + dots(L.planejamento) + '</section>' +
      '<section class="card span-2">' + band('lightbulb', 'NÃO ESQUECER') + '<div class="reminders">' + reminders + '</div></section>' +
      '<section class="card span-3" style="padding:14px 18px;display:flex;align-items:center;gap:16px;background:#EAF0F9">' +
      '<span style="color:var(--navy)">' + icon('target', 38) + '</span><div style="font-size:17px;color:var(--navy)"><b>META:</b> ' + esc(c.meta) + '</div><div style="flex:1"></div><div class="cheer">Vai dar certo!</div></section>';
  }

  // ---------- legenda ----------
  function renderLegend() {
    const used = new Set(App.config.activities.map((a) => a.category));
    $('#legend').innerHTML = App.config.categories.filter((c) => used.has(c.id)).map((c) => '<span><i style="background:' + c.color + '"></i>' + esc(c.name) + '</span>').join('');
  }

  // ---------- ciclo ----------
  function onStatus(s) {
    App.status = s;
    renderTopActions(s);
    renderBanner(s.alert);
    if (App.lastDateKey && App.lastDateKey !== s.dateKey) {
      // virou o dia: acompanha o novo dia se estava vendo "hoje"
      if (App.viewDate === App.lastDateKey) App.viewDate = s.dateKey;
      loadDay();
      if (App.view === 'semana') renderWeek();
    }
    App.lastDateKey = s.dateKey;
    if (App.view === 'hoje') {
      renderClock(s);
      renderNow(s);
      renderNext(s);
      renderMeta(s);
      updateTimelineStates(s, false);
    }
  }

  async function afterConfigChange(rerenderSettings) {
    renderLegend();
    nowSig = '';
    nextSig = '';
    await loadDay();
    if (App.view === 'semana') renderWeek();
    if (App.view === 'regras') renderRules();
    if (App.view === 'config' && rerenderSettings) App.renderSettings();
    App.status = await api.getStatus();
    onStatus(App.status);
  }

  async function init() {
    hydrateIcons(document);
    App.config = await api.getConfig();
    App.status = await api.getStatus();
    App.viewDate = App.status.dateKey;
    App.lastDateKey = App.status.dateKey;
    renderLegend();
    await loadDay();
    onStatus(App.status);
    api.on('status', onStatus);
    api.on('config', (c) => {
      if (App.saving) return;
      App.config = c;
      const editing = App.view === 'config' && document.activeElement && document.activeElement.closest('#config-panel, #modal-root');
      afterConfigChange(!editing);
    });
    api.on('alert', (a) => renderBanner(a));
    api.on('alert:dismiss', () => renderBanner(null));
    api.on('history', async () => {
      await loadHist();
      paintMarks();
      if (App.view === 'relatorios') App.renderReport();
    });
    api.on('navigate', (v) => showView(v));
    const hash = location.hash.replace('#', '');
    if (hash) showView(hash);
  }

  init();
})();
