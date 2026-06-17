import {
  calculatePalmHoursFromConfig,
  calculatePriceFromYield,
  calculatePalmPriceEngine,
  findPalmPrice,
  type PalmPricingGroup,
} from '../domain/pricingEngine.ts';
import { isHighestOpenRangeForSpecies } from '../domain/speciesBusinessRules.ts';
import { calculateTreePruningQuoteForTrees } from '../domain/pricing/treePruningPricing.ts';
import type { PhytosanitaryYields } from '../types/index.ts';
import type { TreePruningServiceConfig } from '../types/treePruning.ts';
import { getPrecioPorHora, getPricingMethod } from '../utils/hourlyPricing.ts';

export interface BookingQuoteLine {
  desc: string;
  price: number;
}

export interface BookingQuoteEconomicLine {
  code: string;
  label: string;
  amount: number;
  kind: 'service' | 'tax' | 'fee' | 'adjustment';
}

export interface BookingStripeLineItem {
  code: string;
  label: string;
  unitAmount: number;
  quantity: number;
}

export interface BookingQuoteWarning {
  code: string;
  message: string;
}

export type BookingEligibilityFailureCode =
  | 'missing_provider_config'
  | 'missing_service_payload'
  | 'missing_pricing_config'
  | 'missing_yield_config'
  | 'missing_treatment_config'
  | 'partial_palm_coverage'
  | 'invalid_tree_config'
  | 'unsupported_request';

export interface BookingQuoteEligibility {
  isEligible: boolean;
  reason?: BookingEligibilityFailureCode;
}

export interface BookingQuotePalmGroupContext {
  id?: string;
  species: string;
  height: string;
  quantity: number;
  isTerminalOpenRange: boolean;
  isPriced: boolean;
}

export interface BookingQuotePricingContext {
  serviceType: 'standard' | 'palm_pruning';
  allowsPriceChange: boolean;
  palmGroups: BookingQuotePalmGroupContext[];
}

export interface BookingQuotePalmCoverage {
  isFull: boolean;
  coveredCount: number;
  totalCount: number;
  missingGroups: BookingQuotePalmGroupContext[];
}

export interface BookingQuoteSlotSelection {
  date: string;
  startHour: number;
  startTime: string;
  endTime: string;
  durationHours: number;
}

export interface BookingAvailabilityCalendarDay {
  date: string;
  day: number;
  disabled: boolean;
  count: number;
  availableStartHours?: number[];
}

export interface BookingQuoteAvailability {
  requestedDate?: string;
  windowEndDate?: string;
  validStartHours: number[];
  calendarDays?: BookingAvailabilityCalendarDay[];
  earliestSlot?: BookingQuoteSlotSelection | null;
  selectedSlot?: BookingQuoteSlotSelection | null;
}

export interface BookingQuoteEconomicBreakdown {
  currency: 'EUR';
  taxRate: number;
  serviceGrossTotal: number;
  serviceNetSubtotal: number;
  serviceTaxAmount: number;
  managementFee: number;
  payableNow: number;
  payableLater: number;
  lines: BookingQuoteEconomicLine[];
  stripeLineItems: BookingStripeLineItem[];
}

export interface BookingCustomerPaymentSummary {
  reservationTotal: number;
  serviceSubtotal: number;
  reservationFee: number;
  confirmationDeposit: number;
  pendingToProfessional: number;
}

export interface BookingQuoteMetadata {
  pricingContext: BookingQuotePricingContext;
  palmCoverage?: BookingQuotePalmCoverage;
}

export interface SerializableBookingData {
  address?: string;
  addressCoordinates?: {
    lat: number;
    lng: number;
  };
  description?: string;
  serviceIds?: string[];
  /** Provenance of the service variables. The engine ignores it; the server uses it to gate manual validation. */
  dataInputMode?: 'photos' | 'manual';
  manualDeclarationId?: string;
  /** Auditable consent captured at manual submission (stored in the signed quote snapshot). */
  manualConsent?: {
    legalVersion: string;
    legalHash: string;
    acceptedText: string;
    acceptedAt: string;
    declaredVariables: Record<string, unknown>;
  };
  wasteRemoval?: boolean;
  aiQuantity?: number;
  lawnSpecies?: string;
  palmGroups?: Array<{
    id?: string;
    species: string;
    height: string;
    quantity: number;
    state?: string;
    hasPhytosanitary?: boolean;
    hasTrunkPeeling?: boolean;
    needsPhytosanitary?: boolean;
    needsTrunkFinish?: boolean;
    hasAccessDifficulty?: boolean;
    isTerminalOpenRange?: boolean;
  }>;
  lawnZones?: Array<{
    quantity: number;
    state: string;
  }>;
  hedgeZones?: Array<{
    type: string;
    height: string;
    length: number;
    state?: string;
    faces_to_trim?: number;
    length_pricing_m?: number;
  }>;
  treeGroups?: Array<{
    id: string;
    pruningType: string;
    aiSizeBand?: 'small' | 'medium' | 'large' | 'over_9';
    difficultyHigh?: boolean;
    analysisLevel?: number;
    isFailed?: boolean;
  }>;
  shrubGroups?: Array<{
    id: string;
    area: number;
    size: 'pequeñas' | 'medianas' | 'grandes';
    state?: string;
  }>;
  phytosanitaryZones?: Array<{
    area: number;
    type?: string;
    affectedType?: string;
    aboveTwoMeters?: boolean;
    aboveThreeMeters?: boolean;
    intent?: 'preventive' | 'curative' | 'weed_control';
    curativeTarget?: 'insects' | 'fungus' | 'both';
    productPreference?: 'chemical' | 'ecological';
    analysisMetrics?: {
      cesped_m2?: number;
      plantas_superficie_calculada_m2?: number;
      plantas_tamano_dominante?: 'pequenas' | 'medianas' | 'grandes' | null;
      seto_bajo_medio_ml?: number;
      seto_alto_ml?: number;
      palmeras_ducha_peq_ud?: number;
      palmeras_ducha_med_ud?: number;
      palmeras_ducha_alta_ud?: number;
      palmeras_cirugia_ud?: number;
      palmeras_endoterapia_troncos_ud?: number;
      arboles_peq_ud?: number;
      arboles_med_ud?: number;
      arboles_gran_ud?: number;
      herbicida_poca_densidad_m2?: number;
      herbicida_mucha_densidad_m2?: number;
      observaciones_ia?: string[];
    };
  }>;
  weedingZones?: Array<{
    id?: string;
    area: number;
    state?: string;
    applyHerbicide?: boolean;
  }>;
}

export interface BookingQuoteResult {
  totalPrice: number;
  estimatedHours: number;
  breakdown: BookingQuoteLine[];
  warnings: BookingQuoteWarning[];
  metadata: BookingQuoteMetadata;
  economics: BookingQuoteEconomicBreakdown;
  eligibility: BookingQuoteEligibility;
  availability?: BookingQuoteAvailability;
}

const DEFAULT_HEDGE_SURCHARGES = { media: 20, alta: 50 };
const DEFAULT_SHRUB_SURCHARGES = { media: 20, alta: 50 };

type TreeSizeBand = 'small' | 'medium' | 'large' | 'over_9';
type PhytosanitaryTreatment = 'insecticida' | 'fungicida' | 'ecologico_preventivo' | 'endoterapia';
type PhytosanitaryAffectedType = 'Césped' | 'Árboles' | 'Setos' | 'Plantas bajas' | 'Palmeras';
type PhytosanitaryBaseTreatment = Exclude<PhytosanitaryTreatment, 'endoterapia'>;
type PhytosanitaryWithoutHerbicide = PhytosanitaryBaseTreatment;

