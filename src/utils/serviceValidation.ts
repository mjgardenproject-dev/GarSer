import { 
  LawnPricingConfig, 
  HedgePricingConfig, 
  PalmPricingConfig, 
  ShrubPricingConfig, 
  WeedingPricingConfig,
  HedgeHeightBand,
  PhytosanitaryPricingConfig
} from '../types';
import { TreePruningServiceConfig } from '../types/treePruning';
import { z } from 'zod';
import { normalizePhytosanitaryPricingConfig, toPersistedPhytosanitaryConfig } from './phytosanitaryConfig';
import { getPrecioPorHora, getPricingMethod } from './hourlyPricing';

export const PHYTOSANITARY_TREATMENTS = ['insecticida', 'fungicida', 'ecologico_preventivo', 'endoterapia'] as const;
export type PhytosanitaryTreatment = typeof PHYTOSANITARY_TREATMENTS[number];

export const PRICING_METHODS = ['per_quantity', 'per_hour'] as const;
export type PricingMethod = typeof PRICING_METHODS[number];

export const pricingMethodSchema = z.enum(PRICING_METHODS);

type PhytosanitaryBaseTreatment = Exclude<PhytosanitaryTreatment, 'endoterapia'>;
type PhytosanitaryWithoutHerbicide = PhytosanitaryBaseTreatment;

export type PhytosanitaryAffectedType = 'Césped' | 'Árboles' | 'Setos' | 'Plantas bajas' | 'Palmeras';
export type PhytosanitaryScaleBand = 'hasta_100m2' | 'mas_de_100m2';
export type PhytosanitaryHeightBand = 'hasta_2m' | 'mas_de_2m' | 'hasta_3m' | 'mas_de_3m';

type PhytosanitaryBasePriceMatrix = Record<PhytosanitaryBaseTreatment, number>;
type PhytosanitaryNoHerbicidePriceMatrix = Record<PhytosanitaryWithoutHerbicide, number>;

export interface PhytosanitaryV2PricingConfig {
  version: 'phytosanitary_v2';
  pricing_method?: PricingMethod;
  precioPorHora?: number;
  hourly_rate?: number;
  importe_minimo: number;
  minimum_fee?: number;
  tratamientos_activos: PhytosanitaryTreatment[];
  superficies_plantas: {
    hasta_100m2: PhytosanitaryBasePriceMatrix;
    mas_de_100m2: PhytosanitaryBasePriceMatrix;
  };
  setos: {
    hasta_2m: PhytosanitaryNoHerbicidePriceMatrix;
    mas_de_2m: PhytosanitaryNoHerbicidePriceMatrix;
  };
  arboles: {
    hasta_3m: PhytosanitaryNoHerbicidePriceMatrix;
    mas_de_3m: PhytosanitaryNoHerbicidePriceMatrix;
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
  recargo_retirada?: {
    percentage: number;
  };
  waste_removal?: {
    percentage: number;
  };
  pricing_modifiers?: {
    eco?: {
      percentage: number;
    };
    combo?: {
      two_treatments_percentage: number;
      three_plus_treatments_percentage: number;
    };
  };
  yields: {
    cesped_m2_per_hour: number;
    setos_ml_per_hour: number;
    palmeras_units_per_hour: number;
    arboles_units_per_hour: number;
    plantas_m2_per_hour: number;
    endoterapia_units_per_hour: number;
  };
}

export const phytosanitaryV2Schema = z.object({
  version: z.literal('phytosanitary_v2'),
  pricing_method: pricingMethodSchema.default('per_quantity'),
  precioPorHora: z.number().nonnegative().optional(),
  hourly_rate: z.number().nonnegative().optional(),
  importe_minimo: z.number().nonnegative(),
  tratamientos_activos: z.array(z.enum(PHYTOSANITARY_TREATMENTS)).min(1),
  superficies_plantas: z.object({
    hasta_100m2: z.object({
      insecticida: z.number().nonnegative(),
      fungicida: z.number().nonnegative(),
      ecologico_preventivo: z.number().nonnegative()
    }),
    mas_de_100m2: z.object({
      insecticida: z.number().nonnegative(),
      fungicida: z.number().nonnegative(),
      ecologico_preventivo: z.number().nonnegative()
    })
  }),
  setos: z.object({
    hasta_2m: z.object({
      insecticida: z.number().nonnegative(),
      fungicida: z.number().nonnegative(),
      ecologico_preventivo: z.number().nonnegative()
    }),
    mas_de_2m: z.object({
      insecticida: z.number().nonnegative(),
      fungicida: z.number().nonnegative(),
      ecologico_preventivo: z.number().nonnegative()
    })
  }),
  arboles: z.object({
    hasta_3m: z.object({
      insecticida: z.number().nonnegative(),
      fungicida: z.number().nonnegative(),
      ecologico_preventivo: z.number().nonnegative()
    }),
    mas_de_3m: z.object({
      insecticida: z.number().nonnegative(),
      fungicida: z.number().nonnegative(),
      ecologico_preventivo: z.number().nonnegative()
    })
  }),
  palmeras: z.object({
    tradicional: z.object({
      hasta_3m: z.number().nonnegative(),
      mas_de_3m: z.number().nonnegative()
    }),
    endoterapia: z.object({
      precio_unico: z.number().nonnegative()
    })
  }),
  yields: z.object({
    cesped_m2_per_hour: z.number().positive(),
    setos_ml_per_hour: z.number().positive(),
    palmeras_units_per_hour: z.number().positive(),
    arboles_units_per_hour: z.number().positive(),
    plantas_m2_per_hour: z.number().positive(),
    endoterapia_units_per_hour: z.number().positive(),
  }),
  recargo_retirada: z.object({ percentage: z.number().nonnegative() }).optional(),
  waste_removal: z.object({ percentage: z.number().nonnegative() }).optional(),
  minimum_fee: z.number().nonnegative().optional(),
  pricing_modifiers: z.object({
    eco: z.object({ percentage: z.number() }).optional(),
    combo: z.object({
      two_treatments_percentage: z.number(),
      three_plus_treatments_percentage: z.number()
    }).optional()
  }).optional()
}).superRefine((data, ctx) => {
  if (data.pricing_method === 'per_hour' && getPrecioPorHora(data) <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "La tarifa horaria es obligatoria para el método de cobro por hora",
      path: ["precioPorHora"]
    });
  }
});

