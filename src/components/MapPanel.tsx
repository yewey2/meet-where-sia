import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { EndpointPoint, MeetingResult, RankedStation } from '../types';
import { getGoogleMapsApiKey } from '../lib/googleMaps';
import {
  createGoogleMapTilesSession,
  fetchGoogleMapAttribution,
  googleMapTileUrl,
} from '../lib/googleMapTiles';
import { SINGAPORE_CENTER } from '../lib/location';
import {
  participantColorOption,
  type ParticipantColorOption,
} from '../lib/participantColors';
import { formatStationLabel } from '../lib/stations';

interface MapPanelProps {
  points: EndpointPoint[];
  result: MeetingResult | null;
  onSelectStation: (station: RankedStation) => void;
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

function markerElement(
  kind: MarkerKind,
  text: string,
  color?: ParticipantColorOption,
) {
  const element = document.createElement('div');
  element.className = `map-marker map-marker-${kind}`;
  element.textContent = text;
  if (color) {
    element.style.setProperty('--participant-light', color.light);
    element.style.setProperty('--participant-dark', color.dark);
  }
  return element;
}

function leafletMarkerIcon(
  kind: MarkerKind,
  text: string,
  color?: ParticipantColorOption,
  offset?: { x: number; y: number },
) {
  const size = kind === 'result' ? 39 : kind === 'alternative' ? 44 : 30;
  const element = markerElement(kind, text, color);
  const markerOffset = offset ?? { x: 0, y: 0 };

  return L.divIcon({
    className: 'leaflet-map-marker',
    html: element.outerHTML,
    iconSize: [size, size],
    iconAnchor: [size / 2 - markerOffset.x, size / 2 - markerOffset.y],
  });
}

function endpointOffsets(points: EndpointPoint[]): Map<string, { x: number; y: number }> {
  const groups = new Map<string, EndpointPoint[]>();
  for (const point of points) {
    const key = `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
    groups.set(key, [...(groups.get(key) ?? []), point]);
  }

  const offsets = new Map<string, { x: number; y: number }>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      offsets.set(group[0].id, { x: 0, y: 0 });
      continue;
    }

    const ordered = [...group].sort((left, right) => {
      if (left.participantId === right.participantId) {
        return left.kind === 'start' ? -1 : 1;
      }
      return left.markerLabel.localeCompare(right.markerLabel, undefined, { numeric: true });
    });
    const radius = group.length === 2 ? 13 : Math.min(21, 11 + group.length * 1.5);
    ordered.forEach((point, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / ordered.length;
      offsets.set(point.id, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    });
  }
  return offsets;
}

function MapLegend() {
  return (
    <div className="map-legend" aria-label="Map legend">
      <span><i className="legend-dot legend-start" />Light: start</span>
      <span><i className="legend-dot legend-end" />Dark: end</span>
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

export function MapPanel({ points, result, onSelectStation }: MapPanelProps) {
  const apiKey = useMemo(getGoogleMapsApiKey, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | undefined>(undefined);
  const overlaysRef = useRef<L.LayerGroup | undefined>(undefined);
  const fittedGeometryRef = useRef('');
  const [isReady, setIsReady] = useState(false);
  const [provider, setProvider] = useState<MapProvider>(
    apiKey ? 'google' : 'openstreetmap',
  );
  const [providerNotice, setProviderNotice] = useState('');
  const fitSignature = useMemo(() => {
    const pointSignature = points
      .map((point) => `${point.id}:${point.lat.toFixed(6)},${point.lng.toFixed(6)}`)
      .sort()
      .join('|');
    const resultSignature = !result
      ? 'no-result'
      : result.mode === 'rail'
        ? result.alternatives
            .map((station) => `${station.id}:${station.lat.toFixed(6)},${station.lng.toFixed(6)}`)
            .join('|')
        : `distance:${result.lat.toFixed(6)},${result.lng.toFixed(6)}`;
    return `${pointSignature}::${resultSignature}`;
  }, [points, result]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    let map: L.Map | undefined;
    let attributionRequest: AbortController | undefined;
    const setupRequest = new AbortController();

    void (async () => {
      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      map = L.map(containerRef.current as HTMLDivElement, {
        attributionControl: true,
        zoomControl: true,
        fadeAnimation: !reduceMotion,
        markerZoomAnimation: !reduceMotion,
        zoomAnimation: !reduceMotion,
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
    const offsets = endpointOffsets(points);

    for (const point of points) {
      const color = participantColorOption(point.participantColor);
      const marker = L.marker([point.lat, point.lng], {
        alt: `${point.participantName} ${point.kind}`,
        icon: leafletMarkerIcon(
          point.kind,
          point.markerLabel,
          color,
          offsets.get(point.id),
        ),
        keyboard: false,
        title: `${point.participantName}: ${
          point.kind === 'start' ? 'start' : 'end'
        } — ${point.label}`,
        zIndexOffset: 500,
      }).addTo(overlays);
      marker.bindTooltip(
        `${escapeHtml(point.participantName)}: ${
          point.kind === 'start' ? 'start' : 'end'
        } — ${escapeHtml(point.label)}`,
        { direction: 'top', offset: [0, -16] },
      );
      bounds.extend([point.lat, point.lng]);

      if (result) {
        L.polyline(
          [
            [point.lat, point.lng],
            [result.lat, result.lng],
          ],
          {
            color: color.dark,
            interactive: false,
            opacity: 0.34,
            weight: 1.5,
          },
        ).addTo(overlays);
      }
    }

    if (result) {
      const resultMarker = L.marker([result.lat, result.lng], {
        alt: `Meeting point: ${result.title}`,
        icon: leafletMarkerIcon('result', result.mode === 'rail' ? 'M' : '★'),
        keyboard: false,
        title: result.title,
        zIndexOffset: 2000,
      }).addTo(overlays);
      resultMarker.bindTooltip(escapeHtml(result.title), {
        direction: 'top',
        offset: [0, -20],
      });
      bounds.extend([result.lat, result.lng]);

      if (result.mode === 'rail') {
        for (const { station: alternative, rank } of result.alternatives
          .map((station, index) => ({ station, rank: index + 1 }))
          .filter(({ station }) => station.id !== result.station.id)
          .slice(0, 3)) {
          const alternativeLabel = formatStationLabel(alternative);
          const marker = L.marker([alternative.lat, alternative.lng], {
            alt: `Select rank ${rank}: ${alternativeLabel}`,
            icon: leafletMarkerIcon('alternative', String(rank)),
            keyboard: false,
            title: `Select ${alternativeLabel}`,
            zIndexOffset: 200,
          }).addTo(overlays);
          marker.bindTooltip(
            `Select ${escapeHtml(alternativeLabel)}`,
            { direction: 'top', offset: [0, -14] },
          );
          marker.on('click', () => onSelectStation(alternative));
          bounds.extend([alternative.lat, alternative.lng]);
        }
      }
    }

    if (fittedGeometryRef.current === fitSignature) return;
    fittedGeometryRef.current = fitSignature;
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    map.invalidateSize({ pan: false });
    if (bounds.isValid()) {
      map.fitBounds(bounds, {
        animate: !reduceMotion,
        maxZoom: 15,
        padding: [68, 68],
      });
    } else {
      map.setView(
        [SINGAPORE_CENTER.lat, SINGAPORE_CENTER.lng],
        11,
        { animate: !reduceMotion },
      );
    }
  }, [fitSignature, isReady, onSelectStation, points, result]);

  return (
    <div className="map-wrap">
      <p className="sr-only">
        {points.length
          ? `Map with ${points.length} entered ${points.length === 1 ? 'location' : 'locations'}.`
          : 'Map centred on Singapore.'}{' '}
        {result ? `Recommended meeting point: ${result.title}.` : ''}
      </p>
      <div
        ref={containerRef}
        className="map-canvas"
        role="region"
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
      {result ? (
        <div className="map-selection-status">
          <span>{result.mode === 'rail' ? 'Meeting station' : 'Meeting point'}</span>
          <strong>{result.title}</strong>
        </div>
      ) : null}
      <MapLegend />
    </div>
  );
}
