import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ParticipantCard } from './components/ParticipantCard';
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
  arithmeticCentroid,
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
import { formatStationLabel } from './lib/stations';
import { useSharedPlan } from './lib/useSharedPlan';
import {
  normalizeParticipantColors,
  pickParticipantColor,
} from './lib/participantColors';
import {
  calculationChangePolicy,
  shouldApplySharedCalculationPreferences,
} from './lib/calculationPreferences';
import { actionableErrorMessage } from './lib/errorMessages';
import type { SharedPlan } from './lib/groupPlans';
import type {
  DistanceObjective,
  EndpointPoint,
  LocationValue,
  MeetingResult,
  Mode,
  MrtStation,
  Participant,
  ParticipantColor,
  RailObjective,
  RankedStation,
  TrainAlertPayload,
} from './types';

const STORAGE_KEY = 'meetmiddle-sg-v1';
// Keep the legacy key so existing users retain their saved plans after rename.

const RAIL_OBJECTIVE_OPTIONS: Array<{
  id: RailObjective;
  label: string;
  summary: string;
  detail: string;
  tradeoff: string;
}> = [
  {
    id: 'average',
    label: 'Quickest overall',
    summary:
      'Minimises the total combined travel time for the group. Best pick for most meetups.',
    detail:
      'Minimises everyone’s combined journey time across the trip to the meetup and onwards afterwards.',
    tradeoff: 'One person may have a slightly longer journey.',
  },
  {
    id: 'weighted',
    label: 'Weighted centre',
    summary:
      'Balances speed and fairness by giving progressively more weight to longer trips.',
    detail:
      'Minimises the average of everyone’s squared full journey time. A trip twice as long has four times the influence.',
    tradeoff: 'The group total may be slightly higher than the quickest-overall option.',
  },
  {
    id: 'minimax',
    label: 'Keep trips manageable',
    summary:
      'Chooses the place with the lowest possible ceiling on anyone’s full outing.',
    detail:
      'This is the minimax calculation: it compares each station’s highest full outing time, whoever that person would be there.',
    tradeoff: 'The group’s combined journey time may be higher.',
  },
  {
    id: 'evenness',
    label: 'Similar travel times',
    summary:
      'Balances trip durations so everyone travels roughly the same amount.',
    detail:
      'Minimises the variance between people’s complete journey times so the effort is more evenly shared.',
    tradeoff: 'The fairest split may not be the quickest option for the group.',
  },
];

const DISTANCE_OBJECTIVE_OPTIONS: Array<{
  id: DistanceObjective;
  label: string;
  summary: string;
  detail: string;
  tradeoff: string;
}> = [
  {
    id: 'centroid',
    label: 'Balanced centre',
    summary: 'A more central point when someone is much farther away.',
    detail: 'Uses the arithmetic centroid, which minimises the average squared straight-line distance. A trip twice as long has four times the influence.',
    tradeoff: 'The group’s combined distance may be higher.',
  },
  {
    id: 'median',
    label: 'Shortest overall',
    summary: 'The least total straight-line distance for the group.',
    detail: 'Uses the geometric median, which minimises the sum of ordinary straight-line distances to every start and end point.',
    tradeoff: 'Someone far from the others may travel much farther than everyone else.',
  },
];

const MapPanel = lazy(async () => {
  const module = await import('./components/MapPanel');
  return { default: module.MapPanel };
});

