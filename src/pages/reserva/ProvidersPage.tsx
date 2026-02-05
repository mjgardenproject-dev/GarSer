import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronLeft, Star, Clock, MapPin, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import * as availCompat from '../../utils/availabilityServiceCompat';
import { canBookSequence } from '../../utils/bufferService';

interface ProviderProfile { user_id: string; full_name: string; avatar_url?: string; rating_average?: number; rating_count?: number }

const ProvidersPage: React.FC = () => {
  const navigate = useNavigate();
  const { bookingData, setBookingData, saveProgress, setCurrentStep } = useBooking();
  const { user } = useAuth();
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<string>(bookingData.providerId);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [configs, setConfigs] = useState<Record<string, any>>({});
  const [selectedDate, setSelectedDate] = useState<string>(bookingData.preferredDate || `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`);
  const [hoursAvailable, setHoursAvailable] = useState<number[]>([]);
  const [showDatePicker] = useState(false);
  const [calendarMonthDate, setCalendarMonthDate] = useState<Date>(new Date(Number(selectedDate.split('-')[0]), Number(selectedDate.split('-')[1]) - 1, Number(selectedDate.split('-')[2])));
  const [monthDays, setMonthDays] = useState<Array<{ date: string; day: number; disabled: boolean; count: number }>>([]);
  const [validHours, setValidHours] = useState<number[]>([]);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const [hoursLoading, setHoursLoading] = useState(false);
  const [serviceName, setServiceName] = useState('');
  const daysCacheRef = useRef<Map<string, Array<{ date: string; day: number; disabled: boolean; count: number }>>>(new Map());
  const hoursCacheRef = useRef<Map<string, number[]>>(new Map());
  const reqIdRef = useRef<number>(0);

  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
  const chips: string[] = [];

  const findFirstAvailableDate = async (providerId: string, startDate: string, hoursNeeded: number) => {
    for (let i=0;i<14;i++) {
      const parts = startDate.split('-').map(Number);
      const dateStr = fmt(addDays(new Date(parts[0], parts[1]-1, parts[2]), i));
      const blocks = await availCompat.getGardenerAvailability(providerId, dateStr);
      const hours = ((blocks||[]) as any[]).filter((b:any)=>b.is_available).map((b:any)=>b.hour_block);
      const set = new Set<number>(hours);
      for (const h of hours) {
        let fits = true;
        const dur = Math.max(1, Number(bookingData.estimatedHours || 0));
        for (let k=0;k<dur;k++) { if (!set.has(h+k)) { fits = false; break; } }
        if (!fits) continue;
        const ok = await canBookSequence(providerId, dateStr, h, hoursNeeded, user?.id || 'anon');
        if (ok.canBook) return { date: dateStr, startHour: h };
      }
    }
    return null;
  };

  const openAvailability = async (providerId: string) => {
    if (selectedProvider === providerId) {
      setSelectedProvider('');
      return;
    }
    setSelectedProvider(providerId);
  setCalendarMonthDate(new Date(Number(selectedDate.split('-')[0]), Number(selectedDate.split('-')[1]) - 1, Number(selectedDate.split('-')[2])));
    const hoursNeeded = Math.max(1, Number(bookingData.estimatedHours || 0));
    try {
      const blocks = await availCompat.getGardenerAvailability(providerId, selectedDate);
      const hours = ((blocks||[]) as any[]).filter((b:any)=>b.is_available).map((b:any)=>b.hour_block);
      const set = new Set<number>(hours);
      let hasValid = false;
      const dur = Math.max(1, Number(bookingData.estimatedHours || 0));
      for (const h of hours) {
        let fits = true;
        for (let k=0;k<dur;k++) { if (!set.has(h+k)) { fits = false; break; } }
        if (!fits) continue;
        const ok = await canBookSequence(providerId, selectedDate, h, hoursNeeded, user?.id || 'anon');
        if (ok.canBook) { hasValid = true; break; }
      }
      if (!hasValid) {
        const first = await findFirstAvailableDate(providerId, selectedDate, hoursNeeded);
        if (first?.date) setSelectedDate(first.date);
      }
    } catch {}
  };

  const computeValidStartHours = async (providerId: string, dateStr: string): Promise<number[]> => {
    try {
      const blocks = await availCompat.getGardenerAvailability(providerId, dateStr);
      const hours = ((blocks||[]) as any[]).filter((b:any)=>b.is_available).map((b:any)=>b.hour_block);
      const set = new Set<number>(hours);
      const dur = Math.max(1, Number(bookingData.estimatedHours || 0));
      const out: number[] = [];
      for (const h of hours) {
        let fits = true;
        for (let k=0;k<dur;k++) { if (!set.has(h+k)) { fits = false; break; } }
        if (!fits) continue;
        const ok = await canBookSequence(providerId, dateStr, h, dur, user?.id || 'anon');
        if (ok.canBook) out.push(h);
      }
      return out;
    } catch {
      return [];
    }
  };

  const rebuildMonth = async (providerId: string, monthStart: Date) => {
    setMonthLoading(true);
    setHoursLoading(false);
    const y = monthStart.getFullYear();
    const m = monthStart.getMonth();
    const last = new Date(y, m + 1, 0);
    const todayStr = fmt(new Date());
    const cacheKey = `${providerId}-${y}-${m}-${Math.max(1, Number(bookingData.estimatedHours || 0))}`;
    const cached = daysCacheRef.current.get(cacheKey);
    const rid = ++reqIdRef.current;
    if (cached) {
      setMonthDays(cached);
      setMonthLoading(false);
      return;
    }
    try {
      const startStr = fmt(new Date(y, m, 1));
      const endStr = fmt(new Date(y, m, last.getDate()));
      const blocks = await availCompat.getAvailabilityRange(providerId, startStr, endStr);
      const byDate: Record<string, number[]> = {};
      (blocks || []).forEach((b: any) => {
        if (!b.is_available) return;
        if (!byDate[b.date]) byDate[b.date] = [];
        byDate[b.date].push(b.hour_block);
      });
      const dur = Math.max(1, Number(bookingData.estimatedHours || 0));
      const items: Array<{ date: string; day: number; disabled: boolean; count: number }> = [];
      for (let d = 1; d <= last.getDate(); d++) {
        const dateStr = fmt(new Date(y, m, d));
        const past = dateStr < todayStr;
        const hours = (byDate[dateStr] || []).sort((a,b)=>a-b);
        let count = 0;
        if (!past && hours.length > 0) {
          const set = new Set<number>(hours);
          for (const h of hours) {
            let fits = true;
            for (let k=0;k<dur;k++) { if (!set.has(h+k)) { fits = false; break; } }
            if (fits) count++;
          }
        }
        items.push({ date: dateStr, day: d, disabled: past || count === 0, count });
      }
      if (reqIdRef.current === rid) {
        daysCacheRef.current.set(cacheKey, items);
        setMonthDays(items);
        const inMonth = new Date(Number(selectedDate.split('-')[0]), Number(selectedDate.split('-')[1])-1, Number(selectedDate.split('-')[2])).getMonth() === m;
        if (!inMonth || !items.some(i => i.date === selectedDate && i.count > 0)) {
          const firstWith = items.find(i => i.count > 0);
          if (firstWith) setSelectedDate(firstWith.date);
        }
      }
    } finally {
      if (reqIdRef.current === rid) setMonthLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      if (!selectedProvider) {
        setMonthDays([]);
        setValidHours([]);
        setHoursAvailable([]);
        setSelectedHour(null);
        return;
      }
      await rebuildMonth(selectedProvider, calendarMonthDate);
      setSelectedHour(null);
    })();
  }, [selectedProvider, calendarMonthDate]);

  useEffect(() => {
    (async () => {
      if (!selectedProvider) return;
      setHoursLoading(true);
      const cacheKey = `${selectedProvider}-${selectedDate}-${Math.max(1, Number(bookingData.estimatedHours || 0))}`;
      const cached = hoursCacheRef.current.get(cacheKey);
      let hrs: number[] = [];
      if (cached) {
        hrs = cached;
      } else {
        hrs = await computeValidStartHours(selectedProvider, selectedDate);
        hoursCacheRef.current.set(cacheKey, hrs);
      }
      setValidHours(hrs);
      setSelectedHour(null);
      setHoursLoading(false);
    })();
  }, [selectedDate]);

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const primaryServiceId = bookingData.serviceIds[0];
        
        let query = supabase
          .from('gardener_service_prices')
          .select('gardener_id, service_id, price_per_unit, additional_config')
          .eq('service_id', primaryServiceId)
          .eq('active', true);
          
        if (bookingData.palmSpecies) {
          // Filter by species in JSONB config
          query = query.contains('additional_config', { selected_species: [bookingData.palmSpecies] });
        }

        const { data: priceRows } = await query;

        const gardenerIds = Array.from(new Set((priceRows || []).map((p: any) => p.gardener_id)));
        const { data: profiles } = await supabase
          .from('gardener_profiles')
          .select('user_id, full_name, avatar_url, rating_average, rating_count')
          .in('user_id', gardenerIds);
        let list: ProviderProfile[] = ((profiles as any) || []) as ProviderProfile[];
        const map: Record<string, number> = {};
        const configMap: Record<string, any> = {};
        (priceRows || []).forEach((p: any) => { 
            map[p.gardener_id] = p.price_per_unit;
            configMap[p.gardener_id] = p.additional_config;
        });
        setPrices(map);
        setConfigs(configMap);
        // Ordenar por disponibilidad más próxima
        const hoursNeeded = Math.max(1, Number(bookingData.estimatedHours || 0));
        const today = new Date();
        const addDaysLocal = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
        const windowDays = 14;
        const earliestMap: Record<string, number> = {};
        await Promise.all(list.map(async (p) => {
          let bestTs = Number.POSITIVE_INFINITY;
          for (let i=0;i<windowDays;i++) {
            const dateStr = fmt(addDaysLocal(today, i));
            const blocks = await availCompat.getGardenerAvailability(p.user_id, dateStr);
            const hours = ((blocks||[]) as any[]).filter((b:any)=>b.is_available).map((b:any)=>b.hour_block);
            for (const h of hours) {
              const ok = await canBookSequence(p.user_id, dateStr, h, hoursNeeded, user?.id || 'anon');
              if (ok.canBook) { bestTs = Math.min(bestTs, new Date(dateStr+'T'+String(h).padStart(2,'0')+':00:00').getTime()); break; }
            }
            if (bestTs !== Number.POSITIVE_INFINITY) break;
          }
          earliestMap[p.user_id] = bestTs;
        }));
        list.sort((a,b)=>{
          const ta = earliestMap[a.user_id] ?? Number.POSITIVE_INFINITY;
          const tb = earliestMap[b.user_id] ?? Number.POSITIVE_INFINITY;
          return ta - tb;
        });
        setProviders(list);
        if (!selectedProvider && list.length > 0) {
          setSelectedProvider(list[0].user_id);
        }
      } catch (e) {
        setProviders([]);
      } finally {
        setLoading(false);
      }
    };
    fetchProviders();
  }, [bookingData.serviceIds.join(','), bookingData.estimatedHours]);

  // Cargar disponibilidad del jardinero seleccionado para la fecha elegida
  useEffect(() => {
    const loadAvailability = async () => {
      if (!selectedProvider || !selectedDate) { setHoursAvailable([]); return; }
      try {
        const blocks = await availCompat.getGardenerAvailability(selectedProvider, selectedDate);
        const availHours = ((blocks || []) as any[]).filter((b: any) => b.is_available).map((b: any) => b.hour_block);
        setHoursAvailable(availHours);
      } catch { setHoursAvailable([]); }
    };
    loadAvailability();
  }, [selectedProvider, selectedDate]);



  const computePrice = (gardenerId: string) => {
    // 1. Lógica específica para Poda de Palmeras (Multi-Group Support)
    const config = configs[gardenerId];
    if (bookingData.palmGroups && bookingData.palmGroups.length > 0 && config) {
        let total = 0;
        
        for (const group of bookingData.palmGroups) {
            const species = group.species;
            const height = group.height;
            const state = group.state || 'normal';
            const waste = group.wasteRemoval;
            const qty = group.quantity;

            // Base Price from Config
            let base = 0;
            if (height && config.height_prices?.[species]?.[height]) {
                base = config.height_prices[species][height];
            } else if (config.species_prices?.[species]) {
                base = config.species_prices[species];
            } else {
                base = prices[gardenerId] || 0; // Fallback to generic price
            }

            // State Surcharge
            let stateKey = state;
            const surcharges = config.condition_surcharges || {};

            if (state === 'muy descuidado') {
                if (surcharges['muy_descuidada'] !== undefined) stateKey = 'muy_descuidada';
                else if (surcharges['muy_descuidado'] !== undefined) stateKey = 'muy_descuidado';
                else stateKey = 'muy_descuidada';
            } else if (state === 'descuidado') {
                if (surcharges['descuidada'] !== undefined) stateKey = 'descuidada';
                else if (surcharges['descuidado'] !== undefined) stateKey = 'descuidado';
                else stateKey = 'descuidada';
            }
            
            const stateSurchargePercent = surcharges[stateKey] || 0;
            const stateMult = 1 + (stateSurchargePercent / 100);

            // Waste Removal Surcharge (applied after state surcharge)
            let wasteMult = 1;
            if (waste) {
                 const wastePercent = config.waste_removal?.percentage || 0;
                 wasteMult = 1 + (wastePercent / 100);
            }

            if (base > 0 && qty > 0) {
                // Formula: Base * StateMult * WasteMult * Qty
                total += Math.ceil(base * stateMult * wasteMult * qty);
            }
        }
        return total;
    }
    
    // Fallback: Legacy single-group logic (for backward compatibility or if groups are empty but fields exist)
    if (bookingData.palmSpecies && config) {
        const species = bookingData.palmSpecies;
        const height = bookingData.palmHeight;
        const state = bookingData.palmState || 'normal';
        const waste = bookingData.palmWasteRemoval;
        const qty = bookingData.aiQuantity || 0;

        // Base Price from Config
        let base = 0;
        if (height && config.height_prices?.[species]?.[height]) {
            base = config.height_prices[species][height];
        } else if (config.species_prices?.[species]) {
            base = config.species_prices[species];
        } else {
            base = prices[gardenerId] || 0; // Fallback to generic price
        }

        // State Surcharge
        let stateKey = state;
        const surcharges = config.condition_surcharges || {};

        if (state === 'muy descuidado') {
            if (surcharges['muy_descuidada'] !== undefined) stateKey = 'muy_descuidada';
            else if (surcharges['muy_descuidado'] !== undefined) stateKey = 'muy_descuidado';
            else stateKey = 'muy_descuidada';
        } else if (state === 'descuidado') {
            if (surcharges['descuidada'] !== undefined) stateKey = 'descuidada';
            else if (surcharges['descuidado'] !== undefined) stateKey = 'descuidado';
            else stateKey = 'descuidada';
        }
        
        const stateSurchargePercent = surcharges[stateKey] || 0;
        const stateMult = 1 + (stateSurchargePercent / 100);

        // Waste Removal Surcharge (applied after state surcharge)
        let wasteMult = 1;
        if (waste) {
             const wastePercent = config.waste_removal?.percentage || 0;
             wasteMult = 1 + (wastePercent / 100);
        }

        if (base > 0 && qty > 0) {
            // Formula: Base * StateMult * WasteMult * Qty
            return Math.ceil(base * stateMult * wasteMult * qty);
        }
        return 0;
    }

    // 2. Lógica por defecto (otros servicios)
    const unitPrice = prices[gardenerId] || 0;
    const qty = bookingData.aiQuantity || 0;
    const mult = bookingData.aiDifficulty ? (bookingData.aiDifficulty === 3 ? 1.6 : bookingData.aiDifficulty === 2 ? 1.3 : 1.0) : 1.0;
    if (unitPrice > 0 && qty > 0) return Math.ceil(qty * unitPrice * mult);
    return 0;
  };

  const handleProviderSelect = (providerId: string) => { setSelectedProvider(providerId); };

  const handleContinue = () => { 
    if (selectedProvider) { 
      // Aseguramos que se guarde la fecha seleccionada y el proveedor
      setBookingData({ 
        providerId: selectedProvider, 
        totalPrice: computePrice(selectedProvider),
        preferredDate: selectedDate 
      }); 
      setCurrentStep(4); 
    } 
  };

  const handleSelectStartHour = async (hour: number) => {
    if (!selectedProvider || !selectedDate) return;
    const dur = Math.max(1, Number(bookingData.estimatedHours || 0));

    const clientId = user?.id || 'anon';
    const ok = await canBookSequence(selectedProvider, selectedDate, hour, dur, clientId);
    if (ok.canBook) {
      const endHour = hour + dur;
      const label = `${String(hour).padStart(2,'0')}:00 - ${String(endHour).padStart(2,'0')}:00`;
      setBookingData({ preferredDate: selectedDate, timeSlot: label });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando jardineros...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => setCurrentStep(2)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">
            {serviceName ? (bookingData.palmSpecies && serviceName.toLowerCase().includes('palmera') ? `${serviceName}: ${bookingData.palmSpecies}` : serviceName) : 'Jardineros'}
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { try { localStorage.removeItem('bookingProgress'); } catch {}; navigate('/dashboard'); }}
              className="px-3 py-2 text-sm bg-white border border-gray-300 hover:bg-gray-50 rounded-lg text-gray-700"
            >
              Cancelar reserva
            </button>
          </div>
        </div>
      </div>

      {/* Progreso */}
      <div className="bg-white">
        <div className="max-w-md mx-auto px-4 py-3">
          <div className="flex items-center space-x-2 text-sm text-gray-600">
            <span>Paso 4 de 5</span>
            <div className="flex-1 bg-gray-200 rounded-full h-1 w-24">
              <div className="bg-green-600 h-1 rounded-full" style={{ width: '80%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-md mx-auto px-4 py-6 pb-24">
        {/* Carrusel de jardineros */}
        <div className="mb-4">
          <div className="flex gap-3 overflow-x-auto scrollbar-hide [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {providers.map((p) => {
              const selected = selectedProvider === p.user_id;
              return (
                <button
                  key={p.user_id}
                  onClick={() => openAvailability(p.user_id)}
                  className={`min-w-[220px] bg-white rounded-2xl shadow-sm p-3 border-2 text-left ${
                    selected ? 'border-green-600 bg-green-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {p.avatar_url ? (
                      <img src={p.avatar_url} alt={p.full_name} className="w-12 h-12 rounded-full object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold">
                        {p.full_name.charAt(0)}
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="font-semibold text-gray-900 truncate">{p.full_name}</div>
                      <div className="text-sm text-gray-700">€{computePrice(p.user_id) || '—'}</div>
                      <div className="text-xs text-gray-500 flex items-center gap-1">
                        <Star className="w-3 h-3 text-yellow-400 fill-current" />
                        {p.rating_average ? Number(p.rating_average).toFixed(1) : 'Nuevo'}
                        {typeof p.rating_count === 'number' && ` (${p.rating_count})`}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Calendario fijo y horas */}
        {selectedProvider && (
        <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-200">
          {/* Encabezado selector */}
          <div className="mb-3">
            <div className="text-sm font-semibold text-gray-900">
              Seleccionar fecha y hora 
              <span className="font-normal text-gray-500 ml-1">
                (la duración del servicio es de {Math.max(1, Number(bookingData.estimatedHours || 0))} h)
              </span>
            </div>
            <div className="flex items-center justify-between mt-2">
              <div className="text-sm text-gray-700">
                {calendarMonthDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setCalendarMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                  className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700"
                >
                  ←
                </button>
                <button
                  onClick={() => setCalendarMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                  className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700"
                >
                  →
                </button>
              </div>
            </div>
          </div>

          {/* Calendario mensual */}
          <div className="mb-3">
            <div className="grid grid-cols-7 text-xs text-gray-500 mb-1">
              {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((w) => (
                <div key={w} className="text-center">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {monthLoading ? (
                Array.from({ length: 42 }).map((_, i) => (
                  <div key={i} className="w-10 h-10 rounded-full bg-gray-200 animate-pulse mx-auto" />
                ))
              ) : (
                (() => {
                  const y = calendarMonthDate.getFullYear();
                  const m = calendarMonthDate.getMonth();
                  const firstDay = new Date(y, m, 1).getDay() || 7;
                  const blanks = Array.from({ length: firstDay - 1 }, () => null);
                  const days = monthDays;
                  const elements = [...blanks.map((_, i) => <div key={`b-${i}`} />),
                    ...days.map((d) => {
                      const selected = d.date === selectedDate;
                      return (
                        <button
                          key={d.date}
                          disabled={d.disabled}
                          onClick={() => setSelectedDate(d.date)}
                          className={`w-10 h-10 rounded-full flex items-center justify-center border ${d.disabled ? 'cursor-not-allowed opacity-40 border-gray-200 bg-gray-50 text-gray-400' : selected ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-green-50'}`}
                        >
                          {d.day}
                        </button>
                      );
                    })
                  ];
                  return elements;
                })()
              )}
            </div>
          </div>

          {/* Horas disponibles: fila horizontal */}
          <div className="mb-2 text-sm font-medium text-gray-900">Horas disponibles:</div>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {hoursLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="w-20 h-10 rounded-xl bg-gray-200 animate-pulse flex-shrink-0" />
              ))
            ) : validHours.length === 0 ? (
              <div className="text-sm text-gray-500">No hay horas válidas en este día.</div>
            ) : (
              validHours.map(h => {
                const isSelected = selectedHour === h || bookingData.timeSlot?.startsWith(`${String(h).padStart(2,'0')}:00`);
                return (
                  <button
                    key={h}
                    onClick={() => { setSelectedHour(h); handleSelectStartHour(h); }}
                    className={`px-4 py-2 rounded-xl text-sm border flex-shrink-0 ${isSelected ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300 hover:border-green-400 hover:bg-green-50'}`}
                  >
                    {`${String(h).padStart(2,'0')}:00`}
                  </button>
                );
              })
            )}
          </div>

          {/* Rango horario seleccionado */}
          {selectedHour != null && (
            <div className="mt-3 text-sm text-green-700">
              Horario del trabajo: {String(selectedHour).padStart(2,'0')}:00 – {String(selectedHour + Math.max(1, Number(bookingData.estimatedHours||0))).padStart(2,'0')}:00
            </div>
          )}
        </div>
        )}

      </div>

      {/* Fixed CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] z-50">
        <div className="max-w-md mx-auto">
          <button
            onClick={handleContinue}
            disabled={!selectedProvider || !bookingData.timeSlot}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-2xl font-semibold text-lg shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            {selectedProvider 
              ? 'Confirmar jardinero'
              : 'Selecciona un jardinero'
            }
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProvidersPage;
