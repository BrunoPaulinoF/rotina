'use strict';
/**
 * Processo principal: ciclo de vida, janelas, bandeja, alertas e IPC.
 * O motor roda aqui (não nas janelas), então os alertas continuam com tudo minimizado ou fechado na bandeja.
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, screen, powerMonitor, dialog, shell, clipboard, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const engine = require('../shared/engine');
const { createDefaultConfig } = require('./defaults');
const { JsonStore, normalizeConfig, normalizeState } = require('./store');
const { AlertService } = require('./alerts');
const { Updater } = require('./updater');
const { detectConnections, buildAgentPrompt, buildAgentGuide } = require('./agent-setup');
const { startInbox } = require('./inbox');
const { startBridgeServer, registerAppPath } = require('../agent/bridge');
const { callTool } = require('../agent/tools');
const { History, periodRange } = require('./history');

const APP_ID = 'com.rotinadesktop.app';
const ROOT = path.join(__dirname, '..', '..');
const ASSETS = path.join(ROOT, 'assets');
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload.js');

const argValue = (prefix) => {
  const a = process.argv.find((x) => x.startsWith(prefix));
  return a ? a.slice(prefix.length) : null;
};

// Diretório de dados alternativo (testes) e relógio simulado (validar transições).
const dataDirArg = process.env.ROTINA_DATA_DIR || argValue('--data-dir=');
if (dataDirArg) {
  app.setPath('userData', path.resolve(dataDirArg));
  // As ferramentas de agente executadas aqui dentro também usam essa pasta.
  process.env.ROTINA_DATA_DIR = path.resolve(dataDirArg);
}
const fakeNow = process.env.ROTINA_FAKE_NOW || argValue('--fake-now=');
let clockOffset = 0;
if (fakeNow && !Number.isNaN(Date.parse(fakeNow))) clockOffset = Date.parse(fakeNow) - Date.now();
const now = () => Date.now() + clockOffset;

// Interface simples, atualizada 1x/s: renderização por software economiza ~100 MB do processo de GPU.
if (process.env.ROTINA_GPU !== '1') app.disableHardwareAcceleration();

const launchedHidden = process.argv.includes('--hidden');
const captureDir = argValue('--capture=');

let config;
let state;
let configStore;
let stateStore;
let alerts;
let tray = null;
let mainWindow = null;
let floatingWindow = null;
let popupWindow = null;
let audioWindow = null;
let audioReady = null;
let audioIdleTimer = null;
let popupTimer = null;
let tickTimer = null;
let quitting = false;
let activeAlert = null;
let lastTrayLabel = '';
let saveStateTimer = null;
const notifications = new Set();

// ---------- log ----------
function logFile() {
  return path.join(app.getPath('userData'), 'rotina.log');
}
function log(msg) {
  try {
    const f = logFile();
    if (fs.existsSync(f) && fs.statSync(f).size > 1024 * 1024) fs.renameSync(f, f + '.old');
    const d = new Date(now());
    fs.appendFileSync(f, engine.dateKey(d) + ' ' + d.toTimeString().slice(0, 8) + '  ' + msg + '\n');
  } catch (_) { /* log nunca derruba o app */ }
}

// ---------- persistência ----------
function loadData() {
  const dir = app.getPath('userData');
  configStore = new JsonStore(path.join(dir, 'config.json'));
  stateStore = new JsonStore(path.join(dir, 'state.json'));
  const rawConfig = configStore.load();
  config = normalizeConfig(rawConfig || createDefaultConfig());
  if (!rawConfig) configStore.save(config);
  state = normalizeState(stateStore.load());
  history = new History(dir);
  // Pausa que continuava ao fechar o app: mantém registrada (atividades nela ficam fora da meta).
  if (state.paused && !history.data().pausas.some((p) => p.fim == null)) history.addPause(now());
}

// ---------- registro de ✓/✗ ----------
let history = null;
let snapshotKey = '';
let summaryCheckedAt = 0;
let summaryWindow = null;

/** Mantém a foto de hoje (atividades que contam na meta) em dia com a rotina. */
function ensureSnapshot(force) {
  const key = engine.dateKey(now()) + '|' + (force ? Date.now() : '');
  if (!force && snapshotKey.startsWith(engine.dateKey(now()) + '|')) return;
  try {
    history.snapshotDay(config, new Date(now()));
    snapshotKey = key;
  } catch (err) {
    log('Erro ao registrar o dia no histórico: ' + err.message);
  }
}

function checkinInfo(t) {
  const c = config.settings.checkin;
  const today = history.day(engine.dateKey(t), t);
  if (!c.enabled || !today) return { enabled: c.enabled, goal: c.goal, today, prompt: null, pending: 0 };
  // Pílula: atividade nos últimos minutos ou que acabou há pouco, ainda sem resposta.
  const windowItems = history.prompts(today.dateKey, t, c.beforeMinutes * 60000).filter((i) => t - i.endMs <= c.afterMinutes * 60000);
  const prompt = state.paused ? null : windowItems[0] || null;
  return { enabled: true, goal: c.goal, today, prompt, pending: today.pendentes };
}

