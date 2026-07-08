/**
 * Manual Entry Schema (isomorphic)
 * -------------------------------------------------------------
 * Declarative description of the "introduce los datos manualmente" survey for
 * each of the 7 canonical services. This is the SINGLE SOURCE OF TRUTH for:
 *   - the wizard UI (fields, order, microcopy, control type)
 *   - client-side validation (immediate UX feedback)
 *   - server-side validation (authoritative range/enum enforcement)
 *
 * It deliberately contains NO React / DOM / Supabase imports so it can be
 * imported both by the browser wizard and by the `booking-authority` Deno edge
 * function (mirrors how `bookingQuoteCore.ts` is shared).
 *
 * The field `key`s map 1:1 to the variables identified in the technical audit
 * and feed the same engine (`buildAuthoritativeBookingQuote`) as the AI path,
 * so the data origin (AI vs manual) is indistinguishable downstream.
 *
 * To add an 8th service: add a `ManualServiceKey`, an entry in
 * `MANUAL_ENTRY_SURVEYS`, a branch in `manualEntryBuilders.ts`, a branch in
 * `validateManualBookingInput`, and a unit test. Nothing else.
 */

export type ManualServiceKey =
  | 'lawn'
  | 'hedge'
  | 'tree'
  | 'palm'
  | 'shrub'
  | 'phytosanitary'
  | 'weeding';

export const MANUAL_SERVICE_KEYS: ManualServiceKey[] = [
  'lawn',
  'hedge',
  'tree',
  'palm',
  'shrub',
  'phytosanitary',
  'weeding',
];

/**
 * Services that NEVER used photo/AI analysis — their booking flow is manual by
 * nature. For these, the "photos vs manual" chooser is meaningless and must NOT
 * be shown; their existing manual form is used directly.
 */
export const MANUAL_ONLY_SERVICE_KEYS: ManualServiceKey[] = ['weeding'];

export function isManualOnlyService(key: ManualServiceKey | null | undefined): boolean {
  return !!key && MANUAL_ONLY_SERVICE_KEYS.includes(key);
}

export type ManualFieldType = 'integer' | 'number' | 'enum' | 'boolean';
export type ManualFieldUi = 'stepper' | 'slider' | 'cards' | 'toggle';

export type ManualFieldValue = number | string | boolean | undefined;
export type ManualAnswers = Record<string, ManualFieldValue>;

export interface ManualEnumOption {
  value: string;
  label: string;
  /** One-line plain-language clarification (tooltip / helper text). */
  help?: string;
  /** Lucide icon name rendered on the choice card. */
  icon?: string;
}

export interface ManualFieldDef {
  key: string;
  type: ManualFieldType;
  ui: ManualFieldUi;
  label: string;
  /** Plain-language explanation of what this term means in this business. */
  help?: string;
  /** Concrete size reference / example for numeric fields. */
  example?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Static categorical options. */
  options?: ManualEnumOption[];
  /** Categorical options that depend on previous answers (e.g. palm height by species). */
  dynamicOptions?: (answers: ManualAnswers) => ManualEnumOption[];
  defaultValue?: ManualFieldValue;
  /** When false for the current answers, the field is skipped and not required. */
  visibleWhen?: (answers: ManualAnswers) => boolean;
  /** Marks the field optional (booleans/toggles are always optional). */
  optional?: boolean;
}

export interface ManualStep {
  id: string;
  title: string;
  description?: string;
  fields: ManualFieldDef[];
}

export interface ManualServiceSurvey {
  serviceKey: ManualServiceKey;
  /** Human label of the canonical service this survey maps to. */
  serviceLabel: string;
  /** Whether the client can declare several distinct items (e.g. palm groups). */
  repeatable: boolean;
  /** Label for the "add another" action when repeatable. */
  addItemLabel?: string;
  /** Singular noun for an item (used in summaries). */
  itemNoun: string;
  steps: ManualStep[];
}

