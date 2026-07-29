import type { Participant, ParticipantColor } from '../types';

export interface ParticipantColorOption {
  id: ParticipantColor;
  label: string;
  light: string;
  dark: string;
}

export const PARTICIPANT_COLORS: readonly ParticipantColorOption[] = [
  { id: 'coral', label: 'Coral', light: '#ffd9d5', dark: '#a82b27' },
  { id: 'orange', label: 'Orange', light: '#ffe1bd', dark: '#98500f' },
  { id: 'amber', label: 'Amber', light: '#ffecaa', dark: '#765600' },
  { id: 'green', label: 'Green', light: '#ccebdc', dark: '#176b4c' },
  { id: 'teal', label: 'Teal', light: '#c8ebe8', dark: '#12645f' },
  { id: 'cyan', label: 'Cyan', light: '#cfeaf4', dark: '#176278' },
  { id: 'blue', label: 'Blue', light: '#d8e7ff', dark: '#285caa' },
  { id: 'indigo', label: 'Indigo', light: '#dedcff', dark: '#4938aa' },
  { id: 'purple', label: 'Purple', light: '#eadbfa', dark: '#6c3b9b' },
  { id: 'pink', label: 'Pink', light: '#f6d8e7', dark: '#903b65' },
] as const;

const COLOR_IDS = new Set<ParticipantColor>(
  PARTICIPANT_COLORS.map((color) => color.id),
);

export function isParticipantColor(value: unknown): value is ParticipantColor {
  return typeof value === 'string' && COLOR_IDS.has(value as ParticipantColor);
}

export function participantColorOption(
  color: ParticipantColor,
): ParticipantColorOption {
  return PARTICIPANT_COLORS.find((option) => option.id === color)
    ?? PARTICIPANT_COLORS[0];
}

export function pickParticipantColor(
  usedColors: readonly ParticipantColor[],
  random: () => number = Math.random,
): ParticipantColor {
  const counts = new Map<ParticipantColor, number>(
    PARTICIPANT_COLORS.map((color) => [color.id, 0]),
  );
  for (const color of usedColors) {
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }

  const lowestUsage = Math.min(...counts.values());
  const choices = PARTICIPANT_COLORS.filter(
    (color) => counts.get(color.id) === lowestUsage,
  );
  const index = Math.min(
    choices.length - 1,
    Math.floor(Math.max(0, random()) * choices.length),
  );
  return choices[index].id;
}

function stableFraction(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

export function normalizeParticipantColors(
  participants: readonly Participant[],
): Participant[] {
  const used: ParticipantColor[] = [];
  return participants.map((participant) => {
    const color = isParticipantColor(participant.color)
      ? participant.color
      : pickParticipantColor(used, () => stableFraction(participant.id));
    used.push(color);
    return participant.color === color ? participant : { ...participant, color };
  });
}
