import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { clearLegacyCheckoutArtifacts } from '../../utils/bookingResumeStorage';
import { reportBookingEvent } from '../../utils/bookingTelemetry';

const LegacyCheckoutRedirect: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    const statePayload = (location.state as { payload?: unknown } | null)?.payload;
    const hadLegacyState = Boolean(statePayload) || location.state != null;

    clearLegacyCheckoutArtifacts({
      userId: user?.id,
      includeAnonFallback: true,
    });

    reportBookingEvent('warn', {
      event: 'booking.legacy_checkout_redirected',
      context: {
        userId: user?.id,
        legacySource: hadLegacyState ? 'route_state' : 'legacy_route',
        discardedLegacyState: hadLegacyState,
        targetFlow: 'wizard',
      },
    });

    navigate('/reservar', {
      replace: true,
    });
  }, [location.state, navigate, user?.id]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-4" />
        <p className="text-gray-600">Redirigiendo al flujo oficial de reserva con Stripe…</p>
      </div>
    </div>
  );
};

export default LegacyCheckoutRedirect;
