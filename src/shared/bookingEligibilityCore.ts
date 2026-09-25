import {
  buildAuthoritativeBookingQuote,
  buildAuthoritativeMultiServiceQuote,
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

/**
 * GarSer Empresas (F7) — trabajos de equipo y de varios días. Un trabajo dura como mucho
 * `MAX_JOB_DAYS` días seguidos desde el elegido y, por cordura, `MAX_JOB_LABOUR_HOURS` horas de
 * trabajo (el mismo tope que `bookings.labour_hours` en la base de datos).
 */
export const MAX_JOB_DAYS = 21;
export const MAX_JOB_LABOUR_HOURS = 250;

/**
 * Horas libres seguidas desde `from`, con el tope de 12 h por jornada y hasta las 20:00. Es la
 * misma regla que `public.free_run` (SQL): la web y el pago tienen que coincidir.
 */
export const freeRun = (hours: Iterable<number>, from: number): number => {
  if (!Number.isFinite(from) || from < 0 || from > 19) return 0;
  const set = hours instanceof Set ? hours : new Set(hours);
  let run = 0;
  while (run < MAX_SINGLE_DAY_DURATION_HOURS && from + run < 20 && set.has(from + run)) run += 1;
  return run;
};

const addIsoDays = (date: string, days: number) => {
  const base = new Date(`${date}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

export type BookingPlanMode = 'single' | 'crew' | 'turns' | 'multi_day';

export interface BookingPlanDay {
  date: string;
  /** Cuántas personas van ese día. */
  people: number;
  /** Horas de trabajo de ese día (sumando a todos). */
  hours: number;
}

export interface BookingPlanShape {
  mode: BookingPlanMode;
  /** Cuántas personas van a la vez como mucho. */
  crew: number;
  /** Lo que dura el primer día (≤ 12): es la `duration_hours` de la reserva. */
  firstDayHours: number;
  /** Último día si son varios; null = un día. */
  endDate: string | null;
  labourHours: number;
  days: BookingPlanDay[];
}

/**
 * GarSer Empresas (F7, A-40) — la forma del trabajo: cuántas personas, cuántos días y lo que
 * dura cada uno. Es la regla de `public.plan_booking_cells` (SQL, la que aparta las horas al
 * pagar) sin decidir QUIÉN va: entre personas igual de válidas el servidor elige la de menos
 * carga, lo que no cambia si se puede ni hasta qué día dura. null = no se puede.
 *  a) un día, con el equipo más pequeño (1 … `maxCrew`): todos desde la hora elegida, las horas
 *     a partes iguales (los primeros, una más), jornada ≤ 12 h y hasta las 20:00;
 *  b) si no, por turnos (D10) si la empresa lo acepta y son 12 h o menos;
 *  c) 12 h o menos nunca en varios días. Más de 12: días seguidos (se saltan los días sin nadie)
 *     hasta `MAX_JOB_DAYS`; el primero todos desde la hora elegida, los demás cada persona desde
 *     su primera hora libre, hasta `maxCrew` personas al día con sus horas libres seguidas.
 * `workerDates` tiene que traer los días siguientes cuando el trabajo pasa de 12 h.
 */
export function planBookingShape(params: {
  workerDates: Map<string, Map<string, number[]>>;
  date: string;
  startHour: number;
  labourHours: number;
  maxCrew?: number;
  allowSplit?: boolean;
}): BookingPlanShape | null {
  const labour = Math.floor(params.labourHours);
  const start = params.startHour;
  if (!(labour >= 1) || labour > MAX_JOB_LABOUR_HOURS || !Number.isInteger(start) || start < 0 || start > 19) return null;
  const maxCrew = Math.max(1, Math.floor(params.maxCrew ?? 1));
  const workers = Array.from(params.workerDates.values());
  const hoursOn = (dates: Map<string, number[]>, date: string) => dates.get(date) || [];

  // a) Un día, el equipo más pequeño.
  const runs = workers.map((dates) => freeRun(hoursOn(dates, params.date), start)).sort((a, b) => b - a);
  for (let k = 1; k <= Math.min(maxCrew, labour); k += 1) {
    const span = Math.ceil(labour / k);
    if (span > MAX_SINGLE_DAY_DURATION_HOURS || start + span > 20) continue;
    const base = Math.floor(labour / k);
    const extra = labour % k;
    if (runs.length >= k && runs[k - 1] >= base && (extra === 0 || runs[extra - 1] >= base + 1)) {
      return {
        mode: k === 1 ? 'single' : 'crew', crew: k, firstDayHours: span, endDate: null, labourHours: labour,
        days: [{ date: params.date, people: k, hours: labour }],
      };
    }
  }

  // b) Por turnos: cada hora la puede hacer alguien.
  if (labour <= MAX_SINGLE_DAY_DURATION_HOURS) {
    if (!params.allowSplit || start + labour > 20) return null;
    for (let hour = start; hour < start + labour; hour += 1) {
      if (!workers.some((dates) => hoursOn(dates, params.date).includes(hour))) return null;
    }
    return {
      mode: 'turns', crew: 1, firstDayHours: labour, endDate: null, labourHours: labour,
      days: [{ date: params.date, people: 1, hours: labour }],
    };
  }

  // c) Varios días.
  let remaining = labour;
  let firstDayHours = 0;
  let crew = 0;
  const days: BookingPlanDay[] = [];
  for (let i = 0; i < MAX_JOB_DAYS; i += 1) {
    const day = addIsoDays(params.date, i);
    const dayRuns = workers
      .map((dates) => {
        const hours = hoursOn(dates, day);
        const from = i === 0 ? start : (hours.length > 0 ? Math.min(...hours) : NaN);
        return freeRun(hours, from);
      })
      .filter((run) => run > 0)
      .sort((a, b) => b - a)
      .slice(0, maxCrew);
    let people = 0;
    let dayHours = 0;
    for (const run of dayRuns) {
      if (remaining === 0) break;
      const len = Math.min(run, remaining);
      remaining -= len;
      people += 1;
      dayHours += len;
      if (i === 0) firstDayHours = Math.max(firstDayHours, len);
    }
    if (i === 0 && people === 0) return null;
    if (people > 0) {
      days.push({ date: day, people, hours: dayHours });
      crew = Math.max(crew, people);
    }
    if (remaining === 0) {
      const endDate = days.length > 1 ? day : null;
      return {
        mode: endDate ? 'multi_day' : 'crew', crew, firstDayHours, endDate, labourHours: labour, days,
      };
    }
  }
  return null;
}

/** Horas de inicio de `date` en las que el trabajo se puede hacer (planBookingShape ≠ null). */
export const getValidStartHoursForPlan = (params: {
  workerDates: Map<string, Map<string, number[]>>;
  date: string;
  labourHours: number;
  maxCrew?: number;
  allowSplit?: boolean;
}) => {
  const candidates = new Set<number>();
  params.workerDates.forEach((dates) => (dates.get(params.date) || []).forEach((hour) => candidates.add(hour)));
  return Array.from(candidates)
    .filter((hour) => Number.isInteger(hour))
    .sort((a, b) => a - b)
    .filter((startHour) => planBookingShape({ ...params, startHour }) !== null);
};

/** La franja elegida con la forma del trabajo (personas, días, fin) para el presupuesto. */
export const buildPlannedSlot = (date: string, startHour: number, plan: BookingPlanShape): BookingQuoteSlotSelection | null => {
  const slot = buildSlotSelection(date, startHour, plan.firstDayHours);
  if (!slot) return null;
  return { ...slot, endDate: plan.endDate, crew: plan.crew, labourHours: plan.labourHours, planDays: plan.days };
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
  /**
   * GarSer Empresas (F7, D11): cuántas personas pueden ir a la vez (autónomo: 1). Con varios
   * días (L > 12), `workerDates` tiene que traer también los 20 días siguientes a cada fecha.
   */
  maxCrew?: number;
  /**
   * GarSer Empresas (F8, D14–D15): los DEMÁS servicios de la visita, cada uno con sus datos y la
   * tarifa del profesional para él. El profesional tiene que ofrecerlos todos. `workerDates`
   * ya tiene que venir filtrado a las personas que los hacen todos (D16).
   */
  mainService?: { serviceId: string; serviceName?: string };
  extraServices?: Array<{
    serviceId: string;
    serviceName?: string;
    bookingInput: SerializableBookingData;
    providerConfig: Record<string, unknown> | null;
  }>;
  requestedDate: string;
  windowEndDate: string;
  restrictToRequestedDate?: boolean;
}): OperationalEligibilityResult {
  if (!params.providerConfig || (params.extraServices || []).some((extra) => !extra.providerConfig)) {
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
    && [params.bookingInput, ...(params.extraServices || []).map((extra) => extra.bookingInput)].some(bookingRequiresPhytosanitaryLicense)
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

  // F8: varios servicios → cada uno con el motor de siempre y su tarifa, y se suman.
  const quote = params.extraServices && params.extraServices.length > 0
    ? buildAuthoritativeMultiServiceQuote([
      {
        serviceId: params.mainService?.serviceId || '',
        serviceName: params.mainService?.serviceName,
        bookingData: params.bookingInput,
        providerConfig: params.providerConfig,
        requiresLicense: bookingRequiresPhytosanitaryLicense(params.bookingInput),
      },
      ...params.extraServices.map((extra) => ({
        serviceId: extra.serviceId,
        serviceName: extra.serviceName,
        bookingData: extra.bookingInput,
        providerConfig: extra.providerConfig,
        requiresLicense: bookingRequiresPhytosanitaryLicense(extra.bookingInput),
      })),
    ])
    : buildAuthoritativeBookingQuote({
      bookingData: params.bookingInput,
      providerConfig: params.providerConfig,
    });

  if (!quote.eligibility.isEligible || quote.totalPrice <= 0 || quote.estimatedHours <= 0) {
    return {
      eligible: false,
      exclusion: toExclusionFromQuote(quote),
    };
  }

  const labourHours = Math.max(1, Math.ceil(quote.estimatedHours));

  // T7 → F7 (D12): los trabajos de más de 12 h ya se pueden reservar, repartidos en varios días
  // (o con varias personas a la vez). Solo queda un tope de cordura, el de la base de datos.
  if (labourHours > MAX_JOB_LABOUR_HOURS) {
    return {
      eligible: false,
      exclusion: buildProviderExclusion(
        'service_exceeds_single_day',
        `Este trabajo necesita ${labourHours} horas de trabajo y no se puede reservar uno de más de ${MAX_JOB_LABOUR_HOURS} horas. Prueba a dividirlo en varios trabajos más pequeños.`,
      ),
    };
  }

  // Un autónomo (o quien no trae el detalle por persona) es una sola persona.
  const workerDates = params.workerDates ?? new Map([['provider', params.providerDates]]);
  const validStartHoursOn = (date: string) => getValidStartHoursForPlan({
    workerDates,
    date,
    labourHours,
    maxCrew: params.maxCrew,
    allowSplit: params.allowSplitAcrossWorkers,
  });
  const planAt = (date: string, startHour: number) => planBookingShape({
    workerDates, date, startHour, labourHours, maxCrew: params.maxCrew, allowSplit: params.allowSplitAcrossWorkers,
  });
  const validHoursForRequestedDate = validStartHoursOn(params.requestedDate);
  const knownDates = new Set<string>(params.providerDates.keys());
  workerDates.forEach((dates) => dates.forEach((_hours, date) => knownDates.add(date)));
  const orderedDates = Array.from(knownDates).sort();
  let earliestSlot: BookingQuoteSlotSelection | null = null;

  for (const date of orderedDates) {
    if (params.restrictToRequestedDate && date !== params.requestedDate) continue;
    if (date < params.requestedDate || date > params.windowEndDate) continue;
    const validHours = validStartHoursOn(date);
    const plan = validHours.length > 0 ? planAt(date, validHours[0]) : null;
    if (plan) {
      earliestSlot = buildPlannedSlot(date, validHours[0], plan);
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

/**
 * GarSer Empresas (F8) — lo que se firma como «versión de la configuración» del profesional: con
 * un servicio, su tarifa (lo de siempre); con varios, las de todos en orden. La web
 * (booking-authority) y el pago (booking-payment) la calculan con ESTA función, así que coinciden
 * por construcción.
 */
export function providerConfigVersionPayload(
  rows: Array<{ updated_at?: string | null; created_at?: string | null; additional_config?: unknown } | null | undefined>,
): string {
  const one = (row?: { updated_at?: string | null; created_at?: string | null; additional_config?: unknown } | null) => ({
    updated_at: row?.updated_at || row?.created_at || '',
    config: row?.additional_config || null,
  });
  return JSON.stringify(rows.length > 1 ? rows.map(one) : one(rows[0]));
}
