import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronLeft, Star, AlertTriangle, Sprout, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  buildAuthoritativeQuoteSnapshot,
  clearAuthoritativeQuoteState,
} from '../../shared/bookingAuthoritativeSnapshot';
import type {
  BookingQuoteAvailability,
  BookingQuoteMetadata,
  BookingQuotePalmCoverage,
  BookingQuotePalmGroupContext,
} from '../../shared/bookingQuoteCore';
import { getBookingCustomerPaymentSummary } from '../../shared/bookingQuoteCore';
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

const ProvidersPage: React.FC = () => {
  const { bookingData, setBookingData, setCurrentStep } = useBooking();
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<string>(bookingData.providerId);
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
  const [providersReloadToken, setProvidersReloadToken] = useState(0);
  const [emptyStateHint, setEmptyStateHint] = useState('');
  const [requiresCertifiedLicense, setRequiresCertifiedLicense] = useState(false);
  const reqIdRef = useRef<number>(0);
  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    []
  );
  const monthFormatter = useMemo(() => new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }), []);

  const [isPartialModalOpen, setIsPartialModalOpen] = useState(false);

  const buildTimeSlotLabel = (startHour: number, durationHours: number) => {
    return `${String(startHour).padStart(2,'0')}:00 - ${String(startHour + durationHours).padStart(2,'0')}:00`;
  };

  const clearSelectedTimeSlot = () => {
    setSelectedHour(null);
    setBookingData((prev) => {
      const hasSelectedSlot =
        Boolean(prev.timeSlot) ||
        Boolean(prev.quoteAvailability?.selectedSlot) ||
        Boolean(prev.providerId) ||
        Boolean(prev.quoteMetadata) ||
        Boolean(prev.quoteEconomics?.serviceGrossTotal);

      if (!hasSelectedSlot) {
        return {};
      }

      return {
        providerId: '',
        timeSlot: '',
        ...clearAuthoritativeQuoteState(),
        quoteAvailability: {
          requestedDate: prev.quoteAvailability?.requestedDate,
          windowEndDate: prev.quoteAvailability?.windowEndDate,
          validStartHours: [],
          calendarDays: prev.quoteAvailability?.calendarDays,
          earliestSlot: prev.quoteAvailability?.earliestSlot || null,
          selectedSlot: null,
        },
      };
    });
  };

  const getEstimatedHours = (providerId: string): number => {
    return Math.max(1, Number(previewQuotes[providerId]?.estimatedHours || 1));
  };

  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  const buildPalmGroupIdentity = (group: { id?: string; species?: string; height?: string }) => {
    if (group?.id) return `id:${group.id}`;
    return `spec:${String(group?.species || '').trim()}::${String(group?.height || '').trim()}`;
  };

  const getQuoteMetadata = (providerId: string): BookingQuoteMetadata | undefined => {
    return previewQuotes[providerId]?.metadata;
  };

  const getPalmCoverage = (providerId: string): BookingQuotePalmCoverage | undefined => {
    return getQuoteMetadata(providerId)?.palmCoverage;
  };

  const getGroupsFromPalmContexts = (contexts: BookingQuotePalmGroupContext[]) => {
    const selectedKeys = new Set(contexts.map((group) => buildPalmGroupIdentity(group)));
    return (bookingData.palmGroups || []).filter((group) => selectedKeys.has(buildPalmGroupIdentity(group)));
  };

  const buildSelectedQuoteMetadata = (quote: ProviderQuotePreview, groupsToKeep: Array<{ id?: string; species?: string; height?: string }>) => {
    const metadata = quote.metadata;
    if (!metadata || metadata.pricingContext.serviceType !== 'palm_pruning') {
      return metadata;
    }

    const selectedKeys = new Set(groupsToKeep.map((group) => buildPalmGroupIdentity(group)));
    const selectedPalmGroups = metadata.pricingContext.palmGroups.filter((group) => selectedKeys.has(buildPalmGroupIdentity(group)));
    const requestedGroups = selectedPalmGroups.filter((group) => Number(group.quantity || 0) > 0);
    const coveredGroups = requestedGroups.filter((group) => group.isPriced);

    return {
      ...metadata,
      pricingContext: {
        ...metadata.pricingContext,
        allowsPriceChange: coveredGroups.some((group) => group.isTerminalOpenRange),
        palmGroups: selectedPalmGroups,
      },
      palmCoverage: {
        isFull: true,
        coveredCount: coveredGroups.length,
        totalCount: requestedGroups.length,
        missingGroups: [],
      },
    };
  };

  const buildSelectedQuoteAvailability = (
    quote: ProviderQuotePreview,
    date: string,
    startHour: number | null
  ): BookingQuoteAvailability => {
    const durationHours = Math.max(1, Math.ceil(Number(quote.estimatedHours || 1)));
    const earliestSlot = quote.availability?.earliestSlot || null;

    return {
      requestedDate: date,
      validStartHours: quote.availability?.validStartHours || [],
      calendarDays: quote.availability?.calendarDays,
      earliestSlot,
      selectedSlot: startHour == null
        ? null
        : {
            date,
            startHour,
            startTime: `${String(startHour).padStart(2, '0')}:00:00`,
            endTime: `${String(startHour + durationHours).padStart(2, '0')}:00:00`,
            durationHours,
          },
    };
  };

  const getPersistedSelectedHour = (providerId: string, date: string) => {
    const selectedSlot = bookingData.quoteAvailability?.selectedSlot;
    if (!selectedSlot) return null;
    if (bookingData.providerId !== providerId) return null;
    if (selectedSlot.date !== date) return null;
    return Number.isFinite(selectedSlot.startHour) ? selectedSlot.startHour : null;
  };

  const persistSelectedQuoteSnapshot = (
    providerId: string,
    date: string,
    startHour: number,
    groupsToKeep?: NonNullable<typeof bookingData.palmGroups>
  ) => {
    const quote = previewQuotes[providerId];
    if (!quote) {
      toast.error('Todavía no se ha podido validar el presupuesto de este profesional.');
      return false;
    }

    const durationHours = Math.max(1, Math.ceil(Number(quote.estimatedHours || 1)));
    const effectiveGroupsToKeep = groupsToKeep ?? (bookingData.palmGroups || []);
    const availability = buildSelectedQuoteAvailability(quote, date, startHour);
    const authoritativeQuoteSnapshot = buildAuthoritativeQuoteSnapshot({
      totalPrice: quote.totalPrice,
      estimatedHours: quote.estimatedHours,
      breakdown: quote.breakdown,
      warnings: quote.warnings,
      metadata: buildSelectedQuoteMetadata(quote, effectiveGroupsToKeep),
      economics: quote.economics,
      availability,
      quoteId: quote.quoteId,
      signature: quote.signature,
      expiresAt: quote.expiresAt,
      pricingVersion: quote.pricingVersion,
      providerConfigVersion: quote.providerConfigVersion,
    });

    if (!authoritativeQuoteSnapshot) {
      toast.error('No se ha podido construir el snapshot autoritativo del presupuesto. Recalcula la disponibilidad.');
      return false;
    }

    setBookingData({
      providerId,
      palmGroups: effectiveGroupsToKeep,
      preferredDate: date,
      timeSlot: buildTimeSlotLabel(startHour, durationHours),
      authoritativeQuoteSnapshot,
    });

    return true;
  };

  const openAvailability = async (providerId: string) => {
    if (selectedProvider && selectedProvider !== providerId) clearSelectedTimeSlot();
    setSelectedProvider(providerId);
    const earliest = previewQuotes[providerId]?.availability?.earliestSlot || earliestByProvider[providerId];
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
        setMonthDays(quote.availability?.calendarDays || days);
        const inMonth = new Date(Number(selectedDate.split('-')[0]), Number(selectedDate.split('-')[1]) - 1, Number(selectedDate.split('-')[2])).getMonth() === monthStart.getMonth();
        const nextCalendarDays = quote.availability?.calendarDays || days;
        if (!inMonth || !nextCalendarDays.some((item) => item.date === selectedDate && item.count > 0)) {
          const firstWith = nextCalendarDays.find((item) => item.count > 0);
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

  const loadValidHours = async (providerId: string, date: string) => {
    setHoursLoading(true);
    try {
      const { quote, validHours: nextHours } = await fetchProviderValidHours({
        bookingData,
        serviceId: bookingData.serviceIds[0],
        providerId,
        date,
        globalMinPrice,
      });
      setPreviewQuotes((prev) => ({ ...prev, [providerId]: quote }));
      setValidHours(quote.availability?.validStartHours || nextHours);
      setSelectedHour(null);
      setAvailabilityError('');
    } catch {
      setValidHours([]);
      setSelectedHour(null);
      setAvailabilityError('No se pudieron calcular las horas válidas. Reintenta.');
    } finally {
      setHoursLoading(false);
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
      await loadValidHours(selectedProvider, selectedDate);
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
      setEmptyStateHint('');
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

        const serviceInfo = (serviceInfoData || null) as { name?: string; base_price?: number } | null;

        setServiceName(serviceInfo?.name || '');
        setGlobalMinPrice(Number(serviceInfo?.base_price || 0));

        const isPhytosanitaryChemical = serviceInfo?.name === 'Servicios fitosanitarios' && 
          (bookingData.phytosanitaryZones || []).some((z: any) => z.productPreference !== 'ecological');
        const isWeedingHerbicide = serviceInfo?.name === 'Desbroce de malas hierbas' &&
          (bookingData.weedingZones || []).some((z: any) => z.applyHerbicide === true);

        const requiresChemical = isPhytosanitaryChemical || isWeedingHerbicide;
        setRequiresCertifiedLicense(requiresChemical);

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

        // Filtro estricto en Frontend (Capa 2)
        if (requiresChemical) {
          list = list.filter(p => (p as any).has_phytosanitary_license === true);
        }

        const preview = list.length > 0
          ? await previewProviderQuotes({
              bookingData,
              serviceId: primaryServiceId,
              providerIds: list.map((provider) => provider.user_id),
              selectedDate,
              windowDays: 14,
              globalMinPrice: Number(serviceInfo?.base_price || 0),
            })
          : { quotes: {}, earliestByProvider: {} };

        const nextEarliestByProvider = Object.fromEntries(
          Object.entries(preview.quotes || {}).map(([providerId, quote]) => [
            providerId,
            quote.availability?.earliestSlot
              ? {
                  date: quote.availability.earliestSlot.date,
                  startHour: quote.availability.earliestSlot.startHour,
                }
              : null,
          ])
        );

        list = list.filter((provider) => {
          const quote = preview.quotes?.[provider.user_id];
          if (!quote) return false;
          if (bookingData.palmGroups && bookingData.palmGroups.length > 0) {
            const coverage = quote.metadata?.palmCoverage;
            return Number(quote.totalPrice || 0) > 0 && Number(coverage?.coveredCount || 0) > 0;
          }
          return Number(quote.totalPrice || 0) > 0;
        });

        const earliestMap: Record<string, number> = {};
        Object.entries(nextEarliestByProvider).forEach(([providerId, earliest]) => {
          earliestMap[providerId] = earliest
            ? new Date(`${earliest.date}T${String(earliest.startHour).padStart(2, '0')}:00:00`).getTime()
            : Number.POSITIVE_INFINITY;
        });
        list.sort((a,b)=>{
          const ta = earliestMap[a.user_id] ?? Number.POSITIVE_INFINITY;
          const tb = earliestMap[b.user_id] ?? Number.POSITIVE_INFINITY;
          
          // Primary Sort: Full Coverage > Partial Coverage (if Palm Service)
          if (bookingData.palmGroups && bookingData.palmGroups.length > 0) {
              const coverageA = preview.quotes?.[a.user_id]?.metadata?.palmCoverage;
              const coverageB = preview.quotes?.[b.user_id]?.metadata?.palmCoverage;
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
        setEarliestByProvider(nextEarliestByProvider);
        setEmptyStateHint(
          requiresChemical
            ? 'Solo podemos mostrar profesionales con licencia fitosanitaria válida para este servicio.'
            : 'Prueba otra fecha o revisa los detalles del servicio para ampliar opciones.'
        );
        
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
        setEmptyStateHint('');
        setRequiresCertifiedLicense(false);
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
    providersReloadToken,
  ]);

  // Cargar disponibilidad del jardinero seleccionado para la fecha elegida
  useEffect(() => {
    setHoursAvailable(validHours);
  }, [selectedProvider, selectedDate]);



  const computeReservationTotal = (gardenerId: string) => {
    const summary = getBookingCustomerPaymentSummary(previewQuotes[gardenerId]?.economics);
    return Math.max(0, Number(summary?.reservationTotal || 0));
  };

  const handleContinue = () => { 
    if (selectedProvider) { 
      const selectedStartHour = selectedHour ?? getPersistedSelectedHour(selectedProvider, selectedDate);
      if (selectedStartHour == null) {
        toast.error('Selecciona una hora válida antes de continuar.');
        return;
      }
      const coverage = getPalmCoverage(selectedProvider);
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

    const coverage = getPalmCoverage(selectedProvider);
    const coveredGroups = getGroupsFromPalmContexts(
      (coverage?.missingGroups?.length || 0) > 0
        ? ((previewQuotes[selectedProvider]?.metadata?.pricingContext.palmGroups || []).filter((group) => group.isPriced))
        : [],
    );

    proceedWithBooking(coveredGroups);
  };

  const proceedWithBooking = (groupsToKeep: any[]) => {
    if (selectedProvider) {
      const selectedStartHour = selectedHour ?? getPersistedSelectedHour(selectedProvider, selectedDate);
      if (selectedStartHour == null) {
        toast.error('Selecciona una hora válida antes de continuar.');
        return;
      }
      if (!persistSelectedQuoteSnapshot(selectedProvider, selectedDate, selectedStartHour, groupsToKeep)) {
        return;
      }
      setCurrentStep(4); 
    } 
  };

  const handleSelectStartHour = (hour: number) => {
    if (!selectedProvider || !selectedDate) return;
    persistSelectedQuoteSnapshot(selectedProvider, selectedDate, hour);
  };

  const handleRetryProviders = () => {
    if (loading) return;
    setProvidersReloadToken((prev) => prev + 1);
  };

  const handleRetryAvailability = () => {
    if (!selectedProvider) return;
    void rebuildMonth(selectedProvider, calendarMonthDate);
    void loadValidHours(selectedProvider, selectedDate);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white shadow-sm border-b border-gray-200">
          <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
            <div className="h-9 w-9 rounded-lg bg-gray-100" />
            <div className="h-5 w-40 rounded bg-gray-200" />
            <div className="w-9" />
          </div>
        </div>
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
        <div className="max-w-md mx-auto px-4 py-6 pb-24">
          <div className="mb-4 grid gap-3" aria-live="polite" aria-busy="true">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-gray-200" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-32 rounded bg-gray-200" />
                    <div className="h-3 w-20 rounded bg-gray-100" />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm animate-pulse">
            <div className="mb-4 h-4 w-40 rounded bg-gray-200" />
            <div className="grid grid-cols-7 gap-2">
              {Array.from({ length: 14 }).map((_, index) => (
                <div key={index} className="mx-auto h-10 w-10 rounded-full bg-gray-100" />
              ))}
            </div>
          </div>
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
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
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

      <main className="max-w-md mx-auto px-4 py-6 pb-24" id="providers-main">
        {/* Carrusel de jardineros */}
      <div className="mb-4">
        {loadError && (
          <div aria-live="polite" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <p className="font-medium text-red-900">No se ha podido cargar la lista de profesionales.</p>
            <p className="mt-1">{loadError}</p>
            <button
              type="button"
              onClick={handleRetryProviders}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2 font-medium text-red-800 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              Reintentar carga
            </button>
          </div>
        )}

        {/* Partial Coverage Warning */}
        {providers.length > 0 && bookingData.palmGroups && bookingData.palmGroups.length > 0 && 
         !providers.some((p) => getPalmCoverage(p.user_id)?.isFull) && (
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
              {requiresCertifiedLicense
                ? 'Este servicio requiere una licencia fitosanitaria válida y ahora mismo no hay disponibilidad compatible en tu zona.'
                : 'Ahora mismo no hay ningún profesional compatible con este servicio y tus filtros actuales.'}
            </p>
            {emptyStateHint && (
              <p className="mb-4 text-sm text-gray-500">
                {emptyStateHint}
              </p>
            )}
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={handleRetryProviders}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
              >
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                Actualizar profesionales
              </button>
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
              >
                Revisar detalles del servicio
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto scrollbar-hide [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {providers.map((p) => {
              const selected = selectedProvider === p.user_id;
              const coverage = getPalmCoverage(p.user_id);
              const isPartial = coverage && !coverage.isFull;
              const paymentSummary = getBookingCustomerPaymentSummary(previewQuotes[p.user_id]?.economics);
              const reservationTotal = computeReservationTotal(p.user_id);

              return (
                <button
                  key={p.user_id}
                  type="button"
                  onClick={() => openAvailability(p.user_id)}
                  aria-pressed={selected}
                  className={`min-w-[240px] bg-white rounded-2xl shadow-sm p-4 border-2 text-left relative transition-colors flex flex-col gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation] ${
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
                      <div className="mt-1">
                        {reservationTotal <= 0 ? (
                          <span className="text-sm text-gray-400 font-normal">No disponible</span>
                        ) : (
                          <>
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                              Total de la reserva
                            </div>
                            <div className="mt-1 flex items-baseline gap-1.5 text-gray-900">
                              <span className="text-lg font-semibold">{currencyFormatter.format(reservationTotal)}</span>
                              {isPartial ? <span className="text-xs text-amber-700 font-normal">(parcial)</span> : null}
                            </div>
                            {paymentSummary ? (
                              <div className="mt-1 text-xs text-gray-500">
                                Incluye tarifa de reserva de {currencyFormatter.format(paymentSummary.reservationFee)}
                              </div>
                            ) : null}
                          </>
                        )}
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
            <div aria-live="polite" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <p className="font-medium text-red-900">No se ha podido cargar la disponibilidad.</p>
              <p className="mt-1">{availabilityError}</p>
              <button
                type="button"
                onClick={handleRetryAvailability}
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2 font-medium text-red-800 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
              >
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                Reintentar disponibilidad
              </button>
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
                          onClick={() => {
                            if (selectedDate !== d.date) clearSelectedTimeSlot();
                            setSelectedDate(d.date);
                          }}
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

      </main>

      {/* Fixed CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] z-50">
        <div className="max-w-md mx-auto">
          <button
            type="button"
            onClick={handleContinue}
            disabled={
              !selectedProvider ||
              !bookingData.quoteAvailability?.selectedSlot ||
              bookingData.providerId !== selectedProvider ||
              bookingData.quoteAvailability?.selectedSlot?.date !== selectedDate
            }
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
          selectedProvider
            ? getGroupsFromPalmContexts(
                (previewQuotes[selectedProvider]?.metadata?.pricingContext.palmGroups || []).filter((group) => group.isPriced)
              )
            : []
        }
        missingGroups={
          selectedProvider
            ? getGroupsFromPalmContexts(getPalmCoverage(selectedProvider)?.missingGroups || [])
            : []
        }
      />
    </div>
  );
};

export default ProvidersPage;
