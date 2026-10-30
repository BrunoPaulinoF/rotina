'use strict';
/**
 * Processo principal: ciclo de vida, janelas, bandeja, alertas e IPC.
 * O motor roda aqui (não nas janelas), então os alertas continuam com tudo minimizado ou fechado na bandeja.
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, screen, powerMonitor, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const engine = require('../shared/engine');
const { createDefaultConfig } = require('./defaults');
const { JsonStore, normalizeConfig, normalizeState } = require('./store');
const { AlertService } = require('./alerts');

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
if (dataDirArg) app.setPath('userData', path.resolve(dataDirArg));
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

function setConfig(next) {
  config = normalizeConfig(next);
  configStore.save(config);
  applySettings();
  broadcast('config', config);
  pushStatus(true);
  return config;
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
    alwaysOnTop: config.settings.floating.alwaysOnTop,
    simulated: clockOffset !== 0
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
  updateTray(status);
}

function scheduleTick() {
  clearTimeout(tickTimer);
  const t = now();
  tickTimer = setTimeout(() => {
    try {
      alerts.tick();
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
  const floatingVisible = floatingWindow && !floatingWindow.isDestroyed() && floatingWindow.isVisible();
  if (a.popup && !floatingVisible) showPopup(activeAlert);
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

function defaultFloatingBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const width = 320;
  const height = 176;
  return { x: wa.x + wa.width - width - 16, y: wa.y + 16, width, height };
}

function createFloatingWindow() {
  const b = boundsVisible(state.floatingBounds) ? state.floatingBounds : defaultFloatingBounds();
  const f = config.settings.floating;
  floatingWindow = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    minWidth: 220,
    minHeight: 104,
    frame: false,
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: f.alwaysOnTop,
    show: false,
    title: 'Rotina Desktop — mini',
    backgroundColor: '#FFFFFF',
    icon: path.join(ASSETS, 'icon.ico'),
    webPreferences: webPrefs()
  });
  if (f.alwaysOnTop) floatingWindow.setAlwaysOnTop(true, 'floating');
  floatingWindow.setOpacity(f.opacity);
  floatingWindow.loadFile(path.join(RENDERER, 'floating.html'));
  // showInactive: aparece sem roubar o foco do que você está usando.
  floatingWindow.once('ready-to-show', () => floatingWindow.showInactive());
  let boundsTimer = null;
  const remember = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (floatingWindow && !floatingWindow.isDestroyed()) {
        state.floatingBounds = floatingWindow.getBounds();
        saveStateSoon();
      }
    }, 500);
  };
  floatingWindow.on('move', remember);
  floatingWindow.on('resize', remember);
  floatingWindow.on('closed', () => {
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
  const wa = screen.getPrimaryDisplay().workArea;
  const width = 380;
  const height = 168;
  popupWindow = new BrowserWindow({
    x: wa.x + wa.width - width - 16,
    y: wa.y + wa.height - height - 16,
    width,
    height,
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
    floatingWindow.setAlwaysOnTop(f.alwaysOnTop, 'floating');
    floatingWindow.setOpacity(f.opacity);
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
  state.paused = paused;
  saveStateNow();
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
  tray.setContextMenu(Menu.buildFromTemplate([
    { label, enabled: false },
    { label: s.next ? 'Próxima: ' + s.next.title : 'Sem próximas atividades', enabled: false },
    { type: 'separator' },
    { label: 'Abrir Rotina Desktop', click: () => showMain() },
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
  const label = tip.replace(/faltam .*$/, '');
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
      case 'dismissAlert': return dismissAlert();
      case 'openMain': return showMain(p.view);
      case 'floating:toggle': return setFloatingEnabled(!(floatingWindow && !floatingWindow.isDestroyed()));
      case 'floating:hide': return setFloatingEnabled(false);
      case 'floating:alwaysOnTop': {
        const next = JSON.parse(JSON.stringify(config));
        next.settings.floating.alwaysOnTop = !!p.value;
        return setConfig(next);
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
  for (const view of ['hoje', 'semana', 'regras', 'config']) {
    await mainWindow.webContents.executeJavaScript('window.__showView && window.__showView(' + JSON.stringify(view) + ')');
    await wait(700);
    await shot(mainWindow, 'main-' + view);
  }
  for (const panel of ['alertas', 'excecoes', 'geral']) {
    await mainWindow.webContents.executeJavaScript('window.__showSettings && window.__showSettings(' + JSON.stringify(panel) + ')');
    await wait(500);
    log('Captura ' + panel + ': ' + (await mainWindow.webContents.executeJavaScript('(document.querySelector("#config-panel h2") || {}).textContent')));
    await shot(mainWindow, 'config-' + panel);
  }
  await mainWindow.webContents.executeJavaScript('window.__openActivity && window.__openActivity("foco1")');
  await wait(500);
  await shot(mainWindow, 'config-editar-atividade');
  if (floatingWindow) await shot(floatingWindow, 'floating');
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

    powerMonitor.on('resume', () => {
      log('Sistema retomado da suspensão');
      alerts.resetClock();
      pushStatus(true);
    });
    powerMonitor.on('unlock-screen', () => pushStatus(true));
    screen.on('display-removed', () => {
      if (floatingWindow && !boundsVisible(floatingWindow.getBounds())) floatingWindow.setBounds(defaultFloatingBounds());
    });

    if (captureDir && mainWindow) mainWindow.once('ready-to-show', () => runCapture(captureDir).catch((err) => log('Captura falhou: ' + err.stack)));
  });
}
