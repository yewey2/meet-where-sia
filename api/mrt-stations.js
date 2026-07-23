import { allowGet, sendJson } from './_http.js';
import { loadStations } from '../server/services.mjs';

export default async function handler(request, response) {
  if (!allowGet(request, response)) return;

  try {
    const payload = await loadStations();
    sendJson(
      response,
      200,
      payload,
      'public, s-maxage=3600, stale-while-revalidate=86400',
    );
  } catch (error) {
    sendJson(response, 502, {
      error:
        error instanceof Error
          ? error.message
          : 'Could not load the official LTA station dataset.',
    });
  }
}
