/** Utilidades mínimas de CLI para los scripts (sin dependencias). */

const hasFlag = (name) => process.argv.includes(`--${name}`);

const getOption = (name, fallback = null) => {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  return fallback;
};

const getIntOption = (name, fallback = null) => {
  const raw = getOption(name);
  if (raw === null) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < 0) {
    throw new Error(`--${name} debe ser un entero >= 0 (recibido: "${raw}").`);
  }
  return value;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { hasFlag, getOption, getIntOption, sleep };
