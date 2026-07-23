import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { EndpointPoint, MeetingResult } from '../types';
import { getGoogleMapsApiKey } from '../lib/googleMaps';
import {
  createGoogleMapTilesSession,
  fetchGoogleMapAttribution,
  googleMapTileUrl,
} from '../lib/googleMapTiles';
import { SINGAPORE_CENTER } from '../lib/location';

interface MapPanelProps {
  points: EndpointPoint[];
  result: MeetingResult | null;
}

type MarkerKind = 'start' | 'end' | 'result' | 'alternative';
type MapProvider = 'google' | 'openstreetmap';

const GOOGLE_MAPS_ATTRIBUTION =
  '<span class="google-maps-attribution" translate="no">Google Maps</span>';
const OPENSTREETMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[character] || character,
  );
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

function addOpenStreetMapLayer(map: L.Map) {
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: OPENSTREETMAP_ATTRIBUTION,
    maxZoom: 19,
  }).addTo(map);
}

export function MapPanel({ points, result }: MapPanelProps) {
  const apiKey = useMemo(getGoogleMapsApiKey, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | undefined>(undefined);
  const overlaysRef = useRef<L.LayerGroup | undefined>(undefined);
  const [isReady, setIsReady] = useState(false);
  const [provider, setProvider] = useState<MapProvider>(
    apiKey ? 'google' : 'openstreetmap',
  );
  const [providerNotice, setProviderNotice] = useState('');

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    let map: L.Map | undefined;
    let attributionRequest: AbortController | undefined;
    const setupRequest = new AbortController();

    void (async () => {
      map = L.map(containerRef.current as HTMLDivElement, {
        attributionControl: true,
        zoomControl: true,
      }).setView([SINGAPORE_CENTER.lat, SINGAPORE_CENTER.lng], 11);

      if (apiKey) {
        try {
          const tileSession = await createGoogleMapTilesSession(
            apiKey,
            setupRequest.signal,
          );
          if (cancelled || !map) return;

          L.tileLayer(googleMapTileUrl(apiKey, tileSession.session), {
            attribution: GOOGLE_MAPS_ATTRIBUTION,
            maxZoom: 22,
          }).addTo(map);
          setProvider('google');

          let currentCopyright = '';
          const updateAttribution = () => {
            if (!map) return;
            attributionRequest?.abort();
            attributionRequest = new AbortController();
            const bounds = map.getBounds();
            void fetchGoogleMapAttribution(
              apiKey,
              tileSession.session,
              {
                north: bounds.getNorth(),
                south: bounds.getSouth(),
                east: bounds.getEast(),
                west: bounds.getWest(),
              },
              map.getZoom(),
              attributionRequest.signal,
            )
              .then((copyright) => {
                if (!map || !copyright || copyright === currentCopyright) return;
                if (currentCopyright) {
                  map.attributionControl.removeAttribution(currentCopyright);
                }
                currentCopyright = escapeHtml(copyright);
                map.attributionControl.addAttribution(currentCopyright);
              })
              .catch(() => {
                // The permanent Google Maps attribution remains visible even if
                // the viewport metadata request is temporarily unavailable.
              });
          };

          map.on('moveend', updateAttribution);
          updateAttribution();
        } catch (error) {
          if (cancelled || !map) return;
          console.warn('Google Maps tiles were unavailable.', error);
          addOpenStreetMapLayer(map);
          setProvider('openstreetmap');
          setProviderNotice('Google Maps is unavailable. Showing the backup map.');
        }
      } else {
        addOpenStreetMapLayer(map);
        setProvider('openstreetmap');
      }

      if (cancelled || !map) return;
      mapRef.current = map;
      overlaysRef.current = L.layerGroup().addTo(map);
      setIsReady(true);
    })();

    return () => {
      cancelled = true;
      setupRequest.abort();
      attributionRequest?.abort();
      map?.remove();
      mapRef.current = undefined;
      overlaysRef.current = undefined;
    };
  }, [apiKey]);

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
        aria-label={`${
          provider === 'google' ? 'Google Maps' : 'OpenStreetMap'
        } map of participant locations and meeting point`}
      />
      {!isReady ? (
        <div className="map-loading" role="status">
          <span className="input-spinner" /> Loading map…
        </div>
      ) : null}
      {providerNotice ? (
        <div className="map-provider-notice" role="status">
          {providerNotice}
        </div>
      ) : null}
      <MapLegend />
    </div>
  );
}
