import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronLeft, MapPin, Navigation } from 'lucide-react';
import AddressAutocomplete from '../../components/common/AddressAutocomplete';
import { getAddressFromCoordinates, getCoordinatesFromAddress } from '../../utils/geolocation';

const AddressPage: React.FC = () => {
  const navigate = useNavigate();
  const { bookingData, setBookingData, saveProgress, setCurrentStep } = useBooking();
  const [address, setAddress] = useState(bookingData.address);
  const [addressCoordinates, setAddressCoordinates] = useState(bookingData.addressCoordinates || null);
  const [isLocating, setIsLocating] = useState(false);
  const [addressError, setAddressError] = useState('');

  useEffect(() => {
    saveProgress();
  }, [address]);

  const handleAddressSelected = (addr: string) => {
    setAddress(addr);
    setAddressCoordinates(null);
    setAddressError('');
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setAddressError('La geolocalización no está disponible');
      return;
    }

    setIsLocating(true);
    setAddressError('');
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const resolvedAddress = await getAddressFromCoordinates(latitude, longitude);
          // Aunque el geocoding inverso falle, las coordenadas son fiables: las guardamos igual
          // para no bloquear la reserva. Solo pedimos que revise/complete el texto de la dirección.
          setAddressCoordinates({ lat: latitude, lng: longitude });
          if (resolvedAddress) {
            setAddress(resolvedAddress);
            setAddressError('');
          } else {
            setAddressError('Tenemos tu ubicación, pero no pudimos completar la dirección automáticamente. Escríbela para continuar.');
          }
        } catch (error) {
          setAddressError('No se pudo obtener la dirección a partir de tu ubicación. Escríbela manualmente.');
        } finally {
          setIsLocating(false);
        }
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setAddressError('Permiso de ubicación denegado. Actívalo en tu navegador o escribe la dirección manualmente.');
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setAddressError('No se pudo determinar tu ubicación (sin señal GPS). Escribe la dirección manualmente.');
        } else if (error.code === error.TIMEOUT) {
          setAddressError('Se agotó el tiempo obteniendo tu ubicación. Inténtalo de nuevo o escribe la dirección.');
        } else {
          setAddressError('No se pudo obtener tu ubicación. Escribe la dirección manualmente.');
        }
        setIsLocating(false);
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  const validateAndContinue = async () => {
    if (!address.trim()) {
      setAddressError('Por favor, introduce una dirección');
      return;
    }

    // Si ya tenemos coordenadas fiables (ubicación actual o dirección seleccionada del
    // autocompletado) no exigimos número de casa: la localización en el mapa ya es precisa.
    // Solo se pide el número cuando el cliente teclea la dirección a mano y aún no hay coords.
    if (!addressCoordinates) {
      const hasNumber = /\d+/.test(address);
      if (!hasNumber) {
        setAddressError('Por favor, incluye el número de la casa');
        return;
      }
    }

    let resolvedCoordinates = addressCoordinates;
    if (!resolvedCoordinates) {
      resolvedCoordinates = await getCoordinatesFromAddress(address.trim());
    }

    if (!resolvedCoordinates) {
      setAddressError('No se pudo validar la dirección en el mapa. Selecciona una dirección sugerida o usa tu ubicación actual.');
      return;
    }

    setBookingData({
      address,
      addressCoordinates: resolvedCoordinates,
    });
    saveProgress();
    setCurrentStep(1);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="mx-auto w-full px-4 py-4 sm:max-w-md flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              navigate('/');
            }}
            aria-label="Volver al inicio"
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            <ChevronLeft aria-hidden="true" className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">Dirección</h1>
          <div className="w-9" />
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-white">
        <div className="mx-auto w-full px-4 py-3 sm:max-w-md">
          <div className="flex items-center space-x-2 text-sm text-gray-600 mb-2">
            <span>Paso 1 de 5</span>
            <div className="flex-1 bg-gray-200 rounded-full h-1">
              <div className="bg-green-600 h-1 rounded-full" style={{ width: '20%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto w-full px-4 py-6 pb-24 sm:max-w-md">
        <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            ¿Dónde está tu jardín?
          </h2>
          <p className="text-gray-600 mb-6">
            Necesitamos tu dirección para encontrar jardineros cerca de ti
          </p>

          {/* Address Input */}
          <div className="mb-4">
            <label htmlFor="booking-address" className="block text-sm font-medium text-gray-700 mb-2">
              Dirección completa
            </label>
            <AddressAutocomplete
              id="booking-address"
              name="booking-address"
              value={address}
              onChange={handleAddressSelected}
              error={addressError}
              placeholder="Buscar dirección completa…"
            />
          </div>

          {/* Use Current Location */}
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={isLocating}
            aria-busy={isLocating}
            className="w-full flex items-center justify-center space-x-2 bg-blue-50 text-blue-700 py-3 px-4 rounded-xl hover:bg-blue-100 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Navigation aria-hidden="true" className="w-4 h-4" />
            <span>{isLocating ? 'Obteniendo ubicación…' : 'Usar mi ubicación actual'}</span>
          </button>

          {addressError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg" aria-live="polite">
              <p className="text-sm text-red-700">{addressError}</p>
            </div>
          )}
        </div>

        {/* Tips */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
          <div className="flex items-start space-x-3">
            <MapPin aria-hidden="true" className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
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

      {/* Fixed CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] z-50">
        <div className="mx-auto w-full sm:max-w-md">
          <button
            type="button"
            onClick={validateAndContinue}
            disabled={!address.trim()}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-2xl font-semibold text-lg shadow-lg hover:shadow-xl hover:scale-[1.02] transition-transform duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
          >
            Continuar a servicios
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddressPage;
