import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

async function loadErrorMessages() {
  const source = await readFile(new URL('../src/lib/errorMessages.ts', import.meta.url), 'utf8');
  const compiled = await transformWithOxc(source, 'errorMessages.ts');
  return import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
}

test('error messages retain useful detail and append a next step', async () => {
  const { actionableErrorMessage } = await loadErrorMessages();

  assert.equal(
    actionableErrorMessage(
      new Error('No Singapore result found'),
      'We could not find that place',
      'Try an MRT station.',
    ),
    'No Singapore result found. Try an MRT station.',
  );
});

test('technical setup failures are replaced with user-safe guidance', async () => {
  const { actionableErrorMessage } = await loadErrorMessages();

  assert.equal(
    actionableErrorMessage(
      new Error('Could not load Google Maps. Check the API key restrictions.'),
      'Place suggestions are unavailable',
      'Enter an MRT/LRT station instead.',
    ),
    'Place suggestions are unavailable. Enter an MRT/LRT station instead.',
  );
});
