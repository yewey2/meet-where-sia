import express from 'express';
import {
  getHealthPayload,
  loadNearbyPlaces,
  loadStations,
  loadTrainAlerts,
} from './services.mjs';

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_request, response) => {
  response.set('Cache-Control', 'no-store');
  response.json(getHealthPayload());
});

app.get('/api/mrt-stations', async (_request, response) => {
  try {
    response.set(
      'Cache-Control',
      'public, s-maxage=3600, stale-while-revalidate=86400',
    );
    response.json(await loadStations());
  } catch (error) {
    response.status(502).json({
      error:
        error instanceof Error
          ? error.message
          : 'Could not load the official LTA station dataset.',
    });
  }
});

app.get('/api/nearby', async (request, response) => {
  const lat = Number(request.query.lat);
  const lng = Number(request.query.lng);
  const radiusKm = Number(request.query.radiusKm || 1.5);

  try {
    response.set(
      'Cache-Control',
      'public, s-maxage=3600, stale-while-revalidate=86400',
    );
    response.json(await loadNearbyPlaces(lat, lng, radiusKm));
  } catch (error) {
    const invalidRequest = error instanceof RangeError;
    response.status(invalidRequest ? 400 : 502).json({
      error:
        error instanceof Error
          ? error.message
          : 'Could not load nearby places.',
    });
  }
});

app.get('/api/lta/train-alerts', async (_request, response) => {
  response.set(
    'Cache-Control',
    'public, s-maxage=60, stale-while-revalidate=60',
  );
  response.json(await loadTrainAlerts());
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: 'Unexpected server error.' });
});

export default app;