export type PhytosanitaryV2RuntimeConfig = z.infer<typeof phytosanitaryV2Schema>;

type PhytosanitaryPricingBlock = 'superficies_plantas' | 'setos' | 'arboles' | 'palmeras_tradicional' | 'palmeras_endoterapia';
const PHYTOSANITARY_COMPATIBILITY: Record<PhytosanitaryPricingBlock, PhytosanitaryTreatment[]> = {
  superficies_plantas: ['insecticida', 'fungicida', 'ecologico_preventivo'],
  setos: ['insecticida', 'fungicida', 'ecologico_preventivo'],
  arboles: ['insecticida', 'fungicida', 'ecologico_preventivo'],
  palmeras_tradicional: ['insecticida', 'fungicida', 'ecologico_preventivo'],
  palmeras_endoterapia: ['endoterapia']
};

export const isPhytosanitaryTreatmentCompatible = (block: PhytosanitaryPricingBlock, treatment: PhytosanitaryTreatment): boolean => {
  return PHYTOSANITARY_COMPATIBILITY[block].includes(treatment);
};

export const phytosanitaryAITaskSchema = z.object({
  ai_ref_id: z.string().optional(),
  tipo_servicio: z.string(),
  tipo_afectado: z.enum(['Césped', 'Árboles', 'Setos', 'Plantas bajas', 'Palmeras']).optional(),
  cantidad_o_superficie: z.number().nonnegative(),
  unidad: z.enum(['unidades', 'm2', 'ml']).optional(),
  nivel_plaga: z.string().optional(),
  tratamiento_recomendado: z.enum(PHYTOSANITARY_TREATMENTS).optional(),
  altura_tramo: z.enum(['bajos_medios', 'altos', 'pequenos', 'medianos', 'grandes', 'pequenas', 'medianas', 'altas']).nullable().optional(),
  palmeras_cirugia: z.boolean().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  nivel_analisis: z.number().int().min(1).max(3).optional(),
  observaciones: z.array(z.string()).nullable().optional()
});

export const phytosanitaryAIResponseSchema = z.object({
  recommended_treatment: z.enum([...PHYTOSANITARY_TREATMENTS, 'inconclusive']).optional(),
  confidence: z.number().min(0).max(1).optional(),
  detected_elements: z.object({
    surfaces_plants: z.array(z.object({
      ai_ref_id: z.string().optional(),
      estimated_area_m2: z.number().nonnegative().optional(),
    })).optional(),
    hedges: z.array(z.object({
      ai_ref_id: z.string().optional(),
      size_band: z.enum(['bajos_medios', 'altos']).optional(),
      ml: z.number().nonnegative().optional()
    })).optional(),
    trees: z.array(z.object({
      ai_ref_id: z.string().optional(),
      size_band: z.enum(['pequenos', 'medianos', 'grandes']).optional()
    })).optional(),
    palms: z.array(z.object({
      ai_ref_id: z.string().optional(),
      size_band: z.enum(['pequenas', 'medianas', 'altas']).optional(),
      surgery_recommended: z.boolean().optional()
    })).optional()
  }).optional(),
  tareas: z.array(phytosanitaryAITaskSchema).optional()
});

const buildBaseMatrix = (value: number): PhytosanitaryBasePriceMatrix => ({
  insecticida: value,
  fungicida: value,
  ecologico_preventivo: value
});

const buildNoHerbicideMatrix = (value: number): PhytosanitaryNoHerbicidePriceMatrix => ({
  insecticida: value,
  fungicida: value,
  ecologico_preventivo: value
});

