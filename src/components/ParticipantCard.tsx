import type { MrtStation, Participant } from '../types';
import { TrashIcon } from './Icons';
import { LocationInput } from './LocationInput';

interface ParticipantCardProps {
  participant: Participant;
  index: number;
  stations: MrtStation[];
  canRemove: boolean;
  onChange: (next: Participant) => void;
  canEditName: boolean;
  readOnly: boolean;
  onRemove: () => void;
}

export function ParticipantCard({
  participant,
  index,
  stations,
  canRemove,
  onChange,
  onRemove,
  canEditName,
  readOnly,
}: ParticipantCardProps) {
  const displayName = participant.name.trim() || `Person ${index + 1}`;
  const namePlaceholder = index === 0 ? 'You' : `Friend ${index + 1}`;

  return (
    <article className="participant-card" aria-label={`Person ${index + 1}: ${displayName}`}>
      <div className="participant-heading">
        <div className="participant-number" aria-hidden="true">
          {index + 1}
        </div>
        <div className="participant-name-field">
          <label htmlFor={`${participant.id}-name`}>Name <span>(optional)</span></label>
          <input
            id={`${participant.id}-name`}
            disabled={!canEditName}
            type="text"
            value={participant.name}
            placeholder={namePlaceholder}
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
          disabled={readOnly || !canRemove}
          onClick={onRemove}
        >
          <TrashIcon />
        </button>
      </div>

      <div
        className={`route-fields ${
          participant.sameAsStart ? 'route-fields-single' : ''
        }`}
      >
        <div className="route-rail" aria-hidden="true">
          <span className="route-dot start-dot" />
          {!participant.sameAsStart ? (
            <>
              <span className="route-line" />
              <span className="route-dot end-dot" />
            </>
          ) : null}
        </div>
        <div className="route-inputs">
          <LocationInput
            label="Coming from"
            value={participant.start}
            placeholder="MRT/LRT, landmark or 6-digit postal code"
            stations={stations}
            disabled={readOnly}
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
              disabled={readOnly}
              checked={!participant.sameAsStart}
              onChange={(event) => {
                const sameAsStart = !event.target.checked;
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
            <span>Different place after the meetup?</span>
          </label>

          {!participant.sameAsStart ? (
            <LocationInput
              label="Heading to after"
              value={participant.end}
              placeholder="MRT/LRT, landmark or 6-digit postal code"
              stations={stations}
              disabled={readOnly}
              onChange={(end) => onChange({ ...participant, end })}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
