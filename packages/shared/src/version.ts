import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

declare const __APP_VERSION__: string | undefined;

function getPackageVersion(): string {
  if (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) {
    return __APP_VERSION__;
  }
  try {
    let dir = typeof import.meta?.url === 'string' ? path.dirname(fileURLToPath(import.meta.url)) : process.cwd();
    for (let i = 0; i < 6; i++) {
      const target = path.join(dir, 'package.json');
      if (fs.existsSync(target)) {
        const pkg = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (pkg.name === 'pm2-webui' && pkg.version) {
          return pkg.version;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // fallback
  }
  return '1.1.2';
}

export const APP_VERSION = getPackageVersion();
