import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Clock, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
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
  restrictedGardenerId?: string;
}

const MergedSlotsSelector: React.FC<Props> = ({
  serviceId,
  clientAddress,
  durationHours,
  selectedDate,
  onDateChange,
  onSlotSelect,
  restrictedGardenerId
}) => {
  const { user } = useAuth();
  const [eligibleGardenerIds, setEligibleGardenerIds] = useState<string[]>([]);
  const [slots, setSlots] = useState<MergedSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [daySuggestions, setDaySuggestions] = useState<{ date: string; slots: MergedSlot[] }[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadGardeners() {
      const gardeners = await findEligibleGardeners(serviceId, clientAddress);
      if (!mounted) return;
      const ids = gardeners.map(g => g.user_id);
      setEligibleGardenerIds(
        restrictedGardenerId ? ids.filter(id => id === restrictedGardenerId) : ids
      );
    }
    loadGardeners();
    return () => { mounted = false; };
  }, [serviceId, clientAddress, restrictedGardenerId]);

  useEffect(() => {
    async function loadSlots() {
      if (!user || eligibleGardenerIds.length === 0) { setSlots([]); return; }
      setLoading(true);
      try {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const merged = await computeMergedSlots(eligibleGardenerIds, dateStr, user?.id || 'anonymous', durationHours);
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
    async function loadSuggestions() {
      if (!user || eligibleGardenerIds.length === 0) { setDaySuggestions([]); return; }
      setSuggestionsLoading(true);
      try {
        const startDateStr = format(selectedDate, 'yyyy-MM-dd');
        const suggestions = await computeNextAvailableDays(
          eligibleGardenerIds,
          startDateStr,
          user?.id || 'anonymous',
          durationHours,
          14,
          7
        );
        setDaySuggestions(suggestions);
        // Inicializar día expandido
        if (suggestions.length > 0) {
          setExpandedDate(prev => prev ?? suggestions[0].date);
        }
      } finally {
        setSuggestionsLoading(false);
      }
    }
    loadSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleGardenerIds, durationHours, selectedDate, user?.id]);
  
  const humanLabel = (dateStr: string) => {
    const d = new Date(dateStr);
    return format(d, "EEE d MMM");
  };

  return (
    <div className="mt-6">
      <div className="flex items-center text-gray-700 mb-3">
        <Calendar className="w-5 h-5 mr-2" />
        <span className="font-semibold">Días disponibles</span>
        {suggestionsLoading && (
          <span className="ml-2 text-xs text-gray-500">Buscando…</span>
        )}
      </div>

      {daySuggestions.length === 0 ? (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center">
          <AlertCircle className="w-5 h-5 text-amber-600 mr-2" />
          <span className="text-amber-800 text-sm">
            No hay días cercanos con disponibilidad para la duración seleccionada.
          </span>
        </div>
      ) : (
        <div className="space-y-3">
          {daySuggestions.map(s => {
            const isOpen = expandedDate === s.date;
            const label = humanLabel(s.date);
            return (
              <div key={s.date} className="border border-gray-200 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setExpandedDate(s.date);
                    onDateChange(new Date(s.date));
                    setSlots(s.slots);
                  }}
                  className={`w-full flex items-center justify-between p-3 text-left ${isOpen ? 'bg-green-50 border-b border-green-200 rounded-t-xl' : ''}`}
                >
                  <div className="flex items-center">
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 mr-2 text-green-600" />
                    ) : (
                      <ChevronRight className="w-4 h-4 mr-2 text-gray-500" />
                    )}
                    <span className="font-medium text-gray-800">{label}</span>
                  </div>
                  <span className="text-xs text-gray-600">{s.slots.length} franjas</span>
                </button>
                {isOpen && (
                  <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {s.slots.map(slot => (
                      <button
                        key={`${s.date}-${slot.startHour}-${slot.endHour}`}
                        type="button"
                        onClick={() => onSlotSelect(slot)}
                        className="p-3 border-2 border-gray-200 rounded-lg hover:border-green-500 hover:bg-green-50 text-left"
                      >
                        <div className="flex items-center text-gray-800">
                          <Clock className="w-4 h-4 mr-2 text-green-600" />
                          <span className="font-semibold">
                            {`${slot.startHour.toString().padStart(2, '0')}:00`} – {`${slot.endHour.toString().padStart(2, '0')}:00`}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-1">
                          {slot.gardenerIds.length} jardineros disponibles
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MergedSlotsSelector;
