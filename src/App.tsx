import { useEffect, useMemo, useState } from 'react';
import { ParticipantCard } from './components/ParticipantCard';
import { MapPanel } from './components/MapPanel';
import { ResultPanel } from './components/ResultPanel';
import { ThemeToggle } from './components/ThemeToggle';
import {
  MapPinIcon,
  PlusIcon,
  RailIcon,
  RouteIcon,
  SparkIcon,
  UsersIcon,
} from './components/Icons';
import { createId } from './lib/ids';
import {
  distanceMetrics,
  geometricMedian,
} from './lib/centroid';
import {
  emptyLocation,
  hasCoordinates,
} from './lib/location';
import {
  geocodeLocation,
  getGoogleMapsApiKey,
  loadGoogleMaps,
  reverseGeocode,
} from './lib/googleMaps';
import { fetchMrtStations, fetchTrainAlerts } from './lib/api';
import {
  findLocalStation,
  parseSingaporeCoordinate,
  rankStationsByTravelTime,
} from './lib/railGraph';
import type {
  EndpointPoint,
  LocationValue,
  MeetingResult,
  Mode,
  MrtStation,
  Participant,
  TrainAlertPayload,
} from './types';

const STORAGE_KEY = 'meetmiddle-sg-v1';
// Keep the legacy key so existing users retain their saved plans after rename.

function createParticipant(name = ''): Participant {
  return {
    id: createId('person'),
    name,
    sameAsStart: true,
    start: emptyLocation(),
    end: emptyLocation(),
  };
}

function isLocationValue(value: unknown): value is LocationValue {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LocationValue>;
  return typeof candidate.query === 'string' && typeof candidate.status === 'string';
}

function loadSavedState(): {
  participants: Participant[];
  mode: Mode;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        participants: [createParticipant()],
        mode: 'rail',
      };
    }
    const parsed = JSON.parse(raw) as {
      participants?: Participant[];
      mode?: Mode;
    };

    const participants = Array.isArray(parsed.participants)
      ? parsed.participants.filter(
          (participant) =>
            participant &&
            typeof participant.id === 'string' &&
            typeof participant.name === 'string' &&
            typeof participant.sameAsStart === 'boolean' &&
            isLocationValue(participant.start) &&
            isLocationValue(participant.end),
        )
      : [];

    return {
      participants: participants.length ? participants : [createParticipant()],
      mode: parsed.mode === 'distance' ? 'distance' : 'rail',
    };
  } catch {
    return {
      participants: [createParticipant()],
      mode: 'rail',
    };
  }
}

function buildEndpointPoints(participants: Participant[]): EndpointPoint[] {
  return participants.flatMap((participant, index) => {
    const participantName = participant.name.trim() || `Person ${index + 1}`;
    const points: EndpointPoint[] = [];

    if (hasCoordinates(participant.start)) {
      points.push({
        id: `${participant.id}-start`,
        participantId: participant.id,
        participantName,
        kind: 'start',
        label: participant.start.label || participant.start.query,
        lat: participant.start.lat,
        lng: participant.start.lng,
      });
    }

    const end = participant.sameAsStart ? participant.start : participant.end;
    if (hasCoordinates(end)) {
      points.push({
        id: `${participant.id}-end`,
        participantId: participant.id,
        participantName,
        kind: 'end',
        label: end.label || end.query,
        lat: end.lat,
        lng: end.lng,
      });
    }

    return points;
  });
}

class FieldResolutionError extends Error {
  participantId: string;
  field: 'start' | 'end';

  constructor(
    participantId: string,
    field: 'start' | 'end',
    message: string,
  ) {
    super(message);
    this.participantId = participantId;
    this.field = field;
  }
}

