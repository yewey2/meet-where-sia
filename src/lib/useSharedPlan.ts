import { useCallback, useEffect, useRef, useState } from 'react';
import type { Mode, Participant, RailObjective } from '../types';
import {
  claimSharedPlan,
  createClaimInvite,
  joinSharedPlan,
  loginSharedPlan,
  createSharedPlan,
  deleteSharedPlan,
  loadSharedPlan,
  ownerLoginSharedPlan,
  logoutSharedPlan,
  mutateSharedPlan,
  planIdFromLocation,
  inviteTokenFromLocation,
  setInviteInLocation,
  setPlanInLocation,
  SharedPlanError,
  type PlanMutation,
  type SharedPlan,
} from './groupPlans';
import { ParticipantSaveQueue } from './participantSaveQueue';

interface UseSharedPlanOptions {
  participants: Participant[];
  mode: Mode;
  railObjective: RailObjective;
  onRemotePlan: (plan: SharedPlan) => void;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'The shared plan could not be updated.';
}

export function useSharedPlan({ participants, mode, railObjective, onRemotePlan }: UseSharedPlanOptions) {
  const [requestedPlanId, setRequestedPlanId] = useState<string | null>(() => planIdFromLocation());
  const [claimToken, setClaimToken] = useState<string | null>(() => inviteTokenFromLocation());
  const [plan, setPlan] = useState<SharedPlan | null>(null);
  const [busy, setBusy] = useState(Boolean(requestedPlanId));
  const [error, setError] = useState('');
  const [syncLabel, setSyncLabel] = useState('Saved');
  const planRef = useRef<SharedPlan | null>(null);
  const pendingCount = useRef(0);
  const participantQueue = useRef<ParticipantSaveQueue | null>(null);
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
      if (document.hidden || pendingCount.current > 0 || participantQueue.current?.hasPending) return;
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

  const runMutation = useCallback(async (mutation: PlanMutation, applyRemote = true, keepalive = false) => {
    const current = planRef.current;
    if (!current) return null;
    const epoch = authEpoch.current;
    pendingCount.current += 1;
    setSyncLabel('Saving…');
    setError('');
    try {
      const next = await mutateSharedPlan(current.id, mutation, keepalive);
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

  if (!participantQueue.current) {
    participantQueue.current = new ParticipantSaveQueue(
      async (participant, keepalive) => {
        await runMutation({ type: 'updateParticipant', participant }, false, keepalive);
      },
      () => undefined,
    );
  }
  participantQueue.current.setSave(async (participant, keepalive) => {
    await runMutation({ type: 'updateParticipant', participant }, false, keepalive);
  });

  const flushParticipants = useCallback((keepalive = false) => (
    participantQueue.current?.flush(keepalive) || Promise.resolve()
  ), []);

  useEffect(() => {
    const flushInBackground = () => {
      void flushParticipants(true).catch(() => undefined);
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushInBackground();
    };
    window.addEventListener('blur', flushInBackground);
    window.addEventListener('pagehide', flushInBackground);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('blur', flushInBackground);
      window.removeEventListener('pagehide', flushInBackground);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      flushInBackground();
    };
  }, [flushParticipants]);

  const scheduleParticipant = useCallback((participant: Participant) => {
    const current = planRef.current;
    if (!current) return;
    setSyncLabel('Unsaved changes');
    participantQueue.current?.schedule(participant);
  }, []);

  return {
    plan,
    requestedPlanId,
    claimToken,
    busy,
    error,
    syncLabel,
    dismissError: () => setError(''),
    async create(input: { title: string; displayName: string; email: string; password: string }) {
      setBusy(true);
      setError('');
      try {
        const next = await createSharedPlan({ ...input, participants, mode, railObjective });
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
        if (epoch === authEpoch.current) {
          acceptPlan(next, true);
          setClaimToken(null);
          setInviteInLocation();
        }
      } catch (loginError) {
        if (epoch === authEpoch.current) setError(message(loginError));
        throw loginError;
      } finally {
        if (epoch === authEpoch.current) setBusy(false);
      }
    },
    async join(username: string, password: string) {
      if (!requestedPlanId) return;
      setBusy(true);
      setError('');
      const epoch = ++authEpoch.current;
      try {
        const next = await joinSharedPlan(requestedPlanId, username, password);
        if (epoch === authEpoch.current) {
          acceptPlan(next, true);
          setClaimToken(null);
          setInviteInLocation();
        }
      } catch (joinError) {
        if (epoch === authEpoch.current) setError(message(joinError));
        throw joinError;
      } finally {
        if (epoch === authEpoch.current) setBusy(false);
      }
    },
    async claim(username: string, password: string) {
      if (!requestedPlanId || !claimToken) return;
      setBusy(true);
      setError('');
      const epoch = ++authEpoch.current;
      try {
        const next = await claimSharedPlan(requestedPlanId, claimToken, username, password);
        if (epoch === authEpoch.current) {
          acceptPlan(next, true);
          setClaimToken(null);
          setInviteInLocation();
        }
      } catch (claimError) {
        if (epoch === authEpoch.current) setError(message(claimError));
        throw claimError;
      } finally {
        if (epoch === authEpoch.current) setBusy(false);
      }
    },
    async ownerLogin(email: string, password: string) {
      if (!requestedPlanId) return;
      setBusy(true);
      setError('');
      const epoch = ++authEpoch.current;
      try {
        const next = await ownerLoginSharedPlan(requestedPlanId, email, password);
        if (epoch === authEpoch.current) {
          acceptPlan(next, true);
          setClaimToken(null);
          setInviteInLocation();
        }
      } catch (loginError) {
        if (epoch === authEpoch.current) setError(message(loginError));
        throw loginError;
      } finally {
        if (epoch === authEpoch.current) setBusy(false);
      }
    },
    scheduleParticipant,
    addParticipant: (participant: Participant) => runMutation({ type: 'addParticipant', participant }),
    removeParticipant: (participantId: string) => runMutation({ type: 'removeParticipant', participantId }),
    setMode: (nextMode: Mode) => runMutation({ type: 'setMode', mode: nextMode }, false),
    setRailObjective: (nextObjective: RailObjective) => runMutation({ type: 'setRailObjective', railObjective: nextObjective }, false),
    resetPlan: (nextParticipants: Participant[], nextMode: Mode, nextObjective: RailObjective) => runMutation({ type: 'resetPlan', participants: nextParticipants, mode: nextMode, railObjective: nextObjective }),
    rename: (title: string) => runMutation({ type: 'renamePlan', title }, false),
    setJoining: (enabled: boolean) => runMutation({ type: 'setJoining', enabled }, false),
    async createInvite(participantId: string) {
      const current = planRef.current;
      if (!current) throw new Error('Open a shared plan first.');
      setBusy(true);
      setError('');
      try {
        const result = await createClaimInvite(current.id, participantId);
        acceptPlan(result.plan, false);
        const inviteUrl = new URL(window.location.href);
        inviteUrl.searchParams.set('plan', current.id);
        inviteUrl.searchParams.set('invite', result.inviteToken);
        return inviteUrl.toString();
      } catch (inviteError) {
        setError(message(inviteError));
        throw inviteError;
      } finally {
        setBusy(false);
      }
    },
    addMember: (input: { participantId: string; temporaryPassword: string }) => runMutation({ type: 'addMember', ...input }, false),
    resetMember: (memberId: string, temporaryPassword: string) => runMutation({ type: 'resetMemberPassword', memberId, temporaryPassword }, false),
    removeMember: (memberId: string) => runMutation({ type: 'removeMember', memberId }, false),
    changePassword: (password: string) => runMutation({ type: 'changePassword', password }, false),
    async logout() {
      const current = planRef.current;
      if (!current) return;
      try {
        await flushParticipants();
      } catch {
        // runMutation has already exposed the save failure. Stay signed in so
        // the queued edit can be retried instead of silently discarding it.
        return;
      }
      const planId = current.id;
      const epoch = ++authEpoch.current;
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
      participantQueue.current?.cancel();
      planRef.current = null;
      setPlan(null);
      setRequestedPlanId(null);
      setClaimToken(null);
      setPlanInLocation();
    },
    async leavePlan() {
      await flushParticipants();
      authEpoch.current += 1;
      planRef.current = null;
      setPlan(null);
      setRequestedPlanId(null);
      setClaimToken(null);
      setError('');
      setPlanInLocation();
    },
  };
}

