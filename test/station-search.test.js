import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

async function loadStationHelpers() {
  const source = await readFile(new URL('../src/lib/stations.ts', import.meta.url), 'utf8');
  const compiled = await transformWithOxc(source, 'stations.ts');
  return import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
}

test('station labels show all interchange codes before the name', async () => {
  const { formatStationLabel } = await loadStationHelpers();
  assert.equal(
    formatStationLabel({ name: 'Bishan', network: 'MRT', codes: ['NS17', 'CC15'] }),
    'NS17/CC15 Bishan',
  );
});

test('station search matches names and exact numbered codes', async () => {
  const { stationMatchesQuery } = await loadStationHelpers();
  const eunos = { name: 'Eunos', network: 'MRT', codes: ['EW7'] };
  const pasirRis = { name: 'Pasir Ris', network: 'MRT', codes: ['EW1'] };
  const kallang = { name: 'Kallang', network: 'MRT', codes: ['EW10'] };

  assert.equal(stationMatchesQuery('eunos', eunos), true);
  assert.equal(stationMatchesQuery('EW7 Eunos', eunos), true);
  assert.equal(stationMatchesQuery('EW1', pasirRis), true);
  assert.equal(stationMatchesQuery('EW1', kallang), false);
});

test('station search supports derived acronyms and common line descriptions', async () => {
  const { buildStationSearchIndex, searchStations } = await loadStationHelpers();
  const stations = [
    { id: 'choa-chu-kang', name: 'Choa Chu Kang', network: 'MRT', codes: ['NS4', 'BP1'] },
    { id: 'south-view', name: 'South View', network: 'LRT', codes: ['BP2'] },
    { id: 'sengkang', name: 'Sengkang', network: 'MRT', codes: ['NE16', 'STC'] },
    { id: 'compassvale', name: 'Compassvale', network: 'LRT', codes: ['SE1'] },
    { id: 'eunos', name: 'Eunos', network: 'MRT', codes: ['EW7'] },
  ];
  const index = buildStationSearchIndex(stations);

  assert.deepEqual(searchStations(index, 'cck').map((station) => station.id), [
    'choa-chu-kang',
  ]);
  assert.deepEqual(searchStations(index, 'red line cck').map((station) => station.id), [
    'choa-chu-kang',
  ]);
  assert.deepEqual(
    searchStations(index, 'lrt', 10).map((station) => station.id),
    ['choa-chu-kang', 'compassvale', 'sengkang', 'south-view'],
  );
  assert.deepEqual(
    searchStations(index, 'sengkang lrt', 10).map((station) => station.id),
    ['compassvale', 'sengkang'],
  );
});