interface PhytosanitaryDetailedPricing {
  cesped: { minimo: number; preventivo: number; curativo: number };
  setos: {
    minimo: number;
    bajos_preventivo: number;
    bajos_curativo: number;
    altos_preventivo: number;
    altos_curativo: number;
  };
  palmeras: {
    minimo: number;
    pequenas_preventivo: number;
    pequenas_curativo: number;
    pequenas_cirugia: number;
    medianas_preventivo: number;
    medianas_curativo: number;
    medianas_cirugia: number;
    altas_preventivo: number;
    altas_curativo: number;
    altas_cirugia: number;
  };
  arboles: {
    minimo: number;
    pequenos_preventivo: number;
    pequenos_curativo: number;
    medianos_preventivo: number;
    medianos_curativo: number;
    grandes_preventivo: number;
    grandes_curativo: number;
  };
  plantas: {
    minimo: number;
    pequenas_preventivo: number;
    pequenas_curativo: number;
    medianas_preventivo: number;
    medianas_curativo: number;
    grandes_preventivo: number;
    grandes_curativo: number;
  };
}

interface PhytosanitaryNormalizedConfig {
  importe_minimo: number;
  minimum_fee: number;
  tratamientos_activos: PhytosanitaryTreatment[];
  superficies_plantas: {
    hasta_100m2: Record<PhytosanitaryBaseTreatment, number>;
    mas_de_100m2: Record<PhytosanitaryBaseTreatment, number>;
  };
  setos: {
    hasta_2m: Record<PhytosanitaryWithoutHerbicide, number>;
    mas_de_2m: Record<PhytosanitaryWithoutHerbicide, number>;
  };
  arboles: {
    hasta_3m: Record<PhytosanitaryWithoutHerbicide, number>;
    mas_de_3m: Record<PhytosanitaryWithoutHerbicide, number>;
  };
  palmeras: {
    tradicional: {
      hasta_3m: number;
      mas_de_3m: number;
    };
    endoterapia: {
      precio_unico: number;
    };
  };
  waste_removal: { percentage: number };
  recargo_retirada: { percentage: number };
  pricing_modifiers: {
    eco: { percentage: number };
    combo: {
      two_treatments_percentage: number;
      three_plus_treatments_percentage: number;
    };
  };
  detailed_pricing: PhytosanitaryDetailedPricing;
}

interface PhytosanitaryQuoteBreakdownItem {
  zoneIndex: number;
  affectedType: PhytosanitaryAffectedType;
  requestedTreatments: PhytosanitaryTreatment[];
  appliedTreatments: PhytosanitaryTreatment[];
  quantity: number;
  unitLabel: 'm2' | 'ml' | 'ud';
  unitPrice: number | null;
  subtotal: number | null;
  lineTotal: number | null;
  reason?: string;
}

interface PhytosanitaryQuoteResult {
  total: number;
  totalBeforeMinimum: number;
  minimumFeeApplied: boolean;
  minimumFee: number;
  breakdown: PhytosanitaryQuoteBreakdownItem[];
}

const EMPTY_DETAILED_PHYTOSANITARY_PRICING: PhytosanitaryDetailedPricing = {
  cesped: { minimo: 0, preventivo: 0, curativo: 0 },
  setos: { minimo: 0, bajos_preventivo: 0, bajos_curativo: 0, altos_preventivo: 0, altos_curativo: 0 },
  palmeras: {
    minimo: 0,
    pequenas_preventivo: 0,
    pequenas_curativo: 0,
    pequenas_cirugia: 0,
    medianas_preventivo: 0,
    medianas_curativo: 0,
    medianas_cirugia: 0,
    altas_preventivo: 0,
    altas_curativo: 0,
    altas_cirugia: 0,
  },
  arboles: {
    minimo: 0,
    pequenos_preventivo: 0,
    pequenos_curativo: 0,
    medianos_preventivo: 0,
    medianos_curativo: 0,
    grandes_preventivo: 0,
    grandes_curativo: 0,
  },
  plantas: {
    minimo: 0,
    pequenas_preventivo: 0,
    pequenas_curativo: 0,
    medianas_preventivo: 0,
    medianas_curativo: 0,
    grandes_preventivo: 0,
    grandes_curativo: 0,
  },
};

const BOOKING_TAX_RATE = 0.21;
const BOOKING_MANAGEMENT_FEE_RATE = 0.125;
const roundUp = (value: number) => Math.ceil(Number(value || 0));
const roundCurrency = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const hasPositiveNumber = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;

export const getBookingCustomerPaymentSummary = (
  economics?: BookingQuoteEconomicBreakdown | null
): BookingCustomerPaymentSummary | null => {
  if (!economics) return null;

  const serviceSubtotal = roundCurrency(economics.serviceGrossTotal);
  const reservationFee = roundCurrency(economics.managementFee);
  const confirmationDeposit = roundCurrency(economics.payableNow);
  const pendingToProfessional = roundCurrency(economics.payableLater);
  const reservationTotal = roundCurrency(serviceSubtotal + reservationFee);

  return {
    reservationTotal,
    serviceSubtotal,
    reservationFee,
    confirmationDeposit,
    pendingToProfessional,
  };
};

const toSafeNumber = (value: unknown): number => {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const buildIneligibleQuote = (
  code: BookingEligibilityFailureCode,
  message: string,
  metadata: BookingQuoteMetadata = buildDefaultQuoteMetadata(),
): BookingQuoteResult => ({
  totalPrice: 0,
  estimatedHours: 0,
  breakdown: [],
  warnings: [{ code, message }],
  metadata,
  economics: buildQuoteEconomics(0, []),
  eligibility: {
    isEligible: false,
    reason: code,
  },
});

const getDurationMultiplier = (state: string) => {
  const normalized = String(state || 'normal').toLowerCase();
  if (normalized.includes('muy') && normalized.includes('descuidad')) return 1.7;
  if (normalized.includes('descuidad')) return 1.3;
  if (normalized.includes('alta')) return 1.7;
  if (normalized.includes('media')) return 1.3;
  return 1.0;
};

const buildShrubBreakdown = (bookingData: SerializableBookingData, config: any, globalWaste: boolean): BookingQuoteLine[] => {
  const lines: BookingQuoteLine[] = [];
  const priceTable = config?.prices_per_m2 || {};
  const surcharges = config?.condition_surcharges || DEFAULT_SHRUB_SURCHARGES;
  const wastePercent = Number(config?.waste_removal?.percentage || 0);

  (bookingData.shrubGroups || []).forEach((group: any) => {
    const size = (group.size || 'pequeñas') as keyof typeof priceTable;
    const unitPrice = Number(priceTable[size] || 0);
    const area = Number(group.area || 0);
    const state = String(group.state || 'normal').toLowerCase();
    let surchargePercent = 0;
    if (state.includes('muy')) surchargePercent = surcharges.alta || DEFAULT_SHRUB_SURCHARGES.alta;
    else if (state.includes('descuidad')) surchargePercent = surcharges.media || DEFAULT_SHRUB_SURCHARGES.media;
    const stateMult = 1 + surchargePercent / 100;
    const wasteMult = globalWaste ? 1 + wastePercent / 100 : 1;
    const linePrice = roundUp(area * unitPrice * stateMult * wasteMult);

    if (linePrice > 0) {
      lines.push({
        desc: `${area} m2 de arbustos (${group.size || 'pequeñas'}, ${group.state || 'normal'})`,
        price: linePrice,
      });
    }
  });

  return lines;
};

const isTreePruningConfig = (value: any): value is TreePruningServiceConfig => {
  if (!value || typeof value !== 'object') return false;
  if (!value.estructural || typeof value.estructural !== 'object') return false;
  if (!value.formacion || typeof value.formacion !== 'object') return false;
  return typeof value.difficultyIncrease === 'number';
};

const mapTreePruningType = (value: any): 'estructural' | 'formacion' => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('shaping') || normalized.includes('form') || normalized.includes('formacion')) return 'formacion';
  return 'estructural';
};

