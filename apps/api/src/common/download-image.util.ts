import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { UPLOAD_DIR } from '../core/config/paths';

const ALLOWED_IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

// Gallery/auction sites block bare fetch() with 403 — mimic a browser request.
// Referer: google.com is accepted by most hotlink-protection rules.
const DOWNLOAD_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  Referer: 'https://www.google.com/',
};

/** Rejects loopback/private/link-local targets — the caller controls this URL, so without this a write-permission user could probe internal network services via the server (SSRF). */
function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168);
  }
  return address === '::1' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd');
}

/**
 * Cheaply checks whether a URL actually resolves to a real image, without
 * downloading the full body — used to decide whether an AI-suggested
 * imageUrl (found via grounded web search, not memorized) is worth offering
 * to the user at all, instead of only finding out it's a 404 or an HTML
 * page once the user clicks save.
 */
export async function isLikelyRealImage(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const resolved = await lookup(parsed.hostname).catch(() => null);
    if (!resolved || isPrivateAddress(resolved.address)) return false;

    const res = await fetch(url, { method: 'HEAD', headers: DOWNLOAD_HEADERS, signal: AbortSignal.timeout(4_000) }).catch(() => null);
    if (!res?.ok) return false;
    const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    return Boolean(ALLOWED_IMAGE_MIME_EXT[mimeType]);
  } catch {
    return false;
  }
}

/**
 * Downloads an (AI-suggested or otherwise externally-sourced) image URL
 * server-side and writes it into UPLOAD_DIR — the browser never fetches the
 * arbitrary third-party URL directly. Shared by artwork media-from-url and
 * artist photo-from-url, since both need the identical SSRF guard + mime/size
 * validation.
 */
export async function downloadImageToUploads(url: string): Promise<{ filename: string; mimetype: string; size: number }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('Invalid URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BadRequestException('Invalid URL');
  }
  const resolved = await lookup(parsed.hostname).catch(() => null);
  if (!resolved || isPrivateAddress(resolved.address)) {
    throw new BadRequestException('Invalid URL');
  }

  const res = await fetch(url, { headers: DOWNLOAD_HEADERS, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) throw new BadRequestException('Could not download image');

  const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  const ext = ALLOWED_IMAGE_MIME_EXT[mimeType];
  if (!ext) throw new BadRequestException('Unsupported image type');

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > 15 * 1024 * 1024) throw new BadRequestException('Image too large');

  const filename = `${randomBytes(16).toString('hex')}${ext}`;
  await writeFile(join(UPLOAD_DIR, filename), buffer);

  return { filename, mimetype: mimeType, size: buffer.byteLength };
}
