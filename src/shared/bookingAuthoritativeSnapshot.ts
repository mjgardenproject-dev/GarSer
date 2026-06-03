import type {
  BookingQuoteAvailability,
  BookingQuoteEconomicBreakdown,
  BookingQuoteMetadata,
  BookingQuoteSlotSelection,
} from './bookingQuoteCore.ts';

export interface BookingAuthoritativeQuoteSnapshot {
  totalPrice: number;
  estimatedHours: number;
  breakdown: Array<{ desc: string; price: number }>;
  warnings: string[];
  metadata: BookingQuoteMetadata;
  economics: BookingQuoteEconomicBreakdown;
  availability: BookingQuoteAvailability;
  quoteId?: string;
  signature?: string;
  expiresAt?: string;
  pricingVersion?: string;
  providerConfigVersion?: string;
}

export interface BookingAuthoritativeQuoteState {
  authoritativeQuoteSnapshot?: BookingAuthoritativeQuoteSnapshot;
  totalPrice?: number;
  estimatedHours?: number;
  priceBreakdown?: Array<{ desc: string; price: number }>;
  quoteWarnings?: string[];
  quoteMetadata?: BookingQuoteMetadata;
  quoteAvailability?: BookingQuoteAvailability;
  quoteEconomics?: BookingQuoteEconomicBreakdown;
  quoteId?: string;
  quoteSignature?: string;
  quoteExpiresAt?: string;
  quotePricingVersion?: string;
  quoteProviderConfigVersion?: string;
}

const hasSelectedSlot = (slot?: BookingQuoteSlotSelection | null): slot is BookingQuoteSlotSelection => {
  return Boolean(slot?.date && slot.startTime && slot.endTime);
};

const hasCompleteSnapshotParts = (input: {
  metadata?: BookingQuoteMetadata;
  availability?: BookingQuoteAvailability;
  economics?: BookingQuoteEconomicBreakdown;
}) => {
  return Boolean(input.metadata?.pricingContext && hasSelectedSlot(input.availability?.selectedSlot) && input.economics);
};

const normalizeWarnings = (warnings?: string[]) => (Array.isArray(warnings) ? warnings : []);

const normalizeBreakdown = (breakdown?: Array<{ desc: string; price: number }>) => {
  return Array.isArray(breakdown) ? breakdown : [];
};

const deriveTotalPrice = (input: {
  totalPrice?: number;
  economics: BookingQuoteEconomicBreakdown;
}) => {
  if (typeof input.totalPrice === 'number' && Number.isFinite(input.totalPrice) && input.totalPrice > 0) {
    return input.totalPrice;
  }
  return input.economics.serviceGrossTotal;
};

const deriveEstimatedHours = (input: {
  estimatedHours?: number;
  availability: BookingQuoteAvailability;
}) => {
  if (typeof input.estimatedHours === 'number' && Number.isFinite(input.estimatedHours) && input.estimatedHours > 0) {
    return input.estimatedHours;
  }
  return Math.max(1, Number(input.availability.selectedSlot?.durationHours || 1));
};

export function buildAuthoritativeQuoteSnapshot(input: {
  totalPrice?: number;
  estimatedHours?: number;
  breakdown?: Array<{ desc: string; price: number }>;
  warnings?: string[];
  metadata?: BookingQuoteMetadata;
  economics?: BookingQuoteEconomicBreakdown;
  availability?: BookingQuoteAvailability;
  quoteId?: string;
  signature?: string;
  expiresAt?: string;
  pricingVersion?: string;
  providerConfigVersion?: string;
}): BookingAuthoritativeQuoteSnapshot | null {
  if (!hasCompleteSnapshotParts(input)) {
    return null;
  }

  return {
    totalPrice: deriveTotalPrice({
      totalPrice: input.totalPrice,
      economics: input.economics!,
    }),
    estimatedHours: deriveEstimatedHours({
      estimatedHours: input.estimatedHours,
      availability: input.availability!,
    }),
    breakdown: normalizeBreakdown(input.breakdown),
    warnings: normalizeWarnings(input.warnings),
    metadata: input.metadata!,
    economics: input.economics!,
    availability: input.availability!,
    quoteId: input.quoteId,
    signature: input.signature,
    expiresAt: input.expiresAt,
    pricingVersion: input.pricingVersion,
    providerConfigVersion: input.providerConfigVersion,
  };
}

