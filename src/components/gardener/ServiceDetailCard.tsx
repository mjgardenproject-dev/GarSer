import React from 'react';
import { Clock, Camera, PenLine } from 'lucide-react';
import type { BookingServiceInput } from '../../utils/bookingServiceDetails';

// Tarjeta "Detalle del servicio" compartida entre solicitudes pendientes
// (BookingRequestsManager) y reservas confirmadas (GardenerBookings).
// Renderiza, por tipo de servicio, las variables que definen el trabajo —
// tanto de reservas por fotos (análisis IA) como de declaración manual.

const FIELD_LABELS: Record<string, string> = {
  quantity: 'Cantidad',
  area: 'Superficie',
  length: 'Longitud',
  faces: 'Caras',
  faces_to_trim: 'Caras a podar',
  state: 'Estado',
  size: 'Tamaño',
  aiSizeBand: 'Tamaño',
  species: 'Especie',
  height: 'Altura',
  type: 'Tipo',
  pruningType: 'Tipo de poda',
  intent: 'Objetivo',
  curativeTarget: 'Plaga',
  productPreference: 'Producto',
};

const FIELD_UNITS: Record<string, string> = { area: ' m²', length: ' m' };
// `quantity` es m² en césped pero unidades en árboles/palmeras: la unidad la decide la sección
const QUANTITY_UNIT_BY_SECTION: Record<string, string> = {
  lawnZones: ' m²',
  treeGroups: ' ud',
  palmGroups: ' ud',
};

const BOOL_LABELS: Record<string, string> = {
  difficultyHigh: 'Dificultad alta',
  dificultad_alta: 'Dificultad alta',
  applyHerbicide: 'Con herbicida',
  hasPhytosanitary: 'Tratamiento fitosanitario',
  hasTrunkPeeling: 'Pelado de tronco',
  hasAccessDifficulty: 'Acceso difícil',
  aboveTwoMeters: 'Altura > 2 m',
  aboveThreeMeters: 'Altura > 3 m',
};

const VALUE_LABELS: Record<string, string> = {
  small: 'Pequeño', medium: 'Mediano', large: 'Grande', over_9: 'Muy grande (>9 m)',
  'pequeñas': 'Pequeñas', medianas: 'Medianas', grandes: 'Grandes', pequenas: 'Pequeñas',
  estructural: 'Poda estructural', formacion: 'Poda de formación',
  normal: 'Normal', descuidado: 'Descuidado', 'muy descuidado': 'Muy descuidado',
  descuidada: 'Descuidada', 'muy descuidada': 'Muy descuidada',
  media: 'Dificultad media', alta: 'Dificultad alta',
  preventive: 'Preventivo', curative: 'Curativo', weed_control: 'Herbicida',
  insects: 'Insectos', fungus: 'Hongos', both: 'Insectos y hongos',
  chemical: 'Químico', ecological: 'Ecológico',
};

// Métricas del análisis fitosanitario (analysisMetrics) legibles
const PHYTO_METRIC_LABELS: Record<string, { label: string; unit: string }> = {
  cesped_m2: { label: 'Césped', unit: ' m²' },
  plantas_superficie_calculada_m2: { label: 'Plantas (superficie)', unit: ' m²' },
  seto_bajo_medio_ml: { label: 'Seto bajo/medio', unit: ' ml' },
  seto_alto_ml: { label: 'Seto alto', unit: ' ml' },
  palmeras_ducha_peq_ud: { label: 'Palmeras ducha (peq.)', unit: ' ud' },
  palmeras_ducha_med_ud: { label: 'Palmeras ducha (med.)', unit: ' ud' },
  palmeras_ducha_alta_ud: { label: 'Palmeras ducha (altas)', unit: ' ud' },
  palmeras_cirugia_ud: { label: 'Palmeras cirugía', unit: ' ud' },
  palmeras_endoterapia_troncos_ud: { label: 'Endoterapia (troncos)', unit: ' ud' },
  arboles_peq_ud: { label: 'Árboles pequeños', unit: ' ud' },
  arboles_med_ud: { label: 'Árboles medianos', unit: ' ud' },
  arboles_gran_ud: { label: 'Árboles grandes', unit: ' ud' },
  herbicida_poca_densidad_m2: { label: 'Herbicida (poca densidad)', unit: ' m²' },
  herbicida_mucha_densidad_m2: { label: 'Herbicida (mucha densidad)', unit: ' m²' },
};

const SECTION_TITLES: Record<string, string> = {
  lawnZones: 'Césped',
  hedgeZones: 'Setos',
  treeGroups: 'Árboles',
  shrubGroups: 'Arbustos',
  palmGroups: 'Palmeras',
  phytosanitaryZones: 'Fitosanitario',
  weedingZones: 'Desbroce',
};

const SECTION_KEYS = Object.keys(SECTION_TITLES) as Array<keyof typeof SECTION_TITLES>;

const prettyValue = (raw: unknown): string => {
  const s = String(raw).replace(/_/g, ' ').toLowerCase();
  return VALUE_LABELS[s] || VALUE_LABELS[String(raw)] || String(raw);
};

export interface DetailRow {
  label: string;
  value: string;
}

