import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

async function loadDirections() {
  const source = await readFile(new URL('../src/lib/directions.ts', import.meta.url), 'utf8');
  const compiled = await transformWithOxc(source, 'directions.ts');
  return import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
}

test('after-meetup directions reverse the meeting point and destination', async () => {
  const { meetingDirectionsUrl } = await loadDirections();
  const endpoint = { lat: 1.35, lng: 103.82 };
  const result = {
    mode: 'rail',
    station: { name: 'Bishan', network: 'MRT' },
  };

  const outbound = new URL(meetingDirectionsUrl(endpoint, result));
  assert.equal(outbound.searchParams.get('origin'), '1.35,103.82');
  assert.equal(outbound.searchParams.get('destination'), 'Bishan MRT Station, Singapore');

  const afterMeetup = new URL(meetingDirectionsUrl(endpoint, result, true));
  assert.equal(afterMeetup.searchParams.get('origin'), 'Bishan MRT Station, Singapore');
  assert.equal(afterMeetup.searchParams.get('destination'), '1.35,103.82');
});
