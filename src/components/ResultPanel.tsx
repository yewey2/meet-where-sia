import { useEffect, useRef, useState } from 'react';
import type {
  DistanceResult,
  EndpointPoint,
  MeetingResult,
  RailJourneyEstimate,
  RailResult,
  RankedStation,
  RailObjective,
  TrainAlertPayload,
} from '../types';
import { haversineKm } from '../lib/centroid';
import { meetingDirectionsUrl, meetingPointMapsUrl } from '../lib/directions';
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
  if (objective === 'average') return 'Lowest group average';
  if (objective === 'evenness') return 'Most even journeys';
  return 'Shortest longest journey';
}

function objectiveMetric(station: RankedStation, objective: RailObjective): string {
  if (objective === 'average') return `${formatMinutes(station.averageMinutes)} average`;
  if (objective === 'evenness') return `${formatMinutes(station.standardDeviationMinutes)} spread`;
  return `${formatMinutes(station.maxMinutes)} longest total`;
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
  const railMinutes =
    journey.initialWaitMinutes +
    journey.rideMinutes +
    journey.transferMinutes;

  return (
    <div className="journey-leg">
      <div className="journey-leg-heading">
        <strong>{afterMeetup ? 'After meetup' : 'To meetup'}</strong>
        <span>{formatMinutes(journey.totalMinutes)}</span>
      </div>
      <small title={journey.endpointLabel}>
        {afterMeetup ? 'To' : 'From'} {journey.endpointLabel}
      </small>
      <p className="journey-route">
        {afterMeetup ? (
          <>
            <strong>{result.station.name} {result.station.network}</strong>
            <span className="journey-route-separator" aria-hidden="true">→</span>
            rail {formatMinutes(railMinutes)} incl. waits/interchanges
            {' · '}
            {journey.transfers
              ? `${journey.transfers} transfer${journey.transfers === 1 ? '' : 's'}`
              : 'direct'}
            <span className="journey-route-separator" aria-hidden="true">→</span>
            <strong>{journey.originStationName} station</strong>, then walk{' '}
            {formatMinutes(journey.accessWalkMinutes)}
          </>
        ) : (
          <>
            Walk {formatMinutes(journey.accessWalkMinutes)} to{' '}
            <strong>{journey.originStationName} station</strong>
            <span className="journey-route-separator" aria-hidden="true">→</span>
            rail {formatMinutes(railMinutes)} incl. waits/interchanges
            {' · '}
            {journey.transfers
              ? `${journey.transfers} transfer${journey.transfers === 1 ? '' : 's'}`
              : 'direct'}
            <span className="journey-route-separator" aria-hidden="true">→</span>
            <strong>{result.station.name} {result.station.network}</strong>
          </>
        )}
      </p>
      {origin ? <DirectionsLink origin={origin} result={result} afterMeetup={afterMeetup} /> : null}
    </div>
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
  return (
    <li className="journey-card">
      <div className="journey-card-heading">
        <div>
          <h3>{summary.participantName}</h3>
          <small>To meetup + after meetup</small>
        </div>
        <strong>{formatMinutes(summary.totalMinutes)} total</strong>
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

function DistanceJourneyCard({
  origin,
  result,
}: {
  origin: EndpointPoint;
  result: DistanceResult;
}) {
  return (
    <li className="journey-card">
      <div className="journey-card-heading">
        <div>
          <h3>{origin.participantName}</h3>
          <small title={origin.label}>From {origin.label}</small>
        </div>
        <strong>{formatKm(haversineKm(origin, result))}</strong>
      </div>
      <p className="journey-route">
        Straight-line distance to <strong>{result.title}</strong>. Open Maps for the live route.
      </p>
      <DirectionsLink origin={origin} result={result} />
    </li>
  );
}

const ROUTE_PREVIEW_COUNT = 4;

export function ResultPanel({
  result,
  isCalculating,
  trainAlerts,
  points,
  onSelectStation,
}: ResultPanelProps) {
  const [shareStatus, setShareStatus] = useState('');
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const shouldFocusHeadingRef = useRef(false);
  const selectedStationId =
    result?.mode === 'rail' ? result.station.id : '';

  useEffect(() => {
    if (!shouldFocusHeadingRef.current) return;
    shouldFocusHeadingRef.current = false;
    resultHeadingRef.current?.focus({ preventScroll: true });
  }, [selectedStationId]);

  useEffect(() => {
    setShareStatus('');
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
  const startingPoints = points.filter((point) => point.kind === 'start');
  const pointsById = new Map(points.map((point) => [point.id, point]));
  const participantJourneys =
    result.mode === 'rail'
      ? summarizeParticipantJourneys(result.station.journeys)
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
      setShareStatus('Could not share just now');
    }
  }

  function selectStation(station: RankedStation) {
    shouldFocusHeadingRef.current = true;
    onSelectStation(station);
  }

  return (
    <section
      id="meeting-result"
      className="result-card result-complete"
      aria-labelledby="meeting-result-title"
    >
      <p className="sr-only" role="status">
        {result.mode === 'rail'
          ? `Selected rank ${selectedRailRank}: ${result.title}`
          : `Fair meeting point: ${result.title}`}
      </p>
      <div className="result-kicker">
        {result.mode === 'rail' ? <RailIcon /> : <SparkIcon />}
        {result.mode === 'rail'
          ? selectedRailRank === 1
            ? `Best MRT/LRT station · ${objectiveLabel(result.objective)}`
            : `Selected station · #${selectedRailRank} overall`
          : 'Fairest by distance'}
      </div>

      <div className="result-title-row">
        <div>
          <h2 id="meeting-result-title" ref={resultHeadingRef} tabIndex={-1}>
            {result.title}
          </h2>
          {result.mode === 'rail' ? (
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
          ) : (
            <p className="result-address">
              <MapPinIcon />
              <span>{result.address || 'Approximate centre of the locations entered'}</span>
            </p>
          )}
        </div>
        {result.mode === 'rail' ? (
          <span className={`network-badge network-${result.station.network.toLowerCase()}`}>
            {result.station.network}
          </span>
        ) : null}
      </div>

      {result.mode === 'rail' ? <TrainStatus alerts={trainAlerts} /> : null}

      <div className="metric-grid metric-grid-primary">
        <div className="metric-card metric-card-emphasis">
          <span>
            {result.mode === 'rail'
              ? result.objective === 'average'
                ? 'Group average'
                : result.objective === 'evenness'
                  ? 'Journey-time spread'
                  : 'Longest full outing'
              : 'Average distance'}
          </span>
          <strong>
            {result.mode === 'rail'
              ? result.objective === 'average'
                ? formatMinutes(result.averageMinutes)
                : result.objective === 'evenness'
                  ? formatMinutes(result.station.standardDeviationMinutes)
                  : formatMinutes(result.maxMinutes)
              : formatKm(result.averageKm)}
          </strong>
        </div>
        <div className="metric-card">
          <span>{result.mode === 'rail'
            ? result.objective === 'average' ? 'Longest full outing' : 'Average per person'
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

      {result.mode === 'rail' ? (
        <div className="journey-summary">
          <div className="journey-summary-heading">
            <div className="section-label">Everyone&apos;s full trip</div>
            <p>Each total includes getting to the meetup and travelling onwards afterwards.</p>
          </div>
          <ul className="journey-list">
            {participantJourneys.slice(0, ROUTE_PREVIEW_COUNT).map((summary) => (
              <RailParticipantJourneyCard
                key={summary.participantId}
                summary={summary}
                pointsById={pointsById}
                result={result}
              />
            ))}
          </ul>
          {participantJourneys.length > ROUTE_PREVIEW_COUNT ? (
            <details className="journey-more">
              <summary>
                Show {participantJourneys.length - ROUTE_PREVIEW_COUNT} more{' '}
                {participantJourneys.length - ROUTE_PREVIEW_COUNT === 1 ? 'person' : 'people'}
              </summary>
              <ul className="journey-list">
                {participantJourneys.slice(ROUTE_PREVIEW_COUNT).map((summary) => (
                  <RailParticipantJourneyCard
                    key={summary.participantId}
                    summary={summary}
                    pointsById={pointsById}
                    result={result}
                  />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {result.mode === 'distance' && startingPoints.length ? (
        <div className="journey-summary">
          <div className="journey-summary-heading">
            <div className="section-label">Directions for everyone</div>
            <p>Open a live public-transport route from each starting point.</p>
          </div>
          <ul className="journey-list">
            {startingPoints.slice(0, ROUTE_PREVIEW_COUNT).map((origin) => (
              <DistanceJourneyCard key={origin.id} origin={origin} result={result} />
            ))}
          </ul>
          {startingPoints.length > ROUTE_PREVIEW_COUNT ? (
            <details className="journey-more">
              <summary>
                Show {startingPoints.length - ROUTE_PREVIEW_COUNT} more{' '}
                {startingPoints.length - ROUTE_PREVIEW_COUNT === 1 ? 'route' : 'routes'}
              </summary>
              <ul className="journey-list">
                {startingPoints.slice(ROUTE_PREVIEW_COUNT).map((origin) => (
                  <DistanceJourneyCard key={origin.id} origin={origin} result={result} />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {result.mode === 'rail' ? (
        <p className="result-tip">Confirm the station exit or venue with your group.</p>
      ) : null}

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
      </div>

      {result.mode === 'rail' && result.alternatives.length > 1 ? (
        <details className="result-disclosure">
          <summary>Other good stations</summary>
          <div className="alternatives-block">
            <div className="alternative-list">
              {result.alternatives
                .map((station, index) => ({ station, rank: index + 1 }))
                .filter(({ station }) => station.id !== result.station.id)
                .map(({ station, rank }) => (
                  <button
                    type="button"
                    className="alternative-row"
                    key={station.id}
                    aria-label={`Rank ${rank}: choose ${station.name} ${station.network}, ${objectiveMetric(station, result.objective)}`}
                    onClick={() => selectStation(station)}
                  >
                    <span className="alternative-rank">{rank}</span>
                    <span className="alternative-name">
                      <strong>{station.name}</strong>
                      <small>
                        {station.lineCodes.join('/')} · average total {formatMinutes(station.averageMinutes)}
                      </small>
                    </span>
                    <span className="alternative-duration">
                      {objectiveMetric(station, result.objective)}
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </details>
      ) : null}

      {result.mode === 'rail' ? (
        <details className="result-disclosure">
          <summary>Food and things nearby</summary>
          <NearbyDiscovery result={result} />
        </details>
      ) : null}

      <details className="result-disclosure">
        <summary>How this was chosen</summary>
        <p className="method-note">
          {result.mode === 'rail'
            ? `${objectiveLabel(result.objective)} was selected. Compared ${result.candidateCount} connected stations using each person's combined trip to the meetup and onwards afterwards. ${result.objective === 'average' ? 'Stations were ranked by the group’s average total time.' : result.objective === 'evenness' ? 'Stations were ranked by the variance in people’s total times, with average and longest time used to break close ties.' : 'Stations were ranked by the longest participant total, with the group average used to break close ties.'} Estimates include walking, waiting, train travel and transfers, but not buses.`
            : 'This point approximately minimises the combined straight-line distance to every location.'}
        </p>
      </details>
    </section>
  );
}
