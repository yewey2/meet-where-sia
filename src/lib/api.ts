import type {
  MrtStation,
  NearbyPlacesPayload,
  TrainAlertPayload,
} from '../types';

interface StationResponse {
  stations: MrtStation[];
  source: string;
  supplementedStations?: string[];
  updatedAt?: string;
  cachedAt: string;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => undefined)) as
    | T
    | { error?: string }
    | undefined;

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `Request failed with status ${response.status}.`;
    throw new Error(message);
  }

  return payload as T;
}

export async function fetchMrtStations(
  signal?: AbortSignal,
): Promise<StationResponse> {
  const response = await fetch('/api/mrt-stations', { signal });
  return parseJsonResponse<StationResponse>(response);
}

export async function fetchTrainAlerts(
  signal?: AbortSignal,
): Promise<TrainAlertPayload> {
  const response = await fetch('/api/lta/train-alerts', { signal });
  return parseJsonResponse<TrainAlertPayload>(response);
}

export async function fetchNearbyPlaces(
  lat: number,
  lng: number,
  radiusKm = 1.5,
  signal?: AbortSignal,
): Promise<NearbyPlacesPayload> {
  const query = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radiusKm: String(radiusKm),
  });
  const response = await fetch(`/api/nearby?${query}`, { signal });
  return parseJsonResponse<NearbyPlacesPayload>(response);
}