function setCheckin(dateKey, id, status, origem) {
  const item = history.setStatus(config, dateKey, id, status, origem, now());
  log('Registro: ' + item.title + ' (' + dateKey + ') = ' + (status || 'limpo') + ' [' + origem + ']');
  broadcast('history', { dateKey });
  pushStatus(true);
  if (summaryWindow && !summaryWindow.isDestroyed()) summaryWindow.webContents.send('summary:data', summaryData());
  return item;
}

function summaryData() {
  const t = now();
  const today = history.day(engine.dateKey(t), t);
  return { items: today ? today.itens.filter((i) => i.status === 'pendente') : [], today, goal: config.settings.checkin.goal };
}

/** Cartão com tudo que ficou sem resposta hoje (17:00 e 21:30, ou pela bandeja). */
function showSummary() {
  const data = summaryData();
  if (!data.items.length) {
    if (summaryWindow && !summaryWindow.isDestroyed()) summaryWindow.destroy();
    return false;
  }
  const height = Math.min(480, 160 + data.items.length * 52);
  const b = cornerBounds(420, height);
  if (summaryWindow && !summaryWindow.isDestroyed()) {
    summaryWindow.setBounds(b);
    summaryWindow.webContents.send('summary:data', data);
    summaryWindow.showInactive();
    return true;
  }
  summaryWindow = new BrowserWindow(Object.assign({}, b, {
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    backgroundColor: '#FFFFFF',
    webPreferences: webPrefs()
  }));
  summaryWindow.setAlwaysOnTop(true, 'pop-up-menu');
  summaryWindow.loadFile(path.join(RENDERER, 'summary.html'));
  summaryWindow.webContents.once('did-finish-load', () => {
    if (!summaryWindow || summaryWindow.isDestroyed()) return;
    summaryWindow.webContents.send('summary:data', data);
    summaryWindow.showInactive();
  });
  summaryWindow.on('closed', () => {
    summaryWindow = null;
  });
  return true;
}

/** Abre o resumo nos horários configurados (só quando o horário passa com o app aberto). */
function checkSummaryTimes() {
  const t = now();
  const c = config.settings.checkin;
  if (!summaryCheckedAt) summaryCheckedAt = t;
  if (c.enabled && !state.paused) {
    for (const hm of c.summaryTimes) {
      const at = engine.atMinutes(new Date(t), engine.parseHM(hm));
      if (at > summaryCheckedAt && at <= t && t - at < 60000 && showSummary()) log('Resumo do dia aberto (' + hm + ')');
    }
  }
  summaryCheckedAt = t;
}

function saveStateSoon() {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(saveStateNow, 400);
}
function saveStateNow() {
  clearTimeout(saveStateTimer);
  try {
    stateStore.save(state);
  } catch (err) {
    log('Erro ao salvar estado: ' + err.message);
  }
}

let lastConfigText = '';
let historyTimer = null;

function setConfig(next) {
  config = normalizeConfig(next);
  configStore.save(config);
  lastConfigText = JSON.stringify(config);
  if (history) ensureSnapshot(true);
  applySettings();
  broadcast('config', config);
  pushStatus(true);
  return config;
}

/**
 * Agentes de IA (MCP, linha de comando ou edição direta do config.json) alteram o arquivo
 * com o app aberto: observa a pasta e recarrega, validando como qualquer outra alteração.
 */
function watchConfigFile() {
  const dir = path.dirname(configStore.file);
  lastConfigText = JSON.stringify(config);
  let timer = null;
  const reload = () => {
    const raw = configStore.load();
    if (!raw) return;
    const text = JSON.stringify(normalizeConfig(raw));
    if (text === lastConfigText) return;
    log('Rotina alterada fora do app (agente ou edição do arquivo); recarregada.');
    setConfig(raw);
  };
  try {
    fs.watch(dir, (_event, name) => {
      if (name === 'historico.json') {
        // Marcação feita por um agente: atualiza as telas.
        clearTimeout(historyTimer);
        historyTimer = setTimeout(() => {
          broadcast('history', {});
          pushStatus(true);
        }, 300);
        return;
      }
      if (name && name !== 'config.json') return;
      clearTimeout(timer);
      timer = setTimeout(reload, 300);
    });
  } catch (err) {
    log('Não foi possível observar o config.json: ' + err.message);
  }
}

// ---------- atualizações ----------
let updater = null;
let updateNotifiedVersion = null;

function setupUpdater() {
  updater = new Updater({
    fetch: (url, opts) => net.fetch(url, opts),
    currentVersion: app.getVersion(),
    log,
    onState: (s) => {
      broadcast('update', s);
      rebuildTrayMenu();
      if (s.status === 'available' && s.latest !== updateNotifiedVersion && Notification.isSupported()) {
        updateNotifiedVersion = s.latest;
        const n = new Notification({ title: 'Rotina Desktop ' + s.latest + ' disponível', body: 'Clique para ver e atualizar. Suas configurações são mantidas.', icon: path.join(ASSETS, 'icon.png'), silent: true });
        notifications.add(n);
        n.on('click', () => showMain('config'));
        n.show();
      }
    }
  });
  const auto = () => {
    if (config.settings.general.autoUpdateCheck && app.isPackaged) updater.check();
  };
  setTimeout(auto, 30 * 1000);
  setInterval(auto, 12 * 60 * 60 * 1000);
}

