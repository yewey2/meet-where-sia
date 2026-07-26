# Deployment

Meet Where Sia can run on Vercel or as a Node.js/Docker service. Google Maps, LTA DataMall, and shared-plan storage are optional and can be enabled independently.

## Vercel

1. Import `yewey2/meet-where-sia` into Vercel.
2. Keep the detected framework preset as **Vite**.
3. Leave the build command as `npm run build` and the output directory as `dist`.
4. Add only the environment variables needed for your deployment.
5. Deploy, then verify the frontend and `/api/health`.

The checked-in [`vercel.json`](../vercel.json) deploys API functions in Singapore (`sin1`) and includes the support-page rewrite.

### Environment variables

| Variable | Required | Scope | Enables |
| --- | --- | --- | --- |
| `VITE_GOOGLE_MAPS_API_KEY` | No | Build and browser | Google map tiles, place search, geocoding, and autocomplete |
| `LTA_ACCOUNT_KEY` | No | Server only | LTA DataMall train-service alerts |
| `UPSTASH_REDIS_REST_URL` | For shared plans | Server only | Persistent shared-plan storage |
| `UPSTASH_REDIS_REST_TOKEN` | For shared plans | Server only | Writable access to shared-plan storage |

`PORT` is only used by the local/Docker server and should not be set on Vercel.

Vite compiles `VITE_GOOGLE_MAPS_API_KEY` into the frontend during the build. Redeploy after changing it. Never give server secrets a `VITE_` prefix.

## Enable shared plans on Vercel

Serverless functions do not provide durable local file storage, so shared plans need an external Redis-compatible store.

1. In the Vercel project's **Storage** or **Marketplace** area, create and connect an Upstash Redis database.
2. Choose a Singapore or nearby region when available.
3. Confirm that the integration added a REST URL and a writable REST token.
4. Redeploy the project.
5. Create a test shared plan, open its link in a private browser window, and confirm that public viewing and contributor sign-in work.

The app recognises the following credential pairs, in order:

```dotenv
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Alternative names injected by some Vercel integrations:
UPSTASH_REDIS_KV_REST_API_URL=
UPSTASH_REDIS_KV_REST_API_TOKEN=

# Legacy aliases:
KV_REST_API_URL=
KV_REST_API_TOKEN=
```

The read-only token and Redis-protocol URL are not substitutes; shared plans perform writes. Redis stores shared-plan JSON, password hashes, sessions, and short-lived rate-limit state.

Anyone with a shared link can view its participant names and locations. Before launching shared plans, confirm that the deployed privacy and terms pages match how you operate the service.

## Google Maps configuration

Enable Map Tiles API, Maps JavaScript API, Places API (New), and Geocoding API in one Google Cloud project. Restrict the browser key by:

- allowed website/HTTP-referrer origins;
- the four required APIs;
- sensible quotas and billing alerts.

Include both production and preview/local origins only when they are needed. A browser key is public by nature; its restrictions are the security boundary.

Without the Google key, the deployment falls back to OpenStreetMap and accepts exact MRT/LRT station names and Singapore coordinates.

## Docker

The Google browser key must be supplied while building the image because Vite embeds it in the static bundle:

```bash
docker build \
  --build-arg VITE_GOOGLE_MAPS_API_KEY=your_restricted_browser_key \
  -t meet-where-sia .

docker run --rm -p 8787:8787 \
  -e LTA_ACCOUNT_KEY=your_lta_datamall_account_key \
  -e UPSTASH_REDIS_REST_URL=your_upstash_rest_url \
  -e UPSTASH_REDIS_REST_TOKEN=your_upstash_rest_token \
  meet-where-sia
```

Omit any optional variable you do not use. Open <http://localhost:8787> after the container starts.

## Post-deployment checks

- Load `/api/health` and confirm it returns an `ok` response.
- Search for an exact MRT station without a Google key.
- Run the built-in Aljunied/Eunos example and confirm a result appears.
- Confirm the map provider's attribution remains visible.
- If Google is enabled, test autocomplete and inspect the key's referrer restrictions.
- If LTA is enabled, confirm the train status loads without exposing the key in browser requests.
- If shared plans are enabled, test public view, owner login, contributor edits, access removal, and deletion.
- Check `/privacy.html`, `/terms.html`, and `/support` in production.
