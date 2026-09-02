import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  LoginRequestSchema,
  RefreshTokenRequestSchema,
  ChangePasswordSchema,
  Verify2FASchema,
  Enable2FASchema,
  Disable2FASchema,
  CreateApiTokenSchema,
  ProcessActionRequestSchema,
  BatchProcessActionSchema,
  ProcessScaleRequestSchema,
  ProcessActionTriggerRequestSchema,
  PluginInstallRequestSchema,
  PluginUninstallRequestSchema,
  BoundedMetricsQuerySchema,
  LogQuerySchema,
  CreateGitAppSchema,
  UpdateGitAppSchema,
  DeployTriggerSchema,
  ClusterDeploySchema,
  ClusterRollbackSchema,
  CrossNodeBatchActionSchema,
  UserPreferencesSchema,
  LogTreeQuerySchema,
  GlobalSettingsSchema,
  canUserPerformAction,
  PermissionAction,
  WSMessageType,
  WSMessage,
  HandshakeInitPayload,
  HandshakeResponsePayload,
  AllowedPm2Plugin,
  ClusterProcessInfo,
  OperationsTimelineEvent,
} from '@pm2-webui/shared';
import crypto from 'node:crypto';
import {
  AuthService,
  JwtUserPayload,
  TwoFactorService,
  SessionService,
  ApiTokenService,
  LockoutService,
  SecurityAuditService,
} from '../security/index.js';
import { UsersRepo } from '../db/repos/usersRepo.js';
import { NodeRegistry } from '../registry/index.js';
import { RelayProxyEngine } from '../relay/index.js';
import { AuditRepo } from '../db/repos/auditRepo.js';
import { SettingsRepo } from '../db/repos/settingsRepo.js';
import { GitAppsRepo } from '../db/repos/gitAppsRepo.js';
import { DeploymentsRepo } from '../db/repos/deploymentsRepo.js';
import { AgentCore } from '@pm2-webui/agent-core';

export interface ApiRoutesDeps {
  readonly authService: AuthService;
  readonly twoFactorService: TwoFactorService;
  readonly sessionService: SessionService;
  readonly apiTokenService: ApiTokenService;
  readonly lockoutService: LockoutService;
  readonly securityAuditService: SecurityAuditService;
  readonly usersRepo: UsersRepo;
  readonly nodeRegistry: NodeRegistry;
  readonly relayProxy: RelayProxyEngine;
  readonly auditRepo: AuditRepo;
  readonly settingsRepo: SettingsRepo;
  readonly gitAppsRepo: GitAppsRepo;
  readonly deploymentsRepo: DeploymentsRepo;
  readonly localAgentCore: AgentCore;
}

export interface RequestUserContext extends JwtUserPayload {
  readonly isPat?: boolean;
  readonly patPermissions?: readonly PermissionAction[];
}

