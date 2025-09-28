import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { format, addDays, startOfDay, addHours, parse, parseISO, isValid } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar, Clock, MapPin, DollarSign, Scissors, SprayCan as Spray, TreePine, CheckCircle } from 'lucide-react';
import { Service, PriceCalculation } from '../../types';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import AddressAutocomplete from '../common/AddressAutocomplete';

const schema = yup.object({
  service_id: yup.string().required('Servicio requerido'),
  date: yup.string().required('Fecha requerida'),
  start_time: yup.string().required('Hora requerida'),
  duration_hours: yup.number().min(1, 'Mínimo 1 hora').max(8, 'Máximo 8 horas').required('Duración requerida'),
  client_address: yup.string().required('Dirección requerida'),
  notes: yup.string()
});

type FormData = yup.InferType<typeof schema>;

const ServiceBooking = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [services, setServices] = useState<Service[]>([]);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [availableDates, setAvailableDates] = useState<{value: string, label: string}[]>([]);
  const [priceCalculation, setPriceCalculation] = useState<PriceCalculation | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState('');
  
  // Servicio preseleccionado desde la navegación
  const preselectedService = location.state?.selectedService;
  const preselectedServiceId = location.state?.selectedServiceId;

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: yupResolver(schema),
    defaultValues: {
      service_id: preselectedServiceId || ''
    }
  });

  const watchedValues = watch();

  useEffect(() => {
    fetchServices();
  }, []);

  useEffect(() => {
    if (watchedValues.service_id && selectedAddress) {
      fetchAvailableDates();
    }
  }, [watchedValues.service_id, selectedAddress]);

  useEffect(() => {
    if (watchedValues.service_id && watchedValues.date) {
      fetchAvailableSlots();
    }
  }, [watchedValues.service_id, watchedValues.date]);

  useEffect(() => {
    if (watchedValues.service_id && watchedValues.duration_hours) {
      calculatePrice();
    }
  }, [watchedValues.service_id, watchedValues.duration_hours]);

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

  const fetchAvailableDates = async () => {
    try {
      console.log('Fetching available dates for service:', watchedValues.service_id);
      console.log('Selected address for filtering:', selectedAddress);
      
      // Primero obtener jardineros que ofrecen el servicio seleccionado
      const { data: gardeners, error: gardenersError } = await supabase
        .from('gardener_profiles')
        .select('user_id, address, max_distance')
        .contains('services', [watchedValues.service_id]);

      if (gardenersError) throw gardenersError;
      
      console.log('Gardeners offering service:', gardeners);

      if (!gardeners || gardeners.length === 0) {
        console.log('No gardeners found for this service');
        setAvailableDates([]);
        return;
      }

      let filteredGardeners = gardeners;

      // Si tenemos dirección del cliente, filtrar por rango de trabajo del jardinero
      if (selectedAddress) {
        try {
          console.log('Filtering gardeners by client within their work range for address:', selectedAddress);
          // Obtener coordenadas del cliente
          const clientCoords = await getCoordinatesFromAddress(selectedAddress);
          
          if (clientCoords) {
            console.log('Client location:', clientCoords);
            
            // Filtrar jardineros que pueden atender al cliente (cliente dentro del rango del jardinero)
            const gardenersInRange = [];
            
            for (const gardener of gardeners) {
              if (!gardener.address) {
                console.log(`Gardener ${gardener.user_id} has no address, excluding from results`);
                continue; // Excluir si no tiene dirección definida
              }
              
              const gardenerCoords = await getCoordinatesFromAddress(gardener.address);
              if (!gardenerCoords) {
                console.log(`Could not get coordinates for gardener ${gardener.user_id}`);
                continue;
              }
              
              const distance = calculateDistance(
                clientCoords.lat,
                clientCoords.lng,
                gardenerCoords.lat,
                gardenerCoords.lng
              );
              
              const maxRange = gardener.max_distance || 25; // Default 25km si no está especificado
              
              console.log(`Distance from gardener ${gardener.user_id} to client: ${distance}km (gardener's max range: ${maxRange}km)`);
              
              if (distance <= maxRange) {
                gardenersInRange.push(gardener);
                console.log(`✅ Gardener ${gardener.user_id} can serve client: ${distance.toFixed(2)}km <= ${maxRange}km`);
              } else {
                console.log(`❌ Gardener ${gardener.user_id} cannot serve client: ${distance.toFixed(2)}km > ${maxRange}km`);
              }
            }
            
            filteredGardeners = gardenersInRange;
            console.log('Gardeners that can serve client:', filteredGardeners);
          }
        } catch (geocodeError) {
          console.warn('Error en geocodificación para fechas, mostrando todos los jardineros:', geocodeError);
          // Si hay error en geocodificación, mostrar todos los jardineros disponibles
        }
      }

      if (filteredGardeners.length === 0) {
        console.log('No gardeners found that can serve this location');
        setAvailableDates([]);
        return;
      }

      const gardenerIds = filteredGardeners.map(g => g.user_id);

      // Obtener fechas con disponibilidad de estos jardineros filtrados
      const { data, error } = await supabase
        .from('availability')
        .select('date, gardener_id')
        .eq('is_available', true)
        .in('gardener_id', gardenerIds)
        .gte('date', format(addDays(startOfDay(new Date()), 1), 'yyyy-MM-dd'))
        .lte('date', format(addDays(startOfDay(new Date()), 14), 'yyyy-MM-dd'));

      if (error) throw error;

      console.log('Available dates data:', data);

      // Obtener fechas únicas y ordenarlas
      const uniqueDates = [...new Set(data?.map(item => item.date) || [])].sort();
      
      console.log('Unique dates:', uniqueDates);
      
      // Formatear las fechas para el selector
      const formattedDates = uniqueDates.map(dateStr => ({
        value: dateStr,
        label: format(parseISO(dateStr), 'EEEE, d MMMM', { locale: es })
      }));

      setAvailableDates(formattedDates);
    } catch (error) {
      console.error('Error fetching available dates:', error);
      setAvailableDates([]);
    }
  };

  const fetchAvailableSlots = async () => {
    try {
      console.log('Fetching available slots for date:', watchedValues.date, 'service:', watchedValues.service_id);
      
      // Primero obtener jardineros que ofrecen el servicio seleccionado
      const { data: gardeners, error: gardenersError } = await supabase
        .from('gardener_profiles')
        .select('user_id, address, max_distance')
        .contains('services', [watchedValues.service_id]);

      if (gardenersError) throw gardenersError;
      
      console.log('Gardeners for slots:', gardeners);

      if (!gardeners || gardeners.length === 0) {
        console.log('No gardeners found for this service');
        setAvailableSlots([]);
        return;
      }

      let filteredGardeners = gardeners;

      // Si tenemos dirección del cliente, filtrar por rango de trabajo del jardinero
      if (selectedAddress) {
        try {
          console.log('Filtering slots by client within gardener work range for address:', selectedAddress);
          // Obtener coordenadas del cliente
          const clientCoords = await getCoordinatesFromAddress(selectedAddress);
          
          if (clientCoords) {
            console.log('Client location for slots:', clientCoords);
            
            // Filtrar jardineros que pueden atender al cliente (cliente dentro del rango del jardinero)
            const gardenersInRange = [];
            
            for (const gardener of gardeners) {
              if (!gardener.address) {
                console.log(`Gardener ${gardener.user_id} has no address, excluding from slots`);
                continue; // Excluir si no tiene dirección definida
              }
              
              const gardenerCoords = await getCoordinatesFromAddress(gardener.address);
              if (!gardenerCoords) {
                console.log(`Could not get coordinates for gardener ${gardener.user_id}`);
                continue;
              }
              
              const distance = calculateDistance(
                clientCoords.lat,
                clientCoords.lng,
                gardenerCoords.lat,
                gardenerCoords.lng
              );
              
              const maxRange = gardener.max_distance || 25; // Default 25km si no está especificado
              
              console.log(`Distance from gardener ${gardener.user_id} to client: ${distance}km (gardener's max range: ${maxRange}km)`);
              
              if (distance <= maxRange) {
                gardenersInRange.push(gardener);
                console.log(`✅ Gardener ${gardener.user_id} can serve client for slots: ${distance.toFixed(2)}km <= ${maxRange}km`);
              } else {
                console.log(`❌ Gardener ${gardener.user_id} cannot serve client for slots: ${distance.toFixed(2)}km > ${maxRange}km`);
              }
            }
            
            filteredGardeners = gardenersInRange;
            console.log('Gardeners that can serve client for slots:', filteredGardeners);
          }
        } catch (geocodeError) {
          console.warn('Error en geocodificación para horarios, mostrando todos los horarios:', geocodeError);
          // Si hay error en geocodificación, mostrar todos los horarios disponibles
        }
      }

      if (filteredGardeners.length === 0) {
        console.log('No gardeners found that can serve this location for slots');
        setAvailableSlots([]);
        return;
      }

      const gardenerIds = filteredGardeners.map(g => g.user_id);

      // Obtener disponibilidad para la fecha seleccionada de jardineros filtrados
      const { data, error } = await supabase
        .from('availability')
        .select('*')
        .eq('date', watchedValues.date)
        .eq('is_available', true)
        .in('gardener_id', gardenerIds);

      if (error) throw error;

      console.log('Available slots data:', data);

      if (!data || data.length === 0) {
        console.log('No availability found for this date from gardeners in range');
        setAvailableSlots([]);
        return;
      }

      console.log('Filtered availability data:', data);

      // Extraer horarios únicos y ordenarlos
      const slots = data.map(slot => slot.start_time);
      const uniqueSlots = [...new Set(slots)].sort();
      
      console.log('Available time slots:', uniqueSlots);
      setAvailableSlots(uniqueSlots);
    } catch (error) {
      console.error('Error fetching available slots:', error);
      setAvailableSlots([]);
    }
  };

  const calculatePrice = async () => {
    try {
      const service = services.find(s => s.id === watchedValues.service_id);
      if (!service || !watchedValues.duration_hours) return;

      const basePrice = service.base_price;
      const travelFee = 15; // Precio fijo de desplazamiento
      const hourlyRate = 25; // Precio por hora
      const totalHours = watchedValues.duration_hours;
      const totalPrice = basePrice + travelFee + (hourlyRate * totalHours);

      setPriceCalculation({
        basePrice,
        travelFee,
        hourlyRate,
        totalHours,
        totalPrice
      });
    } catch (error) {
      console.error('Error calculating price:', error);
    }
  };

  const onSubmit = async (data: FormData) => {
    if (!user || !priceCalculation) return;

    setLoading(true);
    try {
      // Usar la nueva lógica de selección inteligente de jardineros
      console.log('🚀 Iniciando proceso de reserva con selección inteligente');
      
      const assignedGardener = await selectBestGardener(data.service_id, data.client_address);
      
      console.log('✅ Jardinero asignado:', assignedGardener.profiles?.full_name);

      // Crear la reserva
      const { data: bookingData, error: bookingError } = await supabase
        .from('bookings')
        .insert([
          {
            client_id: user.id,
            gardener_id: assignedGardener.user_id,
            service_id: data.service_id,
            date: data.date,
            start_time: data.start_time,
            duration_hours: data.duration_hours,
            total_price: priceCalculation.totalPrice,
            travel_fee: priceCalculation.travelFee,
            hourly_rate: priceCalculation.hourlyRate,
            client_address: data.client_address,
            notes: data.notes,
            status: 'pending'
          }
        ])
        .select()
        .single();

      if (bookingError) throw bookingError;

      // Actualizar la disponibilidad del jardinero (marcar como no disponible)
      const startTime = data.start_time;
      
      // Calcular endTime de forma más robusta
      let endTime: string;
      try {
        const baseDate = parseISO('2025-01-01T00:00:00');
        const startDateTime = parse(startTime, 'HH:mm', baseDate);
        
        if (isValid(startDateTime)) {
          const endDateTime = addHours(startDateTime, data.duration_hours);
          endTime = format(endDateTime, 'HH:mm');
        } else {
          // Fallback: calcular manualmente
          const [hours, minutes] = startTime.split(':').map(Number);
          const totalMinutes = hours * 60 + minutes + (data.duration_hours * 60);
          const endHours = Math.floor(totalMinutes / 60) % 24;
          const endMins = totalMinutes % 60;
          endTime = `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}`;
        }
      } catch (error) {
        console.error('Error calculating end time:', error);
        // Fallback seguro
        const [hours, minutes] = startTime.split(':').map(Number);
        const totalMinutes = hours * 60 + minutes + (data.duration_hours * 60);
        const endHours = Math.floor(totalMinutes / 60) % 24;
        const endMins = totalMinutes % 60;
        endTime = `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}`;
      }

      const { error: availabilityError } = await supabase
        .from('availability')
        .update({ is_available: false })
        .eq('gardener_id', assignedGardener.user_id)
        .eq('date', data.date)
        .gte('start_time', startTime)
        .lte('end_time', endTime);

      if (availabilityError) {
        console.warn('Error actualizando disponibilidad:', availabilityError);
      }

      // Crear mensaje inicial automático en el chat
      const welcomeMessage = `¡Hola! He recibido tu solicitud para el servicio de ${services.find(s => s.id === data.service_id)?.name} el ${format(parseISO(data.date), 'dd/MM/yyyy', { locale: es })} a las ${startTime}. Revisaré tu solicitud y te confirmaré la disponibilidad pronto. ¡Gracias por elegirme!`;

      const { error: chatError } = await supabase
        .from('chat_messages')
        .insert([
          {
            booking_id: bookingData.id,
            sender_id: assignedGardener.user_id,
            message: welcomeMessage
          }
        ]);

      if (chatError) {
        console.warn('Error creando mensaje inicial:', chatError);
      }

      // Mostrar información del jardinero asignado
      toast.success(
        <div className="text-left">
          <div className="font-semibold mb-2">¡Reserva confirmada!</div>
          <div className="text-sm space-y-1">
            <div>🌿 <strong>Jardinero:</strong> {assignedGardener.profiles?.full_name}</div>
            <div>⭐ <strong>Calificación:</strong> {assignedGardener.rating?.toFixed(1)}/5</div>
            <div>📍 <strong>Distancia:</strong> {assignedGardener.distance?.toFixed(1)} km</div>
            <div>💬 <strong>Chat disponible</strong> en tu panel de reservas</div>
          </div>
        </div>,
        { duration: 6000 }
      );
      
      // Redirect to bookings page after successful booking
      setTimeout(() => {
        navigate('/bookings');
      }, 3000);
    } catch (error: any) {
      toast.error(error.message || 'Error al reservar el servicio');
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

  // Función para calcular la distancia entre dos coordenadas usando la fórmula de Haversine
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Radio de la Tierra en kilómetros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Función para obtener coordenadas de una dirección usando Google Maps Geocoding
  const getCoordinatesFromAddress = async (address: string): Promise<{lat: number, lng: number} | null> => {
    try {
      if (!window.google?.maps?.Geocoder) {
        console.error('Google Maps Geocoder no está disponible');
        return null;
      }

      const geocoder = new window.google.maps.Geocoder();
      
      return new Promise((resolve, reject) => {
        geocoder.geocode({ address: address }, (results, status) => {
          if (status === 'OK' && results && results[0]) {
            const location = results[0].geometry.location;
            resolve({
              lat: location.lat(),
              lng: location.lng()
            });
          } else {
            console.error('Geocoding falló:', status);
            resolve(null);
          }
        });
      });
    } catch (error) {
      console.error('Error en geocoding:', error);
      return null;
    }
  };

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
      .eq('user_id', gardeners[0].user_id)
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
      const gardenerIds = gardeners.map(g => g.user_id);
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', gardenerIds);

      if (profilesError) {
        console.warn('Error obteniendo perfiles:', profilesError);
      }

      // 4. Filtrar jardineros por rango de distancia y calcular distancias
      const gardenersWithDistance = [];
      
      for (const gardener of gardeners) {
        const profile = profiles?.find(p => p.user_id === gardener.user_id);
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

          {/* Selección de Fecha */}
          {selectedAddress && watchedValues.service_id ? (
            availableDates.length > 0 ? (
              <div>
                <label className="block text-lg font-semibold text-gray-700 mb-3 sm:mb-4">
                  <Calendar className="inline w-5 h-5 mr-2" />
                  Fechas disponibles
                </label>
                <select
                  {...register('date')}
                  className="w-full p-3 sm:p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm sm:text-base"
                >
                  <option value="">Selecciona una fecha disponible</option>
                  {availableDates.map((date) => (
                    <option key={date.value} value={date.value}>
                      {date.label}
                    </option>
                  ))}
                </select>
                {errors.date && (
                  <p className="mt-2 text-sm text-red-600">{errors.date.message}</p>
                )}
              </div>
            ) : (
              <div className="p-3 sm:p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-yellow-700 text-center text-sm sm:text-base">
                  <Calendar className="inline w-5 h-5 mr-2" />
                  No hay fechas disponibles para este servicio en los próximos 14 días. Intenta con otro servicio o contacta con nosotros.
                </p>
              </div>
            )
          ) : (
            <div className="p-3 sm:p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-gray-600 text-center text-sm sm:text-base">
                <Calendar className="inline w-5 h-5 mr-2" />
                {!selectedAddress ? 'Primero selecciona una dirección' : 'Selecciona un servicio'} para ver las fechas disponibles
              </p>
            </div>
          )}

          {/* Selección de Hora */}
          {watchedValues.date ? (
            availableSlots.length > 0 ? (
              <div>
                <label className="block text-lg font-semibold text-gray-700 mb-3 sm:mb-4">
                  <Clock className="inline w-5 h-5 mr-2" />
                  Horarios disponibles ({availableSlots.length} opciones)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3">
                  {availableSlots.map((slot) => (
                    <label key={slot} className="relative cursor-pointer">
                      <input
                        {...register('start_time')}
                        type="radio"
                        value={slot}
                        className="sr-only"
                      />
                      <div className="p-2 sm:p-3 text-center border-2 border-gray-200 rounded-lg hover:border-green-300 transition-colors peer-checked:border-green-500 peer-checked:bg-green-50 text-sm sm:text-base">
                        {slot}
                      </div>
                    </label>
                  ))}
                </div>
                {errors.start_time && (
                  <p className="mt-2 text-sm text-red-600">{errors.start_time.message}</p>
                )}
                <p className="mt-2 text-xs sm:text-sm text-gray-500">
                  ✨ Horarios filtrados por jardineros disponibles en tu zona
                </p>
              </div>
            ) : (
              <div className="p-3 sm:p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-yellow-700 text-center text-sm sm:text-base">
                  <Clock className="inline w-5 h-5 mr-2" />
                  No hay jardineros disponibles para la fecha seleccionada en tu zona. Prueba con otra fecha.
                </p>
              </div>
            )
          ) : selectedAddress && watchedValues.service_id && availableDates.length > 0 ? (
            <div className="p-3 sm:p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-gray-600 text-center text-sm sm:text-base">
                <Clock className="inline w-5 h-5 mr-2" />
                Selecciona una fecha para ver los horarios disponibles
              </p>
            </div>
          ) : null}

          {/* Duración */}
          {watchedValues.start_time ? (
            <div>
              <label className="block text-lg font-semibold text-gray-700 mb-3 sm:mb-4">
                Duración del servicio
              </label>
              <select
                {...register('duration_hours', { valueAsNumber: true })}
                className="w-full p-3 sm:p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm sm:text-base"
              >
                <option value="">Selecciona duración</option>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((hours) => (
                  <option key={hours} value={hours}>
                    {hours} {hours === 1 ? 'hora' : 'horas'}
                  </option>
                ))}
              </select>
              {errors.duration_hours && (
                <p className="mt-2 text-sm text-red-600">{errors.duration_hours.message}</p>
              )}
            </div>
          ) : watchedValues.date && (
            <div className="p-3 sm:p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-gray-600 text-center text-sm sm:text-base">
                Selecciona un horario para continuar con la duración del servicio
              </p>
            </div>
          )}

          {/* Notas adicionales */}
          {watchedValues.duration_hours && (
            <div>
              <label className="block text-lg font-semibold text-gray-700 mb-3 sm:mb-4">
                Información adicional (opcional)
              </label>
              <textarea
                {...register('notes')}
                rows={3}
                className="w-full p-3 sm:p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm sm:text-base"
                placeholder="Cualquier información adicional que el jardinero deba saber (acceso al jardín, herramientas especiales, etc.)"
              />
              <p className="mt-2 text-xs sm:text-sm text-gray-500">
                Esta información ayudará al jardinero a prepararse mejor para el servicio
              </p>
            </div>
          )}

          {/* Cálculo de Precio */}
          {priceCalculation && (
            <div className="bg-green-50 border border-green-200 rounded-lg sm:rounded-xl p-4 sm:p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3 sm:mb-4 flex items-center">
                <DollarSign className="w-5 h-5 mr-2" />
                Resumen de Precios
              </h3>
              <div className="space-y-2 text-xs sm:text-sm">
                <div className="flex justify-between">
                  <span>Precio base del servicio:</span>
                  <span>€{priceCalculation.basePrice}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tarifa de desplazamiento:</span>
                  <span>€{priceCalculation.travelFee}</span>
                </div>
                <div className="flex justify-between">
                  <span className="break-words">Horas de trabajo ({priceCalculation.totalHours}h × €{priceCalculation.hourlyRate}):</span>
                  <span className="ml-2">€{priceCalculation.hourlyRate * priceCalculation.totalHours}</span>
                </div>
                <hr className="my-2" />
                <div className="flex justify-between text-base sm:text-lg font-bold">
                  <span>Total:</span>
                  <span>€{priceCalculation.totalPrice}</span>
                </div>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !priceCalculation}
            className="w-full bg-green-600 text-white py-3 sm:py-4 px-4 sm:px-6 rounded-lg font-semibold hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm sm:text-base"
          >
            {loading ? 'Procesando reserva...' : 'Reservar Servicio'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ServiceBooking;