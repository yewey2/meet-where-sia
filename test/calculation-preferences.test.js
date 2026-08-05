import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

async function loadPreferences() {
  const source = await readFile(new URL('../src/lib/calculationPreferences.ts', import.meta.url), 'utf8');
  const compiled = await transformWithOxc(source, 'calculationPreferences.ts');
  return import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
}

test('only owners persist shared calculation defaults', async () => {
  const { calculationChangePolicy } = await loadPreferences();

  assert.deepEqual(calculationChangePolicy(false, false), {
    persistShared: false,
    overrideSharedDefaults: false,
  });
  assert.deepEqual(calculationChangePolicy(true, true), {
    persistShared: true,
    overrideSharedDefaults: false,
  });
  assert.deepEqual(calculationChangePolicy(true, false), {
    persistShared: false,
    overrideSharedDefaults: true,
  });
});

test('polling preserves local choices but a different plan applies its defaults', async () => {
  const { shouldApplySharedCalculationPreferences } = await loadPreferences();

  assert.equal(shouldApplySharedCalculationPreferences('plan-a', 'plan-a', true), false);
  assert.equal(shouldApplySharedCalculationPreferences('plan-a', 'plan-a', false), true);
  assert.equal(shouldApplySharedCalculationPreferences('plan-a', 'plan-b', true), true);
});
