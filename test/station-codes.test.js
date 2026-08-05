import assert from 'node:assert/strict';
import test from 'node:test';

import { stationCodesForName } from '../server/stationCodes.mjs';

test('station codes include ordinary, skipped-number and branch stations', () => {
  assert.deepEqual(stationCodesForName('Eunos'), ['EW7']);
  assert.deepEqual(stationCodesForName('Kranji'), ['NS7']);
  assert.deepEqual(stationCodesForName('Expo'), ['CG1', 'DT35']);
  assert.deepEqual(stationCodesForName('Tanah Merah'), ['EW4', 'CG']);
});

test('station codes include every code for interchanges', () => {
  assert.deepEqual(stationCodesForName('Bishan'), ['NS17', 'CC15']);
  assert.deepEqual(stationCodesForName('Outram Park'), ['EW16', 'NE3', 'TE17']);
  assert.deepEqual(stationCodesForName('Marina Bay'), ['NS27', 'CC33', 'TE20']);
});

test('station codes include MRT extensions and LRT loop identifiers', () => {
  assert.deepEqual(stationCodesForName('Hume'), ['DT4']);
  assert.deepEqual(stationCodesForName('Prince Edward Road'), ['CC32']);
  assert.deepEqual(stationCodesForName('Sengkang'), ['NE16', 'STC']);
  assert.deepEqual(stationCodesForName('Teck Lee'), ['PW2']);
});

test('station code lookup tolerates source name punctuation and casing', () => {
  assert.deepEqual(stationCodesForName('ONE-NORTH'), ['CC23']);
  assert.deepEqual(stationCodesForName('Unknown'), []);
});
