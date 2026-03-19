import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { createPortal } from 'react-dom';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronLeft, Camera, Upload, Trash2, Wand2, Image, Sprout, Sparkles, AlertTriangle, CheckCircle, XCircle, Info, Scissors, Trees, Flower2, Shovel, Bug, Eye, EyeOff, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { estimateWorkWithAI, estimateServiceAutoQuote, calculatePalmHours } from '../../utils/aiPricingEstimator';

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

const compressImage = async (file: File): Promise<File> => {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      const maxDimension = 1920;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
          resolve(file);
          return;
      }
      
      ctx.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob((blob) => {
        if (blob) {
          const compressedFile = new File([blob], file.name, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve(compressedFile);
        } else {
          resolve(file);
        }
      }, 'image/jpeg', 0.8);
    };
    
    img.onerror = (error: Event | string) => {
        URL.revokeObjectURL(url);
        reject(error);
    };
    
    img.src = url;
  });
};

const DetailsPage: React.FC = () => {
  const navigate = useNavigate();
  const { bookingData, setBookingData, saveProgress, setCurrentStep, updateServiceData, switchToService } = useBooking();
  const [analysisError, setAnalysisError] = useState<{title: string, message: string, type: 'error' | 'warning'} | null>(null);
  
  // --- NEW: Selective Analysis State ---
  const [analyzedPhotoIndices, setAnalyzedPhotoIndices] = useState<Set<number>>(new Set());
  const [photosToAnalyze, setPhotosToAnalyze] = useState<Set<number>>(new Set());
  // -------------------------------------
  useEffect(() => {
    if (bookingData.serviceIds?.[0]) {
        switchToService(bookingData.serviceIds[0]);
    }
  }, [bookingData.serviceIds?.[0]]); // Trigger only when primary service ID changes

  // Initialize photos from uploadedPhotoUrls if available, otherwise from bookingData.photos
  // We need to keep this in sync with bookingData changes triggered by switchToService
    const [photos, setPhotos] = useState<(File | string)[]>([]);
  const [uploadingIndices, setUploadingIndices] = useState<Set<number>>(new Set());
  
  useEffect(() => {
      // Skip sync if currently uploading
      if (uploadingIndices.size > 0) return;

      if (bookingData.photos && bookingData.photos.length > 0) setPhotos(bookingData.photos);
      else if (bookingData.uploadedPhotoUrls && bookingData.uploadedPhotoUrls.length > 0) setPhotos(bookingData.uploadedPhotoUrls);
      else setPhotos([]);
  }, [bookingData.photos, bookingData.uploadedPhotoUrls, uploadingIndices.size]);

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

  // New Debug States for specific services
  const [debugHedgeHeight, setDebugHedgeHeight] = useState<string>('');
  const [debugHedgeState, setDebugHedgeState] = useState<string>('normal');
  const [debugHedgeAccess, setDebugHedgeAccess] = useState<string>('normal'); // Legacy?
  const [debugTreePruningType, setDebugTreePruningType] = useState<string>('structural');
  const [debugTreeAccess, setDebugTreeAccess] = useState<string>('normal');
  const [debugTreeHours, setDebugTreeHours] = useState<string>('');
  const [debugShrubType, setDebugShrubType] = useState<string>('');
  const [debugShrubSize, setDebugShrubSize] = useState<string>('');
  const [debugClearingType, setDebugClearingType] = useState<string>('');
  const [debugFumigationType, setDebugFumigationType] = useState<string>('');

  const [debugPalmGroups, setDebugPalmGroups] = useState<Array<{species: string, height: string, quantity: number, state: string}>>([]);
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [showRetryModal, setShowRetryModal] = useState(false);
  const [isImageStackExpanded, setIsImageStackExpanded] = useState(false);
  const [expandedZoneIds, setExpandedZoneIds] = useState<Set<string>>(new Set());
  const [loadingMessage, setLoadingMessage] = useState('Escaneando terreno...');
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel: string;
    tone: 'danger' | 'warning';
    onConfirm: null | (() => void | Promise<void>);
  }>({
    isOpen: false,
    title: '',
    message: '',
    confirmLabel: 'Confirmar',
    cancelLabel: 'Cancelar',
    tone: 'warning',
    onConfirm: null
  });
  const [lawnAnalyzingZoneIds, setLawnAnalyzingZoneIds] = useState<Set<string>>(new Set());
  const [lawnUploads, setLawnUploads] = useState<Record<string, Set<number>>>({});
  const [hedgeUploads, setHedgeUploads] = useState<Record<string, Set<number>>>({});
  const [hedgeAnalyzingZoneIds, setHedgeAnalyzingZoneIds] = useState<Set<string>>(new Set());
  const [fumigationUploads, setFumigationUploads] = useState<Record<string, Set<number>>>({});
  const [fumigationAnalyzingZoneIds, setFumigationAnalyzingZoneIds] = useState<Set<string>>(new Set());
  const isAnyLawnZoneAnalyzing = lawnAnalyzingZoneIds.size > 0;
  const isAnyFumigationZoneAnalyzing = fumigationAnalyzingZoneIds.size > 0;

  useEffect(() => {
    if (analyzing || isAnyLawnZoneAnalyzing || isAnyFumigationZoneAnalyzing) {
      const messages = [
        "Escaneando terreno...",
        "Detectando plantas...",
        "Calculando dimensiones...",
        "Analizando densidad...",
        "Estimando trabajo..."
      ];
      let i = 0;
      setLoadingMessage(messages[0]);
      const interval = setInterval(() => {
        i = (i + 1) % messages.length;
        setLoadingMessage(messages[i]);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [analyzing, isAnyLawnZoneAnalyzing, isAnyFumigationZoneAnalyzing]);

  const openConfirm = (config: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: 'danger' | 'warning';
    onConfirm: () => void | Promise<void>;
  }) => {
    setConfirmState({
      isOpen: true,
      title: config.title,
      message: config.message,
      confirmLabel: config.confirmLabel || 'Confirmar',
      cancelLabel: config.cancelLabel || 'Cancelar',
      tone: config.tone || 'warning',
      onConfirm: config.onConfirm
    });
  };

  const closeConfirm = () => {
    setConfirmState(prev => ({ ...prev, isOpen: false, onConfirm: null }));
  };

  const handleConfirmAction = async () => {
    const action = confirmState.onConfirm;
    closeConfirm();
    if (action) await action();
  };

  // Helper to check if analysis has been performed
  const isAnalysisComplete = React.useMemo(() => {
    const hasAiTasks = bookingData.aiTasks && bookingData.aiTasks.length > 0;
    const hasPalmGroups = bookingData.palmGroups && bookingData.palmGroups.length > 0 && bookingData.palmGroups.some(g => g.id.startsWith('ai-'));
    // We can also check other service-specific groups if they have AI IDs
    const hasLawnZones = bookingData.lawnZones && bookingData.lawnZones.some(z => z.id.startsWith('ai-'));
    const hasHedgeZones = bookingData.hedgeZones && bookingData.hedgeZones.some(z => z.id.startsWith('ai-'));
    const hasTreeGroups = bookingData.treeGroups && bookingData.treeGroups.some(z => z.id.startsWith('ai-'));
    const hasShrubGroups = bookingData.shrubGroups && bookingData.shrubGroups.some(z => z.id.startsWith('ai-'));
    const hasClearingZones = bookingData.clearingZones && bookingData.clearingZones.some(z => z.id.startsWith('ai-'));
    const hasFumigationZones = bookingData.fumigationZones && bookingData.fumigationZones.some(z => z.id.startsWith('ai-'));

    return hasAiTasks || hasPalmGroups || hasLawnZones || hasHedgeZones || hasTreeGroups || hasShrubGroups || hasClearingZones || hasFumigationZones;
  }, [bookingData]);

  const resetAnalysis = () => {
      const resetData = {
          aiTasks: [],
          lawnZones: [],
          hedgeZones: [],
          treeGroups: [],
          shrubGroups: [],
          clearingZones: [],
          fumigationZones: [],
          palmGroups: [],
          estimatedHours: 0,
          aiQuantity: 0,
          aiDifficulty: 1
      };
      setBookingData(resetData);
      
      if (bookingData.serviceIds?.[0]) {
           updateServiceData(bookingData.serviceIds[0], resetData);
      }
      setIsImageStackExpanded(false);
  };

  // --- DEBUG TOOL STATE ---
  interface AnalysisDebugInfo {
    service: string;
    model: string;
    promptInputs: any;
    rawResponse: any;
    parsedResponse: any;
    finalAnalysisData: any;
    errors: any[];
    timestamp: string;
  }

  const [debugLogs, setDebugLogs] = useState<AnalysisDebugInfo | null>(null);
  const [showDebugPanel, setShowDebugPanel] = useState(import.meta.env.DEV || false);
  // -----------------------

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
    
    // Clear previous analysis errors when new photos are added
    setAnalysisError(null);

    const files = Array.from(e.dataTransfer.files).filter(file => 
      file.type.startsWith('image/')
    );
    
    if (files.length + photos.length > 5) {
      alert('Máximo 5 fotos permitidas');
      return;
    }

    // Add files to state first for immediate UI feedback
    const startIndex = photos.length;
    // Use functional update to ensure we don't lose previous state if multiple drops happen quickly
    // (though drag-drop is usually sequential user action)
    setPhotos(prev => [...prev, ...files]);

    // Mark indices as uploading
    setUploadingIndices(prev => {
        const next = new Set(prev);
        files.forEach((_, i) => next.add(startIndex + i));
        return next;
    });

    // Add new indices to analysis queue (pending by default)
    setPhotosToAnalyze(prev => {
        const next = new Set(prev);
        files.forEach((_, i) => next.add(startIndex + i));
        return next;
    });

    // Prepare local mutable state for incremental updates
    // We start with the current known state plus placeholders for new files
    // Note: bookingData might be slightly stale if a re-render is pending, 
    // but typically handleDrop runs on stable state.
    const currentUrls = [...(bookingData.uploadedPhotoUrls || [])];
    while(currentUrls.length < startIndex) currentUrls.push(''); // Fill gaps if any
    files.forEach(() => currentUrls.push('')); // Add placeholders for new files

    // We also need to track the mixed array of File|string for local state updates
    // We can't easily get the "current" photos from state inside the loop without functional updates,
    // but we can maintain a local shadow copy that assumes we started from `photos` + `files`.
    const localPhotosState = [...photos, ...files];

    files.forEach(async (file, i) => {
        const globalIndex = startIndex + i;
        
        try {
            const compressedFile = await compressImage(file);
            const url = await uploadFile(compressedFile, globalIndex);
            
            if (url) {
                // Update local tracking variables
                currentUrls[globalIndex] = url;
                localPhotosState[globalIndex] = url;

                // 1. Update uploading status
                setUploadingIndices(prev => {
                    const next = new Set(prev);
                    next.delete(globalIndex);
                    return next;
                });

                // 2. Update photos state
                setPhotos(prev => {
                    const next = [...prev];
                    // Ensure we don't go out of bounds if state changed unexpectedly, though unlikely with indices
                    if (next.length > globalIndex) {
                        next[globalIndex] = url;
                    }
                    return next;
                });

                // 3. Update global booking data incrementally
                setBookingData({ uploadedPhotoUrls: [...currentUrls] });
                
                // 4. Update service specific data
                if (bookingData.serviceIds?.[0]) {
                    updateServiceData(bookingData.serviceIds[0], {
                        uploadedPhotoUrls: [...currentUrls],
                        // We filter for Files to match the type expectation, 
                        // but effectively we are saving the progress of URLs
                        photos: localPhotosState.filter(p => p instanceof File) 
                    });
                }
            } else {
                // Handle upload failure (remove spinner)
                setUploadingIndices(prev => {
                    const next = new Set(prev);
                    next.delete(globalIndex);
                    return next;
                });
            }
        } catch (e) {
            console.error('Error uploading file:', e);
            setUploadingIndices(prev => {
                const next = new Set(prev);
                next.delete(globalIndex);
                return next;
            });
        }
    });
    
    saveProgress();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Clear previous analysis errors
    setAnalysisError(null);

    const files = Array.from(e.target.files || []).filter(file => 
      file.type.startsWith('image/')
    );
    
    if (files.length + photos.length > 5) {
      alert('Máximo 5 fotos permitidas');
      return;
    }

    // Add files to state first for immediate UI feedback
    const startIndex = photos.length;
    setPhotos(prev => [...prev, ...files]);

    // Mark indices as uploading
    setUploadingIndices(prev => {
        const next = new Set(prev);
        files.forEach((_, i) => next.add(startIndex + i));
        return next;
    });

    // Auto-select new photos for analysis
    setPhotosToAnalyze(prev => {
        const next = new Set(prev);
        files.forEach((_, i) => next.add(startIndex + i));
        return next;
    });

    // Prepare local mutable state for incremental updates
    const currentUrls = [...(bookingData.uploadedPhotoUrls || [])];
    while(currentUrls.length < startIndex) currentUrls.push('');
    files.forEach(() => currentUrls.push(''));

    const localPhotosState = [...photos, ...files];

    files.forEach(async (file, i) => {
        const globalIndex = startIndex + i;
        try {
            const compressedFile = await compressImage(file);
            const url = await uploadFile(compressedFile, globalIndex);
            
            if (url) {
                // Update local tracking variables
                currentUrls[globalIndex] = url;
                localPhotosState[globalIndex] = url;

                // 1. Update uploading status
                setUploadingIndices(prev => {
                    const next = new Set(prev);
                    next.delete(globalIndex);
                    return next;
                });

                // 2. Update photos state
                setPhotos(prev => {
                    const next = [...prev];
                    if (next.length > globalIndex) {
                        next[globalIndex] = url;
                    }
                    return next;
                });

                // 3. Update global booking data incrementally
                setBookingData({ uploadedPhotoUrls: [...currentUrls] });

                // 4. Update service specific data
                if (bookingData.serviceIds?.[0]) {
                    updateServiceData(bookingData.serviceIds[0], {
                        uploadedPhotoUrls: [...currentUrls],
                        photos: localPhotosState.filter(p => p instanceof File)
                    });
                }
            } else {
                 setUploadingIndices(prev => {
                    const next = new Set(prev);
                    next.delete(globalIndex);
                    return next;
                });
            }
        } catch (e) {
            console.error('Error uploading file:', e);
            setUploadingIndices(prev => {
                const next = new Set(prev);
                next.delete(globalIndex);
                return next;
            });
        }
    });

    // Remove resetAnalysis to persist previous results when adding new photos
    // if (isAnalysisComplete) resetAnalysis();
    saveProgress();
  };

  const togglePending = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setPhotosToAnalyze(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
        // If we mark as pending, we might want to clear 'analyzed' status?
        // Or just keep it as 're-analyze'
        setAnalyzedPhotoIndices(prevAnalyzed => {
            const nextAnalyzed = new Set(prevAnalyzed);
            nextAnalyzed.delete(index);
            return nextAnalyzed;
        });
      }
      return next;
    });
  };

  const roundToHalfHour = (hours: number) => {
    return Math.round(hours * 2) / 2;
  };

  const calculateTotalTreeHours = (groups: any[]) => {
    // Filter out failed analysis (Level 3)
    const validGroups = groups.filter((t: any) => !(t.isFailed || t.analysisLevel === 3));
    
    if (validGroups.length === 0) return 0;

    const total = validGroups.reduce((acc: number, t: any) => {
      // Use the AI estimated hours stored in the group, fallback to 1.5 if missing
      const h = Number(t.estimatedHours || t._estimatedHours || 1.5);
      return acc + h;
    }, 0);
    return Math.max(0, Math.ceil(total));
  };

  const updatePalmPricing = async (groups: any[]) => {
      // Flatten groups based on quantity for accurate backend calculation
      const flatPalms: any[] = [];
      groups.forEach(g => {
          // Skip failed analysis from pricing calculation
          if (g.analysisLevel === 3 || (g as any).isFailed) return;

          const qty = g.quantity || 1;
          for (let k = 0; k < qty; k++) {
              flatPalms.push({
                  especie: g.species,
                  altura: g.height,
                  estado: g.state || 'normal'
              });
          }
      });

      let totalHours = 0;
      try {
          const estimation = await calculatePalmHours(flatPalms);
          totalHours = roundToHalfHour(estimation.tiempoTotalEstimado);
      } catch (e) {
          console.error("Pricing error", e);
      }
      
      const payload = { palmGroups: groups, estimatedHours: totalHours, isAnalyzing: false };
      setBookingData(prev => ({ ...prev, ...payload }));
      if (bookingData.serviceIds?.[0]) {
          updateServiceData(bookingData.serviceIds[0], payload);
      }
  };

  const handlePalmQuantityChange = (groupId: string, newQuantity: number) => {
      const n = [...(bookingData.palmGroups || [])];
      const g = n.find(x => x.id === groupId);
      if (g) {
          g.quantity = Math.max(1, newQuantity);
          updatePalmPricing(n);
      }
  };

  const removePhoto = async (indexToRemove: number, includeLinkedResults = true) => {
    const removedUrl = bookingData.uploadedPhotoUrls?.[indexToRemove];
    // 1. Remove from 'photos' array
    const newPhotos = photos.filter((_, i) => i !== indexToRemove);
    setPhotos(newPhotos);
    
    // 2. Remove from 'analyzed' and 'toAnalyze' sets (adjusting indices)
    setAnalyzedPhotoIndices(prev => {
        const next = new Set<number>();
        prev.forEach(idx => {
            if (idx < indexToRemove) next.add(idx);
            else if (idx > indexToRemove) next.add(idx - 1);
        });
        return next;
    });

    setPhotosToAnalyze(prev => {
        const next = new Set<number>();
        prev.forEach(idx => {
            if (idx < indexToRemove) next.add(idx);
            else if (idx > indexToRemove) next.add(idx - 1);
        });
        return next;
    });
    
    const newUrls = (bookingData.uploadedPhotoUrls || []).filter((_, i) => i !== indexToRemove);
    setBookingData({ uploadedPhotoUrls: newUrls });
    
    // Explicitly update per-service data
    if (bookingData.serviceIds?.[0]) {
        updateServiceData(bookingData.serviceIds[0], {
            uploadedPhotoUrls: newUrls,
            photos: newPhotos.filter(p => p instanceof File)
        });
    }
    
    if (bookingData.treeGroups && removedUrl) {
        const nextTreeGroups = includeLinkedResults
          ? bookingData.treeGroups.filter(g => !g.photoUrls?.includes(removedUrl))
          : bookingData.treeGroups;
        const treeHours = calculateTotalTreeHours(nextTreeGroups);
        setBookingData({ treeGroups: nextTreeGroups, estimatedHours: treeHours });
        if (bookingData.serviceIds?.[0]) {
          updateServiceData(bookingData.serviceIds[0], { treeGroups: nextTreeGroups, estimatedHours: treeHours });
        }
    }

    if (bookingData.palmGroups) {
        const newGroups = bookingData.palmGroups
            .filter(g => {
                if (!includeLinkedResults) return true;
                const sameByIndex = g.imageIndex === indexToRemove;
                const sameByUrl = !!removedUrl && g.photoUrl === removedUrl;
                return !(sameByIndex || sameByUrl);
            })
            .map(g => ({
                ...g,
                imageIndex: (g.imageIndex !== undefined && g.imageIndex > indexToRemove) ? g.imageIndex - 1 : g.imageIndex
            }));
        await updatePalmPricing(newGroups);
    }

    if (bookingData.shrubGroups) {
        let newGroups = bookingData.shrubGroups
          .map(g => {
            const indices = Array.isArray(g.imageIndices) ? g.imageIndices : [];
            const hadIndex = indices.includes(indexToRemove);
            const updatedIndices = indices
              .filter(idx => idx !== indexToRemove)
              .map(idx => idx > indexToRemove ? idx - 1 : idx);
            if (includeLinkedResults && hadIndex) {
              return { ...g, imageIndices: updatedIndices, __remove: true };
            }
            return { ...g, imageIndices: updatedIndices };
          })
          .filter((g: any) => !g.__remove)
          .map((g: any) => {
            if (g.__remove !== undefined) {
              const { __remove, ...rest } = g;
              return rest;
            }
            return g;
          });

        newGroups = newGroups.filter(g => {
            const isAI = g.id.startsWith('ai-');
            if (isAI && g.imageIndices && g.imageIndices.length === 0) return false;
            return true;
        });

        const totalHours = newGroups.reduce((acc, g) => acc + (Math.ceil(g.quantity * 0.15) || 1), 0);
        setBookingData({ shrubGroups: newGroups, estimatedHours: totalHours });
        if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { shrubGroups: newGroups, estimatedHours: totalHours });
    }
    
    saveProgress();
  };

  const getMainPhotoLinkedResultCount = (photoIndex: number) => {
    const photoUrl = bookingData.uploadedPhotoUrls?.[photoIndex];
    let count = 0;
    if (bookingData.treeGroups) {
      count += bookingData.treeGroups.filter(g => (g.photoUrls || []).includes(photoUrl || '')).length;
    }
    if (bookingData.palmGroups) {
      count += bookingData.palmGroups.filter(g => g.imageIndex === photoIndex || (!!photoUrl && g.photoUrl === photoUrl)).length;
    }
    if (bookingData.shrubGroups) {
      count += bookingData.shrubGroups.filter(g => (g.imageIndices || []).includes(photoIndex)).length;
    }
    return count;
  };

  const handleRemoveMainPhoto = (photoIndex: number) => {
    const linkedCount = getMainPhotoLinkedResultCount(photoIndex);
    const isAnalyzed = analyzedPhotoIndices.has(photoIndex) || linkedCount > 0;
    if (!isAnalyzed) {
      removePhoto(photoIndex, false);
      return;
    }
    openConfirm({
      title: 'Eliminar foto analizada',
      message: `Esta foto tiene ${linkedCount} resultado${linkedCount === 1 ? '' : 's'} asociado${linkedCount === 1 ? '' : 's'}. Si continúas, se eliminará la foto y también sus resultados vinculados.`,
      confirmLabel: 'Eliminar foto y resultados',
      cancelLabel: 'Conservar todo',
      tone: 'danger',
      onConfirm: () => removePhoto(photoIndex, true)
    });
  };

  const removePalmAnalysisResult = (groupId: string) => {
    const group = (bookingData.palmGroups || []).find(g => g.id === groupId);
    if (!group) return;
    const nextGroups = (bookingData.palmGroups || []).filter(g => g.id !== groupId);
    const photoIndex = typeof group.imageIndex === 'number'
      ? group.imageIndex
      : (group.photoUrl && bookingData.uploadedPhotoUrls ? bookingData.uploadedPhotoUrls.indexOf(group.photoUrl) : -1);
    const hasOtherFromSamePhoto = nextGroups.some(g => {
      if (typeof group.imageIndex === 'number' && typeof g.imageIndex === 'number') return g.imageIndex === group.imageIndex;
      if (group.photoUrl && g.photoUrl) return g.photoUrl === group.photoUrl;
      return false;
    });
    if (!hasOtherFromSamePhoto && photoIndex >= 0) {
      setAnalyzedPhotoIndices(prev => {
        const next = new Set(prev);
        next.delete(photoIndex);
        return next;
      });
      setPhotosToAnalyze(prev => {
        const next = new Set(prev);
        next.add(photoIndex);
        return next;
      });
    }
    updatePalmPricing(nextGroups);
    saveProgress();
  };

  const removeTreeAnalysisResult = (groupId: string) => {
    const currentGroups = bookingData.treeGroups || [];
    const target = currentGroups.find(g => g.id === groupId);
    if (!target) return;
    const targetUrl = target.photoUrls?.[0];
    const nextGroups = currentGroups.filter(g => g.id !== groupId);
    const newHours = calculateTotalTreeHours(nextGroups);
    setBookingData({ treeGroups: nextGroups, estimatedHours: newHours });
    if (bookingData.serviceIds?.[0]) {
      updateServiceData(bookingData.serviceIds[0], { treeGroups: nextGroups, estimatedHours: newHours });
    }
    if (targetUrl && bookingData.uploadedPhotoUrls) {
      const photoIndex = bookingData.uploadedPhotoUrls.indexOf(targetUrl);
      const hasOtherFromSamePhoto = nextGroups.some(g => (g.photoUrls || []).includes(targetUrl));
      if (!hasOtherFromSamePhoto && photoIndex >= 0) {
        setAnalyzedPhotoIndices(prev => {
          const next = new Set(prev);
          next.delete(photoIndex);
          return next;
        });
        setPhotosToAnalyze(prev => {
          const next = new Set(prev);
          next.add(photoIndex);
          return next;
        });
      }
    }
    saveProgress();
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

      // Filter photos to analyze based on photosToAnalyze set
      const indicesToProcess = Array.from(photosToAnalyze).sort((a, b) => a - b);
      
      // If no new photos to analyze, do nothing or just re-run all if forced?
      // Spec says "Analyze X new photos", so we respect the set.
      if (indicesToProcess.length === 0) {
          setAnalyzing(false);
          setBookingData({ isAnalyzing: false });
          return;
      }

      const photoUrls: string[] = [];
      const uploadsToPerform: { file: File, index: number }[] = [];

      // Only process selected indices
      indicesToProcess.forEach(i => {
          const p = photos[i];
          if (!p) return;
          
          // Check if already uploaded
          const existingUrl = bookingData.uploadedPhotoUrls?.[i];
          if (existingUrl) {
              photoUrls[i] = existingUrl; // Keep original index position in sparse array
          } else {
              if (typeof p === 'string') {
                  photoUrls[i] = p;
              } else {
                  uploadsToPerform.push({ file: p, index: i });
              }
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

      // Filter out undefined holes, but we need to map results back to original indices?
      // The AI takes a list of URLs. It returns items with 'indice_imagen'.
      // If we send a filtered list [url_A, url_C] (indices 0 and 2),
      // the AI sees them as index 0 and 1 relative to the sent list.
      // WE MUST MAP THEM BACK.
      
      // Construct the payload URLs list
      const targetUrls = indicesToProcess.map(i => photoUrls[i]).filter(Boolean);
      const validUrls = targetUrls; // Alias for legacy code compatibility
      
      // Map AI relative index (0, 1, 2) -> Global Photo Index (0, 2, 5)
      const indexMap = targetUrls.map((_, relativeIdx) => indicesToProcess[relativeIdx]);

      if (targetUrls.length === 0) {
        setAnalyzing(false);
        setBookingData({ isAnalyzing: false });
        alert('Error al procesar las imágenes seleccionadas.');
        return;
      }

      // ---------------------------------------------------------
      // DEBUG: Capture inputs
      const debugInputs = {
        description: '',
        photoCount: targetUrls.length,
        selectedServiceIds: bookingData.serviceIds,
        photoUrls: targetUrls,
        serviceName: debugService,
        model: aiModel
      };
      // ---------------------------------------------------------

      const res = await estimateWorkWithAI({ 
        description: '', 
        photoCount: targetUrls.length, 
        selectedServiceIds: bookingData.serviceIds, 
        photoUrls: targetUrls,
        serviceName: debugService,
        model: aiModel
      });
      
      // ---------------------------------------------------------
      // DEBUG: Initialize Debug Info
      const currentDebugInfo: AnalysisDebugInfo = {
        service: debugService,
        model: aiModel,
        promptInputs: debugInputs,
        rawResponse: res.rawResponse,
        parsedResponse: res.tareas || res.palmas || res.arboles,
        finalAnalysisData: {},
        errors: [],
        timestamp: new Date().toISOString()
      };
      
      // Mark these photos as analyzed
      setAnalyzedPhotoIndices(prev => {
          const next = new Set(prev);
          indicesToProcess.forEach(i => next.add(i));
          return next;
      });
      
      // Clear them from pending queue
      setPhotosToAnalyze(prev => {
          const next = new Set(prev);
          indicesToProcess.forEach(i => next.delete(i));
          return next;
      });
      
      // We do NOT reset previous results here. We only filter them during merging.
      
      // ... logic continues in next block ...
      // Set debug info immediately so user sees raw data even if processing fails/finds nothing
      setDebugLogs(currentDebugInfo);
      // ---------------------------------------------------------

      // Handle Palm Analysis Results
      if (debugService === 'Poda de palmeras') {
          if (res.palmas && res.palmas.length > 0) {
            const newGroups = res.palmas.map((p, idx) => {
                 // Map AI relative index back to global index
                 const globalIndex = indexMap[p.indice_imagen];
                 const originalUrl = photoUrls[globalIndex];
                 
                 return {
                    id: `ai-${Date.now()}-${idx}`,
                    species: p.especie,
                    height: p.altura,
                    quantity: 1, // Default to 1, user must confirm
                    state: p.estado || 'normal',
                    wasteRemoval: true,
                    photoUrl: originalUrl || undefined,
                    imageIndex: globalIndex,
                    analysisLevel: p.nivel_analisis,
                    observations: p.observaciones
                };
            });
            
            // Merge with existing palms not in current analysis batch
            const oldGroups = (bookingData.palmGroups || []).filter(g => {
                // Keep if imageIndex is NOT in indicesToProcess
                return g.imageIndex !== undefined && !indicesToProcess.includes(g.imageIndex);
            });
            
            const mergedGroups = [...oldGroups, ...newGroups];
            
            // Calculate estimated hours via Backend (Strict requirement)
            await updatePalmPricing(mergedGroups);
            
            // DEBUG: Update Final Data
            // currentDebugInfo.finalAnalysisData = palmPayload; // palmPayload is not available here anymore
            setDebugLogs({...currentDebugInfo}); // Force update

            saveProgress();
            setAnalyzing(false);
            return;
          } else {
             // Explicit "No Palms Found" handling
             setAnalyzing(false);
             setAnalysisError({
                 title: 'No se han detectado palmeras',
                 message: 'La inteligencia artificial no ha encontrado palmeras claras en las imágenes. Por favor, añádelas manualmente o prueba con fotos más cercanas.',
                 type: 'warning'
             });
             
             // DEBUG: Update Final Data with error
             currentDebugInfo.errors.push('No palms detected (AI returned empty list)');
             setDebugLogs({...currentDebugInfo});
             return;
          }
      }

      // Handle Tree Analysis Results
      // NEW: Check for empty detection to prevent hallucinations
      if (debugService === 'Poda de árboles') {
          if (!res.arboles || res.arboles.length === 0) {
              setAnalyzing(false);
              setAnalysisError({
                  title: 'No se han detectado árboles',
                  message: 'La inteligencia artificial no ha encontrado árboles claros en la imagen. Por favor, asegúrate de que el árbol sea el protagonista de la foto.',
                  type: 'warning'
              });
              
              // DEBUG: Update Final Data with error
              currentDebugInfo.errors.push('No trees detected (AI returned empty list)');
              setDebugLogs({...currentDebugInfo});
              return;
          }
      }

      if (res.arboles && res.arboles.length > 0) {
        const newTreeGroups = res.arboles.map((t: any, idx: number) => {
            // Calculate heuristic height range: H-2m to H+1m (min 1m)
            const h = Number(t.altura_m || t.altura_aprox_m || 3);
            const minH = Math.max(1, Math.floor(h - 2));
            const maxH = Math.ceil(h + 1);
            const aiHeightRange = `${minH}-${maxH}m`;

            // Map height to standard buckets for pricing
            let standardHeight = '<3m';
            if (h < 3) standardHeight = '<3m';
            else if (h < 6) standardHeight = '3-6m';
            else if (h < 9) standardHeight = '6-9m';
            else standardHeight = '>9m';

            // Detect failure
            const isFailed = t.nivel_analisis === 3 || t.horas_estimadas === 0 || !t.horas_estimadas;

            // Map AI relative index back to global index
            const globalIndex = indexMap[t.indice_imagen];
            const originalUrl = photoUrls[globalIndex];

            return {
                id: `ai-tree-${Date.now()}-${idx}`,
                type: t.tipo_arbol || 'Decorativo',
                height: standardHeight, // Standard bucket for pricing
                aiHeightRange: aiHeightRange, // Display range
                pruningType: t.tipo_poda === 'shaping' ? 'shaping' as const : 'structural' as const,
                access: (() => {
                    // Normalize input string
                    const ta = (t.tipo_acceso || '').toLowerCase();
                    const da = (t.dificultad_acceso || '').toLowerCase();
                    
                    // Check new verbose values
                    if (ta.includes('trepa') || ta.includes('altura')) return 'dificil';
                    if (ta.includes('escalera')) return 'medio';
                    if (ta.includes('suelo')) return 'normal';
                    
                    // Fallback to legacy short values
                    if (da === 'dificil' || ta === 'dificil') return 'dificil';
                    if (da === 'medio' || ta === 'medio') return 'medio';
                    
                    return 'normal';
                })() as 'normal' | 'medio' | 'dificil',
                quantity: 1,
                wasteRemoval: true,
                photoUrls: [originalUrl].filter(Boolean),
                analysisLevel: t.nivel_analisis,
                observations: t.observaciones,
                isFailed: isFailed, // Mark as failed
                estimatedHours: Number(t.horas_estimadas) || 0, // Store explicit AI hours only
                _estimatedHours: Number(t.horas_estimadas) || 0 // Keep internal backup
            };
        });
        
        // MERGE LOGIC:
        // Filter out old groups that came from the photos we just re-analyzed
        const oldGroups = (bookingData.treeGroups || []).filter(g => {
            if (!g.photoUrls || g.photoUrls.length === 0) return true;
            const groupUrl = g.photoUrls[0];
            return !targetUrls.includes(groupUrl);
        });
        
        const mergedGroups = [...oldGroups, ...newTreeGroups];

        // Recalculate Total Hours (Valid Only)
        // Ensure old groups have estimatedHours (fallback if missing)
        const mergedGroupsWithHours = mergedGroups.map(g => ({
            ...g,
            estimatedHours: (g as any).estimatedHours || (g as any)._estimatedHours || 0
        }));
        
        const validTrees = mergedGroupsWithHours.filter((t: any) => !t.isFailed);
        
        // Recalculate Total Hours using AI values
        const totalTreeHours = calculateTotalTreeHours(validTrees);
        
        const treePayload = { 
            treeGroups: mergedGroupsWithHours, // Include ALL trees (valid + failed)
            estimatedHours: totalTreeHours,
            isAnalyzing: false
        };

        // Check for any failures in the CURRENT analysis run
        const failedCount = newTreeGroups.filter((t: any) => t.isFailed).length;
        if (failedCount > 0) {
             setAnalysisError({
                  title: `No se ha podido analizar ${failedCount} foto${failedCount !== 1 ? 's' : ''}`,
                  message: '', // User requested minimal text
                  type: 'warning'
              });
        }
        
        setBookingData(prev => ({
            ...prev,
            ...treePayload
        }));

        if (bookingData.serviceIds?.[0]) {
            updateServiceData(bookingData.serviceIds[0], treePayload);
        }
        
        currentDebugInfo.finalAnalysisData = treePayload;
        setDebugLogs({...currentDebugInfo}); 

        saveProgress();
        setAnalyzing(false);
        return;
      }

      const tareas = Array.isArray(res.tareas) ? res.tareas : [];
      if (tareas.length > 0) {
        let totalHours = 0;
        let updatePayload: any = { isAnalyzing: false };
        
        // Initialize accumulator arrays
        const newLawnZones: any[] = [];
        const newHedgeZones: any[] = [];
        const newTreeGroups: any[] = [];
        const newShrubGroups: any[] = [];
        const newClearingZones: any[] = [];
        const newFumigationZones: any[] = [];
        
        let totalAiQty = 0;

        tareas.forEach((t, idx) => {
            const norm = (s: string) => (s || '').toLowerCase();
            const normService = norm(debugService || t.tipo_servicio);

            if (normService.includes('césped') || normService.includes('cesped')) {
                const qty = Number(t.superficie_m2 || 0);
                const state = t.estado_jardin || 'normal';
                const mult = state.includes('muy') ? 1.6 : state.includes('descuidado') ? 1.3 : 1.0;
                totalHours += Math.ceil((qty / 150) * mult);
                totalAiQty += qty;
                
                newLawnZones.push({
                    id: `ai-zone-${Date.now()}-${idx}`,
                    species: 'Césped general',
                    state: state,
                    quantity: qty,
                    wasteRemoval: true,
                    photoUrls: validUrls, // TODO: Map specific indices if available
                    imageIndices: [],
                    analysisLevel: t.nivel_analisis,
                    observations: t.observaciones
                });
            } 
            else if (normService.includes('seto')) {
                const resumen = t.resumen_medicion || {};
                const faceDetails = resolveHedgeFaceDetails(t);
                const hasFaceBInResult = !!faceDetails?.cara_b;
                const numericFaces = typeof t.caras === 'number' ? t.caras : undefined;
                const baseLength = Number(resumen.base_longitud_m ?? t.longitud_m ?? 0);
                const baseHeight = Number(resumen.base_altura_m ?? t.altura_m ?? 0);
                const facesToTrim = Number(resumen.caras_recortar ?? numericFaces ?? (hasFaceBInResult ? 2 : 1)) >= 2 ? 2 : 1;
                const pricingLength = Number(resumen.longitud_calculo_m ?? (baseLength * facesToTrim));
                const pricingHeight = Number(resumen.altura_calculo_m ?? (baseHeight * facesToTrim));
                const hCat = resolveHedgeHeightBand(baseHeight);
                const state = t.estado_seto || 'normal';
                const baseObservations = Number(t.nivel_analisis || 1) >= 2 ? (t.observaciones || []) : [];
                const observations = baseHeight > 7.5
                  ? [...baseObservations, 'Altura detectada superior a 7.5m, revisar manualmente por seguridad.']
                  : baseObservations;
                
                const hMod = baseHeight > 2 ? 1.5 : 1;
                // State multiplier estimation for UI hours (real calc in ProvidersPage)
                const sMod = state.includes('descuidado') ? 1.2 : 1;
                
                totalHours += Math.ceil((baseLength / 10) * hMod * sMod) || 1;
                totalAiQty += baseLength;

                newHedgeZones.push({
                    id: `ai-hedge-${Date.now()}-${idx}`,
                    category: hCat,
                    type: hCat,
                    height: hCat,
                    length: baseLength,
                    length_pricing_m: pricingLength,
                    height_pricing_m: pricingHeight,
                    faces_to_trim: facesToTrim as 1 | 2,
                    hasBackFaceTrim: facesToTrim === 2,
                    state: state,
                    wasteRemoval: true,
                    photoUrls: validUrls,
                    imageIndices: [],
                    analysisLevel: t.nivel_analisis,
                    observations,
                    selectedIndices: validUrls.map((_, urlIdx) => urlIdx),
                    analyzedIndices: validUrls.map((_, urlIdx) => urlIdx),
                    faceA: {
                        photoUrls: validUrls,
                        files: [],
                        selectedIndices: validUrls.map((_, urlIdx) => urlIdx),
                        analyzedIndices: validUrls.map((_, urlIdx) => urlIdx),
                        analysisLevel: faceDetails?.cara_a?.nivel_analisis || t.nivel_analisis,
                        observations: faceDetails?.cara_a?.nivel_analisis >= 2 ? (faceDetails?.cara_a?.observaciones || []) : [],
                        longitud_m: faceDetails?.cara_a?.longitud_m,
                        altura_m: faceDetails?.cara_a?.altura_m
                    },
                    faceB: {
                        photoUrls: [],
                        files: [],
                        selectedIndices: [],
                        analyzedIndices: [],
                        analysisLevel: faceDetails?.cara_b?.nivel_analisis,
                        observations: faceDetails?.cara_b?.nivel_analisis >= 2 ? (faceDetails?.cara_b?.observaciones || []) : [],
                        longitud_m: faceDetails?.cara_b?.longitud_m,
                        altura_m: faceDetails?.cara_b?.altura_m
                    }
                });
            }
            else if (normService.includes('árbol') || normService.includes('arbol')) {
                const qty = Number(t.cantidad || 0);
                const height = Number(t.altura_aprox_m || 0);
                const hCat = height < 3 ? '<3m' : height <= 6 ? '3-6m' : height <= 9 ? '6-9m' : '>9m';
                
                const perTree = height < 3 ? 0.5 : height <= 6 ? 1.5 : height <= 9 ? 3 : 5;
                totalHours += Math.ceil(qty * perTree) || 1;
                totalAiQty += qty;

                newTreeGroups.push({
                    id: `ai-tree-${Date.now()}-${idx}`,
                    type: t.tipo_arbol || 'Decorativo',
                    height: hCat,
                    quantity: qty,
                    access: 'normal',
                    wasteRemoval: true,
                    photoUrls: validUrls,
                    analysisLevel: t.nivel_analisis,
                    observations: t.observaciones
                });
            }
            else if (normService.includes('poda de plantas')) {
                const qty = Number(t.cantidad_estimada || 0);
                
                // Map AI size to new configuration
                let size = 'Pequeño (hasta 1m)';
                const aiSize = t.tamano_promedio || '';
                if (aiSize.includes('Grande')) size = 'Grande (>2.5m)';
                else if (aiSize.includes('Mediano')) size = 'Mediano (1-2.5m)';
                
                // Map AI type to new configuration
                let type = 'Arbustos ornamentales';
                const aiType = t.tipo_plantacion || '';
                if (aiType.includes('Rosal')) type = 'Rosales y plantas florales';
                else if (aiType.includes('Trepadora')) type = 'Trepadoras';
                else if (aiType.includes('Cactus') || aiType.includes('Suculenta')) type = 'Cactus y suculentas grandes';

                totalHours += Math.ceil(qty * 0.15) || 1; 
                totalAiQty += qty;

                newShrubGroups.push({
                    id: `ai-shrub-${Date.now()}-${idx}`,
                    type: type,
                    size: size,
                    quantity: qty,
                    wasteRemoval: true,
                    photoUrls: validUrls,
                    analysisLevel: t.nivel_analisis,
                    observations: t.observaciones,
                    imageIndices: t.indices_imagenes || []
                });
            }
            else if (normService.includes('malas hierbas') || normService.includes('maleza') || normService.includes('labrar')) {
                const qty = Number(t.superficie_m2 || 0);
                const density = t.densidad_maleza || 'Media';
                const dMod = density === 'Alta' ? 2 : density === 'Media' ? 1.5 : 1;
                
                totalHours += Math.ceil((qty / 20) * dMod) || 1;
                totalAiQty += qty;

                newClearingZones.push({
                    id: `ai-clearing-${Date.now()}-${idx}`,
                    type: t.densidad_maleza === 'Alta' ? 'Cañaveral/Zarzas' : t.densidad_maleza === 'Baja' ? 'Maleza ligera' : 'Maleza densa',
                    area: qty,
                    wasteRemoval: true,
                    photoUrls: validUrls,
                    analysisLevel: t.nivel_analisis,
                    observations: t.observaciones
                });
            }
            else if (normService.includes('fumiga')) {
                const qty = Number(t.cantidad_o_superficie || 0);
                const unit = t.unidad || 'm2';
                const rawAffectedType = String(t.tipo_afectado || '').toLowerCase();
                const affectedType = rawAffectedType.includes('palmera')
                  ? 'Palmeras'
                  : rawAffectedType.includes('árbol') || rawAffectedType.includes('arbol')
                    ? 'Árboles'
                    : rawAffectedType.includes('seto')
                      ? 'Setos'
                      : rawAffectedType.includes('césped') || rawAffectedType.includes('cesped')
                        ? 'Césped'
                        : 'Plantas bajas';
                const rawBand = String((t as any).altura_tramo || '').toLowerCase();
                const aboveTwoMeters = typeof (t as any).supera_2m === 'boolean'
                  ? Boolean((t as any).supera_2m)
                  : rawBand === 'mas_de_2m';
                const aboveThreeMeters = typeof (t as any).supera_3m === 'boolean'
                  ? Boolean((t as any).supera_3m)
                  : rawBand === 'mas_de_3m';
                const recommended = String(t.tratamiento_recomendado || '').toLowerCase();
                const pestLevel = String(t.nivel_plaga || '').toLowerCase();
                const mappedTreatment = recommended || (pestLevel.includes('curativo') || pestLevel.includes('activa') ? 'insecticida' : (pestLevel.includes('fung') ? 'fungicida' : (pestLevel.includes('herbi') ? 'herbicida' : 'ecologico_preventivo')));
                
                if (unit === 'm2') totalHours += Math.ceil(qty / 100) || 1;
                else totalHours += Math.ceil(qty * 0.1) || 1;
                totalAiQty += qty;

                newFumigationZones.push({
                    id: `ai-fum-${Date.now()}-${idx}`,
                    type: mappedTreatment,
                    area: qty,
                    affectedType,
                    aboveTwoMeters,
                    aboveThreeMeters,
                    wasteRemoval: true,
                    photoUrls: validUrls,
                    analysisLevel: t.nivel_analisis,
                    observations: t.observaciones
                });
            }
            else {
                // Fallback
                totalAiQty += Number(t.superficie_m2 ?? t.numero_plantas ?? 0);
                totalHours += 1;
            }
        });

        // Update Payload with accumulated results
        if (newLawnZones.length > 0) {
            updatePayload.lawnZones = newLawnZones;
            if (!updatePayload.aiUnit) updatePayload.aiUnit = 'm2';
        }
        if (newHedgeZones.length > 0) {
            updatePayload.hedgeZones = newHedgeZones;
            if (!updatePayload.aiUnit) updatePayload.aiUnit = 'm';
        }
        if (newTreeGroups.length > 0) {
            updatePayload.treeGroups = newTreeGroups;
            if (!updatePayload.aiUnit) updatePayload.aiUnit = 'u';
        }
        if (newShrubGroups.length > 0) {
            updatePayload.shrubGroups = newShrubGroups;
            if (!updatePayload.aiUnit) updatePayload.aiUnit = 'u';
        }
        if (newClearingZones.length > 0) {
            updatePayload.clearingZones = newClearingZones;
            if (!updatePayload.aiUnit) updatePayload.aiUnit = 'm2';
        }
        if (newFumigationZones.length > 0) {
            updatePayload.fumigationZones = newFumigationZones;
            if (!updatePayload.aiUnit) updatePayload.aiUnit = 'u'; // Default to unit if mixed
        }
        
        // General fallback if mixed or unknown
        if (totalAiQty > 0) updatePayload.aiQuantity = totalAiQty;
        
        updatePayload.estimatedHours = totalHours;
        updatePayload.aiTasks = tareas;
        
        setBookingData(updatePayload);
        
        if (bookingData.serviceIds?.[0]) {
             updateServiceData(bookingData.serviceIds[0], updatePayload);
        }

        // DEBUG: Update Final Data
        currentDebugInfo.finalAnalysisData = updatePayload;
        setDebugLogs({...currentDebugInfo}); // Force update
        
        saveProgress();
      } else {
        // No tasks found logic
        const noTasksPayload = { 
            isAnalyzing: false, 
            aiQuantity: 0, 
            estimatedHours: 0,
            aiTasks: [] 
        };
        setBookingData(noTasksPayload);
        if (bookingData.serviceIds?.[0]) {
             updateServiceData(bookingData.serviceIds[0], noTasksPayload);
        }
        
        // DEBUG: Update Final Data for empty result
        currentDebugInfo.finalAnalysisData = { ...noTasksPayload, message: 'No tasks detected by AI' };
        setDebugLogs({...currentDebugInfo}); // Force update
        
        // Explicit UI Feedback for "No Tasks" (Lawn, etc)
        if (debugService.toLowerCase().includes('césped') || debugService.toLowerCase().includes('cesped')) {
             setAnalysisError({
                 title: 'No se ha detectado césped',
                 message: 'No hemos podido delimitar una zona de césped clara. Por favor, añade la zona manualmente.',
                 type: 'warning'
             });
        } else {
             // Generic fallback
             setAnalysisError({
                 title: 'No se detectaron elementos',
                 message: 'No hemos podido identificar elementos del servicio solicitado. Por favor, añádelos manualmente.',
                 type: 'warning'
             });
        }

        saveProgress();
      }
    } catch (e) {
        setBookingData({ isAnalyzing: false });
        
        if (bookingData.serviceIds?.[0]) {
             updateServiceData(bookingData.serviceIds[0], {
                 isAnalyzing: false
             });
        }
        
        // DEBUG: Capture Error
        setDebugLogs(prev => prev ? ({...prev, errors: [...prev.errors, e]}) : {
            service: debugService,
            model: aiModel,
            promptInputs: {},
            rawResponse: {},
            parsedResponse: {},
            finalAnalysisData: {},
            errors: [e],
            timestamp: new Date().toISOString()
        });

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
    if (lower.includes('fumig')) {
        return {
            title: 'Tratamientos fitosanitarios',
            description: 'Configura cada zona con tipo de vegetación + tratamiento y sube fotos claras para analizar.'
        };
    }
    
    return defaultContent;
  };

  const serviceContent = getServiceContent();

  // --- NEW: Lawn Zone Logic ---
  const addLawnZone = () => {
    // Check max zones
    if ((bookingData.lawnZones || []).length >= 4) {
        toast.error('Máximo 4 zonas permitidas');
        return;
    }

    // Clear analysis error when user interacts
    setAnalysisError(null);
    const newZone = {
        id: `zone-${Date.now()}`,
        species: '',
        state: 'normal',
        quantity: 0,
        wasteRemoval: true,
        photoUrls: [],
        imageIndices: [],
        files: [],
        selectedIndices: [],
        analyzedIndices: []
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
    const zones = [...(bookingData.lawnZones || [])];
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx === -1) return;
    const zone = zones[idx];
    
    // Check if zone has analysis data
    const isAnalyzed = zone.quantity > 0 || (zone.analysisLevel !== undefined);

    if (isAnalyzed) {
      openConfirm({
        title: 'Eliminar resultado del análisis',
        message: 'Se eliminará el resultado del análisis de esta zona, pero se conservarán todas las fotos.',
        confirmLabel: 'Eliminar resultado',
        cancelLabel: 'Cancelar',
        tone: 'warning',
        onConfirm: () => {
          const updatedZone = { 
              ...zone,
              quantity: 0,
              species: '',
              state: 'normal',
              analysisLevel: undefined,
              observations: [],
              analyzedIndices: []
          };
          zones[idx] = updatedZone;
          setBookingData({ lawnZones: zones });
          if (bookingData.serviceIds?.[0]) {
               updateServiceData(bookingData.serviceIds[0], { lawnZones: zones });
          }
          saveProgress();
        }
      });
      return;
    }

    openConfirm({
      title: 'Eliminar zona',
      message: 'Se eliminará la zona completa junto con sus fotos.',
      confirmLabel: 'Eliminar zona',
      cancelLabel: 'Cancelar',
      tone: 'danger',
      onConfirm: () => {
        const newZones = zones.filter(z => z.id !== zoneId);
        setBookingData({ lawnZones: newZones });
        if (bookingData.serviceIds?.[0]) {
             updateServiceData(bookingData.serviceIds[0], { lawnZones: newZones });
        }
        saveProgress();
      }
    });
  };

  const toggleLawnPhotoSelection = (zoneId: string, photoIndex: number) => {
      const zones = [...(bookingData.lawnZones || [])];
      const idx = zones.findIndex(z => z.id === zoneId);
      if (idx === -1) return;
      
      const zone = { ...zones[idx] };
      // If undefined, initialize with all selected (matching UI default)
      let currentSelected = zone.selectedIndices;
      if (!currentSelected) {
          currentSelected = zone.photoUrls.map((_, i) => i);
      }

      const selected = new Set(currentSelected);
      
      if (selected.has(photoIndex)) {
          selected.delete(photoIndex);
      } else {
          selected.add(photoIndex);
      }
      
      zone.selectedIndices = Array.from(selected);
      zones[idx] = zone;
      
      setBookingData({ lawnZones: zones });
      if (bookingData.serviceIds?.[0]) {
           updateServiceData(bookingData.serviceIds[0], { lawnZones: zones });
      }
  };

  const handleLawnFileSelect = async (zoneId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;

    const zones = [...(bookingData.lawnZones || [])];
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx === -1) return;

    // Check max photos per zone
    if (zones[idx].photoUrls.length + files.length > 5) {
        toast.error('Máximo 5 fotos por zona');
        return;
    }

    // 1. Create temporary object URLs and add to zone immediately
    const tempUrls = files.map(f => URL.createObjectURL(f));
    const currentLen = zones[idx].photoUrls.length;
    
    // Add temp URLs to photoUrls
    zones[idx].photoUrls = [...zones[idx].photoUrls, ...tempUrls];
    
    // Auto-select new photos
    const newIndices = tempUrls.map((_, i) => currentLen + i);
    zones[idx].selectedIndices = [...(zones[idx].selectedIndices || []), ...newIndices];

    // Mark as uploading in local state
    setLawnUploads(prev => {
        const zoneUploads = new Set(prev[zoneId] || []);
        newIndices.forEach(i => zoneUploads.add(i));
        return { ...prev, [zoneId]: zoneUploads };
    });

    // Update UI immediately
    setBookingData({ lawnZones: zones });

    // 2. Upload in background
    const startIdx = (bookingData.uploadedPhotoUrls?.length || 0) + Date.now(); 
    
    try {
        const uploadResults = await Promise.all(files.map((file, i) => uploadFile(file, startIdx + i)));
        
        // 3. Update with real URLs
        // We need to fetch the latest state to avoid race conditions (though here we are inside the function closure)
        // Ideally we should use functional state updates, but bookingData is complex.
        // We'll re-read bookingData in the next render cycle effectively by creating a new object here.
        
        // Note: We need to update the SAME zone object instance we modified earlier? 
        // No, we need to create a new one based on the current state.
        // But since we are in an async function, bookingData might have changed?
        // For now, let's assume single-user interaction flow.
        
        const updatedZones = [...(bookingData.lawnZones || [])];
        // Re-find index in case zones changed (unlikely in this short time but possible)
        const updatedIdx = updatedZones.findIndex(z => z.id === zoneId);
        if (updatedIdx === -1) return;
        
        const updatedZone = { ...updatedZones[updatedIdx] };
        const finalUrls = [...updatedZone.photoUrls];
        
        uploadResults.forEach((url, i) => {
            const targetIdx = currentLen + i;
            if (url && targetIdx < finalUrls.length) {
                finalUrls[targetIdx] = url;
            }
        });
        
        updatedZone.photoUrls = finalUrls;
        updatedZones[updatedIdx] = updatedZone;
        
        setBookingData({ lawnZones: updatedZones });
        
        if (bookingData.serviceIds?.[0]) {
             updateServiceData(bookingData.serviceIds[0], {
                 lawnZones: updatedZones
             });
        }
    } catch (error) {
        console.error("Upload failed", error);
        toast.error("Error al subir algunas imágenes");
    } finally {
        // Clear uploading state
        setLawnUploads(prev => {
            const next = { ...prev };
            const zoneUploads = new Set(next[zoneId] || []);
            newIndices.forEach(i => zoneUploads.delete(i));
            next[zoneId] = zoneUploads;
            return next;
        });
    }
  };

  const removePhotoFromZone = (zoneId: string, photoIndex: number) => {
      const zones = [...(bookingData.lawnZones || [])];
      const idx = zones.findIndex(z => z.id === zoneId);
      if (idx === -1) return;
      
      const zone = { ...zones[idx] };
      const isAnalyzedPhoto = zone.analyzedIndices?.includes(photoIndex);
      const executeRemove = () => {
      const updatedZone = { ...zone };
      
      // Update photos
      const urlCount = updatedZone.photoUrls.length;
      if (photoIndex < urlCount) {
          updatedZone.photoUrls = updatedZone.photoUrls.filter((_, i) => i !== photoIndex);
      } else {
          const fileIdx = photoIndex - urlCount;
          if (updatedZone.files) updatedZone.files = updatedZone.files.filter((_, i) => i !== fileIdx);
      }

      // Update indices (selectedIndices)
      if (updatedZone.selectedIndices) {
          updatedZone.selectedIndices = updatedZone.selectedIndices
              .filter(i => i !== photoIndex) // Remove the deleted index
              .map(i => i > photoIndex ? i - 1 : i); // Shift subsequent indices
      }

      // Update analyzedIndices
      if (updatedZone.analyzedIndices) {
          updatedZone.analyzedIndices = updatedZone.analyzedIndices
              .filter(i => i !== photoIndex)
              .map(i => i > photoIndex ? i - 1 : i);
      }

      if (isAnalyzedPhoto) {
        updatedZone.quantity = 0;
        updatedZone.species = '';
        updatedZone.state = 'normal';
        updatedZone.analysisLevel = undefined;
        updatedZone.observations = [];
        updatedZone.analyzedIndices = [];
      }

      zones[idx] = updatedZone;
      setBookingData({ lawnZones: zones });
      
      if (bookingData.serviceIds?.[0]) {
           updateServiceData(bookingData.serviceIds[0], {
               lawnZones: zones
           });
      }
      };

      if (!isAnalyzedPhoto) {
        executeRemove();
        return;
      }

      openConfirm({
        title: 'Eliminar foto analizada',
        message: 'Esta foto forma parte del análisis de la zona. Si continúas, también se eliminará ese resultado de análisis.',
        confirmLabel: 'Eliminar foto y resultado',
        cancelLabel: 'Conservar todo',
        tone: 'danger',
        onConfirm: executeRemove
      });
  };

  const isLawnZoneAnalyzed = (zone: { quantity?: number; analysisLevel?: number }) => Number(zone.quantity || 0) > 0 || zone.analysisLevel !== undefined;

  const analyzeLawnZone = async (zoneId: string, options?: { silent?: boolean }) => {
      const zones = [...(bookingData.lawnZones || [])];
      const idx = zones.findIndex(z => z.id === zoneId);
      if (idx === -1) return false;
      const zone = zones[idx];
      const allUrls = zone.photoUrls || [];
      const indicesToAnalyze = zone.selectedIndices ?? allUrls.map((_, i) => i);
      const finalUrls = indicesToAnalyze.map(i => allUrls[i]).filter((u): u is string => u !== undefined);

      if (finalUrls.length === 0) {
          const message = 'Selecciona al menos una foto para analizar';
          if (!options?.silent) alert(message);
          return false;
      }

      setLawnAnalyzingZoneIds(prev => {
          const next = new Set(prev);
          next.add(zoneId);
          return next;
      });

      try {
          const debugInputs = {
             description: '',
             photoCount: finalUrls.length,
             selectedServiceIds: bookingData.serviceIds,
             photoUrls: finalUrls,
             serviceName: 'Corte de césped',
             model: aiModel
          };

          const res = await estimateWorkWithAI(debugInputs);
          const lawnTasks = (() => {
              if (Array.isArray(res.tareas) && res.tareas.length > 0) return res.tareas;
              const raw = res.rawResponse as any;
              if (Array.isArray(raw?.tareas) && raw.tareas.length > 0) return raw.tareas;
              if (raw?.tareas && typeof raw.tareas === 'object') return [raw.tareas];
              if (raw?.tarea && typeof raw.tarea === 'object') return [raw.tarea];
              return [];
          })();
          
          const currentDebugInfo: AnalysisDebugInfo = {
              service: 'Corte de césped',
              model: aiModel,
              promptInputs: debugInputs,
              rawResponse: res.rawResponse,
              parsedResponse: lawnTasks,
              finalAnalysisData: {},
              errors: [],
              timestamp: new Date().toISOString()
          };
          setDebugLogs(currentDebugInfo);

          if (res.reasons && res.reasons.some(r => r === 'AI_FAILED_CRITICAL')) {
              throw new Error('La IA no ha podido procesar las imágenes. Por favor, inténtalo de nuevo.');
          }

          if (lawnTasks.length > 0) {
              const t = lawnTasks[0];
              const zonePatch = {
                  species: 'Césped general',
                  state: t.estado_jardin || 'normal',
                  quantity: Number(t.superficie_m2 || 0),
                  analysisLevel: t.nivel_analisis,
                  observations: t.observaciones,
                  analyzedIndices: indicesToAnalyze
              };
              let nextZones: any[] = [];

              setBookingData(prev => {
                  const updatedZones = [...(prev.lawnZones || [])];
                  const updatedIdx = updatedZones.findIndex(z => z.id === zoneId);
                  if (updatedIdx !== -1) {
                      updatedZones[updatedIdx] = { ...updatedZones[updatedIdx], ...zonePatch };
                  }

                  nextZones = updatedZones;
                  const activeServiceId = prev.serviceIds?.[0];
                  const nextServicesData = activeServiceId
                      ? {
                          ...prev.servicesData,
                          [activeServiceId]: {
                              ...(prev.servicesData?.[activeServiceId] || {}),
                              lawnZones: updatedZones
                          }
                      }
                      : prev.servicesData;

                  return {
                      lawnZones: updatedZones,
                      servicesData: nextServicesData
                  };
              });
              
              currentDebugInfo.finalAnalysisData = { lawnZones: nextZones };
              setDebugLogs({...currentDebugInfo});
              saveProgress();
              return true;
          }

          throw new Error('No se han detectado datos válidos en las imágenes.');
      } catch (e: any) {
          console.error(e);
          setDebugLogs(prev => prev ? ({...prev, errors: [...prev.errors, e]}) : {
              service: 'Corte de césped',
              model: aiModel,
              promptInputs: {},
              rawResponse: {},
              parsedResponse: {},
              finalAnalysisData: {},
              errors: [e],
              timestamp: new Date().toISOString()
          });
          if (!options?.silent) alert(e.message || 'Error en el análisis');
          return false;
      } finally {
          setLawnAnalyzingZoneIds(prev => {
              const next = new Set(prev);
              next.delete(zoneId);
              return next;
          });
      }
  };

  const analyzeAllLawnZones = async () => {
      const zones = bookingData.lawnZones || [];
      const pendingZones = zones.filter(zone => !isLawnZoneAnalyzed(zone) && !lawnAnalyzingZoneIds.has(zone.id));
      if (pendingZones.length === 0) return;

      const analyzableZones = pendingZones.filter(zone => {
          const allUrls = zone.photoUrls || [];
          const selectedIndices = zone.selectedIndices ?? allUrls.map((_, i) => i);
          const selectedUrls = selectedIndices.map(i => allUrls[i]).filter((u): u is string => u !== undefined);
          return selectedUrls.length > 0;
      });
      const skippedCount = pendingZones.length - analyzableZones.length;

      if (analyzableZones.length === 0) {
          toast.error('Añade y selecciona fotos en las zonas pendientes para analizarlas');
          return;
      }

      const results = await Promise.allSettled(
          analyzableZones.map(zone => analyzeLawnZone(zone.id, { silent: true }))
      );
      const successCount = results.filter(result => result.status === 'fulfilled' && result.value).length;
      const failedCount = analyzableZones.length - successCount;

      if (successCount > 0) {
          toast.success(`Se analizaron ${successCount} zona${successCount === 1 ? '' : 's'} de césped`);
      }
      if (failedCount > 0) {
          toast.error(`No se pudieron analizar ${failedCount} zona${failedCount === 1 ? '' : 's'}`);
      }
      if (skippedCount > 0) {
          toast.error(`${skippedCount} zona${skippedCount === 1 ? '' : 's'} pendiente${skippedCount === 1 ? '' : 's'} sin fotos seleccionadas`);
      }
  };

  // --- Hedge Logic ---
  type HedgeFaceKey = 'faceA' | 'faceB';
  type HedgeFace = {
    photoUrls: string[];
    files: File[];
    selectedIndices: number[];
    analyzedIndices: number[];
    analysisLevel?: number;
    observations?: string[];
    longitud_m?: number;
    altura_m?: number;
  };

  const createEmptyHedgeFace = (): HedgeFace => ({
    photoUrls: [],
    files: [],
    selectedIndices: [],
    analyzedIndices: [],
  });

  const resolveHedgeHeightBand = (heightM: number): '0-1m' | '1-2m' | '2-4m' | '4-6m' => {
    if (heightM <= 1) return '0-1m';
    if (heightM <= 2) return '1-2m';
    if (heightM <= 4) return '2-4m';
    return '4-6m';
  };

  const hedgeHeightBandToMeters = (heightBand: string): number => {
    if (heightBand === '0-1m' || heightBand === '<1m') return 0.75;
    if (heightBand === '1-2m' || heightBand === '>1-2m' || heightBand === 'Hasta 2m (Nivel Suelo)') return 1.5;
    if (heightBand === '2-4m' || heightBand === '>2-3m' || heightBand === '3-4.5m' || heightBand === '2-4m (Nivel Escalera)') return 3;
    if (heightBand === '4-6m' || heightBand === '>4.5-6m' || heightBand === '>6-7.5m' || heightBand === '4-6m (Nivel Especialista)') return 5;
    return 3;
  };

  const resolveHedgeFaceDetails = (task: any) => {
    if (task?.detalle_caras && typeof task.detalle_caras === 'object') return task.detalle_caras;
    if (task?.caras && typeof task.caras === 'object') return task.caras;
    return {};
  };

  const isHedgeZoneAnalyzed = (zone: any) => Number(zone.length || 0) > 0 || zone.analysisLevel !== undefined;

  const normalizeHedgeZone = (zone: any) => {
    const legacyUrls = zone.photoUrls || [];
    const legacySelected = zone.selectedIndices ?? legacyUrls.map((_: string, i: number) => i);
    const legacyAnalyzed = zone.analyzedIndices || [];

    const faceA: HedgeFace = {
      ...createEmptyHedgeFace(),
      ...(zone.faceA || {}),
      photoUrls: zone.faceA?.photoUrls ? [...zone.faceA.photoUrls] : [...legacyUrls],
      files: zone.faceA?.files ? [...zone.faceA.files] : [],
      selectedIndices: zone.faceA?.selectedIndices ? [...zone.faceA.selectedIndices] : [...legacySelected],
      analyzedIndices: zone.faceA?.analyzedIndices ? [...zone.faceA.analyzedIndices] : [...legacyAnalyzed],
    };

    const faceB: HedgeFace = {
      ...createEmptyHedgeFace(),
      ...(zone.faceB || {}),
      photoUrls: zone.faceB?.photoUrls ? [...zone.faceB.photoUrls] : [],
      files: zone.faceB?.files ? [...zone.faceB.files] : [],
      selectedIndices: zone.faceB?.selectedIndices ? [...zone.faceB.selectedIndices] : [],
      analyzedIndices: zone.faceB?.analyzedIndices ? [...zone.faceB.analyzedIndices] : [],
    };

    return {
      ...zone,
      faceA,
      faceB,
      hasBackFaceTrim: zone.hasBackFaceTrim ?? faceB.photoUrls.length > 0,
      faces_to_trim: zone.faces_to_trim,
      length_pricing_m: zone.length_pricing_m,
      height_pricing_m: zone.height_pricing_m,
    };
  };

  const syncLegacyHedgeZone = (zone: any) => {
    const faceAUrls = zone.faceA?.photoUrls || [];
    const faceBUrls = zone.faceB?.photoUrls || [];
    const faceASelected = zone.faceA?.selectedIndices || [];
    const faceBSelected = zone.faceB?.selectedIndices || [];
    const faceAAnalyzed = zone.faceA?.analyzedIndices || [];
    const faceBAnalyzed = zone.faceB?.analyzedIndices || [];
    const offset = faceAUrls.length;

    return {
      ...zone,
      hasBackFaceTrim: faceBUrls.length > 0,
      photoUrls: [...faceAUrls, ...faceBUrls],
      files: [],
      selectedIndices: [...faceASelected, ...faceBSelected.map((i: number) => i + offset)],
      analyzedIndices: [...faceAAnalyzed, ...faceBAnalyzed.map((i: number) => i + offset)],
    };
  };

  const addHedgeZone = () => {
    if ((bookingData.hedgeZones || []).length >= 4) {
        toast.error('Máximo 4 zonas permitidas');
        return;
    }

    setAnalysisError(null);
    const newZone = {
        id: `hedge-${Date.now()}`,
        category: '1-2m',
        type: '1-2m',
        height: '1-2m',
        length: 0,
        state: 'normal',
        access: 'normal' as const, // Legacy
        wasteRemoval: true,
        faceA: createEmptyHedgeFace(),
        faceB: createEmptyHedgeFace(),
        hasBackFaceTrim: false,
        faces_to_trim: 1 as 1 | 2,
        length_pricing_m: 0,
        height_pricing_m: 0,
        photoUrls: [] as string[],
        files: [] as File[],
        imageIndices: [] as number[],
        selectedIndices: [] as number[],
        analyzedIndices: [] as number[]
    };
    const newZones = [...(bookingData.hedgeZones || []), newZone];
    setBookingData({ hedgeZones: newZones });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { hedgeZones: newZones });
    saveProgress();
  };

  const removeHedgeZone = (id: string) => {
    const zones = [...(bookingData.hedgeZones || [])];
    const idx = zones.findIndex(z => z.id === id);
    if (idx === -1) return;

    const zone = zones[idx];
    const isAnalyzed = zone.length > 0 || (zone.analysisLevel !== undefined);

    if (isAnalyzed) {
      openConfirm({
        title: 'Eliminar resultado del análisis',
        message: 'Se eliminará el resultado del análisis de esta zona y se conservarán las fotos.',
        confirmLabel: 'Eliminar resultado',
        cancelLabel: 'Cancelar',
        tone: 'warning',
        onConfirm: () => {
          const updatedZone = {
              ...normalizeHedgeZone(zone),
              length: 0,
              length_pricing_m: 0,
              height_pricing_m: 0,
              faces_to_trim: 1 as 1 | 2,
              category: '1-2m',
              type: '1-2m',
              height: '1-2m',
              state: 'normal',
              analysisLevel: undefined,
              observations: [],
              faceA: {
                ...normalizeHedgeZone(zone).faceA,
                analyzedIndices: [],
                analysisLevel: undefined,
                observations: [],
              },
              faceB: {
                ...normalizeHedgeZone(zone).faceB,
                analyzedIndices: [],
                analysisLevel: undefined,
                observations: [],
              },
          };
          zones[idx] = syncLegacyHedgeZone(updatedZone);
          setBookingData({ hedgeZones: zones });
          if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { hedgeZones: zones });
          saveProgress();
        }
      });
      return;
    }

    openConfirm({
      title: 'Eliminar zona',
      message: 'Se eliminará la zona completa con todas sus fotos.',
      confirmLabel: 'Eliminar zona',
      cancelLabel: 'Cancelar',
      tone: 'danger',
      onConfirm: () => {
        const newZones = zones.filter(z => z.id !== id);
        setBookingData({ hedgeZones: newZones });
        if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { hedgeZones: newZones });
        saveProgress();
      }
    });
  };

  const toggleHedgePhotoSelection = (zoneId: string, faceKey: HedgeFaceKey, photoIndex: number) => {
    const zones = [...(bookingData.hedgeZones || [])];
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx === -1) return;

    const zone = normalizeHedgeZone(zones[idx]);
    const face = { ...zone[faceKey] };
    let currentSelected = face.selectedIndices;
    if (!currentSelected) {
        currentSelected = (face.photoUrls || []).map((_: string, i: number) => i);
    }

    const selected = new Set(currentSelected);
    if (selected.has(photoIndex)) {
        selected.delete(photoIndex);
    } else {
        selected.add(photoIndex);
    }

    face.selectedIndices = Array.from(selected);
    zone[faceKey] = face;
    zones[idx] = syncLegacyHedgeZone(zone);
    setBookingData({ hedgeZones: zones });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { hedgeZones: zones });
  };

  const handleHedgeFileSelect = async (id: string, faceKey: HedgeFaceKey, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    const zones = [...(bookingData.hedgeZones || [])];
    const idx = zones.findIndex(z => z.id === id);
    if (idx === -1) return;

    const normalizedZone = normalizeHedgeZone(zones[idx]);
    const currentFace = { ...normalizedZone[faceKey] };

    if ((currentFace.photoUrls?.length || 0) + files.length > 5) {
        toast.error('Máximo 5 fotos por cara');
        return;
    }

    const tempUrls = files.map(f => URL.createObjectURL(f));
    const currentLen = currentFace.photoUrls?.length || 0;
    currentFace.photoUrls = [...(currentFace.photoUrls || []), ...tempUrls];
    currentFace.selectedIndices = [...(currentFace.selectedIndices || []), ...tempUrls.map((_: string, i: number) => currentLen + i)];

    normalizedZone[faceKey] = currentFace;
    zones[idx] = syncLegacyHedgeZone(normalizedZone);

    const newIndices = tempUrls.map((_: string, i: number) => currentLen + i);
    const uploadKey = `${id}-${faceKey}`;

    setHedgeUploads(prev => {
        const zoneUploads = new Set(prev[uploadKey] || []);
        newIndices.forEach(i => zoneUploads.add(i));
        return { ...prev, [uploadKey]: zoneUploads };
    });

    setBookingData({ hedgeZones: zones });

    const startIdx = (bookingData.uploadedPhotoUrls?.length || 0) + Date.now();

    try {
        const uploadResults = await Promise.all(files.map((file, i) => uploadFile(file, startIdx + i)));
        const updatedZones = [...zones];
        const updatedIdx = updatedZones.findIndex(z => z.id === id);
        if (updatedIdx === -1) return;

        const updatedZone = normalizeHedgeZone(updatedZones[updatedIdx]);
        const updatedFace = { ...updatedZone[faceKey] };
        const finalUrls = [...(updatedFace.photoUrls || [])];

        uploadResults.forEach((url, i) => {
            const targetIdx = currentLen + i;
            if (!url) return;
            if (targetIdx < finalUrls.length) {
                finalUrls[targetIdx] = url;
            } else {
                finalUrls.push(url);
            }
        });

        updatedFace.photoUrls = finalUrls;
        updatedZone[faceKey] = updatedFace;
        updatedZones[updatedIdx] = syncLegacyHedgeZone(updatedZone);
        setBookingData({ hedgeZones: updatedZones });
        if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { hedgeZones: updatedZones });
    } catch (error) {
        console.error('Upload failed', error);
        toast.error('Error al subir algunas imágenes');
    } finally {
        setHedgeUploads(prev => {
            const next = { ...prev };
            const zoneUploads = new Set(next[uploadKey] || []);
            newIndices.forEach(i => zoneUploads.delete(i));
            next[uploadKey] = zoneUploads;
            return next;
        });
    }
  };

  const removePhotoFromHedgeZone = (zoneId: string, faceKey: HedgeFaceKey, photoIndex: number) => {
    const zones = [...(bookingData.hedgeZones || [])];
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx === -1) return;

    const zone = normalizeHedgeZone(zones[idx]);
    const face = { ...zone[faceKey] };
    const isAnalyzedPhoto = face.analyzedIndices?.includes(photoIndex);
    const executeRemove = () => {
    const updatedZone = normalizeHedgeZone(zone);
    const updatedFace = { ...updatedZone[faceKey] };
    const urlCount = (face.photoUrls || []).length;
    if (photoIndex < urlCount) {
        updatedFace.photoUrls = (updatedFace.photoUrls || []).filter((_: string, i: number) => i !== photoIndex);
    } else {
        const fileIdx = photoIndex - urlCount;
        if (updatedFace.files) updatedFace.files = updatedFace.files.filter((_: File, i: number) => i !== fileIdx);
    }

    if (updatedFace.selectedIndices) {
        updatedFace.selectedIndices = updatedFace.selectedIndices
            .filter((i: number) => i !== photoIndex)
            .map((i: number) => (i > photoIndex ? i - 1 : i));
    }

    if (updatedFace.analyzedIndices) {
        updatedFace.analyzedIndices = updatedFace.analyzedIndices
            .filter((i: number) => i !== photoIndex)
            .map((i: number) => (i > photoIndex ? i - 1 : i));
    }

    if (isAnalyzedPhoto) {
      updatedZone.length = 0;
      updatedZone.length_pricing_m = 0;
      updatedZone.height_pricing_m = 0;
      updatedZone.faces_to_trim = 1;
      updatedZone.category = '1-2m';
      updatedZone.type = '1-2m';
      updatedZone.height = '1-2m';
      updatedZone.state = 'normal';
      updatedZone.analysisLevel = undefined;
      updatedZone.observations = [];
      updatedZone.faceA = {
        ...updatedZone.faceA,
        analyzedIndices: [],
        analysisLevel: undefined,
        observations: []
      };
      updatedZone.faceB = {
        ...updatedZone.faceB,
        analyzedIndices: [],
        analysisLevel: undefined,
        observations: []
      };
    }

    updatedZone[faceKey] = updatedFace;
    zones[idx] = syncLegacyHedgeZone(updatedZone);
    setBookingData({ hedgeZones: zones });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { hedgeZones: zones });
    };

    if (!isAnalyzedPhoto) {
      executeRemove();
      return;
    }

    openConfirm({
      title: 'Eliminar foto analizada',
      message: 'Esta foto participa en el análisis del seto. Si continúas, se eliminará la foto y también el resultado de esta zona.',
      confirmLabel: 'Eliminar foto y resultado',
      cancelLabel: 'Conservar todo',
      tone: 'danger',
      onConfirm: executeRemove
    });
  };

  const analyzeHedgeZone = async (id: string, options?: { silent?: boolean }) => {
      const zones = [...(bookingData.hedgeZones || [])];
      const idx = zones.findIndex(z => z.id === id);
      if (idx === -1) return false;
      const zone = normalizeHedgeZone(zones[idx]);
      
      try {
          setHedgeAnalyzingZoneIds(prev => {
              const next = new Set(prev);
              next.add(id);
              return next;
          });

          const faceAUrls = zone.faceA.photoUrls || [];
          const faceAIndices = zone.faceA.selectedIndices ?? faceAUrls.map((_: string, i: number) => i);
          const finalFaceAUrls = faceAIndices.map((i: number) => faceAUrls[i]).filter((u: string | undefined): u is string => u !== undefined);

          if (finalFaceAUrls.length === 0) {
              const message = 'Selecciona al menos una foto en Cara A para analizar';
              if (options?.silent) toast.error(message);
              else alert(message);
              return false;
          }

          const faceBUrls = zone.faceB.photoUrls || [];
          const faceBIndices = zone.faceB.selectedIndices ?? faceBUrls.map((_: string, i: number) => i);
          const finalFaceBUrls = faceBIndices.map((i: number) => faceBUrls[i]).filter((u: string | undefined): u is string => u !== undefined);
          const finalUrls = [...finalFaceAUrls, ...finalFaceBUrls];
          const hedgeFaces = {
            face_a_urls: finalFaceAUrls,
            face_b_urls: finalFaceBUrls.length > 0 ? finalFaceBUrls : undefined
          };
          
          const debugInputs = {
              description: '',
              photoCount: finalUrls.length,
              selectedServiceIds: bookingData.serviceIds,
              photoUrls: finalUrls,
              hedgeFaces,
              serviceName: 'Corte de setos a máquina',
              model: aiModel
          };

          const res = await estimateWorkWithAI(debugInputs);
          
          // Initialize Debug Info
          const currentDebugInfo: AnalysisDebugInfo = {
              service: 'Corte de setos a máquina',
              model: aiModel,
              promptInputs: debugInputs,
              rawResponse: res.rawResponse,
              parsedResponse: res.tareas,
              finalAnalysisData: {},
              errors: [],
              timestamp: new Date().toISOString()
          };
          setDebugLogs(currentDebugInfo);

          if (res.reasons && res.reasons.some(r => r === 'AI_FAILED_CRITICAL')) {
              throw new Error('La IA no ha podido procesar las imágenes. Por favor, inténtalo de nuevo.');
          }

          if (res.tareas && res.tareas.length > 0) {
              const t = res.tareas[0];
              const resumen = t.resumen_medicion || {};
              const faceDetails = resolveHedgeFaceDetails(t);
              const caraA = faceDetails?.cara_a;
              const caraB = faceDetails?.cara_b;
              const hasFaceB = finalFaceBUrls.length > 0;
              const numericFaces = typeof t.caras === 'number' ? t.caras : undefined;
              const facesToTrimValue = Number(resumen.caras_recortar ?? numericFaces ?? (hasFaceB ? 2 : 1));
              const facesToTrim: 1 | 2 = facesToTrimValue >= 2 ? 2 : 1;
              const baseLength = Number(resumen.base_longitud_m ?? t.longitud_m ?? 0);
              const baseHeight = Number(resumen.base_altura_m ?? t.altura_m ?? 0);
              const pricingLength = Number(resumen.longitud_calculo_m ?? (baseLength * facesToTrim));
              const pricingHeight = Number(resumen.altura_calculo_m ?? (baseHeight * facesToTrim));

              const h = baseHeight;
              const heightBand = resolveHedgeHeightBand(h);
              zone.category = heightBand;
              zone.type = heightBand;
              zone.length = Math.round(baseLength * 100) / 100;
              zone.length_pricing_m = Math.round(pricingLength * 100) / 100;
              zone.height_pricing_m = Math.round(pricingHeight * 100) / 100;
              zone.faces_to_trim = facesToTrim;
              zone.hasBackFaceTrim = hasFaceB;
              zone.height = heightBand;
              zone.state = t.estado_seto || 'normal';
              zone.access = 'normal'; // Legacy
              zone.analysisLevel = t.nivel_analisis;
              const baseObservations = Number(t.nivel_analisis || 1) >= 2 ? (t.observaciones || []) : [];
              zone.observations = h > 7.5
                ? [...baseObservations, 'Altura detectada superior a 7.5m, revisar manualmente por seguridad.']
                : baseObservations;
              zone.faceA = {
                ...zone.faceA,
                analyzedIndices: faceAIndices,
                analysisLevel: caraA?.nivel_analisis ?? zone.analysisLevel,
                observations: caraA?.nivel_analisis >= 2 ? (caraA?.observaciones || []) : [],
                longitud_m: caraA?.longitud_m,
                altura_m: caraA?.altura_m
              };
              zone.faceB = {
                ...zone.faceB,
                analyzedIndices: faceBIndices,
                analysisLevel: caraB?.nivel_analisis,
                observations: caraB?.nivel_analisis >= 2 ? (caraB?.observaciones || []) : [],
                longitud_m: caraB?.longitud_m,
                altura_m: caraB?.altura_m
              };
          } else {
              throw new Error('No se han detectado datos válidos en las imágenes.');
          }

          let mergedZones: any[] = [];
          setBookingData((prev) => {
              const prevZones = [...(prev.hedgeZones || [])];
              const prevIdx = prevZones.findIndex((z: any) => z.id === id);
              if (prevIdx === -1) return {};
              const mergedZone = syncLegacyHedgeZone({
                  ...normalizeHedgeZone(prevZones[prevIdx]),
                  ...zone
              });
              prevZones[prevIdx] = mergedZone;
              mergedZones = prevZones;
              return { hedgeZones: prevZones };
          });
          if (bookingData.serviceIds?.[0] && mergedZones.length > 0) updateServiceData(bookingData.serviceIds[0], { hedgeZones: mergedZones });
          
          // Update Final Debug Data
          currentDebugInfo.finalAnalysisData = { hedgeZones: mergedZones.length > 0 ? mergedZones : zones };
          setDebugLogs({...currentDebugInfo});
          
          saveProgress();
          return true;
      } catch (e: any) {
          console.error(e);
          
          // Capture Error in Debug Logs
          setDebugLogs(prev => prev ? ({...prev, errors: [...prev.errors, e]}) : {
              service: 'Corte de setos a máquina',
              model: aiModel,
              promptInputs: {},
              rawResponse: {},
              parsedResponse: {},
              finalAnalysisData: {},
              errors: [e],
              timestamp: new Date().toISOString()
          });

          const message = e.message || 'Error en el análisis';
          if (options?.silent) toast.error(message);
          else alert(message);
          return false;
      } finally {
          setHedgeAnalyzingZoneIds(prev => {
              const next = new Set(prev);
              next.delete(id);
              return next;
          });
      }
  };

  const analyzeAllPendingHedgeZones = async () => {
      const zones = (bookingData.hedgeZones || []).map((z) => normalizeHedgeZone(z));
      const pendingZones = zones.filter((zone) => !isHedgeZoneAnalyzed(zone));
      const readyZones = pendingZones.filter((zone) => {
          const faceAUrls = zone.faceA.photoUrls || [];
          const faceASelected = zone.faceA.selectedIndices ?? faceAUrls.map((_: string, i: number) => i);
          return faceAUrls.length > 0 && faceASelected.length > 0;
      });

      if (readyZones.length === 0) {
          toast.error('No hay zonas pendientes listas para analizar');
          return;
      }

      if (readyZones.length < pendingZones.length) {
          toast.error('Algunas zonas pendientes no tienen fotos seleccionadas en Cara A');
      }

      await Promise.allSettled(readyZones.map((zone) => analyzeHedgeZone(zone.id, { silent: true })));
  };

  // --- Tree Logic ---
  const addTreeGroup = () => {
    const newGroup = {
        id: `tree-${Date.now()}`,
        type: 'Decorativo',
        height: '3-6m',
        quantity: 1,
        access: 'normal' as const,
        wasteRemoval: true,
        photoUrls: [] as string[],
        files: [] as File[]
    };
    const newGroups = [...(bookingData.treeGroups || []), newGroup];
    setBookingData({ treeGroups: newGroups });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { treeGroups: newGroups });
    saveProgress();
  };

  const removeTreeGroup = (id: string) => {
    openConfirm({
      title: 'Eliminar grupo',
      message: 'Se eliminará este grupo del análisis.',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
      onConfirm: () => {
        const newGroups = (bookingData.treeGroups || []).filter(z => z.id !== id);
        const newHours = calculateTotalTreeHours(newGroups);
        setBookingData({ treeGroups: newGroups, estimatedHours: newHours });
        if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { treeGroups: newGroups, estimatedHours: newHours });
        saveProgress();
      }
    });
  };

  const handleTreeFileSelect = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    const groups = [...(bookingData.treeGroups || [])];
    const idx = groups.findIndex(z => z.id === id);
    if (idx === -1) return;

    const startIdx = (bookingData.uploadedPhotoUrls?.length || 0) + Date.now();
    const urls = await Promise.all(files.map((file, i) => uploadFile(file, startIdx + i)));
    const validUrls = urls.filter((u): u is string => !!u);
    
    if (validUrls.length > 0) {
        groups[idx].photoUrls = [...(groups[idx].photoUrls || []), ...validUrls];
        setBookingData({ treeGroups: groups });
        if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { treeGroups: groups });
    }
  };

  const analyzeTreeGroup = async (id: string) => {
      const groups = [...(bookingData.treeGroups || [])];
      const idx = groups.findIndex(z => z.id === id);
      if (idx === -1) return;
      const group = groups[idx];
      
      try {
          setAnalyzing(true);
          
          // Debug Info Prep
          const debugInputs = {
             description: '',
             photoCount: group.photoUrls?.length || 0,
             selectedServiceIds: bookingData.serviceIds,
             photoUrls: group.photoUrls || [],
             serviceName: 'Poda de árboles',
             model: aiModel
          };

          const res = await estimateWorkWithAI(debugInputs);
          
          // Initialize Debug Info
          const currentDebugInfo: AnalysisDebugInfo = {
              service: 'Poda de árboles',
              model: aiModel,
              promptInputs: debugInputs,
              rawResponse: res.rawResponse,
              parsedResponse: res.tareas || res.arboles,
              finalAnalysisData: {},
              errors: [],
              timestamp: new Date().toISOString()
          };
          setDebugLogs(currentDebugInfo);

          if (res.reasons && res.reasons.some(r => r === 'AI_FAILED_CRITICAL')) {
              throw new Error('La IA no ha podido procesar las imágenes. Por favor, inténtalo de nuevo.');
          }

          if (res.tareas && res.tareas.length > 0) {
              const t = res.tareas[0];
              group.type = t.tipo_arbol || 'Decorativo';
              group.quantity = Number(t.cantidad || 1);
              const h = Number(t.altura_aprox_m || 0);
              group.height = h < 3 ? '<3m' : h <= 6 ? '3-6m' : h <= 9 ? '6-9m' : '>9m';
              group.analysisLevel = t.nivel_analisis;
              group.observations = t.observaciones;
          } else {
             throw new Error('No se han detectado datos válidos en las imágenes.');
          }

          groups[idx] = group;
          setBookingData({ treeGroups: groups });
          if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { treeGroups: groups });
          
          // Update Final Debug Data
          currentDebugInfo.finalAnalysisData = { treeGroups: groups };
          setDebugLogs({...currentDebugInfo});
          
          saveProgress();
      } catch (e: any) {
          console.error(e);
          
          // Capture Error in Debug Logs
          setDebugLogs(prev => prev ? ({...prev, errors: [...prev.errors, e]}) : {
              service: 'Poda de árboles',
              model: aiModel,
              promptInputs: {},
              rawResponse: {},
              parsedResponse: {},
              finalAnalysisData: {},
              errors: [e],
              timestamp: new Date().toISOString()
          });
          
          alert(e.message || 'Error en el análisis');
      } finally {
          setAnalyzing(false);
      }
  };

  // --- Shrub Logic ---
  const addShrubGroup = () => {
    const newGroup = {
        id: `shrub-${Date.now()}`,
        type: 'Arbustos ornamentales',
        size: 'Pequeño (hasta 1m)',
        state: 'normal',
        quantity: 1,
        wasteRemoval: true,
        photoUrls: [] as string[],
        files: [] as File[]
    };
    const newGroups = [...(bookingData.shrubGroups || []), newGroup];
    setBookingData({ shrubGroups: newGroups });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { shrubGroups: newGroups });
    saveProgress();
  };

  const removeShrubGroup = (id: string) => {
    openConfirm({
      title: 'Eliminar grupo',
      message: 'Se eliminará este grupo del análisis.',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      tone: 'danger',
      onConfirm: () => {
        const newGroups = (bookingData.shrubGroups || []).filter(z => z.id !== id);
        setBookingData({ shrubGroups: newGroups });
        if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { shrubGroups: newGroups });
        saveProgress();
      }
    });
  };

  const handleShrubFileSelect = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    const groups = [...(bookingData.shrubGroups || [])];
    const idx = groups.findIndex(z => z.id === id);
    if (idx === -1) return;

    const startIdx = (bookingData.uploadedPhotoUrls?.length || 0) + Date.now();
    const urls = await Promise.all(files.map((file, i) => uploadFile(file, startIdx + i)));
    const validUrls = urls.filter((u): u is string => !!u);
    
    if (validUrls.length > 0) {
        groups[idx].photoUrls = [...(groups[idx].photoUrls || []), ...validUrls];
        setBookingData({ shrubGroups: groups });
        if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { shrubGroups: groups });
    }
  };

  const analyzeShrubGroup = async (id: string) => {
      const groups = [...(bookingData.shrubGroups || [])];
      const idx = groups.findIndex(z => z.id === id);
      if (idx === -1) return;
      const group = groups[idx];
      
      try {
          setAnalyzing(true);
          
          // Debug Info Prep
          const debugInputs = {
             description: '',
             photoCount: group.photoUrls?.length || 0,
             selectedServiceIds: bookingData.serviceIds,
             photoUrls: group.photoUrls || [],
             serviceName: 'Poda de plantas',
             model: aiModel
          };

          const res = await estimateWorkWithAI(debugInputs);
          
          // Initialize Debug Info
          const currentDebugInfo: AnalysisDebugInfo = {
              service: 'Poda de plantas',
              model: aiModel,
              promptInputs: debugInputs,
              rawResponse: res.rawResponse,
              parsedResponse: res.tareas,
              finalAnalysisData: {},
              errors: [],
              timestamp: new Date().toISOString()
          };
          setDebugLogs(currentDebugInfo);

          if (res.reasons && res.reasons.some(r => r === 'AI_FAILED_CRITICAL')) {
              throw new Error('La IA no ha podido procesar las imágenes. Por favor, inténtalo de nuevo.');
          }

          if (res.tareas && res.tareas.length > 0) {
              const t = res.tareas[0];
              // Map legacy/AI types to new configuration
              let mappedType = 'Arbustos ornamentales';
              const aiType = t.tipo_plantacion || '';
              if (aiType.includes('Rosal')) mappedType = 'Rosales y plantas florales';
              else if (aiType.includes('Trepadora')) mappedType = 'Trepadoras';
              else if (aiType.includes('Cactus') || aiType.includes('Suculenta')) mappedType = 'Cactus y suculentas grandes';
              
              let mappedSize = 'Pequeño (hasta 1m)';
              const aiSize = t.tamano_promedio || '';
              if (aiSize.includes('Grande')) mappedSize = 'Grande (>2.5m)';
              else if (aiSize.includes('Mediano')) mappedSize = 'Mediano (1-2.5m)';

              group.type = mappedType;
              group.quantity = Number(t.cantidad_estimada || 1);
              group.size = mappedSize;
              group.state = (t.estado_jardin || 'normal').toLowerCase();
              group.analysisLevel = t.nivel_analisis;
              group.observations = t.observaciones;
          } else {
             throw new Error('No se han detectado datos válidos en las imágenes.');
          }

          groups[idx] = group;
          setBookingData({ shrubGroups: groups });
          if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { shrubGroups: groups });
          
          // Update Final Debug Data
          currentDebugInfo.finalAnalysisData = { shrubGroups: groups };
          setDebugLogs({...currentDebugInfo});
          
          saveProgress();
      } catch (e: any) {
          console.error(e);
          
          // Capture Error in Debug Logs
          setDebugLogs(prev => prev ? ({...prev, errors: [...prev.errors, e]}) : {
              service: 'Poda de plantas',
              model: aiModel,
              promptInputs: {},
              rawResponse: {},
              parsedResponse: {},
              finalAnalysisData: {},
              errors: [e],
              timestamp: new Date().toISOString()
          });
          
          alert(e.message || 'Error en el análisis');
      } finally {
          setAnalyzing(false);
      }
  };

  // --- Clearing Logic ---
  const addClearingZone = () => {
    const newZone = {
        id: `clearing-${Date.now()}`,
        type: 'Maleza ligera',
        area: 0,
        wasteRemoval: true,
        photoUrls: [] as string[],
        files: [] as File[]
    };
    const newZones = [...(bookingData.clearingZones || []), newZone];
    setBookingData({ clearingZones: newZones });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { clearingZones: newZones });
    saveProgress();
  };

  const removeClearingZone = (id: string) => {
    openConfirm({
      title: 'Eliminar zona',
      message: 'Se eliminará esta zona del análisis.',
      confirmLabel: 'Eliminar zona',
      cancelLabel: 'Cancelar',
      tone: 'danger',
      onConfirm: () => {
        const newZones = (bookingData.clearingZones || []).filter(z => z.id !== id);
        setBookingData({ clearingZones: newZones });
        if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { clearingZones: newZones });
        saveProgress();
      }
    });
  };

  const handleClearingFileSelect = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    const zones = [...(bookingData.clearingZones || [])];
    const idx = zones.findIndex(z => z.id === id);
    if (idx === -1) return;

    const startIdx = (bookingData.uploadedPhotoUrls?.length || 0) + Date.now();
    const urls = await Promise.all(files.map((file, i) => uploadFile(file, startIdx + i)));
    const validUrls = urls.filter((u): u is string => !!u);
    
    if (validUrls.length > 0) {
        zones[idx].photoUrls = [...(zones[idx].photoUrls || []), ...validUrls];
        setBookingData({ clearingZones: zones });
        if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { clearingZones: zones });
    }
  };

  const analyzeClearingZone = async (id: string) => {
      const zones = [...(bookingData.clearingZones || [])];
      const idx = zones.findIndex(z => z.id === id);
      if (idx === -1) return;
      const zone = zones[idx];
      
      try {
          setAnalyzing(true);
          
          // Debug Info Prep
          const debugInputs = {
             description: '',
             photoCount: zone.photoUrls?.length || 0,
             selectedServiceIds: bookingData.serviceIds,
             photoUrls: zone.photoUrls || [],
             serviceName: 'Labrar y quitar malas hierbas a mano',
             model: aiModel
          };

          const res = await estimateWorkWithAI(debugInputs);
          
          // Initialize Debug Info
          const currentDebugInfo: AnalysisDebugInfo = {
              service: 'Labrar y quitar malas hierbas a mano',
              model: aiModel,
              promptInputs: debugInputs,
              rawResponse: res.rawResponse,
              parsedResponse: res.tareas,
              finalAnalysisData: {},
              errors: [],
              timestamp: new Date().toISOString()
          };
          setDebugLogs(currentDebugInfo);

          if (res.reasons && res.reasons.some(r => r === 'AI_FAILED_CRITICAL')) {
              throw new Error('La IA no ha podido procesar las imágenes. Por favor, inténtalo de nuevo.');
          }

          if (res.tareas && res.tareas.length > 0) {
              const t = res.tareas[0];
              zone.type = t.densidad_maleza === 'Alta' ? 'Cañaveral/Zarzas' : t.densidad_maleza === 'Baja' ? 'Maleza ligera' : 'Maleza densa';
              zone.area = Number(t.superficie_m2 || 0);
              zone.analysisLevel = t.nivel_analisis;
              zone.observations = t.observaciones;
          } else {
             throw new Error('No se han detectado datos válidos en las imágenes.');
          }

          zones[idx] = zone;
          setBookingData({ clearingZones: zones });
          if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { clearingZones: zones });
          
          // Update Final Debug Data
          currentDebugInfo.finalAnalysisData = { clearingZones: zones };
          setDebugLogs({...currentDebugInfo});
          
          saveProgress();
      } catch (e: any) {
          console.error(e);
          
          // Capture Error in Debug Logs
          setDebugLogs(prev => prev ? ({...prev, errors: [...prev.errors, e]}) : {
              service: 'Labrar y quitar malas hierbas a mano',
              model: aiModel,
              promptInputs: {},
              rawResponse: {},
              parsedResponse: {},
              finalAnalysisData: {},
              errors: [e],
              timestamp: new Date().toISOString()
          });
          
          alert(e.message || 'Error en el análisis');
      } finally {
          setAnalyzing(false);
      }
  };

  // --- Fumigation Logic ---
  const addFumigationZone = () => {
    const newZone = {
        id: `fum-${Date.now()}`,
        type: '',
        area: 0,
        affectedType: undefined as 'Césped' | 'Árboles' | 'Setos' | 'Plantas bajas' | 'Palmeras' | undefined,
        aboveTwoMeters: undefined as boolean | undefined,
        aboveThreeMeters: undefined as boolean | undefined,
        wasteRemoval: true,
        photoUrls: [] as string[],
        files: [] as File[],
        selectedIndices: [] as number[],
        analyzedIndices: [] as number[]
    };
    const newZones = [...(bookingData.fumigationZones || []), newZone];
    setBookingData({ fumigationZones: newZones });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { fumigationZones: newZones });
    saveProgress();
  };

  const removeFumigationZone = (id: string) => {
    openConfirm({
      title: 'Eliminar zona',
      message: 'Se eliminará esta zona del análisis.',
      confirmLabel: 'Eliminar zona',
      cancelLabel: 'Cancelar',
      tone: 'danger',
      onConfirm: () => {
        const newZones = (bookingData.fumigationZones || []).filter(z => z.id !== id);
        setBookingData({ fumigationZones: newZones });
        if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { fumigationZones: newZones });
        saveProgress();
      }
    });
  };

  const handleFumigationFileSelect = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    const zones = [...(bookingData.fumigationZones || [])];
    const idx = zones.findIndex(z => z.id === id);
    if (idx === -1) return;
    if ((zones[idx].photoUrls?.length || 0) + files.length > 5) {
      toast.error('Máximo 5 fotos por zona');
      return;
    }

    const currentLen = zones[idx].photoUrls?.length || 0;
    const tempUrls = files.map(f => URL.createObjectURL(f));
    const newIndices = tempUrls.map((_, i) => currentLen + i);
    zones[idx].photoUrls = [...(zones[idx].photoUrls || []), ...tempUrls];
    zones[idx].selectedIndices = [...(zones[idx].selectedIndices || []), ...newIndices];
    setFumigationUploads(prev => {
      const zoneUploads = new Set(prev[id] || []);
      newIndices.forEach(i => zoneUploads.add(i));
      return { ...prev, [id]: zoneUploads };
    });
    setBookingData({ fumigationZones: zones });

    const startIdx = (bookingData.uploadedPhotoUrls?.length || 0) + Date.now();
    try {
      const uploadResults = await Promise.all(files.map((file, i) => uploadFile(file, startIdx + i)));
      const updatedZones = [...(bookingData.fumigationZones || [])];
      const updatedIdx = updatedZones.findIndex(z => z.id === id);
      if (updatedIdx === -1) return;
      const updatedZone = { ...updatedZones[updatedIdx] };
      const finalUrls = [...(updatedZone.photoUrls || [])];
      uploadResults.forEach((url, i) => {
        const targetIdx = currentLen + i;
        if (url && targetIdx < finalUrls.length) {
          finalUrls[targetIdx] = url;
        }
      });
      updatedZone.photoUrls = finalUrls;
      updatedZones[updatedIdx] = updatedZone;
      setBookingData({ fumigationZones: updatedZones });
      if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { fumigationZones: updatedZones });
    } catch (error) {
      console.error(error);
      toast.error('Error al subir algunas imágenes');
    } finally {
      setFumigationUploads(prev => {
        const next = { ...prev };
        const zoneUploads = new Set(next[id] || []);
        newIndices.forEach(i => zoneUploads.delete(i));
        next[id] = zoneUploads;
        return next;
      });
    }
  };

  const toggleFumigationPhotoSelection = (zoneId: string, photoIndex: number) => {
    const zones = [...(bookingData.fumigationZones || [])];
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx === -1) return;
    const zone = { ...zones[idx] };
    const selected = new Set(zone.selectedIndices || []);
    if (selected.has(photoIndex)) selected.delete(photoIndex);
    else selected.add(photoIndex);
    zone.selectedIndices = Array.from(selected);
    zones[idx] = zone;
    setBookingData({ fumigationZones: zones });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { fumigationZones: zones });
  };

  const removeFumigationPhoto = (zoneId: string, photoIndex: number) => {
    const zones = [...(bookingData.fumigationZones || [])];
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx === -1) return;
    const zone = { ...zones[idx] };
    const photoUrls = [...(zone.photoUrls || [])];
    zone.photoUrls = photoUrls.filter((_, i) => i !== photoIndex);
    zone.selectedIndices = (zone.selectedIndices || []).filter(i => i !== photoIndex).map(i => (i > photoIndex ? i - 1 : i));
    zone.analyzedIndices = (zone.analyzedIndices || []).filter(i => i !== photoIndex).map(i => (i > photoIndex ? i - 1 : i));
    zones[idx] = zone;
    setBookingData({ fumigationZones: zones });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { fumigationZones: zones });
  };

  const isFumigationZoneAnalyzed = (zone: { area?: number; analysisLevel?: number }) => Number(zone.area || 0) > 0 || zone.analysisLevel !== undefined;

  const analyzeFumigationZone = async (id: string, options?: { silent?: boolean }) => {
      const zones = [...(bookingData.fumigationZones || [])];
      const idx = zones.findIndex(z => z.id === id);
      if (idx === -1) return false;
      const zone = zones[idx];
      const allUrls = zone.photoUrls || [];
      const indicesToAnalyze = zone.selectedIndices ?? allUrls.map((_, i) => i);
      const finalUrls = indicesToAnalyze.map(i => allUrls[i]).filter((u): u is string => u !== undefined);
      if (finalUrls.length === 0) {
          if (!options?.silent) alert('Selecciona al menos una foto para analizar.');
          return false;
      }
      if (!zone.affectedType) {
          if (!options?.silent) alert('Selecciona el tipo de vegetación a tratar.');
          return false;
      }
      if (!zone.type) {
          if (!options?.silent) alert('Selecciona el tipo de tratamiento.');
          return false;
      }
      
      setFumigationAnalyzingZoneIds(prev => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });

      try {
          const scaleHints = [
            `tipo_afectado=${zone.affectedType || 'Plantas bajas'}`,
            `tratamiento_solicitado=${zone.type || 'ecologico_preventivo'}`
          ].join('; ');
          const res = await estimateWorkWithAI({
             description: scaleHints,
             photoCount: finalUrls.length,
             selectedServiceIds: bookingData.serviceIds,
             photoUrls: finalUrls,
             serviceName: 'Tratamientos fitosanitarios',
             model: aiModel
          });
          
          if (res.reasons && res.reasons.some(r => r === 'AI_FAILED_CRITICAL')) {
              throw new Error('La IA no ha podido procesar las imágenes. Por favor, inténtalo de nuevo.');
          }

          if (res.tareas && res.tareas.length > 0) {
              const t = res.tareas[0];
              zone.area = Number(t.cantidad_o_superficie || 0);
              zone.analysisLevel = t.nivel_analisis;
              zone.observations = t.observaciones;
              zone.analyzedIndices = indicesToAnalyze;
          } else {
             throw new Error('No se han detectado datos válidos en las imágenes.');
          }

          zones[idx] = zone;
          setBookingData({ fumigationZones: zones });
          if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { fumigationZones: zones });
          saveProgress();
          return true;
      } catch (e: any) {
          console.error(e);
          if (!options?.silent) alert(e.message || 'Error en el análisis');
          return false;
      } finally {
          setFumigationAnalyzingZoneIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
      }
  };

  const analyzeAllFumigationZones = async () => {
    const zones = bookingData.fumigationZones || [];
    const pending = zones.filter(zone => !isFumigationZoneAnalyzed(zone) && !fumigationAnalyzingZoneIds.has(zone.id));
    if (pending.length === 0) return;

    const analyzable = pending.filter(zone => {
      const allUrls = zone.photoUrls || [];
      const selected = zone.selectedIndices ?? allUrls.map((_, i) => i);
      const selectedUrls = selected.map(i => allUrls[i]).filter((u): u is string => u !== undefined);
      return selectedUrls.length > 0 && !!zone.affectedType && !!zone.type;
    });
    if (analyzable.length === 0) {
      toast.error('Completa vegetación, tratamiento y fotos en las zonas pendientes');
      return;
    }

    const results = await Promise.allSettled(analyzable.map(zone => analyzeFumigationZone(zone.id, { silent: true })));
    const successCount = results.filter(result => result.status === 'fulfilled' && result.value).length;
    const failedCount = analyzable.length - successCount;
    const skippedCount = pending.length - analyzable.length;
    if (successCount > 0) toast.success(`Se analizaron ${successCount} zona${successCount === 1 ? '' : 's'} de tratamientos fitosanitarios`);
    if (failedCount > 0) toast.error(`No se pudieron analizar ${failedCount} zona${failedCount === 1 ? '' : 's'}`);
    if (skippedCount > 0) toast.error(`${skippedCount} zona${skippedCount === 1 ? '' : 's'} pendiente${skippedCount === 1 ? '' : 's'} incompleta${skippedCount === 1 ? '' : 's'}`);
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
            {(!debugService.includes('Corte de césped') && !debugService.includes('césped')) && (
                <span className="text-sm text-gray-500">{photos.length}/5</span>
            )}
          </div>
          <p className="text-gray-600 text-sm mb-4">
            {serviceContent.description}
          </p>

             <div className="flex flex-col gap-4">
               {(() => {
                   const isLawnService = debugService.includes('Corte de césped') || debugService.includes('césped');
                   const isHedgeService = debugService.includes('seto') || debugService.includes('Seto');
                   const isTreeService = debugService.includes('árbol') || debugService.includes('arbol');
                   const isShrubService = debugService.includes('poda de plantas') || (debugService.includes('poda') && !debugService.includes('árbol') && !debugService.includes('palmera'));
                   const isClearingService = debugService.includes('limpieza') || debugService.includes('desbroce') || debugService.includes('hierbas') || debugService.includes('maleza');
                  const isFumigationService = debugService.toLowerCase().includes('fumig') || debugService.toLowerCase().includes('fitosanit');
                   
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
                                const isZoneAnalyzing = lawnAnalyzingZoneIds.has(zone.id);
                                
                               if (isZoneAnalyzing) {
                                    return (
                                        <div key={zone.id} className="relative h-64 w-full flex flex-col items-center justify-center bg-gradient-to-b from-gray-50 to-white rounded-xl border border-gray-100 overflow-hidden shadow-inner mb-4">
                                            <div className="absolute inset-0 z-0 opacity-20" 
                                                 style={{
                                                     backgroundImage: 'linear-gradient(#16a34a 1px, transparent 1px), linear-gradient(90deg, #16a34a 1px, transparent 1px)',
                                                     backgroundSize: '20px 20px',
                                                     transform: 'perspective(500px) rotateX(60deg) translateY(-50px) scale(1.5)',
                                                     animation: 'gridMove 4s linear infinite'
                                                 }} 
                                            />
                                            <div className="relative z-10 w-24 h-24 flex items-center justify-center mb-4">
                                                <div className="absolute w-full h-full rounded-full border-2 border-green-500/30 animate-ping" />
                                                <div className="absolute w-3/4 h-3/4 rounded-full border border-green-500/50 animate-ping delay-150" />
                                                <div className="relative z-20 bg-white p-3 rounded-full shadow-lg border border-green-100">
                                                    <Sprout className="w-8 h-8 text-green-600 animate-pulse" />
                                                </div>
                                                <div className="absolute w-full h-full rounded-full border-t-2 border-r-2 border-green-500 animate-spin" />
                                            </div>
                                            <div className="relative z-10 text-center">
                                                <p className="text-sm font-semibold text-gray-800 animate-pulse transition-all duration-300">
                                                    {loadingMessage}
                                                </p>
                                                <p className="text-xs text-gray-400 mt-1">Analizando estructura y vegetación...</p>
                                            </div>
                                            <style>{`
                                                @keyframes gridMove {
                                                    0% { background-position: 0 0; }
                                                    100% { background-position: 0 20px; }
                                                }
                                            `}</style>
                                        </div>
                                    );
                                }

                                return (
                                     <div key={zone.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                         {/* Header */}
                                         <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                                             <div className="flex items-center gap-2">
                                                 <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">
                                                     {idx + 1}
                                                 </div>
                                                 <h3 className="font-semibold text-gray-900">Zona de Césped {idx + 1}</h3>
                                                <span className="text-xs text-gray-500 ml-1 font-normal">({allPhotos.length}/5 fotos)</span>
                                            </div>
                                            <div className="flex gap-2">
                                                 <button 
                                                     onClick={() => removeLawnZone(zone.id)}
                                                     className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors"
                                                     title={isAnalyzed ? "Eliminar resultado de análisis" : "Eliminar zona"}
                                                 >
                                                     <Trash2 className="w-5 h-5" />
                                                 </button>
                                             </div>
                                         </div>

                                         {/* Photos Area for this Zone */}
                                         <div className="mb-4">
                                             <div className="text-xs text-gray-500 mb-2 flex justify-between items-center">
                                                 <span>Fotos de esta zona ({allPhotos.length})</span>
                                                 {isAnalyzed && expandedZoneIds.has(zone.id) && (
                                                     <button 
                                                         onClick={() => {
                                                             const next = new Set(expandedZoneIds);
                                                             next.delete(zone.id);
                                                             setExpandedZoneIds(next);
                                                         }}
                                                         className="text-xs text-green-600 hover:text-green-700 font-medium flex items-center gap-1"
                                                     >
                                                         <ChevronLeft className="w-3 h-3 rotate-90" />
                                                         Ocultar fotos
                                                     </button>
                                                 )}
                                             </div>

                                             {/* Stack View (Only if analyzed and collapsed) */}
                                             {isAnalyzed && !expandedZoneIds.has(zone.id) && allPhotos.length > 0 ? (
                                                 <div 
                                                     onClick={() => {
                                                         const next = new Set(expandedZoneIds);
                                                         next.add(zone.id);
                                                         setExpandedZoneIds(next);
                                                     }}
                                                     className="relative h-32 w-full flex items-center justify-center cursor-pointer group py-4 transition-all duration-500 ease-in-out bg-gray-50/50 rounded-xl border border-dashed border-gray-200 hover:bg-green-50/30 hover:border-green-200"
                                                 >
                                                     {allPhotos.slice(0, 3).map((photo, i) => (
                                                         <div 
                                                             key={i}
                                                             className="absolute transition-all duration-500 ease-in-out shadow-lg rounded-xl overflow-hidden border-2 border-white bg-white"
                                                             style={{
                                                                 width: '90px',
                                                                 height: '90px',
                                                                 transform: `translateX(${i * 12}px) rotate(${i * 3}deg)`,
                                                                 zIndex: 10 - i,
                                                                 opacity: 1 - (i * 0.1)
                                                             }}
                                                         >
                                                             <img 
                                                                 src={typeof photo === 'string' ? photo : URL.createObjectURL(photo)} 
                                                                 className="w-full h-full object-cover" 
                                                                 alt=""
                                                             />
                                                         </div>
                                                     ))}
                                                     <div className="absolute bottom-2 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full text-[10px] font-medium text-gray-700 shadow-sm z-20 translate-y-1 group-hover:-translate-y-1 transition-transform border border-gray-100 flex items-center gap-1.5">
                                                         <Image className="w-3 h-3" />
                                                         Editar fotos
                                                     </div>
                                                 </div>
                                             ) : (
                                                 /* List View */
                                                 <div className="flex flex-row overflow-x-auto gap-3 pb-2 snap-x items-center scrollbar-hide min-h-[110px]">
                                                     {allPhotos.map((p, i) => {
                                                         const isSelected = zone.selectedIndices?.includes(i) ?? true;
                                                         const isAnalyzedPhoto = zone.analyzedIndices?.includes(i);
                                                         
                                                         return (
                                                             <div 
                                                                 key={i} 
                                                                 className={`relative shrink-0 snap-start group cursor-pointer ${isSelected ? 'p-0.5' : ''}`}
                                                                 onClick={() => toggleLawnPhotoSelection(zone.id, i)}
                                                             >
                                                                 <div className={`relative w-24 h-24 rounded-lg overflow-hidden border transition-all duration-300 ${isSelected ? 'border-2 border-green-500 shadow-md' : 'border-gray-200 shadow-sm'} ${isAnalyzedPhoto ? 'opacity-80' : 'opacity-100'}`}>
                                                                    <img 
                                                                        src={typeof p === 'string' ? p : URL.createObjectURL(p)} 
                                                                        alt={`Foto ${i}`}
                                                                        className={`w-full h-full object-cover transition-all duration-700 ease-in-out ${lawnUploads[zone.id]?.has(i) ? 'scale-110 blur-sm brightness-50' : 'scale-100 blur-0 brightness-100'}`}
                                                                    />
                                                                    
                                                                    {/* Uploading Overlay */}
                                                                    {lawnUploads[zone.id]?.has(i) && (
                                                                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-20 transition-opacity duration-300">
                                                                            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                                        </div>
                                                                    )}
                                                                    
                                                                    {/* Analyzed Badge */}
                                                                     {isAnalyzedPhoto && (
                                                                         <div className="absolute bottom-1 left-1 bg-green-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-sm z-10">
                                                                             Analizada
                                                                         </div>
                                                                     )}
                                                                     
                                                                     {/* Selection Checkbox */}
                                                                     <div className={`absolute top-1 left-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all z-20 ${isSelected ? 'bg-green-500 border-green-500 scale-100' : 'bg-black/20 border-white/80 group-hover:bg-black/40 scale-90 group-hover:scale-100'}`}>
                                                                         {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                                                                     </div>
                                                                 </div>
                                                                 
                                                                 {!isZoneAnalyzing && (
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); removePhotoFromZone(zone.id, i); }}
                                                                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 shadow-sm transition-colors z-10"
                                                                    >
                                                                        <Trash2 className="w-3.5 h-3.5" />
                                                                    </button>
                                                                )}
                                                             </div>
                                                         );
                                                     })}
                                                     
                                                     {/* Add Photo Button */}
                                                    {!isZoneAnalyzing && allPhotos.length < 5 && (
                                                        <div className="w-24 h-24 shrink-0 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-green-400 transition-colors cursor-pointer group snap-start">
                                                             <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer">
                                                                 <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center group-hover:bg-green-100 transition-colors mb-1">
                                                                     <Image className="w-4 h-4 text-gray-500 group-hover:text-green-600" />
                                                                 </div>
                                                                 <span className="text-[10px] font-medium text-gray-500 group-hover:text-green-700">Añadir foto</span>
                                                                 <input 
                                                                     type="file" 
                                                                     accept="image/*" 
                                                                     multiple 
                                                                     className="hidden" 
                                                                     onChange={(e) => handleLawnFileSelect(zone.id, e)}
                                                                 />
                                                             </label>
                                                         </div>
                                                     )}
                                                 </div>
                                             )}
                                         </div>

                                         {/* Actions / Results */}
                                         <div className="mt-2">
                                             <button
                                                 onClick={() => analyzeLawnZone(zone.id)}
                                                 disabled={isZoneAnalyzing || (zone.selectedIndices !== undefined && zone.selectedIndices.length === 0) || allPhotos.length === 0}
                                                 className={`w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 mb-3 transition-colors ${
                                                     isZoneAnalyzing || (zone.selectedIndices !== undefined && zone.selectedIndices.length === 0) || allPhotos.length === 0
                                                     ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                                                     : 'bg-green-600 text-white hover:bg-green-700'
                                                 }`}
                                             >
                                                 {isZoneAnalyzing ? (
                                                     <>
                                                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-green-600 border-t-transparent"></div>
                                                        Analizando...
                                                     </>
                                                 ) : (
                                                     isAnalyzed ? 'Reanalizar esta zona' : 'Analizar esta zona'
                                                 )}
                                             </button>
                                             {allPhotos.length === 0 && (
                                                 <p className="text-xs text-center text-amber-600 mt-2">
                                                     Añade al menos una foto para analizar
                                                 </p>
                                             )}
                                         </div>

                                         {isAnalyzed && (
                                             <div className="mt-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300 relative overflow-hidden">
                                                <div className={`absolute top-0 left-0 w-1 h-full ${
                                                    zone.analysisLevel === 3 ? 'bg-red-500' :
                                                    zone.analysisLevel === 2 ? 'bg-amber-500' : 'bg-green-500'
                                                }`}></div>
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                       {zone.analysisLevel === 3 ? (
                                                           <div className="mt-1 text-xs font-medium text-red-600">
                                                               Análisis fallido
                                                           </div>
                                                       ) : (
                                                           <>
                                                               <h4 className="font-semibold text-gray-900 text-sm">
                                                                   {zone.species || 'Césped general'}
                                                               </h4>
                                                               <div className="flex items-center gap-2 text-xs text-gray-600 mt-1">
                                                                   <span>
                                                                       Superficie: <span className="font-medium text-gray-900">{zone.quantity} m²</span>
                                                                   </span>
                                                                   <span className="text-gray-300">|</span>
                                                                   <span>
                                                                       Estado: <span className="font-medium text-gray-900 capitalize">{zone.state}</span>
                                                                   </span>
                                                               </div>
                                                               <div className={`mt-2 text-xs font-medium ${
                                                                   zone.analysisLevel === 1 ? 'text-green-600' : 'text-amber-600'
                                                               }`}>
                                                                   {zone.analysisLevel === 1 ? 'Análisis fiable' : 'Análisis con observaciones'}
                                                               </div>
                                                           </>
                                                       )}
                                                    </div>
                                                    <button 
                                                        onClick={() => removeLawnZone(zone.id)}
                                                        className="text-gray-400 hover:text-red-500 transition-colors"
                                                        title="Eliminar resultado"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
            
                                                {/* Observations */}
                                                {zone.observations && zone.observations.length > 0 && (
                                                   <div className="mt-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 border border-gray-100">
                                                       <div className="font-medium mb-1 text-gray-700">Observaciones:</div>
                                                       <ul className="list-disc list-inside space-y-0.5 ml-1">
                                                           {zone.observations.map((obs, k) => (
                                                               <li key={k}>{obs}</li>
                                                           ))}
                                                       </ul>
                                                   </div>
                                                )}
                                             </div>
                                         )}
                                     </div>
                                 );
                             })}

                             {(() => {
                                 const lawnZones = bookingData.lawnZones || [];
                                 const pendingLawnZones = lawnZones.filter(zone => !isLawnZoneAnalyzed(zone) && !lawnAnalyzingZoneIds.has(zone.id));
                                if (lawnZones.length <= 1 || pendingLawnZones.length <= 1) return null;

                                 return (
                                     <button
                                         onClick={analyzeAllLawnZones}
                                        disabled={isAnyLawnZoneAnalyzing}
                                         className={`w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                                            isAnyLawnZoneAnalyzing
                                             ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                             : 'bg-green-600 text-white hover:bg-green-700'
                                         }`}
                                     >
                                         {isAnyLawnZoneAnalyzing ? (
                                             <>
                                                 <div className="animate-spin rounded-full h-4 w-4 border-2 border-green-600 border-t-transparent"></div>
                                                 Analizando zonas...
                                             </>
                                         ) : `Analizar ${pendingLawnZones.length} zona${pendingLawnZones.length === 1 ? '' : 's'}`}
                                     </button>
                                 );
                             })()}
                             
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

                   if (isHedgeService) {
                     return (
                         <div className="space-y-6">
                             {(!bookingData.hedgeZones || bookingData.hedgeZones.length === 0) && (
                                 <div className="text-center py-8 bg-white rounded-xl border border-gray-200 shadow-sm">
                                     <Scissors className="w-12 h-12 text-green-500 mx-auto mb-3" />
                                     <h3 className="text-lg font-medium text-gray-900 mb-1">Añade tu zona de setos</h3>
                                     <p className="text-gray-500 text-sm mb-4 max-w-xs mx-auto">
                                         Añade una zona por cada tramo de seto diferente.
                                     </p>
                                     <button 
                                         onClick={addHedgeZone}
                                         className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
                                     >
                                         + Añadir primera zona
                                     </button>
                                 </div>
                             )}

                            {(bookingData.hedgeZones || []).map((zone, idx) => {
                                const normalizedZone = normalizeHedgeZone(zone);
                                const isAnalyzed = isHedgeZoneAnalyzed(normalizedZone);
                                const isZoneAnalyzing = hedgeAnalyzingZoneIds.has(zone.id);
                                const faceAUrls = normalizedZone.faceA.photoUrls || [];
                                const faceASelected = normalizedZone.faceA.selectedIndices ?? faceAUrls.map((_: string, i: number) => i);
                                const hasFaceAPhotos = faceAUrls.length > 0;
                                const hasFaceASelected = faceASelected.length > 0;
                                const totalPhotos = (normalizedZone.faceA.photoUrls?.length || 0) + (normalizedZone.faceB.photoUrls?.length || 0);

                                if (isZoneAnalyzing) {
                                    return (
                                        <div key={zone.id} className="relative h-64 w-full flex flex-col items-center justify-center bg-gradient-to-b from-gray-50 to-white rounded-xl border border-gray-100 overflow-hidden shadow-inner mb-4">
                                            <div className="absolute inset-0 z-0 opacity-20" 
                                                 style={{
                                                     backgroundImage: 'linear-gradient(#16a34a 1px, transparent 1px), linear-gradient(90deg, #16a34a 1px, transparent 1px)',
                                                     backgroundSize: '20px 20px',
                                                     transform: 'perspective(500px) rotateX(60deg) translateY(-50px) scale(1.5)',
                                                     animation: 'gridMove 4s linear infinite'
                                                 }} 
                                            />
                                            <div className="relative z-10 w-24 h-24 flex items-center justify-center mb-4">
                                                <div className="absolute w-full h-full rounded-full border-2 border-green-500/30 animate-ping" />
                                                <div className="absolute w-3/4 h-3/4 rounded-full border border-green-500/50 animate-ping delay-150" />
                                                <div className="relative z-20 bg-white p-3 rounded-full shadow-lg border border-green-100">
                                                    <Scissors className="w-8 h-8 text-green-600 animate-pulse" />
                                                </div>
                                                <div className="absolute w-full h-full rounded-full border-t-2 border-r-2 border-green-500 animate-spin" />
                                            </div>
                                            <div className="relative z-10 text-center">
                                                <p className="text-sm font-semibold text-gray-800 animate-pulse transition-all duration-300">Analizando esta zona...</p>
                                                <p className="text-xs text-gray-400 mt-1">Analizando estructura y vegetación...</p>
                                            </div>
                                            <style>{`
                                                @keyframes gridMove {
                                                    0% { background-position: 0 0; }
                                                    100% { background-position: 0 20px; }
                                                }
                                            `}</style>
                                        </div>
                                    );
                                }

                                 return (
                                     <div key={zone.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                         <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                                             <div className="flex items-center gap-2">
                                                 <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">{idx + 1}</div>
                                                <h3 className="font-semibold text-gray-900">Zona de Setos {idx + 1}</h3>
                                                <span className="text-xs text-gray-500 ml-1 font-normal">({totalPhotos}/10 fotos)</span>
                                             </div>
                                             <button onClick={() => removeHedgeZone(zone.id)} className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors">
                                                 <Trash2 className="w-5 h-5" />
                                             </button>
                                         </div>

                                         <div className="mb-4">
                                           <div className="mb-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                                               Sube fotos por cara para evitar confusiones: Cara A es la delantera y es obligatoria para analizar; Cara B es la trasera y opcional.
                                           </div>
                                           {([
                                               { key: 'faceA', title: 'Cara A (delantera)', required: true },
                                               { key: 'faceB', title: 'Cara B (trasera)', required: false },
                                           ] as Array<{ key: HedgeFaceKey; title: string; required: boolean }>).map((faceBlock) => {
                                               const face = normalizedZone[faceBlock.key];
                                               const allFacePhotos = [...(face.photoUrls || []), ...(face.files || [])];
                                               const uploadKey = `${zone.id}-${faceBlock.key}`;

                                               return (
                                                   <div key={faceBlock.key} className="mb-3 rounded-lg border border-gray-200 p-3">
                                                       <div className="mb-2 flex items-center justify-between">
                                                           <div className="flex items-center gap-2">
                                                               <span className="text-sm font-medium text-gray-900">{faceBlock.title}</span>
                                                               {faceBlock.required ? (
                                                                   <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Obligatoria</span>
                                                               ) : (
                                                                   <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">Opcional</span>
                                                               )}
                                                           </div>
                                                           <span className="text-xs text-gray-500">{allFacePhotos.length}/5</span>
                                                       </div>
                                                       <div className="flex flex-row overflow-x-auto gap-3 pb-1 snap-x items-center scrollbar-hide min-h-[110px]">
                                                           {allFacePhotos.map((p, i) => {
                                                               const isSelected = face.selectedIndices?.includes(i) ?? true;
                                                               const isAnalyzedPhoto = face.analyzedIndices?.includes(i);

                                                               return (
                                                                   <div
                                                                       key={i}
                                                                       className={`relative shrink-0 snap-start group cursor-pointer ${isSelected ? 'p-0.5' : ''}`}
                                                                       onClick={() => toggleHedgePhotoSelection(zone.id, faceBlock.key, i)}
                                                                   >
                                                                       <div className={`relative w-24 h-24 rounded-lg overflow-hidden border transition-all duration-300 ${isSelected ? 'border-2 border-green-500 shadow-md' : 'border-gray-200 shadow-sm'} ${isAnalyzedPhoto ? 'opacity-80' : 'opacity-100'}`}>
                                                                           <img
                                                                               src={typeof p === 'string' ? p : URL.createObjectURL(p)}
                                                                               alt={`Foto ${i}`}
                                                                               className={`w-full h-full object-cover transition-all duration-700 ease-in-out ${hedgeUploads[uploadKey]?.has(i) ? 'scale-110 blur-sm brightness-50' : 'scale-100 blur-0 brightness-100'}`}
                                                                           />
                                                                           {hedgeUploads[uploadKey]?.has(i) && (
                                                                               <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-20 transition-opacity duration-300">
                                                                                   <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                                               </div>
                                                                           )}
                                                                           {isAnalyzedPhoto && (
                                                                               <div className="absolute bottom-1 left-1 bg-green-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-sm z-10">
                                                                                   Analizada
                                                                               </div>
                                                                           )}
                                                                           <div className={`absolute top-1 left-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all z-20 ${isSelected ? 'bg-green-500 border-green-500 scale-100' : 'bg-black/20 border-white/80 group-hover:bg-black/40 scale-90 group-hover:scale-100'}`}>
                                                                               {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                                                                           </div>
                                                                       </div>

                                                                       {!isZoneAnalyzing && (
                                                                           <button
                                                                               onClick={(e) => { e.stopPropagation(); removePhotoFromHedgeZone(zone.id, faceBlock.key, i); }}
                                                                               className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 shadow-sm transition-colors z-10"
                                                                           >
                                                                               <Trash2 className="w-3.5 h-3.5" />
                                                                           </button>
                                                                       )}
                                                                   </div>
                                                               );
                                                           })}

                                                           {!isZoneAnalyzing && allFacePhotos.length < 5 && (
                                                               <div className="w-24 h-24 shrink-0 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-green-400 transition-colors cursor-pointer group snap-start">
                                                                   <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer">
                                                                       <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center group-hover:bg-green-100 transition-colors mb-1">
                                                                           <Image className="w-4 h-4 text-gray-500 group-hover:text-green-600" />
                                                                       </div>
                                                                       <span className="text-[10px] font-medium text-gray-500 group-hover:text-green-700">Añadir foto</span>
                                                                       <input
                                                                           type="file"
                                                                           accept="image/*"
                                                                           multiple
                                                                           className="hidden"
                                                                           onChange={(e) => handleHedgeFileSelect(zone.id, faceBlock.key, e)}
                                                                       />
                                                                   </label>
                                                               </div>
                                                           )}
                                                       </div>
                                                       {faceBlock.required && allFacePhotos.length === 0 && (
                                                           <p className="mt-2 text-xs text-amber-600">
                                                               Debes subir al menos una foto de la Cara A para continuar.
                                                           </p>
                                                       )}
                                                   </div>
                                               );
                                           })}
                                         </div>

                                        <div className="mt-2">
                                            <button
                                                onClick={() => analyzeHedgeZone(zone.id)}
                                                disabled={isZoneAnalyzing || !hasFaceAPhotos || !hasFaceASelected}
                                                className={`w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 mb-3 transition-colors ${
                                                    isZoneAnalyzing || !hasFaceAPhotos || !hasFaceASelected
                                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                    : 'bg-green-600 text-white hover:bg-green-700'
                                                }`}
                                            >
                                                {isZoneAnalyzing ? (
                                                    <>
                                                       <div className="animate-spin rounded-full h-4 w-4 border-2 border-green-600 border-t-transparent"></div>
                                                       Analizando...
                                                    </>
                                                ) : (
                                                    isAnalyzed ? 'Reanalizar esta zona' : 'Analizar esta zona'
                                                )}
                                            </button>
                                            {!hasFaceAPhotos && (
                                                <p className="text-xs text-center text-amber-600 mt-2">
                                                    Añade al menos una foto en Cara A para analizar
                                                </p>
                                            )}
                                        </div>

                                        {isAnalyzed && (
                                            <div className="mt-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300 relative overflow-hidden">
                                               <div className={`absolute top-0 left-0 w-1 h-full ${
                                                   zone.analysisLevel === 3 ? 'bg-red-500' :
                                                   zone.analysisLevel === 2 ? 'bg-amber-500' : 'bg-green-500'
                                               }`}></div>
                                               <div className="flex justify-between items-start">
                                                   <div>
                                                       {zone.analysisLevel === 3 ? (
                                                           <div className="mt-1 text-xs font-medium text-red-600">
                                                               Análisis fallido
                                                           </div>
                                                       ) : (
                                                           <>
                                                               <h4 className="font-semibold text-gray-900 text-sm">
                                                                  {zone.type || '1-2m'}
                                                               </h4>
                                                               <div className="flex items-center gap-2 text-xs text-gray-600 mt-1">
                                                                   <span>
                                                                       Longitud: <span className="font-medium text-gray-900">{zone.length} m</span>
                                                                   </span>
                                                                   <span className="text-gray-300">|</span>
                                                                   <span>
                                                                       Altura: <span className="font-medium text-gray-900">{zone.height}</span>
                                                                   </span>
                                                                   <span className="text-gray-300">|</span>
                                                                   <span>
                                                                       Estado: <span className="font-medium text-gray-900 capitalize">{zone.state || 'normal'}</span>
                                                                   </span>
                                                                   <span className="text-gray-300">|</span>
                                                                   <span>
                                                                       Caras analizadas: <span className="font-medium text-gray-900">{Number((zone as any).faces_to_trim ?? (zone.hasBackFaceTrim ? 2 : 1))}</span>
                                                                   </span>
                                                               </div>
                                                               <div className={`mt-2 text-xs font-medium ${
                                                                   zone.analysisLevel === 1 ? 'text-green-600' : 'text-amber-600'
                                                               }`}>
                                                                   {zone.analysisLevel === 1 ? 'Análisis fiable' : 'Análisis con observaciones'}
                                                               </div>
                                                           </>
                                                       )}
                                                   </div>
                                                   <button 
                                                       onClick={() => removeHedgeZone(zone.id)}
                                                       className="absolute top-3 right-3 text-gray-400 hover:text-red-500 transition-colors"
                                                       title="Eliminar resultado"
                                                   >
                                                       <Trash2 className="w-4 h-4" />
                                                   </button>
                                               </div>

                                               {zone.analysisLevel !== undefined && zone.analysisLevel >= 2 && zone.observations && zone.observations.length > 0 && (
                                                  <div className="mt-3 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 border border-gray-100">
                                                      <div className="font-medium mb-1 text-gray-700">Observaciones:</div>
                                                      <ul className="list-disc list-inside space-y-0.5 ml-1">
                                                          {zone.observations.map((obs, k) => (
                                                              <li key={k}>{obs}</li>
                                                          ))}
                                                      </ul>
                                                  </div>
                                               )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {(() => {
                                const zones = (bookingData.hedgeZones || []).map((z) => normalizeHedgeZone(z));
                                const pendingCount = zones.filter((z) => !isHedgeZoneAnalyzed(z)).length;
                                const isBatchAnalyzing = hedgeAnalyzingZoneIds.size > 0;
                                if (zones.length <= 1 || pendingCount <= 1) return null;
                                return (
                                    <button
                                        onClick={analyzeAllPendingHedgeZones}
                                        disabled={isBatchAnalyzing}
                                        className={`w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                                            isBatchAnalyzing
                                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                              : 'bg-green-600 text-white hover:bg-green-700'
                                        }`}
                                    >
                                        {isBatchAnalyzing ? (
                                            <>
                                                <div className="animate-spin rounded-full h-4 w-4 border-2 border-green-600 border-t-transparent"></div>
                                                Analizando zonas...
                                            </>
                                        ) : (`Analizar ${pendingCount} zona${pendingCount === 1 ? '' : 's'}`)}
                                    </button>
                                );
                            })()}

                            {(bookingData.hedgeZones && bookingData.hedgeZones.length > 0) && (
                                <button
                                    onClick={addHedgeZone}
                                    className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:bg-gray-50 hover:border-gray-400 transition-colors flex items-center justify-center gap-2 group"
                                >
                                    <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm group-hover:bg-gray-300 transition-colors">+</span>
                                    Añadir otra zona de setos
                                </button>
                            )}
                         </div>
                     );
                   }

                   if (false && isTreeService) {
                     return (
                         <div className="space-y-6">
                             {((bookingData.treeGroups || []).length === 0) && (
                                 <div className="text-center py-8 bg-white rounded-xl border border-gray-200 shadow-sm">
                                     <Trees className="w-12 h-12 text-green-500 mx-auto mb-3" />
                                     <h3 className="text-lg font-medium text-gray-900 mb-1">Añade tus árboles</h3>
                                     <button onClick={addTreeGroup} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium mt-4">+ Añadir grupo de árboles</button>
                                 </div>
                             )}
                             {(bookingData.treeGroups || []).map((group, idx) => {
                                 const isAnalyzed = group.quantity > 0 || (group.analysisLevel !== undefined);
                                 const allPhotos = [...(group.photoUrls || []), ...(group.files || [])];
                                 return (
                                     <div key={group.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                         <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                                             <h3 className="font-semibold text-gray-900">Grupo de Árboles {idx + 1}</h3>
                                             <button onClick={() => removeTreeGroup(group.id)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-5 h-5" /></button>
                                         </div>
                                         <div className="mb-4 grid grid-cols-3 sm:grid-cols-4 gap-2">
                                             {allPhotos.map((p, i) => (
                                                 <div key={i} className="relative aspect-square"><img src={typeof p === 'string' ? p : URL.createObjectURL(p)} className="w-full h-full object-cover rounded-lg" /></div>
                                             ))}
                                             {!isAnalyzed && <label className="border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer aspect-square text-gray-400 hover:text-green-600"><Camera className="w-6 h-6" /><input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleTreeFileSelect(group.id, e)} /></label>}
                                         </div>
                                         {!isAnalyzed ? (
                                             <button onClick={() => analyzeTreeGroup(group.id)} disabled={analyzing || allPhotos.length === 0} className="w-full py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2">{analyzing ? 'Analizando...' : <><Wand2 className="w-4 h-4" /> Analizar</>}</button>
                                         ) : (
                                             <div className="bg-green-50 p-4 rounded-xl border border-green-100">
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-2 text-green-800 font-medium text-sm"><Sparkles className="w-4 h-4" /> Resultado</div>
                                                    {group.analysisLevel && (
                                                        <div className={`px-2 py-0.5 rounded text-[10px] font-medium border ${group.analysisLevel === 1 ? 'bg-green-100 border-green-200 text-green-800' : group.analysisLevel === 2 ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                                            Calidad {group.analysisLevel === 1 ? 'Alta' : group.analysisLevel === 2 ? 'Media' : 'Baja'}
                                                        </div>
                                                    )}
                                                </div>
                                                {group.observations && group.observations.length > 0 && (
                                                    <div className="mb-3 p-2 rounded-lg text-xs border bg-yellow-50 border-yellow-200 text-yellow-800">
                                                        <ul className="list-disc list-inside space-y-0.5 ml-1">{group.observations.map((obs, k) => <li key={k}>{obs}</li>)}</ul>
                                                    </div>
                                                )}
                                                <div className="grid grid-cols-2 gap-4">
                                                     <div><label className="text-xs text-gray-500 block mb-1">Cantidad</label><input type="number" min="1" value={group.quantity} onChange={(e) => { const n = [...(bookingData.treeGroups||[])]; const g = n.find(x => x.id === group.id); if(g) { g.quantity = Number(e.target.value); setBookingData({treeGroups:n}); } }} className="w-full p-2 border border-gray-300 rounded-lg text-sm" /></div>
                                                     <div><label className="text-xs text-gray-500 block mb-1">Altura</label><select value={group.height} onChange={(e) => { const n = [...(bookingData.treeGroups||[])]; const g = n.find(x => x.id === group.id); if(g) { g.height = e.target.value; setBookingData({treeGroups:n}); } }} className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white"><option value="<3m">&lt;3m</option><option value="3-6m">3-6m</option><option value="6-9m">6-9m</option><option value=">9m">&gt;9m</option></select></div>
                                                     <div><label className="text-xs text-gray-500 block mb-1">Tipo</label><select value={group.type} onChange={(e) => { const n = [...(bookingData.treeGroups||[])]; const g = n.find(x => x.id === group.id); if(g) { g.type = e.target.value; setBookingData({treeGroups:n}); } }} className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white"><option value="Decorativo">Decorativo</option><option value="Frutal">Frutal</option><option value="Conífera">Conífera</option></select></div>
                                                 </div>
                                             </div>
                                         )}
                                     </div>
                                 );
                             })}
                             <button onClick={addTreeGroup} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:bg-gray-50 flex items-center justify-center gap-2"><span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm">+</span> Añadir otro grupo</button>
                         </div>
                     );
                   }

                   if (isShrubService) {
                     return (
                         <div className="space-y-6">
                             {(!bookingData.shrubGroups || bookingData.shrubGroups.length === 0) && (
                                 <div className="text-center py-8 bg-white rounded-xl border border-gray-200 shadow-sm">
                                     <Flower2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
                                     <h3 className="text-lg font-medium text-gray-900 mb-1">Añade tus plantas</h3>
                                     <button onClick={addShrubGroup} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium mt-4">+ Añadir grupo de plantas</button>
                                 </div>
                             )}
                             {(bookingData.shrubGroups || []).map((group, idx) => {
                                 const isAnalyzed = group.quantity > 0 || (group.analysisLevel !== undefined);
                                 const allPhotos = [...(group.photoUrls || []), ...(group.files || [])];
                                 return (
                                     <div key={group.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                         <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                                             <h3 className="font-semibold text-gray-900">Grupo de Plantas {idx + 1}</h3>
                                             <button onClick={() => removeShrubGroup(group.id)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-5 h-5" /></button>
                                         </div>
                                         <div className="mb-4 grid grid-cols-3 sm:grid-cols-4 gap-2">
                                             {allPhotos.map((p, i) => (<div key={i} className="relative aspect-square"><img src={typeof p === 'string' ? p : URL.createObjectURL(p)} className="w-full h-full object-cover rounded-lg" /></div>))}
                                             {!isAnalyzed && <label className="border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer aspect-square text-gray-400 hover:text-green-600"><Camera className="w-6 h-6" /><input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleShrubFileSelect(group.id, e)} /></label>}
                                         </div>
                                         {!isAnalyzed ? (
                                             <button onClick={() => analyzeShrubGroup(group.id)} disabled={analyzing || allPhotos.length === 0} className="w-full py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2">{analyzing ? 'Analizando...' : <><Wand2 className="w-4 h-4" /> Analizar</>}</button>
                                         ) : (
                                             <div className="bg-green-50 p-4 rounded-xl border border-green-100">
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-2 text-green-800 font-medium text-sm"><Sparkles className="w-4 h-4" /> Resultado</div>
                                                    {group.analysisLevel && (
                                                        <div className={`px-2 py-0.5 rounded text-[10px] font-medium border ${group.analysisLevel === 1 ? 'bg-green-100 border-green-200 text-green-800' : group.analysisLevel === 2 ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                                            Calidad {group.analysisLevel === 1 ? 'Alta' : group.analysisLevel === 2 ? 'Media' : 'Baja'}
                                                        </div>
                                                    )}
                                                </div>
                                                {group.observations && group.observations.length > 0 && (
                                                    <div className="mb-3 p-2 rounded-lg text-xs border bg-yellow-50 border-yellow-200 text-yellow-800">
                                                        <ul className="list-disc list-inside space-y-0.5 ml-1">{group.observations.map((obs, k) => <li key={k}>{obs}</li>)}</ul>
                                                    </div>
                                                )}
                                                <div className="grid grid-cols-2 gap-4">
                                                     <div><label className="text-xs text-gray-500 block mb-1">Cantidad</label><input type="number" min="1" value={group.quantity} onChange={(e) => { const n = [...(bookingData.shrubGroups||[])]; const g = n.find(x => x.id === group.id); if(g) { g.quantity = Number(e.target.value); setBookingData({shrubGroups:n}); } }} className="w-full p-2 border border-gray-300 rounded-lg text-sm" /></div>
                                                     <div><label className="text-xs text-gray-500 block mb-1">Tamaño</label><select value={group.size} onChange={(e) => { const n = [...(bookingData.shrubGroups||[])]; const g = n.find(x => x.id === group.id); if(g) { g.size = e.target.value; setBookingData({shrubGroups:n}); } }} className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white"><option value="Pequeño (hasta 1m)">Pequeño (hasta 1m)</option><option value="Mediano (1-2.5m)">Mediano (1-2.5m)</option><option value="Grande (>2.5m)">Grande (&gt;2.5m)</option></select></div>
                                                     <div><label className="text-xs text-gray-500 block mb-1">Tipo</label><select value={group.type} onChange={(e) => { const n = [...(bookingData.shrubGroups||[])]; const g = n.find(x => x.id === group.id); if(g) { g.type = e.target.value; setBookingData({shrubGroups:n}); } }} className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white"><option value="Arbustos ornamentales">Arbustos ornamentales</option><option value="Rosales y plantas florales">Rosales y plantas florales</option><option value="Trepadoras">Trepadoras</option><option value="Cactus y suculentas grandes">Cactus y suculentas grandes</option></select></div>
                                                     <div><label className="text-xs text-gray-500 block mb-1">Estado</label><select value={group.state || 'normal'} onChange={(e) => { const n = [...(bookingData.shrubGroups||[])]; const g = n.find(x => x.id === group.id); if(g) { g.state = e.target.value; setBookingData({shrubGroups:n}); } }} className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white"><option value="normal">Normal</option><option value="descuidado">Descuidado</option><option value="muy descuidado">Muy descuidado</option></select></div>
                                                 </div>
                                             </div>
                                         )}
                                     </div>
                                 );
                             })}
                             <button onClick={addShrubGroup} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:bg-gray-50 flex items-center justify-center gap-2"><span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm">+</span> Añadir otro grupo</button>
                         </div>
                     );
                   }

                   if (isClearingService) {
                     return (
                         <div className="space-y-6">
                             {(!bookingData.clearingZones || bookingData.clearingZones.length === 0) && (
                                 <div className="text-center py-8 bg-white rounded-xl border border-gray-200 shadow-sm">
                                     <Shovel className="w-12 h-12 text-green-500 mx-auto mb-3" />
                                     <h3 className="text-lg font-medium text-gray-900 mb-1">Añade zona a desbrozar</h3>
                                     <button onClick={addClearingZone} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium mt-4">+ Añadir zona</button>
                                 </div>
                             )}
                             {(bookingData.clearingZones || []).map((zone, idx) => {
                                 const isAnalyzed = zone.area > 0 || (zone.analysisLevel !== undefined);
                                 const allPhotos = [...(zone.photoUrls || []), ...(zone.files || [])];
                                 return (
                                     <div key={zone.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                         <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                                             <h3 className="font-semibold text-gray-900">Zona de Desbroce {idx + 1}</h3>
                                             <button onClick={() => removeClearingZone(zone.id)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-5 h-5" /></button>
                                         </div>
                                         <div className="mb-4 grid grid-cols-3 sm:grid-cols-4 gap-2">
                                             {allPhotos.map((p, i) => (<div key={i} className="relative aspect-square"><img src={typeof p === 'string' ? p : URL.createObjectURL(p)} className="w-full h-full object-cover rounded-lg" /></div>))}
                                             {!isAnalyzed && <label className="border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer aspect-square text-gray-400 hover:text-green-600"><Camera className="w-6 h-6" /><input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleClearingFileSelect(zone.id, e)} /></label>}
                                         </div>
                                         {!isAnalyzed ? (
                                             <button onClick={() => analyzeClearingZone(zone.id)} disabled={analyzing || allPhotos.length === 0} className="w-full py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2">{analyzing ? 'Analizando...' : <><Wand2 className="w-4 h-4" /> Analizar</>}</button>
                                         ) : (
                                             <div className="bg-green-50 p-4 rounded-xl border border-green-100">
                                                <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-2 text-green-800 font-medium text-sm"><Sparkles className="w-4 h-4" /> Resultado</div>
                                                    {zone.analysisLevel && (
                                                        <div className={`px-2 py-0.5 rounded text-[10px] font-medium border ${zone.analysisLevel === 1 ? 'bg-green-100 border-green-200 text-green-800' : zone.analysisLevel === 2 ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                                            Calidad {zone.analysisLevel === 1 ? 'Alta' : zone.analysisLevel === 2 ? 'Media' : 'Baja'}
                                                        </div>
                                                    )}
                                                </div>
                                                {zone.observations && zone.observations.length > 0 && (
                                                    <div className="mb-3 p-2 rounded-lg text-xs border bg-yellow-50 border-yellow-200 text-yellow-800">
                                                        <ul className="list-disc list-inside space-y-0.5 ml-1">{zone.observations.map((obs, k) => <li key={k}>{obs}</li>)}</ul>
                                                    </div>
                                                )}
                                                <div className="grid grid-cols-2 gap-4">
                                                     <div><label className="text-xs text-gray-500 block mb-1">Área (m²)</label><input type="number" min="1" value={zone.area} onChange={(e) => { const n = [...(bookingData.clearingZones||[])]; const z = n.find(x => x.id === zone.id); if(z) { z.area = Number(e.target.value); setBookingData({clearingZones:n}); } }} className="w-full p-2 border border-gray-300 rounded-lg text-sm" /></div>
                                                     <div><label className="text-xs text-gray-500 block mb-1">Tipo</label><select value={zone.type} onChange={(e) => { const n = [...(bookingData.clearingZones||[])]; const z = n.find(x => x.id === zone.id); if(z) { z.type = e.target.value; setBookingData({clearingZones:n}); } }} className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white"><option value="Maleza ligera">Maleza ligera</option><option value="Maleza densa">Maleza densa</option><option value="Cañaveral/Zarzas">Cañaveral/Zarzas</option></select></div>
                                                 </div>
                                             </div>
                                         )}
                                     </div>
                                 );
                             })}
                             <button onClick={addClearingZone} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:bg-gray-50 flex items-center justify-center gap-2"><span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm">+</span> Añadir otra zona</button>
                         </div>
                     );
                   }

                   if (isFumigationService) {
                     return (
                         <div className="space-y-6">
                           <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                               <h4 className="text-sm font-semibold text-green-900 mb-2">Guía rápida de tratamientos fitosanitarios</h4>
                               <div className="text-xs text-green-800 space-y-1">
                                   <p>1) En cada zona selecciona solo 2 campos: vegetación y tratamiento.</p>
                                   <p>2) Sube fotos claras para que la IA estime superficie y complejidad.</p>
                                   <p>3) Puedes analizar varias zonas en paralelo.</p>
                               </div>
                           </div>
                             {(!bookingData.fumigationZones || bookingData.fumigationZones.length === 0) && (
                                 <div className="text-center py-8 bg-white rounded-xl border border-gray-200 shadow-sm">
                                     <Bug className="w-12 h-12 text-green-500 mx-auto mb-3" />
                                    <h3 className="text-lg font-medium text-gray-900 mb-1">Añade zona a tratar</h3>
                                     <button onClick={addFumigationZone} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium mt-4">+ Añadir zona</button>
                                 </div>
                             )}
                             {(bookingData.fumigationZones || []).map((zone, idx) => {
                                const isAnalyzed = isFumigationZoneAnalyzed(zone);
                                const allPhotos = zone.photoUrls || [];
                                const isZoneAnalyzing = fumigationAnalyzingZoneIds.has(zone.id);

                                if (isZoneAnalyzing) {
                                  return (
                                    <div key={zone.id} className="relative h-64 w-full flex flex-col items-center justify-center bg-gradient-to-b from-gray-50 to-white rounded-xl border border-gray-100 overflow-hidden shadow-inner">
                                      <div className="absolute inset-0 z-0 opacity-20"
                                           style={{
                                             backgroundImage: 'linear-gradient(#16a34a 1px, transparent 1px), linear-gradient(90deg, #16a34a 1px, transparent 1px)',
                                             backgroundSize: '20px 20px',
                                             transform: 'perspective(500px) rotateX(60deg) translateY(-50px) scale(1.5)',
                                             animation: 'gridMove 4s linear infinite'
                                           }}
                                      />
                                      <div className="relative z-10 w-24 h-24 flex items-center justify-center mb-4">
                                        <div className="absolute w-full h-full rounded-full border-2 border-green-500/30 animate-ping" />
                                        <div className="absolute w-3/4 h-3/4 rounded-full border border-green-500/50 animate-ping delay-150" />
                                        <div className="relative z-20 bg-white p-3 rounded-full shadow-lg border border-green-100">
                                          <Bug className="w-8 h-8 text-green-600 animate-pulse" />
                                        </div>
                                        <div className="absolute w-full h-full rounded-full border-t-2 border-r-2 border-green-500 animate-spin" />
                                      </div>
                                      <div className="relative z-10 text-center">
                                        <p className="text-sm font-semibold text-gray-800 animate-pulse">{loadingMessage}</p>
                                        <p className="text-xs text-gray-400 mt-1">Analizando zona fitosanitaria...</p>
                                      </div>
                                      <style>{`
                                        @keyframes gridMove {
                                          0% { background-position: 0 0; }
                                          100% { background-position: 0 20px; }
                                        }
                                      `}</style>
                                    </div>
                                  );
                                }

                                 return (
                                     <div key={zone.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                         <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                                            <div className="flex items-center gap-2">
                                              <h3 className="font-semibold text-gray-900">Zona {idx + 1}</h3>
                                              <span className="text-xs text-gray-500">({allPhotos.length}/5 fotos)</span>
                                            </div>
                                             <button onClick={() => removeFumigationZone(zone.id)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-5 h-5" /></button>
                                         </div>
                                        <div className="mb-4 grid grid-cols-2 gap-3">
                                          <div>
                                            <label className="text-xs text-gray-500 block mb-1">Vegetación a tratar</label>
                                            <select
                                              value={zone.affectedType || ''}
                                              onChange={(e) => {
                                                const next = [...(bookingData.fumigationZones || [])];
                                                const z = next.find(x => x.id === zone.id);
                                                if (!z) return;
                                                z.affectedType = e.target.value as any;
                                                setBookingData({ fumigationZones: next });
                                                if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { fumigationZones: next });
                                              }}
                                              className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white"
                                            >
                                              <option value="">Seleccionar</option>
                                              <option value="Palmeras">Palmeras</option>
                                              <option value="Árboles">Árboles</option>
                                              <option value="Setos">Setos</option>
                                              <option value="Plantas bajas">Plantas</option>
                                              <option value="Césped">Césped</option>
                                            </select>
                                          </div>
                                          <div>
                                            <label className="text-xs text-gray-500 block mb-1">Tipo de tratamiento</label>
                                            <select
                                              value={zone.type || ''}
                                              onChange={(e) => {
                                                const next = [...(bookingData.fumigationZones || [])];
                                                const z = next.find(x => x.id === zone.id);
                                                if (!z) return;
                                                z.type = e.target.value;
                                                setBookingData({ fumigationZones: next });
                                                if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { fumigationZones: next });
                                              }}
                                              className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white"
                                            >
                                              <option value="">Seleccionar</option>
                                              <option value="insecticida">Insecticida</option>
                                              <option value="fungicida">Fungicida</option>
                                              <option value="herbicida">Herbicida</option>
                                              <option value="ecologico_preventivo">Ecológico preventivo</option>
                                              <option value="endoterapia">Endoterapia</option>
                                            </select>
                                          </div>
                                        </div>

                                        <div className="mb-4">
                                          <div className="text-xs text-gray-500 mb-2">Fotos de esta zona ({allPhotos.length})</div>
                                          <div className="flex flex-row overflow-x-auto gap-3 pb-2 snap-x items-center scrollbar-hide min-h-[110px]">
                                            {allPhotos.map((photo, i) => {
                                              const isSelected = zone.selectedIndices?.includes(i) ?? true;
                                              const isAnalyzedPhoto = zone.analyzedIndices?.includes(i);
                                              return (
                                                <div key={i} className={`relative shrink-0 snap-start group cursor-pointer ${isSelected ? 'p-0.5' : ''}`} onClick={() => toggleFumigationPhotoSelection(zone.id, i)}>
                                                  <div className={`relative w-24 h-24 rounded-lg overflow-hidden border transition-all duration-300 ${isSelected ? 'border-2 border-green-500 shadow-md' : 'border-gray-200 shadow-sm'} ${isAnalyzedPhoto ? 'opacity-80' : 'opacity-100'}`}>
                                                    <img src={photo} alt={`Foto ${i + 1}`} className={`w-full h-full object-cover transition-all duration-700 ease-in-out ${fumigationUploads[zone.id]?.has(i) ? 'scale-110 blur-sm brightness-50' : 'scale-100 blur-0 brightness-100'}`} />
                                                    {fumigationUploads[zone.id]?.has(i) && (
                                                      <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-20 transition-opacity duration-300">
                                                        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                      </div>
                                                    )}
                                                    {isAnalyzedPhoto && (
                                                      <div className="absolute bottom-1 left-1 bg-green-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-sm z-10">Analizada</div>
                                                    )}
                                                    <div className={`absolute top-1 left-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all z-20 ${isSelected ? 'bg-green-500 border-green-500' : 'bg-black/20 border-white/80 group-hover:bg-black/40'}`}>
                                                      {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                                                    </div>
                                                  </div>
                                                  <button onClick={(e) => { e.stopPropagation(); removeFumigationPhoto(zone.id, i); }} className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 shadow-sm transition-colors z-10">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                  </button>
                                                </div>
                                              );
                                            })}
                                            {!isZoneAnalyzing && allPhotos.length < 5 && (
                                              <div className="w-24 h-24 shrink-0 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-green-400 transition-colors cursor-pointer group snap-start">
                                                <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer">
                                                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center group-hover:bg-green-100 transition-colors mb-1">
                                                    <Image className="w-4 h-4 text-gray-500 group-hover:text-green-600" />
                                                  </div>
                                                  <span className="text-[10px] font-medium text-gray-500 group-hover:text-green-700">Añadir foto</span>
                                                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFumigationFileSelect(zone.id, e)} />
                                                </label>
                                              </div>
                                            )}
                                          </div>
                                        </div>

                                        <button
                                          onClick={() => analyzeFumigationZone(zone.id)}
                                          disabled={isZoneAnalyzing || allPhotos.length === 0 || !zone.affectedType || !zone.type || (zone.selectedIndices !== undefined && zone.selectedIndices.length === 0)}
                                          className={`w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                                            isZoneAnalyzing || allPhotos.length === 0 || !zone.affectedType || !zone.type || (zone.selectedIndices !== undefined && zone.selectedIndices.length === 0)
                                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                              : 'bg-green-600 text-white hover:bg-green-700'
                                          }`}
                                        >
                                          <Wand2 className="w-4 h-4" />
                                          {isAnalyzed ? 'Reanalizar esta zona' : 'Analizar esta zona'}
                                        </button>

                                        {isAnalyzed && (
                                          <div className="mt-4 bg-green-50 p-4 rounded-xl border border-green-100">
                                            <div className="flex items-center justify-between mb-3">
                                              <div className="flex items-center gap-2 text-green-800 font-medium text-sm"><Sparkles className="w-4 h-4" /> Resultado</div>
                                              {zone.analysisLevel && (
                                                <div className={`px-2 py-0.5 rounded text-[10px] font-medium border ${zone.analysisLevel === 1 ? 'bg-green-100 border-green-200 text-green-800' : zone.analysisLevel === 2 ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                                  Calidad {zone.analysisLevel === 1 ? 'Alta' : zone.analysisLevel === 2 ? 'Media' : 'Baja'}
                                                </div>
                                              )}
                                            </div>
                                            <div className="grid grid-cols-2 gap-4 text-sm text-gray-700 mb-3">
                                              <div><span className="text-xs text-gray-500 block">Vegetación</span>{zone.affectedType || '-'}</div>
                                              <div><span className="text-xs text-gray-500 block">Tratamiento</span>{zone.type || '-'}</div>
                                              <div><span className="text-xs text-gray-500 block">Superficie IA</span>{zone.area > 0 ? `${zone.area} m²` : 'Sin estimar'}</div>
                                            </div>
                                            {zone.observations && zone.observations.length > 0 && (
                                              <div className="p-2 rounded-lg text-xs border bg-yellow-50 border-yellow-200 text-yellow-800">
                                                <ul className="list-disc list-inside space-y-0.5 ml-1">{zone.observations.map((obs, k) => <li key={k}>{obs}</li>)}</ul>
                                              </div>
                                            )}
                                          </div>
                                        )}
                                     </div>
                                 );
                             })}
                            {(bookingData.fumigationZones || []).some(zone => !isFumigationZoneAnalyzed(zone)) && (
                              <button
                                onClick={analyzeAllFumigationZones}
                                disabled={isAnyFumigationZoneAnalyzing}
                                className={`w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors ${
                                  isAnyFumigationZoneAnalyzing ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-green-100 text-green-800 hover:bg-green-200'
                                }`}
                              >
                                <Sparkles className="w-4 h-4" />
                                Analizar todas las zonas pendientes
                              </button>
                            )}
                             <button onClick={addFumigationZone} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:bg-gray-50 flex items-center justify-center gap-2"><span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm">+</span> Añadir otra zona</button>
                         </div>
                     );
                   }

                   // If lawn service and no photos but we have AI tasks (simulated), we need a placeholder
                   const displayItems = (photos.length === 0 && isLawnService && bookingData.aiTasks && bookingData.aiTasks.length > 0) 
                        ? [null] 
                        : photos;

                   // Stacked View for Analysis Complete
                   if (isAnalysisComplete && !isImageStackExpanded && photos.length > 0) {
                       return (
                           <div 
                               onClick={() => setIsImageStackExpanded(true)}
                               className="relative h-40 w-full flex items-center justify-center cursor-pointer group py-4 transition-all duration-500 ease-in-out"
                           >
                               {photos.slice(0, 3).map((photo, i) => (
                                   <div 
                                       key={i}
                                       className="absolute transition-all duration-500 ease-in-out shadow-lg rounded-xl overflow-hidden border-2 border-white bg-white"
                                       style={{
                                           width: '120px',
                                           height: '120px',
                                           transform: `translateX(${i * 15}px) rotate(${i * 4}deg)`,
                                           zIndex: 10 - i,
                                           opacity: 1 - (i * 0.1)
                                       }}
                                   >
                                       {photo ? (
                                           <img 
                                               src={typeof photo === 'string' ? photo : URL.createObjectURL(photo)} 
                                               className="w-full h-full object-cover" 
                                               alt=""
                                           />
                                       ) : (
                                            <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                                                <Image className="w-8 h-8 text-gray-400" />
                                            </div>
                                       )}
                                   </div>
                               ))}
                               <div className="absolute bottom-0 bg-white/90 backdrop-blur-sm px-4 py-1.5 rounded-full text-xs font-medium text-gray-700 shadow-sm z-20 translate-y-1 group-hover:-translate-y-1 transition-transform border border-gray-100 flex items-center gap-2">
                                   <Image className="w-3.5 h-3.5" />
                                   Editar fotos
                               </div>
                           </div>
                       );
                   }

                   // Analysis Loading Animation (Virtual Garden)
                   if (analyzing) {
                       return (
                           <div className="relative h-48 w-full flex flex-col items-center justify-center bg-gradient-to-b from-gray-50 to-white rounded-xl border border-gray-100 overflow-hidden shadow-inner">
                               
                               {/* Background Grid */}
                               <div className="absolute inset-0 z-0 opacity-20" 
                                    style={{
                                        backgroundImage: 'linear-gradient(#16a34a 1px, transparent 1px), linear-gradient(90deg, #16a34a 1px, transparent 1px)',
                                        backgroundSize: '20px 20px',
                                        transform: 'perspective(500px) rotateX(60deg) translateY(-50px) scale(1.5)',
                                        animation: 'gridMove 4s linear infinite'
                                    }} 
                               />

                               {/* Scanning Radar */}
                               <div className="relative z-10 w-24 h-24 flex items-center justify-center mb-4">
                                   <div className="absolute w-full h-full rounded-full border-2 border-green-500/30 animate-ping" />
                                   <div className="absolute w-3/4 h-3/4 rounded-full border border-green-500/50 animate-ping delay-150" />
                                   
                                   {/* Central Icon */}
                                   <div className="relative z-20 bg-white p-3 rounded-full shadow-lg border border-green-100">
                                       <Sprout className="w-8 h-8 text-green-600 animate-pulse" />
                                   </div>

                                   {/* Spinner Ring */}
                                   <div className="absolute w-full h-full rounded-full border-t-2 border-r-2 border-green-500 animate-spin" />
                               </div>

                               {/* Message */}
                               <div className="relative z-10 text-center">
                                   <p className="text-sm font-semibold text-gray-800 animate-pulse transition-all duration-300">
                                       {loadingMessage}
                                   </p>
                                   <p className="text-xs text-gray-400 mt-1">Analizando estructura y vegetación...</p>
                               </div>

                               <style>{`
                                   @keyframes gridMove {
                                       0% { background-position: 0 0; }
                                       100% { background-position: 0 20px; }
                                   }
                               `}</style>
                           </div>
                       );
                   }

                   return (
                     <div className={`flex flex-col gap-2 transition-all duration-500 ease-in-out ${(!isAnalysisComplete || isImageStackExpanded) ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 hidden'}`}>
                       <div className="flex flex-row overflow-x-auto gap-3 pb-2 snap-x items-center scrollbar-hide">
                       {displayItems.map((photo, index) => {
                         const isUploading = uploadingIndices.has(index);
                         const isAnalyzed = analyzedPhotoIndices.has(index);
                         const isPending = photosToAnalyze.has(index);
                         
                         return (
                           <div 
                                key={index} 
                                className={`relative shrink-0 snap-start group cursor-pointer ${isPending ? 'p-0.5' : ''}`}
                                onClick={(e) => togglePending(index, e)}
                           >
                             {photo ? (
                                 <div className={`relative w-24 h-24 rounded-lg overflow-hidden border transition-all duration-300 ${isPending ? 'border-2 border-green-500 shadow-md' : 'border-gray-200 shadow-sm'} ${isAnalyzed ? 'opacity-80' : 'opacity-100'}`}>
                                     <img 
                                       src={typeof photo === 'string' ? photo : URL.createObjectURL(photo)} 
                                       alt={`Foto ${index + 1}`} 
                                       className={`w-full h-full object-cover transition-all duration-700 ease-in-out ${isUploading ? 'scale-110 blur-sm brightness-50' : 'scale-100 blur-0 brightness-100'}`}
                                     />
                                     {/* Uploading Overlay */}
                                     {isUploading && (
                                         <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-20 transition-opacity duration-300">
                                             <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                         </div>
                                     )}
                                     
                                     {/* Analyzed Overlay */}
                                     {isAnalyzed && !isUploading && (
                                         <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                                             <button 
                                                 onClick={(e) => {
                                                     e.stopPropagation();
                                                     setAnalyzedPhotoIndices(prev => {
                                                         const next = new Set(prev);
                                                         next.delete(index);
                                                         return next;
                                                     });
                                                     setPhotosToAnalyze(prev => {
                                                         const next = new Set(prev);
                                                         next.add(index);
                                                         return next;
                                                     });
                                                 }}
                                                 className="px-2 py-1 bg-white text-gray-800 text-[10px] font-bold rounded-full shadow-lg hover:bg-gray-100 flex items-center gap-1"
                                             >
                                                 Re-analizar
                                             </button>
                                         </div>
                                     )}
                                     
                                     {/* Analyzed Badge (Always Visible) */}
                                     {isAnalyzed && !isUploading && (
                                         <div className="absolute bottom-1 left-1 bg-green-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-sm z-10">
                                             Analizada
                                         </div>
                                     )}
                                     
                                     {/* Selection Checkbox (Circle/Tick) */}
                                    {!isAnalyzed && !isUploading && (
                                        <div
                                            className={`absolute top-1 left-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all z-20 ${
                                                isPending 
                                                ? 'bg-green-500 border-green-500 scale-100' 
                                                : 'bg-black/20 border-white/80 group-hover:bg-black/40 scale-90 group-hover:scale-100'
                                            }`}
                                        >
                                            {isPending && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                                        </div>
                                    )}
                                 </div>
                             ) : (
                                  <div className="w-24 h-24 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center">
                                      <Image className="w-8 h-8 text-gray-400" />
                                  </div>
                              )}
                              
                              {photo && !analyzing && !isUploading && (
                                 <button
                                    onClick={(e) => { e.stopPropagation(); handleRemoveMainPhoto(index); }}
                                    className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1.5 hover:bg-red-600 shadow-sm transition-colors z-10"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                              )}
                           </div>
                         );
                       })}
                       
                       {/* Add Photo Slot */}
                       {!analyzing && photos.length < 5 && (
                         <div 
                           className="w-24 h-24 shrink-0 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-green-400 transition-colors cursor-pointer group snap-start"
                           onClick={() => fileInputRef.current?.click()}
                         >
                            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center group-hover:bg-green-100 transition-colors mb-1">
                                <Image className="w-4 h-4 text-gray-500 group-hover:text-green-600" />
                            </div>
                            <span className="text-[10px] font-medium text-gray-500 group-hover:text-green-700">Añadir foto</span>
                         </div>
                       )}
                     </div>

                     {isAnalysisComplete && (
                         <div className="flex justify-center">
                             <button
                                 onClick={() => setIsImageStackExpanded(false)}
                                 className="text-xs flex items-center gap-1 text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-full transition-colors"
                             >
                                 <ChevronLeft className="w-3 h-3 rotate-90" />
                             </button>
                         </div>
                     )}
                   </div>
                   );
               })()}
               
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

          {/* Analysis Error Banner */}
          {analysisError && (
              <div className={`mx-4 mt-4 p-4 rounded-xl border flex items-start gap-3 animate-in fade-in slide-in-from-top-4 duration-300 shadow-sm ${
                  analysisError.type === 'error' ? 'bg-red-50 border-red-100 text-red-900' : 
                  'bg-amber-50 border-amber-100 text-amber-900'
              }`}>
                  <div className={`p-2 rounded-full shrink-0 ${
                      analysisError.type === 'error' ? 'bg-red-100 text-red-600' : 
                      'bg-amber-100 text-amber-600'
                  }`}>
                      <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm mb-1 leading-tight">{analysisError.title}</h3>
                      {analysisError.message && (
                          <p className="text-xs opacity-90 leading-relaxed">
                              {analysisError.message}
                          </p>
                      )}
                  </div>
                  <button 
                      onClick={() => setAnalysisError(null)}
                      className="p-1.5 -mr-1 -mt-1 hover:bg-black/5 rounded-full transition-colors shrink-0"
                  >
                      <XCircle className="w-5 h-5 opacity-40" />
                  </button>
              </div>
          )}

          {!(debugService.includes('Corte de césped') || debugService.includes('césped') || debugService.includes('seto') || debugService.includes('Seto')) && (
              <div className="flex flex-col gap-4 mb-4 mt-4 px-4 sm:px-0">
                <div className="flex items-center justify-end sm:justify-end justify-center w-full gap-3">
                  <button
                    onClick={() => {
                        if (photosToAnalyze.size > 0) {
                            runAIAnalysis();
                        }
                    }}
                    disabled={analyzing || photosToAnalyze.size === 0}
                    className={`w-full sm:w-auto px-6 py-2.5 rounded-lg shadow-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                        analyzing || photosToAnalyze.size === 0
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none border border-gray-200'
                        : 'bg-green-600 hover:bg-green-700 text-white shadow-green-200'
                    }`}
                  >
                    {analyzing ? (
                        'Analizando...'
                    ) : (
                        <>
                            {photosToAnalyze.size > 0 ? `Analizar (${photosToAnalyze.size})` : 'Analizar'}
                        </>
                    )}
                  </button>
                </div>
                
              </div>
          )}



      {/* --- Shrub Analysis Results (Poda de plantas) --- */}
      {bookingData.shrubGroups && bookingData.shrubGroups.length > 0 && (
        <div className="space-y-4 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Sprout className="w-5 h-5 text-green-600" />
                Plantas detectadas
            </h3>
            <div className="grid grid-cols-1 gap-3">
                {bookingData.shrubGroups.map((group, idx) => (
                    <div key={group.id || idx} className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-1 h-full bg-green-500"></div>
                        <div className="flex justify-between items-start gap-3">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center flex-wrap gap-2 mb-1">
                                    <h4 className="font-semibold text-gray-900 text-sm">{group.type}</h4>
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-100">
                                        x{group.quantity}
                                    </span>
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
                                        {group.size}
                                    </span>
                                </div>
                                {group.observations && group.observations.length > 0 && (
                                    <p className="text-[10px] text-gray-500 italic mt-1 truncate">
                                        {group.observations.join(', ')}
                                    </p>
                                )}
                            </div>
                            
                            <div className="shrink-0">
                                <select 
                                    value={group.state || 'normal'} 
                                    onChange={(e) => { 
                                        const n = [...(bookingData.shrubGroups||[])]; 
                                        const g = n.find(x => x.id === group.id); 
                                        if(g) { 
                                            g.state = e.target.value; 
                                            setBookingData({shrubGroups:n});
                                            if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { shrubGroups: n });
                                        } 
                                    }} 
                                    className="py-1 px-2 border border-gray-300 rounded text-xs bg-white text-gray-700 focus:outline-none focus:border-green-500"
                                >
                                    <option value="normal">Normal</option>
                                    <option value="descuidado">Descuidado</option>
                                    <option value="muy descuidado">Muy descuidado</option>
                                </select>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            <div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-sm flex items-center justify-between">
                <span>Tiempo estimado de trabajo:</span>
                <span className="font-bold text-lg">{bookingData.estimatedHours} h</span>
            </div>
        </div>
      )}

      {/* --- Palm Analysis Results (Poda de palmeras) --- */}
      {bookingData.palmGroups && bookingData.palmGroups.length > 0 && (
        <div className="space-y-4 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Trees className="w-5 h-5 text-green-600" />
                Palmeras detectadas
            </h3>
            <div className="grid grid-cols-1 gap-3">
                {bookingData.palmGroups.map((group, idx) => {
                    // Check if this item is a failure case
                    const isFailed = (group as any).isFailed === true || group.analysisLevel === 3;
                    
                    if (isFailed) {
                        return (
                            <div key={group.id || idx} className="bg-white rounded-lg border border-red-200 p-3 shadow-sm relative overflow-hidden flex items-center gap-3">
                                <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
                                
                                {/* Photo Thumbnail */}
                                {group.photoUrl && (
                                    <div className="shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-gray-100 border border-red-100 opacity-80">
                                        <img 
                                            src={group.photoUrl} 
                                            alt="Análisis fallido" 
                                            className="w-full h-full object-cover grayscale-[0.3]"
                                        />
                                    </div>
                                )}

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <AlertTriangle className="w-4 h-4 text-red-600" />
                                        <h4 className="font-semibold text-sm text-red-700">Análisis fallido</h4>
                                    </div>
                                    <p className="text-xs text-red-600 truncate">
                                        {(group.observations?.[0] || 'Intenta hacer la foto desde otro ángulo.')} <span className="opacity-80">(No afectará al precio)</span>
                                    </p>
                                </div>

                                {/* Close Button (Bidirectional Delete) */}
                                <button 
                                    onClick={() => openConfirm({
                                      title: 'Eliminar resultado',
                                      message: 'Se eliminará este resultado del análisis y la foto se conservará.',
                                      confirmLabel: 'Eliminar resultado',
                                      cancelLabel: 'Cancelar',
                                      tone: 'warning',
                                      onConfirm: () => removePalmAnalysisResult(group.id)
                                    })}
                                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                                    title="Eliminar resultado"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        );
                    }

                    return (
                    <div key={group.id || idx} className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm relative overflow-hidden transition-all">
                        <div className="absolute top-0 left-0 w-1 h-full bg-green-500"></div>
                        
                        <div className="flex flex-row items-center gap-4">
                            {/* Photo (if available) */}
                            {group.photoUrl && (
                                <div className="shrink-0 w-24 h-24 rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
                                    <img 
                                        src={group.photoUrl} 
                                        alt={group.species} 
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                            )}

                            <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                                {/* Line 1: Species + Delete */}
                                <div className="flex items-center justify-between">
                                    <h4 className="font-semibold text-sm text-gray-900">
                                        {group.species}
                                    </h4>
                                    
                                    <button 
                                         onClick={() => openConfirm({
                                           title: 'Eliminar resultado',
                                           message: 'Se eliminará este resultado del análisis y la foto se conservará.',
                                           confirmLabel: 'Eliminar resultado',
                                           cancelLabel: 'Cancelar',
                                           tone: 'warning',
                                           onConfirm: () => removePalmAnalysisResult(group.id)
                                         })}
                                         className="text-gray-400 hover:text-red-500 transition-colors"
                                         title="Eliminar resultado"
                                    >
                                         <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>

                                {/* Line 2: Height + State + Quality */}
                                <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                                    <span>Altura: <span className="font-medium text-gray-900">{group.height}</span></span>
                                    <span className="text-gray-300">|</span>
                                    <span>Estado: <span className="font-medium text-gray-900">{group.state}</span></span>
                                    {group.analysisLevel && (
                                        <>
                                            <span className="text-gray-300">|</span>
                                            <span className={`font-medium ${group.analysisLevel === 1 ? 'text-green-700' : 'text-amber-700'}`}>
                                                {group.analysisLevel === 1 ? 'Análisis fiable' : 'Análisis con posible error'}
                                            </span>
                                        </>
                                    )}
                                </div>
                                
                                {/* Observations (New) */}
                                {group.observations && group.observations.length > 0 && (
                                    <div className="mt-1 text-xs text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-100">
                                        <ul className="list-disc list-inside">
                                            {group.observations.map((obs, i) => <li key={i}>{obs}</li>)}
                                        </ul>
                                    </div>
                                )}

                                {/* Line 3: Quantity (Editable) */}
                                <div className="text-xs text-gray-600 flex items-center gap-2 mt-1">
                                    <span className="font-medium text-gray-700">Cantidad:</span>
                                    <div className="flex items-center border border-gray-300 rounded-md bg-white">
                                        <button 
                                            className="px-2 py-0.5 hover:bg-gray-100 text-gray-600 border-r border-gray-200"
                                            onClick={() => handlePalmQuantityChange(group.id, (group.quantity || 1) - 1)}
                                        >
                                            -
                                        </button>
                                        <input 
                                            type="number" 
                                            min="1" 
                                            value={group.quantity} 
                                            onChange={(e) => handlePalmQuantityChange(group.id, parseInt(e.target.value) || 1)}
                                            className="w-10 text-center text-sm py-0.5 focus:outline-none"
                                        />
                                        <button 
                                            className="px-2 py-0.5 hover:bg-gray-100 text-gray-600 border-l border-gray-200"
                                            onClick={() => handlePalmQuantityChange(group.id, (group.quantity || 1) + 1)}
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )})}
            </div>
            <div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-sm flex items-center justify-between">
                <span>Tiempo estimado de trabajo:</span>
                <span className="font-bold text-lg">{bookingData.estimatedHours} h</span>
            </div>
        </div>
      )}

      {/* --- Tree Analysis Results (Poda de árboles) --- */}
      {bookingData.treeGroups && bookingData.treeGroups.length > 0 && (
        <div className="space-y-4 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Trees className="w-5 h-5 text-green-600" />
                Árboles detectados
            </h3>
            <div className="grid grid-cols-1 gap-3">
                {bookingData.treeGroups.map((group, idx) => {
                    // Check if this item is a failure case
                    const isFailed = (group as any).isFailed === true || group.analysisLevel === 3;
                    
                    if (isFailed) {
                        return (
                            <div key={group.id || idx} className="bg-white rounded-lg border border-red-200 p-3 shadow-sm relative overflow-hidden flex items-center gap-3">
                                <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
                                
                                {/* Photo Thumbnail */}
                                {group.photoUrls && group.photoUrls.length > 0 && (
                                    <div className="shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-gray-100 border border-red-100 opacity-80">
                                        <img 
                                            src={group.photoUrls[0]} 
                                            alt="Análisis fallido" 
                                            className="w-full h-full object-cover grayscale-[0.3]"
                                        />
                                    </div>
                                )}

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <AlertTriangle className="w-4 h-4 text-red-600" />
                                        <h4 className="font-semibold text-sm text-red-700">No se pudo analizar</h4>
                                    </div>
                                    <p className="text-xs text-red-600 truncate">
                                        {(group.observations?.[0] || 'Intenta hacer la foto desde otro ángulo.')} <span className="opacity-80">(No afectará al precio)</span>
                                    </p>
                                </div>

                                {/* Close Button (Bidirectional Delete) */}
                                <button 
                                    onClick={() => openConfirm({
                                      title: 'Eliminar resultado',
                                      message: 'Se eliminará este resultado del análisis y la foto se conservará.',
                                      confirmLabel: 'Eliminar resultado',
                                      cancelLabel: 'Cancelar',
                                      tone: 'warning',
                                      onConfirm: () => removeTreeAnalysisResult(group.id)
                                    })}
                                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                                    title="Eliminar resultado"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        );
                    }

                    return (
                    <div key={group.id || idx} className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm relative overflow-hidden transition-all">
                        <div className="absolute top-0 left-0 w-1 h-full bg-green-500"></div>
                        
                        <div className="flex flex-row items-center gap-4">
                            {/* Photo (if available) */}
                            {group.photoUrls && group.photoUrls.length > 0 && (
                                <div className="shrink-0 w-24 h-24 rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
                                    <img 
                                        src={group.photoUrls[0]} 
                                        alt={group.type} 
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                            )}

                            <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
                                {/* Line 1: Type + Delete */}
                                <div className="flex items-center justify-between">
                                    <h4 className="font-semibold text-sm text-gray-900">
                                        {group.pruningType === 'shaping' ? 'Poda de Formación' : 'Poda Estructural'}
                                    </h4>
                                    
                                    <button 
                                         onClick={() => openConfirm({
                                           title: 'Eliminar resultado',
                                           message: 'Se eliminará este resultado del análisis y la foto se conservará.',
                                           confirmLabel: 'Eliminar resultado',
                                           cancelLabel: 'Cancelar',
                                           tone: 'warning',
                                           onConfirm: () => removeTreeAnalysisResult(group.id)
                                         })}
                                         className="text-gray-400 hover:text-red-500 transition-colors"
                                         title="Eliminar resultado"
                                    >
                                         <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>

                                {/* Line 2: Height + Confidence */}
                                <div className="flex items-center gap-1.5 text-xs text-gray-600">
                                    <span>Altura est: <span className="font-medium text-gray-900">{group.aiHeightRange || group.height}</span></span>
                                    <span className="text-gray-300">|</span>
                                    <span className={`font-medium ${group.analysisLevel === 1 ? 'text-green-700' : 'text-amber-700'}`}>
                                        {group.analysisLevel === 1 ? 'Análisis fiable' : 'Revisión manual'}
                                    </span>
                                </div>

                                {/* Line 3: Access */}
                                <div className="text-xs text-gray-600">
                                    Acceso: <span className="font-medium text-gray-900">{group.access === 'medio' ? 'Escalera' : group.access === 'dificil' ? 'Trepa' : 'Suelo'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )})}
            </div>
            
            <div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-sm flex items-center justify-between mt-3">
                <span>Horas totales estimadas:</span>
                <span className="font-bold text-lg">{bookingData.estimatedHours} h</span>
            </div>
        </div>
      )}

        {bookingData.aiTasks && bookingData.aiTasks.length > 0 && !debugService.includes('césped') && !debugService.includes('Corte de césped') && !debugService.includes('planta') && !debugService.includes('Poda de plantas') && !debugService.includes('árbol') && !debugService.includes('Poda de árboles') && (
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

      {/* --- Waste Removal Switch --- */}
      {/* Show only if there are valid results for Trees or Palms or Shrubs */}
      {((bookingData.treeGroups && bookingData.treeGroups.filter(g => !((g as any).isFailed === true || g.analysisLevel === 3)).length > 0) || 
        (bookingData.palmGroups && bookingData.palmGroups.length > 0) || 
        (bookingData.shrubGroups && bookingData.shrubGroups.length > 0) ||
        ((bookingData.aiQuantity || 0) > 0)) && (
          <div className="flex items-center justify-between p-4 bg-white rounded-xl shadow-sm border border-gray-100 mb-6">
              <span className="text-gray-700 font-medium text-sm">Incluir retirada de restos</span>
              <button 
                  onClick={() => {
                      const newValue = !bookingData.wasteRemoval;
                      setBookingData({ wasteRemoval: newValue });
                      if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { wasteRemoval: newValue });
                      saveProgress();
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

      {/* Gardener Note (Moved to bottom) */}
      <div className="mb-6 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-gray-900">Nota para el jardinero (opcional)</h2>
              <span className="text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded border border-gray-200">
                 No afecta al precio
              </span>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej: Cuidado con el perro, entrar por la puerta lateral..."
            className="w-full p-4 border border-gray-200 rounded-xl resize-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm bg-gray-50"
            rows={3}
          />
      </div>

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
                <option value="Tratamientos fitosanitarios">Tratamientos fitosanitarios</option>
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

            {/* --- Hedges --- */}
            {debugService === 'Corte de setos a máquina' && (
                <>
                    <div>
                        <label className="block text-sm font-medium text-gray-800 mb-1">Altura</label>
                        <select
                            value={debugHedgeHeight}
                            onChange={(e) => setDebugHedgeHeight(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
                        >
                            <option value="">Selecciona...</option>
                            <option value="0-1m">0-1m</option>
                            <option value="1-2m">1-2m</option>
                            <option value="2-4m">2-4m</option>
                            <option value="4-6m">4-6m</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-800 mb-1">Estado</label>
                        <select
                            value={debugHedgeState}
                            onChange={(e) => setDebugHedgeState(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
                        >
                            <option value="normal">Normal</option>
                            <option value="descuidado">Descuidado</option>
                        </select>
                    </div>
                </>
            )}

            {/* --- Trees --- */}
            {debugService === 'Poda de árboles' && (
                <>
                    <div>
                        <label className="block text-sm font-medium text-gray-800 mb-1">Tipo Poda</label>
                        <select
                            value={debugTreePruningType}
                            onChange={(e) => setDebugTreePruningType(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
                        >
                            <option value="structural">Estructural</option>
                            <option value="shaping">Formación</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-800 mb-1">Acceso</label>
                        <select
                            value={debugTreeAccess}
                            onChange={(e) => setDebugTreeAccess(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
                        >
                            <option value="normal">Suelo (Normal)</option>
                            <option value="medio">Escalera (Medio)</option>
                            <option value="dificil">Trepa/Altura (Difícil)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-800 mb-1">Horas Estimadas</label>
                        <input
                            type="number"
                            min="1"
                            step="0.5"
                            value={debugTreeHours}
                            onChange={(e) => setDebugTreeHours(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
                            placeholder="Ej: 3"
                        />
                    </div>
                </>
            )}

            {/* --- Shrubs --- */}
            {debugService === 'Poda de plantas' && (
                <>
                    <div>
                        <label className="block text-sm font-medium text-gray-800 mb-1">Tamaño</label>
                        <select
                            value={debugShrubSize}
                            onChange={(e) => setDebugShrubSize(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
                        >
                            <option value="">Selecciona...</option>
                            <option value="Pequeño (hasta 1m)">Pequeño (hasta 1m)</option>
                            <option value="Mediano (1-2.5m)">Mediano (1-2.5m)</option>
                            <option value="Grande (>2.5m)">Grande (&gt;2.5m)</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-800 mb-1">Tipo</label>
                        <select
                            value={debugShrubType}
                            onChange={(e) => setDebugShrubType(e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
                        >
                            <option value="">Selecciona...</option>
                            <option value="Arbustos ornamentales">Arbustos ornamentales</option>
                            <option value="Rosales y plantas florales">Rosales y plantas florales</option>
                            <option value="Trepadoras">Trepadoras</option>
                            <option value="Cactus y suculentas grandes">Cactus y suculentas grandes</option>
                        </select>
                    </div>
                </>
            )}

            {/* --- Clearing --- */}
            {debugService === 'Labrar y quitar malas hierbas a mano' && (
                <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Densidad/Tipo</label>
                    <select
                        value={debugClearingType}
                        onChange={(e) => setDebugClearingType(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
                    >
                        <option value="">Selecciona...</option>
                        <option value="Maleza ligera">Maleza ligera</option>
                        <option value="Maleza densa">Maleza densa</option>
                        <option value="Cañaveral/Zarzas">Cañaveral/Zarzas</option>
                        <option value="Terreno pedregoso">Terreno pedregoso</option>
                    </select>
                </div>
            )}

            {/* --- Fumigation --- */}
            {((debugService || '').toLowerCase().includes('fitosanit') || (debugService || '').toLowerCase().includes('fumig')) && (
                <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Tipo tratamiento</label>
                    <select
                        value={debugFumigationType}
                        onChange={(e) => setDebugFumigationType(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
                    >
                        <option value="">Selecciona...</option>
                        <option value="Insecticida">Insecticida</option>
                        <option value="Fungicida">Fungicida</option>
                        <option value="Herbicida">Herbicida</option>
                    </select>
                </div>
            )}

            {debugService !== 'Poda de palmeras' && debugService !== 'Corte de setos a máquina' && debugService !== 'Poda de árboles' && (
              <div>
                <label className="block text-sm font-medium text-gray-800 mb-1">Estado del jardín</label>
                <select
                  value={debugState}
                  onChange={(e) => setDebugState(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-lg bg-white text-base sm:text-sm"
                >
                  <option value="normal">Normal</option>
                  <option value="descuidado">Descuidado</option>
                  <option value="muy descuidado">Muy descuidado</option>
                </select>
                {debugService === 'Poda de plantas' && (
                  <p className="text-xs text-gray-500 mt-1">
                     {debugState === 'normal' && 'planta saludable, pocas ramas secas'}
                     {debugState === 'descuidado' && 'follaje denso, algunas ramas secas'}
                     {debugState === 'muy descuidado' && 'crecimiento descontrolado, muchas ramas secas'}
                  </p>
                )}
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

            {debugService !== 'Poda de palmeras' && debugService !== 'Poda de árboles' && (
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

                      const updatePayload = { 
                        palmGroups: groups,
                        estimatedHours: totalHours,
                        palmSpecies: undefined,
                        palmHeight: undefined,
                        palmState: undefined,
                      };

                      setBookingData(updatePayload);
                      if (bookingData.serviceIds?.[0]) {
                           updateServiceData(bookingData.serviceIds[0], updatePayload);
                      }
                  } else {
                      const qty = debugQuantity === '' ? 0 : Number(debugQuantity);
                      const lowerDebugService = debugService.toLowerCase();
                      const unit = lowerDebugService.includes('césped') || lowerDebugService.includes('setos') || lowerDebugService.includes('hierbas') || lowerDebugService.includes('labrar') || lowerDebugService.includes('fumig') || lowerDebugService.includes('fitosanit') ? 'm2' : 'plantas';
                      const effectiveDebugState = debugService.includes('seto') ? debugHedgeState : debugState;
                      const diff = effectiveDebugState.includes('muy') ? 3 : effectiveDebugState.includes('descuidado') ? 2 : 1;
                      const debugHedgeHeightMeters = hedgeHeightBandToMeters(debugHedgeHeight);
                      const debugHedgeCategory = debugHedgeHeight || resolveHedgeHeightBand(debugHedgeHeightMeters);
                      
                      // Create synthetic task for AI simulation
                      const syntheticTask: any = {
                        tipo_servicio: debugService,
                        estado_jardin: effectiveDebugState,
                        nivel_analisis: 1, 
                        observaciones: ['Simulación manual'],
                        // Lawn
                        especie_cesped: debugLawnSpecies,
                        superficie_m2: unit === 'm2' ? qty : null,
                        numero_plantas: unit === 'plantas' ? qty : null,
                        // Hedge
                        longitud_m: debugService.includes('seto') ? qty : null,
                        altura_m: debugService.includes('seto') ? debugHedgeHeightMeters : null,
                        tipo_seto: debugHedgeCategory,
                        dificultad_acceso: debugHedgeAccess === 'dificil' ? 3 : debugHedgeAccess === 'medio' ? 2 : 1,
                        // Tree
                        cantidad: debugService.includes('árbol') ? 1 : null,
                        altura_aprox_m: debugService.includes('árbol') ? 3 : null, // Default
                        tipo_arbol: 'Generico', // Default
                        // Shrub
                        cantidad_estimada: debugService.toLowerCase().includes('planta') && !debugService.toLowerCase().includes('fumig') && !debugService.toLowerCase().includes('fitosanit') ? qty : null,
                        tamano_promedio: debugShrubSize,
                        tipo_plantacion: debugShrubType,
                        // Clearing
                        densidad_maleza: debugClearingType,
                        // Fumigation
                        cantidad_o_superficie: qty,
                        unidad: (debugService.toLowerCase().includes('fumig') || debugService.toLowerCase().includes('fitosanit')) ? 'm2' : null,
                        nivel_plaga: debugFumigationType
                       };
 
                       console.log('[Debug] Simulating AI Result:', { 
                           aiQuantity: qty, 
                           aiTasks: [syntheticTask]
                       });

                       const updatePayload: any = {
                         aiQuantity: qty, 
                         aiUnit: unit, 
                         aiDifficulty: diff, 
                         aiTasks: [syntheticTask],
                         isAnalyzing: false
                       };
                       
                       if (debugService === 'Corte de césped') {
                           updatePayload.lawnZones = [{
                               id: `debug-lawn-${Date.now()}`,
                               species: debugLawnSpecies || 'Césped estándar',
                               state: debugState,
                               quantity: qty,
                               wasteRemoval: true,
                               photoUrls: [],
                               imageIndices: [],
                               analysisLevel: 1,
                               observations: ['Simulación manual']
                           }];
                           updatePayload.estimatedHours = Math.ceil(qty / 150);
                       } else if (debugService === 'Corte de setos a máquina') {
                           updatePayload.hedgeZones = [{
                               id: `debug-hedge-${Date.now()}`,
                               category: debugHedgeCategory,
                               type: debugHedgeCategory,
                               height: debugHedgeHeight || '1-2m',
                               length: qty,
                               length_pricing_m: qty,
                               height_pricing_m: qty * debugHedgeHeightMeters,
                               faces_to_trim: 1,
                               hasBackFaceTrim: false,
                               state: debugHedgeState || 'normal',
                               access: 'normal', // Legacy
                               wasteRemoval: true,
                               photoUrls: [],
                               analysisLevel: 1,
                               observations: ['Simulación manual']
                           }];
                           updatePayload.estimatedHours = Math.ceil(qty / 10);
                       } else if (debugService === 'Poda de árboles') {
                          const h = debugTreeHours ? Number(debugTreeHours) : 3;
                          updatePayload.treeGroups = [{
                              id: `debug-tree-${Date.now()}`,
                              type: 'Generico', // Default for legacy compatibility
                              height: 'N/A',   // Default for legacy compatibility
                              pruningType: debugTreePruningType as 'structural' | 'shaping',
                              quantity: 1,     // Placeholder quantity
                              access: debugTreeAccess as 'normal' | 'medio' | 'dificil',
                              wasteRemoval: true,
                              photoUrls: [],
                              analysisLevel: 1,
                              observations: ['Simulación manual']
                          }];
                          updatePayload.estimatedHours = h;
                       } else if (debugService === 'Poda de plantas') {
                            updatePayload.shrubGroups = [{
                                id: `debug-shrub-${Date.now()}`,
                                type: debugShrubType || 'Arbustos ornamentales',
                                size: debugShrubSize || 'Pequeño (hasta 1m)',
                                state: debugState,
                                quantity: qty,
                                wasteRemoval: true,
                                photoUrls: [],
                                analysisLevel: 1,
                                observations: ['Simulación manual'],
                                imageIndices: []
                            }];
                            updatePayload.estimatedHours = Math.ceil(qty * 0.15);
                       } else if (debugService === 'Labrar y quitar malas hierbas a mano') {
                           updatePayload.clearingZones = [{
                               id: `debug-clear-${Date.now()}`,
                               type: debugClearingType || 'Maleza ligera',
                               area: qty,
                               wasteRemoval: true,
                               photoUrls: [],
                               analysisLevel: 1,
                               observations: ['Simulación manual']
                           }];
                           updatePayload.estimatedHours = Math.ceil(qty / 20);
                       } else if ((debugService || '').toLowerCase().includes('fitosanit') || (debugService || '').toLowerCase().includes('fumig')) {
                           updatePayload.fumigationZones = [{
                               id: `debug-fum-${Date.now()}`,
                               type: debugFumigationType || 'Insecticida',
                               area: qty,
                               wasteRemoval: true,
                               photoUrls: [],
                               analysisLevel: 1,
                               observations: ['Simulación manual']
                           }];
                           updatePayload.estimatedHours = Math.ceil(qty / 100);
                       }

                       setBookingData(updatePayload);
                       if (bookingData.serviceIds?.[0]) {
                           updateServiceData(bookingData.serviceIds[0], updatePayload);
                       }
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

      {/* Retry Modal */}
      {showRetryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 animate-in zoom-in-95 duration-200">
                <div className="flex flex-col items-center text-center mb-6">
                    <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mb-4">
                        <Wand2 className="w-6 h-6 text-amber-600" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mb-2">¿Reintentar análisis?</h3>
                    <p className="text-sm text-gray-600">
                        Sentimos que el análisis no haya salido como esperabas. Puedes reintentarlo para comprobar si el nuevo resultado se ajusta mejor.
                    </p>
                </div>
                <div className="flex flex-col gap-3">
                    <button 
                        onClick={() => {
                            setShowRetryModal(false);
                            runAIAnalysis();
                        }}
                        className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium transition-colors"
                    >
                        Reintentar análisis
                    </button>
                    <button 
                        onClick={() => setShowRetryModal(false)}
                        className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-colors"
                    >
                        Cancelar
                    </button>
                </div>
            </div>
        </div>
      )}

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

      {confirmState.isOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex flex-col items-center text-center">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${confirmState.tone === 'danger' ? 'bg-red-100' : 'bg-yellow-100'}`}>
                <AlertTriangle className={`w-6 h-6 ${confirmState.tone === 'danger' ? 'text-red-600' : 'text-yellow-600'}`} />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">{confirmState.title}</h3>
              <p className="text-gray-500 text-center mb-6 text-sm">{confirmState.message}</p>
              <div className="flex flex-col gap-3 w-full">
                <button
                  onClick={handleConfirmAction}
                  className={`w-full text-white py-3 px-4 rounded-xl font-bold transition-all flex items-center justify-center ${
                    confirmState.tone === 'danger'
                      ? 'bg-red-600 hover:bg-red-700 shadow-lg shadow-red-600/20'
                      : 'bg-amber-600 hover:bg-amber-700 shadow-lg shadow-amber-600/20'
                  }`}
                >
                  {confirmState.confirmLabel}
                </button>
                <button
                  onClick={closeConfirm}
                  className="w-full bg-white text-gray-700 border border-gray-200 py-3 px-4 rounded-xl font-bold hover:bg-gray-50 transition-all"
                >
                  {confirmState.cancelLabel}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Fixed CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] z-50">
        <div className="max-w-md mx-auto">
          <button
            onClick={handleContinue}
            disabled={debugService === 'Poda de palmeras' && (!bookingData.estimatedHours || bookingData.estimatedHours <= 0)}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-2xl font-semibold text-lg shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            {(() => {
                const lowerService = (debugService || '').toLowerCase();
                const isLawn = lowerService.includes('césped') || lowerService.includes('cesped');
                const isHedge = lowerService.includes('seto');
                if (isLawn || isHedge) {
                    const zoneCount = isLawn
                        ? (bookingData.lawnZones || []).filter((zone: any) => zone.analysisLevel === 1 || zone.analysisLevel === 2).length
                        : (bookingData.hedgeZones || []).filter((zone: any) => zone.analysisLevel === 1 || zone.analysisLevel === 2).length;
                    return zoneCount > 0 ? `Continuar con ${zoneCount} zona${zoneCount === 1 ? '' : 's'}` : 'Continuar';
                }
                const validTreeCount = (bookingData.treeGroups || []).filter(g => !((g as any).isFailed === true || g.analysisLevel === 3)).length;
                return validTreeCount > 0 ? `Continuar con ${validTreeCount} árboles` : 'Continuar';
            })()}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* DEBUG TOOL UI                                                      */}
      {/* ------------------------------------------------------------------ */}
      
      {/* Toggle Button */}
      <button 
        onClick={() => setShowDebugPanel(!showDebugPanel)}
        className="fixed bottom-24 right-4 bg-gray-800 text-white p-3 rounded-full shadow-lg opacity-75 hover:opacity-100 transition-opacity z-50 hover:scale-110 transform duration-200 border-2 border-green-500"
        title="Toggle AI Debugger"
      >
        <Bug className="w-6 h-6" />
      </button>

      {/* Debug Panel Overlay */}
      {showDebugPanel && (
        <div className="fixed bottom-0 left-0 right-0 h-[60vh] bg-gray-900 text-gray-200 border-t-4 border-green-500 z-[100] shadow-2xl flex flex-col font-mono text-xs animate-in slide-in-from-bottom-10">
           {/* Header */}
           <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700 shadow-md">
              <div className="flex items-center gap-3">
                  <div className="bg-green-900/50 p-1.5 rounded text-green-400 border border-green-800">
                      <Bug className="w-4 h-4" />
                  </div>
                  <div>
                      <span className="font-bold text-white text-sm block">AI Analysis Debugger</span>
                      <span className="text-gray-500 text-[10px]">
                          {debugLogs?.timestamp ? new Date(debugLogs.timestamp).toLocaleTimeString() : 'Esperando...'}
                      </span>
                  </div>
              </div>
              <div className="flex gap-3">
                  <button 
                     onClick={() => {
                         if (!debugLogs) return;
                         const data = JSON.stringify(debugLogs, null, 2);
                         navigator.clipboard.writeText(data);
                         alert('Datos técnicos copiados al portapapeles');
                     }}
                     disabled={!debugLogs}
                     className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                     <span className="text-lg">📋</span> Copiar Datos
                  </button>
                  <button 
                      onClick={() => setShowDebugPanel(false)} 
                      className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                  >
                      <ChevronLeft className="w-6 h-6 rotate-[270deg]" />
                  </button>
              </div>
           </div>
           
           {/* Main Content Area */}
           <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-gray-900">
               {!debugLogs ? (
                   <div className="h-full flex flex-col items-center justify-center text-gray-600 gap-4">
                       <Wand2 className="w-12 h-12 opacity-20" />
                       <p className="text-sm">Ejecuta un análisis ("Analizar") para capturar datos...</p>
                   </div>
               ) : (
                   <>
                       {/* 0. Summary Cards */}
                       <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                           <div className="p-4 bg-gray-800/50 rounded-xl border border-gray-700">
                               <div className="text-gray-500 mb-1 text-[10px] uppercase tracking-wider">Servicio Detectado</div>
                               <div className="text-green-400 font-bold text-sm truncate">{debugLogs.service || 'N/A'}</div>
                           </div>
                           <div className="p-4 bg-gray-800/50 rounded-xl border border-gray-700">
                               <div className="text-gray-500 mb-1 text-[10px] uppercase tracking-wider">Modelo IA</div>
                               <div className="text-blue-400 font-bold text-sm">{debugLogs.model}</div>
                           </div>
                           <div className="p-4 bg-gray-800/50 rounded-xl border border-gray-700">
                               <div className="text-gray-500 mb-1 text-[10px] uppercase tracking-wider">Estado</div>
                               <div className={`font-bold text-sm ${debugLogs.errors?.length ? 'text-red-400' : 'text-green-400'}`}>
                                   {debugLogs.errors?.length ? 'Fallido' : 'Exitoso'}
                               </div>
                           </div>
                       </div>

                       {/* 1. Errors Section (High Priority) */}
                       {debugLogs.errors && debugLogs.errors.length > 0 && (
                           <div className="p-4 bg-red-900/10 border border-red-500/30 rounded-xl">
                               <div className="text-red-400 font-bold mb-3 flex items-center gap-2">
                                   <AlertTriangle className="w-4 h-4" />
                                   Errores Detectados
                               </div>
                               {debugLogs.errors.map((e, i) => (
                                   <pre key={i} className="text-red-300 text-[10px] whitespace-pre-wrap bg-red-950/30 p-2 rounded border border-red-900/50">
                                       {typeof e === 'string' ? e : JSON.stringify(e, null, 2)}
                                   </pre>
                               ))}
                           </div>
                       )}

                       <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                           {/* 2. Raw Response */}
                           <div className="space-y-2">
                               <div className="flex items-center gap-2 text-yellow-500 font-bold text-sm border-b border-gray-800 pb-2">
                                   <span>📥 Respuesta Raw (JSON)</span>
                               </div>
                               <div className="relative group">
                                   <pre className="bg-gray-800 p-4 rounded-xl overflow-x-auto text-yellow-100/80 h-64 text-[10px] leading-relaxed border border-gray-700">
                                       {JSON.stringify(debugLogs.rawResponse, null, 2)}
                                   </pre>
                               </div>
                           </div>

                           {/* 3. Parsed Data */}
                           <div className="space-y-2">
                               <div className="flex items-center gap-2 text-blue-400 font-bold text-sm border-b border-gray-800 pb-2">
                                   <span>🔄 Datos Procesados</span>
                               </div>
                               <div className="relative group">
                                   <pre className="bg-gray-800 p-4 rounded-xl overflow-x-auto text-blue-100/80 h-64 text-[10px] leading-relaxed border border-gray-700">
                                       {JSON.stringify(debugLogs.parsedResponse, null, 2)}
                                   </pre>
                               </div>
                           </div>
                       </div>

                       {/* 4. Inputs & Final State */}
                       <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                           <div className="space-y-2">
                               <div className="flex items-center gap-2 text-gray-400 font-bold text-sm border-b border-gray-800 pb-2">
                                   <span>📤 Inputs Enviados</span>
                               </div>
                               <pre className="bg-gray-800 p-4 rounded-xl overflow-x-auto text-gray-300 h-48 text-[10px] leading-relaxed border border-gray-700">
                                   {JSON.stringify(debugLogs.promptInputs, null, 2)}
                               </pre>
                           </div>

                           <div className="space-y-2">
                               <div className="flex items-center gap-2 text-purple-400 font-bold text-sm border-b border-gray-800 pb-2">
                                   <span>🚀 Estado Final (App)</span>
                               </div>
                               <pre className="bg-gray-800 p-4 rounded-xl overflow-x-auto text-purple-200 h-48 text-[10px] leading-relaxed border border-gray-700">
                                   {JSON.stringify(debugLogs.finalAnalysisData, null, 2)}
                               </pre>
                           </div>
                       </div>
                   </>
               )}
           </div>
        </div>
      )}

    </div>
  );
};

export default DetailsPage;
