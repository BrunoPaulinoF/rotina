'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { startBridgeServer, callRemote, pipeName } = require('../src/agent/bridge');
const { startInbox } = require('../src/main/inbox');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('ponte: nome isolado por pasta de dados (testes nunca falam com o app real)', () => {
  const real = pipeName(null);
  assert.notEqual(pipeName('C:\\teste\\a'), real);
  assert.equal(pipeName('C:\\Teste\\A'), pipeName('c:\\teste\\a'));
});

test('ponte: o servidor MCP executa no app aberto, e não no arquivo local', async () => {
  const dir = tmp('rotina-ponte-');
  const calls = [];
  const server = startBridgeServer(async (tool, args) => {
    calls.push([tool, args]);
    if (tool === 'falha') throw new Error('deu ruim');
    return 'resposta do app para ' + tool;
  }, null, dir);
  await new Promise((r) => server.once('listening', r));
  process.env.ROTINA_DATA_DIR = dir;
  try {
    assert.deepEqual(await callRemote('ver_agora', {}), { ok: true, text: 'resposta do app para ver_agora' });
    assert.deepEqual(await callRemote('falha', {}), { ok: false, error: 'deu ruim' });

    // O server.js (MCP/CLI) usa a ponte quando o app está aberto
    const out = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'agent', 'server.js'), '--cli', 'ver_dia', 'data=hoje'], { env: Object.assign({}, process.env, { ROTINA_DATA_DIR: dir }) });
      let s = '';
      child.stdout.on('data', (d) => (s += d));
      child.on('close', () => resolve(s));
    });
    assert.match(out, /resposta do app para ver_dia/);
    assert.deepEqual(calls[2], ['ver_dia', { data: 'hoje' }]);
  } finally {
    delete process.env.ROTINA_DATA_DIR;
    server.close();
  }
});

test('ponte: com o app fechado, avisa NO_APP', async () => {
  process.env.ROTINA_DATA_DIR = tmp('rotina-sem-app-');
  try {
    await assert.rejects(callRemote('ver_agora', {}), (e) => e.code === 'NO_APP');
  } finally {
    delete process.env.ROTINA_DATA_DIR;
  }
});

test('extensão sem o app aberto: não grava no arquivo local (cairia na cópia privada do pacote)', async () => {
  const dir = tmp('rotina-ext-');
  const out = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'agent', 'server.js'), '--cli', 'remover_atividade', 'id=foco1'], {
      env: Object.assign({}, process.env, { ROTINA_DATA_DIR: dir, ROTINA_REQUIRE_APP: '1', PATH: '' })
    });
    let s = '';
    child.stdout.on('data', (d) => (s += d));
    child.stderr.on('data', (d) => (s += d));
    child.on('close', () => resolve(s));
  });
  assert.match(out, /não está aberto/);
  assert.ok(!fs.existsSync(path.join(dir, 'config.json')));
});

test('pasta de comunicação: pedido vira resposta e o pedido é removido', async () => {
  const root = tmp('rotina-pasta-');
  const box = startInbox(root, async (tool, args) => {
    if (tool !== 'ver_dia') throw new Error('Ferramenta desconhecida: ' + tool);
    return 'dia ' + args.data;
  });
  try {
    fs.writeFileSync(path.join(box.requests, '001.json'), '\uFEFF' + JSON.stringify({ ferramenta: 'ver_dia', argumentos: { data: 'amanhã' } }));
    fs.writeFileSync(path.join(box.requests, '002.json'), JSON.stringify({ ferramenta: 'xyz', argumentos: {} }));
    let r1;
    let r2;
    for (let i = 0; i < 40 && !(r1 && r2); i++) {
      await new Promise((r) => setTimeout(r, 100));
      const f1 = path.join(box.responses, '001.json');
      const f2 = path.join(box.responses, '002.json');
      if (fs.existsSync(f1)) r1 = JSON.parse(fs.readFileSync(f1, 'utf8'));
      if (fs.existsSync(f2)) r2 = JSON.parse(fs.readFileSync(f2, 'utf8'));
    }
    assert.equal(r1.ok, true);
    assert.equal(r1.resultado, 'dia amanhã');
    assert.equal(r2.ok, false);
    assert.match(r2.erro, /desconhecida/);
    assert.deepEqual(fs.readdirSync(box.requests), []);
  } finally {
    box.stop();
  }
});
