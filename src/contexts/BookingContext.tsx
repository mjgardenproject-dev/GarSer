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
  aiTasks?: Array<{ tipo_servicio: string; estado_jardin?: string; superficie_m2?: number|null; numero_plantas?: number|null; tamaño_plantas?: string|null }>;
  palmSpecies?: string;
}

interface BookingContextType {
  bookingData: BookingData;
  currentStep: number;
  setBookingData: (data: Partial<BookingData>) => void;
  setCurrentStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  resetBooking: () => void;
  saveProgress: () => void;
  loadProgress: () => void;
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
  palmSpecies: '',
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

  const setBookingData = (data: Partial<BookingData>) => {
    setBookingDataState(prev => ({ ...prev, ...data }));
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
    localStorage.removeItem('bookingProgress');
  };

  const saveProgress = () => {
    const progress = {
      bookingData,
      currentStep,
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem('bookingProgress', JSON.stringify(progress));
  };

  const loadProgress = () => {
    try {
      const saved = localStorage.getItem('bookingProgress');
      if (saved) {
        const { bookingData: savedData, currentStep: savedStep } = JSON.parse(saved);
        if (savedData && savedStep !== undefined) {
          setBookingDataState(savedData);
          setCurrentStepState(Math.max(0, Math.min(savedStep, 5)));
        }
      }
    } catch (error) {
      console.warn('Error al cargar el progreso:', error);
    }
  };

  // Guardar automáticamente cuando cambien los datos o el paso
  useEffect(() => {
    saveProgress();
  }, [bookingData, currentStep]);

  // Cargar progreso al montar
  useEffect(() => {
    loadProgress();
  }, []);

  const value: BookingContextType = {
    bookingData,
    currentStep,
    setBookingData,
    setCurrentStep: (step: number) => setCurrentStepState(Math.max(0, Math.min(step, 5))),
    nextStep,
    prevStep,
    resetBooking,
    saveProgress,
    loadProgress,
  };

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
};
