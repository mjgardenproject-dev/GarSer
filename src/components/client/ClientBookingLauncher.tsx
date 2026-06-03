import React from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../contexts/AuthContext';
import { clearBookingResumeStorage, hasWizardResume } from '../../utils/bookingResumeStorage';
import CustomerExperienceSections from '../public/CustomerExperienceSections';

const ClientBookingLauncher: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canResume = hasWizardResume({ userId: user?.id, allowAnonFallback: true });
  const firstName = (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0];

  const handleNewBooking = () => {
    clearBookingResumeStorage({ userId: user?.id, flow: 'wizard', includeAnonFallback: true });
    navigate('/reservar?start=1');
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <section className="overflow-hidden rounded-[2rem] border border-emerald-100 bg-gradient-to-r from-white via-emerald-50 to-lime-50 p-5 shadow-sm sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Tu zona de cliente</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
          {firstName ? `Hola, ${firstName}` : 'Bienvenido de nuevo'}
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
          Desde aqui puedes empezar una reserva nueva, retomar una que ya hubieras abierto o ir a tus reservas sin pasar por pantallas tecnicas.
        </p>
      </section>

      <CustomerExperienceSections
        pageVariant="client-dashboard"
        canResumeBooking={canResume}
        showAccessCta={false}
        showBookingsCta
        onPrimaryCta={handleNewBooking}
        onResumeCta={() => navigate('/reservar')}
        onBookingsCta={() => navigate('/bookings')}
      />
    </div>
  );
};

export default ClientBookingLauncher;
