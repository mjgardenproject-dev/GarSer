import { normalizeAuthoritativeQuoteState, readAuthoritativeQuoteSnapshot } from '../shared/bookingAuthoritativeSnapshot';
import { syncBookingPhotoContractWithLegacy } from './bookingPhotoContract';

export type BookingResumeStage = 'draft' | 'checkout' | 'confirmation';
export type BookingResumeFlow = 'wizard' | 'legacy-checkout' | 'legacy-client-home';
export type BookingResumePayloadSchema =
  | 'booking_wizard_progress_v1'
  | 'booking_data_v1'
  | 'legacy_checkout_payload_v1';
export type BookingResumeIssue =
  | 'expired'
  | 'invalid_json'
  | 'invalid_schema'
  | 'quota_exceeded'
  | 'storage_unavailable'
  | 'unknown'
  | 'version_mismatch';

type BrowserStorageKind = 'localStorage' | 'sessionStorage';
type BookingResumeScope = 'anon' | 'user';

interface LegacyCheckoutPayload {
  restrictedGardenerId?: string;
  selectedAddress?: string;
  selectedServiceIds?: string[];
  description?: string;
}

export interface BookingResumeRecord<T = unknown> {
  version: 2;
  schema: 'garser.booking_resume_record.v2';
  payloadSchema: BookingResumePayloadSchema;
  stage: BookingResumeStage;
  flow: BookingResumeFlow;
  updatedAt: string;
  expiresAt: string;
  ownerScope: BookingResumeScope;
  ownerUserId: string | null;
  nonSerializablePaths: string[];
  payload: T;
}

export interface BookingResumeReadOptions {
  userId?: string | null;
  flow?: BookingResumeFlow;
  allowAnonFallback?: boolean;
}

export interface BookingResumeWriteOptions {
  userId?: string | null;
}

export interface ClearBookingResumeOptions {
  userId?: string | null;
  flow?: BookingResumeFlow;
  includeAnonFallback?: boolean;
  includeLegacy?: boolean;
}

export interface ClearLegacyCheckoutArtifactsOptions {
  userId?: string | null;
  includeAnonFallback?: boolean;
  includePendingCheckout?: boolean;
}

export interface BookingResumeWriteResult<T = unknown> {
  record: BookingResumeRecord<T> | null;
  error: BookingResumeIssue | null;
  storage: BrowserStorageKind | null;
}

export interface BookingResumeReadResult<T = unknown> {
  record: BookingResumeRecord<T> | null;
  error: BookingResumeIssue | null;
  sourceKey: string | null;
  storage: BrowserStorageKind | null;
  fromAnonFallback: boolean;
}

const BOOKING_RESUME_KEY_PREFIX = 'booking_resume_v2';
const LEGACY_CANONICAL_KEY_PREFIXES = ['booking_resume_v1'] as const;
const REDIRECT_RESUME_SCHEMA = 'garser.booking_resume_redirect.v1';
const LEGACY_KEYS = ['bookingProgress', 'resumeBooking', 'pending_checkout', 'bookingDraft'] as const;
const KNOWN_FLOWS: BookingResumeFlow[] = ['wizard', 'legacy-checkout', 'legacy-client-home'];

const STAGE_TTL_MS: Record<BookingResumeStage, number> = {
  draft: 7 * 24 * 60 * 60 * 1000,
  checkout: 24 * 60 * 60 * 1000,
  confirmation: 24 * 60 * 60 * 1000,
};

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function pickNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized) return normalized;
    }
  }
  return undefined;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function isExpired(expiresAt?: string): boolean {
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  return Number.isFinite(ts) && ts <= Date.now();
}