// Convierte un item (zona/grupo) en pares etiqueta:valor legibles.
// Solo campos con etiqueta conocida: nunca volcamos claves internas.
export const describeServiceItem = (item: Record<string, unknown>, sectionKey?: string): DetailRow[] => {
  const rows: DetailRow[] = [];
  Object.entries(item).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '' || key === 'id') return;

    if (typeof value === 'boolean') {
      if (value && BOOL_LABELS[key]) rows.push({ label: BOOL_LABELS[key], value: 'Sí' });
      return;
    }

    if (key === 'analysisMetrics' && typeof value === 'object') {
      Object.entries(value as Record<string, unknown>).forEach(([metricKey, metricValue]) => {
        const spec = PHYTO_METRIC_LABELS[metricKey];
        const num = Number(metricValue);
        if (spec && Number.isFinite(num) && num > 0) {
          rows.push({ label: spec.label, value: `${num}${spec.unit}` });
        }
        if (metricKey === 'plantas_tamano_dominante' && metricValue) {
          rows.push({ label: 'Tamaño plantas', value: prettyValue(metricValue) });
        }
      });
      return;
    }

    if (typeof value === 'object') return; // no aplanamos otros objetos anidados

    const label = FIELD_LABELS[key];
    if (!label) return;

    const isEnumField = ['state', 'size', 'aiSizeBand', 'species', 'pruningType', 'type', 'height', 'intent', 'curativeTarget', 'productPreference'].includes(key);
    if (isEnumField) {
      rows.push({ label, value: prettyValue(value) });
      return;
    }

    const unit = key === 'quantity'
      ? (QUANTITY_UNIT_BY_SECTION[sectionKey || ''] ?? ' ud')
      : (FIELD_UNITS[key] || '');
    rows.push({ label, value: `${value}${unit}` });
  });
  return rows;
};

interface DeclaredVariables {
  serviceKey?: string;
  wasteRemoval?: boolean;
  items?: Array<Record<string, unknown>>;
}

interface ServiceDetailCardProps {
  durationHours?: number | null;
  dataInputMode?: string | null;
  /** Payload del RPC get_booking_service_details (fotos y manual). */
  serviceInput?: BookingServiceInput | null;
  /** Fallback para reservas manuales antiguas sin quote enlazado. */
  declaredVariables?: DeclaredVariables | null;
  className?: string;
}

const ItemRows: React.FC<{ rows: DetailRow[]; index?: number; showIndex: boolean }> = ({ rows, index, showIndex }) => {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-gray-50 px-2.5 py-1.5">
      {showIndex && <span className="text-[11px] font-medium text-gray-400">#{(index ?? 0) + 1}</span>}
      {rows.map((r) => (
        <span key={r.label + r.value} className="text-xs text-gray-700">
          <span className="text-gray-500">{r.label}:</span>{' '}
          <strong className="text-gray-800">{r.value}</strong>
        </span>
      ))}
    </div>
  );
};

const ServiceDetailCard: React.FC<ServiceDetailCardProps> = ({
  durationHours,
  dataInputMode,
  serviceInput,
  declaredVariables,
  className,
}) => {
  const isManual = dataInputMode === 'manual';
  const wasteRemoval = serviceInput?.wasteRemoval ?? declaredVariables?.wasteRemoval ?? false;

  // Secciones desde el payload del quote (fuente preferente)
  const sections = serviceInput
    ? SECTION_KEYS
        .map((key) => ({
          key,
          title: SECTION_TITLES[key],
          items: ((serviceInput as Record<string, unknown>)[key] as Array<Record<string, unknown>> | undefined) || [],
        }))
        .filter((section) => section.items.length > 0)
    : [];

  const fallbackItems = sections.length === 0 ? (declaredVariables?.items || []) : [];
  const hasAnyDetail = sections.length > 0 || fallbackItems.length > 0;

  return (
    <div className={`p-3 rounded-lg border border-gray-200 bg-white ${className || ''}`}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-sm font-semibold text-gray-800">Detalle del servicio</p>
        <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 shrink-0">
          {isManual ? <PenLine className="w-3 h-3" /> : <Camera className="w-3 h-3" />}
          {isManual ? 'Declarado por el cliente' : 'Analizado por IA (fotos)'}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-700 mb-1">
        {durationHours != null && (
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-gray-400" />
            Duración estimada: <strong>{durationHours}h</strong>
          </span>
        )}
        {wasteRemoval && <span className="text-emerald-700">Retirada de restos incluida</span>}
      </div>

      {sections.map((section) => (
        <div key={section.key} className="mt-2">
          {sections.length > 1 && (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{section.title}</p>
          )}
          <div className="space-y-1.5">
            {section.items.map((item, idx) => (
              <ItemRows
                key={idx}
                rows={describeServiceItem(item, section.key)}
                index={idx}
                showIndex={section.items.length > 1}
              />
            ))}
          </div>
        </div>
      ))}

      {fallbackItems.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {fallbackItems.map((item, idx) => (
            <ItemRows
              key={idx}
              rows={describeServiceItem(item)}
              index={idx}
              showIndex={fallbackItems.length > 1}
            />
          ))}
        </div>
      )}

      {!hasAnyDetail && (
        <p className="text-xs text-gray-400 mt-1">
          Sin desglose de variables disponible para esta reserva.
        </p>
      )}
    </div>
  );
};

export default ServiceDetailCard;
