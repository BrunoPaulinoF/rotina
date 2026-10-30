'use strict';
/**
 * Gera build/RotinaDesktop.mcpb: extensão de desktop do Claude (Claude Desktop / Cowork).
 * É um zip com manifest.json na raiz e o servidor MCP do app. O Claude roda com o Node embutido dele.
 * Uso: npm run mcpb (também roda antes de npm run dist).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const { TOOLS } = require(path.join(root, 'src', 'agent', 'tools.js'));
const OUT = path.join(root, 'build', 'RotinaDesktop.mcpb');

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Zip simples (deflate), suficiente para o formato .mcpb. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // data/hora
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, deflated);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + deflated.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

function manifest() {
  return {
    manifest_version: '0.3',
    name: 'rotina-desktop',
    display_name: 'Rotina Desktop',
    version: pkg.version,
    description: 'Consulte e altere a rotina diária do app Rotina Desktop (horários, atividades, exceções de datas, alertas).',
    long_description: 'Conecta o Claude ao app Rotina Desktop instalado neste computador. Não confundir com as "rotinas" (tarefas agendadas) do próprio Claude. O app Rotina Desktop precisa estar instalado; se estiver fechado, a extensão tenta abri-lo.',
    author: { name: 'Rotina Desktop', url: 'https://github.com/BrunoPaulinoF/rotina' },
    repository: { type: 'git', url: 'https://github.com/BrunoPaulinoF/rotina' },
    homepage: 'https://github.com/BrunoPaulinoF/rotina',
    icon: 'icon.png',
    server: {
      type: 'node',
      entry_point: 'server/agent/server.js',
      mcp_config: {
        command: 'node',
        args: ['${__dirname}/server/agent/server.js'],
        // Na extensão, as alterações passam sempre pelo app aberto (ver src/agent/bridge.js).
        env: { ROTINA_REQUIRE_APP: '1' }
      }
    },
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    keywords: ['rotina', 'agenda', 'horarios', 'produtividade'],
    license: 'UNLICENSED',
    compatibility: { platforms: ['win32'], runtimes: { node: '>=18.0.0' } }
  };
}

function build() {
  const files = [
    ['src/agent/server.js', 'server/agent/server.js'],
    ['src/agent/tools.js', 'server/agent/tools.js'],
    ['src/agent/bridge.js', 'server/agent/bridge.js'],
    ['src/shared/engine.js', 'server/shared/engine.js'],
    ['src/main/store.js', 'server/main/store.js'],
    ['src/main/defaults.js', 'server/main/defaults.js'],
    ['src/main/history.js', 'server/main/history.js'],
    ['assets/icon.png', 'icon.png']
  ];
  const entries = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest(), null, 2)) },
    // server.js lê a versão de ../../package.json
    { name: 'package.json', data: Buffer.from(JSON.stringify({ name: 'rotina-desktop-mcpb', version: pkg.version, private: true }, null, 2)) }
  ];
  for (const [from, to] of files) entries.push({ name: to, data: fs.readFileSync(path.join(root, from)) });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, zip(entries));
  return OUT;
}

if (require.main === module) console.log('Extensão gerada: ' + build());

module.exports = { build, manifest, zip, OUT };
