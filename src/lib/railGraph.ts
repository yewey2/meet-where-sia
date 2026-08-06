import type {
  Coordinate,
  EndpointPoint,
  MrtStation,
  RailJourneyEstimate,
  RailRouteStep,
  RankedStation,
  RailObjective,
} from '../types';
import { DEFAULT_RAIL_OBJECTIVE } from '../types';
import { distanceMetrics, haversineKm } from './centroid';
import { participantTravelTimeMetrics } from './journeyMetrics';

interface RailLine {
  code: string;
  network: 'MRT' | 'LRT';
  stations: string[];
  circular?: boolean;
}

interface GraphEdge {
  to: string;
  minutes: number;
  kind: 'ride' | 'transfer';
}

interface GraphState {
  minutes: number;
  rideMinutes: number;
  transferMinutes: number;
  transfers: number;
  path: GraphPathSegment[];
}

export interface GraphPathSegment {
  kind: 'ride' | 'transfer';
  minutes: number;
  fromStationId: string;
  fromLineCode: string;
  toStationId: string;
  toLineCode: string;
}

interface RailGraph {
  adjacency: Map<string, GraphEdge[]>;
  lineCodesByStation: Map<string, string[]>;
  stations: MrtStation[];
}

export const RAIL_MODEL = {
  accessWalkSpeedKmh: 4.8,
  accessWalkDetourFactor: 1.2,
  initialWaitMinutes: 2.5,
  transferWalkMinutes: 4,
  transferWaitMinutes: 2.5,
  mrtSpeedKmh: 38,
  lrtSpeedKmh: 24,
  stationDwellMinutes: 0.5,
} as const;

export const RAIL_LOCALITY_MODEL = {
  minOutsideRadiusKm: 2,
  minOutsideBoundsKm: 2,
  minCenterDistanceRatio: 1.5,
} as const;

