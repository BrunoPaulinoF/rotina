/* Configurações: tudo é salvo automaticamente no arquivo local ao alterar. */
(function () {
  'use strict';

  const api = window.rotina;
  const E = window.RotinaEngine;
  const { icon, esc } = window.UI;
  const App = window.App;
  const panelEl = document.getElementById('config-panel');

  const SOUNDS = [
    ['sino', 'Sino suave'], ['gota', 'Gota'], ['duplo', 'Dois toques'], ['marimba', 'Marimba'],
    ['harpa', 'Harpa'], ['digital', 'Digital discreto'], ['custom', 'Arquivo personalizado'], ['none', 'Sem som']
  ];
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

  let panel = 'atividades';
  let dayFilter = 'all';

  const sw = (attr, checked) => '<label class="switch"><input type="checkbox" ' + attr + (checked ? ' checked' : '') + '><i></i></label>';
  const row = (title, desc, controls) => '<div class="row-setting"><div class="rs-text"><strong>' + title + '</strong>' + (desc ? '<small>' + desc + '</small>' : '') + '</div><div class="controls">' + controls + '</div></div>';
  const head = (title, desc, extra) => '<div class="panel-head"><div class="grow"><h2>' + title + '</h2>' + (desc ? '<p>' + desc + '</p>' : '') + '</div>' + (extra || '') + '</div>';
  const endLabel = (a) => E.fmtHM(E.parseHM(a.start) + Number(a.duration));
  const catOf = (id) => App.config.categories.find((c) => c.id === id) || { name: '—', color: '#7E93A8', icon: 'dot' };
  const newId = (p) => (p || 'a') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  panelEl.addEventListener('change', (e) => onAlertChange(e));

  document.getElementById('config-nav').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-panel]');
    if (b) showSettings(b.dataset.panel);
  });

  function showSettings(name) {
    panel = name;
    document.querySelectorAll('#config-nav button').forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
    render();
  }
  window.__showSettings = (name) => {
    App.showView('config');
    showSettings(name);
  };

  function render() {
    const fn = { atividades: renderActivities, categorias: renderCategories, alertas: renderAlerts, semana: renderWeekly, excecoes: renderExceptions, listas: renderLists, agentes: renderAgents, geral: renderGeneral }[panel];
    fn();
    App.hydrateIcons(panelEl);
  }
  App.renderSettings = render;

  // =============== ATIVIDADES ===============
  function renderActivities() {
    const c = App.config;
    const list = c.activities
      .filter((a) => dayFilter === 'all' || a.days.includes(Number(dayFilter)))
      .slice()
      .sort((a, b) => E.parseHM(a.start) - E.parseHM(b.start) || a.title.localeCompare(b.title));
    const filter = '<div class="filter" id="day-filter"><button data-d="all" class="' + (dayFilter === 'all' ? 'active' : '') + '">Todas</button>' +
      DAY_ORDER.map((d) => '<button data-d="' + d + '" class="' + (String(d) === String(dayFilter) ? 'active' : '') + '">' + E.WEEKDAY_SHORT[d] + '</button>').join('') + '</div>';

    panelEl.innerHTML =
      head('Atividades', 'Horários, duração, dias, categoria e alertas. Clique em uma linha para editar.', '<button class="btn primary" id="add-act">' + icon('plus', 16) + 'Nova atividade</button>') +
      '<div class="panel-body">' + filter +
      '<table class="act-table"><tbody>' +
      list.map((a) => {
        const cat = catOf(a.category);
        return '<tr data-id="' + esc(a.id) + '" class="' + (a.enabled ? '' : 'disabled') + '">' +
          '<td style="width:50px"><div class="act-ico" style="background:' + cat.color + '">' + icon(a.icon, 18) + '</div></td>' +
          '<td class="act-time" style="width:120px">' + a.start + ' – ' + endLabel(a) + '<br><small style="font-family:var(--font);font-weight:500;color:var(--muted)">' + a.duration + ' min</small></td>' +
          '<td class="act-title"><strong>' + esc(a.title) + (a.priority > 0 ? ' <span class="chip" style="--c:' + cat.color + '">' + icon('star', 12) + 'prioridade</span>' : '') + '</strong><small>' + esc(cat.name) + (a.subtitle ? ' · ' + esc(a.subtitle) : '') + '</small></td>' +
          '<td style="width:200px"><div class="days">' + DAY_ORDER.map((d) => '<i class="' + (a.days.includes(d) ? 'on' : '') + '">' + E.WEEKDAY_SHORT[d].slice(0, 3) + '</i>').join('') + '</div></td>' +
          '<td style="width:150px"><div class="bell-toggles">' +
          '<button class="mini-toggle ' + (a.alertStart ? 'on' : '') + '" data-toggle="alertStart" title="Alerta no início">' + icon(a.alertStart ? 'bell' : 'bellOff', 13) + 'Início</button>' +
          '<button class="mini-toggle ' + (a.alertAdvance ? 'on' : '') + '" data-toggle="alertAdvance" title="Aviso antecipado">' + icon('clock', 13) + 'Antes</button>' +
          '</div></td></tr>';
      }).join('') +
      '</tbody></table>' +
      (list.length ? '' : '<div class="empty"><strong>Nenhuma atividade</strong>Use "Nova atividade" para cadastrar.</div>') +
      '</div>';

    panelEl.querySelector('#add-act').onclick = () => openActivityEditor(null, {});
    panelEl.querySelector('#day-filter').onclick = (e) => {
      const b = e.target.closest('button[data-d]');
      if (!b) return;
      dayFilter = b.dataset.d;
      render();
    };
    panelEl.querySelector('tbody').onclick = (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const t = e.target.closest('[data-toggle]');
      if (t) {
        const field = t.dataset.toggle;
        App.commit((c) => {
          const a = c.activities.find((x) => x.id === tr.dataset.id);
          a[field] = !a[field];
        }, { rerender: true });
        return;
      }
      openActivityEditor(App.config.activities.find((a) => a.id === tr.dataset.id), {});
    };
  }

  /** Editor de atividade. opts.extraDate: edita uma atividade extra de uma exceção (sem dias da semana). */
  function openActivityEditor(activity, opts) {
    const isExtra = !!opts.extraDate;
    const a = activity
      ? JSON.parse(JSON.stringify(activity))
      : { id: '', title: '', subtitle: '', start: '09:00', duration: 30, days: isExtra ? [] : [1, 2, 3, 4, 5], category: 'basico', icon: 'dot', priority: 0, alertStart: true, alertAdvance: true, enabled: true };
    const cats = App.config.categories;

    const m = App.openModal(
      head(activity ? 'Editar atividade' : (isExtra ? 'Atividade extra' : 'Nova atividade'), isExtra ? 'Vale só para ' + E.fmtLongDate(E.parseDateKey(opts.extraDate)) : '', '<button class="icon-btn" data-close>' + icon('x', 18) + '</button>') +
      '<div class="panel-body"><div class="form-grid">' +
      '<label class="field full"><span>Título</span><input type="text" name="title" maxlength="120" value="' + esc(a.title) + '" placeholder="Ex.: Foco 1: programação"></label>' +
      '<label class="field full"><span>Descrição (opcional)</span><input type="text" name="subtitle" maxlength="240" value="' + esc(a.subtitle) + '" placeholder="Detalhe exibido abaixo do título"><small>Use {casa}, {projeto} ou {nota} para inserir o que está em "Tarefas da semana" para o dia.</small></label>' +
      '<label class="field"><span>Início</span><input type="time" name="start" value="' + esc(a.start) + '"></label>' +
      '<label class="field"><span>Duração (minutos)</span><input type="number" name="duration" min="1" max="1440" value="' + a.duration + '"><small data-end></small></label>' +
      (isExtra ? '' : '<div class="field full"><span>Dias da semana</span><div class="day-checks">' + DAY_ORDER.map((d) => '<label><input type="checkbox" name="day" value="' + d + '"' + (a.days.includes(d) ? ' checked' : '') + '><span>' + E.WEEKDAY_SHORT[d] + '</span></label>').join('') + '</div></div>') +
      '<label class="field"><span>Categoria (define a cor)</span><select name="category">' + cats.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === a.category ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Prioridade quando houver sobreposição</span><select name="priority"><option value="0"' + (a.priority > 0 ? '' : ' selected') + '>Normal</option><option value="10"' + (a.priority > 0 ? ' selected' : '') + '>Compromisso (prevalece sobre as demais)</option></select></label>' +
      '<div class="field full"><span>Ícone</span><div class="icon-grid">' + UI.ICONS.map((n) => '<button type="button" data-icon-pick="' + n + '" class="' + (n === a.icon ? 'sel' : '') + '" title="' + esc(UI.ICON_LABELS[n]) + '">' + icon(n, 20) + '</button>').join('') + '</div></div>' +
      '<div class="field full">' +
      row('Alerta no início', 'Som e notificação quando a atividade começar.', sw('name="alertStart"', a.alertStart)) +
      row('Aviso antecipado', 'Usa os minutos configurados em "Alertas e sons".', sw('name="alertAdvance"', a.alertAdvance)) +
      (isExtra ? '' : row('Atividade ativa', 'Desative para tirar da rotina sem apagar.', sw('name="enabled"', a.enabled))) +
      '</div>' +
      '<div class="field full preview-bar"><span>Pré-visualização</span><div data-preview></div><small data-overlap></small></div>' +
      '<div class="form-error full" data-error></div>' +
      '</div></div>' +
      '<div class="modal-foot">' + (activity ? '<button class="btn danger" data-delete>' + icon('trash', 16) + 'Excluir</button>' : '') +
      (activity && !isExtra ? '<button class="btn" data-duplicate>' + icon('plus', 16) + 'Duplicar</button>' : '') +
      '<span class="grow"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" data-save>' + icon('check', 16) + 'Salvar</button></div>'
    );

    let chosenIcon = a.icon;
    const f = (n) => m.querySelector('[name="' + n + '"]');
    const read = () => ({
      id: a.id,
      title: f('title').value.trim(),
      subtitle: f('subtitle').value.trim(),
      start: f('start').value,
      duration: Math.round(Number(f('duration').value)),
      days: isExtra ? undefined : Array.from(m.querySelectorAll('[name="day"]:checked')).map((x) => Number(x.value)),
      category: f('category').value,
      icon: chosenIcon,
      priority: Number(f('priority').value),
      alertStart: f('alertStart').checked,
      alertAdvance: f('alertAdvance').checked,
      enabled: isExtra ? true : f('enabled').checked
    });

    const update = () => {
      const v = read();
      const s = E.parseHM(v.start);
      const cat = catOf(v.category);
      m.querySelector('[data-end]').textContent = s != null && v.duration > 0 ? 'Termina às ' + E.fmtHM(s + v.duration) + (s + v.duration > 1440 ? ' (dia seguinte)' : '') : '';
      m.querySelector('[data-preview]').innerHTML =
        '<div class="tl-item" style="grid-template-columns:70px 1fr"><div class="tl-time">' + esc(v.start || '--:--') + '</div><div class="tl-bar" style="--c:' + cat.color + '"><span class="tl-icon">' + icon(chosenIcon, 22) + '</span><div class="tl-text"><strong>' + esc(v.title || 'Título') + '</strong>' + (v.subtitle ? '<small>' + esc(v.subtitle) + '</small>' : '') + '</div></div></div>';
      // aviso de sobreposição
      const conflicts = [];
      if (s != null && v.duration > 0 && !isExtra) {
        App.config.activities.forEach((o) => {
          if (o.id === a.id || !o.enabled) return;
          const days = o.days.filter((d) => v.days.includes(d));
          if (!days.length) return;
          const os = E.parseHM(o.start);
          if (os < s + v.duration && s < os + o.duration) conflicts.push(o.title + ' (' + days.map((d) => E.WEEKDAY_SHORT[d]).join(', ') + ')');
        });
      }
      m.querySelector('[data-overlap]').textContent = conflicts.length ? 'Sobrepõe: ' + conflicts.join('; ') + '. Durante a sobreposição vale a de maior prioridade (ou a que começou por último).' : '';
    };
    m.addEventListener('input', update);
    m.addEventListener('change', update);
    m.querySelector('.icon-grid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-icon-pick]');
      if (!b) return;
      chosenIcon = b.dataset.iconPick;
      m.querySelectorAll('[data-icon-pick]').forEach((x) => x.classList.toggle('sel', x === b));
      update();
    });
    m.querySelectorAll('[data-close]').forEach((b) => (b.onclick = App.closeModal));
    update();
    setTimeout(() => f('title').focus(), 30);

    const save = (asCopy) => {
      const v = read();
      const err = !v.title ? 'Informe o título.' : E.parseHM(v.start) == null ? 'Horário de início inválido.' : !(v.duration >= 1 && v.duration <= 1440) ? 'A duração deve ser entre 1 e 1440 minutos.' : !isExtra && !v.days.length ? 'Escolha pelo menos um dia da semana.' : '';
      m.querySelector('[data-error]').textContent = err;
      if (err) return;
      if (!v.id || asCopy) v.id = newId(isExtra ? 'x' : 'a');
      if (asCopy) v.title += ' (cópia)';
      App.commit((c) => {
        let target;
        if (isExtra) target = c.exceptions.find((x) => x.date === opts.extraDate).extra;
        else target = c.activities;
        const i = target.findIndex((x) => x.id === v.id);
        if (isExtra) delete v.days;
        if (i >= 0) target[i] = Object.assign(target[i], v);
        else target.push(v);
      }, { rerender: true, msg: 'Atividade salva' });
      App.closeModal();
    };
    m.querySelector('[data-save]').onclick = () => save(false);
    const dup = m.querySelector('[data-duplicate]');
    if (dup) dup.onclick = () => save(true);
    const del = m.querySelector('[data-delete]');
    if (del) {
      del.onclick = () => {
        if (del.dataset.confirm !== '1') {
          del.dataset.confirm = '1';
          del.innerHTML = icon('trash', 16) + 'Confirmar exclusão';
          return;
        }
        App.commit((c) => {
          if (isExtra) {
            const ex = c.exceptions.find((x) => x.date === opts.extraDate);
            ex.extra = ex.extra.filter((x) => x.id !== a.id);
          } else {
            c.activities = c.activities.filter((x) => x.id !== a.id);
            c.exceptions.forEach((ex) => { ex.removedIds = ex.removedIds.filter((id) => id !== a.id); });
          }
        }, { rerender: true, msg: 'Atividade excluída' });
        App.closeModal();
      };
    }
  }
  window.__openActivity = (id) => {
    window.__showSettings('atividades');
    openActivityEditor(App.config.activities.find((a) => a.id === id), {});
  };

  // =============== CATEGORIAS ===============
  function renderCategories() {
    const c = App.config;
    const counts = {};
    c.activities.forEach((a) => { counts[a.category] = (counts[a.category] || 0) + 1; });
    panelEl.innerHTML =
      head('Categorias e cores', 'A cor da categoria é usada em todas as atividades dela.', '<button class="btn primary" id="add-cat">' + icon('plus', 16) + 'Nova categoria</button>') +
      '<div class="panel-body">' +
      c.categories.map((cat) =>
        '<div class="cat-row" data-id="' + esc(cat.id) + '">' +
        '<input type="color" data-f="color" value="' + cat.color + '" title="Cor">' +
        '<input class="input" type="text" data-f="name" value="' + esc(cat.name) + '" maxlength="60">' +
        '<select class="input" data-f="icon">' + UI.ICONS.map((n) => '<option value="' + n + '"' + (n === cat.icon ? ' selected' : '') + '>Ícone: ' + esc(UI.ICON_LABELS[n]) + '</option>').join('') + '</select>' +
        '<span class="count">' + (counts[cat.id] || 0) + ' atividade(s)</span>' +
        (cat.id === 'basico' ? '<span></span>' : '<button class="icon-btn" data-del title="Excluir categoria">' + icon('trash', 16) + '</button>') +
        '</div>'
      ).join('') +
      '<p class="info-box" style="margin-top:16px">Ao excluir uma categoria, as atividades dela passam para "Básico do dia".</p></div>';

    panelEl.querySelector('#add-cat').onclick = () => App.commit((cfg) => {
      cfg.categories.push({ id: newId('cat'), name: 'Nova categoria', color: '#5B8DEF', icon: 'dot' });
    }, { rerender: true, msg: 'Categoria criada' });
    panelEl.querySelectorAll('.cat-row').forEach((r) => {
      const id = r.dataset.id;
      r.addEventListener('change', (e) => {
        const field = e.target.dataset.f;
        if (!field) return;
        const value = e.target.value;
        App.commit((cfg) => { cfg.categories.find((x) => x.id === id)[field] = field === 'name' ? value.trim() || 'Categoria' : value; });
      });
      const del = r.querySelector('[data-del]');
      if (del) del.onclick = () => {
        if (counts[id] && !confirm('Esta categoria tem ' + counts[id] + ' atividade(s). Elas passarão para "Básico do dia". Continuar?')) return;
        App.commit((cfg) => {
          cfg.categories = cfg.categories.filter((x) => x.id !== id);
          cfg.activities.forEach((a) => { if (a.category === id) a.category = 'basico'; });
        }, { rerender: true, msg: 'Categoria excluída' });
      };
    });
  }

  // =============== ALERTAS ===============
  function renderAlerts() {
    const a = App.config.settings.alerts;
    const s = App.status;
    const muted = s.muteUntil > s.now;
    const soundSelect = (name, value) => '<select data-a="' + name + '">' + SOUNDS.map(([v, l]) => '<option value="' + v + '"' + (v === value ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
      '<button class="icon-btn" data-test="' + name + '" title="Ouvir">' + icon('play', 16) + '</button>';
    const customName = a.customSound ? a.customSound.split(/[\\/]/).pop() : 'nenhum arquivo escolhido';

    panelEl.innerHTML =
      head('Alertas e sons', 'Os alertas funcionam com a janela minimizada ou fechada na bandeja.', '<button class="btn" id="test-alert">' + icon('bell', 16) + 'Testar alerta agora</button>') +
      '<div class="panel-body">' +
      '<div class="section-title">Geral</div>' +
      row('Alertas ativados', 'Desligue para não receber nenhum alerta (a rotina continua sendo exibida).', sw('data-a="enabled"', a.enabled)) +
      row('Rotina pausada', 'Pausa os alertas até você retomar. Também disponível no ícone da bandeja.', sw('data-action="pause"', s.paused)) +
      row('Silenciar temporariamente', muted ? 'Som silenciado até ' + UI.timeLabel(s.muteUntil) + '. Os avisos visuais continuam.' : 'Mantém os avisos visuais, sem som.',
        muted ? '<button class="btn" data-unmute>' + icon('volume', 16) + 'Reativar som</button>'
          : [15, 30, 60, 120].map((m) => '<button class="btn small" data-mute="' + m + '">' + (m < 60 ? m + ' min' : m / 60 + ' h') + '</button>').join('') + '<button class="btn small" data-mute="tomorrow">Até amanhã</button>') +

      '<div class="section-title">Sons</div>' +
      row('Som no início da atividade', '', soundSelect('soundStart', a.soundStart)) +
      row('Som do aviso antecipado', '', soundSelect('soundAdvance', a.soundAdvance)) +
      row('Arquivo personalizado', esc(customName) + ' (WAV, MP3 ou OGG — escolha "Arquivo personalizado" acima para usar)', '<button class="btn" id="choose-sound">' + icon('folder', 16) + 'Escolher arquivo</button>') +
      row('Volume', Math.round(a.volume * 100) + '%', '<input type="range" min="0" max="100" step="5" value="' + Math.round(a.volume * 100) + '" data-a="volume"><button class="icon-btn" data-test="soundStart" title="Ouvir">' + icon('volume', 16) + '</button>') +

      '<div class="section-title">Aviso antecipado</div>' +
      row('Avisar antes de cada atividade', 'Pode ser desativado por atividade em "Atividades".', sw('data-a="advanceEnabled"', a.advanceEnabled)) +
      row('Minutos de antecedência', '', '<input type="number" min="1" max="120" value="' + a.advanceMinutes + '" data-a="advanceMinutes"> min') +

      '<div class="section-title">Avisos visuais</div>' +
      row('Notificação do Windows', 'Aparece na central de notificações.', sw('data-a="windowsNotification"', a.windowsNotification)) +
      row('Cartão de alerta com botão "Adiar"', 'Pequeno cartão no canto inferior direito, sem roubar o foco. A janela flutuante também pisca.', sw('data-a="popup"', a.popup)) +
      row('Tempo do cartão na tela', '', '<input type="number" min="5" max="300" value="' + a.popupSeconds + '" data-a="popupSeconds"> s') +
      row('Adiar alerta por', 'Usado nos botões "Adiar".', '<input type="number" min="1" max="120" value="' + a.snoozeMinutes + '" data-a="snoozeMinutes"> min') +
      (s.snoozes.length ? '<div class="info-box">Alertas adiados: ' + s.snoozes.map((x) => esc(x.title) + ' às ' + UI.timeLabel(x.at)).join(' · ') + '</div>' : '') +
      '</div>';

    panelEl.querySelectorAll('[data-test]').forEach((b) => (b.onclick = () => {
      const name = panelEl.querySelector('select[data-a="' + b.dataset.test + '"]').value;
      api.action('testSound', { name });
    }));
    panelEl.querySelectorAll('[data-mute]').forEach((b) => (b.onclick = () => {
      const v = b.dataset.mute;
      api.action('mute', { minutes: v === 'tomorrow' ? 'tomorrow' : Number(v) }).then(refreshSoon);
    }));
    const un = panelEl.querySelector('[data-unmute]');
    if (un) un.onclick = () => api.action('unmute').then(refreshSoon);
    panelEl.querySelector('#test-alert').onclick = () => api.action('testAlert');
    panelEl.querySelector('#choose-sound').onclick = async () => {
      const file = await api.action('chooseSound');
      if (!file) return;
      App.commit((c) => {
        c.settings.alerts.customSound = file;
        c.settings.alerts.soundStart = 'custom';
      }, { rerender: true, msg: 'Som personalizado definido' });
    };
  }

  function refreshSoon() {
    setTimeout(async () => {
      App.status = await api.getStatus();
      if (panel === 'alertas') render();
    }, 150);
  }

  function onAlertChange(e) {
    if (panel !== 'alertas') return;
    const t = e.target;
    if (t.dataset.action === 'pause') {
      api.action(t.checked ? 'pause' : 'resume').then(refreshSoon);
      return;
    }
    const key = t.dataset.a;
    if (!key) return;
    let value = t.type === 'checkbox' ? t.checked : t.value;
    if (key === 'volume') value = Number(value) / 100;
    if (['advanceMinutes', 'popupSeconds', 'snoozeMinutes'].includes(key)) value = Number(value);
    App.commit((c) => { c.settings.alerts[key] = value; }, { rerender: key === 'volume' || t.type === 'checkbox' }).then(() => {
      if (key === 'volume') api.action('testSound', { name: App.config.settings.alerts.soundStart });
    });
  }

  // =============== TAREFAS DA SEMANA ===============
  function renderWeekly() {
    const w = App.config.weekly;
    panelEl.innerHTML =
      head('Tarefas da semana', 'Tarefa doméstica, observação e projeto de cada dia (aparecem no painel "Semana" e nas atividades com {casa}/{projeto}).') +
      '<div class="panel-body"><div class="week-edit">' +
      '<span></span><span class="h">Casa</span><span class="h">Observação</span><span class="h">Projeto</span>' +
      DAY_ORDER.map((d) =>
        '<b style="color:var(--navy)">' + E.WEEKDAY_SHORT[d] + '</b>' +
        ['casa', 'nota', 'projeto'].map((k) => '<input class="input" data-day="' + d + '" data-k="' + k + '" value="' + esc(w[d][k]) + '" maxlength="160">').join('')
      ).join('') +
      '</div><p class="info-box" style="margin-top:16px">Compromissos como igreja e futebol são atividades com prioridade "Compromisso" — edite-os em "Atividades".</p></div>';
    panelEl.querySelector('.week-edit').addEventListener('change', (e) => {
      const t = e.target;
      if (!t.dataset.k) return;
      App.commit((c) => { c.weekly[Number(t.dataset.day)][t.dataset.k] = t.value.trim(); });
    });
  }

  // =============== EXCEÇÕES ===============
  function renderExceptions() {
    const c = App.config;
    const todayKey = App.status.dateKey;
    const tomorrow = E.dateKey(E.addDays(E.parseDateKey(todayKey), 1));
    const typeOf = (ex) => (ex.off ? 'livre' : ex.baseDay != null ? 'outro' : 'ajustar');

    const cards = c.exceptions.map((ex) => {
      const d = E.parseDateKey(ex.date);
      const type = typeOf(ex);
      const base = ex.baseDay != null ? ex.baseDay : d.getDay();
      const baseActs = c.activities.filter((a) => a.enabled && a.days.includes(base)).sort((x, y) => E.parseHM(x.start) - E.parseHM(y.start));
      return '<div class="exc-card" data-date="' + ex.date + '">' +
        '<div class="exc-head"><span>' + icon('calendar', 20) + '</span><strong>' + E.WEEKDAY_NAMES[d.getDay()] + ', ' + E.fmtLongDate(d) + '</strong>' + (ex.date < todayKey ? '<span class="chip" style="--c:#7E93A8">passada</span>' : '') +
        '<span class="grow"></span>' +
        '<select class="input" data-f="type"><option value="ajustar"' + (type === 'ajustar' ? ' selected' : '') + '>Ajustar este dia</option><option value="outro"' + (type === 'outro' ? ' selected' : '') + '>Usar rotina de outro dia</option><option value="livre"' + (type === 'livre' ? ' selected' : '') + '>Dia livre (sem rotina)</option></select>' +
        (type === 'outro' ? '<select class="input" data-f="baseDay">' + DAY_ORDER.map((x) => '<option value="' + x + '"' + (x === ex.baseDay ? ' selected' : '') + '>Rotina de ' + E.WEEKDAY_NAMES[x].toLowerCase() + '</option>').join('') + '</select>' : '') +
        '<button class="icon-btn" data-del title="Excluir exceção">' + icon('trash', 16) + '</button></div>' +
        '<label class="field" style="margin-top:10px"><span>Observação</span><input type="text" data-f="note" value="' + esc(ex.note) + '" maxlength="160" placeholder="Ex.: Feriado, consulta médica, viagem"></label>' +
        (type === 'livre' ? '<div class="exc-body"><div class="info-box">Neste dia nenhuma atividade da rotina é exibida e nenhum alerta é disparado, exceto as atividades extras abaixo.</div><div>' + extrasHtml(ex) + '</div></div>'
          : '<div class="exc-body"><div><div class="section-title" style="margin-top:0">Atividades do dia (desmarque para remover)</div><div class="check-list">' +
          baseActs.map((a) => '<label><input type="checkbox" data-keep="' + esc(a.id) + '"' + (ex.removedIds.includes(a.id) ? '' : ' checked') + '> <b>' + a.start + '</b> ' + esc(a.title) + '</label>').join('') +
          '</div></div><div>' + extrasHtml(ex) + '</div></div>') +
        '</div>';
    }).join('');

    panelEl.innerHTML =
      head('Exceções de datas', 'Feriados, folgas, viagens ou compromissos em um dia específico, sem mudar a rotina da semana.') +
      '<div class="panel-body">' +
      '<div class="form-grid" style="grid-template-columns:180px 1fr 1fr auto;align-items:end;margin-bottom:18px">' +
      '<label class="field"><span>Data</span><input type="date" id="exc-date" value="' + tomorrow + '"></label>' +
      '<label class="field"><span>Tipo</span><select id="exc-type"><option value="ajustar">Ajustar este dia</option><option value="outro">Usar rotina de outro dia</option><option value="livre">Dia livre (sem rotina)</option></select></label>' +
      '<label class="field"><span>Observação</span><input type="text" id="exc-note" placeholder="Ex.: Feriado" maxlength="160"></label>' +
      '<button class="btn primary" id="exc-add" style="height:38px">' + icon('plus', 16) + 'Criar exceção</button></div>' +
      (cards || '<div class="empty"><strong>Nenhuma exceção cadastrada</strong>Crie uma acima para um dia específico.</div>') +
      '</div>';

    panelEl.querySelector('#exc-add').onclick = () => {
      const date = panelEl.querySelector('#exc-date').value;
      const type = panelEl.querySelector('#exc-type').value;
      const note = panelEl.querySelector('#exc-note').value.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return App.toast('Escolha uma data');
      if (App.config.exceptions.some((x) => x.date === date)) return App.toast('Já existe exceção para esta data');
      App.commit((cfg) => {
        cfg.exceptions.push({ date, note, off: type === 'livre', baseDay: type === 'outro' ? 0 : null, removedIds: [], extra: [] });
      }, { rerender: true, msg: 'Exceção criada' });
    };

    panelEl.querySelectorAll('.exc-card').forEach((card) => {
      const date = card.dataset.date;
      const mutate = (fn, rerender) => App.commit((cfg) => fn(cfg.exceptions.find((x) => x.date === date)), { rerender });
      card.addEventListener('change', (e) => {
        const t = e.target;
        if (t.dataset.f === 'type') {
          mutate((ex) => {
            ex.off = t.value === 'livre';
            ex.baseDay = t.value === 'outro' ? (ex.baseDay != null ? ex.baseDay : 0) : null;
          }, true);
        } else if (t.dataset.f === 'baseDay') {
          mutate((ex) => { ex.baseDay = Number(t.value); ex.removedIds = []; }, true);
        } else if (t.dataset.f === 'note') {
          mutate((ex) => { ex.note = t.value.trim(); }, false);
        } else if (t.dataset.keep) {
          mutate((ex) => {
            ex.removedIds = ex.removedIds.filter((id) => id !== t.dataset.keep);
            if (!t.checked) ex.removedIds.push(t.dataset.keep);
          }, false);
        }
      });
      card.querySelector('[data-del]').onclick = () => {
        if (!confirm('Excluir a exceção de ' + E.fmtLongDate(E.parseDateKey(date)) + '?')) return;
        App.commit((cfg) => { cfg.exceptions = cfg.exceptions.filter((x) => x.date !== date); }, { rerender: true, msg: 'Exceção excluída' });
      };
      card.querySelector('[data-add-extra]').onclick = () => openActivityEditor(null, { extraDate: date });
      card.querySelectorAll('[data-extra]').forEach((b) => (b.onclick = () => {
        const ex = App.config.exceptions.find((x) => x.date === date);
        openActivityEditor(ex.extra.find((x) => x.id === b.dataset.extra), { extraDate: date });
      }));
    });
  }

  function extrasHtml(ex) {
    return '<div class="section-title" style="margin-top:0">Atividades extras só neste dia</div>' +
      ex.extra.slice().sort((x, y) => E.parseHM(x.start) - E.parseHM(y.start)).map((a) => {
        const cat = catOf(a.category);
        return '<div class="extra-item"><div class="act-ico" style="background:' + cat.color + ';width:28px;height:28px">' + icon(a.icon, 15) + '</div><span class="grow"><b>' + a.start + '–' + endLabel(a) + '</b> ' + esc(a.title) + '</span><button class="btn small" data-extra="' + esc(a.id) + '">' + icon('edit', 14) + 'Editar</button></div>';
      }).join('') +
      '<button class="btn small" data-add-extra>' + icon('plus', 14) + 'Adicionar atividade extra</button>';
  }

  // =============== LISTAS ===============
  function renderLists() {
    const L = App.config.lists;
    const area = (k, title, hint) => '<label class="field"><span>' + title + '</span><textarea data-list="' + k + '">' + esc(L[k].join('\n')) + '</textarea><small>' + (hint || 'Um item por linha.') + '</small></label>';
    panelEl.innerHTML =
      head('Regras e listas', 'Conteúdo exibido na aba "Regras e casa". Um item por linha; salva ao sair do campo.') +
      '<div class="panel-body">' +
      '<label class="field" style="margin-bottom:16px"><span>Meta</span><input type="text" data-meta value="' + esc(App.config.meta) + '" maxlength="80"></label>' +
      '<div class="lists-grid">' +
      area('regras', 'Regras da rotina') +
      area('sono', 'Sono') +
      area('planejamento', 'Planejamento de domingo') +
      area('lembretes', 'Não esquecer', 'Um item por linha (os 5 primeiros ganham ícones coloridos).') +
      area('casaTodoDia', 'Casa — todo dia') +
      '</div></div>';
    panelEl.querySelectorAll('[data-list]').forEach((t) => t.addEventListener('change', () => {
      const items = t.value.split('\n').map((x) => x.trim()).filter(Boolean);
      App.commit((c) => { c.lists[t.dataset.list] = items; });
    }));
    panelEl.querySelector('[data-meta]').addEventListener('change', (e) => App.commit((c) => { c.meta = e.target.value.trim(); }));
  }

  // =============== AGENTES DE IA ===============
  async function renderAgents() {
    const info = await api.action('agent:info');
    if (panel !== 'agentes') return;
    const code = (id, text) => '<div class="code-box"><pre>' + esc(text) + '</pre><button class="btn small" data-copy="' + id + '">' + icon('list', 14) + 'Copiar</button></div>';
    const texts = {
      json: info.mcpJson,
      code: info.claudeCode,
      cli: info.cli,
      prompt: 'Minha rotina fica no app Rotina Desktop. Use as ferramentas do servidor MCP "rotina" (ou o guia em ' + info.guideFile + ') para consultar e alterar horários, atividades, exceções de datas e tarefas da semana. Antes de mudar, mostre o que vai alterar.'
    };
    const desktop = info.claudeDesktopConfigs.length
      ? row('Claude Desktop / Cowork', 'Adiciona o servidor "rotina" em: ' + info.claudeDesktopConfigs.map(esc).join(' e ') + '. Depois, feche e abra o Claude Desktop.', '<button class="btn primary" id="install-desktop">' + icon('plus', 16) + 'Conectar ao Claude</button>')
      : row('Claude Desktop / Cowork', 'Claude Desktop não encontrado neste computador. Use a configuração JSON abaixo no seu cliente.', '');

    panelEl.innerHTML =
      head('Agentes de IA', 'Deixe seu agente de IA (Claude Cowork, Claude Code, Cursor, ChatGPT com MCP…) consultar e alterar a rotina. As alterações aparecem aqui na hora.') +
      '<div class="panel-body">' +
      '<div class="section-title">Conexão rápida</div>' + desktop +
      '<div class="section-title">Outros clientes MCP (configuração JSON)</div>' + code('json', texts.json) +
      '<div class="section-title">Claude Code (terminal)</div>' + code('code', texts.code) +
      '<div class="section-title">Agentes que usam linha de comando</div>' + code('cli', texts.cli) +
      '<div class="section-title">Agentes que só editam arquivos</div>' +
      row('Guia para agentes', esc(info.guideFile) + ' — explica o formato do config.json. O app recarrega o arquivo ao salvar.', '<button class="btn" id="open-guide">' + icon('book', 16) + 'Abrir guia</button>') +
      '<div class="section-title">Sugestão de pedido para o agente</div>' + code('prompt', texts.prompt) +
      '<p class="info-box">Ferramentas disponíveis: ver_agora, ver_dia, ver_semana, listar_atividades, salvar_atividade, remover_atividade, listar_categorias, salvar_categoria, remover_categoria, definir_dia_semana, salvar_excecao, remover_excecao, editar_lista, alterar_configuracoes, ler_configuracao, substituir_configuracao e desfazer_ultima_alteracao. Toda alteração passa pela mesma validação do app e pode ser desfeita.</p>' +
      '</div>';
    App.hydrateIcons(panelEl);
    panelEl.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => api.action('copyText', { text: texts[b.dataset.copy] }).then(() => App.toast('Copiado'))));
    panelEl.querySelector('#open-guide').onclick = () => api.action('agent:openGuide');
    const inst = panelEl.querySelector('#install-desktop');
    if (inst) inst.onclick = async () => {
      const r = await api.action('agent:installClaudeDesktop');
      App.toast(r.ok ? 'Conectado! Reinicie o Claude Desktop.' : r.error);
    };
  }

  // =============== ATUALIZAÇÕES ===============
  function renderUpdateBox(s) {
    const box = document.getElementById('update-box');
    if (!box || !s) return;
    const when = s.checkedAt ? ' Última verificação: ' + new Date(s.checkedAt).toLocaleString('pt-BR').slice(0, 17) + '.' : '';
    const mb = s.size ? ' (' + Math.round(s.size / 1048576) + ' MB)' : '';
    let desc = 'Versão instalada: ' + esc(s.current) + '.' + when;
    let ctl = '<button class="btn" data-up="check">' + icon('rotate', 16) + 'Verificar atualizações</button>';
    if (s.status === 'checking') {
      desc = 'Procurando versão nova…';
      ctl = '<button class="btn" disabled>' + icon('clock', 16) + 'Verificando…</button>';
    } else if (s.status === 'none') {
      desc = esc(s.message || 'Você já está na versão mais recente.') + ' Versão instalada: ' + esc(s.current) + '.' + when;
    } else if (s.status === 'error') {
      desc = esc(s.error);
    } else if (s.status === 'available') {
      desc = '<b>Versão ' + esc(s.latest) + ' disponível' + mb + '.</b> Suas configurações e sua rotina são mantidas.' + (s.notes ? '<br>' + esc(s.notes).slice(0, 400).replace(/\n/g, '<br>') : '');
      ctl = '<button class="btn primary" data-up="download">' + icon('download', 16) + 'Baixar e atualizar</button>';
    } else if (s.status === 'downloading') {
      desc = 'Baixando versão ' + esc(s.latest) + '… ' + Math.round((s.progress || 0) * 100) + '%';
      ctl = '<button class="btn" disabled>' + icon('download', 16) + Math.round((s.progress || 0) * 100) + '%</button>';
    } else if (s.status === 'ready') {
      desc = 'Versão ' + esc(s.latest) + ' baixada e verificada. O app fecha, atualiza e abre de novo sozinho (leva alguns segundos).';
      ctl = '<button class="btn primary" data-up="install">' + icon('check', 16) + 'Reiniciar e atualizar</button>';
    }
    box.innerHTML = row('Rotina Desktop', desc, ctl);
    App.hydrateIcons(box);
    const b = box.querySelector('[data-up]');
    if (b) b.onclick = () => {
      const act = b.dataset.up;
      if (act === 'download') api.action('update:download').then((r) => { if (r.status === 'ready') api.action('update:install'); });
      else api.action('update:' + act);
    };
  }
  api.on('update', (s) => {
    if (panel === 'geral') renderUpdateBox(s);
  });

  // =============== GERAL ===============
  async function renderGeneral() {
    const g = App.config.settings.general;
    const f = App.config.settings.floating;
    const info = await api.info();
    panelEl.innerHTML =
      head('Geral e backup', 'Atualizações, inicialização, janela flutuante e dados locais.') +
      '<div class="panel-body">' +
      '<div class="section-title">Atualizações</div>' +
      '<div id="update-box"></div>' +
      row('Verificar automaticamente', 'Procura versões novas ao abrir e a cada 12 horas (só avisa; você decide quando instalar).', sw('data-g="autoUpdateCheck"', g.autoUpdateCheck)) +
      '<div class="section-title">Inicialização</div>' +
      row('Iniciar com o Windows', info.packaged ? 'Abre minimizado na bandeja ao ligar o computador.' : 'Disponível na versão instalada (em modo de desenvolvimento não é registrado).', sw('data-g="startWithWindows"', g.startWithWindows)) +
      row('Ao fechar a janela, continuar na bandeja', 'Os alertas continuam funcionando. Para encerrar, use "Sair" no ícone da bandeja.', sw('data-g="closeToTray"', g.closeToTray)) +
      '<div class="section-title">Janela flutuante</div>' +
      row('Mostrar janela flutuante', 'Pílula pequena com a atividade atual e o tempo restante. Duplo clique abre a janela principal.', sw('data-fl="enabled"', f.enabled)) +
      row('Fixar no topo central da tela', 'Desative para poder arrastar a pílula para onde quiser.', sw('data-fl="fixedTop"', f.fixedTop)) +
      row('Sempre visível (no topo)', 'Fica acima das outras janelas sem roubar o foco.', sw('data-fl="alwaysOnTop"', f.alwaysOnTop)) +
      row('Opacidade', Math.round(f.opacity * 100) + '%', '<input type="range" min="40" max="100" step="5" value="' + Math.round(f.opacity * 100) + '" data-fl="opacity">') +
      '<div class="section-title">Backup</div>' +
      row('Exportar rotina', 'Salva toda a rotina e configurações em um arquivo JSON.', '<button class="btn" data-act="exportConfig">' + icon('download', 16) + 'Exportar</button>') +
      row('Importar rotina', 'Substitui a rotina atual por um arquivo exportado.', '<button class="btn" data-act="importConfig">' + icon('upload', 16) + 'Importar</button>') +
      row('Restaurar rotina inicial', 'Volta aos horários e configurações originais.', '<button class="btn danger" data-act="resetDefaults">' + icon('rotate', 16) + 'Restaurar</button>') +
      '<div class="section-title">Sobre</div>' +
      row('Rotina Desktop ' + esc(info.version), 'Dados salvos em: ' + esc(info.dataDir) + ' (config.json, state.json e rotina.log)', '<button class="btn" data-act="openDataFolder">' + icon('folder', 16) + 'Abrir pasta</button>') +
      '</div>';
    App.hydrateIcons(panelEl);
    renderUpdateBox(await api.action('update:state'));
    panelEl.querySelectorAll('[data-g]').forEach((t) => t.addEventListener('change', () => App.commit((c) => { c.settings.general[t.dataset.g] = t.checked; })));
    panelEl.querySelectorAll('[data-fl]').forEach((t) => t.addEventListener('change', () => App.commit((c) => {
      c.settings.floating[t.dataset.fl] = t.type === 'range' ? Number(t.value) / 100 : t.checked;
    }, { rerender: t.type === 'range' })));
    panelEl.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
      const r = await api.action(b.dataset.act);
      if (r && b.dataset.act !== 'openDataFolder') {
        App.config = await api.getConfig();
        App.toast(b.dataset.act === 'exportConfig' ? 'Rotina exportada' : 'Rotina atualizada');
        render();
      }
    }));
  }
})();
