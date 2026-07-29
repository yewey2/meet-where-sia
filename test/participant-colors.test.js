import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

async function loadParticipantColors() {
  const source = await readFile(
    new URL('../src/lib/participantColors.ts', import.meta.url),
    'utf8',
  );
  const compiled = await transformWithOxc(source, 'participantColors.ts');
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`
  );
}

test('new participants use all ten colours before repeating one', async () => {
  const { PARTICIPANT_COLORS, pickParticipantColor } = await loadParticipantColors();
  const assigned = [];

  for (let index = 0; index < PARTICIPANT_COLORS.length; index += 1) {
    assigned.push(pickParticipantColor(assigned, () => 0.42));
  }

  assert.equal(PARTICIPANT_COLORS.length, 10);
  assert.equal(new Set(assigned).size, 10);
  assert.ok(PARTICIPANT_COLORS.every((color) => assigned.includes(color.id)));
});

test('legacy participants receive stable distinct colours', async () => {
  const { normalizeParticipantColors } = await loadParticipantColors();
  const legacy = Array.from({ length: 6 }, (_, index) => ({
    id: `person_legacy_${index}`,
    name: `Person ${index + 1}`,
    sameAsStart: true,
    start: { query: '', status: 'empty' },
    end: { query: '', status: 'empty' },
  }));

  const first = normalizeParticipantColors(legacy);
  const second = normalizeParticipantColors(legacy);

  assert.deepEqual(
    first.map((participant) => participant.color),
    second.map((participant) => participant.color),
  );
  assert.equal(new Set(first.map((participant) => participant.color)).size, 6);
});