// ---------- agentes de IA ----------
// Três caminhos, todos executados pelo app (que grava no arquivo real da rotina):
//  1. MCP: extensão .mcpb (Claude Desktop/Cowork) ou servidor stdio (Claude Code, Cursor...), via ponte.
//  2. Pasta de comunicação em Documentos (agentes que só manipulam arquivos, ex.: Cowork sem extensão).
//  3. Linha de comando.
let inbox = null;

function inboxDir() {
  return dataDirArg ? path.join(app.getPath('userData'), 'pasta-agentes') : path.join(app.getPath('documents'), 'Rotina Desktop');
}

function mcpbSource() {
  return app.isPackaged ? path.join(process.resourcesPath, 'RotinaDesktop.mcpb') : path.join(ROOT, 'build', 'RotinaDesktop.mcpb');
}

function agentInfo() {
  // O servidor stdio roda pelo próprio executável em modo Node (não exige Node instalado).
  const server = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'src', 'agent', 'server.js')
    : path.join(ROOT, 'src', 'agent', 'server.js');
  const command = process.execPath;
  const env = { ELECTRON_RUN_AS_NODE: '1' };
  if (dataDirArg) env.ROTINA_DATA_DIR = app.getPath('userData');
  const envFlags = Object.entries(env).map(([k, v]) => '-e ' + k + '=' + (v.includes(' ') ? '"' + v + '"' : v)).join(' ');
  const dir = inboxDir();
  const info = {
    command,
    server,
    env,
    dataDir: app.getPath('userData'),
    inboxDir: dir,
    guideFile: path.join(dir, 'LEIA-ME para agentes de IA.md'),
    mcpbFile: path.join(dir, 'RotinaDesktop.mcpb'),
    mcpJson: JSON.stringify({ mcpServers: { 'rotina-desktop': { command, args: [server], env } } }, null, 2),
    claudeCode: 'claude mcp add rotina-desktop --scope user ' + envFlags + ' -- "' + command + '" "' + server + '"',
    cli: '$env:ELECTRON_RUN_AS_NODE=1; & "' + command + '" "' + server + '" --cli ajuda'
  };
  info.prompt = buildAgentPrompt(info);
  return info;
}

