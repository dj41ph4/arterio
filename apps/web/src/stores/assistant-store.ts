'use client';

import { create } from 'zustand';
import type { ChatTraceEntry } from '@/lib/data/ai';

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Which tools the server ran to ground this answer — shown as a collapsible line. */
  trace?: ChatTraceEntry[];
  error?: boolean;
}

interface AssistantState {
  messages: AssistantMessage[];
  pending: boolean;
  /** A question queued from elsewhere (command palette handoff) — the widget sends it as soon as it opens. */
  pendingQuestion: string | null;
  append: (m: AssistantMessage) => void;
  setPending: (v: boolean) => void;
  setPendingQuestion: (q: string | null) => void;
  clear: () => void;
}

/** Deliberately NOT persisted — the server is stateless and the free-tier token budget caps history anyway (plan D3). */
export const useAssistantStore = create<AssistantState>()((set) => ({
  messages: [],
  pending: false,
  pendingQuestion: null,
  append: (m) => set((s) => ({ messages: [...s.messages, m] })),
  setPending: (pending) => set({ pending }),
  setPendingQuestion: (pendingQuestion) => set({ pendingQuestion }),
  clear: () => set({ messages: [] }),
}));
