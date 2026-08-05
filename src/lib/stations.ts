import type { MrtStation } from '../types';

const LINE_SEARCH_ALIASES: Record<string, string[]> = {
  NS: ['north south line', 'red line', 'mrt'],
  EW: ['east west line', 'green line', 'mrt'],
  CG: ['changi airport branch', 'east west line', 'mrt'],
  NE: ['north east line', 'purple line', 'mrt'],
  CC: ['circle line', 'yellow line', 'orange line', 'mrt'],
  DT: ['downtown line', 'blue line', 'mrt'],
  TE: ['thomson east coast line', 'brown line', 'mrt'],
  BP: ['bukit panjang lrt', 'lrt'],
  SE: ['sengkang east lrt', 'sengkang lrt', 'lrt'],
  SW: ['sengkang west lrt', 'sengkang lrt', 'lrt'],
  STC: ['sengkang town centre', 'sengkang lrt', 'lrt'],
  PE: ['punggol east lrt', 'punggol lrt', 'lrt'],
  PW: ['punggol west lrt', 'punggol lrt', 'lrt'],
  PTC: ['punggol town centre', 'punggol lrt', 'lrt'],
};

const stationNameCollator = new Intl.Collator('en-SG', {
  sensitivity: 'base',
  numeric: true,
});

export interface StationSearchEntry {
  station: MrtStation;
  codes: string[];
  compactName: string;
  nameTokens: string[];
  acronym: string;
  searchTerms: string[];
}

function normaliseSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-SG')
    .replace(/\bstation\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function searchTokens(value: string): string[] {
  const normalised = normaliseSearchText(value);
  return normalised ? normalised.split(/\s+/) : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function linePrefix(code: string): string {
  return code.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() || '';
}

function buildStationSearchEntry(station: MrtStation): StationSearchEntry {
  const codes = station.codes || [];
  const nameTokens = searchTokens(station.name);
  const lineAliases = codes.flatMap(
    (code) => LINE_SEARCH_ALIASES[linePrefix(code)] || [],
  );
  const searchTerms = unique([
    ...codes.flatMap(searchTokens),
    ...nameTokens,
    ...lineAliases.flatMap(searchTokens),
    normaliseSearchText(station.network),
  ]);

  return {
    station,
    codes: codes.map((code) => normaliseSearchText(code).replace(/\s/g, '')),
    compactName: nameTokens.join(''),
    nameTokens,
    acronym: nameTokens.map((word) => word[0]).join(''),
    searchTerms,
  };
}

export function buildStationSearchIndex(stations: MrtStation[]): StationSearchEntry[] {
  return stations.map(buildStationSearchEntry);
}

function stationMatchScore(
  query: string,
  entry: StationSearchEntry,
): number | undefined {
  const words = searchTokens(query);
  if (words.length === 0) return undefined;
  const compactQuery = words.join('');

  if (entry.codes.includes(compactQuery)) return 0;
  if (entry.compactName === compactQuery) return 1;
  if (entry.acronym.length > 1 && entry.acronym === compactQuery) return 2;
  if (
    entry.compactName.startsWith(compactQuery) ||
    entry.nameTokens.some((word) => word.startsWith(compactQuery))
  ) {
    return 3;
  }

  const allWordsMatch = words.every((word) => {
    if (/^[a-z]{1,3}\d+$/.test(word)) return entry.codes.includes(word);
    return (
      entry.searchTerms.some((term) => term.startsWith(word)) ||
      entry.acronym.startsWith(word)
    );
  });
  if (allWordsMatch) return 4;

  if (words.length === 1 && entry.compactName.includes(compactQuery)) return 5;
  return undefined;
}

export function searchStations(
  index: StationSearchEntry[],
  query: string,
  limit = 5,
): MrtStation[] {
  return index
    .map((entry) => ({ entry, score: stationMatchScore(query, entry) }))
    .filter(
      (match): match is { entry: StationSearchEntry; score: number } =>
        match.score !== undefined,
    )
    .sort(
      (a, b) =>
        a.score - b.score ||
        stationNameCollator.compare(a.entry.station.name, b.entry.station.name),
    )
    .slice(0, limit)
    .map(({ entry }) => entry.station);
}

export function formatStationCodes(station: MrtStation): string {
  return station.codes?.join('/') || '';
}

export function formatStationLabel(station: MrtStation): string {
  const codes = formatStationCodes(station);
  return codes ? `${codes} ${station.name}` : `${station.name} ${station.network}`;
}

export function stationMatchesQuery(query: string, station: MrtStation): boolean {
  return stationMatchScore(query, buildStationSearchEntry(station)) !== undefined;
}
