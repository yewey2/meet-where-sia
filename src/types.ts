export type Mode = 'distance' | 'rail';

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
  sameAsStart: boolean;
  start: LocationValue;
  end: LocationValue;
}

export interface EndpointPoint {
  id: string;
  participantId: string;
  participantName: string;
  kind: 'start' | 'end';
  label: string;
  lat: number;
  lng: number;
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
  totalTransfers: number;
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
  accessWalkMinutes: number;
  initialWaitMinutes: number;
  rideMinutes: number;
  transferMinutes: number;
  transfers: number;
  totalMinutes: number;
}

export interface DistanceResult extends Coordinate {
  mode: 'distance';
  title: string;
  address: string;
  totalKm: number;
  averageKm: number;
  maxKm: number;
}

export interface RailResult extends Coordinate {
  mode: 'rail';
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
