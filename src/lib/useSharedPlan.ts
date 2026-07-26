import { useCallback, useEffect, useRef, useState } from 'react';
import type { Mode, Participant } from '../types';
import {
  joinSharedPlan,
  loginSharedPlan,
  createSharedPlan,
  deleteSharedPlan,
  loadSharedPlan,
  ownerLoginSharedPlan,
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
  const [busy, setBusy] = useState(Boolean(requestedPlanId));
  const [error, setError] = useState('');
  const [syncLabel, setSyncLabel] = useState('Saved');
  const planRef = useRef<SharedPlan | null>(null);
  const pendingCount = useRef(0);
  const participantTimers = useRef(new Map<string, number>());
  const authEpoch = useRef(0);

  const acceptPlan = useCallback((next: SharedPlan, applyRemote = false) => {
    if (planRef.current && next.version < planRef.current.version) return;
    planRef.current = next;
    setPlan(next);
    if (applyRemote) onRemotePlan(next);
  }, [onRemotePlan]);

  useEffect(() => {
    if (!requestedPlanId) {
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    const epoch = authEpoch.current;
    setBusy(true);
    void loadSharedPlan(requestedPlanId, controller.signal)
      .then((next) => {
        if (epoch !== authEpoch.current) return;
        acceptPlan(next, true);
        setError('');
      })
      .catch((loadError: unknown) => {
        if (epoch !== authEpoch.current) return;
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setPlan(null);
        setError(message(loadError));
      })
      .finally(() => setBusy(false));
    return () => controller.abort();
  }, [acceptPlan, requestedPlanId]);

  useEffect(() => {
    if (!plan) return;
    const interval = window.setInterval(() => {
      if (document.hidden || pendingCount.current > 0 || participantTimers.current.size > 0) return;
      const epoch = authEpoch.current;
      void loadSharedPlan(plan.id)
        .then((next) => {
          if (epoch !== authEpoch.current) return;
          if (next.version > (planRef.current?.version || 0)) acceptPlan(next, true);
        })
        .catch((pollError: unknown) => {
          if (epoch !== authEpoch.current) return;
          if (pollError instanceof SharedPlanError && pollError.status === 404) {
            planRef.current = null;
            setPlan(null);
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
    const epoch = authEpoch.current;
    pendingCount.current += 1;
    setSyncLabel('Saving…');
    setError('');
    try {
      const next = await mutateSharedPlan(current.id, mutation);
      if (epoch === authEpoch.current) {
        acceptPlan(next, applyRemote && pendingCount.current === 1);
        setSyncLabel('Saved');
      }
      return next;
    } catch (mutationError) {
      if (epoch !== authEpoch.current) throw mutationError;
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
    async login(username: string, password: string) {
      if (!requestedPlanId) return;
      setBusy(true);
      setError('');
      const epoch = ++authEpoch.current;
      try {
        const next = await loginSharedPlan(requestedPlanId, username, password);
        if (epoch === authEpoch.current) acceptPlan(next, true);
      } catch (loginError) {
        setError(message(loginError));
        throw loginError;
      } finally {
        setBusy(false);
      }
    },
    async join(username: string, password: string) {
      if (!requestedPlanId) return;
      setBusy(true);
      setError('');
      const epoch = ++authEpoch.current;
      try {
        const next = await joinSharedPlan(requestedPlanId, username, password);
        if (epoch === authEpoch.current) acceptPlan(next, true);
      } catch (joinError) {
        setError(message(joinError));
        throw joinError;
      } finally {
        setBusy(false);
      }
    },
    async ownerLogin(email: string, password: string) {
      if (!requestedPlanId) return;
      setBusy(true);
      setError('');
      const epoch = ++authEpoch.current;
      try {
        const next = await ownerLoginSharedPlan(requestedPlanId, email, password);
        if (epoch === authEpoch.current) acceptPlan(next, true);
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
    setJoining: (enabled: boolean) => runMutation({ type: 'setJoining', enabled }, false),
    addMember: (input: { participantId: string; temporaryPassword: string }) => runMutation({ type: 'addMember', ...input }, false),
    resetMember: (memberId: string, temporaryPassword: string) => runMutation({ type: 'resetMemberPassword', memberId, temporaryPassword }, false),
    removeMember: (memberId: string) => runMutation({ type: 'removeMember', memberId }, false),
    changePassword: (password: string) => runMutation({ type: 'changePassword', password }, false),
    async logout() {
      const current = planRef.current;
      if (!current) return;
      const planId = current.id;
      const epoch = ++authEpoch.current;
      participantTimers.current.forEach((timer) => window.clearTimeout(timer));
      participantTimers.current.clear();
      const publicSnapshot: SharedPlan = { ...current, currentMember: null, members: [] };
      acceptPlan(publicSnapshot, true);
      setSyncLabel('View only');
      setError('');
      try {
        await logoutSharedPlan(planId);
        if (epoch !== authEpoch.current) return;
        const next = await loadSharedPlan(planId);
        if (epoch === authEpoch.current) acceptPlan(next, true);
      } catch (logoutError) {
        if (epoch === authEpoch.current) setError(message(logoutError));
      }
    },
    async deletePlan() {
      if (!planRef.current) return;
      await deleteSharedPlan(planRef.current.id);
      authEpoch.current += 1;
      participantTimers.current.forEach((timer) => window.clearTimeout(timer));
      participantTimers.current.clear();
      planRef.current = null;
      setPlan(null);
      setRequestedPlanId(null);
      setPlanInLocation();
    },
  };
}

