import type {
  MeetingResult,
  RailJourneyEstimate,
  TrainAlertPayload,
} from '../types';
import {
  ArrowUpRightIcon,
  MapPinIcon,
  RailIcon,
  SparkIcon,
} from './Icons';

interface ResultPanelProps {
  result: MeetingResult | null;
  isCalculating: boolean;
  trainAlerts: TrainAlertPayload | null;
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

const RAIL_LINE_NAMES: Record<string, string> = {
  NS: 'North–South Line',
  EW: 'East–West Line',
  CG: 'Changi Airport Branch',
  NE: 'North East Line',
  CC: 'Circle Line',
  DT: 'Downtown Line',
  TE: 'Thomson–East Coast Line',
  BP: 'Bukit Panjang LRT',
  SE: 'Sengkang East LRT',
  SW: 'Sengkang West LRT',
  PE: 'Punggol East LRT',
  PW: 'Punggol West LRT',
};

function formatRailLines(lineCodes: string[]): string {
  return lineCodes.map((code) => RAIL_LINE_NAMES[code] || code).join(' · ');
}

function TrainStatus({ alerts }: { alerts: TrainAlertPayload | null }) {
  if (!alerts || alerts.status === 'not-configured') return null;

  if (alerts.status === 'unavailable') {
    return (
      <div className="train-status train-status-warning">
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
      <div className="train-status train-status-warning">
        <span className="status-indicator" />
        LTA reports a disruption{lines ? ` on ${lines}` : ''}
      </div>
    );
  }

  return (
    <div className="train-status train-status-normal">
      <span className="status-indicator" />
      LTA reports normal or minor-delay service
    </div>
  );
}

function longestJourneyPerParticipant(
  journeys: RailJourneyEstimate[],
): RailJourneyEstimate[] {
  const longest = new Map<string, RailJourneyEstimate>();
  for (const journey of journeys) {
    const current = longest.get(journey.participantId);
    if (!current || journey.totalMinutes > current.totalMinutes) {
      longest.set(journey.participantId, journey);
    }
  }
  return [...longest.values()].sort(
    (a, b) => b.totalMinutes - a.totalMinutes,
  );
}

export function ResultPanel({
  result,
  isCalculating,
  trainAlerts,
}: ResultPanelProps) {
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
        <strong>Finding the fairest meeting point</strong>
        <p>Resolving locations, comparing journeys and updating the map.</p>
      </section>
    );
  }

  if (!result) {
    return (
      <section id="meeting-result" className="result-card result-empty">
        <div className="empty-result-icon" aria-hidden="true">
          <SparkIcon />
        </div>
        <h2>Your result will appear here</h2>
        <p>
          Add everyone’s location, then find the fairest MRT/LRT station or
          distance centre for the group.
        </p>
      </section>
    );
  }

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${result.lat},${result.lng}`,
  )}`;

  return (
    <section
      id="meeting-result"
      className="result-card result-complete"
      aria-live="polite"
    >
      <div className="result-kicker">
        {result.mode === 'rail' ? <RailIcon /> : <SparkIcon />}
        {result.mode === 'rail' ? 'Best rail meeting point' : 'Fairest distance centre'}
      </div>

      <div className="result-title-row">
        <div>
          <h2>{result.title}</h2>
          <p className="result-address">
            {result.mode === 'rail' ? <RailIcon /> : <MapPinIcon />}
            <span>
              {result.mode === 'rail'
                ? formatRailLines(result.station.lineCodes)
                : result.address || 'Approximate centre based on the locations entered'}
            </span>
          </p>
        </div>
        {result.mode === 'rail' ? (
          <span className={`network-badge network-${result.station.network.toLowerCase()}`}>
            {result.station.network}
          </span>
        ) : null}
      </div>

      {result.mode === 'rail' && result.alternatives.length > 1 ? (
        <div className="alternatives-block alternatives-primary">
          <div className="section-label">Next-best alternatives</div>
          <div className="alternative-list">
            {result.alternatives.slice(1, 4).map((station, index) => (
              <div className="alternative-row" key={station.id}>
                <span className="alternative-rank">{index + 2}</span>
                <span className="alternative-name">
                  <strong>{station.name}</strong>
                  <small>
                    {station.lineCodes.join('/')} · avg.{' '}
                    {formatMinutes(station.averageMinutes)}
                  </small>
                </span>
                <span>{formatMinutes(station.maxMinutes)} longest</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="metric-grid">
        <div className="metric-card">
          <span>
            {result.mode === 'rail'
              ? 'Longest estimated journey'
              : 'Average endpoint distance'}
          </span>
          <strong>
            {result.mode === 'rail'
              ? formatMinutes(result.maxMinutes)
              : formatKm(result.averageKm)}
          </strong>
        </div>
        <div className="metric-card">
          <span>{result.mode === 'rail' ? 'Group average' : 'Farthest endpoint'}</span>
          <strong>
            {result.mode === 'rail'
              ? formatMinutes(result.averageMinutes)
              : formatKm(result.maxKm)}
          </strong>
        </div>
        <div className="metric-card">
          <span>{result.mode === 'rail' ? 'Combined journey time' : 'Combined distance'}</span>
          <strong>
            {result.mode === 'rail'
              ? formatMinutes(result.totalMinutes)
              : formatKm(result.totalKm)}
          </strong>
        </div>
      </div>

      {result.mode === 'rail' ? (
        <>
          <TrainStatus alerts={trainAlerts} />
          <div className="journey-summary">
            <div className="section-label">Longest journey by person</div>
            {longestJourneyPerParticipant(result.station.journeys)
              .slice(0, 4)
              .map((journey) => (
                <div className="journey-row" key={journey.endpointId}>
                  <span>
                    <strong>{journey.participantName}</strong>
                    <small title={journey.endpointLabel}>
                      {journey.endpointKind === 'start' ? 'Start' : 'End'}: {journey.endpointLabel}
                      {' · '}via {journey.originStationName}
                      {journey.transfers
                        ? ` · ${journey.transfers} transfer${journey.transfers === 1 ? '' : 's'}`
                        : ' · direct'}
                    </small>
                  </span>
                  <strong>{formatMinutes(journey.totalMinutes)}</strong>
                </div>
              ))}
          </div>
          <div className="method-note rail-method-note">
            Compared all {result.candidateCount} connected stations for fairness,
            then used the group average as a tie-breaker. Times include estimated
            walking, waiting, train travel and transfers; confirm your trip before
            leaving.
          </div>
        </>
      ) : (
        <div className="method-note">
          This is the geometric median: the point that approximately minimizes
          the combined straight-line distance to every location.
        </div>
      )}

      <a
        className="maps-link-button"
        href={mapsUrl}
        target="_blank"
        rel="noreferrer"
      >
        Open in Google Maps
        <ArrowUpRightIcon />
      </a>
    </section>
  );
}
