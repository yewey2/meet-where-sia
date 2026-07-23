import { allowGet, sendJson } from '../_http.js';
import { loadTrainAlerts } from '../../server/services.mjs';

export default async function handler(request, response) {
  if (!allowGet(request, response)) return;

  sendJson(
    response,
    200,
    await loadTrainAlerts(),
    'public, s-maxage=60, stale-while-revalidate=60',
  );
}