/* -------------------------------------------------------------------------- */
/* Shared option sets                                                          */
/* -------------------------------------------------------------------------- */

const GARDEN_STATE_OPTIONS: ManualEnumOption[] = [
  {
    value: 'normal',
    label: 'Normal',
    help: 'Mantenido, con bordes definidos y altura baja.',
    icon: 'Sprout',
  },
  {
    value: 'descuidado',
    label: 'Descuidado',
    help: 'Crecimiento desigual, bordes invadidos, falta de mantenimiento reciente.',
    icon: 'Wheat',
  },
  {
    value: 'muy descuidado',
    label: 'Muy descuidado',
    help: 'Crecimiento fuerte, sin bordes definidos, requiere trabajo previo intenso.',
    icon: 'Trees',
  },
];

const HEDGE_STATE_OPTIONS: ManualEnumOption[] = [
  {
    value: 'normal',
    label: 'Normal',
    help: 'Seto mantenido, recorte ligero de mantenimiento.',
    icon: 'Sprout',
  },
  {
    value: 'media',
    label: 'Dificultad media',
    help: 'Crecimiento notable o irregular; requiere más pasadas.',
    icon: 'Wheat',
  },
  {
    value: 'alta',
    label: 'Dificultad alta',
    help: 'Muy crecido o leñoso; recorte severo o de reformado.',
    icon: 'Trees',
  },
];

const WEEDING_STATE_OPTIONS: ManualEnumOption[] = [
  {
    value: 'normal',
    label: 'Dificultad normal',
    help: 'Terreno regular, maleza ligera (< 30 cm) y sin obstáculos relevantes.',
    icon: 'Sprout',
  },
  {
    value: 'dificultad_media',
    label: 'Dificultad media',
    help: 'Pendiente, terreno irregular o maleza herbácea densa (> 30 cm).',
    icon: 'Wheat',
  },
  {
    value: 'dificultad_alta',
    label: 'Dificultad alta',
    help: 'Difícil acceso, maleza leñosa/zarzas o presencia de piedras/escombros.',
    icon: 'Trees',
  },
];

const SHRUB_SIZE_OPTIONS: ManualEnumOption[] = [
  {
    value: 'pequeñas',
    label: 'Pequeñas',
    help: 'Plantas bajas y arbustos compactos, por debajo de la rodilla.',
    icon: 'Sprout',
  },
  {
    value: 'medianas',
    label: 'Medianas',
    help: 'Arbustos hasta aproximadamente la cintura o el pecho.',
    icon: 'Shrub',
  },
  {
    value: 'grandes',
    label: 'Grandes',
    help: 'Masas voluminosas o arbustos por encima de la cabeza.',
    icon: 'TreePine',
  },
];

const SHRUB_STATE_OPTIONS: ManualEnumOption[] = [
  {
    value: 'normal',
    label: 'Normal',
    help: 'Formas definidas, brotes cortos y sin madera seca visible.',
    icon: 'Sprout',
  },
  {
    value: 'descuidado',
    label: 'Descuidadas',
    help: 'Brotes largos e irregulares, bordes invadiendo caminos o césped.',
    icon: 'Wheat',
  },
  {
    value: 'muy descuidado',
    label: 'Muy descuidadas',
    help: 'Formas perdidas, madera seca visible o invasión de malas hierbas.',
    icon: 'Trees',
  },
];

const TREE_SIZE_OPTIONS: ManualEnumOption[] = [
  { value: 'small', label: 'Pequeño (0-3 m)', help: 'Hasta la altura de una planta baja o puerta.', icon: 'Sprout' },
  { value: 'medium', label: 'Mediano (3-5 m)', help: 'Aproximadamente la altura de una planta de un edificio.', icon: 'TreeDeciduous' },
  { value: 'large', label: 'Grande (5-9 m)', help: 'Claramente por encima de un tejado de planta baja.', icon: 'TreePine' },
  { value: 'over_9', label: 'Muy grande (> 9 m)', help: 'Árbol de gran porte, requiere medios especiales.', icon: 'Trees' },
];

