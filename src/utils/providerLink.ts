import type { BookingData } from '../contexts/BookingContext';
import { clearAuthoritativeQuoteState } from '../shared/bookingAuthoritativeSnapshot';

/**
 * Enlace de reserva de un profesional (garser.es/reservar/<id>). Cada profesional se lo manda a
 * sus clientes, así que la reserva que se abre desde él tiene que quedar ligada a ESE profesional
 * (`restrictedGardenerId`), haya o no una reserva a medias de antes en el navegador.
 *
 * Aquí vive solo la decisión, sin pantallas ni red: qué pasa con el borrador anterior al entrar
 * por un enlace y qué se le dice al cliente cuando ese profesional no puede hacer el trabajo.
 */

/** Lo que depende del profesional elegido: al cambiar de profesional no puede seguir. */
export function clearProviderSelection(): Partial<BookingData> {
  return {
    providerId: '',
    timeSlot: '',
    preferredDate: '',
    ...clearAuthoritativeQuoteState(),
  };
}

export type ProviderLinkEntry =
  /** El borrador ya era de este profesional: se sigue donde estaba. */
  | { kind: 'unchanged' }
  /** No hay nada que aprovechar: reserva nueva, ligada al profesional. */
  | { kind: 'fresh' }
  /**
   * Había una reserva a medias con otro profesional (o sin ninguno): se conserva lo que describe
   * el trabajo (dirección, servicios y sus detalles) y se quita todo lo que era del anterior
   * (profesional, hora y presupuesto). `missingServiceIds`: servicios elegidos que este
   * profesional no hace; si hay alguno, se vuelve a «Servicios» para que el cliente los cambie.
   */
  | {
      kind: 'rebound';
      updates: Partial<BookingData>;
      step: number;
      missingServiceIds: string[];
    };

/** Pasos del funnel (BookingFlow): 0 dirección, 1 servicios, 2 detalles, 3 profesionales, 4 confirmación. */
const SERVICES_STEP = 1;
const PROVIDERS_STEP = 3;

export function resolveProviderLinkEntry(params: {
  bookingData: Pick<BookingData, 'address' | 'serviceIds' | 'restrictedGardenerId' | 'maintenanceVisitId'>;
  currentStep: number;
  gardenerId: string;
  /** Servicios que ofrece el profesional, o null si no se han podido saber. */
  offeredServiceIds: string[] | null;
}): ProviderLinkEntry {
  const { bookingData, currentStep, gardenerId, offeredServiceIds } = params;
  if (bookingData.restrictedGardenerId === gardenerId) return { kind: 'unchanged' };

  const serviceIds = bookingData.serviceIds || [];
  const hasAddress = Boolean(bookingData.address?.trim());
  // La visita de un plan de mantenimiento es de su profesional y con el precio del plan: no se
  // puede pasar a otro. Se puede volver a abrir desde «Mis reservas».
  if (bookingData.maintenanceVisitId || (!hasAddress && serviceIds.length === 0)) {
    return { kind: 'fresh' };
  }

  const offered = offeredServiceIds ? new Set(offeredServiceIds) : null;
  const missingServiceIds = offered ? serviceIds.filter((id) => !offered.has(id)) : [];
  // Nunca se adelanta al cliente: como mucho vuelve atrás. La confirmación (paso 4) era con el
  // profesional anterior, así que se vuelve a elegir hora con este.
  const maxStep = missingServiceIds.length > 0 ? SERVICES_STEP : PROVIDERS_STEP;
  return {
    kind: 'rebound',
    updates: { restrictedGardenerId: gardenerId, ...clearProviderSelection() },
    step: Math.max(0, Math.min(currentStep, maxStep)),
    missingServiceIds,
  };
}

/**
 * Borradores guardados antes de este arreglo: el enlace fijaba el profesional sin quitar el que
 * ya estaba elegido, y la confirmación seguía con el anterior. Si la reserva está ligada a un
 * profesional y el elegido es otro, se quita la elección y se vuelve a la lista (que solo
 * enseña al del enlace).
 */
