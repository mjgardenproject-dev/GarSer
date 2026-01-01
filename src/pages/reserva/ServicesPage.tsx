import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronLeft, Check, Sparkles, Scissors, TreePine, Sprout, Leaf } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface Service {
  id: string;
  name: string;
  description: string;
  icon: string;
  base_price: number;
}

const serviceIcons = {
  'Corte de césped': Scissors,
  'Corte de setos a máquina': TreePine,
  'Poda de plantas': Sprout,
  'Poda de árboles': TreePine,
  'Labrar y quitar malas hierbas a mano': Leaf,
  'Fumigación de plantas': Sparkles,
};

const ServicesPage: React.FC = () => {
  const navigate = useNavigate();
  const { bookingData, setBookingData, saveProgress, setCurrentStep } = useBooking();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedServices, setSelectedServices] = useState<string[]>(bookingData.serviceIds);

  useEffect(() => {
    fetchServices();
  }, []);

  useEffect(() => {
    saveProgress();
  }, [selectedServices]);

  const fetchServices = async () => {
    try {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .order('name');
      
      if (!error && data) {
        setServices(data);
      }
    } catch (error) {
      console.error('Error fetching services:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleService = (serviceId: string) => {
    setSelectedServices(prev => 
      prev.includes(serviceId) 
        ? prev.filter(id => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  const handleContinue = () => {
    if (selectedServices.length === 0) {
      return;
    }
    setBookingData({ serviceIds: selectedServices });
    saveProgress();
    setCurrentStep(3);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando servicios...</p>
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
            onClick={() => setCurrentStep(1)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">Servicios</h1>
          <div className="w-9" />
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-white">
        <div className="max-w-md mx-auto px-4 py-3">
          <div className="flex items-center space-x-2 text-sm text-gray-600 mb-2">
            <span>Paso 2 de 5</span>
            <div className="flex-1 bg-gray-200 rounded-full h-1">
              <div className="bg-green-600 h-1 rounded-full" style={{ width: '40%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            ¿Qué necesitas para tu jardín?
          </h2>
          <p className="text-gray-600">
            Selecciona los servicios que necesitas. Puedes elegir varios.
          </p>
        </div>

        {/* Services Grid */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {services.map((service) => {
            const IconComponent = serviceIcons[service.name as keyof typeof serviceIcons] || Sparkles;
            const isSelected = selectedServices.includes(service.id);
            
            return (
              <button
                key={service.id}
                onClick={() => toggleService(service.id)}
                className={`p-4 rounded-2xl border-2 transition-all duration-200 ${
                  isSelected
                    ? 'border-green-600 bg-green-50 shadow-lg'
                    : 'border-gray-200 bg-white hover:border-green-300 hover:shadow-md'
                }`}
              >
                <div className="flex flex-col items-center text-center">
                  <div className={`p-3 rounded-full mb-2 ${
                    isSelected ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'
                  }`}>
                    <IconComponent className="w-6 h-6" />
                  </div>
                  <h3 className="font-semibold text-gray-900 text-sm mb-1">
                    {service.name}
                  </h3>
                  <p className="text-xs text-gray-500 line-clamp-2">
                    {service.description}
                  </p>
                  {isSelected && (
                    <div className="mt-2">
                      <Check className="w-5 h-5 text-green-600" />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Summary */}
        {selectedServices.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-900">
                  {selectedServices.length} servicio{selectedServices.length !== 1 ? 's' : ''} seleccionado{selectedServices.length !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-green-700">
                  Puedes modificar tu selección más tarde
                </p>
              </div>
              <Check className="w-5 h-5 text-green-600" />
            </div>
          </div>
        )}
      </div>

      {/* Sticky CTA */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 p-4">
        <div className="max-w-md mx-auto">
          <button
            onClick={handleContinue}
            disabled={selectedServices.length === 0}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-2xl font-semibold text-lg shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            {selectedServices.length === 0 
              ? 'Selecciona al menos un servicio'
              : `Continuar con ${selectedServices.length} servicio${selectedServices.length !== 1 ? 's' : ''}`
            }
          </button>
        </div>
      </div>
    </div>
  );
};

export default ServicesPage;
