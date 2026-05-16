import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  clearBookingResumeStorage,
  readAnyBookingResume,
  sanitizeBookingPayload,
  writeBookingResume,
} from '../utils/bookingResumeStorage';
import { useAuth } from './AuthContext';

export interface BookingData {
  address: string;
  serviceIds: string[];
  restrictedGardenerId?: string;
  photos: File[];
  description: string;
  preferredDate: string;
  timeSlot: string;
  providerId: string;
  estimatedHours: number;
  totalPrice: number;
  priceBreakdown?: Array<{
    desc: string;
    price: number;
  }>;
  quoteId?: string;
  quoteSignature?: string;
  quoteExpiresAt?: string;
  quotePricingVersion?: string;
  quoteProviderConfigVersion?: string;
  aiQuantity?: number;
  aiUnit?: string;
  aiDifficulty?: number;
  aiTasks?: Array<{ 
    tipo_servicio: string; 
    estado_jardin?: string; 
    superficie_m2?: number|null; 
    numero_plantas?: number|null; 
    tamaño_plantas?: string|null;
    nivel_analisis?: number;
    observaciones?: string[] | null;
  }>;
  lawnSpecies?: string;
  palmSpecies?: string;
  palmHeight?: string;
  palmState?: string;
  palmWasteRemoval?: boolean; // Legacy field, kept for compatibility but now superseded by global wasteRemoval
  wasteRemoval?: boolean; // New global field for all services
  palmGroups?: Array<{
    id: string;
    species: string;
    height: string;
    quantity: number;
    state?: string;
    wasteRemoval?: boolean;
    photoUrl?: string;
    imageIndex?: number;
    analysisLevel?: number;
    observations?: string[];
    hasPhytosanitary?: boolean;
    hasTrunkPeeling?: boolean;
    lowestRangeThreshold?: string;
    highestOpenRangeThreshold?: string;
    isTerminalOpenRange?: boolean;
    allowsPriceChange?: boolean;
    // Legacy compatibility
    needsPhytosanitary?: boolean;
    needsTrunkFinish?: boolean;
    hasAccessDifficulty?: boolean;
  }>;
  uploadedPhotoUrls?: string[];
  isAnalyzing?: boolean;
  lawnZones?: Array<{
    id: string;
    species: string;
    state: string; // "normal" | "descuidado" | "muy descuidado"
    quantity: number; // m2
    wasteRemoval: boolean;
    photoUrls: string[]; // Multiple photos per zone
    imageIndices: number[]; // Indices in the main photos array
    files?: File[]; // Local files pending upload
    analysisLevel?: number;
    observations?: string[];
    isFailed?: boolean;
    selectedIndices?: number[];
    analyzedIndices?: number[];
  }>;
  // New Service-Specific Fields
  hedgeFaces?: {
    face_a_urls: string[];
    face_b_urls?: string[];
  };
  hedgeZones?: Array<{
    faceA?: {
      photoUrls?: string[];
      files?: File[];
      selectedIndices?: number[];
      analyzedIndices?: number[];
      analysisLevel?: number;
      observations?: string[];
      longitud_m?: number;
      altura_m?: number;
    };
    faceB?: {
      photoUrls?: string[];
      files?: File[];
      selectedIndices?: number[];
      analyzedIndices?: number[];
      analysisLevel?: number;
      observations?: string[];
      longitud_m?: number;
      altura_m?: number;
    };
    hasBackFaceTrim?: boolean;
    faces_to_trim?: 1 | 2;
    length_pricing_m?: number;
    height_pricing_m?: number;
    id: string;
    category?: string;
    type: string;
    height: string;
    length: number; // meters
    access: 'normal' | 'medio' | 'dificil';
    state?: string;
    wasteRemoval: boolean;
    photoUrls?: string[];
    files?: File[];
    analysisLevel?: number;
    observations?: string[];
    isFailed?: boolean;
    imageIndices?: number[];
    selectedIndices?: number[];
    analyzedIndices?: number[];
  }>;
  treeGroups?: Array<{
    id: string;
    pruningType: 'structural' | 'shaping';
    photoUrls: string[];
    aiSizeBand?: 'small' | 'medium' | 'large' | 'over_9';
    aiHeightMeters?: number;
    difficultyHigh?: boolean;
    analysisLevel?: number;
    observations?: string[];
    isFailed?: boolean;
    estimatedHours?: number;
  }>;
  shrubGroups?: Array<{
    id: string;
    area: number; // m2
    size: 'pequeñas' | 'medianas' | 'grandes';
    wasteRemoval: boolean;
    photoUrls?: string[];
    files?: File[];
    analysisLevel?: number;
    observations?: string[];
    isFailed?: boolean;
    imageIndices?: number[]; // Indices in the main photos array
    selectedIndices?: number[];
    analyzedIndices?: number[];
  }>;
  phytosanitaryZones?: Array<{
    id: string;
    type: string;
    area: number; // m2
    scope?: string[] | string;
    requestedTreatment?: 'insecticida' | 'fungicida' | 'combo';
    wantsEco?: boolean;
    affectedType?: 'Césped' | 'Árboles' | 'Setos' | 'Plantas bajas' | 'Palmeras';
    aboveTwoMeters?: boolean;
    aboveThreeMeters?: boolean;
    analysisMetrics?: {
      cesped_m2: number;
      seto_bajo_medio_ml: number;
      seto_alto_ml: number;
      palmeras_ducha_peq_ud: number;
      palmeras_ducha_med_ud: number;
      palmeras_ducha_alta_ud: number;
      palmeras_cirugia_ud: number;
      palmeras_endoterapia_troncos_ud: number;
      arboles_peq_ud: number;
      arboles_med_ud: number;
      arboles_gran_ud: number;
      observaciones_ia: string[];
    };
    wasteRemoval: boolean;
    photoUrls?: string[];
    files?: File[];
    selectedIndices?: number[];
    analyzedIndices?: number[];
    analysisLevel?: number;
    observations?: string[];
    isFailed?: boolean;
  }>;
  weedingZones?: Array<{
    id: string;
    area: number; // m2
    state: string; // "normal" | "dificultad_media" | "dificultad_alta"
    applyHerbicide: boolean;
    wasteRemoval: boolean;
    photoUrls?: string[];
    files?: File[];
    selectedIndices?: number[];
    analyzedIndices?: number[];
    analysisLevel?: number;
    observations?: string[];
    isFailed?: boolean;
  }>;
  // Per-service isolated state storage
  servicesData?: Record<string, {
    photos?: File[];
    uploadedPhotoUrls?: string[];
    description?: string;
    aiTasks?: any[];
    estimatedHours?: number;
    // Specific fields per service type
    lawnZones?: any[];
    palmGroups?: any[];
    hedgeZones?: any[];
    treeGroups?: any[];
    shrubGroups?: any[];
    phytosanitaryZones?: any[];
    weedingZones?: any[];
    lawnSpecies?: string;
    palmSpecies?: string;
    palmHeight?: string;
    palmState?: string;
    aiQuantity?: number;
    aiDifficulty?: number;
    aiUnit?: string;
    wasteRemoval?: boolean; // Can be per-service override if needed
  }>;
}

