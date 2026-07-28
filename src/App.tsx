import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ParticipantCard } from './components/ParticipantCard';
import { MapPanel } from './components/MapPanel';
import { ResultPanel } from './components/ResultPanel';
import { ThemeToggle } from './components/ThemeToggle';
import { SharedPlanPanel } from './components/SharedPlanPanel';
import {
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
import { useSharedPlan } from './lib/useSharedPlan';
import type { SharedPlan } from './lib/groupPlans';
import type {
  EndpointPoint,
  LocationValue,
  MeetingResult,
  Mode,
  MrtStation,
  Participant,
  RailObjective,
  RankedStation,
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
  railObjective: RailObjective;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        participants: [createParticipant()],
        mode: 'rail',
        railObjective: 'minimax',
      };
    }
    const parsed = JSON.parse(raw) as {
      participants?: Participant[];
      mode?: Mode;
      railObjective?: RailObjective;
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
      railObjective:
        parsed.railObjective === 'average' || parsed.railObjective === 'evenness'
          ? parsed.railObjective
          : 'minimax',
    };
  } catch {
    return {
      participants: [createParticipant()],
      mode: 'rail',
      railObjective: 'minimax',
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
  const [railObjective, setRailObjective] = useState<RailObjective>(saved.railObjective);
  const [result, setResult] = useState<MeetingResult | null>(null);
  const [stations, setStations] = useState<MrtStation[]>([]);
  const [stationLoadError, setStationLoadError] = useState('');
  const [trainAlerts, setTrainAlerts] = useState<TrainAlertPayload | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const autoScrolledResultRef = useRef<MeetingResult | null>(null);
  const planRevisionRef = useRef(0);
  const hasGoogleKey = Boolean(getGoogleMapsApiKey());
  const mapPoints = useMemo(() => buildEndpointPoints(participants), [participants]);

  const applyRemotePlan = useCallback((plan: SharedPlan) => {
    planRevisionRef.current += 1;
    setParticipants(plan.participants);
    setMode(plan.mode);
    setRailObjective(plan.railObjective);
    setResult(null);
    setGlobalError('');
  }, []);

  const shared = useSharedPlan({
    participants,
    mode,
    railObjective,
    onRemotePlan: applyRemotePlan,
  });
  const hasSharedLink = Boolean(shared.requestedPlanId);
  const currentSharedMember = shared.plan?.currentMember ?? null;
  const sharedOwner = currentSharedMember?.role === 'owner';
  const canManagePlan = !hasSharedLink || sharedOwner;
  const canEditParticipant = useCallback((participantId: string) => {
    if (!hasSharedLink) return true;
    if (!currentSharedMember) return false;
    return currentSharedMember.role === 'owner' || currentSharedMember.participantId === participantId;
  }, [currentSharedMember, hasSharedLink]);


  useEffect(() => {
    if (hasSharedLink) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ participants, mode, railObjective }),
      );
    } catch {
      // The planner still works when storage is blocked (for example, private embeds).
    }
  }, [hasSharedLink, mode, participants, railObjective]);

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
    if (!result) {
      autoScrolledResultRef.current = null;
      return;
    }
    if (
      isCalculating ||
      autoScrolledResultRef.current ||
      !window.matchMedia('(max-width: 960px)').matches
    ) return;

    autoScrolledResultRef.current = result;
    let settledFrame = 0;
    const frame = window.requestAnimationFrame(() => {
      settledFrame = window.requestAnimationFrame(() => {
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
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(settledFrame);
    };
  }, [isCalculating, result]);

  function updateParticipant(next: Participant) {
    if (isCalculating) return;
    if (!canEditParticipant(next.id)) return;
    planRevisionRef.current += 1;
    setParticipants((current) =>
      current.map((participant) =>
        participant.id === next.id ? next : participant,
      ),
    );
    shared.scheduleParticipant(next);
    setResult(null);
    setGlobalError('');
  }

  function addParticipant() {
    if (isCalculating) return;
    if (!canManagePlan) return;
    planRevisionRef.current += 1;
    const next = createParticipant();
    setParticipants((current) => [...current, next]);
    void shared.addParticipant(next).catch(() => undefined);
    setResult(null);
  }

  function loadExample() {
    if (isCalculating) return;
    if (shared.plan && !window.confirm('Replace every route and remove contributor logins from this shared plan?')) return;

    if (!canManagePlan) return;
    planRevisionRef.current += 1;
    const nextParticipants = [
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
    ];
    setParticipants(nextParticipants);
    setMode('rail');
    setRailObjective('minimax');
    void shared.resetPlan(nextParticipants, 'rail', 'minimax').catch(() => undefined);
    setResult(null);
    setGlobalError('');
  }

  function resetPlanner() {
    if (isCalculating) return;
    if (shared.plan && !window.confirm('Clear every route and remove contributor logins from this shared plan?')) return;

    if (!canManagePlan) return;
    planRevisionRef.current += 1;
    const nextParticipants = [createParticipant()];
    setParticipants(nextParticipants);
    setMode('rail');
    setRailObjective('minimax');
    void shared.resetPlan(nextParticipants, 'rail', 'minimax').catch(() => undefined);
    setResult(null);
    setGlobalError('');
  }

  const selectMeetingStation = useCallback((station: RankedStation) => {
    setResult((current) => {
      if (!current || current.mode !== 'rail' || current.station.id === station.id) {
        return current;
      }

      return {
        ...current,
        lat: station.lat,
        lng: station.lng,
        title: `${station.name} ${station.network}`,
        station,
        totalKm: station.totalKm,
        averageKm: station.averageKm,
        maxKm: station.maxKm,
        totalMinutes: station.totalMinutes,
        averageMinutes: station.averageMinutes,
        maxMinutes: station.maxMinutes,
      };
    });
  }, []);
  async function ensureStations(): Promise<MrtStation[]> {
    if (stations.length) return stations;
    const response = await fetchMrtStations();
    setStations(response.stations);
    setStationLoadError('');
    return response.stations;
  }

  async function calculateMeetingPoint() {
    if (isCalculating) return;
    const calculationRevision = planRevisionRef.current;
    const calculationParticipants = participants;
    const calculationMode = mode;
    const calculationRailObjective = railObjective;
    const calculationIsCurrent = () =>
      planRevisionRef.current === calculationRevision;

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
          : calculationMode === 'rail' || !hasGoogleKey
            ? await ensureStations()
            : [];
      if (!calculationIsCurrent()) return;
      const resolvedParticipants: Participant[] = [];

      for (let index = 0; index < calculationParticipants.length; index += 1) {
        const participant = calculationParticipants[index];
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

        if (!calculationIsCurrent()) return;

        resolvedParticipants.push({ ...participant, start, end });
      }

      const points = buildEndpointPoints(resolvedParticipants);
      if (points.length === 0) {
        throw new Error('Add at least one valid starting point.');
      }

      let nextResult: MeetingResult;
      if (calculationMode === 'distance') {
        const center = geometricMedian(points);
        const metrics = distanceMetrics(center, points);
        const address = await reverseGeocode(center);
        const title = address.split(',')[0]?.trim() || 'Fair distance centre';

        nextResult = {
          mode: 'distance',
          ...center,
          ...metrics,
          title,
          address,
        };
      } else {
        const center = geometricMedian(points);
        const ranked = rankStationsByTravelTime(
          availableStations,
          points,
          center,
          calculationRailObjective,
        );
        const selected = ranked[0];

        if (!selected) {
          throw new Error('No connected MRT/LRT station could be compared.');
        }

        nextResult = {
          mode: 'rail',
          objective: calculationRailObjective,
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
        };

        void fetchTrainAlerts().then(setTrainAlerts).catch(() => undefined);
      }

      if (!calculationIsCurrent()) return;
      setParticipants(resolvedParticipants);
      setResult(nextResult);
      if (shared.plan) {
        resolvedParticipants
          .filter((participant) => canEditParticipant(participant.id))
          .forEach(shared.scheduleParticipant);
      }
    } catch (error) {
      if (!calculationIsCurrent()) return;
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
      : railObjective === 'average'
        ? 'Finds the lowest average full journey time for the group.'
        : railObjective === 'evenness'
          ? 'Finds the most even full journey times across the group.'
          : 'Keeps the longest full journey as short as possible.';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><img src="/icon-192.png" alt="" /></div>
          <div>
            <strong>Meet Where Sia</strong>
            <span>Singapore meetup planner</span>
          </div>
        </div>
        <div className="topbar-actions">
          <SharedPlanPanel
            plan={shared.plan}
            requestedPlanId={shared.requestedPlanId}
            claimToken={shared.claimToken}
            busy={shared.busy}
            syncLabel={shared.syncLabel}
            error={shared.error}
            onCreate={shared.create}
            onLogin={shared.login}
            onJoin={shared.join}
            onClaim={shared.claim}
            onOwnerLogin={shared.ownerLogin}
            onRename={async (title) => { await shared.rename(title); }}
            onSetJoining={async (enabled) => { await shared.setJoining(enabled); }}
            onCreateInvite={shared.createInvite}
            onResetMember={async (memberId, password) => { await shared.resetMember(memberId, password); }}
            onRemoveMember={async (member) => { await shared.removeMember(member.id); }}
            onChangePassword={async (password) => { await shared.changePassword(password); }}
            onLogout={shared.logout}
            onDelete={async () => {
              planRevisionRef.current += 1;
              await shared.deletePlan();
              const localPlan = loadSavedState();
              setParticipants(localPlan.participants);
              setMode(localPlan.mode);
              setRailObjective(localPlan.railObjective);
              setResult(null);
              setGlobalError('');
            }}
            onLeave={async () => {
              planRevisionRef.current += 1;
              await shared.leavePlan();
              const localPlan = loadSavedState();
              setParticipants(localPlan.participants);
              setMode(localPlan.mode);
              setRailObjective(localPlan.railObjective);
              setResult(null);
              setGlobalError('');
            }}
            onDismissError={shared.dismissError}
          />
          <ThemeToggle />
        </div>
      </header>

      <div id="group-dialog-root" />

      <main className="planner-layout">
        <section className="planner-panel" aria-labelledby="planner-title">
          <div className="planner-intro">
            <div className="eyebrow"><SparkIcon /> Made for Singapore</div>
            <h1 id="planner-title">Meet Where Sia?</h1>
            <p>Add where everyone is coming from. We’ll find a fair, practical spot.</p>
          </div>

          <div className="people-section">
            <div className="people-header">
              <div>
                <div className="section-label"><UsersIcon /> Who’s meeting?</div>
                <p>{participants.length} {participants.length === 1 ? 'person' : 'people'} added</p>
              </div>
              <button type="button" className="text-button" disabled={isCalculating || !canManagePlan} onClick={loadExample}>
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
                  canRemove={canManagePlan && participants.length > 1}
                  canEditName={!isCalculating && canManagePlan}
                  readOnly={isCalculating || !canEditParticipant(participant.id)}
                  onChange={updateParticipant}
                  onRemove={() => {
                    setParticipants((current) =>
                      current.filter((item) => item.id !== participant.id),
                    );
                    void shared.removeParticipant(participant.id).catch(() => undefined);
                    setResult(null);
                    setGlobalError('');
                  }}
                />
              ))}
            </div>

            {canManagePlan ? (
              <button type="button" className="add-person-button" disabled={isCalculating} onClick={addParticipant}>
                <PlusIcon /> Add a friend
              </button>
            ) : null}
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
              <span className="mode-change-label">{canManagePlan ? 'Change' : 'View'}</span>
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
                    disabled={isCalculating || !canManagePlan}
                    onChange={() => {
                      setMode('rail');
                      void shared.setMode('rail').catch(() => undefined);
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
                    disabled={isCalculating || !canManagePlan}
                    onChange={() => {
                      setMode('distance');
                      void shared.setMode('distance').catch(() => undefined);
                      setResult(null);
                      setGlobalError('');
                    }}
                  />
                  <RouteIcon />
                  <span><strong>By distance</strong><small>Balances kilometres</small></span>
                </label>
              </fieldset>
              {mode === 'rail' ? (
                <fieldset className="rail-objective-picker">
                  <legend>What should the rail recommendation optimise?</legend>
                  <label>
                    <input
                      type="radio"
                      name="rail-objective"
                      value="minimax"
                      checked={railObjective === 'minimax'}
                      disabled={isCalculating || !canManagePlan}
                      onChange={() => {
                        setRailObjective('minimax');
                        void shared.setRailObjective('minimax').catch(() => undefined);
                        setResult(null);
                        setGlobalError('');
                      }}
                    />
                    <span><strong>Shortest longest journey</strong><small>Protects the person with the longest full trip</small></span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="rail-objective"
                      value="average"
                      checked={railObjective === 'average'}
                      disabled={isCalculating || !canManagePlan}
                      onChange={() => {
                        setRailObjective('average');
                        void shared.setRailObjective('average').catch(() => undefined);
                        setResult(null);
                        setGlobalError('');
                      }}
                    />
                    <span><strong>Lowest group average</strong><small>Minimises everyone’s combined travel time</small></span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="rail-objective"
                      value="evenness"
                      checked={railObjective === 'evenness'}
                      disabled={isCalculating || !canManagePlan}
                      onChange={() => {
                        setRailObjective('evenness');
                        void shared.setRailObjective('evenness').catch(() => undefined);
                        setResult(null);
                        setGlobalError('');
                      }}
                    />
                    <span><strong>Most even journeys</strong><small>Minimises the spread between people’s full trips</small></span>
                  </label>
                </fieldset>
              ) : null}
              {mode === 'rail' && stationLoadError ? (
                <p className="inline-warning">Rail data is unavailable right now. {stationLoadError}</p>
              ) : null}
            </div>
          </details>

          {!hasGoogleKey ? (
            <p className="inline-warning" role="status">
              Google place search is not configured. Locations remain limited to MRT/LRT stations and Singapore coordinates until the deployment API key is updated.
            </p>
          ) : null}

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
            <span>{shared.plan ? `${shared.plan.memberCount} ${shared.plan.memberCount === 1 ? 'editor' : 'editors'} · ${currentSharedMember ? shared.syncLabel : 'Public view'}` : 'Plan saved on this device'}</span>
            {canManagePlan ? <button type="button" disabled={isCalculating} onClick={resetPlanner}>Clear plan</button> : null}
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
            points={mapPoints}
            onSelectStation={selectMeetingStation}
          />
          {mapPoints.length > 0 || result ? (
            <MapPanel
              points={mapPoints}
              result={result}
              onSelectStation={selectMeetingStation}
            />
          ) : null}
        </aside>
      </main>
      <section className="search-intro" aria-labelledby="singapore-meetup-planner">
        <div className="search-intro-heading">
          <span>Singapore MRT meetup planning</span>
          <h2 id="singapore-meetup-planner">Find a fair MRT or LRT meeting point</h2>
          <p>
            Meet Where Sia compares each person’s journey across Singapore’s rail
            network and recommends a practical station that balances travel time
            for the group.
          </p>
        </div>
        <div className="search-intro-grid">
          <article>
            <h3>How does the planner choose a station?</h3>
            <p>
              Add everyone’s starting point, choose MRT/LRT mode, and the planner
              compares connected stations using estimated rail journey times. It
              ranks the fairest option and shows useful alternatives.
            </p>
          </article>
          <article>
            <h3>Does it cover Singapore’s MRT and LRT?</h3>
            <p>
              Yes. The station comparison covers Singapore MRT and LRT services,
              including interchange connections, so friends travelling from
              different parts of the island can compare one shared destination.
            </p>
          </article>
          <article>
            <h3>Can I plan with friends?</h3>
            <p>
              Yes. Create a shared plan so each friend can add or update their own
              route, then compare the recommended meeting station together. The
              core planner is free to use.
            </p>
          </article>
        </div>
      </section>
      <footer className="app-footer">
        <div>
          <strong>Meet Where Sia</strong>
          <span>
            Fairer meetups, anywhere in Singapore. · Built in Singapore · ©{' '}
            {new Date().getFullYear()}
          </span>
        </div>
        <nav aria-label="Footer links">
          <a
            href="https://github.com/yewey2/meet-where-sia"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub<span className="sr-only"> (opens in a new tab)</span>
          </a>
          <a href="/support">Support this project</a>
          <a href="/privacy.html">Privacy</a>
          <a href="/terms.html">Terms</a>
        </nav>
      </footer>
    </div>
  );
}
