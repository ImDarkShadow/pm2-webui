import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadAgentConfig, AgentConfig } from './config/index.js';
import { createAgentCore, AgentCore } from './createAgentCore.js';

export * from './config/index.js';
export * from './db/index.js';
export * from './pm2/index.js';
export * from './pm2/listener.js';
export * from './metrics/index.js';
export * from './logging/index.js';
export * from './deploy/index.js';
export * from './transport/masterWsClient.js';
export * from './transport/agentWsServer.js';
export * from './createAgentCore.js';

export interface StartAgentResult {
  readonly agentCore: AgentCore;
  readonly server: http.Server;
}

export const startAgentNode = async (
  overrides: Partial<AgentConfig> = {},
): Promise<StartAgentResult> => {
  const config = loadAgentConfig(overrides);
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ status: 'ok', agentId: agentCore.agentId, hostname: config.hostname }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const agentCore = createAgentCore({
    config,
    httpServer: server,
    logger: console,
  });

  server.listen(config.port, () => {
    console.log(`📡 Agent HTTP/WS Server listening on port ${config.port}`);
  });

  const startRes = await agentCore.start();
  if (!startRes.ok) {
    console.error('Failed to start Agent Core:', startRes.error);
  }

  console.log(
    `🚀 PM2 Cluster Agent started [ID: ${agentCore.agentId}, Hostname: ${config.hostname}]`,
  );
  if (config.masterWsUrl) {
    console.log(`🔗 Connecting to Master at: ${config.masterWsUrl}`);
  } else {
    console.warn('⚠️ No MASTER_WS_URL specified. Agent running in standalone mode.');
  }

  const shutdown = () => {
    console.log('🛑 Shutting down PM2 Cluster Agent...');
    agentCore.stop();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { agentCore, server };
};

const isDirectExecution = () => {
  if (!process.argv[1]) return false;
  try {
    const currentFilePath = fileURLToPath(import.meta.url);
    return (
      currentFilePath === process.argv[1] ||
      (process.argv[1].includes('agent-core') && process.argv[1].endsWith('index.js'))
    );
  } catch {
    return false;
  }
};

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST && isDirectExecution()) {
  startAgentNode().catch((err) => {
    console.error('Fatal error starting Agent:', err);
    process.exit(1);
  });
}
