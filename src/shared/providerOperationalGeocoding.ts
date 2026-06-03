export interface GeocodedCoordinates {
  lat: number;
  lng: number;
}

interface GoogleGeocodingResponse {
  status?: string;
  results?: Array<{
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
  }>;
}

export const normalizeGeocodedCoordinates = (
  input?: { lat?: unknown; lng?: unknown } | null,
): GeocodedCoordinates | null => {
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

export async function geocodeAddressWithGoogleApi(params: {
  address: string;
  apiKey?: string | null;
  language?: string;
  region?: string;
}): Promise<GeocodedCoordinates | null> {
  const address = String(params.address || '').trim();
  const apiKey = String(params.apiKey || '').trim();
  if (!address || !apiKey) return null;

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('language', params.language || 'es');
  url.searchParams.set('region', params.region || 'es');

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as GoogleGeocodingResponse;
    const firstLocation = payload.results?.[0]?.geometry?.location;
    if (payload.status !== 'OK' || !firstLocation) {
      return null;
    }

    return normalizeGeocodedCoordinates(firstLocation);
  } catch {
    return null;
  }
}
