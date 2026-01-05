import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Calendar, Save, ChevronLeft, ChevronRight, ArrowLeft, RefreshCw, AlertTriangle } from 'lucide-react';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, subWeeks, addWeeks, isBefore, startOfToday } from 'date-fns';
import { es } from 'date-fns/locale';
import { 
  generateDailyTimeBlocks, 
  getGardenerAvailability, 
  setGardenerAvailability 
} from '../../utils/availabilityService';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import RecurringScheduleManager from './RecurringScheduleManager';

interface AvailabilityManagerProps {
  onBack?: () => void;
}

const AvailabilityManager: React.FC<AvailabilityManagerProps> = ({ onBack }) => {
  const { user, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<'weekly' | 'recurring'>('weekly');
  const [selectedWeek, setSelectedWeek] = useState(new Date());
  const [weeklyAvailability, setWeeklyAvailability] = useState<{ [date: string]: { [hour: number]: boolean } }>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bookedBlocks, setBookedBlocks] = useState<{ [date: string]: Set<number> }>({});
  const [hasRecurringSchedule, setHasRecurringSchedule] = useState(false);
  
  // Nuevo estado para controlar cambios sin guardar
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingNav, setPendingNav] = useState<{ type: 'switch'; target: 'weekly' | 'recurring' } | { type: 'leave' } | null>(null);
  const [recurringSaveHandler, setRecurringSaveHandler] = useState<(() => Promise<boolean>) | null>(null);
  const [recurringMountKey, setRecurringMountKey] = useState(0);

  // Generar bloques de tiempo de 1 hora (8:00 AM a 8:00 PM)
  const timeBlocks = generateDailyTimeBlocks();

  const checkRecurringSchedule = useCallback(async () => {
    if (!user?.id) return;
    const { count, error } = await supabase
      .from('recurring_schedules')
      .select('*', { count: 'exact', head: true })
      .eq('gardener_id', user.id);
    
    if (!error) {
      setHasRecurringSchedule(count !== null && count > 0);
    }
  }, [user?.id]);

  // Lazy maintenance: Ensure future slots exist based on recurring rules
  useEffect(() => {
    if (user?.id) {
      checkRecurringSchedule();

      supabase.rpc('generate_recurring_slots', {
        target_gardener_id: user.id,
        force_regenerate: false
      }).then(({ error }: { error: any }) => {
        if (error) {
          console.error('Error in lazy schedule maintenance:', error);
        }
      });
    }
  }, [user?.id, checkRecurringSchedule]);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.id) return;
    if (activeTab === 'weekly') {
      fetchWeeklyAvailability();
      checkRecurringSchedule();
    }
  }, [selectedWeek, user?.id, authLoading, activeTab, checkRecurringSchedule]);

  useEffect(() => {
    if (showConfirmModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [showConfirmModal]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  const fetchWeeklyAvailability = async () => {
    if (!user?.id) {
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
      setHasUnsavedChanges(false); // Reset changes flag on load

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
    setHasUnsavedChanges(true); // Marcar que hay cambios sin guardar
  };

  const saveWeeklyAvailability = async (): Promise<boolean> => {
    if (!user) {
      console.error('No user found when trying to save availability');
      return false;
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
      setHasUnsavedChanges(false); // Reset changes flag on success
      return true;
    } catch (error: any) {
      console.error('Error saving availability:', error);
      toast.error('Error al guardar la disponibilidad');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    if (hasUnsavedChanges) {
      // Opcional: Podríamos advertir aquí también, pero por ahora solo al salir de la página
      // toast('Tienes cambios sin guardar en esta semana', { icon: '⚠️' });
    }
    setSelectedWeek(prev => direction === 'prev' ? subWeeks(prev, 1) : addWeeks(prev, 1));
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

  // Manejadores para la confirmación de salida
  const handleBack = () => {
    if (hasUnsavedChanges) {
      setPendingNav({ type: 'leave' });
      setShowConfirmModal(true);
    } else {
      onBack?.();
    }
  };

  const handleConfirmDiscard = () => {
    setShowConfirmModal(false);
    if (!pendingNav) return;
    if (pendingNav.type === 'switch') {
      if (pendingNav.target === 'weekly') {
        setActiveTab('weekly');
        fetchWeeklyAvailability();
      } else {
        setActiveTab('recurring');
        setRecurringMountKey(k => k + 1);
      }
      setHasUnsavedChanges(false);
      setPendingNav(null);
    } else {
      setHasUnsavedChanges(false);
      setPendingNav(null);
      onBack?.();
    }
  };

  const handleConfirmSave = async () => {
    let success = true;
    if (activeTab === 'weekly') {
      success = await saveWeeklyAvailability();
    } else {
      success = (await recurringSaveHandler?.()) ?? false;
    }
    if (!success) return;
    setHasUnsavedChanges(false);
    setShowConfirmModal(false);
    if (!pendingNav) return;
    if (pendingNav.type === 'switch') {
      setActiveTab(pendingNav.target);
      setPendingNav(null);
    } else {
      setPendingNav(null);
      onBack?.();
    }
  };

  return (
    <div className="max-w-full sm:max-w-3xl md:max-w-4xl mx-auto px-2.5 py-4 sm:p-6 lg:px-6 relative">
        {/* 1. Botón Volver (Parte superior) */}
        {onBack && (
          <div className="mb-4">
            <button
              onClick={handleBack}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg shadow-sm transition-colors"
              aria-label="Volver al Panel"
            >
              <ArrowLeft className="w-4 h-4" />
              Volver
            </button>
          </div>
        )}

        {/* 2. Título de la página (Justo debajo de volver) */}
        <div className="flex items-center mb-6">
            <Calendar className="w-6 h-6 text-green-600 mr-3" />
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">Gestión de Disponibilidad</h2>
        </div>

        {/* 3. Selector de subpáginas (Tabs) */}
        <div className="flex space-x-1 bg-white border border-gray-200 p-1 rounded-lg mb-6 w-full max-w-md mx-auto md:mx-0 shadow-sm">
          <button
            onClick={() => {
              if (hasUnsavedChanges && activeTab !== 'weekly') {
                setPendingNav({ type: 'switch', target: 'weekly' });
                setShowConfirmModal(true);
              } else {
                setActiveTab('weekly');
              }
            }}
            className={`flex-1 flex items-center justify-center py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'weekly' 
                ? 'bg-gray-100 text-gray-900 shadow-sm' 
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <Calendar className="w-4 h-4 mr-2" />
            Calendario Semanal
          </button>
          <button
            onClick={() => {
              if (hasUnsavedChanges && activeTab !== 'recurring') {
                setPendingNav({ type: 'switch', target: 'recurring' });
                setShowConfirmModal(true);
              } else {
                setActiveTab('recurring');
              }
            }}
            className={`flex-1 flex items-center justify-center py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'recurring' 
                ? 'bg-gray-100 text-gray-900 shadow-sm' 
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Horario Fijo
          </button>
        </div>

        {activeTab === 'recurring' ? (
          <RecurringScheduleManager
            key={recurringMountKey}
            onChangePending={(p) => setHasUnsavedChanges(p)}
            registerSaveHandler={(fn) => setRecurringSaveHandler(() => fn)}
          />
        ) : (
          <>
            {/* 4. Selector de la semana actual */}
            <div className="flex items-center justify-center space-x-4 mb-6">
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
                {!hasRecurringSchedule && !Object.values(weeklyAvailability).some(day => Object.values(day).some(v => v)) && (
                  <p className="text-xs text-red-500 mt-1 font-medium">
                    No hay disponibilidad configurada
                  </p>
                )}
              </div>
              
              <button
                onClick={() => navigateWeek('next')}
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* 5. Título del calendario y Botón Guardar (alineados) */}
            <div className="flex items-center justify-between mb-4 px-1">
              <h3 className="text-lg font-semibold text-gray-900">Calendario semanal</h3>
              
              {/* Botón Guardar movido aquí */}
              <button
                onClick={saveWeeklyAvailability}
                disabled={saving || !hasUnsavedChanges}
                className={`
                  py-2 px-6 text-sm rounded-xl font-bold flex items-center gap-2 transition-all duration-200
                  ${hasUnsavedChanges 
                    ? 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg shadow-green-600/20 transform hover:scale-[1.02] active:scale-[0.98] focus:ring-2 focus:ring-green-500 focus:ring-offset-2' 
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
                  }
                  ${saving ? 'opacity-70 cursor-wait' : ''}
                `}
              >
                <Save className="w-4 h-4" />
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
                <span className="ml-3 text-gray-600">Cargando disponibilidad...</span>
              </div>
            ) : (
              <div className="bg-transparent shadow-none border-0 p-0 sm:bg-white sm:rounded-xl sm:shadow-sm sm:border sm:border-gray-200 sm:p-6 overflow-hidden space-y-4 w-full">
                {/* Desktop/Tablet: vista semanal en rejilla */}
            <div className="hidden md:block md:overflow-x-auto">
              {/* Header de días */}
              <div className="grid md:grid-cols-7 gap-2 mb-4 md:min-w-[720px]">
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

              {/* Bloques por hora x día */}
              {timeBlocks.map((timeBlock) => (
                <div key={timeBlock.hour} className="grid md:grid-cols-7 gap-2 md:min-w-[720px]">
                  {getWeekDays().map((day) => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const isAvailable = isBlockAvailable(dateStr, timeBlock.hour);
                    const isBooked = isBlockBooked(dateStr, timeBlock.hour);
                    const isPast = isBefore(day, startOfToday());

                    return (
                      <button
                        key={`${dateStr}-${timeBlock.hour}`}
                        onClick={() => { if (!isBooked && !isPast) toggleBlockAvailability(dateStr, timeBlock.hour); }}
                        disabled={isBooked || isPast}
                        className={`
                          py-3 sm:py-4 px-2 sm:px-3 rounded-lg border-2 transition-all duration-200 
                          flex items-center justify-center font-medium text-xs sm:text-sm
                          ${isBooked
                            ? 'bg-green-600 border-green-700 text-white cursor-default'
                            : isPast
                              ? 'bg-gray-200 border-gray-200 text-gray-400 cursor-not-allowed'
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

            {/* Móvil: vista de calendario semanal compacta */}
            <div className="md:hidden">
              <div className="grid grid-cols-7 gap-1">
                {/* Header de días */}
                {getWeekDays().map((day) => {
                  const dayName = format(day, 'EEEEE', { locale: es });
                  const isWednesday = day.getDay() === 3;
                  const displayLabel = isWednesday ? 'X' : dayName;

                  return (
                    <div key={`header-${day.toISOString()}`} className="text-center py-2 bg-gray-50 rounded-md">
                      <p className="text-sm font-bold text-gray-900 uppercase leading-tight">
                        {displayLabel}
                      </p>
                      <p className="text-[11px] font-bold text-gray-800 leading-tight">
                        {format(day, 'dd')}
                      </p>
                    </div>
                  );
                })}

                {/* Grid de horas (filas) */}
                {timeBlocks.map((timeBlock) => (
                  <React.Fragment key={`row-${timeBlock.hour}`}>
                    {getWeekDays().map((day) => {
                      const dateStr = format(day, 'yyyy-MM-dd');
                      const isAvailable = isBlockAvailable(dateStr, timeBlock.hour);
                      const isBooked = isBlockBooked(dateStr, timeBlock.hour);
                      const isPast = isBefore(day, startOfToday());
                      
                      return (
                        <button
                          key={`mob-${dateStr}-${timeBlock.hour}`}
                          onClick={() => { if (!isBooked && !isPast) toggleBlockAvailability(dateStr, timeBlock.hour); }}
                          disabled={isBooked || isPast}
                          className={`
                            h-9 rounded-md border-2 transition-all duration-200 
                            flex items-center justify-center font-bold text-xs
                            ${isBooked
                              ? 'bg-green-600 border-green-700 text-white cursor-default'
                              : isPast
                                ? 'bg-gray-200 border-gray-200 text-gray-400 cursor-not-allowed'
                                : isAvailable 
                                  ? 'bg-green-100 border-green-400 text-green-900 hover:bg-green-200' 
                                  : 'bg-gray-50 border-gray-300 text-gray-900 hover:bg-gray-100'
                            }
                          `}
                        >
                          {timeBlock.label.split(':')[0]}
                        </button>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        )}
        </>
      )}

      {/* Confirm modal */}
      {showConfirmModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle className="w-6 h-6 text-yellow-600" />
              </div>
              
              <h3 className="text-lg font-bold text-gray-900 mb-2">
                ¿Deseas guardar los cambios?
              </h3>
              
              <p className="text-sm text-gray-600 mb-6">
                Tienes cambios pendientes en tu horario. Si sales sin guardar, perderás las modificaciones realizadas.
              </p>
              
              <div className="flex flex-col gap-3 w-full">
                <button
                  onClick={handleConfirmSave}
                  className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-3 px-4 rounded-xl font-bold shadow-lg shadow-green-600/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center"
                >
                  Guardar cambios
                </button>
                
                <button
                  onClick={handleConfirmDiscard}
                  className="w-full bg-gray-100 text-gray-700 py-3 px-4 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                >
                  No guardar
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Legend and Instructions */}
      {activeTab === 'weekly' && (
        <div className="mt-6 bg-gray-50 rounded-lg p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center space-x-4 sm:space-x-6 text-xs sm:text-sm flex-nowrap">
              <div className="flex items-center">
                <div className="w-3 h-3 sm:w-4 sm:h-4 bg-green-100 border-2 border-green-400 rounded mr-2"></div>
                <span className="text-gray-700">Disponible</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 sm:w-4 sm:h-4 bg-green-600 border-2 border-green-700 rounded mr-2"></div>
                <span className="text-gray-700">Reservado</span>
              </div>
              <div className="flex items-center">
                <div className="w-3 h-3 sm:w-4 sm:h-4 bg-gray-50 border-2 border-gray-300 rounded mr-2"></div>
                <span className="text-gray-700">No disponible</span>
              </div>
            </div>
            
            <div className="text-sm text-gray-600 min-w-0 sm:max-w-[50%]">
              <p className="break-words whitespace-normal leading-snug">Haz clic en cada bloque para cambiar tu disponibilidad</p>
              <p className="break-words whitespace-normal leading-snug">Horario: 8:00 AM - 8:00 PM (bloques de 1 hora)</p>
            </div>
          </div>
        </div>
      )}

      
    </div>
  );
};

export default AvailabilityManager;
