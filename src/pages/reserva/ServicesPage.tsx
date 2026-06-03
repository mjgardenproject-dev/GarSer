import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronLeft, Check, ImageOff, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Service } from '../../types';
import { getServiceImageFallbackUrl, getServiceImageUrl } from '../../utils/serviceImages';

const MAX_MANUAL_RETRIES = 3;

const ServicesPage: React.FC = () => {
  const location = useLocation();
  const { bookingData, setBookingData, saveProgress, setCurrentStep } = useBooking();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedServices, setSelectedServices] = useState<string[]>(bookingData.serviceIds);
  const [manualRetryCount, setManualRetryCount] = useState(0);
  const [imageStates, setImageStates] = useState<Record<string, 'fallback' | 'unavailable'>>({});

  useEffect(() => {
    fetchServices();
  }, []);

  useEffect(() => {
    const preselectedServiceId = (location.state as { selectedServiceId?: string } | null)?.selectedServiceId;
    if (preselectedServiceId && selectedServices.length === 0) {
      setSelectedServices([preselectedServiceId]);
    }
  }, [location.state, selectedServices.length]);

  useEffect(() => {
    saveProgress();
  }, [selectedServices]);

  const fetchServices = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) {
        throw error;
      }

      const imageMap: Record<string, string> = {};
      try {
        const { data: images } = await supabase
          .from('service_images')
          .select('service_id,image_url,active');
        (images || []).forEach((row: any) => {
          if (row?.active !== false && row?.service_id && row?.image_url) {
            imageMap[row.service_id] = row.image_url;
          }
        });
      } catch {}

      const merged = (data as any[]).map((serviceRow) => {
        let updatedName = serviceRow.name;
        if (
          updatedName.toLowerCase().includes('fumigación') ||
          updatedName.toLowerCase().includes('fumigacion') ||
          updatedName.toLowerCase().includes('tratamientos fitosanitarios')
        ) {
          updatedName = 'Servicios fitosanitarios';
        }
        return {
          ...serviceRow,
          name: updatedName,
          image_url: imageMap[serviceRow.id] || serviceRow.image_url,
        };
      });

      setServices(merged as Service[]);
      setImageStates({});
      setManualRetryCount(0);
    } catch (error) {
      console.error('Error fetching services:', error);
      setServices([]);
      setLoadError('No se pudieron cargar los servicios ahora mismo. Reintenta para continuar con la reserva.');
    } finally {
      setLoading(false);
    }
  };

  const handleImageError = (service: Service, currentSrc: string) => {
    const fallbackUrl = getServiceImageFallbackUrl(service.name);
    setImageStates((prev) => {
      if (prev[service.id] === 'unavailable') return prev;
      if (currentSrc !== fallbackUrl && prev[service.id] !== 'fallback') {
        return { ...prev, [service.id]: 'fallback' };
      }
      return { ...prev, [service.id]: 'unavailable' };
    });
  };

  const handleRetry = () => {
    if (loading || manualRetryCount >= MAX_MANUAL_RETRIES) {
      return;
    }
    setManualRetryCount((prev) => prev + 1);
    void fetchServices();
  };

  const toggleService = (serviceId: string) => {
    setSelectedServices(prev =>
      prev.includes(serviceId) ? [] : [serviceId]
    );
  };

  const handleContinue = () => {
    if (selectedServices.length === 0) {
      return;
    }
    setBookingData({ serviceIds: selectedServices });
    saveProgress();
    setCurrentStep(2);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="mx-auto w-full px-4 py-4 sm:max-w-md flex items-center justify-between">
          <button
            type="button"
            onClick={() => setCurrentStep(0)}
            aria-label="Volver al paso de dirección"
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [touch-action:manipulation]"
          >
            <ChevronLeft aria-hidden="true" className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">Servicios</h1>
          <div className="w-9" />
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-white">
        <div className="mx-auto w-full px-4 py-2 sm:max-w-md">
          <div className="flex items-center space-x-2 text-sm text-gray-600 mb-2">
            <span>Paso 2 de 5</span>
            <div className="flex-1 bg-gray-200 rounded-full h-1">
              <div className="bg-green-600 h-1 rounded-full" style={{ width: '40%' }} />
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full px-3 py-3 pb-24 sm:max-w-md" id="services-main">
        <div className="mb-3">
          <p className="text-sm font-medium text-gray-900">
            Selecciona el servicio que quieres reservar
          </p>
        </div>

        {loadError && (
          <div aria-live="polite" className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-900">No se ha podido cargar el catálogo.</p>
            <p className="mt-1 text-sm text-red-700">
              Reintenta ahora. Si el problema continúa, vuelve a intentarlo en unos minutos.
            </p>
            <p className="mt-2 text-xs text-red-700">
              {manualRetryCount < MAX_MANUAL_RETRIES
                ? `Reintentos manuales restantes: ${MAX_MANUAL_RETRIES - manualRetryCount}.`
                : 'Se han agotado los reintentos manuales en esta sesión. Vuelve atrás o recarga la página para reiniciar.'}
            </p>
            <button
              type="button"
              onClick={handleRetry}
              disabled={loading || manualRetryCount >= MAX_MANUAL_RETRIES}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 [touch-action:manipulation]"
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              {loading ? 'Reintentando…' : manualRetryCount >= MAX_MANUAL_RETRIES ? 'Reintentos agotados' : 'Reintentar carga'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 gap-2 mb-4" aria-live="polite" aria-busy="true">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-[104px] w-full animate-pulse rounded-xl border border-gray-200 bg-white p-3">
                <div className="h-full rounded-lg bg-gray-200" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 mb-4">
            {services.map((service) => {
              const isSelected = selectedServices.includes(service.id);
              const imageState = imageStates[service.id];
              const fallbackUrl = getServiceImageFallbackUrl(service.name);
              const imageUrl = imageState === 'fallback' ? fallbackUrl : getServiceImageUrl(service);
              const imageUnavailable = imageState === 'unavailable';

              return (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => toggleService(service.id)}
                  aria-pressed={isSelected}
                  aria-label={`Seleccionar ${service.name}`}
                  className={`relative h-[104px] w-full overflow-hidden rounded-xl border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation] ${
                    isSelected ? 'border-green-600 ring-2 ring-green-600' : 'border-gray-200'
                  }`}
                >
                  {!imageUnavailable ? (
                    <img
                      src={imageUrl}
                      alt=""
                      width={800}
                      height={450}
                      loading="lazy"
                      onError={(event) => handleImageError(service, event.currentTarget.src)}
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-gray-200 to-gray-300" />
                  )}
                  <div className={`absolute inset-0 ${imageUnavailable ? 'bg-gray-900/40' : 'bg-gradient-to-t from-black/40 via-black/20 to-transparent'}`} />
                  {imageState === 'fallback' && (
                    <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
                      <ImageOff aria-hidden="true" className="h-3 w-3" />
                      Imagen alternativa
                    </div>
                  )}
                  {imageUnavailable && (
                    <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
                      <ImageOff aria-hidden="true" className="h-3 w-3" />
                      Imagen no disponible
                    </div>
                  )}
                  <div className="absolute inset-x-1 bottom-1 text-center">
                    <h3 className="text-sm font-semibold text-white text-pretty">
                      {service.name}
                    </h3>
                  </div>
                  {isSelected && (
                    <div className="absolute top-2 right-2 rounded-full bg-green-600 p-1 text-white">
                      <Check aria-hidden="true" className="w-4 h-4" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {!loading && !loadError && services.length === 0 && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
            <p className="text-base font-semibold text-gray-900">No hay servicios disponibles ahora mismo.</p>
            <p className="mt-2 text-sm text-gray-600">
              Reintenta en unos minutos para consultar de nuevo el catálogo.
            </p>
            <button
              type="button"
              onClick={handleRetry}
              disabled={loading}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 [touch-action:manipulation]"
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              {loading ? 'Actualizando…' : 'Actualizar catálogo'}
            </button>
          </div>
        )}
      </main>

      {/* Fixed CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] z-50">
        <div className="mx-auto w-full sm:max-w-md">
          <button
            type="button"
            onClick={handleContinue}
            disabled={selectedServices.length === 0}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 px-6 py-4 text-lg font-semibold text-white shadow-lg transition-transform duration-200 hover:scale-[1.02] hover:shadow-xl motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 rounded-2xl [touch-action:manipulation]"
          >
            {selectedServices.length === 0
              ? 'Selecciona un servicio'
              : 'Continuar a los detalles del servicio'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ServicesPage;
