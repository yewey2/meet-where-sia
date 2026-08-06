import { useEffect, useState } from 'react';
import type {
  DistanceResult,
  EndpointPoint,
  MeetingResult,
  RailJourneyEstimate,
  RailRouteStep,
  RailResult,
  RankedStation,
  RailObjective,
  TrainAlertPayload,
} from '../types';
import { haversineKm } from '../lib/centroid';
import { reverseRailRouteSteps } from '../lib/railGraph';
import { meetingDirectionsUrl, meetingPointMapsUrl } from '../lib/directions';
import { formatStationLabel } from '../lib/stations';
import { recommendationLabel } from '../lib/recommendationLabels';
import {
  summarizeParticipantJourneys,
  type ParticipantJourneySummary,
} from '../lib/journeyMetrics';
import {
  ArrowUpRightIcon,
  MapPinIcon,
  RailIcon,
  ShareIcon,
  SparkIcon,
} from './Icons';
import { NearbyDiscovery } from './NearbyDiscovery';

interface ResultPanelProps {
  result: MeetingResult | null;
  isCalculating: boolean;
  trainAlerts: TrainAlertPayload | null;
  points: EndpointPoint[];
  onSelectStation: (station: RankedStation) => void;
}

function formatKm(value: number): string {
  if (value < 1) return `${Math.round(value * 1000)} m`;
  if (value < 10) return `${value.toFixed(2)} km`;
  return `${value.toFixed(1)} km`;
}

function formatMinutes(value: number): string {
  const rounded = Math.max(0, Math.round(value));
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return `${hours} hr${minutes ? ` ${minutes} min` : ''}`;
}

function objectiveLabel(objective: RailObjective): string {
  if (objective === 'average') return 'Quickest overall';
  if (objective === 'weighted') return 'Weighted centre';
  if (objective === 'evenness') return 'Similar travel times';
  return 'Keep trips manageable';
}

function objectiveMetric(station: RankedStation, objective: RailObjective): string {
  if (objective === 'average') return `${formatMinutes(station.totalMinutes)} group total`;
  if (objective === 'weighted') {
    return `${formatMinutes(station.rootMeanSquareMinutes)} weighted score`;
  }
  if (objective === 'evenness') return `${formatMinutes(station.standardDeviationMinutes)} spread`;
  return `${formatMinutes(station.maxMinutes)} time ceiling`;
}

const RAIL_LINE_NAMES: Record<string, string> = {
  NS: 'North-South Line',
  EW: 'East-West Line',
  CG: 'Changi Airport Branch',
  NE: 'North East Line',
  CC: 'Circle Line',
  DT: 'Downtown Line',
  TE: 'Thomson-East Coast Line',
  BP: 'Bukit Panjang LRT',
  SE: 'Sengkang East LRT',
  SW: 'Sengkang West LRT',
  PE: 'Punggol East LRT',
  PW: 'Punggol West LRT',
};

function formatRailLines(lineCodes: string[]): string {
  return lineCodes.map((code) => RAIL_LINE_NAMES[code] || code).join(', ');
}

function railLineLabel(lineCode: string): string {
  const name = RAIL_LINE_NAMES[lineCode];
  return name ? `${name} (${lineCode})` : lineCode;
}

function TrainStatus({ alerts }: { alerts: TrainAlertPayload | null }) {
  if (!alerts || alerts.status === 'not-configured') return null;

  if (alerts.status === 'unavailable') {
    return (
      <div className="train-status train-status-warning" role="status">
        <span className="status-indicator" />
        Live train status is temporarily unavailable
      </div>
    );
  }

  if (alerts.status === 'disrupted') {
    const lines = alerts.affectedSegments
      .map((segment) => segment.Line)
      .filter(Boolean)
      .join(', ');
    return (
      <div className="train-status train-status-warning" role="status">
        <span className="status-indicator" />
        LTA reports a disruption{lines ? ` on ${lines}` : ''}
      </div>
    );
  }

  return (
    <div className="train-status train-status-normal" role="status">
      <span className="status-indicator" />
      Train service looks normal
    </div>
  );
}