export function reconcileProviderLink(
  bookingData: Pick<BookingData, 'restrictedGardenerId' | 'providerId'>,
  currentStep: number,
): { updates: Partial<BookingData>; step: number } | null {
  const linked = bookingData.restrictedGardenerId;
  if (!linked || !bookingData.providerId || bookingData.providerId === linked) return null;
  return { updates: clearProviderSelection(), step: Math.min(currentStep, PROVIDERS_STEP) };
}

/** Quita de la selección los servicios que el profesional del enlace no hace. */
export function splitServicesByOffer(selected: string[], offeredServiceIds: string[]) {
  const offered = new Set(offeredServiceIds);
  return {
    kept: selected.filter((id) => offered.has(id)),
    removed: selected.filter((id) => !offered.has(id)),
  };
}

// ---------------------------------------------------------------------------
// Por qué el profesional del enlace no sale en «Profesionales»
// ---------------------------------------------------------------------------

export type ProviderLinkBlockReason =
  /** No ofrece el servicio (o alguno de los elegidos). */
  | 'not_offered'
  /** Lo ofrece, pero sus tarifas no cubren el trabajo tal y como se ha descrito. */
  | 'not_configured'
  | 'outside_coverage'
  | 'no_availability'
  /** La dirección del cliente no está en el mapa: es del cliente, no del profesional. */
  | 'address_unlocated'
  | 'needs_license'
  | 'job_too_big'
  /** Su perfil no está listo para recibir reservas (sin zona de trabajo, cuenta cerrada…). */
  | 'unavailable'
  /** Faltan datos del trabajo o el motivo no se conoce. */
  | 'details';

/** Códigos de exclusión del servidor (bookingEligibilityCore + bookingQuoteCore). */
const NOT_CONFIGURED_CODES = new Set([
  'missing_provider_config',
  'missing_pricing_config',
  'missing_yield_config',
  'missing_treatment_config',
  'invalid_tree_config',
  'partial_palm_coverage',
]);

export function classifyProviderLinkBlock(params: {
  /** El profesional tiene tarifa activa para el servicio principal. */
  offersService: boolean;
  exclusionCode?: string | null;
  hasClientCoordinates: boolean;
}): ProviderLinkBlockReason {
  const { offersService, exclusionCode, hasClientCoordinates } = params;
  if (!offersService) return 'not_offered';
  switch (exclusionCode) {
    case 'inactive_service':
      return 'not_offered';
    case 'outside_coverage':
      return 'outside_coverage';
    case 'no_reservable_availability':
      return 'no_availability';
    case 'missing_coordinates':
      return hasClientCoordinates ? 'unavailable' : 'address_unlocated';
    case 'missing_phytosanitary_license':
      return 'needs_license';
    case 'service_exceeds_single_day':
      return 'job_too_big';
    case 'missing_provider_profile':
      return 'unavailable';
    default:
      return exclusionCode && NOT_CONFIGURED_CODES.has(exclusionCode) ? 'not_configured' : 'details';
  }
}

export type ProviderLinkBlockAction =
  | 'change_address'
  | 'change_services'
  | 'review_details'
  | 'search_later'
  | 'retry';

export interface ProviderLinkBlockCopy {
  title: string;
  detail: string;
  primaryAction: ProviderLinkBlockAction;
  primaryLabel: string;
  /**
   * Decisión del dueño (2026-10-17): «Ver otros profesionales» solo cuando este profesional no
   * puede hacer el trabajo nunca (no cubre la zona o no hace el servicio). Si solo le faltan
   * huecos, no se le enseña la competencia a su cliente: se le ofrecen fechas más adelante.
   */
  offerOtherProviders: boolean;
}

const OFFER_OTHERS: ReadonlySet<ProviderLinkBlockReason> = new Set([
  'not_offered',
  'not_configured',
  'outside_coverage',
  'needs_license',
  'unavailable',
]);

export const formatShortDate = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' }).format(new Date(y, m - 1, d));
};

export const addDaysIso = (isoDate: string, days: number) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  const next = new Date(y, m - 1, d + days);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
};

