#!/usr/bin/env node
'use strict';
/**
 * Acesso de agentes de IA à Rotina Desktop.
 *
 *  MCP (Claude Desktop/Cowork, Claude Code, Cursor...):   server.js
 *  Linha de comando:                                       server.js --cli <ferramenta> chave=valor ...
 *                                                          server.js --cli ajuda
 *
 * Sem Node instalado, rode pelo próprio app: defina ELECTRON_RUN_AS_NODE=1 e execute
 * RotinaDesktop.exe com o caminho deste arquivo (dentro de resources\app.asar).
 */

const readline = require('readline');
const { TOOLS, INSTRUCTIONS, callTool, ToolError } = require('./tools');

const VERSION = '1.1.0';
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const LIST_KEYS = new Set(['days', 'remover_ids', 'restaurar_ids', 'remover_extras', 'itens']);

/**
 * Aceita um JSON ('{"title":"X"}') ou pares chave=valor (title="Academia" start=19:00 days=seg,qua).
 * Pares funcionam em qualquer shell; o PowerShell 5 remove as aspas internas de JSON.
 */
function parseCliArgs(list) {
  if (!list.length) return {};
  if (list.length === 1 && list[0].trim().startsWith('{')) return JSON.parse(list[0]);
  const out = {};
  for (const item of list) {
    const i = item.indexOf('=');
    if (i <= 0) throw new Error('use chave=valor (recebido: "' + item + '")');
    const key = item.slice(0, i);
    const raw = item.slice(i + 1);
    let value = raw;
    if (/^(true|false)$/.test(raw)) value = raw === 'true';
    else if (/^-?\d+$/.test(raw) && !LIST_KEYS.has(key)) value = Number(raw);
    else if (/^[[{]/.test(raw)) value = JSON.parse(raw);
    if (LIST_KEYS.has(key) && typeof value === 'string') value = value.split(',').map((x) => x.trim()).filter(Boolean);
    if (LIST_KEYS.has(key) && typeof value === 'number') value = [value];
    out[key] = value;
  }
  return out;
}

async function runCli(argv) {
  const name = argv[0];
  if (!name || name === 'ajuda' || name === '--help') {
    console.log(INSTRUCTIONS + '\n\nFerramentas:\n' + TOOLS.map((t) => '  ' + t.name.padEnd(26) + t.description).join('\n') + '\n\nUso: --cli <ferramenta> chave=valor ...   (ex.: --cli salvar_atividade title="Academia" start=19:00 end=20:00 days=seg,qua)\n     ou --cli <ferramenta> \'{"json":"..."}\' (em shells que preservam aspas)');
    return 0;
  }
  let args;
  try {
    args = parseCliArgs(argv.slice(1));
  } catch (err) {
    console.error('Argumentos inválidos: ' + err.message);
    return 2;
  }
  try {
    console.log(await callTool(name, args));
    return 0;
  } catch (err) {
    console.error('Erro: ' + err.message);
    return 1;
  }
}

function runMcp() {
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  const handlers = {
    initialize: (p) => ({
      protocolVersion: PROTOCOL_VERSIONS.includes(p && p.protocolVersion) ? p.protocolVersion : PROTOCOL_VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: { name: 'rotina-desktop', title: 'Rotina Desktop', version: VERSION },
      instructions: INSTRUCTIONS
    }),
    ping: () => ({}),
    'tools/list': () => ({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }),
    'tools/call': async (p) => {
      try {
        const text = await callTool(p.name, p.arguments);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        // Erros de uso voltam como resultado para o agente poder corrigir a chamada.
        return { content: [{ type: 'text', text: 'Erro: ' + err.message }], isError: true };
      }
    }
  };

  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (_) {
      return error(null, -32700, 'JSON inválido');
    }
    if (msg.id === undefined) return; // notificação (ex.: notifications/initialized)
    const h = handlers[msg.method];
    if (!h) return error(msg.id, -32601, 'Método não suportado: ' + msg.method);
    try {
      reply(msg.id, await h(msg.params || {}));
    } catch (err) {
      error(msg.id, err instanceof ToolError ? -32602 : -32603, err.message);
    }
  });
  rl.on('close', () => process.exit(0));
}

const cliIndex = process.argv.indexOf('--cli');
if (cliIndex >= 0) runCli(process.argv.slice(cliIndex + 1)).then((code) => process.exit(code));
else runMcp();