const normalizeTreeSizeBand = (value: unknown): TreeSizeBand | null => {
  const normalized = String(value || '').toLowerCase().trim();
  if (normalized === 'small' || normalized === 'medium' || normalized === 'large' || normalized === 'over_9') {
    return normalized;
  }
  return null;
};

const resolveTreeBand = (tree: any): TreeSizeBand | null => normalizeTreeSizeBand(tree?.aiSizeBand);

const normalizeWeedingState = (value?: string): 'normal' | 'dificultad_media' | 'dificultad_alta' => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('alta')) return 'dificultad_alta';
  if (normalized.includes('media') || normalized.includes('descuidad')) return 'dificultad_media';
  return 'normal';
};

const buildDefaultQuoteMetadata = (): BookingQuoteMetadata => ({
  pricingContext: {
    serviceType: 'standard',
    allowsPriceChange: true,
    palmGroups: [],
  },
});

const hasRequestedBookingWork = (bookingData: SerializableBookingData) =>
  Boolean(
    bookingData.lawnZones?.length ||
      bookingData.hedgeZones?.length ||
      bookingData.palmGroups?.length ||
      bookingData.treeGroups?.length ||
      bookingData.shrubGroups?.length ||
      bookingData.phytosanitaryZones?.length ||
      bookingData.weedingZones?.length,
  );

const getRequestedPhytosanitaryYieldKeys = (zones: SerializableBookingData['phytosanitaryZones']) => {
  const required = new Set<keyof PhytosanitaryYields>();
  (zones || []).forEach((zone) => {
    const metrics = zone.analysisMetrics;
    if (metrics) {
      if (metrics.cesped_m2) required.add('cesped_m2_per_hour');
      if (metrics.seto_bajo_medio_ml || metrics.seto_alto_ml) required.add('setos_ml_per_hour');
      if (
        metrics.palmeras_ducha_peq_ud ||
        metrics.palmeras_ducha_med_ud ||
        metrics.palmeras_ducha_alta_ud ||
        metrics.palmeras_cirugia_ud
      ) {
        required.add('palmeras_units_per_hour');
      }
      if (metrics.palmeras_endoterapia_troncos_ud) required.add('endoterapia_units_per_hour');
      if (metrics.arboles_peq_ud || metrics.arboles_med_ud || metrics.arboles_gran_ud) {
        required.add('arboles_units_per_hour');
      }
      if (metrics.plantas_superficie_calculada_m2) required.add('plantas_m2_per_hour');
      return;
    }

    const affectedType = zone?.affectedType;
    if (affectedType === 'Palmeras') required.add('palmeras_units_per_hour');
    else if (affectedType === 'Árboles') required.add('arboles_units_per_hour');
    else if (affectedType === 'Setos') required.add('setos_ml_per_hour');
    else if (affectedType === 'Césped') required.add('cesped_m2_per_hour');
    else required.add('plantas_m2_per_hour');
  });
  return Array.from(required);
};

const inferEconomicLineKind = (desc: string): BookingQuoteEconomicLine['kind'] => {
  const normalized = String(desc || '').toLowerCase();
  if (normalized.includes('ajuste')) return 'adjustment';
  return 'service';
};

const buildQuoteEconomics = (
  totalPrice: number,
  breakdown: BookingQuoteLine[]
): BookingQuoteEconomicBreakdown => {
  const serviceGrossTotal = roundCurrency(totalPrice);
  const serviceNetSubtotal = roundCurrency(serviceGrossTotal / (1 + BOOKING_TAX_RATE));
  const serviceTaxAmount = roundCurrency(serviceGrossTotal - serviceNetSubtotal);
  const managementFee = roundCurrency(serviceGrossTotal * BOOKING_MANAGEMENT_FEE_RATE);

  return {
    currency: 'EUR',
    taxRate: BOOKING_TAX_RATE,
    serviceGrossTotal,
    serviceNetSubtotal,
    serviceTaxAmount,
    managementFee,
    payableNow: managementFee,
    payableLater: serviceGrossTotal,
    lines: [
      ...breakdown.map((line, index) => ({
        code: `service_line_${index + 1}`,
        label: line.desc,
        amount: roundCurrency(line.price),
        kind: inferEconomicLineKind(line.desc),
      })),
      {
        code: 'service_subtotal',
        label: 'Subtotal del servicio',
        amount: serviceNetSubtotal,
        kind: 'service',
      },
      {
        code: 'service_tax',
        label: 'IVA del servicio',
        amount: serviceTaxAmount,
        kind: 'tax',
      },
      {
        code: 'management_fee',
        label: 'Gastos de gestión',
        amount: managementFee,
        kind: 'fee',
      },
    ],
    stripeLineItems: managementFee > 0
      ? [{
          code: 'management_fee',
          label: 'Gastos de gestión',
          unitAmount: managementFee,
          quantity: 1,
        }]
      : [],
  };
};

const getPalmBaseUnitPrice = (config: any, group: Pick<PalmPricingGroup, 'species' | 'height'>): number => {
  const precioPorHora = getPrecioPorHora(config);
  const useYield =
    getPricingMethod(config, { allowLegacyYieldCalculation: true }) === 'per_hour' &&
    config?.yield_units_per_hour &&
    precioPorHora > 0;
  if (useYield) {
    const yieldPerUnit = Number(config?.yield_units_per_hour?.[group.species]?.[group.height] || 0);
    return calculatePriceFromYield(1, yieldPerUnit, precioPorHora);
  }
  return findPalmPrice(config, group.species, group.height);
};

const buildPalmQuoteMetadata = (
  bookingGroups: NonNullable<SerializableBookingData['palmGroups']>,
  pricingGroups: PalmPricingGroup[],
  config: any,
): BookingQuoteMetadata => {
  const palmGroups = pricingGroups.map((group, index) => {
    const bookingGroup = bookingGroups[index];
    const quantity = Math.max(0, Number(group.quantity || 0));
    const isTerminalOpenRange =
      Boolean(bookingGroup?.isTerminalOpenRange) ||
      isHighestOpenRangeForSpecies(group.species || '', group.height || '');
    const isPriced = getPalmBaseUnitPrice(config, group) > 0;

    return {
      id: bookingGroup?.id,
      species: group.species,
      height: group.height,
      quantity,
      isTerminalOpenRange,
      isPriced,
    };
  });

  const requestedPalmGroups = palmGroups.filter((group) => group.quantity > 0);
  const coveredPalmGroups = requestedPalmGroups.filter((group) => group.isPriced);

  return {
    pricingContext: {
      serviceType: palmGroups.length > 0 ? 'palm_pruning' : 'standard',
      allowsPriceChange: coveredPalmGroups.some((group) => group.isTerminalOpenRange),
      palmGroups,
    },
    palmCoverage: {
      isFull: requestedPalmGroups.length === coveredPalmGroups.length,
      coveredCount: coveredPalmGroups.length,
      totalCount: requestedPalmGroups.length,
      missingGroups: requestedPalmGroups.filter((group) => !group.isPriced),
    },
  };
};

