import { join } from 'node:path';

/** Local disk storage for uploaded media — also served statically at /uploads (see main.ts). */
export const UPLOAD_DIR = join(process.cwd(), 'uploads');