function isQuotaExceededError(error: unknown) {
  if (!(error instanceof DOMException)) return false;
  return error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

function getStorageByKind(kind: BrowserStorageKind) {
  return kind === 'localStorage' ? localStorage : sessionStorage;
}

function readStorageValue(key: string) {
  for (const kind of ['localStorage', 'sessionStorage'] as const) {
    try {
      const raw = getStorageByKind(kind).getItem(key);
      if (raw) return { raw, storage: kind } as const;
    } catch {}
  }
  return null;
}

function clearStorageKey(key: string) {
  for (const kind of ['localStorage', 'sessionStorage'] as const) {
    try {
      getStorageByKind(kind).removeItem(key);
    } catch {}
  }
}

function clearPendingCheckoutStorage() {
  clearStorageKey('pending_checkout');
}

function buildScopeKey(userId?: string | null) {
  return userId ? `user:${userId}` : 'anon';
}

function buildResumeKey(flow: BookingResumeFlow, userId?: string | null, prefix = BOOKING_RESUME_KEY_PREFIX) {
  return `${prefix}:${buildScopeKey(userId)}:${flow}`;
}

function parseScopeFromKey(key: string) {
  const parts = key.split(':');
  const flow = parts[parts.length - 1] as BookingResumeFlow | undefined;
  const scopePart = parts[parts.length - 2];
  if (!scopePart || !flow || !KNOWN_FLOWS.includes(flow)) return null;
  if (scopePart === 'anon') {
    return { ownerScope: 'anon' as const, ownerUserId: null, flow };
  }
  if (scopePart === 'user' && parts.length >= 5) {
    return { ownerScope: 'user' as const, ownerUserId: parts[parts.length - 3] || null, flow };
  }
  return null;
}

function getCandidateKeys(options: BookingResumeReadOptions = {}) {
  const flows = options.flow ? [options.flow] : KNOWN_FLOWS;
  const nextKeys = flows.flatMap((flow) => {
    const scopedKeys = [buildResumeKey(flow, options.userId)];
    if (options.allowAnonFallback) {
      scopedKeys.push(buildResumeKey(flow, null));
    }
    return [
      ...scopedKeys,
      ...LEGACY_CANONICAL_KEY_PREFIXES.flatMap((prefix) =>
        scopedKeys.map((key) => key.replace(BOOKING_RESUME_KEY_PREFIX, prefix)),
      ),
    ];
  });
  return Array.from(new Set(nextKeys));
}

function shouldStripTransientPhotoUrl(currentPath: string, value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith('blob:') && !normalized.startsWith('data:')) {
    return false;
  }

  return /(uploadedPhotoUrls\[\]|photoUrls\[\]|photoUrl|bookingPhotoContract\.items\[\]\.url)$/.test(currentPath);
}

function cleanNonSerializable(value: unknown, currentPath = '', nonSerializablePaths: string[] = []): unknown {
  if (value == null) return value;
  if (typeof value === 'string' && shouldStripTransientPhotoUrl(currentPath, value)) {
    if (currentPath) nonSerializablePaths.push(currentPath);
    return undefined;
  }
  if (typeof File !== 'undefined' && value instanceof File) {
    if (currentPath) nonSerializablePaths.push(currentPath);
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanNonSerializable(item, currentPath ? `${currentPath}[]` : '[]', nonSerializablePaths))
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
      const nextPath = currentPath ? `${currentPath}.${key}` : key;
      const cleaned = cleanNonSerializable(nested, nextPath, nonSerializablePaths);
      if (cleaned !== undefined) out[key] = cleaned;
    });
    return out;
  }
  return value;
}

function looksLikeBookingData(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  return (
    Array.isArray(value.serviceIds) ||
    'bookingPhotoContract' in value ||
    'uploadedPhotoUrls' in value ||
    'photos' in value ||
    'servicesData' in value ||
    'authoritativeQuoteSnapshot' in value ||
    'quoteMetadata' in value ||
    'quoteAvailability' in value ||
    'quoteEconomics' in value
  );
}

function hasStrictConfirmationContract(value: unknown) {
  if (!looksLikeBookingData(value)) return false;
  const normalized = normalizeAuthoritativeQuoteState(value);
  return Boolean(
    typeof normalized.providerId === 'string' &&
      normalized.providerId &&
      Array.isArray(normalized.serviceIds) &&
      normalized.serviceIds.length > 0 &&
      readAuthoritativeQuoteSnapshot(normalized),
  );
}