export const mapLegacyPhytosanitaryConfigToV2 = (legacy: PhytosanitaryPricingConfig): PhytosanitaryV2PricingConfig => {
  const selected = legacy.selected_types || [];
  const active: PhytosanitaryTreatment[] = [];

  if (selected.includes('Insecticida')) active.push('insecticida');
  if (selected.includes('Fungicida')) active.push('fungicida');
  if (!active.includes('ecologico_preventivo')) active.push('ecologico_preventivo');

  const sampleType = selected[0];
  const fixed = Number(sampleType ? legacy.type_prices?.[sampleType]?.['0-50'] || 0 : 0);
  const middle = Number(sampleType ? legacy.type_prices?.[sampleType]?.['50-200'] || 0 : 0);
  const high = Number(sampleType ? legacy.type_prices?.[sampleType]?.['200+'] || 0 : 0);
  const defaultValue = middle > 0 ? middle : (fixed > 0 ? fixed : high);
  const highValue = high > 0 ? high : defaultValue;
  const palmValue = high > 0 ? high : defaultValue;

  return {
    version: 'phytosanitary_v2',
    pricing_method: legacy.pricing_method || 'per_quantity',
    precioPorHora: getPrecioPorHora(legacy),
    importe_minimo: Number(legacy.minimum_price || 0),
    minimum_fee: Number(legacy.minimum_fee || legacy.minimum_price || 0),
    tratamientos_activos: active.length > 0 ? active : ['ecologico_preventivo'],
    superficies_plantas: {
      hasta_100m2: buildBaseMatrix(defaultValue),
      mas_de_100m2: buildBaseMatrix(highValue)
    },
    setos: {
      hasta_2m: buildNoHerbicideMatrix(defaultValue),
      mas_de_2m: buildNoHerbicideMatrix(highValue)
    },
    arboles: {
      hasta_3m: buildNoHerbicideMatrix(defaultValue),
      mas_de_3m: buildNoHerbicideMatrix(highValue)
    },
    palmeras: {
      tradicional: {
        hasta_3m: palmValue,
        mas_de_3m: highValue
      },
      endoterapia: {
        precio_unico: 0
      }
    },
    recargo_retirada: {
      percentage: Number(legacy.waste_removal?.percentage || 0)
    },
    waste_removal: {
      percentage: Number(legacy.waste_removal?.percentage || 0)
    },
    pricing_modifiers: {
      eco: { percentage: Number(legacy.pricing_modifiers?.eco?.percentage || 0) },
      combo: {
        two_treatments_percentage: Number(legacy.pricing_modifiers?.combo?.two_treatments_percentage || 0),
        three_plus_treatments_percentage: Number(legacy.pricing_modifiers?.combo?.three_plus_treatments_percentage || 0)
      }
    },
    yields: {
      cesped_m2_per_hour: Number(legacy.yields?.cesped_m2_per_hour || 0),
      setos_ml_per_hour: Number(legacy.yields?.setos_ml_per_hour || 0),
      palmeras_units_per_hour: Number(legacy.yields?.palmeras_units_per_hour || 0),
      arboles_units_per_hour: Number(legacy.yields?.arboles_units_per_hour || 0),
      plantas_m2_per_hour: Number(legacy.yields?.plantas_m2_per_hour || 0),
      endoterapia_units_per_hour: Number(legacy.yields?.endoterapia_units_per_hour || 0)
    }
  };
};

export const normalizePhytosanitaryConfig = (config: unknown): PhytosanitaryV2PricingConfig | null => {
  if (!config || typeof config !== 'object') return null;
  const normalized = normalizePhytosanitaryPricingConfig(config as PhytosanitaryPricingConfig);
  const parsedNormalized = phytosanitaryV2Schema.safeParse(normalized);
  if (parsedNormalized.success) return parsedNormalized.data;

  const parsedV2 = phytosanitaryV2Schema.safeParse(config);
  if (parsedV2.success) return parsedV2.data;

  const hasLegacyKeys = typeof (config as any).minimum_price === 'number' || !!(config as any).type_prices;
  if (!hasLegacyKeys) return null;
  return mapLegacyPhytosanitaryConfigToV2(config as PhytosanitaryPricingConfig);
};

export const normalizePhytosanitaryTreatment = (value: string | undefined | null): PhytosanitaryTreatment => {
  const text = String(value || '').toLowerCase();
  if (text.includes('endo')) return 'endoterapia';
  if (text.includes('ecol')) return 'ecologico_preventivo';
  if (text.includes('fung')) return 'fungicida';
  if (text.includes('plaga activa') || text.includes('curativo') || text.includes('insect')) return 'insecticida';
  return 'ecologico_preventivo';
};

export const normalizePhytosanitaryAffectedType = (value: string | undefined | null): PhytosanitaryAffectedType => {
  const text = String(value || '').toLowerCase();
  if (text.includes('palmera')) return 'Palmeras';
  if (text.includes('árbol') || text.includes('arbol')) return 'Árboles';
  if (text.includes('seto')) return 'Setos';
  if (text.includes('césped') || text.includes('cesped')) return 'Césped';
  return 'Plantas bajas';
};

const pickBaseTreatment = (treatment: PhytosanitaryTreatment): PhytosanitaryBaseTreatment => {
  if (treatment === 'insecticida' || treatment === 'fungicida' || treatment === 'ecologico_preventivo') {
    return treatment;
  }
  return 'insecticida';
};

