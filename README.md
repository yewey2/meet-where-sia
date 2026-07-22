# MeetMiddle SG — React V1

A Singapore-focused group meeting-point planner. Each participant supplies a starting point and an ending point; the app resolves those locations and recommends either:

1. **Pure distance** — a geometric median that approximately minimizes the combined straight-line distance to every start and end point.
2. **Nearest MRT/LRT** — the official Singapore rail station with the lowest total straight-line distance to every start and end point.

![MeetMiddle SG preview](docs/preview.png)

## V1 functionality

- React 19, TypeScript, Vite, and a small Express API server.
- Pure-distance mode is selected by default.
- Add or remove any number of participants in one organizer-controlled plan.
- Each participant has a name, start, end, and **End at the same place** option.
- Google place suggestions are restricted to Singapore and every typed query is searched with `, Singapore` appended once.
- Six-digit postal-code variants such as `425-500` and `425 500` are normalized to `425500` before searching.
- A typed location can still be geocoded when the user does not pick an autocomplete suggestion.
- Google Map markers for starts, ends, the selected meeting point, and close MRT/LRT alternatives.
- Result metrics for average endpoint distance, farthest endpoint, and total group distance.
- Official LTA station-exit coordinates are aggregated into one point per MRT/LRT station.
- Optional LTA DataMall train-service status check through the Express server.
- Browser-only plan persistence with `localStorage`.
- Responsive desktop and mobile layouts.
- Loading, empty, validation, API-setup, and upstream-error states.
- No secrets or real API keys are included in this repository.

## How the recommendation works

### Pure distance

The arithmetic mean of latitude and longitude is a visual centroid, but it does not generally minimize the sum of distances. This app instead runs **Weiszfeld's algorithm** on a Singapore-scale local tangent plane to approximate the geometric median. Final metrics use Haversine distance.

Every participant contributes two endpoint observations. When **End at the same place** is selected, the start coordinate is also used as that participant's end coordinate. This keeps every participant weighted consistently with two observations.

### MRT/LRT

The server downloads the official LTA station-exit GeoJSON from data.gov.sg, groups exits by station name, and averages each station's exit coordinates. The client then evaluates every station and sorts by:

1. Lowest total Haversine distance to all endpoints.
2. Lowest farthest-endpoint distance as the tie-breaker.

This is more useful for a group than merely finding the station closest to an unconstrained visual centroid.

### Important limitation

Both V1 modes use **straight-line kilometres**, not public-transport travel time, transfers, walking routes, fares, congestion, accessibility, or individual preferences. A future mode can use the Google Routes API or a transit-routing provider to minimize actual journey time.

## Google Maps setup

### 1. Create and restrict a browser key

Enable these services in the same Google Cloud project:

- Maps JavaScript API
- Places API (New)
- Geocoding API

Restrict the key by:

- **Application restriction:** Websites / HTTP referrers, including your localhost and production origins.
- **API restriction:** Only the three services listed above.

A browser Maps key is visible to website visitors by design. Security comes from referrer and API restrictions, quotas, and monitoring—not from trying to hide the key in React source.

### 2. Configure the project

```bash
cp .env.example .env
```

Then edit `.env`:

```dotenv
VITE_GOOGLE_MAPS_API_KEY=your_restricted_browser_key
VITE_GOOGLE_MAP_ID=
LTA_ACCOUNT_KEY=
PORT=8787
```

`VITE_GOOGLE_MAP_ID` is optional. The app uses Google's demo map ID when it is blank.

## LTA API setup and use

The LTA DataMall key is optional for this V1. Put it only in the server-side variable:

```dotenv
LTA_ACCOUNT_KEY=your_lta_datamall_account_key
```

Do **not** rename it with a `VITE_` prefix; Vite-prefixed variables are compiled into the browser bundle.

The app currently uses the AccountKey for:

- `TrainServiceAlerts`, so MRT mode can show whether LTA reports normal/minor-delay service or a major disruption.

