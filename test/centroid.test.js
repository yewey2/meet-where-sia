import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

async function loadCentroid() {
  const source = await readFile(new URL('../src/lib/centroid.ts', import.meta.url), 'utf8');
  const compiled = await transformWithOxc(source, 'centroid.ts');
  return import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
}

test('arithmetic centroid averages repeated coordinates for balanced distance', async () => {
  const { arithmeticCentroid } = await loadCentroid();
  const result = arithmeticCentroid([
    { lat: 1, lng: 1 },
    { lat: 1, lng: 1 },
    { lat: 1, lng: 2 },
  ]);

  assert.equal(result.lat, 1);
  assert.equal(result.lng, 4 / 3);
});

test('balanced distance keeps Tampines, Joo Koon, and Boon Lay away from the Boon Lay anchor', async () => {
  const { arithmeticCentroid, geometricMedian, haversineKm } = await loadCentroid();
  const tampines = { lat: 1.3543165275390319, lng: 103.94378200066225 };
  const jooKoon = { lat: 1.3277290979482586, lng: 103.67858239304405 };
  const boonLay = { lat: 1.3384759405295732, lng: 103.70571801969106 };
  const points = [tampines, jooKoon, boonLay];

  const balanced = arithmeticCentroid(points);
  const shortest = geometricMedian(points);

  assert.ok(haversineKm(shortest, boonLay) < 0.001);
  assert.ok(haversineKm(balanced, boonLay) > 7.8);
  assert.ok(haversineKm(balanced, tampines) < haversineKm(boonLay, tampines));
});

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