function createParticipant(
  name = '',
  usedColors: readonly ParticipantColor[] = [],
): Participant {
  return {
    id: createId('person'),
    name,
    color: pickParticipantColor(usedColors),
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
  distanceObjective: DistanceObjective;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        participants: [createParticipant()],
        mode: 'rail',
        railObjective: 'average',
        distanceObjective: 'centroid',
      };
    }
    const parsed = JSON.parse(raw) as {
      participants?: Participant[];
      mode?: Mode;
      railObjective?: RailObjective;
      distanceObjective?: DistanceObjective;
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
      participants: participants.length
        ? normalizeParticipantColors(participants)
        : [createParticipant()],
      mode: parsed.mode === 'distance' ? 'distance' : 'rail',
      railObjective:
        parsed.railObjective === 'minimax' ||
        parsed.railObjective === 'weighted' ||
        parsed.railObjective === 'evenness'
          ? parsed.railObjective
          : 'average',
      distanceObjective: parsed.distanceObjective === 'median' ? 'median' : 'centroid',
    };
  } catch {
    return {
      participants: [createParticipant()],
      mode: 'rail',
      railObjective: 'average',
      distanceObjective: 'centroid',
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
        participantColor: participant.color,
        markerLabel: String(index + 1),
        kind: 'start',
        label: participant.start.label || participant.start.query,
        lat: participant.start.lat,
        lng: participant.start.lng,
        isRailStation: participant.start.placeId?.startsWith('station:') === true,
      });
    }

    const end = participant.sameAsStart ? participant.start : participant.end;
    if (hasCoordinates(end)) {
      points.push({
        id: `${participant.id}-end`,
        participantId: participant.id,
        participantName,
        participantColor: participant.color,
        markerLabel: String(index + 1),
        kind: 'end',
        label: end.label || end.query,
        lat: end.lat,
        lng: end.lng,
        isRailStation: end.placeId?.startsWith('station:') === true,
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
      `Enter ${displayName}’s ${field === 'start' ? 'starting point' : 'destination after the meetup'} before calculating.`,
    );
  }

  if (hasCoordinates(location) && location.status === 'resolved') {
    return location;
  }

  const localStation = findLocalStation(location.query, stations);
  if (localStation) {
    return {
      query: formatStationLabel(localStation),
      label: formatStationLabel(localStation),
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
      `${displayName}: enter an MRT/LRT station name or code, or Singapore coordinates such as “1.3000, 103.8000”.`,
    );
  }

  try {
    return await geocodeLocation(location);
  } catch (error) {
    throw new FieldResolutionError(
      participant.id,
      field,
      `${displayName} ${field === 'start' ? 'starting point' : 'destination'}: ${actionableErrorMessage(
        error,
        'We could not find that place',
        'Try an MRT/LRT station, landmark or 6-digit postal code.',
      )}`,
    );
  }
}

