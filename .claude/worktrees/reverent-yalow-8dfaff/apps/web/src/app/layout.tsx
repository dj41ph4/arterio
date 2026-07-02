import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Arterio — Art collection management',
    template: '%s · Arterio',
  },
  description:
    'Professional art collection management for museums, galleries, foundations and auction houses.',
  applicationName: 'Arterio',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0e16' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
