import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { createPortal } from 'react-dom';
import { useBooking, type BookingData } from "../../contexts/BookingContext";
import { ChevronLeft, Camera, Upload, Trash2, Wand2, Image, Sprout, Sparkles, AlertTriangle, CheckCircle, XCircle, Info, Scissors, Trees, Flower2, Shovel, Bug, Eye, EyeOff, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { estimateWorkWithAI, estimateServiceAutoQuote, calculatePalmHours } from '../../utils/aiPricingEstimator';
import { normalizePhytosanitaryTreatment } from '../../utils/serviceValidation';
import { readWeedingHerbicideState, writeWeedingHerbicideState } from '../../utils/weedingPersistence';
import { AnalysisLoadingAnimation } from '../../components/shared/AnalysisLoadingAnimation';
import { AnalysisFailedCard } from '../../components/shared/AnalysisFailedCard';
import { ZonePhotoGallery } from '../../components/shared/ZonePhotoGallery';
import { ZoneActionButton } from '../../components/shared/ZoneActionButton';
import { ServiceResultCard } from '../../components/shared/ServiceResultCard';
import {
  PALM_CANONICAL_SPECIES,
  getHighestOpenRangeThresholdForSpecies,
  getLowestRangeThresholdForSpecies,
  isHighestOpenRangeForSpecies,
  isLowestRangeThresholdForSpecies,
  supportsPhytosanitaryForSpecies,
  supportsTrunkPeelingForSpecies
} from '../../domain/speciesBusinessRules';
// import { TreeBookingGroup } from '../../domain/treePruning';
// import { TreePruningBooking } from '../../components/client/TreePruningBooking';

type PhytosanitaryAffectedType = 'Césped' | 'Árboles' | 'Setos' | 'Plantas bajas' | 'Palmeras';
type PhytosanitaryTreatmentValue = 'insecticida' | 'fungicida' | 'ecologico_preventivo' | 'endoterapia';
type PhytosanitaryScope = 'todo_jardin' | 'palmeras' | 'arboles' | 'cesped' | 'setos' | 'plantas';
type PhytosanitaryRequestTreatment = 'insecticida' | 'fungicida' | 'combo';
type TreeSizeBand = 'small' | 'medium' | 'large' | 'over_9';

type PhytosanitaryAnalysisMetrics = {
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
type PhytosanitaryMetricKey = Exclude<keyof PhytosanitaryAnalysisMetrics, 'observaciones_ia'>;

const PHYTOSANITARY_SCOPE_OPTIONS: Array<{ value: PhytosanitaryScope; label: string; affectedType: PhytosanitaryAffectedType }> = [
  { value: 'setos', label: 'Setos', affectedType: 'Setos' },
  { value: 'cesped', label: 'Césped', affectedType: 'Césped' },
  { value: 'plantas', label: 'Plantas', affectedType: 'Plantas bajas' },
  { value: 'palmeras', label: 'Palmeras', affectedType: 'Palmeras' },
  { value: 'arboles', label: 'Árboles', affectedType: 'Árboles' },
  { value: 'todo_jardin', label: 'Todo el jardín', affectedType: 'Plantas bajas' }
];

const PHYTOSANITARY_REQUEST_TREATMENT_OPTIONS: Array<{ value: PhytosanitaryRequestTreatment; label: string }> = [
  { value: 'insecticida', label: 'Insecticida' },
  { value: 'fungicida', label: 'Fungicida' },
  { value: 'combo', label: 'Combo insecticida + fungicida' }
];

const EMPTY_PHYTOSANITARY_ANALYSIS_METRICS: PhytosanitaryAnalysisMetrics = {
  cesped_m2: 0,
  seto_bajo_medio_ml: 0,
  seto_alto_ml: 0,
  palmeras_ducha_peq_ud: 0,
  palmeras_ducha_med_ud: 0,
  palmeras_ducha_alta_ud: 0,
  palmeras_cirugia_ud: 0,
  palmeras_endoterapia_troncos_ud: 0,
  arboles_peq_ud: 0,
  arboles_med_ud: 0,
  arboles_gran_ud: 0,
  observaciones_ia: []
};

const getAllowedPhytosanitaryTreatments = (affectedType?: PhytosanitaryAffectedType): PhytosanitaryTreatmentValue[] => {
  if (affectedType === 'Palmeras') return ['insecticida', 'fungicida', 'ecologico_preventivo', 'endoterapia'];
  if (affectedType === 'Árboles' || affectedType === 'Setos') return ['insecticida', 'fungicida', 'ecologico_preventivo'];
  return ['insecticida', 'fungicida', 'ecologico_preventivo'];
};

const buildPhytosanitaryZoneType = (
  scope: string | string[] | undefined,
  requested: PhytosanitaryRequestTreatment | undefined,
  wantsEco: boolean | undefined
) => {
  if (!requested) return '';
  if (requested === 'combo') {
    return wantsEco ? 'insecticida+fungicida+ecologico_preventivo' : 'insecticida+fungicida';
  }
  return wantsEco ? `${requested}+ecologico_preventivo` : requested;
};

const toPhytosanitaryMetricNumber = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return 0;
  return Math.max(0, parsed);
};

const normalizeTreeSizeBand = (value: unknown): TreeSizeBand | null => {
  const v = String(value || '').toLowerCase().trim();
  if (v === 'small' || v === 'medium' || v === 'large' || v === 'over_9') return v;
  return null;
};

const treeSizeBandToLegacyMeters = (band: TreeSizeBand): number => {
  if (band === 'small') return 2;
  if (band === 'medium') return 4;
  if (band === 'large') return 7;
  return 9.5;
};

const treeBandLabel = (band?: TreeSizeBand | null): string => {
  if (band === 'small') return 'Pequeño (0-3m)';
  if (band === 'medium') return 'Mediano (3-5m)';
  if (band === 'large') return 'Grande (5-9m)';
  if (band === 'over_9') return 'Muy grande (>9m)';
  return '-';
};

const getDefaultPhytosanitaryScope = (
  affectedType?: PhytosanitaryAffectedType,
  treatmentType?: string
): PhytosanitaryScope[] => {
  if (affectedType === 'Palmeras') return ['palmeras'];
  if (affectedType === 'Árboles') return ['arboles'];
  if (affectedType === 'Setos') return ['setos'];
  if (affectedType === 'Césped') return ['cesped'];
  return ['todo_jardin'];
};

const getPhytosanitaryRequestedTreatment = (treatmentType?: string): PhytosanitaryRequestTreatment | undefined => {
  const normalizedType = String(treatmentType || '').toLowerCase();
  if (!normalizedType) return undefined;
  if (normalizedType.includes('insecticida') && normalizedType.includes('fungicida')) return 'combo';
  if (normalizedType.includes('fungicida')) return 'fungicida';
  if (normalizedType.includes('insecticida') || normalizedType.includes('ecologico') || normalizedType.includes('endoterapia')) return 'insecticida';
  return undefined;
};

const normalizeDetectedWeedingState = (value?: string | null): 'normal' | 'dificultad_media' | 'dificultad_alta' => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('alta')) return 'dificultad_alta';
  if (normalized.includes('media')) return 'dificultad_media';
  return 'normal';
};

const WEEDING_STATE_OPTIONS: Array<{
  value: 'normal' | 'dificultad_media' | 'dificultad_alta';
  label: string;
  description: string;
}> = [
  {
    value: 'normal',
    label: 'Dificultad Normal',
    description: 'Terreno regular, maleza ligera (< 30cm) y sin obstáculos relevantes.'
  },
  {
    value: 'dificultad_media',
    label: 'Dificultad Media',
    description: 'Zonas con pendiente, terreno irregular o maleza herbácea densa (> 30cm).'
  },
  {
    value: 'dificultad_alta',
    label: 'Dificultad Alta',
    description: 'Zonas de difícil acceso, maleza leñosa/zarzas, o presencia de piedras/escombros.'
  }
];

// Deprecated normalizer - removed


const sumPhytosanitaryMetrics = (metrics: PhytosanitaryAnalysisMetrics) => {
  return Number(metrics.cesped_m2 || 0)
    + Number(metrics.seto_bajo_medio_ml || 0)
    + Number(metrics.seto_alto_ml || 0)
    + Number(metrics.palmeras_ducha_peq_ud || 0)
    + Number(metrics.palmeras_ducha_med_ud || 0)
    + Number(metrics.palmeras_ducha_alta_ud || 0)
    + Number(metrics.palmeras_cirugia_ud || 0)
    + Number(metrics.palmeras_endoterapia_troncos_ud || 0)
    + Number(metrics.arboles_peq_ud || 0)
    + Number(metrics.arboles_med_ud || 0)
    + Number(metrics.arboles_gran_ud || 0);
};

// Observation Translations
const OBS_TRANSLATIONS: Record<string, string> = {
  'duplicate_views': 'Posible duplicación de elementos en las fotos.',
  'poor_visibility': 'Mala iluminación o resolución que dificulta el análisis.',
  'risk_environment': 'Riesgo cercano detectado (ej: piscina, mascotas, ventanas).',
  'disease_detected': 'Posibles signos de plaga o enfermedad visibles.',
  'none': 'Análisis completado sin observaciones adicionales.'
};

const PHYTOSANITARY_GROUPED_FIELDS = {
  'Palmeras': [
    { key: 'palmeras_ducha_peq_ud', label: 'Tratamiento preventivo plagas: pequeña', unit: 'ud' },
    { key: 'palmeras_ducha_med_ud', label: 'Tratamiento preventivo plagas: mediana', unit: 'ud' },
    { key: 'palmeras_ducha_alta_ud', label: 'Tratamiento preventivo plagas: alta', unit: 'ud' },
    { key: 'palmeras_cirugia_ud', label: 'Cirugía por plagas', unit: 'ud' },
    { key: 'palmeras_endoterapia_troncos_ud', label: 'Endoterapia preventiva', unit: 'ud' }
  ],
  'Árboles': [
    { key: 'arboles_peq_ud', label: 'Tratamiento estándar: pequeño', unit: 'ud' },
    { key: 'arboles_med_ud', label: 'Tratamiento estándar: mediano', unit: 'ud' },
    { key: 'arboles_gran_ud', label: 'Tratamiento estándar: grande', unit: 'ud' }
  ],
  'Setos': [
    { key: 'seto_bajo_medio_ml', label: 'Tratamiento lineal: bajo/medio', unit: 'ml' },
    { key: 'seto_alto_ml', label: 'Tratamiento lineal: alto', unit: 'ml' }
  ],
  'Césped y Plantas Bajas': [
    { key: 'cesped_m2', label: 'Tratamiento de superficie', unit: 'm²' }
  ],
  'Control de Malas Hierbas': [
    { key: 'herbicida_poca_densidad_m2', label: 'Aplicación de herbicida: densidad baja', unit: 'm²' },
    { key: 'herbicida_mucha_densidad_m2', label: 'Aplicación de herbicida: densidad alta', unit: 'm²' }
  ]
} as const;

const PHYTOSANITARY_RESULT_FIELDS: Array<{ key: PhytosanitaryMetricKey; label: string; unit: string }> = [
  { key: 'cesped_m2', label: 'Césped', unit: 'm²' },
  { key: 'seto_bajo_medio_ml', label: 'Seto bajo/medio', unit: 'ml' },
  { key: 'seto_alto_ml', label: 'Seto alto', unit: 'ml' },
  { key: 'palmeras_ducha_peq_ud', label: 'Palmeras ducha pequeñas', unit: 'ud' },
  { key: 'palmeras_ducha_med_ud', label: 'Palmeras ducha medianas', unit: 'ud' },
  { key: 'palmeras_ducha_alta_ud', label: 'Palmeras ducha altas', unit: 'ud' },
  { key: 'palmeras_cirugia_ud', label: 'Palmeras cirugía', unit: 'ud' },
  { key: 'palmeras_endoterapia_troncos_ud', label: 'Palmeras endoterapia troncos', unit: 'ud' },
  { key: 'arboles_peq_ud', label: 'Árboles pequeños', unit: 'ud' },
  { key: 'arboles_med_ud', label: 'Árboles medianos', unit: 'ud' },
  { key: 'arboles_gran_ud', label: 'Árboles grandes', unit: 'ud' }
];

const PALM_SPECIES = [...PALM_CANONICAL_SPECIES, '<Especie> o similar'] as const;

type PalmGroup = NonNullable<BookingData['palmGroups']>[number];

const hasPositiveUnits = (quantity?: number): boolean => Number(quantity ?? 0) > 0;

const normalizePalmState = (estado?: string): 'normal' | 'descuidado' | 'muy_descuidado' => {
    if (!estado) return 'normal';
    const lower = estado.toLowerCase().trim();
    if (lower.includes('muy')) return 'muy_descuidado';
    if (lower.includes('descuidada') || lower.includes('descuidado')) return 'descuidado';
    return 'normal';
};

const applyPalmSpeciesRules = (group: PalmGroup): PalmGroup => {
  const hasPhytosanitary = supportsPhytosanitaryForSpecies(group.species)
    ? Boolean(group.hasPhytosanitary ?? group.needsPhytosanitary)
    : false;
  const hasTrunkPeeling = supportsTrunkPeelingForSpecies(group.species)
    ? Boolean(group.hasTrunkPeeling ?? group.needsTrunkFinish)
    : false;
  const lowestRangeThreshold = group.lowestRangeThreshold || getLowestRangeThresholdForSpecies(group.species);
  const highestOpenRangeThreshold = group.highestOpenRangeThreshold || getHighestOpenRangeThresholdForSpecies(group.species) || undefined;
  const isLowestRangeThreshold = isLowestRangeThresholdForSpecies(group.species, group.height);
  const isTerminalOpenRange = isHighestOpenRangeForSpecies(group.species, group.height);
  const hasUnits = hasPositiveUnits(group.quantity);
  const hasAccessDifficulty = !hasUnits
    ? undefined
    : isLowestRangeThreshold
      ? false
      : Boolean(group.hasAccessDifficulty);
  const allowsPriceChange = isTerminalOpenRange;

  return {
    ...group,
    hasPhytosanitary,
    hasTrunkPeeling,
    lowestRangeThreshold,
    highestOpenRangeThreshold,
    isTerminalOpenRange,
    allowsPriceChange,
    hasAccessDifficulty
  };
};

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

