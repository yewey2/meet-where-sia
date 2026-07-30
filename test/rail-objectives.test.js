import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

async function loadRailGraph() {
  const source = await readFile(new URL('../src/lib/railGraph.ts', import.meta.url), 'utf8');
  const compiled = await transformWithOxc(source, 'railGraph.ts');
  const centroidStub = `data:text/javascript,${encodeURIComponent(`
    export const distanceMetrics = () => ({});
    export const haversineKm = (a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng);
  `)}`;
  const metricsStub = `data:text/javascript,${encodeURIComponent(`
    export const participantTravelTimeMetrics = () => ({});
  `)}`;
  const code = compiled.code
    .replace('"./centroid"', JSON.stringify(centroidStub))
    .replace('"./journeyMetrics"', JSON.stringify(metricsStub));
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

function station(name, averageMinutes, maxMinutes, varianceMinutes, centroidKm = 1) {
  return { name, averageMinutes, maxMinutes, varianceMinutes, centroidKm };
}

test('minimax objective prioritizes the shortest longest journey', async () => {
  const { compareRankedStations } = await loadRailGraph();
  const lowerAverage = station('Average', 20, 50, 100);
  const lowerMaximum = station('Maximum', 25, 40, 200);

  assert.ok(compareRankedStations(lowerMaximum, lowerAverage, 'minimax') < 0);
});

test('average objective prioritizes group average over the longest journey', async () => {
  const { compareRankedStations } = await loadRailGraph();
  const lowerAverage = station('Average', 20, 50, 100);
  const lowerMaximum = station('Maximum', 25, 40, 200);

  assert.ok(compareRankedStations(lowerAverage, lowerMaximum, 'average') < 0);
});

test('evenness objective prioritizes variance before average journey time', async () => {
  const { compareRankedStations } = await loadRailGraph();
  const lowerAverage = station('Average', 20, 40, 400);
  const moreEven = station('Even', 30, 35, 25);

  assert.ok(compareRankedStations(moreEven, lowerAverage, 'evenness') < 0);
});

test('rail objectives use centroid proximity and station name as stable tie-breakers', async () => {
  const { compareRankedStations } = await loadRailGraph();
  const farther = station('Alpha', 20, 30, 100, 2);
  const nearer = station('Zulu', 20, 30, 100, 1);
  const alphabetical = station('Alpha', 20, 30, 100, 1);

  for (const objective of ['minimax', 'average', 'evenness']) {
    assert.ok(compareRankedStations(nearer, farther, objective) < 0);
    assert.ok(compareRankedStations(alphabetical, nearer, objective) < 0);
  }
});

test('rail locality warning requires a large radial or buffered-bounds detour', async () => {
  const { hasSignificantGeographicDetour } = await loadRailGraph();

  assert.equal(hasSignificantGeographicDetour(6, 2), true);
  assert.equal(hasSignificantGeographicDetour(3, 2), false);
  assert.equal(hasSignificantGeographicDetour(13, 10), false);
  assert.equal(hasSignificantGeographicDetour(3, 2, 2.1), true);
  assert.equal(hasSignificantGeographicDetour(3, 2, 1.9), false);
  assert.equal(hasSignificantGeographicDetour(Number.NaN, 2), false);
});

test('distance outside endpoint bounds is zero inside and measured from the nearest edge', async () => {
  const { distanceOutsideEndpointBoundsKm } = await loadRailGraph();
  const points = [{ lat: 0, lng: 0 }, { lat: 2, lng: 2 }];

  assert.equal(distanceOutsideEndpointBoundsKm({ lat: 1, lng: 1 }, points), 0);
  assert.equal(distanceOutsideEndpointBoundsKm({ lat: 3, lng: 1 }, points), 1);
  assert.equal(distanceOutsideEndpointBoundsKm({ lat: 3, lng: 3 }, points), Math.sqrt(2));
});