export type PhytosanitaryQuoteZone = {
  area: number;
  totalAreaM2?: number;
  type?: string;
  affectedType?: string;
  aboveTwoMeters?: boolean;
  aboveThreeMeters?: boolean;
  intent?: 'preventive' | 'curative' | 'weed_control';
  curativeTarget?: 'insects' | 'fungus' | 'both';
  productPreference?: 'chemical' | 'ecological';
  trunkSize?: 'small' | 'medium' | 'large';
  analysisMetrics?: {
    cesped_m2?: number;
    plantas_superficie_calculada_m2?: number;
    plantas_tamano_dominante?: 'pequenas' | 'medianas' | 'grandes';
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
};

export interface PhytosanitaryQuoteBreakdownItem {
  zoneIndex: number;
  affectedType: PhytosanitaryAffectedType;
  requestedTreatments: PhytosanitaryTreatment[];
  appliedTreatments: PhytosanitaryTreatment[];
  quantity: number;
  unitLabel: 'm2' | 'ml' | 'ud';
  unitPrice: number | null;
  subtotal: number | null;
  ecoModifierPercent: number;
  comboModifierPercent: number;
  severeModifierPercent: number;
  wasteModifierPercent: number;
  lineTotal: number | null;
  formula: string;
  reason?: string;
}

export interface PhytosanitaryQuoteResult {
  total: number;
  final_price: number;
  totalBeforeMinimum: number;
  minimumFeeApplied: boolean;
  minimumFee: number;
  breakdown: PhytosanitaryQuoteBreakdownItem[];
}

export const calculatePhytosanitaryQuote = (params: {
  zones: PhytosanitaryQuoteZone[];
  config: unknown;
  globalWaste: boolean;
}): PhytosanitaryQuoteResult => {
  const normalized = normalizePhytosanitaryConfig(params.config);
  const normalizedWithDetails = normalizePhytosanitaryPricingConfig(params.config as PhytosanitaryPricingConfig | undefined);
  if (!normalized || !Array.isArray(params.zones) || params.zones.length === 0) {
    return { total: 0, final_price: 0, totalBeforeMinimum: 0, minimumFeeApplied: false, minimumFee: 0, breakdown: [] };
  }

  const wastePercentage = Number(
    normalized.recargo_retirada?.percentage ??
    normalized.waste_removal?.percentage ??
    0
  );
  const ecoModifierPercent = Number(normalized.pricing_modifiers?.eco?.percentage || 0);
  const comboTwoTreatmentsPercent = Number(normalized.pricing_modifiers?.combo?.two_treatments_percentage || 0);
  const comboThreePlusTreatmentsPercent = Number(normalized.pricing_modifiers?.combo?.three_plus_treatments_percentage || 0);
  const wasteMult = 1; // Fitosanitarios no generan restos verdes
  const breakdown: PhytosanitaryQuoteBreakdownItem[] = [];
  let totalBeforeMinimum = 0;

  params.zones.forEach((zone, index) => {
    const qty = Number(zone.area || 0);
    const affected = normalizePhytosanitaryAffectedType(zone.affectedType);
    
    const intent = zone.intent || 'preventive';
    const isCurative = intent === 'curative';
    const isWeedControl = intent === 'weed_control';
    const isEco = zone.productPreference === 'ecological';
    const isComboTreatment = zone.curativeTarget === 'both';

    const requestedTreatments: PhytosanitaryTreatment[] = [];
    if (isWeedControl) {
      // Malas hierbas is handled by the Weeding service, not here.
      // But if it slips through somehow, we just push a default or do nothing.
      requestedTreatments.push('ecologico_preventivo');
    } else {
      if (isEco && !isCurative) {
        requestedTreatments.push('ecologico_preventivo');
      } else {
        if (isCurative) {
          if (zone.curativeTarget === 'insects' || isComboTreatment) requestedTreatments.push('insecticida');
          if (zone.curativeTarget === 'fungus' || isComboTreatment) requestedTreatments.push('fungicida');
        } else {
          // Default preventive chemical
          requestedTreatments.push('insecticida');
        }
      }
    }
    
    if (affected === 'Palmeras' && (zone.analysisMetrics?.palmeras_cirugia_ud || zone.analysisMetrics?.palmeras_endoterapia_troncos_ud)) {
        requestedTreatments.push('endoterapia');
    }

    const unitLabel: 'm2' | 'ml' | 'ud' = affected === 'Palmeras' || affected === 'Árboles' ? 'ud' : (affected === 'Setos' ? 'ml' : 'm2');
    const metrics = zone.analysisMetrics || {};
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
      metrics.herbicida_poca_densidad_m2,
      metrics.herbicida_mucha_densidad_m2
    ].some((value) => Number(value || 0) > 0);

    if (hasDetailedMetrics) {
      const detailed = normalizedWithDetails.detailed_pricing;
      const isCure = isCurative;
      
      const getPrice = (cat: any, prevField: string, curField: string) => {
        return Number(cat?.[isCure ? curField : prevField] || 0);
      };

      const sizePlantas = metrics.plantas_tamano_dominante || 'pequenas';

      const base = {
        cesped: Number(metrics.cesped_m2 || 0) * getPrice(detailed?.cesped, 'preventivo', 'curativo'),
        plantas: Number(metrics.plantas_superficie_calculada_m2 || 0) * getPrice(detailed?.plantas, `${sizePlantas}_preventivo`, `${sizePlantas}_curativo`),
        seto: (Number(metrics.seto_bajo_medio_ml || 0) * getPrice(detailed?.setos, 'bajos_preventivo', 'bajos_curativo'))
          + (Number(metrics.seto_alto_ml || 0) * getPrice(detailed?.setos, 'altos_preventivo', 'altos_curativo')),
        palmeraDucha: (Number(metrics.palmeras_ducha_peq_ud || 0) * getPrice(detailed?.palmeras, 'pequenas_preventivo', 'pequenas_curativo'))
          + (Number(metrics.palmeras_ducha_med_ud || 0) * getPrice(detailed?.palmeras, 'medianas_preventivo', 'medianas_curativo'))
          + (Number(metrics.palmeras_ducha_alta_ud || 0) * getPrice(detailed?.palmeras, 'altas_preventivo', 'altas_curativo')),
        palmeraCirugia: Number(metrics.palmeras_cirugia_ud || 0) * Math.max(
          Number(detailed?.palmeras.pequenas_cirugia || 0),
          Number(detailed?.palmeras.medianas_cirugia || 0),
          Number(detailed?.palmeras.altas_cirugia || 0)
        ),
        palmeraEndoterapia: Number(metrics.palmeras_endoterapia_troncos_ud || 0) * Number(normalized.palmeras.endoterapia.precio_unico || 0),
        arboles: (Number(metrics.arboles_peq_ud || 0) * getPrice(detailed?.arboles, 'pequenos_preventivo', 'pequenos_curativo'))
          + (Number(metrics.arboles_med_ud || 0) * getPrice(detailed?.arboles, 'medianos_preventivo', 'medianos_curativo'))
          + (Number(metrics.arboles_gran_ud || 0) * getPrice(detailed?.arboles, 'grandes_preventivo', 'grandes_curativo'))
      };
      const subtotal = Object.values(base).reduce((sum, item) => sum + item, 0);
      const hasSevereInfestation = (metrics.observaciones_ia || []).some((item) => {
        const text = String(item || '').toLowerCase();
        return text.includes('sever') || text.includes('grave') || text.includes('alta infest') || text.includes('critical') || text.includes('riesgo alto');
      });
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
          ecoModifierPercent: 0,
          comboModifierPercent: 0,
          severeModifierPercent: 0,
          wasteModifierPercent: params.globalWaste ? wastePercentage : 0,
          lineTotal: null,
          formula: 'subtotal nulo',
          reason: 'Métricas detalladas sin tarifa base'
        });
        return;
      }
      const ecoApplied = requestedTreatments.includes('ecologico_preventivo');
      const ecoMult = ecoApplied ? (1 + (ecoModifierPercent / 100)) : 1;
      const comboPercent = requestedTreatments.length >= 3
        ? comboThreePlusTreatmentsPercent
        : (requestedTreatments.length === 2 ? comboTwoTreatmentsPercent : 0);
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
        ecoModifierPercent: ecoApplied ? ecoModifierPercent : 0,
        comboModifierPercent: comboPercent,
        severeModifierPercent: 0,
        wasteModifierPercent: params.globalWaste ? wastePercentage : 0,
        lineTotal,
        formula: `base(${subtotal.toFixed(2)}€) × eco(${ecoApplied ? ecoModifierPercent : 0}%) × combo(${comboPercent}%) × retirada(${params.globalWaste ? wastePercentage : 0}%)`
      });
      return;
    }

    if (qty <= 0) {
      breakdown.push({
        zoneIndex: index,
        affectedType: affected,
        requestedTreatments,
        appliedTreatments: [],
        quantity: qty,
        unitLabel,
        unitPrice: null,
        subtotal: null,
        ecoModifierPercent: 0,
        comboModifierPercent: 0,
        severeModifierPercent: 0,
        wasteModifierPercent: params.globalWaste ? wastePercentage : 0,
        lineTotal: null,
        formula: 'subtotal nulo',
        reason: 'Cantidad o superficie inválida'
      });
      return;
    }

    const appliedTreatments = requestedTreatments.filter((treatment) => {
      if (!normalized.tratamientos_activos.includes(treatment)) return false;
      if (affected === 'Palmeras' && treatment === 'endoterapia') return true;
      if (affected === 'Palmeras') return isPhytosanitaryTreatmentCompatible('palmeras_tradicional', treatment);
      if (affected === 'Árboles') return isPhytosanitaryTreatmentCompatible('arboles', treatment);
      if (affected === 'Setos') return isPhytosanitaryTreatmentCompatible('setos', treatment);
      return isPhytosanitaryTreatmentCompatible('superficies_plantas', treatment); // Includes Plantas and Cesped
    });

    const fallbackTreatment = normalized.tratamientos_activos.find((treatment) => {
      if (affected === 'Palmeras' && treatment === 'endoterapia') return true;
      if (affected === 'Palmeras') return isPhytosanitaryTreatmentCompatible('palmeras_tradicional', treatment);
      if (affected === 'Árboles') return isPhytosanitaryTreatmentCompatible('arboles', treatment);
      if (affected === 'Setos') return isPhytosanitaryTreatmentCompatible('setos', treatment);
      return isPhytosanitaryTreatmentCompatible('superficies_plantas', treatment);
    });

    const effectiveTreatments = appliedTreatments.length > 0
      ? appliedTreatments
      : (fallbackTreatment ? [fallbackTreatment] : []);

    if (effectiveTreatments.length === 0) {
      breakdown.push({
        zoneIndex: index,
        affectedType: affected,
        requestedTreatments,
        appliedTreatments: [],
        quantity: qty,
        unitLabel,
        unitPrice: null,
        subtotal: null,
        ecoModifierPercent: 0,
        comboModifierPercent: 0,
        severeModifierPercent: 0,
        wasteModifierPercent: params.globalWaste ? wastePercentage : 0,
        lineTotal: null,
        formula: 'subtotal nulo',
        reason: 'No hay tratamientos compatibles activos'
      });
      return;
    }

    const detailed = normalizedWithDetails.detailed_pricing;
    const isCure = isCurative;

    let unitPrice = 0;
    effectiveTreatments.forEach((treatment) => {
      if (affected === 'Palmeras') {
        if (treatment === 'endoterapia') {
          unitPrice += Number(normalized.palmeras.endoterapia.precio_unico || 0);
        } else {
          const band = zone.aboveThreeMeters ? 'mas_de_3m' : 'hasta_3m';
          const fallbackPrice = isCure ? Number(detailed?.palmeras[band === 'mas_de_3m' ? 'medianas_curativo' : 'pequenas_curativo'] || 0)
                                       : Number(detailed?.palmeras[band === 'mas_de_3m' ? 'medianas_preventivo' : 'pequenas_preventivo'] || 0);
          unitPrice += fallbackPrice > 0 ? fallbackPrice : Number(normalized.palmeras.tradicional[band] || 0);
        }
        return;
      }

      if (affected === 'Árboles') {
        const band = zone.aboveThreeMeters ? 'mas_de_3m' : 'hasta_3m';
        const fallbackPrice = isCure ? Number(detailed?.arboles[band === 'mas_de_3m' ? 'medianos_curativo' : 'pequenos_curativo'] || 0) 
                                     : Number(detailed?.arboles[band === 'mas_de_3m' ? 'medianos_preventivo' : 'pequenos_preventivo'] || 0);
        const treatmentKey = pickBaseTreatment(treatment);
        unitPrice += fallbackPrice > 0 ? fallbackPrice : Number(normalized.arboles[band][treatmentKey as PhytosanitaryWithoutHerbicide] || 0);
        return;
      }

      if (affected === 'Setos') {
        const over2m = zone.aboveTwoMeters ?? zone.aboveThreeMeters ?? false;
        const band = over2m ? 'mas_de_2m' : 'hasta_2m';
        const fallbackPrice = isCure ? Number(detailed?.setos[band === 'mas_de_2m' ? 'altos_curativo' : 'bajos_curativo'] || 0) 
                                     : Number(detailed?.setos[band === 'mas_de_2m' ? 'altos_preventivo' : 'bajos_preventivo'] || 0);
        const treatmentKey = pickBaseTreatment(treatment);
        unitPrice += fallbackPrice > 0 ? fallbackPrice : Number(normalized.setos[band][treatmentKey as PhytosanitaryWithoutHerbicide] || 0);
        return;
      }

      const areaBand = qty > 100 ? 'mas_de_100m2' : 'hasta_100m2';
      const treatmentKey = pickBaseTreatment(treatment);
      const isPlantas = affected === 'Plantas bajas';
      
      let fallbackPrice = 0;
      if (isPlantas) {
        const sizePlantas = zone.analysisMetrics?.plantas_tamano_dominante || 'pequenas';
        fallbackPrice = isCure ? Number(detailed?.plantas[`${sizePlantas}_curativo`] || 0) : Number(detailed?.plantas[`${sizePlantas}_preventivo`] || 0);
      } else {
        fallbackPrice = isCure ? Number(detailed?.cesped.curativo || 0) : Number(detailed?.cesped.preventivo || 0);
      }

      unitPrice += fallbackPrice > 0 ? fallbackPrice : Number(normalized.superficies_plantas[areaBand][treatmentKey] || 0);
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
        ecoModifierPercent: 0,
        comboModifierPercent: 0,
        severeModifierPercent: 0,
        wasteModifierPercent: params.globalWaste ? wastePercentage : 0,
        lineTotal: null,
        formula: 'subtotal nulo',
        reason: 'Tarifa base no configurada'
      });
      return;
    }

    const subtotal = unitPrice * qty;
    const ecoApplied = effectiveTreatments.includes('ecologico_preventivo');
    const ecoMult = ecoApplied ? (1 + (ecoModifierPercent / 100)) : 1;
    const comboPercent = effectiveTreatments.length >= 3
      ? comboThreePlusTreatmentsPercent
      : (effectiveTreatments.length === 2 ? comboTwoTreatmentsPercent : 0);
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
      ecoModifierPercent: ecoApplied ? ecoModifierPercent : 0,
      comboModifierPercent: comboPercent,
      severeModifierPercent: 0,
      wasteModifierPercent: params.globalWaste ? wastePercentage : 0,
      lineTotal,
      formula: `${qty}${unitLabel} × ${unitPrice.toFixed(2)}€ × eco(${ecoApplied ? ecoModifierPercent : 0}%) × combo(${comboPercent}%) × retirada(${params.globalWaste ? wastePercentage : 0}%)`
    });
  });

  const rounded = Math.ceil(Math.round(totalBeforeMinimum * 100) / 100);
  const minimumFee = Number(normalized.minimum_fee || normalized.importe_minimo || 0);
  const minimumFeeApplied = minimumFee > 0 && rounded > 0 && rounded < minimumFee;
  const total = minimumFeeApplied ? Math.ceil(minimumFee) : rounded;

  return {
    total,
    final_price: total,
    totalBeforeMinimum,
    minimumFeeApplied,
    minimumFee: minimumFee > 0 ? Math.ceil(minimumFee) : 0,
    breakdown
  };
};

