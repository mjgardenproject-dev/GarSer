import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronLeft, Star, Clock, MapPin, Check, AlertTriangle, TreePine, SearchX, Sprout } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import * as availCompat from '../../utils/availabilityServiceCompat';
import { canBookSequence } from '../../utils/bufferService';
import { calculatePhytosanitaryQuote } from '../../utils/serviceValidation';
import { calculateWeedingQuote } from '../../utils/weedingPricing';
import { calculateTreePruningQuoteForTrees } from '../../domain/pricing/treePruningPricing';
import { TreePruningServiceConfig } from '../../types/treePruning';
import { calculatePalmPriceEngine, findPalmPrice, PalmPricingGroup, calculatePalmHoursEngine } from '../../domain/pricingEngine';
import { isHighestOpenRangeForSpecies } from '../../domain/speciesBusinessRules';
import { PartialServiceModal } from './PartialServiceModal';

interface ProviderProfile { user_id: string; full_name: string; avatar_url?: string; rating_average?: number; rating_count?: number }
type TreeSizeBand = 'small' | 'medium' | 'large' | 'over_9';

const ProvidersPage: React.FC = () => {
  const navigate = useNavigate();
  const { bookingData, setBookingData, saveProgress, setCurrentStep } = useBooking();
  const { user } = useAuth();
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<string>(bookingData.providerId);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [configs, setConfigs] = useState<Record<string, any>>({});
  const [palmCoverageMap, setPalmCoverageMap] = useState<Record<string, { isFull: boolean; coveredCount: number; totalCount: number; missingGroups: any[] }>>({});
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
  const [globalMinPrice, setGlobalMinPrice] = useState(0);
  const daysCacheRef = useRef<Map<string, Array<{ date: string; day: number; disabled: boolean; count: number }>>>(new Map());
  const hoursCacheRef = useRef<Map<string, number[]>>(new Map());
  const reqIdRef = useRef<number>(0);

  const [isPartialModalOpen, setIsPartialModalOpen] = useState(false);

  const getEstimatedHours = (providerId: string): number => {
    if (!providerId) return 1;
    const config = configs[providerId];
    if (!config) return 1;

    let totalHours = 0;

    // Yield-based calculation helper for difficulty multipliers
    const getDurationMultiplier = (state: string) => {
        const s = (state || 'normal').toLowerCase();
        if (s.includes('muy') && s.includes('descuidad')) return 1.7; // 70% more time
        if (s.includes('descuidad')) return 1.3; // 30% more time
        return 1.0;
    };

    // 1. Lawn (Yield: m2 per hour)
    if (bookingData.lawnZones && bookingData.lawnZones.length > 0) {
        const yieldM2 = Number(config.yield_m2_per_hour || 150);
        bookingData.lawnZones.forEach(z => {
            if (z.quantity > 0) {
                totalHours += (z.quantity / yieldM2) * getDurationMultiplier(z.state);
            }
        });
    }

    // 2. Hedges (Yield: ml per hour)
    if (bookingData.hedgeZones && bookingData.hedgeZones.length > 0) {
        const yields = config.yield_ml_per_hour || {};
        bookingData.hedgeZones.forEach(z => {
            const height = (z.height || '0-2m') as string;
            const yieldMl = Number(yields[height] || yields['0-2m'] || 15);
            const length = z.length || 0;
            const faces = (z as any).faces_to_trim || 1;
            totalHours += (length * faces / yieldMl) * getDurationMultiplier(z.state);
        });
    }

    // 3. Palms (Yield: units per hour)
    if (bookingData.palmGroups && bookingData.palmGroups.length > 0) {
        const yields = config.yield_units_per_hour || {};
        bookingData.palmGroups.forEach(g => {
            const speciesYields = yields[g.species] || {};
            const yieldUnits = Number(speciesYields[g.height] || 1);
            totalHours += (g.quantity / yieldUnits) * getDurationMultiplier(g.state);
        });
        totalHours += 0.5; // Setup and tool preparation time
    }

    // 4. Trees (Yield: units per hour)
    if (bookingData.treeGroups && bookingData.treeGroups.length > 0) {
        const yields = config.yield_units_per_hour || {};
        bookingData.treeGroups.forEach((t: any) => {
            if (t.isFailed || t.analysisLevel === 3) return;
            const type = t.pruningType === 'estructural' ? 'estructural' : 'formacion';
            const band = resolveTreeBand(t) || 'medium';
            const yieldUnits = Number(yields[type]?.[band] || 1);
            totalHours += (1 / yieldUnits) * (t.difficultyHigh ? 1.5 : 1.0);
        });
    }

    // 5. Weeding (Yield: m2 per hour)
    if (bookingData.weedingZones && bookingData.weedingZones.length > 0) {
        const yieldM2 = Number(config.yield_m2_per_hour || 100);
        bookingData.weedingZones.forEach(z => {
            totalHours += (Number(z.area || 0) / yieldM2) * getDurationMultiplier(z.state);
        });
    }

    // 6. Shrubs (Yield: m2 per hour)
    if (bookingData.shrubGroups && bookingData.shrubGroups.length > 0) {
        const yields = config.yield_m2_per_hour || { pequeñas: 40, medianas: 20, grandes: 10 };
        bookingData.shrubGroups.forEach(z => {
            const size = (z.size || 'pequeñas') as keyof typeof yields;
            const yieldM2 = Number(yields[size] || 20);
            totalHours += (Number(z.area || 0) / yieldM2) * getDurationMultiplier(z.state || 'normal');
        });
    }

    // 7. Phytosanitary (Yield: various metrics)
    if (bookingData.phytosanitaryZones && bookingData.phytosanitaryZones.length > 0) {
        const yields = config.yields || {
            cesped_m2_per_hour: 200,
            setos_ml_per_hour: 50,
            palmeras_units_per_hour: 4,
            arboles_units_per_hour: 4,
            plantas_m2_per_hour: 100,
            endoterapia_units_per_hour: 2
        };
        bookingData.phytosanitaryZones.forEach(z => {
            const metrics = z.analysisMetrics;
            if (metrics) {
                if (metrics.cesped_m2) totalHours += metrics.cesped_m2 / Number(yields.cesped_m2_per_hour || 200);
                if (metrics.seto_bajo_medio_ml) totalHours += metrics.seto_bajo_medio_ml / Number(yields.setos_ml_per_hour || 50);
                if (metrics.seto_alto_ml) totalHours += metrics.seto_alto_ml / Number(yields.setos_ml_per_hour || 50);
                if (metrics.palmeras_ducha_peq_ud) totalHours += metrics.palmeras_ducha_peq_ud / Number(yields.palmeras_units_per_hour || 4);
                if (metrics.palmeras_ducha_med_ud) totalHours += metrics.palmeras_ducha_med_ud / Number(yields.palmeras_units_per_hour || 4);
                if (metrics.palmeras_ducha_alta_ud) totalHours += metrics.palmeras_ducha_alta_ud / Number(yields.palmeras_units_per_hour || 4);
                if (metrics.palmeras_cirugia_ud) totalHours += metrics.palmeras_cirugia_ud / Number(yields.palmeras_units_per_hour || 4);
                if (metrics.palmeras_endoterapia_troncos_ud) totalHours += metrics.palmeras_endoterapia_troncos_ud / Number(yields.endoterapia_units_per_hour || 2);
                if (metrics.arboles_peq_ud) totalHours += metrics.arboles_peq_ud / Number(yields.arboles_units_per_hour || 4);
                if (metrics.arboles_med_ud) totalHours += metrics.arboles_med_ud / Number(yields.arboles_units_per_hour || 4);
                if (metrics.arboles_gran_ud) totalHours += metrics.arboles_gran_ud / Number(yields.arboles_units_per_hour || 4);
            } else if (z.area > 0) {
                const affected = z.affectedType;
                if (affected === 'Palmeras') totalHours += z.area / Number(yields.palmeras_units_per_hour || 4);
                else if (affected === 'Árboles') totalHours += z.area / Number(yields.arboles_units_per_hour || 4);
                else if (affected === 'Setos') totalHours += z.area / Number(yields.setos_ml_per_hour || 50);
                else if (affected === 'Césped') totalHours += z.area / Number(yields.cesped_m2_per_hour || 200);
                else totalHours += z.area / Number(yields.plantas_m2_per_hour || 100);
            }
        });
    }

    // Global efficiency for large jobs (over 8 hours)
    let finalHours = totalHours;
    if (totalHours > 8) finalHours = totalHours * 0.9;
    
    // Minimum 1 hour, increments of 0.5h
    return Math.max(1, Math.ceil(finalHours * 2) / 2);
  };

  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
  const chips: string[] = [];
  const mapPhytosanitaryZonesForQuote = () => (bookingData.phytosanitaryZones || []).map((zone) => ({
    area: Number(zone.area || 0),
    type: zone.type,
    affectedType: (zone as any).affectedType,
    aboveTwoMeters: (zone as any).aboveTwoMeters,
    aboveThreeMeters: (zone as any).aboveThreeMeters,
    intent: (zone as any).intent,
    curativeTarget: (zone as any).curativeTarget,
    productPreference: (zone as any).productPreference,
    analysisMetrics: (zone as any).analysisMetrics
  }));
  const formatPhytosanitaryLabel = (item: any) => {
    if (item.quantity === 1 && item.unitLabel === 'ud' && typeof item.subtotal === 'number') {
      return `Zona ${item.zoneIndex + 1}: desglose detallado · base ${Math.ceil(item.subtotal)}€`;
    }
    const treatmentLabel = item.appliedTreatments?.length ? item.appliedTreatments.join(' + ') : 'sin tratamiento';
    return `Zona ${item.zoneIndex + 1}: ${item.affectedType} · ${item.quantity}${item.unitLabel} · ${treatmentLabel}`;
  };

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

  const findFirstAvailableDate = async (providerId: string, startDate: string, hoursNeeded: number) => {
    for (let i=0;i<14;i++) {
      const parts = startDate.split('-').map(Number);
      const dateStr = fmt(addDays(new Date(parts[0], parts[1]-1, parts[2]), i));
      const blocks = await availCompat.getGardenerAvailability(providerId, dateStr);
      const hours = ((blocks||[]) as any[]).filter((b:any)=>b.is_available).map((b:any)=>b.hour_block);
      const set = new Set<number>(hours);
      for (const h of hours) {
        let fits = true;
        const dur = getEstimatedHours(providerId);
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
    const hoursNeeded = getEstimatedHours(providerId);
    try {
      const blocks = await availCompat.getGardenerAvailability(providerId, selectedDate);
      const hours = ((blocks||[]) as any[]).filter((b:any)=>b.is_available).map((b:any)=>b.hour_block);
      const set = new Set<number>(hours);
      let hasValid = false;
      const dur = getEstimatedHours(providerId);
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
      const dur = getEstimatedHours(providerId);
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
    const cacheKey = `${providerId}-${y}-${m}-${getEstimatedHours(providerId)}`;
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
      const dur = getEstimatedHours(providerId);
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
      const cacheKey = `${selectedProvider}-${selectedDate}-${getEstimatedHours(selectedProvider)}`;
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
      setLoading(true);
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

        const gardenerIds = Array.from(new Set((priceRows || []).map((p: any) => p.gardener_id)));
        
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
        setPrices(map);
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

        // Ordenar por disponibilidad más próxima Y cobertura (Full coverage first)
        const today = new Date();
        const addDaysLocal = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
        const windowDays = 14;
        const earliestMap: Record<string, number> = {};
        await Promise.all(list.map(async (p) => {
          const hoursNeeded = getEstimatedHours(p.user_id);
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
        
        // Ensure selected provider is valid for the current filters
        const stillValid = list.some(p => p.user_id === selectedProvider);
        if (list.length > 0) {
            if (!selectedProvider || !stillValid) {
                setSelectedProvider(list[0].user_id);
            }
        } else {
            setSelectedProvider('');
        }
      } catch (e) {
        setProviders([]);
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
    bookingData.lawnZones ? JSON.stringify(bookingData.lawnZones.map(z => ({s: z.species, q: z.quantity, st: z.state}))) : ''
  ]);

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
    const config = configs[gardenerId];
    if (!config) return 0;

    const applyMinimumPrice = (calculatedPrice: number) => {
        const rounded = Math.ceil(calculatedPrice);
        const gardenerMin = Number(config?.minimum_price || 0);
        // Implement global minimum price per service
        const effectiveMin = Math.max(gardenerMin, globalMinPrice);
        
        if (effectiveMin > 0 && rounded > 0 && rounded < effectiveMin) {
            return Math.ceil(effectiveMin);
        }
        return rounded;
    };

    // Fork between hourly and quantity modes
    // NOTE: Tree and Palm pruning are EXCLUDED from hourly pricing as per professional logic
    // because they require specific equipment and risks not covered by a standard hourly rate.
    const hasTreeOrPalm = bookingData.serviceIds.some(id => 
        id.toLowerCase().includes('poda-arboles') || 
        id.toLowerCase().includes('poda-palmeras') ||
        id.toLowerCase().includes('tree') ||
        id.toLowerCase().includes('palm')
    );
    
    if (config.pricing_method === 'per_hour' && config.hourly_rate > 0 && !hasTreeOrPalm) {
        // Hours are yield-based (calculated in getEstimatedHours)
        const totalHours = getEstimatedHours(gardenerId);
        return applyMinimumPrice(totalHours * config.hourly_rate);
    }

    // Quantity-based logic (Default for professional services)
    let total = 0;
    const globalWaste = bookingData.wasteRemoval !== undefined ? bookingData.wasteRemoval : true;

    // 1. Palms
    if (bookingData.palmGroups && bookingData.palmGroups.length > 0) {
        const groups: PalmPricingGroup[] = bookingData.palmGroups.map(g => ({
            species: g.species,
            height: g.height,
            quantity: g.quantity || 1,
            state: g.state || 'normal',
            hasPhytosanitary: g.hasPhytosanitary ?? g.needsPhytosanitary,
            hasTrunkPeeling: g.hasTrunkPeeling ?? g.needsTrunkFinish,
            needsPhytosanitary: g.needsPhytosanitary,
            needsTrunkFinish: g.needsTrunkFinish,
            hasAccessDifficulty: g.hasAccessDifficulty
        }));
        total += calculatePalmPriceEngine(groups, config, globalWaste);
    }
    
    // 2. Hedges
    if (bookingData.hedgeZones && bookingData.hedgeZones.length > 0) {
        let hedgeTotal = 0;
        for (const zone of bookingData.hedgeZones) {
            const lengthForPricing = Number((zone as any).length_pricing_m ?? zone.length ?? 0);
            const faces = Number((zone as any).faces_to_trim ?? 1);
            const height = (zone.height || '0-2m') as string;
            
            let base = Number(config.pricing_matrix?.[height] || 0);
            if (base <= 0) base = Number(config.species_prices?.[zone.type]?.[height] || 0);
            
            if (base <= 0) continue;

            const surcharges = config.condition_surcharges || { media: 20, alta: 50 };
            const s = (zone.state || 'normal').toLowerCase();
            let statePercent = 0;
            if (s.includes('alta') || s.includes('muy_descuidado')) statePercent = surcharges.alta || 50;
            else if (s.includes('media') || s.includes('descuidado')) statePercent = surcharges.media || 20;

            const stateMult = 1 + (statePercent / 100);
            let wasteMult = 1;
            if (globalWaste) wasteMult = 1 + ((config.waste_removal?.percentage || 0) / 100);

            hedgeTotal += base * lengthForPricing * faces * stateMult * wasteMult;
        }
        total += hedgeTotal;
    }

    // 3. Trees
    if (bookingData.treeGroups && bookingData.treeGroups.length > 0 && isTreePruningConfig(config)) {
        const trees = (bookingData.treeGroups || [])
          .filter((t: any) => !(t.isFailed || t.analysisLevel === 3))
          .map((t: any) => ({
            id: String(t.id),
            pruningType: mapTreePruningType(t.pruningType),
            sizeBand: resolveTreeBand(t),
            dificultad_alta: t.difficultyHigh,
            nivel_analisis: t.analysisLevel
          }));
        if (trees.length > 0) {
            const quote = calculateTreePruningQuoteForTrees(config, trees, globalWaste);
            if (quote.isProfessionalSuitable) total += quote.totalPrice;
        }
    }

    // 4. Weeding
    if (bookingData.weedingZones && bookingData.weedingZones.length > 0) {
        const quote = calculateWeedingQuote({
          zones: bookingData.weedingZones.map((z) => ({ id: z.id, area: Number(z.area || 0), state: z.state, applyHerbicide: Boolean(z.applyHerbicide) })),
          config,
          globalWaste
        });
        total += quote.finalPrice;
    }

    // 5. Lawn
    if ((bookingData.lawnSpecies || (bookingData.lawnZones && bookingData.lawnZones.length > 0)) && !config.height_prices) {
        let lawnSubtotal = 0;
        const zones = bookingData.lawnZones || [{ state: 'normal', quantity: bookingData.aiQuantity || 0 }];
        const baseRate = config.price_per_m2 || 0;
        
        if (baseRate > 0) {
            zones.forEach(z => {
                const s = (z.state || 'normal').toLowerCase();
                const surcharges = config.condition_surcharges || {};
                let statePercent = 0;
                if (s.includes('muy')) statePercent = surcharges.muy_descuidado || 50;
                else if (s.includes('descuidad')) statePercent = surcharges.descuidado || 20;
                
                const stateMult = 1 + (statePercent / 100);
                let wasteMult = 1;
                if (globalWaste) wasteMult = 1 + ((config.waste_removal?.percentage || 0) / 100);
                
                lawnSubtotal += baseRate * z.quantity * stateMult * wasteMult;
            });
        }
        total += lawnSubtotal;
    }

    // 6. Shrubs
    if (bookingData.shrubGroups && bookingData.shrubGroups.length > 0) {
        let shrubTotal = 0;
        const prices = config.prices_per_m2 || { pequeñas: 10, medianas: 15, grandes: 25 };
        bookingData.shrubGroups.forEach(z => {
            const size = (z.size || 'pequeñas') as keyof typeof prices;
            const pricePerM2 = prices[size] || 15;
            let line = Number(z.area || 0) * pricePerM2;
            
            const s = (z.state || 'normal').toLowerCase();
            const surcharges = config.condition_surcharges || { media: 20, alta: 50 };
            let statePercent = 0;
            if (s.includes('muy')) statePercent = surcharges.alta || 50;
            else if (s.includes('descuidad')) statePercent = surcharges.media || 20;

            const stateMult = 1 + (statePercent / 100);
            let wasteMult = 1;
            if (globalWaste) wasteMult = 1 + ((config.waste_removal?.percentage || 0) / 100);

            shrubTotal += line * stateMult * wasteMult;
        });
        total += shrubTotal;
    }

    // 7. Phytosanitary
    if (bookingData.phytosanitaryZones && bookingData.phytosanitaryZones.length > 0) {
        const phytoResult = calculatePhytosanitaryQuote({
            zones: mapPhytosanitaryZonesForQuote(),
            config: config,
            globalWaste: globalWaste
        });
        total += phytoResult.total;
    }

    return applyMinimumPrice(total);
  };

  const handleProviderSelect = (providerId: string) => { setSelectedProvider(providerId); };

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
      const isPhytosanitary = Array.isArray(bookingData.phytosanitaryZones) && bookingData.phytosanitaryZones.length > 0;
      const selectedConfig = configs[selectedProvider];
      const globalWaste = bookingData.wasteRemoval !== undefined ? bookingData.wasteRemoval : true;
      const phytosanitaryQuote = (isPhytosanitary && selectedConfig)
        ? calculatePhytosanitaryQuote({
            zones: mapPhytosanitaryZonesForQuote(),
            config: selectedConfig,
            globalWaste
          })
        : null;
      const phytosanitaryBreakdown = phytosanitaryQuote
        ? phytosanitaryQuote.breakdown
            .map((item) => ({
              desc: item.reason
                ? `${formatPhytosanitaryLabel(item)} · ${item.reason}`
                : formatPhytosanitaryLabel(item),
              price: Math.ceil(Number(item.lineTotal || 0))
            }))
        : [];
      if (phytosanitaryQuote && phytosanitaryQuote.minimumFeeApplied) {
        phytosanitaryBreakdown.push({
          desc: `Ajuste por importe mínimo (${Math.ceil(phytosanitaryQuote.minimumFee)}€)`,
          price: Math.ceil(phytosanitaryQuote.minimumFee)
        });
      }
      const finalPrice = phytosanitaryQuote 
        ? Math.max(phytosanitaryQuote.final_price, globalMinPrice)
        : computePrice(selectedProvider);

      if (phytosanitaryQuote && finalPrice > phytosanitaryQuote.final_price) {
        phytosanitaryBreakdown.push({
          desc: `Ajuste por importe mínimo global (${globalMinPrice}€)`,
          price: globalMinPrice
        });
      }

      // Aseguramos que se guarde la fecha seleccionada y el proveedor
      setBookingData({ 
        providerId: selectedProvider, 
        palmGroups: groupsToKeep, // Sanitizar payload
        estimatedHours: getEstimatedHours(selectedProvider), // Actualizar el estimatedHours
        totalPrice: finalPrice,
        preferredDate: selectedDate,
        priceBreakdown: phytosanitaryBreakdown
      }); 
      setCurrentStep(4); 
    } 
  };

  const handleSelectStartHour = async (hour: number) => {
    if (!selectedProvider || !selectedDate) return;
    const dur = getEstimatedHours(selectedProvider);

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
                  onClick={() => openAvailability(p.user_id)}
                  className={`min-w-[240px] bg-white rounded-2xl shadow-sm p-4 border-2 text-left relative transition-all flex flex-col gap-3 ${
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
                      <img src={p.avatar_url} alt={p.full_name} className="w-12 h-12 rounded-full object-cover shrink-0" />
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
                                  <span>€{price}</span>
                                  {isPartial && <span className="text-xs text-amber-700 font-normal">(parcial)</span>}
                              </div>
                            );
                        })()}
                      </div>
                      
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
                              {coverage.missingGroups.length > 2 && <div>+ {coverage.missingGroups.length - 2} más...</div>}
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
          {/* Encabezado selector */}
          <div className="mb-3">
            <div className="text-sm font-semibold text-gray-900">
              Seleccionar fecha y hora 
              <span className="font-normal text-gray-500 ml-1">
                (la duración del servicio es de {getEstimatedHours(selectedProvider)} h)
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
