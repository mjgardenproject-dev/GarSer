import React, { useEffect, useRef, useState } from 'react';
import { useBooking } from '../../contexts/BookingContext';
import { useLocation, useNavigate } from 'react-router-dom';
import AddressPage from './AddressPage';
import ServicesPage from './ServicesPage';
import DetailsPage from './DetailsPage';
import RebookSummaryPage from './RebookSummaryPage';
import { hasRebookBreakdown } from '../../utils/rebookService';

import ProvidersPage from './ProvidersPage';
import ConfirmationPage from './ConfirmationPage';
import { LogOut, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { reconcileProviderLink, resolveProviderLinkEntry } from '../../utils/providerLink';
import { loadProviderLinkProfile } from '../../utils/providerLinkProfile';

type BookingFlowLocationState = {
  selectedServiceId?: string;
  /** Viene del perfil público de un profesional (su enlace garser.es/reservar/<id>). */
  restrictedGardenerId?: string;
};

const BookingFlow: React.FC = () => {
  const { bookingData, currentStep, resetBooking, isLoading, setBookingData, setCurrentStep } = useBooking();
  const navigate = useNavigate();
  const location = useLocation();
  const [showAbandonModal, setShowAbandonModal] = useState(false);
  const stayButtonRef = useRef<HTMLButtonElement>(null);
  const locationState = (location.state || {}) as BookingFlowLocationState;
  const linkGardenerId = locationState.restrictedGardenerId || '';
  // Mientras se decide qué hacer con el borrador anterior no se pinta ningún paso: si no, se
  // vería un instante la reserva vieja (con su profesional) antes de cambiar a la nueva.
  const [linkEntryPending, setLinkEntryPending] = useState(Boolean(linkGardenerId));
  const handledLinkKeyRef = useRef<string | null>(null);
  const reconciledRef = useRef(false);
  const bookingDataRef = useRef(bookingData);
  const currentStepRef = useRef(currentStep);
  bookingDataRef.current = bookingData;
  currentStepRef.current = currentStep;

  useEffect(() => {
    if (locationState.selectedServiceId && bookingData.serviceIds.length === 0) {
      setBookingData({ serviceIds: [locationState.selectedServiceId] });
    }
  }, [bookingData.serviceIds.length, locationState.selectedServiceId, setBookingData]);

  // Entrada por el enlace de un profesional. Antes solo se fijaba si el borrador no tenía ya
  // uno, así que una reserva a medias con otro profesional ganaba al enlace nuevo, y si estaba
  // en la confirmación seguía con el profesional anterior. Ahora la reserva queda ligada al del
  // enlace (ver resolveProviderLinkEntry). Se espera a que cargue el borrador guardado: decidir
  // antes sería decidir sobre una reserva vacía que el borrador pisa al llegar.
  useEffect(() => {
    if (isLoading || !linkGardenerId) return;
    if (handledLinkKeyRef.current === location.key) return;
    handledLinkKeyRef.current = location.key;
    setLinkEntryPending(true);

    void (async () => {
      const profile = await loadProviderLinkProfile(linkGardenerId).catch(() => null);
      const entry = resolveProviderLinkEntry({
        bookingData: bookingDataRef.current,
        currentStep: currentStepRef.current,
        gardenerId: linkGardenerId,
        offeredServiceIds: profile ? profile.serviceIds : null,
      });
      const providerName = profile?.fullName || 'este profesional';

      if (entry.kind === 'fresh') {
        resetBooking();
        setBookingData({ restrictedGardenerId: linkGardenerId });
      } else if (entry.kind === 'rebound') {
        setBookingData(entry.updates);
        setCurrentStep(entry.step);
        toast(
          entry.missingServiceIds.length > 0
            ? `Tu reserva ahora es con ${providerName}. No hace alguno de los servicios que habías elegido: revisa la selección.`
            : `Tu reserva ahora es con ${providerName}. Hemos guardado la dirección y los servicios que ya habías indicado.`,
          { icon: 'ℹ️', id: 'provider-link-rebound' },
        );
      }

      // El enlace ya está aplicado: se quita del historial para que recargar, volver atrás o
      // pulsar «Ver otros profesionales» no lo vuelva a aplicar.
      const { restrictedGardenerId: _applied, ...rest } = locationState;
      void _applied;
      navigate(
        { pathname: location.pathname, search: location.search },
        { replace: true, state: Object.keys(rest).length > 0 ? rest : null },
      );
      setLinkEntryPending(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, linkGardenerId, location.key]);

  // Borradores guardados antes del arreglo de arriba: ligados a un profesional pero con otro ya
  // elegido. Se mira una vez, al cargar.
  useEffect(() => {
    if (isLoading || linkEntryPending || reconciledRef.current) return;
    reconciledRef.current = true;
    const fix = reconcileProviderLink(bookingDataRef.current, currentStepRef.current);
    if (fix) {
      setBookingData(fix.updates);
      setCurrentStep(fix.step);
    }
  }, [isLoading, linkEntryPending, setBookingData, setCurrentStep]);

  useEffect(() => {
    if (!showAbandonModal) {
      return;
    }

    stayButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowAbandonModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showAbandonModal]);

  const handleAbandon = () => {
    resetBooking(); // Borra datos y localStorage
    setShowAbandonModal(false);
    navigate('/dashboard'); // O a home '/'
  };

  const renderCurrentStep = () => {
    if (isLoading || linkEntryPending) {
      return (
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" aria-hidden="true"></div>
          <span className="sr-only" aria-live="polite">Cargando reserva…</span>
        </div>
      );
    }

    switch (currentStep) {
      case 0:
        return <AddressPage />;
      case 1:
        return <ServicesPage />;
      case 2:
        // Al repetir un servicio, primero el resumen. No es un paso nuevo del funnel: es la
        // misma parada, con una pantalla de confirmación delante que se retira sola.
        return (bookingData as { rebookReviewPending?: boolean }).rebookReviewPending &&
          hasRebookBreakdown(bookingData as unknown as Record<string, unknown>)
          ? <RebookSummaryPage />
          // F8: una pantalla por servicio (con varios, se monta de nuevo al pasar al siguiente).
          : <DetailsPage key={bookingData.serviceIds?.[bookingData.activeServiceIndex ?? 0] || 'details'} />;
      case 3:
        return <ProvidersPage />;
      case 4:
        return <ConfirmationPage />;
      default:
        return <AddressPage />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 relative">
      {/* Botón flotante para abandonar reserva */}
      <div className="absolute top-4 right-4 z-40">
        <button
          type="button"
          onClick={() => setShowAbandonModal(true)}
          aria-label="Abandonar reserva"
          className="flex items-center gap-2 px-3 py-2 bg-white/90 backdrop-blur text-red-600 text-sm font-medium rounded-lg border border-red-100 shadow-sm hover:bg-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
        >
          <LogOut aria-hidden="true" className="w-4 h-4" />
          <span className="hidden sm:inline">Abandonar reserva</span>
          <span className="sm:hidden">Salir</span>
        </button>
      </div>

      {renderCurrentStep()}

      {/* Modal de confirmación de abandono */}
      {showAbandonModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setShowAbandonModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="abandon-booking-title"
            aria-describedby="abandon-booking-description"
            className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 transform scale-100 transition-transform"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4 text-amber-600">
              <div className="p-2 bg-amber-50 rounded-full">
                <AlertTriangle aria-hidden="true" className="w-6 h-6" />
              </div>
              <h3 id="abandon-booking-title" className="text-lg font-bold text-gray-900">¿Abandonar reserva?</h3>
            </div>
            
            <p id="abandon-booking-description" className="text-gray-600 mb-6 leading-relaxed">
              Si sales ahora, <span className="font-semibold text-gray-900">perderás todos los datos</span> que has introducido hasta el momento.
            </p>

            <div className="flex flex-col gap-3">
              <button
                ref={stayButtonRef}
                type="button"
                onClick={() => setShowAbandonModal(false)}
                className="w-full py-3 px-4 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-xl transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
              >
                Permanecer en la reserva
              </button>
              <button
                type="button"
                onClick={handleAbandon}
                className="w-full py-3 px-4 bg-white border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 hover:text-red-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              >
                Salir y borrar datos
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookingFlow;