// --- Lawn Validation ---
export const isLawnConfigValid = (config: LawnPricingConfig | undefined): boolean => {
  if (!config) return false;
  if ((config.minimum_price || 0) <= 0) return false;
  
  const pricingMethod = config.pricing_method || 'per_quantity';
  if (pricingMethod === 'per_hour') {
    if (getPrecioPorHora(config) <= 0) return false;
  } else {
    if (!config.price_per_m2 || config.price_per_m2 <= 0) return false;
  }

  // Yield is always mandatory and > 0
  if (!config.yield_m2_per_hour || config.yield_m2_per_hour <= 0) return false;

  return true;
};

// --- Palm Validation ---
export const isPalmConfigValid = (config: PalmPricingConfig | undefined): boolean => {
  if (!config) return false;
  if (!config.selected_species || config.selected_species.length === 0) return false;
  if ((config.minimum_price || 0) <= 0) return false;

  const pricingMethod = getPricingMethod(config, { allowLegacyYieldCalculation: true });
  if (pricingMethod === 'per_hour') {
    if (getPrecioPorHora(config) <= 0) return false;
  }

  const PALM_SPECIES = [
      'Phoenix canariensis', 
      'Phoenix dactylifera', 
      'Washingtonia robusta/filifera', 
      'Syagrus romanzoffiana',
      'Trachycarpus fortunei',
      'Roystonea regia'
  ];

  for (const species of config.selected_species) {
      if (pricingMethod === 'per_quantity') {
        const heightPrices = config.height_prices?.[species];
        if (!heightPrices) return false;

        if (PALM_SPECIES.includes(species as any)) {
            const heights = Object.keys(heightPrices || {});
            if (heights.length === 0) return false;
            for (const h of heights) {
                if (!heightPrices[h] || heightPrices[h] <= 0) return false;
            }
        }
      }
  }

  // Validate Yields (mandatory and > 0)
  if (!config.yield_units_per_hour) return false;
  for (const species of config.selected_species) {
    const speciesYields = config.yield_units_per_hour[species];
    if (!speciesYields) return false;
    const heights = Object.keys(config.height_prices[species] || {});
    if (heights.length === 0) return false;
    for (const h of heights) {
      if (!speciesYields[h] || speciesYields[h] <= 0) return false;
    }
  }

  // Validate Surcharges
  if (!config.condition_surcharges) return false;
  const descSurcharge = config.condition_surcharges.descuidado ?? (config.condition_surcharges as any).descuidada ?? 0;
  const muyDescSurcharge = config.condition_surcharges.muy_descuidado ?? (config.condition_surcharges as any).muy_descuidada ?? 0;
  if (descSurcharge <= 0) return false;
  if (muyDescSurcharge <= 0) return false;

  // Validate Waste Removal
  if (!config.waste_removal || (config.waste_removal.percentage || 0) <= 0) return false;

  return true;
};

