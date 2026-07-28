import type { EndpointPoint, MeetingResult } from '../types';

export function meetingPointMapsUrl(result: MeetingResult): string {
  const query =
    result.mode === 'rail'
      ? `${result.station.name} ${result.station.network} Station, Singapore`
      : result.address || `${result.lat},${result.lng}`;
  const parameters = new URLSearchParams({
    api: '1',
    query,
  });
  return `https://www.google.com/maps/search/?${parameters.toString()}`;
}

export function meetingDirectionsUrl(
  endpoint: EndpointPoint,
  result: MeetingResult,
  afterMeetup = false,
): string {
  const meetingPoint =
    result.mode === 'rail'
      ? `${result.station.name} ${result.station.network} Station, Singapore`
      : `${result.lat},${result.lng}`;
  const endpointCoordinates = `${endpoint.lat},${endpoint.lng}`;
  const parameters = new URLSearchParams({
    api: '1',
    origin: afterMeetup ? meetingPoint : endpointCoordinates,
    destination: afterMeetup ? endpointCoordinates : meetingPoint,
    travelmode: 'transit',
  });
  return `https://www.google.com/maps/dir/?${parameters.toString()}`;
}
