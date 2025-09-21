import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Calendar, Clock, Plus, Trash2, Save } from 'lucide-react';
import { format, addDays, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface TimeSlot {
  id?: string;
  date: string;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

const AvailabilityManager = () => {
  const { user } = useAuth();
  const [selectedWeek, setSelectedWeek] = useState(new Date());
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchAvailability();
  }, [selectedWeek, user]);

  const fetchAvailability = async () => {
    if (!user) return;

    try {
      const weekStart = startOfWeek(selectedWeek, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });

      const { data, error } = await supabase
        .from('availability')
        .select('*')
        .eq('gardener_id', user.id)
        .gte('date', format(weekStart, 'yyyy-MM-dd'))
        .lte('date', format(weekEnd, 'yyyy-MM-dd'))
        .order('date')
        .order('start_time');

      if (error) throw error;
      setTimeSlots(data || []);
    } catch (error) {
      console.error('Error fetching availability:', error);
    }
  };

  const addTimeSlot = (date: string) => {
    const newSlot: TimeSlot = {
      date,
      start_time: '09:00',
      end_time: '17:00',
      is_available: true
    };
    setTimeSlots([...timeSlots, newSlot]);
  };

  const updateTimeSlot = (index: number, field: keyof TimeSlot, value: string | boolean) => {
    const updatedSlots = [...timeSlots];
    updatedSlots[index] = { ...updatedSlots[index], [field]: value };
    setTimeSlots(updatedSlots);
  };

  const removeTimeSlot = (index: number) => {
    const updatedSlots = timeSlots.filter((_, i) => i !== index);
    setTimeSlots(updatedSlots);
  };

  const saveAvailability = async () => {
    if (!user) return;

    setLoading(true);
    try {
      // Delete existing availability for the week
      const weekStart = startOfWeek(selectedWeek, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });

      await supabase
        .from('availability')
        .delete()
        .eq('gardener_id', user.id)
        .gte('date', format(weekStart, 'yyyy-MM-dd'))
        .lte('date', format(weekEnd, 'yyyy-MM-dd'));

      // Insert new availability
      const slotsToInsert = timeSlots.map(slot => ({
        gardener_id: user.id,
        date: slot.date,
        start_time: slot.start_time,
        end_time: slot.end_time,
        is_available: slot.is_available
      }));

      if (slotsToInsert.length > 0) {
        const { error } = await supabase
          .from('availability')
          .insert(slotsToInsert);

        if (error) throw error;
      }

      toast.success('Disponibilidad guardada correctamente');
    } catch (error: any) {
      toast.error(error.message || 'Error al guardar la disponibilidad');
    } finally {
      setLoading(false);
    }
  };

  const getWeekDays = () => {
    const weekStart = startOfWeek(selectedWeek, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: weekStart, end: weekEnd });
  };

  const getSlotsForDate = (date: string) => {
    return timeSlots.filter(slot => slot.date === date);
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    const newWeek = addDays(selectedWeek, direction === 'next' ? 7 : -7);
    setSelectedWeek(newWeek);
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center">
          <Calendar className="w-6 h-6 mr-3" />
          Gestión de Disponibilidad
        </h2>
        <button
          onClick={saveAvailability}
          disabled={loading}
          className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
        >
          <Save className="w-4 h-4 mr-2" />
          {loading ? 'Guardando...' : 'Guardar'}
        </button>
      </div>

      {/* Week Navigation */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigateWeek('prev')}
          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          ← Semana anterior
        </button>
        <h3 className="text-lg font-semibold text-gray-900">
          {format(startOfWeek(selectedWeek, { weekStartsOn: 1 }), 'd MMM', { locale: es })} - {' '}
          {format(endOfWeek(selectedWeek, { weekStartsOn: 1 }), 'd MMM yyyy', { locale: es })}
        </h3>
        <button
          onClick={() => navigateWeek('next')}
          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Semana siguiente →
        </button>
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-7 gap-4">
        {getWeekDays().map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const daySlots = getSlotsForDate(dateStr);
          
          return (
            <div key={dateStr} className="border border-gray-200 rounded-lg p-4">
              <div className="text-center mb-4">
                <h4 className="font-semibold text-gray-900">
                  {format(day, 'EEEE', { locale: es })}
                </h4>
                <p className="text-sm text-gray-600">
                  {format(day, 'd MMM', { locale: es })}
                </p>
              </div>

              <div className="space-y-3">
                {daySlots.map((slot, index) => {
                  const globalIndex = timeSlots.findIndex(s => 
                    s.date === slot.date && 
                    s.start_time === slot.start_time && 
                    s.end_time === slot.end_time
                  );
                  
                  return (
                    <div key={index} className="bg-gray-50 p-3 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <Clock className="w-4 h-4 text-gray-500" />
                        <button
                          onClick={() => removeTimeSlot(globalIndex)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <div className="space-y-2">
                        <input
                          type="time"
                          value={slot.start_time}
                          onChange={(e) => updateTimeSlot(globalIndex, 'start_time', e.target.value)}
                          className="w-full text-sm border border-gray-300 rounded px-2 py-1"
                        />
                        <input
                          type="time"
                          value={slot.end_time}
                          onChange={(e) => updateTimeSlot(globalIndex, 'end_time', e.target.value)}
                          className="w-full text-sm border border-gray-300 rounded px-2 py-1"
                        />
                        <label className="flex items-center text-sm">
                          <input
                            type="checkbox"
                            checked={slot.is_available}
                            onChange={(e) => updateTimeSlot(globalIndex, 'is_available', e.target.checked)}
                            className="mr-2"
                          />
                          Disponible
                        </label>
                      </div>
                    </div>
                  );
                })}
                
                <button
                  onClick={() => addTimeSlot(dateStr)}
                  className="w-full flex items-center justify-center py-2 border-2 border-dashed border-gray-300 rounded-lg hover:border-green-400 hover:bg-green-50 transition-colors text-gray-600 hover:text-green-600"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Añadir horario
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AvailabilityManager;