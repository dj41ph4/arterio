import type { Locale } from '@arterio/shared';
import { HttpArtistRepository } from './http/artist-repository';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface ArtistMovement {
  id: string;
  name: string;
  label?: Partial<Record<Locale, string>>;
}

export interface ArtistView {
  id: string;
  fullName: string;
  sortName: string;
  nationality?: string;
  birthDate?: string;
  deathDate?: string;
  biography: Partial<Record<Locale, string>>;
  movement?: ArtistMovement;
  externalIds: {
    wikidata?: string;
    ulan?: string;
    viaf?: string;
  };
  externalUrls: {
    wikipedia?: string;
    wikidata?: string;
    ulan?: string;
    viaf?: string;
  };
  thumbnail?: string;
  artworkCount: number;
  artworkIds: string[];
  notableWorks?: string[];
  influencedBy?: string[];
  awards?: string[];
}

export interface ArtistQuery {
  search?: string;
  cursor?: string | null;
  limit?: number;
}

export interface Paginated<T> {
  data: T[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface ArtistUpdateInput {
  fullName?: string;
  nationality?: string;
  birthDate?: string;
  deathDate?: string;
  movementId?: string;
  thumbnail?: string;
  biography?: Partial<Record<Locale, string>>;
  /** Wipes biography/thumbnail/movement/external IDs — for undoing a wrong automatic match. */
  resetEnrichment?: boolean;
}

export interface ArtistRepository {
  list(query: ArtistQuery): Promise<Paginated<ArtistView>>;
  getById(id: string): Promise<ArtistView | null>;
  add(artist: ArtistView): Promise<ArtistView>;
  update(id: string, patch: ArtistUpdateInput): Promise<ArtistView>;
  /** Refuses if the artist still has artworks attached, unless force=true (unlinks artworks first). */
  remove(id: string, force?: boolean): Promise<void>;
  /** Re-runs Wikipedia/Wikidata enrichment from the artist's current name — used after a name/spelling fix. */
  enrich(id: string): Promise<ArtistView>;
  /** Finds and merges near-duplicate artists, verifying each group against Wikidata to avoid homonym mistakes. */
  autoMerge(): Promise<AutoMergeReport>;
}

export interface AutoMergeReport {
  merged: Array<{ canonicalName: string; mergedNames: string[]; confidence: number; wikidataQid: string | null }>;
  flagged: Array<{ names: string[]; reason: string }>;
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_ARTISTS: ArtistView[] = [
  {
    id: 'artist-picasso',
    fullName: 'Pablo Picasso',
    sortName: 'Picasso, Pablo',
    nationality: 'Spanish',
    birthDate: '1881-10-25',
    deathDate: '1973-04-08',
    biography: {
      en: `Pablo Ruiz Picasso (25 October 1881 – 8 April 1973) was a Spanish painter, sculptor, printmaker, ceramicist, and theatre designer who spent most of his adult life in France. One of the most influential artists of the 20th century, he is known for co-founding the Cubist movement, the invention of constructed sculpture, the co-invention of collage, and for the wide variety of styles that he helped develop and explore.`,
      fr: `Pablo Ruiz Picasso (25 octobre 1881 – 8 avril 1973) était un peintre, sculpteur, graveur, céramiste et décorateur de théâtre espagnol qui passa la majeure partie de sa vie adulte en France. L'une des figures les plus influentes de l'art du XXe siècle, il est connu pour avoir co-fondé le mouvement cubiste et avoir développé une grande variété de styles artistiques.`,
      it: `Pablo Ruiz Picasso (25 ottobre 1881 – 8 aprile 1973) è stato un pittore, scultore, incisore, ceramista e scenografo spagnolo che trascorse la maggior parte della sua vita adulta in Francia. Considerato uno degli artisti più influenti del XX secolo, è noto per aver co-fondato il movimento cubista.`,
      es: `Pablo Ruiz Picasso (25 de octubre de 1881 – 8 de abril de 1973) fue un pintor, escultor, grabador, ceramista y diseñador teatral español que pasó la mayor parte de su vida adulta en Francia. Uno de los artistas más influyentes del siglo XX, es conocido por cofundar el movimiento cubista.`,
      de: `Pablo Ruiz Picasso (25. Oktober 1881 – 8. April 1973) war ein spanischer Maler, Bildhauer, Grafiker, Keramiker und Bühnenbildner, der den größten Teil seines Erwachsenenlebens in Frankreich verbrachte. Er gilt als einer der einflussreichsten Künstler des 20. Jahrhunderts.`,
      nl: `Pablo Ruiz Picasso (25 oktober 1881 – 8 april 1973) was een Spaanse schilder, beeldhouwer, graficus, pottenbakker en decorontwerper die het grootste deel van zijn volwassen leven in Frankrijk woonde. Hij wordt beschouwd als een van de invloedrijkste kunstenaars van de 20e eeuw.`,
    },
    movement: { id: 'cubism', name: 'Cubism' },
    externalIds: { wikidata: 'Q5593', ulan: '500009666', viaf: '15873' },
    externalUrls: {
      wikipedia: 'https://en.wikipedia.org/wiki/Pablo_Picasso',
      wikidata: 'https://www.wikidata.org/wiki/Q5593',
      ulan: 'https://vocab.getty.edu/ulan/500009666',
      viaf: 'https://viaf.org/viaf/15873',
    },
    thumbnail: 'https://commons.wikimedia.org/wiki/Special:FilePath/Pablo%20picasso%201.jpg?width=300',
    artworkCount: 12,
    artworkIds: [],
    notableWorks: ['Guernica', 'Les Demoiselles d\'Avignon', 'Weeping Woman', 'The Old Guitarist'],
    influencedBy: ['Paul Cézanne', 'El Greco', 'Henri Matisse', 'Paul Gauguin'],
  },
  {
    id: 'artist-monet',
    fullName: 'Claude Monet',
    sortName: 'Monet, Claude',
    nationality: 'French',
    birthDate: '1840-11-14',
    deathDate: '1926-12-05',
    biography: {
      en: `Oscar-Claude Monet (14 November 1840 – 5 December 1926) was a French impressionist painter who is widely considered the founder of Impressionism. He is best known for his water lily paintings, the Haystacks series, the Rouen Cathedral series, and the Houses of Parliament series.`,
      fr: `Oscar-Claude Monet (14 novembre 1840 – 5 décembre 1926) était un peintre impressionniste français, largement considéré comme le fondateur de l'impressionnisme. Il est surtout connu pour ses peintures de nymphéas, la série des Meules, la série de la Cathédrale de Rouen et la série des Parlements de Londres.`,
      it: `Oscar-Claude Monet (14 novembre 1840 – 5 dicembre 1926) è stato un pittore impressionista francese ampiamente considerato il fondatore dell'Impressionismo. È noto soprattutto per le sue pitture di ninfee, la serie delle Biche di fieno e la serie della Cattedrale di Rouen.`,
      es: `Oscar-Claude Monet (14 de noviembre de 1840 – 5 de diciembre de 1926) fue un pintor impresionista francés, ampliamente considerado como el fundador del impresionismo. Es conocido principalmente por sus pinturas de nenúfares y las series de los Almiares y la Catedral de Ruán.`,
      de: `Oscar-Claude Monet (14. November 1840 – 5. Dezember 1926) war ein französischer impressionistischer Maler, der allgemein als Begründer des Impressionismus gilt. Er ist vor allem für seine Seerosen-Gemälde, die Heuschober-Serie und die Rouen-Kathedrale-Serie bekannt.`,
      nl: `Oscar-Claude Monet (14 november 1840 – 5 december 1926) was een Franse impressionistische schilder die algemeen wordt beschouwd als de grondlegger van het impressionisme. Hij is het meest bekend om zijn waterlelieschilderijen en de series Hooibergen en de Kathedraal van Rouen.`,
    },
    movement: { id: 'impressionism', name: 'Impressionism' },
    externalIds: { wikidata: 'Q296', ulan: '500011493', viaf: '56604140' },
    externalUrls: {
      wikipedia: 'https://en.wikipedia.org/wiki/Claude_Monet',
      wikidata: 'https://www.wikidata.org/wiki/Q296',
      ulan: 'https://vocab.getty.edu/ulan/500011493',
    },
    thumbnail: 'https://commons.wikimedia.org/wiki/Special:FilePath/Claude%20Monet%201899%20Nadar%20crop.jpg?width=300',
    artworkCount: 8,
    artworkIds: [],
    notableWorks: ['Water Lilies', 'Impression, Sunrise', 'Haystacks', 'Rouen Cathedral'],
    influencedBy: ['Eugène Boudin', 'Johan Jongkind', 'Gustave Courbet'],
  },
  {
    id: 'artist-rembrandt',
    fullName: 'Rembrandt van Rijn',
    sortName: 'Rembrandt van Rijn',
    nationality: 'Dutch',
    birthDate: '1606-07-15',
    deathDate: '1669-10-04',
    biography: {
      en: `Rembrandt Harmenszoon van Rijn (15 July 1606 – 4 October 1669) was a Dutch Golden Age painter, printmaker and draughtsman. An innovative and prolific master in three media, he is generally considered one of the greatest visual artists in the history of art and the most important in Dutch art history. Unlike most Dutch masters of the 17th century, Rembrandt's works depict a wide range of style and subject matter.`,
      fr: `Rembrandt Harmenszoon van Rijn (15 juillet 1606 – 4 octobre 1669) était un peintre, graveur et dessinateur néerlandais de l'Âge d'or. Maître innovant et prolifique dans trois médias, il est généralement considéré comme l'un des plus grands artistes visuels de l'histoire de l'art.`,
      nl: `Rembrandt Harmenszoon van Rijn (15 juli 1606 – 4 oktober 1669) was een Nederlandse schilder, etser en tekenaar uit de Gouden Eeuw. Hij wordt beschouwd als een van de grootste kunstenaars in de kunstgeschiedenis en de belangrijkste in de Nederlandse kunstgeschiedenis.`,
    },
    movement: { id: 'dutch-golden-age', name: 'Dutch Golden Age' },
    externalIds: { wikidata: 'Q5598', ulan: '500011051', viaf: '64013650' },
    externalUrls: {
      wikipedia: 'https://en.wikipedia.org/wiki/Rembrandt',
      wikidata: 'https://www.wikidata.org/wiki/Q5598',
      ulan: 'https://vocab.getty.edu/ulan/500011051',
    },
    thumbnail: 'https://commons.wikimedia.org/wiki/Special:FilePath/Rembrandt%20van%20Rijn%20-%20Self-Portrait%20-%20Google%20Art%20Project.jpg?width=300',
    artworkCount: 5,
    artworkIds: [],
    notableWorks: ['The Night Watch', 'Self-Portrait with Two Circles', 'The Anatomy Lesson of Dr. Nicolaes Tulp'],
    influencedBy: ['Caravaggio', 'Peter Paul Rubens', 'Jan Lievens'],
  },
  {
    id: 'artist-frida-kahlo',
    fullName: 'Frida Kahlo',
    sortName: 'Kahlo, Frida',
    nationality: 'Mexican',
    birthDate: '1907-07-06',
    deathDate: '1954-07-13',
    biography: {
      en: `Magdalena Carmen Frida Kahlo Calderón (6 July 1907 – 13 July 1954) was a Mexican painter known for her many portraits, self-portraits, and works inspired by the nature and artifacts of Mexico. Inspired by Mexican popular culture, she employed a naïve folk art style to explore questions of identity, postcolonialism, gender, class, and race in Mexican society.`,
      fr: `Magdalena Carmen Frida Kahlo Calderón (6 juillet 1907 – 13 juillet 1954) était une peintre mexicaine connue pour ses nombreux portraits, autoportraits et œuvres inspirées par la nature et les artefacts mexicains. Elle a exploré les questions d'identité, de postcolonialisme, de genre, de classe et de race dans la société mexicaine.`,
      es: `Magdalena Carmen Frida Kahlo Calderón (6 de julio de 1907 – 13 de julio de 1954) fue una pintora mexicana conocida por sus numerosos retratos, autorretratos y obras inspiradas en la naturaleza y los artefactos de México. Exploró cuestiones de identidad, poscolonialismo, género, clase y raza en la sociedad mexicana.`,
    },
    movement: { id: 'magical-realism', name: 'Magical Realism' },
    externalIds: { wikidata: 'Q5588', ulan: '500030701', viaf: '24609509' },
    externalUrls: {
      wikipedia: 'https://en.wikipedia.org/wiki/Frida_Kahlo',
      wikidata: 'https://www.wikidata.org/wiki/Q5588',
    },
    thumbnail: 'https://commons.wikimedia.org/wiki/Special:FilePath/Frida%20Kahlo%2C%20by%20Guillermo%20Kahlo%20(cropped).jpg?width=300',
    artworkCount: 4,
    artworkIds: [],
    notableWorks: ['The Two Fridas', 'Self-Portrait with Thorn Necklace and Hummingbird', 'The Broken Column'],
    influencedBy: ['Diego Rivera', 'José Guadalupe Posada', 'Henri Rousseau'],
  },
  {
    id: 'artist-warhol',
    fullName: 'Andy Warhol',
    sortName: 'Warhol, Andy',
    nationality: 'American',
    birthDate: '1928-08-06',
    deathDate: '1987-02-22',
    biography: {
      en: `Andy Warhol (August 6, 1928 – February 22, 1987) was an American visual artist, film director, and producer who was a leading figure in the visual art movement known as pop art. His works explore the relationship between artistic expression, advertising, and celebrity culture that flourished by the 1960s, and span a variety of media, including painting, silkscreening, photography, film, and sculpture.`,
      fr: `Andy Warhol (6 août 1928 – 22 février 1987) était un artiste visuel, réalisateur et producteur américain, figure de proue du mouvement artistique connu sous le nom de pop art. Ses œuvres explorent la relation entre l'expression artistique, la publicité et la culture des célébrités.`,
      de: `Andy Warhol (6. August 1928 – 22. Februar 1987) war ein amerikanischer bildender Künstler, Filmregisseur und Produzent, der eine führende Persönlichkeit der als Pop Art bekannten Kunstbewegung war. Seine Werke erforschen die Beziehung zwischen künstlerischem Ausdruck, Werbung und Prominentenkultur.`,
    },
    movement: { id: 'pop-art', name: 'Pop Art' },
    externalIds: { wikidata: 'Q5603', ulan: '500006158', viaf: '100262399' },
    externalUrls: {
      wikipedia: 'https://en.wikipedia.org/wiki/Andy_Warhol',
      wikidata: 'https://www.wikidata.org/wiki/Q5603',
      ulan: 'https://vocab.getty.edu/ulan/500006158',
    },
    thumbnail: 'https://commons.wikimedia.org/wiki/Special:FilePath/Andy%20Warhol%20at%20the%20Jewish%20Museum%20(by%20Bernard%20Gotfryd)%20%E2%80%93%20LOC.jpg?width=300',
    artworkCount: 7,
    artworkIds: [],
    notableWorks: ['Campbell\'s Soup Cans', 'Marilyn Diptych', 'Shot Marilyns', 'Brillo Boxes'],
    influencedBy: ['Marcel Duchamp', 'Robert Rauschenberg', 'Jasper Johns'],
  },
  {
    id: 'artist-modigliani',
    fullName: 'Amedeo Modigliani',
    sortName: 'Modigliani, Amedeo',
    nationality: 'Italian',
    birthDate: '1884-07-12',
    deathDate: '1920-01-24',
    biography: {
      en: `Amedeo Clemente Modigliani (12 July 1884 – 24 January 1920) was an Italian Jewish painter and sculptor who worked mainly in France. He is known for portraits and nudes in a modern style characterized by a surreal elongation of faces, necks, and figures that were not received well during his lifetime but now works by Modigliani have sold for great sums.`,
      fr: `Amedeo Clemente Modigliani (12 juillet 1884 – 24 janvier 1920) était un peintre et sculpteur juif italien qui travailla principalement en France. Il est connu pour ses portraits et nus dans un style moderne caractérisé par un allongement surréel des visages, des cous et des silhouettes.`,
      it: `Amedeo Clemente Modigliani (12 luglio 1884 – 24 gennaio 1920) è stato un pittore e scultore ebreo italiano che lavorò principalmente in Francia. È noto per ritratti e nudi in uno stile moderno caratterizzato da un allungamento surreale di visi, colli e figure.`,
    },
    movement: { id: 'expressionism', name: 'Expressionism' },
    externalIds: { wikidata: 'Q44931', ulan: '500014476' },
    externalUrls: {
      wikipedia: 'https://en.wikipedia.org/wiki/Amedeo_Modigliani',
      wikidata: 'https://www.wikidata.org/wiki/Q44931',
    },
    thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Amedeo_Modigliani_in_his_studio.jpg/330px-Amedeo_Modigliani_in_his_studio.jpg',
    artworkCount: 6,
    artworkIds: [],
    notableWorks: ['Reclining Nude', 'Portrait of Jeanne Hébuterne', 'Nu couché'],
    influencedBy: ['Paul Cézanne', 'Henri Matisse', 'Constantin Brâncuși'],
  },
];

// ---------------------------------------------------------------------------
// Mock repository
// ---------------------------------------------------------------------------

export class MockArtistRepository implements ArtistRepository {
  private readonly data = MOCK_ARTISTS;

  async add(artist: ArtistView): Promise<ArtistView> {
    this.data.push(artist);
    return artist;
  }

  async list(query: ArtistQuery): Promise<Paginated<ArtistView>> {
    const limit = Math.min(query.limit ?? 50, 200);
    let items = [...this.data];

    if (query.search) {
      const q = query.search.toLowerCase();
      items = items.filter(
        (a) =>
          a.fullName.toLowerCase().includes(q) ||
          a.nationality?.toLowerCase().includes(q) ||
          a.movement?.name.toLowerCase().includes(q),
      );
    }

    items.sort((a, b) => a.sortName.localeCompare(b.sortName));

    let startIdx = 0;
    if (query.cursor) {
      const idx = items.findIndex((a) => a.id === query.cursor);
      if (idx !== -1) startIdx = idx + 1;
    }

    const slice = items.slice(startIdx, startIdx + limit + 1);
    const hasMore = slice.length > limit;
    const data = hasMore ? slice.slice(0, limit) : slice;

    return {
      data,
      nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null,
    };
  }

  async getById(id: string): Promise<ArtistView | null> {
    return this.data.find((a) => a.id === id) ?? null;
  }

  async update(id: string, patch: ArtistUpdateInput): Promise<ArtistView> {
    const artist = this.data.find((a) => a.id === id);
    if (!artist) throw new Error('Artist not found');
    if (patch.resetEnrichment) {
      Object.assign(artist, { biography: {}, thumbnail: undefined, movement: undefined, externalIds: {} });
      return artist;
    }
    if (patch.fullName !== undefined) artist.fullName = patch.fullName;
    if (patch.nationality !== undefined) artist.nationality = patch.nationality || undefined;
    if (patch.birthDate !== undefined) artist.birthDate = patch.birthDate || undefined;
    if (patch.deathDate !== undefined) artist.deathDate = patch.deathDate || undefined;
    if (patch.thumbnail !== undefined) artist.thumbnail = patch.thumbnail || undefined;
    if (patch.biography !== undefined) artist.biography = { ...artist.biography, ...patch.biography };
    return artist;
  }

  async remove(id: string, _force?: boolean): Promise<void> {
    const idx = this.data.findIndex((a) => a.id === id);
    if (idx !== -1) this.data.splice(idx, 1);
  }

  async enrich(id: string): Promise<ArtistView> {
    const artist = this.data.find((a) => a.id === id);
    if (!artist) throw new Error('Artist not found');
    return artist;
  }

  async autoMerge(): Promise<AutoMergeReport> {
    return { merged: [], flagged: [] };
  }
}

// Singleton — NEXT_PUBLIC_DATA_SOURCE=http points this at the real NestJS API.
const source = process.env.NEXT_PUBLIC_DATA_SOURCE ?? 'mock';
export const artistRepository: ArtistRepository =
  source === 'http' ? new HttpArtistRepository() : new MockArtistRepository();
