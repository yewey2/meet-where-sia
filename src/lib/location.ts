import type { Coordinate, LocationValue } from '../types';

export const SINGAPORE_CENTER: Coordinate = {
  lat: 1.3521,
  lng: 103.8198,
};

export const SINGAPORE_BOUNDS: google.maps.LatLngBoundsLiteral = {
  south: 1.1304,
  west: 103.5804,
  north: 1.4786,
  east: 104.0945,
};

export function emptyLocation(query = ''): LocationValue {
  return {
    query,
    status: query ? 'dirty' : 'empty',
  };
}

export function hasCoordinates(
  location: LocationValue,
): location is LocationValue & Required<Pick<LocationValue, 'lat' | 'lng'>> {
  return Number.isFinite(location.lat) && Number.isFinite(location.lng);
}

/** Converts formats such as "425-500" or "425 500" to "425500". */
export function normalizeLocationQuery(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  const possiblePostalCode = trimmed.replace(/[\s-]/g, '');

  if (/^\d{6}$/.test(possiblePostalCode)) {
    return possiblePostalCode;
  }

  return trimmed;
}

export function appendSingapore(value: string): string {
  const normalized = normalizeLocationQuery(value);
  if (!normalized) return '';
  if (/\bsingapore\b/i.test(normalized)) return normalized;
  return `${normalized}, Singapore`;
}

export function displayLocation(location: LocationValue): string {
  return location.label || location.query;
}
