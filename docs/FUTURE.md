# Future improvements

This document records useful product work that is intentionally outside the
current implementation. The existing MRT/LRT estimator and key-free fallback
should remain available when optional routing services are not configured.

## Time-aware and multimodal journeys

Potential additions:

- choose a meeting, departure, or arrival time;
- include public buses alongside MRT/LRT;
- prefer fewer transfers or less walking;
- set a maximum walking distance or transfer count;
- account for step-free/accessibility needs where a provider supplies the data;
- compare scheduled routes with current rail disruptions; and
- show the difference between the local planning estimate and a live route.

These features need a current routing dataset or API. They cannot be derived
reliably from the app's station graph alone. Google Maps Platform's Routes API
is one possible optional provider: its transit routing supports departure and
arrival times, bus/rail mode preferences, less-walking, and fewer-transfer
preferences. Other providers or Singapore open-transit datasets could be
evaluated before implementation to avoid making the product dependent on a
single vendor.

Any integration should:

1. call billable or secret-key services from the server where appropriate;
2. cache route matrices and enforce group-size/request limits;
3. display provider attribution and journey-data freshness;
4. fall back to the existing local MRT/LRT model when unavailable; and
5. avoid implying that accessibility or disruption data is complete unless the
   source explicitly guarantees it.

## Venue recommendations

When a suitable places provider is configured, meeting-point results could be
extended from a station to a shortlist of venues. Useful signals include the
nearest station exit, walking time, current opening hours, price level,
accessibility information, group suitability, and a lightweight group vote.

