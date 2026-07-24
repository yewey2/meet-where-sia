import { useEffect, useMemo, useState } from 'react';
import { fetchNearbyPlaces } from '../lib/api';
import type {
  NearbyCategory,
  NearbyPlacesPayload,
  NearbyPlace,
  RailResult,
} from '../types';
import { ArrowUpRightIcon, MapPinIcon, SparkIcon } from './Icons';

const SEARCH_RADIUS_KM = 1.5;

const CATEGORIES: Array<{
  id: NearbyCategory;
  label: string;
  search: string;
  ctaLabel: string;
  emptyMessage: string;
}> = [
  {
    id: 'food',
    label: 'Eat',
    search: 'food',
    ctaLabel: 'See more food options',
    emptyMessage: 'No official hawker-centre picks were found within this radius.',
  },
  {
    id: 'cafe',
    label: 'Coffee',
    search: 'cafes',
    ctaLabel: 'See live cafe options',
    emptyMessage: 'Cafe listings change often, so open current results in Google Maps.',
  },
  {
    id: 'activity',
    label: 'Things to do',
    search: 'things to do',
    ctaLabel: 'See more activities',
    emptyMessage: 'No official attraction picks were found within this radius.',
  },
  {
    id: 'outdoors',
    label: 'Outdoors',
    search: 'parks and outdoor activities',
    ctaLabel: 'See outdoor options',
    emptyMessage: 'No official outdoor picks were found within this radius.',
  },
];

function googleMapsSearch(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function formatDistance(distanceKm: number): string {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
  return `${distanceKm.toFixed(1)} km`;
}

function placeMapsUrl(place: NearbyPlace): string {
  return googleMapsSearch(
    [place.name, place.address, 'Singapore'].filter(Boolean).join(', '),
  );
}

export function NearbyDiscovery({ result }: { result: RailResult }) {
  const [activeCategory, setActiveCategory] =
    useState<NearbyCategory>('food');
  const [payload, setPayload] = useState<NearbyPlacesPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const stationLabel = `${result.station.name} ${result.station.network}`;

  useEffect(() => {
    const controller = new AbortController();
    setActiveCategory('food');
    setPayload(null);
    setIsLoading(true);
    setLoadError(false);

    void fetchNearbyPlaces(
      result.lat,
      result.lng,
      SEARCH_RADIUS_KM,
      controller.signal,
    )
      .then(setPayload)
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setLoadError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [result.lat, result.lng]);

  const category =
    CATEGORIES.find((item) => item.id === activeCategory) || CATEGORIES[0];
  const places = useMemo(
    () =>
      (payload?.places || [])
        .filter((place) => place.category === activeCategory)
        .slice(0, 3),
    [activeCategory, payload],
  );
  const categoryMapsUrl = googleMapsSearch(
    `${category.search} near ${stationLabel}, Singapore`,
  );

  return (
    <section className="nearby-discovery" aria-labelledby="nearby-title">
      <div className="nearby-header">
        <div>
          <div className="nearby-kicker">
            <SparkIcon /> Make a plan
          </div>
          <h3 id="nearby-title">What’s near {result.station.name}?</h3>
        </div>
        <span className="nearby-radius">Within {SEARCH_RADIUS_KM} km</span>
      </div>

      <div
        className="nearby-tabs"
        role="tablist"
        aria-label={`Explore around ${stationLabel}`}
      >
        {CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={activeCategory === item.id}
            className={activeCategory === item.id ? 'is-selected' : ''}
            onClick={() => setActiveCategory(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="nearby-tab-panel" role="tabpanel" aria-live="polite">
        {isLoading ? (
          <div className="nearby-loading">
            <span className="button-spinner" aria-hidden="true" />
            Loading official nearby picks…
          </div>
        ) : places.length ? (
          <div className="nearby-place-list">
            {places.map((place) => (
              <a
                className="nearby-place"
                href={placeMapsUrl(place)}
                target="_blank"
                rel="noreferrer"
                key={place.id}
              >
                <span className="nearby-place-icon" aria-hidden="true">
                  <MapPinIcon />
                </span>
                <span className="nearby-place-copy">
                  <strong>{place.name}</strong>
                  {place.address ? <span>{place.address}</span> : null}
                  <small>
                    {place.source} official data
                    {place.detail ? ` · ${place.detail}` : ''}
                  </small>
                </span>
                <span className="nearby-place-distance">
                  {formatDistance(place.distanceKm)}
                  <ArrowUpRightIcon />
                </span>
              </a>
            ))}
          </div>
        ) : (
          <div className="nearby-empty">
            <strong>{loadError ? 'Official picks couldn’t load just now.' : category.emptyMessage}</strong>
            <span>Use the live search below for more choices and current hours.</span>
          </div>
        )}

        <a
          className="nearby-search-button"
          href={categoryMapsUrl}
          target="_blank"
          rel="noreferrer"
        >
          {category.ctaLabel} near {result.station.name}
          <ArrowUpRightIcon />
        </a>
      </div>

      {payload?.sources.length ? (
        <p className="nearby-source-note">
          Picks use{' '}
          {payload.sources.map((source, index) => (
            <span key={source.id}>
              {index ? ' and ' : ''}
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.label}
              </a>
            </span>
          ))}
          . Distances are straight-line; verify hours before heading over.
        </p>
      ) : null}
    </section>
  );
}
