import React, { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { createPortal } from 'react-dom';
import { useBooking, type BookingData } from "../../contexts/BookingContext";
import { ChevronLeft, Trash2, Image, Sprout, Sparkles, AlertTriangle, CheckCircle, XCircle, Info, Scissors, Trees, Flower2, Bug, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { estimateWorkWithAI, calculatePalmHours } from '../../utils/aiPricingEstimator';
import { normalizePhytosanitaryTreatment } from '../../utils/serviceValidation';
import { readWeedingHerbicideState, writeWeedingHerbicideState } from '../../utils/weedingPersistence';
import { AnalysisLoadingAnimation } from '../../components/shared/AnalysisLoadingAnimation';
import { AnalysisFailedCard } from '../../components/shared/AnalysisFailedCard';
import { buildZonePhotoRemovalConfirmation, ZonePhotoGallery } from '../../components/shared/ZonePhotoGallery';
import { ZoneActionButton } from '../../components/shared/ZoneActionButton';
import { ServiceResultCard } from '../../components/shared/ServiceResultCard';
import {
  buildBookingPhotoSelectionErrorMessage,
  fileToDataUrl,
  resolveAnalysisPhotoSources,
  validateBookingPhotoSelection,
} from '../../utils/bookingPhotoPipeline';
import { readAndResetFileInput } from '../../utils/fileInputSelection';
import {
  buildAnalysisCommonFields,
  getAnalysisLoadingMessage,
  getCanonicalAnalyzedPhotoIndices,
  getDefaultSelectedPhotoIndices,
  hasCanonicalAnalysisFailure,
  hasCanonicalAnalysisResult,
  resetAnalysisCommonFields
} from '../../shared/analysisV2Details';
import {
  EMPTY_PHYTOSANITARY_ANALYSIS_METRICS,
  adaptLawnAnalysisResult,
  adaptPhytosanitaryAnalysisResult,
  adaptShrubAnalysisResult,
  adaptTreeAnalysisResult,
  appendFilesToPhotoCollection,
  appendFilesToHedgeFaceCollection,
  appendDebugError,
  buildDetailsPageBookingPatch,
  buildAnalysisFailureFields,
  createEmptyHedgeFaceCollection,
  createDebugInfo,
  extractLawnLegacyTasks,
  getPrimaryBookingPhotoUrls,
  normalizeHedgeZonePhotoCollections,
  normalizePhotoIdentityList,
  normalizeTreeSizeBand,
  removePhotoFromHedgeFaceCollection,
  removePhotoFromCollection,
  reportDetailsPageIssue,
  syncLegacyHedgeZonePhotoCollections,
  sumPhytosanitaryMetrics,
  toggleHedgeFacePhotoSelection,
  togglePhotoSelectionInCollection,
  treeSizeBandToLegacyMeters,
  type AnalysisDebugInfo,
  type HedgeFaceKey,
  type PhytosanitaryAnalysisMetrics,
  type TreeSizeBand,
} from './detailsPageAdapters';
import {
  getDetailsContinueDisabled,
  getDetailsContinueLabel,
  getDetailsServiceFlags,
} from './detailsPagePresentation';
import {
  buildHedgeDevZone,
  buildLawnDevZone,
  buildPalmDevGroup,
  buildPhytosanitaryDevZone,
  buildShrubDevGroup,
  buildTreeDevGroup,
  buildWeedingDevZone,
  isDetailsDevAnalysisEnabled,
} from './detailsPageDevSeeds';
import {
  PALM_CANONICAL_SPECIES,
  getHighestOpenRangeThresholdForSpecies,
  getLowestRangeThresholdForSpecies,
  getPalmHeightBandsForSpecies,
  isHighestOpenRangeForSpecies,
  isLowestRangeThresholdForSpecies,
  mapPalmHeightToBand,
  resolveSpeciesBusinessRule,
  supportsPhytosanitaryForSpecies,
  supportsTrunkPeelingForSpecies
} from '../../domain/speciesBusinessRules';
import {
  HEDGE_BAND_LABELS,
  HEDGE_HEIGHT_BANDS,
  HEDGE_STATE_LABELS,
  mapHedgeHeightToBand,
  normalizeHedgeState as normalizeHedgeStateValue,
  type HedgeHeightBand,
  type HedgeState,
} from '../../domain/hedgeBusinessRules';
import { ManualEntryChoice, type DataInputMode } from '../../components/booking/manual/ManualEntryChoice';
import { ManualEntryWizard, type ManualWizardSubmitPayload } from '../../components/booking/manual/ManualEntryWizard';
import {
  MANUAL_ENTRY_SURVEYS,
  resolveManualServiceKey,
  isManualOnlyService,
} from '../../shared/manualEntry/manualEntrySchema';
import { validateManualBookingInput } from '../../shared/manualEntry/manualEntryValidation';
import { buildConsentRecord, MANUAL_ENTRY_LEGAL_VERSION } from '../../shared/manualEntry/legalCopy';
import { buildManualBookingPatch } from './manualEntryBuilders';
import { recordManualDeclaration, ManualDeclarationError } from '../../utils/bookingManualDeclarationService';
import { isManualBookingInputEnabled } from '../../utils/manualEntryFeatureFlag';
import { reportBookingEvent } from '../../utils/bookingTelemetry';
import { useAuth } from '../../contexts/AuthContext';
// import { TreeBookingGroup } from '../../domain/treePruning';
// import { TreePruningBooking } from '../../components/client/TreePruningBooking';

type PhytosanitaryAffectedType = 'Césped' | 'Árboles' | 'Setos' | 'Plantas bajas' | 'Palmeras';
type PhytosanitaryTreatmentValue = 'insecticida' | 'fungicida' | 'ecologico_preventivo' | 'endoterapia';
type PhytosanitaryScope = 'todo_jardin' | 'palmeras' | 'arboles' | 'cesped' | 'setos' | 'plantas';
type PhytosanitaryRequestTreatment = 'insecticida' | 'fungicida' | 'combo';
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

const getAllowedPhytosanitaryTreatments = (affectedType?: PhytosanitaryAffectedType): PhytosanitaryTreatmentValue[] => {
  if (affectedType === 'Palmeras') return ['insecticida', 'fungicida', 'ecologico_preventivo', 'endoterapia'];
  if (affectedType === 'Árboles' || affectedType === 'Setos') return ['insecticida', 'fungicida', 'ecologico_preventivo'];
  return ['insecticida', 'fungicida', 'ecologico_preventivo'];
};

const buildPhytosanitaryZoneType = (
  _scope: string | string[] | undefined,
  requested: PhytosanitaryRequestTreatment | undefined,
  wantsEco: boolean | undefined
) => {
  if (!requested) return '';
  if (requested === 'combo') {
    return wantsEco ? 'insecticida+fungicida+ecologico_preventivo' : 'insecticida+fungicida';
  }
  return wantsEco ? `${requested}+ecologico_preventivo` : requested;
};

const treeBandLabel = (band?: TreeSizeBand | null): string => {
  if (band === 'small') return 'Pequeño (0-3m)';
  if (band === 'medium') return 'Mediano (3-5m)';
  if (band === 'large') return 'Grande (5-9m)';
  if (band === 'over_9') return 'Muy grande (>9m)';
  return '-';
};

const TREE_BAND_OPTIONS: TreeSizeBand[] = ['small', 'medium', 'large', 'over_9'];

// Resume los árboles detectados por banda de tamaño para que el cliente
// pueda confirmar cuántos quiere podar (la IA propone, el cliente decide).
const summarizeDetectedTrees = (trees: Array<{ size_band?: string | null }>): string => {
    if (!trees || trees.length === 0) return '';
    const counts = new Map<string, number>();
    trees.forEach((t) => {
        const band = treeBandLabel((t?.size_band as TreeSizeBand) || null);
        counts.set(band, (counts.get(band) || 0) + 1);
    });
    return Array.from(counts.entries())
        .map(([label, count]) => `${count}× ${label}`)
        .join(', ');
};

export const shouldShowZoneAnalysisResult = (hasResult: boolean, isZoneAnalyzing: boolean) =>
  hasResult && !isZoneAnalyzing;

const getDefaultPhytosanitaryScope = (
  affectedType?: PhytosanitaryAffectedType,
  _treatmentType?: string
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

type PalmGroup = NonNullable<BookingData['palmGroups']>[number];

const hasPositiveUnits = (quantity?: number): boolean => Number(quantity ?? 0) > 0;

const normalizePalmState = (estado?: string): 'normal' | 'descuidado' | 'muy_descuidado' => {
    if (!estado) return 'normal';
    const lower = estado.toLowerCase().trim();
    if (lower.includes('muy')) return 'muy_descuidado';
    if (lower.includes('descuidada') || lower.includes('descuidado')) return 'descuidado';
    return 'normal';
};

const toNullableConfidence = (value: unknown): number | null => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.min(1, Math.max(0, parsed));
};

const PALM_STATE_OPTIONS: Array<{ value: 'normal' | 'descuidado' | 'muy_descuidado'; label: string }> = [
    { value: 'normal', label: 'Normal' },
    { value: 'descuidado', label: 'Descuidada' },
    { value: 'muy_descuidado', label: 'Muy descuidada' },
];

// Umbral por debajo del cual pedimos al cliente que revise el campo (regla E07 del flujo).
const PALM_CONFIDENCE_REVIEW_THRESHOLD = 0.8;

// Resume las palmeras detectadas por especie y altura para que el cliente
// pueda confirmar cuántas quiere podar (la IA propone, el cliente decide).
const summarizeDetectedPalms = (palms: Array<{ especie?: string | null; altura?: string | null }>): string => {
    if (!palms || palms.length === 0) return '';
    const counts = new Map<string, number>();
    palms.forEach((p) => {
        const especie = p?.especie ? p.especie.charAt(0).toUpperCase() + p.especie.slice(1) : 'Palmera';
        const altura = p?.altura ? ` (${p.altura} m)` : '';
        const key = `${especie}${altura}`;
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries())
        .map(([label, count]) => `${count}× ${label}`)
        .join(', ');
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

/**
 * Nota para el jardinero, aislada en su propio componente con estado local.
 * Teclear aquí solo re-renderiza este textarea, no toda la página de Detalles
 * (~5.900 líneas). El valor se publica al padre vía `onChange`, que únicamente
 * actualiza una ref, por lo que el padre no se re-renderiza en cada pulsación.
 */
const GardenerNote: React.FC<{ defaultValue: string; onChange: (value: string) => void }> = ({ defaultValue, onChange }) => {
  const [value, setValue] = useState(defaultValue);
  // Re-sincroniza si la nota cambia desde fuera (p. ej. cambio de servicio/contexto).
  useEffect(() => { setValue(defaultValue); }, [defaultValue]);
  return (
    <textarea
      value={value}
      onChange={(e) => { setValue(e.target.value); onChange(e.target.value); }}
      placeholder="Ej: cuidado con el perro; entra por la puerta lateral…"
      className="w-full p-4 border border-gray-200 rounded-xl resize-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-base bg-gray-50"
      rows={3}
    />
  );
};

interface LawnZoneCardProps {
    zone: any;
    index: number;
    uploadingIndices?: Set<number>;
    isAnalyzing: boolean;
    loadingMessage: string;
    onAddPhotos: (zoneId: string, e: React.ChangeEvent<HTMLInputElement>) => void;
    onToggleSelection: (zoneId: string, i: number) => void;
    onRemovePhoto: (zoneId: string, i: number) => void;
    onAnalyze: (zoneId: string) => void;
    onRemoveZone: (zoneId: string) => void;
    onDeleteResult: (zoneId: string) => void;
}

/**
 * Tarjeta de una zona de césped, extraída y memoizada. Recibe callbacks estables
 * (vía ref en el padre), de modo que al cambiar una zona solo se re-renderiza la suya.
 * Cuando la zona ya está analizada, se colapsa a un resumen con botón "Editar".
 * No cambia ninguna lógica de negocio: solo encapsula el render y añade el colapso.
 */
const LawnZoneCard = React.memo(({
    zone,
    index,
    uploadingIndices,
    isAnalyzing,
    loadingMessage,
    onAddPhotos,
    onToggleSelection,
    onRemovePhoto,
    onAnalyze,
    onRemoveZone,
    onDeleteResult,
}: LawnZoneCardProps) => {
    const isAnalyzed = hasCanonicalAnalysisResult(zone.analysisV2, {
        analysisLevel: zone.analysisLevel,
        isFailed: zone.isFailed,
        observations: zone.observations,
        analyzedIndices: zone.analyzedIndices,
    }) || zone.quantity > 0;
    const isFailedResult = hasCanonicalAnalysisFailure(zone.analysisV2, {
        analysisLevel: zone.analysisLevel,
        isFailed: zone.isFailed,
        observations: zone.observations,
    });
    const allPhotos = zone.photoUrls || [];

    const resultStats = [
        { label: 'Superficie', value: `${zone.quantity} m²` },
        { label: 'Estado', value: <span className="capitalize">{zone.state}</span> },
    ];

    return (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
            {/* Header */}
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">
                        {index + 1}
                    </div>
                    <h3 className="font-semibold text-gray-900">Zona de Césped {index + 1}</h3>
                    <span className="text-xs text-gray-500 ml-1 font-normal">({allPhotos.length}/5 fotos)</span>
                </div>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => onRemoveZone(zone.id)}
                        className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-colors [touch-action:manipulation]"
                        title={isAnalyzed ? 'Eliminar resultado de análisis' : 'Eliminar zona'}
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                </div>
            </div>

            <>
                    {/* Photos Area for this Zone */}
                    <ZonePhotoGallery
                        photos={allPhotos}
                        photoIds={normalizePhotoIdentityList(zone)}
                        uploadingIndices={uploadingIndices}
                        selectedIndices={getDefaultSelectedPhotoIndices(allPhotos.length, zone.selectedIndices)}
                        analyzedIndices={getCanonicalAnalyzedPhotoIndices(zone.analysisV2, {
                            analyzedIndices: zone.analyzedIndices,
                            selectedIndices: zone.selectedIndices,
                            totalPhotoCount: allPhotos.length,
                        })}
                        isAnalyzing={isAnalyzing}
                        isAnalyzed={isAnalyzed}
                        analysis={zone.analysisV2}
                        analysisLevel={zone.analysisLevel}
                        observations={zone.observations}
                        loadingMessage={loadingMessage}
                        onRetryAnalysis={() => onAnalyze(zone.id)}
                        onToggleSelection={(i) => onToggleSelection(zone.id, i)}
                        onRemovePhoto={(i) => onRemovePhoto(zone.id, i)}
                        onAddPhotos={(e) => onAddPhotos(zone.id, e)}
                    />

                    {/* Actions / Results */}
                    <div className="mt-2">
                        {!isAnalyzed && allPhotos.length > 0 && (
                            <ZoneActionButton
                                onClick={() => onAnalyze(zone.id)}
                                isAnalyzing={isAnalyzing}
                                isAnalyzed={isAnalyzed}
                                disabled={isAnalyzing || (zone.selectedIndices !== undefined && zone.selectedIndices.length === 0)}
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
                            {isFailedResult ? (
                                <AnalysisFailedCard
                                    analysis={zone.analysisV2}
                                    message={zone.observations?.[0]}
                                    onReanalyze={() => onAnalyze(zone.id)}
                                />
                            ) : (
                                <>
                                    <ServiceResultCard
                                        title={zone.species || 'Césped general'}
                                        analysis={zone.analysisV2}
                                        analysisLevel={zone.analysisLevel}
                                        stats={resultStats}
                                        observations={zone.observations}
                                        onDelete={() => onDeleteResult(zone.id)}
                                    />
                                    <div className="mt-3">
                                        <ZoneActionButton
                                            onClick={() => onAnalyze(zone.id)}
                                            isAnalyzing={isAnalyzing}
                                            isAnalyzed={isAnalyzed}
                                            disabled={isAnalyzing || (zone.selectedIndices !== undefined && zone.selectedIndices.length === 0) || allPhotos.length === 0}
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </>
        </div>
    );
});

LawnZoneCard.displayName = 'LawnZoneCard';

const DetailsPage: React.FC = () => {
  const {
    bookingData,
    setBookingData,
    saveProgress,
    setCurrentStep,
    updateServiceData,
    switchToService,
    resumeWarning,
    clearResumeWarning,
  } = useBooking();
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
  const primaryMainPhotoUrls = useMemo(
    () => getPrimaryBookingPhotoUrls(bookingData),
    [bookingData.bookingPhotoContract, bookingData.uploadedPhotoUrls]
  );
  
  useEffect(() => {
      // Skip sync if currently uploading
      if (uploadingIndices.size > 0) return;

      const next = (bookingData.photos && bookingData.photos.length > 0)
        ? bookingData.photos
        : (primaryMainPhotoUrls.length > 0 ? primaryMainPhotoUrls : []);
      // Evita repintar la galería si el contenido no cambió (mismo orden y mismas refs).
      setPhotos((prev) =>
        prev.length === next.length && prev.every((p, i) => p === next[i]) ? prev : next
      );
  }, [bookingData.photos, primaryMainPhotoUrls, uploadingIndices.size]);

  const descriptionRef = useRef<string>(bookingData.description ?? '');

  // Mantener la ref de la nota sincronizada con cambios externos (p. ej. cambio de contexto).
  useEffect(() => {
      descriptionRef.current = bookingData.description ?? '';
  }, [bookingData.description]);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiModel] = useState<'gpt-4o-mini' | 'gemini-2.5-flash'>('gemini-2.5-flash');
  const [debugService, setDebugService] = useState<string>('');
  const serviceFlags = useMemo(() => getDetailsServiceFlags(debugService), [debugService]);
  const { user } = useAuth();
  // --- Manual entry (alternativa a fotos) ---
  const manualFlowEnabled = isManualBookingInputEnabled();
  const manualServiceKey = useMemo(() => resolveManualServiceKey(debugService), [debugService]);
  const manualSurvey = manualServiceKey ? MANUAL_ENTRY_SURVEYS[manualServiceKey] : null;
  // Desbroce (y futuros servicios manual-only) no usan fotos → sin selector foto/manual.
  const manualChoiceAvailable = manualFlowEnabled && !!manualServiceKey && !isManualOnlyService(manualServiceKey);
  const dataInputMode: DataInputMode = bookingData.dataInputMode === 'manual' ? 'manual' : 'photos';
  const isManualActive = manualChoiceAvailable && dataInputMode === 'manual';
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualDraft, setManualDraft] = useState<ManualWizardSubmitPayload | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mainPhotoInputVersion, setMainPhotoInputVersion] = useState(0);
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [isImageStackExpanded, setIsImageStackExpanded] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Escaneando terreno...');

  // Callbacks estables para las tarjetas de zona (memoización): apuntan siempre al
  // handler más reciente vía ref, sin recrearse, para que React.memo pueda saltarse
  // el render de las zonas que no cambian. No altera ningún handler ni su lógica.
  const lawnCb = useRef<{
    toggle: (id: string, i: number) => void;
    remove: (id: string, i: number) => void;
    add: (id: string, e: React.ChangeEvent<HTMLInputElement>) => void;
    analyze: (id: string) => void;
    removeZone: (id: string) => void;
    deleteResult: (id: string) => void;
  } | null>(null);
  const lawnHandlers = useMemo(() => ({
    onAddPhotos: (id: string, e: React.ChangeEvent<HTMLInputElement>) => lawnCb.current?.add(id, e),
    onToggleSelection: (id: string, i: number) => lawnCb.current?.toggle(id, i),
    onRemovePhoto: (id: string, i: number) => lawnCb.current?.remove(id, i),
    onAnalyze: (id: string) => lawnCb.current?.analyze(id),
    onRemoveZone: (id: string) => lawnCb.current?.removeZone(id),
    onDeleteResult: (id: string) => lawnCb.current?.deleteResult(id),
  }), []);
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

  const openPhotoRemovalConfirm = (config: {
    analysis?: any;
    analysisLevel?: number;
    observations?: string[];
    subjectLabel?: string;
    linkedResultCount?: number;
    onConfirm: () => void | Promise<void>;
  }) => {
    const copy = buildZonePhotoRemovalConfirmation({
      analysis: config.analysis,
      analysisLevel: config.analysisLevel,
      observations: config.observations,
      subjectLabel: config.subjectLabel,
      linkedResultCount: config.linkedResultCount
    });

    openConfirm({
      ...copy,
      onConfirm: config.onConfirm
    });
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

  const [, setDebugLogs] = useState<AnalysisDebugInfo | null>(null);
  const activeServiceId = bookingData.serviceIds?.[0] || '';
  const isWeedingServiceSelected = serviceFlags.isWeeding;
  const persistedManualDraft = (bookingData.servicesData?.[activeServiceId] as { manualDraft?: ManualWizardSubmitPayload } | undefined)?.manualDraft;

  const handleManualDraftChange = (payload: ManualWizardSubmitPayload) => {
    setManualDraft(payload);
    if (activeServiceId) {
      updateServiceData(activeServiceId, { manualDraft: payload });
    }
  };

  const mergeActiveServiceSnapshot = (
    prev: BookingData,
    patch: Partial<NonNullable<BookingData['servicesData']>[string]>
  ) => {
    const currentActiveServiceId = prev.serviceIds?.[0];
    if (!currentActiveServiceId) return prev.servicesData;

    return {
      ...prev.servicesData,
      [currentActiveServiceId]: {
        ...(prev.servicesData?.[currentActiveServiceId] || {}),
        ...patch,
      },
    };
  };

  const withReconciledBookingPhotoContract = (
    baseData: BookingData,
    patch: Partial<BookingData>,
    contractSeed = baseData.bookingPhotoContract
  ): Partial<BookingData> => buildDetailsPageBookingPatch(baseData, patch, contractSeed);

  type SimplePhotoCollectionServiceKey =
    | 'lawnZones'
    | 'treeGroups'
    | 'palmGroups'
    | 'shrubGroups'
    | 'phytosanitaryZones'
    | 'weedingZones';

  const commitDetailsPatch = (
    patch: Partial<BookingData> | ((prev: BookingData) => Partial<BookingData>),
    options?: {
      reconcileBookingPhotos?: boolean;
      syncActiveServiceSnapshot?: boolean;
      saveAfterCommit?: boolean;
    }
  ) => {
    const {
      reconcileBookingPhotos = true,
      syncActiveServiceSnapshot = true,
      saveAfterCommit = false,
    } = options || {};

    setBookingData((prev) => {
      const rawPatch = typeof patch === 'function' ? patch(prev) : patch;
      const nextPatch = reconcileBookingPhotos
        ? withReconciledBookingPhotoContract(prev, rawPatch)
        : rawPatch;

      if (!activeServiceId || !syncActiveServiceSnapshot) {
        return nextPatch;
      }

      const servicePatch = { ...rawPatch } as Partial<BookingData>;
      delete (servicePatch as Partial<BookingData>).servicesData;

      return {
        ...nextPatch,
        servicesData: mergeActiveServiceSnapshot(prev, servicePatch),
      };
    });

    if (saveAfterCommit) {
      saveProgress();
    }
  };

  const commitSimplePhotoCollectionPatch = <K extends SimplePhotoCollectionServiceKey>(
    key: K,
    items: NonNullable<BookingData[K]>,
    extraPatch: Partial<BookingData> = {},
    options?: {
      reconcileBookingPhotos?: boolean;
      saveAfterCommit?: boolean;
    }
  ) => {
    const patch = {
      ...extraPatch,
      [key]: items,
    } as Partial<BookingData>;

    commitDetailsPatch(patch, {
      reconcileBookingPhotos: options?.reconcileBookingPhotos,
      saveAfterCommit: options?.saveAfterCommit,
    });
  };

  const commitTreeGroups = (
    treeGroups: NonNullable<BookingData['treeGroups']>,
    estimatedHours: number,
    saveAfterCommit = false
  ) => {
    commitSimplePhotoCollectionPatch('treeGroups', treeGroups, { estimatedHours }, { saveAfterCommit });
  };

  const commitPalmGroups = (
    palmGroups: NonNullable<BookingData['palmGroups']>,
    saveAfterCommit = false
  ) => {
    commitSimplePhotoCollectionPatch('palmGroups', palmGroups, {}, { saveAfterCommit });
  };

  const commitShrubGroups = (
    shrubGroups: NonNullable<BookingData['shrubGroups']>,
    saveAfterCommit = false
  ) => {
    commitSimplePhotoCollectionPatch('shrubGroups', shrubGroups, {}, { saveAfterCommit });
  };

  const commitPhytosanitaryZones = (
    phytosanitaryZones: NonNullable<BookingData['phytosanitaryZones']>,
    saveAfterCommit = false
  ) => {
    commitSimplePhotoCollectionPatch('phytosanitaryZones', phytosanitaryZones, {}, { saveAfterCommit });
  };

  const updateUploadTracker = (
    setter: React.Dispatch<React.SetStateAction<Record<string, Set<number>>>>,
    uploadKey: string,
    indices: number[],
    action: 'add' | 'remove'
  ) => {
    setter((prev) => {
      const next = { ...prev };
      const tracked = new Set(next[uploadKey] || []);

      indices.forEach((index) => {
        if (action === 'add') tracked.add(index);
        else tracked.delete(index);
      });

      if (tracked.size === 0) {
        delete next[uploadKey];
      } else {
        next[uploadKey] = tracked;
      }

      return next;
    });
  };

  const toggleSimplePhotoCollectionSelection = <K extends SimplePhotoCollectionServiceKey>(
    key: K,
    itemId: string,
    photoIndex: number
  ) => {
    const items = [...((bookingData[key] || []) as any[])];
    const itemIndex = items.findIndex((item) => item.id === itemId);
    if (itemIndex === -1) return;

    items[itemIndex] = togglePhotoSelectionInCollection(
      { ...items[itemIndex] },
      photoIndex
    ) as any;

    commitSimplePhotoCollectionPatch(key, items as NonNullable<BookingData[K]>);
  };

  const appendFilesToSimplePhotoCollection = async <K extends SimplePhotoCollectionServiceKey>(params: {
    key: K;
    itemId: string;
    event: React.ChangeEvent<HTMLInputElement>;
    validationScope: string;
    uploadSetter: React.Dispatch<React.SetStateAction<Record<string, Set<number>>>>;
    uploadKey?: string;
  }) => {
    const items = [...((bookingData[params.key] || []) as any[])];
    const itemIndex = items.findIndex((item) => item.id === params.itemId);
    if (itemIndex === -1) return;

    const currentItem = items[itemIndex];
    const currentPhotoUrls = Array.isArray(currentItem.photoUrls) ? currentItem.photoUrls : [];
    const selectedFiles = readAndResetFileInput(params.event);
    const files = await validatePhotoFiles(
      selectedFiles,
      currentPhotoUrls.length,
      5,
      params.validationScope
    );
    if (files.length === 0) return;

    const { nextCollection, newIndices } = appendFilesToPhotoCollection(
      {
        ...currentItem,
        photoUrls: [...currentPhotoUrls],
        files: [...(currentItem.files || [])],
      },
      files
    );

    items[itemIndex] = nextCollection;
    const uploadKey = params.uploadKey || params.itemId;

    updateUploadTracker(params.uploadSetter, uploadKey, newIndices, 'add');
    commitSimplePhotoCollectionPatch(params.key, items as NonNullable<BookingData[K]>);
    updateUploadTracker(params.uploadSetter, uploadKey, newIndices, 'remove');
  };
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
        const serviceRecord = data as { name?: unknown } | null;
        const serviceName = typeof serviceRecord?.name === 'string'
          ? serviceRecord.name
          : '';
        if (serviceName) {
          let sn = serviceName;
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
    commitSimplePhotoCollectionPatch('weedingZones', hydratedZones, {}, { saveAfterCommit: true });
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
      ? resetAnalysisCommonFields({
          ...primary,
          photoUrls: [],
          files: [],
          selectedIndices: [],
          analyzedIndices: [],
        })
      : createDefaultWeedingZone();
    const nextZones = [nextZone];

    commitSimplePhotoCollectionPatch('weedingZones', nextZones, {}, { saveAfterCommit: true });
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
    commitSimplePhotoCollectionPatch('weedingZones', updated, {}, { saveAfterCommit: true });
  };

  // Sync lawn zones to global state
  useEffect(() => {
      if (serviceFlags.isLawn && bookingData.lawnZones) {
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
          const currentUrls = primaryMainPhotoUrls;
          
          const hoursChanged = Math.abs(currentHours - Math.ceil(totalHours)) > 0.1;
          const urlsChanged = allUrls.length !== currentUrls.length || !allUrls.every((u, i) => u === currentUrls[i]);
          
          if (hoursChanged || urlsChanged) {
              commitDetailsPatch({
                  estimatedHours: Math.ceil(totalHours),
                  uploadedPhotoUrls: allUrls,
                  aiQuantity: totalQty,
                  aiUnit: 'm2'
              });
          }
      }
  }, [bookingData.lawnZones, serviceFlags.isLawn]);

  // Sync shrub groups to global state
  useEffect(() => {
      if (serviceFlags.isShrub && bookingData.shrubGroups) {
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
          const currentUrls = primaryMainPhotoUrls;
          
          const hoursChanged = Math.abs(currentHours - totalHours) > 0.1;
          const urlsChanged = allUrls.length !== currentUrls.length || !allUrls.every((u, i) => u === currentUrls[i]);
          
          if (hoursChanged || urlsChanged) {
              commitDetailsPatch({
                  estimatedHours: totalHours,
                  uploadedPhotoUrls: allUrls,
                  aiQuantity: totalQty,
                  aiUnit: 'm2'
              });
          }
      }
  }, [bookingData.shrubGroups, serviceFlags.isShrub]);

  // Sync weeding zones to global state
  useEffect(() => {
      if (serviceFlags.isWeeding && bookingData.weedingZones) {
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
          const currentUrls = primaryMainPhotoUrls;
          
          const hoursChanged = Math.abs(currentHours - totalHours) > 0.1;
          const urlsChanged = allUrls.length !== currentUrls.length || !allUrls.every((u, i) => u === currentUrls[i]);
          
          if (hoursChanged || urlsChanged) {
              commitDetailsPatch({ 
                  estimatedHours: totalHours,
                  uploadedPhotoUrls: allUrls,
                  aiQuantity: totalQty,
                  aiUnit: 'm2'
              });
          }
      }
  }, [bookingData.weedingZones, serviceFlags.isWeeding]);

  const validatePhotoFiles = async (
    files: File[],
    existingCount: number,
    maxTotalPhotos: number,
    scope: string,
  ) => {
    const selection = await validateBookingPhotoSelection({
      files,
      existingCount,
      maxTotalPhotos,
      telemetryContext: {
        scope,
        serviceId: bookingData.serviceIds?.[0] || 'unknown',
      },
    });

    if (selection.rejectedFiles.length > 0) {
      toast.error(buildBookingPhotoSelectionErrorMessage(selection.rejectedFiles));
    }

    return selection.acceptedFiles;
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Clear previous analysis errors
    setAnalysisError(null);

    const selectedFiles = readAndResetFileInput(e);
    const files = await validatePhotoFiles(selectedFiles, photos.length, 5, 'details_main_selection');
    if (files.length === 0) {
      setMainPhotoInputVersion((version) => version + 1);
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

    const previewUrls = files.map((file) => URL.createObjectURL(file));
    const currentUrls = [...primaryMainPhotoUrls];
    while(currentUrls.length < startIndex) currentUrls.push('');
    previewUrls.forEach((url, i) => {
      currentUrls[startIndex + i] = url;
    });

    commitDetailsPatch({
        uploadedPhotoUrls: [...currentUrls],
        photos: [...(bookingData.photos || []), ...files],
      });

    setUploadingIndices(prev => {
      const next = new Set(prev);
      files.forEach((_, i) => next.delete(startIndex + i));
      return next;
    });
    setMainPhotoInputVersion((version) => version + 1);
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
      const quantity = Math.max(1, Math.trunc(Number(t.quantity) || 1));
      return acc + estimateTreeZoneHours(t) * quantity;
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
          reportDetailsPageIssue({
            event: 'booking.details_pricing_failed',
            service: 'Poda de palmeras',
            error: e,
            serviceId: bookingData.serviceIds?.[0],
            scope: 'details_palm_pricing',
            photoCount: flatPalms.length,
          });
      }
      
      const payload = { palmGroups: normalizedGroups, estimatedHours: totalHours, isAnalyzing: false };
      setBookingData(prev => withReconciledBookingPhotoContract(prev, payload));
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
    const removedUrl = primaryMainPhotoUrls[indexToRemove];
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
    
    const newUrls = primaryMainPhotoUrls.filter((_, i) => i !== indexToRemove);
    commitDetailsPatch({
      uploadedPhotoUrls: newUrls,
      photos: newPhotos.filter((photo): photo is File => photo instanceof File),
    });
    setMainPhotoInputVersion((version) => version + 1);
    
    if (bookingData.treeGroups && removedUrl) {
        const nextTreeGroups = includeLinkedResults
          ? bookingData.treeGroups.filter(g => !g.photoUrls?.includes(removedUrl))
          : bookingData.treeGroups;
        const treeHours = calculateTotalTreeHours(nextTreeGroups);
        commitSimplePhotoCollectionPatch('treeGroups', nextTreeGroups, { estimatedHours: treeHours });
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
        commitSimplePhotoCollectionPatch('shrubGroups', newGroups, { estimatedHours: totalHours });
    }
    
    saveProgress();
  };

  const getMainPhotoLinkedResultCount = (photoIndex: number) => {
    const photoUrl = primaryMainPhotoUrls[photoIndex];
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
    openPhotoRemovalConfirm({
      linkedResultCount: linkedCount,
      onConfirm: () => removePhoto(photoIndex, true)
    });
  };

  const removeTreeAnalysisResult = (groupId: string) => {
    const currentGroups = bookingData.treeGroups || [];
    const target = currentGroups.find(g => g.id === groupId);
    if (!target) return;
    const targetUrl = target.photoUrls?.[0];
    const nextGroups = currentGroups.filter(g => g.id !== groupId);
    const newHours = calculateTotalTreeHours(nextGroups);
    commitTreeGroups(nextGroups, newHours);
    if (targetUrl) {
      const photoIndex = primaryMainPhotoUrls.indexOf(targetUrl);
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

  const handleSelectInputMode = (mode: DataInputMode) => {
    commitDetailsPatch({ dataInputMode: mode }, { saveAfterCommit: true });
    reportBookingEvent('info', {
      event: 'booking.manual_input_mode_changed',
      context: { serviceId: activeServiceId, serviceKey: manualServiceKey || 'unknown', mode },
    });
    if (mode === 'manual') {
      reportBookingEvent('info', {
        event: 'booking.manual_entry_started',
        context: { serviceId: activeServiceId, serviceKey: manualServiceKey || 'unknown' },
      });
    }
  };

  const handleManualSubmit = async (payload: ManualWizardSubmitPayload) => {
    if (!manualServiceKey) return;
    const { patch, declaredVariables } = buildManualBookingPatch({
      serviceKey: manualServiceKey,
      items: payload.items,
      wasteRemoval: payload.wasteRemoval,
    });

    // Client-side authoritative validation (the server re-validates on create_quote).
    const validation = validateManualBookingInput(manualServiceKey, patch as any);
    if (!validation.ok) {
      toast.error(validation.errors[0]?.message || 'Revisa los datos introducidos.');
      reportBookingEvent('warn', {
        event: 'booking.manual_validation_rejected',
        context: { serviceKey: manualServiceKey, reason: validation.errors[0]?.code || 'invalid' },
      });
      return;
    }

    setManualSubmitting(true);
    try {
      const consent = buildConsentRecord();
      let declarationId: string | undefined;

      // Best-effort dedicated audit row when authenticated. Auditability is also
      // guaranteed via the durable `manualConsent` embedded in the booking payload.
      if (user?.id) {
        try {
          const result = await recordManualDeclaration({
            serviceId: activeServiceId,
            serviceName: debugService,
            declaredVariables,
            bookingInput: patch as Record<string, unknown>,
          });
          declarationId = result.declarationId;
        } catch (declError) {
          if (declError instanceof ManualDeclarationError && declError.validationErrors?.length) {
            toast.error(declError.message);
            reportBookingEvent('warn', {
              event: 'booking.manual_validation_rejected',
              context: { serviceKey: manualServiceKey, reason: 'server_validation' },
            });
            setManualSubmitting(false);
            return;
          }
          reportBookingEvent('warn', {
            event: 'booking.manual_entry_submit_failed',
            context: { serviceKey: manualServiceKey, reason: 'declaration_persist_failed' },
          });
        }
      }

      const fullPatch: Partial<BookingData> = {
        ...patch,
        manualDeclarationId: declarationId,
        manualConsent: { ...consent, declaredVariables },
        photos: [],
        description: descriptionRef.current,
      };
      commitDetailsPatch(fullPatch, { saveAfterCommit: true });
      if (activeServiceId) {
        updateServiceData(activeServiceId, { ...fullPatch, manualDraft: null });
      }

      reportBookingEvent('info', {
        event: 'booking.manual_entry_submitted',
        context: { serviceKey: manualServiceKey, itemCount: payload.items.length },
      });
      saveProgress();
      setCurrentStep(3);
    } catch (error) {
      toast.error('No hemos podido guardar tus datos. Inténtalo de nuevo.');
      reportBookingEvent('error', {
        event: 'booking.manual_entry_submit_failed',
        context: { serviceKey: manualServiceKey, reason: 'unexpected' },
      });
    } finally {
      setManualSubmitting(false);
    }
  };

  const handleContinue = () => {
    if (serviceFlags.isPhytosanitary) {
      const zones = bookingData.phytosanitaryZones || [];
      if (zones.length === 0) {
        toast.error('Añade al menos una zona para continuar.');
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

    if (serviceFlags.isWeeding) {
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
    if (debugService === 'Poda de plantas y arbustos') {
      const validShrubs = (bookingData.shrubGroups || []).filter((g: any) => !(g.isFailed === true || g.analysisLevel === 3));
      if (validShrubs.length === 0 || !validShrubs.some((g: any) => Number(g.area) > 0)) {
        toast.error('Analiza al menos un grupo de plantas con superficie válida para continuar.');
        return;
      }
    }
    if (debugService === 'Poda de setos') {
      const validHedges = (bookingData.hedgeZones || []).filter((z: any) => !(z.isFailed === true || z.analysisLevel === 3));
      if (validHedges.length === 0 || !validHedges.some((z: any) => Number(z.length) > 0)) {
        toast.error('Analiza al menos una zona de setos con longitud válida para continuar.');
        return;
      }
    }
    // Filter out strings from photos to match File[] type for bookingData
    const filePhotos = photos.filter((p): p is File => p instanceof File);
    setBookingData({ photos: filePhotos, description: descriptionRef.current });
    
    // Explicit persist before leaving
    if (bookingData.serviceIds?.[0]) {
        updateServiceData(bookingData.serviceIds[0], {
            photos: filePhotos,
            description: descriptionRef.current,
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

      // Only process selected indices
      await Promise.all(indicesToProcess.map(async (i) => {
          const p = photos[i];
          if (!p) return;

          if (p instanceof File) {
              photoUrls[i] = await fileToDataUrl(p);
              return;
          }

          if (typeof p === 'string') {
              photoUrls[i] = p;
              return;
          }

          const existingUrl = primaryMainPhotoUrls[i];
          if (existingUrl) {
              photoUrls[i] = existingUrl;
          }
      }));

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
            // La IA PROPONE: no creamos una zona por palmera. Tomamos la principal
            // y el cliente confirma la cantidad (por defecto 1, sin inflar precio).
            const detectedPalms = res.palmas.filter(
                (p) => Number(p?.nivel_analisis) !== 3 && !!p?.especie && String(p.especie) !== 'No detectada'
            );
            const primary = detectedPalms[0] || res.palmas[0];
            const globalIndex = indexMap[primary.indice_imagen];
            const originalUrl = photoUrls[globalIndex];
            const speciesMapped = primary.especie ? primary.especie.charAt(0).toUpperCase() + primary.especie.slice(1) : 'Desconocida';

            const newGroup = {
                id: `ai-${Date.now()}-0`,
                species: speciesMapped,
                height: primary.altura,
                quantity: 1, // Default to 1, user must confirm
                state: normalizePalmState(primary.estado),
                wasteRemoval: true,
                hasPhytosanitary: supportsPhytosanitaryForSpecies(speciesMapped),
                photoUrl: originalUrl || undefined,
                imageIndex: globalIndex,
                analysisLevel: primary.nivel_analisis,
                observations: primary.observaciones,
                aiDetectedCount: detectedPalms.length,
                aiDetectedSummary: summarizeDetectedPalms(detectedPalms),
            };

            // Merge with existing palms not in current analysis batch
            const oldGroups = (bookingData.palmGroups || []).filter(g => {
                // Keep if imageIndex is NOT in indicesToProcess
                return g.imageIndex !== undefined && !indicesToProcess.includes(g.imageIndex);
            });

            const mergedGroups = [...oldGroups, newGroup];

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
        const aiSizeBand =
          normalizeTreeSizeBand(t.size_band);
        const legacyHeight = aiSizeBand ? treeSizeBandToLegacyMeters(aiSizeBand) : 0;
        const analysisLevel = Number(t.nivel_analisis || 3);
        const newTreeGroups = [
          {
            id: `ai-tree-${Date.now()}`,
            pruningType: 'structural' as const,
            quantity: 1,
            photoUrls: targetUrls.map((_, i) => photoUrls[indexMap[i]]).filter(Boolean),
            aiSizeBand: aiSizeBand ?? undefined,
            aiHeightMeters: Number.isFinite(legacyHeight) ? legacyHeight : 0,
            sizeBandConfidence: toNullableConfidence((t as any).size_band_confidence),
            alturaConfidence: toNullableConfidence((t as any).altura_confidence),
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
                // length_pricing_m = longitud BASE: el motor ya multiplica por faces_to_trim.
                const pricingLength = baseLength;
                const pricingHeight = baseHeight;
                const hCat = resolveHedgeHeightBand(baseHeight);
                const state = normalizeHedgeStateValue(t.estado_seto);
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
        if (serviceFlags.isLawn) {
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
            description: 'Sube 1-3 fotos por cada tipo de palmera: la palmera entera (desde la base del tronco hasta la corona) y, si puedes, un detalle de la corona. Hazlas de día, con el sol a tu espalda y sin recortar la copa. Truco: si alguien se pone al lado de la palmera calculamos la altura con más precisión. Si tienes varias iguales en especie, tamaño y estado, basta una foto: luego confirmas cuántas son.'
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
            title: 'Fotos de tus setos',
            description: 'Sube 1-3 fotos por cara: el seto completo desde 3-5 m (Cara A es la delantera y obligatoria; Cara B solo si también quieres recortar la trasera). Hazlas de día y con el sol a tu espalda. Truco: si alguien se pone al lado del seto calculamos la altura y la longitud con más precisión. Después del análisis podrás confirmar las medidas y cuántas caras recortar.'
        };
    }
    if (lower.includes('árbol') || lower.includes('arbol')) {
        return {
            title: 'Fotos de los árboles',
            description: 'Sube 1-3 fotos por cada árbol o grupo de árboles iguales: el árbol entero (desde la base del tronco hasta la punta de la copa), de día y sin recortar la copa. Truco: si alguien se pone al lado del árbol calculamos su tamaño con más precisión. Si tienes varios árboles parecidos, basta una foto: luego confirmas cuántos son.'
        };
    }
    if (lower.includes('planta') || lower.includes('arbusto')) {
        return {
            title: 'Fotos de tus plantas y arbustos',
            description: 'Sube 1-3 fotos por cada macizo o grupo de plantas: el macizo completo desde 3-5 m y, si puedes, un detalle del follaje. Hazlas de día y con el sol a tu espalda. Truco: deja una silla o el cubo de basura junto al macizo — así calculamos la superficie con más precisión. Si tienes macizos separados, añade un grupo por cada uno.'
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
  const isDevAnalysisSeedEnabled = isDetailsDevAnalysisEnabled();

  const applyDevAnalysisSeed = async () => {
    if (!isDevAnalysisSeedEnabled) return;

    setAnalysisError(null);

    if (serviceFlags.isLawn) {
      const currentZones = bookingData.lawnZones || [];
      const baseZones = currentZones.length > 0 ? currentZones : [undefined];
      const nextZones = baseZones.map((zone, index) => buildLawnDevZone(zone, index));
      commitSimplePhotoCollectionPatch('lawnZones', nextZones, {}, { saveAfterCommit: true });
      toast.success('Datos de prueba aplicados a césped');
      return;
    }

    if (serviceFlags.isHedge) {
      const currentZones = bookingData.hedgeZones || [];
      const baseZones = currentZones.length > 0 ? currentZones : [undefined];
      const nextZones = baseZones.map((zone, index) => buildHedgeDevZone(zone, index));
      commitHedgeZones(nextZones, true);
      toast.success('Datos de prueba aplicados a setos');
      return;
    }

    if (serviceFlags.isPalm) {
      const currentGroups = bookingData.palmGroups || [];
      const baseGroups = currentGroups.length > 0 ? currentGroups : [undefined];
      const nextGroups = baseGroups.map((group, index) => buildPalmDevGroup(group, index));
      await updatePalmPricing(nextGroups);
      saveProgress();
      toast.success('Datos de prueba aplicados a palmeras');
      return;
    }

    if (serviceFlags.isTree) {
      const currentGroups = bookingData.treeGroups || [];
      const baseGroups = currentGroups.length > 0 ? currentGroups : [undefined];
      const nextGroups = baseGroups.map((group, index) => buildTreeDevGroup(group, index));
      commitTreeGroups(nextGroups, calculateTotalTreeHours(nextGroups), true);
      toast.success('Datos de prueba aplicados a árboles');
      return;
    }

    if (serviceFlags.isShrub) {
      const currentGroups = bookingData.shrubGroups || [];
      const baseGroups = currentGroups.length > 0 ? currentGroups : [undefined];
      const nextGroups = baseGroups.map((group, index) => buildShrubDevGroup(group, index));
      commitShrubGroups(nextGroups, true);
      toast.success('Datos de prueba aplicados a plantas y arbustos');
      return;
    }

    if (serviceFlags.isPhytosanitary) {
      const currentZones = bookingData.phytosanitaryZones || [];
      const baseZones = currentZones.length > 0 ? currentZones : [undefined];
      const nextZones = baseZones.map((zone, index) => buildPhytosanitaryDevZone(zone, index));
      commitPhytosanitaryZones(nextZones, true);
      toast.success('Datos de prueba aplicados a fitosanitarios');
      return;
    }

    if (serviceFlags.isWeeding) {
      const currentZones = bookingData.weedingZones || [];
      const baseZones = currentZones.length > 0 ? currentZones : [undefined];
      const nextZones = baseZones.map((zone, index) => buildWeedingDevZone(zone, index));
      commitSimplePhotoCollectionPatch('weedingZones', nextZones, {}, { saveAfterCommit: true });
      setWeedingManualConfirmed(true);
      toast.success('Datos de prueba aplicados a desbroce');
    }
  };

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
        photoIds: [],
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
          const updatedZone = resetAnalysisCommonFields({ 
              ...zone,
              quantity: 0,
              species: '',
              state: 'normal',
          });
          zones[idx] = updatedZone;
          commitSimplePhotoCollectionPatch('lawnZones', zones, {}, { saveAfterCommit: true });
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
        setBookingData(withReconciledBookingPhotoContract(bookingData, { lawnZones: newZones }));
        if (bookingData.serviceIds?.[0]) {
             updateServiceData(bookingData.serviceIds[0], { lawnZones: newZones });
        }
        saveProgress();
      }
    });
  };

  const deleteLawnResult = (zoneId: string) => {
    openConfirm({
      title: '¿Eliminar resultado?',
      message: 'Se borrarán los datos del análisis, pero las fotos se mantendrán para poder re-analizar.',
      onConfirm: () => {
        const zones = [...(bookingData.lawnZones || [])];
        const idx = zones.findIndex(z => z.id === zoneId);
        if (idx !== -1) {
          zones[idx] = resetAnalysisCommonFields({ ...zones[idx], quantity: 0, species: '', state: 'normal' });
          commitSimplePhotoCollectionPatch('lawnZones', zones);
        }
      }
    });
  };

  const toggleLawnPhotoSelection = (zoneId: string, photoIndex: number) => {
      toggleSimplePhotoCollectionSelection('lawnZones', zoneId, photoIndex);
  };

  const handleLawnFileSelect = async (zoneId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    await appendFilesToSimplePhotoCollection({
      key: 'lawnZones',
      itemId: zoneId,
      event: e,
      validationScope: 'details_lawn_selection',
      uploadSetter: setLawnUploads,
    });
  };

  const removePhotoFromZone = (zoneId: string, photoIndex: number) => {
      const zones = [...(bookingData.lawnZones || [])];
      const idx = zones.findIndex(z => z.id === zoneId);
      if (idx === -1) return;
      
      const zone = { ...zones[idx] };
      const isAnalyzedPhoto = zone.analyzedIndices?.includes(photoIndex);
      const executeRemove = () => {
      const updatedZone = removePhotoFromCollection({ ...zone }, photoIndex);

      if (isAnalyzedPhoto) {
        updatedZone.quantity = 0;
        updatedZone.species = '';
        updatedZone.state = 'normal';
        Object.assign(updatedZone, resetAnalysisCommonFields(updatedZone));
      }

      zones[idx] = updatedZone;
      setBookingData(withReconciledBookingPhotoContract(bookingData, { lawnZones: zones }));
      
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

      openPhotoRemovalConfirm({
        analysis: zone.analysisV2,
        analysisLevel: zone.analysisLevel,
        observations: zone.observations,
        subjectLabel: 'la zona',
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
      const indicesToAnalyze = getDefaultSelectedPhotoIndices(allUrls.length, zone.selectedIndices);
      const finalUrls = await resolveAnalysisPhotoSources({
        photoUrls: allUrls,
        selectedIndices: indicesToAnalyze,
        files: zone.files,
      });

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
          const analysis = res.analysis_v2;
          const lawnTasks = extractLawnLegacyTasks(res);
          
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


          if (analysis || lawnTasks.length > 0) {
              const t = lawnTasks[0];
              const zonePatch = adaptLawnAnalysisResult({
                analysis,
                legacyTask: t,
                selectedIndices: indicesToAnalyze,
                totalPhotoCount: allUrls.length
              });
              let nextZones: any[] = [];

              setBookingData(prev => {
                  const updatedZones = [...(prev.lawnZones || [])];
                  const updatedIdx = updatedZones.findIndex(z => z.id === zoneId);
                  if (updatedIdx !== -1) {
                      updatedZones[updatedIdx] = { ...updatedZones[updatedIdx], ...zonePatch };
                  }

                  nextZones = updatedZones;
                  const nextServicesData = mergeActiveServiceSnapshot(prev, {
                    lawnZones: updatedZones
                  });

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
          reportDetailsPageIssue({
            event: 'booking.details_analysis_failed',
            service: 'Corte de césped',
            error: e,
            serviceId: bookingData.serviceIds?.[0],
            zoneId,
            scope: 'details_lawn_analysis',
            photoCount: finalUrls.length,
          });
          setDebugLogs(prev => appendDebugError(
            prev || createDebugInfo({ service: 'Corte de césped', model: aiModel, promptInputs: {} }),
            e
          ));
          
          const failureFields = buildAnalysisFailureFields({
            serviceName: 'Corte de césped',
            selectedIndices: zone.selectedIndices,
            totalPhotoCount: (zone.photoUrls || []).length
          });
          setBookingData(prev => {
              const currentZones = prev.lawnZones || [];
              const updatedZones = currentZones.map(z => {
                  if (z.id === zoneId) {
                      return { 
                          ...z, 
                          ...failureFields
                      };
                  }
                  return z;
              });
              
              const nextServicesData = mergeActiveServiceSnapshot(prev, {
                lawnZones: updatedZones
              });

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
  // SSOT: las claves de pricing_matrix/yield_ml_per_hour del jardinero son '0-2m'|'2-4m'|'4-6m'.
  // La versión anterior devolvía '0-1m'/'1-2m' (bandas inexistentes en el motor) y excluía
  // a todos los jardineros para setos ≤2m analizados con fotos.
  const resolveHedgeHeightBand = (heightM: number): HedgeHeightBand => mapHedgeHeightToBand(heightM);

  const resolveHedgeFaceDetails = (task: any) => {
    if (task?.detalle_caras && typeof task.detalle_caras === 'object') return task.detalle_caras;
    if (task?.caras && typeof task.caras === 'object') return task.caras;
    return {};
  };

  const isHedgeZoneAnalyzed = (zone: any) => Number(zone.length || 0) > 0 || zone.analysisLevel !== undefined;
  const normalizeHedgeZone = (zone: any) => normalizeHedgeZonePhotoCollections(zone);
  const syncLegacyHedgeZone = (zone: any) => syncLegacyHedgeZonePhotoCollections(zone);
  const commitHedgeZones = (hedgeZones: BookingData['hedgeZones'], saveAfterCommit = false) => {
    commitDetailsPatch({ hedgeZones }, { saveAfterCommit });
  };

  const addHedgeZone = () => {
    if ((bookingData.hedgeZones || []).length >= 4) {
        toast.error('Máximo 4 zonas permitidas');
        return;
    }

    setAnalysisError(null);
    const newZone = {
        id: `hedge-${Date.now()}`,
        category: '0-2m',
        type: '0-2m',
        height: '0-2m',
        length: 0,
        state: 'normal',
        access: 'normal' as const, // Legacy
        wasteRemoval: true,
        faceA: createEmptyHedgeFaceCollection(),
        faceB: createEmptyHedgeFaceCollection(),
        hasBackFaceTrim: false,
        faces_to_trim: 1 as 1 | 2,
        length_pricing_m: 0,
        height_pricing_m: 0,
        photoIds: [] as string[],
        photoUrls: [] as string[],
        files: [] as File[],
        imageIndices: [] as number[],
        selectedIndices: [] as number[],
        analyzedIndices: [] as number[]
    };
    const newZones = [...(bookingData.hedgeZones || []), newZone];
    commitHedgeZones(newZones, true);
  };

  const updateHedgeZone = (id: string, updates: Partial<NonNullable<BookingData['hedgeZones']>[number]>) => {
    const zones = [...(bookingData.hedgeZones || [])];
    const idx = zones.findIndex((z) => z.id === id);
    if (idx === -1) return;
    const next = { ...zones[idx], ...updates } as any;
    // Mantener coherentes los campos derivados que consume el motor.
    if (updates.length !== undefined) next.length_pricing_m = Number(updates.length) || 0;
    if (updates.height !== undefined) {
      next.category = updates.height;
      next.type = updates.height;
    }
    zones[idx] = next;
    commitHedgeZones(zones, true);
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
          const updatedZone = resetAnalysisCommonFields({
              ...normalizeHedgeZone(zone),
              length: 0,
              length_pricing_m: 0,
              height_pricing_m: 0,
              faces_to_trim: 1 as 1 | 2,
              category: '1-2m',
              type: '1-2m',
              height: '1-2m',
              state: 'normal',
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
          });
          zones[idx] = syncLegacyHedgeZone(updatedZone);
          commitHedgeZones(zones, true);
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
        commitHedgeZones(newZones, true);
      }
    });
  };

  const toggleHedgePhotoSelection = (zoneId: string, faceKey: HedgeFaceKey, photoIndex: number) => {
    const zones = [...(bookingData.hedgeZones || [])];
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx === -1) return;

    zones[idx] = toggleHedgeFacePhotoSelection(zones[idx], faceKey, photoIndex);
    commitHedgeZones(zones);
  };

  const handleHedgeFileSelect = async (id: string, faceKey: HedgeFaceKey, e: React.ChangeEvent<HTMLInputElement>) => {
    const zones = [...(bookingData.hedgeZones || [])];
    const idx = zones.findIndex(z => z.id === id);
    if (idx === -1) return;

    const normalizedZone = normalizeHedgeZone(zones[idx]);
    const currentFace = { ...normalizedZone[faceKey] };
    const selectedFiles = readAndResetFileInput(e);
    const files = await validatePhotoFiles(
      selectedFiles,
      currentFace.photoUrls?.length || 0,
      5,
      'details_hedge_selection'
    );
    if (files.length === 0) return;

    const { zone: updatedZone, newIndices } = appendFilesToHedgeFaceCollection(normalizedZone, faceKey, files);
    zones[idx] = updatedZone;

    const uploadKey = `${id}-${faceKey}`;

    setHedgeUploads(prev => {
        const zoneUploads = new Set(prev[uploadKey] || []);
        newIndices.forEach(i => zoneUploads.add(i));
        return { ...prev, [uploadKey]: zoneUploads };
    });

    commitHedgeZones(zones);
    setHedgeUploads(prev => {
        const next = { ...prev };
        const zoneUploads = new Set(next[uploadKey] || []);
        newIndices.forEach(i => zoneUploads.delete(i));
        next[uploadKey] = zoneUploads;
        return next;
    });
  };

  const removePhotoFromHedgeZone = (zoneId: string, faceKey: HedgeFaceKey, photoIndex: number) => {
    const zones = [...(bookingData.hedgeZones || [])];
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx === -1) return;

    const zone = normalizeHedgeZone(zones[idx]);
    const face = { ...zone[faceKey] };
    const isAnalyzedPhoto = face.analyzedIndices?.includes(photoIndex);
    const executeRemove = () => {
    const updatedZone = removePhotoFromHedgeFaceCollection(zone, faceKey, photoIndex);

    if (isAnalyzedPhoto) {
      updatedZone.length = 0;
      updatedZone.length_pricing_m = 0;
      updatedZone.height_pricing_m = 0;
      updatedZone.faces_to_trim = 1;
      updatedZone.category = '1-2m';
      updatedZone.type = '1-2m';
      updatedZone.height = '1-2m';
      updatedZone.state = 'normal';
      Object.assign(updatedZone, resetAnalysisCommonFields(updatedZone));
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

    zones[idx] = syncLegacyHedgeZone(updatedZone);
    commitHedgeZones(zones);
    };

    if (!isAnalyzedPhoto) {
      executeRemove();
      return;
    }

    openPhotoRemovalConfirm({
      analysis: zone.analysisV2,
      analysisLevel: zone.analysisLevel,
      observations: zone.observations,
      subjectLabel: 'el seto',
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
          const faceAIndices = getDefaultSelectedPhotoIndices(faceAUrls.length, zone.faceA.selectedIndices);
          const finalFaceAUrls = await resolveAnalysisPhotoSources({
            photoUrls: faceAUrls,
            selectedIndices: faceAIndices,
            files: zone.faceA.files,
          });

          if (finalFaceAUrls.length === 0) {
              const message = 'Selecciona al menos una foto en Cara A para analizar';
              if (options?.silent) toast.error(message);
              else toast.error(message);
              return false;
          }

          const faceBUrls = zone.faceB.photoUrls || [];
          const faceBIndices = getDefaultSelectedPhotoIndices(faceBUrls.length, zone.faceB.selectedIndices);
          const finalFaceBUrls = await resolveAnalysisPhotoSources({
            photoUrls: faceBUrls,
            selectedIndices: faceBIndices,
            files: zone.faceB.files,
          });
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
              serviceName: 'Poda de setos',
              model: aiModel
          };

          const res = await estimateWorkWithAI(debugInputs);
          const analysis = res.analysis_v2;
          
          // Initialize Debug Info
          const currentDebugInfo: AnalysisDebugInfo = {
              service: 'Poda de setos',
              model: aiModel,
              promptInputs: debugInputs,
              rawResponse: res.rawResponse,
              parsedResponse: res.tareas,
              finalAnalysisData: {},
              errors: [],
              timestamp: new Date().toISOString()
          };
          setDebugLogs(currentDebugInfo);


          if (analysis || (res.tareas && res.tareas.length > 0)) {
              const t = res.tareas?.[0] || {};
              const hedgeMetrics = analysis?.service === 'Poda de setos' ? analysis.service_metrics as any : null;
              const resumen = hedgeMetrics?.resumen_medicion || t.resumen_medicion || {};
              const faceDetails = hedgeMetrics?.detalle_caras || resolveHedgeFaceDetails(t);
              const caraA = faceDetails?.cara_a || {};
              const caraB = faceDetails?.cara_b || {};
              const hasFaceB = finalFaceBUrls.length > 0;
              const numericFaces = typeof hedgeMetrics?.caras === 'number'
                ? hedgeMetrics.caras
                : (typeof t.caras === 'number' ? t.caras : undefined);
              const facesToTrimValue = Number(resumen.caras_recortar ?? numericFaces ?? (hasFaceB ? 2 : 1));
              const facesToTrim: 1 | 2 = facesToTrimValue >= 2 ? 2 : 1;
              const baseLength = Number(resumen.base_longitud_m ?? hedgeMetrics?.longitud_m ?? t.longitud_m ?? 0);
              const baseHeight = Number(resumen.base_altura_m ?? hedgeMetrics?.altura_m ?? t.altura_m ?? 0);
              // IMPORTANTE: length_pricing_m debe ser la longitud BASE (sin caras). El motor
              // ya multiplica por faces_to_trim; guardar longitud×caras aquí duplicaba el
              // cobro de la segunda cara (base × L×2 × 2). El flujo manual siempre guardó la base.
              const pricingLength = baseLength;
              const pricingHeight = baseHeight;
              const commonAnalysis = buildAnalysisCommonFields({
                analysis,
                analysisLevel: t.nivel_analisis,
                observations: t.observaciones,
                analyzedIndices: [...faceAIndices, ...faceBIndices.map((i) => i + faceAUrls.length)],
                selectedIndices: [...faceAIndices, ...faceBIndices.map((i) => i + faceAUrls.length)],
                totalPhotoCount: finalUrls.length
              });

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
              // La IA PROPONE el estado; el recargo (media/alta) solo se consolida cuando
              // el cliente lo confirma o corrige en la card editable.
              zone.state = normalizeHedgeStateValue(hedgeMetrics?.estado_seto || t.estado_seto);
              (zone as any).stateProposedByAI = zone.state !== 'normal';
              (zone as any).longitudConfidence = toNullableConfidence(hedgeMetrics?.longitud_confidence ?? (t as any).longitud_confidence);
              (zone as any).alturaConfidence = toNullableConfidence(hedgeMetrics?.altura_confidence ?? (t as any).altura_confidence);
              (zone as any).estadoConfidence = toNullableConfidence(hedgeMetrics?.estado_confidence ?? (t as any).estado_confidence);
              zone.access = 'normal'; // Legacy
              zone.analysisV2 = commonAnalysis.analysisV2;
              zone.analysisLevel = commonAnalysis.analysisLevel;
              zone.isFailed = commonAnalysis.isFailed;
              zone.observations = h > 7.5
                ? [...commonAnalysis.observations, 'Altura detectada superior a 7.5m, revisar manualmente por seguridad.']
                : commonAnalysis.observations;
              zone.faceA = {
                ...zone.faceA,
                analyzedIndices: faceAIndices,
                analysisLevel: caraA?.nivel_analisis ?? zone.analysisLevel,
                observations: caraA?.observaciones || [],
                longitud_m: caraA?.longitud_m,
                altura_m: caraA?.altura_m
              };
              zone.faceB = {
                ...zone.faceB,
                analyzedIndices: faceBIndices,
                analysisLevel: caraB?.nivel_analisis,
                observations: caraB?.observaciones || [],
                longitud_m: caraB?.longitud_m,
                altura_m: caraB?.altura_m
              };
          } else {
              throw new Error('No se han detectado datos válidos en las imágenes.');
          }

          const mergedZones = [...(bookingData.hedgeZones || [])];
          mergedZones[idx] = syncLegacyHedgeZone({
            ...normalizeHedgeZone(mergedZones[idx]),
            ...zone
          });
          commitHedgeZones(mergedZones, true);
          
          // Update Final Debug Data
          currentDebugInfo.finalAnalysisData = { hedgeZones: mergedZones.length > 0 ? mergedZones : zones };
          setDebugLogs({...currentDebugInfo});
          return true;
      } catch (e: any) {
          reportDetailsPageIssue({
            event: 'booking.details_analysis_failed',
            service: 'Poda de setos',
            error: e,
            serviceId: bookingData.serviceIds?.[0],
            zoneId: id,
            scope: 'details_hedge_analysis',
            photoCount: zone.faceA.photoUrls.length + zone.faceB.photoUrls.length,
          });
          setDebugLogs(prev => appendDebugError(
            prev || createDebugInfo({ service: 'Poda de setos', model: aiModel, promptInputs: {} }),
            e
          ));

          const failureFields = buildAnalysisFailureFields({
            serviceName: 'Poda de setos',
            selectedIndices: zone.selectedIndices,
            totalPhotoCount: (zone.photoUrls || []).length
          });
          const updatedZones = (bookingData.hedgeZones || []).map((z) =>
            z.id === id
              ? {
                  ...z,
                  ...failureFields
                }
              : z
          );
          commitHedgeZones(updatedZones, true);
          
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
        quantity: 1,
        photoIds: [] as string[],
        photoUrls: [] as string[],
        aiSizeBand: undefined as TreeSizeBand | undefined,
        aiHeightMeters: 0,
        difficultyHigh: undefined as boolean | undefined
    };
    const newGroups = [...(bookingData.treeGroups || []), newGroup];
    commitTreeGroups(newGroups, calculateTotalTreeHours(newGroups), true);
  };

  const updateTreeGroup = (id: string, updates: any) => {
    const next = [...(bookingData.treeGroups || [])];
    const idx = next.findIndex((z) => z.id === id);
    if (idx === -1) return;
    next[idx] = { ...next[idx], ...updates };
    const newHours = calculateTotalTreeHours(next);
    commitTreeGroups(next, newHours, true);
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
        commitTreeGroups(newGroups, newHours, true);
      }
    });
  };

  const handleTreeFileSelect = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    await appendFilesToSimplePhotoCollection({
      key: 'treeGroups',
      itemId: id,
      event: e,
      validationScope: 'details_tree_selection',
      uploadSetter: setTreeUploads,
    });
  };

  
  const toggleTreePhotoSelection = (zoneId: string, photoIndex: number) => {
      toggleSimplePhotoCollectionSelection('treeGroups', zoneId, photoIndex);
  };

  const removeTreePhoto = (zoneId: string, photoIndex: number) => {
      const groups = [...(bookingData.treeGroups || [])];
      const idx = groups.findIndex(z => z.id === zoneId);
      if (idx === -1) return;
      const zone = groups[idx] as any;
      const isAnalyzedPhoto = (zone.analyzedIndices || []).includes(photoIndex);
      const executeRemove = () => {
          Object.assign(zone, removePhotoFromCollection(zone, photoIndex));

          if (isAnalyzedPhoto) {
              Object.assign(zone, resetAnalysisCommonFields({
                  ...zone,
                  aiSizeBand: undefined,
                  aiHeightMeters: 0,
                  aiDetectedCount: undefined,
                  aiDetectedSummary: undefined,
                  sizeBandConfidence: undefined,
                  alturaConfidence: undefined,
                  difficultyHigh: undefined,
                  estimatedHours: 0
              }));
          }

          groups[idx] = zone;
          const newHours = calculateTotalTreeHours(groups);
          commitTreeGroups(groups, newHours, true);
      };

      if (!isAnalyzedPhoto) {
          executeRemove();
          return;
      }

      openPhotoRemovalConfirm({
          analysis: zone.analysisV2,
          analysisLevel: zone.analysisLevel,
          observations: zone.observations,
          subjectLabel: 'el árbol',
          onConfirm: executeRemove
      });
  };

  const addPalmGroup = () => {
    const newGroup = {
        id: `palm-${Date.now()}`,
        species: '',
        height: '',
        quantity: 1,
        state: 'normal',
        wasteRemoval: true,
        photoIds: [] as string[],
        photoUrls: [] as string[],
        files: [] as File[],
        selectedIndices: [] as number[],
        analyzedIndices: [] as number[]
    };
    const newGroups = [...(bookingData.palmGroups || []), newGroup as any];
    commitPalmGroups(newGroups);
  };

  const removePalmGroup = (id: string) => {
      const currentGroups = bookingData.palmGroups || [];
      const nextGroups = currentGroups.filter(g => g.id !== id);
      commitPalmGroups(nextGroups);
      updatePalmPricing(nextGroups);
  };

  const handlePalmFileSelect = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
      await appendFilesToSimplePhotoCollection({
        key: 'palmGroups',
        itemId: id,
        event: e,
        validationScope: 'details_palm_selection',
        uploadSetter: setPalmUploads,
      });
  };

  const togglePalmPhotoSelection = (id: string, photoIndex: number) => {
      toggleSimplePhotoCollectionSelection('palmGroups', id, photoIndex);
  };

  const removePalmPhoto = (id: string, photoIndex: number) => {
      const groups = [...(bookingData.palmGroups || [])];
      const zIdx = groups.findIndex(z => z.id === id);
      if (zIdx === -1) return;
      const group = groups[zIdx] as any;
      const isAnalyzedPhoto = (group.analyzedIndices || []).includes(photoIndex);
      const executeRemove = () => {
          Object.assign(group, removePhotoFromCollection(group, photoIndex));
          if (isAnalyzedPhoto) {
              Object.assign(group, resetAnalysisCommonFields({
                  ...group,
                  species: '',
                  height: '',
                  state: 'normal',
                  hasPhytosanitary: false,
                  hasTrunkPeeling: false,
                  needsPhytosanitary: false,
                  needsTrunkFinish: false,
                  hasAccessDifficulty: undefined,
                  lowestRangeThreshold: undefined,
                  highestOpenRangeThreshold: undefined,
                  isTerminalOpenRange: false,
                  allowsPriceChange: false,
              }));
          }
          groups[zIdx] = group;
          void updatePalmPricing(groups);
          saveProgress();
      };

      if (!isAnalyzedPhoto) {
          executeRemove();
          return;
      }

      openPhotoRemovalConfirm({
          analysis: group.analysisV2,
          analysisLevel: group.analysisLevel,
          observations: group.observations,
          subjectLabel: 'el grupo',
          onConfirm: executeRemove
      });
  };

  const analyzePalmGroup = async (id: string) => {
      const groups = [...(bookingData.palmGroups || [])];
      const idx = groups.findIndex(z => z.id === id);
      if (idx === -1) return;
      const group = groups[idx];
      
      try {
          setPalmAnalyzingZoneIds(prev => new Set(prev).add(id));
          const photoUrls = (group as any).photoUrls || [];
          const selectedIndices = getDefaultSelectedPhotoIndices(photoUrls.length, (group as any).selectedIndices);
          const finalPhotoUrls = await resolveAnalysisPhotoSources({
            photoUrls,
            selectedIndices,
            files: (group as any).files,
          });
          
          const debugInputs = {
             description: '',
             photoCount: finalPhotoUrls.length,
             selectedServiceIds: bookingData.serviceIds,
             photoUrls: finalPhotoUrls,
             serviceName: 'Poda de palmeras',
             model: aiModel
          };

          const res = await estimateWorkWithAI(debugInputs);
          const analysis = res.analysis_v2;
          
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

          const allPalms = Array.isArray(res.palmas) ? res.palmas : [];
          // Solo palmeras realmente detectadas (excluye fallos / "No detectada").
          const detectedPalms = allPalms.filter(
            (p) => Number(p?.nivel_analisis) !== 3 && !!p?.especie && String(p.especie) !== 'No detectada'
          );
          // La IA PROPONE: no creamos zonas automáticas. Tomamos la palmera principal
          // y dejamos que el cliente confirme la cantidad (por defecto 1, sin inflar precio).
          const p0 = detectedPalms[0] || allPalms[0];
          const commonAnalysis = buildAnalysisCommonFields({
            analysis,
            analysisLevel: p0?.nivel_analisis,
            observations: p0?.observaciones,
            analyzedIndices: selectedIndices,
            selectedIndices,
            totalPhotoCount: photoUrls.length
          });
          group.species = p0?.especie ? p0.especie.charAt(0).toUpperCase() + p0.especie.slice(1) : (group.species || 'Desconocida');
          group.height = p0?.altura || group.height;
          group.state = normalizePalmState(p0?.estado);
          group.quantity = Math.max(1, Number(group.quantity) || 1);
          group.analysisV2 = commonAnalysis.analysisV2;
          group.analysisLevel = commonAnalysis.analysisLevel;
          group.observations = commonAnalysis.observations;
          (group as any).isFailed = commonAnalysis.isFailed;
          (group as any).analyzedIndices = commonAnalysis.analyzedIndices;
          (group as any).hasPhytosanitary = supportsPhytosanitaryForSpecies(group.species);
          (group as any).aiDetectedCount = detectedPalms.length;
          (group as any).aiDetectedSummary = summarizeDetectedPalms(detectedPalms);
          // Datos de la propuesta IA para confirmación del cliente: altura en metros
          // (permite re-mapear banda al cambiar especie) y confidences por campo.
          (group as any).aiDetectedHeightM = Number((p0 as any)?.altura_m) > 0 ? Number((p0 as any).altura_m) : undefined;
          (group as any).especieConfidence = toNullableConfidence((p0 as any)?.especie_confidence);
          (group as any).alturaConfidence = toNullableConfidence((p0 as any)?.altura_confidence);
          (group as any).estadoConfidence = toNullableConfidence((p0 as any)?.estado_confidence);
          (group as any).stateProposedByAI = group.state !== 'normal';
          groups[idx] = group;

          await updatePalmPricing(groups);
          commitPalmGroups(groups, true);
          
          currentDebugInfo.finalAnalysisData = { palmGroups: groups };
          setDebugLogs({...currentDebugInfo});
      } catch (e: any) {
          reportDetailsPageIssue({
            event: 'booking.details_analysis_failed',
            service: 'Poda de palmeras',
            error: e,
            serviceId: bookingData.serviceIds?.[0],
            zoneId: id,
            scope: 'details_palm_analysis',
            photoCount: ((group as any).photoUrls || []).length,
          });
          const failureFields = buildAnalysisFailureFields({
            serviceName: 'Poda de palmeras',
            selectedIndices: (group as any).selectedIndices,
            totalPhotoCount: ((group as any).photoUrls || []).length
          });
          setDebugLogs(prev => appendDebugError(
            prev || createDebugInfo({ service: 'Poda de palmeras', model: aiModel, promptInputs: {} }),
            e
          ));
          
          setBookingData((prev) => {
              const currentZones = prev.palmGroups || [];
              const updatedZones = currentZones.map(z => {
                  if (z.id === id) {
                      return { 
                          ...z, 
                          ...failureFields
                      } as any;
                  }
                  return z;
              });
              
              const nextServicesData = mergeActiveServiceSnapshot(prev, {
                palmGroups: updatedZones
              });

              return { ...prev, palmGroups: updatedZones, servicesData: nextServicesData };
          });
          
          const currentZones = bookingData.palmGroups || [];
          const updatedZones = currentZones.map(z => z.id === id ? {
            ...z,
            ...failureFields
          } as any : z);
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
          const selectedIndices = getDefaultSelectedPhotoIndices(group.photoUrls?.length || 0, (group as any).selectedIndices);
          const finalPhotoUrls = await resolveAnalysisPhotoSources({
            photoUrls: group.photoUrls || [],
            selectedIndices,
            files: (group as any).files,
          });
          
          // Debug Info Prep
          const debugInputs = {
             description: '',
             photoCount: finalPhotoUrls.length,
             selectedServiceIds: bookingData.serviceIds,
             photoUrls: finalPhotoUrls,
             serviceName: 'Poda de árboles',
             model: aiModel
          };

          const res = await estimateWorkWithAI(debugInputs);
          const analysis = res.analysis_v2;
          
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


          const allTrees = Array.isArray(res.arboles) ? res.arboles : [];
          // Solo árboles realmente analizados (excluye fallos nivel 3).
          const detectedTrees = allTrees.filter((t) => Number(t?.nivel_analisis) !== 3 && !!t?.size_band);
          // La IA PROPONE: tomamos el árbol principal y el cliente confirma la cantidad.
          const a = detectedTrees[0] || allTrees[0] || null;
          const treePatch = adaptTreeAnalysisResult({
            analysis,
            legacyTree: a,
            selectedIndices,
            totalPhotoCount: group.photoUrls?.length || 0,
            difficultyHigh: group.difficultyHigh,
          });
          Object.assign(group, treePatch);
          (group as any).quantity = Math.max(1, Math.trunc(Number((group as any).quantity) || 1));
          (group as any).aiDetectedCount = detectedTrees.length;
          (group as any).aiDetectedSummary = summarizeDetectedTrees(detectedTrees);
          group.isFailed = Boolean(group.isFailed || !group.aiSizeBand);
          group.estimatedHours = estimateTreeZoneHours(group);

          groups[idx] = group;
          const newHours = calculateTotalTreeHours(groups);
          commitTreeGroups(groups, newHours, true);
          
          // Update Final Debug Data
          currentDebugInfo.finalAnalysisData = { treeGroups: groups, estimatedHours: newHours };
          setDebugLogs({...currentDebugInfo});
      } catch (e: any) {
          reportDetailsPageIssue({
            event: 'booking.details_analysis_failed',
            service: 'Poda de árboles',
            error: e,
            serviceId: bookingData.serviceIds?.[0],
            zoneId: id,
            scope: 'details_tree_analysis',
            photoCount: group.photoUrls?.length || 0,
          });
          const failureFields = buildAnalysisFailureFields({
            serviceName: 'Poda de árboles',
            selectedIndices: (group as any).selectedIndices,
            totalPhotoCount: (group.photoUrls || []).length
          });
          setDebugLogs(prev => appendDebugError(
            prev || createDebugInfo({ service: 'Poda de árboles', model: aiModel, promptInputs: {} }),
            e
          ));
          
          setBookingData((prev) => {
              const currentZones = prev.treeGroups || [];
              const updatedZones = currentZones.map(z => {
                  if (z.id === id) {
                      return { 
                          ...z, 
                          ...failureFields
                      };
                  }
                  return z;
              });
              
              const newHours = calculateTotalTreeHours(updatedZones);
              
              const nextServicesData = mergeActiveServiceSnapshot(prev, {
                treeGroups: updatedZones,
                estimatedHours: newHours
              });

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
    commitShrubGroups(newGroups, true);
  };

  const updateShrubGroup = (id: string, updates: Partial<NonNullable<BookingData['shrubGroups']>[number]>) => {
    const next = [...(bookingData.shrubGroups || [])];
    const idx = next.findIndex((z) => z.id === id);
    if (idx === -1) return;
    next[idx] = { ...next[idx], ...updates };
    commitShrubGroups(next, true);
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
              return resetAnalysisCommonFields({
                ...z,
                area: 0,
              });
            }
            return z;
          });
          commitShrubGroups(newGroups, true);
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
          commitShrubGroups(newGroups, true);
        }
      });
    }
  };

  const toggleShrubPhotoSelection = (zoneId: string, photoIndex: number) => {
      toggleSimplePhotoCollectionSelection('shrubGroups', zoneId, photoIndex);
  };

  const removeShrubPhoto = (zoneId: string, photoIndex: number) => {
      const groups = [...(bookingData.shrubGroups || [])];
      const idx = groups.findIndex(z => z.id === zoneId);
      if (idx === -1) return;
      const zone = groups[idx];
      const isAnalyzedPhoto = (zone.analyzedIndices || []).includes(photoIndex);
      const executeRemove = () => {
          Object.assign(zone, removePhotoFromCollection(zone, photoIndex));

          if (isAnalyzedPhoto) {
              Object.assign(zone, resetAnalysisCommonFields({
                  ...zone,
                  area: 0,
              }));
          }

          groups[idx] = zone;
          commitShrubGroups(groups, true);
      };

      if (!isAnalyzedPhoto) {
          executeRemove();
          return;
      }

      openPhotoRemovalConfirm({
          analysis: zone.analysisV2,
          analysisLevel: zone.analysisLevel,
          observations: zone.observations,
          subjectLabel: 'el macizo',
          onConfirm: executeRemove
      });
  };

  const handleShrubFileSelect = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    await appendFilesToSimplePhotoCollection({
      key: 'shrubGroups',
      itemId: id,
      event: e,
      validationScope: 'details_shrub_selection',
      uploadSetter: setShrubUploads,
    });

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
      const indicesToAnalyze = getDefaultSelectedPhotoIndices(allUrls.length, group.selectedIndices);
      const finalUrls = await resolveAnalysisPhotoSources({
        photoUrls: allUrls,
        selectedIndices: indicesToAnalyze,
        files: group.files,
      });

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
          const analysis = res.analysis_v2;
          
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


          if (analysis || (res.tareas && res.tareas.length > 0)) {
              const t = res.tareas?.[0] || {};
              Object.assign(group, adaptShrubAnalysisResult({
                analysis,
                legacyTask: t,
                selectedIndices: indicesToAnalyze,
                totalPhotoCount: allUrls.length
              }));
          } else {
             throw new Error('No se han detectado datos válidos en las imágenes.');
          }

          groups[idx] = group;
          commitShrubGroups(groups, true);
          
          // Update Final Debug Data
          currentDebugInfo.finalAnalysisData = { shrubGroups: groups };
          setDebugLogs({...currentDebugInfo});
      } catch (e: any) {
          reportDetailsPageIssue({
            event: 'booking.details_analysis_failed',
            service: 'Poda de plantas y arbustos',
            error: e,
            serviceId: bookingData.serviceIds?.[0],
            zoneId: id,
            scope: 'details_shrub_analysis',
            photoCount: allUrls.length,
          });
          const failureFields = buildAnalysisFailureFields({
            serviceName: 'Poda de plantas y arbustos',
            selectedIndices: group.selectedIndices,
            totalPhotoCount: allUrls.length
          });
          setDebugLogs(prev => appendDebugError(
            prev || createDebugInfo({ service: 'Poda de plantas y arbustos', model: aiModel, promptInputs: {} }),
            e
          ));
          
          setBookingData((prev) => {
              const currentZones = prev.shrubGroups || [];
              const updatedZones = currentZones.map(z => {
                  if (z.id === id) {
                      return { 
                          ...z, 
                          ...failureFields
                      };
                  }
                  return z;
              });
              
              const nextServicesData = mergeActiveServiceSnapshot(prev, {
                shrubGroups: updatedZones
              });

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
      photoIds: [] as string[],
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
      commitSimplePhotoCollectionPatch('weedingZones', nextZones, {}, { saveAfterCommit: true });
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
        photoIds: [] as string[],
        photoUrls: [] as string[],
        files: [] as File[],
        selectedIndices: [] as number[],
        analyzedIndices: [] as number[]
    };
    const newZones = [...(bookingData.phytosanitaryZones || []), newZone];
    commitPhytosanitaryZones(newZones, true);
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
        commitPhytosanitaryZones(newZones, true);
      }
    });
  };

  const handlePhytosanitaryFileSelect = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    await appendFilesToSimplePhotoCollection({
      key: 'phytosanitaryZones',
      itemId: id,
      event: e,
      validationScope: 'details_phytosanitary_selection',
      uploadSetter: setPhytosanitaryUploads,
    });
  };

  const togglePhytosanitaryPhotoSelection = (zoneId: string, photoIndex: number) => {
    toggleSimplePhotoCollectionSelection('phytosanitaryZones', zoneId, photoIndex);
  };

  const removePhytosanitaryPhoto = (zoneId: string, photoIndex: number, skipConfirm = false) => {
    const zones = [...(bookingData.phytosanitaryZones || [])];
    const idx = zones.findIndex(z => z.id === zoneId);
    if (idx === -1) return;
    const zone = { ...zones[idx] };

    const doRemove = () => {
      Object.assign(zone, removePhotoFromCollection(zone, photoIndex));
      
      if (isPhytosanitaryZoneAnalyzed(zone)) {
        Object.assign(zone, resetAnalysisCommonFields({
          ...zone,
          analysisMetrics: undefined,
          area: 0,
        }));
      }

      zones[idx] = zone;
      commitPhytosanitaryZones(zones);
    };

    if (!skipConfirm && isPhytosanitaryZoneAnalyzed(zone)) {
      openPhotoRemovalConfirm({
        analysis: zone.analysisV2,
        analysisLevel: zone.analysisLevel,
        observations: zone.observations,
        subjectLabel: 'la zona fitosanitaria',
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
      Object.assign(zone, resetAnalysisCommonFields(zone));
    }

    zones[idx] = zone;
    commitPhytosanitaryZones(zones);
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
      Object.assign(zone, resetAnalysisCommonFields(zone));
    }

    zones[idx] = zone;
    commitPhytosanitaryZones(zones);
  };

  const analyzePhytosanitaryZone = async (id: string, options?: { silent?: boolean }) => {
      const zones = [...(bookingData.phytosanitaryZones || [])];
      const idx = zones.findIndex(z => z.id === id);
      if (idx === -1) return false;
      const zone = zones[idx];
      const allUrls = zone.photoUrls || [];
      const indicesToAnalyze = getDefaultSelectedPhotoIndices(allUrls.length, zone.selectedIndices);
      const finalUrls = await resolveAnalysisPhotoSources({
        photoUrls: allUrls,
        selectedIndices: indicesToAnalyze,
        files: zone.files,
      });
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
          const analysis = res.analysis_v2;
          
          const resData = res as any;

          currentDebugInfo.rawResponse = res.rawResponse;
          currentDebugInfo.parsedResponse = {
            tareas: res.tareas || [],
            reasons: res.reasons || [],
            metricas_fitosanitarias: resData.metricas_fitosanitarias
          };
          setDebugLogs({ ...currentDebugInfo });
          
          if (!analysis && !resData.metricas_fitosanitarias && !(res.tareas && res.tareas.length > 0)) {
             throw new Error('No se han detectado datos válidos en las imágenes.');
          }

          Object.assign(zone, adaptPhytosanitaryAnalysisResult({
            analysis,
            legacyTask: res.tareas?.[0],
            legacyMetrics: resData.metricas_fitosanitarias,
            selectedIndices: indicesToAnalyze,
            totalPhotoCount: allUrls.length
          }));
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

          zones[idx] = zone;
          commitPhytosanitaryZones(zones, true);
          setDebugLogs({ ...currentDebugInfo });
          return true;
      } catch (e: any) {
          reportDetailsPageIssue({
            event: 'booking.details_analysis_failed',
            service: 'Servicios fitosanitarios',
            error: e,
            serviceId: bookingData.serviceIds?.[0],
            zoneId: id,
            scope: 'details_phytosanitary_analysis',
            photoCount: allUrls.length,
          });
          const failureFields = buildAnalysisFailureFields({
            serviceName: 'Servicios fitosanitarios',
            selectedIndices: zone.selectedIndices,
            totalPhotoCount: allUrls.length
          });
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
                          ...failureFields
                      };
                  }
                  return z;
              });
              
              const nextServicesData = mergeActiveServiceSnapshot(prev, {
                phytosanitaryZones: updatedZones
              });

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

  // Mantener la ref de callbacks de césped apuntando a los handlers actuales (cada render).
  lawnCb.current = {
    toggle: toggleLawnPhotoSelection,
    remove: removePhotoFromZone,
    add: handleLawnFileSelect,
    analyze: analyzeLawnZone,
    removeZone: removeLawnZone,
    deleteResult: deleteLawnResult,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="mx-auto w-full px-4 py-4 sm:max-w-md flex items-center justify-between">
          <button
            type="button"
            onClick={() => setCurrentStep(1)}
            aria-label="Volver al paso de servicios"
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
          >
            <ChevronLeft aria-hidden="true" className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">Detalles</h1>
          <div className="w-9" />
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-white">
        <div className="mx-auto w-full px-4 py-3 sm:max-w-md">
          <div className="flex items-center space-x-2 text-sm text-gray-600 mb-2">
            <span>Paso 3 de 5</span>
            <div className="flex-1 bg-gray-200 rounded-full h-1">
              <div className="bg-green-600 h-1 rounded-full" style={{ width: '60%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto w-full px-4 py-6 pb-24 sm:max-w-md">
        {resumeWarning ? (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4" aria-live="polite">
            <div className="flex items-start gap-3">
              <Info aria-hidden="true" className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-amber-900">{resumeWarning.title}</p>
                <p className="mt-1 text-sm text-amber-800">{resumeWarning.detail}</p>
                {resumeWarning.kind === 'rehydrated_partial' ? (
                  <p className="mt-2 text-sm text-amber-800">
                    {resumeWarning.restoredPhotoCount
                      ? `Se han restaurado ${resumeWarning.restoredPhotoCount} foto${resumeWarning.restoredPhotoCount === 1 ? '' : 's'} local${resumeWarning.restoredPhotoCount === 1 ? '' : 'es'} desde este dispositivo. `
                      : ''}
                    Si vuelves atrás y falta alguna imagen, resúbela antes de volver a analizar o confirmar la reserva.
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={clearResumeWarning}
                aria-label="Cerrar aviso de borrador recuperado"
                className="rounded-lg p-1 text-amber-700 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}

        {manualChoiceAvailable ? (
          <ManualEntryChoice mode={dataInputMode} onSelect={handleSelectInputMode} />
        ) : null}

        {isManualActive && manualSurvey ? (
          <ManualEntryWizard
            survey={manualSurvey}
            submitting={manualSubmitting}
            initialItems={manualDraft?.items ?? persistedManualDraft?.items}
            initialWasteRemoval={manualDraft?.wasteRemoval ?? persistedManualDraft?.wasteRemoval ?? bookingData.wasteRemoval}
            onDraftChange={handleManualDraftChange}
            onStepComplete={(stepId) =>
              reportBookingEvent('info', {
                event: 'booking.manual_entry_step_completed',
                context: { serviceKey: manualServiceKey, stepId },
              })
            }
            onConsentAccepted={() =>
              reportBookingEvent('info', {
                event: 'booking.manual_entry_consent_accepted',
                context: { serviceKey: manualServiceKey, legalVersion: MANUAL_ENTRY_LEGAL_VERSION },
              })
            }
            onSubmit={handleManualSubmit}
            onSwitchToPhotos={() => handleSelectInputMode('photos')}
          />
        ) : null}

        <div className={isManualActive ? 'hidden' : 'contents'}>

        {/* Photo Upload */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">
                {serviceContent.title}
            </h2>
            {serviceFlags.showsPhotoCounter && (
                <span className="text-sm text-gray-500">{photos.length}/5</span>
            )}
          </div>
          <p className="text-gray-600 text-sm mb-4">
            {serviceContent.description}
          </p>
          {isDevAnalysisSeedEnabled ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-amber-900">Modo desarrollo</p>
                  <p className="text-xs text-amber-800">
                    Inyecta datos de prueba equivalentes al resultado de un análisis real para probar pricing, tiempos y reserva sin subir fotos.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void applyDevAnalysisSeed();
                  }}
                  className="inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-100"
                >
                  Datos de prueba
                </button>
              </div>
            </div>
          ) : null}

             <div className="flex flex-col gap-4">
               {(() => {
                   const isLawnService = serviceFlags.isLawn;
                   const isHedgeService = serviceFlags.isHedge;
                   const isTreeService = serviceFlags.isTree;
                   const isPalmService = serviceFlags.isPalm;
                   const isShrubService = serviceFlags.isShrub;
                   const isPhytosanitaryService = serviceFlags.isPhytosanitary;
                   const isWeedingService = serviceFlags.isWeeding;
                   if (serviceFlags.isLawn) {
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

                             {(bookingData.lawnZones || []).map((zone, idx) => (
                                 <LawnZoneCard
                                     key={zone.id}
                                     zone={zone}
                                     index={idx}
                                     uploadingIndices={lawnUploads[zone.id]}
                                     isAnalyzing={lawnAnalyzingZoneIds.has(zone.id)}
                                     loadingMessage={getAnalysisLoadingMessage('Corte de césped')}
                                     {...lawnHandlers}
                                 />
                             ))}

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
                                const isAnalyzed = hasCanonicalAnalysisResult(zone.analysisV2, {
                                  analysisLevel: zone.analysisLevel,
                                  isFailed: zone.isFailed,
                                  observations: zone.observations,
                                  analyzedIndices: zone.analyzedIndices
                                }) || isHedgeZoneAnalyzed(normalizedZone);
                                const isFailedResult = hasCanonicalAnalysisFailure(zone.analysisV2, {
                                  analysisLevel: zone.analysisLevel,
                                  isFailed: zone.isFailed,
                                  observations: zone.observations
                                });
                                const isZoneAnalyzing = hedgeAnalyzingZoneIds.has(zone.id);
                                const faceAUrls = normalizedZone.faceA.photoUrls || [];
                                const faceASelected = getDefaultSelectedPhotoIndices(faceAUrls.length, normalizedZone.faceA.selectedIndices);
                                const hasFaceAPhotos = faceAUrls.length > 0;
                                const hasFaceASelected = faceASelected.length > 0;
                                const totalPhotos = (normalizedZone.faceA.photoUrls?.length || 0) + (normalizedZone.faceB.photoUrls?.length || 0);

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
                                              const allFacePhotos = face.photoUrls || [];
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
                                                           photoIds={face.photoIds}
                                                           uploadingIndices={hedgeUploads[uploadKey] || new Set()}
                                                           selectedIndices={getDefaultSelectedPhotoIndices(allFacePhotos.length, face.selectedIndices)}
                                                           analyzedIndices={face.analyzedIndices ?? []}
                                                           isAnalyzing={isZoneAnalyzing}
                                                           isAnalyzed={isAnalyzed}
                                                           analysis={zone.analysisV2}
                                                           analysisLevel={zone.analysisLevel}
                                                           observations={zone.observations}
                                                           loadingMessage={getAnalysisLoadingMessage('Poda de setos')}
                                                           onRetryAnalysis={() => analyzeHedgeZone(zone.id)}
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

                                        {shouldShowZoneAnalysisResult(isAnalyzed, isZoneAnalyzing) && (
                                            <div className="mt-4">
                                                {isFailedResult ? (
                                                    <AnalysisFailedCard
                                                        analysis={zone.analysisV2}
                                                        message={zone.observations?.[0]}
                                                        onReanalyze={() => analyzeHedgeZone(zone.id)}
                                                    />
                                                ) : (
                                                    <ServiceResultCard
                                                        title={`Seto ${HEDGE_BAND_LABELS[(zone.height as HedgeHeightBand)] ? HEDGE_BAND_LABELS[zone.height as HedgeHeightBand].toLowerCase() : zone.height}`}
                                                        analysis={zone.analysisV2}
                                                        analysisLevel={zone.analysisLevel}
                                                        observations={zone.observations}
                                                    >
                                                        {/* Resumen editable: la IA propone longitud/altura/estado y el cliente confirma o corrige. Las caras las decide SIEMPRE el cliente. */}
                                                        {(() => {
                                                            const zoneAny = zone as any;
                                                            const lowLengthConfidence = zoneAny.longitudConfidence != null && zoneAny.longitudConfidence < PALM_CONFIDENCE_REVIEW_THRESHOLD;
                                                            const lowHeightConfidence = zoneAny.alturaConfidence != null && zoneAny.alturaConfidence < PALM_CONFIDENCE_REVIEW_THRESHOLD;
                                                            const currentState = normalizeHedgeStateValue(zone.state);
                                                            const currentFaces: 1 | 2 = Number(zoneAny.faces_to_trim) >= 2 ? 2 : 1;
                                                            return (
                                                                <div className="mt-3 space-y-3">
                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                                        <div>
                                                                            <label className="block text-xs font-medium text-gray-700 mb-1">Longitud (m)</label>
                                                                            <input
                                                                                type="number"
                                                                                min="1"
                                                                                value={zone.length || ''}
                                                                                onChange={(e) => updateHedgeZone(zone.id, { length: Math.max(0, Number(e.target.value) || 0) })}
                                                                                className="w-full text-sm border border-gray-300 rounded-lg px-2 py-2 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                                                                            />
                                                                            {lowLengthConfidence && (
                                                                                <p className="text-[11px] text-amber-700 mt-1">
                                                                                    Revisa la longitud: en las fotos no había una referencia de escala clara. Truco: cuéntala a pasos (1 paso ≈ 0,8 m).
                                                                                </p>
                                                                            )}
                                                                        </div>
                                                                        <div>
                                                                            <label className="block text-xs font-medium text-gray-700 mb-1">Altura del seto</label>
                                                                            <select
                                                                                value={zone.height}
                                                                                onChange={(e) => updateHedgeZone(zone.id, { height: e.target.value })}
                                                                                className="w-full text-sm border border-gray-300 rounded-lg px-2 py-2 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                                                                            >
                                                                                {!HEDGE_HEIGHT_BANDS.includes(zone.height as HedgeHeightBand) && (
                                                                                    <option value={zone.height}>{zone.height}</option>
                                                                                )}
                                                                                {HEDGE_HEIGHT_BANDS.map((band) => (
                                                                                    <option key={band} value={band}>{HEDGE_BAND_LABELS[band]}</option>
                                                                                ))}
                                                                            </select>
                                                                            {lowHeightConfidence && (
                                                                                <p className="text-[11px] text-amber-700 mt-1">
                                                                                    Revisa la altura: influye en el precio y en qué jardineros pueden hacer el trabajo.
                                                                                </p>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-xs font-medium text-gray-700 mb-1">¿Cuántas caras quieres recortar?</label>
                                                                        <div className="flex gap-2">
                                                                            {([1, 2] as const).map((faces) => (
                                                                                <button
                                                                                    key={faces}
                                                                                    type="button"
                                                                                    onClick={() => updateHedgeZone(zone.id, { faces_to_trim: faces, hasBackFaceTrim: faces === 2 } as any)}
                                                                                    className={`flex-1 py-2 px-2 rounded-lg border text-xs font-medium transition-colors ${
                                                                                        currentFaces === faces
                                                                                            ? 'bg-green-50 border-green-500 text-green-700 ring-1 ring-green-500'
                                                                                            : 'bg-white border-gray-200 text-gray-600 hover:border-green-300 hover:bg-gray-50'
                                                                                    }`}
                                                                                >
                                                                                    {faces === 1 ? '1 cara (solo la delantera)' : '2 caras (delantera y trasera)'}
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                        <p className="text-[11px] text-gray-500 mt-1">
                                                                            Recortar las dos caras duplica los metros de trabajo.
                                                                        </p>
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-xs font-medium text-gray-700 mb-1">Estado del seto</label>
                                                                        <div className="flex gap-2">
                                                                            {(['normal', 'media', 'alta'] as HedgeState[]).map((stateOption) => (
                                                                                <button
                                                                                    key={stateOption}
                                                                                    type="button"
                                                                                    onClick={() => updateHedgeZone(zone.id, { state: stateOption, stateProposedByAI: false } as any)}
                                                                                    className={`flex-1 py-2 px-2 rounded-lg border text-xs font-medium transition-colors ${
                                                                                        currentState === stateOption
                                                                                            ? 'bg-green-50 border-green-500 text-green-700 ring-1 ring-green-500'
                                                                                            : 'bg-white border-gray-200 text-gray-600 hover:border-green-300 hover:bg-gray-50'
                                                                                    }`}
                                                                                >
                                                                                    {HEDGE_STATE_LABELS[stateOption]}
                                                                                </button>
                                                                            ))}
                                                                        </div>
                                                                        {zoneAny.stateProposedByAI && currentState !== 'normal' && (
                                                                            <p className="text-[11px] text-amber-700 mt-1">
                                                                                Estado propuesto por la IA según tus fotos. Puede aplicar un recargo del profesional: confírmalo o corrígelo.
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
                                                    </ServiceResultCard>
                                                )}
                                            </div>
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
                                const isAnalyzed = hasCanonicalAnalysisResult(zone.analysisV2, {
                                  analysisLevel: zone.analysisLevel,
                                  isFailed: (zone as any).isFailed,
                                  observations: zone.observations,
                                  analyzedIndices: (zone as any).analyzedIndices
                                });
                                 const photoUrls = (zone as any).photoUrls || [];
                                 const isZoneAnalyzing = palmAnalyzingZoneIds.has(zone.id);
                                const isFailedResult = hasCanonicalAnalysisFailure(zone.analysisV2, {
                                  analysisLevel: zone.analysisLevel,
                                  isFailed: (zone as any).isFailed,
                                  observations: zone.observations
                                });
                                const hasResult = isAnalyzed;

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
                                             photoIds={normalizePhotoIdentityList(zone)}
                                             uploadingIndices={palmUploads[zone.id] || new Set()}
                                            selectedIndices={getDefaultSelectedPhotoIndices(photoUrls.length, (zone as any).selectedIndices)}
                                            analyzedIndices={getCanonicalAnalyzedPhotoIndices(zone.analysisV2, {
                                              analyzedIndices: (zone as any).analyzedIndices,
                                              selectedIndices: (zone as any).selectedIndices,
                                              totalPhotoCount: photoUrls.length
                                            })}
                                             isAnalyzing={isZoneAnalyzing}
                                             isAnalyzed={hasResult}
                                             analysis={zone.analysisV2}
                                             analysisLevel={zone.analysisLevel}
                                             observations={zone.observations}
                                             loadingMessage={getAnalysisLoadingMessage('Poda de palmeras')}
                                             onRetryAnalysis={() => analyzePalmGroup(zone.id)}
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
                                                            Object.assign(z, resetAnalysisCommonFields(z));
                                                            commitPalmGroups(next);
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

                                       {shouldShowZoneAnalysisResult(hasResult, isZoneAnalyzing) && (
                                            <div className="mt-4">
                                                {isFailedResult ? (
                                                    <AnalysisFailedCard 
                                                        analysis={zone.analysisV2}
                                                        message={zone.observations?.[0] || 'Intenta hacer la foto desde otro ángulo.'} 
                                                        onReanalyze={() => analyzePalmGroup(zone.id)} 
                                                    />
                                                ) : (
                                                    <ServiceResultCard
                                                        title={zone.species || 'Desconocida'}
                                                        analysis={zone.analysisV2}
                                                        analysisLevel={zone.analysisLevel}
                                                        observations={zone.observations}
                                                        onDelete={() => removePalmGroup(zone.id)}
                                                    >
                                                        {/* Resumen editable: la IA propone especie/altura/estado y el cliente confirma o corrige */}
                                                        {(() => {
                                                            const zoneAny = zone as any;
                                                            const canonicalSpecies = resolveSpeciesBusinessRule(zone.species)?.canonicalName || '';
                                                            const heightBands = getPalmHeightBandsForSpecies(zone.species);
                                                            const lowSpeciesConfidence = zoneAny.especieConfidence != null && zoneAny.especieConfidence < PALM_CONFIDENCE_REVIEW_THRESHOLD;
                                                            const isSimilarSpecies = /o similar/i.test(zone.species || '');
                                                            const lowHeightConfidence = zoneAny.alturaConfidence != null && zoneAny.alturaConfidence < PALM_CONFIDENCE_REVIEW_THRESHOLD;
                                                            const handleSpeciesEdit = (newSpecies: string) => {
                                                                if (!newSpecies) return;
                                                                const heightM = Number(zoneAny.aiDetectedHeightM);
                                                                const bands = getPalmHeightBandsForSpecies(newSpecies);
                                                                const rebanded = Number.isFinite(heightM) && heightM > 0
                                                                    ? mapPalmHeightToBand(newSpecies, heightM)
                                                                    : null;
                                                                const nextHeight = rebanded
                                                                    || (bands.includes(zone.height) ? zone.height : bands[0] || '');
                                                                updatePalmGroup(zone.id, { species: newSpecies, height: nextHeight } as any);
                                                            };
                                                            return (
                                                                <div className="mt-3 space-y-3">
                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                                        <div>
                                                                            <label className="block text-xs font-medium text-gray-700 mb-1">Especie</label>
                                                                            <select
                                                                                value={canonicalSpecies}
                                                                                onChange={(e) => handleSpeciesEdit(e.target.value)}
                                                                                className="w-full text-sm border border-gray-300 rounded-lg px-2 py-2 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                                                                            >
                                                                                {!canonicalSpecies && <option value="">Selecciona especie</option>}
                                                                                {PALM_CANONICAL_SPECIES.map((sp) => (
                                                                                    <option key={sp} value={sp}>{sp}</option>
                                                                                ))}
                                                                            </select>
                                                                            {(lowSpeciesConfidence || isSimilarSpecies) && (
                                                                                <p className="text-[11px] text-amber-700 mt-1">
                                                                                    La IA no está segura de la especie: revísala, influye en el precio.
                                                                                </p>
                                                                            )}
                                                                        </div>
                                                                        <div>
                                                                            <label className="block text-xs font-medium text-gray-700 mb-1">Altura del tronco</label>
                                                                            <select
                                                                                value={zone.height || ''}
                                                                                onChange={(e) => updatePalmGroup(zone.id, { height: e.target.value } as any)}
                                                                                className="w-full text-sm border border-gray-300 rounded-lg px-2 py-2 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                                                                            >
                                                                                {!zone.height && <option value="">Selecciona altura</option>}
                                                                                {zone.height && !heightBands.includes(zone.height) && (
                                                                                    <option value={zone.height}>{zone.height} m</option>
                                                                                )}
                                                                                {heightBands.map((band) => (
                                                                                    <option key={band} value={band}>{band} m</option>
                                                                                ))}
                                                                            </select>
                                                                            {lowHeightConfidence && (
                                                                                <p className="text-[11px] text-amber-700 mt-1">
                                                                                    Revisa la altura: en las fotos no había una referencia de escala clara.
                                                                                </p>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-xs font-medium text-gray-700 mb-1">Estado de la palmera</label>
                                                                        <div className="flex gap-2">
                                                                            {PALM_STATE_OPTIONS.map((option) => {
                                                                                const isActive = normalizePalmState(zone.state) === option.value;
                                                                                return (
                                                                                    <button
                                                                                        key={option.value}
                                                                                        type="button"
                                                                                        onClick={() => updatePalmGroup(zone.id, { state: option.value, stateProposedByAI: false } as any)}
                                                                                        className={`flex-1 py-2 px-2 rounded-lg border text-xs font-medium transition-colors ${
                                                                                            isActive
                                                                                                ? 'bg-green-50 border-green-500 text-green-700 ring-1 ring-green-500'
                                                                                                : 'bg-white border-gray-200 text-gray-600 hover:border-green-300 hover:bg-gray-50'
                                                                                        }`}
                                                                                    >
                                                                                        {option.label}
                                                                                    </button>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                        {zoneAny.stateProposedByAI && normalizePalmState(zone.state) !== 'normal' && (
                                                                            <p className="text-[11px] text-amber-700 mt-1">
                                                                                Estado propuesto por la IA según tus fotos. Puede aplicar un recargo del profesional: confírmalo o corrígelo.
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}

                                                        {/* Propuesta de la IA: detección como sugerencia, el cliente confirma la cantidad */}
                                                        {Number((zone as any).aiDetectedCount || 0) > 1 && (
                                                            <div className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-md px-3 py-2 mt-3">
                                                                La IA ha detectado <span className="font-semibold">{(zone as any).aiDetectedCount} palmeras</span> en estas fotos
                                                                {(zone as any).aiDetectedSummary ? <> ({(zone as any).aiDetectedSummary})</> : null}.
                                                                Confirma cuántas quieres podar ajustando la cantidad. Si hay especies o alturas distintas, añade un grupo aparte.
                                                            </div>
                                                        )}
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
                                                                    className="w-10 text-center text-sm py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
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
                                                                    <label className={`flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition-colors duration-200 ${
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
                                                                    <label className={`flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition-colors duration-200 ${
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
                                const isAnalyzed = hasCanonicalAnalysisResult(zone.analysisV2, {
                                  analysisLevel: zone.analysisLevel,
                                  isFailed: zone.isFailed,
                                  observations: zone.observations,
                                  analyzedIndices: (zone as any).analyzedIndices
                                });
                                 const photoUrls = zone.photoUrls || [];
                                 const isZoneAnalyzing = treeAnalyzingZoneIds.has(zone.id);
                                const isFailedResult = hasCanonicalAnalysisFailure(zone.analysisV2, {
                                  analysisLevel: zone.analysisLevel,
                                  isFailed: zone.isFailed,
                                  observations: zone.observations
                                });
                                const hasResult = isAnalyzed;

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
                                             photoIds={normalizePhotoIdentityList(zone)}
                                             uploadingIndices={treeUploads[zone.id] || new Set()}
                                             selectedIndices={getDefaultSelectedPhotoIndices(photoUrls.length, (zone as any).selectedIndices)}
                                             analyzedIndices={getCanonicalAnalyzedPhotoIndices(zone.analysisV2, {
                                               analyzedIndices: (zone as any).analyzedIndices,
                                               selectedIndices: (zone as any).selectedIndices,
                                               totalPhotoCount: photoUrls.length
                                             })}
                                             isAnalyzing={isZoneAnalyzing}
                                             isAnalyzed={hasResult}
                                             analysis={zone.analysisV2}
                                             analysisLevel={zone.analysisLevel}
                                             observations={zone.observations}
                                             loadingMessage={getAnalysisLoadingMessage('Poda de árboles')}
                                             onRetryAnalysis={() => analyzeTreeGroup(zone.id)}
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
                                                            Object.assign(z, resetAnalysisCommonFields({
                                                              ...z,
                                                              aiSizeBand: undefined,
                                                              aiHeightMeters: 0,
                                                              aiDetectedCount: undefined,
                                                              aiDetectedSummary: undefined,
                                                              sizeBandConfidence: undefined,
                                                              alturaConfidence: undefined,
                                                              difficultyHigh: undefined,
                                                              estimatedHours: 0
                                                            }));
                                                             const newHours = calculateTotalTreeHours(next);
                                                             commitTreeGroups(next, newHours);
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
                                                        analysis={zone.analysisV2}
                                                        message={zone.observations?.[0] || 'Intenta hacer la foto desde otro ángulo.'} 
                                                        onReanalyze={() => analyzeTreeGroup(zone.id)} 
                                                    />
                                                ) : (
                                                    <ServiceResultCard
                                                        title={`Árbol ${treeBandLabel(normalizeTreeSizeBand((zone as any).aiSizeBand)).toLowerCase()}`}
                                                        analysis={zone.analysisV2}
                                                        analysisLevel={zone.analysisLevel}
                                                        observations={zone.observations}
                                                        onDelete={() => removeTreeAnalysisResult(zone.id)}
                                                    >
                                                        {/* Resumen editable: la IA propone el tamaño y el cliente confirma; el tipo de poda lo elige SIEMPRE el cliente */}
                                                        {(() => {
                                                            const zoneAny = zone as any;
                                                            const currentBand = normalizeTreeSizeBand(zoneAny.aiSizeBand);
                                                            const lowBandConfidence = zoneAny.sizeBandConfidence != null && zoneAny.sizeBandConfidence < PALM_CONFIDENCE_REVIEW_THRESHOLD;
                                                            const quantity = Math.max(1, Math.trunc(Number(zoneAny.quantity) || 1));
                                                            return (
                                                                <div className="mt-3 space-y-3">
                                                                    <div>
                                                                        <label className="block text-xs font-medium text-gray-700 mb-1">Tipo de poda</label>
                                                                        <div className="flex gap-2">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => updateTreeGroup(zone.id, { pruningType: 'shaping' })}
                                                                                className={`flex-1 py-2 px-2 rounded-lg border text-xs font-medium transition-colors ${
                                                                                    zone.pruningType === 'shaping'
                                                                                        ? 'bg-green-50 border-green-500 text-green-700 ring-1 ring-green-500'
                                                                                        : 'bg-white border-gray-200 text-gray-600 hover:border-green-300 hover:bg-gray-50'
                                                                                }`}
                                                                            >
                                                                                Poda de formación
                                                                                <span className="block text-[10px] font-normal text-gray-500 mt-0.5">Mantenimiento estético y de forma</span>
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => updateTreeGroup(zone.id, { pruningType: 'structural' })}
                                                                                className={`flex-1 py-2 px-2 rounded-lg border text-xs font-medium transition-colors ${
                                                                                    zone.pruningType !== 'shaping'
                                                                                        ? 'bg-green-50 border-green-500 text-green-700 ring-1 ring-green-500'
                                                                                        : 'bg-white border-gray-200 text-gray-600 hover:border-green-300 hover:bg-gray-50'
                                                                                }`}
                                                                            >
                                                                                Poda estructural
                                                                                <span className="block text-[10px] font-normal text-gray-500 mt-0.5">Aclareo, ramas gruesas o reducción de copa</span>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-xs font-medium text-gray-700 mb-1">Tamaño del árbol</label>
                                                                        <select
                                                                            value={currentBand || ''}
                                                                            onChange={(e) => updateTreeGroup(zone.id, { aiSizeBand: e.target.value || undefined })}
                                                                            className="w-full text-sm border border-gray-300 rounded-lg px-2 py-2 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                                                                        >
                                                                            {!currentBand && <option value="">Selecciona tamaño</option>}
                                                                            {TREE_BAND_OPTIONS.map((band) => (
                                                                                <option key={band} value={band}>{treeBandLabel(band)}</option>
                                                                            ))}
                                                                        </select>
                                                                        {lowBandConfidence && (
                                                                            <p className="text-[11px] text-amber-700 mt-1">
                                                                                Revisa el tamaño: en las fotos no había una referencia de escala clara. Influye en el precio.
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                    {Number(zoneAny.aiDetectedCount || 0) > 1 && (
                                                                        <div className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-md px-3 py-2">
                                                                            La IA ha detectado <span className="font-semibold">{zoneAny.aiDetectedCount} árboles</span> en estas fotos
                                                                            {zoneAny.aiDetectedSummary ? <> ({zoneAny.aiDetectedSummary})</> : null}.
                                                                            Confirma cuántos quieres podar ajustando la cantidad. Si hay tamaños distintos, añade un grupo aparte.
                                                                        </div>
                                                                    )}
                                                                    <div className="text-xs text-gray-600 flex items-center gap-2 pt-3 border-t border-gray-100">
                                                                        <span className="font-medium text-gray-700">Cantidad de árboles idénticos:</span>
                                                                        <div className="flex items-center border border-gray-300 rounded-md bg-white">
                                                                            <button
                                                                                className="px-2 py-0.5 hover:bg-gray-100 text-gray-600 border-r border-gray-200"
                                                                                onClick={() => updateTreeGroup(zone.id, { quantity: Math.max(1, quantity - 1) })}
                                                                            >
                                                                                -
                                                                            </button>
                                                                            <input
                                                                                type="number"
                                                                                min="1"
                                                                                value={quantity}
                                                                                onChange={(e) => updateTreeGroup(zone.id, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                                                                                className="w-10 text-center text-sm py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                                                                            />
                                                                            <button
                                                                                className="px-2 py-0.5 hover:bg-gray-100 text-gray-600 border-l border-gray-200"
                                                                                onClick={() => updateTreeGroup(zone.id, { quantity: quantity + 1 })}
                                                                            >
                                                                                +
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
                                                    </ServiceResultCard>
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
                               const isAnalyzed = hasCanonicalAnalysisResult(group.analysisV2, {
                                 analysisLevel: group.analysisLevel,
                                 isFailed: group.isFailed,
                                 observations: group.observations,
                                 analyzedIndices: group.analyzedIndices
                               }) || isShrubGroupAnalyzed(group);
                               const isFailedResult = hasCanonicalAnalysisFailure(group.analysisV2, {
                                 analysisLevel: group.analysisLevel,
                                 isFailed: group.isFailed,
                                 observations: group.observations
                               });
                               const hasResult = isAnalyzed;
                                 const allPhotos = group.photoUrls || [];
                                 const isZoneAnalyzing = shrubAnalyzingZoneIds.has(group.id);

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
                                             photoIds={normalizePhotoIdentityList(group)}
                                             uploadingIndices={shrubUploads[group.id] || new Set()}
                                             selectedIndices={getDefaultSelectedPhotoIndices(allPhotos.length, group.selectedIndices)}
                                             analyzedIndices={getCanonicalAnalyzedPhotoIndices(group.analysisV2, {
                                               analyzedIndices: group.analyzedIndices,
                                               selectedIndices: group.selectedIndices,
                                               totalPhotoCount: allPhotos.length
                                             })}
                                             isAnalyzing={isZoneAnalyzing}
                                             isAnalyzed={hasResult}
                                             analysis={group.analysisV2}
                                             analysisLevel={group.analysisLevel}
                                             observations={group.observations}
                                             loadingMessage={getAnalysisLoadingMessage('Poda de plantas y arbustos')}
                                             onRetryAnalysis={() => analyzeShrubGroup(group.id)}
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

                                        {shouldShowZoneAnalysisResult(hasResult, isZoneAnalyzing) && (
                                            <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                                {isFailedResult ? (
                                                    <AnalysisFailedCard
                                                        analysis={group.analysisV2}
                                                        message={group.observations?.[0]}
                                                        onReanalyze={() => analyzeShrubGroup(group.id)}
                                                    />
                                                ) : (
                                                    <ServiceResultCard
                                                        title="Macizo de plantas y arbustos"
                                                        analysis={group.analysisV2}
                                                        analysisLevel={group.analysisLevel}
                                                        observations={group.observations}
                                                    >
                                                        {/* Resumen editable: la IA propone superficie/tamaño/estado y el cliente confirma o corrige */}
                                                        {(() => {
                                                            const groupAny = group as any;
                                                            const lowAreaConfidence = groupAny.superficieConfidence != null && groupAny.superficieConfidence < PALM_CONFIDENCE_REVIEW_THRESHOLD;
                                                            const lowSizeConfidence = groupAny.tamanoConfidence != null && groupAny.tamanoConfidence < PALM_CONFIDENCE_REVIEW_THRESHOLD;
                                                            return (
                                                                <div className="mt-3 space-y-3">
                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                                        <div>
                                                                            <label className="block text-xs font-medium text-gray-700 mb-1">Superficie (m²)</label>
                                                                            <input
                                                                                type="number"
                                                                                min="1"
                                                                                value={group.area || ''}
                                                                                onChange={(e) => updateShrubGroup(group.id, { area: Math.max(0, parseInt(e.target.value) || 0) })}
                                                                                className="w-full text-sm border border-gray-300 rounded-lg px-2 py-2 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                                                                            />
                                                                            {lowAreaConfidence && (
                                                                                <p className="text-[11px] text-amber-700 mt-1">
                                                                                    Revisa la superficie: en las fotos no había una referencia de escala clara.
                                                                                </p>
                                                                            )}
                                                                        </div>
                                                                        <div>
                                                                            <label className="block text-xs font-medium text-gray-700 mb-1">Tamaño dominante</label>
                                                                            <select
                                                                                value={group.size}
                                                                                onChange={(e) => updateShrubGroup(group.id, { size: e.target.value as 'pequeñas' | 'medianas' | 'grandes' })}
                                                                                className="w-full text-sm border border-gray-300 rounded-lg px-2 py-2 bg-white capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                                                                            >
                                                                                <option value="pequeñas">Pequeñas (bajo la rodilla)</option>
                                                                                <option value="medianas">Medianas (hasta el pecho)</option>
                                                                                <option value="grandes">Grandes (sobre la cabeza)</option>
                                                                            </select>
                                                                            {lowSizeConfidence && (
                                                                                <p className="text-[11px] text-amber-700 mt-1">
                                                                                    Revisa el tamaño dominante: influye en el precio.
                                                                                </p>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-xs font-medium text-gray-700 mb-1">Estado de las plantas</label>
                                                                        <div className="flex gap-2">
                                                                            {PALM_STATE_OPTIONS.map((option) => {
                                                                                const isActive = (groupAny.state || 'normal') === option.value;
                                                                                const label = option.value === 'normal' ? 'Normal' : option.value === 'descuidado' ? 'Descuidadas' : 'Muy descuidadas';
                                                                                return (
                                                                                    <button
                                                                                        key={option.value}
                                                                                        type="button"
                                                                                        onClick={() => updateShrubGroup(group.id, { state: option.value, stateProposedByAI: false } as any)}
                                                                                        className={`flex-1 py-2 px-2 rounded-lg border text-xs font-medium transition-colors ${
                                                                                            isActive
                                                                                                ? 'bg-green-50 border-green-500 text-green-700 ring-1 ring-green-500'
                                                                                                : 'bg-white border-gray-200 text-gray-600 hover:border-green-300 hover:bg-gray-50'
                                                                                        }`}
                                                                                    >
                                                                                        {label}
                                                                                    </button>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                        {groupAny.stateProposedByAI && (groupAny.state || 'normal') !== 'normal' && (
                                                                            <p className="text-[11px] text-amber-700 mt-1">
                                                                                Estado propuesto por la IA según tus fotos. Puede aplicar un recargo del profesional: confírmalo o corrígelo.
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}
                                                    </ServiceResultCard>
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
                          const isAnalyzed = hasCanonicalAnalysisResult(zone.analysisV2, {
                            analysisLevel: zone.analysisLevel,
                            isFailed: zone.isFailed,
                            observations: zone.observations,
                            analyzedIndices: zone.analyzedIndices
                          }) || isPhytosanitaryZoneAnalyzed(zone);
                          const isFailedResult = hasCanonicalAnalysisFailure(zone.analysisV2, {
                            analysisLevel: zone.analysisLevel,
                            isFailed: zone.isFailed,
                            observations: zone.observations
                          });
                          const allPhotos = zone.photoUrls || [];
                          const isZoneAnalyzing = phytosanitaryAnalyzingZoneIds.has(zone.id);
                          const validation = getPhytosanitaryValidation(zone as any);
                          const selectedPhotoCount = getPhytosanitarySelectedPhotoCount(zone);
                          const metrics = (zone as any).analysisMetrics || { ...EMPTY_PHYTOSANITARY_ANALYSIS_METRICS };

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
                                    <label className="text-sm font-medium text-gray-600 block mb-2">Alcance del tratamiento</label>
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
                                                Object.assign(z, resetAnalysisCommonFields({
                                                  ...z,
                                                  analysisMetrics: undefined,
                                                  area: 0,
                                                }));
                                              }

                                              commitPhytosanitaryZones(next);
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
                                      <label className="text-sm font-medium text-gray-600 block mb-1">Tipo de tratamiento contextual</label>
                                      <select
                                        value={(zone as any).requestedTreatment || ''}
                                        onChange={(e) => {
                                          const next = [...(bookingData.phytosanitaryZones || [])];
                                          const z = next.find(x => x.id === zone.id);
                                          if (!z) return;
                                          (z as any).requestedTreatment = e.target.value as PhytosanitaryRequestTreatment;
                                          z.type = buildPhytosanitaryZoneType((z as any).scope, (z as any).requestedTreatment, (z as any).wantsEco);
                                          
                                          if (isPhytosanitaryZoneAnalyzed(z)) {
                                            Object.assign(z, resetAnalysisCommonFields({
                                              ...z,
                                              analysisMetrics: undefined,
                                              area: 0,
                                            }));
                                          }

                                          commitPhytosanitaryZones(next);
                                        }}
                                        className="w-full p-2.5 border border-gray-300 rounded-lg text-base bg-white"
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
                                      className="h-5 w-5 accent-green-600 shrink-0"
                                      checked={Boolean((zone as any).wantsEco)}
                                      disabled={(zone as any).type?.includes('endoterapia')}
                                      onChange={(e) => {
                                        const next = [...(bookingData.phytosanitaryZones || [])];
                                        const z = next.find(x => x.id === zone.id);
                                        if (!z) return;
                                        (z as any).wantsEco = e.target.checked;
                                        z.type = buildPhytosanitaryZoneType((z as any).scope, (z as any).requestedTreatment, (z as any).wantsEco);
                                        
                                        if (isPhytosanitaryZoneAnalyzed(z)) {
                                          Object.assign(z, resetAnalysisCommonFields({
                                            ...z,
                                            analysisMetrics: undefined,
                                            area: 0,
                                          }));
                                        }

                                        commitPhytosanitaryZones(next);
                                      }}
                                    />
                                  </label>
                                </div>

                                <div className="pt-4 border-t border-gray-100">
                                  <ZonePhotoGallery
                                      photos={allPhotos}
                                      photoIds={normalizePhotoIdentityList(zone)}
                                      uploadingIndices={phytosanitaryUploads[zone.id] || new Set()}
                                      selectedIndices={getDefaultSelectedPhotoIndices(allPhotos.length, zone.selectedIndices)}
                                      analyzedIndices={getCanonicalAnalyzedPhotoIndices(zone.analysisV2, {
                                        analyzedIndices: zone.analyzedIndices,
                                        selectedIndices: zone.selectedIndices,
                                        totalPhotoCount: allPhotos.length
                                      })}
                                      isAnalyzing={isZoneAnalyzing}
                                      isAnalyzed={isAnalyzed}
                                      analysis={zone.analysisV2}
                                      analysisLevel={zone.analysisLevel}
                                      observations={zone.observations}
                                      loadingMessage={getAnalysisLoadingMessage('Servicios fitosanitarios')}
                                      onRetryAnalysis={() => analyzePhytosanitaryZone(zone.id)}
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

                                  {shouldShowZoneAnalysisResult(isAnalyzed, isZoneAnalyzing) && (
                                      <div className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                          {isFailedResult ? (
                                              <AnalysisFailedCard
                                                  analysis={zone.analysisV2}
                                                  message={zone.observations?.[0]}
                                                  onReanalyze={() => analyzePhytosanitaryZone(zone.id)}
                                              />
                                          ) : (
                                          <ServiceResultCard
                                              title="Análisis Fitosanitario"
                                              analysis={zone.analysisV2}
                                              analysisLevel={zone.analysisLevel}
                                              stats={[]}
                                              observations={zone.observations}
                                              onDelete={() => {
                                                  openConfirm({
                                                      title: '¿Eliminar resultado?',
                                                      message: 'Se borrarán los datos del análisis, pero las fotos se mantendrán para poder re-analizar.',
                                                      onConfirm: () => {
                                                          const next = [...(bookingData.phytosanitaryZones || [])];
                                                          const z = next.find(x => x.id === zone.id);
                                                          if (z) {
                                                              Object.assign(z, resetAnalysisCommonFields({
                                                                ...z,
                                                                analysisMetrics: undefined,
                                                                area: 0,
                                                              }));
                                                              commitPhytosanitaryZones(next);
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
                                          )}
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
                              className="relative h-40 w-full flex items-center justify-center cursor-pointer group py-4 transition-transform duration-500 ease-in-out"
                           >
                               {photos.slice(0, 3).map((photo, i) => (
                                   <div 
                                       key={i}
                                      className="absolute transition-transform duration-500 ease-in-out shadow-lg rounded-xl overflow-hidden border-2 border-white bg-white"
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
                    <div className={`flex flex-col gap-2 transition-[opacity,transform] duration-500 ease-in-out ${(!isAnalysisComplete || isImageStackExpanded) ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 hidden'}`}>
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
                                <div className={`relative w-24 h-24 rounded-lg overflow-hidden border transition-colors duration-300 ${isPending ? 'border-2 border-green-500 shadow-md' : 'border-gray-200 shadow-sm'} ${isAnalyzed ? 'opacity-80' : 'opacity-100'}`}>
                                     <img 
                                       src={typeof photo === 'string' ? photo : URL.createObjectURL(photo)} 
                                       alt={`Foto ${index + 1}`} 
                                      className={`w-full h-full object-cover transition-[transform,filter] duration-700 ease-in-out ${isUploading ? 'scale-110 blur-sm brightness-50' : 'scale-100 blur-0 brightness-100'}`}
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
                                           className={`absolute top-1 left-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-[background-color,border-color,transform] z-20 ${
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
                  key={`main-photo-input-${mainPhotoInputVersion}`}
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

          {serviceFlags.showsGlobalAnalyzeButton && (
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
                              aria-checked={zone.applyHerbicide}
                              aria-label="Aplicar herbicida"
                              onClick={() => handleToggleWeedingHerbicide(0)}
                              className={`${zone.applyHerbicide ? 'bg-green-600' : 'bg-gray-200'} relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2`}
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
                  type="button"
                  role="switch"
                  aria-checked={Boolean(bookingData.wasteRemoval)}
                  aria-label="Incluir retirada de restos"
                  onClick={() => {
                      const newValue = !bookingData.wasteRemoval;
                      commitDetailsPatch({ wasteRemoval: newValue }, { saveAfterCommit: true });
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 ${bookingData.wasteRemoval ? 'bg-green-600' : 'bg-gray-200'}`}
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
          <GardenerNote
            defaultValue={bookingData.description ?? ''}
            onChange={(value) => { descriptionRef.current = value; }}
          />
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
                    commitDetailsPatch({ wasteRemoval: false }, { saveAfterCommit: true });
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
                      className="w-full bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-600/20 py-3 px-4 rounded-xl font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
                    >
                      {confirmState.cancelLabel}
                    </button>
                    <button
                      onClick={handleConfirmAction}
                      className="w-full bg-white text-red-600 border border-red-200 hover:bg-red-50 py-3 px-4 rounded-xl font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                    >
                      {confirmState.confirmLabel}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleConfirmAction}
                      className={`w-full text-white py-3 px-4 rounded-xl font-bold transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 ${
                        confirmState.tone === 'danger'
                          ? 'bg-red-600 hover:bg-red-700 shadow-lg shadow-red-600/20'
                          : 'bg-amber-600 hover:bg-amber-700 shadow-lg shadow-amber-600/20'
                      }`}
                    >
                      {confirmState.confirmLabel}
                    </button>
                    <button
                      onClick={closeConfirm}
                      className="w-full bg-white text-gray-700 border border-gray-200 py-3 px-4 rounded-xl font-bold hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
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
        if (!serviceFlags.isWeeding) return null;
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

        </div>{/* end photos-mode gate */}

      </div>

      {/* Fixed CTA (hidden in manual mode; the wizard owns its own confirm) */}
      {!isManualActive && (
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] z-50">
        <div className="mx-auto w-full sm:max-w-md">
          <button
            onClick={handleContinue}
            disabled={getDetailsContinueDisabled({
              bookingData,
              serviceFlags,
              weedingManualConfirmed,
              getPhytosanitaryValidation: (zone) => getPhytosanitaryValidation(zone as any),
              isPhytosanitaryZoneAnalyzed: (zone) => isPhytosanitaryZoneAnalyzed(zone as any),
            })}
            className="w-full bg-green-600 hover:bg-green-700 text-white py-4 px-6 rounded-2xl font-semibold text-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
          >
            {getDetailsContinueLabel(bookingData, serviceFlags)}
          </button>
        </div>
      </div>
      )}
    </div>
  );
};

export default DetailsPage;
