import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, MapPin, Star, Clock, Euro } from 'lucide-react';
import { Service } from '../../types';
import { supabase } from '../../lib/supabase';

const ServiceCatalog = () => {
  const [services, setServices] = useState<Service[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Catálogo limitado a los 6 servicios canónicos de la IA
  const ALLOWED_SERVICE_NAMES = [
    'Corte de césped',
    'Poda de plantas',
    'Corte de setos a máquina',
    'Corte de arbustos pequeños o ramas finas a tijera',
    'Labrar y quitar malas hierbas a mano',
    'Fumigación de plantas'
  ];
  const normalizeText = (s: string) => (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const ALLOWED_NORMALIZED = ALLOWED_SERVICE_NAMES.map(normalizeText);
  const isAllowedServiceName = (name?: string) => {
    const n = normalizeText(name || '');
    if (!n) return false;
    return ALLOWED_NORMALIZED.includes(n);
  };

  useEffect(() => {
    fetchServices();
  }, []);

  const fetchServices = async () => {
    try {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .order('name');

      if (error) throw error;
      const all = data || [];
      const filtered = all.filter(s => isAllowedServiceName(s.name));
      setServices(filtered);
    } catch (error) {
      console.error('Error fetching services:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredServices = services.filter(service =>
    service.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    service.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleServiceClick = (serviceId: string) => {
    navigate(`/service/${serviceId}`);
  };

  const handleBookNow = (service: Service, e: React.MouseEvent) => {
    e.stopPropagation();
    navigate('/booking');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-green-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Servicios de Jardinería Profesional
        </h1>
        <p className="text-xl text-gray-600 max-w-3xl mx-auto">
          Encuentra el servicio perfecto para tu jardín. Profesionales cualificados a tu disposición.
        </p>
      </div>

      {/* Search Bar */}
      <div className="mb-8">
        <div className="relative max-w-md mx-auto">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar servicios..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredServices.map((service) => (
          <div
            key={service.id}
            onClick={() => handleServiceClick(service.id)}
            className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer transform hover:-translate-y-1 overflow-hidden"
          >
            {/* Service Image */}
            <div className="h-48 bg-gradient-to-br from-green-400 to-green-600 relative overflow-hidden">
              <img
                src={`https://images.pexels.com/photos/${service.image_id || '416978'}/pexels-photo-${service.image_id || '416978'}.jpeg?auto=compress&cs=tinysrgb&w=800`}
                alt={service.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute top-4 right-4 bg-white bg-opacity-90 backdrop-blur-sm rounded-full px-3 py-1">
                <div className="flex items-center text-sm font-semibold text-gray-900">
                  <Euro className="w-4 h-4 mr-1" />
                  {service.base_price}
                </div>
              </div>
            </div>

            {/* Service Content */}
            <div className="p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-2">{service.name}</h3>
              <p className="text-gray-600 mb-4 line-clamp-2">{service.description}</p>
              
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center text-sm text-gray-500">
                  <Clock className="w-4 h-4 mr-1" />
                  Desde 1 hora
                </div>
                <div className="flex items-center text-sm text-gray-500">
                  <MapPin className="w-4 h-4 mr-1" />
                  A domicilio
                </div>
              </div>

              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <Star className="w-4 h-4 text-yellow-400 fill-current" />
                  <span className="text-sm text-gray-600 ml-1">4.8 (127 reseñas)</span>
                </div>
              </div>
              
              <div className="flex gap-2">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleServiceClick(service.id);
                  }}
                  className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                >
                  Ver detalles
                </button>
                <button 
                  onClick={(e) => handleBookNow(service, e)}
                  className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors font-medium"
                >
                  Reservar
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredServices.length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-400 mb-4">
            <Search className="w-16 h-16 mx-auto" />
          </div>
          <p className="text-gray-600">No se encontraron servicios que coincidan con tu búsqueda.</p>
        </div>
      )}
    </div>
  );
};

export default ServiceCatalog;