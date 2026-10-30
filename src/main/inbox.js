'use strict';
/**
 * Pasta de comunicação para agentes que só manipulam arquivos (ex.: Claude Cowork).
 * Fica em Documentos\Rotina Desktop — fora do AppData, então não sofre o desvio de
 * arquivos de apps da Microsoft Store e o agente só precisa de permissão de pasta.
 *
 *   pedidos\<nome>.json    { "ferramenta": "ver_agora", "argumentos": {} }   (o agente grava)
 *   respostas\<nome>.json  { "ok": true, "resultado": "..." }                (o app responde)
 */

const fs = require('fs');
const path = require('path');

const RESPONSE_TTL_MS = 24 * 60 * 60 * 1000;

function startInbox(root, handler, log) {
  const requests = path.join(root, 'pedidos');
  const responses = path.join(root, 'respostas');
  fs.mkdirSync(requests, { recursive: true });
  fs.mkdirSync(responses, { recursive: true });
  const busy = new Set();

  async function processFile(name) {
    if (!name.toLowerCase().endsWith('.json') || busy.has(name)) return;
    const file = path.join(requests, name);
    busy.add(name);
    try {
      let text;
      try {
        text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
      } catch (_) {
        return; // já processado ou removido
      }
      let req;
      try {
        req = JSON.parse(text);
      } catch (err) {
        // Pode estar no meio da gravação: tenta de novo na próxima varredura, até 10 s.
        if (Date.now() - fs.statSync(file).mtimeMs < 10000) return;
        req = null;
      }
      let out;
      if (!req || typeof req !== 'object') {
        out = { ok: false, erro: 'JSON inválido. Formato: {"ferramenta": "ver_agora", "argumentos": {}}' };
      } else {
        const tool = req.ferramenta || req.tool;
        try {
          out = { ok: true, ferramenta: tool, resultado: await handler(String(tool || ''), req.argumentos || req.args || {}) };
        } catch (err) {
          out = { ok: false, ferramenta: tool, erro: err.message };
        }
      }
      out.respondidoEm = new Date().toISOString();
      const dest = path.join(responses, name);
      fs.writeFileSync(dest + '.tmp', JSON.stringify(out, null, 2), 'utf8');
      fs.renameSync(dest + '.tmp', dest);
      fs.unlinkSync(file);
      if (log) log('Pedido de agente pela pasta: ' + name + (out.ok ? '' : ' (erro: ' + out.erro + ')'));
    } catch (err) {
      if (log) log('Falha ao processar pedido ' + name + ': ' + err.message);
    } finally {
      busy.delete(name);
    }
  }

  function scan() {
    let names = [];
    try {
      names = fs.readdirSync(requests);
    } catch (_) {
      return;
    }
    names.forEach((n) => processFile(n));
    // limpa respostas antigas
    try {
      for (const n of fs.readdirSync(responses)) {
        const f = path.join(responses, n);
        if (Date.now() - fs.statSync(f).mtimeMs > RESPONSE_TTL_MS) fs.unlinkSync(f);
      }
    } catch (_) { /* nada a limpar */ }
  }

  let watcher = null;
  try {
    watcher = fs.watch(requests, () => setTimeout(scan, 150));
  } catch (_) { /* a varredura periódica cobre */ }
  // Pastas sincronizadas (OneDrive) nem sempre avisam mudanças: varre também a cada 2 s.
  const timer = setInterval(scan, 2000);
  scan();
  return {
    requests,
    responses,
    scan,
    stop() {
      clearInterval(timer);
      if (watcher) watcher.close();
    }
  };
}

module.exports = { startInbox };
