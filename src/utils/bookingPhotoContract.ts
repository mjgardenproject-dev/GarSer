export const BOOKING_PHOTO_CONTRACT_VERSION = 'booking_photo_v1' as const;

export interface BookingPhotoReferenceInput {
  url?: string;
  storageBucket?: string;
  storagePath?: string;
}

export interface BookingPhotoReference {
  id: string;
  url?: string;
  storageBucket?: string;
  storagePath?: string;
}

export interface BookingPhotoContract {
  schemaVersion: typeof BOOKING_PHOTO_CONTRACT_VERSION;
  items: BookingPhotoReference[];
}

const HTTP_URL_REGEX = /^https?:\/\//i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeHttpUrl(value: unknown): string | undefined {
  const candidate = String(value || '').trim();
  return HTTP_URL_REGEX.test(candidate) ? candidate : undefined;
}

function normalizeAnyUrl(value: unknown): string | undefined {
  const candidate = String(value || '').trim();
  return candidate ? candidate : undefined;
}

function normalizeStorageValue(value: unknown): string | undefined {
  const candidate = String(value || '').trim();
  return candidate ? candidate : undefined;
}

function buildPhotoReferenceId(input: { url?: string; storageBucket?: string; storagePath?: string }): string {
  if (input.storageBucket && input.storagePath) {
    return `storage:${input.storageBucket}:${input.storagePath}`;
  }
  return `url:${input.url || ''}`;
}

export function normalizeBookingPhotoReference(input: unknown): BookingPhotoReference | null {
  if (typeof input === 'string') {
    const url = normalizeHttpUrl(input);
    return url ? { id: buildPhotoReferenceId({ url }), url } : null;
  }

  if (!isRecord(input)) {
    return null;
  }

  const url = normalizeHttpUrl(input.url);
  const storageBucket = normalizeStorageValue(input.storageBucket);
  const storagePath = normalizeStorageValue(input.storagePath);

  if (!url && !(storageBucket && storagePath)) {
    return null;
  }

  return {
    id: buildPhotoReferenceId({ url, storageBucket, storagePath }),
    url,
    storageBucket,
    storagePath,
  };
}

function collectBookingPhotoCandidates(input: unknown, out: unknown[], visited: WeakSet<object>) {
  if (input == null) return;
  if (typeof input === 'string') {
    out.push(input);
    return;
  }

  if (typeof File !== 'undefined' && input instanceof File) {
    return;
  }

  if (Array.isArray(input)) {
    input.forEach((item) => collectBookingPhotoCandidates(item, out, visited));
    return;
  }

  if (!isRecord(input)) {
    return;
  }

  if (visited.has(input)) {
    return;
  }
  visited.add(input);

  if (input.schemaVersion === BOOKING_PHOTO_CONTRACT_VERSION && Array.isArray(input.items)) {
    input.items.forEach((item) => collectBookingPhotoCandidates(item, out, visited));
    return;
  }

  const directReference = normalizeBookingPhotoReference(input);
  if (directReference) {
    out.push(input);
    return;
  }

  Object.entries(input).forEach(([key, value]) => {
    if (key === 'uploadedPhotoUrls' || key === 'photoUrls') {
      if (Array.isArray(value)) value.forEach((item) => out.push(item));
      return;
    }
    if (key === 'photoUrl') {
      out.push(value);
      return;
    }
    collectBookingPhotoCandidates(value, out, visited);
  });
}

export function buildBookingPhotoContract(...sources: unknown[]): BookingPhotoContract {
  const rawCandidates: unknown[] = [];
  const visited = new WeakSet<object>();
  sources.forEach((source) => collectBookingPhotoCandidates(source, rawCandidates, visited));

  const items = Array.from(
    new Map(
      rawCandidates
        .map((candidate) => normalizeBookingPhotoReference(candidate))
        .filter((candidate): candidate is BookingPhotoReference => Boolean(candidate))
        .map((candidate) => [candidate.id, candidate] as const)
    ).values()
  );

  return {
    schemaVersion: BOOKING_PHOTO_CONTRACT_VERSION,
    items,
  };
}

export function extractBookingPhotoUrls(contractLike: unknown): string[] {
  return buildBookingPhotoContract(contractLike).items
    .map((item) => item.url)
    .filter((url): url is string => Boolean(url));
}

export function extractPreferredBookingPhotoUrls(contractLike: unknown, fallbackUrls: unknown[] = []): string[] {
  const canonicalUrls = extractBookingPhotoUrls(contractLike);
  const normalizedFallbackUrls = Array.from(
    new Set(fallbackUrls.map((value) => normalizeAnyUrl(value)).filter((value): value is string => Boolean(value)))
  );

  if (canonicalUrls.length === 0) {
    return normalizedFallbackUrls;
  }

  const transientFallbackUrls = normalizedFallbackUrls.filter((url) => !HTTP_URL_REGEX.test(url));
  return [...canonicalUrls, ...transientFallbackUrls.filter((url) => !canonicalUrls.includes(url))];
}

export function serializeBookingPhotoContract(contractLike: unknown): BookingPhotoReferenceInput[] {
  return buildBookingPhotoContract(contractLike).items.map((item) => ({
    url: item.url,
    storageBucket: item.storageBucket,
    storagePath: item.storagePath,
  }));
}

type BookingPhotoCompatibleData = {
  bookingPhotoContract?: BookingPhotoContract | unknown;
  uploadedPhotoUrls?: string[];
};

export function syncBookingPhotoContractWithLegacy<T extends BookingPhotoCompatibleData>(data: T): T & {
  bookingPhotoContract: BookingPhotoContract;
} {
  const bookingPhotoContract = buildBookingPhotoContract(data.bookingPhotoContract, data);
  const nextUploadedPhotoUrls =
    Array.isArray(data.uploadedPhotoUrls) && data.uploadedPhotoUrls.length > 0
      ? data.uploadedPhotoUrls
      : extractBookingPhotoUrls(bookingPhotoContract);

  return {
    ...data,
    uploadedPhotoUrls: nextUploadedPhotoUrls,
    bookingPhotoContract,
  };
}