const TREE_PRUNING_TYPE_OPTIONS: ManualEnumOption[] = [
  {
    value: 'structural',
    label: 'Poda estructural',
    help: 'Reducción o saneamiento de ramas principales para la salud y seguridad del árbol.',
    icon: 'Axe',
  },
  {
    value: 'shaping',
    label: 'Poda de formación',
    help: 'Mantenimiento estético y de forma, sin intervención estructural.',
    icon: 'Scissors',
  },
];

export const PALM_SPECIES_OPTIONS: ManualEnumOption[] = [
  { value: 'Phoenix canariensis', label: 'Phoenix canariensis', help: 'Palmera canaria, copa muy densa y redondeada.', icon: 'Palmtree' },
  { value: 'Phoenix dactylifera', label: 'Phoenix dactylifera', help: 'Palmera datilera, tronco esbelto y alto.', icon: 'Palmtree' },
  { value: 'Washingtonia robusta/filifera', label: 'Washingtonia', help: 'Tronco muy alto y fino, copa pequeña.', icon: 'Palmtree' },
  { value: 'Syagrus romanzoffiana', label: 'Syagrus romanzoffiana', help: 'Palmera pindó, hojas plumosas y arqueadas.', icon: 'Palmtree' },
  { value: 'Trachycarpus fortunei', label: 'Trachycarpus fortunei', help: 'Palmera de molino, baja y resistente.', icon: 'Palmtree' },
  { value: 'Roystonea regia', label: 'Roystonea regia', help: 'Palmera real, tronco liso y abultado.', icon: 'Palmtree' },
];

const PALM_STATE_OPTIONS: ManualEnumOption[] = [
  { value: 'normal', label: 'Normal', help: 'Mantenida, con pocas hojas secas.', icon: 'Sprout' },
  { value: 'descuidado', label: 'Descuidada', help: 'Bastante hoja seca acumulada; lleva tiempo sin podarse.', icon: 'Wheat' },
  { value: 'muy descuidado', label: 'Muy descuidada', help: 'Faldón de hojas secas grande o tronco muy cargado.', icon: 'Trees' },
];

/**
 * Canonical palm height buckets per species (mirror of `SPECIES_RANGES` used by
 * the pricing engine and the AI normalizer). The bucket string is what the
 * engine consumes directly (`findPalmPrice` normalizes the `m` suffix).
 */
export const PALM_HEIGHT_RANGES_BY_SPECIES: Record<string, string[]> = {
  'Phoenix canariensis': ['0-4m', '4-10m', '>10m'],
  'Phoenix dactylifera': ['0-5m', '5-10m', '10-15m', '>15m'],
  'Washingtonia robusta/filifera': ['0-4m', '4-12m', '12-20m', '>20m'],
  'Syagrus romanzoffiana': ['0-5m', '5-10m', '>10m'],
  'Trachycarpus fortunei': ['0-3m', '3-6m', '>6m'],
  'Roystonea regia': ['0-6m', '>6m'],
};

const DEFAULT_PALM_HEIGHT_RANGES = ['0-5m', '5-12m', '12-20m', '20m+'];

export function getPalmHeightRanges(species?: string): string[] {
  if (!species) return DEFAULT_PALM_HEIGHT_RANGES;
  return PALM_HEIGHT_RANGES_BY_SPECIES[species] || DEFAULT_PALM_HEIGHT_RANGES;
}

const palmHeightOptions = (answers: ManualAnswers): ManualEnumOption[] => {
  const species = typeof answers.species === 'string' ? answers.species : undefined;
  return getPalmHeightRanges(species).map((range) => ({
    value: range,
    label: range.replace('m', ' m').replace('>', 'Más de ').trim(),
    help: range.includes('>')
      ? 'Tramo más alto: el precio puede ajustarse tras la visita del profesional.'
      : undefined,
    icon: 'Ruler',
  }));
};

