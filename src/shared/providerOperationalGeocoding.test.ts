import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  geocodeAddressWithGoogleApi,
  normalizeGeocodedCoordinates,
} from './providerOperationalGeocoding';

describe('providerOperationalGeocoding', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normaliza coordenadas válidas y descarta valores no numéricos', () => {
    expect(normalizeGeocodedCoordinates({ lat: 40.4, lng: -3.7 })).toEqual({
      lat: 40.4,
      lng: -3.7,
    });
    expect(normalizeGeocodedCoordinates({ lat: 'foo', lng: -3.7 })).toBeNull();
  });

  it('resuelve coordenadas desde Google Geocoding API cuando la respuesta es OK', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'OK',
          results: [
            {
              geometry: {
                location: {
                  lat: 40.4168,
                  lng: -3.7038,
                },
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      geocodeAddressWithGoogleApi({
        address: 'Calle Mayor 1, Madrid',
        apiKey: 'google-key',
      }),
    ).resolves.toEqual({
      lat: 40.4168,
      lng: -3.7038,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('falla cerrado cuando la respuesta de Google no es resoluble', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ZERO_RESULTS',
          results: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      geocodeAddressWithGoogleApi({
        address: 'Dirección inexistente',
        apiKey: 'google-key',
      }),
    ).resolves.toBeNull();
  });
});
