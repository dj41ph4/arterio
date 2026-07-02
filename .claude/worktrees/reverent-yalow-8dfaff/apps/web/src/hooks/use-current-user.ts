'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth-store';

const USE_API = process.env.NEXT_PUBLIC_DATA_SOURCE === 'http';

export interface CurrentUser {
  sub: string;
  email: string;
  fullName: string;
  displayName: string | null;
  organizationName: string;
  roles: string[];
}

export function useCurrentUser() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: ['current-user'],
    queryFn: () => apiFetch<CurrentUser>('/auth/me'),
    enabled: USE_API && !!accessToken,
    staleTime: 5 * 60_000,
  });
}
