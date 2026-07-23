export function allowGet(request, response) {
  if (request.method === 'GET') return true;

  response.setHeader('Allow', 'GET');
  sendJson(response, 405, { error: 'Method not allowed.' });
  return false;
}

export function sendJson(response, status, payload, cacheControl) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (cacheControl) response.setHeader('Cache-Control', cacheControl);
  response.end(JSON.stringify(payload));
}
