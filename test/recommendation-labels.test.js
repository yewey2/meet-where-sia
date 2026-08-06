import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

test('recommendations use stable A-D labels', async () => {
  const source = await readFile(
    new URL('../src/lib/recommendationLabels.ts', import.meta.url),
    'utf8',
  );
  const compiled = await transformWithOxc(source, 'recommendationLabels.ts');
  const labels = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
  );

  assert.deepEqual([0, 1, 2, 3].map(labels.recommendationLabel), ['A', 'B', 'C', 'D']);
});
