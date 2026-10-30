'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JsonStore, normalizeState } = require('../src/main/store');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rotina-store-'));

test('grava e lê de volta (persistência entre reinícios)', () => {
  const file = path.join(tmpDir(), 'state.json');
  new JsonStore(file).save({ paused: true, muteUntil: 123 });
  const back = normalizeState(new JsonStore(file).load());
  assert.equal(back.paused, true);
  assert.equal(back.muteUntil, 123);
  assert.ok(!fs.existsSync(file + '.tmp'));
});

test('aceita arquivo com BOM (editado no Bloco de Notas)', () => {
  const file = path.join(tmpDir(), 'state.json');
  fs.writeFileSync(file, '﻿' + JSON.stringify({ paused: true }), 'utf8');
  assert.equal(new JsonStore(file).load().paused, true);
});

test('arquivo corrompido é preservado como cópia e o app recomeça dos padrões', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, '{ quebrado', 'utf8');
  assert.equal(new JsonStore(file).load(), null);
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('config.json.corrompido-')));
});