function isValidBookingPhotoContract(value: unknown) {
  if (!isPlainObject(value) || typeof value.schemaVersion !== 'string' || !Array.isArray(value.items)) {
    return false;
  }

  return value.items.every((item) => {
    if (!isPlainObject(item) || typeof item.id !== 'string') return false;
    if ('url' in item && item.url != null && typeof item.url !== 'string') return false;
    if ('storageBucket' in item && item.storageBucket != null && typeof item.storageBucket !== 'string') return false;
    if ('storagePath' in item && item.storagePath != null && typeof item.storagePath !== 'string') return false;
    return true;
  });
}

function isValidPriceBreakdown(value: unknown) {
  if (!Array.isArray(value)) return false;
  return value.every((item) => isPlainObject(item) && typeof item.desc === 'string' && isFiniteNumber(item.price));
}

function isValidBookingDataPayload(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;

  const validators: Array<[string, (input: unknown) => boolean]> = [
    ['address', (input) => typeof input === 'string'],
    ['serviceIds', isStringArray],
    ['restrictedGardenerId', (input) => input == null || typeof input === 'string'],
    ['photos', Array.isArray],
    ['description', (input) => typeof input === 'string'],
    ['preferredDate', (input) => typeof input === 'string'],
    ['timeSlot', (input) => typeof input === 'string'],
    ['providerId', (input) => typeof input === 'string'],
    ['estimatedHours', isFiniteNumber],
    ['totalPrice', isFiniteNumber],
    ['priceBreakdown', isValidPriceBreakdown],
    ['quoteId', (input) => input == null || typeof input === 'string'],
    ['quoteSignature', (input) => input == null || typeof input === 'string'],
    ['quoteExpiresAt', (input) => input == null || typeof input === 'string'],
    ['quotePricingVersion', (input) => input == null || typeof input === 'string'],
    ['quoteProviderConfigVersion', (input) => input == null || typeof input === 'string'],
    ['quoteWarnings', (input) => input == null || isStringArray(input)],
    ['quoteMetadata', (input) => input == null || isPlainObject(input)],
    ['quoteAvailability', (input) => input == null || isPlainObject(input)],
    ['quoteEconomics', (input) => input == null || isPlainObject(input)],
    ['aiQuantity', (input) => input == null || isFiniteNumber(input)],
    ['aiUnit', (input) => input == null || typeof input === 'string'],
    ['aiDifficulty', (input) => input == null || isFiniteNumber(input)],
    ['aiTasks', (input) => input == null || Array.isArray(input)],
    ['lawnSpecies', (input) => input == null || typeof input === 'string'],
    ['palmSpecies', (input) => input == null || typeof input === 'string'],
    ['palmHeight', (input) => input == null || typeof input === 'string'],
    ['palmState', (input) => input == null || typeof input === 'string'],
    ['palmWasteRemoval', (input) => input == null || typeof input === 'boolean'],
    ['wasteRemoval', (input) => input == null || typeof input === 'boolean'],
    ['palmGroups', (input) => input == null || Array.isArray(input)],
    ['uploadedPhotoUrls', (input) => input == null || isStringArray(input)],
    ['isAnalyzing', (input) => input == null || typeof input === 'boolean'],
    ['lawnZones', (input) => input == null || Array.isArray(input)],
    ['hedgeFaces', (input) => input == null || isPlainObject(input)],
    ['hedgeZones', (input) => input == null || Array.isArray(input)],
    ['treeGroups', (input) => input == null || Array.isArray(input)],
    ['shrubGroups', (input) => input == null || Array.isArray(input)],
    ['phytosanitaryZones', (input) => input == null || Array.isArray(input)],
    ['weedingZones', (input) => input == null || Array.isArray(input)],
    ['servicesData', (input) => input == null || isPlainObject(input)],
    ['bookingPhotoContract', (input) => input == null || isValidBookingPhotoContract(input)],
  ];

  return validators.every(([key, validator]) => !(key in value) || validator(value[key]));
}

