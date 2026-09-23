import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Calendar, Save, ChevronLeft, ChevronRight, RefreshCw, Loader2 } from 'lucide-react';
import { format, parseISO, startOfWeek, endOfWeek, eachDayOfInterval, subWeeks, addWeeks, isBefore, isToday, startOfToday } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  generateDailyTimeBlocks,
  getGardenerAvailabilityByDate,
  setGardenerAvailability
} from '../../utils/availabilityService';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import RecurringScheduleManager from './RecurringScheduleManager';
import AppHeader from '../common/AppHeader';
import { useConfirmDialog } from '../common/ConfirmDialog';

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
  // Horas con solicitud de reserva PENDIENTE: se muestran (ámbar) y no se pueden desmarcar,
  // para que el jardinero no retire disponibilidad de una hora ya solicitada por un cliente.
  const [pendingBlocks, setPendingBlocks] = useState<{ [date: string]: Set<number> }>({});
  // Foto de lo último cargado/guardado, para guardar solo los días que realmente cambian.
  const [savedSnapshot, setSavedSnapshot] = useState<{ [date: string]: { [hour: number]: boolean } }>({});
  const [hasRecurringSchedule, setHasRecurringSchedule] = useState(false);
  
  // Nuevo estado para controlar cambios sin guardar
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [recurringSaveHandler, setRecurringSaveHandler] = useState<(() => Promise<boolean>) | null>(null);
  // Abre el modal "¿Confirmar nuevo horario fijo?" de RecurringScheduleManager — lo usa
  // el botón "Guardar" del header cuando el jardinero guarda explícitamente (fallo 14).
  const [recurringExplicitSaveTrigger, setRecurringExplicitSaveTrigger] = useState<(() => void) | null>(null);
  const [recurringSaving, setRecurringSaving] = useState(false);
  const [recurringMountKey, setRecurringMountKey] = useState(0);

  const { openConfirm, confirmDialog } = useConfirmDialog();

  // Bloques de 1 hora del día laboral (7:00–20:00, ver availabilityWindow.ts)
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
    if (!user?.id) return;

    setLoading(true);
    try {
      const weekStart = startOfWeek(selectedWeek, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(selectedWeek, { weekStartsOn: 1 });
      const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });
      const startStr = format(weekStart, 'yyyy-MM-dd');
      const endStr = format(weekEnd, 'yyyy-MM-dd');

      // Disponibilidad de toda la semana en una sola query (antes: 7 secuenciales)
      const byDate = await getGardenerAvailabilityByDate(user.id, startStr, endStr);
      const weeklyData: { [date: string]: { [hour: number]: boolean } } = {};
      weekDays.forEach((day) => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const dayAvailability: { [hour: number]: boolean } = {};
        (byDate[dateStr] || []).forEach(block => {
          if (block.is_available) {
            dayAvailability[block.hour_block] = true;
          }
        });
        weeklyData[dateStr] = dayAvailability;
      });

      setWeeklyAvailability(weeklyData);
      setSavedSnapshot(weeklyData);
      setHasUnsavedChanges(false); // Reset changes flag on load

      // Reservas confirmadas y solicitudes pendientes de la semana → marcar bloques
      try {
        const { data: bookings, error: bookingsError } = await supabase
          .from('bookings')
          .select('date, start_time, duration_hours, status')
          .eq('gardener_id', user.id)
          .in('status', ['pending', 'confirmed'])
          .gte('date', startStr)
          .lte('date', endStr);

        if (bookingsError) {
          console.warn('Error fetching bookings for calendar:', bookingsError);
          setBookedBlocks({});
          setPendingBlocks({});
        } else {
          const bookedMap: { [date: string]: Set<number> } = {};
          const pendingMap: { [date: string]: Set<number> } = {};
          (bookings || []).forEach((b: any) => {
            const startHour = parseInt((b.start_time || '08:00').split(':')[0]);
            const duration = b.duration_hours || 1;
            const target = b.status === 'confirmed' ? bookedMap : pendingMap;
            if (!target[b.date]) target[b.date] = new Set<number>();
            for (let i = 0; i < duration; i++) {
              target[b.date].add(startHour + i);
            }
          });
          setBookedBlocks(bookedMap);
          setPendingBlocks(pendingMap);
        }
      } catch (e) {
        console.warn('Error building booked blocks map:', e);
        setBookedBlocks({});
        setPendingBlocks({});
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

  // Compara un día contra la última foto guardada para escribir solo lo que cambió.
  const dayChanged = (date: string): boolean => {
    const current = weeklyAvailability[date] || {};
    const saved = savedSnapshot[date] || {};
    const hours = new Set([...Object.keys(current), ...Object.keys(saved)]);
    for (const h of hours) {
      if (!!current[Number(h)] !== !!saved[Number(h)]) return true;
    }
    return false;
  };

  const saveWeeklyAvailability = async (): Promise<boolean> => {
    if (!user) return false;

    const changedDates = Object.keys(weeklyAvailability).filter(dayChanged);
    if (changedDates.length === 0) {
      setHasUnsavedChanges(false);
      return true;
    }

    setSaving(true);
    try {
      // Guardamos solo los días modificados y reportamos exactamente cuáles fallan,
      // en vez de un "todo o nada" que dejaba días a medias sin avisar.
      const results = await Promise.allSettled(
        changedDates.map((date) => {
          const availableHours = Object.entries(weeklyAvailability[date])
            .filter(([, isAvailable]) => isAvailable)
            .map(([hour]) => parseInt(hour));
          return setGardenerAvailability(user.id, date, availableHours);
        })
      );

      const failedDates = changedDates.filter((_, i) => results[i].status === 'rejected');
      if (failedDates.length > 0) {
        const labels = failedDates
          .map((d) => format(parseISO(d), 'EEE dd/MM', { locale: es }))
          .join(', ');
        toast.error(`No se pudo guardar: ${labels}. Revisa tu conexión y guarda de nuevo.`);
        // Actualizamos la foto solo con los días que sí se guardaron
        const snapshot = { ...savedSnapshot };
        changedDates.forEach((d, i) => {
          if (results[i].status === 'fulfilled') snapshot[d] = { ...weeklyAvailability[d] };
        });
        setSavedSnapshot(snapshot);
        return false;
      }

      toast.success('Disponibilidad guardada correctamente');
      setSavedSnapshot(JSON.parse(JSON.stringify(weeklyAvailability)));
      setHasUnsavedChanges(false);
      return true;
    } catch (error: any) {
      console.error('Error saving availability:', error);
      toast.error('Error al guardar la disponibilidad');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Guarda lo que corresponda según la subpágina activa (usado al salir/cambiar con
  // cambios pendientes). No confundir con el guardado explícito del header (fallo 14),
  // que en "horario fijo" pasa antes por su propio modal de confirmación.
  const performActiveSave = async (): Promise<boolean> => {
    if (activeTab === 'weekly') {
      return saveWeeklyAvailability();
    }
    return (await recurringSaveHandler?.()) ?? false;
  };

  // Único punto de aviso "¿deseas guardar los cambios?" para salir, cambiar de semana
  // o cambiar de subpágina con cambios sin guardar — antes vivía duplicado a mano
  // (createPortal) en este mismo archivo; ahora usa el diálogo canónico compartido.
  const confirmUnsavedChanges = (onSavedOk: () => void, onDiscard: () => void) => {
    openConfirm({
      title: '¿Deseas guardar los cambios?',
      message: 'Tienes cambios pendientes en tu horario. Si sales sin guardar, perderás las modificaciones realizadas.',
      confirmLabel: 'Guardar cambios',
      cancelLabel: 'No guardar',
      tone: 'warning',
      onConfirm: async () => {
        const success = await performActiveSave();
        if (success) {
          setHasUnsavedChanges(false);
          onSavedOk();
        }
        // Si falla, ya se mostró un toast de error; el diálogo se cierra igualmente
        // pero no navegamos, así que hasUnsavedChanges sigue true y un nuevo intento
        // de salir vuelve a preguntar.
      },
      onCancel: () => {
        setHasUnsavedChanges(false);
        onDiscard();
      },
    });
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    if (direction === 'prev') {
      const prevWeekStart = startOfWeek(subWeeks(selectedWeek, 1), { weekStartsOn: 1 });
      if (isBefore(prevWeekStart, startOfToday())) return; // no navegar a semanas pasadas
    }
    const applyWeekChange = () => {
      setSelectedWeek(prev => direction === 'prev' ? subWeeks(prev, 1) : addWeeks(prev, 1));
    };
    if (hasUnsavedChanges) {
      confirmUnsavedChanges(applyWeekChange, applyWeekChange);
      return;
    }
    applyWeekChange();
  };

  const applyTabSwitch = (target: 'weekly' | 'recurring', { forceRemount }: { forceRemount: boolean }) => {
    setActiveTab(target);
    if (forceRemount) {
      if (target === 'weekly') {
        fetchWeeklyAvailability();
      } else {
        setRecurringMountKey((k) => k + 1);
      }
    }
  };

  const switchTab = (target: 'weekly' | 'recurring') => {
    if (activeTab === target) return;
    if (hasUnsavedChanges) {
      confirmUnsavedChanges(
        () => applyTabSwitch(target, { forceRemount: false }),
        () => applyTabSwitch(target, { forceRemount: true }),
      );
      return;
    }
    setActiveTab(target);
  };

  // Botón "Guardar" del header compartido (fallo 14): en "horario fijo" abre primero
  // el modal de confirmación de RecurringScheduleManager (avisa de que sobrescribe
  // disponibilidad futura); en "ajustes puntuales" guarda directo, como ya hacía.
  const handleHeaderSave = () => {
    if (activeTab === 'weekly') {
      void saveWeeklyAvailability();
    } else {
      recurringExplicitSaveTrigger?.();
    }
  };

  const savingCombined = activeTab === 'weekly' ? saving : recurringSaving;

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

  const isBlockPending = (date: string, hour: number): boolean => {
    const set = pendingBlocks[date];
    return !!set && set.has(hour);
  };

  const handleBack = () => {
    if (hasUnsavedChanges) {
      confirmUnsavedChanges(() => onBack?.(), () => onBack?.());
      return;
    }
    onBack?.();
  };

  return (
    <div className="relative">
      <AppHeader
        title="Gestión de Disponibilidad"
        onBack={onBack ? handleBack : undefined}
        backLabel="Salir"
      >
        <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => switchTab('weekly')}
            className={`flex-1 flex items-center justify-center py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'weekly'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <Calendar className="w-4 h-4 mr-2" />
            Ajustes puntuales
          </button>
          <button
            onClick={() => switchTab('recurring')}
            className={`flex-1 flex items-center justify-center py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'recurring'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Horario fijo
          </button>
        </div>

        <button
          onClick={handleHeaderSave}
          disabled={savingCombined || !hasUnsavedChanges}
          className={`
            w-full py-2.5 px-4 text-sm rounded-xl font-bold flex items-center justify-center gap-2 transition-all duration-200
            ${hasUnsavedChanges
              ? 'bg-emerald-700 hover:bg-emerald-800 text-white shadow-lg shadow-emerald-700/20 active:scale-[0.98]'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
            }
            ${savingCombined ? 'opacity-70 cursor-wait' : ''}
          `}
        >
          {savingCombined ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {savingCombined ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </AppHeader>

      <div className="max-w-full sm:max-w-3xl md:max-w-4xl mx-auto px-4 py-4 sm:p-6">
        <p className="text-xs text-gray-500 mb-6 px-1">
          {activeTab === 'weekly'
            ? 'Modifica franjas concretas de esta semana — excepciones, bloqueos o horas extra sobre tu horario fijo.'
            : 'Define tu plantilla semanal recurrente. Se aplica automáticamente a las próximas semanas.'}
        </p>

        {activeTab === 'recurring' ? (
          <RecurringScheduleManager
            key={recurringMountKey}
            onChangePending={(p) => setHasUnsavedChanges(p)}
            registerSaveHandler={(fn) => setRecurringSaveHandler(() => fn)}
            onSavingChange={setRecurringSaving}
            registerExplicitSaveTrigger={(fn) => setRecurringExplicitSaveTrigger(() => fn)}
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

            {/* 5. Título del calendario (el guardado vive en el header, fallo 14) */}
            <div className="mb-2 px-1">
              <h3 className="text-lg font-semibold text-gray-900">Calendario semanal</h3>
            </div>

            {/* Leyenda compacta ANTES del calendario (en móvil quedaba al final y no se veía) */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-4 px-1 text-[11px] sm:text-xs text-gray-600">
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 border border-green-400 inline-block" />Disponible</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-600 border border-green-700 inline-block" />Reservado</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-400 inline-block" />Solicitada</span>
              <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-50 border border-gray-300 inline-block" />No disponible</span>
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
                {getWeekDays().map((day) => {
                  const todayDay = isToday(day);
                  return (
                    <div key={day.toISOString()} className={`text-center py-3 rounded-lg ${todayDay ? 'bg-green-50 ring-1 ring-green-400' : 'bg-gray-50'}`}>
                      <p className={`text-xs sm:text-sm font-medium ${todayDay ? 'text-green-700' : 'text-gray-900'}`}>
                        {format(day, 'EEE', { locale: es })}
                      </p>
                      <p className={`text-[11px] sm:text-xs ${todayDay ? 'text-green-600 font-semibold' : 'text-gray-600'}`}>
                        {format(day, 'dd/MM')}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Bloques por hora x día */}
              {timeBlocks.map((timeBlock) => (
                <div key={timeBlock.hour} className="grid md:grid-cols-7 gap-2 md:min-w-[720px]">
                  {getWeekDays().map((day) => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const isAvailable = isBlockAvailable(dateStr, timeBlock.hour);
                    const isBooked = isBlockBooked(dateStr, timeBlock.hour);
                    const isPending = isBlockPending(dateStr, timeBlock.hour);
                    const isPast = isBefore(day, startOfToday());
                    const locked = isBooked || isPending || isPast;

                    return (
                      <button
                        key={`${dateStr}-${timeBlock.hour}`}
                        onClick={() => { if (!locked) toggleBlockAvailability(dateStr, timeBlock.hour); }}
                        disabled={locked}
                        className={`
                          py-3 sm:py-4 px-2 sm:px-3 rounded-lg border-2 transition-all duration-200
                          flex items-center justify-center font-medium text-xs sm:text-sm
                          ${isBooked
                            ? 'bg-emerald-700 border-green-700 text-white cursor-default'
                            : isPending
                              ? 'bg-amber-100 border-amber-400 text-amber-800 cursor-default'
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
                  const todayDay = isToday(day);

                  return (
                    <div key={`header-${day.toISOString()}`} className={`text-center py-2 rounded-md ${todayDay ? 'bg-green-50 ring-1 ring-green-400' : 'bg-gray-50'}`}>
                      <p className={`text-sm font-bold uppercase leading-tight ${todayDay ? 'text-green-700' : 'text-gray-900'}`}>
                        {displayLabel}
                      </p>
                      <p className={`text-[11px] font-bold leading-tight ${todayDay ? 'text-green-600' : 'text-gray-800'}`}>
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
                      const isPending = isBlockPending(dateStr, timeBlock.hour);
                      const isPast = isBefore(day, startOfToday());
                      const locked = isBooked || isPending || isPast;

                      return (
                        <button
                          key={`mob-${dateStr}-${timeBlock.hour}`}
                          onClick={() => { if (!locked) toggleBlockAvailability(dateStr, timeBlock.hour); }}
                          disabled={locked}
                          className={`
                            h-11 rounded-md border-2 transition-all duration-200
                            flex items-center justify-center font-bold text-xs
                            ${isBooked
                              ? 'bg-emerald-700 border-green-700 text-white cursor-default'
                              : isPending
                                ? 'bg-amber-100 border-amber-400 text-amber-900 cursor-default'
                                : isPast
                                  ? 'bg-gray-200 border-gray-200 text-gray-400 cursor-not-allowed'
                                  : isAvailable
                                    ? 'bg-green-100 border-green-400 text-green-900 hover:bg-green-200'
                                    : 'bg-gray-50 border-gray-300 text-gray-900 hover:bg-gray-100'
                            }
                          `}
                        >
                          {timeBlock.label.split(':')[0]}h
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

        {/* Nota de uso */}
        {activeTab === 'weekly' && (
          <div className="mt-6 bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
            <p className="leading-snug">Toca cada bloque para cambiar tu disponibilidad. Horario: 7:00 – 20:00 (bloques de 1 hora).</p>
          </div>
        )}
      </div>

      {confirmDialog}
    </div>
  );
};

export default AvailabilityManager;
