import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { registerApiRoutes, ApiRoutesDeps } from './api/index.js';

export interface MasterServerOptions extends ApiRoutesDeps {
  readonly port?: number;
  readonly host?: string;
  readonly webDistPath?: string;
}

export interface MasterServer {
  readonly fastify: FastifyInstance;
  readonly start: () => Promise<string>;
  readonly stop: () => Promise<void>;
}

export const createMasterServer = async (options: MasterServerOptions): Promise<MasterServer> => {
  const { port = 3005, host = '0.0.0.0', webDistPath, ...apiDeps } = options;

  const app = fastify({
    logger: true,
    disableRequestLogging: false,
  });

  // Gracefully handle application/json with empty or whitespace bodies
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      if (!body || body.trim() === '') {
        done(null, {});
        return;
      }
      try {
        const json = JSON.parse(body);
        done(null, json);
      } catch (err: any) {
        err.statusCode = 400;
        done(err, undefined);
      }
    },
  );

  // Security & Performance Plugins
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // Vite React SPA in dev/prod
  });

  await app.register(rateLimit, {
    max: 2000,
    timeWindow: '1 minute',
  });

  await app.register(websocket);

  // Register all API routes & WebSocket gateway
  await registerApiRoutes(app, apiDeps);

  // Serve static UI bundle if webDistPath exists
  if (webDistPath && fs.existsSync(webDistPath)) {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
    });

    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
        reply.status(404).send({ code: 'NOT_FOUND', message: 'API route not found' });
      } else {
        reply.sendFile('index.html');
      }
    });
  }

  const start = async (): Promise<string> => {
    const address = await app.listen({ port, host });
    return address;
  };

  const stop = async (): Promise<void> => {
    await app.close();
  };

  return {
    fastify: app,
    start,
    stop,
  };
};
