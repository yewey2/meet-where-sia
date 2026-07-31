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
    meanSquaredMinutes: 1600,
    rootMeanSquareMinutes: 40,
    varianceMinutes: 0,
    standardDeviationMinutes: 0,
  });
});

test('rail evenness metrics measure variance between complete participant outings', async () => {
  const { participantTravelTimeMetrics } = await loadJourneyMetrics();
  const journeys = [
    journey('a', 'Aisha', 'start', 5),
    journey('a', 'Aisha', 'end', 5),
    journey('b', 'Ben', 'start', 25),
    journey('b', 'Ben', 'end', 25),
  ];

  assert.deepEqual(participantTravelTimeMetrics(journeys), {
    totalMinutes: 60,
    averageMinutes: 30,
    maxMinutes: 50,
    meanSquaredMinutes: 1300,
    rootMeanSquareMinutes: Math.sqrt(1300),
    varianceMinutes: 400,
    standardDeviationMinutes: 20,
  });
});

test('empty rail journeys have finite zero-valued metrics', async () => {
  const { participantTravelTimeMetrics } = await loadJourneyMetrics();

  assert.deepEqual(participantTravelTimeMetrics([]), {
    totalMinutes: 0,
    averageMinutes: 0,
    maxMinutes: 0,
    meanSquaredMinutes: 0,
    rootMeanSquareMinutes: 0,
    varianceMinutes: 0,
    standardDeviationMinutes: 0,
  });
});
