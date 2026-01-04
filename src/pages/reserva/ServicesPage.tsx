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
  image_url?: string;
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
        let imageMap: Record<string, string> = {};
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
        const merged = (data as any[]).map(s => ({ ...s, image_url: imageMap[s.id] || s.image_url }));
        setServices(merged as Service[]);
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
            Seleccione los servicios necesarios para su jardín
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {services.map((service) => {
            const images: Record<string, string> = {
              'Corte de césped': 'https://trae-api-us.mchost.guru/api/ide/v1/text_to_image?prompt=Close-up%20of%20freshly%20cut%20green%20lawn%20in%20a%20sunny%20residential%20garden%2C%20with%20sharp%20cut%20lines%20visible%20and%20a%20lawnmower%20partially%20visible%20in%20the%20background%2C%20soft%20natural%20lighting%2C%20realistic%20photography%2C%20high%20detail&image_size=landscape_4_3',
              'Corte de setos a máquina': 'https://trae-api-us.mchost.guru/api/ide/v1/text_to_image?prompt=Perfectly%20trimmed%20green%20hedges%20in%20a%20residential%20garden%2C%20showing%20a%20straight%20clean%20cut%2C%20with%20an%20electric%20hedge%20trimmer%20resting%20nearby%2C%20soft%20afternoon%20sunlight%2C%20realistic%20photography%2C%20professional%20gardening&image_size=landscape_4_3',
              'Poda de plantas': 'https://trae-api-us.mchost.guru/api/ide/v1/text_to_image?prompt=Close-up%20of%20trimming%20ornamental%20flowering%20plants%20with%20hand%20pruners%20in%20a%20garden%2C%20focus%20on%20the%20cut%20and%20healthy%20stems%2C%20natural%20soft%20lighting%2C%20realistic%20photography%2C%20detailed&image_size=landscape_4_3',
              'Poda de árboles': 'https://trae-api-us.mchost.guru/api/ide/v1/text_to_image?prompt=Professional%20pruning%20of%20a%20small%20residential%20tree%2C%20focus%20on%20a%20branch%20being%20cut%20with%20pruning%20shears%2C%20soft%20sunlight%20filtering%20through%20leaves%2C%20realistic%20photography%2C%20garden%20maintenance&image_size=landscape_4_3',
              'Labrar y quitar malas hierbas a mano': 'https://trae-api-us.mchost.guru/api/ide/v1/text_to_image?prompt=Hands%20with%20gardening%20gloves%20removing%20weeds%20from%20soil%20in%20a%20residential%20garden%2C%20showing%20tilled%20earth%20and%20small%20hand%20tools%2C%20close-up%20shot%2C%20natural%20daylight%2C%20realistic%20photography&image_size=landscape_4_3',
              'Fumigación de plantas': 'https://trae-api-us.mchost.guru/api/ide/v1/text_to_image?prompt=Close-up%20of%20a%20person%20spraying%20ornamental%20plants%20in%20a%20home%20garden%20with%20a%20manual%20sprayer%2C%20focus%20on%20the%20mist%20and%20green%20leaves%2C%20soft%20natural%20light%2C%20realistic%20photography%2C%20gardening%20care&image_size=landscape_4_3'
            };
            const imageUrl = (service as any)?.image_url || images[service.name] || 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?q=80&w=600&auto=format&fit=crop';
            const isSelected = selectedServices.includes(service.id);
            
            return (
              <button
                key={service.id}
                onClick={() => toggleService(service.id)}
                className={`relative rounded-xl overflow-hidden border transition-all duration-200 h-[104px] w-full ${
                  isSelected ? 'border-green-600 ring-2 ring-green-600' : 'border-gray-200'
                }`}
                style={{ backgroundImage: `url(${imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
              >
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/20 to-transparent" />
                <div className="absolute inset-x-1 bottom-1 text-center">
                  <h3 className={`text-white text-sm font-semibold ${isSelected ? '' : ''}`}>
                    {service.name}
                  </h3>
                </div>
                {isSelected && (
                  <div className="absolute top-2 right-2 bg-green-600 text-white rounded-full p-1">
                    <Check className="w-4 h-4" />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        
      </div>

      {/* Fixed CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] z-50">
        <div className="max-w-md mx-auto">
          <button
            onClick={handleContinue}
            disabled={selectedServices.length === 0}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-2xl font-semibold text-lg shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            {selectedServices.length === 0 
              ? 'Selecciona al menos un servicio'
              : `Continuar con ${selectedServices.length} servicio${selectedServices.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ServicesPage;
