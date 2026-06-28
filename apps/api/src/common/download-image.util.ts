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

/** Rejects loopback/private/link-local targets — the caller controls this URL, so without this a write-permission user could probe internal network services via the server (SSRF). */
function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168);
  }
  return address === '::1' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd');
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

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
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
