import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import AddressAutocomplete from '../common/AddressAutocomplete';
import { Service } from '../../types';
import { Wand2, Calendar, Image as ImageIcon, CheckCircle, ChevronRight, ChevronLeft } from 'lucide-react';
import { estimateWorkWithAI, AITask } from '../../utils/aiPricingEstimator';
import { findEligibleGardenersForServices, computeNextAvailableDays, MergedSlot } from '../../utils/mergedAvailabilityService';
import { broadcastBookingRequest } from '../../utils/bookingBroadcastService';

type WizardStep = 'welcome' | 'address' | 'details' | 'availability' | 'confirm';

const ClientHome: React.FC = () => {
  const { user, profile } = useAuth();
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
  const [dateSuggestions, setDateSuggestions] = useState<{ date: string; slots: MergedSlot[] }[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<MergedSlot | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const fetchServices = async () => {
      const { data, error } = await supabase.from('services').select('*').order('name');
      if (!error && data) setServices(data);
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
        try {
          const { supabase } = await import('../../lib/supabase');
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
            // Obtener URL pública o firmada
            const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(path);
            if (publicUrlData?.publicUrl) {
              photoUrls.push(publicUrlData.publicUrl);
              console.log(`[AI] url resolved (public) for photo ${i+1}`, { url: publicUrlData.publicUrl });
            } else {
              const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
              if (signed?.signedUrl) {
                photoUrls.push(signed.signedUrl);
                console.log(`[AI] url resolved (signed) for photo ${i+1}`, { url: signed.signedUrl });
              }
            }
          }
          console.log('[AI] photo upload done', { photoUrlsLen: photoUrls.length });
        } catch (err) {
          console.warn('No se pudieron preparar URLs de fotos para IA, se seguirá sin imágenes:', err);
        }
      } else if (photos.length > 0 && disablePhotoUpload) {
        console.warn('[AI] Photo upload disabled by env; continuing without images');
      }
  
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
    } catch (e) {
      console.warn('AI analysis error, using fallback:', e);
      setAiTasks([]);
    } finally {
      setAnalyzing(false);
    }
  };

  const fetchAvailability = async () => {
    if (!user) return;
    if (!selectedAddress || selectedServiceIds.length === 0 || estimatedHours <= 0) return;
    setLoadingAvailability(true);
    try {
      const gardeners = await findEligibleGardenersForServices(selectedServiceIds, selectedAddress);
      const ids = gardeners.map(g => (g as any).user_id);
      setEligibleGardenerIds(ids);
      const startDate = new Date().toISOString().slice(0, 10);
      const suggestions = await computeNextAvailableDays(ids, startDate, user.id, estimatedHours, 10, 7);
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
      await broadcastBookingRequest({
        clientId: user.id,
        gardenerIds: eligibleGardenerIds,
        primaryServiceId: selectedServiceIds[0],
        date: selectedDate,
        startHour: selectedSlot.startHour,
        durationHours: estimatedHours,
        clientAddress: selectedAddress,
        notes: description,
        totalPrice: totalPrice,
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
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-600 to-green-500 p-8 text-white">
          <h1 className="text-3xl font-bold">Bienvenido{profile?.full_name ? `, ${profile.full_name}` : ''}</h1>
          <p className="mt-2 opacity-90">Solicita un presupuesto y reserva el trabajo de jardinería que necesites al instante.</p>
        </div>

        {/* Wizard content */}
        <div className="p-6">
          {/* Controls */}
          <div className="flex items-center justify-between mb-6">
            <div className="text-sm text-gray-600">Paso: {['Inicio','Dirección','Detalles','Disponibilidad','Confirmación'][['welcome','address','details','availability','confirm'].indexOf(step)]}</div>
            <div className="space-x-2">
              {step !== 'welcome' && (
                <button onClick={goBack} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 inline-flex items-center">
                  <ChevronLeft className="w-4 h-4 mr-1" /> Atrás
                </button>
              )}
              {step !== 'confirm' && (
                <button onClick={goNext} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 inline-flex items-center">
                  Siguiente <ChevronRight className="w-4 h-4 ml-1" />
                </button>
              )}
            </div>
          </div>

          {step === 'welcome' && (
            <div className="text-center py-16">
              <p className="text-gray-600 mb-8">Tu nueva experiencia de reserva de jardinería, simple y directa.</p>
              <button onClick={handleStart} className="px-8 py-4 bg-green-600 hover:bg-green-700 text-white rounded-xl text-lg font-semibold shadow-lg transform hover:scale-[1.02] transition">
                Empezar
              </button>
            </div>
          )}

          {step === 'address' && (
            <div className="space-y-4">
              <label className="block text-lg font-semibold text-gray-800">Dirección</label>
              <AddressAutocomplete value={selectedAddress} onChange={handleAddressSelected} error={addressError} />
              {selectedAddress && (
                <div className="text-sm text-gray-600">Dirección seleccionada: <span className="font-medium">{selectedAddress}</span></div>
              )}
              {addressError && <div className="text-sm text-red-600">{addressError}</div>}
              <div className="pt-2">
                <button
                  onClick={() => validateAddressHasNumber(selectedAddress) && setStep('details')}
                  className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg"
                >
                  Continuar
                </button>
              </div>
            </div>
          )}

          {step === 'details' && (
            <div className="space-y-6">
              <div>
                <label className="block text-lg font-semibold text-gray-800 mb-2">¿Qué tipo de servicio necesitas?</label>
                <div className="flex flex-wrap gap-2">
                  {services.map(s => (
                    <button
                      key={s.id}
                      onClick={() => toggleService(s.id)}
                      className={`px-3 py-2 rounded-full border ${selectedServiceIds.includes(s.id) ? 'bg-green-600 text-white border-green-600' : 'bg-gray-100 text-gray-700 border-gray-300'} text-sm`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-lg font-semibold text-gray-800 mb-2">Fotos del jardín</label>
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center">
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
                <label className="block text-lg font-semibold text-gray-800 mb-2">Describe el trabajo</label>
                <textarea
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="Ej: Quiero un corte de césped y que poden los setos de la imagen"
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={runAIAnalysis}
                  disabled={analyzing}
                  className="px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg inline-flex items-center disabled:opacity-50"
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

              {aiTimeTotal > 0 && (
                <div className="mt-4 bg-white rounded-lg border border-green-200 p-3">
                  <div className="text-sm text-gray-800">
                    <span className="font-medium">🧮 Resultado final</span>
                    <span>{' • '}Tiempo total: <span className="font-semibold">{aiTimeTotal} {aiTimeTotal === 1 ? 'hora' : 'horas'}</span></span>
                    <span>{' • '}Precio total: <span className="font-semibold">€{aiPriceTotal}</span></span>
                  </div>
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

              {loadingAvailability && (
                <div className="flex items-center gap-2 text-gray-600"><ImageIcon className="w-4 h-4" /> Buscando disponibilidad...</div>
              )}

              {!loadingAvailability && dateSuggestions.length > 0 && (
                <div className="space-y-4">
                  {dateSuggestions.map(ds => (
                    <div key={ds.date} className="border border-gray-200 rounded-xl p-4">
                      <div className="font-medium text-gray-800 mb-2">{ds.date}</div>
                      <div className="flex flex-wrap gap-2">
                        {ds.slots.map(slot => (
                          <button
                            key={`${ds.date}-${slot.startHour}`}
                            onClick={() => { setSelectedDate(ds.date); setSelectedSlot(slot); }}
                            className={`px-3 py-2 rounded-lg border ${selectedDate === ds.date && selectedSlot?.startHour === slot.startHour ? 'bg-green-600 text-white border-green-600' : 'bg-gray-100 text-gray-700 border-gray-300'}`}
                          >
                            {slot.startHour}:00 - {slot.endHour}:00 ({slot.gardenerIds.length} jard.)
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
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