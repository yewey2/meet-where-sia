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
  const typesStub = `data:text/javascript,${encodeURIComponent(`
    export const DEFAULT_RAIL_OBJECTIVE = 'weighted';
  `)}`;
  const code = compiled.code
    .replace('"../types"', JSON.stringify(typesStub))
    .replace('"./centroid"', JSON.stringify(centroidStub))
    .replace('"./journeyMetrics"', JSON.stringify(metricsStub));
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

function station(name, averageMinutes, maxMinutes, varianceMinutes, centroidKm = 1, meanSquaredMinutes = averageMinutes ** 2 + varianceMinutes) {
  return { name, averageMinutes, maxMinutes, varianceMinutes, centroidKm, meanSquaredMinutes };
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

test('weighted objective prioritizes the average squared full-journey time', async () => {
  const { compareRankedStations } = await loadRailGraph();
  const lowerAverageButSkewed = station('Skewed', 20, 50, 300, 1, 700);
  const balanced = station('Balanced', 22, 30, 20, 1, 504);

  assert.ok(compareRankedStations(balanced, lowerAverageButSkewed, 'weighted') < 0);
});

test('rail objectives use centroid proximity and station name as stable tie-breakers', async () => {
  const { compareRankedStations } = await loadRailGraph();
  const farther = station('Alpha', 20, 30, 100, 2);
  const nearer = station('Zulu', 20, 30, 100, 1);
  const alphabetical = station('Alpha', 20, 30, 100, 1);

  for (const objective of ['minimax', 'average', 'weighted', 'evenness']) {
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

test('local stations resolve by name, individual code, or full interchange label', async () => {
  const { findLocalStation } = await loadRailGraph();
  const stations = [
    { id: 'eunos', name: 'Eunos', codes: ['EW7'] },
    { id: 'bishan', name: 'Bishan', codes: ['NS17', 'CC15'] },
  ];

  assert.equal(findLocalStation('Eunos MRT station', stations)?.id, 'eunos');
  assert.equal(findLocalStation('EW7', stations)?.id, 'eunos');
  assert.equal(findLocalStation('EW7 Eunos', stations)?.id, 'eunos');
  assert.equal(findLocalStation('CC15 Bishan', stations)?.id, 'bishan');
  assert.equal(findLocalStation('NS17/CC15 Bishan', stations)?.id, 'bishan');
});

test('rail paths collapse consecutive stops into rides separated by named transfers', async () => {
  const { summarizeRailPath } = await loadRailGraph();
  const stations = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Bravo' },
    { id: 'c', name: 'Central' },
    { id: 'd', name: 'Delta' },
  ];
  const path = [
    { kind: 'ride', minutes: 2, fromStationId: 'a', fromLineCode: 'DT', toStationId: 'b', toLineCode: 'DT' },
    { kind: 'ride', minutes: 3, fromStationId: 'b', fromLineCode: 'DT', toStationId: 'c', toLineCode: 'DT' },
    { kind: 'transfer', minutes: 6.5, fromStationId: 'c', fromLineCode: 'DT', toStationId: 'c', toLineCode: 'CC' },
    { kind: 'ride', minutes: 4, fromStationId: 'c', fromLineCode: 'CC', toStationId: 'd', toLineCode: 'CC' },
  ];

  assert.deepEqual(summarizeRailPath(path, stations), [
    {
      kind: 'ride', lineCode: 'DT',
      fromStationId: 'a', fromStationName: 'Alpha',
      toStationId: 'c', toStationName: 'Central',
      stops: 2, minutes: 5,
    },
    {
      kind: 'transfer', stationId: 'c', stationName: 'Central',
      fromLineCode: 'DT', toLineCode: 'CC', minutes: 6.5,
    },
    {
      kind: 'ride', lineCode: 'CC',
      fromStationId: 'c', fromStationName: 'Central',
      toStationId: 'd', toStationName: 'Delta',
      stops: 1, minutes: 4,
    },
  ]);
});

test('after-meetup rail instructions reverse rides and transfer directions', async () => {
  const { reverseRailRouteSteps } = await loadRailGraph();
  const steps = [
    {
      kind: 'ride', lineCode: 'DT',
      fromStationId: 'a', fromStationName: 'Alpha',
      toStationId: 'c', toStationName: 'Central',
      stops: 2, minutes: 5,
    },
    {
      kind: 'transfer', stationId: 'c', stationName: 'Central',
      fromLineCode: 'DT', toLineCode: 'CC', minutes: 6.5,
    },
    {
      kind: 'ride', lineCode: 'CC',
      fromStationId: 'c', fromStationName: 'Central',
      toStationId: 'd', toStationName: 'Delta',
      stops: 1, minutes: 4,
    },
  ];

  assert.deepEqual(reverseRailRouteSteps(steps), [
    {
      kind: 'ride', lineCode: 'CC',
      fromStationId: 'd', fromStationName: 'Delta',
      toStationId: 'c', toStationName: 'Central',
      stops: 1, minutes: 4,
    },
    {
      kind: 'transfer', stationId: 'c', stationName: 'Central',
      fromLineCode: 'CC', toLineCode: 'DT', minutes: 6.5,
    },
    {
      kind: 'ride', lineCode: 'DT',
      fromStationId: 'c', fromStationName: 'Central',
      toStationId: 'a', toStationName: 'Alpha',
      stops: 2, minutes: 5,
    },
  ]);
});
