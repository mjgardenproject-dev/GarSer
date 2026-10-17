// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * Entrada por el enlace de un profesional (garser.es/reservar/<id> → «Reservar con este
 * profesional»), con el BookingProvider y el guardado del borrador de verdad: lo que se prueba es
 * qué pasa con una reserva a medias que ya estaba en el navegador.
 */

const mocks = vi.hoisted(() => ({
  loadProviderLinkProfile: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

vi.mock('../../utils/bookingPhotoDraftCache', () => ({
  restoreBookingDraftPhotoCache: async (data: unknown) => ({ restoredData: data, missingPaths: [], restoredCount: 0 }),
  syncBookingDraftPhotoCache: async () => undefined,
  clearBookingDraftPhotoCache: async () => undefined,
}));

vi.mock('../../utils/bookingTelemetry', () => ({
  reportBookingEvent: () => undefined,
}));

vi.mock('../../utils/providerLinkProfile', () => ({
  loadProviderLinkProfile: mocks.loadProviderLinkProfile,
}));

vi.mock('react-hot-toast', () => ({
  default: Object.assign(mocks.toast, { error: vi.fn(), success: vi.fn() }),
}));

// Cada paso se sustituye por una sonda que enseña en qué paso está y con qué datos.
const { stepProbe } = vi.hoisted(() => ({
  stepProbe: (step: string) => async () => {
    const { createElement } = await import('react');
    const { useBooking } = await import('../../contexts/BookingContext');
    const Probe = () => {
      const { bookingData } = useBooking();
      return createElement(
        'pre',
        { 'data-testid': 'step', 'data-step': step },
        JSON.stringify({
          restrictedGardenerId: bookingData.restrictedGardenerId ?? null,
          providerId: bookingData.providerId,
          timeSlot: bookingData.timeSlot,
          address: bookingData.address,
          serviceIds: bookingData.serviceIds,
          hasQuote: Boolean(bookingData.authoritativeQuoteSnapshot),
        }),
      );
    };
    return { default: Probe };
  },
}));

vi.mock('./AddressPage', stepProbe('address'));
vi.mock('./ServicesPage', stepProbe('services'));
vi.mock('./DetailsPage', stepProbe('details'));
vi.mock('./RebookSummaryPage', stepProbe('rebook'));
vi.mock('./ProvidersPage', stepProbe('providers'));
vi.mock('./ConfirmationPage', stepProbe('confirmation'));

import BookingFlow from './BookingFlow';
import { BookingProvider } from '../../contexts/BookingContext';
import { readBookingResumeState, writeBookingResume } from '../../utils/bookingResumeStorage';

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location-state">{JSON.stringify(location.state ?? null)}</output>;
};

const renderFlow = (state: Record<string, unknown> | null) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/reserva', state }]}>
      <Routes>
        <Route
          path="/reserva"
          element={
            <>
              <BookingProvider>
                <BookingFlow />
              </BookingProvider>
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

// Reserva a medias con el profesional A, ya en la confirmación: hora elegida y presupuesto firmado.
const draftWithProviderA = (overrides: Record<string, unknown> = {}) => ({
  address: 'Calle Verde 1, Marbella',
  addressCoordinates: { lat: 36.51, lng: -4.88 },
  serviceIds: ['svc-lawn'],
  photos: [],
  description: '',
  preferredDate: '2026-10-20',
  timeSlot: '09:00 - 11:00',
  providerId: 'gardener-A',
  restrictedGardenerId: 'gardener-A',
  estimatedHours: 2,
  totalPrice: 120,
  lawnZones: [{ id: 'z1', species: 'Bermuda', state: 'normal', quantity: 80, wasteRemoval: true, photoUrls: [], imageIndices: [] }],
  authoritativeQuoteSnapshot: {
    totalPrice: 120,
    estimatedHours: 2,
    breakdown: [{ desc: 'Servicio base', price: 120 }],
    warnings: [],
    metadata: { pricingContext: { serviceType: 'standard', allowsPriceChange: false, palmGroups: [] } },
    economics: {
      currency: 'EUR',
      taxRate: 0.21,
      serviceGrossTotal: 120,
      serviceNetSubtotal: 99.17,
      serviceTaxAmount: 20.83,
      managementFee: 15,
      payableNow: 15,
      payableLater: 120,
      lines: [],
      stripeLineItems: [],
    },
    availability: {
      requestedDate: '2026-10-20',
      validStartHours: [9],
      selectedSlot: { date: '2026-10-20', startHour: 9, startTime: '09:00:00', endTime: '11:00:00', durationHours: 2 },
    },
    quoteId: 'quote-A',
    signature: 'sig-A',
    expiresAt: '2099-01-01T00:00:00.000Z',
    pricingVersion: 'v1',
    providerConfigVersion: 'cfg-A',
  },
  ...overrides,
});

const seedDraft = (bookingData: Record<string, unknown>, currentStep: number) => {
  const record = writeBookingResume('draft', 'wizard', { bookingData, currentStep }, { userId: null });
  expect(record).not.toBeNull();
};

const readStep = async () => {
  const node = await screen.findByTestId('step');
  return { step: node.getAttribute('data-step'), data: JSON.parse(node.textContent || '{}') };
};

const storedDraft = () =>
  (readBookingResumeState<{ bookingData: Record<string, unknown>; currentStep: number }>({ userId: null, flow: 'wizard', allowAnonFallback: true })
    .record?.payload ?? null);

describe('BookingFlow — entrada por el enlace de un profesional', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mocks.toast.mockClear();
    mocks.loadProviderLinkProfile.mockReset();
    mocks.loadProviderLinkProfile.mockResolvedValue({
      userId: 'gardener-B',
      fullName: 'Ana Jardines',
      serviceIds: ['svc-lawn', 'svc-hedge'],
      maxDistanceKm: 30,
    });
  });

  afterEach(() => cleanup());

  it('una reserva a medias con otro profesional, en la confirmación, pasa al del enlace y vuelve a elegir hora', async () => {
    seedDraft(draftWithProviderA(), 4);

    renderFlow({ restrictedGardenerId: 'gardener-B' });

    await waitFor(async () => expect((await readStep()).step).toBe('providers'));
    const { data } = await readStep();
    expect(data).toEqual({
      restrictedGardenerId: 'gardener-B',
      providerId: '',
      timeSlot: '',
      // Lo que describe el trabajo se conserva.
      address: 'Calle Verde 1, Marbella',
      serviceIds: ['svc-lawn'],
      hasQuote: false,
    });
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('Tu reserva ahora es con Ana Jardines'), expect.anything());

    // El borrador guardado ya es el nuevo: al recargar no vuelve el profesional A.
    await waitFor(() => {
      const saved = storedDraft();
      expect(saved?.currentStep).toBe(3);
      expect(saved?.bookingData).toMatchObject({ restrictedGardenerId: 'gardener-B', providerId: '' });
      expect(saved?.bookingData).not.toHaveProperty('authoritativeQuoteSnapshot');
    });
    // Y el enlace se consume: recargar o volver atrás no lo aplica otra vez.
    expect(screen.getByTestId('location-state').textContent).toBe('null');
  });

  it('si el profesional del enlace no hace el servicio elegido, vuelve a «Servicios»', async () => {
    seedDraft(draftWithProviderA({ serviceIds: ['svc-palm'] }), 3);

    renderFlow({ restrictedGardenerId: 'gardener-B' });

    await waitFor(async () => expect((await readStep()).step).toBe('services'));
    expect((await readStep()).data.restrictedGardenerId).toBe('gardener-B');
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('No hace alguno de los servicios'), expect.anything());
  });

  it('el mismo enlace otra vez sigue donde estaba, con su hora y su presupuesto', async () => {
    seedDraft(draftWithProviderA({ providerId: 'gardener-B', restrictedGardenerId: 'gardener-B' }), 4);

    renderFlow({ restrictedGardenerId: 'gardener-B' });

    await waitFor(async () => expect((await readStep()).step).toBe('confirmation'));
    expect((await readStep()).data).toMatchObject({ providerId: 'gardener-B', hasQuote: true });
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('sin reserva a medias empieza una nueva ligada al profesional', async () => {
    renderFlow({ restrictedGardenerId: 'gardener-B' });

    await waitFor(async () => expect((await readStep()).data.restrictedGardenerId).toBe('gardener-B'));
    expect((await readStep()).step).toBe('address');
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('no enseña la reserva vieja mientras decide', async () => {
    seedDraft(draftWithProviderA(), 4);
    let resolveProfile: (value: unknown) => void = () => undefined;
    mocks.loadProviderLinkProfile.mockReturnValue(new Promise((resolve) => { resolveProfile = resolve; }));

    renderFlow({ restrictedGardenerId: 'gardener-B' });

    expect(await screen.findByText('Cargando reserva…')).toBeTruthy();
    expect(screen.queryByTestId('step')).toBeNull();
    resolveProfile({ userId: 'gardener-B', fullName: 'Ana Jardines', serviceIds: ['svc-lawn'], maxDistanceKm: 30 });
    await waitFor(async () => expect((await readStep()).step).toBe('providers'));
  });

  it('si no se puede saber qué ofrece, liga la reserva igualmente y deja que «Profesionales» lo diga', async () => {
    seedDraft(draftWithProviderA(), 4);
    mocks.loadProviderLinkProfile.mockRejectedValue(new Error('network'));

    renderFlow({ restrictedGardenerId: 'gardener-B' });

    await waitFor(async () => expect((await readStep()).step).toBe('providers'));
    expect((await readStep()).data).toMatchObject({ restrictedGardenerId: 'gardener-B', providerId: '' });
  });

  it('borrador de antes del arreglo (ligado a B con A elegido): vuelve a la lista aunque no se entre por el enlace', async () => {
    seedDraft(draftWithProviderA({ restrictedGardenerId: 'gardener-B' }), 4);

    renderFlow(null);

    await waitFor(async () => expect((await readStep()).step).toBe('providers'));
    expect((await readStep()).data).toMatchObject({ restrictedGardenerId: 'gardener-B', providerId: '', hasQuote: false });
    expect(mocks.loadProviderLinkProfile).not.toHaveBeenCalled();
  });

  it('una reserva normal (sin enlace) sigue intacta', async () => {
    seedDraft(draftWithProviderA({ restrictedGardenerId: undefined }), 4);

    renderFlow(null);

    await waitFor(async () => expect((await readStep()).step).toBe('confirmation'));
    expect((await readStep()).data).toMatchObject({ restrictedGardenerId: null, providerId: 'gardener-A', hasQuote: true });
  });
});
