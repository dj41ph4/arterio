'use client';

import { useTranslations } from 'next-intl';
import {
  ARTWORK_STATUS_TONE,
  CONDITION_TONE,
  type ArtworkStatus,
  type ConditionRating,
} from '@arterio/shared';
import { Badge } from '@/components/ui/badge';

export function StatusBadge({ status }: { status: ArtworkStatus }) {
  const t = useTranslations('status');
  return (
    <Badge tone={ARTWORK_STATUS_TONE[status]} dot>
      {t(status)}
    </Badge>
  );
}

export function ConditionBadge({ condition }: { condition: ConditionRating }) {
  const t = useTranslations('condition');
  return <Badge tone={CONDITION_TONE[condition]}>{t(condition)}</Badge>;
}