// --- Hedge Validation ---
export const isHedgeConfigValid = (config: HedgePricingConfig | undefined): boolean => {
  if (!config) return false;
  if ((config.minimum_price || 0) <= 0) return false;

  const pricingMethod = config.pricing_method || 'per_quantity';
  if (pricingMethod === 'per_hour') {
    if (getPrecioPorHora(config) <= 0) return false;
  }

  const activeHeights: HedgeHeightBand[] = config.specialist_enabled
    ? ['0-2m', '2-4m', '4-6m']
    : ['0-2m', '2-4m'];

  // Yields are always mandatory and > 0
  if (!config.yield_ml_per_hour) return false;
  for (const height of activeHeights) {
    if (!config.yield_ml_per_hour[height] || config.yield_ml_per_hour[height] <= 0) return false;
  }

  if (pricingMethod === 'per_hour') return true;

  const hasMatrix = activeHeights.every((height) =>
    Number((config as any).pricing_matrix?.[height] || 0) > 0
  );
  if (hasMatrix) return true;

  const selectedCategories = config.selected_categories || [];
  const categoryHeights: Record<string, string[]> = {
    'Setos Estándar (≤3m)': ['0-1m', '>1-2m', '>2-3m'],
    'Setos Gran Altura (>3m)': ['3-4.5m', '>4.5-6m', '>6-7.5m']
  };
  const legacyLengthRanges = ['0-10m', '11-25m', '26-50m', '>50m'];

  if (selectedCategories.length > 0) {
    for (const category of selectedCategories) {
      const heights = categoryHeights[category];
      if (!heights || heights.length === 0) return false;
      for (const height of heights) {
        for (const range of legacyLengthRanges) {
          const value = Number((config as any).category_prices?.[category]?.[height]?.[range] || 0);
          if (value <= 0) return false;
        }
      }
    }
    return true;
  }

  if (!config.selected_types || config.selected_types.length === 0) return false;
  for (const type of config.selected_types) {
    const prices = config.species_prices?.[type];
    if (!prices) return false;
    if (!prices['<1m'] || prices['<1m'] <= 0) return false;
    if (!prices['1-2m'] || prices['1-2m'] <= 0) return false;
    if (!prices['>2m'] || prices['>2m'] <= 0) return false;
  }
  return true;
};

