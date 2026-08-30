#!/usr/bin/env bash
set -e

# ==============================================================================
# PM2 Web UI — Automated Worker Node Installer
# ==============================================================================
# Quick Install:
#   curl -fsSL http://<master-ip>:3005/install.sh | bash
#
# Custom Options:
#   curl -fsSL http://<master-ip>:3005/install.sh | bash -s -- \
#     --master="http://<master-ip>:3005" \
#     --token="<JOIN_TOKEN>" \
#     --name="worker-01"
# ==============================================================================

BOLD='\033[1m'
GREEN='\033[0;32m'
SKY='\033[0;36m'
AMBER='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${SKY}${BOLD}======================================================${NC}"
echo -e "${SKY}${BOLD}   PM2 Web UI — Worker Node Installer        ${NC}"
echo -e "${SKY}${BOLD}======================================================${NC}\n"

# Default configuration
DEFAULT_MASTER="${MASTER_WS_URL:-http://localhost:3005}"
MASTER_URL="$DEFAULT_MASTER"
JOIN_TOKEN="${JOIN_TOKEN:-}"
AGENT_HOSTNAME="${AGENT_HOSTNAME:-$(hostname)}"
AGENT_PORT="${AGENT_PORT:-4321}"
INSTALL_DIR="/opt/pm2-webui-agent"

# Parse CLI arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --master=*)
      MASTER_URL="${1#*=}"
      shift
      ;;
    --master)
      MASTER_URL="$2"
      shift 2
      ;;
    --token=*)
      JOIN_TOKEN="${1#*=}"
      shift
      ;;
    --token)
      JOIN_TOKEN="$2"
      shift 2
      ;;
    --name=*)
      AGENT_HOSTNAME="${1#*=}"
      shift
      ;;
    --name)
      AGENT_HOSTNAME="$2"
      shift 2
      ;;
    --port=*)
      AGENT_PORT="${1#*=}"
      shift
      ;;
    --port)
      AGENT_PORT="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

echo -e "⚙️  Target Master:   ${GREEN}${MASTER_URL}${NC}"
echo -e "🏷️  Node Hostname:   ${GREEN}${AGENT_HOSTNAME}${NC}"
echo -e "🔌 Agent Port:      ${GREEN}${AGENT_PORT}${NC}"
if [ -n "$JOIN_TOKEN" ]; then
  echo -e "🔑 Join Token:      ${GREEN}[Configured]${NC}"
else
  echo -e "🔑 Join Token:      ${AMBER}[None - Manual Approval Required]${NC}"
fi

echo -e "\n1. Checking environment prerequisites..."

# Verify or install Node.js
if ! command -v node &> /dev/null; then
    echo -e "${AMBER}⚠️  Node.js not detected.${NC}"
    echo "Installing Node.js 22 LTS via NodeSource..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update -y && sudo apt-get install -y curl
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v yum &> /dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
        sudo yum install -y nodejs
    elif command -v dnf &> /dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
        sudo dnf install -y nodejs
    else
        echo -e "${RED}❌ Please install Node.js 20+ manually and rerun this script.${NC}"
        exit 1
    fi
fi
echo -e "${GREEN}✓ Node.js $(node -v) is available.${NC}"

# Verify or install PM2 globally
if ! command -v pm2 &> /dev/null; then
    echo -e "${AMBER}⚠️  PM2 not found. Installing PM2 globally...${NC}"
    npm install -g pm2
fi
echo -e "${GREEN}✓ PM2 $(pm2 -v) is ready.${NC}"

# Setup installation directory
echo -e "\n2. Preparing installation directory (${INSTALL_DIR})..."
if [ "$EUID" -eq 0 ]; then
    mkdir -p "$INSTALL_DIR"
else
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown -R "$(whoami)":"$(whoami)" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# Write environment file
cat <<EOF > "$INSTALL_DIR/.env"
MASTER_WS_URL=${MASTER_URL}
AGENT_HOSTNAME=${AGENT_HOSTNAME}
JOIN_TOKEN=${JOIN_TOKEN}
AGENT_PORT=${AGENT_PORT}
DATA_DIR=${INSTALL_DIR}/data
NODE_ENV=production
EOF

echo -e "${GREEN}✓ Environment configuration saved to ${INSTALL_DIR}/.env${NC}"

# Register Systemd Service if systemctl is available
if command -v systemctl &> /dev/null; then
    echo -e "\n3. Configuring Systemd service (pm2-webui-agent.service)..."
    SERVICE_FILE="/etc/systemd/system/pm2-webui-agent.service"
    
    SERVICE_CONTENT="[Unit]
Description=PM2 Web UI Worker Agent
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=$(which npx) pm2-webui agent
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target"

    if [ "$EUID" -eq 0 ]; then
        echo "$SERVICE_CONTENT" > "$SERVICE_FILE"
        systemctl daemon-reload
        systemctl enable pm2-webui-agent
        systemctl restart pm2-webui-agent || true
    else
        echo "$SERVICE_CONTENT" | sudo tee "$SERVICE_FILE" > /dev/null
        sudo systemctl daemon-reload
        sudo systemctl enable pm2-webui-agent
        sudo systemctl restart pm2-webui-agent || true
    fi
    echo -e "${GREEN}✓ Systemd service 'pm2-webui-agent' enabled and started.${NC}"
else
    echo -e "\n3. Starting Agent in background..."
    nohup npx pm2-webui agent > "$INSTALL_DIR/agent.log" 2>&1 &
    echo -e "${GREEN}✓ Worker agent started (PID: $!). Logs written to ${INSTALL_DIR}/agent.log${NC}"
fi

echo -e "\n${GREEN}${BOLD}======================================================${NC}"
echo -e "${GREEN}${BOLD}   Worker Node connected successfully!                ${NC}"
echo -e "${GREEN}${BOLD}======================================================${NC}"
echo -e "Dashboard: ${SKY}${MASTER_URL}${NC}"
echo -e "Check Status: ${SKY}systemctl status pm2-webui-agent${NC} or in the Web UI.\n"