// Current passenger network as of July 2026. Station coordinates and names are
// still supplied at runtime by LTA's official station-exit dataset.
const RAIL_LINES: RailLine[] = [
  {
    code: 'NS',
    network: 'MRT',
    stations: [
      'Jurong East', 'Bukit Batok', 'Bukit Gombak', 'Choa Chu Kang',
      'Yew Tee', 'Kranji', 'Marsiling', 'Woodlands', 'Admiralty',
      'Sembawang', 'Canberra', 'Yishun', 'Khatib', 'Yio Chu Kang',
      'Ang Mo Kio', 'Bishan', 'Braddell', 'Toa Payoh', 'Novena',
      'Newton', 'Orchard', 'Somerset', 'Dhoby Ghaut', 'City Hall',
      'Raffles Place', 'Marina Bay', 'Marina South Pier',
    ],
  },
  {
    code: 'EW',
    network: 'MRT',
    stations: [
      'Pasir Ris', 'Tampines', 'Simei', 'Tanah Merah', 'Bedok',
      'Kembangan', 'Eunos', 'Paya Lebar', 'Aljunied', 'Kallang',
      'Lavender', 'Bugis', 'City Hall', 'Raffles Place', 'Tanjong Pagar',
      'Outram Park', 'Tiong Bahru', 'Redhill', 'Queenstown', 'Commonwealth',
      'Buona Vista', 'Dover', 'Clementi', 'Jurong East', 'Chinese Garden',
      'Lakeside', 'Boon Lay', 'Pioneer', 'Joo Koon', 'Gul Circle',
      'Tuas Crescent', 'Tuas West Road', 'Tuas Link',
    ],
  },
  {
    code: 'CG',
    network: 'MRT',
    stations: ['Tanah Merah', 'Expo', 'Changi Airport'],
  },
  {
    code: 'NE',
    network: 'MRT',
    stations: [
      'HarbourFront', 'Outram Park', 'Chinatown', 'Clarke Quay',
      'Dhoby Ghaut', 'Little India', 'Farrer Park', 'Boon Keng',
      'Potong Pasir', 'Woodleigh', 'Serangoon', 'Kovan', 'Hougang',
      'Buangkok', 'Sengkang', 'Punggol', 'Punggol Coast',
    ],
  },
  {
    code: 'CC',
    network: 'MRT',
    circular: true,
    stations: [
      'Promenade', 'Nicoll Highway', 'Stadium', 'Mountbatten', 'Dakota',
      'Paya Lebar', 'MacPherson', 'Tai Seng', 'Bartley', 'Serangoon',
      'Lorong Chuan', 'Bishan', 'Marymount', 'Caldecott', 'Botanic Gardens',
      'Farrer Road', 'Holland Village', 'Buona Vista', 'one-north',
      'Kent Ridge', 'Haw Par Villa', 'Pasir Panjang', 'Labrador Park',
      'Telok Blangah', 'HarbourFront', 'Keppel', 'Cantonment',
      'Prince Edward Road', 'Marina Bay', 'Bayfront',
    ],
  },
  {
    code: 'CC',
    network: 'MRT',
    stations: ['Dhoby Ghaut', 'Bras Basah', 'Esplanade', 'Promenade'],
  },
  {
    code: 'DT',
    network: 'MRT',
    stations: [
      'Bukit Panjang', 'Cashew', 'Hillview', 'Hume', 'Beauty World',
      'King Albert Park', 'Sixth Avenue', 'Tan Kah Kee', 'Botanic Gardens',
      'Stevens', 'Newton', 'Little India', 'Rochor', 'Bugis', 'Promenade',
      'Bayfront', 'Downtown', 'Telok Ayer', 'Chinatown', 'Fort Canning',
      'Bencoolen', 'Jalan Besar', 'Bendemeer', 'Geylang Bahru', 'Mattar',
      'MacPherson', 'Ubi', 'Kaki Bukit', 'Bedok North', 'Bedok Reservoir',
      'Tampines West', 'Tampines', 'Tampines East', 'Upper Changi', 'Expo',
    ],
  },
  {
    code: 'TE',
    network: 'MRT',
    stations: [
      'Woodlands North', 'Woodlands', 'Woodlands South', 'Springleaf',
      'Lentor', 'Mayflower', 'Bright Hill', 'Upper Thomson', 'Caldecott',
      'Stevens', 'Napier', 'Orchard Boulevard', 'Orchard', 'Great World',
      'Havelock', 'Outram Park', 'Maxwell', 'Shenton Way', 'Marina Bay',
      'Gardens by the Bay', 'Tanjong Rhu', 'Katong Park', 'Tanjong Katong',
      'Marine Parade', 'Marine Terrace', 'Siglap', 'Bayshore',
    ],
  },
  {
    code: 'BP',
    network: 'LRT',
    stations: [
      'Choa Chu Kang', 'South View', 'Keat Hong', 'Teck Whye', 'Phoenix',
      'Bukit Panjang',
    ],
  },
  {
    code: 'BP',
    network: 'LRT',
    circular: true,
    stations: [
      'Bukit Panjang', 'Petir', 'Pending', 'Bangkit', 'Fajar', 'Segar',
      'Jelapang', 'Senja',
    ],
  },
  {
    code: 'SE',
    network: 'LRT',
    circular: true,
    stations: [
      'Sengkang', 'Compassvale', 'Rumbia', 'Bakau', 'Kangkar', 'Ranggung',
    ],
  },
  {
    code: 'SW',
    network: 'LRT',
    circular: true,
    stations: [
      'Sengkang', 'Cheng Lim', 'Farmway', 'Kupang', 'Thanggam', 'Fernvale',
      'Layar', 'Tongkang', 'Renjong',
    ],
  },
  {
    code: 'PE',
    network: 'LRT',
    circular: true,
    stations: [
      'Punggol', 'Cove', 'Meridian', 'Coral Edge', 'Riviera', 'Kadaloor',
      'Oasis', 'Damai',
    ],
  },
  {
    code: 'PW',
    network: 'LRT',
    circular: true,
    stations: [
      'Punggol', 'Sam Kee', 'Teck Lee', 'Punggol Point', 'Samudera',
      'Nibong', 'Sumang', 'Soo Teck',
    ],
  },
];