const PHYTOSANITARY_AFFECTED_OPTIONS: ManualEnumOption[] = [
  { value: 'Césped', label: 'Césped', help: 'Superficie de césped a tratar.', icon: 'Sprout' },
  { value: 'Plantas bajas', label: 'Plantas y arbustos', help: 'Macizos de plantas bajas y arbustos.', icon: 'Flower2' },
  { value: 'Setos', label: 'Setos', help: 'Setos lineales a tratar.', icon: 'Shrub' },
  { value: 'Árboles', label: 'Árboles', help: 'Árboles individuales a tratar.', icon: 'Trees' },
  { value: 'Palmeras', label: 'Palmeras', help: 'Palmeras a tratar.', icon: 'Palmtree' },
];

const PHYTOSANITARY_INTENT_OPTIONS: ManualEnumOption[] = [
  { value: 'preventive', label: 'Preventivo', help: 'Tratamiento de prevención, sin plaga visible declarada.', icon: 'ShieldCheck' },
  { value: 'curative', label: 'Curativo', help: 'Hay una plaga o enfermedad que quieres tratar.', icon: 'Bug' },
];

const PHYTOSANITARY_TARGET_OPTIONS: ManualEnumOption[] = [
  { value: 'insects', label: 'Insectos / plagas', help: 'Tratamiento insecticida.', icon: 'Bug' },
  { value: 'fungus', label: 'Hongos / enfermedad', help: 'Tratamiento fungicida.', icon: 'Microscope' },
  { value: 'both', label: 'Ambos', help: 'Insecticida y fungicida combinados.', icon: 'SprayCan' },
];

const PHYTOSANITARY_PRODUCT_OPTIONS: ManualEnumOption[] = [
  { value: 'chemical', label: 'Convencional', help: 'Producto fitosanitario estándar.', icon: 'FlaskConical' },
  { value: 'ecological', label: 'Ecológico', help: 'Producto de origen ecológico (puede tener recargo).', icon: 'Leaf' },
];

/* -------------------------------------------------------------------------- */
/* Range constants (authoritative — enforced client AND server)               */
/* -------------------------------------------------------------------------- */

export const MANUAL_RANGES = {
  lawn: { superficie_m2: { min: 1, max: 5000 } },
  hedge: { longitud_m: { min: 1, max: 500 }, altura_m: { min: 0.3, max: 6 }, caras: { min: 1, max: 2 } },
  palm: { altura_m: { min: 0.5, max: 25 }, quantity: { min: 1, max: 50 } },
  shrub: { superficie_m2: { min: 1, max: 2000 } },
  phytosanitary: { area: { min: 1, max: 5000 } },
  weeding: { area: { min: 1, max: 10000 } },
} as const;

/* -------------------------------------------------------------------------- */
/* Surveys                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Global field rendered once at the end of every survey (not per item).
 * Maps to the top-level `bookingData.wasteRemoval` flag.
 */
export const MANUAL_GLOBAL_WASTE_FIELD: ManualFieldDef = {
  key: 'wasteRemoval',
  type: 'boolean',
  ui: 'toggle',
  label: 'Retirada de restos',
  help: 'Si lo desactivas, deberás hacerte cargo de los residuos generados durante el servicio.',
  defaultValue: true,
  optional: true,
};

export const MANUAL_GLOBAL_WASTE_STEP: ManualStep = {
  id: 'global-waste',
  title: '¿Quieres que retiremos los restos?',
  description: 'Se aplica a todo el servicio.',
  fields: [MANUAL_GLOBAL_WASTE_FIELD],
};