async function resolveField(
  participant: Participant,
  field: 'start' | 'end',
  displayName: string,
  stations: MrtStation[],
): Promise<LocationValue> {
  const location = participant[field];

  if (!location.query.trim()) {
    throw new FieldResolutionError(
      participant.id,
      field,
      `${displayName} needs an ${field === 'start' ? 'starting' : 'ending'} point.`,
    );
  }

  if (hasCoordinates(location) && location.status === 'resolved') {
    return location;
  }

  const localStation = findLocalStation(location.query, stations);
  if (localStation) {
    return {
      query: `${localStation.name} ${localStation.network}`,
      label: `${localStation.name} ${localStation.network}`,
      placeId: `station:${localStation.id}`,
      lat: localStation.lat,
      lng: localStation.lng,
      status: 'resolved',
    };
  }

  const coordinate = parseSingaporeCoordinate(location.query);
  if (coordinate) {
    return {
      query: location.query,
      label: `${coordinate.lat.toFixed(6)}, ${coordinate.lng.toFixed(6)}`,
      ...coordinate,
      status: 'resolved',
    };
  }

  if (!getGoogleMapsApiKey()) {
    throw new FieldResolutionError(
      participant.id,
      field,
      `${displayName}: place search is currently limited to MRT/LRT station names.`,
    );
  }

  try {
    return await geocodeLocation(location);
  } catch (error) {
    throw new FieldResolutionError(
      participant.id,
      field,
      `${displayName} ${field}: ${
        error instanceof Error ? error.message : 'location could not be resolved.'
      }`,
    );
  }
}

