'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const { Updater, compareVersions } = require('../src/main/updater');

test('comparação de versões', () => {
  assert.equal(compareVersions('1.1.0', '1.0.9'), 1);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.2', '1.10.0'), -1);
  assert.equal(compareVersions('2.0.0-beta', '1.9.9'), 1);
});

/** fetch falso que imita a API do GitHub e os downloads. */
function fakeGitHub({ tag, file, status, wrongHash }) {
  const sha = crypto.createHash('sha512').update(file || '').digest('base64');
  return async (url) => {
    if (url.includes('api.github.com')) {
      if (status) return { status, ok: false };
      return {
        status: 200,
        ok: true,
        json: async () => ({
          tag_name: tag,
          body: 'Novidades',
          html_url: 'https://github.com/x/y/releases/tag/' + tag,
          assets: [
            { name: 'RotinaDesktop-Setup-' + tag + '.exe', size: file.length, browser_download_url: 'https://dl/setup.exe' },
            { name: 'latest.yml', size: 10, browser_download_url: 'https://dl/latest.yml' }
          ]
        })
      };
    }
    if (url.endsWith('latest.yml')) return { ok: true, status: 200, text: async () => 'version: x\nsha512: ' + (wrongHash ? 'AAAA' : sha) + '\n' };
    const bytes = Buffer.from(file);
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(bytes.length) },
      body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: new Uint8Array(bytes) })) }; } }
    };
  };
}

test('sem releases publicadas: informa e não quebra', async () => {
  const u = new Updater({ fetch: fakeGitHub({ status: 404 }), currentVersion: '1.0.0' });
  const s = await u.check();
  assert.equal(s.status, 'none');
});

test('mesma versão: nada a atualizar', async () => {
  const u = new Updater({ fetch: fakeGitHub({ tag: 'v1.0.0', file: 'x' }), currentVersion: '1.0.0' });
  assert.equal((await u.check()).status, 'none');
});

test('versão nova: baixa e confere SHA-512', async () => {
  const u = new Updater({ fetch: fakeGitHub({ tag: 'v1.2.0', file: 'conteudo do instalador' }), currentVersion: '1.1.0' });
  const s = await u.check();
  assert.equal(s.status, 'available');
  assert.equal(s.latest, '1.2.0');
  const d = await u.download();
  assert.equal(d.status, 'ready');
  assert.equal(fs.readFileSync(u.file, 'utf8'), 'conteudo do instalador');
  fs.unlinkSync(u.file);
});

test('hash diferente: recusa o instalador e apaga o arquivo', async () => {
  const u = new Updater({ fetch: fakeGitHub({ tag: 'v1.2.0', file: 'adulterado', wrongHash: true }), currentVersion: '1.1.0' });
  await u.check();
  const d = await u.download();
  assert.equal(d.status, 'error');
  assert.match(d.error, /SHA-512/);
  assert.equal(u.file, null);
});

test('sem internet: estado de erro amigável', async () => {
  const u = new Updater({ fetch: async () => { throw new Error('getaddrinfo ENOTFOUND'); }, currentVersion: '1.0.0' });
  const s = await u.check();
  assert.equal(s.status, 'error');
  assert.match(s.error, /sem internet/);
});
