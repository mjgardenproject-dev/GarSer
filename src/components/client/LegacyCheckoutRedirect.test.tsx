// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locationState: null as { payload?: unknown } | null,
  navigate: vi.fn(),
  clearLegacyCheckoutArtifacts: vi.fn(),
  reportBookingEvent: vi.fn(),
  user: null as { id: string } | null,
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: mocks.locationState }),
  useNavigate: () => mocks.navigate,
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('../../utils/bookingResumeStorage', () => ({
  clearLegacyCheckoutArtifacts: mocks.clearLegacyCheckoutArtifacts,
}));

vi.mock('../../utils/bookingTelemetry', () => ({
  reportBookingEvent: mocks.reportBookingEvent,
}));

import LegacyCheckoutRedirect from './LegacyCheckoutRedirect';

describe('LegacyCheckoutRedirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locationState = null;
    mocks.user = null;
  });

  it('purga artefactos legacy y redirige limpio al flujo oficial aunque llegue state bridge', async () => {
    mocks.locationState = {
      payload: {
        selectedAddress: 'Calle Sol 4',
        selectedServiceIds: ['svc-1'],
        restrictedGardenerId: 'gardener-1',
        description: 'Podar seto',
      },
    };
    mocks.user = { id: 'user-1' };

    render(<LegacyCheckoutRedirect />);

    await waitFor(() => {
      expect(mocks.clearLegacyCheckoutArtifacts).toHaveBeenCalledWith({
        userId: 'user-1',
        includeAnonFallback: true,
      });
    });

    expect(mocks.navigate).toHaveBeenCalledWith('/reservar', {
      replace: true,
    });
    expect(mocks.reportBookingEvent).toHaveBeenCalledWith('warn', {
      event: 'booking.legacy_checkout_redirected',
      context: expect.objectContaining({
        userId: 'user-1',
        legacySource: 'route_state',
        discardedLegacyState: true,
        targetFlow: 'wizard',
      }),
    });
  });

  it('limpia storage legacy incluso sin state bridge y redirige al wizard oficial', async () => {
    render(<LegacyCheckoutRedirect />);

    await waitFor(() => {
      expect(mocks.clearLegacyCheckoutArtifacts).toHaveBeenCalledWith({
        userId: undefined,
        includeAnonFallback: true,
      });
    });

    expect(mocks.reportBookingEvent).toHaveBeenCalledWith('warn', {
      event: 'booking.legacy_checkout_redirected',
      context: expect.objectContaining({
        legacySource: 'legacy_route',
        discardedLegacyState: false,
        targetFlow: 'wizard',
      }),
    });
  });

  it('no intenta rehidratar ni preservar payloads incompatibles', async () => {
    mocks.locationState = { payload: { selectedAddress: 42 } };

    render(<LegacyCheckoutRedirect />);

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/reservar', {
        replace: true,
      });
    });

    expect(mocks.clearLegacyCheckoutArtifacts).toHaveBeenCalled();
    expect(mocks.reportBookingEvent).toHaveBeenCalledWith('warn', {
      event: 'booking.legacy_checkout_redirected',
      context: expect.objectContaining({
        legacySource: 'route_state',
        discardedLegacyState: true,
      }),
    });
  });
});