const calculateWeedingQuote = (params: {
  zones: Array<{ id?: string; area: number; state?: string; applyHerbicide?: boolean }>;
  config: any;
  globalWaste: boolean;
}) => {
  const zones = Array.isArray(params.zones) ? params.zones : [];
  const pricePerM2 = Math.max(0, toSafeNumber(params.config?.precio_desbroce_m2));
  const herbicidePerM2 = Math.max(0, toSafeNumber(params.config?.precio_herbicida_m2));
  const yieldPerHour = Math.max(0, toSafeNumber(params.config?.yield_m2_per_hour));
  const minimumPrice = Math.max(0, toSafeNumber(params.config?.importe_minimo));
  const difficultyMedia = Math.max(0, toSafeNumber(params.config?.suplementos?.dificultad_media));
  const difficultyAlta = Math.max(0, toSafeNumber(params.config?.suplementos?.dificultad_alta));
  const wastePercent = params.globalWaste ? Math.max(0, toSafeNumber(params.config?.suplementos?.retirada_restos)) : 0;

  let totalBeforeMinimum = 0;
  let totalEstimatedHours = 0;

  zones.forEach((zone) => {
    const area = Math.max(0, toSafeNumber(zone.area));
    const state = normalizeWeedingState(zone.state);
    const applyHerbicide = Boolean(zone.applyHerbicide);
    const base = area * pricePerM2;
    const herbicide = applyHerbicide ? area * herbicidePerM2 : 0;
    const statePercent = state === 'dificultad_alta' ? difficultyAlta : state === 'dificultad_media' ? difficultyMedia : 0;
    const stateMultiplier = 1 + statePercent / 100;
    const wasteMultiplier = 1 + wastePercent / 100;
    totalBeforeMinimum += (base + herbicide) * stateMultiplier * wasteMultiplier;
    totalEstimatedHours += yieldPerHour > 0 ? (area / yieldPerHour) * stateMultiplier * wasteMultiplier : 0;
  });

  const minimumApplied = minimumPrice > 0 && totalBeforeMinimum > 0 && totalBeforeMinimum < minimumPrice;
  return {
    finalPrice: Math.ceil(minimumApplied ? minimumPrice : totalBeforeMinimum),
    totalEstimatedHours,
  };
};

const normalizeDetailedPhytosanitaryPricing = (raw?: any): PhytosanitaryDetailedPricing => {
  if (!raw) return EMPTY_DETAILED_PHYTOSANITARY_PRICING;
  return {
    cesped: { ...EMPTY_DETAILED_PHYTOSANITARY_PRICING.cesped, ...(raw.cesped || {}) },
    setos: { ...EMPTY_DETAILED_PHYTOSANITARY_PRICING.setos, ...(raw.setos || {}) },
    palmeras: { ...EMPTY_DETAILED_PHYTOSANITARY_PRICING.palmeras, ...(raw.palmeras || {}) },
    arboles: { ...EMPTY_DETAILED_PHYTOSANITARY_PRICING.arboles, ...(raw.arboles || {}) },
    plantas: { ...EMPTY_DETAILED_PHYTOSANITARY_PRICING.plantas, ...(raw.plantas || {}) },
  };
};

const normalizePhytosanitaryPricingConfig = (raw?: any): PhytosanitaryNormalizedConfig => {
  const detailed = normalizeDetailedPhytosanitaryPricing(raw?.detailed_pricing);
  const inferredMin = Number(raw?.minimum_fee ?? raw?.importe_minimo ?? raw?.minimum_price ?? 0);
  const inferredWaste = Number(raw?.recargo_retirada?.percentage || raw?.waste_removal?.percentage || 0);
  const inferredEco = Number(raw?.pricing_modifiers?.eco?.percentage || 0);
  const inferredComboTwo = Number(raw?.pricing_modifiers?.combo?.two_treatments_percentage || 0);
  const inferredComboThree = Number(raw?.pricing_modifiers?.combo?.three_plus_treatments_percentage || 0);

  return {
    importe_minimo: inferredMin,
    minimum_fee: inferredMin,
    tratamientos_activos: (raw?.tratamientos_activos || ['insecticida', 'fungicida', 'ecologico_preventivo']).filter(Boolean),
    superficies_plantas: {
      hasta_100m2: {
        insecticida: Number(raw?.superficies_plantas?.hasta_100m2?.insecticida || detailed.cesped.curativo || 0),
        fungicida: Number(raw?.superficies_plantas?.hasta_100m2?.fungicida || detailed.cesped.curativo || 0),
        ecologico_preventivo: Number(raw?.superficies_plantas?.hasta_100m2?.ecologico_preventivo || detailed.cesped.preventivo || 0),
      },
      mas_de_100m2: {
        insecticida: Number(raw?.superficies_plantas?.mas_de_100m2?.insecticida || detailed.cesped.curativo || 0),
        fungicida: Number(raw?.superficies_plantas?.mas_de_100m2?.fungicida || detailed.cesped.curativo || 0),
        ecologico_preventivo: Number(raw?.superficies_plantas?.mas_de_100m2?.ecologico_preventivo || detailed.cesped.preventivo || 0),
      },
    },
    setos: {
      hasta_2m: {
        insecticida: Number(raw?.setos?.hasta_2m?.insecticida || detailed.setos.bajos_curativo || 0),
        fungicida: Number(raw?.setos?.hasta_2m?.fungicida || detailed.setos.bajos_curativo || 0),
        ecologico_preventivo: Number(raw?.setos?.hasta_2m?.ecologico_preventivo || detailed.setos.bajos_preventivo || 0),
      },
      mas_de_2m: {
        insecticida: Number(raw?.setos?.mas_de_2m?.insecticida || detailed.setos.altos_curativo || 0),
        fungicida: Number(raw?.setos?.mas_de_2m?.fungicida || detailed.setos.altos_curativo || 0),
        ecologico_preventivo: Number(raw?.setos?.mas_de_2m?.ecologico_preventivo || detailed.setos.altos_preventivo || 0),
      },
    },
    arboles: {
      hasta_3m: {
        insecticida: Number(raw?.arboles?.hasta_3m?.insecticida || detailed.arboles.pequenos_curativo || 0),
        fungicida: Number(raw?.arboles?.hasta_3m?.fungicida || detailed.arboles.pequenos_curativo || 0),
        ecologico_preventivo: Number(raw?.arboles?.hasta_3m?.ecologico_preventivo || detailed.arboles.pequenos_preventivo || 0),
      },
      mas_de_3m: {
        insecticida: Number(raw?.arboles?.mas_de_3m?.insecticida || detailed.arboles.medianos_curativo || 0),
        fungicida: Number(raw?.arboles?.mas_de_3m?.fungicida || detailed.arboles.medianos_curativo || 0),
        ecologico_preventivo: Number(raw?.arboles?.mas_de_3m?.ecologico_preventivo || detailed.arboles.medianos_preventivo || 0),
      },
    },
    palmeras: {
      tradicional: {
        hasta_3m: Number(raw?.palmeras?.tradicional?.hasta_3m || detailed.palmeras.pequenas_curativo || 0),
        mas_de_3m: Number(raw?.palmeras?.tradicional?.mas_de_3m || detailed.palmeras.medianas_curativo || 0),
      },
      endoterapia: {
        precio_unico: Number(raw?.palmeras?.endoterapia?.precio_unico || detailed.palmeras.pequenas_cirugia || 0),
      },
    },
    waste_removal: { percentage: inferredWaste },
    recargo_retirada: { percentage: inferredWaste },
    pricing_modifiers: {
      eco: { percentage: inferredEco },
      combo: {
        two_treatments_percentage: inferredComboTwo,
        three_plus_treatments_percentage: inferredComboThree,
      },
    },
    detailed_pricing: detailed,
  };
};

const normalizePhytosanitaryAffectedType = (value: string | undefined | null): PhytosanitaryAffectedType => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('palmera')) return 'Palmeras';
  if (normalized.includes('árbol') || normalized.includes('arbol')) return 'Árboles';
  if (normalized.includes('seto')) return 'Setos';
  if (normalized.includes('planta')) return 'Plantas bajas';
  return 'Césped';
};

const pickBaseTreatment = (treatment: PhytosanitaryTreatment): PhytosanitaryBaseTreatment => {
  if (treatment === 'fungicida') return 'fungicida';
  if (treatment === 'ecologico_preventivo') return 'ecologico_preventivo';
  return 'insecticida';
};

