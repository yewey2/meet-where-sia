import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MrtStation, Participant } from '../types';
import {
  PARTICIPANT_COLORS,
  participantColorOption,
} from '../lib/participantColors';
import { participantIdentityPresentation } from '../lib/participantPresentation';
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
  isCurrentUser?: boolean;
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
  isCurrentUser,
}: ParticipantCardProps) {
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const displayName = participant.name.trim() || `Person ${index + 1}`;
  const namePlaceholder = index === 0 ? 'You' : `Friend ${index + 1}`;
  const selectedColor = participantColorOption(participant.color);
  const participantStyle = {
    '--participant-light': selectedColor.light,
    '--participant-dark': selectedColor.dark,
  } as CSSProperties;
  const identity = participantIdentityPresentation(index, displayName, Boolean(isCurrentUser));

  useEffect(() => {
    if (!colorPickerOpen) return;

    function closeOnOutsidePress(event: PointerEvent) {
      if (!colorPickerRef.current?.contains(event.target as Node)) {
        setColorPickerOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setColorPickerOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutsidePress, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [colorPickerOpen]);

  useEffect(() => {
    if (readOnly) setColorPickerOpen(false);
  }, [readOnly]);

  return (
    <article
      className={identity.className}
      aria-label={identity.ariaLabel}
      style={participantStyle}
    >
      <div className="participant-heading">
        <div className="participant-number" aria-hidden="true">
          {index + 1}
        </div>
        <div className="participant-name-field">
          <label htmlFor={`${participant.id}-name`}>
            Name <span>(optional)</span>
            {identity.badge ? <span className="current-user-badge">{identity.badge}</span> : null}
          </label>
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

      <div className="participant-color-picker" ref={colorPickerRef}>
        <button
          type="button"
          className="participant-color-trigger"
          aria-expanded={colorPickerOpen}
          aria-controls={`${participant.id}-color-options`}
          disabled={readOnly}
          onClick={() => setColorPickerOpen((open) => !open)}
        >
          <span
            className="participant-color-swatch"
            style={{
              '--swatch-light': selectedColor.light,
              '--swatch-dark': selectedColor.dark,
            } as CSSProperties}
            aria-hidden="true"
          />
          <span>Map colour</span>
          <small>{selectedColor.label}</small>
        </button>
        {colorPickerOpen ? (
          <div
            className="participant-color-options"
            id={`${participant.id}-color-options`}
            role="group"
            aria-label={`Map colour for ${displayName}`}
          >
            {PARTICIPANT_COLORS.map((color) => (
              <button
                type="button"
                key={color.id}
                className="participant-color-option"
                style={{
                  '--swatch-light': color.light,
                  '--swatch-dark': color.dark,
                } as CSSProperties}
                aria-label={`Use ${color.label} for ${displayName}`}
                aria-pressed={participant.color === color.id}
                title={`${color.label}: light start, dark end`}
                disabled={readOnly}
                onClick={() => {
                  onChange({ ...participant, color: color.id });
                  setColorPickerOpen(false);
                }}
              />
            ))}
          </div>
        ) : null}
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
            <span className="same-location-toggle" aria-hidden="true" />
            <span className="same-location-label">Different place after the meetup?</span>
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
