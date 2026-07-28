import type { Mode, Participant, RailObjective } from '../types';

export type SharedMemberRole = 'owner' | 'member';

export interface SharedMember {
  id: string;
  displayName: string;
  email?: string;
  username?: string;
  participantId?: string;
  role: SharedMemberRole;
}

export interface SharedPlan {
  id: string;
  title: string;
  mode: Mode;
  railObjective: RailObjective;
  participants: Participant[];
  createdAt: string;
  updatedAt: string;
  version: number;
  joiningEnabled: boolean;
  memberCount: number;
  currentMember: SharedMember | null;
  members: SharedMember[];
}

export type PlanMutation =
  | { type: 'updateParticipant'; participant: Participant }
  | { type: 'addParticipant'; participant: Participant }
  | { type: 'removeParticipant'; participantId: string }
  | { type: 'setMode'; mode: Mode }
  | { type: 'setRailObjective'; railObjective: RailObjective }
  | { type: 'resetPlan'; participants: Participant[]; mode: Mode; railObjective: RailObjective }
  | { type: 'renamePlan'; title: string }
  | { type: 'setJoining'; enabled: boolean }
  | { type: 'createInvite'; participantId: string }
  | { type: 'addMember'; participantId: string; temporaryPassword: string }
  | { type: 'resetMemberPassword'; memberId: string; temporaryPassword: string }
  | { type: 'removeMember'; memberId: string }
  | { type: 'changePassword'; password: string };

export class SharedPlanError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: options?.body
      ? { 'Content-Type': 'application/json', ...options.headers }
      : options?.headers,
  });
  const payload = await response.json().catch(() => ({})) as {
    error?: string;
    code?: string;
  } & T;
  if (!response.ok) {
    throw new SharedPlanError(
      payload.error || 'The shared plan could not be reached.',
      response.status,
      payload.code,
    );
  }
  return payload;
}

export async function loadSharedPlan(planId: string, signal?: AbortSignal) {
  const response = await api<{ plan: SharedPlan }>(
    `/api/plans?planId=${encodeURIComponent(planId)}`,
    { signal },
  );
  return response.plan;
}

export async function createSharedPlan(input: {
  title: string;
  displayName: string;
  email: string;
  password: string;
  participants: Participant[];
  mode: Mode;
  railObjective: RailObjective;
}) {
  const response = await api<{ plan: SharedPlan }>('/api/plans', {
    method: 'POST',
    body: JSON.stringify({ action: 'create', ...input }),
  });
  return response.plan;
}

export async function ownerLoginSharedPlan(planId: string, email: string, password: string) {
  const response = await api<{ plan: SharedPlan }>('/api/plans', {
    method: 'POST',
    body: JSON.stringify({ action: 'ownerLogin', planId, email, password }),
  });
  return response.plan;
}

export async function loginSharedPlan(planId: string, username: string, password: string) {
  const response = await api<{ plan: SharedPlan }>('/api/plans', {
    method: 'POST',
    body: JSON.stringify({ action: 'login', planId, username, password }),
  });
  return response.plan;
}

export async function joinSharedPlan(planId: string, username: string, password: string) {
  const response = await api<{ plan: SharedPlan }>('/api/plans', {
    method: 'POST',
    body: JSON.stringify({ action: 'join', planId, username, password }),
  });
  return response.plan;
}

export async function claimSharedPlan(planId: string, inviteToken: string, username: string, password: string) {
  const response = await api<{ plan: SharedPlan }>('/api/plans', {
    method: 'POST',
    body: JSON.stringify({ action: 'claimInvite', planId, inviteToken, username, password }),
  });
  return response.plan;
}

export async function createClaimInvite(planId: string, participantId: string) {
  return api<{ plan: SharedPlan; inviteToken: string }>('/api/plans', {
    method: 'POST',
    body: JSON.stringify({ action: 'mutate', planId, mutation: { type: 'createInvite', participantId } }),
  });
}

export async function mutateSharedPlan(planId: string, mutation: PlanMutation, keepalive = false) {
  const response = await api<{ plan: SharedPlan }>('/api/plans', {
    method: 'POST',
    keepalive,
    body: JSON.stringify({ action: 'mutate', planId, mutation }),
  });
  return response.plan;
}

export async function logoutSharedPlan(planId: string) {
  await api<{ ok: true }>('/api/plans', {
    method: 'POST',
    body: JSON.stringify({ action: 'logout', planId }),
  });
}

export async function deleteSharedPlan(planId: string) {
  await api<{ ok: true }>('/api/plans', {
    method: 'POST',
    body: JSON.stringify({ action: 'delete', planId }),
  });
}

export function planIdFromLocation() {
  return new URLSearchParams(window.location.search).get('plan');
}

export function inviteTokenFromLocation() {
  return new URLSearchParams(window.location.search).get('invite');
}

export function setPlanInLocation(planId?: string) {
  const url = new URL(window.location.href);
  if (planId) url.searchParams.set('plan', planId);
  else {
    url.searchParams.delete('plan');
    url.searchParams.delete('invite');
  }
  window.history.replaceState({}, '', url);
}

export function setInviteInLocation(inviteToken?: string) {
  const url = new URL(window.location.href);
  if (inviteToken) url.searchParams.set('invite', inviteToken);
  else url.searchParams.delete('invite');
  window.history.replaceState({}, '', url);
}

