/**
 * Verificación de "compilación" para Node: comprueba que todos los .js del
 * proyecto (index.js, src/, scripts/) parsean sin errores de sintaxis.
 * Uso: npm run verify:syntax
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../..');
const targets = ['index.js', 'src', 'scripts'];

const collect = (entry) => {
  const full = path.join(root, entry);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return full.endsWith('.js') ? [full] : [];
  return fs.readdirSync(full).flatMap((name) => (name === 'node_modules' ? [] : collect(path.join(entry, name))));
};

const files = targets.flatMap(collect);
const failures = files.filter((file) => {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) console.error(`✗ ${path.relative(root, file)}\n${result.stderr}`);
  return result.status !== 0;
});

console.log(`${files.length - failures.length}/${files.length} archivos con sintaxis válida.`);
process.exit(failures.length ? 1 : 0);
