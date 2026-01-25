import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar, MapPin, Scissors, SprayCan as Spray, TreePine } from 'lucide-react';
import { getCoordinatesFromAddress, calculateDistance } from '../../utils/geolocation';
import { Service } from '../../types';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import AddressAutocomplete from '../common/AddressAutocomplete';
import MergedSlotsSelector from '../booking/MergedSlotsSelector';
import { MergedSlot } from '../../utils/mergedAvailabilityService';

const schema = yup.object({
  service_id: yup.string().required('Servicio requerido'),
  client_address: yup.string().required('Dirección requerida'),
  notes: yup.string().optional()
});

type FormData = yup.InferType<typeof schema>;

const ServiceBooking = () => {
  const { user } = useAuth();
  const location = useLocation();
  const preselectedServiceId = (location.state as any)?.selectedServiceId || location.state?.selectedServiceId;
  const restrictedGardenerId: string | undefined = (location.state as any)?.restrictedGardenerId || location.state?.restrictedGardenerId;
  const navigate = useNavigate();
  const [services, setServices] = useState<Service[]>([]);
  const [durationHours, setDurationHours] = useState<number>(0);
  const [selectedSlot, setSelectedSlot] = useState<MergedSlot | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [totalPrice, setTotalPrice] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [eligibilityMessage, setEligibilityMessage] = useState<string|undefined>(undefined);
  const [restrictedGardenerName, setRestrictedGardenerName] = useState<string>('');
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  
  // Servicio preseleccionado desde la navegación
  const preselectedService = (location.state as any)?.selectedService;
  const aiSuggestedPrice: number | undefined = location.state?.aiPrice;
  const aiSuggestedHours: number | undefined = location.state?.aiHours;

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: yupResolver(schema) as any,
    defaultValues: {
      service_id: preselectedServiceId || '',
      client_address: '',
      notes: ''
    }
  });

  const watchedValues = watch();
  // Precio final a mostrar y guardar: si hay IA, usarlo
  const displayTotalPrice = (aiSuggestedPrice && aiSuggestedPrice > 0) ? aiSuggestedPrice : totalPrice;

  // Efectos para cargar datos
  useEffect(() => {
    fetchServices();
  }, []);

  useEffect(() => {
    if (preselectedServiceId) {
      setValue('service_id', preselectedServiceId);
    }
  }, [preselectedServiceId, setValue]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('post_auth_redirect');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const st = parsed?.state;
      if (st?.selectedServiceId) {
        setValue('service_id', st.selectedServiceId);
      }
      const preserved = st?.preserved;
      if (preserved) {
        if (preserved.client_address) {
          setSelectedAddress(preserved.client_address);
          setValue('client_address', preserved.client_address);
        }
        if (preserved.durationHours) setDurationHours(preserved.durationHours);
        if (preserved.selectedDate) setSelectedDate(new Date(preserved.selectedDate));
        if (preserved.selectedSlot) setSelectedSlot(preserved.selectedSlot);
      }
      sessionStorage.removeItem('post_auth_redirect');
    } catch {}
  }, [setValue]);

  useEffect(() => {
    const checkRestrictedEligibility = async () => {
      try {
        if (!restrictedGardenerId) { setEligibilityMessage(undefined); return; }
        if (!watchedValues.service_id || !selectedAddress) { setEligibilityMessage(undefined); return; }
        // Cargar perfil del jardinero
        const { data: gp } = await supabase
          .from('gardener_profiles')
          .select('full_name, services, is_available, address, max_distance')
          .eq('user_id', restrictedGardenerId)
          .maybeSingle();
        const name = gp?.full_name || 'este jardinero';
        setRestrictedGardenerName(name);
        if (!gp) { setEligibilityMessage(`${name} no puede realizar este servicio.`); return; }
        // Servicio
        const offers = Array.isArray(gp.services) && gp.services.includes(watchedValues.service_id);
        if (!offers) { setEligibilityMessage(`${name} no puede realizar este servicio.`); return; }
        // Disponibilidad
        if (gp.is_available === false) { setEligibilityMessage(`${name} no está disponible actualmente.`); return; }
        // Distancia
        if (gp.address) {
          const clientCoords = await getCoordinatesFromAddress(selectedAddress);
          const gardenerCoords = await getCoordinatesFromAddress(gp.address);
          if (clientCoords && gardenerCoords) {
            const dist = calculateDistance(clientCoords.lat, clientCoords.lng, gardenerCoords.lat, gardenerCoords.lng);
            const radius = (gp as any).max_distance ?? 20;
            if (dist > radius) { setEligibilityMessage(`${name} está fuera de tu área de servicio.`); return; }
          }
        }
        setEligibilityMessage(undefined);
      } catch {
        setEligibilityMessage(undefined);
      }
    };
    checkRestrictedEligibility();
  }, [restrictedGardenerId, watchedValues.service_id, selectedAddress]);



  // Calcular precio total cuando cambian la duración y servicio
  useEffect(() => {
    if (durationHours > 0 && watchedValues.service_id) {
      const service = services.find(s => s.id === watchedValues.service_id);
      if (service) {
        const basePrice = service.base_price;
        const travelFee = 15; // Precio fijo de desplazamiento
        const hourlyRate = service.price_per_hour ?? 25; // Precio por hora
        const total = basePrice + travelFee + (hourlyRate * durationHours);
        setTotalPrice(total);
      }
    } else if (aiSuggestedPrice && aiSuggestedPrice > 0) {
      // Mostrar el precio estimado por IA cuando aún no hay duración seleccionada
      setTotalPrice(aiSuggestedPrice);
    } else {
      setTotalPrice(0);
    }
  }, [durationHours, watchedValues.service_id, services, aiSuggestedPrice]);



  const fetchServices = async () => {
    try {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .order('name');

      if (error) throw error;
      setServices(data || []);
    } catch (error) {
      console.error('Error fetching services:', error);
    }
  };

  // Función para manejar el cambio de fecha
  const handleDateChange = (date: Date) => {
    setSelectedDate(date);
    setSelectedSlot(null); // Limpiar franja seleccionada al cambiar fecha
  };

  // Función auxiliar para filtrar jardineros por rango (definida aquí para acceso a supabase/utils)
  const filterGardenerIdsByRange = async (clientAddress: string, gardenerIds: string[]): Promise<string[]> => {
    if (!gardenerIds.length) return [];
    
    // 1. Coordenadas cliente
    const clientCoords = await getCoordinatesFromAddress(clientAddress);
    if (!clientCoords) {
      console.warn('No se pudieron obtener coordenadas del cliente, no se filtra por rango');
      return gardenerIds; 
    }

    // 2. Obtener perfiles de jardineros (dirección y rango)
    const { data: profiles } = await supabase
      .from('gardener_profiles')
      .select('user_id, address, max_distance')
      .in('user_id', gardenerIds);
    
    if (!profiles) return gardenerIds;

    const validIds: string[] = [];

    for (const profile of profiles) {
      if (!profile.address) continue;
      
      const gCoords = await getCoordinatesFromAddress(profile.address);
      if (!gCoords) continue;

      const dist = calculateDistance(clientCoords.lat, clientCoords.lng, gCoords.lat, gCoords.lng);
      const max = profile.max_distance ?? 20;

      if (dist <= max) {
        validIds.push(profile.user_id);
      }
    }
    
    // Devolver intersección para mantener solo los que pasaron el filtro y estaban en la lista original
    return gardenerIds.filter((id: string) => validIds.includes(id));
  };

  const onSubmit = async (data: FormData) => {
    if (!selectedSlot) {
      toast.error('Debes seleccionar una franja disponible');
      return;
    }

    if (!user) {
      setShowAuthPrompt(true);
      const redirectState = {
        restrictedGardenerId,
        selectedServiceId: data.service_id,
        selectedService: services.find(s => s.id === data.service_id),
        aiPrice: (aiSuggestedPrice && aiSuggestedPrice > 0) ? aiSuggestedPrice : totalPrice,
        aiHours: aiSuggestedHours,
        preserved: {
          client_address: data.client_address,
          durationHours,
          selectedDate: selectedDate.toISOString(),
          selectedSlot
        }
      } as any;
      sessionStorage.setItem('post_auth_redirect', JSON.stringify({ path: '/booking', state: redirectState }));
      return;
    }

    setLoading(true);
    try {
      console.log('🚀 Iniciando proceso de solicitud anónima y difusión a jardineros elegibles');

      // Difundir: crear una reserva pendiente por jardinero elegible
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const startLabel = `${selectedSlot.startHour.toString().padStart(2, '0')}:00:00`;
      const endLabel = `${selectedSlot.endHour.toString().padStart(2, '0')}:00:00`;

      // Seguridad adicional: difundir solo a jardineros dentro del círculo de rango
      let gardenerIdsInRange = await filterGardenerIdsByRange(data.client_address, selectedSlot.gardenerIds);
      if (restrictedGardenerId) {
        gardenerIdsInRange = gardenerIdsInRange.filter(id => id === restrictedGardenerId);
        if (gardenerIdsInRange.length === 0) {
          toast.error(`${restrictedGardenerName || 'El jardinero'} no puede realizar este servicio en esa franja.`);
          return;
        }
      }
      if (gardenerIdsInRange.length === 0) {
        toast.error('No hay jardineros dentro de tu zona para esta franja');
        return;
      }

      const finalPrice = (aiSuggestedPrice && aiSuggestedPrice > 0) ? aiSuggestedPrice : totalPrice;

      const inserts = gardenerIdsInRange.map(gardenerId => ({
        client_id: user.id,
        gardener_id: gardenerId,
        service_id: data.service_id,
        date: dateStr,
        start_time: startLabel,
        duration_hours: durationHours,
        client_address: data.client_address,
        notes: data.notes,
        status: 'pending',
        total_price: finalPrice,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }));

      const { error: bookingsError } = await supabase
        .from('bookings')
        .insert(inserts);

      if (bookingsError) throw bookingsError;

      toast.success(
        <div className="text-left">
          <div className="font-semibold mb-2">¡Solicitud enviada!</div>
          <div className="text-sm space-y-1">
            <div>📅 <strong>Fecha:</strong> {format(selectedDate, 'dd/MM/yyyy', { locale: es })}</div>
            <div>⏰ <strong>Horario:</strong> {`${selectedSlot.startHour.toString().padStart(2, '0')}:00`}–{`${selectedSlot.endHour.toString().padStart(2, '0')}:00`} ({durationHours}h)</div>
            <div>💰 <strong>Precio total:</strong> €{finalPrice}</div>
            <div>⏱️ <strong>Respuesta en:</strong> máximo 24 horas</div>
            <div>👤 <strong>Privacidad:</strong> El jardinero se mostrará tras la confirmación</div>
          </div>
        </div>,
        { duration: 6000 }
      );
      
      // Redirect to bookings page
      setTimeout(() => {
        navigate('/bookings');
      }, 3000);
    } catch (error: any) {
      console.error('Error creando solicitudes de reserva:', error);
      toast.error(error.message || 'Error al enviar la solicitud de reserva');
    } finally {
      setLoading(false);
    }
  };

  const getServiceIcon = (serviceName: string) => {
    switch (serviceName.toLowerCase()) {
      case 'fumigación':
        return <Spray className="w-6 h-6" />;
      case 'corte de setos':
        return <Scissors className="w-6 h-6" />;
      case 'poda':
        return <TreePine className="w-6 h-6" />;
      default:
        return <TreePine className="w-6 h-6" />;
    }
  };

  const handleAddressSelect = (address: string) => {
    setSelectedAddress(address);
    setValue('client_address', address);
  };

  // Distancia provista por utilidad compartida

  // Coordenadas provistas por utilidad compartida

  // Función de selección básica como fallback
  const basicGardenerSelection = async (serviceId: string) => {
    const { data: gardeners, error: gardenersError } = await supabase
      .from('gardener_profiles')
      .select('*')
      .contains('services', [serviceId])
      .eq('is_available', true)
      .order('rating', { ascending: false })
      .limit(1);

    if (gardenersError) throw gardenersError;

    if (!gardeners || gardeners.length === 0) {
      throw new Error('No hay jardineros disponibles para este servicio');
    }

    // Obtener el perfil del jardinero seleccionado
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', gardeners[0].user_id)
      .single();

    if (profileError) {
      console.warn('No se pudo obtener el perfil del jardinero:', profileError);
    }

    return {
      ...gardeners[0],
      profiles: profile
    };
  };

  // Función mejorada para seleccionar el mejor jardinero
  const selectBestGardener = async (serviceId: string, clientAddress: string) => {
    try {
      console.log('🔍 Iniciando selección de jardinero para:', { serviceId, clientAddress });

      // 1. Obtener coordenadas de la dirección del cliente
      const clientCoords = await getCoordinatesFromAddress(clientAddress);
      if (!clientCoords) {
        console.warn('No se pudieron obtener las coordenadas del cliente, usando selección básica');
        return await basicGardenerSelection(serviceId);
      }

      console.log('📍 Coordenadas del cliente:', clientCoords);

      // 2. Obtener todos los jardineros que ofrecen el servicio y están disponibles
      const { data: gardeners, error: gardenersError } = await supabase
        .from('gardener_profiles')
        .select('*')
        .contains('services', [serviceId])
        .eq('is_available', true);

      if (gardenersError) throw gardenersError;

      if (!gardeners || gardeners.length === 0) {
        throw new Error('No hay jardineros disponibles para este servicio');
      }

      console.log(`👥 Encontrados ${gardeners.length} jardineros disponibles`);

      // 3. Obtener perfiles de los jardineros
      const gardenerIds = gardeners.map((g: any) => g.user_id);
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', gardenerIds);

      if (profilesError) {
        console.warn('Error obteniendo perfiles:', profilesError);
      }

      // 4. Filtrar jardineros por rango de distancia y calcular distancias
      const gardenersWithDistance = [];
      
      for (const gardener of gardeners) {
        const profile = profiles?.find((p: any) => p.id === gardener.user_id);
        const gardenerWithProfile = {
          ...gardener,
          profiles: profile
        };

        if (!gardener.address) {
          console.warn(`Jardinero ${profile?.full_name} no tiene dirección configurada`);
          continue;
        }

        const gardenerCoords = await getCoordinatesFromAddress(gardener.address);
        if (!gardenerCoords) {
          console.warn(`No se pudieron obtener coordenadas para ${profile?.full_name}`);
          continue;
        }

        const distance = calculateDistance(
          clientCoords.lat, 
          clientCoords.lng, 
          gardenerCoords.lat, 
          gardenerCoords.lng
        );

        // Verificar si está dentro del rango de trabajo del jardinero
        const maxRange = gardener.work_radius || 20; // Default 20km si no está especificado
        
        if (distance <= maxRange) {
          gardenersWithDistance.push({
            ...gardenerWithProfile,
            distance,
            maxRange
          });
          console.log(`✅ ${profile?.full_name}: ${distance.toFixed(2)}km (rango: ${maxRange}km)`);
        } else {
          console.log(`❌ ${profile?.full_name}: ${distance.toFixed(2)}km (fuera de rango: ${maxRange}km)`);
        }
      }

      if (gardenersWithDistance.length === 0) {
        throw new Error('No hay jardineros disponibles en tu área para este servicio');
      }

      // 5. Ordenar por mejores reseñas (rating) y luego por distancia
      gardenersWithDistance.sort((a, b) => {
        // Primero por rating (descendente)
        if (b.rating !== a.rating) {
          return (b.rating || 0) - (a.rating || 0);
        }
        // Si tienen el mismo rating, por distancia (ascendente)
        return a.distance - b.distance;
      });

      const selectedGardener = gardenersWithDistance[0];
      
      console.log('🏆 Jardinero seleccionado:', {
        name: selectedGardener.profiles?.full_name,
        rating: selectedGardener.rating,
        distance: selectedGardener.distance.toFixed(2) + 'km',
        reviews: selectedGardener.total_reviews || 0
      });

      return selectedGardener;

    } catch (error) {
      console.error('Error en selección avanzada de jardinero:', error);
      // Fallback a selección básica
      return await basicGardenerSelection(serviceId);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="bg-white rounded-xl sm:rounded-2xl shadow-xl p-4 sm:p-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6 sm:mb-8">Reservar Servicio de Jardinería</h1>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 sm:space-y-8">
          {/* Servicio Seleccionado o Selector */}
          {preselectedService ? (
            <div>
              <label className="block text-lg font-semibold text-gray-700 mb-3 sm:mb-4">
                Servicio seleccionado
              </label>
              <div className="bg-green-50 border-2 border-green-500 rounded-xl p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center">
                    <div className="text-green-600 mr-3">
                      {getServiceIcon(preselectedService.name)}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 text-lg">{preselectedService.name}</h3>
                      <p className="text-sm text-gray-600">{preselectedService.description}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-green-600">€{preselectedService.base_price}</p>
                    <p className="text-sm text-gray-500">Precio base</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/dashboard')}
                  className="mt-4 text-sm text-green-600 hover:text-green-700 underline"
                >
                  Cambiar servicio
                </button>
              </div>
              <input type="hidden" {...register('service_id')} value={preselectedService.id} />
            </div>
          ) : (
            <div>
              <label className="block text-lg font-semibold text-gray-700 mb-3 sm:mb-4">
                Selecciona el servicio
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {services.map((service) => (
                  <label key={service.id} className="relative cursor-pointer">
                    <input
                      {...register('service_id')}
                      type="radio"
                      value={service.id}
                      className="sr-only"
                    />
                    <div className="p-4 sm:p-6 border-2 border-gray-200 rounded-xl hover:border-green-300 transition-colors peer-checked:border-green-500 peer-checked:bg-green-50">
                      <div className="flex items-center mb-2 sm:mb-3">
                        <div className="text-green-600 mr-2 sm:mr-3">
                          {getServiceIcon(service.name)}
                        </div>
                        <h3 className="font-semibold text-gray-900 text-sm sm:text-base">{service.name}</h3>
                      </div>
                      <p className="text-xs sm:text-sm text-gray-600 mb-2 line-clamp-2">{service.description}</p>
                      <p className="text-base sm:text-lg font-bold text-green-600">€{service.base_price}</p>
                      {aiSuggestedPrice && aiSuggestedPrice > 0 && (
                        <p className="text-xs sm:text-sm text-green-700 mt-1">Precio sugerido IA: €{aiSuggestedPrice}</p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
              {errors.service_id && (
                <p className="mt-2 text-sm text-red-600">{errors.service_id.message}</p>
              )}
            </div>
          )}

          {/* Dirección del servicio */}
          <div>
            <label className="block text-lg font-semibold text-gray-700 mb-3 sm:mb-4">
              <MapPin className="inline w-5 h-5 mr-2" />
              Dirección del servicio <span className="text-red-500">*</span>
            </label>
            <p className="text-sm text-gray-600 mb-3">
              La dirección es obligatoria para mostrar solo los jardineros que pueden atender en tu zona.
            </p>
            <AddressAutocomplete
              value={selectedAddress}
              onChange={handleAddressSelect}
              placeholder="Ingresa la dirección completa donde se realizará el servicio (obligatorio)"
              className="w-full"
            />
            <input
              type="hidden"
              {...register('client_address')}
              value={selectedAddress}
            />
            {errors.client_address && (
              <p className="mt-2 text-sm text-red-600">{errors.client_address.message}</p>
            )}
            {selectedAddress && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs sm:text-sm text-blue-700 break-words">
                  <MapPin className="inline w-4 h-4 mr-1" />
                  Dirección seleccionada: {selectedAddress}
                </p>
              </div>
            )}
            {!selectedAddress && watchedValues.service_id && (
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-xs sm:text-sm text-amber-700">
                  <MapPin className="inline w-4 h-4 mr-1" />
                  Por favor, ingresa tu dirección para ver las fechas y horarios disponibles de jardineros en tu zona.
                </p>
              </div>
            )}
          </div>

          {/* Duración en horas consecutivas */}
          {selectedAddress && watchedValues.service_id && (
            <div>
              <label className="block text-lg font-semibold text-gray-700 mb-3">Duración requerida</label>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {[1,2,3,4,5,6].map(h => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => { setDurationHours(h); setSelectedSlot(null); }}
                    className={`px-3 py-2 border-2 rounded-lg text-sm ${durationHours===h ? 'border-green-600 bg-green-50' : 'border-gray-200 hover:border-green-300'}`}
                  >{h}h</button>
                ))}
              </div>
            </div>
          )}

          {/* Selector de Franjas Fusionadas */}
          {selectedAddress && watchedValues.service_id && durationHours > 0 ? (
            <MergedSlotsSelector
              serviceId={watchedValues.service_id}
              clientAddress={selectedAddress}
              durationHours={durationHours}
              selectedDate={selectedDate}
              onDateChange={handleDateChange}
              onSlotSelect={setSelectedSlot}
              restrictedGardenerId={restrictedGardenerId}
            />
          ) : (
            <div className="p-3 sm:p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-gray-600 text-center text-sm sm:text-base">
                <Calendar className="inline w-5 h-5 mr-2" />
                {!selectedAddress ? 'Primero selecciona una dirección' : !watchedValues.service_id ? 'Selecciona un servicio' : 'Elige la duración'} para ver las franjas disponibles
              </p>
            </div>
          )}

          {restrictedGardenerId && eligibilityMessage && (
            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-amber-800 text-sm mb-3">{eligibilityMessage}</p>
              <button
                type="button"
                onClick={() => navigate('/booking')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Enviar solicitud a otros jardineros
              </button>
            </div>
          )}


          {/* Notas adicionales */}
          {durationHours > 0 && (
            <div>
              <label className="block text-lg font-semibold text-gray-700 mb-3 sm:mb-4">
                Información adicional (opcional)
              </label>
              <textarea
                {...register('notes')}
                rows={3}
                className="w-full p-3 sm:p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-base sm:text-sm"
                placeholder="Cualquier información adicional que el jardinero deba saber (acceso al jardín, herramientas especiales, etc.)"
              />
              <p className="mt-2 text-xs sm:text-sm text-gray-500">
                Esta información ayudará al jardinero a prepararse mejor para el servicio
              </p>
            </div>
          )}

          {/* Resumen de Precio */}
          {(totalPrice > 0 || (aiSuggestedPrice && aiSuggestedPrice > 0)) && selectedSlot && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 sm:p-6">
              <h3 className="text-lg font-semibold text-green-800 mb-3 sm:mb-4">
                💰 Resumen del Precio
              </h3>
              <div className="space-y-2 text-sm sm:text-base">
                <div className="flex justify-between">
                  <span className="text-gray-600">Servicio:</span>
                  <span className="font-medium">{services.find(s => s.id === watchedValues.service_id)?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Precio por hora:</span>
                  <span className="font-medium">€{services.find(s => s.id === watchedValues.service_id)?.price_per_hour}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Duración seleccionada:</span>
                  <span className="font-medium">{durationHours} {durationHours === 1 ? 'hora' : 'horas'}</span>
                </div>
                <div className="border-t border-green-300 pt-2 mt-3">
                  <div className="flex justify-between text-lg font-bold text-green-800">
                    <span>Total:</span>
                    <span>€{displayTotalPrice}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !selectedSlot || !watchedValues.service_id || !selectedAddress}
            className="w-full bg-green-600 text-white py-3 sm:py-4 px-4 sm:px-6 rounded-lg font-semibold hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm sm:text-base"
          >
            {loading ? 'Procesando reserva...' : 'Reservar Servicio'}
          </button>
        </form>
        {showAuthPrompt && (
          <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Necesitamos identificarte</h3>
              <p className="text-sm text-gray-600 mb-4">Para enviar tu solicitud, inicia sesión o regístrate como cliente.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    sessionStorage.setItem('post_auth_force_client', 'true');
                    navigate('/auth', { state: { forceClientOnly: true } });
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Iniciar sesión
                </button>
                <button
                  type="button"
                  onClick={() => {
                    sessionStorage.setItem('post_auth_force_client', 'true');
                    navigate('/auth', { state: { forceClientOnly: true } });
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  Registrarse (Cliente)
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowAuthPrompt(false)}
                className="mt-4 text-sm text-gray-600 hover:text-gray-800"
              >
                Seguir editando datos
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ServiceBooking;