function AccessDifficultyToggle({ group, isAccessDisabled, updatePalmGroup }: { group: any, isAccessDisabled: boolean, updatePalmGroup: (id: string, updates: any) => void }) {
    const [localVal, setLocalVal] = useState<boolean | undefined>(group.hasAccessDifficulty);
    useEffect(() => {
        setLocalVal(group.hasAccessDifficulty);
    }, [group.hasAccessDifficulty]);

    return (
        <div className={`flex gap-3 ${isAccessDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <label className={`flex-1 flex items-center justify-center py-2.5 px-4 rounded-xl border cursor-pointer ${
                localVal === false ? 'bg-green-50 border-green-500 text-green-700 font-medium shadow-sm ring-1 ring-green-500' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-green-300'
            }`}>
                <input 
                    type="radio" 
                    name={`access-${group.id}`}
                    className="sr-only"
                    disabled={isAccessDisabled}
                    checked={localVal === false}
                    onChange={() => {
                        setLocalVal(false);
                        setTimeout(() => updatePalmGroup(group.id, { hasAccessDifficulty: false }), 0);
                    }}
                />
                Sí
            </label>
            <label className={`flex-1 flex items-center justify-center py-2.5 px-4 rounded-xl border cursor-pointer ${
                localVal === true ? 'bg-green-50 border-green-500 text-green-700 font-medium shadow-sm ring-1 ring-green-500' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-green-300'
            }`}>
                <input 
                    type="radio" 
                    name={`access-${group.id}`}
                    className="sr-only"
                    disabled={isAccessDisabled}
                    checked={localVal === true}
                    onChange={() => {
                        setLocalVal(true);
                        setTimeout(() => updatePalmGroup(group.id, { hasAccessDifficulty: true }), 0);
                    }}
                />
                No
            </label>
        </div>
    );
}

function TreeAccessDifficultyToggle({
  group,
  updateTreeGroup,
}: {
  group: any,
  updateTreeGroup: (id: string, updates: any) => void
}) {
  const initialValue = typeof group.difficultyHigh === 'boolean' ? group.difficultyHigh : undefined;
  const [localVal, setLocalVal] = useState<boolean | undefined>(initialValue);
  useEffect(() => {
    setLocalVal(typeof group.difficultyHigh === 'boolean' ? group.difficultyHigh : undefined);
  }, [group.difficultyHigh]);

  return (
    <div className="flex gap-3">
      <label className={`flex-1 flex items-center justify-center py-2.5 px-4 rounded-xl border cursor-pointer ${
        localVal === false ? 'bg-green-50 border-green-500 text-green-700 font-medium shadow-sm ring-1 ring-green-500' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-green-300'
      }`}>
        <input
          type="radio"
          name={`tree-access-${group.id}`}
          className="sr-only"
          checked={localVal === false}
          onChange={() => {
            setLocalVal(false);
            setTimeout(() => updateTreeGroup(group.id, { difficultyHigh: false }), 0);
          }}
        />
        Sí
      </label>
      <label className={`flex-1 flex items-center justify-center py-2.5 px-4 rounded-xl border cursor-pointer ${
        localVal === true ? 'bg-green-50 border-green-500 text-green-700 font-medium shadow-sm ring-1 ring-green-500' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-green-300'
      }`}>
        <input
          type="radio"
          name={`tree-access-${group.id}`}
          className="sr-only"
          checked={localVal === true}
          onChange={() => {
            setLocalVal(true);
            setTimeout(() => updateTreeGroup(group.id, { difficultyHigh: true }), 0);
          }}
        />
        No
      </label>
    </div>
  );
}

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
  const [debugPhytosanitaryType, setDebugPhytosanitaryType] = useState<string>('');

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
    tone: 'danger' | 'warning' | 'phytosanitary_warning';
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
  const [treeUploads, setTreeUploads] = useState<Record<string, Set<number>>>({});
  const [treeAnalyzingZoneIds, setTreeAnalyzingZoneIds] = useState<Set<string>>(new Set());
  const [palmUploads, setPalmUploads] = useState<Record<string, Set<number>>>({});
  const [palmAnalyzingZoneIds, setPalmAnalyzingZoneIds] = useState<Set<string>>(new Set());

  const [phytosanitaryUploads, setPhytosanitaryUploads] = useState<Record<string, Set<number>>>({});
  const [phytosanitaryAnalyzingZoneIds, setPhytosanitaryAnalyzingZoneIds] = useState<Set<string>>(new Set());
  const isAnyLawnZoneAnalyzing = lawnAnalyzingZoneIds.size > 0;
  const isAnyTreeZoneAnalyzing = treeAnalyzingZoneIds.size > 0;
  const [shrubAnalyzingZoneIds, setShrubAnalyzingZoneIds] = useState<Set<string>>(new Set());
  const [shrubUploads, setShrubUploads] = useState<Record<string, Set<number>>>({});
  const [weedingManualConfirmed, setWeedingManualConfirmed] = useState(false);
  const isAnyPhytosanitaryZoneAnalyzing = phytosanitaryAnalyzingZoneIds.size > 0;

  useEffect(() => {
    if (isAnyPhytosanitaryZoneAnalyzing) {
      setLoadingMessage('La IA está analizando las dimensiones de tu jardín...');
      return;
    }
    if (analyzing || isAnyLawnZoneAnalyzing || isAnyTreeZoneAnalyzing) {
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
  }, [analyzing, isAnyLawnZoneAnalyzing, isAnyTreeZoneAnalyzing, isAnyPhytosanitaryZoneAnalyzing]);

  const openConfirm = (config: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: 'danger' | 'warning' | 'phytosanitary_warning';
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
    const hasPhytosanitaryZones = bookingData.phytosanitaryZones && bookingData.phytosanitaryZones.some(z => z.id.startsWith('ai-'));

    return hasAiTasks || hasPalmGroups || hasLawnZones || hasHedgeZones || hasTreeGroups || hasShrubGroups || hasPhytosanitaryZones;
  }, [bookingData]);

  const resetAnalysis = () => {
      const resetData = {
          aiTasks: [],
          lawnZones: [],
          hedgeZones: [],
          treeGroups: [],
          shrubGroups: [],
          phytosanitaryZones: [],
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
  const activeServiceId = bookingData.serviceIds?.[0] || '';
  const isWeedingServiceSelected =
    debugService.toLowerCase().includes('desbroce') ||
    debugService.toLowerCase().includes('malas hierbas');

  const createDebugInfo = (overrides: Partial<AnalysisDebugInfo> & Pick<AnalysisDebugInfo, 'service' | 'model' | 'promptInputs'>): AnalysisDebugInfo => ({
    service: overrides.service,
    model: overrides.model,
    promptInputs: overrides.promptInputs,
    rawResponse: overrides.rawResponse ?? null,
    parsedResponse: overrides.parsedResponse ?? null,
    finalAnalysisData: overrides.finalAnalysisData ?? {},
    errors: overrides.errors ?? [],
    timestamp: overrides.timestamp ?? new Date().toISOString()
  });
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
        if (data) {
          let sn = data.name;
          if (sn.toLowerCase().includes('fumigación') || sn.toLowerCase().includes('fumigacion') || sn.toLowerCase().includes('tratamientos fitosanitarios')) {
            sn = 'Servicios fitosanitarios';
          }
          setDebugService(sn);
        }
      }
    };
    fetchServiceName();
  }, [bookingData.serviceIds]);

  useEffect(() => {
    if (!activeServiceId) return;
    if (!isWeedingServiceSelected) return;
    if (!bookingData.weedingZones || bookingData.weedingZones.length === 0) return;

    let hasChanges = false;
    const hydratedZones = bookingData.weedingZones.map((zone) => {
      const persistedState = readWeedingHerbicideState(activeServiceId, zone.id);
      if (persistedState === null || persistedState === zone.applyHerbicide) return zone;
      hasChanges = true;
      return { ...zone, applyHerbicide: persistedState };
    });

    if (!hasChanges) return;
    setBookingData({ weedingZones: hydratedZones });
    updateServiceData(activeServiceId, { weedingZones: hydratedZones });
    saveProgress();
  }, [
    activeServiceId,
    isWeedingServiceSelected,
    bookingData.weedingZones
      ? JSON.stringify(bookingData.weedingZones.map((z) => ({ id: z.id, applyHerbicide: z.applyHerbicide })))
      : ''
  ]);

  useEffect(() => {
    if (!isWeedingServiceSelected) return;

    const currentZones = bookingData.weedingZones || [];
    const primary = currentZones[0];
    const mustCreate = currentZones.length === 0;
    const mustNormalizeToSingle = currentZones.length > 1;
    const mustStripAiArtifacts = Boolean(
      primary && (
        (primary.photoUrls?.length || 0) > 0
        || (primary.files?.length || 0) > 0
        || (primary.selectedIndices?.length || 0) > 0
        || (primary.analyzedIndices?.length || 0) > 0
        || primary.analysisLevel !== undefined
        || (primary.observations?.length || 0) > 0
        || (primary as any).isFailed === true
      )
    );

    if (!mustCreate && !mustNormalizeToSingle && !mustStripAiArtifacts) return;

    const nextZone = primary
      ? {
          ...primary,
          photoUrls: [],
          files: [],
          selectedIndices: [],
          analyzedIndices: [],
          analysisLevel: undefined,
          observations: [],
          isFailed: false
        }
      : createDefaultWeedingZone();
    const nextZones = [nextZone];

    setBookingData({ weedingZones: nextZones });
    if (activeServiceId) updateServiceData(activeServiceId, { weedingZones: nextZones });
    saveProgress();
  }, [isWeedingServiceSelected, activeServiceId, bookingData.weedingZones]);

  useEffect(() => {
    if (!isWeedingServiceSelected) {
      setWeedingManualConfirmed(false);
    }
  }, [isWeedingServiceSelected]);

  const handleToggleWeedingHerbicide = (zoneIndex: number) => {
    if (!activeServiceId || !bookingData.weedingZones || !bookingData.weedingZones[zoneIndex]) return;
    const updated = [...bookingData.weedingZones];
    const zone = updated[zoneIndex];
    const nextApplyHerbicide = !zone.applyHerbicide;
    updated[zoneIndex] = { ...zone, applyHerbicide: nextApplyHerbicide };

    writeWeedingHerbicideState(activeServiceId, zone.id, nextApplyHerbicide);
    setBookingData({ weedingZones: updated });
    updateServiceData(activeServiceId, { weedingZones: updated });
    saveProgress();
  };

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

  // Sync shrub groups to global state
  useEffect(() => {
      const isShrubService = debugService.toLowerCase().includes('poda de plantas');
      if (isShrubService && bookingData.shrubGroups) {
          let totalHours = 0;
          let totalQty = 0;
          bookingData.shrubGroups.forEach(g => {
              if (g.area > 0) {
                  totalHours += Math.ceil(g.area * 0.15) || 1;
                  totalQty += g.area;
              }
          });
          
          const allUrls = bookingData.shrubGroups.flatMap(g => g.photoUrls || []);
          const currentHours = bookingData.estimatedHours || 0;
          const currentUrls = bookingData.uploadedPhotoUrls || [];
          
          const hoursChanged = Math.abs(currentHours - totalHours) > 0.1;
          const urlsChanged = allUrls.length !== currentUrls.length || !allUrls.every((u, i) => u === currentUrls[i]);
          
          if (hoursChanged || urlsChanged) {
              setBookingData({ 
                  estimatedHours: totalHours,
                  uploadedPhotoUrls: allUrls,
                  aiQuantity: totalQty,
                  aiUnit: 'm2'
              });
          }
      }
  }, [bookingData.shrubGroups, debugService]);

  // Sync weeding zones to global state
  useEffect(() => {
      const isWeedingService = debugService.toLowerCase().includes('desbroce') || debugService.toLowerCase().includes('malas hierbas');
      if (isWeedingService && bookingData.weedingZones) {
          let totalHours = 0;
          let totalQty = 0;
          bookingData.weedingZones.forEach(z => {
              if (z.area > 0) {
                  const sMod = z.state.includes('alta') ? 1.5 : z.state.includes('media') ? 1.2 : 1.0;
                  totalHours += Math.ceil((z.area / 100) * sMod);
                  totalQty += z.area;
              }
          });
          
          const allUrls = bookingData.weedingZones.flatMap(z => z.photoUrls || []);
          const currentHours = bookingData.estimatedHours || 0;
          const currentUrls = bookingData.uploadedPhotoUrls || [];
          
          const hoursChanged = Math.abs(currentHours - totalHours) > 0.1;
          const urlsChanged = allUrls.length !== currentUrls.length || !allUrls.every((u, i) => u === currentUrls[i]);
          
          if (hoursChanged || urlsChanged) {
              setBookingData({ 
                  estimatedHours: totalHours,
                  uploadedPhotoUrls: allUrls,
                  aiQuantity: totalQty,
                  aiUnit: 'm2'
              });
          }
      }
  }, [bookingData.weedingZones, debugService]);

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
      toast.error('Máximo 5 fotos permitidas');
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

  const estimateTreeZoneHours = (zone: any) => {
    const sizeBand = normalizeTreeSizeBand(zone.aiSizeBand);
    if (!sizeBand) return 0;
    const pruningType = String(zone.pruningType || 'structural').toLowerCase();
    const difficultyHigh = zone.difficultyHigh === true;

    const base =
      pruningType.includes('shap')
        ? (sizeBand === 'small' ? 1.0 : sizeBand === 'medium' ? 1.75 : sizeBand === 'large' ? 2.75 : 3.25)
        : (sizeBand === 'small' ? 1.25 : sizeBand === 'medium' ? 2.25 : sizeBand === 'large' ? 3.25 : 3.75);
    const difficultyExtra = difficultyHigh ? 0.5 : 0;
    const over9Extra = sizeBand === 'over_9' ? 1.0 : 0;

    return base + difficultyExtra + over9Extra;
  };

  const calculateTotalTreeHours = (groups: any[]) => {
    const validGroups = groups.filter((t: any) => !(t.isFailed || t.analysisLevel === 3));
    
    if (validGroups.length === 0) return 0;

    const total = validGroups.reduce((acc: number, t: any) => {
      return acc + estimateTreeZoneHours(t);
    }, 0);
    return Math.max(0, Math.ceil(total));
  };

  const updatePalmPricing = async (groups: PalmGroup[]) => {
      const normalizedGroups = groups.map(applyPalmSpeciesRules);
      // Flatten groups based on quantity for accurate backend calculation
      const flatPalms: Array<{ especie: string; altura: string; estado: string }> = [];
      normalizedGroups.forEach(g => {
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
      
      const payload = { palmGroups: normalizedGroups, estimatedHours: totalHours, isAnalyzing: false };
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

  const updatePalmGroup = (groupId: string, updates: Partial<PalmGroup>) => {
      const n = [...(bookingData.palmGroups || [])];
      const g = n.find(x => x.id === groupId);
      if (g) {
          Object.assign(g, updates);
          Object.assign(g, applyPalmSpeciesRules(g));
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

        const totalHours = newGroups.reduce((acc, g) => acc + (Math.ceil((g.area || 0) * 0.15) || 1), 0);
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
    const isPhytosanitaryService = debugService.toLowerCase().includes('fitosanit') || debugService.toLowerCase().includes('fitosanit');
    const isWeedingService = debugService.toLowerCase().includes('desbroce') || debugService.toLowerCase().includes('malas hierbas');
    if (isPhytosanitaryService) {
      const zones = bookingData.phytosanitaryZones || [];
      if (zones.length === 0) {
        alert('Añade al menos una zona para continuar.');
        return;
      }
      const firstInvalidZone = zones.find((zone) => getPhytosanitaryValidation(zone as any).issues.length > 0);
      if (firstInvalidZone) {
        toast.error(getPhytosanitaryValidation(firstInvalidZone as any).issues[0]);
        return;
      }
      if (zones.some((zone) => !isPhytosanitaryZoneAnalyzed(zone as any))) {
        toast.error('Completa el análisis de todas las zonas antes de continuar.');
        return;
      }
    }

    if (isWeedingService) {
      const zone = bookingData.weedingZones?.[0];
      const hasValidArea = Number(zone?.area || 0) > 0;
      const hasValidState = zone?.state === 'normal' || zone?.state === 'dificultad_media' || zone?.state === 'dificultad_alta';
      if (!zone || !hasValidArea || !hasValidState) {
        toast.error('Completa la superficie y el estado de la parcela para continuar.');
        return;
      }
      if (!weedingManualConfirmed) {
        toast.error('Debes confirmar los datos del desbroce para continuar.');
        return;
      }
    }

    if (debugService === 'Poda de palmeras') {
        if (!bookingData.palmGroups || bookingData.palmGroups.length === 0) {
             toast.error('Por favor, asegúrate de tener al menos un grupo de palmeras configurado.');
             return;
        }
        // Validate quantities
        const invalid = bookingData.palmGroups.some(g => g.quantity <= 0);
        if (invalid) {
            toast.error('Tienes palmeras con cantidad 0 o vacía. Por favor, elimínalas o añade una cantidad válida para continuar.');
            return;
        }
    }
    if (debugService === 'Poda de árboles') {
      const validTrees = (bookingData.treeGroups || []).filter((g: any) => !((g as any).isFailed === true || g.analysisLevel === 3));
      if (validTrees.length === 0) {
        toast.error('Analiza al menos un árbol válido para continuar.');
        return;
      }
      const pendingAccess = validTrees.some((g: any) => typeof g.difficultyHigh !== 'boolean');
      if (pendingAccess) {
        toast.error('Responde la pregunta de acceso en cada árbol antes de continuar.');
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
            phytosanitaryZones: bookingData.phytosanitaryZones,
            weedingZones: bookingData.weedingZones,
            aiQuantity: bookingData.aiQuantity,
            aiDifficulty: bookingData.aiDifficulty,
            wasteRemoval: bookingData.wasteRemoval
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
        toast.error('Error al procesar las imágenes seleccionadas.');
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
                 
                 const speciesMapped = p.especie ? p.especie.charAt(0).toUpperCase() + p.especie.slice(1) : 'Desconocida';
                 return {
                    id: `ai-${Date.now()}-${idx}`,
                    species: speciesMapped,
                    height: p.altura,
                    quantity: 1, // Default to 1, user must confirm
                    state: normalizePalmState(p.estado),
                    wasteRemoval: true,
                    hasPhytosanitary: supportsPhytosanitaryForSpecies(speciesMapped),
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
        const t: any = res.arboles[0];
        const bestIndex = typeof t.indice_imagen === 'number' ? t.indice_imagen : 0;
        const globalIndex = indexMap[bestIndex] ?? indexMap[0] ?? indicesToProcess[0] ?? 0;
        const originalUrl = photoUrls[globalIndex];
        const aiSizeBand =
          normalizeTreeSizeBand(t.size_band);
        const legacyHeight = aiSizeBand ? treeSizeBandToLegacyMeters(aiSizeBand) : 0;
        const analysisLevel = Number(t.nivel_analisis || 3);
        const newTreeGroups = [
          {
            id: `ai-tree-${Date.now()}`,
            pruningType: 'structural' as const,
            photoUrls: targetUrls.map((u, i) => photoUrls[indexMap[i]]).filter(Boolean),
            aiSizeBand: aiSizeBand ?? undefined,
            aiHeightMeters: Number.isFinite(legacyHeight) ? legacyHeight : 0,
            difficultyHigh: undefined,
            analysisLevel,
            observations: t.observaciones || [],
            isFailed: analysisLevel === 3 || !aiSizeBand,
          }
        ].map((g) => ({ ...g, estimatedHours: estimateTreeZoneHours(g) }));
        
        // MERGE LOGIC:
        // Filter out old groups that came from the photos we just re-analyzed
        const oldGroups = (bookingData.treeGroups || []).filter(g => {
            const urls = g.photoUrls || [];
            if (urls.length === 0) return true;
            return urls.every((u) => !targetUrls.includes(u));
        });
        
        const mergedGroups = [...oldGroups, ...newTreeGroups];
        const totalTreeHours = calculateTotalTreeHours(mergedGroups);
        
        const treePayload = { 
            treeGroups: mergedGroups,
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
        const updatePayload: any = { isAnalyzing: false };
        
        // Initialize accumulator arrays
        const newLawnZones: any[] = [];
        const newHedgeZones: any[] = [];
        const newTreeGroups: any[] = [];
        const newShrubGroups: any[] = [];
        const newPhytosanitaryZones: any[] = [];
        const newWeedingZones: any[] = [];
        
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
            else if (normService.includes('desbroce') || normService.includes('malas hierbas')) {
                const qty = Math.max(0, Number(t.superficie_malas_hierbas_m2 ?? t.superficie_m2 ?? 0));
                const state = normalizeDetectedWeedingState(t.estado_malas_hierbas ?? t.estado_jardin);
                
                // Estimation (very basic for UI, real calculation in ProvidersPage)
                const sMod = state.includes('alta') ? 1.5 : state.includes('media') ? 1.2 : 1.0;
                totalHours += Math.ceil((qty / 100) * sMod);
                totalAiQty += qty;
                
                newWeedingZones.push({
                    id: `ai-weeding-${Date.now()}-${idx}`,
                    area: qty,
                    state: state,
                    applyHerbicide: false, // User must explicitly opt-in to herbicide
                    wasteRemoval: true,
                    photoUrls: validUrls,
                    selectedIndices: validUrls.map((_, urlIdx) => urlIdx),
                    analyzedIndices: validUrls.map((_, urlIdx) => urlIdx),
                    analysisLevel: t.nivel_analisis,
                    observations: t.observaciones
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
                const legacyTotal = Number(t.tamano_total_jardin_m2 || 0);
                const legacyPercent = Number(t.porcentaje_superficie_plantas || 0);
                const fallbackM2 = Number.isFinite(legacyTotal) && Number.isFinite(legacyPercent)
                  ? Math.max(0, Math.round(legacyTotal * (legacyPercent / 100)))
                  : 0;
                const m2 = Number(t.superficie_m2 ?? fallbackM2 ?? 0);
                
                let size = 'pequeñas';
                const aiSize = String(t.tamano_dominante || '').toLowerCase();
                if (aiSize.includes('grandes')) size = 'grandes';
                else if (aiSize.includes('medianas')) size = 'medianas';

                totalHours += Math.ceil(m2 * 0.15) || 1; 
                totalAiQty += m2;

                newShrubGroups.push({
                    id: `ai-shrub-${Date.now()}-${idx}`,
                    size: size,
                    area: m2,
                    wasteRemoval: true,
                    photoUrls: validUrls,
                    analysisLevel: t.nivel_analisis,
                    observations: t.observaciones,
                    imageIndices: t.indices_imagenes || []
                });
            }
            else if (normService.includes('fitosanitarios')) {
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
                  : rawBand === 'altos';
                const aboveThreeMeters = typeof (t as any).supera_3m === 'boolean'
                  ? Boolean((t as any).supera_3m)
                  : ['medianos', 'grandes', 'medianas', 'altas'].includes(rawBand);
                const recommended = String(t.tratamiento_recomendado || '').toLowerCase();
                const pestLevel = String(t.nivel_plaga || '').toLowerCase();
                const mappedTreatment = recommended || (pestLevel.includes('curativo') || pestLevel.includes('activa') ? 'insecticida' : (pestLevel.includes('fung') ? 'fungicida' : (pestLevel.includes('herbi') ? 'herbicida' : 'ecologico_preventivo')));
                
                // Directly use metricas_fitosanitarias from task (or fallback to empty if old format)
                const rawMetrics = (t as any).metricas_fitosanitarias || (res as any)?.metricas_fitosanitarias || {};
                const analysisMetrics: PhytosanitaryAnalysisMetrics = {
                  ...EMPTY_PHYTOSANITARY_ANALYSIS_METRICS,
                  cesped_m2: Number(rawMetrics.cesped_m2 || 0),
                  seto_bajo_medio_ml: Number(rawMetrics.seto_bajo_medio_ml || 0),
                  seto_alto_ml: Number(rawMetrics.seto_alto_ml || 0),
                  palmeras_ducha_peq_ud: Number(rawMetrics.palmeras_ducha_peq_ud || 0),
                  palmeras_ducha_med_ud: Number(rawMetrics.palmeras_ducha_med_ud || 0),
                  palmeras_ducha_alta_ud: Number(rawMetrics.palmeras_ducha_alta_ud || 0),
                  palmeras_cirugia_ud: Number(rawMetrics.palmeras_cirugia_ud || 0),
                  palmeras_endoterapia_troncos_ud: Number(rawMetrics.palmeras_endoterapia_troncos_ud || 0),
                  arboles_peq_ud: Number(rawMetrics.arboles_peq_ud || 0),
                  arboles_med_ud: Number(rawMetrics.arboles_med_ud || 0),
                  arboles_gran_ud: Number(rawMetrics.arboles_gran_ud || 0),
                  observaciones_ia: Array.isArray(rawMetrics.observaciones_ia) ? rawMetrics.observaciones_ia : []
                };
                
                if (unit === 'm2') totalHours += Math.ceil(qty / 100) || 1;
                else totalHours += Math.ceil(qty * 0.1) || 1;
                totalAiQty += qty;

                newPhytosanitaryZones.push({
                    id: `ai-fum-${Date.now()}-${idx}`,
                    type: mappedTreatment,
                    area: Math.max(qty, sumPhytosanitaryMetrics(analysisMetrics)),
                    scope: getDefaultPhytosanitaryScope(affectedType, mappedTreatment),
                    requestedTreatment: getPhytosanitaryRequestedTreatment(mappedTreatment),
                    wantsEco: mappedTreatment.includes('ecologico_preventivo'),
                    affectedType,
                    aboveTwoMeters,
                    aboveThreeMeters,
                    analysisMetrics,
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
        if (newPhytosanitaryZones.length > 0) {
            updatePayload.phytosanitaryZones = newPhytosanitaryZones;
            if (!updatePayload.aiUnit) updatePayload.aiUnit = 'u'; // Default to unit if mixed
        }
        
        if (newWeedingZones.length > 0) {
            updatePayload.weedingZones = newWeedingZones;
            if (!updatePayload.aiUnit) updatePayload.aiUnit = 'm2';
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
                 title: 'Análisis fallido',
                 message: 'Elemento a analizar impredecible',
                 type: 'error'
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

        toast.error('Error en el análisis. Por favor, reintente.');
        
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
            description: 'Sube una foto por cada tipo de palmera diferente. Las palmeras tienen que verse enteras para las fotos desde el suelo hasta la corona. Si tienes varias iguales en especie, tamaño y estado, solo necesitas subir una foto.'
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
            title: 'Datos de la parcela',
            description: 'Indica la superficie y el estado de la parcela para calcular el presupuesto.'
        };
    }
    if (lower.includes('fitosanit')) {
        return {
            title: 'Servicios fitosanitarios',
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
          if (!options?.silent) toast.error(message);
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
          
          setBookingData(prev => {
              const currentZones = prev.lawnZones || [];
              const updatedZones = currentZones.map(z => {
                  if (z.id === zoneId) {
                      return { 
                          ...z, 
                          isFailed: true,
                          analysisLevel: 3,
                          observations: ['Error en el análisis. Por favor, reintente.']
                      };
                  }
                  return z;
              });
              
              const activeServiceId = prev.serviceIds?.[0] || '';
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
              else toast.error(message);
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

          setBookingData((prev) => {
              const currentZones = prev.hedgeZones || [];
              const updatedZones = currentZones.map(z => {
                  if (z.id === id) {
                      return { 
                          ...z, 
                          isFailed: true,
                          analysisLevel: 3,
                          observations: ['Error en el análisis. Por favor, reintente.']
                      };
                  }
                  return z;
              });
              
              const activeServiceId = prev.serviceIds?.[0] || '';
              const nextServicesData = activeServiceId
                  ? {
                      ...prev.servicesData,
                      [activeServiceId]: {
                          ...(prev.servicesData?.[activeServiceId] || {}),
                          hedgeZones: updatedZones
                      }
                  }
                  : prev.servicesData;

              return {
                  hedgeZones: updatedZones,
                  servicesData: nextServicesData
              };
          });
          
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
        pruningType: 'structural' as const,
        photoUrls: [] as string[],
        aiSizeBand: undefined as TreeSizeBand | undefined,
        aiHeightMeters: 0,
        difficultyHigh: undefined as boolean | undefined
    };
    const newGroups = [...(bookingData.treeGroups || []), newGroup];
    setBookingData({ treeGroups: newGroups });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { treeGroups: newGroups });
    saveProgress();
  };

  const updateTreeGroup = (id: string, updates: any) => {
    const next = [...(bookingData.treeGroups || [])];
    const idx = next.findIndex((z) => z.id === id);
    if (idx === -1) return;
    next[idx] = { ...next[idx], ...updates };
    const newHours = calculateTotalTreeHours(next);
    setBookingData({ treeGroups: next, estimatedHours: newHours });
    if (bookingData.serviceIds?.[0]) {
      updateServiceData(bookingData.serviceIds[0], { treeGroups: next, estimatedHours: newHours });
    }
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

    if ((groups[idx].photoUrls?.length || 0) + files.length > 5) {
        toast.error('Máximo 5 fotos por árbol');
        return;
    }

    const currentLen = groups[idx].photoUrls?.length || 0;
    const tempUrls = files.map(f => URL.createObjectURL(f));
    groups[idx].photoUrls = [...(groups[idx].photoUrls || []), ...tempUrls];
    setBookingData({ treeGroups: groups });

    const newIndices = tempUrls.map((_, i) => currentLen + i);
    setTreeUploads(prev => {
        const zoneUploads = new Set(prev[id] || []);
        newIndices.forEach(i => zoneUploads.add(i));
        return { ...prev, [id]: zoneUploads };
    });

    const startIdx = (bookingData.uploadedPhotoUrls?.length || 0) + Date.now();
    
    try {
        const uploadResults = await Promise.all(files.map((file, i) => uploadFile(file, startIdx + i)));
        const updatedGroups = [...(bookingData.treeGroups || [])];
        const updatedIdx = updatedGroups.findIndex(z => z.id === id);
        if (updatedIdx === -1) return;

        const finalUrls = [...(updatedGroups[updatedIdx].photoUrls || [])];
        uploadResults.forEach((url, i) => {
            const targetIdx = currentLen + i;
            if (!url) return;
            if (targetIdx < finalUrls.length) {
                finalUrls[targetIdx] = url;
            } else {
                finalUrls.push(url);
            }
        });
        
        updatedGroups[updatedIdx].photoUrls = finalUrls;
        setBookingData({ treeGroups: updatedGroups });
        if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { treeGroups: updatedGroups });
    } catch (error) {
        console.error('Upload failed', error);
        toast.error('Error al subir algunas imágenes');
    } finally {
        setTreeUploads(prev => {
            const next = { ...prev };
            const zoneUploads = new Set(next[id] || []);
            newIndices.forEach(i => zoneUploads.delete(i));
            next[id] = zoneUploads;
            return next;
        });
    }
  };

  
  const toggleTreePhotoSelection = (zoneId: string, photoIndex: number) => {
      const groups = [...(bookingData.treeGroups || [])];
      const idx = groups.findIndex(z => z.id === zoneId);
      if (idx === -1) return;
      const zone = groups[idx] as any;
      const allUrls = zone.photoUrls || [];
      const currentSelected = zone.selectedIndices ?? allUrls.map((_: any, i: number) => i);
      const isSelected = currentSelected.includes(photoIndex);
      
      let newSelected;
      if (isSelected) {
          newSelected = currentSelected.filter((i: number) => i !== photoIndex);
      } else {
          newSelected = [...currentSelected, photoIndex].sort((a, b) => a - b);
      }
      
      zone.selectedIndices = newSelected;
      setBookingData({ treeGroups: groups });
      if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { treeGroups: groups });
  };

  const removeTreePhoto = (zoneId: string, photoIndex: number) => {
      const groups = [...(bookingData.treeGroups || [])];
      const idx = groups.findIndex(z => z.id === zoneId);
      if (idx === -1) return;
      const zone = groups[idx] as any;
      
      zone.photoUrls = (zone.photoUrls || []).filter((_: any, i: number) => i !== photoIndex);
      zone.selectedIndices = (zone.selectedIndices || []).filter((i: number) => i !== photoIndex).map((i: number) => i > photoIndex ? i - 1 : i);
      zone.analyzedIndices = (zone.analyzedIndices || []).filter((i: number) => i !== photoIndex).map((i: number) => i > photoIndex ? i - 1 : i);
      
      setBookingData({ treeGroups: groups });
      if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { treeGroups: groups });
  };

  const addPalmGroup = () => {
    const newGroup = {
        id: `palm-${Date.now()}`,
        species: '',
        height: '',
        quantity: 1,
        state: 'normal',
        wasteRemoval: true,
        photoUrls: [] as string[]
    };
    const newGroups = [...(bookingData.palmGroups || []), newGroup as any];
    setBookingData({ palmGroups: newGroups });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { palmGroups: newGroups });
  };

  const removePalmGroup = (id: string) => {
      const currentGroups = bookingData.palmGroups || [];
      const nextGroups = currentGroups.filter(g => g.id !== id);
      setBookingData({ palmGroups: nextGroups });
      if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { palmGroups: nextGroups });
      updatePalmPricing(nextGroups);
  };

  const handlePalmFileSelect = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || e.target.files.length === 0) return;
      const files = Array.from(e.target.files);
      const group = (bookingData.palmGroups || []).find(g => g.id === id);
      if (!group) return;
      const currentPhotos = (group as any).photoUrls || [];
      if (currentPhotos.length + files.length > 5) {
          toast.error('Máximo 5 fotos por grupo');
          return;
      }
      
      const newIndices = files.map((_, i) => currentPhotos.length + i);
      setPalmUploads(prev => {
          const next = { ...prev };
          const set = new Set(next[id] || []);
          newIndices.forEach(i => set.add(i));
          next[id] = set;
          return next;
      });

      const nextGroups = [...(bookingData.palmGroups || [])];
      const zIdx = nextGroups.findIndex(x => x.id === id);
      const tempUrls = files.map(f => URL.createObjectURL(f));
      nextGroups[zIdx] = { ...group, photoUrls: [...currentPhotos, ...tempUrls] } as any;
      setBookingData({ palmGroups: nextGroups });

      try {
          const uploadedUrls = await Promise.all(files.map((f, i) => uploadFile(f, currentPhotos.length + i)));
          const finalGroups = [...(bookingData.palmGroups || [])];
          const finalZIdx = finalGroups.findIndex(x => x.id === id);
          if (finalZIdx !== -1) {
              const updatedUrls = [...currentPhotos];
              uploadedUrls.forEach((url, i) => {
                  if (url) updatedUrls.push(url);
              });
              finalGroups[finalZIdx] = { ...finalGroups[finalZIdx], photoUrls: updatedUrls } as any;
              setBookingData({ palmGroups: finalGroups });
              if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { palmGroups: finalGroups });
          }
      } catch (err) {
          console.error('Error uploading palm photos:', err);
          toast.error('Error al subir algunas fotos');
      } finally {
          setPalmUploads(prev => {
              const next = { ...prev };
              const set = new Set(next[id] || []);
              newIndices.forEach(i => set.delete(i));
              if (set.size === 0) delete next[id];
              else next[id] = set;
              return next;
          });
      }
  };

  const togglePalmPhotoSelection = (id: string, photoIndex: number) => {
      const groups = [...(bookingData.palmGroups || [])];
      const zIdx = groups.findIndex(z => z.id === id);
      if (zIdx === -1) return;
      const group = groups[zIdx] as any;
      const currentSelected = group.selectedIndices ?? Array.from({ length: (group.photoUrls || []).length }, (_, i) => i);
      const newSelected = currentSelected.includes(photoIndex)
          ? currentSelected.filter((i: number) => i !== photoIndex)
          : [...currentSelected, photoIndex].sort((a: number, b: number) => a - b);
      group.selectedIndices = newSelected;
      setBookingData({ palmGroups: groups });
      if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { palmGroups: groups });
  };

  const removePalmPhoto = (id: string, photoIndex: number) => {
      const groups = [...(bookingData.palmGroups || [])];
      const zIdx = groups.findIndex(z => z.id === id);
      if (zIdx === -1) return;
      const group = groups[zIdx] as any;
      group.photoUrls = (group.photoUrls || []).filter((_: any, i: number) => i !== photoIndex);
      if (group.selectedIndices) {
          group.selectedIndices = group.selectedIndices
              .filter((i: number) => i !== photoIndex)
              .map((i: number) => i > photoIndex ? i - 1 : i);
      }
      setBookingData({ palmGroups: groups });
      if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { palmGroups: groups });
  };

  const analyzePalmGroup = async (id: string) => {
      const groups = [...(bookingData.palmGroups || [])];
      const idx = groups.findIndex(z => z.id === id);
      if (idx === -1) return;
      const group = groups[idx];
      
      try {
          setPalmAnalyzingZoneIds(prev => new Set(prev).add(id));
          const photoUrls = (group as any).photoUrls || [];
          
          const debugInputs = {
             description: '',
             photoCount: photoUrls.length,
             selectedServiceIds: bookingData.serviceIds,
             photoUrls: photoUrls,
             serviceName: 'Poda de palmeras',
             model: aiModel
          };

          const res = await estimateWorkWithAI(debugInputs);
          
          const currentDebugInfo: AnalysisDebugInfo = {
              service: 'Poda de palmeras',
              model: aiModel,
              promptInputs: debugInputs,
              rawResponse: res.rawResponse,
              parsedResponse: res.palmas,
              finalAnalysisData: {},
              errors: [],
              timestamp: new Date().toISOString()
          };
          setDebugLogs(currentDebugInfo);

          if (!res.palmas || res.palmas.length === 0) {
              throw new Error('No se han detectado palmeras claras en la imagen.');
          }

          const p0 = res.palmas[0];
          group.species = p0.especie ? p0.especie.charAt(0).toUpperCase() + p0.especie.slice(1) : 'Desconocida';
          group.height = p0.altura;
          group.state = normalizePalmState(p0.estado);
          group.analysisLevel = p0.nivel_analisis;
          group.observations = p0.observaciones || [];
          (group as any).isFailed = group.analysisLevel === 3;
          (group as any).hasPhytosanitary = supportsPhytosanitaryForSpecies(group.species);
          groups[idx] = group;

          for (let i = 1; i < res.palmas.length; i++) {
              const p = res.palmas[i];
              groups.push({
                  id: `palm-ai-${Date.now()}-${i}`,
                  species: p.especie ? p.especie.charAt(0).toUpperCase() + p.especie.slice(1) : 'Desconocida',
                  height: p.altura,
                  quantity: 1,
                  state: normalizePalmState(p.estado),
                  wasteRemoval: true,
                  hasPhytosanitary: supportsPhytosanitaryForSpecies(p.especie ? p.especie.charAt(0).toUpperCase() + p.especie.slice(1) : 'Desconocida'),
                  analysisLevel: p.nivel_analisis,
                  observations: p.observaciones || [],
                  photoUrls: [...photoUrls],
                  isFailed: p.nivel_analisis === 3
              } as any);
          }

          await updatePalmPricing(groups);
          setBookingData({ palmGroups: groups });
          if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { palmGroups: groups });
          
          currentDebugInfo.finalAnalysisData = { palmGroups: groups };
          setDebugLogs({...currentDebugInfo});
          
          saveProgress();
      } catch (e: any) {
          console.error(e);
          setDebugLogs(prev => prev ? ({...prev, errors: [...prev.errors, e]}) : {
              service: 'Poda de palmeras',
              model: aiModel,
              promptInputs: {},
              rawResponse: {},
              parsedResponse: {},
              finalAnalysisData: {},
              errors: [e],
              timestamp: new Date().toISOString()
          });
          
          setBookingData((prev) => {
              const currentZones = prev.palmGroups || [];
              const updatedZones = currentZones.map(z => {
                  if (z.id === id) {
                      return { 
                          ...z, 
                          isFailed: true,
                          analysisLevel: 3,
                          observations: [e.message || 'Error en el análisis. Por favor, reintente.']
                      } as any;
                  }
                  return z;
              });
              
              const activeServiceId = prev.serviceIds?.[0] || '';
              const nextServicesData = activeServiceId
                  ? {
                      ...prev.servicesData,
                      [activeServiceId]: {
                          ...(prev.servicesData?.[activeServiceId] || {}),
                          palmGroups: updatedZones
                      }
                  }
                  : prev.servicesData;

              return { ...prev, palmGroups: updatedZones, servicesData: nextServicesData };
          });
          
          const currentZones = bookingData.palmGroups || [];
          const updatedZones = currentZones.map(z => z.id === id ? { ...z, isFailed: true, analysisLevel: 3, observations: [e.message || 'Error en el análisis.'] } as any : z);
          await updatePalmPricing(updatedZones);
      } finally {
          setPalmAnalyzingZoneIds(prev => {
              const next = new Set(prev);
              next.delete(id);
              return next;
          });
      }
  };

  const analyzeAllPendingPalmGroups = async () => {
      const groups = bookingData.palmGroups || [];
      const pending = groups.filter(z => z.analysisLevel === undefined && ((z as any).photoUrls || []).length > 0);
      for (const z of pending) {
          await analyzePalmGroup(z.id);
      }
  };

const analyzeTreeGroup = async (id: string) => {
      const groups = [...(bookingData.treeGroups || [])];
      const idx = groups.findIndex(z => z.id === id);
      if (idx === -1) return;
      const group = groups[idx];
      
      try {
          setTreeAnalyzingZoneIds(prev => new Set(prev).add(id));
          
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


          const a = Array.isArray(res.arboles) && res.arboles.length > 0 ? res.arboles[0] : null;
          if (!a) throw new Error('No se han detectado datos válidos en las imágenes.');

          const sizeBand =
            normalizeTreeSizeBand((a as any).size_band);
          const legacyHeight = sizeBand
            ? treeSizeBandToLegacyMeters(sizeBand)
            : 0;
          group.aiSizeBand = sizeBand ?? undefined;
          group.aiHeightMeters = Number.isFinite(legacyHeight) ? legacyHeight : 0;
          // BLOQUE 2: no consumir dificultad IA para decisiones de negocio.
          group.difficultyHigh = typeof group.difficultyHigh === 'boolean' ? group.difficultyHigh : undefined;
          group.analysisLevel = Number((a as any).nivel_analisis || 3);
          group.observations = (a as any).observaciones || [];
          group.isFailed = group.analysisLevel === 3 || !group.aiSizeBand;
          group.estimatedHours = estimateTreeZoneHours(group);

          groups[idx] = group;
          const newHours = calculateTotalTreeHours(groups);
          setBookingData({ treeGroups: groups, estimatedHours: newHours });
          if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { treeGroups: groups, estimatedHours: newHours });
          
          // Update Final Debug Data
          currentDebugInfo.finalAnalysisData = { treeGroups: groups, estimatedHours: newHours };
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
          
          setBookingData((prev) => {
              const currentZones = prev.treeGroups || [];
              const updatedZones = currentZones.map(z => {
                  if (z.id === id) {
                      return { 
                          ...z, 
                          isFailed: true,
                          analysisLevel: 3,
                          observations: ['Error en el análisis. Por favor, reintente.']
                      };
                  }
                  return z;
              });
              
              const newHours = calculateTotalTreeHours(updatedZones);
              
              const activeServiceId = prev.serviceIds?.[0] || '';
              const nextServicesData = activeServiceId
                  ? {
                      ...prev.servicesData,
                      [activeServiceId]: {
                          ...(prev.servicesData?.[activeServiceId] || {}),
                          treeGroups: updatedZones,
                          estimatedHours: newHours
                      }
                  }
                  : prev.servicesData;

              return {
                  treeGroups: updatedZones,
                  estimatedHours: newHours,
                  servicesData: nextServicesData
              };
          });
      } finally {
          setTreeAnalyzingZoneIds(prev => {
              const next = new Set(prev);
              next.delete(id);
              return next;
          });
      }
  };

  const analyzeAllPendingTreeGroups = async () => {
      const zones = bookingData.treeGroups || [];
      const pending = zones.filter((z: any) => !(z.isFailed || z.analysisLevel === 1 || z.analysisLevel === 2));
      const ready = pending.filter((z: any) => Array.isArray(z.photoUrls) && z.photoUrls.length > 0);
      if (ready.length === 0) {
          toast.error('No hay árboles pendientes listos para analizar');
          return;
      }
      await Promise.allSettled(ready.map((z: any) => analyzeTreeGroup(z.id)));
  };

  // --- Shrub Logic ---
  const addShrubGroup = () => {
    const newGroup = {
        id: `shrub-${Date.now()}`,
        area: 0,
        size: 'pequeñas' as const,
        wasteRemoval: true,
        photoUrls: [] as string[],
        files: [] as File[],
        selectedIndices: [] as number[],
        analyzedIndices: [] as number[]
    };
    const newGroups = [...(bookingData.shrubGroups || []), newGroup];
    setBookingData({ shrubGroups: newGroups });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { shrubGroups: newGroups });
    saveProgress();
  };

  const removeShrubGroup = (id: string) => {
    const group = bookingData.shrubGroups?.find(z => z.id === id);
    const isAnalyzed = group && (group.area > 0 || group.analysisLevel !== undefined);

    if (isAnalyzed) {
      openConfirm({
        title: 'Eliminar resultado del análisis',
        message: 'Se eliminará este resultado del análisis y la foto se conservará.',
        confirmLabel: 'Eliminar',
        cancelLabel: 'Cancelar',
        tone: 'danger',
        onConfirm: () => {
          const newGroups = (bookingData.shrubGroups || []).map(z => {
            if (z.id === id) {
              return {
                ...z,
                area: 0,
                analysisLevel: undefined,
                observations: [],
                isFailed: false,
                analyzedIndices: []
              };
            }
            return z;
          });
          setBookingData({ shrubGroups: newGroups });
          if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { shrubGroups: newGroups });
          saveProgress();
        }
      });
    } else {
      openConfirm({
        title: 'Eliminar grupo',
        message: 'Se eliminará este grupo por completo.',
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
    }
  };

  const toggleShrubPhotoSelection = (zoneId: string, photoIndex: number) => {
      const groups = [...(bookingData.shrubGroups || [])];
      const idx = groups.findIndex(z => z.id === zoneId);
      if (idx === -1) return;
      const zone = groups[idx];
      const allUrls = zone.photoUrls || [];
      const currentSelected = zone.selectedIndices ?? allUrls.map((_, i) => i);
      const isSelected = currentSelected.includes(photoIndex);
      
      let newSelected;
      if (isSelected) {
          newSelected = currentSelected.filter(i => i !== photoIndex);
      } else {
          newSelected = [...currentSelected, photoIndex].sort((a, b) => a - b);
      }
      
      zone.selectedIndices = newSelected;
      setBookingData({ shrubGroups: groups });
      if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { shrubGroups: groups });
  };

  const removeShrubPhoto = (zoneId: string, photoIndex: number) => {
      const groups = [...(bookingData.shrubGroups || [])];
      const idx = groups.findIndex(z => z.id === zoneId);
      if (idx === -1) return;
      const zone = groups[idx];
      
      zone.photoUrls = (zone.photoUrls || []).filter((_, i) => i !== photoIndex);
      zone.selectedIndices = (zone.selectedIndices || []).filter(i => i !== photoIndex).map(i => i > photoIndex ? i - 1 : i);
      zone.analyzedIndices = (zone.analyzedIndices || []).filter(i => i !== photoIndex).map(i => i > photoIndex ? i - 1 : i);
      
      setBookingData({ shrubGroups: groups });
      if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { shrubGroups: groups });
      saveProgress();
  };

  const handleShrubFileSelect = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    const groups = [...(bookingData.shrubGroups || [])];
    const idx = groups.findIndex(z => z.id === id);
    if (idx === -1) return;
    const group = groups[idx];
    const currentPhotos = group.photoUrls || [];
    
    if (currentPhotos.length + files.length > 5) {
        toast.error('Máximo 5 fotos por grupo');
        return;
    }
    
    const startIndex = currentPhotos.length;
    const tempUrls = files.map(f => URL.createObjectURL(f));
    group.photoUrls = [...currentPhotos, ...tempUrls];

    const currentSelected = group.selectedIndices ?? currentPhotos.map((_, i) => i);
    group.selectedIndices = [...currentSelected, ...files.map((_, i) => startIndex + i)];

    setBookingData({ shrubGroups: groups });

    const newIndices = tempUrls.map((_, i) => startIndex + i);
    setShrubUploads(prev => {
        const next = { ...prev };
        const set = new Set(next[id] || []);
        newIndices.forEach(i => set.add(i));
        next[id] = set;
        return next;
    });

    try {
        for (let i = 0; i < files.length; i++) {
            const globalIndex = startIndex + i;
            const compressed = await compressImage(files[i]);
            const url = await uploadFile(compressed, globalIndex);
            if (!url) continue;

            setBookingData(prev => {
                const latest = [...(prev.shrubGroups || [])];
                const z = latest.find(x => x.id === id);
                if (z) {
                    const urls = [...(z.photoUrls || [])];
                    urls[globalIndex] = url;
                    z.photoUrls = urls;
                }
                if (prev.serviceIds?.[0]) updateServiceData(prev.serviceIds[0], { shrubGroups: latest });
                return { shrubGroups: latest };
            });
        }
    } catch (e) {
        console.error('Upload failed:', e);
        toast.error('Error al subir algunas imágenes');
    } finally {
        setShrubUploads(prev => {
            const next = { ...prev };
            const set = new Set(next[id] || []);
            newIndices.forEach(i => set.delete(i));
            if (set.size === 0) delete next[id];
            else next[id] = set;
            return next;
        });
    }

    saveProgress();
  };

  const isShrubGroupAnalyzed = (group: { area?: number; analysisLevel?: number }) => Number(group.area || 0) > 0 || group.analysisLevel !== undefined;

  const analyzeAllPendingShrubGroups = async () => {
      const groups = bookingData.shrubGroups || [];
      const ready = groups.filter(z => !isShrubGroupAnalyzed(z) && (z.photoUrls || []).length > 0 && (z.selectedIndices || []).length > 0);
      if (ready.length === 0) {
          toast.error('No hay grupos listos para analizar. Asegúrate de añadir fotos.');
          return;
      }
      await Promise.allSettled(ready.map(z => analyzeShrubGroup(z.id, { silent: true })));
  };

  const analyzeShrubGroup = async (id: string, options?: { silent?: boolean }) => {
      const groups = [...(bookingData.shrubGroups || [])];
      const idx = groups.findIndex(z => z.id === id);
      if (idx === -1) return;
      const group = groups[idx];
      const allUrls = group.photoUrls || [];
      const indicesToAnalyze = group.selectedIndices ?? allUrls.map((_, i) => i);
      const finalUrls = indicesToAnalyze.map(i => allUrls[i]).filter((u): u is string => u !== undefined && u !== '');

      if (finalUrls.length === 0) {
          if (!options?.silent) toast.error('Sube al menos una foto del macizo');
          return;
      }
      
      try {
          setAnalyzing(true);
          setShrubAnalyzingZoneIds(prev => new Set(prev).add(id));
          
          // Debug Info Prep
          const debugInputs = {
             description: '',
             photoCount: finalUrls.length,
             selectedServiceIds: bookingData.serviceIds,
             photoUrls: finalUrls,
             serviceName: 'Poda de plantas y arbustos',
             model: aiModel
          };

          const res = await estimateWorkWithAI(debugInputs);
          
          // Initialize Debug Info
          const currentDebugInfo: AnalysisDebugInfo = {
              service: 'Poda de plantas y arbustos',
              model: aiModel,
              promptInputs: debugInputs,
              rawResponse: res.rawResponse,
              parsedResponse: res.tareas,
              finalAnalysisData: {},
              errors: [],
              timestamp: new Date().toISOString()
          };
          setDebugLogs(currentDebugInfo);


          if (res.tareas && res.tareas.length > 0) {
              const t = res.tareas[0];
              
              let mappedSize: 'pequeñas' | 'medianas' | 'grandes' = 'pequeñas';
              const aiSize = String(t.tamano_dominante || '').toLowerCase();
              if (aiSize.includes('grandes')) mappedSize = 'grandes';
              else if (aiSize.includes('medianas')) mappedSize = 'medianas';

              const legacyTotal = Number(t.tamano_total_jardin_m2 || 0);
              const legacyPercent = Number(t.porcentaje_superficie_plantas || 0);
              const fallbackM2 = Number.isFinite(legacyTotal) && Number.isFinite(legacyPercent)
                ? Math.max(0, Math.round(legacyTotal * (legacyPercent / 100)))
                : 0;

              group.area = Math.max(0, Number(t.superficie_m2 ?? fallbackM2 ?? 0));
              group.size = mappedSize;
              group.analysisLevel = t.nivel_analisis;
              group.observations = t.observaciones;
              group.analyzedIndices = indicesToAnalyze;
              (group as any).isFailed = Number(t.nivel_analisis || 3) === 3;
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
              service: 'Poda de plantas y arbustos',
              model: aiModel,
              promptInputs: {},
              rawResponse: {},
              parsedResponse: {},
              finalAnalysisData: {},
              errors: [e],
              timestamp: new Date().toISOString()
          });
          
          setBookingData((prev) => {
              const currentZones = prev.shrubGroups || [];
              const updatedZones = currentZones.map(z => {
                  if (z.id === id) {
                      return { 
                          ...z, 
                          isFailed: true,
                          analysisLevel: 3,
                          observations: ['Error en el análisis. Por favor, reintente.']
                      };
                  }
                  return z;
              });
              
              const activeServiceId = prev.serviceIds?.[0] || '';
              const nextServicesData = activeServiceId
                  ? {
                      ...prev.servicesData,
                      [activeServiceId]: {
                          ...(prev.servicesData?.[activeServiceId] || {}),
                          shrubGroups: updatedZones
                      }
                  }
                  : prev.servicesData;

              return {
                  shrubGroups: updatedZones,
                  servicesData: nextServicesData
              };
          });
      } finally {
          setAnalyzing(false);
          setShrubAnalyzingZoneIds(prev => {
              const next = new Set(prev);
              next.delete(id);
              return next;
          });
      }
  };
  // --- Weeding Manual Logic (single-zone, no AI) ---
  const createDefaultWeedingZone = () => ({
      id: `weeding-${Date.now()}`,
      area: 0,
      state: 'normal' as const,
      applyHerbicide: false,
      wasteRemoval: true,
      photoUrls: [] as string[],
      files: [] as File[],
      selectedIndices: [] as number[],
      analyzedIndices: [] as number[]
  });

  const updateSingleWeedingZone = (updater: (zone: any) => any) => {
      const current = bookingData.weedingZones || [];
      const baseZone = current[0] || createDefaultWeedingZone();
      const nextZone = updater(baseZone);
      const nextZones = [nextZone];
      setBookingData({ weedingZones: nextZones });
      if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { weedingZones: nextZones });
      saveProgress();
  };

  const handleWeedingAreaChange = (value: string) => {
      const parsed = Number(value.replace(',', '.'));
      const safeArea = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      updateSingleWeedingZone((zone) => ({
          ...zone,
          area: safeArea
      }));
  };

  const handleWeedingStateChange = (state: 'normal' | 'dificultad_media' | 'dificultad_alta') => {
      updateSingleWeedingZone((zone) => ({
          ...zone,
          state
      }));
  };

  const addPhytosanitaryZone = () => {
    const newZone = {
        id: `fum-${Date.now()}`,
        type: '',
        area: 0,
        scope: undefined as PhytosanitaryScope | undefined,
        requestedTreatment: undefined as PhytosanitaryRequestTreatment | undefined,
        wantsEco: false,
        affectedType: undefined as 'Césped' | 'Árboles' | 'Setos' | 'Plantas bajas' | 'Palmeras' | undefined,
        aboveTwoMeters: undefined as boolean | undefined,
        aboveThreeMeters: undefined as boolean | undefined,
        analysisMetrics: { ...EMPTY_PHYTOSANITARY_ANALYSIS_METRICS },
        wasteRemoval: true,
        photoUrls: [] as string[],
        files: [] as File[],
        selectedIndices: [] as number[],
        analyzedIndices: [] as number[]
    };
    const newZones = [...(bookingData.phytosanitaryZones || []), newZone];
    setBookingData({ phytosanitaryZones: newZones });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { phytosanitaryZones: newZones });
    saveProgress();
  };

  const removePhytosanitaryZone = (id: string) => {
    openConfirm({
      title: 'Eliminar zona',
      message: 'Se eliminará esta zona del análisis.',
      confirmLabel: 'Eliminar zona',
      cancelLabel: 'Cancelar',
      tone: 'danger',
      onConfirm: () => {
        const newZones = (bookingData.phytosanitaryZones || []).filter(z => z.id !== id);
        setBookingData({ phytosanitaryZones: newZones });
        if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { phytosanitaryZones: newZones });
        saveProgress();
      }
    });
  };

  const handlePhytosanitaryFileSelect = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    const zones = [...(bookingData.phytosanitaryZones || [])];
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
    setPhytosanitaryUploads(prev => {
      const zoneUploads = new Set(prev[id] || []);
      newIndices.forEach(i => zoneUploads.add(i));
      return { ...prev, [id]: zoneUploads };
    });
    setBookingData({ phytosanitaryZones: zones });

    const startIdx = (bookingData.uploadedPhotoUrls?.length || 0) + Date.now();
    try {
      const uploadResults = await Promise.all(files.map((file, i) => uploadFile(file, startIdx + i)));
      const updatedZones = [...(bookingData.phytosanitaryZones || [])];
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
      setBookingData({ phytosanitaryZones: updatedZones });
      if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { phytosanitaryZones: updatedZones });
    } catch (error) {
      console.error(error);
      toast.error('Error al subir algunas imágenes');
    } finally {
      setPhytosanitaryUploads(prev => {
        const next = { ...prev };
        const zoneUploads = new Set(next[id] || []);
        newIndices.forEach(i => zoneUploads.delete(i));
        next[id] = zoneUploads;
        return next;
      });
    }
  };

  const togglePhytosanitaryPhotoSelection = (zoneId: string, photoIndex: number) => {
    const zones = [...(bookingData.phytosanitaryZones || [])];
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx === -1) return;
    const zone = { ...zones[idx] };
    const selected = new Set(zone.selectedIndices || []);
    if (selected.has(photoIndex)) selected.delete(photoIndex);
    else selected.add(photoIndex);
    zone.selectedIndices = Array.from(selected);
    zones[idx] = zone;
    setBookingData({ phytosanitaryZones: zones });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { phytosanitaryZones: zones });
  };

  const removePhytosanitaryPhoto = (zoneId: string, photoIndex: number, skipConfirm = false) => {
    const zones = [...(bookingData.phytosanitaryZones || [])];
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx === -1) return;
    const zone = { ...zones[idx] };

    const doRemove = () => {
      const photoUrls = [...(zone.photoUrls || [])];
      zone.photoUrls = photoUrls.filter((_, i) => i !== photoIndex);
      zone.selectedIndices = (zone.selectedIndices || []).filter(i => i !== photoIndex).map(i => (i > photoIndex ? i - 1 : i));
      zone.analyzedIndices = (zone.analyzedIndices || []).filter(i => i !== photoIndex).map(i => (i > photoIndex ? i - 1 : i));
      
      if (isPhytosanitaryZoneAnalyzed(zone)) {
        zone.analysisMetrics = undefined;
        zone.area = 0;
        zone.analysisLevel = undefined;
        zone.observations = [];
        zone.analyzedIndices = [];
      }

      zones[idx] = zone;
      setBookingData({ phytosanitaryZones: zones });
      if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { phytosanitaryZones: zones });
    };

    if (!skipConfirm && isPhytosanitaryZoneAnalyzed(zone)) {
      openConfirm({
        title: 'Eliminar foto analizada',
        message: 'Esta foto forma parte de un análisis completado. Si la eliminas, se borrarán los resultados actuales de esta zona y tendrás que volver a analizarla.',
        confirmLabel: 'Eliminar y resetear',
        cancelLabel: 'Cancelar',
        tone: 'danger',
        onConfirm: doRemove
      });
      return;
    }

    doRemove();
  };

  const isPhytosanitaryZoneAnalyzed = (zone: { area?: number; analysisLevel?: number }) => Number(zone.area || 0) > 0 || zone.analysisLevel !== undefined;

  const getPhytosanitarySelectedPhotoCount = (zone: { photoUrls?: string[]; selectedIndices?: number[] }) => {
    const total = zone.photoUrls?.length || 0;
    const selected = zone.selectedIndices ?? Array.from({ length: total }, (_, i) => i);
    return selected.length;
  };

  const getPhytosanitaryValidation = (zone: {
    scope?: string | string[];
    requestedTreatment?: PhytosanitaryRequestTreatment;
    wantsEco?: boolean;
    affectedType?: PhytosanitaryAffectedType;
    type?: string;
    area?: number;
    photoUrls?: string[];
    selectedIndices?: number[];
    aboveTwoMeters?: boolean;
    aboveThreeMeters?: boolean;
  }) => {
    const issues: string[] = [];
    const warnings: string[] = [];
    const selectedPhotoCount = getPhytosanitarySelectedPhotoCount(zone);
    const normalizedTreatment = normalizePhytosanitaryTreatment(zone.type || '');
    const allowedTreatments = getAllowedPhytosanitaryTreatments(zone.affectedType);

    const scopeArray = Array.isArray(zone.scope) ? zone.scope : [zone.scope].filter(Boolean) as string[];

    if (scopeArray.length === 0) issues.push('Selecciona el alcance del tratamiento.');
    if (!zone.requestedTreatment) {
      issues.push('Selecciona el tipo de tratamiento contextual.');
    }
    if (!zone.affectedType) issues.push('Selecciona la vegetación afectada.');
    if (!zone.type) issues.push('Selecciona el tratamiento solicitado.');
    if (selectedPhotoCount < 1) issues.push('Selecciona al menos 1 foto para analizar esta zona.');
    if (selectedPhotoCount > 5) issues.push('No puedes analizar más de 5 fotos por zona.');
    if (zone.type && zone.affectedType && !allowedTreatments.includes(normalizedTreatment as PhytosanitaryTreatmentValue)) {
      issues.push('El tratamiento no es compatible con la vegetación seleccionada.');
    }
    if ((zone.type || '').includes('endoterapia') && zone.wantsEco) {
      warnings.push('La opción ecológica no aplica cuando se solicita endoterapia.');
    }

    return { issues, warnings };
  };

  const removePhytosanitaryMetricItem = (zoneId: string, metricKey: PhytosanitaryMetricKey) => {
    const zones = [...(bookingData.phytosanitaryZones || [])];
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx === -1) return;
    const zone = { ...zones[idx] };
    const metrics = { ...((zone as any).analysisMetrics || EMPTY_PHYTOSANITARY_ANALYSIS_METRICS) } as PhytosanitaryAnalysisMetrics;
    metrics[metricKey] = 0;
    (zone as any).analysisMetrics = metrics;
    zone.area = Math.max(0, sumPhytosanitaryMetrics(metrics));

    if (zone.area === 0 && (!metrics.observaciones_ia || metrics.observaciones_ia.length === 0)) {
      (zone as any).analysisMetrics = undefined;
      zone.analysisLevel = undefined;
      zone.observations = [];
      zone.analyzedIndices = [];
    }

    zones[idx] = zone;
    setBookingData({ phytosanitaryZones: zones });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { phytosanitaryZones: zones });
  };

  const removePhytosanitaryObservation = (zoneId: string, observationIndex: number) => {
    const zones = [...(bookingData.phytosanitaryZones || [])];
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx === -1) return;
    const zone = { ...zones[idx] };
    const metrics = { ...((zone as any).analysisMetrics || EMPTY_PHYTOSANITARY_ANALYSIS_METRICS) } as PhytosanitaryAnalysisMetrics;
    const observations = Array.isArray(metrics.observaciones_ia) ? [...metrics.observaciones_ia] : [];
    metrics.observaciones_ia = observations.filter((_, i) => i !== observationIndex);
    (zone as any).analysisMetrics = metrics;
    zone.observations = metrics.observaciones_ia;

    if (zone.area === 0 && (!metrics.observaciones_ia || metrics.observaciones_ia.length === 0)) {
      (zone as any).analysisMetrics = undefined;
      zone.analysisLevel = undefined;
      zone.observations = [];
      zone.analyzedIndices = [];
    }

    zones[idx] = zone;
    setBookingData({ phytosanitaryZones: zones });
    if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { phytosanitaryZones: zones });
  };

  const analyzePhytosanitaryZone = async (id: string, options?: { silent?: boolean }) => {
      const zones = [...(bookingData.phytosanitaryZones || [])];
      const idx = zones.findIndex(z => z.id === id);
      if (idx === -1) return false;
      const zone = zones[idx];
      const allUrls = zone.photoUrls || [];
      const indicesToAnalyze = zone.selectedIndices ?? allUrls.map((_, i) => i);
      const finalUrls = indicesToAnalyze.map(i => allUrls[i]).filter((u): u is string => u !== undefined);
      if (finalUrls.length === 0) {
          if (!options?.silent) toast.error('Selecciona al menos una foto para analizar.');
          return false;
      }
      const validation = getPhytosanitaryValidation(zone);
      if (validation.issues.length > 0) {
          if (!options?.silent) toast.error(validation.issues[0]);
          return false;
      }
      
      setPhytosanitaryAnalyzingZoneIds(prev => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });

      const currentScope = Array.isArray(zone.scope) ? zone.scope : [zone.scope || 'todo_jardin'];
      
      const scaleHints = [
        `tipo_afectado=${zone.affectedType || 'Plantas bajas'}`,
        `tratamiento_contextual=${zone.requestedTreatment || 'insecticida'}`,
        `tratamiento_solicitado=${zone.type || 'ecologico_preventivo'}`,
        `wants_eco=${zone.wantsEco ? 'true' : 'false'}`,
        zone.aboveTwoMeters !== undefined ? `seto_supera_2m=${zone.aboveTwoMeters}` : '',
        zone.aboveThreeMeters !== undefined ? `vegetacion_supera_3m=${zone.aboveThreeMeters}` : ''
      ].filter(Boolean).join('; ');
      
      const currentDebugInfo = createDebugInfo({
        service: 'Servicios fitosanitarios',
        model: aiModel,
        promptInputs: {
          description: scaleHints,
          photoCount: finalUrls.length,
          selectedServiceIds: bookingData.serviceIds,
          photoUrls: finalUrls,
          serviceName: 'Servicios fitosanitarios',
          zoneId: zone.id,
          phytosanitary_scopes: currentScope,
          zoneContext: {
            scope: currentScope,
            affectedType: zone.affectedType,
            requestedTreatment: zone.requestedTreatment,
            type: zone.type,
            wantsEco: zone.wantsEco,
            selectedIndices: indicesToAnalyze
          }
        },
        finalAnalysisData: {
          zoneId: zone.id,
          before: {
            area: zone.area,
            analysisLevel: zone.analysisLevel,
            observations: zone.observations,
            analysisMetrics: zone.analysisMetrics
          }
        }
      });
      setDebugLogs(currentDebugInfo);

      try {
          const res = await estimateWorkWithAI({
             description: scaleHints,
             photoCount: finalUrls.length,
             selectedServiceIds: bookingData.serviceIds,
             photoUrls: finalUrls,
             serviceName: 'Servicios fitosanitarios',
             model: aiModel,
             phytosanitary_scopes: currentScope
          });
          
          const resData = res as any;

          currentDebugInfo.rawResponse = res.rawResponse;
          currentDebugInfo.parsedResponse = {
            tareas: res.tareas || [],
            reasons: res.reasons || [],
            metricas_fitosanitarias: resData.metricas_fitosanitarias
          };
          setDebugLogs({ ...currentDebugInfo });
          

          if (resData.metricas_fitosanitarias) {
              const rawMetrics = resData.metricas_fitosanitarias;
              const metrics: PhytosanitaryAnalysisMetrics = {
                ...EMPTY_PHYTOSANITARY_ANALYSIS_METRICS,
                cesped_m2: Number(rawMetrics.cesped_m2 || 0),
                seto_bajo_medio_ml: Number(rawMetrics.seto_bajo_medio_ml || 0),
                seto_alto_ml: Number(rawMetrics.seto_alto_ml || 0),
                palmeras_ducha_peq_ud: Number(rawMetrics.palmeras_ducha_peq_ud || 0),
                palmeras_ducha_med_ud: Number(rawMetrics.palmeras_ducha_med_ud || 0),
                palmeras_ducha_alta_ud: Number(rawMetrics.palmeras_ducha_alta_ud || 0),
                palmeras_cirugia_ud: Number(rawMetrics.palmeras_cirugia_ud || 0),
                palmeras_endoterapia_troncos_ud: Number(rawMetrics.palmeras_endoterapia_troncos_ud || 0),
                arboles_peq_ud: Number(rawMetrics.arboles_peq_ud || 0),
                arboles_med_ud: Number(rawMetrics.arboles_med_ud || 0),
                arboles_gran_ud: Number(rawMetrics.arboles_gran_ud || 0),
                observaciones_ia: Array.isArray(rawMetrics.observaciones_ia) ? rawMetrics.observaciones_ia : []
              };
              zone.analysisMetrics = metrics;
              zone.area = Math.max(0, sumPhytosanitaryMetrics(metrics));
              zone.analysisLevel = 1; // Or infer from confidence if we add it back
              zone.observations = resData.observaciones_ia || [];
              zone.analyzedIndices = indicesToAnalyze;
              currentDebugInfo.finalAnalysisData = {
                zoneId: zone.id,
                after: {
                  area: zone.area,
                  analysisLevel: zone.analysisLevel,
                  observations: zone.observations,
                  analyzedIndices: zone.analyzedIndices,
                  analysisMetrics: zone.analysisMetrics
                }
              };
          } else if (res.tareas && res.tareas.length > 0) {
              // Legacy support just in case
              const t = res.tareas[0];
              const rawMetrics = (t as any).metricas_fitosanitarias || resData.metricas_fitosanitarias || {};
              const metrics: PhytosanitaryAnalysisMetrics = {
                ...EMPTY_PHYTOSANITARY_ANALYSIS_METRICS,
                cesped_m2: Number(rawMetrics.cesped_m2 || 0),
                seto_bajo_medio_ml: Number(rawMetrics.seto_bajo_medio_ml || 0),
                seto_alto_ml: Number(rawMetrics.seto_alto_ml || 0),
                palmeras_ducha_peq_ud: Number(rawMetrics.palmeras_ducha_peq_ud || 0),
                palmeras_ducha_med_ud: Number(rawMetrics.palmeras_ducha_med_ud || 0),
                palmeras_ducha_alta_ud: Number(rawMetrics.palmeras_ducha_alta_ud || 0),
                palmeras_cirugia_ud: Number(rawMetrics.palmeras_cirugia_ud || 0),
                palmeras_endoterapia_troncos_ud: Number(rawMetrics.palmeras_endoterapia_troncos_ud || 0),
                arboles_peq_ud: Number(rawMetrics.arboles_peq_ud || 0),
                arboles_med_ud: Number(rawMetrics.arboles_med_ud || 0),
                arboles_gran_ud: Number(rawMetrics.arboles_gran_ud || 0),
                observaciones_ia: Array.isArray(rawMetrics.observaciones_ia) ? rawMetrics.observaciones_ia : []
              };
              zone.analysisMetrics = metrics;
              zone.area = Math.max(Number(t.cantidad_o_superficie || 0), sumPhytosanitaryMetrics(metrics));
              zone.analysisLevel = t.nivel_analisis;
              zone.observations = t.observaciones;
              zone.analyzedIndices = indicesToAnalyze;
              currentDebugInfo.finalAnalysisData = {
                zoneId: zone.id,
                after: {
                  area: zone.area,
                  analysisLevel: zone.analysisLevel,
                  observations: zone.observations,
                  analyzedIndices: zone.analyzedIndices,
                  analysisMetrics: zone.analysisMetrics
                }
              };
          } else {
             throw new Error('No se han detectado datos válidos en las imágenes.');
          }

          zones[idx] = zone;
          setBookingData({ phytosanitaryZones: zones });
          if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { phytosanitaryZones: zones });
          setDebugLogs({ ...currentDebugInfo });
          saveProgress();
          return true;
      } catch (e: any) {
          console.error(e);
          currentDebugInfo.errors.push(e?.message || String(e));
          currentDebugInfo.finalAnalysisData = {
            ...(currentDebugInfo.finalAnalysisData || {}),
            zoneId: zone.id,
            failed: true
          };
          setDebugLogs({ ...currentDebugInfo });
          
          setBookingData((prev) => {
              const currentZones = prev.phytosanitaryZones || [];
              const updatedZones = currentZones.map(z => {
                  if (z.id === id) {
                      return { 
                          ...z, 
                          isFailed: true,
                          analysisLevel: 3,
                          observations: ['Error en el análisis. Por favor, reintente.']
                      };
                  }
                  return z;
              });
              
              const activeServiceId = prev.serviceIds?.[0] || '';
              const nextServicesData = activeServiceId
                  ? {
                      ...prev.servicesData,
                      [activeServiceId]: {
                          ...(prev.servicesData?.[activeServiceId] || {}),
                          phytosanitaryZones: updatedZones
                      }
                  }
                  : prev.servicesData;

              return {
                  phytosanitaryZones: updatedZones,
                  servicesData: nextServicesData
              };
          });
          
          return false;
      } finally {
          setPhytosanitaryAnalyzingZoneIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
      }
  };

  const analyzeAllPhytosanitaryZones = async () => {
    const zones = bookingData.phytosanitaryZones || [];
    const pending = zones.filter(zone => !isPhytosanitaryZoneAnalyzed(zone) && !phytosanitaryAnalyzingZoneIds.has(zone.id));
    if (pending.length === 0) return;

    const analyzable = pending.filter(zone => {
      const validation = getPhytosanitaryValidation(zone);
      return validation.issues.length === 0;
    });
    if (analyzable.length === 0) {
      toast.error('Completa vegetación, altura contextual y 1-5 fotos en las zonas pendientes');
      return;
    }

    const results = await Promise.allSettled(analyzable.map(zone => analyzePhytosanitaryZone(zone.id, { silent: true })));
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
            {(!debugService.includes('Corte de césped') && !debugService.includes('césped') && !debugService.toLowerCase().includes('desbroce') && !debugService.toLowerCase().includes('malas hierbas')) && (
                <span className="text-sm text-gray-500">{photos.length}/5</span>
            )}
          </div>
          <p className="text-gray-600 text-sm mb-4">
            {serviceContent.description}
          </p>

             <div className="flex flex-col gap-4">
               {(() => {
                   const normalizedServiceName = (debugService || '').toLowerCase();
                   const isLawnService = normalizedServiceName.includes('corte de césped') || normalizedServiceName.includes('césped') || normalizedServiceName.includes('cesped');
                   const isHedgeService = normalizedServiceName.includes('seto');
                   const isTreeService = normalizedServiceName.includes('árbol') || normalizedServiceName.includes('arbol');
                   const isPalmService = normalizedServiceName.includes('palmera');
                   const isShrubService = normalizedServiceName.includes('poda de plantas') || (normalizedServiceName.includes('poda') && !isTreeService && !isPalmService);
                   const isPhytosanitaryService = normalizedServiceName.includes('fitosanit');
                   const isWeedingService = normalizedServiceName.includes('desbroce') || normalizedServiceName.includes('malas hierbas');
                   
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
                                    return <AnalysisLoadingAnimation key={zone.id} message={loadingMessage} />;
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
                                         <ZonePhotoGallery
                                             photos={allPhotos}
                                             uploadingIndices={lawnUploads[zone.id]}
                                             selectedIndices={zone.selectedIndices}
                                             analyzedIndices={zone.analyzedIndices}
                                             isAnalyzing={isZoneAnalyzing}
                                             isAnalyzed={isAnalyzed}
                                             onToggleSelection={(i) => toggleLawnPhotoSelection(zone.id, i)}
                                             onRemovePhoto={(i) => removePhotoFromZone(zone.id, i)}
                                             onAddPhotos={(e) => handleLawnFileSelect(zone.id, e)}
                                         />

                                         {/* Actions / Results */}
                                         <div className="mt-2">
                                             {!isAnalyzed && allPhotos.length > 0 && (
                                                 <ZoneActionButton
                                                     onClick={() => analyzeLawnZone(zone.id)}
                                                     isAnalyzing={isZoneAnalyzing}
                                                     isAnalyzed={isAnalyzed}
                                                     disabled={isZoneAnalyzing || (zone.selectedIndices !== undefined && zone.selectedIndices.length === 0)}
                                                 />
                                             )}
                                             {allPhotos.length === 0 && (
                                                 <p className="text-xs text-center text-amber-600 mt-2 mb-4">
                                                     Añade al menos una foto para analizar
                                                 </p>
                                             )}
                                         </div>

                                         {isAnalyzed && (
                                             <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                                {zone.isFailed || zone.analysisLevel === 3 ? (
                                                    <AnalysisFailedCard 
                                                        message={zone.observations?.[0]} 
                                                        onReanalyze={() => analyzeLawnZone(zone.id)} 
                                                    />
                                                ) : (
                                                    <ServiceResultCard
                                                        title={zone.species || 'Césped general'}
                                                        analysisLevel={zone.analysisLevel}
                                                        stats={[
                                                            { label: 'Superficie', value: `${zone.quantity} m²` },
                                                            { label: 'Estado', value: <span className="capitalize">{zone.state}</span> }
                                                        ]}
                                                        observations={zone.observations}
                                                        onDelete={() => {
                                                            openConfirm({
                                                                title: '¿Eliminar resultado?',
                                                                message: 'Se borrarán los datos del análisis, pero las fotos se mantendrán para poder re-analizar.',
                                                                onConfirm: () => {
                                                                    const zones = [...(bookingData.lawnZones || [])];
                                                                    const idx = zones.findIndex(z => z.id === zone.id);
                                                                    if (idx !== -1) {
                                                                        zones[idx] = { ...zones[idx], quantity: 0, species: '', state: 'normal', analysisLevel: undefined, observations: [], analyzedIndices: [] };
                                                                        setBookingData({ lawnZones: zones });
                                                                        if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { lawnZones: zones });
                                                                    }
                                                                }
                                                            });
                                                        }}
                                                    />
                                                )}
                                                
                                                <div className="mt-3">
                                                    <ZoneActionButton
                                                         onClick={() => analyzeLawnZone(zone.id)}
                                                         isAnalyzing={isZoneAnalyzing}
                                                         isAnalyzed={isAnalyzed}
                                                         disabled={isZoneAnalyzing || (zone.selectedIndices !== undefined && zone.selectedIndices.length === 0) || allPhotos.length === 0}
                                                     />
                                                </div>
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
                                         className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium mt-4"
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
                                const faceASelected = normalizedZone.faceA.selectedIndices ?? Array.from({ length: faceAUrls.length }, (_, i) => i);
                                const hasFaceAPhotos = faceAUrls.length > 0;
                                const hasFaceASelected = faceASelected.length > 0;
                                const totalPhotos = (normalizedZone.faceA.photoUrls?.length || 0) + (normalizedZone.faceB.photoUrls?.length || 0);

                                if (isZoneAnalyzing) {
                                    return <AnalysisLoadingAnimation key={zone.id} message="Analizando esta zona..." />;
                                }

                                if ((zone as any).isFailed || zone.analysisLevel === 3) {
                                    return (
                                        <AnalysisFailedCard 
                                            key={zone.id}
                                            message={zone.observations?.[0]} 
                                            onReanalyze={() => analyzeHedgeZone(zone.id)} 
                                        />
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
                                                       </div>
                                                       
                                                       <ZonePhotoGallery
                                                           photos={allFacePhotos}
                                                           uploadingIndices={hedgeUploads[uploadKey] || new Set()}
                                                           selectedIndices={face.selectedIndices ?? Array.from({ length: allFacePhotos.length }, (_, i) => i)}
                                                           analyzedIndices={face.analyzedIndices ?? []}
                                                           isAnalyzing={isZoneAnalyzing}
                                                           isAnalyzed={isAnalyzed}
                                                           maxPhotos={5}
                                                           onToggleSelection={(i) => toggleHedgePhotoSelection(zone.id, faceBlock.key, i)}
                                                           onRemovePhoto={(i) => removePhotoFromHedgeZone(zone.id, faceBlock.key, i)}
                                                           onAddPhotos={(e) => handleHedgeFileSelect(zone.id, faceBlock.key, e)}
                                                           emptyText={`Fotos ${faceBlock.title}`}
                                                       />

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
                                            <ZoneActionButton
                                                 isAnalyzing={isZoneAnalyzing}
                                                 isAnalyzed={isAnalyzed}
                                                 disabled={isZoneAnalyzing || !hasFaceAPhotos || !hasFaceASelected}
                                                 onClick={() => analyzeHedgeZone(zone.id)}
                                                 analyzingText="Analizando..."
                                                reanalyzeText="Reanalizar esta zona"
                                                analyzeText="Analizar esta zona"
                                            />
                                        </div>

                                        {isAnalyzed && (
                                            <ServiceResultCard
                                                title={zone.type || '1-2m'}
                                                analysisLevel={zone.analysisLevel}
                                                stats={[
                                                    { label: 'Longitud', value: `${zone.length} m` },
                                                    { label: 'Altura', value: zone.height },
                                                    { label: 'Estado', value: <span className="capitalize">{zone.state || 'normal'}</span> },
                                                    { label: 'Caras analizadas', value: Number((zone as any).faces_to_trim ?? (zone.hasBackFaceTrim ? 2 : 1)) }
                                                ]}
                                                observations={zone.observations}
                                            />
                                        )}
                                     </div>
                                 );
                             })}

                             {(() => {
                                 const hedgeZones = bookingData.hedgeZones || [];
                                 const pendingHedgeZones = hedgeZones.filter(zone => !isHedgeZoneAnalyzed(zone) && !hedgeAnalyzingZoneIds.has(zone.id));
                                 if (hedgeZones.length <= 1 || pendingHedgeZones.length <= 1) return null;

                                 return (
                                     <button
                                         onClick={analyzeAllPendingHedgeZones}
                                         disabled={hedgeAnalyzingZoneIds.size > 0}
                                         className={`w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                                            hedgeAnalyzingZoneIds.size > 0
                                             ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                             : 'bg-green-600 text-white hover:bg-green-700'
                                         }`}
                                     >
                                         {hedgeAnalyzingZoneIds.size > 0 ? (
                                             <>
                                                 <div className="animate-spin rounded-full h-4 w-4 border-2 border-green-600 border-t-transparent"></div>
                                                 Analizando zonas...
                                             </>
                                         ) : `Analizar ${pendingHedgeZones.length} zona${pendingHedgeZones.length === 1 ? '' : 's'}`}
                                     </button>
                                 );
                             })()}

                             {(bookingData.hedgeZones && bookingData.hedgeZones.length > 0) && (
                                 <button onClick={addHedgeZone} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:bg-gray-50 flex items-center justify-center gap-2">
                                     <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm">+</span> 
                                     Añadir otra zona
                                 </button>
                             )}
                         </div>
                     );
                   }

                   if (isPalmService) {
                     return (
                         <div className="space-y-6">
                             {(!bookingData.palmGroups || bookingData.palmGroups.length === 0) && (
                                 <div className="text-center py-8 bg-white rounded-xl border border-gray-200 shadow-sm">
                                     <Trees className="w-12 h-12 text-green-500 mx-auto mb-3" />
                                     <h3 className="text-lg font-medium text-gray-900 mb-1">Añade tus palmeras</h3>
                                     <p className="text-gray-500 text-sm mb-4 max-w-xs mx-auto">
                                         Sube una foto por cada tipo de palmera diferente para estimar la poda.
                                     </p>
                                     <button onClick={addPalmGroup} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium mt-4">+ Añadir grupo de palmeras</button>
                                 </div>
                             )}
                             {(bookingData.palmGroups || []).map((zone, idx) => {
                                 const isAnalyzed = zone.analysisLevel !== undefined;
                                 const photoUrls = (zone as any).photoUrls || [];
                                 const isZoneAnalyzing = palmAnalyzingZoneIds.has(zone.id);
                                 const isFailedResult = (zone as any).isFailed === true || zone.analysisLevel === 3;
                                 const hasResult = isAnalyzed || isFailedResult;

                                 if (isZoneAnalyzing) {
                                     return <AnalysisLoadingAnimation key={zone.id} message="Analizando palmeras..." />;
                                 }

                                 return (
                                     <div key={zone.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                         <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                                             <div className="flex items-center gap-2">
                                                 <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">
                                                     {idx + 1}
                                                 </div>
                                                 <h3 className="font-semibold text-gray-900">Grupo de Palmeras {idx + 1}</h3>
                                                <span className="text-xs text-gray-500 ml-1 font-normal">({photoUrls.length}/5 fotos)</span>
                                             </div>
                                             <button onClick={() => removePalmGroup(zone.id)} className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-5 h-5" /></button>
                                         </div>
                                         
                                         <ZonePhotoGallery
                                             photos={photoUrls}
                                             uploadingIndices={palmUploads[zone.id] || new Set()}
                                             selectedIndices={(zone as any).selectedIndices ?? Array.from({ length: photoUrls.length }, (_, i) => i)}
                                             analyzedIndices={(zone as any).analyzedIndices ?? (isAnalyzed ? Array.from({ length: photoUrls.length }, (_, i) => i) : [])}
                                             isAnalyzing={isZoneAnalyzing}
                                             isAnalyzed={hasResult}
                                             maxPhotos={5}
                                             onToggleSelection={(i) => togglePalmPhotoSelection(zone.id, i)}
                                             onRemovePhoto={(i) => removePalmPhoto(zone.id, i)}
                                             onAddPhotos={(e) => handlePalmFileSelect(zone.id, e)}
                                             emptyText="Fotos de este grupo"
                                         />

                                         <div className="mt-2">
                                             <ZoneActionButton
                                                 isAnalyzing={isZoneAnalyzing}
                                                 isAnalyzed={hasResult}
                                                 disabled={isZoneAnalyzing || photoUrls.length === 0}
                                                 onClick={() => {
                                                     if (hasResult) {
                                                         const next = [...(bookingData.palmGroups || [])];
                                                         const z = next.find(x => x.id === zone.id);
                                                         if (z) {
                                                             z.analysisLevel = undefined;
                                                             z.observations = [];
                                                             (z as any).isFailed = false;
                                                             setBookingData({ palmGroups: next });
                                                             if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { palmGroups: next });
                                                         }
                                                     }
                                                     setTimeout(() => analyzePalmGroup(zone.id), 0);
                                                 }}
                                                 analyzingText="Analizando..."
                                                 reanalyzeText="Reanalizar esta zona"
                                                 analyzeText="Analizar esta zona"
                                             />
                                             {photoUrls.length === 0 && (
                                                 <p className="text-xs text-center text-amber-600 mt-2">
                                                     Añade al menos una foto para analizar
                                                 </p>
                                             )}
                                         </div>

                                         {hasResult && (
                                            <div className="mt-4">
                                                {isFailedResult ? (
                                                    <AnalysisFailedCard 
                                                        message={zone.observations?.[0] || 'Intenta hacer la foto desde otro ángulo.'} 
                                                        onReanalyze={() => analyzePalmGroup(zone.id)} 
                                                    />
                                                ) : (
                                                    <ServiceResultCard
                                                        title={zone.species || 'Desconocida'}
                                                        analysisLevel={zone.analysisLevel}
                                                        stats={[
                                                            { label: 'Altura', value: zone.height || '-' },
                                                            { label: 'Estado', value: <span className="capitalize">{zone.state || 'normal'}</span> }
                                                        ]}
                                                        observations={zone.observations}
                                                        onDelete={() => removePalmGroup(zone.id)}
                                                    >
                                                        {/* Line 3: Quantity (Editable) */}
                                                        <div className="text-xs text-gray-600 flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                                                            <span className="font-medium text-gray-700">Cantidad de palmeras idénticas:</span>
                                                            <div className="flex items-center border border-gray-300 rounded-md bg-white">
                                                                <button 
                                                                    className="px-2 py-0.5 hover:bg-gray-100 text-gray-600 border-r border-gray-200"
                                                                    onClick={() => handlePalmQuantityChange(zone.id, (zone.quantity || 1) - 1)}
                                                                >
                                                                    -
                                                                </button>
                                                                <input 
                                                                    type="number" 
                                                                    min="1" 
                                                                    value={zone.quantity} 
                                                                    onChange={(e) => handlePalmQuantityChange(zone.id, parseInt(e.target.value) || 1)}
                                                                    className="w-10 text-center text-sm py-0.5 focus:outline-none"
                                                                />
                                                                <button 
                                                                    className="px-2 py-0.5 hover:bg-gray-100 text-gray-600 border-l border-gray-200"
                                                                    onClick={() => handlePalmQuantityChange(zone.id, (zone.quantity || 1) + 1)}
                                                                >
                                                                    +
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Servicios extras recomendados */}
                                                        {(supportsPhytosanitaryForSpecies(zone.species) || supportsTrunkPeelingForSpecies(zone.species)) && (
                                                            <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                                                                <h5 className="text-sm font-semibold text-gray-800 mb-3">Servicios extras recomendados</h5>
                                                                
                                                                {supportsPhytosanitaryForSpecies(zone.species) && (
                                                                    <label className={`flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200 ${
                                                                        (zone as any).hasPhytosanitary ? 'bg-green-50 border-green-500 ring-1 ring-green-500' : 'bg-white border-gray-200 hover:border-green-300 hover:bg-gray-50'
                                                                    }`}>
                                                                        <span className={`text-sm font-medium ${(zone as any).hasPhytosanitary ? 'text-green-800' : 'text-gray-700'}`}>
                                                                            Tratamiento de insecticida y fungicida para prevenir plagas
                                                                        </span>
                                                                        <div className={`relative shrink-0 w-11 h-6 transition-colors duration-200 ease-in-out rounded-full ${(zone as any).hasPhytosanitary ? 'bg-green-500' : 'bg-gray-200'}`}>
                                                                            <span className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ease-in-out shadow-sm ${(zone as any).hasPhytosanitary ? 'translate-x-5' : 'translate-x-0'}`} />
                                                                            <input 
                                                                                type="checkbox" 
                                                                                className="sr-only"
                                                                                checked={(zone as any).hasPhytosanitary || false}
                                                                                onChange={(e) => {
                                                                                    const isChecking = e.target.checked;
                                                                                    if (isChecking) {
                                                                                        updatePalmGroup(zone.id, { hasPhytosanitary: true } as any);
                                                                                    } else {
                                                                                        openConfirm({
                                                                                            title: '¿Estás seguro de omitir este tratamiento?',
                                                                                            message: 'El tratamiento de insecticida y fungicida es esencial para palmeras recién podadas. Previene infecciones graves como el picudo rojo y protege la salud de tu palmera tras el corte. No es recomendable omitirlo.',
                                                                                            confirmLabel: 'No aplicar tratamiento',
                                                                                            cancelLabel: 'Mantener servicio extra',
                                                                                            tone: 'phytosanitary_warning',
                                                                                            onConfirm: () => {
                                                                                                updatePalmGroup(zone.id, { hasPhytosanitary: false } as any);
                                                                                            }
                                                                                        });
                                                                                    }
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    </label>
                                                                )}

                                                                {supportsTrunkPeelingForSpecies(zone.species) && (
                                                                    <label className={`flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200 ${
                                                                        (zone as any).hasTrunkPeeling ? 'bg-green-50 border-green-500 ring-1 ring-green-500' : 'bg-white border-gray-200 hover:border-green-300 hover:bg-gray-50'
                                                                    }`}>
                                                                        <span className={`text-sm font-medium block ${(zone as any).hasTrunkPeeling ? 'text-green-800' : 'text-gray-700'}`}>
                                                                            Cepillado y limpieza del tronco
                                                                            <span className="block text-[11px] font-normal text-gray-500 mt-0.5">Deja tu palmera impecable con el cepillado del tronco</span>
                                                                        </span>
                                                                        <div className={`relative shrink-0 w-11 h-6 transition-colors duration-200 ease-in-out rounded-full ${(zone as any).hasTrunkPeeling ? 'bg-green-500' : 'bg-gray-200'}`}>
                                                                            <span className={`absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 ease-in-out shadow-sm ${(zone as any).hasTrunkPeeling ? 'translate-x-5' : 'translate-x-0'}`} />
                                                                            <input 
                                                                                type="checkbox" 
                                                                                className="sr-only"
                                                                                checked={(zone as any).hasTrunkPeeling || false}
                                                                                onChange={(e) => updatePalmGroup(zone.id, { hasTrunkPeeling: e.target.checked } as any)}
                                                                            />
                                                                        </div>
                                                                    </label>
                                                                )}
                                                            </div>
                                                        )}

                                                        <div className="mt-4 pt-4 border-t border-gray-100">
                                                            <span className="block text-sm font-medium text-gray-700 mb-3">¿Se encuentra la base de la palmera en un lugar despejado para arrojar las hojas libremente al suelo?</span>
                                                            <AccessDifficultyToggle 
                                                                group={zone} 
                                                                isAccessDisabled={!hasPositiveUnits(zone.quantity) || (isLowestRangeThresholdForSpecies(zone.species, zone.height) && !bookingData.palmGroups?.some(g => g.species === zone.species && hasPositiveUnits(g.quantity) && !isLowestRangeThresholdForSpecies(g.species, g.height)))} 
                                                                updatePalmGroup={updatePalmGroup} 
                                                            />
                                                                {!hasPositiveUnits(zone.quantity) && (
                                                                    <p className="text-xs text-gray-500 mt-2">
                                                                      Indica unidades mayores a 0 para habilitar esta opción.
                                                                    </p>
                                                                )}
                                                                {hasPositiveUnits(zone.quantity) && isLowestRangeThresholdForSpecies(zone.species, zone.height) && (
                                                                    <p className="text-xs text-gray-500 mt-2">
                                                                      Acceso no aplicable en el rango mínimo de esta especie.
                                                                    </p>
                                                                )}
                                                                {hasPositiveUnits(zone.quantity) && isHighestOpenRangeForSpecies(zone.species, zone.height) && (
                                                                    <p className="text-xs text-amber-700 mt-2">
                                                                      Precio aproximado para este rango alto. El jardinero podrá proponer ajuste y requerirá tu aceptación en el chat.
                                                                    </p>
                                                                )}
                                                            </div>

                                                    </ServiceResultCard>
                                                )}
                                            </div>
                                         )}
                                     </div>
                                 );
                             })}

                             {(() => {
                                 const zones = bookingData.palmGroups || [];
                                 const pending = zones.filter((z: any) => z.analysisLevel === undefined && (z.photoUrls || []).length > 0);
                                 if (zones.length <= 1 || pending.length <= 1) return null;
                                 const isBatchAnalyzing = palmAnalyzingZoneIds.size > 0;
                                 return (
                                     <button
                                         onClick={analyzeAllPendingPalmGroups}
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
                                                 Analizando palmeras...
                                             </>
                                         ) : (`Analizar ${pending.length} grupo${pending.length === 1 ? '' : 's'}`)}
                                     </button>
                                 );
                             })()}

                             {(bookingData.palmGroups && bookingData.palmGroups.length > 0) && (
                                 <button onClick={addPalmGroup} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:bg-gray-50 flex items-center justify-center gap-2 group">
                                     <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm group-hover:bg-gray-300 transition-colors">+</span>
                                     Añadir otro grupo de palmeras
                                 </button>
                             )}
                         </div>
                     );
                   }

                   if (isTreeService) {
                     return (
                         <div className="space-y-6">
                             {(!bookingData.treeGroups || bookingData.treeGroups.length === 0) && (
                                 <div className="text-center py-8 bg-white rounded-xl border border-gray-200 shadow-sm">
                                     <Trees className="w-12 h-12 text-green-500 mx-auto mb-3" />
                                     <h3 className="text-lg font-medium text-gray-900 mb-1">Añade tus árboles</h3>
                                     <p className="text-gray-500 text-sm mb-4 max-w-xs mx-auto">
                                         Añade cada árbol o grupo de árboles para estimar el tiempo de poda.
                                     </p>
                                     <button onClick={addTreeGroup} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium mt-4">+ Añadir grupo de árboles</button>
                                 </div>
                             )}
                             {(bookingData.treeGroups || []).map((zone, idx) => {
                                 const isAnalyzed = zone.analysisLevel !== undefined;
                                 const photoUrls = zone.photoUrls || [];
                                 const isZoneAnalyzing = treeAnalyzingZoneIds.has(zone.id);
                                 const isFailedResult = (zone as any).isFailed === true || zone.analysisLevel === 3;
                                 const hasResult = isAnalyzed || isFailedResult;

                                 if (isZoneAnalyzing) {
                                     return <AnalysisLoadingAnimation key={zone.id} message="Analizando árboles..." />;
                                 }

                                 return (
                                     <div key={zone.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                         <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                                             <div className="flex items-center gap-2">
                                                 <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">
                                                     {idx + 1}
                                                 </div>
                                                 <h3 className="font-semibold text-gray-900">Grupo de Árboles {idx + 1}</h3>
                                                <span className="text-xs text-gray-500 ml-1 font-normal">({photoUrls.length}/5 fotos)</span>
                                             </div>
                                             <button onClick={() => removeTreeGroup(zone.id)} className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-5 h-5" /></button>
                                         </div>
                                         
                                         <ZonePhotoGallery
                                                    photos={photoUrls}
                                                    uploadingIndices={treeUploads[zone.id] || new Set()}
                                                    selectedIndices={(zone as any).selectedIndices ?? Array.from({ length: photoUrls.length }, (_, i) => i)}
                                                    analyzedIndices={(zone as any).analyzedIndices ?? (isAnalyzed ? Array.from({ length: photoUrls.length }, (_, i) => i) : [])}
                                                    isAnalyzing={isZoneAnalyzing}
                                             isAnalyzed={hasResult}
                                             maxPhotos={5}
                                             onToggleSelection={(i) => toggleTreePhotoSelection(zone.id, i)}
                                             onRemovePhoto={(i) => removeTreePhoto(zone.id, i)}
                                             onAddPhotos={(e) => handleTreeFileSelect(zone.id, e)}
                                             emptyText="Fotos de este grupo"
                                         />

                                         <div className="mt-2">
                                             <ZoneActionButton
                                                 isAnalyzing={isZoneAnalyzing}
                                                 isAnalyzed={hasResult}
                                                 disabled={isZoneAnalyzing || photoUrls.length === 0}
                                                 onClick={() => {
                                                     if (hasResult) {
                                                         const next = [...(bookingData.treeGroups || [])];
                                                         const z = next.find(x => x.id === zone.id);
                                                         if (z) {
                                                             z.analysisLevel = undefined;
                                                             (z as any).aiSizeBand = undefined;
                                                             z.aiHeightMeters = 0;
                                                             z.difficultyHigh = undefined;
                                                             z.observations = [];
                                                             z.isFailed = false;
                                                             z.estimatedHours = 0;
                                                             const newHours = calculateTotalTreeHours(next);
                                                             setBookingData({ treeGroups: next, estimatedHours: newHours });
                                                             if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { treeGroups: next, estimatedHours: newHours });
                                                         }
                                                     }
                                                     setTimeout(() => analyzeTreeGroup(zone.id), 0);
                                                 }}
                                                 analyzingText="Analizando..."
                                                 reanalyzeText="Reanalizar esta zona"
                                                 analyzeText="Analizar esta zona"
                                             />
                                             {photoUrls.length === 0 && (
                                                 <p className="text-xs text-center text-amber-600 mt-2">
                                                     Añade al menos una foto para analizar
                                                 </p>
                                             )}
                                         </div>

                                         {hasResult && (
                                            <div className="mt-4">
                                                {isFailedResult ? (
                                                    <AnalysisFailedCard 
                                                        message={zone.observations?.[0] || 'Intenta hacer la foto desde otro ángulo.'} 
                                                        onReanalyze={() => analyzeTreeGroup(zone.id)} 
                                                    />
                                                ) : (
                                                    <ServiceResultCard
                                                        title={zone.pruningType === 'shaping' ? 'Poda de Formación' : 'Poda Estructural'}
                                                        analysisLevel={zone.analysisLevel}
                                                        stats={[
                                                            { label: 'Tamaño', value: treeBandLabel(normalizeTreeSizeBand((zone as any).aiSizeBand)) },
                                                            { label: 'Acceso', value: typeof zone.difficultyHigh === 'boolean' ? (zone.difficultyHigh ? 'Difícil' : 'Fácil') : 'Pendiente de respuesta' }
                                                        ]}
                                                        observations={zone.observations}
                                                        onDelete={() => removeTreeAnalysisResult(zone.id)}
                                                    />
                                                )}
                                                {!isFailedResult && (
                                                    <div className="mt-3 pt-3 border-t border-gray-100">
                                                        <span className="block text-sm font-medium text-gray-700 mb-3">
                                                            ¿El acceso al árbol (base y alrededores) es fácil y está libre de obstáculos que dificulten la poda?
                                                        </span>
                                                        <TreeAccessDifficultyToggle
                                                            group={zone}
                                                            updateTreeGroup={updateTreeGroup}
                                                        />
                                                    </div>
                                                )}
                                                {normalizeTreeSizeBand((zone as any).aiSizeBand) === 'over_9' && (
                                                    <div className="mt-1 text-[10px] text-amber-700 bg-amber-50 p-1.5 rounded border border-amber-100">
                                                        El profesional tendrá que verificar el pago porque es un servicio muy complejo.
                                                    </div>
                                                )}
                                            </div>
                                         )}
                                     </div>
                                 );
                             })}

                             {(() => {
                                 const zones = bookingData.treeGroups || [];
                                 const pending = zones.filter((z: any) => z.analysisLevel === undefined && (z.photoUrls || []).length > 0);
                                 if (zones.length <= 1 || pending.length <= 1) return null;
                                 const isBatchAnalyzing = treeAnalyzingZoneIds.size > 0;
                                 return (
                                     <button
                                         onClick={analyzeAllPendingTreeGroups}
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
                                                 Analizando árboles...
                                             </>
                                         ) : (`Analizar ${pending.length} árbol${pending.length === 1 ? '' : 'es'}`)}
                                     </button>
                                 );
                             })()}

                             {(bookingData.treeGroups && bookingData.treeGroups.length > 0) && (
                                 <button onClick={addTreeGroup} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:bg-gray-50 flex items-center justify-center gap-2 group">
                                     <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm group-hover:bg-gray-300 transition-colors">+</span>
                                     Añadir otro árbol
                                 </button>
                             )}
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
                                     <p className="text-gray-500 text-sm mb-4 max-w-xs mx-auto">
                                         Añade cada grupo o macizo de plantas de manera independiente.
                                     </p>
                                     <button onClick={addShrubGroup} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium mt-4">+ Añadir grupo de plantas</button>
                                 </div>
                             )}
                             {(bookingData.shrubGroups || []).map((group, idx) => {
                                const isAnalyzed = isShrubGroupAnalyzed(group);
                                const isFailedResult = (group as any).isFailed === true || group.analysisLevel === 3;
                                const hasResult = isAnalyzed || isFailedResult;
                                 const allPhotos = [...(group.photoUrls || []), ...(group.files || [])];
                                 const isZoneAnalyzing = shrubAnalyzingZoneIds.has(group.id);

                                 if (isZoneAnalyzing) {
                                     return <AnalysisLoadingAnimation key={group.id} message="Analizando plantas y arbustos..." />;
                                 }

                                 return (
                                     <div key={group.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                                         <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                                             <div className="flex items-center gap-2">
                                                 <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">
                                                     {idx + 1}
                                                 </div>
                                                 <h3 className="font-semibold text-gray-900">Grupo de Plantas {idx + 1}</h3>
                                                <span className="text-xs text-gray-500 ml-1 font-normal">({allPhotos.length}/5 fotos)</span>
                                             </div>
                                             <button onClick={() => removeShrubGroup(group.id)} className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-5 h-5" /></button>
                                         </div>
                                         
                                         <ZonePhotoGallery
                                             photos={allPhotos}
                                             uploadingIndices={shrubUploads[group.id] || new Set()}
                                             selectedIndices={group.selectedIndices ?? Array.from({ length: allPhotos.length }, (_, i) => i)}
                                             analyzedIndices={group.analyzedIndices ?? []}
                                             isAnalyzing={isZoneAnalyzing}
                                             isAnalyzed={isAnalyzed}
                                             maxPhotos={5}
                                             onToggleSelection={(i) => toggleShrubPhotoSelection(group.id, i)}
                                             onRemovePhoto={(i) => removeShrubPhoto(group.id, i)}
                                             onAddPhotos={(e) => handleShrubFileSelect(group.id, e)}
                                             emptyText="Fotos de este grupo"
                                         />

                                         <div className="mt-2">
                                             <ZoneActionButton
                                                 isAnalyzing={isZoneAnalyzing}
                                                isAnalyzed={hasResult}
                                                 disabled={isZoneAnalyzing || (group.selectedIndices !== undefined && group.selectedIndices.length === 0) || allPhotos.length === 0}
                                                 onClick={() => analyzeShrubGroup(group.id)}
                                                 analyzingText="Analizando..."
                                                 reanalyzeText="Reanalizar esta zona"
                                                 analyzeText="Analizar esta zona"
                                             />
                                             {allPhotos.length === 0 && (
                                                 <p className="text-xs text-center text-amber-600 mt-2">
                                                     Añade al menos una foto para analizar
                                                 </p>
                                             )}
                                         </div>

                                        {hasResult && (
                                            <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                                {isFailedResult ? (
                                                    <AnalysisFailedCard
                                                        message={group.observations?.[0]}
                                                        onReanalyze={() => analyzeShrubGroup(group.id)}
                                                    />
                                                ) : (
                                                    <ServiceResultCard
                                                        title="Macizo de plantas y arbustos"
                                                        analysisLevel={group.analysisLevel}
                                                        stats={[
                                                            { label: 'Superficie', value: `${group.area} m²` },
                                                            { label: 'Tamaño dominante', value: <span className="capitalize">{group.size}</span> }
                                                        ]}
                                                        observations={group.observations}
                                                    />
                                                )}
                                            </div>
                                         )}
                                     </div>
                                 );
                             })}
                             
                             {(() => {
                                 const shrubGroups = bookingData.shrubGroups || [];
                                 const pendingShrubGroups = shrubGroups.filter(zone => !isShrubGroupAnalyzed(zone) && !shrubAnalyzingZoneIds.has(zone.id));
                                if (shrubGroups.length <= 1 || pendingShrubGroups.length <= 1) return null;

                                 return (
                                     <button
                                         onClick={analyzeAllPendingShrubGroups}
                                        disabled={shrubAnalyzingZoneIds.size > 0}
                                         className={`w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                                            shrubAnalyzingZoneIds.size > 0
                                             ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                             : 'bg-green-600 text-white hover:bg-green-700'
                                         }`}
                                     >
                                         {shrubAnalyzingZoneIds.size > 0 ? (
                                             <>
                                                 <div className="animate-spin rounded-full h-4 w-4 border-2 border-green-600 border-t-transparent"></div>
                                                 Analizando zonas...
                                             </>
                                         ) : `Analizar ${pendingShrubGroups.length} zona${pendingShrubGroups.length === 1 ? '' : 's'}`}
                                     </button>
                                 );
                             })()}

                             {(bookingData.shrubGroups && bookingData.shrubGroups.length > 0) && (
                                 <button onClick={addShrubGroup} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:bg-gray-50 flex items-center justify-center gap-2"><span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm">+</span> Añadir otro grupo</button>
                             )}
                         </div>
                     );
                   }

                   if (isWeedingService) {
                    return null;
                   }

                   if (isPhytosanitaryService) {
                    return (
                     <div className="space-y-6">
                        {(!bookingData.phytosanitaryZones || bookingData.phytosanitaryZones.length === 0) && (
                          <div className="text-center py-8 bg-white rounded-xl border border-gray-200 shadow-sm">
                            <Bug className="w-12 h-12 text-green-500 mx-auto mb-3" />
                            <h3 className="text-lg font-medium text-gray-900 mb-1">Añade zona a tratar</h3>
                            <button onClick={addPhytosanitaryZone} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium mt-4">+ Añadir zona</button>
                          </div>
                        )}
                        {(bookingData.phytosanitaryZones || []).map((zone, idx) => {
                          const isAnalyzed = isPhytosanitaryZoneAnalyzed(zone);
                          const allPhotos = zone.photoUrls || [];
                          const isZoneAnalyzing = phytosanitaryAnalyzingZoneIds.has(zone.id);
                          const validation = getPhytosanitaryValidation(zone as any);
                          const selectedPhotoCount = getPhytosanitarySelectedPhotoCount(zone);
                          const metrics = (zone as any).analysisMetrics || { ...EMPTY_PHYTOSANITARY_ANALYSIS_METRICS };
                          
                          if (isZoneAnalyzing) {
                              return <AnalysisLoadingAnimation key={zone.id} message="Analizando zona de tratamientos..." />;
                          }

                          if ((zone as any).isFailed || zone.analysisLevel === 3) {
                              return (
                                  <AnalysisFailedCard 
                                      key={zone.id}
                                      message={zone.observations?.[0]} 
                                      onReanalyze={() => analyzePhytosanitaryZone(zone.id)} 
                                  />
                              );
                          }

                          const detectedItems = PHYTOSANITARY_RESULT_FIELDS
                            .map((item) => ({
                              ...item,
                              value: Number((metrics as any)[item.key] || 0)
                            }))
                            .filter((item) => item.value > 0);
                          const aiObservations = Array.isArray(metrics.observaciones_ia) ? metrics.observaciones_ia : [];

                          return (
                            <div key={zone.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
                              <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                                <div className="flex items-center gap-2">
                                  <h3 className="font-semibold text-gray-900">Zona {idx + 1}</h3>
                                  <span className="text-xs text-gray-500">({allPhotos.length}/5 fotos)</span>
                                </div>
                                <button onClick={() => removePhytosanitaryZone(zone.id)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-5 h-5" /></button>
                              </div>

                              <div className="space-y-5">
                                <div className="space-y-3">
                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-green-700">Contexto del tratamiento</div>
                                  <div>
                                    <label className="text-xs text-gray-500 block mb-2">Alcance del tratamiento</label>
                                    <div className="flex flex-wrap gap-2">
                                      {PHYTOSANITARY_SCOPE_OPTIONS.map((option) => {
                                        const currentScope = Array.isArray((zone as any).scope) ? (zone as any).scope : [(zone as any).scope].filter(Boolean);
                                        const isSelected = currentScope.includes(option.value) || currentScope.includes(`solo_${option.value}`);
                                        return (
                                          <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => {
                                              const next = [...(bookingData.phytosanitaryZones || [])];
                                              const z = next.find(x => x.id === zone.id);
                                              if (!z) return;
                                              
                                              // Normalize current scope to remove 'solo_'
                                              let nextScope = currentScope.map((s: string) => s.replace('solo_', ''));
                                              
                                              if (option.value === 'todo_jardin') {
                                                nextScope = isSelected ? [] : ['todo_jardin'];
                                              } else {
                                                nextScope = nextScope.filter((s: string) => s !== 'todo_jardin');
                                                if (isSelected) {
                                                  nextScope = nextScope.filter((s: string) => s !== option.value);
                                                } else {
                                                  nextScope.push(option.value);
                                                }
                                              }
                                              
                                              (z as any).scope = nextScope;
                                              
                                              const firstScopeOption = PHYTOSANITARY_SCOPE_OPTIONS.find(o => nextScope.includes(o.value));
                                              z.affectedType = firstScopeOption?.affectedType;
                                              
                                              z.type = buildPhytosanitaryZoneType((z as any).scope, (z as any).requestedTreatment, (z as any).wantsEco);
                                              
                                              if (isPhytosanitaryZoneAnalyzed(z)) {
                                                (z as any).analysisMetrics = undefined;
                                                z.area = 0;
                                                z.analysisLevel = undefined;
                                                z.observations = [];
                                                z.analyzedIndices = [];
                                              }

                                              setBookingData({ phytosanitaryZones: next });
                                              if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { phytosanitaryZones: next });
                                            }}
                                            className={`px-3 py-1.5 text-sm rounded-full border transition-colors flex items-center gap-1.5 ${isSelected ? 'bg-green-100 border-green-500 text-green-800' : 'bg-white border-gray-300 text-gray-700 hover:border-green-300 hover:bg-green-50'}`}
                                          >
                                            {isSelected && <CheckCircle className="w-3.5 h-3.5" />}
                                            {option.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  <div>
                                      <label className="text-xs text-gray-500 block mb-1">Tipo de tratamiento contextual</label>
                                      <select
                                        value={(zone as any).requestedTreatment || ''}
                                        onChange={(e) => {
                                          const next = [...(bookingData.phytosanitaryZones || [])];
                                          const z = next.find(x => x.id === zone.id);
                                          if (!z) return;
                                          (z as any).requestedTreatment = e.target.value as PhytosanitaryRequestTreatment;
                                          z.type = buildPhytosanitaryZoneType((z as any).scope, (z as any).requestedTreatment, (z as any).wantsEco);
                                          
                                          if (isPhytosanitaryZoneAnalyzed(z)) {
                                            (z as any).analysisMetrics = undefined;
                                            z.area = 0;
                                            z.analysisLevel = undefined;
                                            z.observations = [];
                                            z.analyzedIndices = [];
                                          }

                                          setBookingData({ phytosanitaryZones: next });
                                          if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { phytosanitaryZones: next });
                                        }}
                                        className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white"
                                      >
                                        <option value="">Seleccionar</option>
                                        {PHYTOSANITARY_REQUEST_TREATMENT_OPTIONS.map((option) => (
                                          <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                      </select>
                                    </div>
                                  <label className={`flex items-center justify-between p-3 rounded-lg border ${(zone as any).type?.includes('endoterapia') ? 'bg-gray-50 text-gray-400 border-gray-200' : 'bg-white border-gray-300'}`}>
                                    <span className="text-sm">Quiero opción ecológica</span>
                                    <input
                                      type="checkbox"
                                      checked={Boolean((zone as any).wantsEco)}
                                      disabled={(zone as any).type?.includes('endoterapia')}
                                      onChange={(e) => {
                                        const next = [...(bookingData.phytosanitaryZones || [])];
                                        const z = next.find(x => x.id === zone.id);
                                        if (!z) return;
                                        (z as any).wantsEco = e.target.checked;
                                        z.type = buildPhytosanitaryZoneType((z as any).scope, (z as any).requestedTreatment, (z as any).wantsEco);
                                        
                                        if (isPhytosanitaryZoneAnalyzed(z)) {
                                          (z as any).analysisMetrics = undefined;
                                          z.area = 0;
                                          z.analysisLevel = undefined;
                                          z.observations = [];
                                          z.analyzedIndices = [];
                                        }

                                        setBookingData({ phytosanitaryZones: next });
                                        if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { phytosanitaryZones: next });
                                      }}
                                    />
                                  </label>
                                </div>

                                <div className="pt-4 border-t border-gray-100">
                                  <ZonePhotoGallery
                                      photos={allPhotos}
                                      uploadingIndices={phytosanitaryUploads[zone.id] || new Set()}
                                      selectedIndices={zone.selectedIndices ?? allPhotos.map((_, i) => i)}
                                      analyzedIndices={zone.analyzedIndices ?? (isAnalyzed ? allPhotos.map((_, i) => i) : [])}
                                      isAnalyzing={isZoneAnalyzing}
                                      isAnalyzed={isAnalyzed}
                                      onToggleSelection={(i) => togglePhytosanitaryPhotoSelection(zone.id, i)}
                                      onRemovePhoto={(i) => removePhytosanitaryPhoto(zone.id, i)}
                                      onAddPhotos={(e) => handlePhytosanitaryFileSelect(zone.id, e)}
                                  />

                                  <div className="mt-2">
                                      {(!isAnalyzed || (isAnalyzed && (zone.analyzedIndices && (zone.analyzedIndices.length !== selectedPhotoCount || !zone.analyzedIndices.every(i => zone.selectedIndices?.includes(i)))))) && (
                                          <ZoneActionButton
                                              onClick={() => analyzePhytosanitaryZone(zone.id)}
                                              isAnalyzing={isZoneAnalyzing}
                                              isAnalyzed={isAnalyzed}
                                              disabled={isZoneAnalyzing || validation.issues.length > 0 || selectedPhotoCount === 0}
                                              analyzeText={`Analizar ${selectedPhotoCount} foto${selectedPhotoCount === 1 ? '' : 's'}`}
                                              reanalyzeText="Reanalizar (hay cambios)"
                                          />
                                      )}
                                      
                                      {(validation.issues.length > 0 || validation.warnings.length > 0) && (
                                        <div className="p-3 rounded-lg border border-yellow-200 bg-yellow-50 text-yellow-800 text-xs space-y-1 mb-4">
                                          {validation.issues.map((issue, issueIndex) => <p key={`issue-${issueIndex}`}>{issue}</p>)}
                                          {validation.warnings.map((warning, warningIndex) => <p key={`warning-${warningIndex}`}>{warning}</p>)}
                                        </div>
                                      )}
                                  </div>

                                  {isAnalyzed && (
                                      <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                          <ServiceResultCard
                                              title="Análisis Fitosanitario"
                                              analysisLevel={zone.analysisLevel}
                                              stats={[]}
                                              onDelete={() => {
                                                  openConfirm({
                                                      title: '¿Eliminar resultado?',
                                                      message: 'Se borrarán los datos del análisis, pero las fotos se mantendrán para poder re-analizar.',
                                                      onConfirm: () => {
                                                          const next = [...(bookingData.phytosanitaryZones || [])];
                                                          const z = next.find(x => x.id === zone.id);
                                                          if (z) {
                                                              (z as any).analysisMetrics = undefined;
                                                              z.area = 0;
                                                              z.analysisLevel = undefined;
                                                              z.observations = [];
                                                              z.analyzedIndices = [];
                                                              setBookingData({ phytosanitaryZones: next });
                                                              if (bookingData.serviceIds?.[0]) updateServiceData(bookingData.serviceIds[0], { phytosanitaryZones: next });
                                                          }
                                                      }
                                                  });
                                              }}
                                          >
                                              <div className="space-y-2 mt-3">
                                                  {detectedItems.length === 0 && aiObservations.length === 0 ? (
                                                      <div className="text-sm text-gray-600">La IA no detectó elementos con cantidad.</div>
                                                  ) : (
                                                      <>
                                                          {Object.entries(PHYTOSANITARY_GROUPED_FIELDS).map(([familyName, fields]) => {
                                                              const familyItems = detectedItems.filter(item => fields.some(f => f.key === item.key));
                                                              if (familyItems.length === 0) return null;
                                                              return (
                                                                  <div key={familyName} className="mb-4 last:mb-0">
                                                                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-700 mb-2">{familyName}</div>
                                                                      <div className="space-y-2 pl-2 border-l-2 border-green-200">
                                                                          {familyItems.map((item) => {
                                                                              const fieldDef = fields.find(f => f.key === item.key);
                                                                              return (
                                                                                  <div key={item.key} className="flex items-center justify-between gap-3 bg-white/70 border border-gray-200 rounded-lg px-3 py-2">
                                                                                      <div className="text-sm text-gray-800">
                                                                                          {fieldDef?.label || item.label}: <span className="font-semibold">{item.value} {fieldDef?.unit || item.unit}</span>
                                                                                      </div>
                                                                                      <button
                                                                                          onClick={() => removePhytosanitaryMetricItem(zone.id, item.key)}
                                                                                          className="text-red-600 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50"
                                                                                      >
                                                                                          <Trash2 className="w-4 h-4" />
                                                                                      </button>
                                                                                  </div>
                                                                              );
                                                                          })}
                                                                      </div>
                                                                  </div>
                                                              );
                                                          })}
                                                          {aiObservations.length > 0 && !aiObservations.includes('none') && (
                                                              <div className={`space-y-2 ${detectedItems.length > 0 ? 'mt-3 pt-3 border-t border-gray-200/50' : ''}`}>
                                                                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Observaciones</div>
                                                                  {aiObservations.map((observation: string, observationIndex: number) => {
                                                                      if (observation === 'none') return null;
                                                                      return (
                                                                          <div key={`${observation}-${observationIndex}`} className="flex items-center justify-between gap-3 bg-white/70 border border-gray-200 rounded-lg px-3 py-2">
                                                                              <div className="text-sm text-gray-800">{OBS_TRANSLATIONS[observation] || observation}</div>
                                                                              <button
                                                                                  onClick={() => removePhytosanitaryObservation(zone.id, observationIndex)}
                                                                                  className="text-red-600 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50"
                                                                              >
                                                                                  <Trash2 className="w-4 h-4" />
                                                                              </button>
                                                                          </div>
                                                                      );
                                                                  })}
                                                              </div>
                                                          )}
                                                      </>
                                                  )}
                                              </div>
                                          </ServiceResultCard>
                                      </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {(bookingData.phytosanitaryZones || []).some(zone => !isPhytosanitaryZoneAnalyzed(zone)) && (
                          <button
                            onClick={analyzeAllPhytosanitaryZones}
                            disabled={isAnyPhytosanitaryZoneAnalyzing}
                            className={`w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors ${isAnyPhytosanitaryZoneAnalyzing ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-green-100 text-green-800 hover:bg-green-200'}`}
                          >
                            <Sparkles className="w-4 h-4" />
                            Analizar todas las zonas pendientes
                          </button>
                        )}
                        <button onClick={addPhytosanitaryZone} className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 font-medium hover:bg-gray-50 flex items-center justify-center gap-2"><span className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm">+</span> Añadir otra zona</button>
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
                       return <AnalysisLoadingAnimation message={loadingMessage} />;
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

          {!(debugService.includes('Corte de césped') || debugService.includes('césped') || debugService.includes('seto') || debugService.includes('Seto') || debugService.toLowerCase().includes('desbroce') || debugService.toLowerCase().includes('malas hierbas')) && (
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



      {/* --- Waste Removal Switch --- */}
      {/* Show only if there are valid results for Trees or Palms or Shrubs */}
      {bookingData.weedingZones && bookingData.weedingZones.length > 0 && (
          <div className="mb-6 space-y-4">
              <h3 className="text-lg font-semibold text-gray-900">Detalles del Desbroce</h3>
              {(() => {
                const zone = bookingData.weedingZones?.[0];
                if (!zone) return null;
                return (
                  <div key={zone.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-5">
                      <div>
                          <label htmlFor="weeding-area" className="block text-xs text-gray-500 mb-1">Superficie estimada</label>
                          <div className="relative">
                            <input
                                id="weeding-area"
                                type="number"
                                min={0}
                                step={1}
                                inputMode="numeric"
                                value={zone.area || ''}
                                onChange={(e) => handleWeedingAreaChange(e.target.value)}
                                placeholder="0"
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-12 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">m²</span>
                          </div>
                      </div>

                      <div>
                          <span className="block text-xs text-gray-500 mb-2">Estado de la parcela</span>
                          <div className="space-y-2">
                              {WEEDING_STATE_OPTIONS.map((option) => {
                                  const selected = zone.state === option.value;
                                  return (
                                    <label
                                      key={option.value}
                                      className={`block rounded-xl border p-3 cursor-pointer transition-colors ${selected ? 'border-green-600 bg-green-50' : 'border-gray-200 bg-white hover:border-green-300'}`}
                                    >
                                      <div className="flex items-start gap-3">
                                        <input
                                          type="radio"
                                          name="weeding-state"
                                          checked={selected}
                                          onChange={() => handleWeedingStateChange(option.value)}
                                          className="mt-0.5 h-4 w-4 accent-green-600"
                                        />
                                        <div>
                                          <div className="text-sm font-semibold text-gray-900">{option.label}</div>
                                          <div className="text-xs text-gray-500 mt-0.5">{option.description}</div>
                                        </div>
                                      </div>
                                    </label>
                                  );
                              })}
                          </div>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                          <div>
                              <span className="text-gray-700 font-medium text-sm block">Aplicar herbicida</span>
                              <span className="text-gray-500 text-xs">Previene rebrotes (requiere profesional certificado)</span>
                          </div>
                          <button
                              type="button"
                              role="switch"
                              onClick={() => handleToggleWeedingHerbicide(0)}
                              className={`${zone.applyHerbicide ? 'bg-green-600' : 'bg-gray-200'} relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0`}
                          >
                              <span className={`${zone.applyHerbicide ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition-transform`} />
                          </button>
                      </div>
                  </div>
                );
              })()}
          </div>
      )}

      {((bookingData.treeGroups && bookingData.treeGroups.filter(g => !((g as any).isFailed === true || g.analysisLevel === 3)).length > 0) || 
        (bookingData.palmGroups && bookingData.palmGroups.length > 0) || 
        (bookingData.shrubGroups && bookingData.shrubGroups.length > 0) ||
        (bookingData.weedingZones && bookingData.weedingZones.length > 0) ||
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
                <option value="Poda de plantas y arbustos">Poda de plantas y arbustos</option>
                <option value="Poda de árboles">Poda de árboles</option>
                <option value="Servicios fitosanitarios">Servicios fitosanitarios</option>
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

            {/* --- Tree Pruning Service --- */}
            {/* {debugService === 'Poda de árboles' && (
                <TreePruningBooking
                    onEstimateCalculated={(estimate) => {
                        // Aquí se puede manejar el resultado del presupuesto
                        console.log('Tree pruning estimate calculated:', estimate);
                        // TODO: Integrar con el contexto de booking
                    }}
                />
            )} */}

            {/* --- Shrubs --- */}
            {debugService === 'Poda de plantas y arbustos' && (
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

            {/* --- Phytosanitary --- */}
            {((debugService || '').toLowerCase().includes('fitosanit') || (debugService || '').toLowerCase().includes('fitosanit')) && (
                <div>
                    <label className="block text-sm font-medium text-gray-800 mb-1">Tipo tratamiento</label>
                    <select
                        value={debugPhytosanitaryType}
                        onChange={(e) => setDebugPhytosanitaryType(e.target.value)}
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
                {debugService === 'Poda de plantas y arbustos' && (
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
                                <option value="0-5">0 – 5 m</option>
                                <option value="5-12">5 – 12 m</option>
                                <option value="12-20">12 – 20 m</option>
                                <option value="20+">Más de 20 m</option>
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
                          toast.error('Añade al menos un grupo de palmeras para simular.');
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
                          hasPhytosanitary: supportsPhytosanitaryForSpecies(g.species),
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
                      const unit = lowerDebugService.includes('césped') || lowerDebugService.includes('setos') || lowerDebugService.includes('fitosanit') || lowerDebugService.includes('fitosanit') ? 'm2' : 'plantas';
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
                        cantidad_estimada: debugService.toLowerCase().includes('planta') && !debugService.toLowerCase().includes('fitosanit') && !debugService.toLowerCase().includes('fitosanit') ? qty : null,
                        tamano_promedio: debugShrubSize,
                        tipo_plantacion: debugShrubType,
                        // Phytosanitary
                        cantidad_o_superficie: qty,
                        unidad: (debugService.toLowerCase().includes('fitosanit') || debugService.toLowerCase().includes('fitosanit')) ? 'm2' : null,
                        nivel_plaga: debugPhytosanitaryType
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
                       } else if (debugService === 'Poda de plantas y arbustos') {
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
                       } else if ((debugService || '').toLowerCase().includes('fitosanit') || (debugService || '').toLowerCase().includes('fitosanit')) {
                           updatePayload.phytosanitaryZones = [{
                               id: `debug-fum-${Date.now()}`,
                               type: debugPhytosanitaryType || 'Insecticida',
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
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${confirmState.tone === 'danger' || confirmState.tone === 'phytosanitary_warning' ? 'bg-red-100' : 'bg-yellow-100'}`}>
                <AlertTriangle className={`w-6 h-6 ${confirmState.tone === 'danger' || confirmState.tone === 'phytosanitary_warning' ? 'text-red-600' : 'text-yellow-600'}`} />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">{confirmState.title}</h3>
              <p className="text-gray-500 text-center mb-6 text-sm">{confirmState.message}</p>
              <div className="flex flex-col gap-3 w-full">
                {confirmState.tone === 'phytosanitary_warning' ? (
                  <>
                    <button
                      onClick={closeConfirm}
                      className="w-full bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-600/20 py-3 px-4 rounded-xl font-bold transition-all"
                    >
                      {confirmState.cancelLabel}
                    </button>
                    <button
                      onClick={handleConfirmAction}
                      className="w-full bg-white text-red-600 border border-red-200 hover:bg-red-50 py-3 px-4 rounded-xl font-bold transition-all"
                    >
                      {confirmState.confirmLabel}
                    </button>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {(() => {
        const lowerService = (debugService || '').toLowerCase();
        const isWeedingService = lowerService.includes('desbroce') || lowerService.includes('malas hierbas');
        if (!isWeedingService) return null;
        return (
          <div className="px-4 mb-28">
            <div className="max-w-md mx-auto bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={weedingManualConfirmed}
                  onChange={(e) => setWeedingManualConfirmed(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-green-600"
                />
                <span className="text-xs text-gray-700 leading-relaxed">
                  Confirmo que las variables indicadas para el calculo del presupuesto son correctas. Acepto que, en caso de no serlo, el profesional podra recalcular el precio del desbroce en persona y deberé abonar la diferencia.
                </span>
              </label>
            </div>
          </div>
        );
      })()}

      {/* Fixed CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] z-50">
        <div className="max-w-md mx-auto">
          <button
            onClick={handleContinue}
            disabled={
              (debugService === 'Poda de palmeras' && (!bookingData.estimatedHours || bookingData.estimatedHours <= 0))
              || (
                (debugService.toLowerCase().includes('fitosanit') || debugService.toLowerCase().includes('fitosanit'))
                && (
                  (bookingData.phytosanitaryZones || []).length === 0
                  || (bookingData.phytosanitaryZones || []).some((zone) => getPhytosanitaryValidation(zone as any).issues.length > 0 || !isPhytosanitaryZoneAnalyzed(zone as any))
                )
              )
              || (() => {
                const lowerService = (debugService || '').toLowerCase();
                const isWeedingService = lowerService.includes('desbroce') || lowerService.includes('malas hierbas');
                if (!isWeedingService) return false;
                const zone = bookingData.weedingZones?.[0];
                const hasValidArea = Number(zone?.area || 0) > 0;
                const hasValidState = zone?.state === 'normal' || zone?.state === 'dificultad_media' || zone?.state === 'dificultad_alta';
                return !zone || !hasValidArea || !hasValidState || !weedingManualConfirmed;
              })()
            }
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-2xl font-semibold text-lg shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            {(() => {
                const lowerService = (debugService || '').toLowerCase();
                const isLawn = lowerService.includes('césped') || lowerService.includes('cesped');
                const isHedge = lowerService.includes('seto');
                const isPhytosanitary = lowerService.includes('fitosanit') || lowerService.includes('fitosanit');
                if (isPhytosanitary) {
                    const analyzedZones = (bookingData.phytosanitaryZones || []).filter((zone) => isPhytosanitaryZoneAnalyzed(zone as any)).length;
                    return analyzedZones > 0 ? `Continuar con ${analyzedZones} zona${analyzedZones === 1 ? '' : 's'}` : 'Continuar';
                }
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
                         toast.success('Datos técnicos copiados al portapapeles');
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