function userDirs() {
  return { home: app.getPath('home'), appData: app.getPath('appData'), localAppData: process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local') };
}

/** Prepara a pasta de comunicação: guia, extensão e as subpastas de pedidos/respostas. */
function setupAgentAccess() {
  const info = agentInfo();
  try {
    fs.mkdirSync(info.inboxDir, { recursive: true });
    fs.writeFileSync(info.guideFile, buildAgentGuide(info), 'utf8');
    fs.writeFileSync(path.join(app.getPath('userData'), 'AGENTES.md'), buildAgentGuide(info), 'utf8');
    if (fs.existsSync(mcpbSource())) fs.copyFileSync(mcpbSource(), info.mcpbFile);
  } catch (err) {
    log('Não foi possível preparar a pasta para agentes: ' + err.message);
  }
  inbox = startInbox(info.inboxDir, (tool, args) => callTool(tool, args), log);
  startBridgeServer((tool, args) => callTool(tool, args), log, dataDirArg ? app.getPath('userData') : null);
  if (app.isPackaged) registerAppPath(process.execPath, log);
}

/** Mostra a extensão no Explorador para o usuário arrastar para o Claude (sem associação de arquivo no Windows). */
function revealExtension() {
  const info = agentInfo();
  if (!fs.existsSync(mcpbSource())) return { ok: false, error: 'Arquivo da extensão não encontrado nesta instalação.' };
  fs.mkdirSync(info.inboxDir, { recursive: true });
  fs.copyFileSync(mcpbSource(), info.mcpbFile);
  shell.showItemInFolder(info.mcpbFile);
  return { ok: true, file: info.mcpbFile };
}
// ---------- status ----------
function buildStatus() {
  const t = now();
  const s = engine.getStatus(config, t);
  const alertVisible = activeAlert && !activeAlert.dismissed && t - activeAlert.firedAt < 3 * 60000 ? activeAlert : null;
  return Object.assign(s, {
    paused: state.paused,
    muteUntil: state.muteUntil > t ? state.muteUntil : 0,
    alertsEnabled: config.settings.alerts.enabled,
    alert: alertVisible,
    canSnooze: !!(state.lastAlert && t - state.lastAlert.firedAt < 60 * 60000),
    snoozes: state.snoozes.map((x) => ({ at: x.at, title: x.alert.title })),
    floatingVisible: !!(floatingWindow && !floatingWindow.isDestroyed() && floatingWindow.isVisible()),
    simulated: clockOffset !== 0,
    checkin: checkinInfo(t)
  });
}

function windows() {
  return [mainWindow, floatingWindow, popupWindow].filter((w) => w && !w.isDestroyed());
}

function broadcast(channel, data) {
  for (const w of windows()) w.webContents.send(channel, data);
}

function pushStatus(force) {
  const live = windows().filter((w) => force || (w.isVisible() && !w.isMinimized()));
  const status = buildStatus();
  for (const w of live) w.webContents.send('status', status);
  fitFloating(!!status.checkin.prompt);
  updateTray(status);
}

function scheduleTick() {
  clearTimeout(tickTimer);
  const t = now();
  tickTimer = setTimeout(() => {
    try {
      alerts.tick();
      ensureSnapshot(false);
      checkSummaryTimes();
      pushStatus(false);
    } catch (err) {
      log('Erro no tick: ' + (err && err.stack ? err.stack : err));
    }
    scheduleTick();
  }, 1000 - (t % 1000) + 15);
}

// ---------- alertas ----------
function deliverAlert(alert) {
  activeAlert = Object.assign({}, alert, { dismissed: false });
  const a = config.settings.alerts;
  if (!alert.muted) playSound(alert.sound === 'advance' ? a.soundAdvance : a.soundStart);
  if (a.windowsNotification && Notification.isSupported()) {
    const n = new Notification({ title: alert.title, body: alert.body, icon: path.join(ASSETS, 'icon.png'), silent: true });
    notifications.add(n);
    n.on('click', () => showMain());
    n.on('close', () => notifications.delete(n));
    setTimeout(() => notifications.delete(n), 5 * 60000);
    n.show();
  }
  // A pílula é pequena demais para botões: o aviso com "Adiar" vai sempre no cartão.
  if (a.popup) showPopup(activeAlert);
  broadcast('alert', activeAlert);
  pushStatus(true);
}

function dismissAlert() {
  if (activeAlert) activeAlert.dismissed = true;
  closePopup();
  broadcast('alert:dismiss', null);
  pushStatus(true);
}

// ---------- som (janela oculta com Web Audio, criada sob demanda) ----------
function ensureAudioWindow() {
  if (audioWindow && !audioWindow.isDestroyed()) return audioReady;
  audioWindow = new BrowserWindow({
    show: false,
    width: 100,
    height: 100,
    skipTaskbar: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
  });
  audioReady = new Promise((resolve) => audioWindow.webContents.once('did-finish-load', resolve));
  audioWindow.loadFile(path.join(RENDERER, 'audio.html'));
  audioWindow.on('closed', () => {
    audioWindow = null;
  });
  return audioReady;
}

function playSound(name, volumeOverride) {
  if (!name || name === 'none') return;
  const a = config.settings.alerts;
  let file = null;
  if (name === 'custom') {
    if (!a.customSound || !fs.existsSync(a.customSound)) name = 'sino';
    else file = pathToFileURL(a.customSound).href;
  }
  const volume = volumeOverride != null ? volumeOverride : a.volume;
  ensureAudioWindow().then(() => {
    if (!audioWindow || audioWindow.isDestroyed()) return;
    audioWindow.webContents.send('audio:play', { name, volume, file });
    clearTimeout(audioIdleTimer);
    audioIdleTimer = setTimeout(() => {
      if (audioWindow && !audioWindow.isDestroyed()) audioWindow.destroy();
    }, file ? 90000 : 15000);
  });
}

// ---------- janelas ----------
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (...args) => {
    const ev = args[0];
    const level = ev && ev.level != null ? ev.level : args[1];
    const message = ev && ev.message != null ? ev.message : args[2];
    if (level === 'error' || level === 3) log('Erro na janela: ' + message);
  });
  wc.on('render-process-gone', (_ev, details) => log('Janela encerrada inesperadamente: ' + details.reason));
});

function webPrefs() {
  return { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false };
}

function boundsVisible(b) {
  if (!b) return false;
  return screen.getAllDisplays().some((d) => {
    const w = d.workArea;
    return b.x < w.x + w.width - 40 && b.x + b.width > w.x + 40 && b.y >= w.y - 10 && b.y < w.y + w.height - 40;
  });
}

