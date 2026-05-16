import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronLeft, Check, ImageOff, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Service } from '../../types';
import { getServiceImageFallbackUrl, getServiceImageUrl } from '../../utils/serviceImages';

const ServicesPage: React.FC = () => {
  const location = useLocation();
  const { bookingData, setBookingData, saveProgress, setCurrentStep } = useBooking();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedServices, setSelectedServices] = useState<string[]>(bookingData.serviceIds);
  const [imageFallbacks, setImageFallbacks] = useState<Record<string, string>>({});

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
      setImageFallbacks({});
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
    if (currentSrc !== fallbackUrl) {
      setImageFallbacks((prev) => ({ ...prev, [service.id]: fallbackUrl }));
    }
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando servicios…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setCurrentStep(0)}
            aria-label="Volver al paso de dirección"
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            <ChevronLeft aria-hidden="true" className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">Servicios</h1>
          <div className="w-9" />
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-white">
        <div className="max-w-md mx-auto px-4 py-2">
          <div className="flex items-center space-x-2 text-sm text-gray-600 mb-2">
            <span>Paso 2 de 5</span>
            <div className="flex-1 bg-gray-200 rounded-full h-1">
              <div className="bg-green-600 h-1 rounded-full" style={{ width: '40%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-md mx-auto px-3 py-3 pb-24">
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
            <button
              type="button"
              onClick={fetchServices}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              Reintentar carga
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 mb-4">
          {services.map((service) => {
            const isSelected = selectedServices.includes(service.id);
            const imageUrl = imageFallbacks[service.id] || getServiceImageUrl(service, 800);
            
            return (
              <button
                key={service.id}
                type="button"
                onClick={() => toggleService(service.id)}
                aria-pressed={isSelected}
                aria-label={`Seleccionar ${service.name}`}
                className={`relative rounded-xl overflow-hidden border transition-colors duration-200 h-[104px] w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 ${
                  isSelected ? 'border-green-600 ring-2 ring-green-600' : 'border-gray-200'
                }`}
              >
                <img
                  src={imageUrl}
                  alt=""
                  width={800}
                  height={450}
                  loading="lazy"
                  onError={(event) => handleImageError(service, event.currentTarget.src)}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/20 to-transparent" />
                {imageFallbacks[service.id] && (
                  <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
                    <ImageOff aria-hidden="true" className="h-3 w-3" />
                    Imagen alternativa
                  </div>
                )}
                <div className="absolute inset-x-1 bottom-1 text-center">
                  <h3 className="text-white text-sm font-semibold text-pretty">
                    {service.name}
                  </h3>
                </div>
                {isSelected && (
                  <div className="absolute top-2 right-2 bg-green-600 text-white rounded-full p-1">
                    <Check aria-hidden="true" className="w-4 h-4" />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {!loading && !loadError && services.length === 0 && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
            <p className="text-base font-semibold text-gray-900">No hay servicios disponibles ahora mismo.</p>
            <p className="mt-2 text-sm text-gray-600">
              Reintenta en unos minutos para consultar de nuevo el catálogo.
            </p>
            <button
              type="button"
              onClick={fetchServices}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              Reintentar
            </button>
          </div>
        )}

        
      </div>

      {/* Fixed CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] z-50">
        <div className="max-w-md mx-auto">
          <button
            type="button"
            onClick={handleContinue}
            disabled={selectedServices.length === 0}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-2xl font-semibold text-lg shadow-lg hover:shadow-xl hover:scale-[1.02] motion-reduce:transform-none transition-transform duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
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
