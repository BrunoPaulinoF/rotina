'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { build, manifest } = require('../scripts/build-mcpb');

test('manifest da extensão segue o formato 0.3 (igual às extensões já instaladas no Claude)', () => {
  const m = manifest();
  assert.equal(m.manifest_version, '0.3');
  for (const k of ['name', 'version', 'description', 'author', 'server']) assert.ok(m[k], k);
  assert.equal(m.name, 'rotina-desktop');
  assert.equal(m.server.type, 'node');
  assert.equal(m.server.mcp_config.command, 'node');
  assert.deepEqual(m.server.mcp_config.args, ['${__dirname}/' + m.server.entry_point]);
  assert.equal(m.server.mcp_config.env.ROTINA_REQUIRE_APP, '1');
  assert.ok(m.tools.length >= 17);
});

test('arquivo .mcpb é um zip válido e o servidor dentro dele responde ao MCP', async () => {
  const file = build();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotina-mcpb-'));
  execFileSync('tar', ['-xf', file, '-C', dir]);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const entry = path.join(dir, m.server.entry_point);
  assert.ok(fs.existsSync(entry));
  assert.ok(fs.existsSync(path.join(dir, m.icon)));

  const reply = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], { env: Object.assign({}, process.env, { ROTINA_DATA_DIR: dir }) });
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      if (buf.includes('\n')) {
        child.stdin.end();
        resolve(JSON.parse(buf.split('\n')[0]));
      }
    });
    child.on('error', reject);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
  });
  assert.equal(reply.result.serverInfo.name, 'rotina-desktop');
});