export const MANUAL_ENTRY_SURVEYS: Record<ManualServiceKey, ManualServiceSurvey> = {
  lawn: {
    serviceKey: 'lawn',
    serviceLabel: 'Corte de césped',
    repeatable: false,
    itemNoun: 'zona de césped',
    steps: [
      {
        id: 'surface',
        title: '¿Cuántos metros cuadrados de césped hay?',
        description: 'Introduce una superficie aproximada. No te preocupes por ser exacto al metro.',
        fields: [
          {
            key: 'superficie_m2',
            type: 'number',
            ui: 'slider',
            label: 'Superficie de césped',
            unit: 'm²',
            min: MANUAL_RANGES.lawn.superficie_m2.min,
            max: MANUAL_RANGES.lawn.superficie_m2.max,
            step: 1,
            help: 'La superficie total de césped que quieres cortar.',
            example: 'Una plaza de garaje son unos 12 m². Una pista de pádel, unos 200 m².',
          },
        ],
      },
      {
        id: 'state',
        title: '¿En qué estado está el césped?',
        fields: [
          {
            key: 'estado_jardin',
            type: 'enum',
            ui: 'cards',
            label: 'Estado del césped',
            options: GARDEN_STATE_OPTIONS,
          },
        ],
      },
    ],
  },

  hedge: {
    serviceKey: 'hedge',
    serviceLabel: 'Poda de setos',
    repeatable: false,
    itemNoun: 'seto',
    steps: [
      {
        id: 'length',
        title: '¿Qué longitud tiene el seto?',
        description: 'La longitud total a lo largo del seto, sumando los tramos si hace esquinas.',
        fields: [
          {
            key: 'longitud_m',
            type: 'number',
            ui: 'slider',
            label: 'Longitud del seto',
            unit: 'm',
            min: MANUAL_RANGES.hedge.longitud_m.min,
            max: MANUAL_RANGES.hedge.longitud_m.max,
            step: 1,
            example: 'Un coche mide unos 4,5 m de largo.',
          },
        ],
      },
      {
        id: 'height',
        title: '¿Qué altura tiene el seto?',
        description: 'Mide desde el suelo hasta lo más alto, incluyendo muros o estructuras que el profesional deba alcanzar.',
        fields: [
          {
            key: 'altura_m',
            type: 'number',
            ui: 'stepper',
            label: 'Altura del seto',
            unit: 'm',
            min: MANUAL_RANGES.hedge.altura_m.min,
            max: MANUAL_RANGES.hedge.altura_m.max,
            step: 0.5,
            example: 'Una puerta estándar mide unos 2 m.',
          },
        ],
      },
      {
        id: 'faces',
        title: '¿Cuántas caras hay que recortar?',
        fields: [
          {
            key: 'caras',
            type: 'enum',
            ui: 'cards',
            label: 'Caras a recortar',
            options: [
              { value: '1', label: 'Solo una cara', help: 'El seto está pegado a una pared o linda con otra propiedad.', icon: 'Square' },
              { value: '2', label: 'Las dos caras', help: 'Se puede acceder y recortar por ambos lados.', icon: 'Columns2' },
            ],
          },
        ],
      },
      {
        id: 'state',
        title: '¿En qué estado está el seto?',
        fields: [{ key: 'estado_seto', type: 'enum', ui: 'cards', label: 'Estado del seto', options: HEDGE_STATE_OPTIONS }],
      },
    ],
  },

  tree: {
    serviceKey: 'tree',
    serviceLabel: 'Poda de árboles',
    repeatable: true,
    addItemLabel: 'Añadir otro árbol',
    itemNoun: 'árbol',
    steps: [
      {
        id: 'size',
        title: '¿Qué tamaño tiene el árbol?',
        description: 'Elige el tramo de altura que más se aproxime.',
        fields: [{ key: 'aiSizeBand', type: 'enum', ui: 'cards', label: 'Tamaño del árbol', options: TREE_SIZE_OPTIONS }],
      },
      {
        id: 'pruning_type',
        title: '¿Qué tipo de poda necesitas?',
        fields: [{ key: 'pruningType', type: 'enum', ui: 'cards', label: 'Tipo de poda', options: TREE_PRUNING_TYPE_OPTIONS }],
      },
      {
        id: 'access',
        title: '¿El acceso al árbol es complicado?',
        description: 'Por ejemplo, cercano a cables, en pendiente, o de difícil acceso para una escalera o plataforma.',
        fields: [
          {
            key: 'difficultyHigh',
            type: 'boolean',
            ui: 'cards',
            label: 'Dificultad de acceso',
            options: [
              { value: 'false', label: 'Acceso normal', help: 'Se puede trabajar con normalidad alrededor del árbol.', icon: 'Check' },
              { value: 'true', label: 'Acceso difícil', help: 'Cercano a cables, en pendiente o con obstáculos importantes.', icon: 'AlertTriangle' },
            ],
          },
        ],
      },
    ],
  },

  palm: {
    serviceKey: 'palm',
    serviceLabel: 'Poda de palmeras',
    repeatable: true,
    addItemLabel: 'Añadir palmeras de otro tipo',
    itemNoun: 'grupo de palmeras',
    steps: [
      {
        id: 'species',
        title: '¿Qué especie de palmera es?',
        description: 'Si no estás seguro, elige la que más se parezca.',
        fields: [{ key: 'species', type: 'enum', ui: 'cards', label: 'Especie', options: PALM_SPECIES_OPTIONS }],
      },
      {
        id: 'height',
        title: '¿Qué altura tiene el tronco?',
        description: 'Mide solo el tronco, hasta donde empiezan las hojas.',
        fields: [{ key: 'height', type: 'enum', ui: 'cards', label: 'Altura del tronco', dynamicOptions: palmHeightOptions }],
      },
      {
        id: 'state',
        title: '¿En qué estado está?',
        fields: [{ key: 'state', type: 'enum', ui: 'cards', label: 'Estado', options: PALM_STATE_OPTIONS }],
      },
      {
        id: 'quantity',
        title: '¿Cuántas palmeras de este tipo hay?',
        fields: [
          {
            key: 'quantity',
            type: 'integer',
            ui: 'stepper',
            label: 'Número de palmeras',
            unit: 'ud',
            min: MANUAL_RANGES.palm.quantity.min,
            max: MANUAL_RANGES.palm.quantity.max,
            step: 1,
            defaultValue: 1,
          },
        ],
      },
      {
        id: 'extras',
        title: 'Opciones adicionales',
        description: 'Selecciona solo lo que necesites. Si no estás seguro, déjalo desactivado.',
        fields: [
          {
            key: 'hasPhytosanitary',
            type: 'boolean',
            ui: 'toggle',
            label: 'Tratamiento fitosanitario',
            help: 'Aplicación preventiva contra plagas (no disponible en todas las especies).',
            optional: true,
            visibleWhen: (answers) => speciesSupportsPhytosanitary(answers.species),
          },
          {
            key: 'hasTrunkPeeling',
            type: 'boolean',
            ui: 'toggle',
            label: 'Limpieza / pelado de tronco',
            help: 'Acabado estético del tronco (no disponible en todas las especies).',
            optional: true,
            visibleWhen: (answers) => speciesSupportsTrunkPeeling(answers.species),
          },
          {
            key: 'hasAccessDifficulty',
            type: 'boolean',
            ui: 'toggle',
            label: 'Acceso difícil',
            help: 'Cercana a cables, en pendiente o de difícil acceso.',
            optional: true,
          },
        ],
      },
    ],
  },

  shrub: {
    serviceKey: 'shrub',
    serviceLabel: 'Poda de plantas y arbustos',
    repeatable: false,
    itemNoun: 'zona de arbustos',
    steps: [
      {
        id: 'surface',
        title: '¿Qué superficie ocupan las plantas y arbustos?',
        description: 'La superficie aproximada del macizo o conjunto de plantas a podar.',
        fields: [
          {
            key: 'superficie_m2',
            type: 'number',
            ui: 'slider',
            label: 'Superficie de plantas y arbustos',
            unit: 'm²',
            min: MANUAL_RANGES.shrub.superficie_m2.min,
            max: MANUAL_RANGES.shrub.superficie_m2.max,
            step: 1,
            example: 'Un macizo del tamaño de una cama de matrimonio son unos 3 m².',
          },
        ],
      },
      {
        id: 'size',
        title: '¿De qué tamaño son las plantas predominantes?',
        fields: [{ key: 'tamano_dominante', type: 'enum', ui: 'cards', label: 'Tamaño dominante', options: SHRUB_SIZE_OPTIONS }],
      },
      {
        id: 'state',
        title: '¿En qué estado están las plantas?',
        fields: [{ key: 'estado_plantas', type: 'enum', ui: 'cards', label: 'Estado de las plantas', options: SHRUB_STATE_OPTIONS }],
      },
    ],
  },

  phytosanitary: {
    serviceKey: 'phytosanitary',
    serviceLabel: 'Servicios fitosanitarios',
    repeatable: true,
    addItemLabel: 'Añadir otra zona a tratar',
    itemNoun: 'zona de tratamiento',
    steps: [
      {
        id: 'affected',
        title: '¿Qué quieres tratar?',
        fields: [{ key: 'affectedType', type: 'enum', ui: 'cards', label: 'Tipo de vegetación', options: PHYTOSANITARY_AFFECTED_OPTIONS }],
      },
      {
        id: 'area',
        title: '¿Qué cantidad aproximada hay que tratar?',
        description: 'Superficie en m² (césped, plantas), longitud en metros (setos) o número de ejemplares (árboles, palmeras).',
        fields: [
          {
            key: 'area',
            type: 'number',
            ui: 'stepper',
            label: 'Cantidad a tratar',
            min: MANUAL_RANGES.phytosanitary.area.min,
            max: MANUAL_RANGES.phytosanitary.area.max,
            step: 1,
          },
        ],
      },
      {
        id: 'intent',
        title: '¿Es un tratamiento preventivo o curativo?',
        fields: [{ key: 'intent', type: 'enum', ui: 'cards', label: 'Intención del tratamiento', options: PHYTOSANITARY_INTENT_OPTIONS }],
      },
      {
        id: 'target',
        title: '¿Qué quieres combatir?',
        fields: [
          {
            key: 'curativeTarget',
            type: 'enum',
            ui: 'cards',
            label: 'Objetivo del tratamiento',
            options: PHYTOSANITARY_TARGET_OPTIONS,
            visibleWhen: (answers) => answers.intent === 'curative',
          },
        ],
      },
      {
        id: 'product',
        title: '¿Prefieres producto convencional o ecológico?',
        fields: [{ key: 'productPreference', type: 'enum', ui: 'cards', label: 'Tipo de producto', options: PHYTOSANITARY_PRODUCT_OPTIONS }],
      },
      {
        id: 'height',
        title: '¿Supera los 2-3 metros de altura?',
        description: 'Importante para setos altos, árboles y palmeras grandes.',
        fields: [
          {
            key: 'aboveThreeMeters',
            type: 'boolean',
            ui: 'toggle',
            label: 'Supera los 2-3 m de altura',
            optional: true,
            visibleWhen: (answers) =>
              answers.affectedType === 'Setos' || answers.affectedType === 'Árboles' || answers.affectedType === 'Palmeras',
          },
        ],
      },
    ],
  },

  weeding: {
    serviceKey: 'weeding',
    serviceLabel: 'Desbroce de malas hierbas',
    repeatable: false,
    itemNoun: 'parcela',
    steps: [
      {
        id: 'area',
        title: '¿Qué superficie hay que desbrozar?',
        fields: [
          {
            key: 'area',
            type: 'number',
            ui: 'slider',
            label: 'Superficie a desbrozar',
            unit: 'm²',
            min: MANUAL_RANGES.weeding.area.min,
            max: MANUAL_RANGES.weeding.area.max,
            step: 1,
            example: 'Una parcela urbana pequeña ronda los 200-400 m².',
          },
        ],
      },
      {
        id: 'state',
        title: '¿Qué dificultad tiene el terreno?',
        fields: [{ key: 'state', type: 'enum', ui: 'cards', label: 'Dificultad del desbroce', options: WEEDING_STATE_OPTIONS }],
      },
      {
        id: 'herbicide',
        title: '¿Quieres aplicar herbicida?',
        fields: [
          {
            key: 'applyHerbicide',
            type: 'boolean',
            ui: 'toggle',
            label: 'Aplicar herbicida',
            help: 'Aplicación de herbicida sobre la superficie desbrozada (servicio adicional).',
            optional: true,
          },
        ],
      },
    ],
  },
};

