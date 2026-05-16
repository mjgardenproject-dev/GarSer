export type BookingResumeStage = 'draft' | 'checkout' | 'confirmation';
export type BookingResumeFlow = 'wizard' | 'legacy-checkout' | 'legacy-client-home';

export interface BookingResumeRecord<T = unknown> {
  version: 1;
  stage: BookingResumeStage;
  flow: BookingResumeFlow;
  updatedAt: string;
  expiresAt: string;
  nonSerializablePaths?: string[];
  payload: T;
}

interface BookingResumeReadOptions {
  userId?: string | null;
  flow?: BookingResumeFlow;
  allowAnonFallback?: boolean;
}

interface BookingResumeWriteOptions {
  userId?: string | null;
}

const BOOKING_RESUME_KEY_PREFIX = 'booking_resume_v1';
const BOOKING_RESUME_KEY = BOOKING_RESUME_KEY_PREFIX;
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

function isExpired(expiresAt?: string): boolean {
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  return Number.isFinite(ts) && ts <= Date.now();
}

function buildScopeKey(userId?: string | null) {
  return userId ? `user:${userId}` : 'anon';
}

function buildResumeKey(flow: BookingResumeFlow, userId?: string | null) {
  return `${BOOKING_RESUME_KEY_PREFIX}:${buildScopeKey(userId)}:${flow}`;
}

function getCandidateKeys(options: BookingResumeReadOptions = {}) {
  const flows = options.flow ? [options.flow] : KNOWN_FLOWS;
  const keys = flows.map((flow) => buildResumeKey(flow, options.userId));
  if (options.allowAnonFallback) {
    keys.push(...flows.map((flow) => buildResumeKey(flow, null)));
  }
  return Array.from(new Set(keys));
}

function readRecordByKey<T>(key: string): BookingResumeRecord<T> | null {
  const record = safeParse<BookingResumeRecord<T>>(localStorage.getItem(key));
  if (!record) return null;
  if (record.version !== 1 || isExpired(record.expiresAt)) {
    try {
      localStorage.removeItem(key);
    } catch {}
    return null;
  }
  return record;
}

function cleanNonSerializable(value: unknown, currentPath = '', nonSerializablePaths: string[] = []): unknown {
  if (value == null) return value;
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

export function sanitizeBookingPayload<T>(payload: T): T {
  return cleanNonSerializable(payload) as T;
}

export function collectNonSerializablePaths(payload: unknown): string[] {
  const nonSerializablePaths: string[] = [];
  cleanNonSerializable(payload, '', nonSerializablePaths);
  return Array.from(new Set(nonSerializablePaths));
}

export function writeBookingResume<T>(
  stage: BookingResumeStage,
  flow: BookingResumeFlow,
  payload: T,
  options: BookingResumeWriteOptions = {}
): BookingResumeRecord<T> | null {
  try {
    const nonSerializablePaths = collectNonSerializablePaths(payload);
    const record: BookingResumeRecord<T> = {
      version: 1,
      stage,
      flow,
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + STAGE_TTL_MS[stage]).toISOString(),
      nonSerializablePaths,
      payload: sanitizeBookingPayload(payload),
    };
    localStorage.setItem(buildResumeKey(flow, options.userId), JSON.stringify(record));
    return record;
  } catch {
    return null;
  }
}

export function readCanonicalBookingResume<T = unknown>(options: BookingResumeReadOptions = {}): BookingResumeRecord<T> | null {
  const candidates = getCandidateKeys(options)
    .map((key) => readRecordByKey<T>(key))
    .filter(Boolean) as BookingResumeRecord<T>[];

  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}

export function migrateLegacyBookingResume(): BookingResumeRecord | null {
  const bookingProgress = safeParse<{ bookingData?: unknown; currentStep?: number }>(
    localStorage.getItem('bookingProgress')
  );
  if (bookingProgress?.bookingData) {
    return writeBookingResume('draft', 'wizard', bookingProgress, { userId: null });
  }

  const resumeBooking = safeParse<unknown>(localStorage.getItem('resumeBooking'));
  if (resumeBooking) {
    return writeBookingResume('confirmation', 'wizard', resumeBooking, { userId: null });
  }

  const pendingCheckout =
    safeParse<unknown>(localStorage.getItem('pending_checkout')) ||
    safeParse<unknown>(sessionStorage.getItem('pending_checkout'));
  if (pendingCheckout) {
    return writeBookingResume('checkout', 'legacy-checkout', pendingCheckout, { userId: null });
  }

  const bookingDraft = safeParse<unknown>(localStorage.getItem('bookingDraft'));
  if (bookingDraft) {
    return writeBookingResume('draft', 'legacy-client-home', bookingDraft, { userId: null });
  }

  return null;
}

export function readAnyBookingResume<T = unknown>(options: BookingResumeReadOptions = {}): BookingResumeRecord<T> | null {
  return (readCanonicalBookingResume<T>(options) || migrateLegacyBookingResume()) as BookingResumeRecord<T> | null;
}

export function clearBookingResumeStorage() {
  try {
    Object.keys(localStorage)
      .filter((key) => key === BOOKING_RESUME_KEY || key.startsWith(`${BOOKING_RESUME_KEY_PREFIX}:`))
      .forEach((key) => localStorage.removeItem(key));
    LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
    sessionStorage.removeItem('pending_checkout');
  } catch {}
}

export function hasWizardResume(options: BookingResumeReadOptions = {}): boolean {
  const record = readAnyBookingResume({ ...options, flow: 'wizard', allowAnonFallback: options.allowAnonFallback ?? true });
  if (!record) return false;
  if (record.flow === 'legacy-client-home') return false;
  return record.stage === 'draft' || record.stage === 'confirmation';
}
