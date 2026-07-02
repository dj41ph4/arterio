import Link from 'next/link';

/**
 * Global fallback (locale-less). Most 404s resolve in [locale]/not-found;
 * this covers requests outside any locale segment.
 */
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body
        style={{
          display: 'flex',
          minHeight: '100dvh',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h1 style={{ fontSize: '3rem', margin: 0 }}>404</h1>
        <p style={{ color: '#666' }}>This page could not be found.</p>
        <Link href="/en/dashboard" style={{ color: '#6366f1' }}>
          Go to Arterio
        </Link>
      </body>
    </html>
  );
}
