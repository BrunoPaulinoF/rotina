'use strict';
/**
 * Publica uma versão no GitHub Releases para o botão "Atualizar" do app encontrar.
 * Uso: 1) aumente "version" no package.json  2) faça commit e push  3) npm run release
 * Requer o GitHub CLI (gh) autenticado.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const tag = 'v' + version;
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
const out = (cmd) => execSync(cmd, { cwd: root }).toString().trim();

try {
  out('gh release view ' + tag);
  console.error('A release ' + tag + ' já existe. Aumente "version" no package.json.');
  process.exit(1);
} catch (_) { /* não existe: segue */ }

if (out('git status --porcelain')) {
  console.error('Há alterações sem commit. Faça commit e push antes de publicar.');
  process.exit(1);
}

run('npm run dist');

const files = ['RotinaDesktop-Setup-' + version + '.exe', 'RotinaDesktop-Setup-' + version + '.exe.blockmap', 'latest.yml']
  .map((f) => path.join('dist', f))
  .concat([path.join('build', 'RotinaDesktop.mcpb')])
  .filter((f) => fs.existsSync(path.join(root, f)));
if (!files.some((f) => f.endsWith('latest.yml'))) {
  console.error('dist/latest.yml não foi gerado; o app não conseguiria verificar o download.');
  process.exit(1);
}

run('gh release create ' + tag + ' ' + files.map((f) => '"' + f + '"').join(' ') + ' --title "Rotina Desktop ' + version + '" --generate-notes --target main');
console.log('Publicado: ' + tag + '. Os apps instalados vão encontrar a atualização em "Verificar atualizações".');