interface BookingContextType {
  bookingData: BookingData;
  currentStep: number;
  isLoading: boolean; // Estado de carga para evitar renderizar el paso 0 prematuramente
  resumeWarning: { discardedPaths: string[] } | null;
  setBookingData: (data: Partial<BookingData> | ((prev: BookingData) => Partial<BookingData>)) => void;
  setCurrentStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  resetBooking: () => void;
  clearResumeWarning: () => void;
  saveProgress: () => void;
  loadProgress: () => void;
  updateServiceData: (serviceId: string, data: any) => void;
  switchToService: (serviceId: string) => void;
}

const initialBookingData: BookingData = {
  address: '',
  serviceIds: [],
  photos: [],
  description: '',
  preferredDate: '',
  timeSlot: '',
  providerId: '',
  estimatedHours: 0,
  totalPrice: 0,
  priceBreakdown: [],
  quoteId: '',
  quoteSignature: '',
  quoteExpiresAt: '',
  quotePricingVersion: '',
  quoteProviderConfigVersion: '',
  aiQuantity: 0,
  aiUnit: '',
  aiDifficulty: 1,
  aiTasks: [],
  lawnSpecies: '',
  palmSpecies: '',
  palmGroups: [],
  lawnZones: [],
  wasteRemoval: true, // Default to true
  uploadedPhotoUrls: [],
  isAnalyzing: false,
  servicesData: {},
};

const BookingContext = createContext<BookingContextType | undefined>(undefined);

export const useBooking = () => {
  const context = useContext(BookingContext);
  if (!context) {
    throw new Error('useBooking debe usarse dentro de BookingProvider');
  }
  return context;
};