function isValidWizardProgressPayload(value: unknown): value is { bookingData: Record<string, unknown>; currentStep: number } {
  if (!isPlainObject(value)) return false;
  if (!isValidBookingDataPayload(value.bookingData)) return false;
  const currentStep = value.currentStep;
  if (typeof currentStep !== 'number' || !Number.isInteger(currentStep) || currentStep < 0 || currentStep > 4) {
    return false;
  }
  if ('timestamp' in value && value.timestamp != null && typeof value.timestamp !== 'string') return false;
  return true;
}

function normalizeLegacyCheckoutPayload(value: unknown): LegacyCheckoutPayload | null {
  if (!isPlainObject(value)) return null;

  const selectedServiceIds = normalizeStringArray(
    value.selectedServiceIds ??
      (typeof value.selectedServiceId === 'string' ? [value.selectedServiceId] : null) ??
      value.serviceIds ??
      (typeof value.serviceId === 'string' ? [value.serviceId] : null),
  );
  const normalized: LegacyCheckoutPayload = {
    restrictedGardenerId: pickNonEmptyString(value.restrictedGardenerId, value.gardenerId),
    selectedAddress: pickNonEmptyString(value.selectedAddress, value.address),
    selectedServiceIds,
    description: pickNonEmptyString(value.description),
  };

  if (
    !normalized.restrictedGardenerId &&
    !normalized.selectedAddress &&
    selectedServiceIds.length === 0 &&
    !normalized.description
  ) {
    return null;
  }

  return normalized;
}

function isValidLegacyCheckoutPayload(value: unknown) {
  return normalizeLegacyCheckoutPayload(value) !== null;
}

function getPayloadSchema(stage: BookingResumeStage, flow: BookingResumeFlow): BookingResumePayloadSchema {
  if (flow === 'legacy-checkout') return 'legacy_checkout_payload_v1';
  if (stage === 'draft' && flow === 'wizard') return 'booking_wizard_progress_v1';
  return 'booking_data_v1';
}

function isValidPayloadForSchema(schema: BookingResumePayloadSchema, payload: unknown) {
  if (schema === 'booking_wizard_progress_v1') return isValidWizardProgressPayload(payload);
  if (schema === 'legacy_checkout_payload_v1') return isValidLegacyCheckoutPayload(payload);
  return isValidBookingDataPayload(payload);
}

function isValidPayloadForRecord(
  stage: BookingResumeStage,
  flow: BookingResumeFlow,
  schema: BookingResumePayloadSchema,
  payload: unknown,
) {
  if (!isValidPayloadForSchema(schema, payload)) return false;
  if (stage === 'confirmation' && flow === 'wizard') {
    return hasStrictConfirmationContract(payload);
  }
  return true;
}

function buildRecord<T>(
  stage: BookingResumeStage,
  flow: BookingResumeFlow,
  payload: T,
  options: BookingResumeWriteOptions = {},
): BookingResumeRecord<T> {
  const sanitizedPayload = sanitizeBookingPayload(payload);
  return {
    version: 2,
    schema: 'garser.booking_resume_record.v2',
    payloadSchema: getPayloadSchema(stage, flow),
    stage,
    flow,
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + STAGE_TTL_MS[stage]).toISOString(),
    ownerScope: options.userId ? 'user' : 'anon',
    ownerUserId: options.userId || null,
    nonSerializablePaths: collectNonSerializablePaths(payload),
    payload: sanitizedPayload,
  };
}

