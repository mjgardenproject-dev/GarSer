import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronLeft, Camera, Upload, Trash2, Wand2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { estimateWorkWithAI, estimateServiceAutoQuote } from '../../utils/aiPricingEstimator';

const PALM_SPECIES = [
  'Phoenix (datilera o canaria)',
  'Washingtonia',
  'Roystonea regia (cubana)',
  'Syagrus romanzoffiana (cocotera)',
  'Trachycarpus fortunei',
  'Livistona',
  'Kentia (palmito)',
  'Phoenix roebelenii(pigmea)',
  'cycas revoluta (falsa palmera)'
];

const PALM_GROUP_A = [
  'Phoenix (datilera o canaria)',
  'Washingtonia',
  'Roystonea regia (cubana)',
  'Syagrus romanzoffiana (cocotera)',
  'Trachycarpus fortunei'
];

const PALM_GROUP_B = [
  'Livistona',
  'Kentia (palmito)',
  'Phoenix roebelenii(pigmea)',
  'cycas revoluta (falsa palmera)'
];

const DetailsPage: React.FC = () => {
  const navigate = useNavigate();
  const { bookingData, setBookingData, saveProgress, setCurrentStep } = useBooking();
  const [photos, setPhotos] = useState<File[]>(bookingData.photos);
  const [description, setDescription] = useState(bookingData.description);
  const [analyzing, setAnalyzing] = useState(false);
  const [debugService, setDebugService] = useState<string>('');
  const [debugState, setDebugState] = useState<string>('normal');
  const [debugPalmSpecies, setDebugPalmSpecies] = useState<string>('');
  const [debugPalmHeight, setDebugPalmHeight] = useState<string>('');
  const [debugWasteRemoval, setDebugWasteRemoval] = useState<boolean>(true);
  const [debugQuantity, setDebugQuantity] = useState<number | ''>('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [debugPalmGroups, setDebugPalmGroups] = useState<Array<{species: string, height: string, quantity: number, state: string}>>([]);

  useEffect(() => {
    const fetchServiceName = async () => {
      if (bookingData.serviceIds?.[0]) {
        const { data } = await supabase.from('services').select('name').eq('id', bookingData.serviceIds[0]).single();
        if (data) setDebugService(data.name);
      }
    };
    fetchServiceName();
  }, [bookingData.serviceIds]);

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
    if (debugService === 'Poda de palmeras') {
        if (!bookingData.palmGroups || bookingData.palmGroups.length === 0) {
             alert('Por favor, asegúrate de tener al menos un grupo de palmeras configurado.');
             return;
        }
        // Validate quantities
        const invalid = bookingData.palmGroups.some(g => g.quantity <= 0);
        if (invalid) {
            alert('Por favor, introduce una cantidad válida para todas las palmeras.');
            return;
        }
    }
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

      const res = await estimateWorkWithAI({ 
        description, 
        photoCount: photos.length, 
        selectedServiceIds: bookingData.serviceIds, 
        photoUrls,
        serviceName: debugService 
      });
      
      // Handle Palm Analysis Results
      if (res.palmas && res.palmas.length > 0) {
        const newGroups = res.palmas.map((p, idx) => ({
            id: `ai-${Date.now()}-${idx}`,
            species: p.especie,
            height: p.altura,
            quantity: 1, // Default to 1, user must confirm
            state: p.estado || 'normal',
            wasteRemoval: true,
            photoUrl: photoUrls[p.indice_imagen] || undefined
        }));
        
        // Calculate estimated hours for the new groups
        const totalHours = newGroups.reduce((acc, g) => acc + Math.ceil(g.quantity * (20/60)), 0);
        
        setBookingData({ 
            palmGroups: newGroups,
            estimatedHours: totalHours
        });
        saveProgress();
        setAnalyzing(false);
        return;
      }

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
            <h2 className="text-lg font-bold text-gray-900">
                {debugService === 'Poda de palmeras' ? 'Fotos de tus palmeras' : 'Fotos de tu jardín'}
            </h2>
            <span className="text-sm text-gray-500">{photos.length}/5</span>
          </div>
          <p className="text-gray-600 text-sm mb-4">
            {debugService === 'Poda de palmeras' 
                ? 'Sube una foto de ejemplo por cada tipo de palmera distinta (especie/altura) que tengas. Si tienes 3 palmeras iguales, sube solo una foto.'
                : 'Las fotos ayudan a los jardineros a entender mejor tu espacio'
            }
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

      {/* Palm Pruning Manual Input Section - Rendered from palmGroups */}
      {debugService === 'Poda de palmeras' && bookingData.palmGroups && bookingData.palmGroups.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-6 mb-4 border border-blue-100">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Detalles de tus palmeras</h2>
          <div className="space-y-6">
            {bookingData.palmGroups.map((group, idx) => (
                <div key={group.id} className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                    <div className="flex gap-4 mb-4">
                        {group.photoUrl ? (
                            <img src={group.photoUrl} alt="Palmera detectada" className="w-20 h-20 object-cover rounded-lg" />
                        ) : (
                            <div className="w-20 h-20 bg-blue-100 rounded-lg flex items-center justify-center text-blue-500">
                                <span className="text-xs text-center p-1">Sin foto</span>
                            </div>
                        )}
                        <div className="flex-1">
                            <h3 className="font-semibold text-gray-900">{group.species}</h3>
                            <p className="text-sm text-gray-600">Altura: {group.height}m</p>
                            <div className="mt-2">
                                <label className="block text-xs font-medium text-gray-700 mb-1">Estado</label>
                                <select
                                    value={group.state || 'normal'}
                                    onChange={(e) => {
                                        const newGroups = [...(bookingData.palmGroups || [])];
                                        newGroups[idx] = { ...newGroups[idx], state: e.target.value };
                                        setBookingData({ palmGroups: newGroups });
                                        saveProgress();
                                    }}
                                    className="w-full p-1 border border-gray-300 rounded text-sm bg-white"
                                >
                                    <option value="normal">Normal</option>
                                    <option value="descuidado">Descuidado</option>
                                    <option value="muy descuidado">Muy descuidado</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-800 mb-1">
                                ¿Cuántas palmeras como esta tienes?
                            </label>
                            <input
                                type="number"
                                min={1}
                                step={1}
                                value={group.quantity}
                                onChange={(e) => {
                                    const val = Math.max(0, parseInt(e.target.value) || 0);
                                    const newGroups = [...(bookingData.palmGroups || [])];
                                    newGroups[idx] = { ...newGroups[idx], quantity: val };
                                    
                                    // Recalculate total estimated hours
                                    const totalHours = newGroups.reduce((acc, g) => acc + Math.ceil(g.quantity * (20/60)), 0);
                                    
                                    setBookingData({ 
                                        palmGroups: newGroups,
                                        estimatedHours: totalHours
                                    });
                                    saveProgress();
                                }}
                                className="w-full p-2 border border-gray-300 rounded-lg bg-white"
                            />
                        </div>

                        <div className="flex items-center gap-2">
                            <input 
                                type="checkbox" 
                                id={`waste-${group.id}`}
                                checked={group.wasteRemoval !== false}
                                onChange={(e) => {
                                    const newGroups = [...(bookingData.palmGroups || [])];
                                    newGroups[idx] = { ...newGroups[idx], wasteRemoval: e.target.checked };
                                    setBookingData({ palmGroups: newGroups });
                                    saveProgress();
                                }}
                                className="w-4 h-4 text-green-600 rounded border-gray-300 focus:ring-green-500"
                            />
                            <label htmlFor={`waste-${group.id}`} className="text-sm text-gray-700">
                                Incluir retirada de residuos
                            </label>
                        </div>
                    </div>
                </div>
            ))}
            
            <div className="text-right text-sm text-gray-600">
                Tiempo total estimado: <span className="font-semibold">{bookingData.estimatedHours} h</span>
            </div>
          </div>
        </div>
      )}

      {/* Legacy single-group manual input - REMOVED/REPLACED by the above loop */}

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
                <option value="Poda de palmeras">Poda de palmeras</option>
              </select>
            </div>
            {debugService !== 'Poda de palmeras' && (
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
            )}
            
            {debugService === 'Poda de palmeras' && (
              <div className="sm:col-span-2 space-y-3 p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                <h4 className="font-semibold text-blue-900 text-sm">Simulador de Grupos de Palmeras</h4>
                
                {/* List of simulated groups */}
                {debugPalmGroups.length > 0 && (
                    <ul className="space-y-2 mb-2">
                        {debugPalmGroups.map((g, i) => (
                            <li key={i} className="flex justify-between items-center bg-white p-2 rounded border border-blue-200 text-sm">
                                <span>{g.quantity}x {g.species} ({g.height}) - {g.state}</span>
                                <button 
                                    onClick={() => setDebugPalmGroups(prev => prev.filter((_, idx) => idx !== i))}
                                    className="text-red-500 hover:text-red-700"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                <div className="space-y-2 border-t border-blue-200 pt-2">
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Especie</label>
                        <select
                            value={debugPalmSpecies}
                            onChange={(e) => {
                                setDebugPalmSpecies(e.target.value);
                                setDebugPalmHeight(''); 
                            }}
                            className="w-full p-1 border border-blue-300 rounded text-sm"
                        >
                            <option value="">Selecciona...</option>
                            {PALM_SPECIES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>

                    {debugPalmSpecies && (
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Altura</label>
                            <select
                                value={debugPalmHeight}
                                onChange={(e) => setDebugPalmHeight(e.target.value)}
                                className="w-full p-1 border border-blue-300 rounded text-sm"
                            >
                                <option value="">Selecciona...</option>
                                {PALM_GROUP_A.includes(debugPalmSpecies) ? (
                                    <>
                                        <option value="0-5">0 – 5 m</option>
                                        <option value="5-12">5 – 12 m</option>
                                        <option value="12-20">12 – 20 m</option>
                                        <option value="20+">Más de 20 m</option>
                                    </>
                                ) : PALM_GROUP_B.includes(debugPalmSpecies) ? (
                                    <>
                                        <option value="0-2">0 – 2 m</option>
                                        <option value="2+">Más de 2 m</option>
                                    </>
                                ) : null}
                            </select>
                        </div>
                    )}
                    
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Estado</label>
                        <select
                            value={debugState}
                            onChange={(e) => setDebugState(e.target.value)}
                            className="w-full p-1 border border-blue-300 rounded text-sm"
                        >
                            <option value="normal">Normal</option>
                            <option value="descuidado">Descuidado</option>
                            <option value="muy descuidado">Muy descuidado</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Cantidad Inicial</label>
                        <input
                            type="number"
                            min="1"
                            value={debugQuantity}
                            onChange={(e) => setDebugQuantity(Number(e.target.value))}
                            className="w-full p-1 border border-blue-300 rounded text-sm"
                            placeholder="1"
                        />
                    </div>

                    <button
                        type="button"
                        onClick={() => {
                            if (debugPalmSpecies && debugPalmHeight && debugQuantity) {
                                setDebugPalmGroups(prev => [...prev, {
                                    species: debugPalmSpecies,
                                    height: debugPalmHeight,
                                    quantity: Number(debugQuantity),
                                    state: debugState
                                }]);
                                // Reset fields
                                setDebugPalmSpecies('');
                                setDebugPalmHeight('');
                                setDebugQuantity('');
                            }
                        }}
                        disabled={!debugPalmSpecies || !debugPalmHeight || !debugQuantity}
                        className="w-full py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
                    >
                        + Añadir Grupo
                    </button>
                </div>
              </div>
            )}

            {debugService !== 'Poda de palmeras' && (
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">Cantidad</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={debugQuantity}
                  onChange={(e) => setDebugQuantity(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full p-2 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
                  placeholder="Ej: 1"
                />
                <div className="text-xs text-gray-600 mt-1">Unidad: m² o plantas según servicio</div>
              </div>
            )}
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (debugService === 'Poda de palmeras') {
                      if (debugPalmGroups.length === 0) {
                          alert('Añade al menos un grupo de palmeras para simular.');
                          return;
                      }

                      // Convert simulated groups to context structure
                      // Note: We use a placeholder ID and assume no photo for debug simulation
                      const groups = debugPalmGroups.map((g, i) => ({
                          id: `debug-${Date.now()}-${i}`,
                          species: g.species,
                          height: g.height,
                          quantity: g.quantity,
                          state: g.state,
                          wasteRemoval: debugWasteRemoval,
                          photoUrl: undefined 
                      }));

                      const totalHours = groups.reduce((acc, g) => acc + Math.ceil(g.quantity * (20/60)), 0);

                      setBookingData({ 
                        palmGroups: groups,
                        estimatedHours: totalHours,
                        // Clear single fields just in case
                        palmSpecies: undefined,
                        palmHeight: undefined,
                        palmState: undefined,
                      });
                  } else {
                      const qty = debugQuantity === '' ? 0 : Number(debugQuantity);
                      const unit = debugService.includes('césped') || debugService.includes('setos') || debugService.includes('hierbas') || debugService.includes('labrar') ? 'm2' : 'plantas';
                      const diff = debugState.includes('muy') ? 3 : debugState.includes('descuidado') ? 2 : 1;
                      
                      let hours = 0;
                      if (unit === 'm2') {
                          hours = Math.ceil(qty / 150);
                      } else {
                          hours = Math.ceil(qty * 0.15);
                      }

                      setBookingData({ 
                        aiQuantity: qty, 
                        aiUnit: unit, 
                        aiDifficulty: diff, 
                        estimatedHours: hours,
                        // Limpiamos datos de palmeras si cambiamos a otro servicio
                        palmSpecies: undefined,
                        palmHeight: undefined,
                        palmState: undefined,
                        palmWasteRemoval: undefined
                      });
                  }
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
                  setDebugPalmSpecies('');
                  setDebugPalmHeight('');
                  setDebugPalmGroups([]);
                  setDebugWasteRemoval(true);
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