function createMainWindow(view) {
  const b = boundsVisible(state.mainBounds) ? state.mainBounds : null;
  mainWindow = new BrowserWindow({
    width: b ? b.width : 1360,
    height: b ? b.height : 880,
    x: b ? b.x : undefined,
    y: b ? b.y : undefined,
    minWidth: 1040,
    minHeight: 660,
    show: false,
    title: 'Rotina Desktop',
    backgroundColor: '#F2F5FA',
    icon: path.join(ASSETS, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: webPrefs()
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(RENDERER, 'main.html'), view ? { hash: view } : undefined);
  mainWindow.once('ready-to-show', () => {
    if (state.mainMaximized) mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on('close', () => {
    if (!mainWindow.isMaximized() && !mainWindow.isMinimized()) state.mainBounds = mainWindow.getBounds();
    state.mainMaximized = mainWindow.isMaximized();
    saveStateNow();
    if (!quitting && config.settings.general.closeToTray && !state.trayHintShown) {
      state.trayHintShown = true;
      saveStateNow();
      if (tray) tray.displayBalloon({ title: 'Rotina Desktop continua ativo', content: 'Os alertas seguem funcionando. Abra pelo ícone perto do relógio.', iconType: 'info' });
    }
  });
  mainWindow.on('closed', () => {
    // A janela é destruída ao fechar para liberar memória; o motor continua no processo principal.
    mainWindow = null;
    if (!quitting && !config.settings.general.closeToTray) app.quit();
  });
  mainWindow.on('restore', () => pushStatus(true));
  mainWindow.on('show', () => pushStatus(true));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());
}

function showMain(view) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (view) mainWindow.webContents.send('navigate', view);
  } else {
    createMainWindow(view);
  }
}

// Pílula compacta, fixa em um dos 6 locais da tela, sempre acima das outras janelas.
const FLOAT_W = 300;
const FLOAT_W_CHECKIN = 470; // com a pergunta "fez?" e os botões ✓/✗
const FLOAT_H = 30;
let floatingTopTimer = null;
let floatingWide = false;

function floatingBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const pos = config.settings.floating.position;
  const w = floatingWide ? FLOAT_W_CHECKIN : FLOAT_W;
  const m = 8;
  const x = pos.endsWith('left') ? wa.x + m : pos.endsWith('right') ? wa.x + wa.width - w - m : Math.round(wa.x + (wa.width - w) / 2);
  const y = pos.startsWith('top') ? wa.y + 4 : wa.y + wa.height - FLOAT_H - 4;
  return { x, y, width: w, height: FLOAT_H };
}

/** Alarga a pílula enquanto há uma pergunta ✓/✗ e volta ao tamanho normal depois. */
function fitFloating(wide) {
  if (wide === floatingWide) return;
  floatingWide = wide;
  if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.setBounds(floatingBounds());
}

/** Canto inferior direito, acima da pílula quando ela também está lá. */
function cornerBounds(width, height) {
  const wa = screen.getPrimaryDisplay().workArea;
  const lift = config.settings.floating.enabled && config.settings.floating.position === 'bottom-right' ? FLOAT_H + 8 : 0;
  return { x: wa.x + wa.width - width - 16, y: wa.y + wa.height - height - 16 - lift, width, height };
}

function keepFloatingOnTop() {
  if (!floatingWindow || floatingWindow.isDestroyed()) return;
  // Nível acima das janelas comuns; reforçado periodicamente porque o Windows pode rebaixar
  // janelas "sempre no topo" quando outro app ativa a própria janela.
  floatingWindow.setAlwaysOnTop(true, 'screen-saver');
  floatingWindow.moveTop();
}

function createFloatingWindow() {
  const f = config.settings.floating;
  const b = floatingBounds();
  floatingWindow = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Não recebe foco: clicar nos botões não tira o foco do que você está usando.
    focusable: false,
    alwaysOnTop: true,
    show: false,
    title: 'Rotina Desktop — mini',
    backgroundColor: '#00000000',
    icon: path.join(ASSETS, 'icon.ico'),
    webPreferences: webPrefs()
  });
  floatingWindow.setOpacity(f.opacity);
  // Cliques atravessam a pílula; o renderer reativa só enquanto o mouse está sobre os botões.
  floatingWindow.setIgnoreMouseEvents(true, { forward: true });
  floatingWindow.loadFile(path.join(RENDERER, 'floating.html'));
  floatingWindow.once('ready-to-show', () => {
    floatingWindow.showInactive();
    keepFloatingOnTop();
  });
  clearInterval(floatingTopTimer);
  floatingTopTimer = setInterval(keepFloatingOnTop, 3000);
  floatingWindow.on('closed', () => {
    clearInterval(floatingTopTimer);
    floatingWindow = null;
    rebuildTrayMenu();
  });
  floatingWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function setFloatingEnabled(enabled) {
  if (config.settings.floating.enabled !== enabled) {
    const next = JSON.parse(JSON.stringify(config));
    next.settings.floating.enabled = enabled;
    setConfig(next);
  } else {
    applySettings();
  }
}

function showPopup(alert) {
  closePopup();
  // Não cobre a pílula quando ela está no canto inferior direito.
  const b = cornerBounds(380, 168);
  popupWindow = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    resizable: false,
    movable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    backgroundColor: '#FFFFFF',
    webPreferences: webPrefs()
  });
  popupWindow.setAlwaysOnTop(true, 'pop-up-menu');
  popupWindow.loadFile(path.join(RENDERER, 'popup.html'));
  popupWindow.webContents.once('did-finish-load', () => {
    if (!popupWindow || popupWindow.isDestroyed()) return;
    popupWindow.webContents.send('popup:data', { alert, seconds: config.settings.alerts.popupSeconds, snoozeMinutes: config.settings.alerts.snoozeMinutes });
    popupWindow.showInactive();
  });
  popupWindow.on('closed', () => {
    popupWindow = null;
  });
  clearTimeout(popupTimer);
  popupTimer = setTimeout(closePopup, config.settings.alerts.popupSeconds * 1000);
}

function closePopup() {
  clearTimeout(popupTimer);
  if (popupWindow && !popupWindow.isDestroyed()) popupWindow.destroy();
  popupWindow = null;
}

