import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronLeft, Camera, Upload, Trash2, Wand2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { estimateWorkWithAI, estimateServiceAutoQuote } from '../../utils/aiPricingEstimator';

const DetailsPage: React.FC = () => {
  const navigate = useNavigate();
  const { bookingData, setBookingData, saveProgress, setCurrentStep } = useBooking();
  const [photos, setPhotos] = useState<File[]>(bookingData.photos);
  const [description, setDescription] = useState(bookingData.description);
  const [analyzing, setAnalyzing] = useState(false);
  const [debugService, setDebugService] = useState<string>('');
  const [debugState, setDebugState] = useState<string>('normal');
  const [debugQuantity, setDebugQuantity] = useState<number | ''>('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files).filter(file => 
      file.type.startsWith('image/')
    );
    
    if (files.length + photos.length > 5) {
      alert('Máximo 5 fotos permitidas');
      return;
    }

    setPhotos(prev => [...prev, ...files]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(file => 
      file.type.startsWith('image/')
    );
    
    if (files.length + photos.length > 5) {
      alert('Máximo 5 fotos permitidas');
      return;
    }

    setPhotos(prev => [...prev, ...files]);
  };

  const removePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleContinue = () => {
    setBookingData({ photos, description });
    saveProgress();
    setCurrentStep(3);
  };

  const runAIAnalysis = async () => {
    try {
      setAnalyzing(true);
      const photoUrls: string[] = [];
      if (photos.length > 0) {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id || 'anon';
        const bucket = (import.meta.env.VITE_BOOKING_PHOTOS_BUCKET as string | undefined) || 'booking-photos';
        const now = Date.now();
        await Promise.allSettled(photos.map(async (file, i) => {
          const safeName = (file.name || `foto_${i}.jpg`).toLowerCase().replace(/[^a-z0-9._-]/g, '_');
          const path = `drafts/${userId}/${now}_${i}_${safeName}`;
          const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
          if (!uploadError) {
            const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
            if (signed?.signedUrl) photoUrls.push(signed.signedUrl);
          }
        }));
      }

      const primaryServiceName = bookingData.serviceIds.length === 1 ? undefined : undefined;
      const firstImageUrl = photoUrls[0];
      if (bookingData.serviceIds.length === 1 && firstImageUrl) {
        const svc = bookingData.serviceIds[0];
        const { data: svcRow } = await supabase.from('services').select('name').eq('id', svc).maybeSingle();
        const svcName = (svcRow as any)?.name as string | undefined;
        if (svcName) {
          const auto = await estimateServiceAutoQuote({ service: svcName, imageUrl: firstImageUrl, description: '' });
          if (auto?.analysis && auto?.result) {
            const qty = Math.max(0, Number(auto.analysis.cantidad || 0));
            const unit = String(auto.analysis.unidad || '');
            const diff = Number(auto.analysis.dificultad || 1);
            const hours = Math.max(0, Number(auto.result.tiempo_estimado_horas || 0));
            setBookingData({ estimatedHours: Math.ceil(hours), aiQuantity: qty, aiUnit: unit, aiDifficulty: diff });
            saveProgress();
            return;
          }
        }
      }

      const res = await estimateWorkWithAI({ description, photoCount: photos.length, selectedServiceIds: bookingData.serviceIds, photoUrls });
      const tareas = Array.isArray(res.tareas) ? res.tareas : [];
      if (tareas.length > 0) {
        const norm = (s: string) => (s || '').toLowerCase();
        const perfHours = (t: any) => {
          const tipo = norm(t.tipo_servicio || '');
          const estado = norm(t.estado_jardin || '');
          const mult = estado.includes('muy') ? 1.6 : estado.includes('descuidado') ? 1.3 : 1.0;
          let h = 0;
          if (tipo.includes('césped') || tipo.includes('cesped')) {
            h = (Number(t.superficie_m2 || 0) / 150) * mult;
          } else if (tipo.includes('setos') || tipo.includes('seto')) {
            h = (Number(t.superficie_m2 || 0) / 8.4) * mult;
          } else if (tipo.includes('poda de árboles') || tipo.includes('poda de arboles') || (tipo.includes('poda') && (tipo.includes('árbol') || tipo.includes('arbol')))) {
            h = Number(t.numero_plantas || 0) * 1.0 * mult;
          } else if (tipo.includes('poda de plantas') || (tipo.includes('poda') && tipo.includes('planta'))) {
            h = Number(t.numero_plantas || 0) * 0.15 * mult;
          } else if (tipo.includes('malas hierbas') || tipo.includes('hierbas') || tipo.includes('maleza') || tipo.includes('labrar')) {
            h = (Number(t.superficie_m2 || 0) / 20) * mult;
          } else if (tipo.includes('fumig')) {
            h = Number(t.numero_plantas || 0) * 0.05 * mult;
          }
          return Math.max(0, h);
        };
        const total = Math.ceil(tareas.reduce((acc, t) => acc + perfHours(t), 0));
        const first = tareas[0];
        const qty = Number(first.superficie_m2 ?? first.numero_plantas ?? 0);
        const unit = first.superficie_m2 != null ? 'm2' : 'plantas';
        const diff = first.estado_jardin?.includes('muy') ? 3 : first.estado_jardin?.includes('descuidado') ? 2 : 1;
        setBookingData({ aiTasks: tareas, estimatedHours: total, aiQuantity: qty, aiUnit: unit, aiDifficulty: diff });
        saveProgress();
      }
    } catch {}
    finally {
      setAnalyzing(false);
    }
  };

  const gardenSizeSuggestions = [
    { label: 'Pequeño', value: 50 },
    { label: 'Mediano', value: 150 },
    { label: 'Grande', value: 300 },
    { label: 'Muy grande', value: 500 },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => setCurrentStep(1)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">Detalles</h1>
          <div className="w-9" />
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-white">
        <div className="max-w-md mx-auto px-4 py-3">
          <div className="flex items-center space-x-2 text-sm text-gray-600 mb-2">
            <span>Paso 3 de 5</span>
            <div className="flex-1 bg-gray-200 rounded-full h-1">
              <div className="bg-green-600 h-1 rounded-full" style={{ width: '60%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-md mx-auto px-4 py-6 pb-24">
        {/* Photo Upload */}
        <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Fotos de tu jardín</h2>
            <span className="text-sm text-gray-500">{photos.length}/5</span>
          </div>
          <p className="text-gray-600 text-sm mb-4">
            Las fotos ayudan a los jardineros a entender mejor tu espacio
          </p>

          {/* Upload Area */}
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              dragActive ? 'border-green-600 bg-green-50' : 'border-gray-300'
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 font-medium mb-1">Arrastra fotos aquí</p>
            <p className="text-gray-500 text-sm mb-3">o haz clic para seleccionar</p>
            <button className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors">
              <Camera className="w-4 h-4 inline mr-2" />
              Elegir fotos
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Photo Preview */}
          {photos.length > 0 && (
            <div className="mt-4">
              <div className="flex gap-2 overflow-x-auto pb-2">
                {photos.map((photo, index) => (
                  <div key={index} className="relative flex-shrink-0">
                    <img
                      src={URL.createObjectURL(photo)}
                      alt={`Foto ${index + 1}`}
                      className="w-20 h-20 object-cover rounded-lg"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removePhoto(index);
                      }}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Analizar con IA</h2>
          <button
            onClick={runAIAnalysis}
            disabled={analyzing || photos.length === 0 || bookingData.serviceIds.length === 0}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
          >
            <Wand2 className="w-4 h-4 inline mr-2" /> Analizar con IA
          </button>
        </div>
        <p className="text-sm text-gray-600">Usa las fotos y el servicio seleccionado para estimar cantidad y horas automáticamente.</p>
      </div>

        <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
          <h2 className="text-lg font-bold text-gray-900 mb-2">Describe el trabajo</h2>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej: Quiero un corte de césped y que poden los setos de la imagen"
            className="w-full p-4 border border-gray-300 rounded-xl resize-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-base sm:text-sm"
            rows={4}
          />
      </div>

        {bookingData.aiTasks && bookingData.aiTasks.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-4">
            <h3 className="text-green-800 font-semibold mb-3">Resultado IA</h3>
            <ul className="space-y-2">
              {bookingData.aiTasks.map((t, idx) => {
                const tipo = t.tipo_servicio || '';
                const qty = t.superficie_m2 ?? t.numero_plantas ?? 0;
                const unit = t.superficie_m2 != null ? 'm²' : 'plantas';
                const estado = t.estado_jardin || '';
                return (
                  <li key={idx} className="text-sm text-gray-800">
                    <span className="font-medium">{tipo}</span>{' — '}
                    <span className="italic">{estado}</span>{' • '}
                    <span>cantidad: {qty} {unit}</span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 text-sm text-green-800">
              Tiempo total estimado: <span className="font-semibold">{bookingData.estimatedHours} h</span>
            </div>
          </div>
        )}

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <h3 className="text-amber-900 font-semibold mb-3">Debug IA (manual)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Tipo de servicio</label>
              <select
                value={debugService}
                onChange={(e) => setDebugService(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
              >
                <option value="">Selecciona…</option>
                <option value="Corte de césped">Corte de césped</option>
                <option value="Corte de setos a máquina">Corte de setos a máquina</option>
                <option value="Poda de plantas">Poda de plantas</option>
                <option value="Poda de árboles">Poda de árboles</option>
                <option value="Labrar y quitar malas hierbas a mano">Labrar y quitar malas hierbas a mano</option>
                <option value="Fumigación de plantas">Fumigación de plantas</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Estado del jardín</label>
              <select
                value={debugState}
                onChange={(e) => setDebugState(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
              >
                <option value="normal">normal</option>
                <option value="descuidado">descuidado</option>
                <option value="muy descuidado">muy descuidado</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Cantidad</label>
              <input
                type="number"
                min={0}
                step={1}
                value={debugQuantity}
                onChange={(e) => setDebugQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full p-2 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
                placeholder="Ej: 120"
              />
              <div className="text-xs text-gray-600 mt-1">Unidad: m² o plantas según servicio</div>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => {
                  const qty = debugQuantity === '' ? 0 : Number(debugQuantity);
                  const unit = debugService.includes('césped') || debugService.includes('setos') || debugService.includes('hierbas') || debugService.includes('labrar') ? 'm2' : 'plantas';
                  const diff = debugState.includes('muy') ? 3 : debugState.includes('descuidado') ? 2 : 1;
                  const hours = unit === 'm2' ? Math.ceil(qty / 150) : Math.ceil(qty * 0.15);
                  setBookingData({ aiQuantity: qty, aiUnit: unit, aiDifficulty: diff, estimatedHours: hours });
                  saveProgress();
                }}
                className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm"
              >
                Aplicar
              </button>
              <button
                type="button"
                onClick={() => {
                  setDebugService('');
                  setDebugState('normal');
                  setDebugQuantity('');
                }}
                className="px-3 py-2 bg-white hover:bg-gray-50 text-gray-800 rounded-lg border border-gray-300 text-sm"
              >
                Limpiar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Fixed CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] z-50">
        <div className="max-w-md mx-auto">
          <button
            onClick={handleContinue}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-2xl font-semibold text-lg shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200"
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
};

export default DetailsPage;
