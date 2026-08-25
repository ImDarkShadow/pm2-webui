import { create } from 'zustand';

interface NodeSummary {
  id: string;
  hostname: string;
  ipAddress: string;
  port: number;
  connectivityMode: string;
  status: string;
  version?: string;
  lastSeenAt?: number;
  isOnline: boolean;
}

interface NodeStateStore {
  selectedNodeId: string | null;
  nodes: NodeSummary[];
  setSelectedNodeId: (id: string | null) => void;
  setNodes: (nodes: NodeSummary[]) => void;
}

export const useNodeStore = create<NodeStateStore>((set) => ({
  selectedNodeId: null,
  nodes: [],
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  setNodes: (nodes) =>
    set((state) => ({
      nodes,
      selectedNodeId: state.selectedNodeId || (nodes[0] ? nodes[0].id : null),
    })),
}));
