'use strict';
/**
 * Conexão de agentes de IA: prompt universal para colar em qualquer agente, guia da pasta
 * de comunicação e detecção (somente leitura) de quais aplicativos já usam o Rotina Desktop.
 */

const fs = require('fs');
const path = require('path');
const { TOOLS } = require('../agent/tools');

const SERVER_KEYS = ['rotina-desktop', 'rotina'];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (_) {
    return null;
  }
}

const hasServer = (obj) => !!obj && SERVER_KEYS.some((k) => obj[k]);

function listDirs(parent, re) {
  try {
    return fs.readdirSync(parent).filter((d) => re.test(d)).map((d) => path.join(parent, d)).filter((d) => fs.statSync(d).isDirectory());
  } catch (_) {
    return [];
  }
}

/**
 * Pastas de dados do Claude Desktop em uso. A versão da Microsoft Store guarda tudo em
 * %LOCALAPPDATA%\Claude-Data\claude_<pacote>; a instalação clássica usa %APPDATA%\Claude.
 */
function claudeDesktopDirs(dirs) {
  const store = listDirs(path.join(dirs.localAppData, 'Claude-Data'), /^claude_/i);
  if (store.length) return store;
  const classic = path.join(dirs.appData, 'Claude');
  return fs.existsSync(classic) ? [classic] : [];
}

function claudeDesktopHasRotina(dir) {
  for (const ext of listDirs(path.join(dir, 'Claude Extensions'), /./)) {
    const m = readJson(path.join(ext, 'manifest.json'));
    if (m && SERVER_KEYS.includes(m.name)) return true;
  }
  const cfg = readJson(path.join(dir, 'claude_desktop_config.json'));
  return hasServer(cfg && cfg.mcpServers);
}

function jsonClient(id, name, dir, file, key, projects) {
  return { id, name, dirs: [dir], check: (d) => {
    const j = readJson(path.join(d, file));
    if (!j) return false;
    if (hasServer(j[key])) return true;
    return !!projects && !!j.projects && Object.values(j.projects).some((p) => p && hasServer(p.mcpServers));
  } };
}

function clientTargets(dirs) {
  const { home, appData } = dirs;
  return [
    { id: 'claude-desktop', name: 'Claude Desktop / Cowork', dirs: claudeDesktopDirs(dirs), check: claudeDesktopHasRotina },
    jsonClient('claude-code', 'Claude Code', home, '.claude.json', 'mcpServers', true),
    jsonClient('cursor', 'Cursor', path.join(home, '.cursor'), 'mcp.json', 'mcpServers'),
    jsonClient('vscode', 'VS Code (Copilot)', path.join(appData, 'Code', 'User'), 'mcp.json', 'servers'),
    jsonClient('windsurf', 'Windsurf', path.join(home, '.codeium', 'windsurf'), 'mcp_config.json', 'mcpServers'),
    { id: 'codex', name: 'Codex CLI', dirs: [path.join(home, '.codex')], check: (d) => {
      try {
        return /^\s*\[mcp_servers\.(rotina-desktop|rotina|"rotina-desktop")\]/m.test(fs.readFileSync(path.join(d, 'config.toml'), 'utf8'));
      } catch (_) {
        return false;
      }
    } },
    jsonClient('gemini', 'Gemini CLI', path.join(home, '.gemini'), 'settings.json', 'mcpServers')
  ];
}

/**
 * Para cada aplicativo: "conectado", "nao-conectado" (instalado, sem o Rotina Desktop)
 * ou "ausente" (não encontrado neste computador).
 */
function detectConnections(dirs) {
  return clientTargets(dirs).map((t) => {
    const present = t.dirs.filter((d) => fs.existsSync(d));
    const connected = present.some((d) => t.check(d));
    return { id: t.id, name: t.name, status: connected ? 'conectado' : present.length ? 'nao-conectado' : 'ausente' };
  });
}

