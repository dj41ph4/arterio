import { API_BASE_URL } from '@/lib/api/client';
import { useAuthStore } from '@/stores/auth-store';

export type ReportType = 'catalogue' | 'insurance' | 'conservation' | 'financial';

export const reportsApi = {
  /** Downloads a generated PDF report via the browser. */
  async downloadPdf(type: ReportType): Promise<void> {
    const { accessToken } = useAuthStore.getState();
    const res = await fetch(`${API_BASE_URL}/reports/${type}/pdf`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(body.message ?? `Report generation failed (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arterio-${type}-${new Date().toISOString().slice(0, 10)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
