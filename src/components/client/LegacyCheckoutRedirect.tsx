import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { writeBookingResume } from '../../utils/bookingResumeStorage';

type LegacyCheckoutPayload = {
  restrictedGardenerId?: string;
  selectedAddress?: string;
  selectedServiceIds?: string[];
  description?: string;
};

const LEGACY_PENDING_CHECKOUT_KEY = 'pending_checkout';

const readLegacyPayload = (): LegacyCheckoutPayload | null => {
  try {
    const raw =
      localStorage.getItem(LEGACY_PENDING_CHECKOUT_KEY) ||
      sessionStorage.getItem(LEGACY_PENDING_CHECKOUT_KEY);

    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as LegacyCheckoutPayload;
  } catch {
    return null;
  }
};

const clearLegacyPayload = () => {
  try {
    localStorage.removeItem(LEGACY_PENDING_CHECKOUT_KEY);
    sessionStorage.removeItem(LEGACY_PENDING_CHECKOUT_KEY);
  } catch {}
};

const LegacyCheckoutRedirect: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const statePayload = (location.state as { payload?: LegacyCheckoutPayload } | null)?.payload;
    const payload = statePayload || readLegacyPayload();
    const primaryServiceId = payload?.selectedServiceIds?.length === 1 ? payload.selectedServiceIds[0] : undefined;

    if (payload?.selectedAddress || primaryServiceId || payload?.description || payload?.restrictedGardenerId) {
      const progress = {
        bookingData: {
          address: payload?.selectedAddress || '',
          serviceIds: primaryServiceId ? [primaryServiceId] : [],
          description: payload?.description || '',
          restrictedGardenerId: payload?.restrictedGardenerId,
        },
        currentStep: primaryServiceId ? 2 : 0,
        timestamp: new Date().toISOString(),
      };

      writeBookingResume('draft', 'wizard', progress);
    }

    clearLegacyPayload();

    navigate('/reservar', {
      replace: true,
      state: primaryServiceId
        ? {
            selectedServiceId: primaryServiceId,
            restrictedGardenerId: payload?.restrictedGardenerId,
          }
        : undefined,
    });
  }, [location.state, navigate]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-4" />
        <p className="text-gray-600">Redirigiendo al flujo oficial de reserva…</p>
      </div>
    </div>
  );
};

export default LegacyCheckoutRedirect;
