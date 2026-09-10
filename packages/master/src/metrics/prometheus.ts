import { ProcessInfo, HostMetrics, NodeState } from '@pm2-webui/shared';

export interface PrometheusExportInput {
  readonly nodes: readonly NodeState[];
  readonly nodeMetrics: ReadonlyMap<string, { host?: HostMetrics; processes?: readonly ProcessInfo[] }>;
}

export const formatPrometheusMetrics = (input: PrometheusExportInput): string => {
  const lines: string[] = [];
  const append = (line: string) => lines.push(line);

  append('# HELP pm2_up Master control plane health status (1 = up)');
  append('# TYPE pm2_up gauge');
  append('pm2_up 1');
  append('');

  append('# HELP pm2_node_status Node connectivity status (1 = online, 0 = offline/pending)');
  append('# TYPE pm2_node_status gauge');
  for (const node of input.nodes) {
    const isOnline = node.status === 'online' ? 1 : 0;
    append(
      `pm2_node_status{node_id="${node.id}",hostname="${node.hostname}",ip="${node.ipAddress}",mode="${node.connectivityMode}"} ${isOnline}`,
    );
  }
  append('');

  append('# HELP pm2_process_status PM2 process status (1 = online, 0 = stopped/errored)');
  append('# TYPE pm2_process_status gauge');
  for (const node of input.nodes) {
    const metrics = input.nodeMetrics.get(node.id);
    const procs = metrics?.processes || [];
    for (const p of procs) {
      const isOnline = p.status === 'online' ? 1 : 0;
      append(
        `pm2_process_status{node_id="${node.id}",hostname="${node.hostname}",process="${p.name}",pm_id="${p.pmId}",exec_mode="${p.execMode}"} ${isOnline}`,
      );
    }
  }
  append('');

  append('# HELP pm2_process_cpu_percent PM2 process CPU utilization percentage');
  append('# TYPE pm2_process_cpu_percent gauge');
  for (const node of input.nodes) {
    const metrics = input.nodeMetrics.get(node.id);
    const procs = metrics?.processes || [];
    for (const p of procs) {
      const cpu = p.monit?.cpu ?? p.cpu ?? 0;
      append(
        `pm2_process_cpu_percent{node_id="${node.id}",hostname="${node.hostname}",process="${p.name}",pm_id="${p.pmId}"} ${cpu}`,
      );
    }
  }
  append('');

  append('# HELP pm2_process_memory_bytes PM2 process Resident Set Size (RSS) memory in bytes');
  append('# TYPE pm2_process_memory_bytes gauge');
  for (const node of input.nodes) {
    const metrics = input.nodeMetrics.get(node.id);
    const procs = metrics?.processes || [];
    for (const p of procs) {
      const mem = p.monit?.memory ?? p.memory ?? 0;
      append(
        `pm2_process_memory_bytes{node_id="${node.id}",hostname="${node.hostname}",process="${p.name}",pm_id="${p.pmId}"} ${mem}`,
      );
    }
  }
  append('');

  append('# HELP pm2_process_restarts_total Total number of restarts for process');
  append('# TYPE pm2_process_restarts_total counter');
  for (const node of input.nodes) {
    const metrics = input.nodeMetrics.get(node.id);
    const procs = metrics?.processes || [];
    for (const p of procs) {
      append(
        `pm2_process_restarts_total{node_id="${node.id}",hostname="${node.hostname}",process="${p.name}",pm_id="${p.pmId}"} ${p.restarts ?? 0}`,
      );
    }
  }
  append('');

  append('# HELP pm2_process_event_loop_delay_seconds Node.js event loop delay in seconds');
  append('# TYPE pm2_process_event_loop_delay_seconds gauge');
  for (const node of input.nodes) {
    const metrics = input.nodeMetrics.get(node.id);
    const procs = metrics?.processes || [];
    for (const p of procs) {
      const delaySec = ((p.eventLoopDelayMs ?? 0.5) / 1000).toFixed(4);
      append(
        `pm2_process_event_loop_delay_seconds{node_id="${node.id}",hostname="${node.hostname}",process="${p.name}",pm_id="${p.pmId}"} ${delaySec}`,
      );
    }
  }
  append('');

  append('# HELP pm2_node_cpu_utilization_percent Host CPU utilization percentage');
  append('# TYPE pm2_node_cpu_utilization_percent gauge');
  for (const node of input.nodes) {
    const metrics = input.nodeMetrics.get(node.id);
    if (metrics?.host) {
      append(
        `pm2_node_cpu_utilization_percent{node_id="${node.id}",hostname="${node.hostname}"} ${metrics.host.cpu.usagePercent}`,
      );
    }
  }
  append('');

  append('# HELP pm2_node_memory_used_bytes Host RAM used in bytes');
  append('# TYPE pm2_node_memory_used_bytes gauge');
  for (const node of input.nodes) {
    const metrics = input.nodeMetrics.get(node.id);
    if (metrics?.host) {
      append(
        `pm2_node_memory_used_bytes{node_id="${node.id}",hostname="${node.hostname}"} ${metrics.host.memory.used}`,
      );
    }
  }
  append('');

  append('# HELP pm2_node_disk_used_bytes Host disk space used in bytes');
  append('# TYPE pm2_node_disk_used_bytes gauge');
  for (const node of input.nodes) {
    const metrics = input.nodeMetrics.get(node.id);
    if (metrics?.host) {
      append(
        `pm2_node_disk_used_bytes{node_id="${node.id}",hostname="${node.hostname}"} ${metrics.host.disk.used}`,
      );
    }
  }
  append('');

  return lines.join('\n') + '\n';
};
