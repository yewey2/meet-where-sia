interface GoogleMapTilesSession {
  session: string;
  expiry: string;
  tileWidth: number;
  tileHeight: number;
  imageFormat: string;
}

interface GoogleMapViewport {
  copyright?: string;
}

interface TileViewportBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

const GOOGLE_MAP_TILES_BASE_URL = 'https://tile.googleapis.com';

async function googleTilesError(response: Response): Promise<Error> {
  const payload = (await response.json().catch(() => undefined)) as
    | { error?: { message?: string }; message?: string }
    | undefined;
  const message = payload?.error?.message || payload?.message;
  return new Error(
    message || `Google Maps tiles request failed (${response.status}).`,
  );
}

export async function createGoogleMapTilesSession(
  apiKey: string,
  signal?: AbortSignal,
): Promise<GoogleMapTilesSession> {
  const response = await fetch(
    `${GOOGLE_MAP_TILES_BASE_URL}/v1/createSession?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mapType: 'roadmap',
        language: 'en-SG',
        region: 'SG',
      }),
      signal,
    },
  );

  if (!response.ok) throw await googleTilesError(response);
  const session = (await response.json()) as GoogleMapTilesSession;
  if (!session.session) {
    throw new Error('Google Maps returned an invalid tile session.');
  }
  return session;
}

export function googleMapTileUrl(apiKey: string, session: string): string {
  return `${GOOGLE_MAP_TILES_BASE_URL}/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(
    session,
  )}&key=${encodeURIComponent(apiKey)}`;
}

export async function fetchGoogleMapAttribution(
  apiKey: string,
  session: string,
  bounds: TileViewportBounds,
  zoom: number,
  signal?: AbortSignal,
): Promise<string> {
  const parameters = new URLSearchParams({
    session,
    key: apiKey,
    zoom: String(zoom),
    north: String(bounds.north),
    south: String(bounds.south),
    east: String(bounds.east),
    west: String(bounds.west),
  });
  const response = await fetch(
    `${GOOGLE_MAP_TILES_BASE_URL}/tile/v1/viewport?${parameters}`,
    { signal },
  );
  if (!response.ok) throw await googleTilesError(response);
  const viewport = (await response.json()) as GoogleMapViewport;
  return viewport.copyright?.trim() || '';
}

