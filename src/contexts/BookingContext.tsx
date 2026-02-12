import React, { createContext, useContext, useState, useEffect } from 'react';

export interface BookingData {
  address: string;
  serviceIds: string[];
  photos: File[];
  description: string;
  preferredDate: string;
  timeSlot: string;
  providerId: string;
  estimatedHours: number;
  totalPrice: number;
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
  setBookingData: (data: Partial<BookingData>) => void;
  setCurrentStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  resetBooking: () => void;
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
  const [bookingData, setBookingDataState] = useState<BookingData>(initialBookingData);
  const [currentStep, setCurrentStepState] = useState(0);
  const [isLoading, setIsLoading] = useState(true); // Inicialmente cargando

  const setBookingData = (data: Partial<BookingData>) => {
    setBookingDataState(prev => {
        const newData = { ...prev, ...data };
        
        // Auto-persist to service isolation if we have a current service context
        // This is a heuristic: if we are updating fields that are service-specific
        // and we have a single selected service ID (common in flow), save to that bucket.
        // However, explicit saving is better controlled by the UI. 
        // For now, we just update the main state. The UI will handle "switching" contexts.
        
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
              aiQuantity: 0,
              aiDifficulty: 1,
              // Apply saved
              ...saved
          };
      });
  };

  const nextStep = () => {
    setCurrentStepState(prev => Math.min(prev + 1, 5));
  };

  const prevStep = () => {
    setCurrentStepState(prev => Math.max(prev - 1, 0));
  };

  const resetBooking = () => {
    setBookingDataState(initialBookingData);
    setCurrentStepState(0);
    // Solo borramos localStorage si se llama explícitamente a resetBooking (abandono confirmado)
    // No lo borramos aquí para permitir persistencia entre recargas si no se ha confirmado el abandono
    localStorage.removeItem('bookingProgress');
  };

  const saveProgress = () => {
    // Guardado robusto en cada cambio
    try {
      const progress = {
        bookingData,
        currentStep,
        timestamp: new Date().toISOString(),
      };
      localStorage.setItem('bookingProgress', JSON.stringify(progress));
    } catch (e) {
      console.warn('Error saving booking progress:', e);
    }
  };

  const loadProgress = () => {
    try {
      const saved = localStorage.getItem('bookingProgress');
      if (saved) {
        const { bookingData: savedData, currentStep: savedStep } = JSON.parse(saved);
        if (savedData && savedStep !== undefined) {
          // Restaurar datos completos
          setBookingDataState(prev => ({ ...prev, ...savedData }));
          // Restaurar paso exacto
          setCurrentStepState(Math.max(0, Math.min(savedStep, 5)));
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
    loadProgress();
  }, []);

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
    setBookingData,
    setCurrentStep: (step: number) => setCurrentStepState(Math.max(0, Math.min(step, 5))),
    nextStep,
    prevStep,
    resetBooking,
    saveProgress,
    loadProgress,
    updateServiceData,
    switchToService,
  };

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
};