export const registerApiRoutes = async (
  fastify: FastifyInstance,
  deps: ApiRoutesDeps,
): Promise<void> => {
  const {
    authService,
    twoFactorService,
    sessionService,
    apiTokenService,
    lockoutService: _lockoutService,
    securityAuditService,
    usersRepo,
    nodeRegistry,
    relayProxy,
    auditRepo,
    settingsRepo,
    gitAppsRepo,
    deploymentsRepo,
    localAgentCore,
  } = deps;

  // Middleware / Helper to verify authentication (JWT or Scoped PAT)
  const authenticate = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<RequestUserContext | null> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Missing Authorization header' });
      return null;
    }

    const token = authHeader.slice(7);

    // 1. Personal Access Token
    if (token.startsWith('pm2_pat_')) {
      const patRes = await apiTokenService.verifyPat(token);
      if (!patRes.ok) {
        reply.status(401).send({ code: patRes.error.code, message: patRes.error.message });
        return null;
      }

      return {
        id: patRes.value.user.id,
        sub: patRes.value.user.id,
        username: patRes.value.user.username,
        roleId: patRes.value.user.roleId,
        roleName: patRes.value.user.roleName,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        isPat: true,
        patPermissions: patRes.value.permissions,
      };
    }

    // 2. JWT Access Token
    const verifyRes = authService.verifyAccessToken(token);
    if (!verifyRes.ok) {
      reply.status(401).send({ code: 'UNAUTHORIZED', message: verifyRes.error.message });
      return null;
    }

    return {
      ...verifyRes.value,
      isPat: false,
    };
  };

  const isAuthorized = (
    user: RequestUserContext,
    action: PermissionAction,
    targetScope?: any,
  ): boolean => {
    if (user.isPat && user.patPermissions) {
      return user.patPermissions.includes(action);
    }
    return canUserPerformAction({ user, action, targetScope });
  };

  // Automated Worker Node Installation Script
  const serveInstallScript = async (req: FastifyRequest, reply: FastifyReply) => {
    const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const host =
      (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost:3005';
    const detectedMasterUrl = `${protocol}://${host}`;

    const script = `#!/usr/bin/env bash
set -e

BOLD='\\033[1m'
GREEN='\\033[0;32m'
SKY='\\033[0;36m'
AMBER='\\033[0;33m'
RED='\\033[0;31m'
NC='\\033[0m'

echo -e "\${SKY}\${BOLD}======================================================\${NC}"
echo -e "\${SKY}\${BOLD}   PM2 Web UI — Worker Node Installer        \${NC}"
echo -e "\${SKY}\${BOLD}======================================================\${NC}\\n"

MASTER_URL="\${MASTER_WS_URL:-${detectedMasterUrl}}"
JOIN_TOKEN="\${JOIN_TOKEN:-}"
AGENT_HOSTNAME="\${AGENT_HOSTNAME:-$(hostname)}"
AGENT_PORT="\${AGENT_PORT:-4321}"
INSTALL_DIR="/opt/pm2-webui-agent"

while [[ $# -gt 0 ]]; do
  case $1 in
    --master=*) MASTER_URL="\${1#*=}"; shift ;;
    --master) MASTER_URL="$2"; shift 2 ;;
    --token=*) JOIN_TOKEN="\${1#*=}"; shift ;;
    --token) JOIN_TOKEN="$2"; shift 2 ;;
    --name=*) AGENT_HOSTNAME="\${1#*=}"; shift ;;
    --name) AGENT_HOSTNAME="$2"; shift 2 ;;
    --port=*) AGENT_PORT="\${1#*=}"; shift ;;
    --port) AGENT_PORT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

echo -e "⚙️  Target Master:   \${GREEN}\${MASTER_URL}\${NC}"
echo -e "🏷️  Node Hostname:   \${GREEN}\${AGENT_HOSTNAME}\${NC}"
echo -e "🔌 Agent Port:      \${GREEN}\${AGENT_PORT}\${NC}"

if ! command -v node &> /dev/null; then
    echo -e "\${AMBER}Node.js not found. Installing Node.js 22 LTS...\${NC}"
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
        echo -e "\${RED}Please install Node.js 20+ first.\${NC}"
        exit 1
    fi
fi

if ! command -v pm2 &> /dev/null; then
    echo -e "\${AMBER}Installing PM2 globally...\${NC}"
    npm install -g pm2
fi

if [ "$EUID" -eq 0 ]; then
    mkdir -p "$INSTALL_DIR"
else
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown -R "$(whoami)":"$(whoami)" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

cat <<EOF > "$INSTALL_DIR/.env"
MASTER_WS_URL=\${MASTER_URL}
AGENT_HOSTNAME=\${AGENT_HOSTNAME}
JOIN_TOKEN=\${JOIN_TOKEN}
AGENT_PORT=\${AGENT_PORT}
DATA_DIR=\${INSTALL_DIR}/data
NODE_ENV=production
EOF

if command -v systemctl &> /dev/null; then
    SERVICE_FILE="/etc/systemd/system/pm2-webui-agent.service"
    SERVICE_CONTENT="[Unit]
Description=PM2 Web UI Worker Agent
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=\${INSTALL_DIR}
EnvironmentFile=\${INSTALL_DIR}/.env
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
else
    nohup npx pm2-webui agent > "$INSTALL_DIR/agent.log" 2>&1 &
fi

echo -e "\\n\${GREEN}\${BOLD}Worker node installed and running!\${NC}\\n"
`;
    return reply.type('text/plain; charset=utf-8').send(script);
  };

  fastify.get('/install.sh', serveInstallScript);
  fastify.get('/install-agent.sh', serveInstallScript);
  fastify.get('/api/v1/install.sh', serveInstallScript);

  // 1. Auth & 2FA Endpoints
  fastify.post('/api/v1/auth/login', async (req, reply) => {
    const parsed = LoginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const loginRes = await authService.login(
      parsed.data.username,
      parsed.data.password,
      req.ip,
      req.headers['user-agent'],
    );

    if (!loginRes.ok) {
      return reply.status(401).send({ code: loginRes.error.code, message: loginRes.error.message });
    }

    return reply.send(loginRes.value);
  });

  fastify.post('/api/v1/auth/2fa/verify', async (req, reply) => {
    const parsed = Verify2FASchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const verifyRes = await authService.verify2FALogin(
      parsed.data.tempToken,
      parsed.data.code,
      req.ip,
      req.headers['user-agent'],
    );

    if (!verifyRes.ok) {
      return reply
        .status(401)
        .send({ code: verifyRes.error.code, message: verifyRes.error.message });
    }

    return reply.send(verifyRes.value);
  });

  fastify.post('/api/v1/auth/refresh', async (req, reply) => {
    const parsed = RefreshTokenRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const refreshRes = await authService.refresh(
      parsed.data.refreshToken,
      req.ip,
      req.headers['user-agent'],
    );

    if (!refreshRes.ok) {
      return reply
        .status(401)
        .send({ code: refreshRes.error.code, message: refreshRes.error.message });
    }

    return reply.send(refreshRes.value);
  });

  fastify.post('/api/v1/auth/logout', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const sessionId = (req.body as any)?.sessionId;
    if (sessionId) {
      authService.logout(sessionId, user.id, req.ip);
    }
    return reply.send({ success: true });
  });

  fastify.get('/api/v1/auth/me', async (req, reply) => {
    const userContext = await authenticate(req, reply);
    if (!userContext) return;

    if (userContext.isPat) {
      return reply.send({ user: userContext });
    }

    const userRes = usersRepo.findById(userContext.id);
    if (!userRes.ok || !userRes.value) {
      return reply.send({ user: userContext });
    }

    const {
      passwordHash: _,
      twoFactorSecretEnc: __,
      failedAttempts: ___,
      lockedUntil: ____,
      ...user
    } = userRes.value;

    return reply.send({ user });
  });

  const handleChangePassword = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const parsed = ChangePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const changeRes = await authService.changePassword(
      user.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      req.ip,
    );

    if (!changeRes.ok) {
      const statusCode = changeRes.error.code === 'UNAUTHORIZED' ? 401 : 400;
      return reply.status(statusCode).send({
        code: changeRes.error.code,
        message: changeRes.error.message,
      });
    }

    return reply.send({
      success: true,
      message: 'Password changed successfully',
      user: changeRes.value,
    });
  };

  fastify.post('/api/v1/auth/change-password', handleChangePassword);
  fastify.post('/api/v1/auth/password', handleChangePassword);

  fastify.get('/api/v1/auth/2fa/status', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const statusRes = twoFactorService.getStatus(user.id);
    if (!statusRes.ok) {
      return reply
        .status(500)
        .send({ code: statusRes.error.code, message: statusRes.error.message });
    }
    return reply.send(statusRes.value);
  });

  fastify.post('/api/v1/auth/2fa/setup', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const setupRes = twoFactorService.generateSetup(user.id, user.username);
    if (!setupRes.ok) {
      return reply.status(500).send({ code: setupRes.error.code, message: setupRes.error.message });
    }
    securityAuditService.logEvent({
      event: 'auth:2fa_setup',
      userId: user.id,
      username: user.username,
      status: 'success',
      ipAddress: req.ip,
    });
    return reply.send(setupRes.value);
  });

  fastify.post('/api/v1/auth/2fa/enable', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const parsed = Enable2FASchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }
    const enableRes = await twoFactorService.enable(
      user.id,
      parsed.data.secret,
      parsed.data.code,
      parsed.data.recoveryCodes,
    );
    if (!enableRes.ok) {
      return reply
        .status(400)
        .send({ code: enableRes.error.code, message: enableRes.error.message });
    }
    securityAuditService.logEvent({
      event: 'auth:2fa_enabled',
      userId: user.id,
      username: user.username,
      status: 'success',
      ipAddress: req.ip,
    });
    return reply.send({ success: true, message: '2FA enabled successfully' });
  });

  fastify.post('/api/v1/auth/2fa/disable', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const parsed = Disable2FASchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }
    const userWithHash = usersRepo.findById(user.id);
    if (!userWithHash.ok || !userWithHash.value) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'User not found' });
    }
    const validPassword = await authService.verifyPassword(
      userWithHash.value.passwordHash,
      parsed.data.password,
    );
    if (!validPassword) {
      return reply.status(401).send({ code: 'UNAUTHORIZED', message: 'Invalid password' });
    }
    const disableRes = await twoFactorService.disable(user.id);
    if (!disableRes.ok) {
      return reply
        .status(500)
        .send({ code: disableRes.error.code, message: disableRes.error.message });
    }
    securityAuditService.logEvent({
      event: 'auth:2fa_disabled',
      userId: user.id,
      username: user.username,
      status: 'success',
      ipAddress: req.ip,
    });
    return reply.send({ success: true, message: '2FA disabled' });
  });

  fastify.get('/api/v1/auth/sessions', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const listRes = sessionService.listUserSessions(user.id);
    if (!listRes.ok) {
      return reply.status(500).send({ code: listRes.error.code, message: listRes.error.message });
    }
    return reply.send(listRes.value);
  });

  fastify.delete('/api/v1/auth/sessions/:sessionId', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const { sessionId } = req.params as { sessionId: string };
    sessionService.revokeSession(sessionId);
    securityAuditService.logEvent({
      event: 'auth:session_revoked',
      userId: user.id,
      username: user.username,
      status: 'success',
      ipAddress: req.ip,
      details: { sessionId },
    });
    return reply.send({ success: true });
  });

  fastify.post('/api/v1/auth/sessions/revoke-all', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    sessionService.revokeAllOtherSessions(user.id);
    securityAuditService.logEvent({
      event: 'auth:session_revoked',
      userId: user.id,
      username: user.username,
      status: 'success',
      ipAddress: req.ip,
      details: { action: 'revoke_all_other' },
    });
    return reply.send({ success: true });
  });

  fastify.get('/api/v1/auth/tokens', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const listRes = apiTokenService.listTokens(user.id);
    return reply.send(listRes.ok ? listRes.value : []);
  });

  fastify.post('/api/v1/auth/tokens', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const parsed = CreateApiTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }
    const createRes = await apiTokenService.createToken(
      user.id,
      parsed.data.name,
      parsed.data.permissions as readonly PermissionAction[],
      parsed.data.expiresInDays,
    );
    if (!createRes.ok) {
      return reply
        .status(500)
        .send({ code: createRes.error.code, message: createRes.error.message });
    }
    securityAuditService.logEvent({
      event: 'token:created',
      userId: user.id,
      username: user.username,
      status: 'success',
      ipAddress: req.ip,
      details: { tokenName: parsed.data.name, tokenId: createRes.value.tokenInfo.id },
    });
    return reply.status(201).send(createRes.value);
  });

  fastify.delete('/api/v1/auth/tokens/:tokenId', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;
    const { tokenId } = req.params as { tokenId: string };
    apiTokenService.revokeToken(tokenId, user.id);
    securityAuditService.logEvent({
      event: 'token:revoked',
      userId: user.id,
      username: user.username,
      status: 'success',
      ipAddress: req.ip,
      details: { tokenId },
    });
    return reply.send({ success: true });
  });

  fastify.get('/api/v1/security/health', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const userWithHash = usersRepo.findById(user.id);
    const twoFactorActive = userWithHash.ok && userWithHash.value?.twoFactorEnabled;
    const sessions = sessionService.listUserSessions(user.id);
    const tokens = apiTokenService.listTokens(user.id);

    return reply.send({
      twoFactorEnabled: Boolean(twoFactorActive),
      passwordAlgorithm: 'Argon2id (m=19MB, t=2, p=1)',
      activeSessionsCount: sessions.ok ? sessions.value.length : 0,
      activeTokensCount: tokens.ok ? tokens.value.length : 0,
      nodeInterconnect: 'Ed25519 Cryptographic Signatures',
      databaseStorage: 'AES-256-GCM Encrypted at Rest',
    });
  });

  // 2. Node Registry Endpoints
  fastify.get('/api/v1/nodes', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'node:view')) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }

    const nodesRes = nodeRegistry.listNodes();
    if (!nodesRes.ok) {
      return reply.status(500).send({ code: nodesRes.error.code, message: nodesRes.error.message });
    }

    // Annotate with live connectivity status
    const annotated = nodesRes.value.map((n) => ({
      ...n,
      isOnline: n.id === localAgentCore.agentId || relayProxy.isAgentConnected(n.id),
    }));

    return reply.send(annotated);
  });

  fastify.get('/api/v1/nodes/:nodeId', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const { nodeId } = req.params as { nodeId: string };
    const nodeRes = nodeRegistry.getNode(nodeId);
    if (!nodeRes.ok || !nodeRes.value) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Node not found' });
    }

    return reply.send({
      ...nodeRes.value,
      isOnline: nodeId === localAgentCore.agentId || relayProxy.isAgentConnected(nodeId),
    });
  });

  fastify.post('/api/v1/nodes/:nodeId/approve', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'node:approve')) {
      return reply
        .status(403)
        .send({ code: 'FORBIDDEN', message: 'Admin approval permission required' });
    }

    const { nodeId } = req.params as { nodeId: string };
    const approveRes = nodeRegistry.approveNode(nodeId, user.sub, req.ip);
    if (!approveRes.ok) {
      return reply
        .status(500)
        .send({ code: approveRes.error.code, message: approveRes.error.message });
    }

    return reply.send({ success: true });
  });

  fastify.post('/api/v1/nodes/:nodeId/reject', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'node:approve')) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Admin permission required' });
    }

    const { nodeId } = req.params as { nodeId: string };
    const { reason = 'Rejected by administrator' } = (req.body as any) || {};
    const rejectRes = nodeRegistry.rejectNode(nodeId, user.sub, reason, req.ip);
    if (!rejectRes.ok) {
      return reply
        .status(500)
        .send({ code: rejectRes.error.code, message: rejectRes.error.message });
    }

    return reply.send({ success: true });
  });

  fastify.post('/api/v1/nodes/:nodeId/token', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const { nodeId } = req.params as { nodeId: string };
    const tokenRes = authService.issueDelegationTokenForNode(user.sub, nodeId, [
      'process:view',
      'process:manage',
      'log:view',
      'metrics:view',
    ]);

    if (!tokenRes.ok) {
      return reply.status(500).send({ code: tokenRes.error.code, message: tokenRes.error.message });
    }

    return reply.send({ token: tokenRes.value });
  });

  // 3. Process Control & Inspection Endpoints
  fastify.get('/api/v1/nodes/:nodeId/processes', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const { nodeId } = req.params as { nodeId: string };

    if (nodeId === localAgentCore.agentId) {
      const listRes = await localAgentCore.pm2Manager.listProcesses('normal');
      if (!listRes.ok) {
        return reply.status(500).send({ code: listRes.error.code, message: listRes.error.message });
      }
      return reply.send(listRes.value);
    }

    // Remote node: relay tunnel
    const tunnelRes = await relayProxy.executeTunnelRequest(nodeId, '/processes', 'GET');
    if (!tunnelRes.ok) {
      return reply
        .status(502)
        .send({ code: tunnelRes.error.code, message: tunnelRes.error.message });
    }
    return reply.send(tunnelRes.value);
  });

  fastify.post('/api/v1/nodes/:nodeId/processes/action', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'process:manage', `node:${(req.params as any).nodeId}`)) {
      return reply
        .status(403)
        .send({ code: 'FORBIDDEN', message: 'Insufficient permission to manage processes' });
    }

    const { nodeId } = req.params as { nodeId: string };
    const parsed = ProcessActionRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    let execRes: any;
    if (nodeId === localAgentCore.agentId) {
      execRes = await localAgentCore.pm2Manager.executeAction(parsed.data, 'high');
    } else {
      execRes = await relayProxy.sendCommandToAgent(
        nodeId,
        WSMessageType.PROCESS_ACTION_REQ,
        parsed.data,
      );
    }

    auditRepo.insert({
      userId: user.sub,
      username: user.username,
      nodeId,
      processName: String(parsed.data.target),
      action: `process:${parsed.data.action}`,
      status: execRes.ok ? 'success' : 'failure',
      ipAddress: req.ip,
      detailsJson: JSON.stringify(parsed.data),
    });

    if (!execRes.ok) {
      return reply.status(500).send({ code: execRes.error.code, message: execRes.error.message });
    }

    return reply.send({ success: true });
  });

  // 3.1 Unified Cross-Server Process View
  fastify.get('/api/v1/processes/all', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'process:view')) {
      return reply
        .status(403)
        .send({ code: 'FORBIDDEN', message: 'Insufficient permission to view processes' });
    }

    const nodesRes = nodeRegistry.listNodes();
    const allNodes = nodesRes.ok ? nodesRes.value : [];
    const onlineNodes = allNodes.filter((n) => n.status === 'online');

    const promises = onlineNodes.map(async (node) => {
      try {
        let procs: any[] = [];
        if (node.id === localAgentCore.agentId) {
          const res = await localAgentCore.pm2Manager.listProcesses('normal');
          if (res.ok) procs = res.value as any[];
        } else {
          const res = await relayProxy.executeTunnelRequest(node.id, '/processes', 'GET');
          if (res.ok && Array.isArray(res.value)) {
            procs = res.value;
          }
        }
        return procs.map((p) => ({
          ...p,
          nodeId: node.id,
          nodeHostname: node.hostname,
          nodeIp: node.ipAddress,
        })) as ClusterProcessInfo[];
      } catch {
        return [] as ClusterProcessInfo[];
      }
    });

    const results = await Promise.all(promises);
    const flattened = results.flat();
    return reply.send(flattened);
  });

  fastify.post('/api/v1/processes/batch-action', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'process:manage')) {
      return reply
        .status(403)
        .send({ code: 'FORBIDDEN', message: 'Insufficient permission to manage processes' });
    }

    const parsed = CrossNodeBatchActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const { action, targets } = parsed.data;
    const successful: any[] = [];
    const failed: any[] = [];

    await Promise.all(
      targets.map(async ({ nodeId, pmId }) => {
        try {
          let res: any;
          if (nodeId === localAgentCore.agentId) {
            res = await localAgentCore.pm2Manager.executeAction({ action, target: pmId }, 'high');
          } else {
            res = await relayProxy.sendCommandToAgent(
              nodeId,
              WSMessageType.PROCESS_ACTION_REQ,
              { action, target: pmId },
              8000,
            );
          }

          if (res.ok) {
            successful.push({ nodeId, pmId });
            auditRepo.insert({
              userId: user.sub,
              username: user.username,
              nodeId,
              processName: String(pmId),
              action: `process:${action}`,
              status: 'success',
              ipAddress: req.ip,
            });
          } else {
            failed.push({ nodeId, pmId, error: res.error.message });
          }
        } catch (err: any) {
          failed.push({ nodeId, pmId, error: err.message || 'Operation failed' });
        }
      }),
    );

    return reply.send({ successful, failed });
  });

  // 3.2 Operations Timeline Feed
  fastify.get('/api/v1/timeline', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const auditsRes = auditRepo.list({ limit: 40 });
    const deploymentsRes = deploymentsRepo.listRecent(20);

    const events: OperationsTimelineEvent[] = [];

    if (auditsRes.ok) {
      for (const log of auditsRes.value.logs) {
        let type: OperationsTimelineEvent['type'] = 'process_restart';
        let title = log.action;
        let status: OperationsTimelineEvent['status'] =
          log.status === 'success' ? 'success' : 'error';

        if (log.action.includes('deploy')) {
          type = log.status === 'success' ? 'deploy_success' : 'deploy_failure';
          title = `Deployment ${log.status === 'success' ? 'Succeeded' : 'Failed'}`;
        } else if (log.action.includes('reload')) {
          type = 'process_reload';
          title = `Process '${log.processName || 'service'}' Graceful Reloaded`;
        } else if (log.action.includes('restart')) {
          type = 'process_restart';
          title = `Process '${log.processName || 'service'}' Restarted`;
        } else if (log.action.includes('crash')) {
          type = 'process_crash';
          status = 'error';
          title = `Process '${log.processName || 'service'}' Crashed`;
        } else if (log.action.includes('approve') || log.action.includes('online')) {
          type = 'node_online';
          title = `Node ${log.nodeId || 'Worker'} Online`;
        } else if (log.action.includes('auth') || log.action.includes('lockout')) {
          type = 'security_alert';
          status = 'warning';
          title = `Security Event: ${log.action}`;
        }

        events.push({
          id: `audit-${log.id}`,
          timestamp: log.timestamp,
          type,
          title,
          description: log.detailsJson
            ? log.detailsJson
            : `Action executed by ${log.username || 'system'}`,
          nodeId: log.nodeId,
          processName: log.processName,
          status,
        });
      }
    }

    if (deploymentsRes.ok) {
      for (const dep of deploymentsRes.value) {
        events.push({
          id: `dep-${dep.id}`,
          timestamp: dep.finishedAt || dep.startedAt,
          type:
            dep.status === 'success'
              ? 'deploy_success'
              : dep.status === 'failed'
                ? 'deploy_failure'
                : 'deploy_start',
          title: `Deploy '${dep.branch || 'main'}' (${dep.releaseId})`,
          description: dep.commitMessage || `Deployment status: ${dep.status}`,
          nodeId: dep.nodeId,
          appId: dep.appId,
          status: dep.status === 'success' ? 'success' : dep.status === 'failed' ? 'error' : 'info',
        });
      }
    }

    // Sort descending
    events.sort((a, b) => b.timestamp - a.timestamp);
    return reply.send(events.slice(0, 30));
  });

  // User Roaming Preferences
  fastify.get('/api/v1/users/preferences', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const prefs = usersRepo.getPreferences(user.sub);
    return reply.send(prefs.ok ? prefs.value : {});
  });

  fastify.put('/api/v1/users/preferences', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const parsed = UserPreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const updated = usersRepo.updatePreferences(user.sub, parsed.data);
    if (!updated.ok) {
      return reply.status(500).send({ code: updated.error.code, message: updated.error.message });
    }
    return reply.send(updated.value);
  });

  fastify.post('/api/v1/nodes/:nodeId/processes/batch', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const { nodeId } = req.params as { nodeId: string };
    const parsed = BatchProcessActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    if (nodeId === localAgentCore.agentId) {
      const batchRes = await localAgentCore.pm2Manager.batchExecuteActions(
        parsed.data.action,
        parsed.data.targets,
      );
      if (!batchRes.ok) {
        return reply
          .status(500)
          .send({ code: batchRes.error.code, message: batchRes.error.message });
      }
      return reply.send(batchRes.value);
    }

    // Remote batch execution
    const successful: (string | number)[] = [];
    const failed: any[] = [];
    for (const target of parsed.data.targets) {
      const res = await relayProxy.sendCommandToAgent(nodeId, WSMessageType.PROCESS_ACTION_REQ, {
        action: parsed.data.action,
        target,
      });
      if (res.ok) successful.push(target);
      else failed.push({ target, error: res.error.message });
    }

    return reply.send({ successful, failed });
  });

  // Dynamic Cluster Scaling (Bounded 1..32, audit-logged)
  fastify.post('/api/v1/nodes/:nodeId/processes/scale', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const { nodeId } = req.params as { nodeId: string };
    if (!isAuthorized(user, 'process:scale', `node:${nodeId}`)) {
      return reply
        .status(403)
        .send({ code: 'FORBIDDEN', message: 'Insufficient permission to scale processes' });
    }

    const parsed = ProcessScaleRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const { target, instances } = parsed.data;

    let res: any;
    if (nodeId === localAgentCore.agentId) {
      res = await localAgentCore.pm2Manager.scaleProcess(target, instances);
    } else {
      res = await relayProxy.sendCommandToAgent(nodeId, WSMessageType.PROCESS_ACTION_REQ, {
        action: 'scale',
        target,
        options: { instances },
      });
    }

    auditRepo.insert({
      userId: user.id,
      username: user.username,
      nodeId,
      processName: String(target),
      action: `process:scale to ${instances} instances`,
      status: res.ok ? 'success' : 'failure',
      ipAddress: req.ip,
      detailsJson: JSON.stringify({ target, instances }),
    });

    if (!res.ok) {
      return reply.status(500).send({ code: res.error.code, message: res.error.message });
    }

    return reply.send({ success: true, target, instances });
  });

  // Custom Axm Action Trigger (Validated against advertised action list, audit-logged)
  fastify.post('/api/v1/nodes/:nodeId/processes/:target/trigger-action', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const { nodeId, target } = req.params as { nodeId: string; target: string };
    if (!isAuthorized(user, 'process:action_trigger', `node:${nodeId}`)) {
      return reply
        .status(403)
        .send({ code: 'FORBIDDEN', message: 'Insufficient permission to trigger process actions' });
    }

    const parsed = ProcessActionTriggerRequestSchema.safeParse({ ...(req.body as any), target });
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const { actionName, params } = parsed.data;
    const pmId = typeof target === 'number' ? target : parseInt(target, 10);

    let res: any;
    if (nodeId === localAgentCore.agentId) {
      res = await localAgentCore.pm2Manager.triggerAction(
        isNaN(pmId) ? 0 : pmId,
        actionName,
        params,
      );
    } else {
      res = await relayProxy.sendCommandToAgent(nodeId, WSMessageType.PROCESS_ACTION_REQ, {
        action: 'trigger',
        target,
        options: { env: { actionName, params: JSON.stringify(params || {}) } },
      });
    }

    auditRepo.insert({
      userId: user.id,
      username: user.username,
      nodeId,
      processName: String(target),
      action: `process:trigger_action ${actionName}`,
      status: res.ok ? 'success' : 'failure',
      ipAddress: req.ip,
      detailsJson: JSON.stringify({ actionName, params }),
    });

    if (!res.ok) {
      return reply.status(500).send({ code: res.error.code, message: res.error.message });
    }

    return reply.send({ success: true, result: res.value });
  });

  // Environment Variable View & Reveal (Milestone 17: Secret masking with audit logging)
  fastify.get('/api/v1/nodes/:nodeId/processes/:target/env', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const { nodeId, target } = req.params as { nodeId: string; target: string };
    let proc: any = null;

    if (nodeId === localAgentCore.agentId) {
      const describeRes = await localAgentCore.pm2Manager.describeProcess(target);
      if (describeRes.ok) proc = describeRes.value;
    }

    if (!proc) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Process not found' });
    }

    const rawEnv = proc.env || {};
    const maskedEnv: Record<string, string> = {};
    for (const k of Object.keys(rawEnv)) {
      maskedEnv[k] = '••••••••';
    }

    return reply.send({ env: maskedEnv });
  });

  fastify.post('/api/v1/nodes/:nodeId/processes/:target/reveal-env', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'process:view_secrets', `node:${(req.params as any).nodeId}`)) {
      return reply
        .status(403)
        .send({ code: 'FORBIDDEN', message: 'Permission to view process secrets required' });
    }

    const { nodeId, target } = req.params as { nodeId: string; target: string };
    const { key } = (req.body as any) || {};

    if (!key) {
      return reply
        .status(400)
        .send({ code: 'VALIDATION_ERROR', message: 'Environment key required' });
    }

    let proc: any = null;
    if (nodeId === localAgentCore.agentId) {
      const describeRes = await localAgentCore.pm2Manager.describeProcess(target);
      if (describeRes.ok) proc = describeRes.value;
    }

    if (!proc || !proc.env) {
      return reply
        .status(404)
        .send({ code: 'NOT_FOUND', message: 'Process or environment not found' });
    }

    const value = proc.env[key];

    // Log secret reveal action to Audit Trail
    auditRepo.insert({
      userId: user.sub,
      username: user.username,
      nodeId,
      processName: target,
      action: 'process:reveal_env_secret',
      status: 'success',
      ipAddress: req.ip,
      detailsJson: JSON.stringify({ key }),
    });

    return reply.send({ key, value: value || '' });
  });

  // 4. Progressive Log Endpoints
  fastify.get('/api/v1/nodes/:nodeId/logs/tree', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const { nodeId } = req.params as { nodeId: string };
    const parsed = LogTreeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    if (nodeId === localAgentCore.agentId) {
      const summariesRes = localAgentCore.logEngine.querySummaries(
        parsed.data.processName,
        parsed.data.granularity,
        parsed.data.from,
        parsed.data.to,
      );
      return reply.send(summariesRes.ok ? summariesRes.value : []);
    }

    return reply.send([]);
  });

  fastify.get('/api/v1/nodes/:nodeId/logs/raw', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const { nodeId } = req.params as { nodeId: string };
    const parsed = LogQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    if (nodeId === localAgentCore.agentId) {
      const rawRes = localAgentCore.logEngine.queryRawLogs(parsed.data);
      return reply.send(rawRes.ok ? rawRes.value : { lines: [], total: 0 });
    }

    // Remote node tunnel
    const tunnelRes = await relayProxy.executeTunnelRequest(nodeId, '/logs', 'GET', parsed.data);
    if (!tunnelRes.ok) {
      return reply
        .status(502)
        .send({ code: tunnelRes.error.code, message: tunnelRes.error.message });
    }
    return reply.send(tunnelRes.value);
  });

  // 5. Extended Bounded Metrics Endpoint (with Recharts time-series history)
  fastify.get('/api/v1/nodes/:nodeId/metrics', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const { nodeId } = req.params as { nodeId: string };
    if (!isAuthorized(user, 'metrics:view', `node:${nodeId}`)) {
      return reply
        .status(403)
        .send({ code: 'FORBIDDEN', message: 'Insufficient permission to view metrics' });
    }

    const parsed = BoundedMetricsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const now = Date.now();
    const maxRangeMs = 30 * 24 * 60 * 60 * 1000; // 30 days max
    const fromTs = Math.max(parsed.data.from ?? now - 24 * 60 * 60 * 1000, now - maxRangeMs);
    const toTs = Math.min(parsed.data.to ?? now, now);

    if (nodeId === localAgentCore.agentId) {
      const currentRes = await localAgentCore.metricsCollector.collectCurrentMetrics();
      const historyRes = localAgentCore.metricsRepo.queryRange(fromTs, toTs);
      const dbHistory = historyRes.ok ? historyRes.value : [];
      const recentSamples = localAgentCore.metricsCollector.getRecentSamples();

      // Combine DB history with live rolling samples
      const map = new Map<number, any>();
      for (const item of dbHistory) {
        map.set(item.timestamp, item);
      }
      for (const item of recentSamples) {
        map.set(item.timestamp, item);
      }

      const combined = Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);

      return reply.send({
        current: currentRes.ok ? currentRes.value : null,
        history: combined.slice(-parsed.data.limit),
      });
    }

    // Remote node tunnel
    const tunnelRes = await relayProxy.executeTunnelRequest(nodeId, '/metrics', 'GET', {
      from: fromTs,
      to: toTs,
    });
    if (!tunnelRes.ok) {
      const latest = relayProxy.getLatestMetricsForNode(nodeId);
      if (latest) {
        return reply.send({
          current: latest,
          history: [],
        });
      }
      return reply
        .status(502)
        .send({ code: tunnelRes.error.code, message: tunnelRes.error.message });
    }
    return reply.send(tunnelRes.value);
  });

  // 6. PM2 Plugin Management (Strictly Allow-listed official plugins)
  fastify.get('/api/v1/nodes/:nodeId/plugins', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const { nodeId } = req.params as { nodeId: string };
    if (!isAuthorized(user, 'node:view', `node:${nodeId}`)) {
      return reply
        .status(403)
        .send({ code: 'FORBIDDEN', message: 'Insufficient permission to view node plugins' });
    }

    if (nodeId === localAgentCore.agentId) {
      const pluginsRes = await localAgentCore.pm2Manager.listPlugins();
      return reply.send(pluginsRes.ok ? pluginsRes.value : []);
    }

    return reply.send([]);
  });

  fastify.post('/api/v1/nodes/:nodeId/plugins/install', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const { nodeId } = req.params as { nodeId: string };
    if (!isAuthorized(user, 'plugin:manage', `node:${nodeId}`)) {
      return reply
        .status(403)
        .send({ code: 'FORBIDDEN', message: 'Admin permission required to manage plugins' });
    }

    const parsed = PluginInstallRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const { pluginName } = parsed.data;
    let res: any;

    if (nodeId === localAgentCore.agentId) {
      res = await localAgentCore.pm2Manager.installPlugin(pluginName as AllowedPm2Plugin);
    } else {
      res = await relayProxy.sendCommandToAgent(nodeId, WSMessageType.PROCESS_ACTION_REQ, {
        action: 'install_plugin',
        target: pluginName,
      });
    }

    auditRepo.insert({
      userId: user.id,
      username: user.username,
      nodeId,
      action: `plugin:install ${pluginName}`,
      status: res.ok ? 'success' : 'failure',
      ipAddress: req.ip,
      detailsJson: JSON.stringify({ pluginName }),
    });

    if (!res.ok) {
      return reply.status(500).send({ code: res.error.code, message: res.error.message });
    }

    return reply.send({ success: true, pluginName });
  });

  fastify.post('/api/v1/nodes/:nodeId/plugins/uninstall', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const { nodeId } = req.params as { nodeId: string };
    if (!isAuthorized(user, 'plugin:manage', `node:${nodeId}`)) {
      return reply
        .status(403)
        .send({ code: 'FORBIDDEN', message: 'Admin permission required to manage plugins' });
    }

    const parsed = PluginUninstallRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const { pluginName } = parsed.data;
    let res: any;

    if (nodeId === localAgentCore.agentId) {
      res = await localAgentCore.pm2Manager.uninstallPlugin(pluginName as AllowedPm2Plugin);
    } else {
      res = await relayProxy.sendCommandToAgent(nodeId, WSMessageType.PROCESS_ACTION_REQ, {
        action: 'uninstall_plugin',
        target: pluginName,
      });
    }

    auditRepo.insert({
      userId: user.id,
      username: user.username,
      nodeId,
      action: `plugin:uninstall ${pluginName}`,
      status: res.ok ? 'success' : 'failure',
      ipAddress: req.ip,
      detailsJson: JSON.stringify({ pluginName }),
    });

    if (!res.ok) {
      return reply.status(500).send({ code: res.error.code, message: res.error.message });
    }

    return reply.send({ success: true, pluginName });
  });

  // 7. Audit Trail Endpoints
  fastify.get('/api/v1/audit', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'audit:view')) {
      return reply
        .status(403)
        .send({ code: 'FORBIDDEN', message: 'Insufficient permission to view audit logs' });
    }

    const { page = 1, limit = 50, nodeId, action, status } = req.query as any;
    const auditRes = auditRepo.list({
      page: Number(page),
      limit: Number(limit),
      nodeId,
      action,
      status,
    });

    return reply.send(auditRes.ok ? auditRes.value : { logs: [], total: 0 });
  });

  // 6. Settings Endpoints
  fastify.get('/api/v1/settings', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    const settingsRes = settingsRepo.getGlobalSettings();
    return reply.send(settingsRes.ok ? settingsRes.value : {});
  });

  fastify.put('/api/v1/settings', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'settings:manage')) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Admin permission required' });
    }

    const parsed = GlobalSettingsSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const updatedRes = settingsRepo.updateGlobalSettings(parsed.data);
    return reply.send(updatedRes.ok ? updatedRes.value : {});
  });

  // 7. Git Deployments & Version Control Endpoints
  fastify.get('/api/v1/deploy/apps', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'deploy:view')) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }

    const appsRes = gitAppsRepo.list();
    return reply.send(appsRes.ok ? appsRes.value : []);
  });

  fastify.post('/api/v1/deploy/apps', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'deploy:create')) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }

    const parsed = CreateGitAppSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const createRes = gitAppsRepo.create(parsed.data);
    if (!createRes.ok) {
      return reply
        .status(409)
        .send({ code: createRes.error.code, message: createRes.error.message });
    }

    auditRepo.insert({
      timestamp: Date.now(),
      userId: user.id,
      username: user.username,
      nodeId: parsed.data.nodeId,
      processName: parsed.data.name,
      action: 'deploy:create',
      status: 'success',
      ipAddress: req.ip,
      detailsJson: JSON.stringify(parsed.data),
    });

    return reply.status(201).send(createRes.value);
  });

  fastify.get('/api/v1/deploy/apps/:appId', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'deploy:view')) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }

    const { appId } = req.params as { appId: string };
    const appRes = gitAppsRepo.findById(appId);
    if (!appRes.ok || !appRes.value) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Git app not found' });
    }

    return reply.send(appRes.value);
  });

  fastify.put('/api/v1/deploy/apps/:appId', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'deploy:update')) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }

    const { appId } = req.params as { appId: string };
    const parsed = UpdateGitAppSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const updateRes = gitAppsRepo.update(appId, parsed.data);
    if (!updateRes.ok) {
      return reply
        .status(500)
        .send({ code: updateRes.error.code, message: updateRes.error.message });
    }

    return reply.send(updateRes.value);
  });

  fastify.delete('/api/v1/deploy/apps/:appId', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'deploy:delete')) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }

    const { appId } = req.params as { appId: string };
    const appRes = gitAppsRepo.findById(appId);
    if (appRes.ok && appRes.value) {
      await localAgentCore.deployEngine.deleteApp(appId, appRes.value.name).catch(() => {});
    }

    gitAppsRepo.deleteApp(appId);
    return reply.send({ success: true, message: 'Git app deleted successfully' });
  });

  fastify.post('/api/v1/deploy/apps/:appId/deploy', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'deploy:trigger')) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }

    const { appId } = req.params as { appId: string };
    const parsed = DeployTriggerSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const appRes = gitAppsRepo.findById(appId);
    if (!appRes.ok || !appRes.value) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Git app not found' });
    }

    const app = appRes.value;
    const deploymentId = crypto.randomUUID();
    const branch = parsed.data.branch || app.branch || 'main';

    const initialRecord = {
      id: deploymentId,
      appId: app.id,
      appName: app.name,
      nodeId: app.nodeId,
      releaseId: `rel_${Date.now()}`,
      commitHash: parsed.data.commitHash || 'latest',
      branch,
      status: 'building' as const,
      triggerType: 'manual' as const,
      triggeredByUsername: user.username,
      logs: `[PM2 Web UI] Deployment queued by ${user.username}...\n`,
      startedAt: Date.now(),
    };

    deploymentsRepo.create(initialRecord);

    // Asynchronously run deployment engine
    localAgentCore.deployEngine
      .deployApp(app, {
        branch,
        commitHash: parsed.data.commitHash,
        triggerType: 'manual',
        triggeredByUsername: user.username,
        onLog: (chunk) => {
          deploymentsRepo.appendLogs(deploymentId, chunk);
        },
      })
      .then((deployRes) => {
        if (deployRes.ok) {
          const rec = deployRes.value;
          deploymentsRepo.updateStatus(deploymentId, rec.status, {
            logs: rec.logs,
            finishedAt: rec.finishedAt,
            durationMs: rec.durationMs,
            errorMessage: rec.errorMessage,
          });

          if (rec.status === 'success') {
            gitAppsRepo.update(app.id, {
              commitHash: rec.commitHash,
              commitMessage: rec.commitMessage,
              commitAuthor: rec.commitAuthor,
              branch: rec.branch,
            });
          }
        }
      })
      .catch((err) => {
        deploymentsRepo.updateStatus(deploymentId, 'failed', {
          errorMessage: err?.message || 'Deployment runner error',
          finishedAt: Date.now(),
        });
      });

    return reply.status(202).send(initialRecord);
  });

  fastify.post('/api/v1/deploy/apps/:appId/rollback/:deployId', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'deploy:rollback')) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }

    const { appId, deployId } = req.params as { appId: string; deployId: string };
    const appRes = gitAppsRepo.findById(appId);
    if (!appRes.ok || !appRes.value) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Git app not found' });
    }

    const targetDeployRes = deploymentsRepo.findById(deployId);
    if (!targetDeployRes.ok || !targetDeployRes.value) {
      return reply
        .status(404)
        .send({ code: 'NOT_FOUND', message: 'Target deployment record not found' });
    }

    const rollbackRes = await localAgentCore.deployEngine.rollbackApp(
      appRes.value,
      targetDeployRes.value.releaseId,
      {
        triggeredByUsername: user.username,
      },
    );

    if (!rollbackRes.ok) {
      return reply
        .status(500)
        .send({ code: rollbackRes.error.code, message: rollbackRes.error.message });
    }

    const rollbackRecord = rollbackRes.value;
    deploymentsRepo.create(rollbackRecord);

    gitAppsRepo.update(appId, {
      commitHash: targetDeployRes.value.commitHash,
      commitMessage: `[Rollback] ${targetDeployRes.value.commitMessage || targetDeployRes.value.releaseId}`,
    });

    return reply.send(rollbackRecord);
  });

  // Coordinated Multi-Node Cluster Deploy
  fastify.post('/api/v1/deploy/apps/:appId/cluster-deploy', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'deploy:trigger')) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }

    const { appId } = req.params as { appId: string };
    const appRes = gitAppsRepo.findById(appId);
    if (!appRes.ok || !appRes.value) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Git app not found' });
    }

    const parsed = ClusterDeploySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const app = appRes.value;
    const nodesRes = nodeRegistry.listNodes();
    const onlineNodes = (nodesRes.ok ? nodesRes.value : []).filter((n) => n.status === 'online');

    const targetNodeIds =
      parsed.data.targetNodeIds && parsed.data.targetNodeIds.length > 0
        ? parsed.data.targetNodeIds
        : onlineNodes.map((n) => n.id);

    const startTime = Date.now();
    const successfulNodes: string[] = [];
    const failedNodes: { nodeId: string; error: string }[] = [];

    await Promise.all(
      targetNodeIds.map(async (nodeId) => {
        try {
          if (nodeId === localAgentCore.agentId) {
            const depRes = await localAgentCore.deployEngine.deployApp(
              { ...app, branch: parsed.data.branch || app.branch },
              {
                commitHash: parsed.data.commitHash,
                triggeredByUsername: user.username,
              },
            );
            if (depRes.ok) {
              successfulNodes.push(nodeId);
              deploymentsRepo.create(depRes.value);
            } else {
              failedNodes.push({ nodeId, error: depRes.error.message });
            }
          } else {
            const remoteRes = await relayProxy.sendCommandToAgent(
              nodeId,
              WSMessageType.PROCESS_ACTION_REQ,
              {
                action: 'deploy',
                target: app.name,
                options: {
                  branch: parsed.data.branch || app.branch,
                  commitHash: parsed.data.commitHash,
                },
              },
              30000,
            );
            if (remoteRes.ok) {
              successfulNodes.push(nodeId);
            } else {
              failedNodes.push({ nodeId, error: remoteRes.error.message });
            }
          }
        } catch (err: any) {
          failedNodes.push({ nodeId, error: err.message || 'Deploy error' });
        }
      }),
    );

    auditRepo.insert({
      userId: user.sub,
      username: user.username,
      action: `deploy:cluster_deploy for ${app.name}`,
      status: failedNodes.length === 0 ? 'success' : 'failure',
      ipAddress: req.ip,
      detailsJson: JSON.stringify({
        successfulNodes,
        failedNodes,
        durationMs: Date.now() - startTime,
      }),
    });

    return reply.send({
      appId,
      successfulNodes,
      failedNodes,
      durationMs: Date.now() - startTime,
      branch: parsed.data.branch || app.branch,
      commitHash: parsed.data.commitHash,
    });
  });

  // Coordinated Multi-Node Cluster Rollback
  fastify.post('/api/v1/deploy/apps/:appId/cluster-rollback', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'deploy:rollback')) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }

    const { appId } = req.params as { appId: string };
    const appRes = gitAppsRepo.findById(appId);
    if (!appRes.ok || !appRes.value) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Git app not found' });
    }
    const app = appRes.value;

    const parsed = ClusterRollbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', errors: parsed.error.errors });
    }

    const { deployId, targetNodeIds } = parsed.data;
    const targetDeployRes = deploymentsRepo.findById(deployId);
    if (!targetDeployRes.ok || !targetDeployRes.value) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Target deployment not found' });
    }
    const targetDeploy = targetDeployRes.value;

    const nodesRes = nodeRegistry.listNodes();
    const onlineNodes = (nodesRes.ok ? nodesRes.value : []).filter((n) => n.status === 'online');
    const nodesToRollback =
      targetNodeIds && targetNodeIds.length > 0 ? targetNodeIds : onlineNodes.map((n) => n.id);

    const successfulNodes: string[] = [];
    const failedNodes: { nodeId: string; error: string }[] = [];

    await Promise.all(
      nodesToRollback.map(async (nodeId) => {
        try {
          if (nodeId === localAgentCore.agentId) {
            const rollbackRes = await localAgentCore.deployEngine.rollbackApp(
              app,
              targetDeploy.releaseId,
              { triggeredByUsername: user.username },
            );
            if (rollbackRes.ok) {
              successfulNodes.push(nodeId);
              deploymentsRepo.create(rollbackRes.value);
            } else {
              failedNodes.push({ nodeId, error: rollbackRes.error.message });
            }
          } else {
            const remoteRes = await relayProxy.sendCommandToAgent(
              nodeId,
              WSMessageType.PROCESS_ACTION_REQ,
              {
                action: 'rollback',
                target: app.name,
                options: { releaseId: targetDeploy.releaseId },
              },
              30000,
            );
            if (remoteRes.ok) {
              successfulNodes.push(nodeId);
            } else {
              failedNodes.push({ nodeId, error: remoteRes.error.message });
            }
          }
        } catch (err: any) {
          failedNodes.push({ nodeId, error: err.message || 'Rollback error' });
        }
      }),
    );

    return reply.send({
      appId,
      targetDeployId: deployId,
      successfulNodes,
      failedNodes,
    });
  });

  fastify.get('/api/v1/deploy/apps/:appId/deployments', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'deploy:view')) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }

    const { appId } = req.params as { appId: string };
    const listRes = deploymentsRepo.listByApp(appId, 50);
    return reply.send(listRes.ok ? listRes.value : []);
  });

  fastify.get('/api/v1/deploy/deployments/:deployId', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'deploy:view')) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }

    const { deployId } = req.params as { deployId: string };
    const depRes = deploymentsRepo.findById(deployId);
    if (!depRes.ok || !depRes.value) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Deployment not found' });
    }

    return reply.send(depRes.value);
  });

  fastify.get('/api/v1/deploy/recent', async (req, reply) => {
    const user = await authenticate(req, reply);
    if (!user) return;

    if (!isAuthorized(user, 'deploy:view')) {
      return reply.status(403).send({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }

    const listRes = deploymentsRepo.listRecent(20);
    return reply.send(listRes.ok ? listRes.value : []);
  });

  // Public GitHub / GitLab Webhook Endpoint
  fastify.post('/api/v1/deploy/webhook/:appId', async (req, reply) => {
    const { appId } = req.params as { appId: string };
    const appRes = gitAppsRepo.findById(appId);
    if (!appRes.ok || !appRes.value) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'App not found' });
    }

    const app = appRes.value;
    if (!app.autoDeploy) {
      return reply
        .status(400)
        .send({ code: 'AUTO_DEPLOY_DISABLED', message: 'Auto-deploy is disabled for this app' });
    }

    // Verify HMAC SHA256 Signature (GitHub) or Secret Token (GitLab)
    const githubSig = req.headers['x-hub-signature-256'] as string | undefined;
    const gitlabToken = req.headers['x-gitlab-token'] as string | undefined;

    let isAuthorized = false;

    if (gitlabToken && gitlabToken === app.webhookSecret) {
      isAuthorized = true;
    } else if (githubSig) {
      const payloadString = JSON.stringify(req.body);
      const computedHmac = `sha256=${crypto.createHmac('sha256', app.webhookSecret).update(payloadString).digest('hex')}`;
      if (crypto.timingSafeEqual(Buffer.from(githubSig), Buffer.from(computedHmac))) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return reply
        .status(401)
        .send({ code: 'INVALID_SIGNATURE', message: 'Webhook signature or secret token invalid' });
    }

    const body = (req.body || {}) as any;
    const ref = body.ref as string | undefined;
    const expectedRef = `refs/heads/${app.branch}`;

    if (ref && ref !== expectedRef) {
      return reply.send({
        message: `Push ignored for branch ${ref}. App configured for ${app.branch}`,
      });
    }

    const deploymentId = crypto.randomUUID();
    const initialRecord = {
      id: deploymentId,
      appId: app.id,
      appName: app.name,
      nodeId: app.nodeId,
      releaseId: `rel_${Date.now()}`,
      commitHash: body.after || body.checkout_sha || 'webhook-push',
      branch: app.branch,
      status: 'building' as const,
      triggerType: 'webhook' as const,
      triggeredByUsername: body.pusher?.name || body.user_username || 'Git Webhook',
      logs: `[Webhook] Triggered by push to ${app.branch}...\n`,
      startedAt: Date.now(),
    };

    deploymentsRepo.create(initialRecord);

    localAgentCore.deployEngine
      .deployApp(app, {
        branch: app.branch,
        triggerType: 'webhook',
        triggeredByUsername: 'Git Webhook',
        onLog: (chunk) => {
          deploymentsRepo.appendLogs(deploymentId, chunk);
        },
      })
      .then((deployRes) => {
        if (deployRes.ok) {
          const rec = deployRes.value;
          deploymentsRepo.updateStatus(deploymentId, rec.status, {
            logs: rec.logs,
            finishedAt: rec.finishedAt,
            durationMs: rec.durationMs,
            errorMessage: rec.errorMessage,
          });

          if (rec.status === 'success') {
            gitAppsRepo.update(app.id, {
              commitHash: rec.commitHash,
              commitMessage: rec.commitMessage,
              commitAuthor: rec.commitAuthor,
              branch: rec.branch,
            });
          }
        }
      });

    return reply.status(202).send({ message: 'Deployment triggered successfully', deploymentId });
  });

  // 8. Agent WebSocket Handshake Route
  fastify.get('/api/v1/agent/connect', { websocket: true }, (socket) => {
    let connectedAgentId: string | null = null;

    socket.on('message', (data: any) => {
      try {
        const msg = JSON.parse(data.toString()) as WSMessage<any>;

        if (msg.type === WSMessageType.AGENT_HANDSHAKE_INIT) {
          const init = msg.payload as HandshakeInitPayload;
          connectedAgentId = init.agentId;

          const challengeRes = nodeRegistry.initiateHandshake(init);
          if (challengeRes.ok) {
            socket.send(
              JSON.stringify({
                id: msg.id,
                type: WSMessageType.AGENT_HANDSHAKE_CHALLENGE,
                payload: challengeRes.value,
                timestamp: Date.now(),
              }),
            );
          }
        } else if (msg.type === WSMessageType.AGENT_HANDSHAKE_RESPONSE) {
          if (!connectedAgentId) return;
          const resp = msg.payload as HandshakeResponsePayload;

          const ackRes = nodeRegistry.verifyHandshakeResponse({
            agentId: connectedAgentId,
            signature: resp.signature,
            timestamp: resp.timestamp,
          });

          if (ackRes.ok) {
            relayProxy.registerAgentSocket(connectedAgentId, socket);
            socket.send(
              JSON.stringify({
                id: msg.id,
                type: WSMessageType.AGENT_HANDSHAKE_ACK,
                payload: ackRes.value,
                timestamp: Date.now(),
              }),
            );
          } else {
            socket.send(
              JSON.stringify({
                id: msg.id,
                type: WSMessageType.AGENT_HANDSHAKE_REJECT,
                payload: { message: ackRes.error.message },
                timestamp: Date.now(),
              }),
            );
            socket.close(4003, ackRes.error.message);
          }
        } else {
          if (connectedAgentId) {
            relayProxy.handleAgentMessage(connectedAgentId, data.toString());
          }
        }
      } catch (error) {
        fastify.log.error(error, 'Error in Agent WebSocket connection');
      }
    });

    socket.on('close', () => {
      if (connectedAgentId) {
        relayProxy.removeAgentSocket(connectedAgentId);
      }
    });
  });
};
