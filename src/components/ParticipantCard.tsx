import type { MrtStation, Participant } from '../types';
import { TrashIcon } from './Icons';
import { LocationInput } from './LocationInput';

interface ParticipantCardProps {
  participant: Participant;
  index: number;
  stations: MrtStation[];
  canRemove: boolean;
  onChange: (next: Participant) => void;
  onRemove: () => void;
}

export function ParticipantCard({
  participant,
  index,
  stations,
  canRemove,
  onChange,
  onRemove,
}: ParticipantCardProps) {
  const displayName = participant.name.trim() || `Person ${index + 1}`;

  return (
    <article className="participant-card">
      <div className="participant-heading">
        <div className="participant-number" aria-hidden="true">
          {index + 1}
        </div>
        <div className="participant-name-field">
          <label htmlFor={`${participant.id}-name`}>Person</label>
          <input
            id={`${participant.id}-name`}
            type="text"
            value={participant.name}
            placeholder={`Person ${index + 1}`}
            onChange={(event) =>
              onChange({ ...participant, name: event.target.value })
            }
          />
        </div>
        <button
          type="button"
          className="icon-button remove-person"
          aria-label={`Remove ${displayName}`}
          title={`Remove ${displayName}`}
          disabled={!canRemove}
          onClick={onRemove}
        >
          <TrashIcon />
        </button>
      </div>

      <div className="route-fields">
        <div className="route-rail" aria-hidden="true">
          <span className="route-dot start-dot" />
          <span className="route-line" />
          <span className="route-dot end-dot" />
        </div>
        <div className="route-inputs">
          <LocationInput
            label="Starting point"
            value={participant.start}
            placeholder="e.g. Senja LRT"
            stations={stations}
            onChange={(start) =>
              onChange({
                ...participant,
                start,
                end: participant.sameAsStart ? { ...start } : participant.end,
              })
            }
          />

          <label className="same-location-control">
            <input
              type="checkbox"
              checked={participant.sameAsStart}
              onChange={(event) => {
                const sameAsStart = event.target.checked;
                onChange({
                  ...participant,
                  sameAsStart,
                  end: sameAsStart
                    ? { ...participant.start }
                    : {
                        query: '',
                        status: 'empty',
                      },
                });
              }}
            />
            <span>End at the same place</span>
          </label>

          <LocationInput
            label="Ending point"
            value={participant.sameAsStart ? participant.start : participant.end}
            disabled={participant.sameAsStart}
            placeholder="e.g. ION Orchard or 425-500"
            stations={stations}
            onChange={(end) => onChange({ ...participant, end })}
          />
        </div>
      </div>
    </article>
  );
}
