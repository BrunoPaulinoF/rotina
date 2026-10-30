'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const SERVER = path.join(__dirname, '..', 'src', 'agent', 'server.js');
const tmpData = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rotina-agent-'));
const readConfig = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));

/** Conversa com o servidor MCP por stdio, como um cliente faria. */
function mcpSession(dir) {
  const child = spawn(process.execPath, [SERVER], { env: Object.assign({}, process.env, { ROTINA_DATA_DIR: dir }) });
  let buf = '';
  const waiting = new Map();
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      waiting.get(msg.id)(msg);
    }
  });
  let next = 1;
  const request = (method, params) => new Promise((resolve) => {
    const id = next++;
    waiting.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const call = async (name, args) => (await request('tools/call', { name, arguments: args })).result;
  return { request, call, close: () => child.stdin.end() };
}

test('MCP: handshake, lista de ferramentas e instruções', async () => {
  const s = mcpSession(tmpData());
  const init = await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.ok(init.result.capabilities.tools);
  assert.match(init.result.instructions, /Rotina Desktop/);
  const list = await s.request('tools/list', {});
  const names = list.result.tools.map((t) => t.name);
  for (const n of ['ver_agora', 'ver_dia', 'salvar_atividade', 'remover_atividade', 'salvar_excecao', 'desfazer_ultima_alteracao']) assert.ok(names.includes(n), n);
  list.result.tools.forEach((t) => assert.match(t.name, /^[a-zA-Z0-9_-]{1,64}$/));
  const unknown = await s.request('metodo/inexistente', {});
  assert.equal(unknown.error.code, -32601);
  s.close();
});

test('MCP: cria, altera e remove atividade; grava config válido', async () => {
  const dir = tmpData();
  const s = mcpSession(dir);
  await s.request('initialize', {});
  const created = await s.call('salvar_atividade', { id: 'academia', title: 'Academia', start: '19:00', end: '20:00', days: ['seg', 'qua'], category: 'corpo', icon: 'dumbbell' });
  assert.ok(!created.isError, created.content[0].text);
  let cfg = readConfig(dir);
  const a = cfg.activities.find((x) => x.id === 'academia');
  assert.deepEqual([a.start, a.duration, a.days], ['19:00', 60, [1, 3]]);
  assert.match(created.content[0].text, /Família e descanso/); // sobreposição avisada

  await s.call('salvar_atividade', { id: 'academia', start: '06:00' });
  cfg = readConfig(dir);
  assert.equal(cfg.activities.find((x) => x.id === 'academia').start, '06:00');
  assert.equal(cfg.activities.find((x) => x.id === 'academia').title, 'Academia');

  const dia = await s.call('ver_dia', { data: '2026-11-02' });
  assert.match(dia.content[0].text, /06:00–07:00 {2}Academia/);

  await s.call('remover_atividade', { id: 'academia' });
  assert.ok(!readConfig(dir).activities.some((x) => x.id === 'academia'));
  await s.call('desfazer_ultima_alteracao', {});
  assert.ok(readConfig(dir).activities.some((x) => x.id === 'academia'));
  s.close();
});

test('MCP: erros de uso voltam como resultado com isError', async () => {
  const s = mcpSession(tmpData());
  const bad = await s.call('salvar_atividade', { title: 'Sem horário' });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /informe title, start/);
  const badDay = await s.call('listar_atividades', { dia: 'xyz' });
  assert.equal(badDay.isError, true);
  s.close();
});

test('MCP: exceção de data (feriado) e tarefas da semana', async () => {
  const dir = tmpData();
  const s = mcpSession(dir);
  const r = await s.call('salvar_excecao', { data: '2026-11-20', tipo: 'livre', nota: 'Feriado', extras: [{ title: 'Churrasco', start: '12:00', duration: 180, category: 'familia', icon: 'heart' }] });
  assert.match(r.content[0].text, /Feriado/);
  assert.match(r.content[0].text, /12:00–15:00 {2}Churrasco/);
  const ex = readConfig(dir).exceptions[0];
  assert.equal(ex.off, true);
  await s.call('definir_dia_semana', { dia: 'sexta', projeto: 'App Rotina' });
  assert.equal(readConfig(dir).weekly[5].projeto, 'App Rotina');
  s.close();
});

test('linha de comando: ajuda e chamada de ferramenta', () => {
  const dir = tmpData();
  const env = Object.assign({}, process.env, { ROTINA_DATA_DIR: dir });
  assert.match(execFileSync(process.execPath, [SERVER, '--cli', 'ajuda'], { env }).toString(), /salvar_atividade/);
  const out = execFileSync(process.execPath, [SERVER, '--cli', 'ver_dia', '{"data":"2026-11-03"}'], { env }).toString();
  assert.match(out, /19:00–21:00 {2}Igreja/);
  // pares chave=valor (funcionam no PowerShell, que remove aspas de JSON)
  execFileSync(process.execPath, [SERVER, '--cli', 'salvar_atividade', 'id=yoga', 'title=Yoga leve', 'start=06:00', 'duration=20', 'days=sab,dom', 'alertAdvance=false'], { env });
  const yoga = readConfig(dir).activities.find((a) => a.id === 'yoga');
  assert.deepEqual([yoga.title, yoga.duration, yoga.days, yoga.alertAdvance], ['Yoga leve', 20, [0, 6], false]);
});
