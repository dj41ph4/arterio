'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_ACCENT } from '@/lib/accent';

/**
 * SSR-safe storage. We deliberately reference `window.localStorage` (not the
 * bare `localStorage` global) so the server never touches storage — some Node
 * runtimes expose a malformed experimental `localStorage` global that throws.
 */
const safeStorage = createJSONStorage(() =>
  typeof window !== 'undefined'
    ? window.localStorage
    : { getItem: () => null, setItem: () => {}, removeItem: () => {} },
);

interface UiState {
  accent: string;
  setAccent: (accent: string) => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;

  commandOpen: boolean;
  setCommandOpen: (v: boolean) => void;
  toggleCommand: () => void;

  assistantOpen: boolean;
  setAssistantOpen: (v: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      accent: DEFAULT_ACCENT,
      setAccent: (accent) => set({ accent }),

      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

      commandOpen: false,
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      toggleCommand: () => set((s) => ({ commandOpen: !s.commandOpen })),

      assistantOpen: false,
      setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
    }),
    {
      name: 'arterio-ui',
      storage: safeStorage,
      // Avoid hydration mismatches: rehydrate from storage after mount.
      skipHydration: true,
      // Only persist user preferences, not transient open states.
      partialize: (s) => ({ accent: s.accent, sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);