function DirectionsLink({
  origin,
  result,
  afterMeetup = false,
}: {
  origin: EndpointPoint;
  result: MeetingResult;
  afterMeetup?: boolean;
}) {
  return (
    <a
      className="journey-directions-link"
      href={meetingDirectionsUrl(origin, result, afterMeetup)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {afterMeetup ? 'Live directions after meetup' : 'Live directions to meetup'}
      <ArrowUpRightIcon />
      <span className="sr-only"> for {origin.participantName} (opens in a new tab)</span>
    </a>
  );
}

function RailJourneyLeg({
  journey,
  origin,
  result,
}: {
  journey: RailJourneyEstimate;
  origin?: EndpointPoint;
  result: RailResult;
}) {
  const afterMeetup = journey.endpointKind === 'end';
  const routeSteps = afterMeetup
    ? reverseRailRouteSteps(journey.routeSteps)
    : journey.routeSteps;
  const railMinutes =
    journey.initialWaitMinutes +
    journey.rideMinutes +
    journey.transferMinutes;

  if (!journey.endpointIsRailStation) {
    return (
      <div className="journey-leg">
        <div className="journey-leg-heading">
          <strong>{afterMeetup ? 'After meetup' : 'To meetup'}</strong>
          <span>{formatKm(journey.straightLineDistanceKm)}</span>
        </div>
        <small title={journey.endpointLabel}>
          {afterMeetup ? 'To' : 'From'} {journey.endpointLabel}
        </small>
        <p className="journey-route journey-route-unsupported">
          Straight-line distance only. Detailed routing for non-MRT/LRT locations
          is not supported yet.
        </p>
      </div>
    );
  }

  return (
    <div className="journey-leg">
      <div className="journey-leg-heading">
        <strong>{afterMeetup ? 'After meetup' : 'To meetup'}</strong>
        <span>{formatMinutes(journey.totalMinutes)}</span>
      </div>
      <small title={journey.endpointLabel}>
        {afterMeetup ? 'To' : 'From'} {journey.endpointLabel}
      </small>
      {routeSteps.length > 0 ? (
        <>
          <ol className="rail-route-steps">
            {routeSteps.map((step, index) => (
              <RailRouteStepRow
                key={`${step.kind}-${index}`}
                step={step}
                initialWaitMinutes={index === 0 ? journey.initialWaitMinutes : 0}
              />
            ))}
          </ol>
          <p className="rail-route-estimate">
            {formatMinutes(railMinutes)} estimated rail time, including waits and
            interchange walking.
          </p>
        </>
      ) : (
        <p className="journey-route">
          No train needed—this leg starts and ends at{' '}
          <strong>{formatStationLabel(result.station)}</strong>.
        </p>
      )}
      {origin ? <DirectionsLink origin={origin} result={result} afterMeetup={afterMeetup} /> : null}
    </div>
  );
}

function RailRouteStepRow({
  step,
  initialWaitMinutes,
}: {
  step: RailRouteStep;
  initialWaitMinutes: number;
}) {
  if (step.kind === 'transfer') {
    return (
      <li className="rail-route-step rail-route-transfer">
        <span className="rail-route-transfer-mark" aria-hidden="true">↳</span>
        <span>
          <strong>Transfer at {step.stationName}</strong>
          <small>
            Change from {step.fromLineCode} to {step.toLineCode} · about{' '}
            {formatMinutes(step.minutes)}
          </small>
        </span>
      </li>
    );
  }

  return (
    <li className="rail-route-step">
      <span className={`rail-route-line-code line-${step.lineCode.toLowerCase()}`}>
        {step.lineCode}
      </span>
      <span>
        <strong>Take {railLineLabel(step.lineCode)}</strong>
        <small>
          {step.fromStationName} to {step.toStationName} · {step.stops}{' '}
          {step.stops === 1 ? 'stop' : 'stops'} · about {formatMinutes(step.minutes)}
          {initialWaitMinutes > 0
            ? ` + ${formatMinutes(initialWaitMinutes)} initial wait`
            : ''}
        </small>
      </span>
    </li>
  );
}

function RailParticipantJourneyCard({
  summary,
  pointsById,
  result,
}: {
  summary: ParticipantJourneySummary;
  pointsById: Map<string, EndpointPoint>;
  result: RailResult;
}) {
  const routeIncomplete = [summary.outbound, summary.afterMeetup]
    .some((journey) => journey && !journey.endpointIsRailStation);

  return (
    <li className="journey-card">
      <div className="journey-card-heading">
        <div>
          <h3>{summary.participantName}</h3>
          <small>{routeIncomplete ? 'Includes unsupported location routing' : 'To meetup + after meetup'}</small>
        </div>
        <strong>{routeIncomplete ? 'Route incomplete' : `${formatMinutes(summary.totalMinutes)} total`}</strong>
      </div>
      <div className="journey-leg-list">
        {summary.outbound ? (
          <RailJourneyLeg
            journey={summary.outbound}
            origin={pointsById.get(summary.outbound.endpointId)}
            result={result}
          />
        ) : null}
        {summary.afterMeetup ? (
          <RailJourneyLeg
            journey={summary.afterMeetup}
            origin={pointsById.get(summary.afterMeetup.endpointId)}
            result={result}
          />
        ) : null}
      </div>
    </li>
  );
}

interface DistanceParticipantJourney {
  participantId: string;
  participantName: string;
  outbound?: EndpointPoint;
  afterMeetup?: EndpointPoint;
  totalKm: number;
}

function summarizeDistanceJourneys(
  points: EndpointPoint[],
  result: DistanceResult,
): DistanceParticipantJourney[] {
  const summaries = new Map<string, DistanceParticipantJourney>();
  for (const point of points) {
    const summary = summaries.get(point.participantId) || {
      participantId: point.participantId,
      participantName: point.participantName,
      totalKm: 0,
    };
    if (point.kind === 'start') summary.outbound = point;
    else summary.afterMeetup = point;
    summary.totalKm += haversineKm(point, result);
    summaries.set(point.participantId, summary);
  }
  return [...summaries.values()];
}

function DistanceJourneyLeg({ point, result }: { point: EndpointPoint; result: DistanceResult }) {
  const afterMeetup = point.kind === 'end';
  return (
    <div className="journey-leg">
      <div className="journey-leg-heading">
        <strong>{afterMeetup ? 'After meetup' : 'To meetup'}</strong>
        <span>{formatKm(haversineKm(point, result))}</span>
      </div>
      <small title={point.label}>{afterMeetup ? 'To' : 'From'} {point.label}</small>
      <p className="journey-route journey-route-unsupported">
        Straight-line distance only. Detailed routing is not supported in distance
        mode yet.
      </p>
    </div>
  );
}

function DistanceJourneyCard({
  journey,
  result,
}: {
  journey: DistanceParticipantJourney;
  result: DistanceResult;
}) {
  return (
    <li className="journey-card">
      <div className="journey-card-heading">
        <div>
          <h3>{journey.participantName}</h3>
          <small>Straight-line estimate only</small>
        </div>
        <strong>{formatKm(journey.totalKm)} total</strong>
      </div>
      <div className="journey-leg-list">
        {journey.outbound ? <DistanceJourneyLeg point={journey.outbound} result={result} /> : null}
        {journey.afterMeetup ? <DistanceJourneyLeg point={journey.afterMeetup} result={result} /> : null}
      </div>
    </li>
  );
}

export function ResultPanel({
  result,
  isCalculating,
  trainAlerts,
  points,
  onSelectStation,
}: ResultPanelProps) {
  const [shareStatus, setShareStatus] = useState('');
  const [detourTooltipOpen, setDetourTooltipOpen] = useState(false);
  const [nearbyOpen, setNearbyOpen] = useState(false);

  useEffect(() => {
    setShareStatus('');
    setDetourTooltipOpen(false);
  }, [result?.lat, result?.lng]);

  if (isCalculating) {
    return (
      <section
        id="meeting-result"
        className="result-card result-loading"
        aria-live="polite"
      >
        <div className="result-loader-orbit" aria-hidden="true">
          <span />
          <i />
        </div>
        <strong>Comparing everyone&apos;s journeys</strong>
        <p>Checking travel time, transfers and walking.</p>
      </section>
    );
  }

  if (!result) {
    return (
      <section id="meeting-result" className="result-card result-empty">
        <div className="empty-result-icon" aria-hidden="true">
          <SparkIcon />
        </div>
        <h2>Your meeting spot will appear here</h2>
        <p>Add the group&apos;s starting points, then find a fair place to meet.</p>
      </section>
    );
  }

  const selectedRailRank =
    result.mode === 'rail'
      ? Math.max(
          1,
          result.alternatives.findIndex(
            (station) => station.id === result.station.id,
          ) + 1,
        )
      : 0;
  const selectedRailLabel = result.mode === 'rail'
    ? recommendationLabel(selectedRailRank - 1)
    : '';
  const mapsUrl = meetingPointMapsUrl(result);
  const websiteUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  const isSharedPlan = new URLSearchParams(window.location.search).has('plan');
  const resultSummary =
    result.mode === 'rail'
      ? `Meet at ${result.title}. ${objectiveLabel(result.objective)}: ${objectiveMetric(result.station, result.objective)}.`
      : `Meet near ${result.title}. Average distance: ${formatKm(result.averageKm)}.`;
  // Local plans cannot be reconstructed by recipients, so share the compact Maps
  // destination directly. Shared plans retain their short plan URL and put the
  // independently useful Maps destination in the message.
  const shareUrl = isSharedPlan ? websiteUrl : mapsUrl;
  const shareText = isSharedPlan
    ? `${resultSummary}\nMeeting spot on Maps: ${mapsUrl}`
    : resultSummary;
  const pointsById = new Map(points.map((point) => [point.id, point]));
  const participantJourneys =
    result.mode === 'rail'
      ? summarizeParticipantJourneys(result.station.journeys)
      : [];
  const hasUnsupportedRailJourneys = participantJourneys.some((summary) =>
    [summary.outbound, summary.afterMeetup]
      .some((journey) => journey && !journey.endpointIsRailStation),
  );
  const distanceJourneys =
    result.mode === 'distance'
      ? summarizeDistanceJourneys(points, result)
      : [];

  async function shareResult() {
    setShareStatus('');
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Meet Where Sia',
          text: shareText,
          url: shareUrl,
        });
        setShareStatus('Shared');
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        setShareStatus('Copied');
      } else {
        setShareStatus('Open Maps to copy the link');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setShareStatus('Share failed—open Maps to copy the link');
    }
  }

  return (
    <section
      id="meeting-result"
      className="result-card result-complete"
      aria-labelledby="meeting-result-title"
    >
      <p className="sr-only" role="status">
        {result.mode === 'rail'
          ? `Selected recommendation ${selectedRailLabel}: ${result.title}`
          : `${result.objective === 'centroid' ? 'Balanced centre' : 'Shortest-overall point'}: ${result.title}`}
      </p>
      <div className="result-kicker">
        {result.mode === 'rail' ? <RailIcon /> : <SparkIcon />}
        {result.mode === 'rail'
          ? selectedRailRank === 1
            ? `Best MRT/LRT station · ${objectiveLabel(result.objective)}`
            : `Selected station · option ${selectedRailLabel}`
          : result.objective === 'centroid'
            ? 'Balanced centre'
            : 'Shortest overall'}
      </div>

      <div className="result-title-row">
        <div>
          <h2 id="meeting-result-title">
            {result.title}
          </h2>
          {result.mode === 'rail' ? (
            <>
              {result.station.hasGeographicDetour ? (
                <div className="rail-detour-warning" role="note">
                  <span>Recommended by MRT/LRT time, but another route may be better.</span>
                  <span className={`rail-detour-help ${detourTooltipOpen ? 'is-open' : ''}`}>
                    <button
                      type="button"
                      className="rail-detour-trigger"
                      aria-label="Why another route may be better"
                      aria-controls="rail-detour-explanation"
                      aria-expanded={detourTooltipOpen}
                      onClick={() => setDetourTooltipOpen((open) => !open)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setDetourTooltipOpen(false);
                      }}
                    >
                      Why?
                    </button>
                    <span
                      id="rail-detour-explanation"
                      className="rail-detour-tooltip"
                      role="note"
                      hidden={!detourTooltipOpen}
                    >
                      The MRT/LRT estimate is lowest here, but this station sits
                      well beyond the area between the locations you entered. Rail
                      lines can pull the result toward a distant interchange, while
                      a bus or a more central meeting point may be more practical.
                    </span>
                  </span>
                </div>
              ) : null}
              <div
                className="rail-line-chips"
                aria-label={`Served by ${formatRailLines(result.station.lineCodes)}`}
              >
                {result.station.lineCodes.map((code) => (
                  <span className={`rail-line-chip line-${code.toLowerCase()}`} key={code}>
                    {code}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="result-address">
              <MapPinIcon />
              <span>{result.address || (
                result.objective === 'centroid'
                  ? 'Balanced centre of the locations entered'
                  : 'Point with the lowest combined distance'
              )}</span>
            </p>
          )}
        </div>
      </div>

      {result.mode === 'rail' ? <TrainStatus alerts={trainAlerts} /> : null}

      <div className="metric-grid metric-grid-primary">
        <div className="metric-card metric-card-emphasis">
          <span>
            {result.mode === 'rail'
              ? result.objective === 'average'
                ? 'Group total'
                : result.objective === 'weighted'
                  ? 'Weighted time score'
                : result.objective === 'evenness'
                  ? 'Journey-time spread'
                  : 'Highest outing time'
              : 'Average distance'}
          </span>
          <strong>
            {result.mode === 'rail'
              ? result.objective === 'average'
                ? formatMinutes(result.totalMinutes)
                : result.objective === 'weighted'
                  ? formatMinutes(result.station.rootMeanSquareMinutes)
                : result.objective === 'evenness'
                  ? formatMinutes(result.station.standardDeviationMinutes)
                  : formatMinutes(result.maxMinutes)
              : formatKm(result.averageKm)}
          </strong>
        </div>
        <div className="metric-card">
          <span>{result.mode === 'rail'
            ? result.objective === 'average' ? 'Highest outing time' : 'Average per person'
            : 'Farthest person'}</span>
          <strong>
            {result.mode === 'rail'
              ? result.objective === 'average'
                ? formatMinutes(result.maxMinutes)
                : formatMinutes(result.averageMinutes)
              : formatKm(result.maxKm)}
          </strong>
        </div>
      </div>

      <div className="result-actions">
        <button type="button" className="share-result-button" onClick={() => void shareResult()}>
          <ShareIcon />
          {shareStatus || 'Send meeting spot'}
        </button>
        <a
          className="maps-link-button"
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open in Maps
          <ArrowUpRightIcon />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <span className="sr-only" aria-live="polite">{shareStatus}</span>
      </div>

      {result.mode === 'rail' && result.alternatives.length > 1 ? (
        <fieldset className="station-comparison">
          <legend>Compare top stations</legend>
          <p>Choose another station to update the plan in place.</p>
          <div className="station-option-list">
            {result.alternatives.map((station, index) => {
              const selected = station.id === result.station.id;
              return (
                <label
                  className={`station-option ${selected ? 'is-selected' : ''}`}
                  key={station.id}
                >
                  <input
                    type="radio"
                    name="meeting-station"
                    value={station.id}
                    checked={selected}
                    onChange={() => onSelectStation(station)}
                  />
                  <span className="alternative-rank">{recommendationLabel(index)}</span>
                  <span className="alternative-name">
                    <strong>{formatStationLabel(station)}</strong>
                    <small>
                      {station.lineCodes.join('/')} · {objectiveMetric(station, result.objective)}
                    </small>
                  </span>
                  <span className="station-option-action">
                    {selected ? 'Selected' : 'Choose'}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {result.mode === 'rail' ? (
        <p className="result-tip">Confirm the station exit or venue with your group.</p>
      ) : null}

      {result.mode === 'rail' ? (
        <details className="result-section-disclosure">
          <summary>
            <span><strong>Journey details</strong><small>Routes for {participantJourneys.length} {participantJourneys.length === 1 ? 'person' : 'people'}</small></span>
            <span className="disclosure-action">View</span>
          </summary>
          <div className="journey-summary">
            <div className="journey-summary-heading">
              <div className="section-label">Everyone&apos;s full journey</div>
              <p>
                {hasUnsupportedRailJourneys
                  ? 'Rail steps are shown for MRT/LRT endpoints; other locations use straight-line distance only.'
                  : 'Each total includes getting to the meetup and travelling onwards afterwards.'}
              </p>
            </div>
            <ul className="journey-list">
              {participantJourneys.map((summary) => (
                <RailParticipantJourneyCard
                  key={summary.participantId}
                  summary={summary}
                  pointsById={pointsById}
                  result={result}
                />
              ))}
            </ul>
          </div>
        </details>
      ) : null}

      {result.mode === 'distance' && distanceJourneys.length ? (
        <details className="result-section-disclosure">
          <summary>
            <span><strong>Journey details</strong><small>Distances for {distanceJourneys.length} {distanceJourneys.length === 1 ? 'person' : 'people'}</small></span>
            <span className="disclosure-action">View</span>
          </summary>
          <div className="journey-summary">
            <div className="journey-summary-heading">
              <div className="section-label">Distances for everyone</div>
              <p>Both legs are straight-line estimates; detailed routing is not supported yet.</p>
            </div>
            <ul className="journey-list">
              {distanceJourneys.map((journey) => (
                <DistanceJourneyCard
                  key={journey.participantId}
                  journey={journey}
                  result={result}
                />
              ))}
            </ul>
          </div>
        </details>
      ) : null}

      {result.mode === 'rail' ? (
        <details
          className="result-section-disclosure"
          onToggle={(event) => setNearbyOpen(event.currentTarget.open)}
        >
          <summary>
            <span><strong>Places nearby</strong><small>Food, coffee and things to do</small></span>
            <span className="disclosure-action">Explore</span>
          </summary>
          {nearbyOpen ? <NearbyDiscovery result={result} /> : null}
        </details>
      ) : null}

      <p className="result-method-summary">
        <strong>Why this spot?</strong>{' '}
        {result.mode === 'rail'
          ? `Compared ${result.candidateCount} connected stations for ${objectiveLabel(result.objective).toLowerCase()}, including each person’s journey to the meetup and onwards. Estimates cover walking, waits, trains and transfers, but not buses.`
          : result.objective === 'centroid'
            ? 'This point keeps the group geographically central by giving longer distances more influence.'
            : 'This point approximately minimises the combined straight-line distance to every location.'}
      </p>
    </section>
  );
}
