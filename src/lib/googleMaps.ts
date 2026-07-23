import type { Coordinate, LocationValue } from '../types';
import {
  appendSingapore,
  SINGAPORE_BOUNDS,
} from './location';

let googleMapsPromise: Promise<typeof google> | undefined;

export function getGoogleMapsApiKey(): string {
  return String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
}

export function loadGoogleMaps(): Promise<typeof google> {
  if (window.google?.maps) return Promise.resolve(window.google);
  if (googleMapsPromise) return googleMapsPromise;

  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) {
    return Promise.reject(
      new Error('VITE_GOOGLE_MAPS_API_KEY is not configured.'),
    );
  }

  googleMapsPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-meet-where-google-maps]',
    );

    const onReady = () => {
      if (window.google?.maps) {
        resolve(window.google);
      } else {
        reject(new Error('Google Maps loaded without the expected API.'));
      }
    };

    if (existingScript) {
      existingScript.addEventListener('load', onReady, { once: true });
      existingScript.addEventListener(
        'error',
        () => reject(new Error('Could not load Google Maps.')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.dataset.meetWhereGoogleMaps = 'true';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&v=weekly&loading=async&auth_referrer_policy=origin`;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', onReady, { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error('Could not load Google Maps. Check the API key restrictions.')),
      { once: true },
    );
    document.head.appendChild(script);
  });

  return googleMapsPromise;
}

export async function geocodeLocation(
  location: LocationValue,
): Promise<LocationValue> {
  const maps = await loadGoogleMaps();
  const { Geocoder } = (await maps.maps.importLibrary(
    'geocoding',
  )) as google.maps.GeocodingLibrary;
  const geocoder = new Geocoder();
  const response = await geocoder.geocode({
    address: appendSingapore(location.query),
    bounds: SINGAPORE_BOUNDS,
    componentRestrictions: { country: 'SG' },
    region: 'sg',
  });

  const result = response.results[0];
  if (!result?.geometry?.location) {
    throw new Error(`No Singapore result found for “${location.query}”.`);
  }

  return {
    query: location.query,
    label: result.formatted_address,
    placeId: result.place_id,
    lat: result.geometry.location.lat(),
    lng: result.geometry.location.lng(),
    status: 'resolved',
  };
}

export async function reverseGeocode(
  coordinate: Coordinate,
): Promise<string> {
  try {
    const maps = await loadGoogleMaps();
    const { Geocoder } = (await maps.maps.importLibrary(
      'geocoding',
    )) as google.maps.GeocodingLibrary;
    const geocoder = new Geocoder();
    const response = await geocoder.geocode({
      location: coordinate,
      region: 'sg',
    });

    return (
      response.results[0]?.formatted_address ||
      `${coordinate.lat.toFixed(6)}, ${coordinate.lng.toFixed(6)}`
    );
  } catch {
    return `${coordinate.lat.toFixed(6)}, ${coordinate.lng.toFixed(6)}`;
  }
}
