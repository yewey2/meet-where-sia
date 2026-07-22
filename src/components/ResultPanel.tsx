import type {
  MeetingResult,
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
  participantCount: number;
  trainAlerts: TrainAlertPayload | null;
  stationCount: number;
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

function TrainStatus({ alerts }: { alerts: TrainAlertPayload | null }) {
  if (!alerts) return null;

  if (alerts.status === 'not-configured') {
    return (
      <div className="train-status train-status-neutral">
        <span className="status-indicator" />
        LTA live alerts are optional and not configured
      </div>
    );
  }

  if (alerts.status === 'unavailable') {
    return (
      <div className="train-status train-status-warning">
        <span className="status-indicator" />
        LTA train status could not be checked
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

export function ResultPanel({
  result,
  isCalculating,
  participantCount,
  trainAlerts,
  stationCount,
}: ResultPanelProps) {
  if (isCalculating) {
    return (
      <section className="result-card result-loading" aria-live="polite">
        <div className="result-loader-orbit">
          <span />
          <i />
        </div>
        <strong>Finding the fairest meeting point</strong>
        <p>Resolving locations, comparing distances, and preparing the map.</p>
      </section>
    );
  }

  if (!result) {
    return (
      <section className="result-card result-empty">
        <div className="empty-result-icon">
          <SparkIcon />
        </div>
        <h2>Your result will appear here</h2>
        <p>
          Add each person’s start and end point, then calculate a geometric
          median or the best MRT/LRT station.
        </p>
        <div className="empty-result-stats">
          <span><strong>{participantCount}</strong> people</span>
          <span><strong>{participantCount * 2}</strong> possible endpoints</span>
          {stationCount > 0 ? (
            <span><strong>{stationCount}</strong> rail stations loaded</span>
          ) : null}
        </div>
      </section>
    );
  }

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${result.lat},${result.lng}`,
  )}`;

  return (
    <section className="result-card result-complete" aria-live="polite">
      <div className="result-kicker">
        {result.mode === 'rail' ? <RailIcon /> : <SparkIcon />}
        {result.mode === 'rail' ? 'Best rail meeting point' : 'Minimum-distance center'}
      </div>

      <div className="result-title-row">
        <div>
          <h2>{result.title}</h2>
          <p className="result-address">
            <MapPinIcon />
            <span>{result.address}</span>
          </p>
        </div>
        {result.mode === 'rail' ? (
          <span className={`network-badge network-${result.station.network.toLowerCase()}`}>
            {result.station.network}
          </span>
        ) : null}
      </div>

      <div className="metric-grid">
        <div className="metric-card">
          <span>
            {result.mode === 'rail'
              ? 'Average estimated journey'
              : 'Average endpoint distance'}
          </span>
          <strong>
            {result.mode === 'rail'
              ? formatMinutes(result.averageMinutes)
              : formatKm(result.averageKm)}
          </strong>
        </div>
        <div className="metric-card">
          <span>{result.mode === 'rail' ? 'Longest estimated journey' : 'Farthest endpoint'}</span>
          <strong>
            {result.mode === 'rail'
              ? formatMinutes(result.maxMinutes)
              : formatKm(result.maxKm)}
          </strong>
        </div>
        <div className="metric-card">
          <span>{result.mode === 'rail' ? 'Total group journey' : 'Total group distance'}</span>
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
          <div className="method-note rail-method-note">
            Compared {result.candidateCount} connected stations within{' '}
            {result.radiusKm.toFixed(1)} km of the geometric center. Times are
            local graph estimates including access walking, average waits, train
            segments, and 4-minute interchange walks—not official timetables.
          </div>
          <div className="journey-summary">
            <div className="section-label">Longest endpoint journeys</div>
            {result.station.journeys
              .slice()
              .sort((a, b) => b.totalMinutes - a.totalMinutes)
              .slice(0, 3)
              .map((journey) => (
                <div className="journey-row" key={journey.endpointId}>
                  <span>
                    <strong>{journey.endpointLabel}</strong>
                    <small>
                      via {journey.originStationName}
                      {journey.transfers
                        ? ` · ${journey.transfers} transfer${journey.transfers === 1 ? '' : 's'}`
                        : ' · direct'}
                    </small>
                  </span>
                  <strong>{formatMinutes(journey.totalMinutes)}</strong>
                </div>
              ))}
          </div>
          {result.alternatives.length > 1 ? (
            <div className="alternatives-block">
              <div className="section-label">Close alternatives</div>
              <div className="alternative-list">
                {result.alternatives.slice(1, 4).map((station, index) => (
                  <div className="alternative-row" key={station.id}>
                    <span className="alternative-rank">{index + 2}</span>
                    <span className="alternative-name">
                      <strong>{station.name}</strong>
                      <small>
                        {station.lineCodes.join('/')} · avg.{' '}
                        {formatMinutes(station.averageMinutes)} ·{' '}
                        {formatKm(station.centroidKm)} from center
                      </small>
                    </span>
                    <span>{formatMinutes(station.totalMinutes)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="method-note">
          This is the geometric median: the coordinate that approximately
          minimizes the combined straight-line distance to every start and end.
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