function tryParseLegacyCanonicalRecord<T>(key: string, value: unknown): BookingResumeRecord<T> | null {
  if (!isPlainObject(value) || value.version !== 1) return null;
  if (typeof value.stage !== 'string' || typeof value.flow !== 'string') return null;
  if (!KNOWN_FLOWS.includes(value.flow as BookingResumeFlow)) return null;
  if (!['draft', 'checkout', 'confirmation'].includes(value.stage)) return null;
  if (typeof value.updatedAt !== 'string' || typeof value.expiresAt !== 'string' || isExpired(value.expiresAt)) {
    return null;
  }

  const parsedScope = parseScopeFromKey(key);
  if (!parsedScope || parsedScope.flow !== value.flow) return null;

  const payloadSchema = getPayloadSchema(value.stage as BookingResumeStage, value.flow as BookingResumeFlow);
  if (!isValidPayloadForRecord(value.stage as BookingResumeStage, value.flow as BookingResumeFlow, payloadSchema, value.payload)) {
    return null;
  }

  return {
    version: 2,
    schema: 'garser.booking_resume_record.v2',
    payloadSchema,
    stage: value.stage as BookingResumeStage,
    flow: value.flow as BookingResumeFlow,
    updatedAt: value.updatedAt,
    expiresAt: value.expiresAt,
    ownerScope: parsedScope.ownerScope,
    ownerUserId: parsedScope.ownerUserId,
    nonSerializablePaths: isStringArray(value.nonSerializablePaths) ? value.nonSerializablePaths : [],
    payload: sanitizeBookingPayload(value.payload) as T,
  };
}

function tryParseRecord<T>(key: string, raw: string) {
  const parsed = safeParse<unknown>(raw);
  if (!parsed) return { record: null as BookingResumeRecord<T> | null, error: 'invalid_json' as BookingResumeIssue };

  const migratedLegacyRecord = tryParseLegacyCanonicalRecord<T>(key, parsed);
  if (migratedLegacyRecord) {
    return { record: migratedLegacyRecord, error: null as BookingResumeIssue | null };
  }

  if (!isPlainObject(parsed)) {
    return { record: null as BookingResumeRecord<T> | null, error: 'invalid_schema' as BookingResumeIssue };
  }
  if (parsed.version !== 2) {
    return { record: null as BookingResumeRecord<T> | null, error: 'version_mismatch' as BookingResumeIssue };
  }
  if (parsed.schema !== 'garser.booking_resume_record.v2') {
    return { record: null as BookingResumeRecord<T> | null, error: 'invalid_schema' as BookingResumeIssue };
  }
  if (!KNOWN_FLOWS.includes(parsed.flow as BookingResumeFlow)) {
    return { record: null as BookingResumeRecord<T> | null, error: 'invalid_schema' as BookingResumeIssue };
  }
  if (!['draft', 'checkout', 'confirmation'].includes(String(parsed.stage))) {
    return { record: null as BookingResumeRecord<T> | null, error: 'invalid_schema' as BookingResumeIssue };
  }
  if (!['anon', 'user'].includes(String(parsed.ownerScope))) {
    return { record: null as BookingResumeRecord<T> | null, error: 'invalid_schema' as BookingResumeIssue };
  }
  if (parsed.ownerScope === 'user' && typeof parsed.ownerUserId !== 'string') {
    return { record: null as BookingResumeRecord<T> | null, error: 'invalid_schema' as BookingResumeIssue };
  }
  if (parsed.ownerScope === 'anon' && parsed.ownerUserId != null) {
    return { record: null as BookingResumeRecord<T> | null, error: 'invalid_schema' as BookingResumeIssue };
  }
  if (!isStringArray(parsed.nonSerializablePaths)) {
    return { record: null as BookingResumeRecord<T> | null, error: 'invalid_schema' as BookingResumeIssue };
  }
  if (typeof parsed.updatedAt !== 'string' || typeof parsed.expiresAt !== 'string') {
    return { record: null as BookingResumeRecord<T> | null, error: 'invalid_schema' as BookingResumeIssue };
  }
  if (isExpired(parsed.expiresAt)) {
    return { record: null as BookingResumeRecord<T> | null, error: 'expired' as BookingResumeIssue };
  }
  if (typeof parsed.payloadSchema !== 'string') {
    return { record: null as BookingResumeRecord<T> | null, error: 'invalid_schema' as BookingResumeIssue };
  }
  if (
    !isValidPayloadForRecord(
      parsed.stage as BookingResumeStage,
      parsed.flow as BookingResumeFlow,
      parsed.payloadSchema as BookingResumePayloadSchema,
      parsed.payload,
    )
  ) {
    return { record: null as BookingResumeRecord<T> | null, error: 'invalid_schema' as BookingResumeIssue };
  }

  return {
    record: {
      ...(parsed as unknown as BookingResumeRecord<T>),
      payload: sanitizeBookingPayload(parsed.payload) as T,
    },
    error: null as BookingResumeIssue | null,
  };
}