/** Prompt para colar em qualquer agente. Cada caminho é algo que aquele tipo de agente consegue fazer sozinho. */
function buildAgentPrompt(info) {
  const req = path.join(info.inboxDir, 'pedidos', '001-ver-agora.json');
  return [
    'Quero que você consulte e altere a minha rotina diária, que fica no app Rotina Desktop instalado neste computador (Windows).',
    'Atenção: isto NÃO tem relação com as "rotinas" (tarefas agendadas) do próprio Claude nem com outros conectores. É um aplicativo separado, chamado Rotina Desktop.',
    '',
    'Antes de cada passo que precise de permissão (acessar pasta, rodar comando, editar configuração), diga em uma frase o que vai fazer e peça.',
    '',
    '1) JÁ TEM AS FERRAMENTAS? Veja se você tem ferramentas como ver_agora, ver_dia e salvar_atividade (servidor "rotina-desktop", "Rotina Desktop" ou "rotina"). Se tiver, use-as e vá para a CONFIRMAÇÃO.',
    '',
    '2) SE VOCÊ É O CLAUDE NO CLAUDE DESKTOP / COWORK (ou qualquer agente que acessa pastas): use a pasta de comunicação do app. Não precisa instalar nada.',
    '   a. Peça acesso à pasta: ' + info.inboxDir,
    '   b. Leia o arquivo "LEIA-ME para agentes de IA.md" dessa pasta: ele lista todas as ferramentas e parâmetros.',
    '   c. Para usar uma ferramenta, crie um arquivo .json com nome único dentro de "pedidos". Exemplo: ' + req,
    '      com o conteúdo: {"ferramenta": "ver_agora", "argumentos": {}}',
    '   d. Em 1 a 3 segundos o app apaga o pedido e grava a resposta, com o mesmo nome, dentro de "respostas" (campos "ok" e "resultado" ou "erro"). Leia a resposta.',
    '   e. Se a resposta não aparecer em 15 segundos, o app está fechado: me peça para abrir o Rotina Desktop (ícone perto do relógio).',
    '   Use sempre pedidos/respostas; não edite outros arquivos do app. Você NÃO consegue instalar servidores MCP no Claude Desktop sozinho (a configuração do Claude é protegida), então não tente.',
    '   No fim, sugira (opcional) que eu instale a extensão para ter as ferramentas nativas: no Rotina Desktop, Configurações → Agentes de IA → "Instalar no Claude Desktop". Ele abre a pasta com o arquivo RotinaDesktop.mcpb; eu arrasto esse arquivo para a janela do Claude Desktop (ou Configurações do Claude → Extensões → Configurações avançadas → Instalar extensão) e clico em Instalar. As ferramentas aparecem numa nova conversa.',
    '',
    '3) SE VOCÊ É O CLAUDE CODE: peça permissão e rode este comando; as ferramentas aparecem numa nova sessão (até lá, use a pasta do item 2):',
    '   ' + info.claudeCode,
    '',
    '4) OUTROS APPS COM MCP (Cursor, VS Code/Copilot, Windsurf, Codex, Gemini...): peça permissão e adicione este servidor MCP stdio na configuração do seu app, preservando os servidores que já existem (faça uma cópia do arquivo antes):',
    info.mcpJson,
    '   Em Codex (config.toml): [mcp_servers.rotina-desktop] com command = ' + JSON.stringify(info.command) + ', args = [' + JSON.stringify(info.server) + '] e env = { ' + Object.entries(info.env).map(([k, v]) => k + ' = ' + JSON.stringify(v)).join(', ') + ' }. No VS Code, a chave é "servers" e o servidor leva "type": "stdio".',
    '   Diga se preciso reiniciar o app ou abrir uma nova conversa. Até lá, use a pasta do item 2.',
    '',
    '5) SE VOCÊ SÓ RODA COMANDOS NO TERMINAL (PowerShell), com argumentos no formato chave=valor:',
    '   ' + info.cli,
    '',
    'CONFIRMAÇÃO: mostre o que tenho agora na rotina (ferramenta ver_agora) e explique em poucas linhas o que consegue fazer: ver o dia e a semana, criar/editar/remover atividades, exceções para datas específicas (feriados, consultas, viagens), tarefas fixas da semana, regras e alertas.',
    '',
    'REGRAS: antes de alterar, mostre o que vai mudar e espere meu ok; para mudar só uma data, use salvar_excecao (não mexa na rotina semanal); qualquer alteração pode ser desfeita com desfazer_ultima_alteracao.'
  ].join('\n');
}

