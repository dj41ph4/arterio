'use client';

import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Send, Sparkles, Trash2, X } from 'lucide-react';
import type { Locale } from '@arterio/shared';
import { aiApi } from '@/lib/data/ai';
import { useUiStore } from '@/stores/ui-store';
import { useAssistantStore, type AssistantMessage } from '@/stores/assistant-store';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChatMessageBubble } from './chat-message';

let nextId = 0;
const uid = () => `msg_${Date.now()}_${nextId++}`;

/**
 * Floating assistant: a round launcher pinned bottom-right that opens a chat
 * POPUP (Intercom-style card, not a sidebar). The page behind stays visible
 * and interactive — no backdrop.
 */
export function AssistantWidget() {
  const t = useTranslations('assistant');
  const locale = useLocale() as Locale;
  const open = useUiStore((s) => s.assistantOpen);
  const setOpen = useUiStore((s) => s.setAssistantOpen);
  const { messages, pending, append, setPending, clear, pendingQuestion, setPendingQuestion } = useAssistantStore();
  const [input, setInput] = React.useState('');
  const [aiDisabled, setAiDisabled] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 180);
  }, [open]);

  // Handoff from the command palette: a queued question fires as soon as the popup opens.
  React.useEffect(() => {
    if (open && pendingQuestion && !pending) {
      const q = pendingQuestion;
      setPendingQuestion(null);
      void send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingQuestion]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    setInput('');
    const userMessage: AssistantMessage = { id: uid(), role: 'user', content: question };
    append(userMessage);
    setPending(true);
    try {
      const history = [...useAssistantStore.getState().messages]
        .filter((m) => !m.error)
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await aiApi.chat({ messages: history, locale });
      append({
        id: uid(),
        role: 'assistant',
        content: res.message || t('emptyAnswer'),
        trace: res.trace,
      });
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 503) {
        setAiDisabled(true);
        append({ id: uid(), role: 'assistant', content: t('aiDisabled'), error: true });
      } else {
        append({ id: uid(), role: 'assistant', content: t('error'), error: true });
      }
    } finally {
      setPending(false);
    }
  }

  const suggestions = [t('examples.q1'), t('examples.q2'), t('examples.q3'), t('examples.q4')];

  return (
    <>
      {/* Chat popup */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            style={{ transformOrigin: 'bottom right' }}
            className={cn(
              'fixed z-40 flex flex-col overflow-hidden rounded-2xl border bg-background shadow-floating',
              // Mobile: near-fullscreen popup clearing the topbar + bottom nav; desktop: Intercom-style card.
              'inset-x-3 bottom-[5.5rem] top-20',
              'md:inset-auto md:bottom-24 md:right-6 md:h-[min(620px,calc(100dvh-8rem))] md:w-[400px]',
            )}
            role="dialog"
            aria-label={t('title')}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b bg-gradient-to-r from-primary/10 to-transparent px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-full bg-primary/15">
                  <Sparkles className="size-4 text-primary" />
                </div>
                <h2 className="text-sm font-semibold">{t('title')}</h2>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <Button variant="ghost" size="icon-sm" onClick={clear} title={t('clear')}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
                <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)}>
                  <X className="size-4" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                  <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
                    <Sparkles className="size-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{t('emptyTitle')}</p>
                    <p className="mt-1 max-w-[260px] text-xs text-muted-foreground">{t('emptyHint')}</p>
                  </div>
                  <div className="flex w-full flex-col gap-2">
                    {suggestions.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => send(q)}
                        className="rounded-xl border bg-card px-3 py-2 text-left text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m) => (
                <ChatMessageBubble key={m.id} message={m} />
              ))}
              {pending && (
                <div className="flex items-center gap-2 pl-8 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  {t('thinking')}
                </div>
              )}
              {aiDisabled && (
                <div className="rounded-xl border border-dashed p-3 text-center text-xs text-muted-foreground">
                  {t('aiDisabledHint')}{' '}
                  <Link href="/settings" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => setOpen(false)}>
                    {t('aiDisabledCta')}
                  </Link>
                </div>
              )}
            </div>

            {/* Input */}
            <form
              className="border-t p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
            >
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send(input);
                    }
                  }}
                  rows={1}
                  placeholder={t('placeholder')}
                  className="max-h-32 min-h-[38px] flex-1 resize-none rounded-xl border bg-card px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
                />
                <Button type="submit" size="icon-sm" disabled={!input.trim() || pending} className="mb-0.5 shrink-0">
                  <Send className="size-4" />
                </Button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Round floating launcher — above the mobile bottom nav, classic corner on desktop */}
      <motion.button
        type="button"
        onClick={() => setOpen(!open)}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        className={cn(
          'fixed z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-floating',
          'bg-gradient-to-br from-[hsl(var(--primary)/0.92)] to-[hsl(var(--primary))]',
          'bottom-20 right-4 md:bottom-6 md:right-6',
        )}
        aria-label={t('title')}
      >
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.span key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.15 }}>
              <X className="size-6" />
            </motion.span>
          ) : (
            <motion.span key="s" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }} transition={{ duration: 0.15 }}>
              <Sparkles className="size-6" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </>
  );
}