// --- Tree Validation ---
export const isTreePruningConfigValid = (config: TreePruningServiceConfig | undefined): boolean => {
  if (!config) return false;
  if ((config.minimumPrice || 0) <= 0) return false;

  const checkRequiredBands = (band: any) => {
    if (!band) return false;
    if ((band.small || 0) <= 0) return false;
    if ((band.medium || 0) <= 0) return false;
    return true;
  };

  const checkOptionalLargeBand = (band: any) => {
    if (!band) return false;
    if (band.large === undefined) return true;
    return Number(band.large) > 0;
  };

  if (!checkRequiredBands(config.formacion)) return false;
  if (!checkRequiredBands(config.estructural)) return false;
  if (!checkOptionalLargeBand(config.formacion)) return false;
  if (!checkOptionalLargeBand(config.estructural)) return false;

  // Validate yields (mandatory and > 0)
  if (!config.yield_units_per_hour) return false;
  if (!checkRequiredBands(config.yield_units_per_hour.formacion)) return false;
  if (!checkRequiredBands(config.yield_units_per_hour.estructural)) return false;
  if (!checkOptionalLargeBand(config.yield_units_per_hour.formacion)) return false;
  if (!checkOptionalLargeBand(config.yield_units_per_hour.estructural)) return false;

  const supportsLargeFormation = Number(config.formacion.large || 0) > 0;
  const supportsLargeStructural = Number(config.estructural.large || 0) > 0;
  if (supportsLargeFormation !== (Number(config.yield_units_per_hour.formacion.large || 0) > 0)) return false;
  if (supportsLargeStructural !== (Number(config.yield_units_per_hour.estructural.large || 0) > 0)) return false;

  if ((config.difficultyIncrease || 0) <= 0) return false;
  if ((config.wasteRemovalMultiplier || 0) <= 0) return false;

  return true;
};

