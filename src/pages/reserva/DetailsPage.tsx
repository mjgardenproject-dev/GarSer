import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronLeft, Camera, Upload, Trash2, Wand2, Image } from 'lucide-react';
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
  // Initialize photos from uploadedPhotoUrls if available, otherwise from bookingData.photos
  const [photos, setPhotos] = useState<(File | string)[]>(() => {
    if (bookingData.photos && bookingData.photos.length > 0) return bookingData.photos;
    if (bookingData.uploadedPhotoUrls && bookingData.uploadedPhotoUrls.length > 0) return bookingData.uploadedPhotoUrls;
    return [];
  });
  const [description, setDescription] = useState(bookingData.description);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiModel, setAiModel] = useState<'gpt-4o-mini' | 'gemini-2.0-flash'>('gpt-4o-mini');
  const [debugService, setDebugService] = useState<string>('');
  const [debugState, setDebugState] = useState<string>('normal');
  const [debugPalmSpecies, setDebugPalmSpecies] = useState<string>('');
  const [debugPalmHeight, setDebugPalmHeight] = useState<string>('');
  const [debugWasteRemoval, setDebugWasteRemoval] = useState<boolean>(true);
  const [debugQuantity, setDebugQuantity] = useState<number | ''>('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [debugPalmGroups, setDebugPalmGroups] = useState<Array<{species: string, height: string, quantity: number, state: string}>>([]);
  const [showWasteModal, setShowWasteModal] = useState(false);

  // Auto-resume analysis if needed
  useEffect(() => {
    if (bookingData.isAnalyzing && !analyzing && photos.length > 0) {
        // If we have URLs, we can try to resume analysis
        // But we need to make sure runAIAnalysis can handle existing URLs
        runAIAnalysis();
    }
  }, []); // Run once on mount

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

  const uploadFile = async (file: File, index: number): Promise<string | null> => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id || 'anon';
        const bucket = (import.meta.env.VITE_BOOKING_PHOTOS_BUCKET as string | undefined) || 'booking-photos';
        const now = Date.now();
        const safeName = (file.name || `foto_${index}.jpg`).toLowerCase().replace(/[^a-z0-9._-]/g, '_');
        const path = `drafts/${userId}/${now}_${index}_${safeName}`;
        
        const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
        
        if (!uploadError) {
          const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(path, 3600 * 24); // 24 hours
          return signed?.signedUrl || null;
        } else {
            console.error('Upload error:', uploadError);
            return null;
        }
      } catch (e) {
          console.error('Upload exception:', e);
          return null;
      }
  };

  const handleDrop = async (e: React.DragEvent) => {
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

    // Add files to state first for immediate UI feedback
    const newPhotos = [...photos, ...files];
    setPhotos(newPhotos);

    // Upload files immediately
    const currentUrls = [...(bookingData.uploadedPhotoUrls || [])];
    // Ensure currentUrls has same length as original photos to match indices
    while(currentUrls.length < photos.length) currentUrls.push('');

    const uploadPromises = files.map(async (file, i) => {
        const globalIndex = photos.length + i;
        const url = await uploadFile(file, globalIndex);
        if (url) {
            // Update the specific index in the state to be the URL instead of File
            // We need to do this carefully to avoid race conditions if possible, 
            // but for now we'll just update context and let state follow if needed or mix them
            return { index: globalIndex, url };
        }
        return null;
    });

    // Wait for uploads and update context
    const results = await Promise.all(uploadPromises);
    const updatedUrls = [...currentUrls];
    const updatedPhotosState = [...newPhotos];

    results.forEach(res => {
        if (res) {
            updatedUrls[res.index] = res.url;
            updatedPhotosState[res.index] = res.url; // Replace File with URL in state
        }
    });

    setPhotos(updatedPhotosState);
    setBookingData({ uploadedPhotoUrls: updatedUrls });
    saveProgress();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(file => 
      file.type.startsWith('image/')
    );
    
    if (files.length + photos.length > 5) {
      alert('Máximo 5 fotos permitidas');
      return;
    }

    // Add files to state first for immediate UI feedback
    const newPhotos = [...photos, ...files];
    setPhotos(newPhotos);

    // Upload files immediately
    const currentUrls = [...(bookingData.uploadedPhotoUrls || [])];
    // Ensure currentUrls has same length as original photos to match indices
    while(currentUrls.length < photos.length) currentUrls.push('');

    const uploadPromises = files.map(async (file, i) => {
        const globalIndex = photos.length + i;
        const url = await uploadFile(file, globalIndex);
        if (url) return { index: globalIndex, url };
        return null;
    });

    const results = await Promise.all(uploadPromises);
    const updatedUrls = [...currentUrls];
    const updatedPhotosState = [...newPhotos];

    results.forEach(res => {
        if (res) {
            updatedUrls[res.index] = res.url;
            updatedPhotosState[res.index] = res.url; // Replace File with URL in state
        }
    });

    setPhotos(updatedPhotosState);
    setBookingData({ uploadedPhotoUrls: updatedUrls });
    saveProgress();
  };

  const removePhoto = (index: number) => {
    const newPhotos = photos.filter((_, i) => i !== index);
    setPhotos(newPhotos);
    
    const newUrls = (bookingData.uploadedPhotoUrls || []).filter((_, i) => i !== index);
    setBookingData({ uploadedPhotoUrls: newUrls });
    saveProgress();
    
    // Update palmGroups when a photo is removed to keep indices in sync
    if (debugService === 'Poda de palmeras' && bookingData.palmGroups) {
        const newGroups = bookingData.palmGroups
            .filter(g => g.imageIndex !== index)
            .map(g => ({
                ...g,
                imageIndex: (g.imageIndex !== undefined && g.imageIndex > index) ? g.imageIndex - 1 : g.imageIndex
            }));
        
        const totalHours = newGroups.reduce((acc, g) => acc + Math.ceil(g.quantity * (20/60)), 0);
        setBookingData({ palmGroups: newGroups, estimatedHours: totalHours });
    }
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
            alert('Tienes palmeras con cantidad 0 o vacía. Por favor, elimínalas o añade una cantidad válida para continuar.');
            return;
        }
    }
    // Filter out strings from photos to match File[] type for bookingData
    const filePhotos = photos.filter((p): p is File => p instanceof File);
    setBookingData({ photos: filePhotos, description });
    saveProgress();
    setCurrentStep(3);
  };

  const runAIAnalysis = async () => {
    try {
      setAnalyzing(true);
      setBookingData({ isAnalyzing: true });
      saveProgress();

      const photoUrls: string[] = [];
      const uploadsToPerform: { file: File, index: number }[] = [];

      // Sort existing URLs and identify files that need upload
      photos.forEach((p, i) => {
          if (typeof p === 'string') {
              photoUrls[i] = p; // Keep index position
          } else {
              uploadsToPerform.push({ file: p, index: i });
          }
      });

      if (uploadsToPerform.length > 0) {
        await Promise.allSettled(uploadsToPerform.map(async ({ file, index }) => {
           const url = await uploadFile(file, index);
           if (url) {
               photoUrls[index] = url;
               // Also update state/context for future persistence
               const currentUrls = [...(bookingData.uploadedPhotoUrls || [])];
               // Ensure size
               while(currentUrls.length <= index) currentUrls.push('');
               currentUrls[index] = url;
               setBookingData({ uploadedPhotoUrls: currentUrls });
           }
        }));
      }

      // Filter out undefined holes if any (though logic should prevent holes)
      const validUrls = photoUrls.filter(Boolean);

      if (photos.length > 0 && validUrls.length === 0) {
        setAnalyzing(false);
        setBookingData({ isAnalyzing: false });
        saveProgress();
        alert('Error al subir las imágenes. Por favor, verifica tu conexión o inténtalo de nuevo.');
        return;
      }

      const primaryServiceName = bookingData.serviceIds.length === 1 ? undefined : undefined;
      const firstImageUrl = validUrls[0];
      if (bookingData.serviceIds.length === 1 && firstImageUrl) {
        const svc = bookingData.serviceIds[0];
        const { data: svcRow } = await supabase.from('services').select('name').eq('id', svc).maybeSingle();
        const svcName = (svcRow as any)?.name as string | undefined;
        if (svcName) {
          const auto = await estimateServiceAutoQuote({ service: svcName, imageUrl: firstImageUrl, description: '', model: aiModel });
          if (auto?.analysis && auto?.result) {
            const qty = Math.max(0, Number(auto.analysis.cantidad || 0));
            const unit = String(auto.analysis.unidad || '');
            const diff = Number(auto.analysis.dificultad || 1);
            const hours = Math.max(0, Number(auto.result.tiempo_estimado_horas || 0));
            setBookingData({ estimatedHours: Math.ceil(hours), aiQuantity: qty, aiUnit: unit, aiDifficulty: diff, isAnalyzing: false });
            saveProgress();
            return;
          }
        }
      }

      const res = await estimateWorkWithAI({ 
        description: '', // Don't send user notes to AI 
        photoCount: photos.length, 
        selectedServiceIds: bookingData.serviceIds, 
        photoUrls: validUrls,
        serviceName: debugService,
        model: aiModel
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
            photoUrl: validUrls[p.indice_imagen] || undefined,
            imageIndex: p.indice_imagen
        }));
        
        // Calculate estimated hours for the new groups
        const totalHours = newGroups.reduce((acc, g) => acc + Math.ceil(g.quantity * (20/60)), 0);
        
        setBookingData({ 
            palmGroups: newGroups,
            estimatedHours: totalHours,
            isAnalyzing: false
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
        setBookingData({ aiTasks: tareas, estimatedHours: total, aiQuantity: qty, aiUnit: unit, aiDifficulty: diff, isAnalyzing: false });
        saveProgress();
      }
    } catch {
        setBookingData({ isAnalyzing: false });
        saveProgress();
    }
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
        <div className={debugService === 'Poda de palmeras' ? "mb-4" : "bg-white rounded-2xl shadow-sm p-6 mb-4"}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">
                {debugService === 'Poda de palmeras' ? 'Fotos de tus palmeras' : 'Fotos de tu jardín'}
            </h2>
            <span className="text-sm text-gray-500">{photos.length}/5</span>
          </div>
          <p className="text-gray-600 text-sm mb-4">
            {debugService === 'Poda de palmeras' 
                ? 'Sube una foto por cada tipo de palmera diferente. Si tienes varias iguales en especie tamaño y estado, solo necesitas subir una foto'
                : 'Las fotos ayudan a los jardineros a entender mejor tu espacio'
            }
          </p>

          {debugService === 'Poda de palmeras' ? (
             <div className="flex flex-col gap-4">
               {photos.map((photo, index) => {
                   const palmGroup = bookingData.palmGroups?.find(g => g.imageIndex === index);
                   
                   return (
                     <div key={index} className={`flex gap-4 p-3 ${debugService === 'Poda de palmeras' ? '' : 'border border-gray-100 rounded-xl bg-gray-50/50'}`}>
                        {/* Photo Slot */}
                        <div className="relative shrink-0">
                           <img 
                             src={typeof photo === 'string' ? photo : URL.createObjectURL(photo)} 
                             alt={`Palmera ${index + 1}`} 
                             className="w-24 h-24 object-cover rounded-lg border border-gray-200"
                           />
                           <button
                             onClick={(e) => { e.stopPropagation(); removePhoto(index); }}
                             className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 shadow-sm transition-colors"
                           >
                             <Trash2 className="w-3.5 h-3.5" />
                           </button>
                        </div>

                        {/* Analysis Result / Info Slot */}
                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                           {palmGroup ? (
                               <div className="space-y-2 text-sm">
                                   <div className="flex justify-between items-start">
                                       <div>
                                           <p className="font-semibold text-gray-900">{palmGroup.species}</p>
                                           <p className="text-gray-500">Altura: {palmGroup.height}m - {palmGroup.state}</p>
                                       </div>
                                   </div>
                                   
                                   <div className="grid grid-cols-2 gap-3 mt-1">
                                       <div>
                                            <label className="block text-xs text-gray-500 mb-1">Cantidad</label>
                                            <input 
                                                type="number" 
                                                min={0} 
                                                value={palmGroup.quantity === 0 ? '' : palmGroup.quantity}
                                                onChange={(e) => {
                                                    const val = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value));
                                                    const newGroups = [...(bookingData.palmGroups || [])];
                                                    const groupIndex = newGroups.findIndex(g => g.imageIndex === index);
                                                    if (groupIndex !== -1) {
                                                        newGroups[groupIndex] = { ...newGroups[groupIndex], quantity: val };
                                                        const totalHours = newGroups.reduce((acc, g) => acc + Math.ceil(g.quantity * (20/60)), 0);
                                                        setBookingData({ palmGroups: newGroups, estimatedHours: totalHours });
                                                        saveProgress();
                                                    }
                                                }}
                                                placeholder="-"
                                                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                                            />
                                       </div>
                                       <div>
                                            <label className="block text-xs text-gray-500 mb-1">Estado</label>
                                            <div className="w-full px-2 py-1.5 border border-gray-200 bg-gray-50 rounded-lg text-sm text-gray-700 capitalize">
                                                {palmGroup.state || 'normal'}
                                            </div>
                                       </div>
                                   </div>
                               </div>
                           ) : (
                               <div className="h-full flex items-center text-gray-400 italic text-sm border-l-2 border-gray-200 pl-4">
                                   {analyzing ? 'Analizando...' : 'Pendiente de análisis. Haz clic en "Analizar" abajo.'}
                               </div>
                           )}
                        </div>
                     </div>
                   );
               })}

               {/* Add Photo Slot */}
               {photos.length < 5 && (
                 <div className={`flex gap-4 p-3 ${debugService === 'Poda de palmeras' ? '' : 'border-2 border-dashed border-gray-300 rounded-xl hover:bg-gray-50'} transition-colors cursor-pointer group`} onClick={() => fileInputRef.current?.click()}>
                    <div className={`w-24 h-24 flex items-center justify-center rounded-lg text-gray-400 border border-transparent ${
                        debugService === 'Poda de palmeras' 
                        ? 'bg-gray-200 group-hover:bg-gray-300' 
                        : 'bg-gray-50 group-hover:bg-gray-100'
                    }`}>
                        {debugService === 'Poda de palmeras' ? (
                            <Image className="w-8 h-8 text-gray-500 group-hover:text-gray-700 transition-colors" />
                        ) : (
                            <Upload className="w-8 h-8 text-gray-400 group-hover:text-green-600 transition-colors" />
                        )}
                    </div>
                    <div className="flex-1 flex items-center text-gray-500 font-medium group-hover:text-green-700 transition-colors">
                        Haz clic para añadir otra foto...
                    </div>
                 </div>
               )}
               
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
             </div>
          ) : (
            <>
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
                          src={typeof photo === 'string' ? photo : URL.createObjectURL(photo)}
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
            </>
          )}
        </div>

      {debugService === 'Poda de palmeras' ? (
          <div className="flex flex-col gap-4 mb-4">
            <div className="flex items-center justify-end gap-3">
              <select
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value as any)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-green-500"
              >
                <option value="gpt-4o-mini">ChatGPT-4o Mini</option>
                <option value="gemini-2.0-flash">Google Gemini 2 Flash</option>
              </select>
              <button
                onClick={runAIAnalysis}
                disabled={analyzing || photos.length === 0 || bookingData.serviceIds.length === 0}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 shadow-sm font-medium"
              >
                Analizar
              </button>
            </div>
            
            {/* Waste Removal Switch - Only shown after analysis */}
            {bookingData.palmGroups && bookingData.palmGroups.length > 0 && (
                <div className="flex items-center justify-between p-4 bg-white rounded-xl shadow-sm border border-gray-100">
                    <span className="text-gray-700 font-medium text-sm">Incluir retirada de restos</span>
                    <button 
                        onClick={() => {
                            if (bookingData.wasteRemoval) {
                                setShowWasteModal(true);
                            } else {
                                setBookingData({ wasteRemoval: true });
                                saveProgress();
                            }
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${bookingData.wasteRemoval ? 'bg-green-600' : 'bg-gray-200'}`}
                    >
                        <span
                            className={`${
                                bookingData.wasteRemoval ? 'translate-x-6' : 'translate-x-1'
                            } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                        />
                    </button>
                </div>
            )}
          </div>
      ) : (
      <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Analizar con IA</h2>
          <div className="flex items-center gap-2">
            <select
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-green-500"
            >
              <option value="gpt-4o-mini">ChatGPT-4o Mini</option>
              <option value="gemini-2.0-flash">Google Gemini 2 Flash</option>
            </select>
            <button
              onClick={runAIAnalysis}
              disabled={analyzing || photos.length === 0 || bookingData.serviceIds.length === 0}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
            >
              <Wand2 className="w-4 h-4 inline mr-2" /> Analizar
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-600">Usa las fotos y el servicio seleccionado para estimar cantidad y horas automáticamente.</p>
      </div>
      )}

        <div className={debugService === 'Poda de palmeras' ? "mb-4" : "bg-white rounded-2xl shadow-sm p-6 mb-4"}>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Nota para el jardinero (opcional)</h2>
          <div className="relative">
             <div className="absolute -top-10 right-0 text-xs text-gray-500 bg-white px-2 py-1 rounded shadow-sm border border-gray-100 hidden sm:block">
               No se envía a la IA
             </div>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej: Cuidado con el perro, entrar por la puerta lateral..."
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

      {/* Palm Pruning Manual Input Section - Removed (Integrated into Photo Upload) */}

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

      {/* Waste Removal Warning Modal */}
      {showWasteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="text-lg font-bold text-gray-900 mb-2">¿Desactivar retirada?</h3>
            <p className="text-gray-600 mb-6">
              Si desactivas la retirada de restos, deberás hacerte cargo de todos los residuos generados. ¿Estás seguro?
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setShowWasteModal(false)}
                className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold shadow-sm transition-colors"
              >
                Mantener retirada
              </button>
              <button
                onClick={() => {
                    setBookingData({ wasteRemoval: false });
                    saveProgress();
                    setShowWasteModal(false);
                }}
                className="w-full py-3 text-gray-500 hover:text-gray-700 font-medium transition-colors"
              >
                Desactivar
              </button>
            </div>
          </div>
        </div>
      )}

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