function readRecordByKey<T>(key: string) {
  const stored = readStorageValue(key);
  if (!stored) {
    return { record: null as BookingResumeRecord<T> | null, error: null as BookingResumeIssue | null, storage: null as BrowserStorageKind | null };
  }

  const parsed = tryParseRecord<T>(key, stored.raw);
  if (!parsed.record) {
    clearStorageKey(key);
    return { record: null as BookingResumeRecord<T> | null, error: parsed.error, storage: stored.storage };
  }

  if (LEGACY_CANONICAL_KEY_PREFIXES.some((prefix) => key.startsWith(`${prefix}:`))) {
    const migrated = writeBookingResumeResult(parsed.record.stage, parsed.record.flow, parsed.record.payload, {
      userId: parsed.record.ownerUserId,
    });
    if (migrated.record) {
      clearStorageKey(key);
      return { record: migrated.record as BookingResumeRecord<T>, error: null as BookingResumeIssue | null, storage: migrated.storage };
    }
  }

  return { record: parsed.record, error: null as BookingResumeIssue | null, storage: stored.storage };
}

export function sanitizeBookingPayload<T>(payload: T): T {
  const cleaned = cleanNonSerializable(payload) as T;
  if (!cleaned || typeof cleaned !== 'object') return cleaned;

  if (looksLikeBookingData(cleaned)) {
    return syncBookingPhotoContractWithLegacy(normalizeAuthoritativeQuoteState(cleaned)) as T;
  }

  if ('bookingData' in (cleaned as Record<string, unknown>)) {
    const record = cleaned as Record<string, unknown>;
    if (looksLikeBookingData(record.bookingData)) {
      return {
        ...(cleaned as Record<string, unknown>),
        bookingData: syncBookingPhotoContractWithLegacy(normalizeAuthoritativeQuoteState(record.bookingData)),
      } as T;
    }
  }

  return cleaned;
}

export function collectNonSerializablePaths(payload: unknown): string[] {
  const nonSerializablePaths: string[] = [];
  cleanNonSerializable(payload, '', nonSerializablePaths);
  return Array.from(new Set(nonSerializablePaths));
}

export function writeBookingResumeResult<T>(
  stage: BookingResumeStage,
  flow: BookingResumeFlow,
  payload: T,
  options: BookingResumeWriteOptions = {},
): BookingResumeWriteResult<T> {
  try {
    const record = buildRecord(stage, flow, payload, options);
    if (!isValidPayloadForRecord(stage, flow, record.payloadSchema, record.payload)) {
      return {
        record: null,
        error: 'invalid_schema',
        storage: null,
      };
    }
    const key = buildResumeKey(flow, options.userId);
    const raw = JSON.stringify(record);

    try {
      localStorage.setItem(key, raw);
      sessionStorage.removeItem(key);
      return { record, error: null, storage: 'localStorage' };
    } catch (localError) {
      try {
        sessionStorage.setItem(key, raw);
        return { record, error: null, storage: 'sessionStorage' };
      } catch (sessionError) {
        return {
          record: null,
          error:
            isQuotaExceededError(localError) || isQuotaExceededError(sessionError)
              ? 'quota_exceeded'
              : 'storage_unavailable',
          storage: null,
        };
      }
    }
  } catch (error) {
    return {
      record: null,
      error: isQuotaExceededError(error) ? 'quota_exceeded' : 'unknown',
      storage: null,
    };
  }
}

