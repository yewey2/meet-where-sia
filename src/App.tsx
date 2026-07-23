import { useEffect, useMemo, useState } from 'react';
import { ParticipantCard } from './components/ParticipantCard';
import { MapPanel } from './components/MapPanel';
import { ResultPanel } from './components/ResultPanel';
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
const DEFAULT_RADIUS_KM = 4;

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
  radiusKm: number;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        participants: [createParticipant()],
        mode: 'rail',
        radiusKm: DEFAULT_RADIUS_KM,
      };
    }
    const parsed = JSON.parse(raw) as {
      participants?: Participant[];
      mode?: Mode;
      radiusKm?: number;
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
      radiusKm:
        typeof parsed.radiusKm === 'number' &&
        parsed.radiusKm >= 1 &&
        parsed.radiusKm <= 12
          ? parsed.radiusKm
          : DEFAULT_RADIUS_KM,
    };
  } catch {
    return {
      participants: [createParticipant()],
      mode: 'rail',
      radiusKm: DEFAULT_RADIUS_KM,
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
      `${displayName} ${field}: enter an exact MRT/LRT station name or Singapore latitude, longitude. A Google key is only needed for addresses and postal codes.`,
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
  const [radiusKm, setRadiusKm] = useState(saved.radiusKm);
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
        JSON.stringify({ participants, mode, radiusKm }),
      );
    } catch {
      // The planner still works when storage is blocked (for example, private embeds).
    }
  }, [mode, participants, radiusKm]);

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
        name: 'John Doe',
        sameAsStart: true,
        start: emptyLocation('Senja LRT'),
        end: emptyLocation('Senja LRT'),
      },
      {
        id: createId('person'),
        name: 'Aisha Tan',
        sameAsStart: false,
        start: emptyLocation('Orchard MRT'),
        end: emptyLocation('Paya Lebar MRT'),
      },
    ]);
    setMode('rail');
    setRadiusKm(DEFAULT_RADIUS_KM);
    setResult(null);
    setGlobalError('');
  }

  function resetPlanner() {
    setParticipants([createParticipant()]);
    setMode('rail');
    setRadiusKm(DEFAULT_RADIUS_KM);
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
        throw new Error('Add at least one valid start and end point.');
      }

      setParticipants(resolvedParticipants);

      if (mode === 'distance') {
        const center = geometricMedian(points);
        const metrics = distanceMetrics(center, points);
        const address = await reverseGeocode(center);
        const title = address.split(',')[0]?.trim() || 'Fair distance center';

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
          radiusKm,
        );
        const selected = ranked[0];

        if (!selected) {
          throw new Error(
            `No connected MRT/LRT station is within ${radiusKm} km of the fair-distance center. Increase the meeting radius.`,
          );
        }

        const address = await reverseGeocode(selected);
        setResult({
          mode: 'rail',
          lat: selected.lat,
          lng: selected.lng,
          title: `${selected.name} ${selected.network}`,
          address,
          station: selected,
          alternatives: ranked.slice(0, 4),
          center,
          radiusKm,
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
      ? 'Minimizes the combined straight-line kilometres across every start and end point.'
      : 'Uses a local rail graph to minimize estimated group journey time within the chosen radius.';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><MapPinIcon /></div>
          <div>
            <strong>MeetMiddle</strong>
            <span>Singapore</span>
          </div>
          <span className="version-badge">V1</span>
        </div>

        <div className="api-statuses">
          <span className={`api-pill ${hasGoogleKey ? 'is-ready' : 'is-optional'}`}>
            <i /> Google {hasGoogleKey ? 'ready' : 'optional'}
          </span>
          <span
            className={`api-pill ${
              trainAlerts?.configured ? 'is-ready' : 'is-optional'
            }`}
          >
            <i /> LTA {trainAlerts?.configured ? 'connected' : 'optional'}
          </span>
        </div>
      </header>

      <main className="planner-layout">
        <section className="planner-panel">
          <div className="planner-intro">
            <div className="eyebrow"><SparkIcon /> Group meeting planner</div>
            <h1>Find the fairest place to meet.</h1>
            <p>
              Enter every person’s start and end point. The app resolves each
              Singapore location, then finds one practical center for the group.
            </p>
          </div>

          {!hasGoogleKey ? (
            <div className="setup-banner">
              <strong>Works without a Google key</strong>
              <span>
                The OpenStreetMap map and exact MRT/LRT station names work
                without a key. Add one only for address and postal-code search.
              </span>
            </div>
          ) : null}

          <div className="mode-section">
            <div className="section-label">How should the center be chosen?</div>
            <div className="mode-switch" role="radiogroup" aria-label="Meeting point mode">
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'rail'}
                className={mode === 'rail' ? 'is-selected' : ''}
                onClick={() => {
                  setMode('rail');
                  setResult(null);
                  setGlobalError('');
                }}
              >
                <RailIcon />
                <span><strong>MRT/LRT travel time</strong><small>Default · local rail graph</small></span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'distance'}
                className={mode === 'distance' ? 'is-selected' : ''}
                onClick={() => {
                  setMode('distance');
                  setResult(null);
                  setGlobalError('');
                }}
              >
                <RouteIcon />
                <span><strong>Pure distance</strong><small>Geometric median</small></span>
              </button>
            </div>
            <p className="mode-description">{modeDescription}</p>
            {mode === 'rail' ? (
              <div className="radius-control">
                <div className="radius-label-row">
                  <label htmlFor="meeting-radius">Meeting radius</label>
                  <output htmlFor="meeting-radius">{radiusKm.toFixed(1)} km</output>
                </div>
                <input
                  id="meeting-radius"
                  type="range"
                  min="1"
                  max="12"
                  step="0.5"
                  value={radiusKm}
                  onChange={(event) => {
                    setRadiusKm(Number(event.target.value));
                    setResult(null);
                    setGlobalError('');
                  }}
                />
                <p>
                  Only stations inside this radius from the geometric center are
                  compared by estimated train, transfer, waiting, and access-walk time.
                </p>
              </div>
            ) : null}
            {mode === 'rail' && stationLoadError ? (
              <p className="inline-warning">Station data: {stationLoadError}</p>
            ) : null}
          </div>

          <div className="people-section">
            <div className="people-header">
              <div>
                <div className="section-label"><UsersIcon /> People and routes</div>
                <p>{participants.length} {participants.length === 1 ? 'person' : 'people'} in this plan</p>
              </div>
              <button type="button" className="text-button" onClick={loadExample}>
                Load example
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
              <PlusIcon /> Add another person
            </button>
          </div>

          {globalError ? (
            <div className="global-error" role="alert">
              <strong>Check the route details</strong>
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
              ? 'Calculating…'
              : mode === 'distance'
                ? 'Find the distance center'
                : 'Find the best MRT/LRT'}
          </button>

          <div className="planner-footnote">
            <span>V1 saves the plan only in this browser.</span>
            <button type="button" onClick={resetPlanner}>Clear plan</button>
          </div>
          <p className="v2-note">
            Shared editable links, contributor emails, and multi-user changes are
            intentionally reserved for V2.
          </p>
        </section>

        <aside className="results-column">
          <MapPanel points={mapPoints} result={result} />
          <ResultPanel
            result={result}
            isCalculating={isCalculating}
            participantCount={participants.length}
            trainAlerts={trainAlerts}
            stationCount={stations.length}
          />
        </aside>
      </main>
    </div>
  );
}
