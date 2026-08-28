#!/usr/bin/env bash
set -e

# PM2 Cluster Manager — Remote Agent Automated Installer
# Usage: MASTER_URL=http://your-master-ip:3005 bash <(curl -s https://.../install-agent.sh)

MASTER_URL="${MASTER_WS_URL:-http://localhost:3005}"
INSTALL_DIR="/opt/pm2-cluster-agent"

echo "=== Installing PM2 Cluster Agent ==="
echo "Master URL: $MASTER_URL"

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js 20+ first."
    exit 1
fi

if ! command -v pm2 &> /dev/null; then
    echo "PM2 is not installed. Installing PM2 globally..."
    npm install -g pm2
fi

echo "Agent setup successfully initialized."
