#!/usr/bin/env bash
set -e

echo "Starting PM2 Web UI development environment..."
pnpm install
pnpm --filter @pm2-webui/shared build
pnpm --filter @pm2-webui/agent-core build

# Start master in background and vite web server
(cd packages/master && pnpm start) &
(cd packages/web && pnpm dev) &

wait