export function writeBookingResume<T>(
  stage: BookingResumeStage,
  flow: BookingResumeFlow,
  payload: T,
  options: BookingResumeWriteOptions = {},
): BookingResumeRecord<T> | null {
  return writeBookingResumeResult(stage, flow, payload, options).record;
}

export function readBookingResumeState<T = unknown>(options: BookingResumeReadOptions = {}): BookingResumeReadResult<T> {
  let firstError: BookingResumeIssue | null = null;
  const candidates = getCandidateKeys(options)
    .map((key) => {
      const result = readRecordByKey<T>(key);
      if (result.error && !firstError) {
        firstError = result.error;
      }
      if (!result.record) return null;
      return {
        record: result.record,
        sourceKey: key,
        storage: result.storage,
      };
    })
    .filter(Boolean) as Array<{ record: BookingResumeRecord<T>; sourceKey: string; storage: BrowserStorageKind | null }>;

  if (candidates.length === 0) {
    return {
      record: null,
      error: firstError,
      sourceKey: null,
      storage: null,
      fromAnonFallback: false,
    };
  }

  const latest = candidates.sort((a, b) => Date.parse(b.record.updatedAt) - Date.parse(a.record.updatedAt))[0];
  return {
    record: latest.record,
    error: null,
    sourceKey: latest.sourceKey,
    storage: latest.storage,
    fromAnonFallback: Boolean(options.userId && latest.record.ownerScope === 'anon'),
  };
}

export function readCanonicalBookingResume<T = unknown>(options: BookingResumeReadOptions = {}): BookingResumeRecord<T> | null {
  return readBookingResumeState<T>(options).record;
}

export function claimBookingResumeForUser<T = unknown>(params: {
  userId: string;
  record: BookingResumeRecord<T>;
  sourceKey?: string | null;
}) {
  if (!params.userId) return null;
  const result = writeBookingResumeResult(params.record.stage, params.record.flow, params.record.payload, {
    userId: params.userId,
  });
  if (result.record && params.record.ownerScope === 'anon' && params.sourceKey) {
    clearStorageKey(params.sourceKey);
  }
  return result.record;
}

export function buildBookingResumeRedirectParam<T>(
  stage: BookingResumeStage,
  flow: BookingResumeFlow,
  payload: T,
  options: BookingResumeWriteOptions = {},
) {
  try {
    const record = buildRecord(stage, flow, payload, options);
    if (!isValidPayloadForRecord(stage, flow, record.payloadSchema, record.payload)) {
      return '';
    }
    return encodeURIComponent(
      btoa(
        JSON.stringify({
          schema: REDIRECT_RESUME_SCHEMA,
          version: 1,
          record,
        }),
      ),
    );
  } catch {
    return '';
  }
}

export function parseBookingResumeRedirectParam<T = unknown>(encoded: string | null | undefined) {
  if (!encoded) {
    return { record: null as BookingResumeRecord<T> | null, error: null as BookingResumeIssue | null };
  }

  try {
    const decoded = safeParse<{ schema?: unknown; version?: unknown; record?: unknown }>(
      atob(decodeURIComponent(encoded)),
    );
    if (!decoded || decoded.schema !== REDIRECT_RESUME_SCHEMA || decoded.version !== 1 || !decoded.record) {
      return { record: null as BookingResumeRecord<T> | null, error: 'invalid_schema' as BookingResumeIssue };
    }

    const parsed = tryParseRecord<T>(
      buildResumeKey('wizard', null),
      JSON.stringify(decoded.record),
    );
    return { record: parsed.record, error: parsed.error };
  } catch {
    return { record: null as BookingResumeRecord<T> | null, error: 'invalid_json' as BookingResumeIssue };
  }
}

