'use strict';
/**
 * Conexão de agentes de IA: prompt universal para colar em qualquer agente
 * e detecção (somente leitura) de quais aplicativos já têm o servidor "rotina".
 */

const fs = require('fs');
const path = require('path');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (_) {
    return null;
  }
}

/** Arquivos de configuração MCP dos aplicativos mais comuns no Windows. */
function clientTargets(dirs) {
  const { home, appData, localAppData } = dirs;
  const claudeDesktop = [];
  try {
    for (const d of fs.readdirSync(path.join(localAppData, 'Packages'))) {
      if (/^Claude_/i.test(d)) claudeDesktop.push(path.join(localAppData, 'Packages', d, 'LocalCache', 'Roaming', 'Claude'));
    }
  } catch (_) { /* sem pasta de pacotes */ }
  claudeDesktop.push(path.join(appData, 'Claude'));
  return [
    { id: 'claude-desktop', name: 'Claude Desktop / Cowork', dirs: claudeDesktop, file: 'claude_desktop_config.json', key: 'mcpServers' },
    { id: 'claude-code', name: 'Claude Code', dirs: [home], file: '.claude.json', key: 'mcpServers', projects: true },
    { id: 'cursor', name: 'Cursor', dirs: [path.join(home, '.cursor')], file: 'mcp.json', key: 'mcpServers' },
    { id: 'vscode', name: 'VS Code (Copilot)', dirs: [path.join(appData, 'Code', 'User')], file: 'mcp.json', key: 'servers' },
    { id: 'windsurf', name: 'Windsurf', dirs: [path.join(home, '.codeium', 'windsurf')], file: 'mcp_config.json', key: 'mcpServers' },
    { id: 'codex', name: 'Codex CLI', dirs: [path.join(home, '.codex')], file: 'config.toml', toml: true },
    { id: 'gemini', name: 'Gemini CLI', dirs: [path.join(home, '.gemini')], file: 'settings.json', key: 'mcpServers' }
  ];
}

/**
 * Para cada aplicativo: "conectado" (servidor rotina configurado), "nao-conectado"
 * (aplicativo encontrado, sem o servidor) ou "ausente" (aplicativo não encontrado).
 */
function detectConnections(dirs) {
  return clientTargets(dirs).map((t) => {
    const present = t.dirs.filter((d) => fs.existsSync(d));
    let connected = false;
    for (const d of present) {
      const file = path.join(d, t.file);
      if (!fs.existsSync(file)) continue;
      if (t.toml) {
        connected = connected || /^\s*\[mcp_servers\.rotina\]/m.test(fs.readFileSync(file, 'utf8'));
        continue;
      }
      const j = readJson(file);
      if (!j) continue;
      if (j[t.key] && j[t.key].rotina) connected = true;
      if (t.projects && j.projects && Object.values(j.projects).some((p) => p && p.mcpServers && p.mcpServers.rotina)) connected = true;
    }
    return { id: t.id, name: t.name, status: connected ? 'conectado' : present.length ? 'nao-conectado' : 'ausente', files: present.map((d) => path.join(d, t.file)) };
  });
}

/** Prompt para colar em qualquer agente: ele verifica, conecta (pedindo permissão) e confirma. */
function buildAgentPrompt(info, dirs) {
  const q = (s) => '"' + s + '"';
  const desktopFiles = clientTargets(dirs)[0].dirs.filter((d) => fs.existsSync(d)).map((d) => path.join(d, 'claude_desktop_config.json'));
  const envToml = Object.entries(info.env).map(([k, v]) => k + ' = ' + JSON.stringify(v)).join(', ');
  return [
    'Quero que você passe a consultar e alterar a minha rotina diária, que fica no app Rotina Desktop instalado neste computador (Windows). O app oferece um servidor MCP chamado "rotina".',
    '',
    'PASSO 1 — Verifique se você já tem as ferramentas do servidor "rotina" (ver_agora, ver_dia, salvar_atividade…). Se tiver, pule para o PASSO 4.',
    '',
    'PASSO 2 — Se não tiver, conecte o servidor "rotina" do jeito que o seu aplicativo usa para servidores MCP. Antes de rodar comandos ou editar arquivos de configuração, me diga exatamente o que vai fazer e peça minha permissão. Ao editar um arquivo existente, faça uma cópia antes e preserve os outros servidores já configurados.',
    '',
    'Dados do servidor (tipo stdio):',
    '- comando: ' + info.command,
    '- argumentos: [' + q(info.server) + ']',
    '- variáveis de ambiente: ' + Object.entries(info.env).map(([k, v]) => k + '=' + v).join(', '),
    '',
    'Como configurar nos aplicativos mais comuns:',
    '- Claude Code: ' + info.claudeCode,
    '- Claude Desktop / Cowork: adicione em "mcpServers" do claude_desktop_config.json' + (desktopFiles.length ? ' (' + desktopFiles.join(' e ') + ')' : '') + '; depois feche e abra o Claude Desktop.',
    '- Cursor: em "mcpServers" de %USERPROFILE%\\.cursor\\mcp.json',
    '- VS Code (Copilot): em "servers" de %APPDATA%\\Code\\User\\mcp.json, com "type": "stdio"',
    '- Windsurf: em "mcpServers" de %USERPROFILE%\\.codeium\\windsurf\\mcp_config.json',
    '- Codex CLI: em %USERPROFILE%\\.codex\\config.toml, seção [mcp_servers.rotina] com command = ' + JSON.stringify(info.command) + ', args = [' + JSON.stringify(info.server) + '] e env = { ' + envToml + ' }',
    '- Gemini CLI: em "mcpServers" de %USERPROFILE%\\.gemini\\settings.json',
    '- Outro aplicativo: use a configuração de servidor MCP stdio dele com os dados acima.',
    '',
    'Bloco JSON pronto (formato "mcpServers"):',
    info.mcpJson,
    '',
    'Depois de configurar, me diga se preciso reiniciar o aplicativo ou abrir uma nova conversa para as ferramentas aparecerem.',
    '',
    'PASSO 3 — Se o seu ambiente não usa MCP:',
    '- Se você roda comandos no terminal, use a linha de comando (PowerShell), com argumentos no formato chave=valor:',
    '  ' + info.cli,
    '- Se você só edita arquivos, siga o guia ' + info.guideFile + ' e altere ' + info.configFile + ' (o app recarrega sozinho ao salvar).',
    '',
    'PASSO 4 — Confirme que funcionou mostrando o que tenho agora na rotina (ver_agora) e me explique em poucas linhas o que você consegue fazer: ver o dia e a semana, criar/editar/remover atividades, exceções para datas específicas (feriados, consultas, viagens), tarefas fixas da semana, regras e configurações de alertas.',
    '',
    'Regras ao mexer na rotina: antes de alterar, mostre o que vai mudar; para mudar só uma data use uma exceção (salvar_excecao) em vez de mexer na rotina semanal; qualquer alteração pode ser revertida com desfazer_ultima_alteracao.'
  ].join('\n');
}

module.exports = { detectConnections, buildAgentPrompt, clientTargets };