// --- Shrub Validation ---
export const isShrubConfigValid = (config: ShrubPricingConfig | undefined): boolean => {
  if (!config) return false;
  if ((config.minimum_price || 0) <= 0) return false;

  const pricingMethod = config.pricing_method || 'per_quantity';
  if (pricingMethod === 'per_hour') {
    if (getPrecioPorHora(config) <= 0) return false;
  } else {
    if (!config.prices_per_m2) return false;
    const { pequeñas, medianas, grandes } = config.prices_per_m2;
    if (!pequeñas || pequeñas <= 0) return false;
    if (!medianas || medianas <= 0) return false;
    if (!grandes || grandes <= 0) return false;
  }

  // Validate yields (mandatory and > 0)
  if (!config.yield_m2_per_hour) return false;
  if (!config.yield_m2_per_hour.pequeñas || config.yield_m2_per_hour.pequeñas <= 0) return false;
  if (!config.yield_m2_per_hour.medianas || config.yield_m2_per_hour.medianas <= 0) return false;
  if (!config.yield_m2_per_hour.grandes || config.yield_m2_per_hour.grandes <= 0) return false;

  return true;
};

// --- Weeding Validation ---
export const WEEDING_STATES = ['normal', 'dificultad_media', 'dificultad_alta'] as const;
export type WeedingState = typeof WEEDING_STATES[number];

export const weedingV1Schema = z.object({
  version: z.literal('weeding_v1'),
  importe_minimo: z.number().nonnegative().min(1),
  precio_desbroce_m2: z.number().nonnegative(),
  precio_herbicida_m2: z.number().nonnegative().optional(),
  suplementos: z.object({
    dificultad_media: z.number().nonnegative(),
    dificultad_alta: z.number().nonnegative(),
    retirada_restos: z.number().nonnegative(),
  }),
  yield_m2_per_hour: z.number().positive()
});

export const isWeedingConfigValid = (config: WeedingPricingConfig | undefined): boolean => {
  if (!config) return false;
  const parsed = weedingV1Schema.safeParse(config);
  return parsed.success;
};

// --- Phytosanitary Validation ---
export const isPhytosanitaryConfigValid = (config: PhytosanitaryPricingConfig | undefined): boolean => {
  if (!config) return false;
  const persisted = toPersistedPhytosanitaryConfig(normalizePhytosanitaryPricingConfig(config));
  const parsedV2 = normalizePhytosanitaryConfig(persisted);
  if (parsedV2 && parsedV2.version === 'phytosanitary_v2') {
    if (Number(parsedV2.importe_minimo || 0) <= 0) return false;
    if (!parsedV2.tratamientos_activos || parsedV2.tratamientos_activos.length === 0) return false;

    const pricingMethod = parsedV2.pricing_method || 'per_quantity';
    if (pricingMethod === 'per_hour') {
      if (getPrecioPorHora(parsedV2) <= 0) return false;
    }

    if (pricingMethod === 'per_quantity') {
      const baseTreatments: PhytosanitaryBaseTreatment[] = ['insecticida', 'fungicida', 'ecologico_preventivo'];
      for (const t of baseTreatments) {
        if (parsedV2.tratamientos_activos.includes(t)) {
          if (Number(parsedV2.superficies_plantas.hasta_100m2[t] || 0) <= 0) return false;
          if (Number(parsedV2.superficies_plantas.mas_de_100m2[t] || 0) <= 0) return false;
          if (Number(parsedV2.setos.hasta_2m[t as PhytosanitaryWithoutHerbicide] || 0) <= 0) return false;
          if (Number(parsedV2.setos.mas_de_2m[t as PhytosanitaryWithoutHerbicide] || 0) <= 0) return false;
          if (Number(parsedV2.arboles.hasta_3m[t as PhytosanitaryWithoutHerbicide] || 0) <= 0) return false;
          if (Number(parsedV2.arboles.mas_de_3m[t as PhytosanitaryWithoutHerbicide] || 0) <= 0) return false;
        }
      }
      if (parsedV2.tratamientos_activos.includes('endoterapia') && Number(parsedV2.palmeras.endoterapia.precio_unico || 0) <= 0) {
        return false;
      }
      if (Number(parsedV2.palmeras.tradicional.hasta_3m || 0) <= 0) return false;
      if (Number(parsedV2.palmeras.tradicional.mas_de_3m || 0) <= 0) return false;
    }

    // Validate yields (mandatory and > 0)
    if (!parsedV2.yields) return false;
    if (parsedV2.yields.cesped_m2_per_hour <= 0) return false;
    if (parsedV2.yields.setos_ml_per_hour <= 0) return false;
    if (parsedV2.yields.palmeras_units_per_hour <= 0) return false;
    if (parsedV2.yields.arboles_units_per_hour <= 0) return false;
    if (parsedV2.yields.plantas_m2_per_hour <= 0) return false;
    if (parsedV2.yields.endoterapia_units_per_hour <= 0) return false;

    return true;
  }
  if (!config.selected_types || config.selected_types.length === 0) return false;
  if ((config.minimum_price || 0) <= 0) return false;
  const typePrices = config.type_prices;
  if (!typePrices) return false;

  for (const type of config.selected_types) {
    const prices = typePrices[type];
    if (!prices) return false;
    // Ranges: 0-50, 50-200, 200+
    if (!prices['0-50'] || prices['0-50'] <= 0) return false;
    if (!prices['50-200'] || prices['50-200'] <= 0) return false;
    if (!prices['200+'] || prices['200+'] <= 0) return false;
  }
  return true;
};