// ---------- configurações aplicadas ----------
function applySettings() {
  const f = config.settings.floating;
  if (f.enabled && !floatingWindow) createFloatingWindow();
  if (!f.enabled && floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.destroy();
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.setBounds(floatingBounds());
    floatingWindow.setOpacity(f.opacity);
    keepFloatingOnTop();
  }
  applyLoginItem();
  rebuildTrayMenu();
}

function applyLoginItem() {
  // Em desenvolvimento não registra (registraria o electron.exe).
  if (!app.isPackaged) return;
  const want = config.settings.general.startWithWindows;
  const current = app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
  if (current !== want) {
    app.setLoginItemSettings({ openAtLogin: want, path: process.execPath, args: ['--hidden'] });
    log('Inicialização com o Windows: ' + (want ? 'ativada' : 'desativada'));
  }
}

// ---------- bandeja ----------
function trayIcon() {
  return path.join(ASSETS, state.paused ? 'tray-paused.ico' : 'tray.ico');
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Rotina Desktop');
  tray.on('click', () => showMain());
  rebuildTrayMenu();
}

function setPaused(paused) {
  if (state.paused === paused) return;
  state.paused = paused;
  saveStateNow();
  // Atividades que terminam durante a pausa ficam fora da meta.
  if (paused) history.addPause(now());
  else history.endPause(now());
  log(paused ? 'Rotina pausada' : 'Rotina retomada');
  if (tray) tray.setImage(trayIcon());
  // Ao retomar, não dispara o que passou durante a pausa.
  alerts.resetClock();
  rebuildTrayMenu();
  pushStatus(true);
}

function mute(minutes) {
  const t = now();
  if (minutes === 'tomorrow') {
    const d = engine.addDays(t, 1);
    d.setHours(5, 0, 0, 0);
    state.muteUntil = d.getTime();
  } else {
    state.muteUntil = t + Number(minutes) * 60000;
  }
  saveStateNow();
  log('Som silenciado até ' + new Date(state.muteUntil).toLocaleString('pt-BR'));
  rebuildTrayMenu();
  pushStatus(true);
}

function unmute() {
  state.muteUntil = 0;
  saveStateNow();
  rebuildTrayMenu();
  pushStatus(true);
}

function snooze(minutes) {
  const at = alerts.snooze(minutes || config.settings.alerts.snoozeMinutes);
  dismissAlert();
  rebuildTrayMenu();
  return at;
}

function rebuildTrayMenu() {
  if (!tray) return;
  const t = now();
  const s = engine.getStatus(config, t);
  const muted = state.muteUntil > t;
  const canSnooze = !!(state.lastAlert && t - state.lastAlert.firedAt < 60 * 60000);
  const floatingOn = !!(floatingWindow && !floatingWindow.isDestroyed());
  const label = s.primary ? 'Agora: ' + s.primary.title + ' (até ' + s.primary.endLabel + ')' : 'Tempo livre';
  const today = history ? history.day(engine.dateKey(t), t) : null;
  const pending = today ? today.pendentes : 0;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label, enabled: false },
    { label: s.next ? 'Próxima: ' + s.next.title : 'Sem próximas atividades', enabled: false },
    { label: today && today.total ? 'Hoje: ' + today.feitos + ' de ' + today.total + ' feitas (' + Math.round(today.taxa * 100) + '%, meta ' + config.settings.checkin.goal + '%)' : 'Hoje: nada para contar ainda', enabled: false },
    { type: 'separator' },
    { label: 'Abrir Rotina Desktop', click: () => showMain() },
    { label: pending ? 'Marcar o que fiz hoje (' + pending + ' sem resposta)…' : 'Nada para marcar agora', enabled: pending > 0, click: () => showSummary() },
    { label: 'Relatórios', click: () => showMain('relatorios') },
    { label: 'Janela flutuante', type: 'checkbox', checked: floatingOn, click: (mi) => setFloatingEnabled(mi.checked) },
    { type: 'separator' },
    state.paused ? { label: 'Retomar rotina', click: () => setPaused(false) } : { label: 'Pausar rotina', click: () => setPaused(true) },
    muted
      ? { label: 'Reativar som (silenciado até ' + engine.fmtHM(new Date(state.muteUntil).getHours() * 60 + new Date(state.muteUntil).getMinutes()) + ')', click: unmute }
      : {
        label: 'Silenciar',
        submenu: [
          { label: '15 minutos', click: () => mute(15) },
          { label: '30 minutos', click: () => mute(30) },
          { label: '1 hora', click: () => mute(60) },
          { label: '2 horas', click: () => mute(120) },
          { label: 'Até amanhã', click: () => mute('tomorrow') }
        ]
      },
    {
      label: 'Adiar último alerta',
      enabled: canSnooze,
      submenu: [5, 10, 15, 30].map((m) => ({ label: m + ' minutos', click: () => snooze(m) }))
    },
    { type: 'separator' },
    updater && updater.state.status === 'available'
      ? { label: 'Atualizar para a versão ' + updater.state.latest + '…', click: () => showMain('config') }
      : { label: 'Verificar atualizações', click: () => { showMain('config'); updater && updater.check(); } },
    { label: 'Configurações', click: () => showMain('config') },
    { label: 'Sair', click: () => app.quit() }
  ]));
}

