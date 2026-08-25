import { create } from 'zustand';
import { api } from '../api/client.js';

export type ProcessViewMode = 'cards' | 'table';
export type DensityMode = 'comfortable' | 'compact';

interface PreferencesState {
  processViewMode: ProcessViewMode;
  density: DensityMode;
  sidebarCollapsed: boolean;
  selectedNodeFilter: string;
  autoRefreshInterval: number; // in ms, default 4000
  isLoaded: boolean;

  setProcessViewMode: (mode: ProcessViewMode) => void;
  setDensity: (density: DensityMode) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSelectedNodeFilter: (nodeId: string) => void;
  setAutoRefreshInterval: (interval: number) => void;
  loadPreferences: () => Promise<void>;
  savePreferences: (partial: Partial<PreferencesState>) => Promise<void>;
}

const LOCAL_STORAGE_KEY = 'pm2_cluster_user_preferences';

export const usePreferencesStore = create<PreferencesState>((set, get) => {
  // Load initial from localStorage if present
  let initialPrefs: any = {};
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) initialPrefs = JSON.parse(raw);
  } catch {
    // Ignore parse error
  }

  return {
    processViewMode: initialPrefs.processViewMode || 'cards',
    density: initialPrefs.density || 'comfortable',
    sidebarCollapsed: initialPrefs.sidebarCollapsed || false,
    selectedNodeFilter: initialPrefs.selectedNodeFilter || 'all',
    autoRefreshInterval: initialPrefs.autoRefreshInterval || 4000,
    isLoaded: false,

    setProcessViewMode: (mode) => {
      set({ processViewMode: mode });
      get().savePreferences({ processViewMode: mode });
    },

    setDensity: (density) => {
      set({ density });
      get().savePreferences({ density });
    },

    setSidebarCollapsed: (collapsed) => {
      set({ sidebarCollapsed: collapsed });
      get().savePreferences({ sidebarCollapsed: collapsed });
    },

    setSelectedNodeFilter: (filter) => {
      set({ selectedNodeFilter: filter });
      get().savePreferences({ selectedNodeFilter: filter });
    },

    setAutoRefreshInterval: (interval) => {
      set({ autoRefreshInterval: interval });
      get().savePreferences({ autoRefreshInterval: interval });
    },

    loadPreferences: async () => {
      try {
        const backendPrefs = await api.getPreferences().catch(() => null);
        if (
          backendPrefs &&
          typeof backendPrefs === 'object' &&
          Object.keys(backendPrefs).length > 0
        ) {
          set({
            processViewMode: backendPrefs.processViewMode || get().processViewMode,
            density: backendPrefs.density || get().density,
            sidebarCollapsed: backendPrefs.sidebarCollapsed ?? get().sidebarCollapsed,
            selectedNodeFilter: backendPrefs.selectedNodeFilter || get().selectedNodeFilter,
            autoRefreshInterval: backendPrefs.autoRefreshInterval || get().autoRefreshInterval,
            isLoaded: true,
          });
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(backendPrefs));
          return;
        }
      } catch {
        // Use local storage fallback
      }
      set({ isLoaded: true });
    },

    savePreferences: async (partial) => {
      const state = get();
      const updated = {
        processViewMode: partial.processViewMode ?? state.processViewMode,
        density: partial.density ?? state.density,
        sidebarCollapsed: partial.sidebarCollapsed ?? state.sidebarCollapsed,
        selectedNodeFilter: partial.selectedNodeFilter ?? state.selectedNodeFilter,
        autoRefreshInterval: partial.autoRefreshInterval ?? state.autoRefreshInterval,
      };

      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
        await api.updatePreferences(updated).catch(() => {});
      } catch {
        // Best effort
      }
    },
  };
});
