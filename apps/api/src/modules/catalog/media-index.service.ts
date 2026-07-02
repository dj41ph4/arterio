import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { PrismaService } from '../../core/prisma/prisma.service';
import { UPLOAD_DIR } from '../../core/config/paths';

export interface MediaIndexBackfillStatus {
  running: boolean;
  done: number;
  total: number;
  indexed: number;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * Computes and stores the visual signature of a MediaAsset: sha-256 checksum,
 * pixel dimensions, a 64-bit perceptual hash (DCT pHash — survives resizes,
 * recompression and small crops) and the 4 dominant colors. The palette is
 * rolled up onto Artwork.dominantColors when the artwork has none — that
 * column was only ever seeded by demo data, never by real uploads.
 *
 * Everything here is best-effort: indexing failures are logged and swallowed,
 * an unindexed asset simply stays invisible to color search / visual
 * duplicates / similarity until the backfill retries it.
 */
@Injectable()
export class MediaIndexService {
  private readonly logger = new Logger(MediaIndexService.name);

  constructor(private readonly prisma: PrismaService) {}

  async indexAsset(assetId: string): Promise<boolean> {
    try {
      const asset = await this.prisma.mediaAsset.findUnique({ where: { id: assetId } });
      if (!asset || asset.type !== 'image') return false;

      const buffer = await readFile(join(UPLOAD_DIR, asset.storageKey));
      const checksum = createHash('sha256').update(buffer).digest('hex');

      const image = sharp(buffer, { failOn: 'none' });
      const meta = await image.metadata();

      const [phash, dominantColors] = await Promise.all([
        this.computePhash(image.clone()),
        this.computeDominantColors(image.clone()),
      ]);

      await this.prisma.mediaAsset.update({
        where: { id: assetId },
        data: {
          checksum,
          width: meta.width ?? null,
          height: meta.height ?? null,
          phash,
          },
      });

      // Roll the palette up onto the artwork when it has none of its own.
      if (asset.artworkId && dominantColors.length) {
        const artwork = await this.prisma.artwork.findUnique({
          where: { id: asset.artworkId },
          select: { dominantColors: true },
        });
        const existing = (artwork?.dominantColors as string[] | null) ?? [];
        if (!existing.length) {
          await this.prisma.artwork.update({
            where: { id: asset.artworkId },
            data: { dominantColors },
          });
        }
      }
      return true;
    } catch (e) {
      this.logger.warn(`Indexation du média ${assetId} échouée : ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** Fire-and-forget wrapper for upload paths — never delays or fails the request. */
  indexAssetInBackground(assetId: string): void {
    void this.indexAsset(assetId);
  }

  /**
   * Classic DCT pHash: 32×32 grayscale → 2D DCT-II → top-left 8×8 block of
   * low frequencies → each bit = coefficient above the block's median
   * (DC term excluded). 64 bits, hex-encoded.
   */
  private async computePhash(image: sharp.Sharp): Promise<string> {
    const N = 32;
    const { data } = await image
      .grayscale()
      .resize(N, N, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Precompute cosines for the 8 output frequencies only — full 32x32 DCT is wasted work.
    const K = 8;
    const cos = Array.from({ length: K }, (_, u) =>
      Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))),
    );

    const coeffs: number[] = [];
    for (let v = 0; v < K; v++) {
      for (let u = 0; u < K; u++) {
        let sum = 0;
        for (let y = 0; y < N; y++) {
          for (let x = 0; x < N; x++) {
            sum += data[y * N + x]! * cos[u]![x]! * cos[v]![y]!;
          }
        }
        coeffs.push(sum);
      }
    }

    const ac = coeffs.slice(1); // drop the DC term — it's just overall brightness
    const median = [...ac].sort((a, b) => a - b)[Math.floor(ac.length / 2)]!;
    let bits = '';
    for (const c of coeffs) bits += c > median ? '1' : '0';

    let hex = '';
    for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  }

  /** Frequency quantization on a 48×48 downscale: 4×4×4 RGB buckets, averaged, top 4 distinct. */
  private async computeDominantColors(image: sharp.Sharp): Promise<string[]> {
    const SIZE = 48;
    const { data } = await image
      .resize(SIZE, SIZE, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += 3) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const key = ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6);
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      bucket.count++;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      buckets.set(key, bucket);
    }

    const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
    return [...buckets.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .map((b) => `#${toHex(b.r / b.count)}${toHex(b.g / b.count)}${toHex(b.b / b.count)}`);
  }

  // ---------------------------------------------------------- backfill job
  // Same in-memory job pattern as the AI bulk-autofill: one job per org,
  // state lost on restart (documented, acceptable for the appliance).

  private static readonly jobs = new Map<string, MediaIndexBackfillStatus>();

  getBackfillStatus(organizationId: string): MediaIndexBackfillStatus {
    return (
      MediaIndexService.jobs.get(organizationId) ?? {
        running: false,
        done: 0,
        total: 0,
        indexed: 0,
        startedAt: null,
        finishedAt: null,
      }
    );
  }

  async startBackfill(organizationId: string): Promise<MediaIndexBackfillStatus> {
    const current = MediaIndexService.jobs.get(organizationId);
    if (current?.running) return current;

    const pending = await this.prisma.mediaAsset.findMany({
      where: { organizationId, type: 'image', phash: null },
      select: { id: true },
    });

    const status: MediaIndexBackfillStatus = {
      running: pending.length > 0,
      done: 0,
      total: pending.length,
      indexed: 0,
      startedAt: new Date().toISOString(),
      finishedAt: pending.length === 0 ? new Date().toISOString() : null,
    };
    MediaIndexService.jobs.set(organizationId, status);
    if (!pending.length) return status;

    void (async () => {
      for (const { id } of pending) {
        const ok = await this.indexAsset(id);
        status.done++;
        if (ok) status.indexed++;
        await new Promise((r) => setTimeout(r, 100)); // pace: keep the appliance responsive
      }
      status.running = false;
      status.finishedAt = new Date().toISOString();
      this.logger.log(`Backfill d'indexation terminé pour ${organizationId} : ${status.indexed}/${status.total} indexés.`);
    })();

    return status;
  }
}
