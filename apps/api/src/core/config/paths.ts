import { join } from 'node:path';

/**
 * Local disk storage for uploaded media — also served statically at /uploads
 * (see main.ts). Honors the UPLOAD_DIR env var so the container can place media
 * in the mapped /data volume; falls back to <cwd>/uploads for local dev.
 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
