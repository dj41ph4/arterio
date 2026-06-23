import type { ArtworkView } from '@arterio/shared';
import {
  ARTWORK_STATUS,
  CONDITION_RATING,
  AUTHENTICATION_STATUS,
  type ArtworkStatus,
  type ConditionRating,
  type AuthenticationStatus,
} from '@arterio/shared';
import { COLLECTIONS } from '../collection-repository';

/** Tiny deterministic PRNG (mulberry32) so the dataset is stable across renders. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ARTISTS = [
  { id: 'a1', name: 'Rembrandt van Rijn', n: 'Dutch' },
  { id: 'a2', name: 'Claude Monet', n: 'French' },
  { id: 'a3', name: 'Johannes Vermeer', n: 'Dutch' },
  { id: 'a4', name: 'Pablo Picasso', n: 'Spanish' },
  { id: 'a5', name: 'Artemisia Gentileschi', n: 'Italian' },
  { id: 'a6', name: 'J. M. W. Turner', n: 'British' },
  { id: 'a7', name: 'Egon Schiele', n: 'Austrian' },
  { id: 'a8', name: 'Hilma af Klint', n: 'Swedish' },
  { id: 'a9', name: 'Caspar David Friedrich', n: 'German' },
  { id: 'a10', name: 'Sofonisba Anguissola', n: 'Italian' },
  { id: 'a11', name: 'Francisco Goya', n: 'Spanish' },
  { id: 'a12', name: 'Berthe Morisot', n: 'French' },
];

const TECHNIQUES = [
  'Oil on canvas',
  'Oil on panel',
  'Watercolour on paper',
  'Tempera on wood',
  'Gouache',
  'Bronze',
  'Charcoal on paper',
  'Etching',
];

const SUPPORTS = ['Canvas', 'Wood panel', 'Paper', 'Bronze', 'Linen'];

const LOCATIONS = [
  'Gallery 1 · North wall',
  'Gallery 2 · East wall',
  'Gallery 4 · Central',
  'Storage A · Rack 12',
  'Storage B · Drawer 4',
  'Conservation lab',
  'Long-term vault',
];

const TITLE_HEADS = [
  'Portrait of',
  'Study for',
  'View of',
  'Still Life with',
  'Composition',
  'The Garden at',
  'Woman with',
  'Landscape near',
  'Self-Portrait',
  'Allegory of',
];
const TITLE_TAILS = [
  'a Young Woman',
  'the Harbour',
  'Pomegranates',
  'No. VII',
  'Argenteuil',
  'a Pearl Earring',
  'Twilight',
  'the Sea',
  'Saint Jerome',
  'Spring',
];

const TAG_POOL = [
  'portrait',
  'landscape',
  'religious',
  'mythology',
  'still-life',
  'figure',
  'signed',
  'framed',
  'restored',
  'on-view',
  'rare',
  'provenance-documented',
];

const COLOR_SETS = [
  ['#2b2118', '#7a5c3e', '#cdb89a'],
  ['#0b3d2e', '#2f7d5b', '#9bd3b4'],
  ['#1e2a44', '#3b5b92', '#a9c2e8'],
  ['#3a1f2b', '#8a3b54', '#e0a8ba'],
  ['#4a3b12', '#b08a2e', '#efd28a'],
  ['#241a2e', '#5b3b78', '#bda6d6'],
  ['#102a2e', '#2f6f74', '#9ad1d4'],
];

function pick<T>(r: () => number, arr: T[]): T {
  return arr[Math.floor(r() * arr.length)]!;
}

function generate(): ArtworkView[] {
  const r = rng(20260620);
  const items: ArtworkView[] = [];
  const COUNT = 124;
  const now = Date.now();

  for (let i = 0; i < COUNT; i++) {
    const artist = pick(r, ARTISTS);
    const collection = pick(r, COLLECTIONS);
    const status = pick(r, ARTWORK_STATUS as unknown as ArtworkStatus[]);
    const condition = pick(r, CONDITION_RATING as unknown as ConditionRating[]);
    const authentication = pick(
      r,
      AUTHENTICATION_STATUS as unknown as AuthenticationStatus[],
    );
    const technique = pick(r, TECHNIQUES);
    const colors = pick(r, COLOR_SETS);
    const year = 1480 + Math.floor(r() * 530);
    const h = 20 + Math.round(r() * 180);
    const w = 18 + Math.round(r() * 160);
    const current = Math.round((5_000 + r() * 1_950_000) / 100) * 100;
    const insured = Math.round(current * (1.05 + r() * 0.4));
    const tagCount = 1 + Math.floor(r() * 3);
    const tags = Array.from({ length: tagCount }, () => pick(r, TAG_POOL));
    const created = now - Math.floor(r() * 1000 * 60 * 60 * 24 * 540);
    const updated = created + Math.floor(r() * (now - created));
    const title = `${pick(r, TITLE_HEADS)} ${pick(r, TITLE_TAILS)}`;

    items.push({
      id: `art_${(i + 1).toString().padStart(4, '0')}`,
      inventoryNumber: `INV-${(1001 + i).toString()}`,
      accessionNumber: r() > 0.6 ? `${year}.${100 + i}` : null,
      title: { en: title, fr: title },
      description: {
        en: `${technique}. ${authentication.replace('_', ' ')}. A work attributed to the circle of ${artist.name}.`,
      },
      artistId: artist.id,
      artistName: artist.name,
      attribution: null,
      authentication,
      movementName: null,
      categoryName: r() > 0.5 ? 'Painting' : 'Work on paper',
      techniqueName: technique,
      supportName: pick(r, SUPPORTS),
      dateText: `c. ${year}`,
      yearFrom: year,
      yearTo: r() > 0.7 ? year + 1 + Math.floor(r() * 6) : null,
      heightCm: h,
      widthCm: w,
      depthCm: technique === 'Bronze' ? 10 + Math.round(r() * 40) : null,
      weightKg: technique === 'Bronze' ? 2 + Math.round(r() * 60) : null,
      status,
      condition,
      acquisitionMethod: pick(r, ['purchase', 'donation', 'bequest', 'commission']),
      acquisitionDate: new Date(created).toISOString(),
      collectionId: collection.id,
      collectionName: collection.name,
      collectionColor: collection.color,
      currentLocationName: pick(r, LOCATIONS),
      valuation: {
        currency: 'EUR',
        currentValue: current,
        insuranceValue: insured,
        purchasePrice: Math.round(current * (0.5 + r() * 0.5)),
      },
      dominantColors: colors,
      tags,
      primaryImageUrl: null,
      thumbnailUrl: null,
      imageCount: Math.floor(r() * 6),
      media: [],
      isFavorite: r() > 0.85,
      qrSlug: `demo-${i + 1}`,
      createdAt: new Date(created).toISOString(),
      updatedAt: new Date(updated).toISOString(),
    });
  }
  return items;
}

/** Singleton dataset (regenerated only once per session). */
export const MOCK_ARTWORKS: ArtworkView[] = generate();

export const MOCK_COLLECTIONS = COLLECTIONS;
export const MOCK_ARTISTS = ARTISTS;
