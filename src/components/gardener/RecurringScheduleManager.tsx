import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Save, Clock, Calendar, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import toast from 'react-hot-toast';

// Tipos
interface RecurringSettings {
  weeks_to_maintain: number;
  min_notice_hours: number;
  last_generated_date?: string;
}

// Constantes
const DAYS_OF_WEEK = [
  { label: 'L', value: 1, full: 'Lunes' },
  { label: 'M', value: 2, full: 'Martes' },
  { label: 'X', value: 3, full: 'Miércoles' },
  { label: 'J', value: 4, full: 'Jueves' },
  { label: 'V', value: 5, full: 'Viernes' },
  { label: 'S', value: 6, full: 'Sábado' },
  { label: 'D', value: 0, full: 'Domingo' },
];

// Horas del día (8:00 a 20:00)
const WORK_HOURS = Array.from({ length: 12 }, (_, i) => i + 8); // [8, 9, ..., 19]

export default function RecurringScheduleManager({ onChangePending, registerSaveHandler }: { onChangePending?: (pending: boolean) => void; registerSaveHandler?: (fn: () => Promise<boolean>) => void; }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Estado del Paso 1: Generador
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]); // L-V por defecto
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(17);

  // Estado del Paso 2: Matriz de horario (Source of Truth)
  // Mapa: día (0-6) -> Set de horas activas (8-19)
  const [scheduleMatrix, setScheduleMatrix] = useState<Record<number, Set<number>>>({});

  // Estado de Configuración
  const [settings, setSettings] = useState<RecurringSettings>({
    weeks_to_maintain: 4, // "1 mes" por defecto aprox
    min_notice_hours: 24,
  });

  const markDirty = () => {
    if (!dirty) {
      setDirty(true);
      onChangePending?.(true);
    }
  };

  // Cargar datos iniciales
  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  // Bloquear scroll cuando el modal está activo
  useEffect(() => {
    if (showConfirmation) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [showConfirmation]);

  // Efecto para aplicar cambios del Paso 1 al Paso 2 (Generador -> Matriz)
  const applyGeneratorToMatrix = (days: number[], start: number, end: number) => {
    const newMatrix: Record<number, Set<number>> = {};
    
    // Inicializar todos los días vacíos
    DAYS_OF_WEEK.forEach(d => newMatrix[d.value] = new Set());

    // Rellenar días seleccionados con el rango
    days.forEach(day => {
      const hours = new Set<number>();
      for (let h = start; h < end; h++) {
        hours.add(h);
      }
      newMatrix[day] = hours;
    });

    setScheduleMatrix(newMatrix);
    markDirty();
  };

  const handleGeneratorChange = (
    newDays: number[], 
    newStart: number, 
    newEnd: number
  ) => {
    setSelectedDays(newDays);
    setStartHour(newStart);
    setEndHour(newEnd);
    applyGeneratorToMatrix(newDays, newStart, newEnd);
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // 1. Cargar horarios recurrentes existentes
      const { data: schedData, error: schedError } = await supabase
        .from('recurring_schedules')
        .select('*')
        .eq('gardener_id', user?.id);

      if (schedError) throw schedError;

      // 2. Cargar configuración
      const { data: settData, error: settError } = await supabase
        .from('recurring_availability_settings')
        .select('*')
        .eq('gardener_id', user?.id)
        .single();

      if (settError && settError.code !== 'PGRST116') throw settError;

      // 3. Reconstruir la matriz desde los datos
      const matrix: Record<number, Set<number>> = {};
      DAYS_OF_WEEK.forEach(d => matrix[d.value] = new Set());

      if (schedData) {
        schedData.forEach((row: any) => {
          const start = parseInt(row.start_time.substring(0, 2));
          const end = parseInt(row.end_time.substring(0, 2));
          const day = row.day_of_week;
          
          if (!matrix[day]) matrix[day] = new Set();
          
          for (let h = start; h < end; h++) {
            matrix[day].add(h);
          }
        });
      }
      setScheduleMatrix(matrix);

      // 4. Establecer configuración
      if (settData) {
        setSettings({
          weeks_to_maintain: settData.weeks_to_maintain || 4,
          min_notice_hours: settData.min_notice_hours || 24,
          last_generated_date: settData.last_generated_date
        });
      }

    } catch (error) {
      console.error('Error fetching recurring data:', error);
      toast.error('Error al cargar horario fijo');
    } finally {
      setLoading(false);
    }
  };

  const toggleMatrixCell = (day: number, hour: number) => {
    const newMatrix = { ...scheduleMatrix };
    if (!newMatrix[day]) newMatrix[day] = new Set();

    const newDaySet = new Set(newMatrix[day]);
    if (newDaySet.has(hour)) {
      newDaySet.delete(hour);
    } else {
      newDaySet.add(hour);
    }
    
    newMatrix[day] = newDaySet;
    setScheduleMatrix(newMatrix);
    markDirty();
  };

  const commitSave = useCallback(async (): Promise<boolean> => {
    setSaving(true);

    try {
      if (!user?.id) return false;

      // 1. Guardar Configuración
      const { error: settError } = await supabase
        .from('recurring_availability_settings')
        .upsert({
          gardener_id: user.id,
          weeks_to_maintain: settings.weeks_to_maintain,
          min_notice_hours: settings.min_notice_hours,
          updated_at: new Date().toISOString()
        });

      if (settError) throw settError;

      // 2. Eliminar horarios recurrentes anteriores
      const { error: delError } = await supabase
        .from('recurring_schedules')
        .delete()
        .eq('gardener_id', user.id);

      if (delError) throw delError;

      // 3. Generar nuevas filas para recurring_schedules
      // Agrupamos horas contiguas para minimizar filas
      const newRows = [];
      
      for (const dayObj of DAYS_OF_WEEK) {
        const day = dayObj.value;
        const hours = Array.from(scheduleMatrix[day] || []).sort((a, b) => a - b);
        
        if (hours.length === 0) continue;

        let rangeStart = hours[0];
        let prevHour = hours[0];

        for (let i = 1; i < hours.length; i++) {
          const currentHour = hours[i];
          if (currentHour !== prevHour + 1) {
            // Fin de bloque
            newRows.push({
              gardener_id: user.id,
              day_of_week: day,
              start_time: `${rangeStart.toString().padStart(2, '0')}:00:00`,
              end_time: `${(prevHour + 1).toString().padStart(2, '0')}:00:00`
            });
            rangeStart = currentHour;
          }
          prevHour = currentHour;
        }
        // Último bloque
        newRows.push({
          gardener_id: user.id,
          day_of_week: day,
          start_time: `${rangeStart.toString().padStart(2, '0')}:00:00`,
          end_time: `${(prevHour + 1).toString().padStart(2, '0')}:00:00`
        });
      }

      if (newRows.length > 0) {
        const { error: insError } = await supabase
          .from('recurring_schedules')
          .insert(newRows);
        
        if (insError) throw insError;
      }

      // 4. Regenerar disponibilidad futura
      const { error: rpcError } = await supabase.rpc('generate_recurring_slots', {
        target_gardener_id: user.id,
        force_regenerate: true 
      });

      if (rpcError) throw rpcError;

      toast.success('Horario fijo guardado y aplicado correctamente');
      setDirty(false);
      onChangePending?.(false);
      return true;
      
    } catch (error: any) {
      console.error('Error saving:', error);
      toast.error('Error al guardar: ' + error.message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [settings, scheduleMatrix, user?.id]);
  
  useEffect(() => {
    registerSaveHandler?.(commitSave);
  }, [commitSave]);
  
  const handleSave = async () => {
    setShowConfirmation(false);
    await commitSave();
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      
      {/* SECCIÓN 1: CREA TU HORARIO FIJO */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-green-600" />
          Crea tu horario fijo
        </h2>
        
        <div className="grid gap-6 md:grid-cols-2">
          {/* Selector de Días */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-700 block">
              Días de trabajo
            </label>
            <div className="flex flex-wrap gap-2">
              {DAYS_OF_WEEK.map((day) => {
                const isSelected = selectedDays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    onClick={() => {
                      const newDays = isSelected 
                        ? selectedDays.filter(d => d !== day.value)
                        : [...selectedDays, day.value];
                      handleGeneratorChange(newDays, startHour, endHour);
                    }}
                    className={`
                      w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all
                      ${isSelected 
                        ? 'bg-green-600 text-white shadow-md shadow-green-200 scale-105' 
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
                    `}
                    title={day.full}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selector de Horas */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-700 block">
              Horario base
            </label>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <span className="text-xs text-gray-500 mb-1 block">Desde</span>
                <select
                  value={startHour}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    handleGeneratorChange(selectedDays, val, Math.max(val + 1, endHour));
                  }}
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-green-500 focus:border-green-500"
                >
                  {WORK_HOURS.slice(0, -1).map(h => (
                    <option key={h} value={h}>{h}:00</option>
                  ))}
                </select>
              </div>
              <span className="text-gray-400 mt-5">-</span>
              <div className="flex-1">
                <span className="text-xs text-gray-500 mb-1 block">Hasta</span>
                <select
                  value={endHour}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    handleGeneratorChange(selectedDays, Math.min(startHour, val - 1), val);
                  }}
                  className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-green-500 focus:border-green-500"
                >
                  {WORK_HOURS.map(h => (
                    <option key={h} value={h} disabled={h <= startHour}>{h}:00</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECCIÓN 2: PERFECCIONA TU HORARIO (CALENDARIO) */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-green-600" />
            Perfecciona tu horario
          </h2>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
            Toca las casillas para añadir/quitar horas
          </span>
        </div>
        
        <p className="text-sm text-gray-600 mb-6">
          Añade pausas o ajusta horas sueltas. Lo que veas aquí será tu horario fijo real.
        </p>

        {/* Grid Calendario Semanal Fijo (Estilo unificado con AvailabilityManager) */}
        <div className="bg-transparent shadow-none border-0 p-0 sm:bg-white sm:rounded-xl sm:shadow-sm sm:border sm:border-gray-200 sm:p-6 overflow-hidden space-y-4 w-full">
            {/* Desktop/Tablet: vista semanal en rejilla */}
            <div className="hidden md:block md:overflow-x-auto">
              {/* Header de días */}
              <div className="grid md:grid-cols-7 gap-2 mb-4 md:min-w-[720px]">
                {DAYS_OF_WEEK.map((day) => (
                  <div key={day.value} className="text-center py-3 bg-gray-50 rounded-lg">
                    <p className="text-xs sm:text-sm font-medium text-gray-900">
                      {day.full}
                    </p>
                  </div>
                ))}
              </div>

              {/* Bloques por hora x día */}
              {WORK_HOURS.map((hour) => (
                <div key={hour} className="grid md:grid-cols-7 gap-2 md:min-w-[720px]">
                  {DAYS_OF_WEEK.map((day) => {
                    const isActive = scheduleMatrix[day.value]?.has(hour);
                    
                    return (
                      <button
                        key={`${day.value}-${hour}`}
                        onClick={() => toggleMatrixCell(day.value, hour)}
                        className={`
                          py-3 sm:py-4 px-2 sm:px-3 rounded-lg border-2 transition-all duration-200 
                          flex items-center justify-center font-medium text-xs sm:text-sm
                          ${isActive 
                            ? 'bg-green-100 border-green-400 text-green-800 hover:bg-green-200 shadow-sm' 
                            : 'bg-gray-50 border-gray-300 text-gray-500 hover:bg-gray-100'
                          }
                        `}
                      >
                        <span className="text-[11px] sm:text-xs">
                          {hour.toString().padStart(2, '0')}:00
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Móvil: vista de calendario semanal compacta */}
            <div className="md:hidden">
              <div className="grid grid-cols-7 gap-1">
                {/* Header de días */}
                {DAYS_OF_WEEK.map((day) => (
                    <div key={`header-${day.value}`} className="text-center py-2 bg-gray-50 rounded-md">
                      <p className="text-sm font-bold text-gray-900 uppercase leading-tight">
                        {day.label}
                      </p>
                    </div>
                ))}

                {/* Grid de horas (filas) */}
                {WORK_HOURS.map((hour) => (
                  <React.Fragment key={`row-${hour}`}>
                    {DAYS_OF_WEEK.map((day) => {
                      const isActive = scheduleMatrix[day.value]?.has(hour);
                      
                      return (
                        <button
                          key={`mob-${day.value}-${hour}`}
                          onClick={() => toggleMatrixCell(day.value, hour)}
                          className={`
                            h-9 rounded-md border-2 transition-all duration-200 
                            flex items-center justify-center font-bold text-xs
                            ${isActive 
                              ? 'bg-green-100 border-green-400 text-green-900 hover:bg-green-200' 
                              : 'bg-gray-50 border-gray-300 text-gray-900 hover:bg-gray-100'
                            }
                          `}
                        >
                          {hour.toString().padStart(2, '0')}
                        </button>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
        </div>
      </section>

      {/* SECCIÓN 3: CONFIGURACIÓN ADELANTO/ANTELACIÓN */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
          <Info className="w-5 h-5 text-green-600" />
          Reglas de disponibilidad
        </h2>

        <div className="grid gap-8 md:grid-cols-2">
          {/* Adelanto (Weeks to maintain) */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-900">
              ¿Con cuánta antelación quieres mostrar tu agenda?
            </label>
            <p className="text-xs text-gray-500">
              Tu calendario estará siempre abierto por este tiempo.
            </p>
            <select
              value={settings.weeks_to_maintain}
              onChange={(e) => {
                setSettings({ ...settings, weeks_to_maintain: parseInt(e.target.value) });
                markDirty();
              }}
              className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-green-500 focus:border-green-500 shadow-sm"
            >
              <option value={2}>2 semanas</option>
              <option value={4}>1 mes (Recomendado)</option>
              <option value={8}>2 meses</option>
              <option value={12}>3 meses</option>
            </select>
          </div>

          {/* Antelación mínima (Min notice hours) */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-900">
              Antelación mínima para recibir reservas
            </label>
            <p className="text-xs text-gray-500">
              Los clientes no podrán reservar antes de este tiempo.
            </p>
            <select
              value={settings.min_notice_hours}
              onChange={(e) => {
                setSettings({ ...settings, min_notice_hours: parseInt(e.target.value) });
                markDirty();
              }}
              className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-green-500 focus:border-green-500 shadow-sm"
            >
              <option value={0}>Sin restricción (Inmediato)</option>
              <option value={24}>24 horas antes</option>
              <option value={48}>48 horas antes</option>
              <option value={72}>3 días antes</option>
              <option value={168}>1 semana antes</option>
            </select>
          </div>
        </div>
      </section>

      {/* SECCIÓN 4: GUARDADO */}
      <div className="pt-4 pb-8">
        <button
          onClick={() => setShowConfirmation(true)}
          disabled={saving}
          className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white py-4 px-6 text-lg rounded-xl font-bold shadow-lg shadow-green-600/20 transform transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-3"
        >
          <Save className="w-6 h-6" />
          Guardar horario fijo
        </button>
      </div>

      {/* Modal de Confirmación */}
      {showConfirmation && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 animate-in fade-in zoom-in duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mb-6 shrink-0">
                <AlertTriangle className="w-8 h-8 text-yellow-600" />
              </div>
              
              <h3 className="text-xl font-bold text-gray-900 mb-4 text-center">
                ¿Confirmar nuevo horario fijo?
              </h3>
              
              <div className="bg-yellow-50 rounded-xl p-4 mb-6 w-full">
                <ul className="space-y-3 text-sm text-gray-700">
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                    <span>Este horario se guardará y <strong>se renovará automáticamente</strong> cada día.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                    <span>Toda la disponibilidad futura se <strong>sobrescribirá</strong> con este nuevo horario.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                    <span>Los ajustes manuales o excepciones que hayas hecho en el calendario semanal <strong>se perderán</strong> y deberás rehacerlos si es necesario.</span>
                  </li>
                </ul>
              </div>

              <div className="flex flex-col gap-3 w-full">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-3.5 px-6 rounded-xl font-bold shadow-lg shadow-green-600/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    'Sí, aplicar cambios'
                  )}
                </button>
                
                <button
                  onClick={() => setShowConfirmation(false)}
                  disabled={saving}
                  className="w-full bg-white border border-gray-200 text-gray-700 py-3.5 px-6 rounded-xl font-bold hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