export function describeProviderLinkBlock(
  reason: ProviderLinkBlockReason,
  context: {
    providerName: string;
    /** Nombre del servicio principal. */
    serviceName?: string;
    /** Varios servicios en la misma visita. */
    multiService?: boolean;
    maxDistanceKm?: number | null;
    /** Primer y último día que se han mirado (fechas ISO). */
    windowStart: string;
    windowEnd: string;
  },
): ProviderLinkBlockCopy {
  const name = context.providerName || 'Este profesional';
  const service = context.multiService
    ? 'alguno de los servicios que has elegido'
    : context.serviceName
      ? `«${context.serviceName}»`
      : 'este servicio';
  const offerOtherProviders = OFFER_OTHERS.has(reason);

  switch (reason) {
    case 'not_offered':
      return {
        title: `${name} no hace este servicio`,
        detail: `${name} no ofrece ${service}. Puedes elegir otro de sus servicios.`,
        primaryAction: 'change_services',
        primaryLabel: 'Elegir otro servicio',
        offerOtherProviders,
      };
    case 'not_configured':
      return {
        title: `${name} no hace este trabajo tal y como lo has descrito`,
        detail: `Sus tarifas para ${service} no cubren alguna de las características que has indicado (tipo, tamaño o tratamiento). Revisa los detalles o elige otro de sus servicios.`,
        primaryAction: 'review_details',
        primaryLabel: 'Revisar los detalles',
        offerOtherProviders,
      };
    case 'outside_coverage': {
      const radius = Number(context.maxDistanceKm) > 0 ? ` (${Number(context.maxDistanceKm)} km)` : '';
      return {
        title: `${name} no trabaja en tu zona`,
        detail: `Tu dirección queda fuera de su radio de trabajo${radius}. Si el trabajo es en otra dirección, cámbiala.`,
        primaryAction: 'change_address',
        primaryLabel: 'Cambiar la dirección',
        offerOtherProviders,
      };
    }
    case 'no_availability':
      return {
        title: `${name} no tiene huecos para este trabajo`,
        detail: `No le queda ningún hueco libre entre el ${formatShortDate(context.windowStart)} y el ${formatShortDate(context.windowEnd)} para las horas que lleva este trabajo.`,
        primaryAction: 'search_later',
        primaryLabel: `Buscar a partir del ${formatShortDate(addDaysIso(context.windowEnd, 1))}`,
        offerOtherProviders,
      };
    case 'address_unlocated':
      return {
        title: 'No hemos podido situar tu dirección',
        detail: `Sin ella no podemos comprobar si ${name} trabaja en tu zona. Vuelve al primer paso y elige la dirección de las sugerencias.`,
        primaryAction: 'change_address',
        primaryLabel: 'Cambiar la dirección',
        offerOtherProviders,
      };
    case 'needs_license':
      return {
        title: `${name} no puede hacer este tratamiento ahora mismo`,
        detail: 'Lleva producto químico y no tiene la licencia fitosanitaria vigente. Prueba con un tratamiento ecológico, si tu servicio lo permite.',
        primaryAction: 'review_details',
        primaryLabel: 'Revisar los detalles',
        offerOtherProviders,
      };
    case 'job_too_big':
      return {
        title: 'Este trabajo es demasiado grande para reservarlo de una vez',
        detail: 'Prueba a dividirlo en varios trabajos más pequeños.',
        primaryAction: 'review_details',
        primaryLabel: 'Revisar los detalles',
        offerOtherProviders,
      };
    case 'unavailable':
      return {
        title: `${name} no admite reservas ahora mismo`,
        detail: 'Su perfil todavía no está listo para recibir reservas en GarSer.',
        primaryAction: 'retry',
        primaryLabel: 'Volver a comprobar',
        offerOtherProviders,
      };
    case 'details':
    default:
      return {
        title: `No hemos podido preparar la reserva con ${name}`,
        detail: 'Revisa los detalles del servicio o vuelve a intentarlo en un momento.',
        primaryAction: 'review_details',
        primaryLabel: 'Revisar los detalles',
        offerOtherProviders,
      };
  }
}
