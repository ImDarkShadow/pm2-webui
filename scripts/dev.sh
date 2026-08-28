#!/usr/bin/env bash
set -e

echo "Starting PM2 Cluster Manager development environment..."
pnpm install
pnpm --filter @pm2-cluster/shared build
pnpm --filter @pm2-cluster/agent-core build

# Start master in background and vite web server
(cd packages/master && pnpm start) &
(cd packages/web && pnpm dev) &

wait