const formatPhytosanitaryLabel = (item: PhytosanitaryQuoteBreakdownItem) => {
  if (item.quantity === 1 && item.unitLabel === 'ud' && typeof item.subtotal === 'number') {
    return `Zona ${item.zoneIndex + 1}: desglose detallado · base ${roundUp(item.subtotal)}€`;
  }
  const treatmentLabel = item.appliedTreatments?.length ? item.appliedTreatments.join(' + ') : 'sin tratamiento';
  return `Zona ${item.zoneIndex + 1}: ${item.affectedType} · ${item.quantity}${item.unitLabel} · ${treatmentLabel}`;
};

const calculatePhytosanitaryQuote = (params: {
  zones: SerializableBookingData['phytosanitaryZones'];
  config: unknown;
  globalWaste: boolean;
}): PhytosanitaryQuoteResult => {
  const normalized = normalizePhytosanitaryPricingConfig(params.config as any);
  const ecoModifierPercent = Number(normalized.pricing_modifiers?.eco?.percentage || 0);
  const comboTwoTreatmentsPercent = Number(normalized.pricing_modifiers?.combo?.two_treatments_percentage || 0);
  const comboThreePlusTreatmentsPercent = Number(normalized.pricing_modifiers?.combo?.three_plus_treatments_percentage || 0);
  const wasteMult = 1;
  const breakdown: PhytosanitaryQuoteBreakdownItem[] = [];
  let totalBeforeMinimum = 0;

  (params.zones || []).forEach((zone, index) => {
    const qty = Number(zone?.area || 0);
    const affected = normalizePhytosanitaryAffectedType(zone?.affectedType);
    const intent = zone?.intent || 'preventive';
    const isCurative = intent === 'curative';
    const isWeedControl = intent === 'weed_control';
    const isEco = zone?.productPreference === 'ecological';
    const isComboTreatment = zone?.curativeTarget === 'both';
    const requestedTreatments: PhytosanitaryTreatment[] = [];

    if (isWeedControl) {
      requestedTreatments.push('ecologico_preventivo');
    } else if (isEco && !isCurative) {
      requestedTreatments.push('ecologico_preventivo');
    } else if (isCurative) {
      if (zone?.curativeTarget === 'insects' || isComboTreatment) requestedTreatments.push('insecticida');
      if (zone?.curativeTarget === 'fungus' || isComboTreatment) requestedTreatments.push('fungicida');
    } else {
      requestedTreatments.push('insecticida');
    }

    if (affected === 'Palmeras' && (zone?.analysisMetrics?.palmeras_cirugia_ud || zone?.analysisMetrics?.palmeras_endoterapia_troncos_ud)) {
      requestedTreatments.push('endoterapia');
    }

    const unitLabel: 'm2' | 'ml' | 'ud' = affected === 'Palmeras' || affected === 'Árboles' ? 'ud' : (affected === 'Setos' ? 'ml' : 'm2');
    const metrics = zone?.analysisMetrics || {};
    const hasDetailedMetrics = [
      metrics.cesped_m2,
      metrics.plantas_superficie_calculada_m2,
      metrics.seto_bajo_medio_ml,
      metrics.seto_alto_ml,
      metrics.palmeras_ducha_peq_ud,
      metrics.palmeras_ducha_med_ud,
      metrics.palmeras_ducha_alta_ud,
      metrics.palmeras_cirugia_ud,
      metrics.palmeras_endoterapia_troncos_ud,
      metrics.arboles_peq_ud,
      metrics.arboles_med_ud,
      metrics.arboles_gran_ud,
    ].some((value) => Number(value || 0) > 0);

    if (hasDetailedMetrics) {
      const detailed = normalized.detailed_pricing;
      const getPrice = (category: any, preventiveField: string, curativeField: string) =>
        Number(category?.[isCurative ? curativeField : preventiveField] || 0);
      const plantasSize = metrics.plantas_tamano_dominante || 'pequenas';
      const subtotal =
        Number(metrics.cesped_m2 || 0) * getPrice(detailed.cesped, 'preventivo', 'curativo') +
        Number(metrics.plantas_superficie_calculada_m2 || 0) * getPrice(detailed.plantas, `${plantasSize}_preventivo`, `${plantasSize}_curativo`) +
        Number(metrics.seto_bajo_medio_ml || 0) * getPrice(detailed.setos, 'bajos_preventivo', 'bajos_curativo') +
        Number(metrics.seto_alto_ml || 0) * getPrice(detailed.setos, 'altos_preventivo', 'altos_curativo') +
        Number(metrics.palmeras_ducha_peq_ud || 0) * getPrice(detailed.palmeras, 'pequenas_preventivo', 'pequenas_curativo') +
        Number(metrics.palmeras_ducha_med_ud || 0) * getPrice(detailed.palmeras, 'medianas_preventivo', 'medianas_curativo') +
        Number(metrics.palmeras_ducha_alta_ud || 0) * getPrice(detailed.palmeras, 'altas_preventivo', 'altas_curativo') +
        Number(metrics.palmeras_cirugia_ud || 0) * Math.max(
          Number(detailed.palmeras.pequenas_cirugia || 0),
          Number(detailed.palmeras.medianas_cirugia || 0),
          Number(detailed.palmeras.altas_cirugia || 0),
        ) +
        Number(metrics.palmeras_endoterapia_troncos_ud || 0) * Number(normalized.palmeras.endoterapia.precio_unico || 0) +
        Number(metrics.arboles_peq_ud || 0) * getPrice(detailed.arboles, 'pequenos_preventivo', 'pequenos_curativo') +
        Number(metrics.arboles_med_ud || 0) * getPrice(detailed.arboles, 'medianos_preventivo', 'medianos_curativo') +
        Number(metrics.arboles_gran_ud || 0) * getPrice(detailed.arboles, 'grandes_preventivo', 'grandes_curativo');

      if (subtotal <= 0) {
        breakdown.push({
          zoneIndex: index,
          affectedType: affected,
          requestedTreatments,
          appliedTreatments: [],
          quantity: 0,
          unitLabel: 'm2',
          unitPrice: null,
          subtotal: null,
          lineTotal: null,
          reason: 'Métricas detalladas sin tarifa base',
        });
        return;
      }

      const ecoApplied = requestedTreatments.includes('ecologico_preventivo');
      const comboPercent = requestedTreatments.length >= 3
        ? comboThreePlusTreatmentsPercent
        : (requestedTreatments.length === 2 ? comboTwoTreatmentsPercent : 0);
      const ecoMult = ecoApplied ? (1 + (ecoModifierPercent / 100)) : 1;
      const comboMult = 1 + (comboPercent / 100);
      const lineTotal = subtotal * ecoMult * comboMult * wasteMult;
      totalBeforeMinimum += lineTotal;
      breakdown.push({
        zoneIndex: index,
        affectedType: affected,
        requestedTreatments,
        appliedTreatments: requestedTreatments,
        quantity: 1,
        unitLabel: 'ud',
        unitPrice: subtotal,
        subtotal,
        lineTotal,
      });
      return;
    }

    const effectiveTreatments = requestedTreatments.filter((treatment) => normalized.tratamientos_activos.includes(treatment));
    if (qty <= 0 || effectiveTreatments.length === 0) {
      breakdown.push({
        zoneIndex: index,
        affectedType: affected,
        requestedTreatments,
        appliedTreatments: [],
        quantity: qty,
        unitLabel,
        unitPrice: null,
        subtotal: null,
        lineTotal: null,
        reason: qty <= 0 ? 'Cantidad o superficie inválida' : 'No hay tratamientos compatibles activos',
      });
      return;
    }

    let unitPrice = 0;
    effectiveTreatments.forEach((treatment) => {
      if (affected === 'Palmeras') {
        if (treatment === 'endoterapia') {
          unitPrice += Number(normalized.palmeras.endoterapia.precio_unico || 0);
        } else {
          unitPrice += Number((zone?.aboveThreeMeters ? normalized.palmeras.tradicional.mas_de_3m : normalized.palmeras.tradicional.hasta_3m) || 0);
        }
        return;
      }
      if (affected === 'Árboles') {
        const key = zone?.aboveThreeMeters ? 'mas_de_3m' : 'hasta_3m';
        unitPrice += Number(normalized.arboles[key][pickBaseTreatment(treatment)] || 0);
        return;
      }
      if (affected === 'Setos') {
        const key = (zone?.aboveTwoMeters ?? zone?.aboveThreeMeters) ? 'mas_de_2m' : 'hasta_2m';
        unitPrice += Number(normalized.setos[key][pickBaseTreatment(treatment)] || 0);
        return;
      }
      const key = qty > 100 ? 'mas_de_100m2' : 'hasta_100m2';
      unitPrice += Number(normalized.superficies_plantas[key][pickBaseTreatment(treatment)] || 0);
    });

    if (unitPrice <= 0) {
      breakdown.push({
        zoneIndex: index,
        affectedType: affected,
        requestedTreatments,
        appliedTreatments: effectiveTreatments,
        quantity: qty,
        unitLabel,
        unitPrice: null,
        subtotal: null,
        lineTotal: null,
        reason: 'Tarifa base no configurada',
      });
      return;
    }

    const subtotal = unitPrice * qty;
    const ecoApplied = effectiveTreatments.includes('ecologico_preventivo');
    const comboPercent = effectiveTreatments.length >= 3
      ? comboThreePlusTreatmentsPercent
      : (effectiveTreatments.length === 2 ? comboTwoTreatmentsPercent : 0);
    const ecoMult = ecoApplied ? (1 + (ecoModifierPercent / 100)) : 1;
    const comboMult = 1 + (comboPercent / 100);
    const lineTotal = subtotal * ecoMult * comboMult * wasteMult;
    totalBeforeMinimum += lineTotal;
    breakdown.push({
      zoneIndex: index,
      affectedType: affected,
      requestedTreatments,
      appliedTreatments: effectiveTreatments,
      quantity: qty,
      unitLabel,
      unitPrice,
      subtotal,
      lineTotal,
    });
  });

  const rounded = Math.ceil(Math.round(totalBeforeMinimum * 100) / 100);
  const minimumFee = Number(normalized.minimum_fee || normalized.importe_minimo || 0);
  const minimumFeeApplied = minimumFee > 0 && rounded > 0 && rounded < minimumFee;

  return {
    total: minimumFeeApplied ? Math.ceil(minimumFee) : rounded,
    totalBeforeMinimum,
    minimumFeeApplied,
    minimumFee: minimumFee > 0 ? Math.ceil(minimumFee) : 0,
    breakdown,
  };
};

