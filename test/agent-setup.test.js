'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectConnections, buildAgentPrompt, buildAgentGuide } = require('../src/main/agent-setup');

function fakeProfile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rotina-perfil-'));
  const dirs = { home: path.join(root, 'home'), appData: path.join(root, 'Roaming'), localAppData: path.join(root, 'Local') };
  Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));
  return dirs;
}
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
};
const statusOf = (list, id) => list.find((c) => c.id === id).status;

const INFO = {
  command: 'C:\\Program Files\\RotinaDesktop\\RotinaDesktop.exe',
  server: 'C:\\Program Files\\RotinaDesktop\\resources\\app.asar\\src\\agent\\server.js',
  env: { ELECTRON_RUN_AS_NODE: '1' },
  inboxDir: 'C:\\Users\\x\\Documents\\Rotina Desktop',
  mcpJson: '{ "mcpServers": { "rotina-desktop": {} } }',
  claudeCode: 'claude mcp add rotina-desktop --scope user -e ELECTRON_RUN_AS_NODE=1 -- "a" "b"',
  cli: '$env:ELECTRON_RUN_AS_NODE=1; & "a" "b" --cli ajuda'
};

test('Claude Desktop da Store: lê Claude-Data (não o AppData desviado) e reconhece a extensão', () => {
  const d = fakeProfile();
  // Arquivo antigo/desviado com o servidor: NÃO deve contar como conectado
  write(path.join(d.appData, 'Claude', 'claude_desktop_config.json'), { mcpServers: { rotina: {} } });
  write(path.join(d.localAppData, 'Claude-Data', 'claude_pkg', 'claude_desktop_config.json'), { preferences: {} });
  assert.equal(statusOf(detectConnections(d), 'claude-desktop'), 'nao-conectado');
  // Extensão instalada
  write(path.join(d.localAppData, 'Claude-Data', 'claude_pkg', 'Claude Extensions', 'local.rotina', 'manifest.json'), { name: 'rotina-desktop' });
  assert.equal(statusOf(detectConnections(d), 'claude-desktop'), 'conectado');
});

test('Claude Desktop clássico (sem Claude-Data) usa %APPDATA%\\Claude', () => {
  const d = fakeProfile();
  write(path.join(d.appData, 'Claude', 'claude_desktop_config.json'), '\uFEFF' + JSON.stringify({ mcpServers: { 'rotina-desktop': {} } }));
  assert.equal(statusOf(detectConnections(d), 'claude-desktop'), 'conectado');
});

test('outros aplicativos: nomes antigo e novo do servidor, TOML e arquivo corrompido', () => {
  const d = fakeProfile();
  write(path.join(d.home, '.claude.json'), { projects: { 'C:/p': { mcpServers: { rotina: {} } } } });
  write(path.join(d.home, '.cursor', 'mcp.json'), { mcpServers: { outro: {} } });
  write(path.join(d.home, '.codex', 'config.toml'), '[mcp_servers.rotina-desktop]\ncommand = "x"\n');
  write(path.join(d.appData, 'Code', 'User', 'mcp.json'), '{ quebrado');
  const c = detectConnections(d);
  assert.equal(statusOf(c, 'claude-code'), 'conectado');
  assert.equal(statusOf(c, 'cursor'), 'nao-conectado');
  assert.equal(statusOf(c, 'codex'), 'conectado');
  assert.equal(statusOf(c, 'vscode'), 'nao-conectado');
  assert.equal(statusOf(c, 'windsurf'), 'ausente');
});

test('prompt: separa do recurso "rotinas" do Claude e dá ao Cowork um caminho que ele consegue seguir', () => {
  const p = buildAgentPrompt(INFO);
  for (const s of ['NÃO tem relação com as "rotinas"', 'Peça acesso à pasta: ' + INFO.inboxDir, 'LEIA-ME para agentes de IA.md', '"ferramenta": "ver_agora"', 'respostas', 'NÃO consegue instalar servidores MCP no Claude Desktop sozinho', 'RotinaDesktop.mcpb', INFO.claudeCode, INFO.cli, 'ver_agora', 'salvar_excecao', 'desfazer_ultima_alteracao']) {
    assert.ok(p.includes(s), 'prompt deveria conter: ' + s);
  }
  assert.ok(!/claude_desktop_config\.json/.test(p), 'o prompt não deve mandar o Cowork editar a configuração do Claude');
});

test('guia lista todas as ferramentas com parâmetros', () => {
  const g = buildAgentGuide(INFO);
  const { TOOLS } = require('../src/agent/tools');
  TOOLS.forEach((t) => assert.ok(g.includes('### ' + t.name), t.name));
  assert.match(g, /`start` \(string\) — Início, HH:MM\./);
  assert.match(g, /`data` \(string, obrigatório\)/);
});