export const BookingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const [bookingData, setBookingDataState] = useState<BookingData>(initialBookingData);
  const [currentStep, setCurrentStepState] = useState(0);
  const [isLoading, setIsLoading] = useState(true); // Inicialmente cargando
  const [resumeWarning, setResumeWarning] = useState<{ discardedPaths: string[] } | null>(null);

  const setBookingData = (data: Partial<BookingData> | ((prev: BookingData) => Partial<BookingData>)) => {
    setBookingDataState(prev => {
        const updates = typeof data === 'function' ? data(prev) : data;
        const newData = { ...prev, ...updates };
        return newData;
    });
  };

  const updateServiceData = (serviceId: string, data: any) => {
      setBookingDataState(prev => ({
          ...prev,
          servicesData: {
              ...prev.servicesData,
              [serviceId]: {
                  ...(prev.servicesData?.[serviceId] || {}),
                  ...data
              }
          }
      }));
  };
  
  // Helper to switch context to a specific service
  const switchToService = (serviceId: string) => {
      setBookingDataState(prev => {
          const saved = prev.servicesData?.[serviceId] || {};
          // Merge saved data into active fields, resetting others to defaults if not present
          return {
              ...prev,
              // Reset common fields to avoid contamination, then overwrite with saved
              photos: [],
              uploadedPhotoUrls: [],
              description: '',
              aiTasks: [],
              estimatedHours: 0,
              lawnZones: [],
              palmGroups: [],
              hedgeZones: [],
              treeGroups: [],
              shrubGroups: [],
              phytosanitaryZones: [],
              weedingZones: [],
              aiQuantity: 0,
              aiDifficulty: 1,
              // Apply saved
              ...saved
          };
      });
  };

  const nextStep = () => {
    setCurrentStepState(prev => Math.min(prev + 1, 4));
  };

  const prevStep = () => {
    setCurrentStepState(prev => Math.max(prev - 1, 0));
  };

  const resetBooking = () => {
    setBookingDataState(initialBookingData);
    setCurrentStepState(0);
    setResumeWarning(null);
    clearBookingResumeStorage();
  };

  const saveProgress = () => {
    try {
      const safeBookingData = sanitizeBookingPayload(bookingData);
      const progress = {
        bookingData: safeBookingData,
        currentStep,
        timestamp: new Date().toISOString(),
      };
      writeBookingResume('draft', 'wizard', progress, { userId: user?.id });
    } catch (e) {
      console.warn('Error saving booking progress:', e);
    }
  };

  const loadProgress = () => {
    try {
      const resume = readAnyBookingResume<{ bookingData?: BookingData; currentStep?: number } | BookingData>({
        userId: user?.id,
        flow: 'wizard',
        allowAnonFallback: true,
      });
      const progress = resume?.flow === 'wizard' ? resume.payload : null;
      if (progress) {
        const savedData =
          'bookingData' in (progress as Record<string, unknown>)
            ? (progress as { bookingData?: BookingData }).bookingData
            : (progress as BookingData);
        const savedStep =
          'currentStep' in (progress as Record<string, unknown>)
            ? (progress as { currentStep?: number }).currentStep
            : 0;
        if (savedData && savedStep !== undefined) {
          setBookingDataState(prev => ({ ...prev, ...savedData }));
          setCurrentStepState(Math.max(0, Math.min(savedStep, 4)));
        }
        if (Array.isArray(resume?.nonSerializablePaths) && resume.nonSerializablePaths.length > 0) {
          setResumeWarning({ discardedPaths: resume.nonSerializablePaths });
        }
      }
    } catch (error) {
      console.warn('Error al cargar el progreso:', error);
    } finally {
      setIsLoading(false); // Marcar como cargado independientemente del resultado
    }
  };
  
  // Efecto para restaurar estado al recargar la página si existe progreso guardado
  useEffect(() => {
    if (authLoading) return;
    loadProgress();
  }, [user?.id, authLoading]);

  // Guardar automáticamente cuando cambien los datos o el paso
  // Solo guardar si NO estamos cargando para evitar sobrescribir con datos vacíos iniciales
  useEffect(() => {
    if (!isLoading && (JSON.stringify(bookingData) !== JSON.stringify(initialBookingData) || currentStep > 0)) {
      saveProgress();
    }
  }, [bookingData, currentStep, isLoading]);

  const value: BookingContextType = {
    bookingData,
    currentStep,
    isLoading,
    resumeWarning,
    setBookingData,
    setCurrentStep: (step: number) => setCurrentStepState(Math.max(0, Math.min(step, 4))),
    nextStep,
    prevStep,
    resetBooking,
    clearResumeWarning: () => setResumeWarning(null),
    saveProgress,
    loadProgress,
    updateServiceData,
    switchToService,
  };

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
};
