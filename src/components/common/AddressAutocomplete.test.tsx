// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/googleMapsLoader', () => ({
  default: { isGoogleMapsLoaded: () => true, load: async () => undefined },
}));

import AddressAutocomplete from './AddressAutocomplete';

type W = Window & { google?: unknown };

const installPlaces = (status: string) => {
  (window as W).google = {
    maps: {
      places: {
        PlacesServiceStatus: { OK: 'OK' },
        AutocompleteSessionToken: class {},
        AutocompleteService: class {
          getPlacePredictions(_req: unknown, cb: (p: unknown[] | null, s: string) => void) { cb(null, status); }
        },
      },
    },
  };
};

const typeAddress = async (value = 'Calle Mayor 12, Marbella') => {
  render(<AddressAutocomplete id="a" value="" onChange={() => undefined} />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.change(screen.getByRole('textbox'), { target: { value } });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
};

describe('AddressAutocomplete · QA-121/QA-068 (nada técnico de Google a la vista del cliente)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, 'log').mockImplementation(() => undefined); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); cleanup(); delete (window as W).google; });

  it.each(['REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'UNKNOWN_ERROR'])('con %s el cliente lee un aviso suyo, sin facturación ni guías de Google Cloud', async (status) => {
    installPlaces(status);
    await typeAddress();
    const text = document.body.textContent || '';
    expect(text).toContain('No hemos podido cargar las sugerencias de direcciones');
    expect(text).toContain('la comprobaremos al continuar');
    expect(text).not.toMatch(/facturaci[óo]n|Guía de Google Maps|Google Cloud|API de Google|clave y permisos/i);
    expect(document.querySelector('a[href*="google"]')).toBeNull();
  });

  it('ZERO_RESULTS (nada que sugerir todavía) no es un fallo: sin aviso', async () => {
    installPlaces('ZERO_RESULTS');
    await typeAddress();
    expect(document.body.textContent).not.toContain('No hemos podido');
  });

  it('si hay sugerencias no sale ningún aviso', async () => {
    (window as W).google = {
      maps: { places: {
        PlacesServiceStatus: { OK: 'OK' },
        AutocompleteSessionToken: class {},
        AutocompleteService: class {
          getPlacePredictions(_req: unknown, cb: (p: unknown[] | null, s: string) => void) {
            cb([{ place_id: '1', description: 'Calle Mayor 12, Marbella', structured_formatting: { main_text: 'Calle Mayor 12', secondary_text: 'Marbella' } }], 'OK');
          }
        },
      } },
    };
    await typeAddress();
    expect(document.body.textContent).not.toContain('No hemos podido');
  });
});
