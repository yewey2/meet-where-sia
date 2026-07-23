import { allowGet, sendJson } from './_http.js';
import { getHealthPayload } from '../server/services.mjs';

export default function handler(request, response) {
  if (!allowGet(request, response)) return;
  sendJson(response, 200, getHealthPayload(), 'no-store');
}
