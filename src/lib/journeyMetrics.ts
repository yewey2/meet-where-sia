import type { RailJourneyEstimate } from '../types';

export interface ParticipantJourneySummary {
  participantId: string;
  participantName: string;
  outbound?: RailJourneyEstimate;
  afterMeetup?: RailJourneyEstimate;
  totalMinutes: number;
}

export function summarizeParticipantJourneys(
  journeys: RailJourneyEstimate[],
): ParticipantJourneySummary[] {
  const summaries = new Map<string, ParticipantJourneySummary>();

  for (const journey of journeys) {
    const summary = summaries.get(journey.participantId) || {
      participantId: journey.participantId,
      participantName: journey.participantName,
      totalMinutes: 0,
    };
    summary.participantName = journey.participantName;
    summary.totalMinutes += journey.totalMinutes;
    if (journey.endpointKind === 'start') summary.outbound = journey;
    else summary.afterMeetup = journey;
    summaries.set(journey.participantId, summary);
  }

  return [...summaries.values()];
}

export function participantTravelTimeMetrics(journeys: RailJourneyEstimate[]): {
  totalMinutes: number;
  averageMinutes: number;
  maxMinutes: number;
  meanSquaredMinutes: number;
  rootMeanSquareMinutes: number;
  varianceMinutes: number;
  standardDeviationMinutes: number;
} {
  const summaries = summarizeParticipantJourneys(journeys);
  const totals = summaries.map((summary) => summary.totalMinutes);
  const totalMinutes = totals.reduce((sum, minutes) => sum + minutes, 0);
  const averageMinutes = totals.length ? totalMinutes / totals.length : 0;
  const meanSquaredMinutes = totals.length
    ? totals.reduce((sum, minutes) => sum + minutes ** 2, 0) / totals.length
    : 0;
  const varianceMinutes = totals.length
    ? totals.reduce((sum, minutes) => sum + (minutes - averageMinutes) ** 2, 0) / totals.length
    : 0;

  return {
    totalMinutes,
    averageMinutes,
    maxMinutes: totals.length ? Math.max(...totals) : 0,
    meanSquaredMinutes,
    rootMeanSquareMinutes: Math.sqrt(meanSquaredMinutes),
    varianceMinutes,
    standardDeviationMinutes: Math.sqrt(varianceMinutes),
  };
}
