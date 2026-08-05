import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

async function loadPresentation() {
  const source = await readFile(new URL('../src/lib/participantPresentation.ts', import.meta.url), 'utf8');
  const compiled = await transformWithOxc(source, 'participantPresentation.ts');
  return import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
}

test('the assigned participant is identified as the current user', async () => {
  const { participantIdentityPresentation } = await loadPresentation();

  assert.deepEqual(participantIdentityPresentation(1, 'Alice', true), {
    className: 'participant-card is-current-user',
    ariaLabel: 'Person 2: Alice (You)',
    badge: 'Your route',
  });
  assert.deepEqual(participantIdentityPresentation(1, 'Alice', false), {
    className: 'participant-card',
    ariaLabel: 'Person 2: Alice',
    badge: null,
  });
});
