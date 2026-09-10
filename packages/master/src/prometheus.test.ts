import { describe, it, expect } from 'vitest';
import { formatPrometheusMetrics } from './metrics/prometheus.js';
import { NodeState, ProcessInfo, HostMetrics } from '@pm2-webui/shared';

describe('Prometheus Metrics Exposition Formatter', () => {
  it('formats Prometheus exposition text accurately with gauges, node status, and processes', () => {
    const nodes: NodeState[] = [
      {
        id: 'node-1',
        hostname: 'worker-primary',
        ipAddress: '192.168.1.10',
        port: 3006,
        publicKey: 'pubkey1',
        connectivityMode: 'direct',
        status: 'online',
        version: '1.1.2',
        enrolledAt: 1000000,
        lastSeenAt: 1005000,
      },
      {
        id: 'node-2',
        hostname: 'worker-offline',
        ipAddress: '192.168.1.11',
        port: 3006,
        publicKey: 'pubkey2',
        connectivityMode: 'relay',
        status: 'offline',
        version: '1.1.2',
        enrolledAt: 1000000,
        lastSeenAt: 900000,
      },
    ];

    const hostMetrics = {
      timestamp: Date.now(),
      cpu: {
        cores: 8,
        usagePercent: 25.5,
        load1m: 1.2,
        load5m: 1.0,
        load15m: 0.8,
      },
      memory: {
        total: 16 * 1024 * 1024 * 1024,
        used: 8 * 1024 * 1024 * 1024,
        free: 8 * 1024 * 1024 * 1024,
        swapTotal: 0,
        swapUsed: 0,
      },
      disk: {
        total: 100 * 1024 * 1024 * 1024,
        used: 40 * 1024 * 1024 * 1024,
        free: 60 * 1024 * 1024 * 1024,
        usagePercent: 40,
      },
      network: {
        rxSec: 1000,
        txSec: 2000,
      },
    } as unknown as HostMetrics;

    const processes = [
      {
        name: 'web-server',
        pmId: 0,
        pid: 1234,
        status: 'online',
        instances: 1,
        restarts: 2,
        uptime: 3600,
        cpu: 12.4,
        memory: 150 * 1024 * 1024,
        heapUsedMb: 85.2,
        heapTotalMb: 120.0,
        eventLoopDelayMs: 1.15,
        rps: 240,
        latencyMs: 14.5,
      },
    ] as unknown as ProcessInfo[];

    const nodeMetrics = new Map<string, { host?: HostMetrics; processes?: readonly ProcessInfo[] }>();
    nodeMetrics.set('node-1', { host: hostMetrics, processes });

    const result = formatPrometheusMetrics({ nodes, nodeMetrics });

    // Verifications
    expect(result).toContain('# HELP pm2_up Master control plane health status');
    expect(result).toContain('pm2_up 1');
    expect(result).toContain('pm2_node_status{node_id="node-1",hostname="worker-primary",ip="192.168.1.10",mode="direct"} 1');
    expect(result).toContain('pm2_node_status{node_id="node-2",hostname="worker-offline",ip="192.168.1.11",mode="relay"} 0');
    expect(result).toContain('pm2_process_status{node_id="node-1",hostname="worker-primary",process="web-server",pm_id="0",exec_mode="undefined"} 1');
    expect(result).toContain('pm2_process_cpu_percent{node_id="node-1",hostname="worker-primary",process="web-server",pm_id="0"} 12.4');
    expect(result).toContain('pm2_process_memory_bytes{node_id="node-1",hostname="worker-primary",process="web-server",pm_id="0"} 157286400');
    expect(result).toContain('pm2_process_restarts_total{node_id="node-1",hostname="worker-primary",process="web-server",pm_id="0"} 2');
    expect(result).toContain('pm2_process_event_loop_delay_seconds{node_id="node-1",hostname="worker-primary",process="web-server",pm_id="0"}');
    expect(result).toContain('pm2_node_cpu_utilization_percent{node_id="node-1",hostname="worker-primary"} 25.5');
    expect(result).toContain('pm2_node_memory_used_bytes{node_id="node-1",hostname="worker-primary"} 8589934592');
    expect(result).toContain('pm2_node_disk_used_bytes{node_id="node-1",hostname="worker-primary"} 42949672960');
  });
});
