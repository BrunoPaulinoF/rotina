'use strict';
/**
 * Atualização pelo GitHub Releases (repositório público).
 * Verifica a última versão, baixa o instalador, confere o SHA-512 do latest.yml e instala em silêncio.
 * As configurações ficam em %APPDATA%\Rotina Desktop e não são tocadas pelo instalador.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = 'BrunoPaulinoF/rotina';
const API = 'https://api.github.com/repos/' + REPO + '/releases/latest';

/** -1 se a < b, 0 se iguais, 1 se a > b (ignora "v" e sufixos). */
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

class Updater {
  /**
   * @param {object} o
   * @param {typeof fetch} o.fetch
   * @param {string} o.currentVersion
   * @param {(state: object) => void} [o.onState]
   * @param {(msg: string) => void} [o.log]
   */
  constructor(o) {
    this.fetch = o.fetch;
    this.currentVersion = o.currentVersion;
    this.onState = o.onState || (() => {});
    this.log = o.log || (() => {});
    this.release = null;
    this.file = null;
    this.state = { status: 'idle', current: o.currentVersion };
  }

  set(patch) {
    this.state = Object.assign({}, this.state, patch);
    this.onState(this.state);
    return this.state;
  }

  async check() {
    if (['checking', 'downloading'].includes(this.state.status)) return this.state;
    this.set({ status: 'checking', error: null });
    try {
      const res = await this.fetch(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'RotinaDesktop' } });
      if (res.status === 404) return this.set({ status: 'none', latest: null, checkedAt: Date.now(), message: 'Nenhuma versão publicada ainda.' });
      if (!res.ok) throw new Error('GitHub respondeu ' + res.status);
      const rel = await res.json();
      const latest = String(rel.tag_name || '').replace(/^v/i, '');
      const setup = (rel.assets || []).find((a) => /setup.*\.exe$/i.test(a.name));
      const yml = (rel.assets || []).find((a) => a.name === 'latest.yml');
      if (compareVersions(latest, this.currentVersion) <= 0 || !setup) {
        return this.set({ status: 'none', latest, checkedAt: Date.now(), message: 'Você já está na versão mais recente.' });
      }
      this.release = { version: latest, setup, yml, notes: rel.body || '', url: rel.html_url };
      this.log('Atualização disponível: ' + latest);
      return this.set({ status: 'available', latest, notes: this.release.notes, size: setup.size, url: rel.html_url, checkedAt: Date.now() });
    } catch (err) {
      this.log('Falha ao verificar atualização: ' + err.message);
      return this.set({ status: 'error', error: 'Não foi possível verificar (sem internet?). ' + err.message });
    }
  }

  async download() {
    if (!this.release) await this.check();
    if (!this.release) return this.state;
    const { setup, yml, version } = this.release;
    this.set({ status: 'downloading', progress: 0, error: null });
    const dest = path.join(os.tmpdir(), 'RotinaDesktop-Setup-' + version + '.exe');
    try {
      let expected = null;
      if (yml) {
        const y = await this.fetch(yml.browser_download_url, { headers: { 'User-Agent': 'RotinaDesktop' } });
        const m = /^sha512:\s*(\S+)/m.exec(await y.text());
        if (m) expected = m[1];
      }
      const res = await this.fetch(setup.browser_download_url, { headers: { 'User-Agent': 'RotinaDesktop' } });
      if (!res.ok) throw new Error('download respondeu ' + res.status);
      const total = Number(res.headers.get('content-length')) || setup.size || 0;
      const hash = crypto.createHash('sha512');
      const out = fs.createWriteStream(dest);
      const reader = res.body.getReader();
      let received = 0;
      let lastReport = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        received += chunk.length;
        if (total && Date.now() - lastReport > 250) {
          lastReport = Date.now();
          this.set({ progress: received / total });
        }
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
      if (setup.size && received !== setup.size) throw new Error('arquivo incompleto (' + received + ' de ' + setup.size + ' bytes)');
      if (expected && hash.digest('base64') !== expected) throw new Error('verificação de integridade (SHA-512) falhou');
      this.file = dest;
      this.log('Atualização ' + version + ' baixada e verificada.');
      return this.set({ status: 'ready', progress: 1 });
    } catch (err) {
      try { fs.unlinkSync(dest); } catch (_) { /* nada a limpar */ }
      this.log('Falha ao baixar atualização: ' + err.message);
      return this.set({ status: 'error', error: 'Falha no download: ' + err.message });
    }
  }

  /** Executa o instalador em modo silencioso e reabre o app ao final (--force-run). */
  install(quit) {
    if (!this.file || !fs.existsSync(this.file)) return false;
    this.log('Instalando atualização ' + this.release.version);
    spawn(this.file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(quit, 300);
    return true;
  }
}

module.exports = { Updater, compareVersions, REPO };
