import { join, dirname } from 'node:path';

/**
 * Local disk storage for uploaded media — also served statically at /uploads
 * (see main.ts). Honors the UPLOAD_DIR env var so the container can place media
 * in the mapped /data volume; falls back to <cwd>/uploads for local dev.
 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');

/**
 * A manually-uploaded TLS certificate (Settings → HTTPS) lives alongside
 * uploads in the same persistent volume, so it survives container restarts
 * and image updates. Falls back to a self-signed cert generated at boot
 * (see main.ts) when no file is present here.
 */
export const CERTS_DIR = join(dirname(UPLOAD_DIR), 'certs');
export const CUSTOM_CERT_PATH = join(CERTS_DIR, 'custom-cert.pem');
export const CUSTOM_KEY_PATH = join(CERTS_DIR, 'custom-key.pem');
