import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const LegacyBookingRedirect: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/reservar', {
      replace: true,
      state: location.state,
    });
  }, [location.state, navigate]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-4" />
        <p className="text-gray-600">Redirigiendo al flujo de reserva…</p>
      </div>
    </div>
  );
};

export default LegacyBookingRedirect;
