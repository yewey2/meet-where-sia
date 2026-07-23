import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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

type MarkerKind = 'start' | 'end' | 'result' | 'alternative';

interface GoogleMapOverlays {
  markers: google.maps.marker.AdvancedMarkerElement[];
  lines: google.maps.Polyline[];
}

function markerElement(kind: MarkerKind, text: string) {
  const element = document.createElement('div');
  element.className = `map-marker map-marker-${kind}`;
  element.textContent = text;
  return element;
}

function leafletMarkerIcon(kind: MarkerKind, text: string) {
  const size = kind === 'result' ? 39 : kind === 'alternative' ? 25 : 30;
  const element = markerElement(kind, text);

  return L.divIcon({
    className: 'leaflet-map-marker',
    html: element.outerHTML,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function MapLegend() {
  return (
    <div className="map-legend" aria-label="Map legend">
      <span><i className="legend-dot legend-start" />Start</span>
      <span><i className="legend-dot legend-end" />End</span>
      <span><i className="legend-dot legend-result" />Meeting point</span>
    </div>
  );
}

function OpenStreetMapPanel({ points, result }: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | undefined>(undefined);
  const overlaysRef = useRef<L.LayerGroup | undefined>(undefined);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      attributionControl: true,
      zoomControl: true,
    }).setView([SINGAPORE_CENTER.lat, SINGAPORE_CENTER.lng], 11);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    overlaysRef.current = L.layerGroup().addTo(map);
    setIsReady(true);

    return () => {
      map.remove();
      mapRef.current = undefined;
      overlaysRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const overlays = overlaysRef.current;
    if (!map || !overlays || !isReady) return;

    overlays.clearLayers();
    const bounds = L.latLngBounds([]);

    for (const point of points) {
      L.marker([point.lat, point.lng], {
        alt: `${point.participantName} ${point.kind}`,
        icon: leafletMarkerIcon(
          point.kind,
          point.kind === 'start' ? 'S' : 'E',
        ),
        keyboard: true,
        title: `${point.participantName}: ${
          point.kind === 'start' ? 'start' : 'end'
        } — ${point.label}`,
        zIndexOffset: 500,
      }).addTo(overlays);
      bounds.extend([point.lat, point.lng]);

      if (result) {
        L.polyline(
          [
            [point.lat, point.lng],
            [result.lat, result.lng],
          ],
          {
            color: '#7b8090',
            interactive: false,
            opacity: 0.34,
            weight: 1.5,
          },
        ).addTo(overlays);
      }
    }

    if (result) {
      L.marker([result.lat, result.lng], {
        alt: `Meeting point: ${result.title}`,
        icon: leafletMarkerIcon('result', result.mode === 'rail' ? 'M' : '★'),
        keyboard: true,
        title: result.title,
        zIndexOffset: 2000,
      }).addTo(overlays);
      bounds.extend([result.lat, result.lng]);

      if (result.mode === 'rail') {
        for (const alternative of result.alternatives.slice(1, 4)) {
          L.marker([alternative.lat, alternative.lng], {
            alt: `Alternative: ${alternative.name} ${alternative.network}`,
            icon: leafletMarkerIcon('alternative', 'M'),
            keyboard: true,
            title: `${alternative.name} ${alternative.network}`,
            zIndexOffset: 200,
          }).addTo(overlays);
          bounds.extend([alternative.lat, alternative.lng]);
        }
      }
    }

    map.invalidateSize({ pan: false });
    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        maxZoom: 15,
        padding: [68, 68],
      });
    } else {
      map.setView([SINGAPORE_CENTER.lat, SINGAPORE_CENTER.lng], 11);
    }
  }, [isReady, points, result]);

  return (
    <div className="map-wrap">
      <div
        ref={containerRef}
        className="map-canvas"
        role="application"
        aria-label="OpenStreetMap map of participant locations and meeting point"
      />
      {!isReady ? (
        <div className="map-loading">
          <span className="input-spinner" /> Loading map…
        </div>
      ) : null}
      <MapLegend />
    </div>
  );
}

function GoogleMapPanel({ points, result }: MapPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | undefined>(undefined);
  const overlaysRef = useRef<GoogleMapOverlays>({
    markers: [],
    lines: [],
  });
  const [loadError, setLoadError] = useState('');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
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
  }, []);

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
      overlaysRef.current = { markers: [], lines: [] };

      if (cancelled) return;

      const bounds = new maps.maps.LatLngBounds();
      const markers: google.maps.marker.AdvancedMarkerElement[] = [];
      const lines: google.maps.Polyline[] = [];

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

      overlaysRef.current = { markers, lines };

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

  if (loadError) {
    return (
      <div className="map-fallback" role="img" aria-label="Map unavailable">
        <div className="map-fallback-grid" />
        <div className="map-fallback-shape" />
        <div className="map-fallback-message">
          <MapPinIcon />
          <strong>Google map unavailable</strong>
          <span>{loadError}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="map-wrap">
      <div
        ref={containerRef}
        className="map-canvas"
        role="application"
        aria-label="Google map of participant locations and meeting point"
      />
      {!isReady ? (
        <div className="map-loading">
          <span className="input-spinner" /> Loading map…
        </div>
      ) : null}
      <MapLegend />
    </div>
  );
}

export function MapPanel(props: MapPanelProps) {
  return getGoogleMapsApiKey() ? (
    <GoogleMapPanel {...props} />
  ) : (
    <OpenStreetMapPanel {...props} />
  );
}
