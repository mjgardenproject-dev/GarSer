import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { format, addDays, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar, Clock, MapPin, DollarSign, Scissors, SprayCan as Spray, TreePine, CheckCircle } from 'lucide-react';
import { Service, PriceCalculation } from '../../types';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

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
  const [priceCalculation, setPriceCalculation] = useState<PriceCalculation | null>(null);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    resolver: yupResolver(schema),
    defaultValues: {
      service_id: location.state?.selectedServiceId || ''
    }
  });

  const watchedValues = watch();

  useEffect(() => {
    fetchServices();
  }, []);

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

  const fetchAvailableSlots = async () => {
    try {
      const { data, error } = await supabase
        .from('availability')
        .select(`
          *,
          gardener_profiles!inner(services)
        `)
        .eq('date', watchedValues.date)
        .eq('is_available', true)
        .contains('gardener_profiles.services', [watchedValues.service_id]);

      if (error) throw error;

      const slots = data?.map(slot => slot.start_time) || [];
      setAvailableSlots([...new Set(slots)].sort());
    } catch (error) {
      console.error('Error fetching available slots:', error);
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
      // Simular asignación con IA (en producción sería más compleja)
      const { data: gardeners, error: gardenersError } = await supabase
        .from('gardener_profiles')
        .select('*')
        .contains('services', [data.service_id])
        .eq('is_available', true)
        .order('rating', { ascending: false })
        .limit(1);

      if (gardenersError) throw gardenersError;

      if (!gardeners || gardeners.length === 0) {
        toast.error('No hay jardineros disponibles para este servicio');
        return;
      }

      const assignedGardener = gardeners[0];

      const { error } = await supabase
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
        ]);

      if (error) throw error;

      toast.success('¡Servicio reservado exitosamente! Te hemos asignado un jardinero.');
      
      // Redirect to bookings page after successful booking
      setTimeout(() => {
        navigate('/bookings');
      }, 2000);
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

  const generateDateOptions = () => {
    const dates = [];
    for (let i = 1; i <= 14; i++) {
      const date = addDays(startOfDay(new Date()), i);
      dates.push({
        value: format(date, 'yyyy-MM-dd'),
        label: format(date, 'EEEE, d MMMM', { locale: es })
      });
    }
    return dates;
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-2xl shadow-xl p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Reservar Servicio de Jardinería</h1>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
          {/* Selección de Servicio */}
          <div>
            <label className="block text-lg font-semibold text-gray-700 mb-4">
              Selecciona el servicio
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {services.map((service) => (
                <label key={service.id} className="relative cursor-pointer">
                  <input
                    {...register('service_id')}
                    type="radio"
                    value={service.id}
                    className="sr-only"
                  />
                  <div className="p-6 border-2 border-gray-200 rounded-xl hover:border-green-300 transition-colors peer-checked:border-green-500 peer-checked:bg-green-50">
                    <div className="flex items-center mb-3">
                      <div className="text-green-600 mr-3">
                        {getServiceIcon(service.name)}
                      </div>
                      <h3 className="font-semibold text-gray-900">{service.name}</h3>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">{service.description}</p>
                    <p className="text-lg font-bold text-green-600">€{service.base_price}</p>
                  </div>
                </label>
              ))}
            </div>
            {errors.service_id && (
              <p className="mt-2 text-sm text-red-600">{errors.service_id.message}</p>
            )}
          </div>

          {/* Selección de Fecha */}
          <div>
            <label className="block text-lg font-semibold text-gray-700 mb-4">
              <Calendar className="inline w-5 h-5 mr-2" />
              Fecha del servicio
            </label>
            <select
              {...register('date')}
              className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
            >
              <option value="">Selecciona una fecha</option>
              {generateDateOptions().map((date) => (
                <option key={date.value} value={date.value}>
                  {date.label}
                </option>
              ))}
            </select>
            {errors.date && (
              <p className="mt-2 text-sm text-red-600">{errors.date.message}</p>
            )}
          </div>

          {/* Selección de Hora */}
          {availableSlots.length > 0 && (
            <div>
              <label className="block text-lg font-semibold text-gray-700 mb-4">
                <Clock className="inline w-5 h-5 mr-2" />
                Hora disponible
              </label>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                {availableSlots.map((slot) => (
                  <label key={slot} className="relative cursor-pointer">
                    <input
                      {...register('start_time')}
                      type="radio"
                      value={slot}
                      className="sr-only"
                    />
                    <div className="p-3 text-center border-2 border-gray-200 rounded-lg hover:border-green-300 transition-colors peer-checked:border-green-500 peer-checked:bg-green-50">
                      {slot}
                    </div>
                  </label>
                ))}
              </div>
              {errors.start_time && (
                <p className="mt-2 text-sm text-red-600">{errors.start_time.message}</p>
              )}
            </div>
          )}

          {/* Duración */}
          <div>
            <label className="block text-lg font-semibold text-gray-700 mb-4">
              Duración (horas)
            </label>
            <select
              {...register('duration_hours', { valueAsNumber: true })}
              className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
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

          {/* Dirección */}
          <div>
            <label className="block text-lg font-semibold text-gray-700 mb-4">
              <MapPin className="inline w-5 h-5 mr-2" />
              Dirección del servicio
            </label>
            <textarea
              {...register('client_address')}
              rows={3}
              className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              placeholder="Ingresa la dirección completa donde se realizará el servicio"
            />
            {errors.client_address && (
              <p className="mt-2 text-sm text-red-600">{errors.client_address.message}</p>
            )}
          </div>

          {/* Notas adicionales */}
          <div>
            <label className="block text-lg font-semibold text-gray-700 mb-4">
              Notas adicionales (opcional)
            </label>
            <textarea
              {...register('notes')}
              rows={3}
              className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              placeholder="Cualquier información adicional que el jardinero deba saber"
            />
          </div>

          {/* Cálculo de Precio */}
          {priceCalculation && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <DollarSign className="w-5 h-5 mr-2" />
                Resumen de Precios
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Precio base del servicio:</span>
                  <span>€{priceCalculation.basePrice}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tarifa de desplazamiento:</span>
                  <span>€{priceCalculation.travelFee}</span>
                </div>
                <div className="flex justify-between">
                  <span>Horas de trabajo ({priceCalculation.totalHours}h × €{priceCalculation.hourlyRate}):</span>
                  <span>€{priceCalculation.hourlyRate * priceCalculation.totalHours}</span>
                </div>
                <hr className="my-2" />
                <div className="flex justify-between text-lg font-bold">
                  <span>Total:</span>
                  <span>€{priceCalculation.totalPrice}</span>
                </div>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !priceCalculation}
            className="w-full bg-green-600 text-white py-4 px-6 rounded-lg font-semibold hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Procesando reserva...' : 'Reservar Servicio'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ServiceBooking;