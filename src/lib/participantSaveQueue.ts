import type { Participant } from '../types';

type SaveParticipant = (participant: Participant, keepalive: boolean) => Promise<void>;

export class ParticipantSaveQueue {
  private readonly pending = new Map<string, Participant>();
  private readonly timers = new Map<string, number>();
  private operation: Promise<void> = Promise.resolve();

  constructor(
    private save: SaveParticipant,
    private readonly onBackgroundError: (error: unknown) => void,
    private readonly delay = 650,
  ) {}

  setSave(save: SaveParticipant) {
    this.save = save;
  }

  get hasPending() {
    return this.pending.size > 0 || this.timers.size > 0;
  }

  schedule(participant: Participant) {
    const existing = this.timers.get(participant.id);
    if (existing !== undefined) window.clearTimeout(existing);
    this.pending.set(participant.id, participant);
    const timer = window.setTimeout(() => {
      this.timers.delete(participant.id);
      // Participant payloads are small; keepalive also protects a request that
      // started just before the tab navigates away.
      void this.enqueue([participant.id], true).catch(this.onBackgroundError);
    }, this.delay);
    this.timers.set(participant.id, timer);
  }

  flush(keepalive = false) {
    const participantIds = [...this.pending.keys()];
    this.clearTimers(participantIds);
    return this.enqueue(participantIds, keepalive);
  }

  cancel() {
    this.clearTimers([...this.timers.keys()]);
    this.pending.clear();
  }

  private clearTimers(participantIds: string[]) {
    participantIds.forEach((participantId) => {
      const timer = this.timers.get(participantId);
      if (timer !== undefined) window.clearTimeout(timer);
      this.timers.delete(participantId);
    });
  }

  private enqueue(participantIds: string[], keepalive: boolean) {
    if (participantIds.length === 0) return this.operation;
    const next = this.operation.then(async () => {
      for (const participantId of participantIds) {
        const participant = this.pending.get(participantId);
        if (!participant) continue;
        this.pending.delete(participantId);
        try {
          await this.save(participant, keepalive);
        } catch (error) {
          // Preserve a failed value for the next blur/page-hide flush, but never
          // replace a newer edit that was scheduled while this request ran.
          if (!this.pending.has(participantId)) this.pending.set(participantId, participant);
          throw error;
        }
      }
    });
    this.operation = next.catch(() => undefined);
    return next;
  }
}
