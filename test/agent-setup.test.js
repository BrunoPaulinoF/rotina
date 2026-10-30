'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectConnections, buildAgentPrompt } = require('../src/main/agent-setup');

/** Perfil de usuário falso com pastas de alguns aplicativos. */
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

test('detecta aplicativos conectados, sem o servidor e ausentes', () => {
  const d = fakeProfile();
  // Claude Desktop da Microsoft Store, já conectado (arquivo com BOM)
  write(path.join(d.localAppData, 'Packages', 'Claude_abc', 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'), '\uFEFF' + JSON.stringify({ mcpServers: { rotina: { command: 'x' } } }));
  // Claude Code com o servidor só em um projeto
  write(path.join(d.home, '.claude.json'), { projects: { 'C:/proj': { mcpServers: { rotina: {} } } } });
  // Cursor instalado, sem o servidor
  write(path.join(d.home, '.cursor', 'mcp.json'), { mcpServers: { outro: {} } });
  // Codex conectado via TOML
  write(path.join(d.home, '.codex', 'config.toml'), 'model = "x"\n\n[mcp_servers.rotina]\ncommand = "x"\n');
  // VS Code instalado, arquivo corrompido: não quebra
  write(path.join(d.appData, 'Code', 'User', 'mcp.json'), '{ quebrado');

  const c = detectConnections(d);
  assert.equal(statusOf(c, 'claude-desktop'), 'conectado');
  assert.equal(statusOf(c, 'claude-code'), 'conectado');
  assert.equal(statusOf(c, 'cursor'), 'nao-conectado');
  assert.equal(statusOf(c, 'codex'), 'conectado');
  assert.equal(statusOf(c, 'vscode'), 'nao-conectado');
  assert.equal(statusOf(c, 'windsurf'), 'ausente');
  assert.equal(statusOf(c, 'gemini'), 'ausente');
});

test('prompt universal traz verificação, permissão, dados do servidor e alternativas', () => {
  const d = fakeProfile();
  const info = {
    command: 'C:\\Program Files\\RotinaDesktop\\RotinaDesktop.exe',
    server: 'C:\\Program Files\\RotinaDesktop\\resources\\app.asar\\src\\agent\\server.js',
    env: { ELECTRON_RUN_AS_NODE: '1' },
    mcpJson: '{ "mcpServers": {} }',
    claudeCode: 'claude mcp add rotina --scope user -e ELECTRON_RUN_AS_NODE=1 -- "a" "b"',
    cli: '$env:ELECTRON_RUN_AS_NODE=1; & "a" "b" --cli ajuda',
    guideFile: 'C:\\dados\\AGENTES.md',
    configFile: 'C:\\dados\\config.json'
  };
  const p = buildAgentPrompt(info, d);
  for (const s of ['ver_agora', 'peça minha permissão', 'preserve os outros servidores', info.command, info.server, 'ELECTRON_RUN_AS_NODE=1', info.claudeCode, 'Cursor', 'VS Code', 'Codex', 'Gemini', '[mcp_servers.rotina]', info.cli, info.guideFile, 'desfazer_ultima_alteracao']) {
    assert.ok(p.includes(s), 'prompt deveria conter: ' + s);
  }
});
