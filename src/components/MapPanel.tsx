import { useEffect, useRef, useState } from 'react';
import type { EndpointPoint, MeetingResult } from '../types';
import {
  getGoogleMapId,
  getGoogleMapsApiKey,
  loadGoogleMaps,
} from '../lib/googleMaps';
import { SINGAPORE_CENTER } from '../lib/location';
import { MapPinIcon } from './Icons';

interface MapPanelProps {
  points: EndpointPoint[];
  result: MeetingResult | null;
}

interface MapOverlays {
  markers: google.maps.marker.AdvancedMarkerElement[];
  lines: google.maps.Polyline[];
  circles: google.maps.Circle[];
}

function markerElement(
  kind: 'start' | 'end' | 'result' | 'alternative',
  text: string,
) {
  const element = document.createElement('div');
  element.className = `map-marker map-marker-${kind}`;
  element.textContent = text;
  return element;
}

export function MapPanel({ points, result }: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | undefined>(undefined);
  const overlaysRef = useRef<MapOverlays>({ markers: [], lines: [], circles: [] });
  const [loadError, setLoadError] = useState('');
  const [isReady, setIsReady] = useState(false);
  const hasApiKey = Boolean(getGoogleMapsApiKey());

  useEffect(() => {
    if (!hasApiKey || !containerRef.current || mapRef.current) return;
    let cancelled = false;

    void (async () => {
      try {
        const maps = await loadGoogleMaps();
        const { Map } = (await maps.maps.importLibrary(
          'maps',
        )) as google.maps.MapsLibrary;
        await maps.maps.importLibrary('marker');

        if (cancelled || !containerRef.current) return;

        mapRef.current = new Map(containerRef.current, {
          center: SINGAPORE_CENTER,
          zoom: 11,
          mapId: getGoogleMapId(),
          disableDefaultUI: true,
          zoomControl: true,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });
        setIsReady(true);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : 'The Google map could not be loaded.',
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasApiKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isReady) return;
    let cancelled = false;

    void (async () => {
      const maps = await loadGoogleMaps();
      const { AdvancedMarkerElement } = (await maps.maps.importLibrary(
        'marker',
      )) as google.maps.MarkerLibrary;

      for (const marker of overlaysRef.current.markers) marker.map = null;
      for (const line of overlaysRef.current.lines) line.setMap(null);
      for (const circle of overlaysRef.current.circles) circle.setMap(null);
      overlaysRef.current = { markers: [], lines: [], circles: [] };

      if (cancelled) return;

      const bounds = new maps.maps.LatLngBounds();
      const markers: google.maps.marker.AdvancedMarkerElement[] = [];
      const lines: google.maps.Polyline[] = [];
      const circles: google.maps.Circle[] = [];

      for (const point of points) {
        const marker = new AdvancedMarkerElement({
          map,
          position: { lat: point.lat, lng: point.lng },
          title: `${point.participantName}: ${
            point.kind === 'start' ? 'start' : 'end'
          } — ${point.label}`,
          content: markerElement(
            point.kind,
            point.kind === 'start' ? 'S' : 'E',
          ),
          zIndex: 5,
        });
        markers.push(marker);
        bounds.extend({ lat: point.lat, lng: point.lng });

        if (result) {
          const line = new maps.maps.Polyline({
            map,
            path: [
              { lat: point.lat, lng: point.lng },
              { lat: result.lat, lng: result.lng },
            ],
            geodesic: true,
            strokeColor: '#7b8090',
            strokeOpacity: 0.34,
            strokeWeight: 1.5,
            clickable: false,
          });
          lines.push(line);
        }
      }

      if (result) {
        const resultMarker = new AdvancedMarkerElement({
          map,
          position: { lat: result.lat, lng: result.lng },
          title: result.title,
          content: markerElement('result', result.mode === 'rail' ? 'M' : '★'),
          zIndex: 20,
        });
        markers.push(resultMarker);
        bounds.extend({ lat: result.lat, lng: result.lng });

        if (result.mode === 'rail') {
          const radiusCircle = new maps.maps.Circle({
            map,
            center: result.center,
            radius: result.radiusKm * 1000,
            strokeColor: '#5d50c6',
            strokeOpacity: 0.7,
            strokeWeight: 1.5,
            fillColor: '#7c6ee6',
            fillOpacity: 0.08,
            clickable: false,
          });
          circles.push(radiusCircle);
          const circleBounds = radiusCircle.getBounds();
          if (circleBounds) bounds.union(circleBounds);

          for (const alternative of result.alternatives.slice(1, 4)) {
            const alternativeMarker = new AdvancedMarkerElement({
              map,
              position: { lat: alternative.lat, lng: alternative.lng },
              title: `${alternative.name} ${alternative.network}`,
              content: markerElement('alternative', 'M'),
              zIndex: 2,
            });
            markers.push(alternativeMarker);
            bounds.extend({ lat: alternative.lat, lng: alternative.lng });
          }
        }
      }

      overlaysRef.current = { markers, lines, circles };

      if (points.length === 0 && !result) {
        map.setCenter(SINGAPORE_CENTER);
        map.setZoom(11);
      } else if (!bounds.isEmpty()) {
        map.fitBounds(bounds, 68);
        window.setTimeout(() => {
          if ((map.getZoom() || 0) > 15) map.setZoom(15);
        }, 120);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isReady, points, result]);

  if (!hasApiKey || loadError) {
    return (
      <div className="map-fallback" role="img" aria-label="Singapore map preview">
        <div className="map-fallback-grid" />
        <div className="map-fallback-shape" />
        <div className="fallback-pin fallback-pin-one">S</div>
        <div className="fallback-pin fallback-pin-two">E</div>
        <div className="fallback-pin fallback-pin-center">★</div>
        <div className="map-fallback-message">
          <MapPinIcon />
          <strong>{loadError ? 'Map unavailable' : 'Live map is optional'}</strong>
          <span>
            {loadError ||
              'The planner works with station names. Add a Google key for the live map and address search.'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="map-wrap">
      <div
        ref={containerRef}
        className="google-map"
        role="application"
        aria-label="Map of participant locations and meeting point"
      />
      {!isReady ? (
        <div className="map-loading">
          <span className="input-spinner" /> Loading map…
        </div>
      ) : null}
      <div className="map-legend" aria-label="Map legend">
        <span><i className="legend-dot legend-start" />Start</span>
        <span><i className="legend-dot legend-end" />End</span>
        <span><i className="legend-dot legend-result" />Meeting point</span>
        {result?.mode === 'rail' ? (
          <span><i className="legend-radius" />Search radius</span>
        ) : null}
      </div>
    </div>
  );
}
