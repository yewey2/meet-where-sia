import type { Participant } from '../types';

export type SharedPlanAccessMode = 'claim' | 'join' | 'login';

interface TriggerMember {
  displayName: string;
  username?: string;
  role: 'owner' | 'member';
}

export function sharedPlanAccessModes(
  hasClaimToken: boolean,
  joiningEnabled: boolean,
): SharedPlanAccessMode[] {
  return [
    ...(hasClaimToken ? ['claim' as const] : []),
    'login',
    ...(joiningEnabled ? ['join' as const] : []),
  ];
}

export function defaultSharedPlanAccessMode(
  hasClaimToken: boolean,
): SharedPlanAccessMode {
  return hasClaimToken ? 'claim' : 'login';
}

export function namedPlanParticipants(participants: readonly Participant[]) {
  const choices: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();

  for (const participant of participants) {
    const name = participant.name.trim();
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    choices.push({ id: participant.id, name });
  }

  return choices;
}

export function sharedPlanTriggerLabel(member: TriggerMember | null) {
  if (!member) return 'Join';
  if (member.role === 'owner') return 'Manage';
  return `My route · ${member.username || member.displayName}`;
}
