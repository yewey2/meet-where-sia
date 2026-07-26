import { useCallback, useEffect, useRef, useState } from 'react';
import type { Mode, Participant } from '../types';
import {
  createSharedPlan,
  deleteSharedPlan,
  loadSharedPlan,
  loginSharedPlan,
  logoutSharedPlan,
  mutateSharedPlan,
  planIdFromLocation,
  setPlanInLocation,
  SharedPlanError,
  type PlanMutation,
  type SharedPlan,
} from './groupPlans';

interface UseSharedPlanOptions {
  participants: Participant[];
  mode: Mode;
  onRemotePlan: (plan: SharedPlan) => void;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'The shared plan could not be updated.';
}

export function useSharedPlan({ participants, mode, onRemotePlan }: UseSharedPlanOptions) {
  const [requestedPlanId, setRequestedPlanId] = useState<string | null>(() => planIdFromLocation());
  const [plan, setPlan] = useState<SharedPlan | null>(null);
  const [accessRequired, setAccessRequired] = useState(Boolean(requestedPlanId));
  const [busy, setBusy] = useState(Boolean(requestedPlanId));
  const [error, setError] = useState('');
  const [syncLabel, setSyncLabel] = useState('Saved');
  const planRef = useRef<SharedPlan | null>(null);
  const pendingCount = useRef(0);
  const participantTimers = useRef(new Map<string, number>());

  const acceptPlan = useCallback((next: SharedPlan, applyRemote = false) => {
    planRef.current = next;
    setPlan(next);
    setAccessRequired(false);
    if (applyRemote) onRemotePlan(next);
  }, [onRemotePlan]);

  useEffect(() => {
    if (!requestedPlanId) {
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    void loadSharedPlan(requestedPlanId, controller.signal)
      .then((next) => {
        acceptPlan(next, true);
        setError('');
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        if (loadError instanceof SharedPlanError && loadError.status === 401) {
          setAccessRequired(true);
          setError('');
        } else {
          setAccessRequired(true);
          setError(message(loadError));
        }
      })
      .finally(() => setBusy(false));
    return () => controller.abort();
  }, [acceptPlan, requestedPlanId]);

  useEffect(() => {
    if (!plan) return;
    const interval = window.setInterval(() => {
      if (document.hidden || pendingCount.current > 0 || participantTimers.current.size > 0) return;
      void loadSharedPlan(plan.id)
        .then((next) => {
          if (next.version > (planRef.current?.version || 0)) acceptPlan(next, true);
        })
        .catch((pollError: unknown) => {
          if (pollError instanceof SharedPlanError && [401, 403, 404].includes(pollError.status)) {
            planRef.current = null;
            setPlan(null);
            setAccessRequired(true);
            setError(message(pollError));
          }
        });
    }, 20_000);
    return () => window.clearInterval(interval);
  }, [acceptPlan, plan]);

  useEffect(() => () => {
    participantTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const runMutation = useCallback(async (mutation: PlanMutation, applyRemote = true) => {
    const current = planRef.current;
    if (!current) return null;
    pendingCount.current += 1;
    setSyncLabel('Saving…');
    setError('');
    try {
      const next = await mutateSharedPlan(current.id, mutation);
      acceptPlan(next, applyRemote && pendingCount.current === 1);
      setSyncLabel('Saved');
      return next;
    } catch (mutationError) {
      setError(message(mutationError));
      setSyncLabel('Save failed');
      throw mutationError;
    } finally {
      pendingCount.current -= 1;
    }
  }, [acceptPlan]);

  const scheduleParticipant = useCallback((participant: Participant) => {
    const current = planRef.current;
    if (!current) return;
    const existing = participantTimers.current.get(participant.id);
    if (existing) window.clearTimeout(existing);
    setSyncLabel('Unsaved changes');
    const timer = window.setTimeout(() => {
      participantTimers.current.delete(participant.id);
      void runMutation({ type: 'updateParticipant', participant }, false).catch(() => undefined);
    }, 650);
    participantTimers.current.set(participant.id, timer);
  }, [runMutation]);

  return {
    plan,
    requestedPlanId,
    accessRequired,
    busy,
    error,
    syncLabel,
    dismissError: () => setError(''),
    async create(input: { title: string; displayName: string; email: string; password: string }) {
      setBusy(true);
      setError('');
      try {
        const next = await createSharedPlan({ ...input, participants, mode });
        setPlanInLocation(next.id);
        setRequestedPlanId(next.id);
        acceptPlan(next);
      } catch (createError) {
        setError(message(createError));
        throw createError;
      } finally {
        setBusy(false);
      }
    },
    async login(email: string, password: string) {
      if (!requestedPlanId) return;
      setBusy(true);
      setError('');
      try {
        const next = await loginSharedPlan(requestedPlanId, email, password);
        acceptPlan(next, true);
      } catch (loginError) {
        setError(message(loginError));
        throw loginError;
      } finally {
        setBusy(false);
      }
    },
    scheduleParticipant,
    addParticipant: (participant: Participant) => runMutation({ type: 'addParticipant', participant }),
    removeParticipant: (participantId: string) => runMutation({ type: 'removeParticipant', participantId }),
    setMode: (nextMode: Mode) => runMutation({ type: 'setMode', mode: nextMode }, false),
    resetPlan: (nextParticipants: Participant[], nextMode: Mode) => runMutation({ type: 'resetPlan', participants: nextParticipants, mode: nextMode }),
    rename: (title: string) => runMutation({ type: 'renamePlan', title }, false),
    addMember: (input: { displayName: string; email: string; temporaryPassword: string }) => runMutation({ type: 'addMember', ...input }, false),
    resetMember: (memberId: string, temporaryPassword: string) => runMutation({ type: 'resetMemberPassword', memberId, temporaryPassword }, false),
    removeMember: (memberId: string) => runMutation({ type: 'removeMember', memberId }, false),
    changePassword: (password: string) => runMutation({ type: 'changePassword', password }, false),
    async logout() {
      if (!planRef.current) return;
      try {
        await logoutSharedPlan(planRef.current.id);
      } finally {
        planRef.current = null;
        setPlan(null);
        setAccessRequired(true);
      }
    },
    async deletePlan() {
      if (!planRef.current) return;
      await deleteSharedPlan(planRef.current.id);
      planRef.current = null;
      setPlan(null);
      setRequestedPlanId(null);
      setAccessRequired(false);
      setPlanInLocation();
    },
  };
}

