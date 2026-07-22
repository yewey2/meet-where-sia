import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { LocationValue, MrtStation } from '../types';
import {
  appendSingapore,
  hasCoordinates,
  SINGAPORE_BOUNDS,
} from '../lib/location';
import {
  getGoogleMapsApiKey,
  loadGoogleMaps,
} from '../lib/googleMaps';
import { CheckIcon, SearchIcon } from './Icons';

interface LocationInputProps {
  label: string;
  value: LocationValue;
  onChange: (next: LocationValue) => void;
  disabled?: boolean;
  placeholder?: string;
  error?: string;
  stations?: MrtStation[];
}

interface GoogleSuggestionItem {
  source: 'google';
  prediction: google.maps.places.PlacePrediction;
  primary: string;
  secondary: string;
  fullText: string;
}

interface StationSuggestionItem {
  source: 'station';
  station: MrtStation;
  primary: string;
  secondary: string;
  fullText: string;
}

type SuggestionItem = GoogleSuggestionItem | StationSuggestionItem;

function stationMatches(query: string, station: MrtStation): boolean {
  const words = query
    .toLowerCase()
    .replace(/\b(?:mrt|lrt|station)\b/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const name = station.name.toLowerCase();
  return words.length > 0 && words.every((word) => name.includes(word));
}

export function LocationInput({
  label,
  value,
  onChange,
  disabled = false,
  placeholder = 'Search a place or postal code',
  error,
  stations = [],
}: LocationInputProps) {
  const listId = useId();
  const requestIdRef = useRef(0);
  const sessionTokenRef =
    useRef<google.maps.places.AutocompleteSessionToken | undefined>(undefined);
  const blurTimerRef = useRef<number | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selectionError, setSelectionError] = useState('');
  const hasApiKey = Boolean(getGoogleMapsApiKey());

  useEffect(() => {
    if (
      disabled ||
      value.query.trim().length < 2 ||
      value.status === 'resolved'
    ) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    const stationSuggestions: StationSuggestionItem[] = stations
      .filter((station) => stationMatches(value.query, station))
      .slice(0, 5)
      .map((station) => ({
        source: 'station',
        station,
        primary: station.name,
        secondary: `Official ${station.network} station`,
        fullText: `${station.name} ${station.network}`,
      }));

    if (!hasApiKey) {
      setSuggestions(stationSuggestions);
      setActiveIndex(-1);
      setIsOpen(stationSuggestions.length > 0);
      setIsLoading(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setSelectionError('');

      try {
        const maps = await loadGoogleMaps();
        const { AutocompleteSessionToken, AutocompleteSuggestion } =
          (await maps.maps.importLibrary(
            'places',
          )) as google.maps.PlacesLibrary;

        sessionTokenRef.current ||= new AutocompleteSessionToken();
        const response =
          await AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: appendSingapore(value.query),
            includedRegionCodes: ['sg'],
            locationRestriction: SINGAPORE_BOUNDS,
            language: 'en-SG',
            region: 'sg',
            sessionToken: sessionTokenRef.current,
          });

        if (requestIdRef.current !== currentRequestId) return;

        const googleSuggestions = response.suggestions
          .map((suggestion): GoogleSuggestionItem | undefined => {
            const prediction = suggestion.placePrediction;
            if (!prediction) return undefined;

            return {
              source: 'google',
              prediction,
              primary: prediction.mainText?.toString() || prediction.text.toString(),
              secondary: prediction.secondaryText?.toString() || '',
              fullText: prediction.text.toString(),
            };
          })
          .filter((item): item is GoogleSuggestionItem => Boolean(item));

        const nextSuggestions: SuggestionItem[] = [
          ...stationSuggestions,
          ...googleSuggestions,
        ].slice(0, 8);

        setSuggestions(nextSuggestions);
        setActiveIndex(-1);
        setIsOpen(nextSuggestions.length > 0);
      } catch (requestError) {
        if (requestIdRef.current !== currentRequestId) return;
        setSuggestions([]);
        setIsOpen(false);
        setSelectionError(
          requestError instanceof Error
            ? requestError.message
            : 'Google place suggestions are unavailable.',
        );
      } finally {
        if (requestIdRef.current === currentRequestId) {
          setIsLoading(false);
        }
      }
    }, 320);

    return () => window.clearTimeout(timer);
  }, [disabled, hasApiKey, stations, value.query, value.status]);

  useEffect(
    () => () => {
      if (blurTimerRef.current) window.clearTimeout(blurTimerRef.current);
    },
    [],
  );

  async function selectSuggestion(item: SuggestionItem) {
    setIsLoading(true);
    setSelectionError('');

    try {
      if (item.source === 'station') {
        onChange({
          query: item.fullText,
          label: item.fullText,
          placeId: `station:${item.station.id}`,
          lat: item.station.lat,
          lng: item.station.lng,
          status: 'resolved',
        });
        setSuggestions([]);
        setIsOpen(false);
        setActiveIndex(-1);
        return;
      }

      const place = item.prediction.toPlace();
      await place.fetchFields({
        fields: ['id', 'displayName', 'formattedAddress', 'location'],
      });

      if (!place.location) {
        throw new Error('That result did not include map coordinates.');
      }

      onChange({
        query: place.displayName || item.primary,
        label: place.formattedAddress || item.fullText,
        placeId: place.id,
        lat: place.location.lat(),
        lng: place.location.lng(),
        status: 'resolved',
      });

      sessionTokenRef.current = undefined;
      setSuggestions([]);
      setIsOpen(false);
      setActiveIndex(-1);
    } catch (requestError) {
      setSelectionError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not resolve that place.',
      );
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen || suggestions.length === 0) {
      if (event.key === 'Escape') setIsOpen(false);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) =>
        current >= suggestions.length - 1 ? 0 : current + 1,
      );
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1,
      );
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      void selectSuggestion(suggestions[activeIndex]);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
    }
  }

  const resolved = value.status === 'resolved' && hasCoordinates(value);
  const visibleError =
    error ||
    selectionError ||
    (value.status === 'error'
      ? 'Try a more specific Singapore place or choose a suggestion.'
      : '');

  return (
    <div className="location-field">
      <label className="field-label" htmlFor={`${listId}-input`}>
        {label}
      </label>
      <div
        className={`location-input-wrap ${
          visibleError ? 'has-error' : ''
        } ${resolved ? 'is-resolved' : ''}`}
      >
        <SearchIcon className="field-leading-icon" />
        <input
          id={`${listId}-input`}
          type="text"
          value={value.query}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={`${listId}-listbox`}
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
          }
          aria-invalid={Boolean(visibleError)}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          onBlur={() => {
            blurTimerRef.current = window.setTimeout(
              () => setIsOpen(false),
              160,
            );
          }}
          onKeyDown={handleKeyDown}
          onChange={(event) => {
            const query = event.target.value;
            onChange({
              query,
              status: query.trim() ? 'dirty' : 'empty',
            });
            setSelectionError('');
          }}
        />
        {isLoading ? (
          <span className="input-spinner" aria-label="Searching" />
        ) : resolved ? (
          <CheckIcon className="field-status-icon" />
        ) : null}

        {isOpen && suggestions.length > 0 ? (
          <div className="suggestions-popover">
            <div
              id={`${listId}-listbox`}
              className="suggestions-list"
              role="listbox"
            >
              {suggestions.map((item, index) => (
                <button
                  id={`${listId}-option-${index}`}
                  key={
                    item.source === 'station'
                      ? `station-${item.station.id}`
                      : `google-${item.prediction.placeId}-${index}`
                  }
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`suggestion-row ${
                    index === activeIndex ? 'is-active' : ''
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => void selectSuggestion(item)}
                >
                  <span className="suggestion-pin" aria-hidden="true" />
                  <span>
                    <strong>{item.primary}</strong>
                    {item.secondary ? <small>{item.secondary}</small> : null}
                  </span>
                </button>
              ))}
            </div>
            <div className="suggestions-footer">
              {hasApiKey
                ? 'Official rail stations + Google places'
                : 'Official LTA rail stations'}
            </div>
          </div>
        ) : null}
      </div>
      {visibleError ? (
        <p className="field-message error-message">{visibleError}</p>
      ) : value.query && value.status !== 'resolved' ? (
        <p className="field-message">
          {hasApiKey
            ? `Will search as “${appendSingapore(value.query)}”`
            : 'Choose an official station suggestion or enter latitude, longitude.'}
        </p>
      ) : value.label && value.label !== value.query ? (
        <p className="field-message resolved-message">{value.label}</p>
      ) : null}
    </div>
  );
}
