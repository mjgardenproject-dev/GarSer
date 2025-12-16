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

// Sólo permitir los servicios definidos en el estimador IA (coincidencia estricta de nombre)
const ALLOWED_SERVICE_NAMES = [
  'Corte de césped',
  'Poda de plantas',
  'Corte de setos a máquina',
  'Corte de arbustos pequeños o ramas finas a tijera',
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
  const { user, profile } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(false);
  const [gardenerProfile, setGardenerProfile] = useState<GardenerProfile | null>(null);

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
  }, [user]);

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
      } else if (profile) {
        console.log('No existing profile found, using main profile data');
        setValue('full_name', profile.full_name);
        setValue('phone', profile.phone);
        setValue('address', profile.address);
      } else {
        console.log('No profile data found');
      }
    } catch (error) {
      console.error('Error fetching gardener profile:', error);
    }
  };



  const onSubmit = async (data: FormData) => {
    if (!user) {
      console.error('No user found when trying to save profile');
      return;
    }

    console.log('Starting to save profile for user:', user.id);
    console.log('Profile data to save:', data);

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

  const handleServiceToggle = (serviceId: string) => {
    const currentServices = watchedServices || [];
    const updatedServices = currentServices.includes(serviceId)
      ? currentServices.filter(id => id !== serviceId)
      : [...currentServices, serviceId];
    
    setValue('services', updatedServices);
  };



  return (
    <div className="bg-white rounded-2xl shadow-lg p-8">
      {onBack && (
        <button
          onClick={onBack}
          className="mb-6 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg"
          aria-label="Volver al Panel"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al Panel
        </button>
      )}
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center">
          <User className="w-6 h-6 mr-3" />
          Configuración del Perfil
        </h2>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Personal Information */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Información Personal</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nombre completo
              </label>
              <input
                {...register('full_name')}
                type="text"
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
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
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                placeholder="+34 600 000 000"
              />
              {errors.phone && (
                <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>
              )}
            </div>
          </div>
        </div>

        {/* Address and Coverage */}
        <div>
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

            <div className="bg-gray-50 p-6 rounded-lg">
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
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Descripción profesional
          </label>
          <textarea
            {...register('description')}
            rows={4}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            placeholder="Describe tu experiencia, especialidades y lo que te diferencia como jardinero profesional..."
          />
          {errors.description && (
            <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>
          )}
        </div>

        {/* Services */}
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Briefcase className="w-5 h-5 mr-2" />
            Servicios que ofreces
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {services.map((service) => (
              <label key={service.id} className="relative cursor-pointer">
                <input
                  type="checkbox"
                  checked={watchedServices.includes(service.id)}
                  onChange={() => handleServiceToggle(service.id)}
                  className="sr-only"
                />
                <div className={`p-4 border-2 rounded-lg transition-colors ${
                  watchedServices.includes(service.id)
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-200 hover:border-green-300'
                }`}>
                  <h4 className="font-semibold text-gray-900 mb-1">{service.name}</h4>
                  <p className="text-sm text-gray-600">{service.description}</p>
                  <p className="text-sm font-medium text-green-600 mt-2">
                    Precio base: €{service.base_price}
                  </p>
                </div>
              </label>
            ))}
          </div>
          {errors.services && (
            <p className="mt-2 text-sm text-red-600">{errors.services.message}</p>
          )}
        </div>

        {/* Statistics */}
        {gardenerProfile && (
          <div className="bg-gray-50 rounded-lg p-6">
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
