import {
  buildAuthoritativeBookingQuote,
  type BookingEligibilityFailureCode,
  type BookingQuoteResult,
  type BookingQuoteSlotSelection,
  type SerializableBookingData,
} from './bookingQuoteCore.ts';

export type ProviderProfileLike = {
  max_distance: number | null;
  operational_latitude: number | null;
  operational_longitude: number | null;
  // T1 (transversal, 2026-09-13): campos requeridos, no opcionales, a propósito — así
  // cualquier sitio que construya un ProviderProfileLike sin pasarlos falla en tiempo de
  // compilación en vez de dejar pasar silenciosamente a un jardinero sin licencia vigente
  // para un tratamiento que la exige.
  license_verification_status: string | null;
  license_expires_at: string | null;
};

export type ProviderExclusionCode =
  | BookingEligibilityFailureCode
  | 'inactive_service'
  | 'missing_provider_profile'
  | 'missing_coordinates'
  | 'outside_coverage'
  | 'no_reservable_availability'
  | 'missing_phytosanitary_license'
  | 'service_exceeds_single_day';

export type ProviderExclusion = {
  code: ProviderExclusionCode;
  message: string;
};

export type OperationalEligibilityResult =
  | {
      eligible: true;
      quote: BookingQuoteResult;
      providerConfigVersion: string;
      validHoursForRequestedDate: number[];
      earliestSlot: BookingQuoteSlotSelection;
    }
  | {
      eligible: false;
      exclusion: ProviderExclusion;
    };

const buildProviderExclusion = (
  code: ProviderExclusionCode,
  message: string,
): ProviderExclusion => ({
  code,
  message,
});

// (0,0) — "null island" — solo puede venir de un guardado fallido, nunca de una
// dirección real de servicio; tratarlo como coordenadas ausentes permite que el
// backend re-geocodifique y repare el perfil.
const toValidCoordinates = (rawLat: unknown, rawLng: unknown) => {
  if (rawLat == null || rawLng == null || rawLat === '' || rawLng === '') return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
};

export const getClientCoordinates = (bookingInput: SerializableBookingData) =>
  toValidCoordinates(bookingInput?.addressCoordinates?.lat, bookingInput?.addressCoordinates?.lng);

export const getProviderCoordinates = (profile?: ProviderProfileLike | null) =>
  toValidCoordinates(profile?.operational_latitude, profile?.operational_longitude);

