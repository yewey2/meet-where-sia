import type {
  Coordinate,
} from '../types';

const EARTH_RADIUS_KM = 6371.0088;
const EARTH_RADIUS_M = EARTH_RADIUS_KM * 1000;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export function haversineKm(a: Coordinate, b: Coordinate): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const deltaLat = (b.lat - a.lat) * DEG_TO_RAD;
  const deltaLng = (b.lng - a.lng) * DEG_TO_RAD;

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Finds the geometric median using Weiszfeld's algorithm on a local tangent
 * plane. For Singapore-scale distances this closely approximates the point
 * that minimizes the sum of straight-line kilometres to all endpoints.
 */
export function geometricMedian(points: Coordinate[]): Coordinate {
  if (points.length === 0) {
    throw new Error('At least one coordinate is required.');
  }

  if (points.length === 1) return { ...points[0] };

  const originLat =
    points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const originLng =
    points.reduce((sum, point) => sum + point.lng, 0) / points.length;
  const cosOriginLat = Math.cos(originLat * DEG_TO_RAD);

  const planar = points.map((point) => ({
    x:
      (point.lng - originLng) *
      DEG_TO_RAD *
      EARTH_RADIUS_M *
      cosOriginLat,
    y: (point.lat - originLat) * DEG_TO_RAD * EARTH_RADIUS_M,
  }));

  let current = {
    x: planar.reduce((sum, point) => sum + point.x, 0) / planar.length,
    y: planar.reduce((sum, point) => sum + point.y, 0) / planar.length,
  };

  for (let iteration = 0; iteration < 250; iteration += 1) {
    let numeratorX = 0;
    let numeratorY = 0;
    let denominator = 0;
    let coincidentPoint: { x: number; y: number } | undefined;

    for (const point of planar) {
      const distance = Math.hypot(current.x - point.x, current.y - point.y);

      if (distance < 0.001) {
        coincidentPoint = point;
        break;
      }

      const weight = 1 / distance;
      numeratorX += point.x * weight;
      numeratorY += point.y * weight;
      denominator += weight;
    }

    if (coincidentPoint) {
      current = coincidentPoint;
      break;
    }

    const next = {
      x: numeratorX / denominator,
      y: numeratorY / denominator,
    };

    if (Math.hypot(next.x - current.x, next.y - current.y) < 0.01) {
      current = next;
      break;
    }

    current = next;
  }

  return {
    lat: originLat + (current.y / EARTH_RADIUS_M) * RAD_TO_DEG,
    lng:
      originLng +
      (current.x / (EARTH_RADIUS_M * cosOriginLat)) * RAD_TO_DEG,
  };
}

export function distanceMetrics(
  candidate: Coordinate,
  points: Coordinate[],
): { totalKm: number; averageKm: number; maxKm: number } {
  const distances = points.map((point) => haversineKm(candidate, point));
  const totalKm = distances.reduce((sum, distance) => sum + distance, 0);

  return {
    totalKm,
    averageKm: totalKm / distances.length,
    maxKm: Math.max(...distances),
  };
}
