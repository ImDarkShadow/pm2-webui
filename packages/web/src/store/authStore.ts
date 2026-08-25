import { create } from 'zustand';
import { api, UserSession } from '../api/client.js';

export interface LoginResponse {
  requires2FA?: boolean;
  tempToken?: string;
  userId?: string;
  user?: UserSession;
}

interface AuthState {
  user: UserSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<LoginResponse>;
  verify2FA: (tempToken: string, code: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (username, password) => {
    const data = await api.login(username, password);
    if (!data.requires2FA && data.user) {
      set({ user: data.user, isAuthenticated: true });
    }
    return data;
  },

  verify2FA: async (tempToken, code) => {
    const data = await api.verify2FA(tempToken, code);
    set({ user: data.user, isAuthenticated: true });
  },

  logout: () => {
    api.clearTokens();
    set({ user: null, isAuthenticated: false });
  },

  checkAuth: async () => {
    if (!api.getAccessToken()) {
      set({ user: null, isAuthenticated: false, isLoading: false });
      return;
    }
    try {
      const data = await api.getMe();
      set({ user: data.user, isAuthenticated: true, isLoading: false });
    } catch {
      api.clearTokens();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