function normalizeStationName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(?:mrt|lrt)\b/g, '')
    .replace(/\bstation\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function nodeKey(stationId: string, lineCode: string): string {
  return `${stationId}|${lineCode}`;
}

function stationDisplayName(station: MrtStation): string {
  const codes = station.codes?.join('/') || '';
  return codes ? `${codes} ${station.name}` : station.name;
}

function parseNodeKey(key: string): { stationId: string; lineCode: string } {
  const separator = key.lastIndexOf('|');
  return {
    stationId: key.slice(0, separator),
    lineCode: key.slice(separator + 1),
  };
}

function addEdge(
  adjacency: Map<string, GraphEdge[]>,
  from: string,
  edge: GraphEdge,
) {
  const edges = adjacency.get(from) || [];
  if (!edges.some((candidate) => candidate.to === edge.to)) edges.push(edge);
  adjacency.set(from, edges);
}

function segmentMinutes(
  a: MrtStation,
  b: MrtStation,
  network: 'MRT' | 'LRT',
): number {
  const speed = network === 'MRT'
    ? RAIL_MODEL.mrtSpeedKmh
    : RAIL_MODEL.lrtSpeedKmh;
  const minimum = network === 'MRT' ? 1.4 : 1;
  return Math.max(
    minimum,
    (haversineKm(a, b) / speed) * 60 + RAIL_MODEL.stationDwellMinutes,
  );
}

function buildRailGraph(stations: MrtStation[]): RailGraph {
  const byName = new Map(
    stations.map((station) => [normalizeStationName(station.name), station]),
  );
  const adjacency = new Map<string, GraphEdge[]>();
  const lineCodesByStation = new Map<string, string[]>();
  const missingTopologyStations = new Set<string>();

  for (const line of RAIL_LINES) {
    const resolved = line.stations.map((name) => {
      const station = byName.get(normalizeStationName(name));
      if (!station) missingTopologyStations.add(name);
      return station;
    });
    for (const station of resolved) {
      if (!station) continue;
      const codes = lineCodesByStation.get(station.id) || [];
      if (!codes.includes(line.code)) codes.push(line.code);
      lineCodesByStation.set(station.id, codes);
      adjacency.set(nodeKey(station.id, line.code), adjacency.get(nodeKey(station.id, line.code)) || []);
    }

    const pairCount = line.circular ? resolved.length : resolved.length - 1;
    for (let index = 0; index < pairCount; index += 1) {
      const current = resolved[index];
      const next = resolved[(index + 1) % resolved.length];
      if (!current || !next) continue;
      const minutes = segmentMinutes(current, next, line.network);
      const currentKey = nodeKey(current.id, line.code);
      const nextKey = nodeKey(next.id, line.code);
      addEdge(adjacency, currentKey, { to: nextKey, minutes, kind: 'ride' });
      addEdge(adjacency, nextKey, { to: currentKey, minutes, kind: 'ride' });
    }
  }

  if (missingTopologyStations.size > 0) {
    throw new Error(
      `Rail graph is missing station data for: ${[...missingTopologyStations].join(', ')}.`,
    );
  }

  for (const [stationId, lineCodes] of lineCodesByStation) {
    for (const fromLine of lineCodes) {
      for (const toLine of lineCodes) {
        if (fromLine === toLine) continue;
        addEdge(adjacency, nodeKey(stationId, fromLine), {
          to: nodeKey(stationId, toLine),
          minutes: RAIL_MODEL.transferWalkMinutes + RAIL_MODEL.transferWaitMinutes,
          kind: 'transfer',
        });
      }
    }
  }

  return {
    adjacency,
    lineCodesByStation,
    stations: stations.filter((station) => lineCodesByStation.has(station.id)),
  };
}

function isBetter(next: GraphState, current?: GraphState): boolean {
  if (!current) return true;
  if (Math.abs(next.minutes - current.minutes) > 0.0001) {
    return next.minutes < current.minutes;
  }
  return next.transfers < current.transfers;
}

function shortestPaths(graph: RailGraph, originStationId: string): Map<string, GraphState> {
  const distances = new Map<string, GraphState>();
  const pending = new Set<string>();
  const originLines = graph.lineCodesByStation.get(originStationId) || [];

  for (const lineCode of originLines) {
    const key = nodeKey(originStationId, lineCode);
    distances.set(key, {
      minutes: 0,
      rideMinutes: 0,
      transferMinutes: 0,
      transfers: 0,
      path: [],
    });
    pending.add(key);
  }

  while (pending.size > 0) {
    let currentKey: string | undefined;
    let currentState: GraphState | undefined;
    for (const key of pending) {
      const state = distances.get(key);
      if (state && (!currentState || state.minutes < currentState.minutes)) {
        currentKey = key;
        currentState = state;
      }
    }
    if (!currentKey || !currentState) break;
    pending.delete(currentKey);

    for (const edge of graph.adjacency.get(currentKey) || []) {
      const fromNode = parseNodeKey(currentKey);
      const toNode = parseNodeKey(edge.to);
      const next: GraphState = {
        minutes: currentState.minutes + edge.minutes,
        rideMinutes: currentState.rideMinutes + (edge.kind === 'ride' ? edge.minutes : 0),
        transferMinutes:
          currentState.transferMinutes + (edge.kind === 'transfer' ? edge.minutes : 0),
        transfers: currentState.transfers + (edge.kind === 'transfer' ? 1 : 0),
        path: [
          ...currentState.path,
          {
            kind: edge.kind,
            minutes: edge.minutes,
            fromStationId: fromNode.stationId,
            fromLineCode: fromNode.lineCode,
            toStationId: toNode.stationId,
            toLineCode: toNode.lineCode,
          },
        ],
      };
      if (isBetter(next, distances.get(edge.to))) {
        distances.set(edge.to, next);
        pending.add(edge.to);
      }
    }
  }

  return distances;
}

function nearestGraphStation(point: Coordinate, stations: MrtStation[]): MrtStation {
  const ranked = stations
    .map((station) => ({ station, distanceKm: haversineKm(point, station) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
  if (!ranked[0]) throw new Error('No connected MRT/LRT station was available.');
  return ranked[0].station;
}

function bestStateAtStation(
  stationId: string,
  lineCodes: string[],
  paths: Map<string, GraphState>,
): GraphState | undefined {
  return lineCodes
    .map((lineCode) => paths.get(nodeKey(stationId, lineCode)))
    .filter((state): state is GraphState => Boolean(state))
    .sort((a, b) => a.minutes - b.minutes || a.transfers - b.transfers)[0];
}

export function summarizeRailPath(
  path: GraphPathSegment[],
  stations: MrtStation[],
): RailRouteStep[] {
  const stationNames = new Map(
    stations.map((station) => [station.id, stationDisplayName(station)]),
  );
  const nameOf = (stationId: string) => stationNames.get(stationId) || stationId;
  const steps: RailRouteStep[] = [];

  for (const segment of path) {
    if (segment.kind === 'transfer') {
      steps.push({
        kind: 'transfer',
        stationId: segment.fromStationId,
        stationName: nameOf(segment.fromStationId),
        fromLineCode: segment.fromLineCode,
        toLineCode: segment.toLineCode,
        minutes: segment.minutes,
      });
      continue;
    }

    const previous = steps[steps.length - 1];
    if (
      previous?.kind === 'ride' &&
      previous.lineCode === segment.fromLineCode &&
      previous.toStationId === segment.fromStationId
    ) {
      previous.toStationId = segment.toStationId;
      previous.toStationName = nameOf(segment.toStationId);
      previous.stops += 1;
      previous.minutes += segment.minutes;
      continue;
    }

    steps.push({
      kind: 'ride',
      lineCode: segment.fromLineCode,
      fromStationId: segment.fromStationId,
      fromStationName: nameOf(segment.fromStationId),
      toStationId: segment.toStationId,
      toStationName: nameOf(segment.toStationId),
      stops: 1,
      minutes: segment.minutes,
    });
  }

  return steps;
}

export function reverseRailRouteSteps(steps: RailRouteStep[]): RailRouteStep[] {
  return [...steps].reverse().map((step): RailRouteStep => {
    if (step.kind === 'transfer') {
      return {
        ...step,
        fromLineCode: step.toLineCode,
        toLineCode: step.fromLineCode,
      };
    }
    return {
      ...step,
      fromStationId: step.toStationId,
      fromStationName: step.toStationName,
      toStationId: step.fromStationId,
      toStationName: step.fromStationName,
    };
  });
}

export function findLocalStation(
  query: string,
  stations: MrtStation[],
): MrtStation | undefined {
  const normalized = normalizeStationName(query);
  if (!normalized) return undefined;
  return stations.find(
    (station) =>
      normalizeStationName(station.name) === normalized ||
      normalizeStationName(stationDisplayName(station)) === normalized ||
      (station.codes || []).some(
        (code) =>
          normalizeStationName(code) === normalized ||
          normalizeStationName(`${code} ${station.name}`) === normalized,
      ),
  );
}

export function parseSingaporeCoordinate(query: string): Coordinate | undefined {
  const match = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return undefined;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (lat < 1.13 || lat > 1.48 || lng < 103.58 || lng > 104.1) return undefined;
  return { lat, lng };
}

export function rankStationsByTravelTime(
  stations: MrtStation[],
  points: EndpointPoint[],
  center: Coordinate,
  objective: RailObjective = DEFAULT_RAIL_OBJECTIVE,
): RankedStation[] {
  const graph = buildRailGraph(stations);
  const candidates = graph.stations;
  if (candidates.length === 0) return [];
  const groupRadiusKm = Math.max(
    0,
    ...points.map((point) => haversineKm(center, point)),
  );

  const endpointPaths = points.map((point) => {
    const origin = nearestGraphStation(point, graph.stations);
    const accessDistanceKm = haversineKm(point, origin) * RAIL_MODEL.accessWalkDetourFactor;
    return {
      point,
      origin,
      accessWalkMinutes: (accessDistanceKm / RAIL_MODEL.accessWalkSpeedKmh) * 60,
      paths: shortestPaths(graph, origin.id),
    };
  });

  return candidates
    .map((station): RankedStation | undefined => {
      const lineCodes = graph.lineCodesByStation.get(station.id) || [];
      const journeys: RailJourneyEstimate[] = [];

      for (const endpoint of endpointPaths) {
        const path = bestStateAtStation(station.id, lineCodes, endpoint.paths);
        if (!path) return undefined;
        const initialWaitMinutes = path.rideMinutes > 0
          ? RAIL_MODEL.initialWaitMinutes
          : 0;
        const totalMinutes =
          endpoint.accessWalkMinutes + initialWaitMinutes + path.minutes;
        journeys.push({
          endpointId: endpoint.point.id,
          endpointLabel: endpoint.point.label,
          endpointKind: endpoint.point.kind,
          participantId: endpoint.point.participantId,
          participantName: endpoint.point.participantName,
          originStationId: endpoint.origin.id,
          originStationName: endpoint.origin.name,
          endpointIsRailStation: endpoint.point.isRailStation,
          straightLineDistanceKm: haversineKm(endpoint.point, station),
          accessWalkMinutes: endpoint.accessWalkMinutes,
          initialWaitMinutes,
          rideMinutes: path.rideMinutes,
          transferMinutes: path.transferMinutes,
          transfers: path.transfers,
          totalMinutes,
          routeSteps: summarizeRailPath(path.path, graph.stations),
        });
      }

      const participantTimeMetrics = participantTravelTimeMetrics(journeys);
      const centroidKm = haversineKm(center, station);
      const geographicDetourKm = Math.max(0, centroidKm - groupRadiusKm);
      const boundsDetourKm = distanceOutsideEndpointBoundsKm(station, points);
      return {
        ...station,
        ...distanceMetrics(station, points),
        centroidKm,
        ...participantTimeMetrics,
        totalTransfers: journeys.reduce((sum, journey) => sum + journey.transfers, 0),
        groupRadiusKm,
        geographicDetourKm,
        boundsDetourKm,
        hasGeographicDetour: hasSignificantGeographicDetour(
          centroidKm,
          groupRadiusKm,
          boundsDetourKm,
        ),
        journeys,
        lineCodes,
      };
    })
    .filter((station): station is RankedStation => Boolean(station))
    .sort((a, b) => compareRankedStations(a, b, objective));
}

export function distanceOutsideEndpointBoundsKm(
  candidate: Coordinate,
  points: Coordinate[],
): number {
  if (points.length === 0) return 0;
  const latitudes = points.map((point) => point.lat);
  const longitudes = points.map((point) => point.lng);
  const nearestPointInBounds = {
    lat: Math.min(Math.max(candidate.lat, Math.min(...latitudes)), Math.max(...latitudes)),
    lng: Math.min(Math.max(candidate.lng, Math.min(...longitudes)), Math.max(...longitudes)),
  };
  return haversineKm(candidate, nearestPointInBounds);
}

export function hasSignificantGeographicDetour(
  stationDistanceFromCenterKm: number,
  groupRadiusKm: number,
  distanceOutsideBoundsKm = 0,
): boolean {
  if (
    !Number.isFinite(stationDistanceFromCenterKm) ||
    !Number.isFinite(groupRadiusKm) ||
    !Number.isFinite(distanceOutsideBoundsKm) ||
    stationDistanceFromCenterKm < 0 ||
    groupRadiusKm < 0 ||
    distanceOutsideBoundsKm < 0
  ) {
    return false;
  }

  const outsideRadiusKm = stationDistanceFromCenterKm - groupRadiusKm;
  return (
    distanceOutsideBoundsKm > RAIL_LOCALITY_MODEL.minOutsideBoundsKm ||
    (
      outsideRadiusKm > RAIL_LOCALITY_MODEL.minOutsideRadiusKm &&
      stationDistanceFromCenterKm >
        groupRadiusKm * RAIL_LOCALITY_MODEL.minCenterDistanceRatio
    )
  );
}

export function compareRankedStations(
  a: RankedStation,
  b: RankedStation,
  objective: RailObjective,
): number {
  if (objective === 'average') {
    const averageDelta = a.averageMinutes - b.averageMinutes;
    if (Math.abs(averageDelta) > 0.05) return averageDelta;
    const longestDelta = a.maxMinutes - b.maxMinutes;
    if (Math.abs(longestDelta) > 0.05) return longestDelta;
  } else if (objective === 'weighted') {
    // Squaring each person's complete outing gives longer trips progressively
    // more influence without allowing only the single longest trip to decide.
    const weightedDelta = a.meanSquaredMinutes - b.meanSquaredMinutes;
    if (Math.abs(weightedDelta) > 0.01) return weightedDelta;
    const averageDelta = a.averageMinutes - b.averageMinutes;
    if (Math.abs(averageDelta) > 0.05) return averageDelta;
    const longestDelta = a.maxMinutes - b.maxMinutes;
    if (Math.abs(longestDelta) > 0.05) return longestDelta;
  } else if (objective === 'evenness') {
    const varianceDelta = a.varianceMinutes - b.varianceMinutes;
    if (Math.abs(varianceDelta) > 0.01) return varianceDelta;
    const averageDelta = a.averageMinutes - b.averageMinutes;
    if (Math.abs(averageDelta) > 0.05) return averageDelta;
    const longestDelta = a.maxMinutes - b.maxMinutes;
    if (Math.abs(longestDelta) > 0.05) return longestDelta;
  } else {
    // Fairness compares each person's combined journey to the meetup and
    // onward afterwards, rather than treating each leg as a different person.
    // The worst full outing leads; the group average breaks close ties.
    const longestJourneyDelta = a.maxMinutes - b.maxMinutes;
    if (Math.abs(longestJourneyDelta) > 0.05) return longestJourneyDelta;

    const averageJourneyDelta = a.averageMinutes - b.averageMinutes;
    if (Math.abs(averageJourneyDelta) > 0.05) return averageJourneyDelta;
  }

  const centerDistanceDelta = a.centroidKm - b.centroidKm;
  if (Math.abs(centerDistanceDelta) > 0.01) return centerDistanceDelta;

  return a.name.localeCompare(b.name);
}
