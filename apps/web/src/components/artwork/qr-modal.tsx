'use client';

import * as React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Download, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface QrModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  url: string;
}

export function QrModal({ open, onClose, title, url }: QrModalProps) {
  const t = useTranslations('artwork');

  function handleDownload() {
    const svg = document.getElementById('artwork-qr-svg');
    if (!svg) return;
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qr-${title.replace(/\s+/g, '-').toLowerCase()}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>{t('qr.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="rounded-xl border bg-white p-4">
            <QRCodeSVG
              id="artwork-qr-svg"
              value={url}
              size={200}
              level="M"
              includeMargin={false}
            />
          </div>
          <p className="text-center text-xs text-[var(--muted-foreground)] break-all">{url}</p>
          <Button variant="outline" size="sm" className="gap-1.5 w-full" onClick={handleDownload}>
            <Download className="size-3.5" />
            {t('qr.download')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
