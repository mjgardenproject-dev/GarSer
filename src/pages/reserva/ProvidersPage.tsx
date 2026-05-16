import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronLeft, Star, AlertTriangle, Sprout } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { TreePruningServiceConfig } from '../../types/treePruning';
import { findPalmPrice } from '../../domain/pricingEngine';
import { isHighestOpenRangeForSpecies } from '../../domain/speciesBusinessRules';
import { PartialServiceModal } from './PartialServiceModal';
import {
  fetchProviderMonthDays,
  fetchProviderValidHours,
  previewProviderQuotes,
  type ProviderMonthDay,
  type ProviderQuotePreview,
} from '../../utils/bookingAuthorityService';
import toast from 'react-hot-toast';

interface ProviderProfile { user_id: string; full_name: string; avatar_url?: string; rating_average?: number; rating_count?: number }
type TreeSizeBand = 'small' | 'medium' | 'large' | 'over_9';

const ProvidersPage: React.FC = () => {
  const { bookingData, setBookingData, setCurrentStep } = useBooking();
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<string>(bookingData.providerId);
  const [configs, setConfigs] = useState<Record<string, any>>({});
  const [palmCoverageMap, setPalmCoverageMap] = useState<Record<string, { isFull: boolean; coveredCount: number; totalCount: number; missingGroups: any[] }>>({});
  const [selectedDate, setSelectedDate] = useState<string>(bookingData.preferredDate || `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`);
  const [, setHoursAvailable] = useState<number[]>([]);
  const [calendarMonthDate, setCalendarMonthDate] = useState<Date>(new Date(Number(selectedDate.split('-')[0]), Number(selectedDate.split('-')[1]) - 1, Number(selectedDate.split('-')[2])));
  const [monthDays, setMonthDays] = useState<ProviderMonthDay[]>([]);
  const [validHours, setValidHours] = useState<number[]>([]);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [monthLoading, setMonthLoading] = useState(false);
  const [hoursLoading, setHoursLoading] = useState(false);
  const [serviceName, setServiceName] = useState('');
  const [globalMinPrice, setGlobalMinPrice] = useState(0);
  const [previewQuotes, setPreviewQuotes] = useState<Record<string, ProviderQuotePreview>>({});
  const [earliestByProvider, setEarliestByProvider] = useState<Record<string, { date: string; startHour: number } | null>>({});
  const [loadError, setLoadError] = useState('');
  const [availabilityError, setAvailabilityError] = useState('');
  const reqIdRef = useRef<number>(0);
  const currencyFormatter = useMemo(() => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }), []);
  const monthFormatter = useMemo(() => new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }), []);

  const [isPartialModalOpen, setIsPartialModalOpen] = useState(false);

  const clearSelectedTimeSlot = () => {
    setSelectedHour(null);
    setBookingData((prev) => (prev.timeSlot ? { timeSlot: '' } : {}));
  };

  const getEstimatedHours = (providerId: string): number => {
    return Math.max(1, Number(previewQuotes[providerId]?.estimatedHours || 1));
  };

  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  const isTreePruningConfig = (value: any): value is TreePruningServiceConfig => {
    if (!value || typeof value !== 'object') return false;
    if (!value.estructural || typeof value.estructural !== 'object') return false;
    if (!value.formacion || typeof value.formacion !== 'object') return false;
    if (typeof value.difficultyIncrease !== 'number') return false;
    return true;
  };

  const mapTreePruningType = (value: any): 'estructural' | 'formacion' => {
    const v = String(value || '').toLowerCase();
    if (v.includes('shaping') || v.includes('form') || v.includes('formacion')) return 'formacion';
    return 'estructural';
  };

  const normalizeTreeSizeBand = (value: unknown): TreeSizeBand | null => {
    const v = String(value || '').toLowerCase().trim();
    if (v === 'small' || v === 'medium' || v === 'large' || v === 'over_9') return v;
    return null;
  };

  const resolveTreeBand = (tree: any): TreeSizeBand | null => {
    return normalizeTreeSizeBand(tree?.aiSizeBand);
  };

  const getTreeOver9Notice = (gardenerId: string) => {
    if (!bookingData.treeGroups || bookingData.treeGroups.length === 0) return null;
    const c = configs[gardenerId];
    if (!isTreePruningConfig(c)) return null;
    const trees = (bookingData.treeGroups || [])
      .filter((t: any) => !(t.isFailed || t.analysisLevel === 3))
      .map((t: any) => ({
        pruningType: mapTreePruningType(t.pruningType),
        sizeBand: resolveTreeBand(t)
      }))
      .filter((t: any) => t.sizeBand === 'over_9');
    if (trees.length === 0) return null;

    for (const tree of trees) {
      const large = tree.pruningType === 'estructural' ? c.estructural.large : c.formacion.large;
      if (typeof large === 'number' && large > 0) {
        return 'El profesional tendrá que verificar el pago porque es un servicio muy complejo.';
      }
    }
    return null;
  };

  const getPalmTerminalRangeNotice = () => {
    const groups = bookingData.palmGroups || [];
    const hasTerminalOpenRange = groups.some((g: any) => {
      if (!(Number(g?.quantity || 0) > 0)) return false;
      if (typeof g?.isTerminalOpenRange === 'boolean') return g.isTerminalOpenRange;
      return isHighestOpenRangeForSpecies(g?.species || '', g?.height || '');
    });
    if (!hasTerminalOpenRange) return null;
    return 'Precio aproximado: en el rango más alto de palmera el jardinero puede ajustar el importe y requerirá tu aceptación en el chat.';
  };

  const openAvailability = async (providerId: string) => {
    if (selectedProvider && selectedProvider !== providerId) clearSelectedTimeSlot();
    setSelectedProvider(providerId);
    const earliest = earliestByProvider[providerId];
    const nextDate = earliest?.date || selectedDate;
    setSelectedDate(nextDate);
    setCalendarMonthDate(new Date(Number(nextDate.split('-')[0]), Number(nextDate.split('-')[1]) - 1, Number(nextDate.split('-')[2])));
  };

  const rebuildMonth = async (providerId: string, monthStart: Date) => {
    setMonthLoading(true);
    setHoursLoading(false);
    const rid = ++reqIdRef.current;
    try {
      const { quote, days } = await fetchProviderMonthDays({
        bookingData,
        serviceId: bookingData.serviceIds[0],
        providerId,
        monthDate: fmt(new Date(monthStart.getFullYear(), monthStart.getMonth(), 1)),
        globalMinPrice,
      });
      if (reqIdRef.current === rid) {
        setPreviewQuotes((prev) => ({ ...prev, [providerId]: quote }));
        setMonthDays(days);
        const inMonth = new Date(Number(selectedDate.split('-')[0]), Number(selectedDate.split('-')[1]) - 1, Number(selectedDate.split('-')[2])).getMonth() === monthStart.getMonth();
        if (!inMonth || !days.some((item) => item.date === selectedDate && item.count > 0)) {
          const firstWith = days.find((item) => item.count > 0);
          if (firstWith) setSelectedDate(firstWith.date);
        }
      }
      if (reqIdRef.current === rid) setAvailabilityError('');
    } catch (error) {
      if (reqIdRef.current === rid) {
        setMonthDays([]);
        setAvailabilityError('No se pudo cargar el calendario del profesional. Reintenta.');
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
  }, [
    selectedProvider,
    calendarMonthDate,
    bookingData.serviceIds.join(','),
    bookingData.aiQuantity,
    bookingData.aiDifficulty,
    bookingData.wasteRemoval,
    bookingData.weedingZones ? JSON.stringify(bookingData.weedingZones.map((z) => ({ id: z.id, a: z.area, s: z.state, h: z.applyHerbicide }))) : '',
    bookingData.palmGroups ? JSON.stringify(bookingData.palmGroups.map((g) => ({ s: g.species, h: g.height, q: g.quantity }))) : '',
    bookingData.lawnZones ? JSON.stringify(bookingData.lawnZones.map((z) => ({ s: z.species, q: z.quantity, st: z.state }))) : '',
  ]);

  useEffect(() => {
    (async () => {
      if (!selectedProvider) return;
      setHoursLoading(true);
      try {
        const { quote, validHours: nextHours } = await fetchProviderValidHours({
          bookingData,
          serviceId: bookingData.serviceIds[0],
          providerId: selectedProvider,
          date: selectedDate,
          globalMinPrice,
        });
        setPreviewQuotes((prev) => ({ ...prev, [selectedProvider]: quote }));
        setValidHours(nextHours);
        setSelectedHour(null);
        setAvailabilityError('');
      } catch {
        setValidHours([]);
        setSelectedHour(null);
        setAvailabilityError('No se pudieron calcular las horas válidas. Reintenta.');
      } finally {
        setHoursLoading(false);
      }
    })();
  }, [
    selectedDate,
    selectedProvider,
    bookingData.serviceIds.join(','),
    bookingData.aiQuantity,
    bookingData.aiDifficulty,
    bookingData.wasteRemoval,
    bookingData.weedingZones ? JSON.stringify(bookingData.weedingZones.map((z) => ({ id: z.id, a: z.area, s: z.state, h: z.applyHerbicide }))) : '',
    bookingData.palmGroups ? JSON.stringify(bookingData.palmGroups.map((g) => ({ s: g.species, h: g.height, q: g.quantity }))) : '',
    bookingData.lawnZones ? JSON.stringify(bookingData.lawnZones.map((z) => ({ s: z.species, q: z.quantity, st: z.state }))) : '',
  ]);

  useEffect(() => {
    const fetchProviders = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const primaryServiceId = bookingData.serviceIds[0];
        
        const query = supabase
          .from('gardener_service_prices')
          .select('gardener_id, service_id, price_per_unit, additional_config')
          .eq('service_id', primaryServiceId)
          .eq('active', true);
          
        if (bookingData.palmSpecies) {
          // Filter by species in JSONB config
          // Previously we filtered by ALL species, now we want to fetch ANY potential match
          // to calculate partial coverage later.
          // query = query.contains('additional_config', { selected_species: [bookingData.palmSpecies] });
          // Instead of filtering in DB, we fetch all palm service providers and filter in JS
        }

        const { data: priceRows } = await query;

        let gardenerIds = Array.from(new Set((priceRows || []).map((p: any) => p.gardener_id)));
        if (bookingData.restrictedGardenerId) {
          gardenerIds = gardenerIds.filter((id) => id === bookingData.restrictedGardenerId);
        }
        
        // Determinar si se requiere licencia (Fitosanitarios químicos)
        const { data: serviceInfoData } = await supabase
            .from('services')
            .select('name, base_price')
            .eq('id', primaryServiceId)
            .single();

        setServiceName(serviceInfoData?.name || '');
        setGlobalMinPrice(Number(serviceInfoData?.base_price || 0));

        const isPhytosanitaryChemical = serviceInfoData?.name === 'Servicios fitosanitarios' && 
          (bookingData.phytosanitaryZones || []).some((z: any) => z.productPreference !== 'ecological');
        const isWeedingHerbicide = serviceInfoData?.name === 'Desbroce de malas hierbas' &&
          (bookingData.weedingZones || []).some((z: any) => z.applyHerbicide === true);

        const requiresChemical = isPhytosanitaryChemical || isWeedingHerbicide;

        let profilesQuery = supabase
          .from('gardener_profiles')
          .select('user_id, full_name, avatar_url, rating_average, rating_count, has_phytosanitary_license')
          .in('user_id', gardenerIds);

        // Filtro estricto en Backend (Capa 1)
        if (requiresChemical) {
          profilesQuery = profilesQuery.eq('has_phytosanitary_license', true);
        }

        const { data: profiles } = await profilesQuery;
        
        let list: ProviderProfile[] = ((profiles as any) || []) as ProviderProfile[];
        const map: Record<string, number> = {};
        const configMap: Record<string, any> = {};
        const coverageMap: Record<string, { isFull: boolean; coveredCount: number; totalCount: number; missingGroups: any[] }> = {};

        // Filtro estricto en Frontend (Capa 2)
        if (requiresChemical) {
          list = list.filter(p => (p as any).has_phytosanitary_license === true);
        }

        (priceRows || []).forEach((p: any) => { 
            map[p.gardener_id] = p.price_per_unit;
            configMap[p.gardener_id] = p.additional_config;
            
            // Calculate Palm Coverage if applicable
            if (bookingData.palmGroups && bookingData.palmGroups.length > 0) {
                const config = p.additional_config;
                let covered = 0;
                const missing = [];
                const total = bookingData.palmGroups.length;
                
                for (const group of bookingData.palmGroups) {
                     const price = findPalmPrice(config, group.species, group.height);
                     if (price > 0) {
                         covered++;
                     } else {
                         missing.push(group);
                     }
                }
                
                coverageMap[p.gardener_id] = {
                    isFull: covered === total,
                    coveredCount: covered,
                    totalCount: total,
                    missingGroups: missing
                };
            }
        });
        setConfigs(configMap);
        setPalmCoverageMap(coverageMap);

        // Strict Filtering for Tree Pruning (Poda de árboles)
        // Rule 4: Gardener Availability Logic
        const { data: treeServiceInfo } = await supabase
            .from('services')
            .select('name')
            .eq('id', primaryServiceId)
            .single();

        if (treeServiceInfo?.name === 'Poda de árboles') {
            list = list.filter(p => {
                const c = configMap[p.user_id];
                if (!c) return false;
                if (!isTreePruningConfig(c)) return false;

                const required =
                  Number(c.estructural.small || 0) > 0 &&
                  Number(c.estructural.medium || 0) > 0 &&
                  Number(c.formacion.small || 0) > 0 &&
                  Number(c.formacion.medium || 0) > 0;
                if (!required) return false;

                const trees = (bookingData.treeGroups || [])
                  .filter((t: any) => !(t.isFailed || t.analysisLevel === 3))
                  .map((t: any) => ({
                    pruningType: mapTreePruningType(t.pruningType),
                    sizeBand: resolveTreeBand(t),
                  }))
                  .filter((t: any) => Boolean(t.sizeBand));

                for (const tree of trees) {
                  if (tree.sizeBand === 'large' || tree.sizeBand === 'over_9') {
                    const large = tree.pruningType === 'estructural' ? c.estructural.large : c.formacion.large;
                    if (!(typeof large === 'number' && large > 0)) return false;
                  }
                }

                return true;
            });
        }

        // Filter list: Remove gardeners with 0 coverage for palms
        if (bookingData.palmGroups && bookingData.palmGroups.length > 0) {
             list = list.filter(p => coverageMap[p.user_id]?.coveredCount > 0);
        }

        const preview = list.length > 0
          ? await previewProviderQuotes({
              bookingData,
              serviceId: primaryServiceId,
              providerIds: list.map((provider) => provider.user_id),
              selectedDate,
              windowDays: 14,
              globalMinPrice: Number(serviceInfoData?.base_price || 0),
            })
          : { quotes: {}, earliestByProvider: {} };

        const earliestMap: Record<string, number> = {};
        Object.entries(preview.earliestByProvider || {}).forEach(([providerId, earliest]) => {
          earliestMap[providerId] = earliest
            ? new Date(`${earliest.date}T${String(earliest.startHour).padStart(2, '0')}:00:00`).getTime()
            : Number.POSITIVE_INFINITY;
        });
        list.sort((a,b)=>{
          const ta = earliestMap[a.user_id] ?? Number.POSITIVE_INFINITY;
          const tb = earliestMap[b.user_id] ?? Number.POSITIVE_INFINITY;
          
          // Primary Sort: Full Coverage > Partial Coverage (if Palm Service)
          if (bookingData.palmGroups && bookingData.palmGroups.length > 0) {
              const coverageA = coverageMap[a.user_id];
              const coverageB = coverageMap[b.user_id];
              if (coverageA?.isFull && !coverageB?.isFull) return -1;
              if (!coverageA?.isFull && coverageB?.isFull) return 1;
              // Secondary: More coverage count
              if ((coverageA?.coveredCount || 0) > (coverageB?.coveredCount || 0)) return -1;
              if ((coverageA?.coveredCount || 0) < (coverageB?.coveredCount || 0)) return 1;
          }

          return ta - tb;
        });
        setProviders(list);
        setPreviewQuotes(preview.quotes || {});
        setEarliestByProvider(preview.earliestByProvider || {});
        
        // Ensure selected provider is valid for the current filters
        const stillValid = list.some(p => p.user_id === selectedProvider);
        if (list.length > 0) {
            if (!selectedProvider || !stillValid) {
                if (selectedProvider && selectedProvider !== list[0].user_id) {
                    clearSelectedTimeSlot();
                }
                setSelectedProvider(list[0].user_id);
            }
        } else {
            if (selectedProvider) {
                clearSelectedTimeSlot();
            }
            setSelectedProvider('');
        }
      } catch (e) {
        setProviders([]);
        setPreviewQuotes({});
        setEarliestByProvider({});
        setLoadError('No se pudieron cargar los profesionales. Reintenta.');
      } finally {
        setLoading(false);
      }
    };
    fetchProviders();
  }, [
    bookingData.serviceIds.join(','), 
    bookingData.estimatedHours,
    bookingData.lawnSpecies,
    bookingData.palmSpecies,
    bookingData.aiQuantity,
    bookingData.aiDifficulty,
    bookingData.wasteRemoval,
    bookingData.weedingZones
      ? JSON.stringify(bookingData.weedingZones.map((z) => ({ id: z.id, a: z.area, s: z.state, h: z.applyHerbicide })))
      : '',
    bookingData.palmGroups ? JSON.stringify(bookingData.palmGroups.map(g => g.species)) : '', // Detect species changes in groups
    bookingData.lawnZones ? JSON.stringify(bookingData.lawnZones.map(z => ({s: z.species, q: z.quantity, st: z.state}))) : '',
    selectedDate,
  ]);

  // Cargar disponibilidad del jardinero seleccionado para la fecha elegida
  useEffect(() => {
    setHoursAvailable(validHours);
  }, [selectedProvider, selectedDate]);



  const computePrice = (gardenerId: string) => {
    return Math.max(0, Number(previewQuotes[gardenerId]?.totalPrice || 0));
  };

  const handleContinue = () => { 
    if (selectedProvider) { 
      const coverage = palmCoverageMap[selectedProvider];
      if (coverage && !coverage.isFull && coverage.missingGroups.length > 0) {
        setIsPartialModalOpen(true);
        return;
      }
      proceedWithBooking(bookingData.palmGroups || []);
    } 
  };

  const handleConfirmPartialService = () => {
    setIsPartialModalOpen(false);
    if (!selectedProvider) return;
    
    const config = configs[selectedProvider];
    const coveredGroups = (bookingData.palmGroups || []).filter(
      (g) => findPalmPrice(config, g.species, g.height) > 0
    );
    
    proceedWithBooking(coveredGroups);
  };

  const proceedWithBooking = (groupsToKeep: any[]) => {
    if (selectedProvider) {
      const quote = previewQuotes[selectedProvider];
      if (!quote) {
        toast.error('Todavía no se ha podido validar el presupuesto de este profesional.');
        return;
      }
      const slotLabel = selectedHour != null
        ? `${String(selectedHour).padStart(2,'0')}:00 - ${String(selectedHour + Math.max(1, Math.ceil(quote.estimatedHours))).padStart(2,'0')}:00`
        : bookingData.timeSlot;
      setBookingData({
        providerId: selectedProvider,
        palmGroups: groupsToKeep,
        estimatedHours: quote.estimatedHours,
        totalPrice: quote.totalPrice,
        preferredDate: selectedDate,
        timeSlot: slotLabel,
        priceBreakdown: quote.breakdown,
        quoteId: '',
        quoteSignature: '',
        quoteExpiresAt: '',
        quotePricingVersion: quote.pricingVersion || '',
        quoteProviderConfigVersion: quote.providerConfigVersion || '',
      });
      setCurrentStep(4); 
    } 
  };

  const handleSelectStartHour = (hour: number) => {
    if (!selectedProvider || !selectedDate) return;
    const dur = getEstimatedHours(selectedProvider);
    const endHour = hour + dur;
    const label = `${String(hour).padStart(2,'0')}:00 - ${String(endHour).padStart(2,'0')}:00`;
    setBookingData({ preferredDate: selectedDate, timeSlot: label });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando jardineros…</p>
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
            type="button"
            onClick={() => setCurrentStep(2)}
            aria-label="Volver al paso de detalles"
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
          >
            <ChevronLeft aria-hidden="true" className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">
            {serviceName ? (bookingData.palmSpecies && serviceName.toLowerCase().includes('palmera') ? `${serviceName}: ${bookingData.palmSpecies}` : serviceName) : 'Jardineros'}
          </h1>
          {/* Botón de cancelar reserva movido al layout principal en BookingFlow */}
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
        {loadError && (
          <div aria-live="polite" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {loadError}
          </div>
        )}

        {/* Partial Coverage Warning */}
        {providers.length > 0 && bookingData.palmGroups && bookingData.palmGroups.length > 0 && 
         !providers.some(p => palmCoverageMap[p.user_id]?.isFull) && (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                <div className="p-1 bg-amber-100 rounded-full text-amber-600 shrink-0 mt-0.5">
                    <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="text-sm text-amber-800">
                    <p className="font-medium">No hay ningún jardinero disponible para realizar el trabajo completo.</p>
                    <p className="text-amber-700 mt-1">A continuación mostramos profesionales que pueden realizar parte del servicio (se cobrará solo la parte realizada).</p>
                </div>
            </div>
        )}

        {/* No providers message */}
        {!loading && providers.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center max-w-sm mx-auto mt-8">
            <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <Sprout className="w-10 h-10 text-green-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              No hay profesionales disponibles
            </h3>
            <p className="text-gray-600 mb-6 leading-relaxed">
              Actualmente no hay ningún profesional cualificado disponible para este servicio en tu zona. Por favor, intenta nuevamente más tarde o prueba con otras opciones (ej. tratamientos ecológicos).
            </p>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto scrollbar-hide [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {providers.map((p) => {
              const selected = selectedProvider === p.user_id;
              const coverage = palmCoverageMap[p.user_id];
              const isPartial = coverage && !coverage.isFull;
              const treeOver9Notice = getTreeOver9Notice(p.user_id);
              const palmTerminalNotice = getPalmTerminalRangeNotice();

              return (
                <button
                  key={p.user_id}
                  type="button"
                  onClick={() => openAvailability(p.user_id)}
                  aria-pressed={selected}
                  className={`min-w-[240px] bg-white rounded-2xl shadow-sm p-4 border-2 text-left relative transition-colors flex flex-col gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 ${
                    selected ? 'border-green-600 bg-green-50' : isPartial ? 'border-amber-300 bg-amber-50 hover:border-amber-400' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {/* Partial Tag - Repositioned inside the normal flow or top left with margin */}
                  {isPartial && (
                      <div className="bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-1 rounded-lg self-start border border-amber-200 mb-1">
                          PARCIAL ({coverage.coveredCount}/{coverage.totalCount})
                      </div>
                  )}

                  <div className="flex items-center gap-3">
                    {p.avatar_url ? (
                      <img src={p.avatar_url} alt={p.full_name} className="w-12 h-12 rounded-full object-cover shrink-0" width="48" height="48" loading="lazy" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold shrink-0">
                        {p.full_name.charAt(0)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 truncate">{p.full_name}</div>
                      <div className="text-sm text-gray-700 font-medium">
                        {(() => {
                            const price = computePrice(p.user_id);
                            if (price <= 0) return <span className="text-gray-400 font-normal">No disponible</span>;
                            return (
                              <div className="flex items-baseline gap-1">
                                  <span>{currencyFormatter.format(price)}</span>
                                  {isPartial && <span className="text-xs text-amber-700 font-normal">(parcial)</span>}
                              </div>
                            );
                        })()}
                      </div>
                      {previewQuotes[p.user_id]?.warnings && previewQuotes[p.user_id].warnings!.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {previewQuotes[p.user_id].warnings!.slice(0, 2).map((warning) => (
                            <div key={warning} className="text-xs text-amber-800 bg-amber-50 p-2 rounded border border-amber-200 leading-tight">
                              {warning}
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {!isPartial && treeOver9Notice && (
                          <div className="mt-2 text-xs text-amber-800 bg-amber-50 p-2 rounded border border-amber-200 leading-tight">
                              {treeOver9Notice}
                          </div>
                      )}
                      {!isPartial && palmTerminalNotice && (
                          <div className="mt-2 text-xs text-amber-800 bg-amber-50 p-2 rounded border border-amber-200 leading-tight">
                              {palmTerminalNotice}
                          </div>
                      )}

                      {/* Partial Coverage Details */}
                      {isPartial && coverage?.missingGroups.length > 0 && (
                          <div className="mt-2 text-xs text-amber-800 bg-amber-100 p-2 rounded border border-amber-200 leading-tight">
                              <span className="font-semibold block mb-1">No incluye:</span>
                              {coverage.missingGroups.slice(0, 2).map((g: any, i: number) => (
                                  <div key={i} className="truncate">• {g.species} {g.height}</div>
                              ))}
                              {coverage.missingGroups.length > 2 && <div>+ {coverage.missingGroups.length - 2} más…</div>}
                          </div>
                      )}

                      {!isPartial && (
                          <div className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                            <Star className="w-3 h-3 text-yellow-400 fill-current" />
                            {p.rating_average ? Number(p.rating_average).toFixed(1) : 'Nuevo'}
                            {typeof p.rating_count === 'number' && ` (${p.rating_count})`}
                          </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

        {/* Calendario fijo y horas */}
        {selectedProvider && (
        <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-200">
          {availabilityError && (
            <div aria-live="polite" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {availabilityError}
            </div>
          )}
          {/* Encabezado selector */}
          <div className="mb-3">
            <div className="text-sm font-semibold text-gray-900">
              Seleccionar fecha y hora 
              <span className="font-normal text-gray-500 ml-1">
                (la duración del servicio es de {getEstimatedHours(selectedProvider)} h)
              </span>
            </div>
            <div className="flex items-center justify-between mt-2">
              <div className="text-sm text-gray-700 capitalize">
                {monthFormatter.format(calendarMonthDate)}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCalendarMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                  aria-label="Ver mes anterior"
                  className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => setCalendarMonthDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                  aria-label="Ver mes siguiente"
                  className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
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
                          type="button"
                          disabled={d.disabled}
                          onClick={() => setSelectedDate(d.date)}
                          aria-label={`Seleccionar ${d.date}`}
                          className={`w-10 h-10 rounded-full flex items-center justify-center border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 ${d.disabled ? 'cursor-not-allowed opacity-40 border-gray-200 bg-gray-50 text-gray-400' : selected ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-green-50'}`}
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
                    type="button"
                    onClick={() => { setSelectedHour(h); handleSelectStartHour(h); }}
                    aria-pressed={isSelected}
                  className={`px-4 py-2 rounded-xl text-sm border flex-shrink-0 tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 ${isSelected ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300 hover:border-green-400 hover:bg-green-50'}`}
                  >
                    {`${String(h).padStart(2,'0')}:00`}
                  </button>
                );
              })
            )}
          </div>

          {/* Rango horario seleccionado */}
          {selectedHour != null && (
            <div className="mt-3 text-sm text-green-700 tabular-nums" aria-live="polite">
              Horario del trabajo: {String(selectedHour).padStart(2,'0')}:00 – {String(selectedHour + getEstimatedHours(selectedProvider)).padStart(2,'0')}:00
            </div>
          )}
        </div>
        )}

      </div>

      {/* Fixed CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] z-50">
        <div className="max-w-md mx-auto">
          <button
            type="button"
            onClick={handleContinue}
            disabled={!selectedProvider || !bookingData.timeSlot}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-2xl font-semibold text-lg shadow-lg hover:shadow-xl hover:scale-[1.02] motion-reduce:transform-none transition-transform duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
          >
            {selectedProvider 
              ? 'Confirmar jardinero'
              : 'Selecciona un jardinero'
            }
          </button>
        </div>
      </div>

      <PartialServiceModal
        isOpen={isPartialModalOpen}
        onClose={() => setIsPartialModalOpen(false)}
        onConfirm={handleConfirmPartialService}
        coveredGroups={
          selectedProvider && configs[selectedProvider]
            ? (bookingData.palmGroups || []).filter(
                (g) => findPalmPrice(configs[selectedProvider], g.species, g.height) > 0
              )
            : []
        }
        missingGroups={
          selectedProvider && palmCoverageMap[selectedProvider]
            ? palmCoverageMap[selectedProvider].missingGroups
            : []
        }
      />
    </div>
  );
};

export default ProvidersPage;
