// The public LTA station-exit GeoJSON can lag newly opened stations. These
// station-centre coordinates come from Singapore OneMap's official Search API
// and are used only until the station-exit dataset contains the same station.
export const OPERATIONAL_STATION_FALLBACKS = [
  {
    id: 'hume',
    name: 'Hume',
    network: 'MRT',
    lat: 1.3545953239503,
    lng: 103.769118851887,
    exitCount: 0,
  },
  {
    id: 'keppel',
    name: 'Keppel',
    network: 'MRT',
    lat: 1.26977220124441,
    lng: 103.830031459524,
    exitCount: 0,
  },
  {
    id: 'cantonment',
    name: 'Cantonment',
    network: 'MRT',
    lat: 1.27287214563203,
    lng: 103.837062313764,
    exitCount: 0,
  },
  {
    id: 'prince-edward-road',
    name: 'Prince Edward Road',
    network: 'MRT',
    lat: 1.27315693636085,
    lng: 103.847097123745,
    exitCount: 0,
  },
  {
    id: 'punggol-coast',
    name: 'Punggol Coast',
    network: 'MRT',
    lat: 1.41492733388605,
    lng: 103.910166388177,
    exitCount: 0,
  },
];