export function buildAuthoritativeBookingQuote(params: {
  bookingData: SerializableBookingData;
  providerConfig: any;
}): BookingQuoteResult {
  const { bookingData, providerConfig } = params;
  const config = providerConfig;
  const globalWaste = bookingData.wasteRemoval !== undefined ? bookingData.wasteRemoval : true;
  const breakdown: BookingQuoteLine[] = [];
  const warnings: BookingQuoteWarning[] = [];
  let metadata = buildDefaultQuoteMetadata();

  if (!config) {
    return buildIneligibleQuote(
      'missing_provider_config',
      'El profesional no tiene una configuración operativa válida para este servicio.',
      metadata,
    );
  }

  if (!hasRequestedBookingWork(bookingData)) {
    return buildIneligibleQuote(
      'missing_service_payload',
      'Faltan datos operativos del servicio para calcular un presupuesto autoritativo.',
      metadata,
    );
  }

  const pushWarning = (code: string, message: string) => {
    if (!warnings.some((item) => item.code === code && item.message === message)) {
      warnings.push({ code, message });
    }
  };

  let totalHours = 0;
  const palmGroups: PalmPricingGroup[] = (bookingData.palmGroups || []).map((group) => ({
    species: group.species,
    height: group.height,
    quantity: group.quantity || 1,
    state: group.state || 'normal',
    hasPhytosanitary: group.hasPhytosanitary ?? group.needsPhytosanitary,
    hasTrunkPeeling: group.hasTrunkPeeling ?? group.needsTrunkFinish,
    needsPhytosanitary: group.needsPhytosanitary,
    needsTrunkFinish: group.needsTrunkFinish,
    hasAccessDifficulty: group.hasAccessDifficulty,
    isTerminalOpenRange: group.isTerminalOpenRange,
  }));
  if (bookingData.palmGroups?.length) {
    metadata = buildPalmQuoteMetadata(bookingData.palmGroups, palmGroups, config);
    if (!metadata.palmCoverage?.isFull) {
      return buildIneligibleQuote(
        'partial_palm_coverage',
        'La configuración del profesional no cubre todas las palmeras solicitadas.',
        metadata,
      );
    }
  }
  const pricedPalmGroups = palmGroups.filter((_, index) => metadata.pricingContext.palmGroups[index]?.isPriced);

  const validTrees = bookingData.treeGroups
    ?.filter((tree: any) => !(tree.isFailed || tree.analysisLevel === 3))
    .flatMap((tree: any) => {
      const sizeBand = resolveTreeBand(tree);
      if (!sizeBand) return [];
      return [{
        id: String(tree.id),
        pruningType: mapTreePruningType(tree.pruningType),
        sizeBand,
        dificultad_alta: Boolean(tree.difficultyHigh),
        nivel_analisis: tree.analysisLevel,
      }];
    }) || [];
  const treeQuote =
    validTrees.length > 0 && isTreePruningConfig(config)
      ? calculateTreePruningQuoteForTrees(config, validTrees, globalWaste)
      : null;

  if (bookingData.treeGroups?.length) {
    if (!isTreePruningConfig(config)) {
      return buildIneligibleQuote(
        'invalid_tree_config',
        'La poda de árboles requiere una configuración completa de precios y dificultad.',
        metadata,
      );
    }
    if (validTrees.length === 0 || !treeQuote?.isProfessionalSuitable) {
      return buildIneligibleQuote(
        'invalid_tree_config',
        'La configuración del profesional no permite cotizar los árboles solicitados.',
        metadata,
      );
    }
  }

  if (bookingData.lawnZones?.length) {
    const usesHourlyPricing = getPricingMethod(config) === 'per_hour';
    if (!hasPositiveNumber(config.yield_m2_per_hour)) {
      return buildIneligibleQuote(
        'missing_yield_config',
        'El servicio de césped requiere rendimiento por m2/hora configurado.',
        metadata,
      );
    }
    if (usesHourlyPricing) {
      if (!hasPositiveNumber(getPrecioPorHora(config))) {
        return buildIneligibleQuote(
          'missing_pricing_config',
          'El servicio de césped por horas requiere una tarifa horaria válida.',
          metadata,
        );
      }
    } else if (!hasPositiveNumber(config.price_per_m2)) {
      return buildIneligibleQuote(
        'missing_pricing_config',
        'El servicio de césped requiere un precio por m2 válido.',
        metadata,
      );
    }
  }

  if (bookingData.hedgeZones?.length) {
    const pricingMethod = getPricingMethod(config);
    const yields = config.yield_ml_per_hour || {};
    for (const zone of bookingData.hedgeZones) {
      const height = zone.height || '0-2m';
      if (pricingMethod === 'per_hour') {
        if (!hasPositiveNumber(getPrecioPorHora(config))) {
          return buildIneligibleQuote(
            'missing_pricing_config',
            'El servicio de setos por horas requiere una tarifa horaria válida.',
            metadata,
          );
        }
      } else {
        const base = Number(config.pricing_matrix?.[height] || config.species_prices?.[zone.type]?.[height] || 0);
        if (!(base > 0)) {
          return buildIneligibleQuote(
            'missing_pricing_config',
            'El servicio de setos requiere una matriz de precios completa para la altura solicitada.',
            metadata,
          );
        }
      }
      if (!hasPositiveNumber(yields[height])) {
        return buildIneligibleQuote(
          'missing_yield_config',
          'El servicio de setos requiere rendimientos configurados para cada altura ofertada.',
          metadata,
        );
      }
    }
  }

  if (bookingData.weedingZones?.length) {
    if (!hasPositiveNumber(config.precio_desbroce_m2)) {
      return buildIneligibleQuote(
        'missing_pricing_config',
        'El desbroce requiere un precio por m2 válido.',
        metadata,
      );
    }
    if (!hasPositiveNumber(config.yield_m2_per_hour)) {
      return buildIneligibleQuote(
        'missing_yield_config',
        'El desbroce requiere un rendimiento por m2/hora válido.',
        metadata,
      );
    }
    if ((bookingData.weedingZones || []).some((zone) => zone.applyHerbicide) && !hasPositiveNumber(config.precio_herbicida_m2)) {
      return buildIneligibleQuote(
        'missing_pricing_config',
        'El desbroce con herbicida requiere una tarifa de herbicida válida.',
        metadata,
      );
    }
  }

  if (bookingData.shrubGroups?.length) {
    const pricingMethod = getPricingMethod(config);
    const pricesPerM2 = config.prices_per_m2 || {};
    const yieldsBySize = config.yield_m2_per_hour || {};
    if (pricingMethod === 'per_hour' && !hasPositiveNumber(getPrecioPorHora(config))) {
      return buildIneligibleQuote(
        'missing_pricing_config',
        'La poda de arbustos por horas requiere una tarifa horaria válida.',
        metadata,
      );
    }
    for (const group of bookingData.shrubGroups) {
      const size = String(group.size || 'pequeñas');
      if (pricingMethod !== 'per_hour' && !hasPositiveNumber(pricesPerM2[size])) {
        return buildIneligibleQuote(
          'missing_pricing_config',
          'La poda de arbustos requiere precios válidos por tamaño.',
          metadata,
        );
      }
      if (!hasPositiveNumber(yieldsBySize[size])) {
        return buildIneligibleQuote(
          'missing_yield_config',
          'La poda de arbustos requiere rendimientos válidos por tamaño.',
          metadata,
        );
      }
    }
  }

  if (bookingData.phytosanitaryZones?.length) {
    const normalizedPhytosanitary = normalizePhytosanitaryPricingConfig(config);
    const activeTreatments = normalizedPhytosanitary.tratamientos_activos || [];
    if (activeTreatments.length === 0) {
      return buildIneligibleQuote(
        'missing_treatment_config',
        'Los servicios fitosanitarios requieren tratamientos activos configurados.',
        metadata,
      );
    }
    const yields = config.yields || {};
    const missingYield = getRequestedPhytosanitaryYieldKeys(bookingData.phytosanitaryZones).find(
      (key) => !hasPositiveNumber(yields[key]),
    );
    if (missingYield) {
      return buildIneligibleQuote(
        'missing_yield_config',
        'Los servicios fitosanitarios requieren rendimientos completos para el trabajo solicitado.',
        metadata,
      );
    }
  }

  if (bookingData.lawnZones?.length) {
    const yieldM2 = Number(config.yield_m2_per_hour);
    bookingData.lawnZones.forEach((zone) => {
      if (zone.quantity > 0) totalHours += (zone.quantity / yieldM2) * getDurationMultiplier(zone.state);
    });
  }

  if (bookingData.hedgeZones?.length) {
    const yields = config.yield_ml_per_hour || {};
    bookingData.hedgeZones.forEach((zone) => {
      const height = zone.height || '0-2m';
      const yieldMl = Number(yields[height]);
      const length = Number(zone.length || 0);
      const faces = Number(zone.faces_to_trim || 1);
      totalHours += (length * faces / yieldMl) * getDurationMultiplier(zone.state || 'normal');
    });
  }

  if (palmGroups.length) {
    totalHours += Number(calculatePalmHoursFromConfig(pricedPalmGroups, config, globalWaste) || 0);

    metadata.pricingContext.palmGroups.forEach((group) => {
      if (group.isPriced && group.quantity > 0 && group.isTerminalOpenRange) {
        pushWarning('palm_terminal_range', 'Precio aproximado: en el rango más alto de palmera el jardinero puede ajustar el importe y requerirá tu aceptación en el chat.');
      }
    });
  }

  if (treeQuote?.isProfessionalSuitable) {
    totalHours += Number(treeQuote.totalEstimatedHours || 0);
    treeQuote.overallWarnings.forEach((message) => {
      pushWarning('tree_complexity_review', message);
    });
  }

  if (bookingData.weedingZones?.length) {
    const yieldM2 = Number(config.yield_m2_per_hour);
    bookingData.weedingZones.forEach((zone) => {
      totalHours += (Number(zone.area || 0) / yieldM2) * getDurationMultiplier(zone.state || 'normal');
    });
  }

  if (bookingData.shrubGroups?.length) {
    const yields = config.yield_m2_per_hour || {};
    bookingData.shrubGroups.forEach((group) => {
      const size = (group.size || 'pequeñas') as keyof typeof yields;
      const yieldM2 = Number(yields[size] || 0);
      totalHours += (Number(group.area || 0) / yieldM2) * getDurationMultiplier(group.state || 'normal');
    });
  }

  if (bookingData.phytosanitaryZones?.length) {
    const yields = config.yields || {};
    bookingData.phytosanitaryZones.forEach((zone: any) => {
      const metrics = zone.analysisMetrics;
      if (metrics) {
        if (metrics.cesped_m2) totalHours += metrics.cesped_m2 / Number(yields.cesped_m2_per_hour || 0);
        if (metrics.seto_bajo_medio_ml) totalHours += metrics.seto_bajo_medio_ml / Number(yields.setos_ml_per_hour || 0);
        if (metrics.seto_alto_ml) totalHours += metrics.seto_alto_ml / Number(yields.setos_ml_per_hour || 0);
        if (metrics.palmeras_ducha_peq_ud) totalHours += metrics.palmeras_ducha_peq_ud / Number(yields.palmeras_units_per_hour || 0);
        if (metrics.palmeras_ducha_med_ud) totalHours += metrics.palmeras_ducha_med_ud / Number(yields.palmeras_units_per_hour || 0);
        if (metrics.palmeras_ducha_alta_ud) totalHours += metrics.palmeras_ducha_alta_ud / Number(yields.palmeras_units_per_hour || 0);
        if (metrics.palmeras_cirugia_ud) totalHours += metrics.palmeras_cirugia_ud / Number(yields.palmeras_units_per_hour || 0);
        if (metrics.palmeras_endoterapia_troncos_ud) totalHours += metrics.palmeras_endoterapia_troncos_ud / Number(yields.endoterapia_units_per_hour || 0);
        if (metrics.arboles_peq_ud) totalHours += metrics.arboles_peq_ud / Number(yields.arboles_units_per_hour || 0);
        if (metrics.arboles_med_ud) totalHours += metrics.arboles_med_ud / Number(yields.arboles_units_per_hour || 0);
        if (metrics.arboles_gran_ud) totalHours += metrics.arboles_gran_ud / Number(yields.arboles_units_per_hour || 0);
      } else if (zone.area > 0) {
        const affectedType = zone.affectedType;
        if (affectedType === 'Palmeras') totalHours += zone.area / Number(yields.palmeras_units_per_hour || 0);
        else if (affectedType === 'Árboles') totalHours += zone.area / Number(yields.arboles_units_per_hour || 0);
        else if (affectedType === 'Setos') totalHours += zone.area / Number(yields.setos_ml_per_hour || 0);
        else if (affectedType === 'Césped') totalHours += zone.area / Number(yields.cesped_m2_per_hour || 0);
        else totalHours += zone.area / Number(yields.plantas_m2_per_hour || 0);
      }
    });
  }

  if (totalHours > 8) totalHours *= 0.9;
  const estimatedHours = Math.max(1, Math.ceil(totalHours * 2) / 2);

  const applyMinimumPrice = (calculatedPrice: number) => {
    const rounded = roundUp(calculatedPrice);
    const gardenerMin = Number(config?.minimum_price || config?.minimumPrice || config?.importe_minimo || 0);
    if (gardenerMin > 0 && rounded > 0 && rounded < gardenerMin) return roundUp(gardenerMin);
    return rounded;
  };

  const hasTreeOrPalm = (bookingData.serviceIds || []).some((id) => {
    const normalized = String(id || '').toLowerCase();
    return normalized.includes('poda-arboles') || normalized.includes('poda-palmeras') || normalized.includes('tree') || normalized.includes('palm');
  });

  let totalPrice = 0;
  const precioPorHora = getPrecioPorHora(config);

  if (getPricingMethod(config) === 'per_hour' && precioPorHora > 0 && !hasTreeOrPalm) {
    totalPrice = applyMinimumPrice(estimatedHours * precioPorHora);
  } else {
    let total = 0;

    if (palmGroups.length) {
      total += calculatePalmPriceEngine(pricedPalmGroups, config, globalWaste);

      metadata.pricingContext.palmGroups.forEach((group) => {
        if (!group.isPriced || group.quantity <= 0) return;
        breakdown.push({
          desc: `${group.quantity}x ${group.species} (${group.height})${group.isTerminalOpenRange ? ' · verificación final del profesional' : ''}`,
          price: 0,
        });
      });
    }

    if (bookingData.hedgeZones?.length) {
      let hedgeTotal = 0;
      for (const zone of bookingData.hedgeZones) {
        const lengthForPricing = Number(zone.length_pricing_m ?? zone.length ?? 0);
        const faces = Number(zone.faces_to_trim ?? 1);
        const height = zone.height || '0-2m';
        let base = Number(config.pricing_matrix?.[height] || 0);
        if (base <= 0) base = Number(config.species_prices?.[zone.type]?.[height] || 0);
        if (base <= 0) continue;

        const surcharges = config.condition_surcharges || DEFAULT_HEDGE_SURCHARGES;
        const state = String(zone.state || 'normal').toLowerCase();
        let statePercent = 0;
        if (state.includes('alta') || state.includes('muy_descuidado')) statePercent = surcharges.alta || DEFAULT_HEDGE_SURCHARGES.alta;
        else if (state.includes('media') || state.includes('descuidado')) statePercent = surcharges.media || DEFAULT_HEDGE_SURCHARGES.media;

        const stateMult = 1 + statePercent / 100;
        const wasteMult = globalWaste ? 1 + Number(config.waste_removal?.percentage || 0) / 100 : 1;
        hedgeTotal += base * lengthForPricing * faces * stateMult * wasteMult;
      }
      total += hedgeTotal;
    }

    if (treeQuote?.isProfessionalSuitable) {
      total += treeQuote.totalPrice;
    }

    if (bookingData.weedingZones?.length) {
      const quote = calculateWeedingQuote({
        zones: bookingData.weedingZones.map((zone) => ({
          id: zone.id,
          area: Number(zone.area || 0),
          state: zone.state,
          applyHerbicide: Boolean(zone.applyHerbicide),
        })),
        config,
        globalWaste,
      });
      total += quote.finalPrice;
    }

    if ((bookingData.lawnSpecies || bookingData.lawnZones?.length) && !config.height_prices) {
      let lawnSubtotal = 0;
      const zones = bookingData.lawnZones || [{ state: 'normal', quantity: bookingData.aiQuantity || 0 }];
      const baseRate = Number(config.price_per_m2 || 0);

      if (baseRate > 0) {
        zones.forEach((zone) => {
          const state = String(zone.state || 'normal').toLowerCase();
          const surcharges = config.condition_surcharges || {};
          let statePercent = 0;
          if (state.includes('muy')) statePercent = surcharges.muy_descuidado || 50;
          else if (state.includes('descuidad')) statePercent = surcharges.descuidado || 20;
          const stateMult = 1 + statePercent / 100;
          const wasteMult = globalWaste ? 1 + Number(config.waste_removal?.percentage || 0) / 100 : 1;
          lawnSubtotal += baseRate * Number(zone.quantity || 0) * stateMult * wasteMult;
        });
      }

      total += lawnSubtotal;
    }

    if (bookingData.shrubGroups?.length) {
      let shrubTotal = 0;
      const pricesPerM2 = config.prices_per_m2 || {};
      bookingData.shrubGroups.forEach((group) => {
        const size = (group.size || 'pequeñas') as keyof typeof pricesPerM2;
        const pricePerM2 = Number(pricesPerM2[size] || 0);
        const state = String(group.state || 'normal').toLowerCase();
        const surcharges = config.condition_surcharges || DEFAULT_SHRUB_SURCHARGES;
        let statePercent = 0;
        if (state.includes('muy')) statePercent = surcharges.alta || DEFAULT_SHRUB_SURCHARGES.alta;
        else if (state.includes('descuidad')) statePercent = surcharges.media || DEFAULT_SHRUB_SURCHARGES.media;
        const stateMult = 1 + statePercent / 100;
        const wasteMult = globalWaste ? 1 + Number(config.waste_removal?.percentage || 0) / 100 : 1;
        shrubTotal += Number(group.area || 0) * pricePerM2 * stateMult * wasteMult;
      });
      total += shrubTotal;
      breakdown.push(...buildShrubBreakdown(bookingData, config, globalWaste));
    }

    if (bookingData.phytosanitaryZones?.length) {
      const phytosanitaryQuote = calculatePhytosanitaryQuote({
        zones: bookingData.phytosanitaryZones,
        config,
        globalWaste,
      });
      total += phytosanitaryQuote.total;
      phytosanitaryQuote.breakdown.forEach((item) => {
        breakdown.push({
          desc: item.reason ? `${formatPhytosanitaryLabel(item)} · ${item.reason}` : formatPhytosanitaryLabel(item),
          price: roundUp(Number(item.lineTotal || 0)),
        });
      });
      if (phytosanitaryQuote.minimumFeeApplied) {
        breakdown.push({
          desc: `Ajuste por importe mínimo (${roundUp(phytosanitaryQuote.minimumFee)}€)`,
          price: roundUp(phytosanitaryQuote.minimumFee),
        });
      }
      if (phytosanitaryQuote.breakdown.some((item) => item.reason)) {
        return buildIneligibleQuote(
          'missing_pricing_config',
          'Los servicios fitosanitarios tienen tratamientos o tarifas incompletos para la solicitud.',
          metadata,
        );
      }
    }

    totalPrice = applyMinimumPrice(total);
    const currentBreakdownTotal = breakdown.reduce((sum, line) => sum + line.price, 0);
    if (totalPrice > 0 && breakdown.length > 0 && currentBreakdownTotal > 0 && totalPrice > currentBreakdownTotal) {
      breakdown.push({
        desc: `Ajuste por importe mínimo (${roundUp(Number(config?.minimum_price || config?.minimumPrice || config?.importe_minimo || 0))}€)`,
        price: totalPrice - currentBreakdownTotal,
      });
    }
  }

  const normalizedBreakdown = breakdown.filter((line) => line.price > 0 || line.desc.includes('verificación final del profesional'));

  return {
    totalPrice,
    estimatedHours,
    breakdown: normalizedBreakdown,
    warnings,
    metadata,
    economics: buildQuoteEconomics(totalPrice, normalizedBreakdown),
    eligibility: {
      isEligible: totalPrice > 0,
    },
  };
}
