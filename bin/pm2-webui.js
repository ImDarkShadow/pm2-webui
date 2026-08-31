#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const getVersion = () => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    return pkg.version || '1.1.0';
  } catch {
    return '1.1.0';
  }
};

const args = process.argv.slice(2);
const command = args[0];

if (command === '--help' || command === '-h' || command === 'help') {
  console.log(`
PM2 Web UI — Real-time Multi-Node Cluster Control Plane

Usage:
  npx pm2-webui [command] [options]

Commands:
  master, server    Start Master Server & Web UI dashboard (default)
  agent, worker     Start Worker Agent node connected to a master

Environment Variables:
  PORT              Master HTTP/WebSocket port (default: 3005)
  MASTER_WS_URL     Target Master URL for worker agent (e.g. http://master-ip:3005)
  JOIN_TOKEN        Cluster join token for automatic enrollment
  AGENT_HOSTNAME    Custom hostname for the worker node
  AGENT_PORT        Local agent port (default: 4321)

Examples:
  npx pm2-webui
  MASTER_WS_URL="http://192.168.1.10:3005" npx pm2-webui agent
`);
  process.exit(0);
}

if (command === '--version' || command === '-v') {
  console.log(`pm2-webui v${getVersion()}`);
  process.exit(0);
}

let targetScript;
const remainingArgs =
  command === 'master' || command === 'server' || command === 'agent' || command === 'worker'
    ? args.slice(1)
    : args;

if (command === 'agent' || command === 'worker') {
  targetScript = path.join(rootDir, 'packages/agent-core/dist/index.js');
} else {
  targetScript = path.join(rootDir, 'packages/master/dist/index.js');
}

const child = spawn(process.execPath, [targetScript, ...remainingArgs], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
