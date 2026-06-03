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
};

export type ProviderExclusionCode =
  | BookingEligibilityFailureCode
  | 'inactive_service'
  | 'missing_provider_profile'
  | 'missing_coordinates'
  | 'outside_coverage'
  | 'no_reservable_availability';

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

export const getClientCoordinates = (bookingInput: SerializableBookingData) => {
  const rawLat = bookingInput?.addressCoordinates?.lat;
  const rawLng = bookingInput?.addressCoordinates?.lng;
  if (rawLat == null || rawLng == null || rawLat === '' || rawLng === '') return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

export const getProviderCoordinates = (profile?: ProviderProfileLike | null) => {
  const rawLat = profile?.operational_latitude;
  const rawLng = profile?.operational_longitude;
  if (rawLat == null || rawLng == null || rawLat === '' || rawLng === '') return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

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
  const requestedDateHours = params.providerDates.get(params.requestedDate) || [];
  const validHoursForRequestedDate = getValidStartHours(requestedDateHours, durationHours);
  const orderedDates = Array.from(params.providerDates.keys()).sort();
  let earliestSlot: BookingQuoteSlotSelection | null = null;

  for (const date of orderedDates) {
    if (params.restrictToRequestedDate && date !== params.requestedDate) continue;
    if (date < params.requestedDate || date > params.windowEndDate) continue;
    const validHours = getValidStartHours(params.providerDates.get(date) || [], durationHours);
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
