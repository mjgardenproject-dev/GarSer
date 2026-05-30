import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarClock, ClipboardList, RefreshCcw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import ServiceCatalog from './ServiceCatalog';
import { clearBookingResumeStorage, hasWizardResume } from '../../utils/bookingResumeStorage';

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
    <div className="max-w-7xl mx-auto p-4 sm:p-6">
      <section className="bg-white border border-gray-200 rounded-3xl shadow-sm p-6 sm:p-8 mb-6">
        <div className="max-w-3xl">
          <p className="text-sm font-medium text-green-700 mb-2">
            {firstName ? `Hola, ${firstName}` : 'Reserva oficial GarSer'}
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 text-pretty mb-3">
            Reserva tu servicio desde un unico flujo guiado
          </h1>
          <p className="text-base sm:text-lg text-gray-600 mb-6">
            Direccion, servicio, detalles, disponibilidad y confirmacion quedan dentro del mismo proceso para evitar perdida de datos y precios inconsistentes.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => navigate('/reservar')}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-green-600 text-white px-5 py-3 font-semibold hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
            >
              {canResume ? 'Continuar reserva' : 'Empezar reserva'}
              <ArrowRight aria-hidden="true" className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleNewBooking}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-300 bg-white text-gray-800 px-5 py-3 font-semibold hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
            >
              <RefreshCcw aria-hidden="true" className="w-4 h-4" />
              Empezar desde cero
            </button>
            {user && (
              <button
                type="button"
                onClick={() => navigate('/bookings')}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-300 bg-white text-gray-800 px-5 py-3 font-semibold hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
              >
                <ClipboardList aria-hidden="true" className="w-4 h-4" />
                Ver mis reservas
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <CalendarClock aria-hidden="true" className="w-5 h-5 text-green-700 mb-3" />
          <h2 className="text-base font-semibold text-gray-900 mb-1">Flujo unico</h2>
          <p className="text-sm text-gray-600">La reserva se gestiona en un solo wizard oficial sin checkout lateral ni pasos duplicados.</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <ArrowRight aria-hidden="true" className="w-5 h-5 text-green-700 mb-3" />
          <h2 className="text-base font-semibold text-gray-900 mb-1">Recuperacion segura</h2>
          <p className="text-sm text-gray-600">Si ya empezaste, puedes retomar el borrador compatible desde el mismo punto soportado.</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <ClipboardList aria-hidden="true" className="w-5 h-5 text-green-700 mb-3" />
          <h2 className="text-base font-semibold text-gray-900 mb-1">Seguimiento claro</h2>
          <p className="text-sm text-gray-600">Consulta el historial de reservas sin mezclar la navegacion de seguimiento con la de nueva contratacion.</p>
        </div>
      </section>

      <ServiceCatalog />
    </div>
  );
};

export default ClientBookingLauncher;
