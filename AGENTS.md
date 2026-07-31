# Agent guide

Meet Where Sia is a Vite/React/TypeScript planner for fair Singapore MRT/LRT
meeting points. The backend is plain Node/Express-compatible JavaScript and runs
as Vercel functions or the local server.

## Where things live

- `src/App.tsx` - main state and planner orchestration.
- `src/types.ts` - shared frontend domain types.
- `src/components/` - participant form, results, map, nearby places, sharing UI.
- `src/lib/railGraph.ts` - rail graph, journey estimates, four-objective station ranking.
- `src/lib/journeyMetrics.ts` - per-participant full outings and aggregate time metrics.
- `src/lib/centroid.ts` - modified Weiszfeld geometric-median/distance calculations.
- `src/lib/googleMaps.ts`, `googleMapTiles.ts` - optional Google integration.
- `src/lib/groupPlans.ts`, `useSharedPlan.ts` - shared-plan client and syncing.
- `src/lib/participantColors.ts` - the ten participant map colours.
- `api/_plans-core.js` - shared-plan validation, auth, permissions, and storage.
- `api/*.js` - Vercel API entry points.
- `server/services.mjs` - shared station, nearby-place, and alert services.
- `server/index.mjs`, `server/local.js` - Express/local and Docker runtime.
- `test/` - Node tests for algorithms, integrations, plans, and security.
- `public/` - static metadata, icons, policies, sitemap, and robots file.
- `docs/FUTURE.md` - intentionally deferred product work.

## Main flow

`ParticipantCard` -> location resolution in `App.tsx` -> endpoint points ->
`railGraph.ts` or `centroid.ts` -> `ResultPanel` + lazy-loaded `MapPanel`.

Shared plans flow through `useSharedPlan.ts` -> `groupPlans.ts` -> `/api/plans`
-> `_plans-core.js` -> Redis/Upstash (or the in-memory test store).

## Important invariants

- Preserve the key-free MRT/LRT and OpenStreetMap fallback.
- Each participant contributes both start and end to fairness calculations;
  "same place" deliberately counts the start again as the end.
- Rail objectives are `average`, `weighted`, `minimax`, and `evenness`.
  User-facing names: Quickest overall, Weighted centre, Keep trips manageable,
  and Similar travel times, respectively.
- The `weighted` objective minimises the mean of squared participant full-outing
  times. Rank with `meanSquaredMinutes`; use `rootMeanSquareMinutes` only to
  display the score in familiar minute units.
- `minimax` compares the maximum full-outing time at each candidate; it does not
  permanently identify or favour one participant as the furthest.
- `evenness` minimises variance between participant full-outing times. Keep the
  statistical term in explanatory copy rather than the primary button label.
- Pure-distance mode is an ordinary geometric median, not an arithmetic mean.
  Repeated coordinates retain their full weight and may legitimately anchor the
  answer. Preserve the modified Weiszfeld coincident-point handling.
- Shared links expose participant names/locations; contributors may edit only
  their assigned participant. Keep auth and mutation checks server-side.
- Participant colours must use the ten allowed IDs and remain compatible with
  legacy plans that have no stored colour.
- Never expose LTA or Redis credentials. A `VITE_` Google key is public by design.

## Commands

```text
npm run dev     local frontend + API
npm run check   TypeScript
npm test        full Node test suite
npm run build   production build
```

Before handing off a change, run `npm run check`, `npm test`, `npm run build`,
and `git diff --check`. Preserve unrelated working-tree changes.
