import { allowGet, sendJson } from './_http.js';
import { loadNearbyPlaces } from '../server/services.mjs';

export default async function handler(request, response) {
  if (!allowGet(request, response)) return;

  const lat = Number(request.query.lat);
  const lng = Number(request.query.lng);
  const radiusKm = Number(request.query.radiusKm || 1.5);

  try {
    const payload = await loadNearbyPlaces(lat, lng, radiusKm);
    sendJson(
      response,
      200,
      payload,
      'public, s-maxage=3600, stale-while-revalidate=86400',
    );
  } catch (error) {
    sendJson(response, error instanceof RangeError ? 400 : 502, {
      error:
        error instanceof Error
          ? error.message
          : 'Could not load nearby places.',
    });
  }
}
