import React, { createContext, useContext, useState, useEffect } from 'react';
import type { AnalysisV2Envelope } from '../shared/analysisV2';
import type {
  BookingQuoteAvailability,
  BookingQuoteEconomicBreakdown,
  BookingQuoteMetadata,
} from '../shared/bookingQuoteCore';
import type { BookingAuthoritativeQuoteSnapshot } from '../shared/bookingAuthoritativeSnapshot';
import { normalizeAuthoritativeQuoteState } from '../shared/bookingAuthoritativeSnapshot';
import type { BookingPhotoContract } from '../utils/bookingPhotoContract';
import {
  clearBookingDraftPhotoCache,
  restoreBookingDraftPhotoCache,
  syncBookingDraftPhotoCache,
} from '../utils/bookingPhotoDraftCache';
import {
  claimBookingResumeForUser,
  clearBookingResumeStorage,
  readBookingResumeState,
  sanitizeBookingPayload,
  writeBookingResumeResult,
} from '../utils/bookingResumeStorage';
import { reportBookingEvent } from '../utils/bookingTelemetry';
import { syncBookingPhotoContractWithLegacy } from '../utils/bookingPhotoContract';
import { useAuth } from './AuthContext';

export interface BookingData {
  address: string;
  addressCoordinates?: {
    lat: number;
    lng: number;
  };
  serviceIds: string[];
  restrictedGardenerId?: string;
  photos: File[];
  bookingPhotoContract?: BookingPhotoContract;
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
  quoteWarnings?: string[];
  authoritativeQuoteSnapshot?: BookingAuthoritativeQuoteSnapshot;
  quoteMetadata?: BookingQuoteMetadata;
  quoteAvailability?: BookingQuoteAvailability;
  quoteEconomics?: BookingQuoteEconomicBreakdown;
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
  // Manual entry flow (alternativa a fotos)
  dataInputMode?: 'photos' | 'manual'; // How the service variables were captured
  manualDeclarationId?: string; // Links to booking_manual_declarations audit row
  manualConsent?: {
    legalVersion: string;
    legalHash: string;
    acceptedText: string;
    acceptedAt: string;
    declaredVariables: Record<string, unknown>;
  }; // Durable, auditable consent captured at manual submission (travels into the signed quote snapshot)
  palmGroups?: Array<{
    id: string;
    species: string;
    height: string;
    quantity: number;
    state?: string;
    wasteRemoval?: boolean;
    photoUrl?: string;
    photoIds?: string[];
    photoUrls?: string[];
    files?: File[];
    selectedIndices?: number[];
    analyzedIndices?: number[];
    imageIndex?: number;
    analysisLevel?: number;
    observations?: string[];
    analysisV2?: AnalysisV2Envelope;
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
    inputSource?: 'ai' | 'manual';
  }>;
  uploadedPhotoUrls?: string[];
  isAnalyzing?: boolean;
  lawnZones?: Array<{
    id: string;
    species: string;
    state: string; // "normal" | "descuidado" | "muy descuidado"
    quantity: number; // m2
    wasteRemoval: boolean;
    photoIds?: string[];
    photoUrls: string[]; // Multiple photos per zone
    imageIndices: number[]; // Indices in the main photos array
    files?: File[]; // Local files pending upload
    analysisLevel?: number;
    observations?: string[];
    isFailed?: boolean;
    selectedIndices?: number[];
    analyzedIndices?: number[];
    analysisV2?: AnalysisV2Envelope;
    inputSource?: 'ai' | 'manual';
  }>;
  // New Service-Specific Fields
  hedgeFaces?: {
    face_a_urls: string[];
    face_b_urls?: string[];
  };
  hedgeZones?: Array<{
    faceA?: {
      photoIds?: string[];
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
      photoIds?: string[];
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
    photoIds?: string[];
    photoUrls?: string[];
    files?: File[];
    analysisLevel?: number;
    observations?: string[];
    isFailed?: boolean;
    imageIndices?: number[];
    selectedIndices?: number[];
    analyzedIndices?: number[];
    analysisV2?: AnalysisV2Envelope;
    inputSource?: 'ai' | 'manual';
  }>;
  treeGroups?: Array<{
    id: string;
    pruningType: 'structural' | 'shaping';
    photoIds?: string[];
    photoUrls: string[];
    files?: File[];
    selectedIndices?: number[];
    analyzedIndices?: number[];
    aiSizeBand?: 'small' | 'medium' | 'large' | 'over_9';
    aiHeightMeters?: number;
    difficultyHigh?: boolean;
    analysisLevel?: number;
    observations?: string[];
    isFailed?: boolean;
    estimatedHours?: number;
    analysisV2?: AnalysisV2Envelope;
    inputSource?: 'ai' | 'manual';
  }>;
  shrubGroups?: Array<{
    id: string;
    area: number; // m2
    size: 'pequeñas' | 'medianas' | 'grandes';
    wasteRemoval: boolean;
    photoIds?: string[];
    photoUrls?: string[];
    files?: File[];
    analysisLevel?: number;
    observations?: string[];
    isFailed?: boolean;
    imageIndices?: number[]; // Indices in the main photos array
    selectedIndices?: number[];
    analyzedIndices?: number[];
    analysisV2?: AnalysisV2Envelope;
    inputSource?: 'ai' | 'manual';
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
    photoIds?: string[];
    photoUrls?: string[];
    files?: File[];
    selectedIndices?: number[];
    analyzedIndices?: number[];
    analysisLevel?: number;
    observations?: string[];
    isFailed?: boolean;
    analysisV2?: AnalysisV2Envelope;
    inputSource?: 'ai' | 'manual';
  }>;
  weedingZones?: Array<{
    id: string;
    area: number; // m2
    state: string; // "normal" | "dificultad_media" | "dificultad_alta"
    applyHerbicide: boolean;
    wasteRemoval: boolean;
    photoIds?: string[];
    photoUrls?: string[];
    files?: File[];
    selectedIndices?: number[];
    analyzedIndices?: number[];
    analysisLevel?: number;
    observations?: string[];
    isFailed?: boolean;
    analysisV2?: AnalysisV2Envelope;
    inputSource?: 'ai' | 'manual';
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
  resumeWarning: {
    kind: 'rehydrated_partial' | 'storage_degraded' | 'storage_failed' | 'invalid_resume';
    title: string;
    detail: string;
    discardedPaths?: string[];
    restoredPhotoCount?: number;
    nonSerializablePaths?: string[];
  } | null;
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
  addressCoordinates: undefined,
  serviceIds: [],
  photos: [],
  bookingPhotoContract: { schemaVersion: 'booking_photo_v1', items: [] },
  description: '',
  preferredDate: '',
  timeSlot: '',
  providerId: '',
  estimatedHours: 0,
  totalPrice: 0,
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
  const [resumeWarning, setResumeWarning] = useState<BookingContextType['resumeWarning']>(null);

  const applyPhotoContractCompatibility = (data: BookingData): BookingData =>
    syncBookingPhotoContractWithLegacy(normalizeAuthoritativeQuoteState(data)) as BookingData;

  const setBookingData = (data: Partial<BookingData> | ((prev: BookingData) => Partial<BookingData>)) => {
    setBookingDataState(prev => {
        const updates = typeof data === 'function' ? data(prev) : data;
        const newData = { ...prev, ...updates };
        return applyPhotoContractCompatibility(newData);
    });
  };

  const updateServiceData = (serviceId: string, data: any) => {
      setBookingDataState(prev => applyPhotoContractCompatibility({
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
          return applyPhotoContractCompatibility({
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
          });
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
    clearBookingResumeStorage({ userId: user?.id, flow: 'wizard', includeAnonFallback: true });
    void clearBookingDraftPhotoCache(user?.id);
  };

  const saveProgress = () => {
    try {
      const safeBookingData = sanitizeBookingPayload(bookingData);
      const progress = {
        bookingData: safeBookingData,
        currentStep,
        timestamp: new Date().toISOString(),
      };
      const writeResult = writeBookingResumeResult('draft', 'wizard', progress, { userId: user?.id });
      if (writeResult.error) {
        reportBookingEvent('warn', {
          event: 'booking.resume_persist_failed',
          context: {
            flow: 'wizard',
            stage: 'draft',
            reason: writeResult.error,
            storage: writeResult.storage || 'none',
            userId: user?.id,
          },
        });
        setResumeWarning((previous) => {
          if (previous?.kind === 'rehydrated_partial') return previous;
          return {
            kind: 'storage_failed',
            title: 'Tu borrador no se ha podido guardar de forma segura',
            detail:
              writeResult.error === 'quota_exceeded'
                ? 'El navegador ha rechazado el guardado por falta de espacio. Si recargas o cambias de cuenta, podrías perder avances recientes.'
                : 'El navegador no ha permitido persistir el borrador. Evita recargar y termina el flujo antes de cerrar esta pestaña.',
          };
        });
      } else if (writeResult.storage === 'sessionStorage') {
        reportBookingEvent('warn', {
          event: 'booking.resume_persist_degraded',
          context: {
            flow: 'wizard',
            stage: 'draft',
            storage: writeResult.storage,
            userId: user?.id,
          },
        });
        setResumeWarning((previous) => {
          if (previous?.kind === 'rehydrated_partial') return previous;
          return {
            kind: 'storage_degraded',
            title: 'Borrador guardado solo en esta pestaña',
            detail:
              'El navegador no ha permitido persistir el borrador en almacenamiento duradero. Si cierras esta pestaña o cambias de dispositivo, tendrás que reanudar desde cero.',
          };
        });
      } else {
        setResumeWarning((previous) =>
          previous?.kind === 'storage_degraded' || previous?.kind === 'storage_failed' ? null : previous,
        );
      }
      void syncBookingDraftPhotoCache(bookingData, user?.id);
    } catch (e) {
      console.warn('Error saving booking progress:', e);
    }
  };

  const loadProgress = () => {
    void (async () => {
      try {
        const resumeState = readBookingResumeState<{ bookingData?: BookingData; currentStep?: number } | BookingData>({
          userId: user?.id,
          flow: 'wizard',
          allowAnonFallback: true,
        });
        const resume =
          resumeState.record && resumeState.fromAnonFallback && user?.id
            ? claimBookingResumeForUser({
                userId: user.id,
                record: resumeState.record,
                sourceKey: resumeState.sourceKey,
              }) || resumeState.record
            : resumeState.record;
        if (resumeState.fromAnonFallback && user?.id && resume) {
          reportBookingEvent('info', {
            event: 'booking.resume_restored',
            context: {
              flow: 'wizard',
              stage: resume.stage,
              userId: user.id,
              restoredFrom: 'anon_fallback',
            },
          });
        }
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
            const restored = await restoreBookingDraftPhotoCache(
              applyPhotoContractCompatibility({ ...initialBookingData, ...savedData }),
              user?.id,
            );
            setBookingDataState(restored.restoredData as BookingData);
            setCurrentStepState(Math.max(0, Math.min(savedStep, 4)));

            const missingPaths = restored.missingPaths;
            const discardedPaths = Array.from(new Set([...(missingPaths || [])]));
            const nonSerializablePaths = Array.from(new Set(resume?.nonSerializablePaths || []));
            if (discardedPaths.length > 0 || nonSerializablePaths.length > 0) {
              reportBookingEvent('warn', {
                event: 'booking.resume_restored',
                context: {
                  flow: 'wizard',
                  stage: resume?.stage || 'draft',
                  status: 'partial',
                  discardedPathCount: discardedPaths.length,
                  nonSerializablePathCount: nonSerializablePaths.length,
                  userId: user?.id,
                },
              });
              setResumeWarning({
                kind: 'rehydrated_partial',
                title: 'Se ha recuperado tu borrador con límites explícitos',
                detail:
                  discardedPaths.length > 0
                    ? 'Las fotos locales que seguían solo en este dispositivo se han intentado restaurar. Revisa qué imágenes faltan antes de continuar.'
                    : 'Los datos serializables del borrador han vuelto, pero los archivos locales o URLs temporales no viajan de forma fiable entre refresh, login y retornos externos.',
                discardedPaths,
                restoredPhotoCount: restored.restoredCount,
                nonSerializablePaths,
              });
            } else {
              reportBookingEvent('info', {
                event: 'booking.resume_restored',
                context: {
                  flow: 'wizard',
                  stage: resume?.stage || 'draft',
                  status: 'complete',
                  userId: user?.id,
                },
              });
              setResumeWarning(null);
            }
            return;
          }
        }
        setBookingDataState(initialBookingData);
        setCurrentStepState(0);
        if (resumeState.error === 'invalid_schema' || resumeState.error === 'version_mismatch') {
          reportBookingEvent('warn', {
            event: 'booking.resume_rejected',
            context: {
              flow: 'wizard',
              stage: 'draft',
              reason: resumeState.error,
              userId: user?.id,
            },
          });
          setResumeWarning({
            kind: 'invalid_resume',
            title: 'El borrador anterior se ha descartado por seguridad',
            detail:
              'El navegador contenía un estado incompatible, incompleto o de una versión anterior. Se ha ignorado para evitar rehidratar datos corruptos o de otra sesión.',
          });
        } else if (resumeState.error === 'expired') {
          setResumeWarning(null);
        } else {
          setResumeWarning(null);
        }
      } catch (error) {
        console.warn('Error al cargar el progreso:', error);
      } finally {
        setIsLoading(false); // Marcar como cargado independientemente del resultado
      }
    })();
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