function migrateLegacyPayload<T>(
  key: string,
  stage: BookingResumeStage,
  flow: BookingResumeFlow,
  options: {
    normalize?: (value: unknown) => T | null;
  } = {},
) {
  const stored = readStorageValue(key);
  if (!stored) return null;

  const parsed = safeParse<unknown>(stored.raw);
  const payload = options.normalize ? options.normalize(parsed) : ((parsed as T | null) ?? null);
  if (!payload) {
    clearStorageKey(key);
    return null;
  }

  const migrated = writeBookingResumeResult(stage, flow, payload, { userId: null });
  if (!migrated.record) {
    if (migrated.error === 'invalid_schema') {
      clearStorageKey(key);
    }
    return null;
  }

  clearStorageKey(key);
  return migrated.record;
}

export function migrateLegacyBookingResume(): BookingResumeRecord | null {
  return (
    migrateLegacyPayload('bookingProgress', 'draft', 'wizard') ||
    migrateLegacyPayload('resumeBooking', 'confirmation', 'wizard') ||
    migrateLegacyPayload('bookingDraft', 'draft', 'legacy-client-home')
  );
}

export function clearLegacyCheckoutArtifacts(options: ClearLegacyCheckoutArtifactsOptions = {}) {
  const includeAnonFallback = options.includeAnonFallback ?? true;
  const scopes = Array.from(
    new Set([
      ...(options.userId !== undefined ? [options.userId] : []),
      ...(includeAnonFallback ? [null] : []),
    ]),
  );

  [BOOKING_RESUME_KEY_PREFIX, ...LEGACY_CANONICAL_KEY_PREFIXES].forEach((prefix) => {
    scopes.forEach((scopeUserId) => {
      clearStorageKey(buildResumeKey('legacy-checkout', scopeUserId, prefix));
    });
  });

  if (options.includePendingCheckout ?? true) {
    clearPendingCheckoutStorage();
  }
}

export function readAnyBookingResume<T = unknown>(options: BookingResumeReadOptions = {}): BookingResumeRecord<T> | null {
  clearLegacyCheckoutArtifacts({
    userId: options.userId,
    includeAnonFallback: options.allowAnonFallback ?? true,
  });
  return (readCanonicalBookingResume<T>(options) || migrateLegacyBookingResume()) as BookingResumeRecord<T> | null;
}

export function clearBookingResumeStorage(options: ClearBookingResumeOptions = {}) {
  try {
    const prefixesToClear = [BOOKING_RESUME_KEY_PREFIX, ...LEGACY_CANONICAL_KEY_PREFIXES];
    const flows = options.flow ? [options.flow] : KNOWN_FLOWS;
    const scopedKeys =
      options.userId !== undefined || options.includeAnonFallback
        ? Array.from(
            new Set(
              flows.flatMap((flow) => {
                const keys = options.userId !== undefined ? [buildResumeKey(flow, options.userId)] : [];
                if (options.includeAnonFallback || !options.userId) {
                  keys.push(buildResumeKey(flow, null));
                }
                return prefixesToClear.flatMap((prefix) =>
                  keys.map((key) => key.replace(BOOKING_RESUME_KEY_PREFIX, prefix)),
                );
              }),
            ),
          )
        : null;

    for (const kind of ['localStorage', 'sessionStorage'] as const) {
      const storage = getStorageByKind(kind);
      Object.keys(storage)
        .filter((key) => {
          if (scopedKeys) return scopedKeys.includes(key);
          return prefixesToClear.some((prefix) => key.startsWith(`${prefix}:`));
        })
        .forEach((key) => storage.removeItem(key));
    }

    if (options.includeLegacy ?? true) {
      LEGACY_KEYS.forEach((key) => {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      });
    } else {
      localStorage.removeItem('pending_checkout');
      sessionStorage.removeItem('pending_checkout');
    }
  } catch {}
}

export function hasWizardResume(options: BookingResumeReadOptions = {}): boolean {
  const record = readAnyBookingResume({
    ...options,
    flow: 'wizard',
    allowAnonFallback: options.allowAnonFallback ?? true,
  });
  if (!record) return false;
  if (record.flow === 'legacy-client-home') return false;
  return record.stage === 'draft' || record.stage === 'confirmation';
}
