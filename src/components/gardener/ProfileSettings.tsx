import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { Save, User, MapPin, Phone, Briefcase, Star, ArrowLeft } from 'lucide-react';
import { Service, GardenerProfile } from '../../types';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import AddressAutocomplete from '../common/AddressAutocomplete';
import DistanceMapSelector from '../common/DistanceMapSelector';
import PalmPricingConfigurator, { PalmPricingConfig } from './PalmPricingConfigurator';
import LawnPricingConfigurator, { LawnPricingConfig } from './LawnPricingConfigurator';
import HedgePricingConfigurator, { HedgePricingConfig } from './HedgePricingConfigurator';
import TreePricingConfigurator, { TreePricingConfig } from './TreePricingConfigurator';
import ShrubPricingConfigurator, { ShrubPricingConfig } from './ShrubPricingConfigurator';
import ClearingPricingConfigurator, { ClearingPricingConfig } from './ClearingPricingConfigurator';
import FumigationPricingConfigurator, { FumigationPricingConfig } from './FumigationPricingConfigurator';
import StandardServiceConfig, { StandardPricingConfig } from './StandardServiceConfig';

// Sólo permitir los servicios definidos en el estimador IA (coincidencia estricta de nombre)
const ALLOWED_SERVICE_NAMES = [
  'Corte de césped',
  'Poda de plantas',
  'Corte de setos a máquina',
  'Poda de árboles',
  'Labrar y quitar malas hierbas a mano',
  'Fumigación de plantas',
  'Poda de palmeras'
];
const normalizeText = (s: string) => (s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const ALLOWED_NORMALIZED = ALLOWED_SERVICE_NAMES.map(normalizeText);
const isAllowedServiceName = (name?: string) => {
  const n = normalizeText(name || '');
  if (!n) return false;
  // Coincidencia estricta por nombre normalizado (evita coincidencias parciales/sinónimos)
  return ALLOWED_NORMALIZED.includes(n);
};

const schema = yup.object({
  full_name: yup.string().required('Nombre completo requerido'),
  phone: yup.string().required('Teléfono requerido'),
  address: yup.string().required('Dirección requerida'),
  description: yup.string().required('Descripción requerida'),
  max_distance: yup.number().min(1, 'Mínimo 1 km').max(100, 'Máximo 100 km').required('Distancia requerida'),
  services: yup.array().min(1, 'Selecciona al menos un servicio').required('Servicios requeridos')
});

type FormData = yup.InferType<typeof schema>;

interface ProfileSettingsProps {
  onBack?: () => void;
}

const ProfileSettings: React.FC<ProfileSettingsProps> = ({ onBack }) => {
  const { user } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(false);
  const [gardenerProfile, setGardenerProfile] = useState<GardenerProfile | null>(null);
  const [servicePrices, setServicePrices] = useState<Record<string, number>>({});
  const [palmConfig, setPalmConfig] = useState<PalmPricingConfig | undefined>(undefined);
  const [lawnConfig, setLawnConfig] = useState<LawnPricingConfig | undefined>(undefined);
  const [hedgeConfig, setHedgeConfig] = useState<HedgePricingConfig | undefined>(undefined);
  const [treeConfig, setTreeConfig] = useState<TreePricingConfig | undefined>(undefined);
  const [shrubConfig, setShrubConfig] = useState<ShrubPricingConfig | undefined>(undefined);
  const [clearingConfig, setClearingConfig] = useState<ClearingPricingConfig | undefined>(undefined);
  const [fumigationConfig, setFumigationConfig] = useState<FumigationPricingConfig | undefined>(undefined);
  const [standardConfigs, setStandardConfigs] = useState<Record<string, StandardPricingConfig>>({});
  const [highlightPalmError, setHighlightPalmError] = useState(false);

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: yupResolver(schema),
    defaultValues: {
      full_name: '',
      phone: '',
      address: '',
      description: '',
      max_distance: 25,
      services: []
    }
  });

  const watchedServices = watch('services') || [];

  useEffect(() => {
    fetchServices();
    fetchGardenerProfile();
    fetchServicePrices();
  }, [user]);

  const fetchServicePrices = async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('gardener_service_prices')
        .select('service_id, price_per_unit, additional_config')
        .eq('gardener_id', user.id);
      if (error) throw error;
      const prices: Record<string, number> = {};
      const configs: Record<string, StandardPricingConfig> = {};
      
      data?.forEach((row: any) => {
        prices[row.service_id] = row.price_per_unit;
        // Cargar configuración adicional si existe
        if (row.additional_config && Object.keys(row.additional_config).length > 0) {
            // Guardamos la config en el estado genérico.
            // Para palmeras se sobrescribirá/gestionará con el efecto específico loadPalmConfig,
            // pero para el resto lo necesitamos aquí.
            configs[row.service_id] = row.additional_config;
        }
      });
      setServicePrices(prices);
      setStandardConfigs(configs);
      
      // Intentar cargar la configuración específica de palmeras
      // Primero necesitamos saber cuál es el ID del servicio "Poda de palmeras"
      // Lo haremos en un efecto separado o aquí si ya tenemos los servicios cargados.
      // Como fetchServices es asíncrono, lo mejor es hacerlo después o buscar el ID.
    } catch (e) {
      console.error('Error fetching service prices:', e);
    }
  };

  // Cargar todas las configuraciones especializadas
  useEffect(() => {
    const loadConfigs = async () => {
      if (!user?.id || services.length === 0) return;
      
      const { data } = await supabase
        .from('gardener_service_prices')
        .select('service_id, additional_config')
        .eq('gardener_id', user.id);
        
      if (data) {
        data.forEach((row: any) => {
          const service = services.find(s => s.id === row.service_id);
          if (!service || !row.additional_config) return;

          switch(service.name) {
            case 'Poda de palmeras': setPalmConfig(row.additional_config as PalmPricingConfig); break;
            case 'Corte de césped': setLawnConfig(row.additional_config as LawnPricingConfig); break;
            case 'Corte de setos a máquina': setHedgeConfig(row.additional_config as HedgePricingConfig); break;
            case 'Poda de árboles': setTreeConfig(row.additional_config as TreePricingConfig); break;
            case 'Poda de plantas': setShrubConfig(row.additional_config as ShrubPricingConfig); break;
            case 'Labrar y quitar malas hierbas a mano': setClearingConfig(row.additional_config as ClearingPricingConfig); break;
            case 'Fumigación de plantas': setFumigationConfig(row.additional_config as FumigationPricingConfig); break;
          }
        });
      }
    };
    loadConfigs();
  }, [user?.id, services]);

  const fetchServices = async () => {
    try {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .order('name');

      if (error) throw error;
      const all = data || [];
      const filtered = all.filter((s: Service) => isAllowedServiceName(s.name));
      setServices(filtered);
    } catch (error) {
      console.error('Error fetching services:', error);
    }
  };

  const fetchGardenerProfile = async () => {
    if (!user) {
      console.error('No user found when trying to fetch profile');
      return;
    }

    console.log('Starting to fetch gardener profile for user:', user.id);

    try {
      const { data, error } = await supabase
        .from('gardener_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        console.error('Error fetching gardener profile:', error);
        throw error;
      }

      console.log('Fetched gardener profile data:', data);
      
      if (data) {
        setGardenerProfile(data);
        console.log('Setting form values with profile data');
        setValue('full_name', data.full_name);
        setValue('phone', data.phone);
        setValue('address', data.address);
        setValue('description', data.description);
        setValue('max_distance', data.max_distance);
        setValue('services', data.services);
        console.log('Form values set successfully');
      } else {
        console.log('No profile data found');
      }
    } catch (error) {
      console.error('Error fetching gardener profile:', error);
    }
  };



  const onError = (errors: any) => {
    toast.error('Por favor, completa todos los campos requeridos marcados en rojo.');
    console.log('Validation errors:', errors);
  };

  const onSubmit = async (data: FormData) => {
    if (!user) {
      console.error('No user found when trying to save profile');
      return;
    }

    console.log('Starting to save profile for user:', user.id);
    console.log('Profile data to save:', data);

    // Validación específica para Poda de palmeras
    const palmService = services.find(s => s.name === 'Poda de palmeras');
    if (palmService && data.services.includes(palmService.id)) {
        // Si el servicio está seleccionado, debe tener al menos una especie configurada
        if (!palmConfig?.selected_species || palmConfig.selected_species.length === 0) {
            toast.error('El servicio "Poda de palmeras" está seleccionado pero no tiene especies configuradas. Por favor, selecciona al menos una especie o desactiva el servicio.');
            setHighlightPalmError(true);
            return;
        }
    }

    setLoading(true);
    try {
      // Update or create gardener profile
      const profileData = {
        user_id: user.id,
        full_name: data.full_name,
        phone: data.phone,
        address: data.address,
        description: data.description,
        max_distance: data.max_distance,
        services: data.services,
        is_available: true,
        rating: gardenerProfile?.rating || 5.0,
        total_reviews: gardenerProfile?.total_reviews || 0
      };

      const payload = { ...profileData } as any;

      console.log('Saving to gardener_profiles table:', payload);

      // Check if gardener profile already exists
      const { data: existingProfile } = await supabase
        .from('gardener_profiles')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();

      let profileError;
      
      if (existingProfile) {
        // Profile exists, update it
        console.log('Profile exists, updating...');
        const { error } = await supabase
          .from('gardener_profiles')
          .update(payload)
          .eq('user_id', user.id);
        profileError = error;
      } else {
        // Profile doesn't exist, create it
        console.log('Profile does not exist, creating...');
        const { error } = await supabase
          .from('gardener_profiles')
          .insert(payload);
        profileError = error;
      }

      if (profileError) {
        console.error('Error saving to gardener_profiles:', profileError);
        throw profileError;
      }

      console.log('Successfully saved to gardener_profiles');

      // Update gardener service prices - FIX: Process ALL services to handle deactivation and cleanup
      const servicePriceUpdates = services.map(service => {
        const isSelected = watchedServices.includes(service.id);
        const price = servicePrices[service.id];
        
        // If not selected, mark as inactive
        if (!isSelected) {
            return {
                gardener_id: user.id,
                service_id: service.id,
                unit_type: (service as any).measurement || 'area',
                price_per_unit: price || 0, // Keep old price or 0
                currency: 'EUR',
                active: false, // EXPLICITLY INACTIVE
                additional_config: undefined // Optional: clear config or keep it
            };
        }

        // If selected, prepare active payload with sanitized config
        if (isSelected && price !== undefined) {
          const sName = service.name;
          let additionalConfig;
          
          if (sName === 'Poda de palmeras') {
              // Sanitize Palm Config
              if (palmConfig) {
                  const cleanConfig = { ...palmConfig };
                  const selected = cleanConfig.selected_species || [];
                  
                  // Clean species_prices
                  const cleanSpeciesPrices: Record<string, number> = {};
                  Object.keys(cleanConfig.species_prices).forEach(key => {
                      if (selected.includes(key as any)) {
                          cleanSpeciesPrices[key] = (cleanConfig.species_prices as any)[key];
                      }
                  });
                  cleanConfig.species_prices = cleanSpeciesPrices as any;

                  // Clean height_prices
                  const cleanHeightPrices: Record<string, any> = {};
                  Object.keys(cleanConfig.height_prices).forEach(key => {
                       if (selected.includes(key as any)) {
                           cleanHeightPrices[key] = (cleanConfig.height_prices as any)[key];
                       }
                  });
                  cleanConfig.height_prices = cleanHeightPrices as any;
                  
                  additionalConfig = cleanConfig;
              }
          }
          else if (sName === 'Corte de césped') {
              // Sanitize Lawn Config
              if (lawnConfig) {
                  const cleanConfig = { ...lawnConfig };
                  const selected = cleanConfig.selected_species || [];
                  
                  // Clean species_prices
                  const cleanSpeciesPrices: Record<string, any> = {};
                  Object.keys(cleanConfig.species_prices).forEach(key => {
                      if (selected.includes(key as any)) {
                          cleanSpeciesPrices[key] = cleanConfig.species_prices[key];
                      }
                  });
                  cleanConfig.species_prices = cleanSpeciesPrices;
                  
                  additionalConfig = cleanConfig;
              }
          }
          else if (sName === 'Corte de setos a máquina') additionalConfig = hedgeConfig;
          else if (sName === 'Poda de árboles') additionalConfig = treeConfig;
          else if (sName === 'Poda de plantas') additionalConfig = shrubConfig;
          else if (sName === 'Labrar y quitar malas hierbas a mano') additionalConfig = clearingConfig;
          else if (sName === 'Fumigación de plantas') additionalConfig = fumigationConfig;
          else additionalConfig = standardConfigs[service.id];

          additionalConfig = additionalConfig || undefined;

          return {
            gardener_id: user.id,
            service_id: service.id,
            unit_type: (service as any).measurement || 'area',
            price_per_unit: price,
            currency: 'EUR',
            active: true,
            additional_config: additionalConfig // Guardar JSONB
          };
        }
        return null;
      }).filter(Boolean);

      if (servicePriceUpdates.length > 0) {
        const { error: priceError } = await supabase
          .from('gardener_service_prices')
          .upsert(servicePriceUpdates);
        if (priceError) console.error('Error updating prices:', priceError);
      }

      // Also update the main profiles table
      const mainProfileData = {
        full_name: data.full_name,
        phone: data.phone,
        address: data.address
      };

      console.log('Updating main profiles table:', mainProfileData);

      const { error: mainProfileError } = await supabase
        .from('profiles')
        .update(mainProfileData)
        .eq('user_id', user.id);

      if (mainProfileError) {
        console.error('Error updating main profiles:', mainProfileError);
        throw mainProfileError;
      }

      console.log('Successfully updated main profiles');

      toast.success('Perfil actualizado correctamente');
      fetchGardenerProfile();
    } catch (error: any) {
      console.error('Error in profile submission:', error);
      toast.error(error.message || 'Error al actualizar el perfil');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async (serviceName: string, config: any, setConfig: (c: any) => void, successMsg: string) => {
    if (!user) return;
    const service = services.find(s => s.name === serviceName);
    if (!service) return;

    setConfig(config);

    const payload = {
      gardener_id: user.id,
      service_id: service.id,
      unit_type: (service as any).measurement || 'area',
      price_per_unit: servicePrices[service.id] || 0,
      currency: 'EUR',
      active: true,
      additional_config: config
    };

    try {
      const { error } = await supabase.from('gardener_service_prices').upsert(payload);
      if (error) throw error;
      toast.success(successMsg);
    } catch (error) {
      console.error(`Error saving ${serviceName} config:`, error);
      toast.error(`Error al guardar configuración de ${serviceName}`);
      throw error;
    }
  };

  const handleSavePalmConfig = async (config: PalmPricingConfig) => {
    await handleSaveConfig(
        'Poda de palmeras', 
        config, 
        setPalmConfig, 
        'Precios de palmeras guardados correctamente'
    );
  };

  const handleSaveLawnConfig = async (config: LawnPricingConfig) => {
    await handleSaveConfig(
        'Corte de césped', 
        config, 
        setLawnConfig, 
        'Configuración de césped guardada correctamente'
    );
  };

  const handleSaveStandardConfig = async (serviceId: string, config: StandardPricingConfig) => {
    if (!user) return;
    const service = services.find(s => s.id === serviceId);
    if (!service) return;

    // Update local state
    setStandardConfigs(prev => ({ ...prev, [serviceId]: config }));

    const payload = {
      gardener_id: user.id,
      service_id: service.id,
      unit_type: (service as any).measurement || 'area',
      price_per_unit: servicePrices[service.id] || 0,
      currency: 'EUR',
      active: true,
      additional_config: config
    };

    try {
      const { error } = await supabase
        .from('gardener_service_prices')
        .upsert(payload);

      if (error) throw error;
      toast.success(`Configuración guardada para ${service.name}`);
    } catch (error) {
      console.error('Error saving standard config:', error);
      toast.error('Error al guardar la configuración');
      throw error;
    }
  };

  const handleServiceToggle = (serviceId: string) => {
    const currentServices = watchedServices || [];
    const updatedServices = currentServices.includes(serviceId)
      ? currentServices.filter(id => id !== serviceId)
      : [...currentServices, serviceId];
    
    // Si deseleccionamos palmeras, quitamos el error
    const palmService = services.find(s => s.name === 'Poda de palmeras');
    if (palmService && serviceId === palmService.id && currentServices.includes(serviceId)) {
        setHighlightPalmError(false);
    }
    
    setValue('services', updatedServices);
  };



  return (
    <div className="max-w-full sm:max-w-3xl md:max-w-4xl mx-auto px-2.5 py-4 sm:p-6 lg:px-6">
      {onBack && (
        <button
          onClick={onBack}
          className="mb-6 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg shadow-sm transition-colors"
          aria-label="Volver al Panel"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al Panel
        </button>
      )}
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center">
          <User className="w-6 h-6 sm:w-8 sm:h-8 mr-3 text-green-600" />
          Configuración del Perfil
        </h2>
      </div>

      <form onSubmit={handleSubmit(onSubmit, onError)} className="space-y-6">
        {/* Personal Information */}
        <div className="">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Información Personal</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nombre completo
              </label>
              <input
                {...register('full_name')}
                type="text"
                className="w-full p-3 text-base sm:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                placeholder="Tu nombre completo"
              />
              {errors.full_name && (
                <p className="mt-1 text-sm text-red-600">{errors.full_name.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Teléfono
              </label>
              <input
                {...register('phone')}
                type="tel"
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-base sm:text-sm"
                placeholder="+34 600 000 000"
              />
              {errors.phone && (
                <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>
              )}
            </div>
          </div>
        </div>

        {/* Address and Coverage */}
        <div className="">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <MapPin className="w-5 h-5 mr-2" />
            Ubicación y Cobertura
          </h3>
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Dirección base
              </label>
              <AddressAutocomplete
                value={watch('address') || ''}
                onChange={(address) => setValue('address', address)}
                placeholder="Tu dirección de trabajo"
              />
              {errors.address && (
                <p className="mt-1 text-sm text-red-600">{errors.address.message}</p>
              )}
            </div>

            <div className="">
              <DistanceMapSelector
                address={watch('address') || ''}
                distance={watch('max_distance') || 25}
                onDistanceChange={(distance) => {
                  console.log('max_distance changed:', distance);
                  setValue('max_distance', distance);
                }}
              />
              {errors.max_distance && (
                <p className="mt-1 text-sm text-red-600">{errors.max_distance.message}</p>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        <div className="">
          <label className="block text-lg font-semibold text-gray-900 mb-4">
            Descripción profesional
          </label>
          <textarea
            {...register('description')}
            rows={4}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-base sm:text-sm"
            placeholder="Describe tu experiencia, especialidades y lo que te diferencia como jardinero profesional..."
          />
          {errors.description && (
            <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>
          )}
        </div>

        {/* Services */}
        <div className="">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Briefcase className="w-5 h-5 mr-2" />
            Servicios que ofreces
          </h3>
          <div className="grid grid-cols-1 gap-4">
            {services.map((service) => {
              const isSelected = watchedServices.includes(service.id);
              const measurement = (service as any).measurement === 'count' ? 'unidad' : 'm²';
              const isPalm = service.name === 'Poda de palmeras';
              const isLawn = service.name === 'Corte de césped';
              const isHedge = service.name === 'Corte de setos a máquina';
              const isTree = service.name === 'Poda de árboles';
              const isShrub = service.name === 'Poda de plantas';
              const isClearing = service.name === 'Labrar y quitar malas hierbas a mano';
              const isFumigation = service.name === 'Fumigación de plantas';

              const hasError = isPalm && highlightPalmError;

              const isSpecialService = isPalm || isLawn || isHedge || isTree || isShrub || isClearing || isFumigation;

              return (
                <div key={service.id} className={`border-2 rounded-lg transition-colors ${
                  hasError ? 'border-red-500 bg-red-50' : (isSelected ? 'border-green-500' : 'border-gray-200 hover:border-green-300')
                } ${isSpecialService && isSelected ? 'p-0 overflow-hidden bg-white' : (isSelected ? 'bg-green-50 p-4' : 'p-4')}`}>
                  <div className={isSpecialService && isSelected ? 'bg-green-50 p-4' : ''}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleServiceToggle(service.id)}
                      className="mt-1 h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                    />
                    <div className="flex-1">
                      <h4 className="font-semibold text-gray-900">{service.name}</h4>
                      <p className="text-sm text-gray-600 mb-2">{service.description}</p>
                    </div>
                  </label>
                  </div>

                  {isSelected && (
                    <>
                      <div className={`${isSpecialService ? 'border-t border-gray-100 p-4' : 'mt-3 pl-7'}`}>
                        {!isSpecialService && (
                          <div className="flex items-center gap-2">
                            <label className="text-sm font-medium text-gray-700">Precio por {measurement}:</label>
                            <div className="relative w-32">
                              <span className="absolute left-3 top-2 text-gray-500">€</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={servicePrices[service.id] || ''}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  setServicePrices(prev => ({
                                    ...prev,
                                    [service.id]: isNaN(val) ? 0 : val
                                  }));
                                }}
                                className="w-full pl-7 pr-3 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-transparent text-base sm:text-sm"
                                placeholder="0.00"
                              />
                            </div>
                          </div>
                        )}

                        {/* Configuración avanzada de palmeras */}
                        {isPalm && (
                          <div className="cursor-default bg-white p-4">
                            <PalmPricingConfigurator 
                              value={palmConfig} 
                              onChange={(newConfig) => {
                                  setPalmConfig(newConfig);
                                  if (newConfig.selected_species && newConfig.selected_species.length > 0) {
                                      setHighlightPalmError(false);
                                  }
                              }}
                              onSave={handleSavePalmConfig} 
                            />
                          </div>
                        )}

                        {/* Configuración avanzada de césped */}
                        {isLawn && (
                          <div className="cursor-default bg-white p-4">
                            <LawnPricingConfigurator 
                              value={lawnConfig} 
                              onChange={(newConfig) => setLawnConfig(newConfig)}
                              onSave={handleSaveLawnConfig} 
                            />
                          </div>
                        )}

                        {/* Configuración de setos */}
                        {isHedge && (
                          <div className="cursor-default bg-white p-4">
                            <HedgePricingConfigurator 
                              value={hedgeConfig} 
                              onChange={setHedgeConfig}
                              onSave={(c) => handleSaveConfig('Corte de setos a máquina', c, setHedgeConfig, 'Configuración de setos guardada')} 
                            />
                          </div>
                        )}

                        {/* Configuración de árboles */}
                        {isTree && (
                          <div className="cursor-default bg-white p-4">
                            <TreePricingConfigurator 
                              value={treeConfig} 
                              onChange={setTreeConfig}
                              onSave={(c) => handleSaveConfig('Poda de árboles', c, setTreeConfig, 'Configuración de árboles guardada')} 
                            />
                          </div>
                        )}

                        {/* Configuración de plantas/arbustos */}
                        {isShrub && (
                          <div className="cursor-default bg-white p-4">
                            <ShrubPricingConfigurator 
                              value={shrubConfig} 
                              onChange={setShrubConfig}
                              onSave={(c) => handleSaveConfig('Poda de plantas', c, setShrubConfig, 'Configuración de plantas guardada')} 
                            />
                          </div>
                        )}

                        {/* Configuración de desbroce */}
                        {isClearing && (
                          <div className="cursor-default bg-white p-4">
                            <ClearingPricingConfigurator 
                              value={clearingConfig} 
                              onChange={setClearingConfig}
                              onSave={(c) => handleSaveConfig('Labrar y quitar malas hierbas a mano', c, setClearingConfig, 'Configuración de desbroce guardada')} 
                            />
                          </div>
                        )}

                        {/* Configuración de fumigación */}
                        {isFumigation && (
                          <div className="cursor-default bg-white p-4">
                            <FumigationPricingConfigurator 
                              value={fumigationConfig} 
                              onChange={setFumigationConfig}
                              onSave={(c) => handleSaveConfig('Fumigación de plantas', c, setFumigationConfig, 'Configuración de fumigación guardada')} 
                            />
                          </div>
                        )}
                      </div>
                      
                      {/* Configuración estándar para otros servicios */}
                      {!isSpecialService && (
                          <div className="mt-4 border-t border-gray-100 pt-4 cursor-default bg-white -mx-4 -mb-4 px-4 pb-4">
                              <StandardServiceConfig
                                  value={standardConfigs[service.id]}
                                  onChange={(newConfig) => setStandardConfigs(prev => ({ ...prev, [service.id]: newConfig }))}
                                  onSave={(config) => handleSaveStandardConfig(service.id, config)}
                              />
                          </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {errors.services && (
            <p className="mt-2 text-sm text-red-600">{errors.services.message}</p>
          )}
        </div>

        {/* Statistics */}
        {gardenerProfile && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Star className="w-5 h-5 mr-2" />
              Estadísticas
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{gardenerProfile.rating.toFixed(1)}</div>
                <div className="text-sm text-gray-600">Calificación promedio</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{gardenerProfile.total_reviews}</div>
                <div className="text-sm text-gray-600">Reseñas totales</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {gardenerProfile.is_available ? 'Activo' : 'Inactivo'}
                </div>
                <div className="text-sm text-gray-600">Estado actual</div>
              </div>
            </div>
          </div>
        )}



        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 font-semibold"
        >
          <Save className="w-5 h-5 mr-2" />
          {loading ? 'Guardando...' : 'Guardar Configuración'}
        </button>
      </form>
    </div>
  );
};

export default ProfileSettings;
