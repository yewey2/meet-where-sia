import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

async function loadJourneyMetrics() {
  const source = await readFile(new URL('../src/lib/journeyMetrics.ts', import.meta.url), 'utf8');
  const compiled = await transformWithOxc(source, 'journeyMetrics.ts');
  return import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
}

function journey(participantId, participantName, endpointKind, totalMinutes) {
  return {
    endpointId: `${participantId}-${endpointKind}`,
    endpointLabel: `${participantName} ${endpointKind}`,
    endpointKind,
    participantId,
    participantName,
    originStationId: 'station',
    originStationName: 'Station',
    accessWalkMinutes: 0,
    initialWaitMinutes: 0,
    rideMinutes: totalMinutes,
    transferMinutes: 0,
    transfers: 0,
    totalMinutes,
  };
}

test('rail fairness uses each person full outing while preserving both legs', async () => {
  const { participantTravelTimeMetrics, summarizeParticipantJourneys } = await loadJourneyMetrics();
  const journeys = [
    journey('a', 'Aisha', 'start', 10),
    journey('a', 'Aisha', 'end', 30),
    journey('b', 'Ben', 'start', 20),
    journey('b', 'Ben', 'end', 20),
  ];

  const summaries = summarizeParticipantJourneys(journeys);
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].outbound.totalMinutes, 10);
  assert.equal(summaries[0].afterMeetup.totalMinutes, 30);
  assert.equal(summaries[0].totalMinutes, 40);

  assert.deepEqual(participantTravelTimeMetrics(journeys), {
    totalMinutes: 80,
    averageMinutes: 40,
    maxMinutes: 40,
  });
});