function describeParams(schema) {
  const props = (schema && schema.properties) || {};
  const required = (schema && schema.required) || [];
  const names = Object.keys(props);
  if (!names.length) return '  (sem parâmetros)';
  return names.map((n) => {
    const p = props[n];
    const type = Array.isArray(p.type) ? p.type.join(' | ') : p.type || 'objeto';
    return '  - `' + n + '` (' + type + (required.includes(n) ? ', obrigatório' : '') + ')' + (p.enum ? ' — valores: ' + p.enum.join(', ') : '') + (p.description ? ' — ' + p.description : '');
  }).join('\n');
}

/** Guia da pasta de comunicação, gerado a partir das ferramentas (sempre atualizado). */
function buildAgentGuide(info) {
  return [
    '# Rotina Desktop — guia para agentes de IA',
    '',
    'Esta pasta é a forma de um agente de IA (como o Claude Cowork) consultar e alterar a rotina do app **Rotina Desktop**.',
    'Não tem relação com as "rotinas"/tarefas agendadas do Claude. Este arquivo é regerado pelo app; não edite.',
    '',
    '## Como usar',
    '',
    '1. Crie um arquivo `.json` com nome único dentro de `pedidos\\` (ex.: `pedidos\\002-dia-de-amanha.json`):',
    '   ```json',
    '   { "ferramenta": "ver_dia", "argumentos": { "data": "amanhã" } }',
    '   ```',
    '2. Em 1 a 3 segundos o app executa, apaga o pedido e grava `respostas\\<mesmo nome>.json`:',
    '   ```json',
    '   { "ok": true, "ferramenta": "ver_dia", "resultado": "Sábado, ...", "respondidoEm": "..." }',
    '   ```',
    '   Em caso de problema: `{ "ok": false, "erro": "..." }` — corrija os argumentos e tente de novo com outro nome.',
    '3. Sem resposta em 15 segundos: o app está fechado. Peça ao usuário para abrir o Rotina Desktop.',
    '',
    'Regras: antes de alterar, mostre ao usuário o que vai mudar e espere o ok. Para mudar só uma data, use `salvar_excecao`.',
    'Qualquer alteração pode ser desfeita com `desfazer_ultima_alteracao`. Não edite outros arquivos do app.',
    '',
    '## Exemplos',
    '',
    '```json',
    '{ "ferramenta": "ver_agora", "argumentos": {} }',
    '{ "ferramenta": "ver_semana", "argumentos": {} }',
    '{ "ferramenta": "salvar_atividade", "argumentos": { "title": "Academia", "start": "19:00", "end": "20:00", "days": ["seg", "qua"], "category": "corpo", "icon": "dumbbell" } }',
    '{ "ferramenta": "salvar_atividade", "argumentos": { "id": "foco1", "start": "08:45" } }',
    '{ "ferramenta": "salvar_excecao", "argumentos": { "data": "2026-12-25", "tipo": "livre", "nota": "Natal" } }',
    '{ "ferramenta": "desfazer_ultima_alteracao", "argumentos": {} }',
    '```',
    '',
    '## Ferramentas',
    '',
    TOOLS.map((t) => '### ' + t.name + '\n' + t.description + '\n' + describeParams(t.inputSchema)).join('\n\n'),
    '',
    '## Outras formas de conexão',
    '',
    '- **Extensão do Claude Desktop/Cowork:** arraste `RotinaDesktop.mcpb` (nesta pasta) para a janela do Claude Desktop e clique em Instalar.',
    '- **Claude Code:** `' + info.claudeCode + '`',
    '- **Outros clientes MCP (stdio):**',
    '```json',
    info.mcpJson,
    '```',
    '- **Linha de comando (PowerShell):** `' + info.cli + '`'
  ].join('\n');
}

module.exports = { detectConnections, buildAgentPrompt, buildAgentGuide, clientTargets };
