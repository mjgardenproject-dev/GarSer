import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Star, Clock, MapPin, Euro, CheckCircle, AlertTriangle } from 'lucide-react';
import { Service } from '../../types';
import { supabase } from '../../lib/supabase';

const ServiceDetail = () => {
  const { serviceId } = useParams();
  const navigate = useNavigate();
  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (serviceId) {
      fetchService();
    }
  }, [serviceId]);

  const fetchService = async () => {
    try {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('id', serviceId)
        .single();

      if (error) throw error;
      setService(data);
    } catch (error) {
      console.error('Error fetching service:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleBookService = () => {
    navigate('/booking');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-green-600"></div>
      </div>
    );
  }

  if (!service) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Servicio no encontrado</h1>
        <button
          onClick={() => navigate('/dashboard')}
          className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors"
        >
          Volver al catálogo
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      {/* Back Button */}
      <button
        onClick={() => navigate('/dashboard')}
        className="flex items-center text-gray-600 hover:text-gray-900 mb-6 transition-colors"
      >
        <ArrowLeft className="w-5 h-5 mr-2" />
        Volver al catálogo
      </button>

      <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Service Image */}
        <div className="h-64 md:h-80 bg-gradient-to-br from-green-400 to-green-600 relative">
          <img
            src={`https://images.pexels.com/photos/${service.image_id || '416978'}/pexels-photo-${service.image_id || '416978'}.jpeg?auto=compress&cs=tinysrgb&w=1200`}
            alt={service.name}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black bg-opacity-20"></div>
          <div className="absolute bottom-6 left-6 text-white">
            <h1 className="text-3xl md:text-4xl font-bold mb-2">{service.name}</h1>
            <div className="flex items-center">
              <Star className="w-5 h-5 text-yellow-400 fill-current mr-1" />
              <span className="text-lg">4.8 (127 reseñas)</span>
            </div>
          </div>
        </div>

        {/* Service Content */}
        <div className="p-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Main Content */}
            <div className="lg:col-span-2">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Descripción del servicio</h2>
              <p className="text-gray-600 text-lg leading-relaxed mb-6">
                {service.description}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="bg-green-50 p-4 rounded-lg text-center">
                  <Clock className="w-8 h-8 text-green-600 mx-auto mb-2" />
                  <p className="font-semibold text-gray-900">Duración flexible</p>
                  <p className="text-sm text-gray-600">Desde 1 hora</p>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg text-center">
                  <MapPin className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                  <p className="font-semibold text-gray-900">A domicilio</p>
                  <p className="text-sm text-gray-600">En tu ubicación</p>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg text-center">
                  <CheckCircle className="w-8 h-8 text-purple-600 mx-auto mb-2" />
                  <p className="font-semibold text-gray-900">Profesional</p>
                  <p className="text-sm text-gray-600">Jardineros expertos</p>
                </div>
              </div>

              {/* Service Includes */}
              <h3 className="text-xl font-bold text-gray-900 mb-4">¿Qué incluye este servicio?</h3>
              <ul className="space-y-2 mb-6">
                <li className="flex items-center text-gray-600">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                  Mano de obra profesional especializada
                </li>
                <li className="flex items-center text-gray-600">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                  Herramientas y equipamiento necesario
                </li>
                <li className="flex items-center text-gray-600">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                  Limpieza y recogida de residuos
                </li>
                <li className="flex items-center text-gray-600">
                  <CheckCircle className="w-5 h-5 text-green-500 mr-3" />
                  Asesoramiento personalizado
                </li>
              </ul>

              {/* Important Notes */}
              {(service.name.includes('Fumigación') || 
                service.name.includes('Plantación') || 
                service.name.includes('Instalación') || 
                service.name.includes('Fertilización')) && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                  <div className="flex items-start">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 mr-3 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-yellow-800 mb-1">Importante</h4>
                      <p className="text-yellow-700 text-sm">
                        El coste de los materiales, productos o plantas no está incluido en el precio del servicio.
                        El jardinero te asesorará sobre los mejores productos para tu caso específico.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Booking Card */}
            <div className="lg:col-span-1">
              <div className="bg-gray-50 rounded-xl p-6 lg:sticky lg:top-6">
                <div className="text-center mb-6">
                  <div className="text-3xl font-bold text-gray-900 mb-2">
                    €{service.base_price}
                  </div>
                  <p className="text-gray-600">Precio base del servicio</p>
                </div>

                <div className="space-y-3 mb-6 text-sm text-gray-600">
                  <div className="flex justify-between">
                    <span>Precio base:</span>
                    <span>€{service.base_price}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Desplazamiento:</span>
                    <span>€15</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Por hora adicional:</span>
                    <span>€25/h</span>
                  </div>
                  <hr className="my-2" />
                  <div className="flex justify-between font-semibold text-gray-900">
                    <span>Total estimado (1h):</span>
                    <span>€{service.base_price + 15 + 25}</span>
                  </div>
                </div>

                <button
                  onClick={handleBookService}
                  className="w-full bg-green-600 text-white py-3 px-6 rounded-lg hover:bg-green-700 transition-colors font-semibold text-lg"
                >
                  Reservar Servicio
                </button>

                <p className="text-xs text-gray-500 text-center mt-3">
                  El precio final se calculará según la duración seleccionada
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServiceDetail;
