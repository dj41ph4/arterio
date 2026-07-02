'use client';

import * as React from 'react';
import { ChevronDown, Sparkles, Wrench } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { AssistantMessage } from '@/stores/assistant-store';

/** Minimal markdown: **bold**, bullet lines, paragraphs — no dependency, chat answers are short. */
function renderContent(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={j}>{part.slice(2, -2)}</strong>
      ) : (
        <React.Fragment key={j}>{part}</React.Fragment>
      ),
    );
    const isBullet = /^\s*[-•]\s+/.test(line);
    return (
      <React.Fragment key={i}>
        {isBullet ? <span className="block pl-3">{parts}</span> : parts}
        {i < lines.length - 1 && !isBullet ? <br /> : null}
      </React.Fragment>
    );
  });
}

export function ChatMessageBubble({ message }: { message: AssistantMessage }) {
  const t = useTranslations('assistant');
  const [traceOpen, setTraceOpen] = React.useState(false);
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex w-full gap-2', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="size-3.5 text-primary" />
        </div>
      )}
      <div className={cn('max-w-[85%] space-y-1', isUser && 'flex flex-col items-end')}>
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
            isUser
              ? 'rounded-br-sm bg-primary text-primary-foreground'
              : message.error
                ? 'rounded-bl-sm border border-destructive/30 bg-destructive/10 text-foreground'
                : 'rounded-bl-sm bg-muted text-foreground',
          )}
        >
          {renderContent(message.content)}
        </div>
        {!isUser && message.trace && message.trace.length > 0 && (
          <div className="px-1">
            <button
              type="button"
              onClick={() => setTraceOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Wrench className="size-3" />
              {t('toolTrace', { count: message.trace.length })}
              <ChevronDown className={cn('size-3 transition-transform', traceOpen && 'rotate-180')} />
            </button>
            {traceOpen && (
              <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                {message.trace.map((entry, i) => (
                  <li key={i} className="pl-4">
                    {entry.summary}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