The AccountKey is not needed for station geometry. Station locations come from LTA's public static/open-data GeoJSON, proxied and cached by the Express server.

Other potentially useful LTA DataMall additions for later versions include station crowd density, crowd forecasts, facilities maintenance, passenger-volume data, and bus information. They do not directly provide a general door-to-door route planner, so they are not used to calculate the V1 centroid.

## Run locally

### Requirements

- Node.js 22.12 or later
- npm

### Development mode

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal, normally `http://localhost:5173`.

- React/Vite runs on port `5173`.
- Express runs on port `8787`.
- Vite proxies `/api/*` to Express.

### Production build

```bash
npm run build
npm start
```

Open `http://localhost:8787`.

### Type-check only

```bash
npm run check
```

## Docker

The Google browser variables must be present at image build time because Vite compiles them into the static bundle. The LTA key remains a runtime server variable.

```bash
docker build \
  --build-arg VITE_GOOGLE_MAPS_API_KEY="your_restricted_browser_key" \
  --build-arg VITE_GOOGLE_MAP_ID="your_optional_map_id" \
  -t meetmiddle-sg .

docker run --rm -p 8787:8787 \
  -e LTA_ACCOUNT_KEY="your_lta_datamall_account_key" \
  meetmiddle-sg
```

## Example flow

Use the built-in **Load example** action to populate:

- John Doe: `Senja LRT` → same place.
- Aisha Tan: `ION Orchard` → `425-500`.

Select suggestions where available, or press the calculate button and let the app geocode unresolved text automatically.

## API routes

| Route | Purpose |
|---|---|
| `GET /api/health` | Reports server status and whether the two keys are configured. |
| `GET /api/mrt-stations` | Downloads, aggregates, and caches official LTA MRT/LRT station-exit data. |
| `GET /api/lta/train-alerts` | Calls LTA DataMall with the server-side `AccountKey`; returns a safe normalized status. |

The station list is cached in memory for 12 hours. LTA service alerts are cached for 60 seconds.

## Project structure

```text
meetmiddle-sg/
├── server/
│   └── index.mjs              # Express API, LTA proxy, station aggregation
├── src/
│   ├── components/            # Inputs, participant cards, map, result panel
│   ├── lib/
│   │   ├── centroid.ts        # Haversine, geometric median, station ranking
│   │   ├── googleMaps.ts      # Maps loader, geocoding, reverse geocoding
│   │   ├── location.ts        # Singapore scoping and postal normalization
│   │   └── api.ts             # Browser calls to the Express API
│   ├── App.tsx
│   ├── styles.css
│   └── types.ts
├── .env.example
├── Dockerfile
├── package.json
└── vite.config.ts
```

## V2 direction

The UI already separates participant records from the calculation logic, so a shared-plan backend can be added without redesigning the centroid engine. A practical V2 would add:

- Shareable plan IDs and editable links.
- Email or one-time-link contributor identity.
- Server-side persistence and optimistic concurrency/versioning.
- Organizer permissions, participant-level edit permissions, and an audit log.
- Live synchronization through WebSockets or server-sent events.
- Expiring links, rate limits, abuse protection, and deletion controls.
- Optional travel-time, accessibility, venue-category, and operating-hours filters.

## Official data and API references

- [Google Maps JavaScript Place Autocomplete Data API](https://developers.google.com/maps/documentation/javascript/place-autocomplete-data)
- [Google Maps JavaScript Geocoding service](https://developers.google.com/maps/documentation/javascript/geocoding)
- [Google Maps Platform API security guidance](https://developers.google.com/maps/api-security-best-practices)
- [LTA DataMall](https://datamall.lta.gov.sg/)
- [LTA static datasets](https://datamall.lta.gov.sg/content/datamall/en/static-data.html)
- [LTA MRT Station Exit GeoJSON on data.gov.sg](https://data.gov.sg/datasets/d_b39d3a0871985372d7e1637193335da5/view)
