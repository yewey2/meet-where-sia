import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 8787);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const STATION_DATASET_ID = 'd_b39d3a0871985372d7e1637193335da5';
const STATION_POLL_URL = `https://api-open.data.gov.sg/v1/public/api/datasets/${STATION_DATASET_ID}/poll-download`;
const LTA_ALERTS_URL =
  'https://datamall2.mytransport.sg/ltaodataservice/TrainServiceAlerts';

const STATION_CACHE_MS = 12 * 60 * 60 * 1000;
const ALERT_CACHE_MS = 60 * 1000;

let stationCache;
let alertCache;

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

function titleCaseStation(value) {
  const smallWords = new Set(['by', 'the', 'of', 'and']);
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) => {
      if (index > 0 && smallWords.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ')
    .replace(/Mrt/g, 'MRT')
    .replace(/Lrt/g, 'LRT');
}

function stationId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Upstream request failed (${response.status}).`);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function aggregateStationExits(geojson) {
  const aggregates = new Map();
  const features = Array.isArray(geojson?.features) ? geojson.features : [];

  for (const feature of features) {
    const coordinates = feature?.geometry?.coordinates;
    const rawName = feature?.properties?.STATION_NA;

    if (
      feature?.geometry?.type !== 'Point' ||
      !Array.isArray(coordinates) ||
      coordinates.length < 2 ||
      typeof rawName !== 'string'
    ) {
      continue;
    }

    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const network = /\bLRT\b/i.test(rawName) ? 'LRT' : 'MRT';
    const cleanName = rawName
      .replace(/\s+(MRT|LRT)\s+STATION\s*$/i, '')
      .trim();
    const key = cleanName.toUpperCase();
    const current = aggregates.get(key) || {
      name: titleCaseStation(cleanName),
      network,
      latTotal: 0,
      lngTotal: 0,
      exitCount: 0,
    };

    current.latTotal += lat;
    current.lngTotal += lng;
    current.exitCount += 1;
    if (network === 'MRT') current.network = 'MRT';
    aggregates.set(key, current);
  }

  return [...aggregates.values()]
    .map((station) => ({
      id: stationId(station.name),
      name: station.name,
      network: station.network,
      lat: station.latTotal / station.exitCount,
      lng: station.lngTotal / station.exitCount,
      exitCount: station.exitCount,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function loadStations() {
  if (stationCache && Date.now() - stationCache.cachedAtMs < STATION_CACHE_MS) {
    return stationCache.payload;
  }

  const catalogueResponse = await fetchWithTimeout(STATION_POLL_URL, {
    headers: { accept: 'application/json' },
  });
  const catalogue = await catalogueResponse.json();

  if (catalogue?.code !== 0 || !catalogue?.data?.url) {
    throw new Error(catalogue?.errMsg || 'The station dataset URL was unavailable.');
  }

  const datasetResponse = await fetchWithTimeout(
    catalogue.data.url,
    { headers: { accept: 'application/geo+json, application/json' } },
    20_000,
  );
  const geojson = await datasetResponse.json();
  const stations = aggregateStationExits(geojson);

  if (stations.length < 20) {
    throw new Error('The station dataset contained too few valid stations.');
  }

  const payload = {
    stations,
    source: 'LTA MRT Station Exit (GEOJSON) via data.gov.sg',
    updatedAt: geojson?.metadata?.lastUpdatedAt,
    cachedAt: new Date().toISOString(),
  };

  stationCache = { cachedAtMs: Date.now(), payload };
  return payload;
}

function normaliseTrainAlerts(payload) {
  const value = payload?.value ?? payload?.Value ?? payload;
  const statusCode = Number(value?.Status);
  const affectedSegments = Array.isArray(value?.AffectedSegments)
    ? value.AffectedSegments
    : [];
  const messages = Array.isArray(value?.Message) ? value.Message : [];

  return {
    configured: true,
    available: true,
    status: statusCode === 2 ? 'disrupted' : 'normal',
    affectedSegments,
    messages,
    checkedAt: new Date().toISOString(),
  };
}

async function loadTrainAlerts() {
  const accountKey = String(process.env.LTA_ACCOUNT_KEY || '').trim();
  if (!accountKey) {
    return {
      configured: false,
      available: false,
      status: 'not-configured',
      affectedSegments: [],
      messages: [],
    };
  }

  if (alertCache && Date.now() - alertCache.cachedAtMs < ALERT_CACHE_MS) {
    return alertCache.payload;
  }

  try {
    const response = await fetchWithTimeout(LTA_ALERTS_URL, {
      headers: {
        AccountKey: accountKey,
        accept: 'application/json',
      },
    });
    const payload = normaliseTrainAlerts(await response.json());
    alertCache = { cachedAtMs: Date.now(), payload };
    return payload;
  } catch (error) {
    return {
      configured: true,
      available: false,
      status: 'unavailable',
      affectedSegments: [],
      messages: [],
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'LTA request failed.',
    };
  }
}

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    googleMapsConfigured: Boolean(
      String(process.env.VITE_GOOGLE_MAPS_API_KEY || '').trim(),
    ),
    ltaConfigured: Boolean(String(process.env.LTA_ACCOUNT_KEY || '').trim()),
    time: new Date().toISOString(),
  });
});

app.get('/api/mrt-stations', async (_request, response) => {
  try {
    response.set('Cache-Control', 'public, max-age=3600');
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

app.get('/api/lta/train-alerts', async (_request, response) => {
  response.set('Cache-Control', 'private, max-age=60');
  response.json(await loadTrainAlerts());
});

if (existsSync(distDir)) {
  app.use(express.static(distDir, { index: false }));
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/')) {
      next();
      return;
    }
    response.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(port, () => {
  console.log(`MeetMiddle API listening on http://localhost:${port}`);
});
