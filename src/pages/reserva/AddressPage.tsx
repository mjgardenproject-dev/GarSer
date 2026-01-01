import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronLeft, MapPin, Navigation, Search } from 'lucide-react';
import AddressAutocomplete from '../../components/common/AddressAutocomplete';

const AddressPage: React.FC = () => {
  const navigate = useNavigate();
  const { bookingData, setBookingData, saveProgress, setCurrentStep, prevStep } = useBooking();
  const [address, setAddress] = useState(bookingData.address);
  const [isLocating, setIsLocating] = useState(false);
  const [addressError, setAddressError] = useState('');

  useEffect(() => {
    saveProgress();
  }, [address]);

  const handleAddressSelected = (addr: string) => {
    setAddress(addr);
    setAddressError('');
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setAddressError('La geolocalización no está disponible');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          // Usamos las coordenadas para crear una dirección mock
          const mockAddress = `Calle Ejemplo ${Math.floor(Math.random() * 100)}, Madrid (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
          setAddress(mockAddress);
          setAddressError('');
        } catch (error) {
          setAddressError('No se pudo obtener la dirección');
        } finally {
          setIsLocating(false);
        }
      },
      (error) => {
        setAddressError('No se pudo obtener tu ubicación');
        setIsLocating(false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  const validateAndContinue = () => {
    if (!address.trim()) {
      setAddressError('Por favor, introduce una dirección');
      return;
    }

    // Validar que tenga número
    const hasNumber = /\d+/.test(address);
    if (!hasNumber) {
      setAddressError('Por favor, incluye el número de la casa');
      return;
    }

    setBookingData({ address });
    saveProgress();
    setCurrentStep(2);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => {
              prevStep();
            }}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">Dirección</h1>
          <div className="w-9" />
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-white">
        <div className="max-w-md mx-auto px-4 py-3">
          <div className="flex items-center space-x-2 text-sm text-gray-600 mb-2">
            <span>Paso 1 de 5</span>
            <div className="flex-1 bg-gray-200 rounded-full h-1">
              <div className="bg-green-600 h-1 rounded-full" style={{ width: '20%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            ¿Dónde está tu jardín?
          </h2>
          <p className="text-gray-600 mb-6">
            Necesitamos tu dirección para encontrar jardineros cerca de ti
          </p>

          {/* Address Input */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Dirección completa
            </label>
            <AddressAutocomplete
              value={address}
              onChange={handleAddressSelected}
              error={addressError}
              placeholder="Buscar dirección..."
            />
          </div>

          {/* Use Current Location */}
          <button
            onClick={handleUseCurrentLocation}
            disabled={isLocating}
            className="w-full flex items-center justify-center space-x-2 bg-blue-50 text-blue-700 py-3 px-4 rounded-xl hover:bg-blue-100 transition-colors disabled:opacity-50"
          >
            <Navigation className="w-4 h-4" />
            <span>{isLocating ? 'Obteniendo ubicación...' : 'Usar mi ubicación actual'}</span>
          </button>

          {addressError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-700">{addressError}</p>
            </div>
          )}
        </div>

        {/* Tips */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <div className="flex items-start space-x-3">
            <MapPin className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-blue-900 text-sm mb-1">
                Consejo
              </h3>
              <p className="text-sm text-blue-700">
                Incluye el número exacto de tu casa para que el jardinero te encuentre fácilmente
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky CTA */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4">
        <div className="max-w-md mx-auto">
          <button
            onClick={validateAndContinue}
            disabled={!address.trim()}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-2xl font-semibold text-lg shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddressPage;
