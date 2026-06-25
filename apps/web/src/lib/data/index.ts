import type { ArtworkRepository } from './types';
import { MockArtworkRepository } from './mock/artwork-repository';
import { HttpArtworkRepository } from './http/artwork-repository';

/**
 * Repository selector — NEXT_PUBLIC_DATA_SOURCE=http points every screen at the
 * real NestJS API (no screen changes required); defaults to the mock dataset.
 */
const source = process.env.NEXT_PUBLIC_DATA_SOURCE ?? 'mock';

export const artworkRepository: ArtworkRepository =
  source === 'http' ? new HttpArtworkRepository() : new MockArtworkRepository();

export type { ArtworkRepository } from './types';
export * from './types';