export default function App() {
  const saved = useMemo(loadSavedState, []);
  const [participants, setParticipants] = useState<Participant[]>(saved.participants);
  const [mode, setMode] = useState<Mode>(saved.mode);
  const [railObjective, setRailObjective] = useState<RailObjective>(saved.railObjective);
  const [distanceObjective, setDistanceObjective] = useState<DistanceObjective>(saved.distanceObjective);
  const [result, setResult] = useState<MeetingResult | null>(null);
  const [stations, setStations] = useState<MrtStation[]>([]);
  const [stationLoadError, setStationLoadError] = useState('');
  const [trainAlerts, setTrainAlerts] = useState<TrainAlertPayload | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const autoScrolledResultRef = useRef<MeetingResult | null>(null);
  const planRevisionRef = useRef(0);
  const sharedCalculationPlanIdRef = useRef<string | null>(null);
  const localCalculationOverrideRef = useRef(false);
  const objectiveHelpDialogRef = useRef<HTMLDialogElement>(null);
  const hasGoogleKey = Boolean(getGoogleMapsApiKey());
  const mapPoints = useMemo(() => buildEndpointPoints(participants), [participants]);

  const applyRemotePlan = useCallback((plan: SharedPlan) => {
    planRevisionRef.current += 1;
    setParticipants(normalizeParticipantColors(plan.participants));
    if (shouldApplySharedCalculationPreferences(
      sharedCalculationPlanIdRef.current,
      plan.id,
      localCalculationOverrideRef.current,
    )) {
      setMode(plan.mode);
      setRailObjective(plan.railObjective);
      setDistanceObjective(plan.distanceObjective);
      localCalculationOverrideRef.current = false;
    }
    sharedCalculationPlanIdRef.current = plan.id;
    setResult(null);
    setGlobalError('');
  }, []);

  const shared = useSharedPlan({
    participants,
    mode,
    railObjective,
    distanceObjective,
    onRemotePlan: applyRemotePlan,
  });
  const hasSharedLink = Boolean(shared.requestedPlanId);
  const currentSharedMember = shared.plan?.currentMember ?? null;
  const sharedOwner = currentSharedMember?.role === 'owner';
  const canManagePlan = !hasSharedLink || sharedOwner;
  const selectedRailObjective =
    RAIL_OBJECTIVE_OPTIONS.find((option) => option.id === railObjective)
    ?? RAIL_OBJECTIVE_OPTIONS[0];
  const selectedDistanceObjective =
    DISTANCE_OBJECTIVE_OPTIONS.find((option) => option.id === distanceObjective)
    ?? DISTANCE_OBJECTIVE_OPTIONS[0];
  const activeObjectiveOptions = mode === 'rail'
    ? RAIL_OBJECTIVE_OPTIONS
    : DISTANCE_OBJECTIVE_OPTIONS;
  const selectedObjective = mode === 'rail'
    ? selectedRailObjective
    : selectedDistanceObjective;
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
        JSON.stringify({ participants, mode, railObjective, distanceObjective }),
      );
    } catch {
      // The planner still works when storage is blocked (for example, private embeds).
    }
  }, [distanceObjective, hasSharedLink, mode, participants, railObjective]);

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
          actionableErrorMessage(
            error,
            'The rail station list could not be loaded',
            'Try again, or use Direct distance mode for now.',
          ),
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
        target.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
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
    const previous = participants.find((participant) => participant.id === next.id);
    const colorOnlyChange = Boolean(
      previous
      && previous.color !== next.color
      && previous.name === next.name
      && previous.sameAsStart === next.sameAsStart
      && previous.start === next.start
      && previous.end === next.end,
    );
    planRevisionRef.current += 1;
    setParticipants((current) =>
      current.map((participant) =>
        participant.id === next.id ? next : participant,
      ),
    );
    shared.scheduleParticipant(next);
    if (!colorOnlyChange) setResult(null);
    setGlobalError('');
  }

  function addParticipant() {
    if (isCalculating) return;
    if (!canManagePlan) return;
    planRevisionRef.current += 1;
    const next = createParticipant(
      '',
      participants.map((participant) => participant.color),
    );
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
        color: 'green' as const,
        sameAsStart: true,
        start: emptyLocation('Aljunied MRT'),
        end: emptyLocation('Aljunied MRT'),
      },
      {
        id: createId('person'),
        name: 'Ben',
        color: 'blue' as const,
        sameAsStart: true,
        start: emptyLocation('Eunos MRT'),
        end: emptyLocation('Eunos MRT'),
      },
    ];
    setParticipants(nextParticipants);
    setMode('rail');
    setRailObjective('average');
    setDistanceObjective('centroid');
    void shared.resetPlan(nextParticipants, 'rail', 'average', 'centroid').catch(() => undefined);
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
    setRailObjective('average');
    setDistanceObjective('centroid');
    void shared.resetPlan(nextParticipants, 'rail', 'average', 'centroid').catch(() => undefined);
    setResult(null);
    setGlobalError('');
  }

  function chooseRailObjective(nextObjective: RailObjective) {
    if (isCalculating || railObjective === nextObjective) return;
    const policy = calculationChangePolicy(Boolean(shared.plan), sharedOwner);
    if (policy.overrideSharedDefaults) localCalculationOverrideRef.current = true;
    setRailObjective(nextObjective);
    if (policy.persistShared) {
      void shared.setRailObjective(nextObjective).catch(() => undefined);
    }
    setResult(null);
    setGlobalError('');
  }

  function chooseMode(nextMode: Mode) {
    if (isCalculating || mode === nextMode) return;
    const policy = calculationChangePolicy(Boolean(shared.plan), sharedOwner);
    if (policy.overrideSharedDefaults) localCalculationOverrideRef.current = true;
    setMode(nextMode);
    if (policy.persistShared) {
      void shared.setMode(nextMode).catch(() => undefined);
    }
    setResult(null);
    setGlobalError('');
  }

  function chooseDistanceObjective(nextObjective: DistanceObjective) {
    if (isCalculating || distanceObjective === nextObjective) return;
    const policy = calculationChangePolicy(Boolean(shared.plan), sharedOwner);
    if (policy.overrideSharedDefaults) localCalculationOverrideRef.current = true;
    setDistanceObjective(nextObjective);
    if (policy.persistShared) {
      void shared.setDistanceObjective(nextObjective).catch(() => undefined);
    }
    setResult(null);
    setGlobalError('');
  }

  function chooseActiveObjective(nextObjective: RailObjective | DistanceObjective) {
    if (mode === 'rail') chooseRailObjective(nextObjective as RailObjective);
    else chooseDistanceObjective(nextObjective as DistanceObjective);
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
        title: formatStationLabel(station),
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
    const calculationDistanceObjective = distanceObjective;
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
        throw new Error('Add a valid starting point, then try the calculation again.');
      }

      let nextResult: MeetingResult;
      if (calculationMode === 'distance') {
        const center = calculationDistanceObjective === 'centroid'
          ? arithmeticCentroid(points)
          : geometricMedian(points);
        const metrics = distanceMetrics(center, points);
        const address = await reverseGeocode(center);
        const title = address.split(',')[0]?.trim() || (
          calculationDistanceObjective === 'centroid'
            ? 'Balanced distance centre'
            : 'Minimum-distance point'
        );

        nextResult = {
          mode: 'distance',
          objective: calculationDistanceObjective,
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
          throw new Error('No connected MRT/LRT station could be compared. Try different locations or switch to Direct distance.');
        }

        nextResult = {
          mode: 'rail',
          objective: calculationRailObjective,
          lat: selected.lat,
          lng: selected.lng,
          title: formatStationLabel(selected),
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
          : 'The meeting point could not be calculated. Check the locations and try again.',
      );
    } finally {
      setIsCalculating(false);
    }
  }

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
              sharedCalculationPlanIdRef.current = null;
              localCalculationOverrideRef.current = false;
              const localPlan = loadSavedState();
              setParticipants(localPlan.participants);
              setMode(localPlan.mode);
              setRailObjective(localPlan.railObjective);
              setDistanceObjective(localPlan.distanceObjective);
              setResult(null);
              setGlobalError('');
            }}
            onLeave={async () => {
              planRevisionRef.current += 1;
              await shared.leavePlan();
              sharedCalculationPlanIdRef.current = null;
              localCalculationOverrideRef.current = false;
              const localPlan = loadSavedState();
              setParticipants(localPlan.participants);
              setMode(localPlan.mode);
              setRailObjective(localPlan.railObjective);
              setDistanceObjective(localPlan.distanceObjective);
              setResult(null);
              setGlobalError('');
            }}
            onDismissError={shared.dismissError}
          />
          <ThemeToggle />
        </div>
      </header>

      <div id="group-dialog-root" />

      <dialog
        ref={objectiveHelpDialogRef}
        className="objective-help-dialog"
        aria-labelledby="objective-help-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="objective-help-content">
          <form method="dialog">
            <button
              type="submit"
              className="objective-help-close"
              aria-label="Close fairness goal comparison"
            >
              ×
            </button>
          </form>
          <div className="objective-help-heading">
            <span>Fairness goal</span>
            <h2 id="objective-help-title">What’s the difference?</h2>
            <p>
              {mode === 'rail'
                ? 'Every goal counts each person’s journey to the meetup and onwards. The difference is what the station ranking prioritises.'
                : 'Both goals use straight-line distance to every start and end point. The difference is how strongly longer distances influence the result.'}
            </p>
          </div>
          <ul className="objective-help-list">
            {activeObjectiveOptions.map((option) => {
              const selected = option.id === (mode === 'rail' ? railObjective : distanceObjective);
              return (
                <li className={selected ? 'is-selected' : ''} key={option.id}>
                  <div className="objective-help-option-heading">
                    <strong>{option.label}</strong>
                    {selected ? <span>Current</span> : null}
                  </div>
                  <p>{option.detail}</p>
                  <small><strong>Trade-off:</strong> {option.tradeoff}</small>
                  <button
                    type="button"
                    disabled={selected || isCalculating}
                    onClick={() => {
                      chooseActiveObjective(option.id);
                      objectiveHelpDialogRef.current?.close();
                    }}
                  >
                    {selected ? 'Selected' : `Use ${option.label.toLowerCase()}`}
                  </button>
                </li>
              );
            })}
          </ul>
          <form method="dialog">
            <button type="submit" className="objective-help-done">Done</button>
          </form>
        </div>
      </dialog>

      <main className="planner-layout">
        <section className="planner-panel" aria-labelledby="planner-title">
          <div className="planner-intro">
            <div className="eyebrow"><SparkIcon /> Made for Singapore</div>
            <h1 id="planner-title">Meet Where Sia?</h1>
            <p>Add everyone’s route. We’ll compare the journeys and find a meeting spot that feels fair.</p>
          </div>

          <div className="people-section">
            <div className="people-header">
              <div>
                <div className="section-label"><UsersIcon /> Who’s meeting?</div>
                <p>{participants.length} {participants.length === 1 ? 'person' : 'people'} added</p>
              </div>
              <button type="button" className="text-button sample-plan-button" disabled={isCalculating || !canManagePlan} onClick={loadExample}>
                <SparkIcon /> Try an example
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
                  isCurrentUser={
                    Boolean(currentSharedMember?.participantId) &&
                    currentSharedMember?.participantId === participant.id
                  }
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

          <section className="method-panel" aria-labelledby="method-title">
            <div className="method-panel-heading">
              <div>
                <div className="section-label" id="method-title">How should we choose?</div>
                <p>Balance train time or straight-line distance—then decide what feels fair.</p>
              </div>
              {shared.plan && !sharedOwner ? (
                <span className="local-method-note">Changes here affect only your view</span>
              ) : null}
            </div>
            <div className="mode-section">
              <fieldset className="mode-switch">
                <legend className="sr-only">How should the meeting spot be chosen?</legend>
                <label className={mode === 'rail' ? 'is-selected' : ''}>
                  <input
                    type="radio"
                    name="meeting-mode"
                    value="rail"
                    checked={mode === 'rail'}
                    disabled={isCalculating}
                    onChange={() => chooseMode('rail')}
                  />
                  <RailIcon />
                  <span><strong>MRT/LRT time</strong><small>Balanced travel time</small></span>
                </label>
                <label className={mode === 'distance' ? 'is-selected' : ''}>
                  <input
                    type="radio"
                    name="meeting-mode"
                    value="distance"
                    checked={mode === 'distance'}
                    disabled={isCalculating}
                    onChange={() => chooseMode('distance')}
                  />
                  <RouteIcon />
                  <span><strong>Direct distance</strong><small>{selectedDistanceObjective.label}</small></span>
                </label>
              </fieldset>
              <div className={`rail-objective-guidance ${mode === 'distance' ? 'distance-mode-guidance' : ''}`}>
                <div>
                  <strong>{selectedObjective.label}</strong>
                  <p id="objective-explanation">{selectedObjective.summary}</p>
                </div>
              </div>
              <details className="rail-objective-disclosure">
                <summary className="rail-objective-disclosure-trigger">
                  <span>Customise fairness goal</span>
                  <small>
                    {selectedObjective.label}
                    {(mode === 'rail' && railObjective === 'average') ||
                    (mode === 'distance' && distanceObjective === 'centroid')
                      ? ' (default)'
                      : ''}
                  </small>
                </summary>
                <fieldset
                  className="rail-objective-picker"
                  aria-describedby="objective-explanation"
                >
                  <legend className="sr-only">Prioritise</legend>
                  {activeObjectiveOptions.map((option) => (
                    <label
                      className={selectedObjective.id === option.id ? 'is-selected' : ''}
                      key={option.id}
                    >
                      <input
                        type="radio"
                        name={`${mode}-objective`}
                        value={option.id}
                        checked={selectedObjective.id === option.id}
                        disabled={isCalculating}
                        onChange={() => chooseActiveObjective(option.id)}
                      />
                      <span>
                        <strong>
                          {option.label}
                          {(mode === 'rail' && option.id === 'average') ||
                          (mode === 'distance' && option.id === 'centroid')
                            ? ' (default)'
                            : ''}
                        </strong>
                        <small>{option.summary}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <button
                  type="button"
                  className="rail-objective-help"
                  aria-haspopup="dialog"
                  onClick={() => objectiveHelpDialogRef.current?.showModal()}
                >
                  <span aria-hidden="true">i</span>
                  Full comparison
                </button>
              </details>
              {mode === 'rail' && stationLoadError ? (
                <p className="inline-warning">Rail data is unavailable right now. {stationLoadError}</p>
              ) : null}
            </div>
          </section>

          {!hasGoogleKey ? (
            <p className="inline-warning" role="status">
              Place search is limited to MRT/LRT stations and Singapore coordinates right now.
            </p>
          ) : null}

          {globalError ? (
            <div className="global-error" role="alert">
              <strong>We couldn’t finish the calculation</strong>
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
            <Suspense
              fallback={(
                <div className="map-wrap">
                  <div className="map-loading" role="status">
                    <span className="input-spinner" aria-hidden="true" />
                    Loading map…
                  </div>
                </div>
              )}
            >
              <MapPanel
                points={mapPoints}
                result={result}
                onSelectStation={selectMeetingStation}
              />
            </Suspense>
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