export function readAuthoritativeQuoteSnapshot(
  input: BookingAuthoritativeQuoteState,
): BookingAuthoritativeQuoteSnapshot | null {
  const directSnapshot = buildAuthoritativeQuoteSnapshot({
    totalPrice: input.authoritativeQuoteSnapshot?.totalPrice,
    estimatedHours: input.authoritativeQuoteSnapshot?.estimatedHours,
    breakdown: input.authoritativeQuoteSnapshot?.breakdown,
    warnings: input.authoritativeQuoteSnapshot?.warnings,
    metadata: input.authoritativeQuoteSnapshot?.metadata,
    economics: input.authoritativeQuoteSnapshot?.economics,
    availability: input.authoritativeQuoteSnapshot?.availability,
    quoteId: input.authoritativeQuoteSnapshot?.quoteId,
    signature: input.authoritativeQuoteSnapshot?.signature,
    expiresAt: input.authoritativeQuoteSnapshot?.expiresAt,
    pricingVersion: input.authoritativeQuoteSnapshot?.pricingVersion,
    providerConfigVersion: input.authoritativeQuoteSnapshot?.providerConfigVersion,
  });

  if (directSnapshot) {
    return directSnapshot;
  }

  return buildAuthoritativeQuoteSnapshot({
    totalPrice: input.totalPrice,
    estimatedHours: input.estimatedHours,
    breakdown: input.priceBreakdown,
    warnings: input.quoteWarnings,
    metadata: input.quoteMetadata,
    economics: input.quoteEconomics,
    availability: input.quoteAvailability,
    quoteId: input.quoteId,
    signature: input.quoteSignature,
    expiresAt: input.quoteExpiresAt,
    pricingVersion: input.quotePricingVersion,
    providerConfigVersion: input.quoteProviderConfigVersion,
  });
}

export function hasAuthoritativeQuoteSnapshot(input: BookingAuthoritativeQuoteState): boolean {
  return readAuthoritativeQuoteSnapshot(input) !== null;
}

function hasAnyAuthoritativeQuoteInput(input: BookingAuthoritativeQuoteState): boolean {
  return Boolean(
    input.authoritativeQuoteSnapshot ||
      input.quoteMetadata ||
      input.quoteAvailability ||
      input.quoteEconomics ||
      input.quoteId ||
      input.quoteSignature ||
      input.quoteExpiresAt ||
      input.quotePricingVersion ||
      input.quoteProviderConfigVersion ||
      (Array.isArray(input.quoteWarnings) && input.quoteWarnings.length > 0) ||
      (Array.isArray(input.priceBreakdown) && input.priceBreakdown.length > 0),
  );
}

export function clearAuthoritativeQuoteState(): Pick<
  BookingAuthoritativeQuoteState,
  | 'authoritativeQuoteSnapshot'
  | 'priceBreakdown'
  | 'quoteWarnings'
  | 'quoteMetadata'
  | 'quoteAvailability'
  | 'quoteEconomics'
  | 'quoteId'
  | 'quoteSignature'
  | 'quoteExpiresAt'
  | 'quotePricingVersion'
  | 'quoteProviderConfigVersion'
> {
  return {
    authoritativeQuoteSnapshot: undefined,
    priceBreakdown: undefined,
    quoteWarnings: undefined,
    quoteMetadata: undefined,
    quoteAvailability: undefined,
    quoteEconomics: undefined,
    quoteId: undefined,
    quoteSignature: undefined,
    quoteExpiresAt: undefined,
    quotePricingVersion: undefined,
    quoteProviderConfigVersion: undefined,
  };
}

export function normalizeAuthoritativeQuoteState<T extends BookingAuthoritativeQuoteState>(input: T): T {
  const snapshot = readAuthoritativeQuoteSnapshot(input);
  if (!snapshot) {
    if (!hasAnyAuthoritativeQuoteInput(input)) {
      return input;
    }
    return {
      ...input,
      ...clearAuthoritativeQuoteState(),
    };
  }

  return {
    ...input,
    totalPrice: snapshot.totalPrice,
    estimatedHours: snapshot.estimatedHours,
    priceBreakdown: snapshot.breakdown,
    quoteWarnings: snapshot.warnings,
    quoteMetadata: snapshot.metadata,
    quoteAvailability: snapshot.availability,
    quoteEconomics: snapshot.economics,
    quoteId: snapshot.quoteId,
    quoteSignature: snapshot.signature,
    quoteExpiresAt: snapshot.expiresAt,
    quotePricingVersion: snapshot.pricingVersion,
    quoteProviderConfigVersion: snapshot.providerConfigVersion,
    authoritativeQuoteSnapshot: snapshot,
  };
}
