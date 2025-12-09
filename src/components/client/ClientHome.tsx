import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import AddressAutocomplete from '../common/AddressAutocomplete';
import { Service } from '../../types';
import { Wand2, Calendar, Image as ImageIcon, CheckCircle, ChevronRight, ChevronLeft, ChevronDown, Clock, Euro } from 'lucide-react';
import { estimateWorkWithAI, AITask } from '../../utils/aiPricingEstimator';
import { findEligibleGardenersForServices, computeNextAvailableDays, MergedSlot } from '../../utils/mergedAvailabilityService';
import { broadcastBookingRequest } from '../../utils/bookingBroadcastService';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';

type WizardStep = 'welcome' | 'address' | 'details' | 'availability' | 'confirm';

const ClientHome: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
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
      } else if (tipo.includes('arbustos') || tipo.includes('tijera') || tipo.includes('ramas')) {
        if (t.numero_plantas != null) {
          const sz = (t.tamaño_plantas || '').toLowerCase();
          const perPlant = sz.includes('muy grandes') || sz.includes('grandisimas') ? 0.35
            : sz.includes('grandes') ? 0.25
            : sz.includes('medianas') ? 0.15
            : 0.1; // pequeñas por defecto
          h = (t.numero_plantas * perPlant) * factor;
          p = h * 20;
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
    if (aiTimeTotal > 0) {
      setEstimatedHours(Math.ceil(aiTimeTotal));
    } else {
      setEstimatedHours(0);
    }
  }, [aiTimeTotal]);

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
          'corte de arbustos pequenos o ramas finas a tijera',
          'labrar y quitar malas hierbas a mano',
          'fumigacion de plantas',
        ];
        const present = new Set((data || []).map(s => normalizeText(s.name)));
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

  const handleStart = () => setStep('address');

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

            for (let i = 0; i < photos.length; i++) {
              const file = photos[i];
              console.log(`[AI] uploading photo ${i+1}/${photos.length}`, { name: file.name, type: file.type });
              const safeName = sanitizeFileName(file.name || `foto_${i}.jpg`);
              const path = `drafts/${userId}/${now}_${i}_${safeName}`;
              const { error: uploadError } = await supabase.storage
                .from(bucket)
                .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
              if (uploadError) {
                console.warn(`[AI] upload error photo ${i+1}:`, uploadError.message);
                continue;
              }
              console.log(`[AI] photo ${i+1} uploaded`, { path });
              const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
              if (signed?.signedUrl) {
                photoUrls.push(signed.signedUrl);
                console.log(`[AI] url resolved (signed) for photo ${i+1}`, { url: signed.signedUrl });
              }
            }
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
  
      console.log('[AI] calling estimateWorkWithAI', { photoUrlsLen: photoUrls.length, descriptionLen: description.length, selectedServiceIdsLen: selectedServiceIds.length });
      const result = await estimateWorkWithAI({
        description,
        photoCount: photos.length,
        selectedServiceIds,
        photoUrls,
      });
      const tareas = Array.isArray(result.tareas) ? result.tareas : [];
      console.log('[AI] estimateWorkWithAI returned', {
        tareasCount: tareas.length,
        hasReasons: Array.isArray(result.reasons),
      });
      setAiTasks(tareas);
      // Si no hay servicios seleccionados, intentar deducirlos de las tareas IA
      if (selectedServiceIds.length === 0 && tareas.length > 0 && services.length > 0) {
        const inferred = deriveServiceIdsFromAITasks(tareas, services);
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
      }
    } finally {
      setAnalyzing(false);
    }
  };

  // Prefetch disponibilidad automáticamente tras tener estimación IA y datos clave
  useEffect(() => {
    const ready = !!user?.id && !!selectedAddress && selectedServiceIds.length > 0 && estimatedHours > 0;
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
  }, [user?.id, selectedAddress, selectedServiceIds, estimatedHours, prefetchedAvailability]);

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
      // Cargar nombres de perfiles para mostrar jardineros
      if (ids.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', ids);
        if (!profilesError && profiles) {
          setEligibleGardenerProfiles(profiles as any);
        } else {
          setEligibleGardenerProfiles([]);
        }
      } else {
        setEligibleGardenerProfiles([]);
      }
      const startDate = new Date().toISOString().slice(0, 10);
      const suggestions = await computeNextAvailableDays(ids, startDate, user?.id || 'anonymous', estimatedHours, 10, 7);
      console.log('[avail] sugerencias de días/horas', { days: suggestions.length, first: suggestions[0] });
      setDateSuggestions(suggestions);
      if (suggestions.length > 0) {
        setSelectedDate(suggestions[0].date);
        setSelectedSlot(suggestions[0].slots[0] || null);
      }
    } catch (e) {
      console.error('Error obteniendo disponibilidad:', e);
    } finally {
      setLoadingAvailability(false);
    }
  };

  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [receiveNotifications, setReceiveNotifications] = useState(true);

  const confirmAndSend = async () => {
    if (!selectedSlot || !selectedDate || eligibleGardenerIds.length === 0) return;
    if (!user) {
      setShowAuthPrompt(true);
      try {
        const redirectState = {
          restrictedGardenerId,
          preserved: {
            selectedAddress,
            selectedServiceIds,
            description,
            estimatedHours,
            selectedDate,
            selectedSlot
          }
        } as any;
        sessionStorage.setItem('post_auth_redirect', JSON.stringify({ path: '/reserva', state: redirectState }));
      } catch {}
      return;
    }
    setSending(true);
    try {
      const effectivePrice = aiPriceTotal > 0 ? aiPriceTotal : totalPrice;
      const roundedPrice = Math.ceil(effectivePrice);
      await broadcastBookingRequest({
        clientId: user.id,
        gardenerIds: eligibleGardenerIds,
        primaryServiceId: selectedServiceIds[0],
        date: selectedDate,
        startHour: selectedSlot.startHour,
        durationHours: estimatedHours,
        clientAddress: selectedAddress,
        notes: description,
        totalPrice: roundedPrice,
        hourlyRate: hourlyRateAverage,
        photoFiles: photos,
      });
      setStep('confirm');
    } catch (e) {
      console.error('Error enviando solicitudes de reserva:', e);
    } finally {
      setSending(false);
    }
  };

  const hasProcessedRef = useRef(false);

  useEffect(() => {
    const processPending = async () => {
      if (!user?.id) return;
      if (hasProcessedRef.current) return;
      hasProcessedRef.current = true;
      try {
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
        <div className="p-4 sm:p-6">
          {applicationStatus === 'submitted' ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 bg-yellow-100 text-yellow-700 rounded-full flex items-center justify-center mb-4">
                <Clock className="w-8 h-8" />
              </div>
              <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">Tu solicitud está en revisión</h2>
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
                    <button onClick={goNext} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 inline-flex items-center text-sm sm:text-base">
                      Siguiente <ChevronRight className="w-4 h-4 ml-1" />
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
                  <label className="block text-base sm:text-lg font-semibold text-gray-800">Dirección</label>
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
                      className="w-full p-3 sm:p-4 text-sm sm:text-base border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent"
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

                  {(aiTimeTotal > 0 || aiPriceTotal > 0 || (estimatedHours > 0 && totalPrice > 0)) && (
                    <div className="mt-4 bg-white border border-gray-200 rounded-lg p-4">
                      <h4 className="text-gray-900 font-semibold mb-2">Estimación</h4>
                      <div className="flex items-center gap-6">
                        <div className="flex items-center text-gray-700">
                          <Clock className="w-4 h-4 mr-2" />
                          {Math.ceil(aiTimeTotal > 0 ? aiTimeTotal : estimatedHours)} h
                        </div>
                        <div className="flex items-center text-gray-700">
                          <Euro className="w-4 h-4 mr-2" />
                          €{Math.ceil(aiPriceTotal > 0 ? aiPriceTotal : totalPrice)}
                        </div>
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
                                        .map(id => eligibleGardenerProfiles.find(p => p.user_id === id)?.full_name)
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
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-semibold text-gray-800">Fechas disponibles</h3>
                    <div className="flex gap-2">
                      {restrictedGardenerProfile && (
                        <button
                          onClick={() => {
                            // Clear the restriction and navigate to normal booking flow
                            sessionStorage.removeItem('restrictedGardenerId');
                            navigate('/dashboard');
                          }}
                          className="px-4 py-2 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg border border-orange-200"
                        >
                          Buscar otros jardineros disponibles
                        </button>
                      )}
                      <button
                        onClick={fetchAvailability}
                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700"
                      >
                        Buscar disponibilidad
                      </button>
                    </div>
                  </div>

                  {eligibleGardenerProfiles.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-xl p-4">
                      <div className="text-sm text-gray-800 font-medium mb-2">Jardineros que pueden realizar estos trabajos</div>
                      <div className="flex flex-wrap gap-2">
                        {eligibleGardenerProfiles.map(p => (
                          <span key={p.user_id} className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-lg border border-gray-200">
                            {p.full_name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {loadingAvailability && (
                    <div className="flex items-center gap-2 text-gray-600"><ImageIcon className="w-4 h-4" /> Buscando disponibilidad...</div>
                  )}

                  {!loadingAvailability && dateSuggestions.length > 0 && (
                    <div className="space-y-2">
                      {dateSuggestions.map(ds => {
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
                              <div>
                                <div className="font-medium text-gray-800">{ds.date}</div>
                                <div className="text-sm text-gray-600">{totalSlots} franjas disponibles</div>
                              </div>
                              <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {isOpen && (
                              <div className="p-3 bg-gray-50 border-t border-gray-200">
                                <div className="flex flex-wrap gap-2">
                                  {ds.slots.map(slot => {
                                    const names = slot.gardenerIds
                                      .map(id => eligibleGardenerProfiles.find(p => p.user_id === id)?.full_name)
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
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {eligibleGardenerIds.length > 0 && selectedSlot && (
                    <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                      <div className="text-green-800 font-medium">
                        Se notificará automáticamente a {eligibleGardenerIds.length} jardineros disponibles.
                      </div>
                    </div>
                  )}

                  <div>
                    <button
                      onClick={confirmAndSend}
                      disabled={!selectedSlot || eligibleGardenerIds.length === 0 || sending}
                      className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
                    >
                      Confirmar y enviar solicitudes
                    </button>
                  </div>
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
      {showAuthPrompt && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-semibold text-gray-900 mb-2">Necesitamos identificarte</h3>
            <p className="text-sm text-gray-600 mb-4">Para enviar tu solicitud, inicia sesión o regístrate como cliente.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => { sessionStorage.setItem('post_auth_force_client', 'true'); navigate('/auth', { state: { forceClientOnly: true } }); }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Iniciar sesión
              </button>
              <button
                type="button"
                onClick={() => { sessionStorage.setItem('post_auth_force_client', 'true'); navigate('/auth', { state: { forceClientOnly: true } }); }}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Registrarse (Cliente)
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowAuthPrompt(false)}
              className="mt-4 text-sm text-gray-600 hover:text-gray-800"
            >
              Seguir editando datos
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientHome;
