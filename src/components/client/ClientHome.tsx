import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import AddressAutocomplete from '../common/AddressAutocomplete';
import { Service } from '../../types';
import { Wand2, Image as ImageIcon, CheckCircle, ChevronRight, ChevronLeft, ChevronDown, Clock, Euro } from 'lucide-react';
import { estimateWorkWithAI, AITask, estimateServiceAutoQuote, AutoQuoteAnalysis } from '../../utils/aiPricingEstimator';
import { findEligibleGardenersForServices, computeNextAvailableDays, MergedSlot, computeEarliestSlotForGardener, getWeekBlocksForGardener } from '../../utils/mergedAvailabilityService';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';

type WizardStep = 'welcome' | 'address' | 'details' | 'availability' | 'confirm';

const ClientHome: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const normalizeForPricing = (s: string) => (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const manualPricingEnabled = import.meta.env.DEV;
  const [userProfile, setUserProfile] = useState<any>(null);
  
  // Fetch user profile when authenticated
  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!user?.id) {
        setUserProfile(null);
        return;
      }
      
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();
        
        if (!error && data) {
          setUserProfile(data);
        } else {
          setUserProfile(null);
        }
      } catch (error) {
        console.error('Error fetching user profile:', error);
        setUserProfile(null);
      }
    };
    
    fetchUserProfile();
  }, [user?.id]);
  
  // Try multiple ways to get the restricted gardener ID
  const restrictedGardenerId = location.state?.restrictedGardenerId || 
                              (location.state as any)?.restrictedGardenerId ||
                              new URLSearchParams(location.search).get('gardenerId') ||
                              sessionStorage.getItem('restrictedGardenerId') ||
                              undefined;
  
  // Store in sessionStorage for persistence
  useEffect(() => {
    if (restrictedGardenerId) {
      sessionStorage.setItem('restrictedGardenerId', restrictedGardenerId);
    }
  }, [restrictedGardenerId]);
  
  // Debug logging
  useEffect(() => {
    console.log('[Debug] Full location object:', location);
    console.log('[Debug] Location state:', location.state);
    console.log('[Debug] Location search:', location.search);
    console.log('[Debug] Restricted gardener ID:', restrictedGardenerId);
  }, [location, restrictedGardenerId]);
  const [step, setStep] = useState<WizardStep>('welcome');
  const [applicationStatus, setApplicationStatus] = useState<null | 'submitted' | 'approved' | 'rejected'>(null);

  // Datos del formulario
  const [selectedAddress, setSelectedAddress] = useState<string>('');
  const [addressError, setAddressError] = useState<string>('');
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [description, setDescription] = useState<string>('');
  const [photos, setPhotos] = useState<File[]>([]);

  // Estimación IA y precio
  const [analyzing, setAnalyzing] = useState(false);
  const [estimatedHours, setEstimatedHours] = useState<number>(0);
  const [aiTasks, setAiTasks] = useState<AITask[]>([]);
  const [aiAutoAnalysis, setAiAutoAnalysis] = useState<AutoQuoteAnalysis | null>(null);
  const [aiAutoHours, setAiAutoHours] = useState<number>(0);
  const [aiAutoPrice, setAiAutoPrice] = useState<number>(0);
  const [debugTaskDraft, setDebugTaskDraft] = useState<AITask>({
    tipo_servicio: '',
    estado_jardin: 'normal',
    superficie_m2: null,
    numero_plantas: null,
    tamaño_plantas: null,
  });
  const [debugQuantity, setDebugQuantity] = useState<number | null>(null);
  const debugQuantityUnit = useMemo(() => {
    const n = normalizeForPricing(debugTaskDraft.tipo_servicio);
    if (n.includes('cesped') || n.includes('setos') || n.includes('malas hierbas') || n.includes('labrar')) return 'm2' as const;
    return 'plantas' as const;
  }, [debugTaskDraft.tipo_servicio]);
  // Totales calculados desde las tareas IA
  const { aiTimeTotal, aiPriceTotal } = useMemo(() => {
    const factorFromEstado = (estado?: string) => {
      const v = (estado || '').toLowerCase();
      if (v.includes('muy descuidado') || v.includes('bastante descuidado')) return 1.6;
      if (v.includes('descuidado')) return 1.3;
      return 1;
    };
    const round2 = (n: number) => Math.round(n * 100) / 100;
    let time = 0;
    let price = 0;
    aiTasks.forEach(t => {
      const tipo = (t.tipo_servicio || '').toLowerCase();
      const factor = factorFromEstado(t.estado_jardin);
      let h = 0;
      let p = 0;
      if (tipo.includes('césped') || tipo.includes('cesped')) {
        if (t.superficie_m2 != null) {
          h = (t.superficie_m2 / 150) * factor; // 150 m²/h
          p = h * 25;
        }
      } else if (tipo.includes('setos') || tipo.includes('seto')) {
        if (t.superficie_m2 != null) {
          h = (t.superficie_m2 / 8.4) * factor; // 8.4 m²/h
          p = h * 25;
        }
      } else if (tipo.includes('poda de plantas') || (tipo.includes('poda') && tipo.includes('planta'))) {
        if (t.numero_plantas != null) {
          h = (t.numero_plantas * 0.15) * factor;
          p = h * 25;
        }
      } else if (tipo.includes('poda de árboles') || tipo.includes('poda de arboles') || (tipo.includes('poda') && (tipo.includes('árbol') || tipo.includes('arbol')))) {
        if (t.numero_plantas != null) {
          h = (t.numero_plantas * 1.0) * factor;
          p = h * 30;
        }
      } else if (tipo.includes('malas hierbas') || tipo.includes('hierbas') || tipo.includes('maleza') || tipo.includes('labrado')) {
        if (t.superficie_m2 != null) {
          h = (t.superficie_m2 / 20) * factor; // 20 m²/h
          p = h * 20;
        }
      } else if (tipo.includes('fumig')) {
        if (t.numero_plantas != null) {
          h = (t.numero_plantas * 0.05) * factor; // 0.05 h/planta
          p = h * 35;
        }
      }
      time += h;
      price += p;
    });
    return { aiTimeTotal: round2(time), aiPriceTotal: round2(price) };
  }, [aiTasks]);

  const hourlyRateAverage = useMemo(() => {
    if (selectedServiceIds.length === 0) return 0;
    const rates = selectedServiceIds
      .map(id => services.find(s => s.id === id)?.price_per_hour || 0)
      .filter(n => n > 0);
    if (rates.length === 0) return 0;
    return Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) / 100;
  }, [selectedServiceIds, services]);
  const totalPrice = useMemo(() => {
    const travelFee = 15; // tarifa fija
    return estimatedHours > 0 && hourlyRateAverage > 0 ? Math.round((travelFee + estimatedHours * hourlyRateAverage) * 100) / 100 : 0;
  }, [estimatedHours, hourlyRateAverage]);

  // Ajustar horas estimadas tras análisis IA para habilitar disponibilidad (solo IA)
  useEffect(() => {
    const preferred = aiAutoHours > 0 ? aiAutoHours : aiTimeTotal;
    if (preferred > 0) setEstimatedHours(Math.ceil(preferred));
    else setEstimatedHours(0);
  }, [aiTimeTotal, aiAutoHours]);

  // Disponibilidad y jardineros
  const [eligibleGardenerIds, setEligibleGardenerIds] = useState<string[]>([]);
  const [eligibleGardenerProfiles, setEligibleGardenerProfiles] = useState<{ id: string; full_name: string }[]>([]);
  const [dateSuggestions, setDateSuggestions] = useState<{ date: string; slots: MergedSlot[] }[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<MergedSlot | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [sending, setSending] = useState(false);
  const [prefetchedAvailability, setPrefetchedAvailability] = useState(false);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [restrictedGardenerProfile, setRestrictedGardenerProfile] = useState<{ user_id: string; full_name: string; avatar_url?: string } | null>(null);

  // Fetch restricted gardener profile when coming from gardener link
  useEffect(() => {
    const fetchRestrictedGardenerProfile = async () => {
      console.log('[Debug] Fetching restricted gardener profile for ID:', restrictedGardenerId);
      if (!restrictedGardenerId) return;
      
      try {
        const { data: profile, error } = await supabase
          .from('gardener_profiles')
          .select('user_id, full_name, avatar_url')
          .eq('user_id', restrictedGardenerId)
          .single();
        
        console.log('[Debug] Profile fetch result:', { profile, error });
        
        if (!error && profile) {
          setRestrictedGardenerProfile(profile);
        } else {
          console.log('[Debug] No profile found or error occurred');
        }
      } catch (error) {
        console.error('Error fetching restricted gardener profile:', error);
      }
    };
    
    fetchRestrictedGardenerProfile();
  }, [restrictedGardenerId]);
  useEffect(() => {
    if (dateSuggestions.length > 0 && !expandedDate) {
      setExpandedDate(dateSuggestions[0].date);
    }
  }, [dateSuggestions]);

  // Helpers: normalizar textos y deducir servicios desde tareas IA
  const normalizeText = (s: string) => (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const deriveServiceIdsFromAITasks = (tasks: any[], catalog: Service[]) => {
    const ids = new Set<string>();
    const normalizedServices = catalog.map(s => ({ id: s.id, n: normalizeText(s.name) }));

    for (const t of tasks) {
      const tipo = normalizeText(t?.tipo_servicio || '');
      if (!tipo) continue;
      // Coincidencia EXTACTA con nombre de servicio (normalizado)
      const exact = normalizedServices.find(s => s.n === tipo);
      if (exact) {
        ids.add(exact.id);
      } else {
        console.warn('[AI] No existe servicio canónico con nombre exacto', { tipo, catalogNames: normalizedServices.map(s => s.n) });
      }
    }
    return Array.from(ids);
  };

  useEffect(() => {
    const fetchServices = async () => {
      const { data, error } = await supabase.from('services').select('*').order('name');
      if (!error && data) {
        setServices(data);
        // Diagnóstico: comprobar presencia de los 6 servicios canónicos IA
        const required = [
          'corte de cesped',
          'poda de plantas',
          'corte de setos a maquina',
          'poda de arboles',
          'labrar y quitar malas hierbas a mano',
          'fumigacion de plantas',
        ];
        const present = new Set((data || []).map((s: Service) => normalizeText(s.name)));
        const missing = required.filter(r => !present.has(r));
        if (missing.length > 0) {
          console.warn('[catalog] Faltan servicios canónicos en tabla services', { missing });
        } else {
          console.log('[catalog] Todos los servicios canónicos IA están presentes');
        }
      }
    };
    fetchServices();
  }, []);

  useEffect(() => {
    if (!manualPricingEnabled) return;
    if (debugTaskDraft.tipo_servicio) return;
    if (services.length === 0) return;
    setDebugTaskDraft(prev => ({ ...prev, tipo_servicio: services[0].name }));
  }, [manualPricingEnabled, debugTaskDraft.tipo_servicio, services]);

  useEffect(() => {
    if (!manualPricingEnabled) return;
    if (!debugTaskDraft.tipo_servicio) return;
    const unit = debugQuantityUnit;
    const v = unit === 'm2' ? debugTaskDraft.superficie_m2 : debugTaskDraft.numero_plantas;
    setDebugQuantity(v ?? null);
  }, [manualPricingEnabled, debugQuantityUnit, debugTaskDraft.tipo_servicio, debugTaskDraft.superficie_m2, debugTaskDraft.numero_plantas]);

  const goNext = () => {
    if (step === 'welcome') setStep('address');
    else if (step === 'address') setStep('details');
    else if (step === 'details') setStep('availability');
    else if (step === 'availability') setStep('confirm');
  };
  const goBack = () => {
    if (step === 'confirm') setStep('availability');
    else if (step === 'availability') setStep('details');
    else if (step === 'details') setStep('address');
    else if (step === 'address') setStep('welcome');
  };

  const validateAddressHasNumber = (address: string) => {
    const hasNumber = /\d+/.test(address);
    if (!hasNumber) setAddressError('Por favor incluye el número exacto de la casa.');
    else setAddressError('');
    return hasNumber;
  };

  const handleStart = () => {
    navigate('/reservar?start=1');
  };

  const handleAddressSelected = (addr: string) => {
    setSelectedAddress(addr);
    validateAddressHasNumber(addr);
  };

  const toggleService = (id: string) => {
    setSelectedServiceIds(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  };

  const onPhotosSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setPhotos(files);
  };

  const runAIAnalysis = async () => {
    try {
      console.log('[AI] runAIAnalysis invoked', {
        selectedServiceIdsLen: selectedServiceIds.length,
        photosCount: photos.length,
        descriptionLen: description.length,
      });
      setAnalyzing(true);
      let tareasLocal: AITask[] = [];
      const disablePhotoUpload = (import.meta.env.VITE_DISABLE_PHOTO_UPLOAD as string | undefined) === 'true';
      // Subir fotos para obtener URLs accesibles por la IA
      const photoUrls: string[] = [];
      if (photos.length > 0 && !disablePhotoUpload) {
        console.log('[AI] photo upload config', { disablePhotoUpload, photosLen: photos.length });
        const uploadTimeoutMs = Number((import.meta.env.VITE_PHOTO_UPLOAD_TIMEOUT_MS as string | undefined) || '12000');
        let timedOut = false;

        let timeoutId: any = null;
        const uploadPromise = (async () => {
          try {
            const { data: userData } = await supabase.auth.getUser();
            const userId = userData?.user?.id || 'anon';
            const bucket = (import.meta.env.VITE_BOOKING_PHOTOS_BUCKET as string | undefined) || 'booking-photos';
            const now = Date.now();
            console.log('[AI] photo upload init', { bucket, count: photos.length, userId });

            const sanitizeFileName = (name: string) => {
              const base = name.trim().toLowerCase().replace(/\s+/g, '_');
              return base.replace(/[^a-z0-9._-]/g, '_');
            };

            const start = Date.now();
            await Promise.allSettled(photos.map(async (file, i) => {
              console.log(`[AI] uploading photo ${i+1}/${photos.length}`, { name: file.name, type: file.type });
              const safeName = sanitizeFileName(file.name || `foto_${i}.jpg`);
              const path = `drafts/${userId}/${now}_${i}_${safeName}`;
              const { error: uploadError } = await supabase.storage
                .from(bucket)
                .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
              if (uploadError) {
                console.warn(`[AI] upload error photo ${i+1}:`, uploadError.message);
                return;
              }
              console.log(`[AI] photo ${i+1} uploaded`, { path });
              const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
              if (signed?.signedUrl) {
                photoUrls.push(signed.signedUrl);
                console.log(`[AI] url resolved (signed) for photo ${i+1}`, { url: signed.signedUrl });
              }
            }));
            console.log('[AI] parallel photo upload duration ms', Date.now() - start);
            console.log('[AI] photo upload done', { photoUrlsLen: photoUrls.length });
          } catch (err) {
            console.warn('No se pudieron preparar URLs de fotos para IA, se seguirá sin imágenes:', err);
          }
        })();

        timeoutId = setTimeout(() => {
          timedOut = true;
          console.warn('[AI] photo upload timed out; continuing without images', { uploadTimeoutMs });
        }, uploadTimeoutMs);

        await uploadPromise;
        if (!timedOut && timeoutId) {
          clearTimeout(timeoutId);
        }
        console.log('[AI] photo upload step finished; proceeding to AI', { photoUrlsLen: photoUrls.length });

        // Incluir siempre al menos 1–2 imágenes inline como dataURL para máxima compatibilidad
        if (photos.length > 0) {
          const maxInline = 2;
          const toResizedDataUrl = (file: File, maxDim = 1280, quality = 0.7) => new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const src = typeof reader.result === 'string' ? reader.result : '';
              if (!src) return resolve('');
              const img = new Image();
              img.onload = () => {
                let w = img.width, h = img.height;
                const scale = Math.min(1, maxDim / Math.max(w, h));
                w = Math.round(w * scale);
                h = Math.round(h * scale);
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) return resolve(src);
                ctx.drawImage(img, 0, 0, w, h);
                try {
                  const out = canvas.toDataURL('image/jpeg', quality);
                  resolve(out);
                } catch {
                  resolve(src);
                }
              };
              img.onerror = () => resolve('');
              img.src = src;
            };
            reader.onerror = () => resolve('');
            reader.readAsDataURL(file);
          });
          const limit = Math.min(photos.length, maxInline);
          for (let i = 0; i < limit; i++) {
            try {
              const dataUrl = await toResizedDataUrl(photos[i]);
              if (dataUrl && !photoUrls.some(u => u.startsWith('data:'))) {
                photoUrls.unshift(dataUrl);
                console.log(`[AI] inline dataUrl ready for photo ${i+1}`, { length: dataUrl.length, startsWithData: dataUrl.startsWith('data:') });
              }
            } catch (err) {
              console.warn(`[AI] failed to prepare dataUrl for photo ${i+1}`, err);
            }
          }
          console.log('[AI] inline images prepared', { photoUrlsLen: photoUrls.length });
        }
      } else if (photos.length > 0 && disablePhotoUpload) {
        console.warn('[AI] Photo upload disabled by env; continuing without images');
      }
  
      const primaryService = selectedServiceIds.length === 1 ? services.find(s => s.id === selectedServiceIds[0])?.name : undefined;
      const firstImageUrl = photoUrls[0];
      if (primaryService && firstImageUrl) {
        console.log('[AI] calling estimateServiceAutoQuote', { service: primaryService, hasImage: !!firstImageUrl });
        const auto = await estimateServiceAutoQuote({ service: primaryService, imageUrl: firstImageUrl, description: '' });
        if (auto?.analysis && auto?.result) {
          console.log('[AI] auto_quote returned', auto);
          setAiAutoAnalysis(auto.analysis);
          setAiAutoHours(Math.max(0, Number(auto.result.tiempo_estimado_horas || 0)));
          setAiAutoPrice(Math.max(0, Number(auto.result.precio_estimado || 0)));
        } else {
          console.log('[AI] auto_quote not available, falling back to multi-task analysis');
          const result = await estimateWorkWithAI({ description, photoCount: photos.length, selectedServiceIds, photoUrls });
          const tareas = Array.isArray(result.tareas) ? result.tareas : [];
          setAiTasks(tareas);
        }
      } else {
        console.log('[AI] calling estimateWorkWithAI', { photoUrlsLen: photoUrls.length, descriptionLen: description.length, selectedServiceIdsLen: selectedServiceIds.length });
        const result = await estimateWorkWithAI({ description, photoCount: photos.length, selectedServiceIds, photoUrls });
        const tareas = Array.isArray(result.tareas) ? result.tareas : [];
        setAiTasks(tareas);
        tareasLocal = tareas;
        tareasLocal = tareas;
      }
      // Si no hay servicios seleccionados, intentar deducirlos de las tareas IA
      if (selectedServiceIds.length === 0 && tareasLocal.length > 0 && services.length > 0) {
        const inferred = deriveServiceIdsFromAITasks(tareasLocal, services);
        if (inferred.length > 0) {
          console.log('[AI] servicios deducidos desde tareas IA', { inferred });
          setSelectedServiceIds(inferred);
        } else {
          console.log('[AI] no se pudieron deducir servicios desde tareas IA');
        }
      }
    } catch (e) {
      console.warn('AI analysis error, using fallback:', e);
      setAiTasks([]);
      
      // Mostrar mensaje específico para rate limit
      if (e instanceof Error && e.message.includes('Rate limit')) {
        alert(`⚠️ ${e.message}\n\nPuedes:\n• Esperar unas horas e intentar de nuevo\n• Añadir método de pago en OpenAI para aumentar límites\n• Continuar sin análisis IA seleccionando servicios manualmente`);
      } else {
        toast.error('No se pudo analizar con IA. Revisa permisos de Storage y despliegue de Edge Function.');
      }
    } finally {
      setAnalyzing(false);
    }
  };

  // Prefetch disponibilidad automáticamente tras tener estimación IA y datos clave
  useEffect(() => {
    const ready = !!selectedAddress && selectedServiceIds.length > 0 && estimatedHours > 0;
    if (!prefetchedAvailability && ready) {
      console.log('[avail] auto-prefetch: iniciando búsqueda de jardineros y horas', {
        selectedServiceIdsLen: selectedServiceIds.length,
        estimatedHours,
        addressPresent: !!selectedAddress,
      });
      fetchAvailability()
        .then(() => setPrefetchedAvailability(true))
        .catch(() => setPrefetchedAvailability(true));
    }
  }, [selectedAddress, selectedServiceIds, estimatedHours, prefetchedAvailability]);

  const [timeFilter, setTimeFilter] = useState<'morning' | 'afternoon' | 'all'>('all');
  const [gardenerList, setGardenerList] = useState<any[]>([]);
  const [selectedGardener, setSelectedGardener] = useState<any | null>(null);
  const [gardenerWeekBlocks, setGardenerWeekBlocks] = useState<Map<string, { hour: number; available: boolean }[]>>(new Map());
  const [weekStartDate, setWeekStartDate] = useState<string>('');

  const fetchAvailability = async () => {
    if (!selectedAddress || selectedServiceIds.length === 0 || estimatedHours <= 0) return;
    setLoadingAvailability(true);
    try {
      console.log('[avail] buscando jardineros elegibles...', {
        selectedServiceIds,
        address: selectedAddress,
        estimatedHours,
      });
      const gardeners = await findEligibleGardenersForServices(selectedServiceIds, selectedAddress);
      let ids = gardeners.map(g => (g as any).user_id);
      if (restrictedGardenerId) {
        ids = ids.filter(id => id === restrictedGardenerId);
      }
      console.log('[avail] jardineros encontrados', { count: ids.length, ids });
      setEligibleGardenerIds(ids);

      // Cargar perfiles completos y PRECIOS
      if (ids.length > 0) {
        // Corrección: el endpoint falla al pedir rating_average/rating_count si no están expuestos o el tipo es incorrecto.
        // Pedimos user_id, full_name, avatar_url y (si existen) rating_average.
        // Si falla 400 es probable que algún campo no exista en la vista/tabla o permiso.
        // Probamos con select básico primero.
        const { data: profiles, error: profilesError } = await supabase
          .from('gardener_profiles')
          .select('user_id, full_name, avatar_url, rating_average, rating_count')
          .in('user_id', ids);

        if (profilesError) {
             console.error('Error fetching profiles:', profilesError);
        }
          
        const { data: pricesData } = await supabase
          .from('gardener_service_prices')
          .select('gardener_id, service_id, price_per_unit, unit_type')
          .in('gardener_id', ids)
          .eq('active', true);
          
        const pricesMap = new Map<string, Record<string, number>>(); // gardener_id -> { service_id: price }
        pricesData?.forEach((p: any) => {
          if (!pricesMap.has(p.gardener_id)) pricesMap.set(p.gardener_id, {});
          pricesMap.get(p.gardener_id)![p.service_id] = p.price_per_unit;
        });

        if (!profilesError && profiles) {
          // Calcular datos para cada jardinero
          const list = await Promise.all(profiles.map(async (p: any) => {
            // Calcular precio final
            let finalPrice = 0;
            let breakdown = '';
            
            // Usar análisis IA
            const quantity = aiAutoAnalysis ? parseFloat(String(aiAutoAnalysis.cantidad)) : (debugQuantity || 0);
            const difficulty = aiAutoAnalysis ? 
              (String(aiAutoAnalysis.dificultad).includes('muy') ? 1.6 : String(aiAutoAnalysis.dificultad).includes('descuidado') ? 1.3 : 1.0) 
              : 1.0;

            if (selectedServiceIds.length > 0) {
              const svcId = selectedServiceIds[0];
              const price = pricesMap.get(p.user_id)?.[svcId] || 0; // Default a 0 si no tiene precio configurado
              if (price > 0 && quantity > 0) {
                finalPrice = quantity * price * difficulty;
                breakdown = `${quantity} ${aiAutoAnalysis?.unidad || 'ud'} × €${price} × ${difficulty}`;
              } else {
                // Fallback si no hay precio configurado: usar estimación global
                finalPrice = totalPrice; 
              }
            }

            // Calcular primer hueco disponible
            const today = new Date().toISOString().slice(0, 10);
            const earliest = await computeEarliestSlotForGardener(
              p.user_id,
              estimatedHours,
              today,
              user?.id || 'anonymous',
              timeFilter
            );

            return {
              ...p,
              finalPrice: Math.ceil(finalPrice),
              earliestSlot: earliest,
              priceBreakdown: breakdown
            };
          }));

          // Ordenar por disponibilidad (earliest timestamp)
          list.sort((a, b) => {
            if (!a.earliestSlot && !b.earliestSlot) return 0;
            if (!a.earliestSlot) return 1;
            if (!b.earliestSlot) return -1;
            return a.earliestSlot.timestamp - b.earliestSlot.timestamp;
          });

          setGardenerList(list);
        }
      }
    } catch (e) {
      console.error('Error obteniendo disponibilidad:', e);
    } finally {
      setLoadingAvailability(false);
    }
  };

  // Re-ordenar cuando cambia el filtro
  useEffect(() => {
    if (gardenerList.length > 0) {
      const reorder = async () => {
        const today = new Date().toISOString().slice(0, 10);
        const updated = await Promise.all(gardenerList.map(async (g) => {
          const earliest = await computeEarliestSlotForGardener(
            g.user_id,
            estimatedHours,
            today,
            user?.id || 'anonymous',
            timeFilter
          );
          return { ...g, earliestSlot: earliest };
        }));
        
        updated.sort((a, b) => {
          if (!a.earliestSlot && !b.earliestSlot) return 0;
          if (!a.earliestSlot) return 1;
          if (!b.earliestSlot) return -1;
          return a.earliestSlot.timestamp - b.earliestSlot.timestamp;
        });
        setGardenerList(updated);
      };
      reorder();
    }
  }, [timeFilter]);

  const loadGardenerWeek = async (gardenerId: string, start: string) => {
    const blocks = await getWeekBlocksForGardener(gardenerId, start, user?.id || 'anonymous');
    setGardenerWeekBlocks(blocks);
  };


  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [receiveNotifications, setReceiveNotifications] = useState(true);
  const isBookingPage = location.pathname.startsWith('/reserva') || location.pathname.startsWith('/reservar');
  const draftKey = 'bookingDraft';
  const saveTimer = useRef<number | null>(null);
  const restoredRef = useRef(false);

  // Restaurar SOLO el paso lo antes posible para no saltar a "Dirección" tras recarga
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (typeof draft.step === 'string' && draft.step !== 'welcome') {
        setStep(draft.step as WizardStep);
      }
    } catch {}
  }, []);

  // Restaurar borrador al montar (tras cargar servicios)
  useEffect(() => {
    if (restoredRef.current) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (Array.isArray(draft.selectedServiceIds)) {
        setSelectedServiceIds(draft.selectedServiceIds);
      }
      if (typeof draft.selectedAddress === 'string') {
        setSelectedAddress(draft.selectedAddress);
      }
      if (typeof draft.description === 'string') {
        setDescription(draft.description);
      }
      if (typeof draft.estimatedHours === 'number') {
        setEstimatedHours(draft.estimatedHours);
      }
      if (Array.isArray(draft.aiTasks)) {
        setAiTasks(draft.aiTasks);
      }
      if (draft.aiAutoAnalysis) {
        setAiAutoAnalysis(draft.aiAutoAnalysis);
      }
      if (typeof draft.aiAutoHours === 'number') {
        setAiAutoHours(draft.aiAutoHours);
      }
      if (typeof draft.aiAutoPrice === 'number') {
        setAiAutoPrice(draft.aiAutoPrice);
      }
      if (draft.debugTaskDraft && typeof draft.debugTaskDraft === 'object') {
        setDebugTaskDraft(draft.debugTaskDraft);
      }
      if (draft.debugQuantity !== undefined) {
        setDebugQuantity(draft.debugQuantity);
      }
      if (typeof draft.timeFilter === 'string') {
        setTimeFilter(draft.timeFilter);
      }
      if (typeof draft.selectedDate === 'string') {
        setSelectedDate(draft.selectedDate);
      }
      if (draft.selectedSlot) {
        setSelectedSlot(draft.selectedSlot);
      }
      if (typeof draft.step === 'string') {
        setStep(draft.step as WizardStep);
      }
      restoredRef.current = true;
    } catch {}
  }, [services]);

  // Avanzar automáticamente al entrar en /reserva con start=1
  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    if (isBookingPage && qs.get('start') === '1') {
      let draftStep: string | null = null;
      try {
        const raw = localStorage.getItem(draftKey);
        if (raw) draftStep = JSON.parse(raw)?.step || null;
      } catch {}
      if (step === 'welcome' && (!draftStep || draftStep === 'welcome')) {
        setStep('address');
      }
      navigate('/reservar', { replace: true });
    }
  }, [isBookingPage, location.search, step]);

  // Persistir borrador con pequeño debounce
  useEffect(() => {
    const payload = {
      step,
      selectedAddress,
      selectedServiceIds,
      description,
      aiTasks,
      aiAutoAnalysis,
      aiAutoHours,
      aiAutoPrice,
      estimatedHours,
      selectedDate,
      selectedSlot,
      timeFilter,
      restrictedGardenerId,
      debugTaskDraft,
      debugQuantity,
    };
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(payload));
      } catch {}
    }, 300);
    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, [
    step,
    selectedAddress,
    selectedServiceIds,
    description,
    aiTasks,
    aiAutoAnalysis,
    estimatedHours,
    selectedDate,
    selectedSlot,
    timeFilter,
    restrictedGardenerId,
  ]);

  const confirmAndSend = async () => {
    if (!selectedSlot || !selectedDate || !selectedGardener) return;
    const effectivePrice = selectedGardener.finalPrice;
    const roundedPrice = Math.ceil(effectivePrice);
    
    try { localStorage.removeItem(draftKey); } catch {}

    navigate('/reservar/checkout', {
      state: {
        payload: {
          restrictedGardenerId: selectedGardener.user_id,
          selectedAddress,
          selectedServiceIds,
          description,
          estimatedHours,
          selectedDate,
          startHour: selectedSlot.startHour,
          endHour: selectedSlot.endHour,
          eligibleGardenerIds: [selectedGardener.user_id],
          hourlyRateAverage,
          totalPrice: roundedPrice,
          aiTasks,
          aiAutoPrice: roundedPrice,
          aiPriceTotal: roundedPrice,
          photoFiles: photos,
        }
      }
    });
  };

  const hasProcessedRef = useRef(false);

  useEffect(() => {
    const processPending = async () => {
      if (!user?.id) return;
      if (hasProcessedRef.current) return;
      hasProcessedRef.current = true;
      try {
        const src = (() => { try { return localStorage.getItem('signup_source'); } catch { return null; } })();
        const metaRole = (user as any)?.user_metadata?.role;
        const metaReq = (user as any)?.user_metadata?.requested_role;
        const gardenerIntent = metaRole === 'gardener' || metaReq === 'gardener';
        if (src === 'checkout' || !gardenerIntent) {
          try { localStorage.removeItem('pendingGardenerApplication'); } catch {}
          return;
        }
        const raw = localStorage.getItem('pendingGardenerApplication');
        if (raw) {
          const payload = JSON.parse(raw);
          payload.user_id = user.id;
          payload.submitted_at = new Date().toISOString();
          try {
            if (payload.photo_data) {
              const res = await fetch(payload.photo_data);
              const blob = await res.blob();
              const type = blob.type || 'image/jpeg';
              const ext = type.split('/').pop() || 'jpg';
              const avatarPath = `${user.id}/avatar/${Date.now()}.${ext}`;
              const { error: upErr } = await supabase.storage.from('applications').upload(avatarPath, blob, { upsert: true, contentType: type });
              if (!upErr) {
                const { data } = supabase.storage.from('applications').getPublicUrl(avatarPath);
                if (data?.publicUrl) payload.professional_photo_url = data.publicUrl;
              }
            }
            if (Array.isArray(payload.proof_photos_data) && payload.proof_photos_data.length > 0) {
              const urls: string[] = [];
              for (let i = 0; i < payload.proof_photos_data.length; i++) {
                const d = payload.proof_photos_data[i];
                const res = await fetch(d);
                const blob = await res.blob();
                const type = blob.type || 'image/jpeg';
                const ext = type.split('/').pop() || 'jpg';
                const proofPath = `${user.id}/proof/${Date.now()}_${i}.${ext}`;
                const { error: upErr } = await supabase.storage.from('applications').upload(proofPath, blob, { upsert: true, contentType: type });
                if (!upErr) {
                  const { data } = supabase.storage.from('applications').getPublicUrl(proofPath);
                  if (data?.publicUrl) urls.push(data.publicUrl);
                }
              }
              if (urls.length > 0) payload.proof_photos = urls;
            }
          } catch {}
          delete payload.photo_data;
          delete payload.proof_photos_data;
          const { data: existing } = await supabase
            .from('gardener_applications')
            .select('id,status')
            .eq('user_id', user.id)
            .in('status', ['draft','submitted'])
            .order('submitted_at', { ascending: false })
            .limit(1);
          if (existing && existing.length > 0) {
            const id = existing[0].id;
            await supabase
              .from('gardener_applications')
              .update({ ...payload, status: 'submitted' })
              .eq('id', id);
            localStorage.removeItem('pendingGardenerApplication');
            toast.success('Solicitud enviada. Está en revisión.');
          } else {
            const { error } = await supabase
              .from('gardener_applications')
              .insert(payload);
            if (error) {
              const msg = (error as any)?.message || '';
              if (msg.includes('duplicate') || msg.includes('conflict') || (error as any)?.code === '409') {
                const { data: ex2 } = await supabase
                  .from('gardener_applications')
                  .select('id')
                  .eq('user_id', user.id)
                  .order('submitted_at', { ascending: false })
                  .limit(1);
                const id2 = ex2?.[0]?.id;
                if (id2) {
                  await supabase
                    .from('gardener_applications')
                    .update({ ...payload, status: 'submitted' })
                    .eq('id', id2);
                  localStorage.removeItem('pendingGardenerApplication');
                  toast.success('Solicitud enviada. Está en revisión.');
                }
              }
            } else {
              localStorage.removeItem('pendingGardenerApplication');
              toast.success('Solicitud enviada. Está en revisión.');
            }
          }
        }
      } catch {}
      try {
        const { data } = await supabase
          .from('gardener_applications')
          .select('status')
          .eq('user_id', user.id)
          .order('submitted_at', { ascending: false })
          .limit(1);
        if (data && data.length > 0) setApplicationStatus(data[0].status as any);
      } catch {}
    };
    processPending();
  }, [user?.id]);

  const GardenerInfoBanner = () => {
    console.log('[Debug] GardenerInfoBanner rendering with profile:', restrictedGardenerProfile);
    if (!restrictedGardenerProfile) return null;
    
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-4">
          {restrictedGardenerProfile.avatar_url && (
            <img 
              src={restrictedGardenerProfile.avatar_url} 
              alt={restrictedGardenerProfile.full_name}
              className="w-12 h-12 rounded-full object-cover"
            />
          )}
          <div>
            <div className="text-sm text-blue-600 font-medium">Estás reservando con este jardinero</div>
            <div className="text-lg font-semibold text-blue-900">{restrictedGardenerProfile.full_name}</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-600 to-green-500 p-5 sm:p-8 text-white">
          {applicationStatus === 'submitted' ? (
            <>
              <h1 className="text-2xl sm:text-3xl font-bold">Solicitud de jardinero en revisión</h1>
              <p className="mt-2 opacity-90 text-sm sm:text-base">Has solicitado ser jardinero en GarSer.es. Estamos validando tus datos y tu perfil profesional. Te avisaremos por email muy pronto.</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl sm:text-3xl font-bold">Bienvenido{userProfile?.full_name ? `, ${userProfile.full_name}` : ''}</h1>
              <p className="mt-2 opacity-90 text-sm sm:text-base">Solicita un presupuesto y reserva el trabajo de jardinería que necesites al instante.</p>
            </>
          )}
        </div>

        {/* Content */}
        <div className="p-5 sm:p-8">
          {applicationStatus === 'submitted' ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 bg-yellow-100 text-yellow-700 rounded-full flex items-center justify-center mb-4">
                <Clock className="w-8 h-8" />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Tu solicitud está en revisión</h2>
              <p className="text-gray-600 text-center max-w-md">Has solicitado ser jardinero. Estamos revisando tu información para activar tu cuenta profesional. Te avisaremos por email en cuanto terminemos. Mientras tanto, no verás el panel de cliente y no necesitas hacer nada más.</p>
            </div>
          ) : (
            <>
              {applicationStatus === 'rejected' && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800">
                  Tu solicitud fue rechazada. Si crees que es un error, contáctanos.
                </div>
              )}

              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <div className="text-sm text-gray-600">Paso: {['Inicio','Dirección','Detalles','Disponibilidad','Confirmación'][['welcome','address','details','availability','confirm'].indexOf(step)]}</div>
                {restrictedGardenerProfile && (
                  <div className="text-sm bg-blue-100 text-blue-800 px-3 py-1 rounded-full">
                    Reserva con: {restrictedGardenerProfile.full_name}
                  </div>
                )}
              <div className="space-x-2">
                {step !== 'welcome' && (
                  <button onClick={goBack} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 inline-flex items-center text-sm sm:text-base">
                    <ChevronLeft className="w-4 h-4 mr-1" /> Atrás
                  </button>
                )}
                {step !== 'confirm' && (
                  <button onClick={goNext} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 inline-flex items-center text-sm sm:text-base">
                    Siguiente <ChevronRight className="w-4 h-4 ml-1" />
                  </button>
                )}
                {step !== 'welcome' && (
                  <button
                    onClick={() => { try { localStorage.removeItem(draftKey); } catch {}; navigate('/dashboard'); }}
                    className="px-3 py-2 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg text-gray-700 inline-flex items-center text-sm sm:text-base"
                  >
                    Cancelar reserva
                  </button>
                )}
              </div>
              </div>

              {step === 'welcome' && (
                <div className="text-center py-10 sm:py-16">
                  {restrictedGardenerProfile && <GardenerInfoBanner />}
                  <p className="text-gray-600 mb-8 text-sm sm:text-base">Tu nueva experiencia de reserva de jardinería, simple y directa.</p>
                  <button onClick={handleStart} className="px-6 sm:px-8 py-3 sm:py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl text-base sm:text-lg font-semibold shadow-lg transform hover:scale-[1.02] transition">
                    Empezar
                  </button>
                </div>
              )}

              {step === 'address' && (
                <div className="space-y-3 sm:space-y-4">
                  {restrictedGardenerProfile && <GardenerInfoBanner />}
                  <label className="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
                  <AddressAutocomplete value={selectedAddress} onChange={handleAddressSelected} error={addressError} />
                  {selectedAddress && (
                    <div className="text-sm text-gray-600">Dirección seleccionada: <span className="font-medium">{selectedAddress}</span></div>
                  )}
                  {addressError && <div className="text-sm text-red-600">{addressError}</div>}
                  <div className="pt-2">
                    <button
                      onClick={() => validateAddressHasNumber(selectedAddress) && setStep('details')}
                      className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm sm:text-base"
                    >
                      Continuar
                    </button>
                  </div>
                </div>
              )}

              {step === 'details' && (
                <div className="space-y-5 sm:space-y-6">
                  {restrictedGardenerProfile && <GardenerInfoBanner />}
                  <div>
                    <label className="block text-base sm:text-lg font-semibold text-gray-800 mb-2">Selecciona el servicio</label>
                    <div className="flex flex-wrap gap-2">
                      {services.map(svc => {
                        const selected = selectedServiceIds.includes(svc.id);
                        return (
                          <button
                            key={svc.id}
                            type="button"
                            onClick={() => toggleService(svc.id)}
                            className={`px-3 py-2 rounded-lg border text-sm ${selected ? 'bg-green-600 text-white border-green-600' : 'bg-gray-100 text-gray-700 border-gray-300'}`}
                          >
                            <div className="font-medium">{svc.name}</div>
                            {typeof svc.price_per_hour === 'number' && svc.price_per_hour > 0 && (
                              <div className="text-xs opacity-80">{`€${svc.price_per_hour}/h`}</div>
                            )}
                          </button>
                        );
                      })}
                      {services.length === 0 && (
                        <div className="text-sm text-gray-600">No hay servicios configurados todavía.</div>
                      )}
                    </div>
                    {selectedServiceIds.length > 0 && (
                      <div className="text-xs text-gray-600 mt-2">Seleccionados: {selectedServiceIds.length}</div>
                    )}
                  </div>
                  <div>
                    <label className="block text-base sm:text-lg font-semibold text-gray-800 mb-2">Fotos del jardín</label>
                    <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 sm:p-6 text-center">
                      <input type="file" accept="image/*" multiple onChange={onPhotosSelected} />
                      <div className="mt-4 flex flex-wrap gap-3">
                        {photos.map((file, idx) => (
                          <div key={idx} className="w-20 h-20 bg-gray-100 rounded-lg overflow-hidden">
                            <img src={URL.createObjectURL(file)} alt={`foto-${idx}`} className="w-full h-full object-cover" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-base sm:text-lg font-semibold text-gray-800 mb-2">Describe el trabajo</label>
                    <textarea
                      rows={4}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full p-3 sm:p-4 text-base border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      placeholder="Ej: Quiero un corte de césped y que poden los setos de la imagen"
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={runAIAnalysis}
                      disabled={analyzing}
                      className="px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg inline-flex items-center disabled:opacity-50 text-sm sm:text-base"
                    >
                      <Wand2 className="w-4 h-4 mr-2" /> Analizar con IA
                    </button>
                    {aiTasks.length > 0 && (
                      <div className="text-gray-700">
                        IA detectó {aiTasks.length} {aiTasks.length === 1 ? 'tarea' : 'tareas'}.
                      </div>
                    )}
                  </div>

                  {manualPricingEnabled && (
                    <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
                      <h4 className="text-amber-900 font-semibold mb-3">Debug IA (manual)</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-800 mb-1">Tipo de servicio</label>
                          <select
                            value={debugTaskDraft.tipo_servicio}
                            onChange={(e) => setDebugTaskDraft(prev => ({ ...prev, tipo_servicio: e.target.value }))}
                            className="w-full py-2.5 px-3.5 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
                          >
                            <option value="" disabled>Selecciona…</option>
                            {services.map(s => (
                              <option key={s.id} value={s.name}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Estado del jardín</label>
                          <select
                            value={debugTaskDraft.estado_jardin}
                            onChange={(e) => setDebugTaskDraft(prev => ({ ...prev, estado_jardin: e.target.value }))}
                            className="w-full p-2 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
                          >
                            <option value="normal">normal</option>
                            <option value="descuidado">descuidado</option>
                            <option value="muy descuidado">muy descuidado</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad</label>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={debugQuantity ?? ''}
                            onChange={(e) => {
                              const v = e.target.value === '' ? null : Number(e.target.value);
                              setDebugQuantity(v);
                              setDebugTaskDraft(prev => ({
                                ...prev,
                                superficie_m2: debugQuantityUnit === 'm2' ? v : null,
                                numero_plantas: debugQuantityUnit === 'plantas' ? v : null,
                                tamaño_plantas: null,
                              }));
                            }}
                            className="w-full py-2.5 px-3.5 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
                            placeholder={debugQuantityUnit === 'm2' ? 'Ej: 120' : 'Ej: 8'}
                          />
                          <div className="text-xs text-gray-600 mt-1">Unidad: {debugQuantityUnit === 'm2' ? 'm²' : 'plantas'}</div>
                        </div>
                        <div className="flex items-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (!debugTaskDraft.tipo_servicio) return;
                              setAiAutoAnalysis(null);
                              setAiAutoHours(0);
                              setAiAutoPrice(0);
                              const task: AITask = {
                                tipo_servicio: debugTaskDraft.tipo_servicio,
                                estado_jardin: debugTaskDraft.estado_jardin,
                                superficie_m2: debugQuantityUnit === 'm2' ? debugQuantity : null,
                                numero_plantas: debugQuantityUnit === 'plantas' ? debugQuantity : null,
                                tamaño_plantas: null,
                              };
                              setAiTasks([task]);
                              toast.success('Parámetros IA aplicados manualmente');
                            }}
                            className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm"
                          >
                            Aplicar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAiAutoAnalysis(null);
                              setAiAutoHours(0);
                              setAiAutoPrice(0);
                              setAiTasks([]);
                              toast('Tareas IA limpiadas');
                            }}
                            className="px-3 py-2 bg-white hover:bg-gray-50 text-gray-800 rounded-lg border border-gray-300 text-sm"
                          >
                            Limpiar
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {aiTasks.length > 0 && (
                    <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
                      <h4 className="text-green-800 font-semibold mb-2">Tareas sugeridas</h4>
                      <ul className="space-y-2">
                        {aiTasks.map((t, idx) => (
                          <li key={idx} className="text-sm text-gray-800">
                            <span className="font-medium">{t.tipo_servicio}</span>
                            {' — '}<span className="italic">{t.estado_jardin}</span>
                            {t.superficie_m2 != null && (
                              <span>{' • '}superficie: {t.superficie_m2} m²</span>
                            )}
                            {t.numero_plantas != null && (
                              <span>{' • '}plantas: {t.numero_plantas}</span>
                            )}
                            {t.tamaño_plantas && (
                              <span>{' • '}tamaño: {t.tamaño_plantas}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiAutoAnalysis && (
                    <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
                      <h4 className="text-green-800 font-semibold mb-2">Detección IA</h4>
                      <div className="text-sm text-gray-800">
                        <div><span className="font-medium">Servicio:</span> {aiAutoAnalysis.servicio}</div>
                        <div><span className="font-medium">Cantidad detectada:</span> {aiAutoAnalysis.cantidad} {aiAutoAnalysis.unidad}</div>
                        <div><span className="font-medium">Nivel de dificultad:</span> {aiAutoAnalysis.dificultad}</div>
                      </div>
                    </div>
                  )}

                  {(aiAutoHours > 0 || aiAutoPrice > 0 || aiTimeTotal > 0 || aiPriceTotal > 0 || (estimatedHours > 0 && totalPrice > 0)) && (
                    <div className="mt-4 bg-white border border-gray-200 rounded-lg p-4">
                      <h4 className="text-gray-900 font-semibold mb-2">Estimación</h4>
                      <div className="flex items-center gap-6">
                        <div className="flex items-center text-gray-700">
                          <Clock className="w-4 h-4 mr-2" />
                          {Math.ceil((aiAutoHours > 0 ? aiAutoHours : (aiTimeTotal > 0 ? aiTimeTotal : estimatedHours)))} h
                        </div>
                        {/* Eliminamos el precio estimado aquí para no confundir, ya que cada jardinero tiene su precio */}
                        <div className="flex items-center text-gray-500 text-sm">
                          (El precio final dependerá del jardinero que elijas)
                        </div>
                      </div>
                      <div className="mt-4">
                        <button
                          type="button"
                          onClick={goNext}
                          disabled={estimatedHours <= 0 || selectedServiceIds.length === 0}
                          className="px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg inline-flex items-center disabled:opacity-50 text-sm sm:text-base"
                        >
                          Ver jardineros disponibles <ChevronRight className="w-4 h-4 ml-2" />
                        </button>
                      </div>
                    </div>
                  )}

                  {aiTimeTotal > 0 && (
                    <div className="mt-6">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-base sm:text-lg font-semibold text-gray-800">Elige día y hora disponibles</h4>
                        <button
                          type="button"
                          onClick={() => setStep('availability')}
                          className="text-sm text-green-700 hover:underline"
                        >
                          Ver más días
                        </button>
                      </div>

                      {loadingAvailability && (
                        <div className="flex items-center gap-2 text-gray-600"><ImageIcon className="w-4 h-4" /> Buscando disponibilidad...</div>
                      )}

                      {!loadingAvailability && dateSuggestions.length > 0 && (
                        <div className="space-y-2">
                          {dateSuggestions.slice(0, 4).map(ds => {
                            const isOpen = expandedDate === ds.date;
                            const totalSlots = ds.slots.length;
                            return (
                              <div key={ds.date} className="border border-gray-200 rounded-xl overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedDate(ds.date);
                                    setSelectedDate(ds.date);
                                    setSelectedSlot(null);
                                  }}
                                  className={`w-full flex items-center justify-between p-3 text-left ${isOpen ? 'bg-green-50' : 'bg-white'}`}
                                >
                                  <span className="font-medium text-gray-800">{ds.date}</span>
                                  <span className="text-xs text-gray-600">{totalSlots} franjas</span>
                                </button>
                                {isOpen && (
                                  <div className="p-3 flex flex-wrap gap-2 border-t border-gray-200">
                                    {ds.slots.map(slot => {
                                      const names = slot.gardenerIds
                                      .map(id => eligibleGardenerProfiles.find(p => (p as any).id === id)?.full_name)
                                        .filter(Boolean) as string[];
                                      const shown = names.slice(0, 3);
                                      const extra = names.length - shown.length;
                                      const namesLabel = shown.join(', ') + (extra > 0 ? ` +${extra} más` : '');
                                      return (
                                        <button
                                          key={`${ds.date}-${slot.startHour}`}
                                          onClick={() => { setSelectedDate(ds.date); setSelectedSlot(slot); }}
                                          className={`px-3 py-2 rounded-lg border ${selectedDate === ds.date && selectedSlot?.startHour === slot.startHour ? 'bg-green-600 text-white border-green-600' : 'bg-gray-100 text-gray-700 border-gray-300'}`}
                                        >
                                          <div className="text-sm">
                                            {slot.startHour}:00 - {slot.endHour}:00 ({slot.gardenerIds.length} jard.)
                                          </div>
                                          <div className="text-xs opacity-80">
                                            {namesLabel || '—'}
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {!loadingAvailability && dateSuggestions.length === 0 && (
                    <div className="text-center py-8">
                      {restrictedGardenerProfile ? (
                        <div className="bg-orange-50 border border-orange-200 rounded-xl p-6">
                          <div className="text-orange-800 font-medium mb-2">Este jardinero no tiene disponibilidad para tus requisitos</div>
                          <div className="text-orange-700 text-sm mb-4">Puede que el jardinero no esté disponible para este tipo de servicio, fecha o ubicación.</div>
                          <button
                            onClick={() => {
                              // Clear the restriction and navigate to normal booking flow
                              sessionStorage.removeItem('restrictedGardenerId');
                              navigate('/dashboard');
                            }}
                            className="px-4 py-2 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg border border-orange-200"
                          >
                            Buscar otros jardineros
                          </button>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-600">No encontramos disponibilidad inmediata. Pulsa "Ver más días" para ampliar la búsqueda.</div>
                      )}
                    </div>
                  )}

                      {eligibleGardenerIds.length > 0 && selectedSlot && (
                        <div className="mt-3 bg-green-50 border border-green-200 rounded-xl p-3">
                          <div className="text-green-800 text-sm">
                            Has seleccionado <span className="font-semibold">{selectedDate}</span> de <span className="font-semibold">{selectedSlot.startHour}:00</span> a <span className="font-semibold">{selectedSlot.endHour}:00</span>.
                          </div>
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => setStep('availability')}
                              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm"
                            >
                              Continuar con la reserva
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {step === 'availability' && (
                <div className="space-y-6">
                  {restrictedGardenerProfile && <GardenerInfoBanner />}
                  
                  {/* Header: Filtro y Título */}
                  <div className="bg-white sticky top-0 z-10 py-2 border-b border-gray-100">
                    <h3 className="text-lg font-bold text-gray-900 mb-3 px-1">Jardineros disponibles</h3>
                    <div className="flex gap-2 overflow-x-auto pb-2 px-1 scrollbar-hide">
                      <button
                        onClick={() => setTimeFilter('all')}
                        className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                          timeFilter === 'all' 
                            ? 'bg-green-600 text-white shadow-md' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        Todas las horas
                      </button>
                      <button
                        onClick={() => setTimeFilter('morning')}
                        className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                          timeFilter === 'morning' 
                            ? 'bg-green-600 text-white shadow-md' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        Mañana (hasta 14:00)
                      </button>
                      <button
                        onClick={() => setTimeFilter('afternoon')}
                        className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                          timeFilter === 'afternoon' 
                            ? 'bg-green-600 text-white shadow-md' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        Tarde (desde 14:00)
                      </button>
                    </div>
                  </div>

                  {loadingAvailability ? (
                    <div className="space-y-4 py-8">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="animate-pulse bg-white border border-gray-200 rounded-2xl p-4 flex gap-4">
                          <div className="w-16 h-16 bg-gray-200 rounded-full flex-shrink-0" />
                          <div className="flex-1 space-y-3">
                            <div className="h-4 bg-gray-200 rounded w-3/4" />
                            <div className="h-4 bg-gray-200 rounded w-1/2" />
                            <div className="h-8 bg-gray-200 rounded w-full" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : gardenerList.length > 0 ? (
                    <div className="space-y-4">
                      {gardenerList.map(gardener => {
                        const isSelected = selectedGardener?.user_id === gardener.user_id;
                        const earliest = gardener.earliestSlot;
                        
                        return (
                          <div 
                            key={gardener.user_id} 
                            className={`bg-white border-2 rounded-2xl overflow-hidden transition-all duration-300 ${
                              isSelected ? 'border-green-500 shadow-lg ring-1 ring-green-500' : 'border-gray-100 shadow-sm hover:border-green-200'
                            }`}
                          >
                            {/* Card Content */}
                            <div className="p-4 sm:p-5" onClick={() => {
                                if (isSelected) {
                                  setSelectedGardener(null);
                                  setGardenerWeekBlocks(new Map());
                                } else {
                                  setSelectedGardener(gardener);
                                  const start = earliest ? earliest.date : new Date().toISOString().slice(0, 10);
                                  setWeekStartDate(start);
                                  loadGardenerWeek(gardener.user_id, start);
                                }
                              }}>
                              <div className="flex gap-4 items-start">
                                {/* Avatar */}
                                <div className="flex-shrink-0">
                                  {gardener.avatar_url ? (
                                    <img 
                                      src={gardener.avatar_url} 
                                      alt={gardener.full_name} 
                                      className="w-16 h-16 rounded-full object-cover border border-gray-100 shadow-sm"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold text-xl border border-green-200">
                                      {gardener.full_name.charAt(0)}
                                    </div>
                                  )}
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex justify-between items-start">
                                    <h4 className="text-lg font-bold text-gray-900 truncate pr-2">
                                      {gardener.full_name}
                                    </h4>
                                    <div className="flex items-center bg-yellow-50 px-2 py-1 rounded-lg border border-yellow-100">
                                      <span className="text-yellow-500 text-sm">★</span>
                                      <span className="text-xs font-bold text-yellow-700 ml-1">
                                        {gardener.rating_average ? Number(gardener.rating_average).toFixed(1) : 'Nuevo'}
                                      </span>
                                    </div>
                                  </div>
                                  
                                  <div className="mt-2">
                                    <div className="text-2xl font-bold text-gray-900">
                                      €{gardener.finalPrice}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-0.5">
                                      {gardener.priceBreakdown || 'Precio estimado'}
                                    </div>
                                  </div>

                                  {earliest ? (
                                    <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-medium border border-green-100">
                                      <Clock className="w-3.5 h-3.5" />
                                      Primer hueco: {earliest.date} a las {earliest.startHour}:00
                                    </div>
                                  ) : (
                                    <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 text-gray-500 rounded-lg text-xs font-medium border border-gray-100">
                                      <Clock className="w-3.5 h-3.5" />
                                      Sin disponibilidad cercana
                                    </div>
                                  )}
                                </div>
                              </div>
                              
                              <button 
                                className={`w-full mt-4 py-3 rounded-xl font-semibold text-sm transition-colors ${
                                  isSelected 
                                    ? 'bg-green-600 text-white shadow-md' 
                                    : 'bg-white border border-green-600 text-green-600 hover:bg-green-50'
                                }`}
                              >
                                {isSelected ? 'Ocultar disponibilidad' : 'Ver disponibilidad'}
                              </button>
                            </div>

                            {/* Calendario Expandible */}
                            {isSelected && (
                              <div className="border-t border-gray-100 bg-gray-50 p-4 animate-in slide-in-from-top-2 duration-200">
                                <div className="flex items-center justify-between mb-4">
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const d = new Date(weekStartDate);
                                      d.setDate(d.getDate() - 7);
                                      const newStart = d.toISOString().slice(0, 10);
                                      setWeekStartDate(newStart);
                                      loadGardenerWeek(gardener.user_id, newStart);
                                    }}
                                    className="p-2 hover:bg-white rounded-full border border-transparent hover:border-gray-200 hover:shadow-sm transition-all"
                                  >
                                    <ChevronLeft className="w-5 h-5 text-gray-600" />
                                  </button>
                                  <span className="font-semibold text-gray-900 text-sm">
                                    Semana del {new Date(weekStartDate).toLocaleDateString()}
                                  </span>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const d = new Date(weekStartDate);
                                      d.setDate(d.getDate() + 7);
                                      const newStart = d.toISOString().slice(0, 10);
                                      setWeekStartDate(newStart);
                                      loadGardenerWeek(gardener.user_id, newStart);
                                    }}
                                    className="p-2 hover:bg-white rounded-full border border-transparent hover:border-gray-200 hover:shadow-sm transition-all"
                                  >
                                    <ChevronRight className="w-5 h-5 text-gray-600" />
                                  </button>
                                </div>

                                <div className="space-y-3">
                                  {Array.from(gardenerWeekBlocks.entries()).map(([date, blocks]) => {
                                    const visibleBlocks = blocks.filter(b => b.available);
                                    if (visibleBlocks.length === 0) return null;
                                    
                                    return (
                                      <div key={date} className="bg-white rounded-xl p-3 border border-gray-100 shadow-sm">
                                        <div className="text-xs font-bold text-gray-500 uppercase mb-2">
                                          {new Date(date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric' })}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                          {visibleBlocks.map(block => {
                                            const isSlotSelected = selectedDate === date && selectedSlot?.startHour === block.hour;
                                            return (
                                              <button
                                                key={`${date}-${block.hour}`}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setSelectedDate(date);
                                                  setSelectedSlot({
                                                    startHour: block.hour,
                                                    endHour: block.hour + estimatedHours,
                                                    gardenerIds: [gardener.user_id]
                                                  });
                                                }}
                                                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                                                  isSlotSelected 
                                                    ? 'bg-green-600 text-white border-green-600 shadow-md transform scale-105' 
                                                    : 'bg-white text-gray-700 border-gray-200 hover:border-green-400 hover:bg-green-50'
                                                }`}
                                              >
                                                {block.hour}:00
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {Array.from(gardenerWeekBlocks.values()).every(b => !b.some(x => x.available)) && (
                                    <div className="text-center py-6 text-gray-500 text-sm bg-white rounded-xl border border-dashed border-gray-300">
                                      No hay huecos libres esta semana
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-12 px-4">
                      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Clock className="w-8 h-8 text-gray-400" />
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900">No encontramos jardineros</h3>
                      <p className="text-gray-500 mt-1 max-w-xs mx-auto">
                        Intenta cambiar el filtro de horario o espera unos momentos.
                      </p>
                    </div>
                  )}

                  <div className="fixed bottom-0 left-0 right-0 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] bg-white border-t border-gray-200 shadow-lg sm:static sm:bg-transparent sm:border-0 sm:shadow-none sm:p-0">
                    <button
                      onClick={confirmAndSend}
                      disabled={!selectedSlot || !selectedGardener || sending}
                      className="w-full sm:w-auto px-6 py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-[0.98] transition-all"
                    >
                      {selectedSlot 
                        ? `Reservar para el ${new Date(selectedDate).toLocaleDateString()} a las ${selectedSlot.startHour}:00` 
                        : 'Selecciona un hueco para continuar'}
                    </button>
                  </div>
                  {/* Spacer for fixed bottom button on mobile */}
                  <div className="h-24 sm:h-0" />
                </div>
              )}

              {step === 'confirm' && (
                <div className="text-center py-16">
                  {restrictedGardenerProfile && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-8 max-w-md mx-auto">
                      <div className="text-blue-800 font-semibold mb-4">Resumen de tu reserva</div>
                      <div className="space-y-3 text-left">
                        <div className="flex items-center gap-3">
                          {restrictedGardenerProfile.avatar_url && (
                            <img 
                              src={restrictedGardenerProfile.avatar_url} 
                              alt={restrictedGardenerProfile.full_name}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          )}
                          <div>
                            <div className="text-sm text-blue-600">Jardinero seleccionado</div>
                            <div className="font-semibold text-blue-900">{restrictedGardenerProfile.full_name}</div>
                          </div>
                        </div>
                        {selectedServiceIds.length > 0 && (
                          <div>
                            <div className="text-sm text-blue-600">Servicio</div>
                            <div className="text-blue-900">{services.find(s => s.id === selectedServiceIds[0])?.name}</div>
                          </div>
                        )}
                        {selectedDate && (
                          <div>
                            <div className="text-sm text-blue-600">Fecha</div>
                            <div className="text-blue-900">{selectedDate}</div>
                          </div>
                        )}
                        {selectedSlot && (
                          <div>
                            <div className="text-sm text-blue-600">Hora</div>
                            <div className="text-blue-900">{selectedSlot.startHour}:00 - {selectedSlot.endHour}:00</div>
                          </div>
                        )}
                        {(aiPriceTotal > 0 || totalPrice > 0) && (
                          <div>
                            <div className="text-sm text-blue-600">Precio estimado</div>
                            <div className="text-blue-900 font-semibold">€{Math.ceil(aiPriceTotal > 0 ? aiPriceTotal : totalPrice)}</div>
                          </div>
                        )}
                        <div className="pt-3 border-t border-blue-200">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={receiveNotifications}
                              onChange={(e) => setReceiveNotifications(e.target.checked)}
                              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                            />
                            <span className="text-sm text-blue-800">Recibir notificaciones sobre esta reserva</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                  <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
                  <h3 className="text-2xl font-semibold text-gray-900 mb-2">¡Solicitud enviada!</h3>
                  <p className="text-gray-600">
                    {restrictedGardenerProfile 
                      ? `Hemos enviado tu solicitud a ${restrictedGardenerProfile.full_name}. Si acepta, se quedará con el trabajo.`
                      : "Hemos enviado tu solicitud a los jardineros disponibles. El primero en aceptar se quedará con el trabajo."
                    }
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {(!(location.pathname.startsWith('/reserva') || location.pathname.startsWith('/reservar'))) && (
        <div className="mt-8 space-y-6">
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Qué es Garser</h2>
            <p className="text-gray-700 text-sm">
              GarSer es tu servicio de jardinería de confianza. Te ayudamos a reservar trabajos de forma rápida, clara y sin complicaciones.
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">A qué nos dedicamos</h2>
            <p className="text-gray-700 text-sm">
              Corte de césped, poda de setos y árboles, limpieza de malas hierbas, fumigación de plantas y mantenimiento general del jardín.
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Qué servicios ofrecemos</h2>
            <p className="text-gray-700 text-sm">
              Trabajos puntuales y planes de mantenimiento. Presupuestos claros con estimación de horas y precio total.
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl p-6">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">Por qué confiar en nosotros</h2>
            <p className="text-gray-700 text-sm">
              Profesionales verificados, comunicación transparente y soporte en cada paso. No necesitas registrarte para empezar tu reserva.
            </p>
          </div>
        </div>
      )}
      {showAuthPrompt && null}
    </div>
  );
};

export default ClientHome;