/* -------------------------------------------------------------------------- */
/* Service resolution                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a free-form service name to a manual survey key.
 * Mirrors the matching logic in `getDetailsServiceFlags` so the manual flow and
 * the photo flow agree on which service a booking belongs to.
 */
export function resolveManualServiceKey(serviceName?: string | null): ManualServiceKey | null {
  const normalized = String(serviceName || '').trim().toLowerCase();
  if (!normalized) return null;

  const isTree = normalized.includes('arbol') || normalized.includes('árbol');
  const isPalm = normalized.includes('palmera');

  if (normalized.includes('cesped') || normalized.includes('césped')) return 'lawn';
  if (normalized.includes('seto')) return 'hedge';
  if (isPalm) return 'palm';
  if (isTree) return 'tree';
  if (normalized.includes('fitosanit')) return 'phytosanitary';
  if (normalized.includes('desbroce') || normalized.includes('malas hierbas')) return 'weeding';
  if (normalized.includes('poda de plantas') || normalized.includes('arbusto')) return 'shrub';
  if (normalized.includes('poda')) return 'shrub';
  return null;
}

export function getManualSurvey(serviceName?: string | null): ManualServiceSurvey | null {
  const key = resolveManualServiceKey(serviceName);
  return key ? MANUAL_ENTRY_SURVEYS[key] : null;
}

