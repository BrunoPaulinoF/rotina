'use strict';
/**
 * Ponte local (named pipe) entre agentes de IA e o app Rotina Desktop aberto.
 *
 * Por que existe: o Claude Desktop da Microsoft Store desvia as gravações em %APPDATA% dos
 * processos que ele inicia (extensões, servidores MCP) para uma cópia privada do pacote.
 * Se o servidor MCP gravasse o config.json direto, o app nunca veria a mudança.
 * Pela ponte, quem grava é o próprio app, no arquivo real.
 */

const net = require('net');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const MAX_REQUEST = 1024 * 1024;
const REG_KEY = 'HKCU\\Software\\RotinaDesktop';

/**
 * Nome da ponte. Com uma pasta de dados alternativa (testes), o nome muda para nunca
 * falar com o app de verdade do usuário.
 */
function pipeName(dataDir) {
  const user = String((os.userInfo && os.userInfo().username) || 'usuario').replace(/[^\w.-]/g, '_');
  const dir = dataDir === undefined ? process.env.ROTINA_DATA_DIR : dataDir;
  const suffix = dir ? '-' + require('crypto').createHash('sha1').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 10) : '';
  const name = 'rotina-desktop-' + user + suffix;
  return process.platform === 'win32' ? '\\\\.\\pipe\\' + name : path.join(os.tmpdir(), name + '.sock');
}

/** Executa uma ferramenta no app aberto. Rejeita com code "NO_APP" se o app não estiver rodando. */
function callRemote(tool, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(pipeName());
    let buf = '';
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      fn(v);
    };
    const timer = setTimeout(() => finish(reject, Object.assign(new Error('O app Rotina Desktop não respondeu a tempo.'), { code: 'TIMEOUT' })), timeoutMs || 15000);
    sock.setEncoding('utf8');
    sock.on('connect', () => sock.write(JSON.stringify({ tool, args: args || {} }) + '\n'));
    sock.on('data', (d) => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      try {
        finish(resolve, JSON.parse(buf.slice(0, i)));
      } catch (err) {
        finish(reject, err);
      }
    });
    sock.on('error', (err) => {
      const noApp = ['ENOENT', 'ECONNREFUSED', 'EPIPE'].includes(err.code);
      finish(reject, noApp ? Object.assign(new Error('O app Rotina Desktop não está aberto.'), { code: 'NO_APP' }) : err);
    });
  });
}

/** No app: atende pedidos da ponte. handler(tool, args) -> Promise<string>. */
function startBridgeServer(handler, log, dataDir) {
  const server = net.createServer((sock) => {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    sock.on('data', (d) => {
      buf += d;
      if (buf.length > MAX_REQUEST) return sock.destroy();
      const i = buf.indexOf('\n');
      if (i < 0) return;
      let req;
      try {
        req = JSON.parse(buf.slice(0, i));
      } catch (_) {
        return sock.end(JSON.stringify({ ok: false, error: 'Pedido inválido.' }) + '\n');
      }
      Promise.resolve()
        .then(() => handler(String(req.tool || ''), req.args || {}))
        .then((text) => sock.end(JSON.stringify({ ok: true, text }) + '\n'), (err) => sock.end(JSON.stringify({ ok: false, error: err.message }) + '\n'));
    });
  });
  server.on('error', (err) => log && log('Ponte para agentes indisponível: ' + err.message));
  server.listen(pipeName(dataDir || null));
  return server;
}

/** Caminho do executável que o app registra ao iniciar (lido pelas extensões para abri-lo). */
function readAppPath() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('reg', ['query', REG_KEY, '/v', 'ExePath'], { windowsHide: true }, (err, out) => {
      const m = !err && /ExePath\s+REG_SZ\s+(.+)\r?\n/.exec(out);
      resolve(m ? m[1].trim() : null);
    });
  });
}

function registerAppPath(exePath, log) {
  if (process.platform !== 'win32') return;
  execFile('reg', ['add', REG_KEY, '/v', 'ExePath', '/t', 'REG_SZ', '/d', exePath, '/f'], { windowsHide: true }, (err) => {
    if (err && log) log('Não foi possível registrar o caminho do app: ' + err.message);
  });
}

/**
 * Abre o app pelo Explorer (que já está rodando), para que ele não herde o contexto
 * do processo que pediu — evitando o desvio de arquivos do pacote do Claude.
 */
async function launchApp() {
  const exe = await readAppPath();
  if (!exe) return false;
  spawn('explorer.exe', [exe], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return true;
}

module.exports = { pipeName, callRemote, startBridgeServer, readAppPath, registerAppPath, launchApp };
