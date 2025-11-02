import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Calendar, Clock, Save, Check, X, Copy, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, addDays, startOfWeek, endOfWeek, eachDayOfInterval, subWeeks, addWeeks } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
  generateDailyTimeBlocks, 
  getGardenerAvailability, 
  setGardenerAvailability 
} from '../../utils/availabilityService';
import { AvailabilityBlock, TimeBlock } from '../../types';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

const AvailabilityManager = () => {
  const { user } = useAuth();
  const [selectedWeek, setSelectedWeek] = useState(new Date());
  const [weeklyAvailability, setWeeklyAvailability] = useState<{ [date: string]: { [hour: number]: boolean } }>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bookedBlocks, setBookedBlocks] = useState<{ [date: string]: Set<number> }>({});

  // Generar bloques de tiempo de 1 hora (8:00 AM a 8:00 PM)
  const timeBlocks = generateDailyTimeBlocks();

  useEffect(() => {
    fetchWeeklyAvailability();
  }, [selectedWeek, user]);

  const fetchWeeklyAvailability = async () => {
    if (!user) {
      console.error('No user found when trying to fetch availability');
      return;
    }

    console.log('Starting to fetch weekly availability for user:', user.id);

    setLoading(true);
    try {
      const weekStart = startOfWeek(selectedWeek, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });
      const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });
      
      console.log('Fetching availability for week:', format(weekStart, 'yyyy-MM-dd'), 'to', format(weekEnd, 'yyyy-MM-dd'));
      
      const weeklyData: { [date: string]: { [hour: number]: boolean } } = {};

      for (const day of weekDays) {
        const dateStr = format(day, 'yyyy-MM-dd');
        console.log('Fetching availability for date:', dateStr);
        
        const availability = await getGardenerAvailability(user.id, dateStr);
        console.log(`Availability for ${dateStr}:`, availability);
        
        // Convertir a formato de horas
        const dayAvailability: { [hour: number]: boolean } = {};
        availability.forEach(block => {
          if (block.is_available) {
            dayAvailability[block.hour_block] = true;
          }
        });
        weeklyData[dateStr] = dayAvailability;
      }

      console.log('Final weekly availability data:', weeklyData);
      setWeeklyAvailability(weeklyData);

      // Cargar reservas confirmadas dentro de la semana y marcar bloques
      try {
        const startStr = format(weekStart, 'yyyy-MM-dd');
        const endStr = format(weekEnd, 'yyyy-MM-dd');
        const { data: bookings, error: bookingsError } = await supabase
          .from('bookings')
          .select('date, start_time, duration_hours')
          .eq('gardener_id', user.id)
          .eq('status', 'confirmed')
          .gte('date', startStr)
          .lte('date', endStr);

        if (bookingsError) {
          console.warn('Error fetching confirmed bookings for calendar:', bookingsError);
          setBookedBlocks({});
        } else {
          const bookedMap: { [date: string]: Set<number> } = {};
          (bookings || []).forEach((b: any) => {
            const startHour = parseInt((b.start_time || '08:00').split(':')[0]);
            const duration = b.duration_hours || 1;
            const dateKey = b.date;
            if (!bookedMap[dateKey]) bookedMap[dateKey] = new Set<number>();
            for (let i = 0; i < duration; i++) {
              bookedMap[dateKey].add(startHour + i);
            }
          });
          setBookedBlocks(bookedMap);
        }
      } catch (e) {
        console.warn('Error building booked blocks map:', e);
        setBookedBlocks({});
      }
    } catch (error) {
      console.error('Error fetching availability:', error);
      toast.error('Error al cargar la disponibilidad');
    } finally {
      setLoading(false);
    }
  };

  const toggleBlockAvailability = (date: string, hour: number) => {
    setWeeklyAvailability(prev => {
      const dayAvailability = prev[date] || {};
      return {
        ...prev,
        [date]: {
          ...dayAvailability,
          [hour]: !dayAvailability[hour]
        }
      };
    });
  };

  const saveWeeklyAvailability = async () => {
    if (!user) {
      console.error('No user found when trying to save availability');
      return;
    }

    console.log('Starting to save weekly availability for user:', user.id);
    console.log('Weekly availability data:', weeklyAvailability);

    setSaving(true);
    try {
      const promises = Object.entries(weeklyAvailability).map(([date, dayAvailability]) => {
        const availableHours = Object.entries(dayAvailability)
          .filter(([_, isAvailable]) => isAvailable)
          .map(([hour, _]) => parseInt(hour));
        
        console.log(`Saving availability for date ${date}:`, availableHours);
        return setGardenerAvailability(user.id, date, availableHours);
      });

      const results = await Promise.all(promises);
      console.log('Save results:', results);
      toast.success('Disponibilidad guardada correctamente');
    } catch (error: any) {
      console.error('Error saving availability:', error);
      toast.error('Error al guardar la disponibilidad');
    } finally {
      setSaving(false);
    }
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    setSelectedWeek(prev => direction === 'prev' ? subWeeks(prev, 1) : addWeeks(prev, 1));
  };

  const copyPreviousWeekSchedule = async () => {
    if (!user) return;

    setSaving(true);
    try {
      const previousWeek = subWeeks(selectedWeek, 1);
      const prevWeekStart = startOfWeek(previousWeek, { weekStartsOn: 1 });
      const prevWeekEnd = endOfWeek(previousWeek, { weekStartsOn: 1 });
      const prevWeekDays = eachDayOfInterval({ start: prevWeekStart, end: prevWeekEnd });
      
      const currentWeekStart = startOfWeek(selectedWeek, { weekStartsOn: 1 });
      const currentWeekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });
      const currentWeekDays = eachDayOfInterval({ start: currentWeekStart, end: currentWeekEnd });

      const previousWeekData: { [date: string]: { [hour: number]: boolean } } = {};
      
      // Obtener datos de la semana anterior
      for (const day of prevWeekDays) {
        const dateStr = format(day, 'yyyy-MM-dd');
        const availability = await getGardenerAvailability(user.id, dateStr);
        
        const dayAvailability: { [hour: number]: boolean } = {};
        for (let hour = 8; hour <= 19; hour++) {
          dayAvailability[hour] = availability.some(block => block.hour_block === hour && block.is_available);
        }
        previousWeekData[dateStr] = dayAvailability;
      }

      // Aplicar a la semana actual
      const newWeeklyAvailability = { ...weeklyAvailability };
      currentWeekDays.forEach((day, index) => {
        const currentDateStr = format(day, 'yyyy-MM-dd');
        const previousDateStr = format(prevWeekDays[index], 'yyyy-MM-dd');
        
        if (previousWeekData[previousDateStr]) {
          newWeeklyAvailability[currentDateStr] = { ...previousWeekData[previousDateStr] };
        }
      });

      // Actualizar el estado local
      setWeeklyAvailability(newWeeklyAvailability);

      // Guardar automáticamente en la base de datos solo para los días de la semana actual
      const savePromises = currentWeekDays.map((day) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const dayAvailability = newWeeklyAvailability[dateStr] || {};
        const availableHours = Object.entries(dayAvailability)
          .filter(([_, isAvailable]) => isAvailable)
          .map(([hour, _]) => parseInt(hour));
        
        console.log(`Auto-saving availability for date ${dateStr}:`, availableHours);
        return setGardenerAvailability(user.id, dateStr, availableHours);
      });

      await Promise.all(savePromises);
      
      // Refrescar los datos desde la base de datos para asegurar sincronización
      await fetchWeeklyAvailability();
      
      toast.success('Horario de la semana anterior copiado y guardado correctamente');
    } catch (error) {
      console.error('Error copying previous week schedule:', error);
      toast.error('Error al copiar el horario de la semana anterior');
    } finally {
      setSaving(false);
    }
  };

  const getWeekDays = () => {
    const weekStart = startOfWeek(selectedWeek, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: weekStart, end: weekEnd });
  };

  const isBlockAvailable = (date: string, hour: number): boolean => {
    const dayAvailability = weeklyAvailability[date] || {};
    return dayAvailability[hour] || false;
  };

  const isBlockBooked = (date: string, hour: number): boolean => {
    const set = bookedBlocks[date];
    return !!set && set.has(hour);
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-6 overflow-hidden">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-center md:justify-between gap-4 mb-6">
          <div className="flex items-center">
            <Calendar className="w-6 h-6 text-green-600 mr-3" />
            <h2 className="text-2xl font-bold text-gray-900">Gestión de Disponibilidad</h2>
          </div>
          
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigateWeek('prev')}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            
            <div className="text-center">
              <p className="text-lg font-semibold text-gray-900">
                {format(startOfWeek(selectedWeek, { weekStartsOn: 1 }), 'dd MMM', { locale: es })} - {' '}
                {format(endOfWeek(selectedWeek, { weekStartsOn: 1 }), 'dd MMM yyyy', { locale: es })}
              </p>
            </div>
            
            <button
              onClick={() => navigateWeek('next')}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          
          <div className="flex items-center space-x-3">
            <button
              onClick={copyPreviousWeekSchedule}
              disabled={saving}
              className="flex items-center px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Copy className="w-4 h-4 mr-2" />
              {saving ? 'Copiando...' : 'Copiar Semana Anterior'}
            </button>
            
            <button
              onClick={saveWeeklyAvailability}
              disabled={saving}
              className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              <Save className="w-4 h-4 mr-2" />
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
            <span className="ml-3 text-gray-600">Cargando disponibilidad...</span>
          </div>
        ) : (
          <div className="space-y-3 overflow-x-auto w-full">
            {/* Days header */}
            <div className="grid grid-cols-8 gap-2 mb-4 min-w-[720px]">
              <div className="flex items-center justify-center py-3 bg-gray-100 rounded-lg">
                <Clock className="w-4 h-4 mr-2 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Horario</span>
              </div>
              
              {getWeekDays().map((day) => (
                <div key={day.toISOString()} className="text-center py-3 bg-gray-50 rounded-lg">
                  <p className="text-xs sm:text-sm font-medium text-gray-900">
                    {format(day, 'EEE', { locale: es })}
                  </p>
                  <p className="text-[11px] sm:text-xs text-gray-600">
                    {format(day, 'dd/MM')}
                  </p>
                </div>
              ))}
            </div>

            {/* Time blocks grid */}
            {timeBlocks.map((timeBlock) => (
              <div key={timeBlock.hour} className="grid grid-cols-8 gap-2 min-w-[720px]">
                <div className="flex items-center justify-center py-3 sm:py-4 bg-gray-50 rounded-lg border">
                  <span className="text-xs sm:text-sm font-medium text-gray-700">
                    {timeBlock.label}
                  </span>
                </div>
                
                {getWeekDays().map((day) => {
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const isAvailable = isBlockAvailable(dateStr, timeBlock.hour);
                  const isBooked = isBlockBooked(dateStr, timeBlock.hour);
                  
                  return (
                    <button
                      key={`${dateStr}-${timeBlock.hour}`}
                      onClick={() => { if (!isBooked) toggleBlockAvailability(dateStr, timeBlock.hour); }}
                      disabled={isBooked}
                      className={`
                        py-3 sm:py-4 px-2 sm:px-3 rounded-lg border-2 transition-all duration-200 
                        flex items-center justify-center font-medium text-xs sm:text-sm
                        ${isBooked
                          ? 'bg-green-600 border-green-700 text-white cursor-default'
                          : isAvailable 
                            ? 'bg-green-100 border-green-400 text-green-800 hover:bg-green-200 shadow-sm' 
                            : 'bg-gray-50 border-gray-300 text-gray-500 hover:bg-gray-100'
                        }
                      `}
                    >
                      <span className="text-[11px] sm:text-xs">
                        {timeBlock.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend and Instructions */}
      <div className="mt-6 bg-gray-50 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-6 text-sm">
            <div className="flex items-center">
              <div className="w-4 h-4 bg-green-100 border-2 border-green-400 rounded mr-2"></div>
              <span className="text-gray-700">Disponible</span>
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 bg-green-600 border-2 border-green-700 rounded mr-2"></div>
              <span className="text-gray-700">Reservado</span>
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 bg-gray-50 border-2 border-gray-300 rounded mr-2"></div>
              <span className="text-gray-700">No disponible</span>
            </div>
          </div>
          
          <div className="text-sm text-gray-600">
            <p>Haz clic en cada bloque para cambiar tu disponibilidad</p>
            <p>Horario: 8:00 AM - 8:00 PM (bloques de 1 hora)</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AvailabilityManager;