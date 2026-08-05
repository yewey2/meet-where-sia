import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

async function loadPresentation() {
  const source = await readFile(new URL('../src/lib/sharedPlanPresentation.ts', import.meta.url), 'utf8');
  const compiled = await transformWithOxc(source, 'sharedPlanPresentation.ts');
  const url = `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`;
  return import(url);
}

test('returning visitors see sign in first while claim links stay claim-first', async () => {
  const { defaultSharedPlanAccessMode, sharedPlanAccessModes } = await loadPresentation();

  assert.equal(defaultSharedPlanAccessMode(false), 'login');
  assert.deepEqual(sharedPlanAccessModes(false, true), ['login', 'join']);
  assert.equal(defaultSharedPlanAccessMode(true), 'claim');
  assert.deepEqual(sharedPlanAccessModes(true, true), ['claim', 'login', 'join']);
});

test('participant choices trim names and remove case-insensitive duplicates', async () => {
  const { namedPlanParticipants } = await loadPresentation();
  const participants = [
    { id: 'one', name: ' Alice ' },
    { id: 'two', name: 'alice' },
    { id: 'three', name: '' },
    { id: 'four', name: 'Ben' },
  ];

  assert.deepEqual(namedPlanParticipants(participants), [
    { id: 'one', name: 'Alice' },
    { id: 'four', name: 'Ben' },
  ]);
});

test('the shared-plan trigger identifies a signed-in participant', async () => {
  const { sharedPlanTriggerLabel } = await loadPresentation();

  assert.equal(sharedPlanTriggerLabel(null), 'Join');
  assert.equal(sharedPlanTriggerLabel({ role: 'owner', displayName: 'Host' }), 'Manage');
  assert.equal(
    sharedPlanTriggerLabel({ role: 'member', displayName: 'Alice Tan', username: 'Alice' }),
    'My route · Alice',
  );
});
