import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronLeft, Star, Clock, MapPin, Check, AlertTriangle, TreePine, SearchX, Sprout } from 'lucide-react';
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
  const daysCacheRef = useRef<Map<string, Array<{ date: string; day: number; disabled: boolean; count: number }>>>(new Map());
  const hoursCacheRef = useRef<Map<string, number[]>>(new Map());
  const reqIdRef = useRef<number>(0);

  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
  const chips: string[] = [];

  // Helper function to robustly find palm price
  const findPalmPrice = (config: any, species: string, height: string): number => {
    // 1. Check for valid configuration
    if (!config || !config.height_prices) {
        // Fallback: Check species_prices (legacy/base) if height_prices is missing
        if (config?.species_prices?.[species] && typeof config.species_prices[species] === 'number') {
            return config.species_prices[species];
        }
        return 0;
    }

    // 2. Try exact match in height_prices
    if (config.height_prices[species]?.[height]) {
        return config.height_prices[species][height];
    }

    // 3. Normalize species
    let speciesKey = species;
    const speciesLower = species.toLowerCase();
    
    // Map of common AI outputs/User inputs to Config Keys
    const speciesMap: Record<string, string> = {
        'phoenix': 'Phoenix (datilera o canaria)',
        'datilera': 'Phoenix (datilera o canaria)',
        'canaria': 'Phoenix (datilera o canaria)',
        'washingtonia': 'Washingtonia',
        'roystonea': 'Roystonea regia (cubana)',
        'cubana': 'Roystonea regia (cubana)',
        'syagrus': 'Syagrus romanzoffiana (cocotera)',
        'cocotera': 'Syagrus romanzoffiana (cocotera)',
        'trachycarpus': 'Trachycarpus fortunei',
        'fortunei': 'Trachycarpus fortunei',
        'livistona': 'Livistona',
        'kentia': 'Kentia (palmito)',
        'palmito': 'Kentia (palmito)',
        'roebelenii': 'Phoenix roebelenii(pigmea)',
        'pigmea': 'Phoenix roebelenii(pigmea)',
        'cycas': 'cycas revoluta (falsa palmera)',
        'revoluta': 'cycas revoluta (falsa palmera)',
        'falsa': 'cycas revoluta (falsa palmera)'
    };

    // Find matching species key via map
    let found = false;
    for (const [key, val] of Object.entries(speciesMap)) {
        if (speciesLower.includes(key)) {
            speciesKey = val;
            found = true;
            break;
        }
    }

    // If not found via map, try partial match against actual config keys (height_prices)
    if (!found && !config.height_prices[speciesKey]) {
        const configKeys = Object.keys(config.height_prices);
        const match = configKeys.find(k => k.toLowerCase().includes(speciesLower) || speciesLower.includes(k.toLowerCase()));
        if (match) {
            speciesKey = match;
            found = true;
        }
    }

    // Check if species exists in config (height_prices)
    if (!config.height_prices[speciesKey]) {
        // Last resort: Check species_prices (base)
        if (config.species_prices?.[speciesKey] && typeof config.species_prices[speciesKey] === 'number') {
            return config.species_prices[speciesKey];
        }
        console.warn(`[findPalmPrice] Species not found in config: ${species} (mapped to ${speciesKey})`);
        return 0;
    }

    // 4. Try normalized species with exact height
    if (config.height_prices[speciesKey][height]) {
        return config.height_prices[speciesKey][height];
    }

    // 5. Parse height number from string for range matching
    // Handle "X-Y" format in input (e.g. "4-8m")
    const matches = height.match(/(\d+(?:\.\d+)?)/g);
    let heightNum = 0;
    if (matches && matches.length > 0) {
        if (matches.length === 1) {
             heightNum = parseFloat(matches[0]);
        } else {
             // If range provided by AI (e.g. 4-8), take average
             const v1 = parseFloat(matches[0]);
             const v2 = parseFloat(matches[1]);
             heightNum = (v1 + v2) / 2;
        }
    } else {
         console.warn(`[findPalmPrice] Could not parse height: ${height}`);
         // Fallback to base price if height parse fails
         if (config.species_prices?.[speciesKey]) return config.species_prices[speciesKey];
         return 0; 
    }

    // Find correct range in height_prices[speciesKey]
    const ranges = Object.keys(config.height_prices[speciesKey]);
    let bestRange = '';

    for (const range of ranges) {
        if (range.includes('+')) {
            const min = parseFloat(range.replace('+', ''));
            if (heightNum >= min) {
                bestRange = range;
            }
        } else if (range.includes('-')) {
            const [min, max] = range.split('-').map(Number);
            if (heightNum >= min && heightNum < max) {
                bestRange = range;
                break; // Exact range found
            }
        }
    }
    
    if (bestRange) {
        return config.height_prices[speciesKey][bestRange] || 0;
    }

    // If no specific height found, try fallback to base (species_prices)
    if (config.species_prices?.[speciesKey]) {
        return config.species_prices[speciesKey];
    }

    console.warn(`[findPalmPrice] No matching height range for: ${height} (${heightNum}m) in species ${speciesKey}`);
    return 0;
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
      setLoading(true);
      try {
        const primaryServiceId = bookingData.serviceIds[0];
        
        let query = supabase
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
        } else if (bookingData.lawnZones && bookingData.lawnZones.length > 0) {
          // Filter by ALL unique species in zones
          const speciesList = Array.from(new Set(bookingData.lawnZones.map(z => z.species)));
          query = query.contains('additional_config', { selected_species: speciesList });
        } else if (bookingData.lawnSpecies) {
          // Filter by lawn species
          query = query.contains('additional_config', { selected_species: [bookingData.lawnSpecies] });
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
        const coverageMap: Record<string, { isFull: boolean; coveredCount: number; totalCount: number; missingGroups: any[] }> = {};

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
        const { data: serviceInfo } = await supabase
            .from('services')
            .select('name')
            .eq('id', primaryServiceId)
            .single();

        if (serviceInfo?.name === 'Poda de árboles') {
            list = list.filter(p => {
                const c = configMap[p.user_id];
                if (!c) return false;

                // 1. Check Mandatory Fields Presence (must not be null/undefined)
                if (c.structuralHourlyRate == null) return false;
                if (c.shapingHourlyRate == null) return false;
                if (c.ladderModifier == null) return false;
                if (c.climbingModifier == null) return false;
                if (c.wasteRemovalModifier == null) return false;

                // 2. Check Values Validity
                // Hourly rates MUST be > 0
                if (c.structuralHourlyRate <= 0) return false;
                if (c.shapingHourlyRate <= 0) return false;

                // Modifiers MUST be >= 0 (0% is valid, negative is not)
                if (c.ladderModifier < 0) return false;
                if (c.climbingModifier < 0) return false;
                if (c.wasteRemovalModifier < 0) return false;

                return true;
            });
        }

        // Filter list: Remove gardeners with 0 coverage for palms
        if (bookingData.palmGroups && bookingData.palmGroups.length > 0) {
             list = list.filter(p => coverageMap[p.user_id]?.coveredCount > 0);
        }

        // Ordenar por disponibilidad más próxima Y cobertura (Full coverage first)
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
    // Debug Log Start
    console.log(`[ComputePrice] Calculating for Gardener: ${gardenerId}`);
    console.log(`[ComputePrice] BookingData:`, JSON.stringify({
        serviceIds: bookingData.serviceIds,
        hedgeZones: bookingData.hedgeZones,
        palmGroups: bookingData.palmGroups,
        treeGroups: bookingData.treeGroups,
        shrubGroups: bookingData.shrubGroups,
        clearingZones: bookingData.clearingZones,
        fumigationZones: bookingData.fumigationZones,
        lawnZones: bookingData.lawnZones
    }, null, 2));

    const config = configs[gardenerId];
    console.log(`[ComputePrice] Config found:`, config);

    if (!config) {
        console.warn(`[ComputePrice] No config for gardener ${gardenerId}`);
        return 0;
    }

    // Palms (Poda de palmeras)
    if (bookingData.palmGroups && bookingData.palmGroups.length > 0 && config) {
        // GLOBAL OVERRIDE
        const globalWaste = bookingData.wasteRemoval !== undefined ? bookingData.wasteRemoval : true;
        
        // Ensure species_prices exists
        if (!config.species_prices) return 0;

        let total = 0;
        
        for (const group of bookingData.palmGroups) {
            // Price = Base Price (Species + Height) * Quantity * Multipliers
            const species = group.species;
            const height = group.height;
            const quantity = group.quantity || 1;
            
            // Lookup base price
            // Use robust helper function
            const basePrice = findPalmPrice(config, species, height);
            
            if (basePrice <= 0) {
                console.warn(`[ComputePrice] Base price 0 for ${species} / ${height}`);
                continue;
            }

            // Condition Surcharge
            const state = (group.state || 'normal').toLowerCase();
            const surcharges = config.condition_surcharges || { normal: 0, neglected: 15, overgrown: 30 };
            let statePercent = 0;
            
            // Map state strings to config keys
            // Config keys usually: 'normal', 'descuidada', 'muy_descuidada' (feminine in config)
            if (state.includes('muy') && (state.includes('descuidado') || state.includes('mal'))) {
                statePercent = surcharges.muy_descuidado || surcharges.muy_descuidada || surcharges.overgrown || 0;
            } else if (state.includes('descuidado') || state.includes('mal')) {
                statePercent = surcharges.descuidado || surcharges.descuidada || surcharges.neglected || 0;
            } else {
                statePercent = surcharges.normal || 0;
            }
            
            const stateMult = 1 + (statePercent / 100);

            // Waste Removal Surcharge
            let wastePercent = 0;
            if (globalWaste) {
                wastePercent = config.wasteRemovalModifier !== undefined 
                    ? config.wasteRemovalModifier 
                    : (config.waste_removal?.percentage || 0);
            }
            const wasteMult = 1 + (wastePercent / 100);
            
            // Final Calculation for this group
            total += basePrice * quantity * stateMult * wasteMult;
        }
        
        return Math.ceil(total);
    }
    
    // Fallback: Legacy single-group logic (for backward compatibility or if groups are empty but fields exist)
    if (bookingData.palmSpecies && config) {
        const species = bookingData.palmSpecies;
        const height = bookingData.palmHeight;
        const state = bookingData.palmState || 'normal';
        const waste = bookingData.wasteRemoval !== undefined ? bookingData.wasteRemoval : bookingData.palmWasteRemoval;
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

    // --- New Service Pricing Logic ---

    // Hedges
    if (bookingData.hedgeZones && bookingData.hedgeZones.length > 0) {
        if (!config || !config.species_prices) {
            console.warn('[ComputePrice] Hedges: Missing config or species_prices', config);
            return 0;
        }
        
        // GLOBAL OVERRIDE
        const globalWaste = bookingData.wasteRemoval !== undefined ? bookingData.wasteRemoval : true;

        console.log('[ComputePrice] Starting Hedge Calculation...');
        let total = 0;
        for (const zone of bookingData.hedgeZones) {
            const { type, height, length, access } = zone;
            console.log(`[ComputePrice] Processing Zone:`, zone);
            
            // Config keys match the values stored in bookingData (verified in Configurator)
            const base = config.species_prices[type]?.[height] || 0;
            console.log(`[ComputePrice] Base price lookup for type='${type}', height='${height}':`, base);
            
            if (base <= 0) {
                console.warn(`[ComputePrice] Invalid base price (${base}) for type='${type}', height='${height}'`);
                continue;
            }
            
            // Condition Surcharge
            const surcharges = config.condition_surcharges || { descuidado: 20, muy_descuidado: 50 };
            let statePercent = 0;
            const s = (zone.state || 'normal').toLowerCase();
            
            if (s.includes('muy') && s.includes('descuidado')) {
                statePercent = surcharges.muy_descuidado || 0;
            } else if (s.includes('descuidado')) {
                statePercent = surcharges.descuidado || 0;
            }
            
            const stateMult = 1 + (statePercent / 100);
            
            // Waste
            let wasteMult = 1;
            if (globalWaste) {
                wasteMult = 1 + ((config.waste_removal?.percentage || 0) / 100);
            }
            
            const lineTotal = base * length * stateMult * wasteMult;
            console.log(`[ComputePrice] Line Total: ${lineTotal} (Base: ${base}, Length: ${length}, StateMult: ${stateMult}, WasteMult: ${wasteMult})`);
            
            total += lineTotal;
        }
        console.log(`[ComputePrice] Final Hedge Total: ${Math.ceil(total)}`);
        return Math.ceil(total);
    }

    // Trees
    if (bookingData.treeGroups && bookingData.treeGroups.length > 0 && config) {
        // GLOBAL OVERRIDE
        const globalWaste = bookingData.wasteRemoval !== undefined ? bookingData.wasteRemoval : true;
        
        let total = 0;
        
        // Iterate over EACH tree group (individual tree from AI)
        for (const group of bookingData.treeGroups) {
            // SKIP FAILED ANALYSIS (Level 3)
            if ((group as any).isFailed || group.analysisLevel === 3) continue;

            // Use per-tree estimated hours from AI, NO FALLBACK
            const treeHours = group.estimatedHours;
            
            // If no hours, treat as failed (skip)
            if (!treeHours || treeHours <= 0) continue;
            
            const pruningType = group.pruningType || 'structural';
            const access = group.access || 'normal';

            // Hourly Rate based on Type
            let hourlyRate = 0;
            if (pruningType === 'shaping') {
                hourlyRate = config.shapingHourlyRate;
            } else {
                hourlyRate = config.structuralHourlyRate;
            }

            // Validacion estricta: Si no hay precio o es <= 0, no calcular
            if (!hourlyRate || hourlyRate <= 0) continue;

            // Access Surcharge
            let accessPercent = 0;
            const legacySurcharges = config.access_surcharges || {};
            
            if (access === 'medio') { // Escalera
                accessPercent = config.ladderModifier != null 
                    ? config.ladderModifier 
                    : (legacySurcharges.medio || 0);
            } else if (access === 'dificil') { // Trepa
                accessPercent = config.climbingModifier != null 
                    ? config.climbingModifier 
                    : (legacySurcharges.dificil || 0);
            }
            
            // Waste Removal Surcharge
            let wastePercent = 0;
            if (globalWaste) {
                wastePercent = config.wasteRemovalModifier != null 
                    ? config.wasteRemovalModifier 
                    : (config.waste_removal?.percentage || 0);
            }
            
            const totalMultiplier = 1 + (accessPercent / 100) + (wastePercent / 100);
            
            total += treeHours * hourlyRate * totalMultiplier;
        }
        
        return Math.ceil(total);
    }

    // Shrubs
    if (bookingData.shrubGroups && bookingData.shrubGroups.length > 0 && config && config.species_prices) {
        // GLOBAL OVERRIDE: La retirada de restos es una configuración global.
        const globalWaste = bookingData.wasteRemoval !== undefined ? bookingData.wasteRemoval : true;
        
        let total = 0;
        for (const group of bookingData.shrubGroups) {
            const { type, size, quantity, state } = group;
            const base = config.species_prices[type]?.[size] || 0;
            if (base <= 0) continue;
            
            // Condition Multiplier
            const surcharges = config.condition_multipliers || { normal: 0, neglected: 15, overgrown: 30 };
            let conditionPercent = 0;
            const s = (state || 'normal').toLowerCase();
            
            if (s.includes('muy') && s.includes('descuidado')) conditionPercent = surcharges.overgrown;
            else if (s.includes('descuidado')) conditionPercent = surcharges.neglected;
            else conditionPercent = surcharges.normal;

            const conditionMult = 1 + (conditionPercent / 100);

            let wasteMult = 1;
            if (globalWaste) {
                wasteMult = 1 + ((config.waste_removal?.percentage || 0) / 100);
            }
            
            total += base * quantity * conditionMult * wasteMult;
        }
        return Math.ceil(total);
    }

    // Clearing
    if (bookingData.clearingZones && bookingData.clearingZones.length > 0 && config && config.type_prices) {
        // GLOBAL OVERRIDE
        const globalWaste = bookingData.wasteRemoval !== undefined ? bookingData.wasteRemoval : true;
        
        const totalArea = bookingData.clearingZones.reduce((acc, z) => acc + (z.area || 0), 0);
        let range = '0-50';
        if (totalArea > 200) range = '200+';
        else if (totalArea > 50) range = '50-200';
        
        let total = 0;
        for (const zone of bookingData.clearingZones) {
            const { type, area } = zone;
            const baseRate = config.type_prices[type]?.[range] || 0;
            
            let subtotal = 0;
            if (range === '0-50') subtotal = baseRate; // Fixed price
            else subtotal = baseRate * area;
            
            let wasteMult = 1;
            if (globalWaste) {
                wasteMult = 1 + ((config.waste_removal?.percentage || 0) / 100);
            }
            
            total += subtotal * wasteMult;
        }
        return Math.ceil(total);
    }

    // Fumigation
    if (bookingData.fumigationZones && bookingData.fumigationZones.length > 0 && config && config.type_prices) {
        // GLOBAL OVERRIDE
        const globalWaste = bookingData.wasteRemoval !== undefined ? bookingData.wasteRemoval : true;

        const totalArea = bookingData.fumigationZones.reduce((acc, z) => acc + (z.area || 0), 0);
        let range = '0-50';
        if (totalArea > 200) range = '200+';
        else if (totalArea > 50) range = '50-200';
        
        let total = 0;
        for (const zone of bookingData.fumigationZones) {
            const { type, area } = zone;
            const baseRate = config.type_prices[type]?.[range] || 0;
            
            let subtotal = 0;
            if (range === '0-50') subtotal = baseRate; // Fixed price
            else subtotal = baseRate * area;
            
            let wasteMult = 1;
            if (globalWaste) {
                wasteMult = 1 + ((config.waste_removal?.percentage || 0) / 100);
            }
            
            total += subtotal * wasteMult;
        }
        return Math.ceil(total);
    }

    // 2. Lógica para Corte de Césped (Lawn Service)
    // Detectamos si es césped por la presencia de lawnSpecies o lawnZones y la estructura de la config
    if ((bookingData.lawnSpecies || (bookingData.lawnZones && bookingData.lawnZones.length > 0)) && config && config.species_prices && !config.height_prices) {
        
        // Unificar zonas (Legacy + New Model)
        let zones: Array<{ species: string; state: string; quantity: number; wasteRemoval: boolean }> = [];
        
        // GLOBAL OVERRIDE: La retirada de restos es una configuración global.
        // Si el usuario la desactiva en DetailsPage, aplica a todas las zonas.
        const globalWaste = bookingData.wasteRemoval !== undefined ? bookingData.wasteRemoval : true;

        if (bookingData.lawnZones && bookingData.lawnZones.length > 0) {
            zones = bookingData.lawnZones.map(z => ({
                species: z.species,
                state: z.state,
                quantity: z.quantity,
                wasteRemoval: globalWaste
            }));
        } else if (bookingData.lawnSpecies) {
            // Fallback Legacy
            let state = 'normal';
            if (bookingData.aiDifficulty === 2) state = 'descuidado';
            if (bookingData.aiDifficulty === 3) state = 'muy_descuidado';
            
            zones.push({
                species: bookingData.lawnSpecies,
                state: state,
                quantity: bookingData.aiQuantity || 0,
                wasteRemoval: globalWaste
            });
        }

        // 1. Calcular superficie total
        const totalArea = zones.reduce((acc, z) => acc + (z.quantity || 0), 0);
        
        // 2. Determinar rango de superficie basado en el TOTAL
        let range = '0-50';
        if (totalArea > 200) range = '200+';
        else if (totalArea > 50) range = '50-200';

        // 3. Agrupar zonas por Especie + Estado + WasteRemoval (para sumar superficies)
        const groups: Record<string, { species: string; state: string; wasteRemoval: boolean; quantity: number }> = {};
        
        for (const z of zones) {
            if (z.quantity <= 0) continue;
            // Clave única para agrupación
            const key = `${z.species}|${z.state}|${z.wasteRemoval}`;
            
            if (!groups[key]) {
                groups[key] = { 
                    species: z.species, 
                    state: z.state, 
                    wasteRemoval: z.wasteRemoval, 
                    quantity: 0 
                };
            }
            groups[key].quantity += z.quantity;
        }

        // 4. Calcular precio para cada grupo usando el rango TOTAL
        let totalCost = 0;
        
        for (const key in groups) {
            const group = groups[key];
            const baseRate = config.species_prices[group.species]?.[range] || 0;
            
            // Calcular subtotal del grupo
            let subtotal = 0;
            if (range === '0-50') {
                // Si es rango fijo (0-50), ¿se aplica por grupo o se prorratea?
                // Interpretación: "Cada combinación especie + estado se calcula de forma independiente."
                // Si el rango es 0-50, asumimos que el precio base es el coste mínimo para ese servicio.
                subtotal = baseRate;
                
                // AJUSTE: Si tenemos múltiples grupos en rango 0-50 (ej: 10m2 A + 10m2 B = 20m2 Total),
                // aplicar el precio fijo completo a cada uno podría duplicar costes excesivamente si es "visita mínima".
                // Sin embargo, si son especies distintas, son trabajos distintos.
                // Si es la misma especie y estado, ya están agrupados.
                // Por tanto, aplicamos el precio base al grupo.
            } else {
                subtotal = baseRate * group.quantity;
            }
            
            if (subtotal <= 0) continue;

            // Surcharges
            // State
            const surcharges = config.condition_surcharges || {};
            let stateSurchargePercent = 0;
            
            // Normalizar keys de estado para coincidir con config
            // Config keys: 'descuidado', 'muy_descuidado'
            // Zone state: 'normal', 'descuidado', 'muy_descuidado' (o 'descuidada'?)
            // Mapeamos variaciones comunes
            const s = (group.state || 'normal').toLowerCase();
            if (s.includes('muy') && s.includes('descuidad')) {
                stateSurchargePercent = surcharges.muy_descuidado || 0;
            } else if (s.includes('descuidad') && !s.includes('muy')) {
                 stateSurchargePercent = surcharges.descuidado || 0;
            }
            
            const stateMult = 1 + (stateSurchargePercent / 100);

            // Waste
            let wasteMult = 1;
            if (globalWaste) {
                const wastePercent = config.waste_removal?.percentage || 0;
                wasteMult = 1 + (wastePercent / 100);
            }

            totalCost += subtotal * stateMult * wasteMult;
        }

        return Math.ceil(totalCost);
    }

    // 3. Lógica por defecto (otros servicios)
    const unitPrice = prices[gardenerId] || 0;
    const qty = bookingData.aiQuantity || 0;
    
    // Apply surcharges from config if available
    let mult = 1.0;
    if (config) {
        const difficulty = bookingData.aiDifficulty || 1;
        const surcharges = config.condition_surcharges || {};
        
        let stateSurcharge = 0;
        if (difficulty === 3) { // Muy descuidado
            stateSurcharge = surcharges.muy_descuidado !== undefined ? surcharges.muy_descuidado : 50;
        } else if (difficulty === 2) { // Descuidado
            stateSurcharge = surcharges.descuidado !== undefined ? surcharges.descuidado : 20;
        }
        
        const stateMult = 1 + (stateSurcharge / 100);
        
        // Waste Removal Surcharge
        let wasteMult = 1;
        const waste = bookingData.wasteRemoval !== undefined ? bookingData.wasteRemoval : true;
        if (waste) {
             const wastePercent = config.waste_removal?.percentage || 0;
             wasteMult = 1 + (wastePercent / 100);
        }
        
        mult = stateMult * wasteMult;
    } else {
        // Fallback to legacy hardcoded multipliers if no config found
        mult = bookingData.aiDifficulty ? (bookingData.aiDifficulty === 3 ? 1.6 : bookingData.aiDifficulty === 2 ? 1.3 : 1.0) : 1.0;
        // Legacy waste removal was implicit in price or not handled well for generic services previously
        // We leave it as is for backward compatibility if no config exists
    }

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
              No hay jardineros disponibles
            </h3>
            <p className="text-gray-600 mb-6 leading-relaxed">
              Actualmente no hay ningún jardinero disponible para este servicio en tu zona. Por favor, intenta nuevamente más tarde.
            </p>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto scrollbar-hide [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {providers.map((p) => {
              const selected = selectedProvider === p.user_id;
              const coverage = palmCoverageMap[p.user_id];
              const isPartial = coverage && !coverage.isFull;

              return (
                <button
                  key={p.user_id}
                  onClick={() => openAvailability(p.user_id)}
                  className={`min-w-[240px] bg-white rounded-2xl shadow-sm p-3 border-2 text-left relative overflow-hidden transition-all ${
                    selected ? 'border-green-600 bg-green-50' : isPartial ? 'border-amber-200 bg-amber-50/30 hover:border-amber-300' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {/* Partial Tag */}
                  {isPartial && (
                      <div className="absolute top-0 right-0 bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded-bl-lg border-b border-l border-amber-200">
                          PARCIAL ({coverage.coveredCount}/{coverage.totalCount})
                      </div>
                  )}

                  <div className="flex items-center gap-3">
                    {p.avatar_url ? (
                      <img src={p.avatar_url} alt={p.full_name} className="w-12 h-12 rounded-full object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold">
                        {p.full_name.charAt(0)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 truncate pr-4">{p.full_name}</div>
                      <div className="text-sm text-gray-700 font-medium">
                        {(() => {
                            const price = computePrice(p.user_id);
                            if (price <= 0) return <span className="text-gray-400 font-normal">No disponible</span>;
                            return (
                              <div className="flex items-baseline gap-1">
                                  <span>€{price}</span>
                                  {isPartial && <span className="text-[10px] text-amber-600 font-normal">(parcial)</span>}
                              </div>
                            );
                        })()}
                      </div>
                      
                      {/* Partial Coverage Details */}
                      {isPartial && coverage?.missingGroups.length > 0 && (
                          <div className="mt-1.5 text-[10px] text-amber-700 bg-amber-100/50 p-1 rounded border border-amber-100 leading-tight">
                              <span className="font-semibold block mb-0.5">No incluye:</span>
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
