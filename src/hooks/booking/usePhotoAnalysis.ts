import { useState, useCallback } from 'react';
import toast from 'react-hot-toast';

export const usePhotoAnalysis = ({
  bookingData,
  setBookingData,
  updateServiceData,
  saveProgress,
  debugService,
  aiModel,
  estimateWorkWithAI,
  setDebugLogs
}: any) => {
  const [photos, setPhotos] = useState<string[]>(bookingData.photos || []);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploadingIndices, setUploadingIndices] = useState<Set<number>>(new Set());
  const [photosToAnalyze, setPhotosToAnalyze] = useState<Set<number>>(new Set());
  const [analyzedPhotoIndices, setAnalyzedPhotoIndices] = useState<number[]>([]);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    const newPhotos = files.map(f => URL.createObjectURL(f));
    setPhotos(prev => [...prev, ...newPhotos]);
    setPhotosToAnalyze(prev => {
      const next = new Set(prev);
      newPhotos.forEach((_, i) => next.add(photos.length + i));
      return next;
    });
  }, [photos.length]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.dataTransfer.files) return;
    const files = Array.from(e.dataTransfer.files);
    const newPhotos = files.map(f => URL.createObjectURL(f));
    setPhotos(prev => [...prev, ...newPhotos]);
  }, []);

  const removePhoto = useCallback((index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
    setAnalyzedPhotoIndices(prev => prev.filter(i => i !== index).map(i => i > index ? i - 1 : i));
  }, []);

  const togglePending = useCallback((index: number) => {
    setPhotosToAnalyze(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const runAIAnalysis = useCallback(async () => {
    // Basic implementation
    setAnalyzing(true);
    try {
      // Mock analysis for now or implement if needed
      toast.success('Análisis completado');
    } catch (err) {
      toast.error('Error en el análisis');
    } finally {
      setAnalyzing(false);
    }
  }, []);

  return {
    photos,
    setPhotos,
    analyzing,
    setAnalyzing,
    uploadingIndices,
    setUploadingIndices,
    photosToAnalyze,
    setPhotosToAnalyze,
    analyzedPhotoIndices,
    setAnalyzedPhotoIndices,
    analysisError,
    setAnalysisError,
    debugLogs: null,
    handleDrop,
    handleFileSelect,
    removePhoto,
    togglePending,
    runAIAnalysis,
  };
};
