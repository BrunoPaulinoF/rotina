'use strict';
/** Verificação de sintaxe de todos os arquivos JS do app (sem dependências). Uso: npm run check */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const roots = ['src', 'scripts', 'test'].map((d) => path.join(__dirname, '..', d));
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
};
roots.forEach(walk);

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error('✖ ' + path.relative(process.cwd(), f) + '\n' + err.stderr.toString());
  }
}
console.log(failed ? failed + ' arquivo(s) com erro de sintaxe.' : '✔ ' + files.length + ' arquivos JS sem erros de sintaxe.');
process.exit(failed ? 1 : 0);
