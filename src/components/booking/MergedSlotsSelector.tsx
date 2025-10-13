import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Clock, AlertCircle } from 'lucide-react';
import { format, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { useAuth } from '../../contexts/AuthContext';
import { findEligibleGardeners, computeMergedSlots, computeNextAvailableDays, MergedSlot } from '../../utils/mergedAvailabilityService';

interface Props {
  serviceId: string;
  clientAddress: string;
  durationHours: number;
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  onSlotSelect: (slot: MergedSlot) => void;
}

const MergedSlotsSelector: React.FC<Props> = ({
  serviceId,
  clientAddress,
  durationHours,
  selectedDate,
  onDateChange,
  onSlotSelect
}) => {
  const { user } = useAuth();
  const [eligibleGardenerIds, setEligibleGardenerIds] = useState<string[]>([]);
  const [slots, setSlots] = useState<MergedSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [daySuggestions, setDaySuggestions] = useState<{ date: string; slots: MergedSlot[] }[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function loadGardeners() {
      const gardeners = await findEligibleGardeners(serviceId, clientAddress);
      if (!mounted) return;
      setEligibleGardenerIds(gardeners.map(g => g.user_id));
    }
    loadGardeners();
    return () => { mounted = false; };
  }, [serviceId, clientAddress]);

  useEffect(() => {
    let mounted = true;
    async function loadSlots() {
      if (!user || eligibleGardenerIds.length === 0) { setSlots([]); return; }
      setLoading(true);
      try {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const merged = await computeMergedSlots(eligibleGardenerIds, dateStr, user.id, durationHours);
        if (!mounted) return;
        setSlots(merged);
      } finally {
        setLoading(false);
      }
    }
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleGardenerIds, durationHours, selectedDate, user?.id]);

  // Buscar próximos días con disponibilidad para evitar prueba manual
  useEffect(() => {
    let mounted = true;
    async function loadSuggestions() {
      if (!user || eligibleGardenerIds.length === 0) { setDaySuggestions([]); return; }
      setSuggestionsLoading(true);
      try {
        const startDateStr = format(selectedDate, 'yyyy-MM-dd');
        const suggestions = await computeNextAvailableDays(
          eligibleGardenerIds,
          startDateStr,
          user.id,
          durationHours,
          14,
          7
        );
        if (!mounted) return;
        setDaySuggestions(suggestions);

        // Si el día actual no tiene slots, auto-seleccionar el primer día sugerido
        if (suggestions.length > 0 && slots.length === 0) {
          const firstDate = new Date(suggestions[0].date);
          onDateChange(firstDate);
        }
      } finally {
        setSuggestionsLoading(false);
      }
    }
    loadSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleGardenerIds, durationHours, selectedDate, user?.id]);

  const dayLabel = useMemo(() => format(selectedDate, "EEEE, d 'de' MMMM", { locale: es }), [selectedDate]);

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center text-gray-700">
          <Calendar className="w-5 h-5 mr-2" />
          <span className="font-semibold">{dayLabel}</span>
        </div>
        <div className="flex space-x-2">
          <button
            type="button"
            onClick={() => onDateChange(addDays(selectedDate, -1))}
            className="px-3 py-1 border rounded-lg text-sm hover:bg-gray-50"
          >Anterior</button>
          <button
            type="button"
            onClick={() => onDateChange(addDays(selectedDate, 1))}
            className="px-3 py-1 border rounded-lg text-sm hover:bg-gray-50"
          >Siguiente</button>
        </div>
      </div>

      {/* Sugerencias de próximos días con disponibilidad */}
      <div className="mb-4">
        <div className="flex items-center text-gray-700 mb-2">
          <Calendar className="w-4 h-4 mr-2 text-green-600" />
          <span className="text-sm font-semibold">Próximos días con disponibilidad</span>
          {suggestionsLoading && (
            <span className="ml-2 text-xs text-gray-500">Buscando…</span>
          )}
        </div>
        {daySuggestions.length === 0 ? (
          <p className="text-xs text-gray-500">No hay días cercanos con disponibilidad para la duración seleccionada.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {daySuggestions.map(s => {
              const d = new Date(s.date);
              const label = format(d, "EEE d MMM", { locale: es });
              return (
                <button
                  key={s.date}
                  type="button"
                  onClick={() => onDateChange(d)}
                  className={`px-3 py-1 rounded-full text-xs border ${format(selectedDate, 'yyyy-MM-dd') === s.date ? 'bg-green-100 border-green-300 text-green-800' : 'hover:bg-gray-50 border-gray-200 text-gray-700'}`}
                  title={`${s.slots.length} franjas disponibles`}
                >
                  {label} · {s.slots.length} slots
                </button>
              );
            })}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-6">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" />
        </div>
      ) : slots.length === 0 ? (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center">
          <AlertCircle className="w-5 h-5 text-amber-600 mr-2" />
          <span className="text-amber-800 text-sm">
            No hay disponibilidad para este servicio en tu zona en el día y duración seleccionados.
          </span>
        </div>
      ) : (
        <div>
          <p className="text-sm text-gray-600 mb-3">Selecciona una franja disponible. El primero en aceptar obtiene el trabajo.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {slots.map(slot => (
              <button
                key={`${slot.startHour}-${slot.endHour}`}
                type="button"
                onClick={() => onSlotSelect(slot)}
                className="p-4 border-2 border-gray-200 rounded-xl hover:border-green-500 hover:bg-green-50 text-left"
              >
                <div className="flex items-center text-gray-800">
                  <Clock className="w-5 h-5 mr-2 text-green-600" />
                  <span className="font-semibold">
                    {`${slot.startHour.toString().padStart(2, '0')}:00`} – {`${slot.endHour.toString().padStart(2, '0')}:00`}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {slot.gardenerIds.length} jardineros disponibles
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default MergedSlotsSelector;