export default function App() {
  const saved = useMemo(loadSavedState, []);
  const [participants, setParticipants] = useState<Participant[]>(saved.participants);
  const [mode, setMode] = useState<Mode>(saved.mode);
  const [result, setResult] = useState<MeetingResult | null>(null);
  const [stations, setStations] = useState<MrtStation[]>([]);
  const [stationLoadError, setStationLoadError] = useState('');
  const [trainAlerts, setTrainAlerts] = useState<TrainAlertPayload | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const hasGoogleKey = Boolean(getGoogleMapsApiKey());
  const mapPoints = useMemo(() => buildEndpointPoints(participants), [participants]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ participants, mode }),
      );
    } catch {
      // The planner still works when storage is blocked (for example, private embeds).
    }
  }, [mode, participants]);

  useEffect(() => {
    if (!hasGoogleKey) return;
    void loadGoogleMaps().catch(() => {
      // The map and individual fields show a more specific setup error.
    });
  }, [hasGoogleKey]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchTrainAlerts(controller.signal)
      .then(setTrainAlerts)
      .catch(() => {
        setTrainAlerts({
          configured: false,
          available: false,
          status: 'unavailable',
          affectedSegments: [],
          messages: [],
        });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (mode !== 'rail' || stations.length > 0 || stationLoadError) return;
    const controller = new AbortController();

    void fetchMrtStations(controller.signal)
      .then((response) => {
        setStations(response.stations);
        setStationLoadError('');
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setStationLoadError(
          error instanceof Error
            ? error.message
            : 'The official rail station list could not be loaded.',
        );
      });

    return () => controller.abort();
  }, [mode, stationLoadError, stations.length]);

  useEffect(() => {
    if (!result || !window.matchMedia('(max-width: 820px)').matches) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById('meeting-result');
      if (!target) return;
      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      if (reduceMotion) return;
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [result]);

  function updateParticipant(next: Participant) {
    setParticipants((current) =>
      current.map((participant) =>
        participant.id === next.id ? next : participant,
      ),
    );
    setResult(null);
    setGlobalError('');
  }

  function addParticipant() {
    setParticipants((current) => [
      ...current,
      createParticipant(`Person ${current.length + 1}`),
    ]);
    setResult(null);
  }

  function loadExample() {
    setParticipants([
      {
        id: createId('person'),
        name: 'Aisha',
        sameAsStart: true,
        start: emptyLocation('Aljunied MRT'),
        end: emptyLocation('Aljunied MRT'),
      },
      {
        id: createId('person'),
        name: 'Ben',
        sameAsStart: true,
        start: emptyLocation('Eunos MRT'),
        end: emptyLocation('Eunos MRT'),
      },
    ]);
    setMode('rail');
    setResult(null);
    setGlobalError('');
  }

  function resetPlanner() {
    setParticipants([createParticipant()]);
    setMode('rail');
    setResult(null);
    setGlobalError('');
  }

  async function ensureStations(): Promise<MrtStation[]> {
    if (stations.length) return stations;
    const response = await fetchMrtStations();
    setStations(response.stations);
    setStationLoadError('');
    return response.stations;
  }

  async function calculateMeetingPoint() {
    setGlobalError('');
    setIsCalculating(true);
    setResult(null);

    setParticipants((current) =>
      current.map((participant) => ({
        ...participant,
        start:
          participant.start.query && participant.start.status !== 'resolved'
            ? { ...participant.start, status: 'resolving' }
            : participant.start,
        end:
          !participant.sameAsStart &&
          participant.end.query &&
          participant.end.status !== 'resolved'
            ? { ...participant.end, status: 'resolving' }
            : participant.sameAsStart
              ? { ...participant.start }
              : participant.end,
      })),
    );

    try {
      const availableStations =
        stations.length > 0
          ? stations
          : mode === 'rail' || !hasGoogleKey
            ? await ensureStations()
            : [];
      const resolvedParticipants: Participant[] = [];

      for (let index = 0; index < participants.length; index += 1) {
        const participant = participants[index];
        const displayName = participant.name.trim() || `Person ${index + 1}`;
        const start = await resolveField(
          participant,
          'start',
          displayName,
          availableStations,
        );
        const end = participant.sameAsStart
          ? { ...start }
          : await resolveField(
              participant,
              'end',
              displayName,
              availableStations,
            );

        resolvedParticipants.push({ ...participant, start, end });
      }

      const points = buildEndpointPoints(resolvedParticipants);
      if (points.length === 0) {
        throw new Error('Add at least one valid starting point.');
      }

      setParticipants(resolvedParticipants);

      if (mode === 'distance') {
        const center = geometricMedian(points);
        const metrics = distanceMetrics(center, points);
        const address = await reverseGeocode(center);
        const title = address.split(',')[0]?.trim() || 'Fair distance centre';

        setResult({
          mode: 'distance',
          ...center,
          ...metrics,
          title,
          address,
        });
      } else {
        const center = geometricMedian(points);
        const ranked = rankStationsByTravelTime(
          availableStations,
          points,
          center,
        );
        const selected = ranked[0];

        if (!selected) {
          throw new Error('No connected MRT/LRT station could be compared.');
        }

        setResult({
          mode: 'rail',
          lat: selected.lat,
          lng: selected.lng,
          title: `${selected.name} ${selected.network}`,
          address: '',
          station: selected,
          alternatives: ranked.slice(0, 4),
          candidateCount: ranked.length,
          totalKm: selected.totalKm,
          averageKm: selected.averageKm,
          maxKm: selected.maxKm,
          totalMinutes: selected.totalMinutes,
          averageMinutes: selected.averageMinutes,
          maxMinutes: selected.maxMinutes,
        });

        void fetchTrainAlerts().then(setTrainAlerts).catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof FieldResolutionError) {
        setParticipants((current) =>
          current.map((participant) => {
            if (participant.id !== error.participantId) return participant;
            return {
              ...participant,
              [error.field]: {
                ...participant[error.field],
                status: 'error',
              },
            };
          }),
        );
      }

      setGlobalError(
        error instanceof Error
          ? error.message
          : 'The meeting point could not be calculated.',
      );
    } finally {
      setIsCalculating(false);
    }
  }

  const modeDescription =
    mode === 'distance'
      ? 'Balances straight-line distance for the whole group.'
      : 'Balances everyone’s estimated MRT/LRT journey time.';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><MapPinIcon /></div>
          <div>
            <strong>Meet Where Sia</strong>
            <span>Singapore meetup planner</span>
          </div>
        </div>
        <div className="topbar-actions">
          <ThemeToggle />
        </div>
      </header>

      <main className="planner-layout">
        <section className="planner-panel" aria-labelledby="planner-title">
          <div className="planner-intro">
            <div className="eyebrow"><SparkIcon /> Made for Singapore</div>
            <h1 id="planner-title">Where should we meet?</h1>
            <p>Add where everyone is coming from. We’ll find a fair, practical spot.</p>
          </div>

          <div className="people-section">
            <div className="people-header">
              <div>
                <div className="section-label"><UsersIcon /> Who’s meeting?</div>
                <p>{participants.length} {participants.length === 1 ? 'person' : 'people'} added</p>
              </div>
              <button type="button" className="text-button" onClick={loadExample}>
                Use sample
              </button>
            </div>

            <div className="participant-list">
              {participants.map((participant, index) => (
                <ParticipantCard
                  key={participant.id}
                  participant={participant}
                  index={index}
                  stations={stations}
                  canRemove={participants.length > 1}
                  onChange={updateParticipant}
                  onRemove={() => {
                    setParticipants((current) =>
                      current.filter((item) => item.id !== participant.id),
                    );
                    setResult(null);
                    setGlobalError('');
                  }}
                />
              ))}
            </div>

            <button type="button" className="add-person-button" onClick={addParticipant}>
              <PlusIcon /> Add a friend
            </button>
          </div>

          <details className="mode-disclosure">
            <summary>
              <span className="mode-summary-copy">
                {mode === 'rail' ? <RailIcon /> : <RouteIcon />}
                <span>
                  <strong>{mode === 'rail' ? 'Fair by MRT/LRT time' : 'Fair by distance'}</strong>
                  <small>{modeDescription}</small>
                </span>
              </span>
              <span className="mode-change-label">Change</span>
            </summary>
            <div className="mode-section">
              <fieldset className="mode-switch">
                <legend className="sr-only">How should the meeting spot be chosen?</legend>
                <label className={mode === 'rail' ? 'is-selected' : ''}>
                  <input
                    type="radio"
                    name="meeting-mode"
                    value="rail"
                    checked={mode === 'rail'}
                    onChange={() => {
                      setMode('rail');
                      setResult(null);
                      setGlobalError('');
                    }}
                  />
                  <RailIcon />
                  <span><strong>By MRT/LRT</strong><small>Balances travel time</small></span>
                </label>
                <label className={mode === 'distance' ? 'is-selected' : ''}>
                  <input
                    type="radio"
                    name="meeting-mode"
                    value="distance"
                    checked={mode === 'distance'}
                    onChange={() => {
                      setMode('distance');
                      setResult(null);
                      setGlobalError('');
                    }}
                  />
                  <RouteIcon />
                  <span><strong>By distance</strong><small>Balances kilometres</small></span>
                </label>
              </fieldset>
              {mode === 'rail' && stationLoadError ? (
                <p className="inline-warning">Rail data is unavailable right now. {stationLoadError}</p>
              ) : null}
            </div>
          </details>

          {globalError ? (
            <div className="global-error" role="alert">
              <strong>Check the highlighted location</strong>
              <span>{globalError}</span>
            </div>
          ) : null}

          <button
            type="button"
            className="calculate-button"
            disabled={isCalculating}
            onClick={() => void calculateMeetingPoint()}
          >
            {isCalculating ? <span className="button-spinner" /> : <SparkIcon />}
            {isCalculating
              ? 'Comparing journeys…'
              : 'Find our meeting spot'}
          </button>

          {result ? (
            <a className="jump-to-result" href="#meeting-result">
              View recommendation <span aria-hidden="true">↓</span>
            </a>
          ) : null}

          <div className="planner-footnote">
            <span>Plan saved on this device</span>
            <nav aria-label="Planner and legal links">
              <a href="/privacy.html">Privacy</a>
              <a href="/terms.html">Terms</a>
              <button type="button" onClick={resetPlanner}>Clear plan</button>
            </nav>
          </div>
        </section>

        <aside
          className={`results-column ${
            !result && !isCalculating ? 'is-empty' : ''
          }`}
        >
          <ResultPanel
            result={result}
            isCalculating={isCalculating}
            trainAlerts={trainAlerts}
          />
          {mapPoints.length > 0 || result ? (
            <MapPanel points={mapPoints} result={result} />
          ) : null}
        </aside>
      </main>
    </div>
  );
}
