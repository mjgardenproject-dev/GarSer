import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronLeft, Camera, Upload, Trash2, Wand2, Image, Sprout, Sparkles, AlertTriangle, CheckCircle, XCircle, Info } from 'lucide-react';
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
  const { bookingData, setBookingData, saveProgress, setCurrentStep, updateServiceData, switchToService } = useBooking();
  
  // Initialize state on mount when service changes
  useEffect(() => {
    if (bookingData.serviceIds?.[0]) {
        switchToService(bookingData.serviceIds[0]);
    }
  }, [bookingData.serviceIds?.[0]]); // Trigger only when primary service ID changes

  // Initialize photos from uploadedPhotoUrls if available, otherwise from bookingData.photos
  // We need to keep this in sync with bookingData changes triggered by switchToService
  const [photos, setPhotos] = useState<(File | string)[]>([]);
  
  useEffect(() => {
      if (bookingData.photos && bookingData.photos.length > 0) setPhotos(bookingData.photos);
      else if (bookingData.uploadedPhotoUrls && bookingData.uploadedPhotoUrls.length > 0) setPhotos(bookingData.uploadedPhotoUrls);
      else setPhotos([]);
  }, [bookingData.photos, bookingData.uploadedPhotoUrls]);

  const [description, setDescription] = useState(bookingData.description);
  
  // Sync description when bookingData changes (e.g. context switch)
  useEffect(() => {
      setDescription(bookingData.description);
  }, [bookingData.description]);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiModel, setAiModel] = useState<'gpt-4o-mini' | 'gemini-2.0-flash'>('gemini-2.0-flash');
  const [debugService, setDebugService] = useState<string>('');
  const [debugLawnSpecies, setDebugLawnSpecies] = useState<string>('');
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

  // Sync lawn zones to global state
  useEffect(() => {
      const isLawnService = debugService.includes('Corte de césped') || debugService.includes('césped');
      if (isLawnService && bookingData.lawnZones) {
          // 1. Calculate Hours
          let totalHours = 0;
          let totalQty = 0;
          bookingData.lawnZones.forEach(z => {
              if (z.quantity > 0) {
                  const diff = z.state === 'muy descuidado' ? 1.6 : z.state === 'descuidado' ? 1.3 : 1.0;
                  const h = (z.quantity / 150) * diff;
                  totalHours += h;
                  totalQty += z.quantity;
              }
          });
          
          // 2. Aggregate Photos
          const allUrls = bookingData.lawnZones.flatMap(z => z.photoUrls);
          
          // Only update if changed
          const currentHours = bookingData.estimatedHours || 0;
          const currentUrls = bookingData.uploadedPhotoUrls || [];
          
          const hoursChanged = Math.abs(currentHours - Math.ceil(totalHours)) > 0.1;
          const urlsChanged = allUrls.length !== currentUrls.length || !allUrls.every((u, i) => u === currentUrls[i]);
          
          if (hoursChanged || urlsChanged) {
              setBookingData({ 
                  estimatedHours: Math.ceil(totalHours),
                  uploadedPhotoUrls: allUrls,
                  aiQuantity: totalQty,
                  aiUnit: 'm2'
              });
          }
      }
  }, [bookingData.lawnZones, debugService]);

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
    
    // Explicitly update per-service data
    if (bookingData.serviceIds?.[0]) {
        updateServiceData(bookingData.serviceIds[0], {
            uploadedPhotoUrls: updatedUrls,
            photos: updatedPhotosState.filter(p => p instanceof File) // Best effort, though URLs are primary
        });
    }
    
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
    
    // Explicitly update per-service data
    if (bookingData.serviceIds?.[0]) {
        updateServiceData(bookingData.serviceIds[0], {
            uploadedPhotoUrls: updatedUrls,
            photos: updatedPhotosState.filter(p => p instanceof File)
        });
    }

    setBookingData({ uploadedPhotoUrls: updatedUrls });
    saveProgress();
  };

  const removePhoto = (index: number) => {
    const newPhotos = photos.filter((_, i) => i !== index);
    setPhotos(newPhotos);
    
    const newUrls = (bookingData.uploadedPhotoUrls || []).filter((_, i) => i !== index);
    setBookingData({ uploadedPhotoUrls: newUrls });
    
    // Explicitly update per-service data
    if (bookingData.serviceIds?.[0]) {
        updateServiceData(bookingData.serviceIds[0], {
            uploadedPhotoUrls: newUrls,
            photos: newPhotos.filter(p => p instanceof File)
        });
    }
    
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
        
        if (bookingData.serviceIds?.[0]) {
             updateServiceData(bookingData.serviceIds[0], {
                 palmGroups: newGroups,
                 estimatedHours: totalHours
             });
        }
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
    
    // Explicit persist before leaving
    if (bookingData.serviceIds?.[0]) {
        updateServiceData(bookingData.serviceIds[0], {
            photos: filePhotos,
            description,
            // Ensure all current context is saved
            aiTasks: bookingData.aiTasks,
            estimatedHours: bookingData.estimatedHours,
            lawnZones: bookingData.lawnZones,
            palmGroups: bookingData.palmGroups,
            aiQuantity: bookingData.aiQuantity,
            aiDifficulty: bookingData.aiDifficulty
        });
    }
    
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
        // Evitar AutoQuote para servicios con prompts complejos (como césped o palmeras)
        // ya que estimateServiceAutoQuote espera un JSON plano y nuestros prompts devuelven { tareas: [] }
        if (svcName && !svcName.toLowerCase().includes('césped') && !svcName.toLowerCase().includes('palmera')) {
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
        
        if (bookingData.serviceIds?.[0]) {
             updateServiceData(bookingData.serviceIds[0], {
                 palmGroups: newGroups,
                 estimatedHours: totalHours,
                 isAnalyzing: false // Persist analysis state
             });
        }
        
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
        const species = first.especie_cesped || undefined;
        
        setBookingData({ 
            aiTasks: tareas, 
            estimatedHours: total, 
            aiQuantity: qty, 
            aiUnit: unit, 
            aiDifficulty: diff, 
            lawnSpecies: species,
            isAnalyzing: false 
        });
        
        if (bookingData.serviceIds?.[0]) {
             updateServiceData(bookingData.serviceIds[0], {
                 aiTasks: tareas,
                 estimatedHours: total,
                 aiQuantity: qty,
                 aiUnit: unit,
                 aiDifficulty: diff,
                 lawnSpecies: species,
                 isAnalyzing: false
             });
        }
        
        saveProgress();
      }
    } catch {
        setBookingData({ isAnalyzing: false });
        
        if (bookingData.serviceIds?.[0]) {
             updateServiceData(bookingData.serviceIds[0], {
                 isAnalyzing: false
             });
        }
        
        saveProgress();
    }
    finally {
      setAnalyzing(false);
    }
  };

  const getServiceContent = () => {
    const defaultContent = {
        title: 'Fotos de tu jardín',
        description: 'Las fotos ayudan a los jardineros a entender mejor tu espacio.'
    };
    
    if (!debugService) return defaultContent;
    
    const lower = debugService.toLowerCase();
    if (lower.includes('palmera')) {
        return {
            title: 'Fotos de tus palmeras',
            description: 'Sube una foto por cada tipo de palmera diferente. Si tienes varias iguales en especie, tamaño y estado, solo necesitas subir una foto.'
        };
    }
    if (lower.includes('césped') || lower.includes('cesped')) {
        return {
            title: 'Fotos del césped',
            description: 'Sube fotos de la zona de césped a cortar. Intenta mostrar la altura actual y los bordes.'
        };
    }
    if (lower.includes('seto')) {
        return {
            title: 'Fotos de los setos',
            description: 'Sube fotos que muestren la longitud y altura de los setos.'
        };
    }
    if (lower.includes('árbol') || lower.includes('arbol')) {
        return {
            title: 'Fotos de los árboles',
            description: 'Sube fotos generales de los árboles a podar.'
        };
    }
    if (lower.includes('limpieza') || lower.includes('desbroce') || lower.includes('hierbas')) {
        return {
            title: 'Fotos de la zona',
            description: 'Sube fotos que muestren la densidad de la vegetación a limpiar.'
        };
    }
    
    return defaultContent;
  };

  const serviceContent = getServiceContent();

  // --- NEW: Lawn Zone Logic ---
  const addLawnZone = () => {
    const newZone = {
        id: `zone-${Date.now()}`,
        species: '',
        state: 'normal',
        quantity: 0,
        wasteRemoval: true,
        photoUrls: [],
        imageIndices: [],
        files: [] 
    };
    const newZones = [...(bookingData.lawnZones || []), newZone];
    setBookingData({ 
        lawnZones: newZones,
        wasteRemoval: true 
    });
    
    if (bookingData.serviceIds?.[0]) {
         updateServiceData(bookingData.serviceIds[0], {
             lawnZones: newZones,
             wasteRemoval: true
         });
    }
    
    saveProgress(); // Ensure persistence
  };

  const removeLawnZone = (zoneId: string) => {
    if (!window.confirm('¿Estás seguro de eliminar esta zona y sus fotos?')) return;
    const newZones = (bookingData.lawnZones || []).filter(z => z.id !== zoneId);
    setBookingData({ lawnZones: newZones });
    
    if (bookingData.serviceIds?.[0]) {
         updateServiceData(bookingData.serviceIds[0], {
             lawnZones: newZones
         });
    }
    
    saveProgress(); // Ensure persistence
  };

  const handleLawnFileSelect = async (zoneId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;

    const zones = [...(bookingData.lawnZones || [])];
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx === -1) return;

    // Upload immediately
    const startIdx = (bookingData.uploadedPhotoUrls?.length || 0) + Date.now(); // Ensure uniqueness
    const uploadPromises = files.map((file, i) => uploadFile(file, startIdx + i));
    
    // We could show a loading state here if needed
    const urls = await Promise.all(uploadPromises);
    const validUrls = urls.filter((u): u is string => !!u);
    
    if (validUrls.length > 0) {
        zones[idx].photoUrls = [...zones[idx].photoUrls, ...validUrls];
        setBookingData({ lawnZones: zones });
        
        if (bookingData.serviceIds?.[0]) {
             updateServiceData(bookingData.serviceIds[0], {
                 lawnZones: zones
             });
        }
    }
  };

  const removePhotoFromZone = (zoneId: string, photoIndex: number) => {
      const zones = [...(bookingData.lawnZones || [])];
      const idx = zones.findIndex(z => z.id === zoneId);
      if (idx === -1) return;
      
      const zone = { ...zones[idx] };
      // Can only remove if not analyzed (handled by UI, but double check)
      if (zone.quantity > 0 || zone.analysisLevel !== undefined) {
          // It's analyzed. User should not be able to do this.
          // But maybe they want to reset analysis?
          // User said: "Si el usuario quiere borrar algo, debe eliminarse el conjunto completo"
          // So we simply block this.
          return; 
      }
      
      if (zone.files && zone.files[photoIndex]) {
          zone.files = zone.files.filter((_, i) => i !== photoIndex);
      } else {
          // It's a URL
          // If we mix files and URLs, index management is tricky.
          // Let's assume files are appended after URLs?
          // Simpler: Just reconstruct arrays.
          const urlCount = zone.photoUrls.length;
          if (photoIndex < urlCount) {
              zone.photoUrls = zone.photoUrls.filter((_, i) => i !== photoIndex);
          } else {
              const fileIdx = photoIndex - urlCount;
              if (zone.files) zone.files = zone.files.filter((_, i) => i !== fileIdx);
          }
      }
      zones[idx] = zone;
      setBookingData({ lawnZones: zones });
      
      if (bookingData.serviceIds?.[0]) {
           updateServiceData(bookingData.serviceIds[0], {
               lawnZones: zones
           });
      }
  };

  const analyzeLawnZone = async (zoneId: string) => {
      const zones = [...(bookingData.lawnZones || [])];
      const idx = zones.findIndex(z => z.id === zoneId);
      if (idx === -1) return;
      const zone = zones[idx];

      try {
          setAnalyzing(true);
          
          // Files are already uploaded
          const finalUrls = zone.photoUrls;
          
          if (finalUrls.length === 0) {
              alert('Añade fotos primero');
              setAnalyzing(false);
              return;
          }

          // 2. Call AI
          const res = await estimateWorkWithAI({
             description: '',
             photoCount: finalUrls.length,
             selectedServiceIds: bookingData.serviceIds,
             photoUrls: finalUrls,
             serviceName: 'Corte de césped',
             model: aiModel
          });
          
          // 3. Process Result
          // Expected: tareas[0] with superficie_m2, estado_jardin
          if (res.tareas && res.tareas.length > 0) {
              const t = res.tareas[0];
              zone.species = t.especie_cesped || 'Césped estándar'; // AI might not return species for lawn sometimes
              zone.state = t.estado_jardin || 'normal';
              zone.quantity = Number(t.superficie_m2 || 0);
              
              // New Analysis Fields
              zone.analysisLevel = t.nivel_analisis;
              zone.observations = t.observaciones;
          } else {
              // Fallback or error
              zone.state = 'normal';
              zone.quantity = 0;
          }
          
          zones[idx] = zone;
          setBookingData({ lawnZones: zones });
          
          if (bookingData.serviceIds?.[0]) {
               updateServiceData(bookingData.serviceIds[0], {
                   lawnZones: zones
               });
          }
          
          saveProgress();

      } catch (e) {
          console.error(e);
          alert('Error en el análisis');
      } finally {
          setAnalyzing(false);
      }
  };

  // --- End New Logic ---

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
        <div className="mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">
                {serviceContent.title}
            </h2>
            <span className="text-sm text-gray-500">{photos.length}/5</span>
          </div>
          <p className="text-gray-600 text-sm mb-4">
            {serviceContent.description}
          </p>

             <div className="flex flex-col gap-4">
               {(() => {
                   const isLawnService = debugService.includes('Corte de césped') || debugService.includes('césped');
                   
                   if (isLawnService) {
                     return (
                         <div className="space-y-6">
                             {/* Initial State: No zones */}
                             {(!bookingData.lawnZones || bookingData.lawnZones.length === 0) && (
                                 <div className="text-center py-8 bg-white rounded-xl border border-gray-200 shadow-sm">
                                     <Sprout className="w-12 h-12 text-green-500 mx-auto mb-3" />
                                     <h3 className="text-lg font-medium text-gray-900 mb-1">Añade tu zona de césped</h3>
                                     <p className="text-gray-500 text-sm mb-4 max-w-xs mx-auto">
                                         Si tienes varias zonas separadas (ej: jardín delantero y trasero), añádelas por separado.
                                     </p>
                                     <button 
                                         onClick={addLawnZone}
                                         className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
                                     >
                                         + Añadir primera zona
                                     </button>
                                 </div>
                             )}

                             {(bookingData.lawnZones || []).map((zone, idx) => {
                                 const isAnalyzed = zone.quantity > 0 || (zone.analysisLevel !== undefined);
                                 const allPhotos = [...zone.photoUrls, ...(zone.files || [])];
                                 
                                 return (
                                     <div key={zone.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                         {/* Header */}
                                         <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                                             <div className="flex items-center gap-2">
                                                 <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">
                                                     {idx + 1}
                                                 </div>
                                                 <h3 className="font-semibold text-gray-900">Zona de Césped {idx + 1}</h3>
                                             </div>
                                             <div className="flex gap-2">
                                                 <button 
                                                     onClick={() => removeLawnZone(zone.id)}
                                                     className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors"
                                                     title={isAnalyzed ? "Eliminar zona y análisis" : "Eliminar zona"}
                                                 >
                                                     <Trash2 className="w-5 h-5" />
                                                 </button>
                                             </div>
                                         </div>

                                         {/* Photos Grid for this Zone */}
                                         <div className="mb-4">
                                             <div className="text-xs text-gray-500 mb-2">Fotos de esta zona ({allPhotos.length})</div>
                                             <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                                 {allPhotos.map((p, i) => (
                                                     <div key={i} className="relative aspect-square group">
                                                         <img 
                                                             src={typeof p === 'string' ? p : URL.createObjectURL(p)} 
                                                             alt={`Foto ${i}`}
                                                             className="w-full h-full object-cover rounded-lg border border-gray-200"
                                                         />
                                                         {!isAnalyzed && (
                                                             <button
                                                                 onClick={() => removePhotoFromZone(zone.id, i)}
                                                                 className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 w-6 h-6 flex items-center justify-center hover:bg-red-600 shadow-sm opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity"
                                                             >
                                                                 &times;
                                                             </button>
                                                         )}
                                                     </div>
                                                 ))}
                                                 
                                                 {/* Add Photo Button (Small) */}
                                                 {!isAnalyzed && (
                                                     <label className="border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 aspect-square transition-colors text-gray-400 hover:text-green-600 hover:border-green-300">
                                                         <Camera className="w-6 h-6 mb-1" />
                                                         <span className="text-[10px] font-medium">+ Foto</span>
                                                         <input 
                                                             type="file" 
                                                             accept="image/*" 
                                                             multiple 
                                                             className="hidden" 
                                                             onChange={(e) => handleLawnFileSelect(zone.id, e)}
                                                         />
                                                     </label>
                                                 )}
                                             </div>
                                         </div>

                                         {/* Actions / Results */}
                                         {!isAnalyzed ? (
                                             <div className="mt-2">
                                                 <button
                                                     onClick={() => analyzeLawnZone(zone.id)}
                                                     disabled={analyzing || allPhotos.length === 0}
                                                     className="w-full py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium flex items-center justify-center gap-2"
                                                 >
                                                     {analyzing ? (
                                                         <>
                                                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                                                            Analizando...
                                                         </>
                                                     ) : (
                                                         <>
                                                            <Wand2 className="w-4 h-4" />
                                                            Analizar esta zona
                                                         </>
                                                     )}
                                                 </button>
                                                 {allPhotos.length === 0 && (
                                                     <p className="text-xs text-center text-amber-600 mt-2">
                                                         Añade al menos una foto para analizar
                                                     </p>
                                                 )}
                                             </div>
                                         ) : (
                                             <div className="bg-green-50 p-4 rounded-xl border border-green-100 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-2 text-green-800 font-medium text-sm">
                                                        <Sparkles className="w-4 h-4" />
                                                        Resultado del análisis
                                                    </div>
                                                    {zone.analysisLevel && (
                                                         <div className={`px-2 py-0.5 rounded text-[10px] font-medium border flex items-center gap-1 ${
                                                             zone.analysisLevel === 1 ? 'bg-green-100 border-green-200 text-green-800' :
                                                             zone.analysisLevel === 2 ? 'bg-yellow-50 border-yellow-200 text-yellow-800' :
                                                             'bg-red-50 border-red-200 text-red-800'
                                                         }`}>
                                                             {zone.analysisLevel === 1 ? 'Calidad Alta' : zone.analysisLevel === 2 ? 'Calidad Media' : 'Calidad Baja'}
                                                         </div>
                                                    )}
                                                </div>

                                                {/* Observations / Warnings */}
                                                {zone.analysisLevel && zone.analysisLevel > 1 && zone.observations && zone.observations.length > 0 && (
                                                    <div className={`mb-3 p-2 rounded-lg text-xs border ${
                                                        zone.analysisLevel === 2 ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-red-50 border-red-200 text-red-800'
                                                    }`}>
                                                        <div className="flex items-center gap-1 font-semibold mb-1">
                                                             {zone.analysisLevel === 2 ? <AlertTriangle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                                                             Observaciones:
                                                        </div>
                                                        <ul className="list-disc list-inside space-y-0.5 ml-1">
                                                            {zone.observations.map((obs, k) => (
                                                                <li key={k}>{obs}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}

                                                <div className="grid grid-cols-2 gap-4">
                                                     <div>
                                                         <label className="text-xs text-gray-500 block mb-1">Superficie (m²)</label>
                                                         <input 
                                                             type="number" 
                                                             min="0"
                                                             value={zone.quantity}
                                                             onChange={(e) => {
                                                                 const val = Number(e.target.value);
                                                                 const newZones = [...(bookingData.lawnZones || [])];
                                                                 const z = newZones.find(z => z.id === zone.id);
                                                                 if (z) { 
        z.quantity = val; 
        setBookingData({ lawnZones: newZones }); 
        
        if (bookingData.serviceIds?.[0]) {
             updateServiceData(bookingData.serviceIds[0], {
                 lawnZones: newZones
             });
        }
    }
                                                             }}
                                                             className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                                         />
                                                     </div>
                                                     <div>
                                                         <label className="text-xs text-gray-500 block mb-1">Estado</label>
                                                         <select 
                                                             value={zone.state}
                                                             onChange={(e) => {
                                                                 const val = e.target.value;
                                                                 const newZones = [...(bookingData.lawnZones || [])];
                                                                 const z = newZones.find(z => z.id === zone.id);
                                                                 if (z) { 
        z.state = val; 
        setBookingData({ lawnZones: newZones }); 
        
        if (bookingData.serviceIds?.[0]) {
             updateServiceData(bookingData.serviceIds[0], {
                 lawnZones: newZones
             });
        }
    }
                                                             }}
                                                             className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                                         >
                                                             <option value="normal">Normal</option>
                                                             <option value="descuidado">Descuidado</option>
                                                             <option value="muy descuidado">Muy descuidado</option>
                                                         </select>
                                                     </div>
                                                 </div>
                                                 {zone.species && (
                                                     <div className="mt-2 text-xs text-gray-500">
                                                         Especie detectada: <span className="font-medium text-gray-700">{zone.species}</span>
                                                     </div>
                                                 )}
                                             </div>
                                         )}
                                     </div>
                                 );
                             })}
                             
                             {(bookingData.lawnZones && bookingData.lawnZones.length > 0) && (
                                 <button 
                                     onClick={addLawnZone}
                                     className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:bg-gray-50 hover:border-gray-400 transition-colors flex items-center justify-center gap-2 group"
                                 >
                                     <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm group-hover:bg-gray-300 transition-colors">+</span> 
                                     Añadir otra zona de césped
                                 </button>
                             )}
                         </div>
                     );
                   }

                   // If lawn service and no photos but we have AI tasks (simulated), we need a placeholder
                   const displayItems = (photos.length === 0 && isLawnService && bookingData.aiTasks && bookingData.aiTasks.length > 0) 
                        ? [null] 
                        : photos;

                   return displayItems.map((photo, index) => {
                   // Logic for Palm Trees
                   const palmGroup = debugService === 'Poda de palmeras' ? bookingData.palmGroups?.find(g => g.imageIndex === index) : null;
                   
                   // Logic for Lawn Mowing (Specialized Card)
                   const lawnTask = isLawnService && bookingData.aiTasks && bookingData.aiTasks.length > 0 ? bookingData.aiTasks[0] : null;
                   
                   // Logic for Other Services (Generic)
                   // We'll show the global AI result in the first slot for now, or per-item if implemented later
                   const isGeneric = debugService !== 'Poda de palmeras' && !isLawnService;
                   const showGenericResult = isGeneric && index === 0 && !bookingData.isAnalyzing && (bookingData.aiQuantity || bookingData.estimatedHours);

                   return (
                     <div key={index} className="flex gap-4 p-3">
                        {/* Photo Slot */}
                        <div className="relative shrink-0">
                           {photo ? (
                               <img 
                                 src={typeof photo === 'string' ? photo : URL.createObjectURL(photo)} 
                                 alt={`Foto ${index + 1}`} 
                                 className="w-24 h-24 object-cover rounded-lg border border-gray-200"
                               />
                           ) : (
                               // Placeholder for simulated data without photo
                               <div className="w-24 h-24 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center">
                                   <Image className="w-8 h-8 text-gray-400" />
                               </div>
                           )}
                           
                           {photo && (
                               <button
                                 onClick={(e) => { e.stopPropagation(); removePhoto(index); }}
                                 className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 shadow-sm transition-colors"
                               >
                                 <Trash2 className="w-3.5 h-3.5" />
                               </button>
                           )}
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
                           ) : lawnTask && (index === 0 || !photo) ? (
                               // Specialized Lawn Mowing Card (Simulated or Real)
                               <div className="space-y-2 text-sm">
                                   <div className="flex justify-between items-start">
                                       <div>
                                           <p className="font-semibold text-gray-900">{bookingData.lawnSpecies || 'Especie desconocida'}</p>
                                           <p className="text-gray-500 capitalize">{lawnTask.estado_jardin || 'normal'}</p>
                                       </div>
                                   </div>
                                   
                                   <div className="grid grid-cols-2 gap-3 mt-1">
                                       <div>
                                            <label className="block text-xs text-gray-500 mb-1">Superficie (m²)</label>
                                            <input 
                                                type="number" 
                                                min={0} 
                                                value={bookingData.aiQuantity || ''}
                                                onChange={(e) => {
                                                    const val = e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value));
                                                    const diff = bookingData.aiDifficulty || 1;
                                                    const mult = diff === 3 ? 1.6 : diff === 2 ? 1.3 : 1.0;
                                                    const hours = (val / 150) * mult;
                                                    
                                                    // Update simulated task
                                                    const newTasks = [...(bookingData.aiTasks || [])];
                                                    if (newTasks.length > 0) {
                                                        newTasks[0] = { ...newTasks[0], superficie_m2: val };
                                                    }

                                                    setBookingData({ 
                                                        aiQuantity: val, 
                                                        estimatedHours: Math.ceil(hours),
                                                        aiTasks: newTasks 
                                                    });
                                                    saveProgress();
                                                }}
                                                placeholder="0"
                                                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                                            />
                                       </div>
                                       <div>
                                            <label className="block text-xs text-gray-500 mb-1">Estado</label>
                                            <select
                                                value={bookingData.aiDifficulty === 3 ? 'muy descuidado' : bookingData.aiDifficulty === 2 ? 'descuidado' : 'normal'}
                                                onChange={(e) => {
                                                    const state = e.target.value;
                                                    const diff = state === 'muy descuidado' ? 3 : state === 'descuidado' ? 2 : 1;
                                                    const mult = diff === 3 ? 1.6 : diff === 2 ? 1.3 : 1.0;
                                                    const qty = bookingData.aiQuantity || 0;
                                                    const hours = (qty / 150) * mult;

                                                    // Update simulated task
                                                    const newTasks = [...(bookingData.aiTasks || [])];
                                                    if (newTasks.length > 0) {
                                                        newTasks[0] = { ...newTasks[0], estado_jardin: state };
                                                    }

                                                    setBookingData({ 
                                                        aiDifficulty: diff,
                                                        estimatedHours: Math.ceil(hours),
                                                        aiTasks: newTasks
                                                    });
                                                    saveProgress();
                                                }}
                                                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
                                            >
                                                <option value="normal">Normal</option>
                                                <option value="descuidado">Descuidado</option>
                                                <option value="muy descuidado">Muy descuidado</option>
                                            </select>
                                       </div>
                                   </div>
                               </div>
                           ) : showGenericResult ? (
                               <div className="space-y-2 text-sm">
                                   <div className="font-semibold text-gray-900">Análisis del servicio</div>
                                   <div className="grid grid-cols-2 gap-3 mt-1">
                                        <div>
                                            <label className="block text-xs text-gray-500 mb-1">Cantidad ({bookingData.aiUnit || 'u'})</label>
                                            <input 
                                                type="number"
                                                min={0}
                                                value={bookingData.aiQuantity || ''}
                                                onChange={(e) => {
                                                    const val = e.target.value === '' ? 0 : Math.max(0, Number(e.target.value));
                                                    // Simple recalculation based on difficulty and unit
                                                    // Note: This logic duplicates estimateWorkWithAI somewhat, but is needed for manual adjustment
                                                    const unit = bookingData.aiUnit || 'm2';
                                                    const diff = bookingData.aiDifficulty || 1;
                                                    const mult = diff === 3 ? 1.6 : diff === 2 ? 1.3 : 1.0;
                                                    let hours = 0;
                                                    if (unit === 'm2') hours = (val / 150) * mult; // Example for grass
                                                    else hours = val * 0.15 * mult; // Example for plants
                                                    // Improve: Ideally we should store the factor/type to recalculate accurately
                                                    setBookingData({ aiQuantity: val, estimatedHours: Math.ceil(hours) });
                                                    saveProgress();
                                                }}
                                                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                                            />
                                       </div>
                                       <div>
                                            <label className="block text-xs text-gray-500 mb-1">Dificultad</label>
                                            <select 
                                                value={bookingData.aiDifficulty || 1}
                                                onChange={(e) => {
                                                    const val = Number(e.target.value);
                                                    setBookingData({ aiDifficulty: val });
                                                    saveProgress();
                                                    // Trigger recalculation in effect or simple logic here
                                                }}
                                                className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
                                            >
                                                <option value={1}>Normal</option>
                                                <option value={2}>Descuidado</option>
                                                <option value={3}>Muy descuidado</option>
                                            </select>
                                       </div>
                                   </div>
                               </div>
                           ) : (
                               <div className="h-full flex items-center text-gray-400 italic text-sm border-l-2 border-gray-200 pl-4">
                                   {analyzing ? 'Analizando...' : isGeneric ? (index === 0 ? 'Pendiente de análisis...' : 'Foto añadida') : 'Pendiente de análisis...'}
                               </div>
                           )}
                        </div>
                     </div>
                   );
               });
               })()}

               {/* Add Photo Slot */}
               {photos.length < 5 && (
                 <div className="flex gap-4 p-3 transition-colors cursor-pointer group" onClick={() => fileInputRef.current?.click()}>
                    <div className="w-24 h-24 flex items-center justify-center rounded-lg text-gray-400 border border-transparent bg-gray-200 group-hover:bg-gray-300">
                        <Image className="w-8 h-8 text-gray-500 group-hover:text-gray-700 transition-colors" />
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
        </div>

          <div className="flex flex-col gap-4 mb-4">
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={runAIAnalysis}
                disabled={analyzing || photos.length === 0 || bookingData.serviceIds.length === 0}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 shadow-sm font-medium"
              >
                Analizar
              </button>
            </div>
            
            {/* Waste Removal Switch - Only shown after analysis */}
            {((bookingData.palmGroups && bookingData.palmGroups.length > 0) || (bookingData.aiQuantity && bookingData.aiQuantity > 0)) && (
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

        <div className="mb-4">
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

        {bookingData.aiTasks && bookingData.aiTasks.length > 0 && !debugService.includes('césped') && !debugService.includes('Corte de césped') && (
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
            {debugService === 'Corte de césped' && (
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">Especie de césped</label>
                <select
                  value={debugLawnSpecies}
                  onChange={(e) => setDebugLawnSpecies(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
                >
                  <option value="" disabled>Selecciona especie...</option>
                  <option value="Bermuda (fina o gramilla)">Bermuda (fina o gramilla)</option>
                  <option value="Gramón (Kikuyu, San Agustín o similares)">Gramón (Kikuyu, San Agustín o similares)</option>
                  <option value="Dichondra (oreja de ratón o similares)">Dichondra (oreja de ratón o similares)</option>
                  <option value="Césped Mixto (Festuca/Raygrass)">Césped Mixto (Festuca/Raygrass)</option>
                </select>
              </div>
            )}
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

                      // Create synthetic task for AI simulation
                      const syntheticTask = {
                        tipo_servicio: debugService,
                        estado_jardin: debugState,
                        superficie_m2: unit === 'm2' ? qty : null,
                        numero_plantas: unit === 'plantas' ? qty : null,
                        tamaño_plantas: null
                       };
 
                       console.log('[Debug] Simulating AI Result:', { 
                           aiQuantity: qty, 
                           aiTasks: [syntheticTask], 
                           lawnSpecies: debugLawnSpecies 
                       });

                       setBookingData({ 
                         aiQuantity: qty, 
                        aiUnit: unit, 
                        aiDifficulty: diff, 
                        estimatedHours: hours,
                        aiTasks: [syntheticTask], // Simulate AI task detection
                        // Limpiamos datos de palmeras si cambiamos a otro servicio
                        palmSpecies: undefined,
                        palmHeight: undefined,
                        palmState: undefined,
                        palmWasteRemoval: undefined,
                        lawnSpecies: debugLawnSpecies
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
                  setDebugLawnSpecies('');
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