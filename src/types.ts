export type Mode = 'distance' | 'rail';
export type DistanceObjective = 'centroid' | 'median';
export type RailObjective = 'minimax' | 'average' | 'weighted' | 'evenness';
export type ParticipantColor =
  | 'coral'
  | 'orange'
  | 'amber'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'blue'
  | 'indigo'
  | 'purple'
  | 'pink';

export type LocationStatus =
  | 'empty'
  | 'dirty'
  | 'resolving'
  | 'resolved'
  | 'error';

export interface LocationValue {
  query: string;
  label?: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  status: LocationStatus;
}

export interface Participant {
  id: string;
  name: string;
  color: ParticipantColor;
  sameAsStart: boolean;
  start: LocationValue;
  end: LocationValue;
}

export interface EndpointPoint {
  id: string;
  participantId: string;
  participantName: string;
  participantColor: ParticipantColor;
  markerLabel: string;
  kind: 'start' | 'end';
  label: string;
  lat: number;
  lng: number;
  isRailStation: boolean;
}

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface MrtStation extends Coordinate {
  id: string;
  name: string;
  network: 'MRT' | 'LRT';
  exitCount: number;
}

export interface RankedStation extends MrtStation {
  totalKm: number;
  averageKm: number;
  maxKm: number;
  centroidKm: number;
  totalMinutes: number;
  averageMinutes: number;
  maxMinutes: number;
  meanSquaredMinutes: number;
  rootMeanSquareMinutes: number;
  varianceMinutes: number;
  standardDeviationMinutes: number;
  totalTransfers: number;
  groupRadiusKm: number;
  geographicDetourKm: number;
  boundsDetourKm: number;
  hasGeographicDetour: boolean;
  journeys: RailJourneyEstimate[];
  lineCodes: string[];
}

export interface RailJourneyEstimate {
  endpointId: string;
  endpointLabel: string;
  endpointKind: 'start' | 'end';
  participantId: string;
  participantName: string;
  originStationId: string;
  originStationName: string;
  endpointIsRailStation: boolean;
  straightLineDistanceKm: number;
  accessWalkMinutes: number;
  initialWaitMinutes: number;
  rideMinutes: number;
  transferMinutes: number;
  transfers: number;
  totalMinutes: number;
  routeSteps: RailRouteStep[];
}

export interface RailRideStep {
  kind: 'ride';
  lineCode: string;
  fromStationId: string;
  fromStationName: string;
  toStationId: string;
  toStationName: string;
  stops: number;
  minutes: number;
}

export interface RailTransferStep {
  kind: 'transfer';
  stationId: string;
  stationName: string;
  fromLineCode: string;
  toLineCode: string;
  minutes: number;
}

export type RailRouteStep = RailRideStep | RailTransferStep;

export interface DistanceResult extends Coordinate {
  mode: 'distance';
  objective: DistanceObjective;
  title: string;
  address: string;
  totalKm: number;
  averageKm: number;
  maxKm: number;
}

export interface RailResult extends Coordinate {
  mode: 'rail';
  objective: RailObjective;
  title: string;
  address: string;
  station: RankedStation;
  alternatives: RankedStation[];
  candidateCount: number;
  totalKm: number;
  averageKm: number;
  maxKm: number;
  totalMinutes: number;
  averageMinutes: number;
  maxMinutes: number;
}

export type MeetingResult = DistanceResult | RailResult;

export interface TrainAlertSegment {
  Status?: number;
  Line?: string;
  Direction?: string;
  Stations?: string;
  FreePublicBus?: string;
  FreeMRTShuttle?: string;
  MRTShuttleDirection?: string;
}

export interface TrainAlertMessage {
  Content?: string;
  CreatedDate?: string;
}

export interface TrainAlertPayload {
  configured: boolean;
  available: boolean;
  status: 'not-configured' | 'normal' | 'disrupted' | 'unavailable';
  affectedSegments: TrainAlertSegment[];
  messages: TrainAlertMessage[];
  checkedAt?: string;
  error?: string;
}

export type NearbyCategory = 'food' | 'cafe' | 'activity' | 'outdoors';

export interface NearbyPlace extends Coordinate {
  id: string;
  name: string;
  category: NearbyCategory;
  distanceKm: number;
  address?: string;
  detail?: string;
  source: 'NEA' | 'STB';
}

export interface NearbyPlacesPayload {
  places: NearbyPlace[];
  radiusKm: number;
  sources: Array<{
    id: 'NEA' | 'STB';
    label: string;
    url: string;
  }>;
  cachedAt: string;
}
