import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

async function loadCentroid() {
  const source = await readFile(new URL('../src/lib/centroid.ts', import.meta.url), 'utf8');
  const compiled = await transformWithOxc(source, 'centroid.ts');
  return import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
}

test('geometric median does not stop merely because the initial estimate is an input point', async () => {
  const { distanceMetrics, geometricMedian } = await loadCentroid();
  const origin = { lat: 1.3, lng: 103.8 };
  const points = [
    origin,
    { lat: 1.3, lng: 103.9 },
    { lat: 1.31, lng: 103.77 },
    { lat: 1.31, lng: 103.77 },
    { lat: 1.28, lng: 103.76 },
  ];

  const result = geometricMedian(points);
  assert.ok(distanceMetrics(result, points).totalKm < distanceMetrics(origin, points).totalKm);
  assert.ok(Math.hypot(result.lat - origin.lat, result.lng - origin.lng) > 0.001);
});

test('repeated majority locations correctly anchor an ordinary geometric median', async () => {
  const { geometricMedian, haversineKm } = await loadCentroid();
  const pasirRis = { lat: 1.373, lng: 103.949 };
  const boonLay = { lat: 1.339, lng: 103.706 };

  const result = geometricMedian([pasirRis, pasirRis, pasirRis, boonLay]);
  assert.ok(haversineKm(result, pasirRis) < 0.001);
});