/* -------------------------------------------------------------------------- */
/* Species capability helpers (kept dependency-free for isomorphism)           */
/* -------------------------------------------------------------------------- */

const SPECIES_PHYTOSANITARY: Record<string, boolean> = {
  'Phoenix canariensis': true,
  'Phoenix dactylifera': true,
  'Washingtonia robusta/filifera': true,
  'Syagrus romanzoffiana': false,
  'Trachycarpus fortunei': true,
  'Roystonea regia': false,
};

const SPECIES_TRUNK_PEELING: Record<string, boolean> = {
  'Phoenix canariensis': true,
  'Phoenix dactylifera': true,
  'Washingtonia robusta/filifera': true,
  'Syagrus romanzoffiana': false,
  'Trachycarpus fortunei': false,
  'Roystonea regia': false,
};

export function speciesSupportsPhytosanitary(species: ManualFieldValue): boolean {
  if (typeof species !== 'string') return true;
  return SPECIES_PHYTOSANITARY[species] ?? true;
}

export function speciesSupportsTrunkPeeling(species: ManualFieldValue): boolean {
  if (typeof species !== 'string') return true;
  return SPECIES_TRUNK_PEELING[species] ?? true;
}

/** Visible (not skipped) fields of a step given current answers. */
export function getVisibleFields(step: ManualStep, answers: ManualAnswers): ManualFieldDef[] {
  return step.fields.filter((field) => (field.visibleWhen ? field.visibleWhen(answers) : true));
}

/** Resolve the option list of a field given current answers. */
export function getFieldOptions(field: ManualFieldDef, answers: ManualAnswers): ManualEnumOption[] {
  if (field.dynamicOptions) return field.dynamicOptions(answers);
  return field.options || [];
}
