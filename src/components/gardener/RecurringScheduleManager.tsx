import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Plus, Trash2, Save, Clock, Calendar, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

interface RecurringScheduleGroup {
  id: string; // client-side only ID for key
  days: number[]; // Array of day indices (0-6)
  start_time: string;
  end_time: string;
}

interface RecurringSettings {
  weeks_to_maintain: number;
  last_generated_date?: string;
}

// Order: Monday (1) to Sunday (0)
const DAYS_OF_WEEK = [
  { label: 'L', value: 1, full: 'Lunes' },
  { label: 'M', value: 2, full: 'Martes' },
  { label: 'X', value: 3, full: 'Miércoles' },
  { label: 'J', value: 4, full: 'Jueves' },
  { label: 'V', value: 5, full: 'Viernes' },
  { label: 'S', value: 6, full: 'Sábado' },
  { label: 'D', value: 0, full: 'Domingo' },
];

// Generate hours for dropdown (08:00 to 20:00)
const HOURS = Array.from({ length: 13 }, (_, i) => {
  const hour = (i + 8).toString().padStart(2, '0');
  return `${hour}:00`;
});

const TimeSelect = ({ value, onChange, label }: { value: string, onChange: (val: string) => void, label: string }) => (
  <div className="flex flex-col">
    <label className="text-[10px] text-gray-400 font-medium uppercase tracking-wider mb-1">{label}</label>
    <div className="relative">
      <select
        value={value?.substring(0, 5) || '09:00'}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-gray-50 border border-gray-200 text-gray-700 text-sm font-semibold rounded-lg focus:ring-green-500 focus:border-green-500 block w-full p-2.5 pr-8"
      >
        {HOURS.map((time) => (
          <option key={time} value={time}>
            {time}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
        <Clock className="w-4 h-4" />
      </div>
    </div>
  </div>
);

export default function RecurringScheduleManager() {
  const { user } = useAuth();
  const [scheduleGroups, setScheduleGroups] = useState<RecurringScheduleGroup[]>([]);
  const [settings, setSettings] = useState<RecurringSettings>({ weeks_to_maintain: 2 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch schedules
      const { data: schedData, error: schedError } = await supabase
        .from('recurring_schedules')
        .select('*')
        .eq('gardener_id', user?.id);

      if (schedError) throw schedError;

      // Group by start_time + end_time
      const groups: RecurringScheduleGroup[] = [];
      if (schedData) {
        // Map "time-key" -> days array
        const timeMap = new Map<string, number[]>();
        
        schedData.forEach((row: any) => {
          // Normalize times (e.g. 09:00:00 -> 09:00)
          const start = row.start_time.substring(0, 5);
          const end = row.end_time.substring(0, 5);
          const key = `${start}-${end}`;
          
          if (!timeMap.has(key)) {
            timeMap.set(key, []);
          }
          timeMap.get(key)?.push(row.day_of_week);
        });

        // Convert map to array
        timeMap.forEach((days, key) => {
          const [start, end] = key.split('-');
          groups.push({
            id: Math.random().toString(36).substring(2, 11),
            days: days.sort((a, b) => a - b),
            start_time: start,
            end_time: end
          });
        });
      }

      // Fetch settings
      const { data: settData, error: settError } = await supabase
        .from('recurring_availability_settings')
        .select('*')
        .eq('gardener_id', user?.id)
        .single();

      if (settError && settError.code !== 'PGRST116') throw settError;

      setScheduleGroups(groups);
      if (settData) {
        setSettings({ 
          weeks_to_maintain: settData.weeks_to_maintain,
          last_generated_date: settData.last_generated_date 
        });
      }
    } catch (error) {
      console.error('Error fetching recurring data:', error);
    } finally {
      setLoading(false);
    }
  };

  const addGroup = () => {
    if (scheduleGroups.length > 0) return; // Prevent more than 1 group
    setScheduleGroups([
      ...scheduleGroups,
      { 
        id: Math.random().toString(36).substring(2, 11),
        days: [1, 2, 3, 4, 5], // Mon-Fri default
        start_time: '09:00', 
        end_time: '17:00' 
      }
    ]);
  };

  const removeGroup = (index: number) => {
    const newGroups = [...scheduleGroups];
    newGroups.splice(index, 1);
    setScheduleGroups(newGroups);
  };

  const updateGroup = (index: number, field: keyof RecurringScheduleGroup, value: any) => {
    const newGroups = [...scheduleGroups];
    newGroups[index] = { ...newGroups[index], [field]: value };
    setScheduleGroups(newGroups);
  };

  const toggleDay = (groupIndex: number, dayValue: number) => {
    const group = scheduleGroups[groupIndex];
    const newDays = group.days.includes(dayValue)
      ? group.days.filter(d => d !== dayValue)
      : [...group.days, dayValue].sort((a, b) => a - b);
    
    updateGroup(groupIndex, 'days', newDays);
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    try {
      // 1. Save Settings
      const { error: settError } = await supabase
        .from('recurring_availability_settings')
        .upsert({
          gardener_id: user.id,
          weeks_to_maintain: settings.weeks_to_maintain,
          updated_at: new Date().toISOString()
        });

      if (settError) throw settError;

      // 2. Save Schedules
      // First delete all existing
      const { error: delError } = await supabase
        .from('recurring_schedules')
        .delete()
        .eq('gardener_id', user.id);

      if (delError) throw delError;

      // Flatten groups to individual rows
      const flatSchedules = [];
      for (const group of scheduleGroups) {
        for (const day of group.days) {
          flatSchedules.push({
            gardener_id: user.id,
            day_of_week: day,
            start_time: group.start_time,
            end_time: group.end_time
          });
        }
      }

      // Insert new rows
      if (flatSchedules.length > 0) {
        const { error: insError } = await supabase
          .from('recurring_schedules')
          .insert(flatSchedules);

        if (insError) throw insError;
      }

      // 3. Trigger Generation via RPC (Force Regenerate = true)
      const { error: rpcError } = await supabase.rpc('generate_recurring_slots', {
        target_gardener_id: user.id,
        force_regenerate: true
      });

      if (rpcError) throw rpcError;

      toast.success('Horario guardado y aplicado correctamente.');
      
      fetchData();
    } catch (error: any) {
      console.error('Error saving recurring schedule:', error);
      toast.error('Error al guardar: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-4">Cargando configuración...</div>;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-6">
      <div className="flex items-center justify-between border-b border-gray-100 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-green-600" />
            Horario Fijo Recurrente
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Configura tu disponibilidad semanal habitual y deja que el sistema la mantenga por ti.
          </p>
        </div>
        {scheduleGroups.length === 0 && (
          <button
            onClick={addGroup}
            className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Crear Horario
          </button>
        )}
      </div>

      <div className="space-y-4">
        {scheduleGroups.length === 0 ? (
          <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
            No tienes un horario fijo configurado. Pulsa en "Crear Horario" para empezar.
          </div>
        ) : (
          scheduleGroups.map((group, index) => (
            <div key={group.id} className="flex flex-col gap-4 p-5 bg-gray-50 rounded-lg border border-gray-200 hover:border-green-200 transition-colors">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-500 mb-2">Días de la semana</label>
                  <div className="flex flex-wrap gap-2">
                    {DAYS_OF_WEEK.map((day) => {
                      const isSelected = group.days.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          onClick={() => toggleDay(index, day.value)}
                          className={`
                            w-8 h-8 rounded-full text-xs font-medium flex items-center justify-center transition-all
                            ${isSelected 
                              ? 'bg-green-600 text-white shadow-sm ring-2 ring-green-600 ring-offset-1' 
                              : 'bg-white text-gray-600 border border-gray-300 hover:border-green-400'}
                          `}
                          title={day.full}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-3 bg-white p-2 rounded-lg border border-gray-200">
                  <TimeSelect 
                    label="Desde" 
                    value={group.start_time} 
                    onChange={(val) => updateGroup(index, 'start_time', val)} 
                  />
                  <div className="h-8 w-px bg-gray-200 self-center"></div>
                  <TimeSelect 
                    label="Hasta" 
                    value={group.end_time} 
                    onChange={(val) => updateGroup(index, 'end_time', val)} 
                  />
                </div>

                <button
                  onClick={() => removeGroup(index)}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors self-end sm:self-center"
                  title="Eliminar horario"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>

            </div>
          ))
        )}
      </div>

      <div className="border-t border-gray-100 pt-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          Configuración de Automatización
        </h3>
        
        <div className="flex flex-col md:flex-row md:items-end gap-6">
          <div className="flex-1">
            <label className="block text-sm text-gray-600 mb-2">
              Mantener disponibilidad visible por:
            </label>
            <div className="flex gap-4">
              {[1, 2, 3].map((weeks) => (
                <label key={weeks} className={`
                  flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border cursor-pointer transition-all
                  ${settings.weeks_to_maintain === weeks 
                    ? 'bg-green-50 border-green-500 text-green-700 font-medium ring-1 ring-green-500' 
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}
                `}>
                  <input
                    type="radio"
                    name="weeks"
                    value={weeks}
                    checked={settings.weeks_to_maintain === weeks}
                    onChange={() => setSettings({ ...settings, weeks_to_maintain: weeks })}
                    className="hidden"
                  />
                  {weeks} {weeks === 1 ? 'Semana' : 'Semanas'}
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              El sistema añadirá automáticamente un nuevo día al final de este periodo cada día.
            </p>
          </div>

          <div className="flex flex-col gap-3">
             <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2 justify-center shadow-sm"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Guardando...' : 'Guardar Configuración'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
