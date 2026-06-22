import type { Locale } from '@arterio/shared';

/**
 * Translates an English nationality adjective into the target locale.
 * Keys are lowercase English demonyms as stored in the DB / mock data.
 * Falls back to the original value if not in the table.
 */
const NATIONALITY_MAP: Record<string, Partial<Record<Locale, string>>> = {
  // A
  american:     { fr: 'Américain', it: 'Americano', es: 'Estadounidense', de: 'Amerikanisch', nl: 'Amerikaans' },
  argentinian:  { fr: 'Argentin',  it: 'Argentino', es: 'Argentino',      de: 'Argentinisch', nl: 'Argentijns' },
  austrian:     { fr: 'Autrichien',it: 'Austriaco', es: 'Austriaco',      de: 'Österreichisch',nl: 'Oostenrijks' },
  australian:   { fr: 'Australien',it: 'Australiano',es: 'Australiano',   de: 'Australisch',  nl: 'Australisch' },

  // B
  belgian:      { fr: 'Belge',     it: 'Belga',    es: 'Belga',          de: 'Belgisch',     nl: 'Belgisch' },
  brazilian:    { fr: 'Brésilien', it: 'Brasiliano',es: 'Brasileño',     de: 'Brasilianisch',nl: 'Braziliaans' },
  british:      { fr: 'Britannique',it: 'Britannico',es: 'Británico',    de: 'Britisch',     nl: 'Brits' },
  bulgarian:    { fr: 'Bulgare',   it: 'Bulgaro',  es: 'Búlgaro',        de: 'Bulgarisch',   nl: 'Bulgaars' },

  // C
  canadian:     { fr: 'Canadien',  it: 'Canadese', es: 'Canadiense',     de: 'Kanadisch',    nl: 'Canadees' },
  chinese:      { fr: 'Chinois',   it: 'Cinese',   es: 'Chino',          de: 'Chinesisch',   nl: 'Chinees' },
  colombian:    { fr: 'Colombien', it: 'Colombiano',es: 'Colombiano',    de: 'Kolumbianisch',nl: 'Colombiaans' },
  croatian:     { fr: 'Croate',    it: 'Croato',   es: 'Croata',         de: 'Kroatisch',    nl: 'Kroatisch' },
  czech:        { fr: 'Tchèque',   it: 'Ceco',     es: 'Checo',          de: 'Tschechisch',  nl: 'Tsjechisch' },

  // D
  danish:       { fr: 'Danois',    it: 'Danese',   es: 'Danés',          de: 'Dänisch',      nl: 'Deens' },
  dutch:        { fr: 'Néerlandais',it:'Olandese', es: 'Neerlandés',     de: 'Niederländisch',nl: 'Nederlands' },

  // E
  egyptian:     { fr: 'Égyptien',  it: 'Egiziano', es: 'Egipcio',        de: 'Ägyptisch',    nl: 'Egyptisch' },
  english:      { fr: 'Anglais',   it: 'Inglese',  es: 'Inglés',         de: 'Englisch',     nl: 'Engels' },

  // F
  finnish:      { fr: 'Finlandais',it: 'Finlandese',es: 'Finlandés',    de: 'Finnisch',     nl: 'Fins' },
  flemish:      { fr: 'Flamand',   it: 'Fiammingo',es: 'Flamenco',       de: 'Flämisch',     nl: 'Vlaams' },
  french:       { fr: 'Français',  it: 'Francese', es: 'Francés',        de: 'Französisch',  nl: 'Frans' },

  // G
  german:       { fr: 'Allemand',  it: 'Tedesco',  es: 'Alemán',         de: 'Deutsch',      nl: 'Duits' },
  greek:        { fr: 'Grec',      it: 'Greco',    es: 'Griego',         de: 'Griechisch',   nl: 'Grieks' },

  // H
  hungarian:    { fr: 'Hongrois',  it: 'Ungherese',es: 'Húngaro',        de: 'Ungarisch',    nl: 'Hongaars' },

  // I
  indian:       { fr: 'Indien',    it: 'Indiano',  es: 'Indio',          de: 'Indisch',      nl: 'Indiaas' },
  iranian:      { fr: 'Iranien',   it: 'Iraniano', es: 'Iraní',          de: 'Iranisch',     nl: 'Iraans' },
  irish:        { fr: 'Irlandais', it: 'Irlandese',es: 'Irlandés',       de: 'Irisch',       nl: 'Iers' },
  italian:      { fr: 'Italien',   it: 'Italiano', es: 'Italiano',       de: 'Italienisch',  nl: 'Italiaans' },

  // J
  japanese:     { fr: 'Japonais',  it: 'Giapponese',es: 'Japonés',      de: 'Japanisch',    nl: 'Japans' },

  // K
  korean:       { fr: 'Coréen',    it: 'Coreano',  es: 'Coreano',        de: 'Koreanisch',   nl: 'Koreaans' },

  // M
  mexican:      { fr: 'Mexicain',  it: 'Messicano',es: 'Mexicano',       de: 'Mexikanisch',  nl: 'Mexicaans' },
  moroccan:     { fr: 'Marocain',  it: 'Marocchino',es: 'Marroquí',     de: 'Marokkanisch', nl: 'Marokkaans' },

  // N
  norwegian:    { fr: 'Norvégien', it: 'Norvegese',es: 'Noruego',        de: 'Norwegisch',   nl: 'Noors' },

  // P
  peruvian:     { fr: 'Péruvien',  it: 'Peruviano',es: 'Peruano',        de: 'Peruanisch',   nl: 'Peruaans' },
  polish:       { fr: 'Polonais',  it: 'Polacco',  es: 'Polaco',         de: 'Polnisch',     nl: 'Pools' },
  portuguese:   { fr: 'Portugais', it: 'Portoghese',es: 'Portugués',    de: 'Portugiesisch',nl: 'Portugees' },

  // R
  romanian:     { fr: 'Roumain',   it: 'Romeno',   es: 'Rumano',         de: 'Rumänisch',    nl: 'Roemeens' },
  russian:      { fr: 'Russe',     it: 'Russo',    es: 'Ruso',           de: 'Russisch',     nl: 'Russisch' },

  // S
  scottish:     { fr: 'Écossais',  it: 'Scozzese', es: 'Escocés',        de: 'Schottisch',   nl: 'Schots' },
  spanish:      { fr: 'Espagnol',  it: 'Spagnolo', es: 'Español',        de: 'Spanisch',     nl: 'Spaans' },
  swedish:      { fr: 'Suédois',   it: 'Svedese',  es: 'Sueco',          de: 'Schwedisch',   nl: 'Zweeds' },
  swiss:        { fr: 'Suisse',    it: 'Svizzero', es: 'Suizo',          de: 'Schweizerisch',nl: 'Zwitsers' },

  // T
  turkish:      { fr: 'Turc',      it: 'Turco',    es: 'Turco',          de: 'Türkisch',     nl: 'Turks' },

  // U
  ukrainian:    { fr: 'Ukrainien', it: 'Ucraino',  es: 'Ucraniano',      de: 'Ukrainisch',   nl: 'Oekraïens' },

  // V
  venezuelan:   { fr: 'Vénézuélien',it:'Venezuelano',es:'Venezolano',   de: 'Venezolanisch',nl: 'Venezolaans' },

  // Other
  flamish:      { fr: 'Flamand',   it: 'Fiammingo',es: 'Flamenco',       de: 'Flämisch',     nl: 'Vlaams' },
};

export function translateNationality(nationality: string | undefined | null, locale: Locale): string {
  if (!nationality) return '—';
  const key = nationality.toLowerCase().trim();
  const translations = NATIONALITY_MAP[key];
  if (!translations) return nationality; // unknown — return as-is
  return locale === 'en' ? nationality : (translations[locale] ?? nationality);
}
