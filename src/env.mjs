import fs from 'node:fs';
import path from 'node:path';

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key) || process.env[key] != null) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export function loadLocalEnv(root = process.cwd()) {
  if (process.env.NODE_ENV === 'production') return;
  parseEnvFile(path.resolve(root, '.env.local'));
  parseEnvFile(path.resolve(root, '.env'));
}
