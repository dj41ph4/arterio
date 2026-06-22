import type { Locale } from '@arterio/shared';

/**
 * Client-side Wikipedia + Wikidata enrichment — calls the real public APIs
 * directly from the browser. Both expose `access-control-allow-origin: *`,
 * so no backend/proxy is required. No API key, no rate-limit auth.
 */

const LANGS: Locale[] = ['en', 'fr', 'it', 'es', 'de', 'nl'];

export interface LiveEnrichmentResult {
  qid: string | null;
  birthDate?: string;
  deathDate?: string;
  nationality?: string;
  movement?: string;
  ulanId?: string;
  viafId?: string;
  imageUrl?: string;
  notableWorks?: string[];
  influencedBy?: string[];
  biographies: Partial<Record<Locale, string>>;
  sourceUrls: { wikipedia?: string; wikidata?: string };
}

async function searchWikidataQid(name: string): Promise<string | null> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&limit=5&format=json&type=item&origin=*`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const artistTerms = ['painter', 'sculptor', 'artist', 'photographer', 'printmaker', 'engraver', 'draughtsman'];
  const match =
    data.search.find((r: { description?: string }) =>
      artistTerms.some((t) => r.description?.toLowerCase().includes(t)),
    ) ?? data.search[0];
  return match?.id ?? null;
}

async function fetchWikidataDetails(qid: string) {
  const sparql = `
SELECT ?birthDate ?deathDate ?nationalityLabel ?movementLabel ?ulanId ?viafId ?image
       (GROUP_CONCAT(DISTINCT ?notableWorkLabel; separator="|") AS ?notableWorks)
       (GROUP_CONCAT(DISTINCT ?influencedLabel; separator="|") AS ?influenced)
WHERE {
  BIND(wd:${qid} AS ?item)
  OPTIONAL { ?item wdt:P569 ?birthDate }
  OPTIONAL { ?item wdt:P570 ?deathDate }
  OPTIONAL { ?item wdt:P27 ?nationality }
  OPTIONAL { ?item wdt:P135 ?movement }
  OPTIONAL { ?item wdt:P245 ?ulanId }
  OPTIONAL { ?item wdt:P214 ?viafId }
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?item wdt:P800 ?notableWork . ?notableWork rdfs:label ?notableWorkLabel . FILTER(LANG(?notableWorkLabel)="en") }
  OPTIONAL { ?item wdt:P737 ?influenced_item . ?influenced_item rdfs:label ?influencedLabel . FILTER(LANG(?influencedLabel)="en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}
GROUP BY ?birthDate ?deathDate ?nationalityLabel ?movementLabel ?ulanId ?viafId ?image
LIMIT 1`.trim();

  const res = await fetch(
    `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`,
    { headers: { Accept: 'application/sparql-results+json' } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const b = data.results.bindings[0];
  if (!b) return null;

  const fmtDate = (v?: { value: string }) => v?.value.replace('T00:00:00Z', '');
  const imageToCommons = (v?: { value: string }) =>
    v?.value.replace('http://commons.wikimedia.org/wiki/Special:FilePath/', 'https://commons.wikimedia.org/wiki/Special:FilePath/') + '?width=400';

  return {
    birthDate: fmtDate(b.birthDate),
    deathDate: fmtDate(b.deathDate),
    nationality: b.nationalityLabel?.value,
    movement: b.movementLabel?.value,
    ulanId: b.ulanId?.value,
    viafId: b.viafId?.value,
    imageUrl: b.image ? imageToCommons(b.image) : undefined,
    notableWorks: b.notableWorks?.value ? b.notableWorks.value.split('|').filter(Boolean) : [],
    influencedBy: b.influenced?.value ? b.influenced.value.split('|').filter(Boolean) : [],
  };
}

async function fetchWikipediaBio(name: string, lang: Locale): Promise<{ text: string; url: string } | null> {
  const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&srlimit=1&format=json&origin=*`;
  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) return null;
  const searchData = await searchRes.json();
  const title = searchData.query?.search?.[0]?.title;
  if (!title) return null;

  const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  const summaryRes = await fetch(summaryUrl);
  if (!summaryRes.ok) return null;
  const summary = await summaryRes.json();
  if (!summary.extract) return null;
  return { text: summary.extract, url: summary.content_urls?.desktop?.page };
}

/** Full live enrichment pipeline — same logic as the NestJS ArtistEnrichmentService, run client-side. */
export async function enrichArtistLive(fullName: string): Promise<LiveEnrichmentResult> {
  const qid = await searchWikidataQid(fullName);
  if (!qid) {
    return { qid: null, biographies: {}, sourceUrls: {} };
  }

  const [details, ...bios] = await Promise.all([
    fetchWikidataDetails(qid),
    ...LANGS.map((lang) => fetchWikipediaBio(fullName, lang)),
  ]);

  const biographies: Partial<Record<Locale, string>> = {};
  let wikipediaUrl: string | undefined;
  LANGS.forEach((lang, i) => {
    const bio = bios[i] as { text: string; url: string } | null;
    if (bio) {
      biographies[lang] = bio.text;
      if (lang === 'en') wikipediaUrl = bio.url;
    }
  });

  return {
    qid,
    ...details,
    biographies,
    sourceUrls: {
      wikipedia: wikipediaUrl,
      wikidata: `https://www.wikidata.org/wiki/${qid}`,
    },
  };
}
