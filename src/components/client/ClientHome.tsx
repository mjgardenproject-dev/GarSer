import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import AddressAutocomplete from '../common/AddressAutocomplete';
import { Service } from '../../types';
import { Wand2, Calendar, Image as ImageIcon, CheckCircle, ChevronRight, ChevronLeft, ChevronDown, Clock, Euro } from 'lucide-react';
import { estimateWorkWithAI, AITask } from '../../utils/aiPricingEstimator';
import { findEligibleGardenersForServices, computeNextAvailableDays, MergedSlot } from '../../utils/mergedAvailabilityService';
import { broadcastBookingRequest } from '../../utils/bookingBroadcastService';
import { useNavigate } from 'react-router-dom';

type WizardStep = 'welcome' | 'address' | 'details' | 'availability' | 'confirm';

const ClientHome: React.FC = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>('welcome');

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
  const [eligibleGardenerProfiles, setEligibleGardenerProfiles] = useState<{ user_id: string; full_name: string }[]>([]);
  const [dateSuggestions, setDateSuggestions] = useState<{ date: string; slots: MergedSlot[] }[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<MergedSlot | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [sending, setSending] = useState(false);
  const [prefetchedAvailability, setPrefetchedAvailability] = useState(false);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  // Cuando llegan sugerencias, expandir por defecto el primer día
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

        // Fallback: inline data URLs si no hay URLs de Storage
        if (photos.length > 0 && photoUrls.length === 0) {
          console.warn('[AI] no storage URLs; preparing inline data URLs fallback');
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
              if (dataUrl) {
                photoUrls.push(dataUrl);
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
    if (!user?.id) return;
    if (!selectedAddress || selectedServiceIds.length === 0 || estimatedHours <= 0) return;
    setLoadingAvailability(true);
    try {
      console.log('[avail] buscando jardineros elegibles...', {
        selectedServiceIds,
        address: selectedAddress,
        estimatedHours,
      });
      const gardeners = await findEligibleGardenersForServices(selectedServiceIds, selectedAddress);
      const ids = gardeners.map(g => (g as any).user_id);
      console.log('[avail] jardineros encontrados', { count: ids.length, ids });
      setEligibleGardenerIds(ids);
      // Cargar nombres de perfiles para mostrar jardineros
      if (ids.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('user_id, full_name')
          .in('user_id', ids);
        if (!profilesError && profiles) {
          setEligibleGardenerProfiles(profiles as any);
        } else {
          setEligibleGardenerProfiles([]);
        }
      } else {
        setEligibleGardenerProfiles([]);
      }
      const startDate = new Date().toISOString().slice(0, 10);
      const suggestions = await computeNextAvailableDays(ids, startDate, user.id, estimatedHours, 10, 7);
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

  const confirmAndSend = async () => {
    if (!user || !profile) return;
    if (!selectedSlot || !selectedDate || eligibleGardenerIds.length === 0) return;
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

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-600 to-green-500 p-5 sm:p-8 text-white">
          <h1 className="text-2xl sm:text-3xl font-bold">Bienvenido{profile?.full_name ? `, ${profile.full_name}` : ''}</h1>
          <p className="mt-2 opacity-90 text-sm sm:text-base">Solicita un presupuesto y reserva el trabajo de jardinería que necesites al instante.</p>
        </div>

        {/* Wizard content */}
        <div className="p-4 sm:p-6">
          {/* Controls */}
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <div className="text-sm text-gray-600">Paso: {['Inicio','Dirección','Detalles','Disponibilidad','Confirmación'][['welcome','address','details','availability','confirm'].indexOf(step)]}</div>
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
              <p className="text-gray-600 mb-8 text-sm sm:text-base">Tu nueva experiencia de reserva de jardinería, simple y directa.</p>
              <button onClick={handleStart} className="px-6 sm:px-8 py-3 sm:py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl text-base sm:text-lg font-semibold shadow-lg transform hover:scale-[1.02] transition">
                Empezar
              </button>
            </div>
          )}

          {step === 'address' && (
            <div className="space-y-3 sm:space-y-4">
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
              {/* Eliminado el selector manual de servicios; flujo 100% por IA */}

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

              {/* Disponibilidad inmediata bajo presupuesto y horas */}
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
                    <div className="text-sm text-gray-600">No encontramos disponibilidad inmediata. Pulsa "Ver más días" para ampliar la búsqueda.</div>
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
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold text-gray-800">Fechas disponibles</h3>
                <button
                  onClick={fetchAvailability}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700"
                >
                  Buscar disponibilidad
                </button>
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
              <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">¡Solicitud enviada!</h3>
              <p className="text-gray-600">Hemos enviado tu solicitud a los jardineros disponibles. El primero en aceptar se quedará con el trabajo.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClientHome;