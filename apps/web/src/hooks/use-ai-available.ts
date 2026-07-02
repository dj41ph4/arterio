import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '@/lib/data/admin';

const USE_API = process.env.NEXT_PUBLIC_DATA_SOURCE === 'http';

/** Whether the "AI autofill" buttons should render at all — false if OpenRouter isn't enabled + configured for this org. */
export function useAiAvailable(): boolean {
  const { data } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: settingsApi.getAiSettings,
    enabled: USE_API,
    staleTime: 60_000,
  });
  if (!USE_API) return false;
  return Boolean(data?.enabled && data.hasApiKey);
}