function updateTray(status) {
  if (!tray) return;
  let tip = 'Rotina Desktop';
  if (status.paused) tip += ' — pausada';
  else if (status.primary) tip += '\n' + status.primary.title + '\nTermina ' + status.primary.endLabel + ' · faltam ' + engine.fmtDuration(status.remainingMs);
  else if (status.next) tip += '\nTempo livre · próxima: ' + status.next.title;
  // O menu também mostra o placar do dia: reconstrói quando ele muda.
  const c = status.checkin;
  const label = tip.replace(/faltam .*$/, '') + '|' + c.pending + '|' + (c.today ? c.today.feitos + '/' + c.today.total : '');
  tray.setToolTip(tip.slice(0, 127));
  if (label !== lastTrayLabel) {
    lastTrayLabel = label;
    rebuildTrayMenu();
  }
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('config:get', () => config);
  ipcMain.handle('config:save', (_e, next) => setConfig(next));
  ipcMain.handle('status:get', () => buildStatus());
  ipcMain.handle('plan:day', (_e, key) => engine.getDayPlan(config, engine.parseDateKey(key) || new Date(now())));
  ipcMain.handle('plan:week', (_e, key) => {
    const start = engine.weekStart(engine.parseDateKey(key) || new Date(now()));
    return [0, 1, 2, 3, 4, 5, 6].map((o) => engine.getDayPlan(config, engine.addDays(start, o)));
  });
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    dataDir: app.getPath('userData'),
    simulated: clockOffset !== 0,
    loginItem: app.isPackaged ? app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin : null
  }));
  ipcMain.handle('action', async (e, name, payload) => {
    const p = payload || {};
    switch (name) {
      case 'pause': return setPaused(true);
      case 'resume': return setPaused(false);
      case 'mute': return mute(p.minutes || 30);
      case 'unmute': return unmute();
      case 'snooze': return snooze(p.minutes);
      case 'checkin:set': {
        try {
          return { ok: true, item: setCheckin(p.dateKey || engine.dateKey(now()), p.id, p.status || null, p.origem || 'app') };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }
      case 'checkin:summary': return showSummary();
      case 'checkin:closeSummary': {
        if (summaryWindow && !summaryWindow.isDestroyed()) summaryWindow.destroy();
        return null;
      }
      case 'history:day': {
        const key = p.dateKey || engine.dateKey(now());
        if (key === engine.dateKey(now())) ensureSnapshot(false);
        return history.day(key, now());
      }
      case 'history:report': {
        const [from, to] = p.de ? [p.de, p.ate] : periodRange(p.periodo || 'semana', now());
        return history.report(from, to, now(), config.settings.checkin.goal);
      }
      case 'dismissAlert': return dismissAlert();
      case 'openMain': return showMain(p.view);
      case 'floating:toggle': return setFloatingEnabled(!(floatingWindow && !floatingWindow.isDestroyed()));
      case 'floating:hide': return setFloatingEnabled(false);
      case 'floating:mouse': {
        // Captura o mouse só enquanto ele está sobre os botões; no resto, o clique vai para trás.
        if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.setIgnoreMouseEvents(!p.capture, { forward: true });
        return null;
      }
      case 'testSound': return playSound(p.name || config.settings.alerts.soundStart, p.volume);
      case 'testAlert': {
        const s = engine.getStatus(config, now());
        const it = s.primary || s.next;
        if (!it) return null;
        return deliverAlert({
          id: 'teste|' + now(), key: 'teste|' + now(), type: 'start', at: now(), firedAt: now(),
          title: 'Teste: ' + it.title, body: it.startLabel + ' – ' + it.endLabel + (it.subtitle ? ' · ' + it.subtitle : ''),
          item: { id: it.id, key: it.key, title: it.title, color: it.color, icon: it.icon, startLabel: it.startLabel, endLabel: it.endLabel },
          sound: 'start', muted: state.muteUntil > now()
        });
      }
      case 'chooseSound': {
        const win = BrowserWindow.fromWebContents(e.sender);
        const r = await dialog.showOpenDialog(win, { title: 'Escolher som de alerta', properties: ['openFile'], filters: [{ name: 'Áudio', extensions: ['wav', 'mp3', 'ogg', 'm4a'] }] });
        if (r.canceled || !r.filePaths[0]) return null;
        const dir = path.join(app.getPath('userData'), 'sons');
        fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, path.basename(r.filePaths[0]));
        fs.copyFileSync(r.filePaths[0], dest);
        return dest;
      }
      case 'exportConfig': {
        const win = BrowserWindow.fromWebContents(e.sender);
        const r = await dialog.showSaveDialog(win, { title: 'Exportar rotina', defaultPath: 'rotina-backup-' + engine.dateKey(now()) + '.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (r.canceled || !r.filePath) return false;
        fs.writeFileSync(r.filePath, JSON.stringify(config, null, 2), 'utf8');
        return true;
      }
      case 'importConfig': {
        const win = BrowserWindow.fromWebContents(e.sender);
        const r = await dialog.showOpenDialog(win, { title: 'Importar rotina', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (r.canceled || !r.filePaths[0]) return null;
        try {
          return setConfig(JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')));
        } catch (err) {
          dialog.showErrorBox('Importar rotina', 'Arquivo inválido: ' + err.message);
          return null;
        }
      }
      case 'resetDefaults': {
        const win = BrowserWindow.fromWebContents(e.sender);
        const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Cancelar', 'Restaurar'], defaultId: 0, cancelId: 0, title: 'Restaurar rotina padrão', message: 'Substituir toda a rotina e as configurações pelos valores iniciais?', detail: 'Exporte um backup antes, se quiser guardar a rotina atual.' });
        if (r.response !== 1) return null;
        return setConfig(createDefaultConfig());
      }
      case 'openDataFolder': return shell.openPath(app.getPath('userData'));
      case 'update:state': return updater.state;
      case 'update:check': return updater.check();
      case 'update:download': return updater.download();
      case 'update:install': return updater.install(() => app.quit());
      case 'agent:info': return agentInfo();
      case 'agent:connections': return detectConnections(userDirs());
      case 'agent:revealExtension': {
        try {
          return revealExtension();
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }
      case 'agent:openGuide': return shell.openPath(agentInfo().guideFile);
      case 'agent:openFolder': return shell.openPath(agentInfo().inboxDir);
      case 'copyText': return clipboard.writeText(String(p.text || ''));
      case 'quit': return app.quit();
      default: return null;
    }
  });
}

// ---------- modo de captura (validação visual durante o desenvolvimento) ----------
async function runCapture(dir) {
  const out = path.resolve(dir);
  fs.mkdirSync(out, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (win, name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, name + '.png'), img.toPNG());
  };
  await wait(2500);
  for (const view of ['hoje', 'semana', 'relatorios', 'regras', 'config']) {
    await mainWindow.webContents.executeJavaScript('window.__showView && window.__showView(' + JSON.stringify(view) + ')');
    await wait(700);
    await shot(mainWindow, 'main-' + view);
  }
  for (const panel of ['meta', 'alertas', 'excecoes', 'agentes', 'geral']) {
    await mainWindow.webContents.executeJavaScript('window.__showSettings && window.__showSettings(' + JSON.stringify(panel) + ')');
    await wait(500);
    log('Captura ' + panel + ': ' + (await mainWindow.webContents.executeJavaScript('(document.querySelector("#config-panel h2") || {}).textContent')));
    await shot(mainWindow, 'config-' + panel);
  }
  await mainWindow.webContents.executeJavaScript('window.__openActivity && window.__openActivity("foco1")');
  await wait(500);
  await shot(mainWindow, 'config-editar-atividade');
  if (floatingWindow) await shot(floatingWindow, 'floating');
  if (showSummary()) {
    await wait(1500);
    if (summaryWindow) await shot(summaryWindow, 'resumo');
    summaryWindow.destroy();
  }
  const status = engine.getStatus(config, now());
  const it = status.primary || status.next;
  if (it) {
    showPopup({ id: 'cap', key: 'cap', type: 'start', at: now(), firedAt: now(), title: 'Agora: ' + it.title, body: it.startLabel + ' – ' + it.endLabel, item: { id: it.id, key: it.key, title: it.title, color: it.color, icon: it.icon, startLabel: it.startLabel, endLabel: it.endLabel } });
    await wait(1500);
    if (popupWindow) await shot(popupWindow, 'popup');
  }
  log('Capturas salvas em ' + out);
  if (process.argv.includes('--capture-exit')) app.quit();
}

// ---------- inicialização ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId(APP_ID);
  app.on('second-instance', () => showMain());
  app.on('window-all-closed', () => {
    // Continua rodando na bandeja.
  });
  app.on('before-quit', () => {
    quitting = true;
    saveStateNow();
    log('Aplicativo encerrado');
  });

  app.whenReady().then(() => {
    loadData();
    log('Aplicativo iniciado' + (launchedHidden ? ' (com o Windows)' : '') + (clockOffset ? ' — relógio simulado ' + new Date(now()).toString() : ''));
    alerts = new AlertService({ now, getConfig: () => config, state, saveState: saveStateSoon, deliver: deliverAlert, log });
    registerIpc();
    createTray();
    applySettings();
    if (!launchedHidden) createMainWindow();
    alerts.tick();
    scheduleTick();

    watchConfigFile();
    setupAgentAccess();
    setupUpdater();

    powerMonitor.on('resume', () => {
      log('Sistema retomado da suspensão');
      alerts.resetClock();
      pushStatus(true);
    });
    powerMonitor.on('unlock-screen', () => pushStatus(true));
    // Resolução, barra de tarefas ou monitores mudaram: mantém a pílula no topo central (ou visível).
    const reposition = () => {
      if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.setBounds(floatingBounds());
    };
    screen.on('display-removed', reposition);
    screen.on('display-metrics-changed', reposition);

    if (captureDir && mainWindow) mainWindow.once('ready-to-show', () => runCapture(captureDir).catch((err) => log('Captura falhou: ' + err.stack)));
  });
}
