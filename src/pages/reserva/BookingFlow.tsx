import React, { useState } from 'react';
import { useBooking } from '../../contexts/BookingContext';
import { useNavigate } from 'react-router-dom';
import AddressPage from './AddressPage';
import ServicesPage from './ServicesPage';
import DetailsPage from './DetailsPage';
// AvailabilityPage eliminado del flujo
import ProvidersPage from './ProvidersPage';
import ConfirmationPage from './ConfirmationPage';
import { LogOut, AlertTriangle } from 'lucide-react';

const BookingFlow: React.FC = () => {
  const { currentStep, resetBooking, isLoading } = useBooking();
  const navigate = useNavigate();
  const [showAbandonModal, setShowAbandonModal] = useState(false);

  const handleAbandon = () => {
    resetBooking(); // Borra datos y localStorage
    setShowAbandonModal(false);
    navigate('/dashboard'); // O a home '/'
  };

  const renderCurrentStep = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
        </div>
      );
    }

    switch (currentStep) {
      case 0:
        return <AddressPage />;
      case 1:
        return <ServicesPage />;
      case 2:
        return <DetailsPage />;
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
          onClick={() => setShowAbandonModal(true)}
          className="flex items-center gap-2 px-3 py-2 bg-white/90 backdrop-blur text-red-600 text-sm font-medium rounded-lg border border-red-100 shadow-sm hover:bg-red-50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">Abandonar reserva</span>
          <span className="sm:hidden">Salir</span>
        </button>
      </div>

      {renderCurrentStep()}

      {/* Modal de confirmación de abandono */}
      {showAbandonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 transform scale-100 transition-all">
            <div className="flex items-center gap-3 mb-4 text-amber-600">
              <div className="p-2 bg-amber-50 rounded-full">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">¿Abandonar reserva?</h3>
            </div>
            
            <p className="text-gray-600 mb-6 leading-relaxed">
              Si sales ahora, <span className="font-semibold text-gray-900">perderás todos los datos</span> que has introducido hasta el momento.
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => setShowAbandonModal(false)}
                className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors shadow-sm"
              >
                Permanecer en la reserva
              </button>
              <button
                onClick={handleAbandon}
                className="w-full py-3 px-4 bg-white border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 hover:text-red-600 transition-colors"
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
