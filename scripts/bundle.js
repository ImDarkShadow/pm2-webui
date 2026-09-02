import esbuild from 'esbuild';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const external = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  'node:*',
].filter((name) => !name.startsWith('@pm2-webui/'));

await Promise.all([
  esbuild.build({
    entryPoints: ['packages/master/src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: 'dist/master.js',
    external,
  }),
  esbuild.build({
    entryPoints: ['packages/agent-core/src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: 'dist/agent.js',
    external,
  }),
]);

console.log('✅ Standalone bundle complete: dist/master.js and dist/agent.js');