export const calculateDistanceKm = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) => {
  const earthRadiusKm = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

export const buildSlotSelection = (
  date: string,
  startHour: number,
  durationHours: number,
): BookingQuoteSlotSelection | null => {
  if (!date || !Number.isFinite(startHour) || startHour < 0) return null;
  const safeDuration = Math.max(1, Math.ceil(durationHours));
  const startTime = `${String(startHour).padStart(2, '0')}:00:00`;
  const endHour = startHour + safeDuration;
  return {
    date,
    startHour,
    startTime,
    endTime: `${String(endHour).padStart(2, '0')}:00:00`,
    durationHours: safeDuration,
  };
};

/**
 * T7 (transversal, D4-a) — tope de horas de UNA reserva de un solo día. No es un número
 * inventado para esta comprobación: es el mismo `duration_hours <= 12` que ya exige, desde
 * hace tiempo, el CHECK de `bookings`/`booking_payment_attempts` y cada RPC del ciclo de vida
 * (`create_broadcast_booking_requests`, `booking_authority_foundations`, etc. — todas paran en
 * 12). Un presupuesto por encima de esto NUNCA podría convertirse en una reserva real, así que
 * conviene decirlo aquí, con un motivo claro, en vez de dejar que el cliente lo descubra al
 * no ver huecos en ninguna fecha.
 */
export const MAX_SINGLE_DAY_DURATION_HOURS = 12;

export const getValidStartHours = (hours: number[], duration: number) => {
  const sorted = Array.from(new Set(hours.filter((hour) => Number.isFinite(hour)))).sort((a, b) => a - b);
  const set = new Set(sorted);
  const valid: number[] = [];

  for (const hour of sorted) {
    let fits = true;
    for (let step = 0; step < duration; step += 1) {
      if (!set.has(hour + step)) {
        fits = false;
        break;
      }
    }
    if (fits) valid.push(hour);
  }

  return valid;
};

/**
 * GarSer Empresas (F4, H-26) — horas de inicio válidas cuando el proveedor tiene varias
 * personas: una hora vale si ALGUNA persona puede hacer el trabajo entero desde ella. No se
 * suman horas de personas distintas: Ana libre de 9 a 10 y Luis de 10 a 11 no hacen un trabajo
 * de 2 horas a las 9.
 */
export const getValidStartHoursForWorkers = (
  workerDates: Map<string, Map<string, number[]>>,
  date: string,
  duration: number,
) => {
  const valid = new Set<number>();
  workerDates.forEach((dates) => {
    getValidStartHours(dates.get(date) || [], duration).forEach((hour) => valid.add(hour));
  });
  return Array.from(valid).sort((a, b) => a - b);
};

/** Una fila de `provider_free_hours` (SQL): una hora libre de una persona de un proveedor. */
export type ProviderFreeHourRow = {
  provider_id: string;
  worker_id: string;
  date: string;
  hour: number;
};

/** proveedor → persona → día → horas libres. */
export type ProviderWorkerIndex = Map<string, Map<string, Map<string, number[]>>>;

export const buildProviderWorkerIndex = (rows: ProviderFreeHourRow[]): ProviderWorkerIndex => {
  const index: ProviderWorkerIndex = new Map();
  rows.forEach((row) => {
    const providerId = String(row.provider_id || '');
    const workerId = String(row.worker_id || '');
    const date = String(row.date || '').slice(0, 10);
    const hour = Number(row.hour);
    if (!providerId || !workerId || !date || !Number.isFinite(hour)) return;
    const workers = index.get(providerId) || new Map<string, Map<string, number[]>>();
    const dates = workers.get(workerId) || new Map<string, number[]>();
    const hours = dates.get(date) || [];
    hours.push(hour);
    dates.set(date, hours);
    workers.set(workerId, dates);
    index.set(providerId, workers);
  });
  return index;
};

/** Todas las horas en que alguien del proveedor está libre (para calendarios y compatibilidad). */
export const mergeWorkerDates = (workerDates: Map<string, Map<string, number[]>>) => {
  const merged = new Map<string, number[]>();
  workerDates.forEach((dates) => {
    dates.forEach((hours, date) => {
      merged.set(date, Array.from(new Set([...(merged.get(date) || []), ...hours])).sort((a, b) => a - b));
    });
  });
  return merged;
};

/**
 * T1 (transversal) — ¿este trabajo necesita el carnet de manipulador de productos
 * fitosanitarios (RD 1311/2012)? Solo lo piden fitosanitarios con producto NO ecológico y
 * desbroce con herbicida — exactamente el mismo criterio que ya usaba `ProvidersPage.tsx`
 * para el TEXTO (nunca para filtrar), ahora reutilizado aquí para filtrar de verdad.
 *
 * D2 (decisión del usuario, 2026-09-13): palmeras se queda FUERA de esta puerta a
 * propósito, aunque su extra fitosanitario (p.ej. Picudo Rojo) tenga la misma base legal.
 *
 * `productPreference` ausente cuenta como químico (no como eco): un dato que falta no
 * puede blanquear el filtro.
 */
export function bookingRequiresPhytosanitaryLicense(
  bookingInput: SerializableBookingData,
): boolean {
  const requiresChemicalPhytosanitary = (bookingInput.phytosanitaryZones || []).some(
    (zone) => zone?.productPreference !== 'ecological',
  );
  const requiresHerbicide = (bookingInput.weedingZones || []).some(
    (zone) => zone?.applyHerbicide === true,
  );
  return requiresChemicalPhytosanitary || requiresHerbicide;
}

/**
 * T1 + D1 — una licencia está VIGENTE cuando el admin la aprobó Y la fecha de caducidad
 * (que el admin escribe al aprobar, `review_gardener_license`) todavía no ha pasado. El
 * booleano `has_phytosanitary_license` NO es la fuente de verdad por sí solo: se deja de
 * usar aquí a propósito porque no sabe de caducidad.
 */
export function isPhytosanitaryLicenseActive(
  profile?: Pick<ProviderProfileLike, 'license_verification_status' | 'license_expires_at'> | null,
): boolean {
  if (!profile) return false;
  if (profile.license_verification_status !== 'approved') return false;
  if (!profile.license_expires_at) return false;
  const expiresAtMs = new Date(profile.license_expires_at).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();
}

const toExclusionFromQuote = (quote: BookingQuoteResult): ProviderExclusion => {
  const firstWarning = quote.warnings[0]?.message
    || 'La configuración del profesional no es operativa para este servicio.';
  const reason = (quote.eligibility.reason || 'missing_pricing_config') as ProviderExclusionCode;
  return buildProviderExclusion(reason, firstWarning);
};

export function evaluateOperationalEligibility(params: {
  bookingInput: SerializableBookingData;
  providerConfig: Record<string, unknown> | null;
  providerConfigVersion: string;
  profile?: ProviderProfileLike | null;
  providerDates: Map<string, number[]>;
  /**
   * GarSer Empresas (F4): horas libres de cada persona que puede hacer el trabajo. Si llega,
   * manda sobre `providerDates` (ver getValidStartHoursForWorkers). Un autónomo es una sola
   * persona: el resultado es el mismo que con `providerDates`.
   */
  workerDates?: Map<string, Map<string, number[]>>;
  /**
   * GarSer Empresas (F4, A-13): en una empresa el carnet es de cada persona, y las personas
   * sin carnet ya vienen excluidas de `workerDates` cuando el trabajo lo exige. Entonces no se
   * mira el carnet de la ficha (una empresa no tiene).
   */
  licenseCheckedPerWorker?: boolean;
  /**
   * GarSer Empresas (F6, D10): la empresa acepta trabajos partidos → una hora vale si cada hora
   * del trabajo la puede hacer ALGUIEN del equipo (por turnos), aunque no sea la misma persona.
   */
  allowSplitAcrossWorkers?: boolean;
  requestedDate: string;
  windowEndDate: string;
  restrictToRequestedDate?: boolean;
}): OperationalEligibilityResult {
  if (!params.providerConfig) {
    return {
      eligible: false,
      exclusion: buildProviderExclusion(
        'inactive_service',
        'El profesional no tiene una oferta activa y operativa para este servicio.',
      ),
    };
  }

  if (!params.profile) {
    return {
      eligible: false,
      exclusion: buildProviderExclusion(
        'missing_provider_profile',
        'Falta el perfil operativo del profesional para validar la elegibilidad.',
      ),
    };
  }

  const clientCoordinates = getClientCoordinates(params.bookingInput);
  const providerCoordinates = getProviderCoordinates(params.profile);
  if (!clientCoordinates || !providerCoordinates) {
    return {
      eligible: false,
      exclusion: buildProviderExclusion(
        'missing_coordinates',
        'No se han podido resolver las coordenadas operativas para validar la cobertura.',
      ),
    };
  }

  const maxDistance = Number(params.profile.max_distance || 0);
  if (maxDistance > 0) {
    const distanceKm = calculateDistanceKm(providerCoordinates, clientCoordinates);
    if (distanceKm > maxDistance) {
      return {
        eligible: false,
        exclusion: buildProviderExclusion(
          'outside_coverage',
          'La dirección del cliente queda fuera del radio operativo del profesional.',
        ),
      };
    }
  }

  // T1 (transversal): un profesional sin licencia vigente para el tratamiento que se pide
  // no es elegible, punto — hasta ahora nada en el backend comprobaba esto y el filtro solo
  // existía como texto en ProvidersPage (nunca filtraba la lista de verdad).
  if (
    !params.licenseCheckedPerWorker
    && bookingRequiresPhytosanitaryLicense(params.bookingInput)
    && !isPhytosanitaryLicenseActive(params.profile)
  ) {
    return {
      eligible: false,
      exclusion: buildProviderExclusion(
        'missing_phytosanitary_license',
        'El profesional no tiene una licencia fitosanitaria vigente para este tratamiento.',
      ),
    };
  }

  const quote = buildAuthoritativeBookingQuote({
    bookingData: params.bookingInput,
    providerConfig: params.providerConfig,
  });

  if (!quote.eligibility.isEligible || quote.totalPrice <= 0 || quote.estimatedHours <= 0) {
    return {
      eligible: false,
      exclusion: toExclusionFromQuote(quote),
    };
  }

  const durationHours = Math.max(1, Math.ceil(quote.estimatedHours));

  // T7 (D4-a, fix mínimo y honesto — sin sistema de reserva multi-día): un presupuesto por
  // encima de `MAX_SINGLE_DAY_DURATION_HOURS` no podría convertirse NUNCA en una reserva real
  // (lo rechaza el CHECK de `duration_hours` en BD, igual en las 7+ RPC del ciclo de vida) —
  // así que no tiene sentido seguir buscando hueco en ninguna fecha ni en ningún profesional:
  // se avisa aquí, de una vez, con un motivo claro. Antes esto caía en el mismo
  // `no_reservable_availability` genérico que "esta fecha en concreto no tiene hueco",
  // indistinguible para el cliente de "prueba otro día" cuando ningún día serviría jamás.
  if (durationHours > MAX_SINGLE_DAY_DURATION_HOURS) {
    return {
      eligible: false,
      exclusion: buildProviderExclusion(
        'service_exceeds_single_day',
        `Este trabajo necesita ${durationHours} horas seguidas y ningún servicio se puede reservar por más de ${MAX_SINGLE_DAY_DURATION_HOURS} horas en un solo día. Prueba a reducir el alcance del trabajo — de momento no ofrecemos reservas repartidas en varios días.`,
      ),
    };
  }

  const workerDates = params.workerDates;
  const mergedByTurns = workerDates && params.allowSplitAcrossWorkers ? mergeWorkerDates(workerDates) : null;
  const validStartHoursOn = (date: string) => (mergedByTurns
    ? getValidStartHours(mergedByTurns.get(date) || [], durationHours)
    : workerDates
      ? getValidStartHoursForWorkers(workerDates, date, durationHours)
      : getValidStartHours(params.providerDates.get(date) || [], durationHours));
  const validHoursForRequestedDate = validStartHoursOn(params.requestedDate);
  const knownDates = new Set<string>(params.providerDates.keys());
  workerDates?.forEach((dates) => dates.forEach((_hours, date) => knownDates.add(date)));
  const orderedDates = Array.from(knownDates).sort();
  let earliestSlot: BookingQuoteSlotSelection | null = null;

  for (const date of orderedDates) {
    if (params.restrictToRequestedDate && date !== params.requestedDate) continue;
    if (date < params.requestedDate || date > params.windowEndDate) continue;
    const validHours = validStartHoursOn(date);
    if (validHours.length > 0) {
      earliestSlot = buildSlotSelection(date, validHours[0], quote.estimatedHours);
      break;
    }
  }

  if (!earliestSlot) {
    return {
      eligible: false,
      exclusion: buildProviderExclusion(
        'no_reservable_availability',
        'El profesional no tiene un hueco reservable válido para la duración estimada.',
      ),
    };
  }

  return {
    eligible: true,
    quote,
    providerConfigVersion: params.providerConfigVersion,
    validHoursForRequestedDate,
    earliestSlot,
  };
}
