import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('all rail and distance fairness choices remain visible in the planner', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

  for (const label of [
    'Quickest overall',
    'Weighted centre',
    'Keep trips manageable',
    'Similar travel times',
    'Balanced centre',
    'Shortest overall',
  ]) {
    assert.match(source, new RegExp(`label: '${label}'`));
  }

  assert.match(source, /name=\{`\$\{mode\}-objective`\}/);
  assert.match(source, /arithmeticCentroid\(points\)/);
  assert.match(source, /geometricMedian\(points\)/);
});
